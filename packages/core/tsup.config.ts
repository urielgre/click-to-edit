import { defineConfig } from "tsup";

/**
 * Four-config build:
 *   1. Client entry ("index") — bundled with a "use client" banner so the
 *      whole module is treated as a Client Component by Next.js App Router.
 *
 *   2. Server entry — no banner. createEditHandler runs on the server and
 *      MUST NOT be marked as a client component.
 *
 *   3. CLI entry — emits `dist/cli.js` with a "#!/usr/bin/env node" shebang
 *      so the OS knows to run it with Node. Referenced from package.json's
 *      `bin` field so `npx click-to-edit init` works end-to-end.
 *
 *   4. Webpack/Turbopack loader — emits `dist/loader.cjs`. Loaders must be
 *      CommonJS (the standard Next.js webpack loader contract). It's a
 *      build-time module that runs in the Node toolchain process and stamps
 *      `data-cte-loc` attributes onto every JSXOpeningElement.
 */
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    external: ["react", "react-dom", "next"],
    banner: { js: '"use client";' },
  },
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    // Do NOT clean — would wipe the client output from the first config.
    clean: false,
    sourcemap: true,
    splitting: false,
    external: [
      "react",
      "react-dom",
      "next",
      "fs",
      "path",
      "fs/promises",
      "node:fs",
      "node:path",
      "node:fs/promises",
    ],
  },
  {
    entry: { cli: "src/cli/init.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    external: [
      "fs",
      "path",
      "fs/promises",
      "node:fs",
      "node:path",
      "node:fs/promises",
    ],
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { loader: "src/webpack/loader.ts" },
    // Webpack loaders are CJS by Next.js convention. ESM loaders work but
    // require extra config on the user side; CJS is the universal default.
    format: ["cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
    external: ["@babel/parser"],
  },
]);
