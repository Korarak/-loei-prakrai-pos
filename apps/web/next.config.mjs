import { fileURLToPath } from 'node:url';

/** API calls go to the same origin and Next proxies them to the API (the API container is not exposed to the proxy). */
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

export default {
  output: 'standalone',
  // Trace from the monorepo root so the standalone server includes packages/core.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@prakai/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
