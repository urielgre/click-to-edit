"use client";

import * as React from "react";
import type { ClickToEditOptions } from "../shared/types.js";
import { EditModeContext, resolveOptions } from "./context.js";
import type { ToastKind } from "./context.js";
import { UndoStack } from "./undo-stack.js";
import { postEdit } from "./client-rpc.js";
import {
  Overlay,
  overlayEnqueueToast,
  useEditModeUndoStackRef,
} from "./overlay.js";

/**
 * Public root component. Renders children verbatim in production. In dev,
 * mounts the overlay and registers global hotkeys.
 *
 * SSR-safe: nothing touches `window` outside of `useEffect`, and the JSX
 * shape is the same on first render whether on server or client (children +
 * an empty Overlay div), so hydration cannot mismatch.
 */
export function ClickToEditProvider(props: {
  children: React.ReactNode;
  options?: ClickToEditOptions;
}): React.ReactElement {
  // Hard gate: in production, no-op. We check this once at render — the
  // bundler will tree-shake the rest away when NODE_ENV is "production".
  if (process.env.NODE_ENV !== "development") {
    return <>{props.children}</>;
  }

  return <DevProvider options={props.options}>{props.children}</DevProvider>;
}

function DevProvider(props: {
  children: React.ReactNode;
  options?: ClickToEditOptions;
}): React.ReactElement {
  const options = React.useMemo(
    () => resolveOptions(props.options),
    [props.options],
  );
  const [enabled, setEnabled] = React.useState(false);

  // Undo stack persists for the lifetime of the page. Recreated only if the
  // limit changes (rare).
  const undoStack = React.useMemo(
    () => new UndoStack(options.undoLimit),
    [options.undoLimit],
  );

  // Park the stack on the module-scoped ref so the overlay's click handler
  // can grab it without a re-render dance.
  React.useEffect(() => {
    useEditModeUndoStackRef.current = undoStack;
    return () => {
      useEditModeUndoStackRef.current = null;
    };
  }, [undoStack]);

  // showToast bridges into the overlay's enqueue function. Stable identity
  // so consumers (editor) can hold onto it.
  const showToast = React.useCallback((kind: ToastKind, message: string) => {
    overlayEnqueueToast?.(kind, message);
  }, []);

  // Hotkey listener: Cmd/Ctrl+E toggles edit mode, Esc exits, Cmd/Ctrl+Z
  // undoes the last edit. We deliberately don't depend on tinykeys — the
  // matching rules here are simple enough.
  React.useEffect(() => {
    const isHotkey = (e: KeyboardEvent): boolean => {
      const mod = e.metaKey || e.ctrlKey;
      // Default hotkey is "Mod+E"; if the user passes something else we still
      // honor Cmd/Ctrl+E for v0.1 since the format string is informational.
      // (Full tinykeys-style parsing can land later without breaking API.)
      if (mod && (e.key === "e" || e.key === "E")) return true;
      // Allow user-supplied single-letter binding "Mod+X":
      const match = /^Mod\+([A-Za-z])$/.exec(options.hotkey);
      const letter = match?.[1];
      if (letter && mod && e.key.toLowerCase() === letter.toLowerCase()) {
        return true;
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isHotkey(e)) {
        e.preventDefault();
        setEnabled((v) => !v);
        return;
      }
      if (e.key === "Escape" && enabled) {
        setEnabled(false);
        return;
      }
      if (
        enabled &&
        (e.metaKey || e.ctrlKey) &&
        (e.key === "z" || e.key === "Z") &&
        !e.shiftKey
      ) {
        // Only undo if focus is NOT in a contenteditable (so the in-edit
        // contenteditable still gets native undo).
        const active = document.activeElement as HTMLElement | null;
        if (active && active.isContentEditable) return;
        e.preventDefault();
        void performUndo();
      }
    };

    const performUndo = async (): Promise<void> => {
      const inverse = undoStack.popInverse();
      if (!inverse) {
        showToast("info", "Nothing to undo");
        return;
      }
      const res = await postEdit(options.editRoute, inverse);
      if (res.ok) {
        showToast("success", "Undone");
      } else {
        showToast("error", `Undo failed: ${res.message || res.error}`);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, options.editRoute, options.hotkey, showToast, undoStack]);

  const value = React.useMemo(
    () => ({ enabled, setEnabled, options, undoStack, showToast }),
    [enabled, options, undoStack, showToast],
  );

  return (
    <EditModeContext.Provider value={value}>
      {props.children}
      <Overlay />
    </EditModeContext.Provider>
  );
}
