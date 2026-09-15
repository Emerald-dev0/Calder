/** @type {import('next').NextConfig} */
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
