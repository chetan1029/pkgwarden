import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../src/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('log', () => {
  it('writes one JSON object per line to stderr, with detail in fields', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    log.info('run closed', { run_id: 'r1' });
    const line = String(write.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: 'info', message: 'run closed', run_id: 'r1' });
    expect(line.endsWith('\n')).toBe(true);
  });

  it('respects LOG_LEVEL, and silent turns it off', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('LOG_LEVEL', 'warn');
    log.info('hidden');
    log.warn('shown');
    vi.stubEnv('LOG_LEVEL', 'silent');
    log.error('hidden too');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
