/**
 * Webpack/Turbopack loader that stamps every JSX opening element with a
 * `data-cte-loc="<absolutePath>:<line>:<column>"` attribute.
 *
 * The client overlay reads this attribute (via `element.closest("[data-cte-loc]")`)
 * on click and ships the exact location to the server, which then does a
 * surgical AST rewrite at that exact JSXElement — no text matching, no
 * disambiguation guessing.
 *
 * Registration in user's `next.config.{js,ts}`:
 *
 *   turbopack: {
 *     rules: {
 *       '**\/*.{tsx,jsx}': {
 *         loaders: [{ loader: 'click-to-edit/loader' }],
 *       },
 *     },
 *   }
 *
 * The loader is a no-op in production builds and on files inside
 * `node_modules` — it only adds attributes to the user's own source.
 *
 * Implementation: parse with `@babel/parser` (jsx + typescript plugins),
 * collect `JSXOpeningElement.name.end` offsets, then string-splice the new
 * attribute in. We do NOT regenerate via @babel/generator because that
 * destroys formatting and would invalidate source maps unnecessarily.
 *
 * Fragments (`<>...</>`) have no opening element to stamp, so a component
 * whose root is a fragment is not editable. Wrap such roots in a real
 * element (`<div>...</div>`) to enable editing.
 */

import { parse } from "@babel/parser";

const ATTR_NAME = "data-cte-loc";
const ELIGIBLE = /\.(tsx|jsx|ts|js)$/;

interface LoaderContext {
  resourcePath: string;
  mode?: string;
  callback?: (err: Error | null, content?: string) => void;
}

export default function clickToEditLoader(
  this: LoaderContext,
  source: string,
): string {
  const filename = this.resourcePath;

  // Only act in development. Webpack passes `mode` on `this`; otherwise fall
  // back to NODE_ENV. Production must be a pass-through — `data-cte-loc`
  // attributes have no place in a shipped build.
  const mode = this.mode ?? process.env.NODE_ENV;
  if (mode === "production") return source;

  if (!ELIGIBLE.test(filename)) return source;
  if (filename.includes("node_modules")) return source;

  // Cheap reject: if the source has no `<` at all, there's no JSX to stamp.
  if (source.indexOf("<") < 0) return source;

  // Parse. We use errorRecovery: true so a file with a tiny syntax issue
  // doesn't block the rest of the project from compiling — webpack would
  // surface the actual SWC error downstream anyway.
  let ast: unknown;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      errorRecovery: true,
      // Babel needs `tokens: false` (default) to keep memory tight; we don't
      // need them.
    });
  } catch {
    return source;
  }

  // Walk for JSXOpeningElement nodes and collect splice positions.
  type Insertion = { offset: number; text: string };
  const insertions: Insertion[] = [];

  // Use POSIX-style forward slashes in the attribute value so the
  // server-side path validator (which uses path.resolve) gets a portable
  // input regardless of platform.
  const posixFilename = filename.replace(/\\/g, "/");

  walk(ast);

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;

    if (n.type === "JSXOpeningElement") {
      const loc = n.loc?.start;
      const nameEnd: unknown = n.name?.end;
      if (
        loc &&
        typeof nameEnd === "number" &&
        !hasCteLocAttribute(n.attributes)
      ) {
        const value = `${posixFilename}:${loc.line}:${loc.column}`;
        // Escape any double quotes in the path. Paths almost never contain
        // them but a Unix filename CAN, so guard against runaway output.
        const escaped = value.replace(/"/g, "&quot;");
        insertions.push({
          offset: nameEnd,
          text: ` ${ATTR_NAME}="${escaped}"`,
        });
      }
    }

    for (const key of Object.keys(n)) {
      // Skip metadata fields that don't carry child nodes.
      if (
        key === "loc" ||
        key === "tokens" ||
        key === "comments" ||
        key === "extra" ||
        key === "range" ||
        key === "start" ||
        key === "end"
      ) {
        continue;
      }
      walk(n[key]);
    }
  }

  if (insertions.length === 0) return source;

  // Splice from the end so earlier offsets remain valid as we insert.
  insertions.sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const { offset, text } of insertions) {
    result = result.slice(0, offset) + text + result.slice(offset);
  }
  return result;
}

function hasCteLocAttribute(attrs: unknown): boolean {
  if (!Array.isArray(attrs)) return false;
  for (const a of attrs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attr = a as any;
    if (
      attr?.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      attr.name.name === ATTR_NAME
    ) {
      return true;
    }
  }
  return false;
}
