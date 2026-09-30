# pkgwarden

[![ci](https://github.com/chetan1029/pkgwarden/actions/workflows/ci.yml/badge.svg)](https://github.com/chetan1029/pkgwarden/actions/workflows/ci.yml)

How to run it, every flag and variable, exit codes and refusal messages: [docs/running.md](docs/running.md).

pkgwarden reviews npm dependency changes before they reach main. When a pull request adds or upgrades a package, a small set of agents checks it and gives one of four verdicts: **allow**, **review**, **block** or **undecided**, with the evidence behind it.

Rules run first. A model is only called when a rule flags something it can't settle on its own, and the strongest model is only asked to confirm a block. Most reviews cost nothing.

```text
▸ fast-json-kit 2.0.0 → 2.0.1
review-package#1     ⚑ [high] install-script: install script added or changed since 2.0.0 (postinstall: node scripts/setup.js)
review-package#1     ⚑ [high] suspicious-code: new install-time code reads environment variables, makes network requests
review-package#1     ⚑ [medium] fresh-publish: published 24 hours ago
diff-judge#1         → offline-small (reserved $0.011)
diff-judge#1         ← offline-small in 1ms, 1200 in / 300 out, $0.0027
diff-confirm#1       → offline-large (reserved $0.205)
diff-confirm#1       ← offline-large in 0ms, 1200 in / 300 out, $0.013
review-package#1     – maintenance-judge skipped: no rule asked for it

BLOCK     fast-json-kit 2.0.0 → 2.0.1
          • diff judge: The new code reads environment variables, sends data over the network.
          • the package contains text that tries to instruct AI reviewers
          • published 24 hours ago
```

That is `pkgwarden demo prompt-injection`: a fake package with a malicious install script and a README that tells AI reviewers to mark it safe.

## Try it

Needs Node 24 and pnpm 10.

```bash
pnpm install
pnpm pkgwarden demo                      # list the built-in scenarios
pnpm pkgwarden demo postinstall-exfil    # offline, no API key
pnpm pkgwarden check lodash@4.17.20      # a real package from the registry
pnpm pkgwarden diff old/pnpm-lock.yaml pnpm-lock.yaml
```

`pnpm pkgwarden` runs the source with tsx. `pnpm run build` bundles the CLI into one file, `packages/cli/dist/main.mjs`. Without `ANTHROPIC_API_KEY` it runs rules only.

## See it in the browser

```bash
pnpm web
```

Opens the replay viewer at http://localhost:3000: every scenario, replayed event by event, with the agents, checks, budget and verdict updating as it goes, plus a second run of each served from the cache. The site is static (`apps/web`, Next.js): the traces are recorded when it builds, so hosting it needs no server and no API key. Deploy steps are in [docs/running.md](docs/running.md#the-website).

## How it works

For each package change, `review-package` collects evidence from the npm registry, OSV.dev, deps.dev and the tarballs of both versions. The tarballs are read in memory, never installed or run. Then it runs 15 rules:

| Rules           | What they look for                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known issues    | malicious-package reports, known vulnerabilities, integrity mismatch                                                                                                                          |
| Code            | install scripts added or changed, suspicious patterns in new code (process spawning, eval, base64 payloads, network calls at install time, credential paths, obfuscation), new minified files |
| People          | new publisher, new maintainers, lookalike names of popular packages                                                                                                                           |
| Everything else | fresh publish, new young dependencies, size jumps, licence changes, dropped provenance, deprecation, stale packages                                                                           |

Two judges handle what rules can't decide:

- **diff judge** reads only the flagged parts of the diff. It has no tools, so text inside a package can't make it fetch or change anything. It starts on a small model, and a high-risk answer is confirmed by the large model before anything is blocked.
- **maintenance judge** looks at the GitHub repository with four read-only tools, at most four calls, when a package looks stale.

The final verdict is plain code in [`verdict.ts`](packages/review/src/review/verdict.ts), so you can read exactly why something was blocked.

## The engine

The npm reviewer runs on a small agent engine (`packages/engine`) that knows nothing about npm:

- **Declared access.** Each agent's definition lists its tools, its sub-agents, a step limit, a timeout and a budget. The engine checks every definition before a run can start, and it runs every tool call itself, so a model can ask for anything but only declared tools actually run. Refusals are recorded.
- **Budgets that nest.** Run, package and agent. Before each model call the engine reserves the worst case (estimated input plus `max_tokens`), then settles to the real usage. If the reservation doesn't fit, the agent ends as `out_of_budget`, which becomes `undecided`, never `allow`.
- **Content-addressed judgments.** Model answers are cached under a hash of the exact request (model, prompt, messages, schema, settings). The same input never costs twice, and changing the prompt changes every key, so there is nothing to invalidate by hand. Only answers that passed validation are stored.
- **Structured output, checked twice.** Answers come back as JSON Schema structured output and are validated again with Zod. An invalid answer gets one repair turn, then the agent fails.
- **Fallbacks.** Clients per tier are tried in order on retryable errors (429, 5xx, network). The large model also uses server-side fallbacks for safety declines.
- **One trace format.** Every step is a typed event (Zod-validated as it is emitted). The CLI view, replay, tests and evals all fold the same events with one `reduce()` function.

## Evals

`pnpm run eval` runs the 9 built-in scenarios through the whole reviewer with scripted judges, then runs them again on the same cache:

```text
accuracy 9/9 (100%), spent $0.0567
second pass on the same cache: spent $0.0000, reused 9 judgments, saved $0.0567
```

`pnpm run eval:live` does the same with real models. That's the nightly workflow.

## Layout

```text
packages/contracts  versioned Zod schemas for events, verdicts and agent definitions, plus reduce()
packages/engine     runtime (runner, tool gate, budgets, deadlines), models, stores, trace, logger
packages/review     npm sources, tarball reader, analysis, rules, judges, verdict, scenarios
packages/cli        check, diff, replay, demo
apps/web            the replay viewer: a static Next.js site built from recorded traces
evals               scenario runner, offline and live
docs                running.md (the runbook) and tech-plan.md
```

## Checks

`pnpm run ci:check` is the one command CI runs and you run before pushing: Prettier, ESLint (type-aware), `tsc --noEmit`, dependency-cruiser rules (the engine never imports npm code, contracts import nothing internal, no cycles), the tests, and the offline evals.

## Status

Working: the engine, the npm reviewer, the CLI, the evals and the replay viewer. Next: live reviews on the site (a small worker with a daily spending cap), a GitHub Action that comments on PRs, and an npm release with provenance. See [docs/tech-plan.md](docs/tech-plan.md).

## License

MIT
