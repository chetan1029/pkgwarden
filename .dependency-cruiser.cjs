module.exports = {
  forbidden: [
    {
      name: 'contracts-stay-pure',
      severity: 'error',
      comment: 'The contract is data. It must not reach into the runtime, or it cannot be published alone.',
      from: { path: '^packages/contracts' },
      to: { path: '^packages/(?!contracts)' },
    },
    {
      name: 'engine-knows-nothing-about-npm',
      severity: 'error',
      comment: 'The engine runs any agents. npm knowledge lives in review, so the engine can be reused as it is.',
      from: { path: '^packages/engine' },
      to: { path: '^packages/(review|cli)|^evals' },
    },
    {
      name: 'review-is-not-an-app',
      severity: 'error',
      comment: 'review is a library. The CLI and evals use it; it never reaches back into them.',
      from: { path: '^packages/review' },
      to: { path: '^packages/cli|^evals' },
    },
    {
      name: 'web-only-reads-traces',
      severity: 'error',
      comment:
        'The site shows recorded traces. It depends on the contract, never on the engine or the reviewer; only its recording script runs them.',
      from: { path: '^apps/web/src' },
      to: { path: '^packages/(engine|review|cli)' },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: 'An import the checker cannot resolve is an import these rules cannot see, so it fails the check.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle means the module boundaries are not real.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', 'main\\.ts$', '\\.config\\.(ts|mjs)$', '^apps/web/src/app/', '^apps/web/scripts/'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Build output and Next.js's generated files are not source.
    exclude: { path: '(^|/)(\\.next|out|dist)/|next-env\\.d\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    // Workspace packages export their .ts source, so the resolver has to follow `exports` to .ts files.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
