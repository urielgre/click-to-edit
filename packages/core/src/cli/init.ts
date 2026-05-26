/**
 * `npx click-to-edit init` — wire click-to-edit into the user's Next.js
 * App Router project.
 *
 * Steps:
 *   1. Find the root layout file (`app/layout.{tsx,jsx,ts,js}`).
 *   2. Codemod the layout to wrap `{children}` with `<ClickToEditProvider>`
 *      and add the import. No-op if already wrapped.
 *   3. Create `app/api/click-to-edit/edit/route.ts` if missing.
 *
 * Idempotent. `--dry-run` prints the would-be changes without writing.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { wrapLayoutWithProvider } from "./codemod-layout.js";
import { createRouteFileContents } from "./codemod-route.js";
import { findLayoutFile, fileExists } from "./utils.js";

type Step = "ok" | "skipped" | "error";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const dryRun = args.includes("--dry-run");
  const showHelp = command === "--help" || command === "-h" || command === "help";

  if (showHelp || !command) {
    printHelp();
    process.exit(showHelp ? 0 : 1);
  }

  if (command !== "init") {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const cwd = process.cwd();
  console.log(`click-to-edit init — scanning ${cwd}`);
  if (dryRun) console.log("(dry run — no files will be written)\n");

  let exitCode = 0;

  // Step 1: find layout
  const layout = await findLayoutFile(cwd);
  if (!layout) {
    console.error(
      "  error: could not find app/layout.{tsx,jsx,ts,js}.\n" +
        "  click-to-edit currently supports the App Router only. If you're on\n" +
        "  Pages Router, support is on the roadmap.",
    );
    process.exit(1);
  }

  // Step 2: codemod layout
  const layoutSource = await fs.readFile(layout.absolutePath, "utf8");
  const result = wrapLayoutWithProvider(layoutSource);

  let layoutStep: Step;
  if (result.kind === "already-wrapped") {
    console.log(`  ok    ${layout.relativePath} (already wraps children)`);
    layoutStep = "skipped";
  } else if (result.kind === "error") {
    console.error(`  error ${layout.relativePath}: ${result.message}`);
    layoutStep = "error";
    exitCode = 1;
  } else {
    if (dryRun) {
      console.log(`  would update ${layout.relativePath}:`);
      console.log(indent(result.source));
    } else {
      await fs.writeFile(layout.absolutePath, result.source, "utf8");
    }
    console.log(`  ok    ${layout.relativePath} (wrapped with <ClickToEditProvider>)`);
    layoutStep = "ok";
  }

  // Step 3: create route file. Anchor under whichever app base we found
  // the layout in (either `app/` or `src/app/`).
  const routeRelative = path.posix.join(
    layout.appBase,
    "api",
    "click-to-edit",
    "edit",
    "route.ts",
  );
  const routeAbsolute = path.join(cwd, ...routeRelative.split("/"));
  const routeAlreadyExists = await fileExists(routeAbsolute);

  let routeStep: Step;
  if (routeAlreadyExists) {
    console.log(`  ok    ${routeRelative} (already exists)`);
    routeStep = "skipped";
  } else {
    if (dryRun) {
      console.log(`  would create ${routeRelative}:`);
      console.log(indent(createRouteFileContents()));
    } else {
      await fs.mkdir(path.dirname(routeAbsolute), { recursive: true });
      await fs.writeFile(routeAbsolute, createRouteFileContents(), "utf8");
    }
    console.log(`  ok    ${routeRelative} (created)`);
    routeStep = "ok";
  }

  console.log();
  if (layoutStep === "error") {
    console.error(
      "Done with errors. The layout needs a manual edit — see the README:\n" +
        "  https://github.com/urielgre/click-to-edit#install",
    );
  } else {
    printTurbopackInstructions();
    console.log();
    console.log("After updating next.config:");
    console.log("  1. Run your dev server (e.g. npm run dev)");
    console.log("  2. Open your app in the browser");
    console.log("  3. Press Cmd/Ctrl+E to toggle edit mode");
    console.log("  4. Click any text to edit it");
    if (routeStep === "skipped" && layoutStep === "skipped") {
      console.log("\n(Nothing changed in files — both pieces were already in place.)");
    }
  }

  process.exit(exitCode);
}

/**
 * Print copy-paste instructions for adding the build-time loader to the
 * user's `next.config.js` / `next.config.ts`. We intentionally do NOT
 * auto-edit that file — its shape varies (CJS / ESM / wrapped in
 * withSomething()) and a bad patch would break the entire build. Manual
 * is safer for v0.1.
 */
function printTurbopackInstructions(): void {
  console.log(
    [
      "ONE MORE STEP — add the build-time loader to your next.config.{js,ts}.",
      "Pick the snippet that matches your Next.js setup:",
      "",
      "  // For Next.js 16+ (Turbopack default):",
      "  turbopack: {",
      "    rules: {",
      "      '**/*.{tsx,jsx}': {",
      "        loaders: [{ loader: 'click-to-edit/loader' }],",
      "      },",
      "    },",
      "  },",
      "",
      "  // For Next.js 14/15 (webpack default — or include alongside the above to support both):",
      "  webpack: (config, { dev }) => {",
      "    if (dev) {",
      "      config.module.rules.push({",
      "        test: /\\.(tsx|jsx)$/,",
      "        exclude: /node_modules/,",
      "        use: [{ loader: 'click-to-edit/loader' }],",
      "      });",
      "    }",
      "    return config;",
      "  },",
      "",
      "This injects a data-cte-loc attribute on every JSX element so",
      "click-to-edit knows exactly which source line each DOM element came",
      "from. The loader is a no-op in production builds.",
    ].join("\n"),
  );
}

function printHelp(): void {
  console.log(
    [
      "Usage: npx click-to-edit <command> [options]",
      "",
      "Commands:",
      "  init        Wire click-to-edit into your Next.js App Router project",
      "",
      "Options:",
      "  --dry-run   Print would-be changes without writing files",
      "  --help, -h  Show this help",
      "",
      "Examples:",
      "  npx click-to-edit init",
      "  npx click-to-edit init --dry-run",
    ].join("\n"),
  );
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Unexpected error: ${msg}`);
  process.exit(1);
});
