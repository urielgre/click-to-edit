/**
 * Atomic file write: stage to a sibling temp file, then rename. Rename within
 * the same directory is atomic on POSIX and on Windows NTFS (single MoveFile
 * operation), so readers never observe a half-written file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Writes `content` to `absolutePath` atomically. Throws on any fs error;
 * the caller is responsible for translating that into an EditResponse.
 */
export async function atomicWrite(
  absolutePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath);
  const suffix = crypto.randomBytes(8).toString("hex");
  const tmpPath = path.join(dir, `${base}.cte-tmp-${suffix}`);

  try {
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, absolutePath);
  } catch (err) {
    // Best-effort cleanup; ignore failure (the temp file may already be gone).
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
