/** @type {import('next').NextConfig} */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@calder/ui"],
  poweredByHeader: false,
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@valkey/valkey-glide": false,
    };
    return config;
  },
};

export default nextConfig;
