import { type AgentContext, type CodeAgent, defineCodeAgent, type Result, settle } from '@pkgwarden/engine';
import { type JudgeNote, PackageTarget, PackageVerdict, targetLabel } from '@pkgwarden/contracts';
import { buildExcerpts, diffPackages } from '../analysis/diff.js';
import { installTimeFiles } from '../analysis/patterns.js';
import type { DiffJudgeInput, DiffJudgment } from '../judges/diff-judge.js';
import type { MaintenanceInput, MaintenanceJudgment } from '../judges/maintenance-judge.js';
import { githubRepo } from '../npm/util.js';
import { type ReviewEvidence, type RuleOutcome, runRules } from '../rules/rules.js';
import type { Advisories, DepsDevSummary, Downloads, PackumentSummary, TarballContents } from '../sources/outputs.js';
import { decideVerdict, type JudgeResult } from './verdict.js';

const MAX_NEW_DEPENDENCY_LOOKUPS = 5;
const EXCERPT_CHARS = 12_000;

/**
 * Reviews one package change: collects evidence, runs every rule, and calls a judge only when a
 * rule asks for one. A package that is not on the registry goes to review, never to allow.
 */
export const reviewPackage: CodeAgent<typeof PackageTarget, typeof PackageVerdict> = defineCodeAgent({
  def: {
    id: 'review-package',
    version: '1',
    description: 'Collects evidence about one package change, runs the rules, and calls a judge only when a rule asks.',
    tools: ['npm.packument', 'npm.downloads', 'npm.tarball', 'osv.query', 'depsdev.version'],
    agents: ['diff-judge', 'diff-confirm', 'maintenance-judge'],
    budget: { maxSteps: 30, maxUsd: 0.4, timeoutMs: 180_000 },
  },
  input: PackageTarget,
  output: PackageVerdict,
  async run(target, ctx) {
    const packument = await ctx.callTool<PackumentSummary>('npm.packument', {
      name: target.name,
      ...(target.to ? { version: target.to } : {}),
      ...(target.from ? { from: target.from } : {}),
    });
    const to = packument.to;
    if (!packument.found || !to) {
      const verdict: PackageVerdict = {
        name: target.name,
        to: target.to ?? 'latest',
        ...(target.from ? { from: target.from } : {}),
        verdict: 'review',
        reasons: ['not found on the npm registry: check the name for a typo or a dependency-confusion attempt'],
        checks: [],
        judges: [],
      };
      ctx.emit({ type: 'verdict', result: verdict });
      return verdict;
    }
    const from = packument.from;
    const label = targetLabel({ name: target.name, from: from?.version, to: to.version });
    const newDependencyNames = Object.keys(to.dependencies).filter(d => !(d in (from?.dependencies ?? {})));

    const [downloads, advisories, depsdev, toTar, fromTar, newDeps] = await Promise.all([
      settle(ctx.callTool<Downloads>('npm.downloads', { name: target.name })),
      settle(ctx.callTool<Advisories>('osv.query', { name: target.name, version: to.version })),
      settle(ctx.callTool<DepsDevSummary>('depsdev.version', { name: target.name, version: to.version })),
      settle(ctx.callTool<TarballContents>('npm.tarball', { url: to.tarball, integrity: to.integrity })),
      from
        ? settle(ctx.callTool<TarballContents>('npm.tarball', { url: from.tarball, integrity: from.integrity }))
        : Promise.resolve(undefined),
      Promise.all(
        newDependencyNames
          .slice(0, MAX_NEW_DEPENDENCY_LOOKUPS)
          .map(name => settle(ctx.callTool<PackumentSummary>('npm.packument', { name })).then(r => ({ name, r })))
      ),
    ]);

    const tarballError = firstFailure(toTar, fromTar);
    // Without the earlier tarball every file would look new, so no diff is better than a wrong one.
    const diff = toTar.ok && (!fromTar || fromTar.ok) ? diffPackages(fromTar?.data.files, toTar.data.files) : undefined;

    const evidence: ReviewEvidence = {
      name: target.name,
      to,
      from,
      packument,
      now: ctx.now(),
      downloads: downloads.ok ? { ok: true, data: downloads.data.weekly } : downloads,
      advisories: advisories.ok ? { ok: true, data: advisories.data.advisories } : advisories,
      licenses: depsdev.ok ? depsdev.data.licenses : undefined,
      diff,
      tarballError,
      newDependencies: newDeps.map(({ name, r }) => ({ name, created: r.ok ? r.data.created : undefined })),
    };

    const outcomes = runRules(evidence);
    for (const { escalate: _escalate, ...check } of outcomes) {
      ctx.emit({ type: 'check.result', target: label, result: check });
    }
    const asked = new Set(outcomes.filter(o => o.status === 'flagged' && o.escalate).map(o => o.escalate));
    const judges: JudgeNote[] = [];

    let diffResult: JudgeResult<DiffJudgment> | undefined;
    if (!asked.has('diff-judge')) {
      ctx.emit({ type: 'agent.skipped', agentId: 'diff-judge', reason: 'no rule asked for it' });
    } else if (!ctx.modelsEnabled || !diff) {
      const reason = ctx.modelsEnabled ? 'no diff to read' : 'rules-only mode';
      ctx.emit({ type: 'agent.skipped', agentId: 'diff-judge', reason });
      diffResult = { status: 'skipped' };
    } else {
      const input = buildDiffJudgeInput(
        evidence,
        outcomes.filter(o => o.status === 'flagged')
      );
      diffResult = await runDiffJudges(ctx, input, label, judges);
    }

    let maintenanceResult: JudgeResult<MaintenanceJudgment> | undefined;
    const repo = githubRepo(to.repository);
    if (!asked.has('maintenance-judge')) {
      ctx.emit({ type: 'agent.skipped', agentId: 'maintenance-judge', reason: 'no rule asked for it' });
    } else if (!ctx.modelsEnabled || !repo) {
      const reason = ctx.modelsEnabled ? 'no GitHub repository listed' : 'rules-only mode';
      ctx.emit({ type: 'agent.skipped', agentId: 'maintenance-judge', reason });
    } else {
      const input: MaintenanceInput = {
        package: target.name,
        owner: repo.owner,
        repo: repo.repo,
        ...(packument.lastPublished ? { lastPublished: packument.lastPublished } : {}),
        versionCount: packument.versionCount,
        weeklyDownloads: evidence.downloads.ok ? evidence.downloads.data : null,
      };
      const outcome = await ctx.runAgent<MaintenanceJudgment>('maintenance-judge', input, label);
      maintenanceResult =
        outcome.status === 'done' ? { status: 'done', judgment: outcome.output } : { status: outcome.status };
      judges.push({
        agentId: 'maintenance-judge',
        status: outcome.status,
        summary:
          outcome.status === 'done'
            ? `${outcome.output.status}: ${outcome.output.reasons.join('; ')}`
            : (outcome.error ?? outcome.status),
      });
    }

    const { verdict, reasons } = decideVerdict({ outcomes, diff: diffResult, maintenance: maintenanceResult });
    const result: PackageVerdict = {
      name: target.name,
      ...(from ? { from: from.version } : {}),
      to: to.version,
      verdict,
      reasons,
      checks: outcomes.map(({ escalate: _escalate, ...check }) => check),
      judges,
    };
    ctx.emit({ type: 'verdict', result });
    return result;
  },
});

function firstFailure(...results: readonly (Result<unknown> | undefined)[]): string | undefined {
  for (const r of results) if (r && !r.ok) return r.detail;
  return undefined;
}

/** The small model reads first; the large model is asked only when the small one says "high". */
async function runDiffJudges(
  ctx: AgentContext,
  input: DiffJudgeInput,
  label: string,
  judges: JudgeNote[]
): Promise<JudgeResult<DiffJudgment>> {
  const first = await ctx.runAgent<DiffJudgment>('diff-judge', input, label);
  if (first.status !== 'done') {
    judges.push({ agentId: 'diff-judge', status: first.status, summary: first.error ?? first.status });
    return { status: first.status };
  }
  judges.push({ agentId: 'diff-judge', status: 'done', summary: `${first.output.risk}: ${first.output.summary}` });
  if (first.output.risk !== 'high') return { status: 'done', judgment: first.output };

  const confirm = await ctx.runAgent<DiffJudgment>('diff-confirm', input, label);
  if (confirm.status !== 'done') {
    judges.push({
      agentId: 'diff-confirm',
      status: confirm.status,
      summary: `could not confirm (${confirm.error ?? confirm.status}), keeping the first judgment`,
    });
    return { status: 'done', judgment: first.output };
  }
  judges.push({
    agentId: 'diff-confirm',
    status: 'done',
    summary: `${confirm.output.risk}: ${confirm.output.summary}`,
  });
  return { status: 'done', judgment: confirm.output };
}

function buildDiffJudgeInput(e: ReviewEvidence, flagged: readonly RuleOutcome[]): DiffJudgeInput {
  const installFiles = installTimeFiles(e.to.scripts);
  const flaggedFiles = new Set(flagged.flatMap(o => o.evidence.flatMap(ev => (ev.file ? [ev.file] : []))));
  const priority = (file: string) =>
    (installFiles.has(file) ? 100 : 0) + (flaggedFiles.has(file) ? 50 : 0) + (/\.(c|m)?js$/.test(file) ? 10 : 0);
  const installScripts = Object.fromEntries(
    ['preinstall', 'install', 'postinstall', 'prepare'].flatMap(h => (e.to.scripts[h] ? [[h, e.to.scripts[h]]] : []))
  );
  return {
    package: e.name,
    ...(e.from ? { from: e.from.version } : {}),
    to: e.to.version,
    findings: flagged.map(o => o.message),
    installScripts,
    excerpts: e.diff ? buildExcerpts(e.diff, priority, EXCERPT_CHARS) : [],
  };
}
