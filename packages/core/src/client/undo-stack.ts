"use client";

import type { EditRequest } from "../shared/types.js";
import { DEFAULTS } from "../shared/types.js";

/**
 * One entry on the undo stack.
 *  - `request` is the EditRequest that was sent (oldText -> newText).
 *  - `previousText` is the text that was on screen before this edit
 *    (typically === request.oldText, but stored separately so the caller
 *    isn't forced to assume that invariant).
 */
export type UndoEntry = {
  request: EditRequest;
  previousText: string;
};

/**
 * In-memory bounded stack with a tiny pub-sub so React UI can react to size
 * changes. Cleared on full page reload — that's intentional for v0.1, since
 * persisting undo across reloads would require knowing which tab/page the
 * user was on.
 */
export class UndoStack {
  private entries: UndoEntry[] = [];
  private readonly limit: number;
  private listeners = new Set<() => void>();

  constructor(limit: number = DEFAULTS.undoLimit) {
    this.limit = Math.max(0, limit);
  }

  push(entry: UndoEntry): void {
    if (this.limit === 0) return;
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      // Drop the oldest. Cheap because limit is small (50 by default).
      this.entries.splice(0, this.entries.length - this.limit);
    }
    this.notify();
  }

  /**
   * Pop the top entry and return an EditRequest that *reverses* it
   * (swaps oldText/newText). Returns null if the stack is empty.
   *
   * Note: this does NOT push the inverse onto the stack — the caller decides
   * whether undo should itself be undoable (redo). For v0.1 we keep it one-
   * way: undo consumes a stack entry, period.
   */
  popInverse(): EditRequest | null {
    const top = this.entries.pop();
    if (!top) return null;
    this.notify();

    const inverse: EditRequest = {
      oldText: top.request.newText,
      newText: top.previousText,
    };

    // Carry exact-mode coordinates if the original request had them.
    if (
      typeof top.request.file === "string" &&
      typeof top.request.line === "number" &&
      typeof top.request.column === "number"
    ) {
      inverse.file = top.request.file;
      inverse.line = top.request.line;
      inverse.column = top.request.column;
    }

    // For search-mode entries: the file's parent text has changed since the
    // original edit (oldText -> newText). Patch the cached parentText so the
    // server's text search can still find the target.
    if (typeof top.request.parentText === "string") {
      inverse.parentText = top.request.parentText.replace(
        top.request.oldText,
        top.request.newText,
      );
    }
    if (top.request.siblingTexts) {
      inverse.siblingTexts = top.request.siblingTexts.slice();
    }

    return inverse;
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  }

  /**
   * Subscribe to size/contents changes. Returns an unsubscribe function.
   * Used by the provider to keep an `undoCount` React state in sync so the
   * overlay can show/hide the Undo button.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // listener errors must not corrupt the stack
      }
    }
  }
}
