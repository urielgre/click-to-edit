/**
 * Defensive guards for the dev-only edit handler.
 *
 * Two layers of protection:
 *   - validateEnv() rejects any access outside NODE_ENV=development.
 *   - validatePath() prevents path traversal and locks edits to source files
 *     inside the project's cwd, excluding generated/dependency directories.
 */

import path from "node:path";
import type { EditErrorCode } from "../shared/types.js";

/**
 * Returns true only when NODE_ENV === "development". The server handler
 * MUST refuse to process any edit when this is false.
 */
export function validateEnv(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Allowed source-file extensions for editing.
 */
const ALLOWED_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);

/**
 * Directory segments that may never appear anywhere in an edit target's
 * resolved path. Catches node_modules, generated build output, and VCS
 * metadata.
 */
const BLOCKED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
]);

export type PathValidationResult =
  | { ok: true; absolute: string }
  | { ok: false; error: EditErrorCode; message: string };

/**
 * Validates a user-supplied file path. The input is the relative `file`
 * from EditRequest; this resolves it against process.cwd() and runs the
 * full sandbox check.
 */
export function validatePath(filePath: string): PathValidationResult {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return {
      ok: false,
      error: "not_in_project",
      message: "file path must be a non-empty string",
    };
  }

  // Reject literal `..` segments before resolving — this catches even
  // attempts that would happen to resolve back inside cwd.
  const normalizedForSegments = filePath.replace(/\\/g, "/");
  const segments = normalizedForSegments.split("/");
  if (segments.includes("..")) {
    return {
      ok: false,
      error: "not_in_project",
      message: "path contains '..' segments",
    };
  }

  const cwd = process.cwd();
  const absolute = path.resolve(cwd, filePath);

  // Reject if resolved path is outside cwd. We compare with a trailing
  // separator to avoid matching sibling dirs that start with the same prefix
  // (e.g. /work vs /work2).
  const cwdWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (absolute !== cwd && !absolute.startsWith(cwdWithSep)) {
    return {
      ok: false,
      error: "not_in_project",
      message: "resolved path escapes project root",
    };
  }

  // Reject blocked segments anywhere in the resolved path.
  const resolvedSegments = absolute.split(/[\\/]/);
  for (const seg of resolvedSegments) {
    if (BLOCKED_SEGMENTS.has(seg)) {
      return {
        ok: false,
        error: "not_in_project",
        message: `path contains blocked segment '${seg}'`,
      };
    }
  }

  const ext = path.extname(absolute).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: "invalid_extension",
      message: `extension '${ext}' is not editable`,
    };
  }

  return { ok: true, absolute };
}
