/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the tool to be embedded in other sites/projects (iframe) as the challenge suggests.
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] }];
  },
};
export default nextConfig;
