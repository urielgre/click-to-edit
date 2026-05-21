/**
 * Shared types — the integration contract between the client overlay and the
 * server-side dev route handler. ALL fields here are PUBLIC API once v0.1.0
 * ships; treat changes as breaking.
 */

/**
 * Request body for POST <editRoute> (default: /api/__cte/edit).
 *
 * Two modes share one shape:
 *
 *   1. **Exact mode** — when the client can read React's `_debugSource`
 *      fiber field. Sends `file`, `line`, `column` plus `oldText`/`newText`.
 *      Used for Client Components in development builds.
 *
 *   2. **Search mode** — when fiber source is unavailable (Server Components,
 *      third-party components, hydrated nodes without `_debugSource`). The
 *      client omits `file`/`line`/`column` and includes `parentText` and
 *      `siblingTexts` so the server can scan the project for a unique JSX
 *      literal matching this DOM context.
 *
 * Both modes always require `oldText` and `newText`.
 */
export type EditRequest = {
  /**
   * The exact text being replaced, trimmed of leading/trailing whitespace.
   * In exact mode: used to disambiguate which child of the JSX element and
   * to refuse if source has drifted. In search mode: the primary key used
   * to find candidate JSX literals across the project.
   */
  oldText: string;

  /**
   * The replacement text. Whitespace inside is preserved verbatim; the server
   * does NOT trim, escape, or normalize this value.
   */
  newText: string;

  // ---- Exact mode (preferred) -------------------------------------------

  /**
   * Path to the source file, relative to project root.
   * Example: "app/page.tsx". Server MUST resolve this against
   * `process.cwd()` and reject paths that escape it.
   *
   * Optional: present only in exact mode.
   */
  file?: string;

  /**
   * 1-indexed line of the *enclosing JSXElement*, from React's `_debugSource`.
   * Optional: present only in exact mode.
   */
  line?: number;

  /**
   * 1-indexed column of the JSXElement.
   * Optional: present only in exact mode.
   */
  column?: number;

  // ---- Search mode (fallback) -------------------------------------------

  /**
   * The trimmed, whitespace-collapsed text content of the clicked element's
   * parent in the DOM. Used to disambiguate when the same `oldText` appears
   * in multiple files. Optional: client sends this in search mode; server
   * uses it for filtering when present.
   *
   * Capped at ~500 chars by convention to bound payload size.
   */
  parentText?: string;

  /**
   * Trimmed text of the clicked element's sibling DOM nodes. Same role as
   * `parentText` — secondary disambiguation signal.
   */
  siblingTexts?: string[];
};

/**
 * Success response. The route handler returns HTTP 200.
 */
export type EditSuccess = {
  ok: true;
  /** Absolute path of the file that was written. */
  file: string;
};

/**
 * Discriminator for failure modes. Stable enum — order does not matter,
 * but values are part of public API.
 */
export type EditErrorCode =
  /** NODE_ENV !== "development", or some other env-level gate rejected. */
  | "forbidden"
  /** Resolved file path escapes process.cwd(), or matches a blocklist (node_modules, .git, .next). */
  | "not_in_project"
  /** File extension is not .tsx/.jsx/.ts/.js. */
  | "invalid_extension"
  /** File does not exist on disk. */
  | "file_not_found"
  /** Babel could not parse the source file as JSX. */
  | "parse_error"
  /** No JSXElement found at the requested line:column. */
  | "element_not_found"
  /**
   * The matched JSX child is not a plain literal — e.g. it is `{variable}`,
   * `{t('key')}`, a template literal, or a conditional expression.
   * The client should NEVER let the user reach this state (the overlay
   * grays out non-editable nodes), but the server enforces it defensively.
   */
  | "not_editable"
  /** No JSXText/StringLiteral child whose value === oldText was found. */
  | "mismatch"
  /** Multiple children matched oldText; the server refuses to guess. */
  | "ambiguous"
  /** fs/path operation failed during write. Includes message detail. */
  | "write_failed";

export type EditFailure = {
  ok: false;
  error: EditErrorCode;
  message: string;
};

export type EditResponse = EditSuccess | EditFailure;

/**
 * Configuration for createEditHandler() and the client provider.
 * Both sides accept this so the install flow can pass a single object.
 */
export type ClickToEditOptions = {
  /**
   * Route path the client POSTs edits to. Must match the actual route file
   * location in the user's app. Default: "/api/__cte/edit".
   */
  editRoute?: string;

  /**
   * Keyboard shortcut to toggle edit mode. Default: "Mod+E"
   * (Cmd on macOS, Ctrl elsewhere). Format follows tinykeys-style binding.
   */
  hotkey?: string;

  /**
   * Maximum number of edits kept in the in-memory undo stack.
   * Default: 50. Set to 0 to disable undo entirely.
   */
  undoLimit?: number;
};

/**
 * Default values applied when an option is omitted. Exported so both the
 * provider and the server handler can reference a single source of truth.
 */
export const DEFAULTS = {
  // Note: Next.js excludes folders starting with "_" from routing (private
  // folders). The route path must not have any "_"-prefixed segments.
  editRoute: "/api/click-to-edit/edit",
  hotkey: "Mod+E",
  undoLimit: 50,
} as const satisfies Required<ClickToEditOptions>;
