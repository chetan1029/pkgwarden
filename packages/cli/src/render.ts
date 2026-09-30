import {
  describeEvent,
  formatUsd,
  type LineTone,
  type PackageVerdict,
  type RunEvent,
  type RunView,
  targetLabel,
  type Verdict,
} from '@pkgwarden/contracts';

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = paint('2');
const bold = paint('1');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const magenta = paint('35');
const cyan = paint('36');

const TONE: Record<LineTone, (s: string) => string> = {
  plain: s => s,
  muted: dim,
  info: cyan,
  ok: green,
  warn: yellow,
  danger: red,
  limit: magenta,
};

const VERDICT_STYLE: Record<Verdict, (s: string) => string> = {
  allow: green,
  review: yellow,
  undecided: magenta,
  block: red,
};

/** A fixed-width, coloured label such as BLOCK. */
export function verdictBadge(v: Verdict): string {
  return VERDICT_STYLE[v](bold(v.toUpperCase().padEnd(9)));
}

/**
 * One line per interesting event, printed as the run happens. The words come from the shared
 * describeEvent, so the terminal and the web viewer say the same thing. Returns undefined for noise.
 */
export function formatEvent(event: RunEvent): string | undefined {
  if (event.type === 'run.started') {
    const models = event.modelsEnabled ? 'on' : 'off (rules only)';
    return `${bold('pkgwarden')} ${dim('·')} ${event.label} ${dim(`· budget ${formatUsd(event.budgetUsd)} · models ${models}`)}`;
  }
  // The summary at the end already covers these.
  if (event.type === 'run.finished' || event.type === 'verdict') return undefined;
  const line = describeEvent(event);
  if (!line) return undefined;
  if (line.heading) return `\n${cyan(line.icon)} ${bold(line.text)}`;
  const who = event.span ? dim(`${event.span.padEnd(20)} `) : '';
  return `${who}${TONE[line.tone](`${line.icon} ${line.text}`)}`;
}

/** The verdicts and a one-line cost summary, printed at the end of a run. */
export function formatSummary(view: RunView): string {
  const lines = ['', bold('Verdicts')];
  for (const v of view.verdicts) lines.push(formatVerdict(v));
  const tools = `${view.toolCalls} tool calls${view.cachedToolCalls ? ` (${view.cachedToolCalls} cached)` : ''}`;
  const models = `${view.modelCalls} model calls${view.reusedCalls ? `, ${view.reusedCalls} reused` : ''}`;
  const spent = `spent ${formatUsd(view.spentUsd)} of ${formatUsd(view.budgetUsd)} · saved ${formatUsd(view.savedUsd)}`;
  lines.push('', dim(`${spent} · ${models} · ${tools}`));
  if (view.error) lines.push(red(`run failed: ${view.error}`));
  return lines.join('\n');
}

function formatVerdict(v: PackageVerdict): string {
  const out = [`${verdictBadge(v.verdict)} ${targetLabel(v)}`];
  for (const reason of v.reasons.slice(0, 4)) out.push(`${' '.repeat(10)}${dim('•')} ${reason}`);
  return out.join('\n');
}
