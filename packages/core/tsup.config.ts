import { defineConfig } from "tsup";

/**
 * Three-config build:
 *   1. Client entry ("index") — bundled with a "use client" banner so the
 *      whole module is treated as a Client Component by Next.js App Router.
 *
 *   2. Server entry — no banner. createEditHandler runs on the server and
 *      MUST NOT be marked as a client component.
 *
 *   3. CLI entry — emits `dist/cli.js` with a "#!/usr/bin/env node" shebang
 *      so the OS knows to run it with Node. Referenced from package.json's
 *      `bin` field so `npx click-to-edit init` works end-to-end.
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
    // CLI is ESM-only. Modern Node (>=18) executes ESM bin scripts natively;
    // CJS would require an extra cjs entry we don't need.
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
]);
