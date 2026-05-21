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
      };

  const matches: Match[] = [];
  let sawNonEditableMatch = false;
  let nonEditableMessage = "";

  for (const child of element.children) {
    if (child.type === "JSXText") {
      const node = child as JSXText;
      const trimmed = node.value.trim();
      if (trimmed === oldText && typeof node.start === "number") {
        // Find the offset of the trimmed substring inside the node's source span.
        // We use node.value (the decoded text) for the search; for typical JSX
        // text the decoded value equals the raw source for the trimmed portion.
        const raw = source.slice(node.start, node.end);
        const idx = raw.indexOf(trimmed);
        if (idx >= 0) {
          matches.push({
            kind: "jsxText",
            node,
            trimmedStart: node.start + idx,
            trimmedEnd: node.start + idx + trimmed.length,
          });
        }
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
        sawNonEditableMatch = true;
        nonEditableMessage = `child is a dynamic ${expr.type}, not a literal`;
        continue;
      }
    }
    // Other child types (nested JSXElement, JSXFragment, JSXSpreadChild,
    // JSXEmptyExpression) are ignored — they aren't candidates for a text
    // edit, and the user's overlay should never target them.
  }

  if (matches.length === 0) {
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
