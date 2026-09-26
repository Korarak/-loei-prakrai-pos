/** API calls go to the same origin; in dev Next proxies them to the API, in production Nginx Proxy Manager does. */
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

export default {
  output: 'standalone',
  transpilePackages: ['@prakai/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
