/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
    // Keep these packages unbundled so OTel monkey-patching works at runtime.
    // In Next.js 14 this lives under experimental; renamed to serverExternalPackages in v15.
    serverComponentsExternalPackages: [
      '@opentelemetry/sdk-node',
      '@opentelemetry/auto-instrumentations-node',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-metrics',
      '@opentelemetry/semantic-conventions',
      '@grpc/grpc-js',
      // Keep pg unbundled so @opentelemetry/instrumentation-pg can patch require('pg')
      'pg',
      'pg-native',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Mark ALL @opentelemetry and @grpc packages as CommonJS externals.
      // These packages use Node.js built-ins (stream, path, net, tls…) that
      // webpack cannot bundle — they are loaded at runtime from node_modules.
      const existingExternals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...existingExternals,
        ({ request }, callback) => {
          if (request && (request.startsWith('@opentelemetry/') || request.startsWith('@grpc/'))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        stream: false, net: false, tls: false, fs: false, http2: false, dns: false, path: false,
      };
    }
    return config;
  },
  // Caddy owns /images in deployed environments. The rewrite keeps the same
  // catalogue usable when the documented localhost:3000 path bypasses Caddy.
  async rewrites() {
    const cdn = process.env.CLOUDFRONT_DOMAIN;
    if (!cdn) return [];
    return [{ source: '/images/:file', destination: `https://${cdn}/:file` }];
  },
  images: {
    remotePatterns: (() => {
      const domain = process.env.CADDY_DOMAIN;
      if (domain && domain !== 'localhost') {
        return [{ protocol: 'https', hostname: domain }];
      }
      return [{ protocol: 'http', hostname: 'localhost' }];
    })(),
  },
};

module.exports = nextConfig;
