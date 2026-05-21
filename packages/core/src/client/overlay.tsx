"use client";

import * as React from "react";
import { useEditMode } from "./context.js";
import type { Toast } from "./context.js";
import { getFiberSource } from "./use-fiber-source.js";
import type { FiberSource } from "./use-fiber-source.js";
import { isEditableElement, startEdit } from "./editor.js";

/**
 * Overlay UI rendered only in dev mode. Composed of:
 *   - A bottom-right status badge ("click-to-edit ON" + hotkey hint).
 *   - A hover highlight box (absolutely positioned) over the element under
 *     the cursor while edit mode is enabled.
 *   - A toast region for save/error feedback.
 *
 * The overlay does NOT use a portal — it just renders into the provider's
 * subtree. Everything is z-index 2147483600+ to sit above app chrome.
 */

const Z_BASE = 2147483600;
const HIGHLIGHT_BLUE = "#3b82f6"; // exact mode (fiber source available)
const HIGHLIGHT_YELLOW = "#eab308"; // search mode (no fiber, server will scan)
const HIGHLIGHT_RED = "#ef4444"; // genuinely non-editable

type HoverState = {
  rect: DOMRect;
  source: FiberSource | null;
  editable: boolean;
  /** "exact" = fiber source available; "search" = will fall back to text search. */
  mode: "exact" | "search";
  reason?: string;
};

export function Overlay(): React.ReactElement | null {
  const { enabled, options, showToast } = useEditMode();
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
    // Expose enqueueToast to the context's showToast.
    // The provider sets the function pointer; we just register our impl.
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
  // element under the cursor and read its fiber source.
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

        // Skip while actively editing.
        if (editingRef.current) return;

        const el = document.elementFromPoint(x, y);
        if (!el || !(el instanceof HTMLElement)) {
          setHover(null);
          return;
        }
        // Ignore overlay's own DOM.
        if (el.closest("[data-cte-overlay]")) {
          setHover(null);
          return;
        }
        const source = getFiberSource(el);
        const hasText = isEditableElement(el);
        // Even without fiber source we can still try — the server falls back
        // to a text-search across the project. Only refuse if the DOM shape
        // makes editing impossible (no text, or nested elements with text).
        const editable = hasText;
        const mode: "exact" | "search" = source ? "exact" : "search";
        const reason = !editable
          ? "Contains nested elements — click the inner text instead"
          : !source
            ? "Server Component / no source info — will use text search (slower, may be ambiguous)"
            : undefined;
        setHover({
          rect: el.getBoundingClientRect(),
          source,
          editable,
          mode,
          reason,
        });
      });
    };

    const handleLeave = (): void => {
      setHover(null);
    };

    const handleScroll = (): void => {
      // Cheap: just clear; next mousemove will repopulate.
      if (!editingRef.current) setHover(null);
    };

    window.addEventListener("mousemove", handleMove, { passive: true });
    window.addEventListener("mouseleave", handleLeave);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseleave", handleLeave);
      window.removeEventListener("scroll", handleScroll, { capture: true } as EventListenerOptions);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  // Click handler — intercept in capture phase so we beat the app's own
  // onClick handlers (links, buttons, etc.).
  React.useEffect(() => {
    if (!enabled) return;

    const onClick = (e: MouseEvent): void => {
      if (editingRef.current) return;
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      // Don't hijack clicks on our own overlay UI.
      if (el.closest("[data-cte-overlay]")) return;

      if (!isEditableElement(el)) return;
      // Source may be null — that's fine; editor.tsx will use search mode.
      const source = getFiberSource(el);

      // We're taking over this click.
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
      {enabled ? <Badge hotkey={options.hotkey} /> : null}
      <ToastList toasts={toasts} />
    </div>
  );
}

function Highlight({ hover }: { hover: HoverState }): React.ReactElement {
  const color = !hover.editable
    ? HIGHLIGHT_RED
    : hover.mode === "search"
      ? HIGHLIGHT_YELLOW
      : HIGHLIGHT_BLUE;
  const bg = !hover.editable
    ? "rgba(239,68,68,0.06)"
    : hover.mode === "search"
      ? "rgba(234,179,8,0.08)"
      : "rgba(59,130,246,0.06)";
  const { rect, reason, editable } = hover;
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

function Badge({ hotkey }: { hotkey: string }): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        background: "#0f172a",
        color: "white",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        pointerEvents: "auto",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#22c55e",
          display: "inline-block",
          boxShadow: "0 0 6px #22c55e",
        }}
      />
      <span>click-to-edit ON</span>
      <kbd
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
          background: "rgba(255,255,255,0.12)",
          padding: "1px 5px",
          borderRadius: 3,
          color: "#e2e8f0",
        }}
      >
        {prettyHotkey(hotkey)}
      </kbd>
    </div>
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
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return hotkey.replace(/Mod/i, isMac ? "Cmd" : "Ctrl");
}

// --- module-scoped bridges -----------------------------------------------
// The overlay owns the toast list state, but the editor (which lives outside
// React) needs to enqueue toasts via the context's `showToast`. The provider
// wires both ends to these module-scoped slots.

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
