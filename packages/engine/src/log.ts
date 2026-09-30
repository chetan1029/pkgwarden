/** Log levels, lowest first. `LOG_LEVEL=silent` turns logging off. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (configured === 'silent') return Number.POSITIVE_INFINITY;
  return order[configured as LogLevel] ?? order.info;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
  if (order[level] < threshold()) return;
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...fields })}\n`);
}

/**
 * The only logger. One JSON object per line on stderr, so stdout stays free for program
 * output. Messages are short and stable; detail goes in fields. Never log secrets or package content.
 */
export const log = {
  debug: (message: string, fields: Record<string, unknown> = {}): void => write('debug', message, fields),
  info: (message: string, fields: Record<string, unknown> = {}): void => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}): void => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}): void => write('error', message, fields),
};
