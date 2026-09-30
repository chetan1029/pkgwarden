# Tech plan

## Goal

Review npm dependency changes (one package, or a lockfile diff) and give one of four verdicts, `allow`, `review`, `block` or `undecided`, with evidence. It runs as a CLI, later as a GitHub Action and as a public website with replay and live modes.

Out of scope for now: PyPI, accounts, users' own API keys, an MCP server, and ever running a package's code.

## Rules the design follows

1. The engine is the only thing that acts. Model agents ask; the engine checks and runs.
2. Rules first. A model is called only when a rule flags something it can't settle.
3. Zod at every boundary: config, API responses, model output, trace events.
4. Everything is a typed event. One trace format feeds every view.
5. `undecided` never counts as `allow`.
6. Package code is never run. Tarballs are read in memory with size and path limits.
7. CI needs no network and no API key.

## Decisions

The repository follows a TypeScript project guide (strict types, Zod at every boundary, one `ci:check`, architecture rules in CI). Where it departs from the guide, the table says why.

| Area               | Choice                                                                                                          | Why                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Node 24 LTS, pinned in `.nvmrc` and `engines` (`>=24 <25`); pnpm pinned through `packageManager`                | As the guide: a new major is a decision                                                                                                                                                                  |
| Modules            | ESM only; workspace packages export their `.ts` source                                                          | Nothing to build between an edit and a run                                                                                                                                                               |
| Dev and build      | tsx runs source; tsdown bundles the CLI into one ESM file                                                       | As the guide                                                                                                                                                                                             |
| TypeScript         | 6.0, strict, `moduleResolution: bundler`, `tsc --noEmit` as the check                                           | The guide says 5.7+. TypeScript 7 ships only the native compiler, without the JavaScript API that type-aware ESLint and dependency-cruiser need, so 6.0 is the newest that works with them               |
| Validation         | Zod 4.6.5, pinned exactly                                                                                       | The guide pins Zod 3.25 from its original project; the rule is "pin exactly what the contract depends on", so this pins the version the code uses                                                        |
| Models             | Anthropic SDK 0.128.0, pinned exactly; beta Messages endpoint; own agent loop                                   | The engine needs a cache lookup, a budget reservation and the tool gate on every turn, so it owns the loop instead of using a tool runner                                                                |
| Model tiers        | small: `claude-haiku-4-5`, falling back to `claude-sonnet-5`; large: `claude-opus-5` with server-side fallbacks | The cheap model does the reading. The strongest one only confirms blocks, which are rare                                                                                                                 |
| Structured output  | `output_config.format` from the Zod schema, then Zod again                                                      | The API constrains the shape, Zod checks the details                                                                                                                                                     |
| Lint and format    | ESLint (type-aware) and Prettier, with the guide's rules                                                        | Adds typescript-eslint's `eslint-recommended` override, which turns off core `no-undef` and `no-redeclare` for TypeScript; without it every Zod schema-and-type pair and every DOM type name is an error |
| Architecture rules | dependency-cruiser, with the guide's rules plus the real boundaries                                             | Adds `no-unresolvable`: an import the checker cannot resolve is one its rules cannot see                                                                                                                 |
| Tests              | Vitest 5, `test/*.spec.ts` per package, fakes in `test/support.ts`                                              | The guide shows Vitest 4                                                                                                                                                                                 |
| Exit codes         | 0 ran (findings included), 1 failed or refused, 2 wrong command                                                 | `--fail-on` is off by default, because a finding is not a failure; CI opts in with `--fail-on block`                                                                                                     |
| Web app            | Next.js 16, static export, Tailwind 4, built with webpack                                                       | Replay needs no server, so the site is plain files. Turbopack cannot map the packages' `./x.js` imports to `.ts` source yet; webpack can with `extensionAlias`                                           |
| Docker             | Not yet                                                                                                         | The guide asks for it when something is deployed. It comes with the worker (milestone 5)                                                                                                                 |

## Packages

- `contracts` depends only on Zod. Events, verdicts, agent definitions and `reduce()`, versioned by `CONTRACT_VERSION`, which every trace records.
- `engine` knows nothing about npm. `runtime/` (runner, tool gate, nested budgets, deadlines, errors), `models/`, `stores/`, `trace/`, the logger and the `Result` type.
- `review` has everything npm-specific: `http/`, `npm/`, `analysis/`, `sources/` (with response and output schemas in their own modules), `rules/`, `judges/`, `review/`, `scenarios/`.
- `cli`: argument parsing, commands, rendering, and a small entry point.
- `apps/web` is the replay viewer. Its pages depend only on `contracts` (a dependency rule enforces it); its recording script runs the reviewer at build time.
- `evals` runs the scenarios offline or live.

Imports flow one way: `contracts` ← `engine` ← `review` ← `cli` / `evals`. dependency-cruiser fails the build otherwise.

## Caching

| What                 | Key                       | Kept                                                           |
| -------------------- | ------------------------- | -------------------------------------------------------------- |
| Tarball              | integrity hash            | forever                                                        |
| Model judgment       | hash of the exact request | forever, only if the answer was valid                          |
| npm metadata, GitHub | package or repo           | about 1 hour                                                   |
| deps.dev             | package and version       | 1 day                                                          |
| OSV advisories       | not cached                | always fresh, because reports can appear hours after a publish |
| Final verdict        | not cached                | rebuilt from the pieces on every run                           |

## Milestones

| #   | Build                                                                       | Status                                  |
| --- | --------------------------------------------------------------------------- | --------------------------------------- |
| 0   | Repo, CI, contracts package                                                 | done                                    |
| 1   | Engine: tool gate, budgets, cache, model loop, traces                       | done                                    |
| 2   | Data sources, rules, CLI (rules only)                                       | done, checked against the live registry |
| 3   | Judges, fixtures, evals                                                     | done: 9 scenarios, offline and live     |
| 4   | Web viewer in replay mode (static traces recorded at build time)            | done: 9 scenarios, cold and cached runs |
| 5   | Worker for live reviews: Hono, SSE, Postgres, per-visitor limits, daily cap | next                                    |
| 6   | Break-it switches, GitHub Action, npm release with provenance               |                                         |

## Known gaps

- The popular-package list for lookalike names is hand-picked. It should be generated from download counts.
- Only `package-lock.json` and `pnpm-lock.yaml` are read. `yarn.lock` is not.
- GitHub Actions are pinned to major versions. Pin them to commit SHAs (for example with Renovate) before the repo goes public.
- A server-side fallback can be served by a different model than the one priced. Cost is estimated at the configured model's price.
