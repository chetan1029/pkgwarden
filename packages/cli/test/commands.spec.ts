import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCli, UsageError } from '../src/args.js';
import { runCommand } from '../src/commands.js';

let dir: string;
let stdout: string;
const out = {
  stdout: (text: string) => {
    stdout += text;
  },
  stderr: () => {},
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pkgwarden-cli-'));
  stdout = '';
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('commands', () => {
  it('exits 0 for a block by default, because a finding is not a failure', async () => {
    expect(await runCommand(parseCli(['demo', 'postinstall-exfil']), out)).toBe(0);
    expect(stdout).toContain('BLOCK');
  });

  it('exits 1 for a block when asked to fail on blocks', async () => {
    expect(await runCommand(parseCli(['demo', 'postinstall-exfil', '--fail-on', 'block']), out)).toBe(1);
  });

  it('refuses a scenario that does not exist', async () => {
    await expect(runCommand(parseCli(['demo', 'nope']), out)).rejects.toThrow(UsageError);
  });

  it('replays a saved trace to the same verdict', async () => {
    const trace = join(dir, 'run.jsonl');
    await runCommand(parseCli(['demo', 'prompt-injection', '--trace', trace]), out);
    const live = stdout.slice(stdout.indexOf('Verdicts'));
    stdout = '';
    expect(await runCommand(parseCli(['replay', trace]), out)).toBe(0);
    expect(stdout.slice(stdout.indexOf('Verdicts'))).toBe(live);
  });
});
