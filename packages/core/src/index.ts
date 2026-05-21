/**
 * Public client-side entry point.
 *
 * Consumers do:
 *   import { ClickToEditProvider } from "click-to-edit";
 *
 * The server-side handler lives at "click-to-edit/server".
 */

export { ClickToEditProvider } from "./client/index.js";
export type {
  EditRequest,
  EditResponse,
  EditErrorCode,
  ClickToEditOptions,
} from "./shared/types.js";
export { DEFAULTS } from "./shared/types.js";
