import type { NextConfig } from 'next';

// A fully static site: every run is a recorded trace, so there is nothing to serve at request time.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Workspace packages export their TypeScript source.
  transpilePackages: ['@pkgwarden/contracts'],
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    // The packages import './x.js' as ESM requires; point webpack at the .ts file behind it.
    // Turbopack cannot do this mapping for workspace packages yet, which is why the scripts pass --webpack.
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return webpackConfig;
  },
};

export default config;
