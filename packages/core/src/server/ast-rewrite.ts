/**
 * JSX child rewriter built directly on @babel/parser.
 *
 * Strategy: parse the source with @babel/parser (jsx + typescript plugins),
 * find the JSXElement at the requested line/column, identify a single
 * matching literal child, and SPLICE the new text into the original source
 * string at the child node's byte offsets.
 *
 * We deliberately do NOT use recast's printer to regenerate the file: its
 * JSXElement printer strips leading whitespace from text children and
 * applies `indentTail`, which reformats the surrounding tag indentation.
 *
 * We also deliberately do NOT go through recast.parse — recast wraps the
 * source in a Lines object that may normalize line endings before handing
 * it to babel, which makes the returned `.start`/`.end` offsets diverge
 * from positions in the original source string. Using @babel/parser
 * directly keeps the offsets aligned 1:1 with the original bytes.
 *
 * Matching rules (kept narrow on purpose — anything dynamic must be rejected):
 *   - JSXText whose trimmed value equals oldText
 *   - JSXExpressionContainer holding a StringLiteral whose value equals oldText
 * Everything else (identifiers, calls, template literals, conditionals, etc.)
 * returns `not_editable`.
 */

import { parse as babelParse } from "@babel/parser";

import type { EditErrorCode } from "../shared/types.js";
import { followVariable } from "./follow-variable.js";

export type RewriteResult =
  | { ok: true; source: string }
  | { ok: false; error: EditErrorCode; message: string };

// Minimal structural types — we keep these loose because we only ever inspect
// a handful of fields and don't want to fight @babel/types versioning.
type Loc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

type AnyNode = {
  type: string;
  loc?: Loc | null;
  start?: number;
  end?: number;
  [key: string]: unknown;
};

type JSXElement = AnyNode & {
  type: "JSXElement";
  openingElement: AnyNode & { loc?: Loc | null };
  children: AnyNode[];
};

type JSXText = AnyNode & {
  type: "JSXText";
  value: string;
  start: number;
  end: number;
};

type StringLiteralNode = AnyNode & {
  type: "StringLiteral" | "Literal";
  value: unknown;
  start: number;
  end: number;
};

type JSXExpressionContainer = AnyNode & {
  type: "JSXExpressionContainer";
  expression: AnyNode;
};

/**
 * Node types that may live inside a JSXExpressionContainer and represent
 * user-visible dynamic content. We reject all of these defensively.
 */
const DYNAMIC_EXPRESSION_TYPES = new Set([
  "Identifier",
  "MemberExpression",
  "CallExpression",
  "TemplateLiteral",
  "ConditionalExpression",
  "LogicalExpression",
  "BinaryExpression",
]);

/**
 * Rewrites a single JSX child literal in `source`. The caller passes the
 * 1-indexed line / 0-indexed column of the *enclosing JSXElement's opening
 * tag* (as reported by React's _debugSource), plus the exact `oldText` to
 * match and the replacement `newText`.
 */
export function rewriteJsxText(
  source: string,
  line: number,
  column: number,
  oldText: string,
  newText: string,
): RewriteResult {
  let ast: AnyNode;
  try {
    ast = babelParse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      // Babel emits both start/end (numeric offsets) and loc by default.
      errorRecovery: false,
    }) as unknown as AnyNode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "parse_error", message };
  }

  const element = findJsxElementAt(ast, line, column);
  if (!element) {
    return {
      ok: false,
      error: "element_not_found",
      message: `no JSXElement at ${line}:${column}`,
    };
  }

  // Collect all matching children. We walk every child first to detect
  // ambiguity before performing the splice.
  type Match =
    | {
        kind: "jsxText";
        node: JSXText;
        // For JSXText we want to preserve surrounding whitespace inside the
        // node's textual span. We splice only the trimmed core.
        trimmedStart: number;
        trimmedEnd: number;
      }
    | {
        kind: "stringLiteral";
        container: JSXExpressionContainer;
        literal: StringLiteralNode;
      }
    | {
        // Dynamic child like `{plan.name}` that we followed back to a
        // string literal in a static const declaration in the same file.
        // The offsets point inside the original literal's quotes; the
        // replacement is the new text already escaped for the chosen quote.
        kind: "followed";
        spliceStart: number;
        spliceEnd: number;
        replacement: string;
      };

  const matches: Match[] = [];
  let sawNonEditableMatch = false;
  let nonEditableMessage = "";
  // If followVariable refused with a specific reason (ambiguous, mismatch),
  // we want to surface that instead of the generic "not_editable" message.
  let followedFailure: { error: EditErrorCode; message: string } | null = null;

  // The client sends `oldText` derived from DOM textContent, which has had
  // internal whitespace collapsed by the browser (newlines + indentation
  // become a single space). The source JSXText preserves the original
  // multi-line whitespace. Match against a normalized form on both sides so
  // multi-line JSX text edits work — see issue: "Stop scrolling..." case.
  const normalizedOld = normalizeWs(oldText);

  for (const child of element.children) {
    if (child.type === "JSXText") {
      const node = child as JSXText;
      if (
        normalizeWs(node.value) === normalizedOld &&
        typeof node.start === "number" &&
        typeof node.end === "number"
      ) {
        // Locate the trimmed core inside the node's source span by counting
        // leading/trailing whitespace bytes — robust to any internal
        // whitespace shape (newlines, tabs, mixed indentation).
        const raw = source.slice(node.start, node.end);
        const leadingLen = (/^\s*/.exec(raw)?.[0] ?? "").length;
        const trailingLen = (/\s*$/.exec(raw)?.[0] ?? "").length;
        matches.push({
          kind: "jsxText",
          node,
          trimmedStart: node.start + leadingLen,
          trimmedEnd: node.end - trailingLen,
        });
      }
      continue;
    }

    if (child.type === "JSXExpressionContainer") {
      const container = child as JSXExpressionContainer;
      const expr = container.expression;
      if (
        (expr.type === "StringLiteral" || expr.type === "Literal") &&
        typeof (expr as StringLiteralNode).value === "string"
      ) {
        if ((expr as StringLiteralNode).value === oldText) {
          matches.push({
            kind: "stringLiteral",
            container,
            literal: expr as StringLiteralNode,
          });
        }
        continue;
      }

      if (DYNAMIC_EXPRESSION_TYPES.has(expr.type)) {
        // Try to follow the variable back to a string literal in source
        // (e.g. `{plan.name}` -> the `name: 'Free'` literal in the `plans`
        // array). Only refuse with the friendly error if even that fails.
        const followed = followVariable(ast, source, expr, oldText, newText);
        if (followed.ok) {
          matches.push({
            kind: "followed",
            spliceStart: followed.spliceStart,
            spliceEnd: followed.spliceEnd,
            replacement: followed.replacement,
          });
        } else {
          // When follow-variable traced the variable but couldn't make a
          // clean edit (multiple matches in the array, or no match), that
          // specific error is more useful than the generic "this is a
          // dynamic expression" message.
          if (followed.error === "ambiguous" || followed.error === "mismatch") {
            followedFailure = {
              error: followed.error,
              message: followed.message,
            };
          }
          sawNonEditableMatch = true;
          nonEditableMessage = humanizeDynamicReason(
            expr.type,
            getDynamicExpressionName(expr),
          );
        }
        continue;
      }
    }
    // Other child types (nested JSXElement, JSXFragment, JSXSpreadChild,
    // JSXEmptyExpression) are ignored — they aren't candidates for a text
    // edit, and the user's overlay should never target them.
  }

  if (matches.length === 0) {
    if (followedFailure) {
      return {
        ok: false,
        error: followedFailure.error,
        message: followedFailure.message,
      };
    }
    if (sawNonEditableMatch) {
      return {
        ok: false,
        error: "not_editable",
        message: nonEditableMessage,
      };
    }
    return {
      ok: false,
      error: "mismatch",
      message: `no child matches oldText`,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: "ambiguous",
      message: `${matches.length} children match oldText`,
    };
  }

  const match = matches[0]!;

  // Surgical string splice — preserves every other byte of the source verbatim.
  let spliceStart: number;
  let spliceEnd: number;
  let replacement: string;

  if (match.kind === "jsxText") {
    spliceStart = match.trimmedStart;
    spliceEnd = match.trimmedEnd;
    replacement = newText;
  } else if (match.kind === "followed") {
    // followVariable already computed exact offsets (inside the literal's
    // quotes) and quote-escaped the replacement for us.
    spliceStart = match.spliceStart;
    spliceEnd = match.spliceEnd;
    replacement = match.replacement;
  } else {
    if (
      typeof match.literal.start !== "number" ||
      typeof match.literal.end !== "number"
    ) {
      return {
        ok: false,
        error: "parse_error",
        message: "StringLiteral node missing source offsets",
      };
    }
    const original = source.slice(match.literal.start, match.literal.end);
    // Preserve the original quote character (' or ").
    const quote = original.charAt(0);
    if (quote !== '"' && quote !== "'") {
      return {
        ok: false,
        error: "parse_error",
        message: "StringLiteral source does not start with a quote",
      };
    }
    spliceStart = match.literal.start;
    spliceEnd = match.literal.end;
    // Escape backslashes first, then the chosen quote character.
    const escaped = newText
      .replace(/\\/g, "\\\\")
      .replace(new RegExp(quote, "g"), "\\" + quote);
    replacement = quote + escaped + quote;
  }

  const newSource =
    source.slice(0, spliceStart) + replacement + source.slice(spliceEnd);

  return { ok: true, source: newSource };
}

/**
 * Walk the AST and return the first JSXElement whose openingElement starts
 * at the given 1-indexed line / 0-indexed column. We also accept a 1-indexed
 * column for tolerance, since callers' definitions of "column" vary
 * (React's _debugSource is 1-indexed line / 0-indexed column).
 */
function findJsxElementAt(
  ast: AnyNode,
  line: number,
  column: number,
): JSXElement | null {
  let found: JSXElement | null = null;

  function visit(node: unknown): void {
    if (found) return;
    if (!node || typeof node !== "object") return;
    const n = node as AnyNode;

    if (n.type === "JSXElement") {
      const el = n as JSXElement;
      const loc = el.openingElement?.loc?.start;
      if (loc && loc.line === line) {
        if (loc.column === column || loc.column === column - 1) {
          found = el;
          return;
        }
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "tokens" || key === "comments") continue;
      const v = (n as Record<string, unknown>)[key];
      if (Array.isArray(v)) {
        for (const item of v) visit(item);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  }

  visit(ast);
  return found;
}

/**
 * Collapse internal whitespace runs to a single space and trim. Used when
 * comparing client-supplied `oldText` (DOM-collapsed) against source JSXText
 * values (which preserve original newlines + indentation).
 */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Translate a babel expression type into a sentence the end-user can act
 * on. The point is to make clear that this text isn't in source code and
 * editing it requires going elsewhere (data store, translations, etc.).
 * Include the expression's source name (e.g. `post.title`) so the user can
 * tell Claude exactly which symbol to investigate.
 */
function humanizeDynamicReason(
  exprType: string,
  exprName: string | null,
): string {
  const ref = exprName ? ` \`${exprName}\`` : "";
  switch (exprType) {
    case "Identifier":
      return `This text comes from a variable${ref}. Tell Claude Code to look up where it's set, or ask it to hardcode the value.`;
    case "MemberExpression":
      return `This text comes from data${ref} (database row, props, or state). Edit it where the data lives (your DB, API, or the initial value).`;
    case "CallExpression":
      return `This text comes from a function call${ref} (often an i18n translation like t('key')). Edit the translation file or the function's return value.`;
    case "TemplateLiteral":
      return "This text uses a template string with interpolations. Edit the literal parts inside the backticks in source.";
    case "ConditionalExpression":
      return "This text is one branch of a `? :` ternary. Edit the literal in source.";
    case "LogicalExpression":
      return "This text is part of a `||` / `&&` / `??` expression. Edit the literal in source.";
    case "BinaryExpression":
      return "This text is built by string concatenation (`+`). Edit one of the literal pieces in source.";
    default:
      return `This text is computed at runtime (${exprType}${ref}), not a literal in source. Edit it in source.`;
  }
}

/**
 * Extract a human-readable symbol name from a dynamic expression so the
 * error message can quote it. For `<h1>{post.title}</h1>` returns
 * "post.title"; for `<h1>{t('home.title')}</h1>` returns "t".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDynamicExpressionName(expr: any): string | null {
  if (!expr || typeof expr !== "object") return null;
  if (expr.type === "Identifier" && typeof expr.name === "string") {
    return expr.name;
  }
  if (expr.type === "MemberExpression") {
    return buildMemberPath(expr);
  }
  if (expr.type === "CallExpression") {
    if (expr.callee?.type === "Identifier") {
      return `${expr.callee.name}(...)`;
    }
    if (expr.callee?.type === "MemberExpression") {
      const path = buildMemberPath(expr.callee);
      return path ? `${path}(...)` : null;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMemberPath(expr: any): string {
  const parts: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let curr: any = expr;
  while (curr) {
    if (curr.type === "MemberExpression") {
      if (curr.property?.type === "Identifier") {
        parts.unshift(curr.property.name);
      } else if (
        curr.property?.type === "StringLiteral" &&
        typeof curr.property.value === "string"
      ) {
        parts.unshift(`["${curr.property.value}"]`);
      }
      curr = curr.object;
    } else if (curr.type === "Identifier") {
      parts.unshift(curr.name);
      break;
    } else {
      break;
    }
  }
  return parts.join(".");
}
