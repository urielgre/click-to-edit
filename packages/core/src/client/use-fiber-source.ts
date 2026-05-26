"use client";

/**
 * Source resolution for a clicked DOM element.
 *
 * Primary path: read a `data-cte-loc="<absolutePath>:<line>:<column>"`
 * attribute from the nearest ancestor that has one. The attribute is
 * injected at build time by the webpack loader (`click-to-edit/loader`).
 * This path works for both Server Components and Client Components because
 * the attribute is a literal in the streamed HTML — it survives RSC
 * serialization with no special handling required.
 *
 * Fallback path: walk the React fiber chain looking for `_debugSource`,
 * which `@babel/preset-react` populates for Client Components in dev. Kept
 * for two reasons:
 *   1. Users who haven't added the loader to their next.config yet can
 *      still get partial functionality on Client Components.
 *   2. React 19 removed `_debugSource` from production fibers — but it
 *      still exists in dev mode. The fallback may erode over time; the
 *      primary attribute path is forward-compatible.
 *
 * Returns null if neither source is available — caller should treat that
 * as "not editable" or fall through to server-side text-search (which we
 * keep only for un-instrumented third-party components).
 */

export type FiberSource = {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
};

const ATTR_NAME = "data-cte-loc";

export function getFiberSource(element: Element): FiberSource | null {
  // Primary: data-cte-loc attribute (build-time injected).
  const fromAttr = readDataCteLoc(element);
  if (fromAttr) return fromAttr;

  // Fallback: React fiber _debugSource (dev mode, Client Components only).
  return readFiberDebugSource(element);
}

function readDataCteLoc(element: Element): FiberSource | null {
  const tagged = element.closest(`[${ATTR_NAME}]`);
  if (!tagged) return null;
  const raw = tagged.getAttribute(ATTR_NAME);
  if (!raw) return null;

  // Format: "absolute/path/to/file.tsx:LINE:COLUMN". The path may contain
  // colons on Windows (e.g. "C:/Users/..."). Parse from the right so the
  // last two colons split off line + column.
  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 1) return null;
  const prevColon = raw.lastIndexOf(":", lastColon - 1);
  if (prevColon < 1) return null;

  const fileName = raw.slice(0, prevColon);
  const lineNumber = Number.parseInt(raw.slice(prevColon + 1, lastColon), 10);
  const columnNumber = Number.parseInt(raw.slice(lastColon + 1), 10);

  if (!fileName || !Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
    return null;
  }
  return { fileName, lineNumber, columnNumber };
}

function readFiberDebugSource(element: Element): FiberSource | null {
  const fiberKey = Object.keys(element).find((k) =>
    k.startsWith("__reactFiber$"),
  );
  if (!fiberKey) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (element as unknown as Record<string, unknown>)[fiberKey];
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
