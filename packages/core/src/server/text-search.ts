/**
 * Search-mode source mapping: when the client cannot read `_debugSource` from
 * a React fiber (Server Components, hydrated third-party content, etc.), it
 * sends just the clicked text plus parent/sibling context. We walk the
 * project source tree and find a UNIQUE JSXElement whose JSXText or
 * StringLiteral child equals `oldText` and whose surrounding text matches
 * the DOM context.
 *
 * Limits:
 *   - O(files × parse). Fine for vibe-coded apps (10-100 files), too slow
 *     for monorepos with hundreds of pages. Acceptable for v0.1.
 *   - No caching across requests. Files are re-parsed every click.
 *   - If two unrelated files contain the same text + parent context, we
 *     refuse with `ambiguous`. Edit one of them in source first.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as babelParse } from "@babel/parser";

import type { EditErrorCode } from "../shared/types.js";

const ALLOWED_EXT = new Set([".tsx", ".jsx", ".ts", ".js"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  "coverage",
]);

export type SearchHit = {
  /** Absolute path to the source file. */
  file: string;
  /** 1-indexed line of the JSXElement start. */
  line: number;
  /** 1-indexed column. Babel reports 0-indexed; we convert. */
  column: number;
};

export type SearchResult =
  | { ok: true; hit: SearchHit }
  | { ok: false; error: EditErrorCode; message: string };

type Candidate = SearchHit & {
  /** Concatenated literal children of the JSX element — used to score
   *  similarity to the client's `parentText` for disambiguation. */
  parentTextLiterals: string;
};

export async function searchForEditPoint(
  rootDir: string,
  oldText: string,
  parentText?: string,
  _siblingTexts?: string[],
): Promise<SearchResult> {
  const trimmedOld = oldText.trim();
  if (!trimmedOld) {
    return {
      ok: false,
      error: "mismatch",
      message: "Empty oldText cannot be searched for.",
    };
  }

  const candidates: Candidate[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!ALLOWED_EXT.has(ext)) continue;
        await scanFile(path.join(dir, entry.name));
      }
    }
  }

  async function scanFile(filePath: string): Promise<void> {
    let source: string;
    try {
      source = await fs.readFile(filePath, "utf8");
    } catch {
      return;
    }
    // Fast rejection: if the file's raw text doesn't even mention oldText,
    // skip the parse.
    if (!source.includes(trimmedOld)) return;

    let ast: unknown;
    try {
      ast = babelParse(source, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
        errorRecovery: true,
      });
    } catch {
      return;
    }

    walkAst(ast, filePath);
  }

  function walkAst(node: unknown, filePath: string): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walkAst(n, filePath);
      return;
    }
    // We use `any` for the AST traversal — @babel/types isn't installed
    // and the node shapes we touch are stable across babel versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;

    if (n.type === "JSXElement" && Array.isArray(n.children)) {
      for (const child of n.children) {
        let matched = false;
        if (child?.type === "JSXText" && typeof child.value === "string") {
          if (child.value.trim() === trimmedOld) matched = true;
        } else if (
          child?.type === "JSXExpressionContainer" &&
          child.expression?.type === "StringLiteral" &&
          child.expression.value === trimmedOld
        ) {
          matched = true;
        }
        if (matched) {
          candidates.push({
            file: filePath,
            line: n.loc?.start?.line ?? 0,
            column: (n.loc?.start?.column ?? 0) + 1, // convert 0-idx -> 1-idx
            parentTextLiterals: collectLiteralText(n.children),
          });
        }
      }
    }

    // Recurse into all object/array children except metadata fields.
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "tokens" || key === "comments" || key === "extra") {
        continue;
      }
      walkAst(n[key], filePath);
    }
  }

  await walk(rootDir);

  if (candidates.length === 0) {
    return {
      ok: false,
      error: "mismatch",
      message: `No JSX text matching "${trimmedOld}" found in project source. Has the source changed since the page loaded?`,
    };
  }

  if (candidates.length === 1) {
    const c = candidates[0]!;
    return { ok: true, hit: { file: c.file, line: c.line, column: c.column } };
  }

  // Multiple candidates — try parent-text disambiguation.
  if (parentText) {
    const target = normalize(parentText);
    // Score each candidate by how much of its literal text overlaps with
    // the DOM parent text. Best-by-substring wins; ties => ambiguous.
    const scored = candidates.map((c) => {
      const cand = normalize(c.parentTextLiterals);
      let score = 0;
      if (cand && target.includes(cand)) score = cand.length;
      else if (cand && cand.includes(target)) score = target.length;
      return { c, score };
    });
    const maxScore = Math.max(...scored.map((s) => s.score));
    if (maxScore > 0) {
      const winners = scored.filter((s) => s.score === maxScore);
      if (winners.length === 1) {
        const w = winners[0]!.c;
        return {
          ok: true,
          hit: { file: w.file, line: w.line, column: w.column },
        };
      }
    }
  }

  return {
    ok: false,
    error: "ambiguous",
    message: `Found ${candidates.length} JSX literals matching "${trimmedOld}". click-to-edit cannot determine which one to change. Edit a unique nearby string first, or modify the source directly.`,
  };
}

function collectLiteralText(children: unknown[]): string {
  const parts: string[] = [];
  for (const child of children) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = child as any;
    if (c?.type === "JSXText" && typeof c.value === "string") {
      parts.push(c.value);
    } else if (
      c?.type === "JSXExpressionContainer" &&
      c.expression?.type === "StringLiteral"
    ) {
      parts.push(c.expression.value);
    }
  }
  return parts.join(" ");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
