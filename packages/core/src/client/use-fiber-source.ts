"use client";

/**
 * Fiber source resolution.
 *
 * React (16+) tags every host DOM node with a property named like
 * `__reactFiber$abc123` that points at the corresponding fiber. In *dev*
 * builds, `@babel/preset-react`'s jsx-source transform fills
 * `fiber._debugSource` with `{ fileName, lineNumber, columnNumber }` for the
 * JSXElement that produced the node.
 *
 * We walk up `.return` until we find a fiber that owns a `_debugSource`,
 * because text nodes / fragments / forwardRef wrappers can be the immediate
 * fiber for an element without carrying source info themselves.
 *
 * Caveats:
 *   - `_debugSource` exists ONLY in development. In production this returns
 *     null for every node (which is correct — production is opt-out anyway).
 *   - `_debugSource.fileName` is an ABSOLUTE path on disk (whatever the
 *     bundler emitted at compile time). We forward it verbatim to the server
 *     and rely on the server's `validatePath` to resolve / blocklist it.
 *   - These fields are undocumented React internals. They have been stable
 *     across React 16, 17, and 18, but a future major could rename them.
 *
 * The `any` casts are unavoidable: React fibers have no public TS type, and
 * the `__reactFiber$<random>` key is dynamic.
 */

export type FiberSource = {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
};

export function getFiberSource(element: Element): FiberSource | null {
  const fiberKey = Object.keys(element).find((k) =>
    k.startsWith("__reactFiber$"),
  );
  if (!fiberKey) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (element as unknown as Record<string, unknown>)[fiberKey];
  // Walk up until we find a fiber that carries _debugSource.
  while (fiber && !fiber._debugSource) {
    fiber = fiber.return;
  }
  if (!fiber || !fiber._debugSource) return null;

  const src = fiber._debugSource as Partial<FiberSource>;
  if (
    typeof src.fileName !== "string" ||
    typeof src.lineNumber !== "number" ||
    typeof src.columnNumber !== "number"
  ) {
    return null;
  }
  return {
    fileName: src.fileName,
    lineNumber: src.lineNumber,
    columnNumber: src.columnNumber,
  };
}
