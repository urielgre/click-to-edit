/**
 * "Follow-variable" resolver: when a JSX child is a dynamic expression like
 * `{plan.name}` instead of a literal, look up whether the expression
 * ultimately points to a string literal sitting in the same file (typically
 * inside a top-level `const`).
 *
 * Common case this unlocks: marketing copy stored as a static data structure.
 *
 *   const plans = [
 *     { name: 'Free',  description: 'Get started ...', features: ['5 subreddits', ...] },
 *     { name: 'Pro',   description: 'For serious ...', features: [...] },
 *   ];
 *   plans.map(plan => (
 *     <h3>{plan.name}</h3>             // ← resolves to plans[i].name
 *     <p>{plan.description}</p>        // ← resolves to plans[i].description
 *     {plan.features.map(f => <li>{f}</li>)}  // ← resolves to plans[i].features[j]
 *   ))
 *
 * The user's clicked `oldText` tells us which array element to target — we
 * walk the array and look for the single element whose property matches.
 *
 * Cases handled in v0.1:
 *   (1) `{identifier}` where `const identifier = "literal"` in same file
 *   (2) `{obj.prop}` where `const obj = { prop: "literal", ... }` in same file
 *   (3) `{p.prop}` inside `arr.map(p => ...)` where `const arr = [{prop: "literal"}, ...]`
 *   (4) `{item}` inside `arr.map(item => ...)` where `const arr = ["literal", ...]`
 *   (5) `{p.features.map(f => f)}` nested map — best-effort.
 *
 * Refuses (returns null) for: function props, fetched data, reassigned
 * variables, complex computed property access, anything we can't statically
 * resolve to a string literal.
 */

import type { EditErrorCode } from "../shared/types.js";

export type FollowResult =
  | {
      ok: true;
      /** Byte offset in the original source where the splice begins. */
      spliceStart: number;
      /** Byte offset where the splice ends (exclusive). */
      spliceEnd: number;
      /** What to insert in place of the matched range. */
      replacement: string;
    }
  | { ok: false; error: EditErrorCode; message: string };

/**
 * Top-level entry. Given the file's AST, the source text, the dynamic
 * expression inside the JSX child, and the user's `oldText`, try to resolve
 * it to a string literal in source. Returns success with splice offsets or
 * null if we can't.
 */
export function followVariable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any,
  source: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expression: any,
  oldText: string,
  newText: string,
): FollowResult {
  // Step 1: Extract access path. {plan.name} -> root='plan', path=['name'].
  const access = extractAccessPath(expression);
  if (!access) {
    // Even when we can't extract a clean path, the literal MIGHT still
    // live in this file (e.g. inside a ternary, a complex expression, or
    // a chain we don't understand). Fall back to file-scoped text search.
    return fileScopedSearch(ast, source, oldText, newText);
  }
  const { root, path } = access;

  // Step 2: Resolve `root` in two layers:
  //   - file-level const declarations
  //   - .map() callback parameters in any enclosing scope
  const constMap = collectFileConsts(ast);
  const mapParams = collectMapParams(ast);

  // If root is a map callback parameter, the "real" array we need to walk
  // is whatever that map iterates over. We may need to chain through
  // multiple map parameters (e.g., `feature` inside `plan.features.map`
  // resolves up to `plans[i].features[j]`).
  const arraysToSearch = resolveArraysToSearch(root, path, mapParams, constMap);
  if (!arraysToSearch) {
    // Structural resolution failed — the variable came from a function we
    // don't understand (.find, .filter, .reduce, fetch result, prop, etc).
    // Fall back to a file-scoped text search: if exactly one string literal
    // in this file matches `oldText`, edit it. This catches "marketing
    // copy stored as a const in the same file" regardless of how the
    // developer reached it.
    return fileScopedSearch(ast, source, oldText, newText);
  }

  // arraysToSearch is a list of (literal node, residual path) pairs we
  // should look inside. For case (1) — direct identifier to const literal —
  // the list has one entry pointing straight at the literal. For map
  // callbacks, it points at the array literal with the remaining path.

  // Step 3: For each candidate location, collect string literals matching
  // oldText.
  const hits: Array<{ start: number; end: number; quote: string }> = [];

  for (const candidate of arraysToSearch) {
    if (candidate.kind === "direct") {
      // The expression should resolve to candidate.value (no array iteration).
      const literal = navigateLiteral(candidate.value, candidate.residualPath);
      if (literal && isStringLiteral(literal)) {
        if (literal.value === oldText) {
          if (
            typeof literal.start === "number" &&
            typeof literal.end === "number"
          ) {
            hits.push({
              start: literal.start,
              end: literal.end,
              quote: detectQuote(source, literal.start),
            });
          }
        }
      }
    } else {
      // ArrayExpression — iterate elements, navigate residualPath in each,
      // collect matches.
      for (const el of candidate.array.elements ?? []) {
        if (!el) continue;
        const literal = navigateLiteral(el, candidate.residualPath);
        if (literal && isStringLiteral(literal) && literal.value === oldText) {
          if (
            typeof literal.start === "number" &&
            typeof literal.end === "number"
          ) {
            hits.push({
              start: literal.start,
              end: literal.end,
              quote: detectQuote(source, literal.start),
            });
          }
        }
      }
    }
  }

  if (hits.length === 0) {
    // Structural resolution worked but the value isn't in the expected
    // place (maybe the array gets filtered/transformed before rendering).
    // Try the file-scoped search as a last resort.
    return fileScopedSearch(ast, source, oldText, newText);
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: "ambiguous",
      message: `Found ${hits.length} string literals matching "${oldText}" in the resolved variable. Edit a unique nearby string first, or modify the source directly.`,
    };
  }

  const hit = hits[0]!;
  // Replace inside the quotes — preserve the quote character.
  const escaped = escapeForQuote(newText, hit.quote);
  return {
    ok: true,
    spliceStart: hit.start + 1, // skip opening quote
    spliceEnd: hit.end - 1, // skip closing quote
    replacement: escaped,
  };
}

// ---- Path extraction ----------------------------------------------------

type AccessPath = { root: string; path: string[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAccessPath(expr: any): AccessPath | null {
  if (!expr || typeof expr !== "object") return null;
  if (expr.type === "Identifier" && typeof expr.name === "string") {
    return { root: expr.name, path: [] };
  }
  if (expr.type === "MemberExpression" && !expr.computed) {
    const path: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let curr: any = expr;
    while (curr && curr.type === "MemberExpression") {
      if (curr.property?.type !== "Identifier") return null;
      path.unshift(curr.property.name);
      curr = curr.object;
    }
    if (curr?.type === "Identifier" && typeof curr.name === "string") {
      return { root: curr.name, path };
    }
  }
  return null;
}

// ---- Scope collection ---------------------------------------------------

/**
 * Top-level `const`/`let`/`var` declarations whose init is a static value
 * (string literal, object literal, or array literal).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectFileConsts(ast: any): Map<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = new Map<string, any>();
  const body = ast?.program?.body ?? ast?.body ?? [];
  for (const node of body) {
    if (node?.type !== "VariableDeclaration") continue;
    for (const decl of node.declarations ?? []) {
      if (decl?.id?.type === "Identifier" && decl.init) {
        // Only consider declarations that look static — string literal,
        // object literal, or array literal. Anything else (function call,
        // import, etc.) is by definition not statically resolvable.
        if (isStaticValue(decl.init)) {
          result.set(decl.id.name, decl.init);
        }
      }
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStaticValue(node: any): boolean {
  if (!node) return false;
  if (node.type === "StringLiteral") return true;
  if (node.type === "ArrayExpression") return true;
  if (node.type === "ObjectExpression") return true;
  return false;
}

/**
 * All `.map(param => ...)` callbacks in the file, keyed by `param` name.
 * Value is the expression being mapped (the receiver of `.map`). When the
 * same name appears multiple times, the last one wins — fine for our
 * purposes, which are best-effort.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectMapParams(ast: any): Map<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    // Detect `<receiver>.map(<callback>)` calls.
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "map" &&
      Array.isArray(node.arguments) &&
      node.arguments.length >= 1
    ) {
      const cb = node.arguments[0];
      if (
        cb?.type === "ArrowFunctionExpression" ||
        cb?.type === "FunctionExpression"
      ) {
        const param = cb.params?.[0];
        if (param?.type === "Identifier" && typeof param.name === "string") {
          result.set(param.name, node.callee.object);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (
        key === "loc" ||
        key === "tokens" ||
        key === "comments" ||
        key === "extra"
      ) {
        continue;
      }
      walk(node[key]);
    }
  }
  walk(ast);
  return result;
}

// ---- Resolver -----------------------------------------------------------

type DirectCandidate = {
  kind: "direct";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  residualPath: string[];
};
type ArrayCandidate = {
  kind: "array";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  array: any;
  residualPath: string[];
};
type Candidate = DirectCandidate | ArrayCandidate;

/**
 * Given a JSX expression like `{plan.name}`, return a list of candidate
 * "places to look" for the matching string literal.
 *
 * Each candidate is either:
 *   - `direct`: the expression resolves to a single literal — caller
 *     navigates `residualPath` on `value` to reach the StringLiteral.
 *   - `array`: the expression came out of a map iteration — caller iterates
 *     `array.elements` and navigates `residualPath` on each element.
 *
 * Recursion handles nested map cases: when `root` is itself a map param,
 * we resolve back to the outer array and then thread our access through
 * each outer element.
 */
function resolveArraysToSearch(
  root: string,
  path: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapParams: Map<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constMap: Map<string, any>,
  depth = 0,
): Candidate[] | null {
  if (depth > 4) return null;

  // Case A: `root` is a const-bound static value.
  const constValue = constMap.get(root);
  if (constValue) {
    if (constValue.type === "ArrayExpression" && path.length === 0) {
      // `{arrayVariable}` is unusual but valid for some cases (rare). Treat
      // each element as a possible match.
      return [{ kind: "array", array: constValue, residualPath: [] }];
    }
    return [{ kind: "direct", value: constValue, residualPath: path }];
  }

  // Case B: `root` is a map callback parameter — each iteration binds `root`
  // to one element of `mappedReceiver`. We need to find the array(s) that
  // `mappedReceiver` resolves to, then in each element apply our `path` to
  // reach the target literal.
  const mappedReceiver = mapParams.get(root);
  if (mappedReceiver) {
    const receiverAccess = extractAccessPath(mappedReceiver);
    if (!receiverAccess) return null;

    // Resolve where the receiver lives. Two shapes are useful:
    //   (i)  receiver is a const array → that array IS our iteration scope.
    //   (ii) receiver is `outerParam.someProp` where outerParam itself is a
    //        map param — for each outer element, navigate `someProp` to get
    //        an inner array. Each becomes a separate iteration scope.
    const parents = resolveArraysToSearch(
      receiverAccess.root,
      receiverAccess.path,
      mapParams,
      constMap,
      depth + 1,
    );
    if (!parents) return null;

    const out: Candidate[] = [];
    for (const parent of parents) {
      if (parent.kind === "direct") {
        // (i) outer resolved directly to a value. If that value is an array,
        // it's the iteration scope; otherwise nothing to iterate.
        const inner = navigateLiteral(parent.value, parent.residualPath);
        if (inner?.type === "ArrayExpression") {
          out.push({ kind: "array", array: inner, residualPath: path });
        }
      } else {
        // (ii) outer resolved to an array. For each element, apply parent's
        // residualPath. If parent.residualPath is empty, the current map
        // iterates over parent.array directly and we apply OUR `path` to
        // each element. Otherwise we navigate into each element to find
        // the inner array.
        if (parent.residualPath.length === 0) {
          out.push({ kind: "array", array: parent.array, residualPath: path });
        } else {
          for (const el of parent.array.elements ?? []) {
            if (!el) continue;
            const inner = navigateLiteral(el, parent.residualPath);
            if (inner?.type === "ArrayExpression") {
              out.push({ kind: "array", array: inner, residualPath: path });
            }
          }
        }
      }
    }
    return out.length > 0 ? out : null;
  }

  return null;
}

/**
 * Navigate a node (ObjectExpression / ArrayExpression / StringLiteral /
 * etc.) by following a dot-path. Returns the leaf node or null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function navigateLiteral(node: any, path: string[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let curr: any = node;
  for (const segment of path) {
    if (!curr) return null;
    if (curr.type !== "ObjectExpression") return null;
    let found = null;
    for (const prop of curr.properties ?? []) {
      if (prop.type !== "ObjectProperty") continue;
      const key = prop.key;
      const keyName =
        key?.type === "Identifier"
          ? key.name
          : key?.type === "StringLiteral"
            ? key.value
            : null;
      if (keyName === segment) {
        found = prop.value;
        break;
      }
    }
    if (!found) return null;
    curr = found;
  }
  return curr;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStringLiteral(node: any): boolean {
  return (
    node &&
    (node.type === "StringLiteral" ||
      (node.type === "Literal" && typeof node.value === "string"))
  );
}

function detectQuote(source: string, offset: number): string {
  const ch = source.charAt(offset);
  return ch === "'" || ch === '"' ? ch : '"';
}

function escapeForQuote(value: string, quote: string): string {
  // Escape the chosen quote character and backslashes; leave the rest
  // alone. Avoids over-escaping unicode etc.
  return value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`);
}

function formatExprName(root: string, path: string[]): string {
  return path.length === 0 ? root : `${root}.${path.join(".")}`;
}

// ---- File-scoped text search fallback -----------------------------------

/**
 * Last-resort: walk the entire file AST for any string literal whose value
 * equals `oldText`. If exactly one match exists in a position we consider
 * "marketing content" (not an import path, not a className/id/key, not a
 * JSX prop value like href/src), edit it.
 *
 * This catches all the patterns the structural follow-variable resolver
 * doesn't recognize: `.find()`, `.filter().map()`, ternaries, fallback
 * defaults (`x || "Default"`), index access (`arr[0]`), and any other way
 * a developer might reference an in-source string.
 *
 * Bounded to a single file — won't cross-collide with same text in
 * unrelated files (the cross-file ambiguity that broke the old text-search
 * approach).
 */
function fileScopedSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any,
  source: string,
  oldText: string,
  newText: string,
): FollowResult {
  // Whitespace-normalized comparison so source line wraps don't fail the
  // match (same handling as the AST rewriter and text-search modules).
  const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
  const normalizedOld = collapse(oldText);

  const hits: Array<{ start: number; end: number; quote: string }> = [];
  // Diagnostic counters so we can tell whether the walker actually saw
  // the literal at all — invaluable when a real-world file refuses an edit
  // that an isolated test of the same shape passes.
  let stringLiteralCount = 0;
  let stringLiteralValueMatches = 0;
  let rejectedByPosition = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any, parent: any, parentKey: string | null): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, parent, parentKey);
      return;
    }

    // Skip whole subtrees that never contain display content. We DO NOT
    // skip ImportDeclaration/ExportNamedDeclaration/ExportAllDeclaration
    // — those wrap the rest of the module (every exported component's
    // body lives inside ExportNamedDeclaration). The position whitelist
    // below already excludes the path strings on imports/exports.
    if (
      node.type === "JSXAttribute" ||
      node.type === "TSTypeAnnotation" ||
      node.type === "TSTypeLiteral" ||
      node.type === "TSLiteralType" ||
      // Import/export paths live as the `source` field; skip just that field
      // when we encounter them, not the whole declaration.
      (parentKey === "source" &&
        (parent?.type === "ImportDeclaration" ||
          parent?.type === "ExportNamedDeclaration" ||
          parent?.type === "ExportAllDeclaration"))
    ) {
      return;
    }

    // String-literal match — only count if the literal sits in a position
    // consistent with display content. Whitelist of safe parent positions:
    //   - ObjectProperty.value           const x = { name: "Free" }
    //   - ArrayExpression element        const xs = ["a", "b"]
    //   - VariableDeclarator.init        const x = "Hello"
    //   - JSXExpressionContainer.expr    <h1>{"Hello"}</h1>
    //   - LogicalExpression (||/??)      x || "Default"
    //   - ConditionalExpression          cond ? "A" : "B"
    // Blacklist (skip) — most importantly:
    //   - CallExpression argument        t('key'), console.log("x")  <- i18n keys etc.
    //   - TaggedTemplateExpression
    //   - throw new Error("..."), assert messages, etc.
    if (node.type === "StringLiteral") {
      stringLiteralCount++;
      if (
        typeof node.value === "string" &&
        collapse(node.value) === normalizedOld
      ) {
        stringLiteralValueMatches++;
        if (
          typeof node.start === "number" &&
          typeof node.end === "number" &&
          isMarketingPosition(parent, parentKey)
        ) {
          const quote = source.charAt(node.start);
          if (quote === '"' || quote === "'") {
            hits.push({ start: node.start + 1, end: node.end - 1, quote });
          }
        } else {
          rejectedByPosition++;
        }
      }
    }

    // JSXText match — direct in-JSX text. JSXText only ever sits inside a
    // JSXElement/JSXFragment, so no extra position filtering needed.
    if (
      node.type === "JSXText" &&
      typeof node.value === "string" &&
      collapse(node.value) === normalizedOld &&
      typeof node.start === "number" &&
      typeof node.end === "number"
    ) {
      const raw = source.slice(node.start, node.end);
      const leadingLen = (/^\s*/.exec(raw)?.[0] ?? "").length;
      const trailingLen = (/\s*$/.exec(raw)?.[0] ?? "").length;
      hits.push({
        start: node.start + leadingLen,
        end: node.end - trailingLen,
        quote: "", // not a quoted literal; replacement is raw text
      });
    }

    for (const key of Object.keys(node)) {
      if (
        key === "loc" ||
        key === "tokens" ||
        key === "comments" ||
        key === "extra"
      ) {
        continue;
      }
      walk(node[key], node, key);
    }
  }

  walk(ast, null, null);

  function isMarketingPosition(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent: any,
    parentKey: string | null,
  ): boolean {
    if (!parent) return false;
    // const x = "Text"  -> parent is VariableDeclarator, key is 'init'
    if (parent.type === "VariableDeclarator" && parentKey === "init") return true;
    // { name: "Free" } -> parent is ObjectProperty, key is 'value'
    if (parent.type === "ObjectProperty" && parentKey === "value") return true;
    // class Property too
    if (parent.type === "ClassProperty" && parentKey === "value") return true;
    // ["a", "b"] -> parent is ArrayExpression, key is 'elements'
    if (parent.type === "ArrayExpression" && parentKey === "elements") return true;
    // <h1>{"Hello"}</h1> -> parent is JSXExpressionContainer, key is 'expression'
    if (parent.type === "JSXExpressionContainer" && parentKey === "expression")
      return true;
    // x || "Default" -> LogicalExpression
    if (parent.type === "LogicalExpression" && parentKey === "right") return true;
    // cond ? "A" : "B"
    if (
      parent.type === "ConditionalExpression" &&
      (parentKey === "consequent" || parentKey === "alternate")
    ) {
      return true;
    }
    // Anything else (CallExpression args, ThrowStatement, ImportDeclaration
    // source, etc.) is excluded.
    return false;
  }

  if (hits.length === 0) {
    // Suppress the counters from the public message — they were useful to
    // diagnose the "export blocks the walker" bug, but in normal operation
    // a user just needs "we couldn't find this text in this file".
    void stringLiteralCount;
    void stringLiteralValueMatches;
    void rejectedByPosition;
    return {
      ok: false,
      error: "mismatch",
      message: `No string literal matching "${oldText}" found in this file. The text may live in a different file, in your data layer, or have changed since the page loaded.`,
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: "ambiguous",
      message: `Found ${hits.length} places in this file matching "${oldText}". Edit a unique nearby string first, or modify the source directly.`,
    };
  }

  const hit = hits[0]!;
  if (hit.quote === "") {
    // JSXText match — no quote escaping
    return {
      ok: true,
      spliceStart: hit.start,
      spliceEnd: hit.end,
      replacement: newText,
    };
  }
  return {
    ok: true,
    spliceStart: hit.start,
    spliceEnd: hit.end,
    replacement: escapeForQuote(newText, hit.quote),
  };
}
