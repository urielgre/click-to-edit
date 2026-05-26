"use client";

import * as React from "react";
import { useEditMode } from "./context.js";
import type { Toast } from "./context.js";
import { getFiberSource } from "./use-fiber-source.js";
import type { FiberSource } from "./use-fiber-source.js";
import {
  isEditableElement,
  hasOwnTextNode,
  getTextNodeAtPoint,
  startEdit,
  startTextNodeEdit,
} from "./editor.js";

/**
 * Overlay UI rendered only in dev mode. Composed of:
 *   - A bottom-right floating control: a toggle pill (always visible) plus
 *     an Undo button (visible when edit mode is on and undo stack non-empty).
 *   - A hover highlight box (absolutely positioned) over the element under
 *     the cursor while edit mode is enabled.
 *   - A toast region for save/error feedback.
 *
 * The overlay does NOT use a portal — it just renders into the provider's
 * subtree. Everything is z-index 2147483600+ to sit above app chrome.
 */

const Z_BASE = 2147483600;
const HIGHLIGHT_BLUE = "#3b82f6"; // exact mode (fiber source available)
const HIGHLIGHT_YELLOW = "#eab308"; // search mode (no fiber, server text-search)
const HIGHLIGHT_RED = "#ef4444"; // not editable

type EditableKind =
  /** Single-text-child element — use element-level edit path. */
  | "element"
  /** Mixed-content parent — text-node-level edit on caret position. */
  | "text-node"
  /** Has fiber/text content but neither path will work cleanly. */
  | "none";

type HoverState = {
  rect: DOMRect;
  source: FiberSource | null;
  kind: EditableKind;
  /** "exact" if fiber source available, else "search" (server text-search). */
  mode: "exact" | "search";
  reason?: string;
};

export function Overlay(): React.ReactElement | null {
  const { enabled, setEnabled, options, showToast, undoCount, performUndo } =
    useEditMode();
  const [hover, setHover] = React.useState<HoverState | null>(null);
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  // Editing state — when non-null, an inline editor is active on `element`.
  // We use it to suppress hover updates during edit.
  const editingRef = React.useRef<HTMLElement | null>(null);
  const cancelEditRef = React.useRef<(() => void) | null>(null);

  // Bridge: provider passes us `showToast` via context, but we own the toast
  // list state. The provider's `showToast` is wired to our enqueue below via
  // the same callback identity (see provider).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    overlayEnqueueToast = (kind, message) => {
      const id = nextToastId++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2000);
    };
    return () => {
      overlayEnqueueToast = null;
    };
  }, []);

  // Hover tracking. We use mousemove (throttled via rAF) to find the topmost
  // element under the cursor and classify it.
  React.useEffect(() => {
    if (!enabled) {
      setHover(null);
      return;
    }
    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const handleMove = (e: MouseEvent): void => {
      pending = { x: e.clientX, y: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!pending) return;
        const { x, y } = pending;
        pending = null;

        if (editingRef.current) return;

        const el = document.elementFromPoint(x, y);
        if (!el || !(el instanceof HTMLElement)) {
          setHover(null);
          return;
        }
        if (el.closest("[data-cte-overlay]")) {
          setHover(null);
          return;
        }

        const source = getFiberSource(el);

        // Classify editability:
        //   - Pure-text element (no element children with text) → element mode
        //   - Mixed content but has text nodes → text-node mode
        //   - Otherwise → none (red outline)
        let kind: EditableKind;
        let reason: string | undefined;
        if (isEditableElement(el)) {
          kind = "element";
        } else if (hasOwnTextNode(el)) {
          kind = "text-node";
          reason =
            "Click directly on the text you want to edit (mixed-content element).";
        } else {
          kind = "none";
          reason = "No editable text in this element.";
        }
        if (kind !== "none" && !source) {
          reason =
            reason ??
            "No fiber source — server will text-search to find it (slower).";
        }

        const mode: "exact" | "search" = source ? "exact" : "search";
        setHover({
          rect: el.getBoundingClientRect(),
          source,
          kind,
          mode,
          reason,
        });
      });
    };

    const handleLeave = (): void => setHover(null);
    const handleScroll = (): void => {
      if (!editingRef.current) setHover(null);
    };

    window.addEventListener("mousemove", handleMove, { passive: true });
    window.addEventListener("mouseleave", handleLeave);
    window.addEventListener("scroll", handleScroll, {
      passive: true,
      capture: true,
    });

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseleave", handleLeave);
      window.removeEventListener(
        "scroll",
        handleScroll,
        { capture: true } as EventListenerOptions,
      );
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  // Click handler — capture-phase so we beat the app's own onClick handlers.
  React.useEffect(() => {
    if (!enabled) return;

    const onClick = (e: MouseEvent): void => {
      if (editingRef.current) return;
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      // Don't hijack clicks on our own overlay UI.
      if (el.closest("[data-cte-overlay]")) return;

      // Element-level edit path: simple single-text-child elements.
      if (isEditableElement(el)) {
        const source = getFiberSource(el);
        e.preventDefault();
        e.stopPropagation();
        editingRef.current = el;
        setHover(null);
        const cancel = startEdit({
          element: el,
          source,
          editRoute: options.editRoute,
          undoStack: useEditModeUndoStackRef.current!,
          showToast,
          onDone: () => {
            editingRef.current = null;
            cancelEditRef.current = null;
          },
        });
        cancelEditRef.current = cancel;
        return;
      }

      // Mixed-content path: find which text node the user actually clicked.
      if (hasOwnTextNode(el)) {
        const textNode = getTextNodeAtPoint(e.clientX, e.clientY);
        if (!textNode) return; // clicked whitespace or an inner element
        // Resolve source via the same `closest('[data-cte-loc]')` path the
        // element-mode click handler uses. Without this, text-node edits
        // would fall back to fragile server-side text search.
        const source = getFiberSource(el);
        e.preventDefault();
        e.stopPropagation();
        editingRef.current = el;
        setHover(null);
        const cancel = startTextNodeEdit({
          textNode,
          source,
          editRoute: options.editRoute,
          undoStack: useEditModeUndoStackRef.current!,
          showToast,
          onDone: () => {
            editingRef.current = null;
            cancelEditRef.current = null;
          },
        });
        cancelEditRef.current = cancel;
        return;
      }

      // Otherwise: don't hijack — let the app's own handler run.
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, options.editRoute, showToast]);

  // When edit mode is turned off mid-edit, cancel.
  React.useEffect(() => {
    if (!enabled && cancelEditRef.current) {
      cancelEditRef.current();
      cancelEditRef.current = null;
      editingRef.current = null;
    }
  }, [enabled]);

  return (
    <div
      data-cte-overlay=""
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: Z_BASE,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {enabled && hover ? <Highlight hover={hover} /> : null}
      <FloatingControls
        enabled={enabled}
        onToggle={() => setEnabled(!enabled)}
        hotkey={options.hotkey}
        undoCount={undoCount}
        onUndo={() => {
          void performUndo();
        }}
      />
      <ToastList toasts={toasts} />
    </div>
  );
}

function Highlight({ hover }: { hover: HoverState }): React.ReactElement {
  const color =
    hover.kind === "none"
      ? HIGHLIGHT_RED
      : hover.mode === "search"
        ? HIGHLIGHT_YELLOW
        : HIGHLIGHT_BLUE;
  const bg =
    hover.kind === "none"
      ? "rgba(239,68,68,0.06)"
      : hover.mode === "search"
        ? "rgba(234,179,8,0.08)"
        : "rgba(59,130,246,0.06)";
  const { rect, reason } = hover;
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          border: `1px solid ${color}`,
          outline: `1px dashed ${color}`,
          outlineOffset: "1px",
          borderRadius: 2,
          pointerEvents: "none",
          boxSizing: "border-box",
          background: bg,
          transition: "all 60ms ease",
        }}
      />
      {reason ? (
        <div
          style={{
            position: "fixed",
            top: Math.max(4, rect.top - 28),
            left: rect.left,
            background: color,
            color: "white",
            fontSize: 11,
            padding: "3px 6px",
            borderRadius: 3,
            maxWidth: 360,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          }}
        >
          {reason}
        </div>
      ) : null}
    </>
  );
}

/**
 * Always-visible floating controls in the bottom-right corner.
 *  - Toggle button: click to enter/exit edit mode. Shows current state.
 *  - Undo button: visible only when enabled AND there are undoable edits.
 */
function FloatingControls(props: {
  enabled: boolean;
  onToggle: () => void;
  hotkey: string;
  undoCount: number;
  onUndo: () => void;
}): React.ReactElement {
  const { enabled, onToggle, hotkey, undoCount, onUndo } = props;
  const showUndo = enabled && undoCount > 0;

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        display: "flex",
        gap: 6,
        alignItems: "center",
        pointerEvents: "auto",
      }}
    >
      {enabled ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={undoCount === 0}
          title={
            undoCount === 0
              ? "Nothing to undo yet"
              : `Undo last edit (Cmd/Ctrl+Z) — ${undoCount} edit${undoCount === 1 ? "" : "s"}`
          }
          style={{
            background: undoCount === 0 ? "#f1f5f9" : "#3b82f6",
            color: undoCount === 0 ? "#94a3b8" : "white",
            border:
              undoCount === 0 ? "1px solid #cbd5e1" : "1px solid #2563eb",
            padding: "8px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            cursor: undoCount === 0 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow:
              undoCount === 0
                ? "0 1px 3px rgba(0,0,0,0.08)"
                : "0 2px 8px rgba(59,130,246,0.35)",
            fontFamily: "inherit",
            transition: "all 120ms ease",
          }}
        >
          <UndoIcon />
          <span>
            Undo{undoCount > 1 ? ` (${undoCount})` : ""}
          </span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        title={
          enabled
            ? `Exit edit mode (${prettyHotkey(hotkey)})`
            : `Enter edit mode (${prettyHotkey(hotkey)})`
        }
        style={{
          background: enabled ? "#0f172a" : "#fff",
          color: enabled ? "white" : "#0f172a",
          border: enabled ? "1px solid #0f172a" : "1px solid #e2e8f0",
          padding: "8px 12px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: enabled ? "#22c55e" : "#94a3b8",
            display: "inline-block",
            boxShadow: enabled ? "0 0 6px #22c55e" : "none",
            transition: "all 120ms ease",
          }}
        />
        <span>click-to-edit{enabled ? " on" : ""}</span>
        <kbd
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
            background: enabled ? "rgba(255,255,255,0.15)" : "#f1f5f9",
            color: enabled ? "#e2e8f0" : "#64748b",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          {prettyHotkey(hotkey)}
        </kbd>
      </button>
    </div>
  );
}

function UndoIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7" />
    </svg>
  );
}

function ToastList({ toasts }: { toasts: Toast[] }): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 56,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "flex-end",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background:
              t.kind === "success"
                ? "#16a34a"
                : t.kind === "error"
                  ? "#dc2626"
                  : "#0f172a",
            color: "white",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            maxWidth: 360,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            animation: "cte-toast-in 120ms ease-out",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

function prettyHotkey(hotkey: string): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  return hotkey.replace(/Mod/i, isMac ? "Cmd" : "Ctrl");
}

// --- module-scoped bridges -----------------------------------------------

let nextToastId = 1;
export let overlayEnqueueToast:
  | ((kind: "success" | "error" | "info", message: string) => void)
  | null = null;

/**
 * The provider stores its UndoStack on this ref so the overlay's click
 * handler can read it without re-rendering when stack contents change.
 */
export const useEditModeUndoStackRef: {
  current: import("./undo-stack.js").UndoStack | null;
} = { current: null };
