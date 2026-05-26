/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["click-to-edit"],

  // Build-time injection of `data-cte-loc` attributes on every JSX element.
  // The loader is a no-op outside development and on files in node_modules.
  //
  // We register for BOTH compilers because Next.js may run either:
  //   - webpack (Next.js 14 / 15 default)
  //   - Turbopack (Next.js 16 default, or Next.js 14 with `next dev --turbo`)
  webpack: (config, { dev }) => {
    if (dev) {
      config.module.rules.push({
        test: /\.(tsx|jsx)$/,
        exclude: /node_modules/,
        use: [{ loader: "click-to-edit/loader" }],
      });
    }
    return config;
  },
  turbopack: {
    rules: {
      "**/*.{tsx,jsx}": {
        loaders: [{ loader: "click-to-edit/loader" }],
      },
    },
  },
};

module.exports = nextConfig;
