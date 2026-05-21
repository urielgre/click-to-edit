/**
 * Small helpers shared by the CLI: locating the user's App Router layout file.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type LayoutInfo = {
  absolutePath: string;
  /** Path relative to the project root, for friendly logging. */
  relativePath: string;
};

/**
 * Find the root App Router layout file. Tries `app/layout.{tsx,jsx,ts,js}`
 * in that order. Returns null if none exist — that almost always means the
 * project is Pages Router or not a Next.js project at all.
 */
export async function findLayoutFile(cwd: string): Promise<LayoutInfo | null> {
  const extensions = ["tsx", "jsx", "ts", "js"];
  for (const ext of extensions) {
    const absolute = path.join(cwd, "app", `layout.${ext}`);
    try {
      await fs.access(absolute);
      return {
        absolutePath: absolute,
        relativePath: path.posix.join("app", `layout.${ext}`),
      };
    } catch {
      // try the next extension
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
