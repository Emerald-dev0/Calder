import createMDX from "@next/mdx";

/** @type {import('next').NextConfig} */
const nextConfig = {
 reactStrictMode: true,
 transpilePackages: ["@calder/ui"],
 poweredByHeader: false,
 async headers() {
  const headers = [
   { key: "X-Content-Type-Options", value: "nosniff" },
   { key: "X-Frame-Options", value: "DENY" },
   { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
   { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
   { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
  if (process.env.NODE_ENV === "production") {
   headers.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
   });
   // Add CSP for Cloudflare beacon and inline scripts
   headers.push({
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self';",
   });
  }
  return [{ source: "/(.*)", headers }];
 },
 pageExtensions: ["ts", "tsx", "mdx"],
 async redirects() {
 return [
 { source: "/blog/hello-avenor", destination: "/blog/hello-calder", permanent: true },
 { source: "/alternatives/resend", destination: "/migrate", permanent: true },
 { source: "/docs/migrate-resend", destination: "/migrate", permanent: true },
 { source: "/docs/migrate-postmark", destination: "/migrate", permanent: true },
 ];
 },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
