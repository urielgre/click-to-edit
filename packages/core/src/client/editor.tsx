"use client";

import type { EditRequest, EditResponse } from "../shared/types.js";
import { postEdit } from "./client-rpc.js";
import type { FiberSource } from "./use-fiber-source.js";
import type { UndoStack } from "./undo-stack.js";

/**
 * Editability heuristic. A node is editable only if it contains a single
 * contiguous run of text with no element children that would themselves
 * carry independent text. Examples:
 *
 *   <h1>Hello world</h1>            -> editable
 *   <p>Hi <strong>there</strong></p> -> NOT editable from <p> (the <strong> child
 *                                       has its own JSXText). The user can click
 *                                       directly on <strong> instead.
 *   <div></div>                      -> NOT editable (no text)
 */
export function isEditableElement(el: Element): boolean {
  // Reject if any element-typed child has non-whitespace text content.
  // (Text nodes themselves are fine — they're the thing we want to edit.)
  for (const child of Array.from(el.children)) {
    if ((child.textContent ?? "").trim().length > 0) return false;
  }
  return (el.textContent ?? "").trim().length > 0;
}

type StartEditArgs = {
  element: HTMLElement;
  /** Fiber source if available (exact mode). Null means search mode. */
  source: FiberSource | null;
  editRoute: string;
  undoStack: UndoStack;
  showToast: (kind: "success" | "error", message: string) => void;
  onDone?: () => void;
};

/**
 * Promote a clicked element into contenteditable mode and wire up the
 * commit / cancel / save flow. Returns a teardown function so the overlay
 * can cancel programmatically (e.g. if the user toggles edit mode off
 * mid-edit).
 */
export function startEdit(args: StartEditArgs): () => void {
  const { element, source, editRoute, undoStack, showToast, onDone } = args;

  const originalText = element.textContent ?? "";
  const originalContentEditable = element.getAttribute("contenteditable");
  const originalSpellcheck = element.getAttribute("spellcheck");
  const originalOutline = element.style.outline;
  const originalOutlineOffset = element.style.outlineOffset;
  const originalCursor = element.style.cursor;

  let finished = false;

  const restore = (): void => {
    if (originalContentEditable === null) {
      element.removeAttribute("contenteditable");
    } else {
      element.setAttribute("contenteditable", originalContentEditable);
    }
    if (originalSpellcheck === null) {
      element.removeAttribute("spellcheck");
    } else {
      element.setAttribute("spellcheck", originalSpellcheck);
    }
    element.style.outline = originalOutline;
    element.style.outlineOffset = originalOutlineOffset;
    element.style.cursor = originalCursor;
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("blur", onBlur);
    element.removeEventListener("paste", onPaste);
  };

  const cancel = (): void => {
    if (finished) return;
    finished = true;
    element.textContent = originalText;
    restore();
    if (document.body) document.body.focus();
    onDone?.();
  };

  const commit = async (): Promise<void> => {
    if (finished) return;
    finished = true;

    const newText = (element.textContent ?? "").trim();
    const oldText = originalText.trim();
    restore();

    if (newText === oldText) {
      // No-op. Don't bother the server.
      onDone?.();
      return;
    }

    if (newText.length === 0) {
      // Defensive: empty text would erase the JSX child. Roll back and warn.
      element.textContent = originalText;
      showToast(
        "error",
        "Empty text not allowed — delete the element in source instead.",
      );
      onDone?.();
      return;
    }

    // Build the request — exact mode if we have fiber source, else search mode.
    const request: EditRequest = source
      ? {
          oldText,
          newText,
          file: source.fileName,
          line: source.lineNumber,
          column: source.columnNumber,
        }
      : {
          oldText,
          newText,
          parentText: gatherParentText(element),
          siblingTexts: gatherSiblingTexts(element),
        };

    // Optimistically: the DOM already shows newText (the user typed it).
    const res: EditResponse = await postEdit(editRoute, request);

    if (res.ok) {
      undoStack.push({ request, previousText: oldText });
      flashGreen(element);
      showToast("success", "Saved");
    } else {
      // Roll back optimistic edit on failure.
      element.textContent = originalText;
      showToast("error", res.message || res.error);
    }
    onDone?.();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onBlur = (): void => {
    void commit();
  };

  const onPaste = (e: ClipboardEvent): void => {
    // Strip rich text — paste as plain.
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  };

  // Activate edit mode on the element.
  element.setAttribute("contenteditable", "true");
  element.setAttribute("spellcheck", "false");
  element.style.outline = "2px solid #3b82f6";
  element.style.outlineOffset = "2px";
  element.style.cursor = "text";
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("blur", onBlur);
  element.addEventListener("paste", onPaste);

  // Focus + caret to end.
  element.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return cancel;
}

function flashGreen(element: HTMLElement): void {
  const prevTransition = element.style.transition;
  const prevBg = element.style.backgroundColor;
  element.style.transition = "background-color 200ms ease";
  element.style.backgroundColor = "rgba(34,197,94,0.25)";
  window.setTimeout(() => {
    element.style.backgroundColor = prevBg;
    window.setTimeout(() => {
      element.style.transition = prevTransition;
    }, 250);
  }, 300);
}

/**
 * Pull a compact text signature from the clicked element's parent for the
 * server's text-search disambiguation step. Trimmed, whitespace-collapsed,
 * and capped at 500 chars.
 */
function gatherParentText(el: Element): string | undefined {
  const parent = el.parentElement;
  if (!parent) return undefined;
  const text = (parent.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return text || undefined;
}

/**
 * Sibling text snippets. Each is trimmed and capped; the full list is
 * truncated to a small number of entries to bound payload size.
 */
function gatherSiblingTexts(el: Element): string[] | undefined {
  const parent = el.parentElement;
  if (!parent) return undefined;
  const out: string[] = [];
  for (const child of Array.from(parent.children)) {
    if (child === el) continue;
    const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    out.push(t.slice(0, 200));
    if (out.length >= 8) break;
  }
  return out.length > 0 ? out : undefined;
}
