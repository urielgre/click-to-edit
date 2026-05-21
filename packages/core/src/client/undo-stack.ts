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
 * In-memory bounded stack. Cleared on full page reload — that's intentional
 * for v0.1, since persisting undo across reloads would require knowing which
 * tab/page the user was on.
 */
export class UndoStack {
  private entries: UndoEntry[] = [];
  private readonly limit: number;

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
    return {
      file: top.request.file,
      line: top.request.line,
      column: top.request.column,
      // Swap: the file currently has request.newText, we want previousText.
      oldText: top.request.newText,
      newText: top.previousText,
    };
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
