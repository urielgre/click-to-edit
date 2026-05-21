/**
 * The dev-only POST handler that turns an EditRequest into a real source-file
 * mutation. Wire up via:
 *
 *   // app/api/__cte/edit/route.ts
 *   import { createEditHandler } from "click-to-edit/server";
 *   export const POST = createEditHandler();
 *
 * Two modes:
 *
 *   - **Exact mode** — request includes `file`, `line`, `column`. Used when
 *     the client could read React's `_debugSource` (Client Components in
 *     dev). Fast, surgical, never ambiguous.
 *
 *   - **Search mode** — request includes only `oldText` (+ optional
 *     `parentText` / `siblingTexts`). Used when fiber source is unavailable
 *     (Server Components, hydrated 3rd-party nodes). The handler walks the
 *     project to find a unique matching JSXElement, then proceeds as if it
 *     had been called in exact mode.
 *
 * Every failure path returns a typed EditResponse so the client overlay can
 * render a precise message.
 */

import fs from "node:fs/promises";
import * as path from "node:path";

import type {
  EditRequest,
  EditResponse,
  ClickToEditOptions,
} from "../shared/types.js";
import { validateEnv, validatePath } from "./guards.js";
import { rewriteJsxText } from "./ast-rewrite.js";
import { atomicWrite } from "./atomic-write.js";
import { searchForEditPoint } from "./text-search.js";

/**
 * Runtime check for the EditRequest shape. Loose: only `oldText` + `newText`
 * are required. `file`/`line`/`column` indicate exact mode; their absence
 * triggers search mode.
 */
function isEditRequest(value: unknown): value is EditRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.oldText !== "string" || typeof v.newText !== "string") {
    return false;
  }
  // If any exact-mode field is present, all three must be present and valid.
  const hasFile = v.file !== undefined;
  const hasLine = v.line !== undefined;
  const hasColumn = v.column !== undefined;
  if (hasFile || hasLine || hasColumn) {
    if (typeof v.file !== "string") return false;
    if (typeof v.line !== "number" || !Number.isFinite(v.line)) return false;
    if (typeof v.column !== "number" || !Number.isFinite(v.column)) return false;
  }
  // Optional search-mode fields.
  if (v.parentText !== undefined && typeof v.parentText !== "string") {
    return false;
  }
  if (v.siblingTexts !== undefined) {
    if (!Array.isArray(v.siblingTexts)) return false;
    if (!v.siblingTexts.every((s) => typeof s === "string")) return false;
  }
  return true;
}

function isExactMode(
  body: EditRequest,
): body is EditRequest & { file: string; line: number; column: number } {
  return (
    typeof body.file === "string" &&
    typeof body.line === "number" &&
    typeof body.column === "number"
  );
}

function fail(
  res: Extract<EditResponse, { ok: false }>,
  status: number,
): Response {
  return Response.json(res, { status });
}

export function createEditHandler(_options: ClickToEditOptions = {}) {
  return async function POST(req: Request): Promise<Response> {
    try {
      if (!validateEnv()) {
        return fail(
          {
            ok: false,
            error: "forbidden",
            message: "click-to-edit is disabled outside NODE_ENV=development",
          },
          404,
        );
      }

      const raw = await req.json().catch(() => null);
      if (!isEditRequest(raw)) {
        return fail(
          { ok: false, error: "forbidden", message: "invalid request" },
          400,
        );
      }
      const body: EditRequest = raw;

      // Resolve target file/line/column. In search mode we walk the project
      // to find a unique candidate.
      let absolute: string;
      let line: number;
      let column: number;

      if (isExactMode(body)) {
        const pathCheck = validatePath(body.file);
        if (!pathCheck.ok) {
          return fail(
            { ok: false, error: pathCheck.error, message: pathCheck.message },
            400,
          );
        }
        absolute = pathCheck.absolute;
        line = body.line;
        column = body.column;
      } else {
        const search = await searchForEditPoint(
          process.cwd(),
          body.oldText,
          body.parentText,
          body.siblingTexts,
        );
        if (!search.ok) {
          return fail(
            { ok: false, error: search.error, message: search.message },
            400,
          );
        }
        // Re-validate the discovered path defensively.
        const relative = path.relative(process.cwd(), search.hit.file);
        const pathCheck = validatePath(relative);
        if (!pathCheck.ok) {
          return fail(
            { ok: false, error: pathCheck.error, message: pathCheck.message },
            400,
          );
        }
        absolute = pathCheck.absolute;
        line = search.hit.line;
        column = search.hit.column;
      }

      let source: string;
      try {
        source = await fs.readFile(absolute, "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return fail(
            {
              ok: false,
              error: "file_not_found",
              message: `file not found: ${absolute}`,
            },
            404,
          );
        }
        return fail(
          {
            ok: false,
            error: "write_failed",
            message: (err as Error).message ?? "failed to read file",
          },
          500,
        );
      }

      const rewrite = rewriteJsxText(
        source,
        line,
        column,
        body.oldText,
        body.newText,
      );
      if (!rewrite.ok) {
        return fail(
          { ok: false, error: rewrite.error, message: rewrite.message },
          400,
        );
      }

      try {
        await atomicWrite(absolute, rewrite.source);
      } catch (err) {
        return fail(
          {
            ok: false,
            error: "write_failed",
            message: (err as Error).message ?? "atomic write failed",
          },
          500,
        );
      }

      const success: EditResponse = { ok: true, file: absolute };
      return Response.json(success, { status: 200 });
    } catch (err) {
      // Last-resort safety net so we never leak an unhandled rejection.
      return fail(
        {
          ok: false,
          error: "write_failed",
          message: (err as Error)?.message ?? "internal error",
        },
        500,
      );
    }
  };
}
