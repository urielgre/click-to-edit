"use client";

import * as React from "react";
import type { ClickToEditOptions } from "../shared/types.js";
import { DEFAULTS } from "../shared/types.js";
import type { UndoStack } from "./undo-stack.js";

/**
 * Internal context shared between the provider and the overlay/editor.
 * Not exported from the package — purely an implementation detail.
 */
export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

export type EditModeContextValue = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  options: Required<ClickToEditOptions>;
  undoStack: UndoStack;
  /**
   * Live count of items on the undo stack. Used by the overlay to show /
   * hide the visible Undo button. Driven by UndoStack.subscribe() in the
   * provider.
   */
  undoCount: number;
  /**
   * Trigger undo programmatically (same effect as Cmd/Ctrl+Z). Used by the
   * visible Undo button.
   */
  performUndo: () => void;
  showToast: (kind: ToastKind, message: string) => void;
};

export const EditModeContext =
  React.createContext<EditModeContextValue | null>(null);

export function useEditMode(): EditModeContextValue {
  const ctx = React.useContext(EditModeContext);
  if (!ctx) {
    throw new Error(
      "click-to-edit: useEditMode must be used inside <ClickToEditProvider>",
    );
  }
  return ctx;
}

export function resolveOptions(
  options: ClickToEditOptions | undefined,
): Required<ClickToEditOptions> {
  return {
    editRoute: options?.editRoute ?? DEFAULTS.editRoute,
    hotkey: options?.hotkey ?? DEFAULTS.hotkey,
    undoLimit: options?.undoLimit ?? DEFAULTS.undoLimit,
  };
}
