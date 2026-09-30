#!/usr/bin/env node
import { LimitRefusal, log } from '@pkgwarden/engine';
import { HELP, parseCli, UsageError } from './args.js';
import { runCommand } from './commands.js';

const out = {
  stdout: (text: string) => void process.stdout.write(text),
  stderr: (text: string) => void process.stderr.write(text),
};

async function main(): Promise<number> {
  try {
    return await runCommand(parseCli(process.argv.slice(2)), out);
  } catch (err) {
    if (err instanceof UsageError) {
      out.stderr(`${err.problems.map(p => `pkgwarden: ${p}`).join('\n')}\n\n${HELP}`);
      return 2;
    }
    if (err instanceof LimitRefusal) {
      log.error('run refused', { reason: err.message });
      return 1;
    }
    log.error('run failed', { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    return 1;
  }
}

process.exitCode = await main();
