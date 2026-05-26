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

/**
 * Next.js file-name conventions that produce IMAGES, ICONS, or XML rather
 * than DOM content. A user can never click on text inside these in the
 * browser, so they shouldn't appear as candidates during search. Without
 * this filter they create phantom duplicates that block legitimate edits.
 */
const SKIP_FILE_PATTERNS: RegExp[] = [
  /(^|[/\\])opengraph-image\.(tsx?|jsx?)$/,
  /(^|[/\\])twitter-image\.(tsx?|jsx?)$/,
  /(^|[/\\])icon(\d*)\.(tsx?|jsx?)$/,
  /(^|[/\\])apple-icon\.(tsx?|jsx?)$/,
  /(^|[/\\])sitemap\.(tsx?|ts|js)$/,
  /(^|[/\\])robots\.(tsx?|ts|js)$/,
];

function isSkippedFile(filePath: string): boolean {
  return SKIP_FILE_PATTERNS.some((re) => re.test(filePath));
}

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
        const filePath = path.join(dir, entry.name);
        if (isSkippedFile(filePath)) continue;
        await scanFile(filePath);
      }
    }
  }

  // Pre-compute the whitespace-collapsed form of the needle once; we reuse
  // it for the cheap-substring fast-reject below.
  const collapsedNeedle = trimmedOld.replace(/\s+/g, " ");

  async function scanFile(filePath: string): Promise<void> {
    let source: string;
    try {
      source = await fs.readFile(filePath, "utf8");
    } catch {
      return;
    }
    // Fast rejection: collapse all whitespace runs in the file's source
    // before substring-checking for the needle. Without this, multi-line
    // JSXText (e.g. text wrapped onto two source lines with indentation in
    // between) gets falsely rejected even though the AST walker below
    // would correctly match it after normalization.
    const collapsedSource = source.replace(/\s+/g, " ");
    if (!collapsedSource.includes(collapsedNeedle)) return;

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

  // Ancestor stack of JSXElements as the walker recurses. We use this to
  // find the grandparent JSXElement when a match is detected — that wider
  // context is what disambiguates two textually-identical literals that
  // live in different parts of the codebase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsxAncestors: any[] = [];

  function walkAst(node: unknown, filePath: string): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walkAst(n, filePath);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;

    if (n.type === "JSXElement" && Array.isArray(n.children)) {
      // Normalize once per search — source JSXText values can be multi-line
      // (e.g. text wrapped onto two lines with leading indentation), while
      // `trimmedOld` arrives DOM-collapsed. Both sides get the same shape.
      const normalizedOld = normalizeWs(trimmedOld);
      for (const child of n.children) {
        let matched = false;
        if (child?.type === "JSXText" && typeof child.value === "string") {
          if (normalizeWs(child.value) === normalizedOld) matched = true;
        } else if (
          child?.type === "JSXExpressionContainer" &&
          child.expression?.type === "StringLiteral" &&
          child.expression.value === trimmedOld
        ) {
          matched = true;
        }
        if (matched) {
          // For disambiguation, use the wider context of the GRANDPARENT
          // JSXElement (the top of the ancestor stack is `n`'s ancestors).
          // Falls back to direct children if no grandparent exists.
          const grandparent =
            jsxAncestors.length > 0
              ? jsxAncestors[jsxAncestors.length - 1]
              : null;
          const contextText = grandparent
            ? collectAllJsxTextRecursive(grandparent, 0)
            : collectLiteralText(n.children);
          candidates.push({
            file: filePath,
            line: n.loc?.start?.line ?? 0,
            column: (n.loc?.start?.column ?? 0) + 1, // convert 0-idx -> 1-idx
            parentTextLiterals: contextText,
          });
        }
      }
    }

    // Push this JSXElement onto the ancestor stack while we descend.
    const isJsxElement = n.type === "JSXElement";
    if (isJsxElement) jsxAncestors.push(n);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "tokens" || key === "comments" || key === "extra") {
        continue;
      }
      walkAst(n[key], filePath);
    }
    if (isJsxElement) jsxAncestors.pop();
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

  // Multiple candidates — disambiguate via word-overlap between each
  // candidate's surrounding-AST text and the client's DOM parentText.
  //
  // Substring containment (the previous approach) inverted the desired
  // signal: a candidate with TIGHT context becomes a substring of any
  // candidate with WIDER context, so the wrong file scored higher. Counting
  // shared distinctive words is robust to context-length differences.
  if (parentText) {
    const targetWords = wordSet(parentText, trimmedOld);
    const scored = candidates.map((c) => ({
      c,
      score: wordOverlapScore(c.parentTextLiterals, targetWords, trimmedOld),
    }));
    const maxScore = Math.max(0, ...scored.map((s) => s.score));
    // Require a meaningful lead — the best candidate must outscore the
    // next-best by at least 2 distinctive words. Otherwise we treat the
    // signal as too weak and fall through to the ambiguous return.
    if (maxScore >= 2) {
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const top = sorted[0]!;
      const runnerUp = sorted[1];
      if (!runnerUp || top.score - runnerUp.score >= 2) {
        const w = top.c;
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

/**
 * Recursively gather all JSXText/StringLiteral values inside a JSXElement,
 * descending through nested elements. Capped at depth=5 so a malicious or
 * pathological tree can't run away. Used for disambiguation context: when
 * two files have the same target text, the surrounding text usually
 * differs and we lean on that.
 */
function collectAllJsxTextRecursive(node: unknown, depth: number): string {
  if (depth > 5 || !node || typeof node !== "object") return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any;
  const parts: string[] = [];
  if (n.type === "JSXText" && typeof n.value === "string") {
    parts.push(n.value);
  } else if (
    n.type === "JSXExpressionContainer" &&
    n.expression?.type === "StringLiteral"
  ) {
    parts.push(n.expression.value);
  } else if (Array.isArray(n.children)) {
    for (const child of n.children) {
      const t = collectAllJsxTextRecursive(child, depth + 1);
      if (t) parts.push(t);
    }
  }
  return parts.join(" ");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Case-preserving whitespace normalization. Used for matching `oldText`
 * against JSXText `value`, which preserves source-side newlines and
 * indentation that the browser collapses in the DOM. Case-sensitive — we
 * still want "RedditPulse" to differ from "redditpulse".
 */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Build a set of distinctive words from `text`, excluding (a) words shorter
 * than 3 chars (high noise), (b) any word that appears in `excludeText` —
 * which is the matching `oldText`. We exclude the match's own words because
 * by definition every candidate contains them, so they contribute zero
 * disambiguation signal.
 */
function wordSet(text: string, excludeText: string): Set<string> {
  const exclude = new Set(
    excludeText
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3),
  );
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/\W+/)) {
    if (w.length >= 3 && !exclude.has(w)) out.add(w);
  }
  return out;
}

/**
 * Number of distinctive words from `candidateText` that also appear in
 * `targetWords`. Excludes any words shared with `excludeText` (the match
 * itself), since those carry no disambiguation information.
 */
function wordOverlapScore(
  candidateText: string,
  targetWords: Set<string>,
  excludeText: string,
): number {
  const candWords = wordSet(candidateText, excludeText);
  let hits = 0;
  for (const w of candWords) {
    if (targetWords.has(w)) hits++;
  }
  return hits;
}
