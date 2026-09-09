import createMDX from "@next/mdx";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@calder/ui"],
  poweredByHeader: false,
  pageExtensions: ["ts", "tsx", "mdx"],
  async redirects() {
    return [{ source: "/blog/hello-avenor", destination: "/blog/hello-calder", permanent: true }];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
