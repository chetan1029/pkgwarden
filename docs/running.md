# Running pkgwarden

## Prerequisites

- Node 24 (the version in `.nvmrc`). `package.json` pins `>=24 <25`, so a newer major is a decision rather than an accident.
- pnpm 10. `packageManager` pins the exact version: `corepack enable` installs it, or `brew install pnpm` and pnpm switches to the pinned version itself.

```bash
pnpm install
cp .env.example .env    # then fill in what you need
set -a; . ./.env; set +a
```

## Project commands

| Command                 | What it does                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm run ci:check`     | Everything CI runs: format check, lint, typecheck, dependency rules, tests, offline evals. Run it before pushing. |
| `pnpm pkgwarden <args>` | Runs the CLI from source with tsx. No build step.                                                                 |
| `pnpm web`              | Records the scenario traces and starts the replay viewer at http://localhost:3000.                                |
| `pnpm run build`        | Bundles the CLI into `packages/cli/dist/main.mjs` and builds the static site into `apps/web/out`.                 |
| `pnpm run build:cli`    | Only the CLI bundle.                                                                                              |
| `pnpm run test`         | Unit tests. No network.                                                                                           |
| `pnpm run eval`         | The 9 scenarios with offline judges. No network, no API key.                                                      |
| `pnpm run eval:live`    | The same scenarios with real models. Needs `ANTHROPIC_API_KEY`. Costs a few cents.                                |
| `pnpm run depcheck`     | Architecture rules in `.dependency-cruiser.cjs`.                                                                  |
| `pnpm run format`       | Formats everything with Prettier, Markdown included.                                                              |

## CLI

```text
pkgwarden check <name[@version]> [--from <version>]
pkgwarden diff <old-lockfile> <new-lockfile>
pkgwarden replay <trace.jsonl>
pkgwarden demo [scenario]
```

- `check` reviews one package. Without a version it takes `latest`; without `--from` it compares against the version published just before.
- `diff` reads two lockfiles (`package-lock.json` or `pnpm-lock.yaml`) and reviews every package version that is new in the second.
- `replay` prints a trace written with `--trace`, as if the run were happening again. A half-written last line is left out with a warning.
- `demo` runs a built-in scenario: fake packages, a fake registry and offline judges, with no network and no API key. Without a name it lists the scenarios.

| Flag                | Default            | Meaning                                                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `--rules-only`      | off                | Never call a model. Anything a judge would have settled goes to `review`.                   |
| `--models`          | off                | Use models even without `ANTHROPIC_API_KEY`, for example with an `ant auth login` profile.  |
| `--budget <usd>`    | `0.50`             | Most the run may spend. The ceiling is `2.00`; asking for more is refused, not lowered.     |
| `--fail-on <level>` | `never`            | Exit 1 when any verdict is at or above `block` or `review`. `undecided` counts as `review`. |
| `--trace <file>`    |                    | Also append every event to a JSONL file.                                                    |
| `--json`            | off                | Print events as JSONL on stdout instead of the readable view.                               |
| `--cache-dir <dir>` | `.pkgwarden/cache` | Where tool results and model judgments are kept between runs.                               |
| `--no-cache`        | off                | Keep nothing between runs.                                                                  |

In CI, gate on blocks with `pkgwarden diff base.yaml pnpm-lock.yaml --fail-on block`.

## The website

`apps/web` is a static Next.js site. Its build first records every scenario twice (cold, then on a warm cache) into `apps/web/public/traces/`, with the offline judges and a fixed clock, then exports plain HTML into `apps/web/out`. Nothing runs at request time.

- **Locally:** `pnpm web`. To serve the built site instead: `pnpm run build`, then any static server over `apps/web/out`.
- **On Vercel:** import the repository, set **Root Directory** to `apps/web`, keep the Next.js preset, and set **Build Command** to `pnpm run build` (so the traces are recorded before `next build`). Vercel installs the whole pnpm workspace from the repository root and reads Node 24 from `apps/web/package.json`. No environment variables are needed.
- **Anywhere else:** upload `apps/web/out` to any static host (Netlify, Cloudflare Pages, S3). Every page is a real `index.html`.

The web build uses webpack (`next build --webpack`) because the workspace packages import `./x.js` for their `.ts` source, and only webpack can map that today (see `apps/web/next.config.ts`).

## Environment variables

| Variable               | Used for                                                                                               | Where it comes from                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`    | Model judges. Without it (or `--models`), runs are rules only.                                         | console.anthropic.com, or a CI secret                 |
| `ANTHROPIC_AUTH_TOKEN` | Alternative to the API key, read by the SDK.                                                           | `ant auth`                                            |
| `GITHUB_TOKEN`         | The maintenance judge's GitHub calls, read at the moment of each call and only sent to api.github.com. | A fine-grained token with no permissions, or CI's own |
| `LOG_LEVEL`            | `debug`, `info` (default), `warn`, `error` or `silent`.                                                |                                                       |

## Output

- **stdout** is the program's output: the readable run view and verdicts, or JSONL events with `--json`. `pkgwarden check x --json | jq` works.
- **stderr** is logs, one JSON object per line: `{"at":"…","level":"warn","message":"…",…}`. `LOG_LEVEL=debug` adds a line per HTTP call (host, path, status, duration; never tokens or package content).
- **Traces** (`--trace`) are append-only JSONL, one event per line. The `run.started` line records the contract version the trace was written with.
- **Cache**: one JSON file per entry under `--cache-dir`. Tarballs and model judgments are kept forever (their keys are content hashes), registry and GitHub data for about an hour, and OSV advisories are never cached.

## Exit codes

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | The review ran. Findings, including `block`, are results, not failures.                      |
| 1    | The review failed or was refused, or `--fail-on` was met.                                    |
| 2    | The command itself was wrong: an unknown option or command, a missing argument, a bad value. |

## Refusals and what they mean

| Message                                                  | What to do                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--budgt is not an option; did you mean --budget?`       | Fix the typo. Every problem on the line is listed at once.                                                                  |
| `--budget 5 is above the ceiling of 2.00 dollars`        | Ask for 2.00 or less. Limits can be lowered per run, never raised.                                                          |
| `--rules-only and --models cannot be used together`      | Pick one.                                                                                                                   |
| `use package-lock.json or pnpm-lock.yaml`                | `yarn.lock` is not read yet.                                                                                                |
| `"x" is not a scenario; run pkgwarden demo to list them` | Run `pkgwarden demo` for the names.                                                                                         |
| `line 12 is not valid JSON` (replay)                     | The trace was edited or corrupted in the middle. A broken last line alone is dropped.                                       |
| `engine configuration is invalid: …`                     | An agent declares a tool or sub-agent that does not exist or is not allowed. Fix the definition; nothing ran.               |
| Verdict `undecided`                                      | A judge was needed but did not finish (budget, timeout, refusal). Read its reason in the verdict; it never counts as allow. |
| Verdict `review` with "not found on the npm registry"    | Check the name for a typo or a dependency-confusion attempt.                                                                |
