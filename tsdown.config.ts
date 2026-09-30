import { defineConfig } from 'tsdown';

// One ESM file for the CLI, with the workspace packages and their dependencies bundled in.
export default defineConfig({
  entry: { main: 'packages/cli/src/main.ts' },
  format: ['esm'],
  outDir: 'packages/cli/dist',
  target: 'node24',
  clean: true,
  dts: false,
  sourcemap: false,
  // The Anthropic SDK uses dynamic imports; keep them in the one file rather than split into chunks.
  outputOptions: { codeSplitting: false },
  outExtensions: () => ({ js: '.mjs' }),
});
