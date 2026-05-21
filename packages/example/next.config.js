/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure React's _debugSource is available in dev by relying on the
  // default @babel/preset-react jsx-source transform. No extra config needed.
  transpilePackages: ["click-to-edit"],
};

module.exports = nextConfig;
