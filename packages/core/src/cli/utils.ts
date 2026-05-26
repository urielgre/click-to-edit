/**
 * Small helpers shared by the CLI: locating the user's App Router layout file
 * and determining the app-directory base (top-level `app/` vs. `src/app/`).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type LayoutInfo = {
  absolutePath: string;
  /** Path relative to the project root, for friendly logging. */
  relativePath: string;
  /**
   * The directory that contains the `app/` tree, relative to the project
   * root. Either "app" or "src/app". Use this to derive sibling paths like
   * the API route file location.
   */
  appBase: "app" | "src/app";
};

const APP_BASES = ["app", "src/app"] as const;
const EXTENSIONS = ["tsx", "jsx", "ts", "js"] as const;

/**
 * Find the root App Router layout file. Tries `app/layout.{ext}` first, then
 * `src/app/layout.{ext}`. Returns null if none exist — that almost always
 * means the project is Pages Router or not a Next.js project at all.
 */
export async function findLayoutFile(cwd: string): Promise<LayoutInfo | null> {
  for (const base of APP_BASES) {
    for (const ext of EXTENSIONS) {
      const relative = path.posix.join(base, `layout.${ext}`);
      const absolute = path.join(cwd, ...relative.split("/"));
      try {
        await fs.access(absolute);
        return {
          absolutePath: absolute,
          relativePath: relative,
          appBase: base,
        };
      } catch {
        // try the next location
      }
    }
  }
  return null;
}

/**
 * Detect whether a file exists. Returns true on success, false on any error.
 */
export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
