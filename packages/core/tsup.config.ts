import { defineConfig } from "tsup";

/**
 * Two-config build:
 *   1. Client entry ("index") — bundled with a "use client" banner so the
 *      whole module is treated as a Client Component by Next.js App Router.
 *      Without this banner, React.createContext / useState / etc. inside the
 *      bundled output throw at runtime ("createContext only works in Client
 *      Components"), because directives in individual source files don't
 *      survive bundling.
 *
 *   2. Server entry — no banner. createEditHandler runs on the server and
 *      MUST NOT be marked as a client component.
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
]);
