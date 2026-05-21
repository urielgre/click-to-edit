/**
 * Public server-side entry point.
 *
 * Consumers do:
 *   import { createEditHandler } from "click-to-edit/server";
 *
 *   export const POST = createEditHandler();
 *
 * The lower-level helpers (rewriteJsxText, validatePath, validateEnv) are
 * exported primarily for testing and for advanced integrators who want to
 * compose their own handler.
 */

export { createEditHandler } from "./create-handler.js";
export { rewriteJsxText } from "./ast-rewrite.js";
export { validatePath, validateEnv } from "./guards.js";
export { searchForEditPoint } from "./text-search.js";
export type { SearchHit, SearchResult } from "./text-search.js";
export type {
  EditRequest,
  EditResponse,
  EditErrorCode,
  ClickToEditOptions,
} from "../shared/types.js";
