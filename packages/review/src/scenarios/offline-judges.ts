import { type ModelConfig, type ModelTiers, type Script, scriptedModel } from '@pkgwarden/engine';
import { MAINTENANCE_PROMPT_START } from '../judges/maintenance-judge.js';
import { EVAL_NOW } from './types.js';

/** Stand-in for the diff judge: pattern-based, deterministic, and honest about injection text. */
export const heuristicDiffJudge: Script = request => {
  const first = request.messages[0];
  const text = typeof first?.content === 'string' ? first.content : '';
  const behaviours: { kind: string; description: string; file: string; line: number }[] = [];
  const checks: [string, RegExp, string][] = [
    ['network', /fetch\(|https?\.request\(/, 'sends data over the network'],
    ['env-access', /process\.env/, 'reads environment variables'],
    ['process-exec', /child_process|execSync|spawn\(/, 'starts other processes'],
    ['obfuscation', /_0x[0-9a-f]{4}|eval\(|Buffer\.from\([^)]*base64/, 'decodes and runs hidden code'],
  ];
  for (const block of text.matchAll(/<package_file path="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/package_file>/g)) {
    const [, file = '', body = ''] = block;
    for (const row of body.split('\n')) {
      const m = row.match(/^(\d+): (.*)$/);
      if (!m) continue;
      for (const [kind, re, description] of checks) {
        if (re.test(m[2] ?? '') && !behaviours.some(b => b.kind === kind)) {
          behaviours.push({ kind, description, file, line: Number(m[1]) });
        }
      }
    }
  }
  const kinds = new Set(behaviours.map(b => b.kind));
  const risk =
    kinds.has('obfuscation') || kinds.has('process-exec') || (kinds.has('network') && kinds.has('env-access'))
      ? 'high'
      : kinds.size > 0
        ? 'medium'
        : 'low';
  return {
    output: {
      summary:
        risk === 'low'
          ? 'The added code looks like an ordinary change.'
          : `The new code ${behaviours.map(b => b.description).join(', ')}.`,
      behaviours,
      risk,
      injectionAttempt:
        /ignore (all )?(previous|prior) instructions|mark (this|it)( package)? as safe|report (the )?risk as low/i.test(
          text
        ),
    },
  };
};

/** Stand-in for the maintenance judge. It uses a tool first, like the real one would. */
export function heuristicMaintenanceJudge(now: Date): Script {
  return (request, turn) => {
    const first = request.messages[0];
    const text = typeof first?.content === 'string' ? first.content : '';
    const [, owner = '', repo = ''] = text.match(/Repository: ([\w.-]+)\/([\w.-]+)/) ?? [];
    if (turn === 0) return { toolCalls: [{ name: 'github__repo', input: { owner, repo } }] };
    const last = request.messages.at(-1);
    const block = Array.isArray(last?.content) ? last.content.find(b => b.type === 'tool_result') : undefined;
    const raw = block && 'content' in block && typeof block.content === 'string' ? block.content : '{}';
    const facts = JSON.parse(raw) as { archived?: boolean; pushedAt?: string };
    const stale =
      facts.archived === true || !facts.pushedAt || now.getTime() - Date.parse(facts.pushedAt) > 2 * 365 * 86_400_000;
    return {
      output: {
        status: stale ? 'abandoned' : 'active',
        reasons: [
          stale ? (facts.archived ? 'the repository is archived' : 'no pushes for over two years') : 'recent pushes',
        ],
        evidence: [{ label: 'repository', url: `https://github.com/${owner}/${repo}` }],
      },
    };
  };
}

const offlineScript =
  (now: Date): Script =>
  (request, turn) =>
    request.system.startsWith(MAINTENANCE_PROMPT_START)
      ? heuristicMaintenanceJudge(now)(request, turn)
      : heuristicDiffJudge(request, turn);

/** The offline small tier, priced like Haiku so eval costs look realistic. */
export const OFFLINE_SMALL: ModelConfig = {
  id: 'offline-small',
  tier: 'small',
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 5,
};
/** The offline large tier, priced like Opus. */
export const OFFLINE_LARGE: ModelConfig = {
  id: 'offline-large',
  tier: 'large',
  inputUsdPerMTok: 5,
  outputUsdPerMTok: 25,
};

/** Model tiers for tests and offline evals: no network, no API key, same answers every time. */
export function offlineModels(now: Date = EVAL_NOW): ModelTiers {
  return {
    small: [scriptedModel(OFFLINE_SMALL, offlineScript(now))],
    large: [scriptedModel(OFFLINE_LARGE, offlineScript(now))],
  };
}
