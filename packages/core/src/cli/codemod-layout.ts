/**
 * Codemod for the user's root `app/layout.{tsx,jsx,ts,js}`.
 *
 * Two changes are applied if missing:
 *   1. `import { ClickToEditProvider } from "click-to-edit";`
 *   2. The `{children}` expression in the layout's JSX is wrapped with
 *      `<ClickToEditProvider>{children}</ClickToEditProvider>`.
 *
 * Designed to be idempotent — running it on an already-wrapped layout is a
 * no-op. Uses the same byte-splice technique as the runtime AST rewrite to
 * preserve every other byte of the source (formatting, comments, etc.).
 *
 * Refuses (does not guess) when the layout's structure is unfamiliar.
 */

import { parse as babelParse } from "@babel/parser";

export type WrapResult =
  | { kind: "wrapped"; source: string }
  | { kind: "already-wrapped" }
  | { kind: "error"; message: string };

const PROVIDER_NAME = "ClickToEditProvider";
const PACKAGE_NAME = "click-to-edit";

export function wrapLayoutWithProvider(source: string): WrapResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ast: any;
  try {
    ast = babelParse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    });
  } catch (err) {
    return {
      kind: "error",
      message: `Could not parse layout file: ${(err as Error).message}`,
    };
  }

  // Are we already importing ClickToEditProvider from this package?
  let alreadyImported = false;
  for (const node of ast.program?.body ?? []) {
    if (
      node?.type === "ImportDeclaration" &&
      node.source?.value === PACKAGE_NAME
    ) {
      for (const spec of node.specifiers ?? []) {
        if (
          spec.type === "ImportSpecifier" &&
          (spec.imported?.name === PROVIDER_NAME ||
            spec.imported?.value === PROVIDER_NAME)
        ) {
          alreadyImported = true;
          break;
        }
      }
    }
  }

  // Locate the `{children}` JSX expression to wrap.
  const target = findChildrenExpression(ast);
  if (!target) {
    return {
      kind: "error",
      message:
        "Could not locate `{children}` in the layout's JSX. " +
        "If your layout uses a non-standard pattern, wrap children manually — " +
        "see the README for the snippet.",
    };
  }

  // Already wrapped? The direct parent JSX element's tag is ClickToEditProvider.
  if (target.parentTagName === PROVIDER_NAME) {
    return { kind: "already-wrapped" };
  }

  // Splice the wrap.
  const before = source.slice(0, target.start);
  const childrenSlice = source.slice(target.start, target.end);
  const after = source.slice(target.end);
  let updated =
    before + `<${PROVIDER_NAME}>${childrenSlice}</${PROVIDER_NAME}>` + after;

  // Inject the import if missing. Place it after the last existing import so
  // user-organized import groups stay intact.
  if (!alreadyImported) {
    const lastImportEnd = findLastImportEnd(ast);
    const importLine = `import { ${PROVIDER_NAME} } from "${PACKAGE_NAME}";`;
    if (lastImportEnd !== null) {
      updated =
        updated.slice(0, lastImportEnd) +
        `\n${importLine}` +
        updated.slice(lastImportEnd);
    } else {
      updated = `${importLine}\n` + updated;
    }
  }

  return { kind: "wrapped", source: updated };
}

type ChildrenLocation = {
  start: number;
  end: number;
  /** The JSX tag name immediately containing `{children}`. Null if the
   *  expression is at the top of a fragment. */
  parentTagName: string | null;
};

function findChildrenExpression(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any,
): ChildrenLocation | null {
  let found: ChildrenLocation | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any, parentTagName: string | null): void {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, parentTagName);
      return;
    }
    if (node.type === "JSXElement" && Array.isArray(node.children)) {
      const tagName =
        node.openingElement?.name?.type === "JSXIdentifier"
          ? node.openingElement.name.name
          : null;
      for (const child of node.children) {
        if (
          child?.type === "JSXExpressionContainer" &&
          child.expression?.type === "Identifier" &&
          child.expression?.name === "children" &&
          typeof child.start === "number" &&
          typeof child.end === "number"
        ) {
          found = {
            start: child.start,
            end: child.end,
            parentTagName: tagName,
          };
          return;
        }
        walk(child, tagName);
      }
      return;
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
      walk(node[key], parentTagName);
    }
  }

  walk(ast, null);
  return found;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLastImportEnd(ast: any): number | null {
  let lastEnd: number | null = null;
  for (const node of ast.program?.body ?? []) {
    if (node?.type === "ImportDeclaration" && typeof node.end === "number") {
      lastEnd = node.end;
    }
  }
  return lastEnd;
}
