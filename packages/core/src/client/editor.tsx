"use client";

import type { EditRequest, EditResponse } from "../shared/types.js";
import { postEdit } from "./client-rpc.js";
import type { FiberSource } from "./use-fiber-source.js";
import type { UndoStack } from "./undo-stack.js";

/**
 * Editability heuristic for the simple element-level edit path.
 * A node is editable here only if it contains a single contiguous run of
 * text with no element children that would themselves carry independent
 * text. Mixed-content elements (e.g. `<h1>foo <span>bar</span></h1>`) are
 * NOT editable via this path — those go through `startTextNodeEdit` so the
 * user can click and edit JUST the plain-text portion.
 */
export function isEditableElement(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if ((child.textContent ?? "").trim().length > 0) return false;
  }
  return (el.textContent ?? "").trim().length > 0;
}

/**
 * Returns true if the element contains at least one non-empty text-node
 * child (regardless of whether it also has element children). Used by the
 * overlay to decide whether to allow a text-node-level edit on a clicked
 * mixed-content element.
 */
export function hasOwnTextNode(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "").trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * Find the text node sitting under (clientX, clientY). Returns null if the
 * caret would be on an element node, on whitespace, or if the browser does
 * not expose a caret-from-point API.
 *
 * Supports Chromium/Safari (`caretRangeFromPoint`) and Firefox
 * (`caretPositionFromPoint`). On unsupported browsers, returns null and the
 * caller should fall back to the element-level path.
 */
export function getTextNodeAtPoint(x: number, y: number): Text | null {
  let node: Node | null = null;

  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) node = range.startContainer;
  }
  if (!node && typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) node = pos.offsetNode;
  }
  if (node && node.nodeType === Node.TEXT_NODE) {
    if ((node.textContent ?? "").trim().length > 0) {
      return node as Text;
    }
  }
  return null;
}

// ---- Element-level edit (single-text-child elements) --------------------

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
      onDone?.();
      return;
    }

    // Empty `newText` is allowed — the AST rewriter emits an empty JSXText
    // child. Undo recovers the original if the user did it by mistake.

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

    const res: EditResponse = await postEdit(editRoute, request);

    if (res.ok) {
      undoStack.push({ request, previousText: oldText });
      flashGreen(element);
      showToast("success", "Saved");
    } else {
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

  element.setAttribute("contenteditable", "true");
  element.setAttribute("spellcheck", "false");
  element.style.outline = "2px solid #3b82f6";
  element.style.outlineOffset = "2px";
  element.style.cursor = "text";
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("blur", onBlur);
  element.addEventListener("paste", onPaste);

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

// ---- Text-node-level edit (mixed-content parents) -----------------------

type StartTextNodeEditArgs = {
  /** The text node the user clicked. Will be temporarily wrapped in a span. */
  textNode: Text;
  /**
   * Source location from the nearest `[data-cte-loc]` ancestor (or fiber
   * fallback). When present, the edit is sent in exact mode — no server-side
   * text-search guessing. When null, the server falls back to text search.
   */
  source: FiberSource | null;
  editRoute: string;
  undoStack: UndoStack;
  showToast: (kind: "success" | "error", message: string) => void;
  onDone?: () => void;
};

/**
 * Edit a single text node living among element siblings (e.g. the plain
 * text in `<h1>foo <span>bar</span></h1>`).
 *
 * Mechanism: wrap the text node in a temporary `<span contenteditable>`,
 * let the user edit, then on commit unwrap the span back into a fresh
 * text node with the new content. The text node's source location is
 * resolved server-side via text-search (we send oldText, parentText,
 * siblingTexts — same wire format the Server Component path already uses).
 */
export function startTextNodeEdit(args: StartTextNodeEditArgs): () => void {
  const { textNode, source, editRoute, undoStack, showToast, onDone } = args;
  const parent = textNode.parentElement;

  if (!parent) {
    // Orphan text node — shouldn't be possible inside the DOM but bail safely.
    onDone?.();
    return () => {};
  }

  const originalText = textNode.textContent ?? "";

  // Wrap the text node in a span so contenteditable applies to just this run.
  const wrapper = document.createElement("span");
  wrapper.setAttribute("data-cte-wrapper", "");
  wrapper.style.outline = "2px solid #3b82f6";
  wrapper.style.outlineOffset = "1px";
  wrapper.style.cursor = "text";
  wrapper.style.borderRadius = "2px";
  parent.insertBefore(wrapper, textNode);
  wrapper.appendChild(textNode);
  wrapper.setAttribute("contenteditable", "true");
  wrapper.setAttribute("spellcheck", "false");

  let finished = false;

  const teardownListeners = (): void => {
    wrapper.removeEventListener("keydown", onKeyDown);
    wrapper.removeEventListener("blur", onBlur);
    wrapper.removeEventListener("paste", onPaste);
  };

  /** Replace the wrapper span with a fresh text node containing `text`. */
  const unwrap = (text: string): void => {
    const newTextNode = document.createTextNode(text);
    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(newTextNode, wrapper);
      wrapper.parentNode.removeChild(wrapper);
    }
  };

  const cancel = (): void => {
    if (finished) return;
    finished = true;
    teardownListeners();
    unwrap(originalText);
    if (document.body) document.body.focus();
    onDone?.();
  };

  const commit = async (): Promise<void> => {
    if (finished) return;
    finished = true;

    const newText = (wrapper.textContent ?? "").trim();
    const oldText = originalText.trim();
    teardownListeners();

    if (newText === oldText) {
      unwrap(originalText);
      onDone?.();
      return;
    }
    // Empty `newText` is allowed — users may legitimately want to delete a
    // text node's content. The server-side AST rewriter just emits an empty
    // string in place of the JSXText. Undo (Cmd+Z) recovers the original.

    // Prefer exact mode (file/line/col from data-cte-loc) when available;
    // fall back to search mode (parentText/siblingTexts) otherwise.
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
          parentText: gatherParentText(parent),
          siblingTexts: gatherSiblingTextsForTextNode(parent, textNode),
        };

    const res: EditResponse = await postEdit(editRoute, request);

    if (res.ok) {
      undoStack.push({ request, previousText: oldText });
      flashGreen(wrapper);
      // Unwrap after the flash so the green outline is visible briefly.
      window.setTimeout(() => {
        // Preserve the original surrounding whitespace from the text node's
        // value by reusing the same leading/trailing spaces.
        unwrap(preserveWhitespace(originalText, newText));
      }, 320);
      showToast("success", "Saved");
    } else {
      unwrap(originalText);
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

  wrapper.addEventListener("keydown", onKeyDown);
  wrapper.addEventListener("blur", onBlur);
  wrapper.addEventListener("paste", onPaste);

  wrapper.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(wrapper);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return cancel;
}

// ---- helpers ------------------------------------------------------------

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
 * Compact text signature of the clicked element's parent for the server's
 * text-search disambiguation step. Trimmed, whitespace-collapsed, capped.
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

/** Sibling-elements' text snippets (element-level path). */
function gatherSiblingTexts(el: Element): string[] | undefined {
  const parent = el.parentElement;
  if (!parent) return undefined;
  return collectSiblingsText(parent, el);
}

/**
 * Sibling-text snippets when editing a text node — here `parent` is the
 * element the text node lives in, and we exclude only the text node itself.
 */
function gatherSiblingTextsForTextNode(
  parent: Element,
  textNode: Text,
): string[] | undefined {
  return collectSiblingsText(parent, textNode);
}

function collectSiblingsText(
  parent: Element,
  self: Node,
): string[] | undefined {
  const out: string[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child === self) continue;
    const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    out.push(t.slice(0, 200));
    if (out.length >= 8) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Preserve the leading/trailing whitespace of `original` when emitting a
 * replacement text node containing the trimmed `newText`. Without this, the
 * DOM loses the space that separated this text node from a sibling element.
 */
function preserveWhitespace(original: string, newText: string): string {
  const leadingMatch = /^\s*/.exec(original);
  const trailingMatch = /\s*$/.exec(original);
  const lead = leadingMatch ? leadingMatch[0] : "";
  const trail = trailingMatch ? trailingMatch[0] : "";
  return `${lead}${newText}${trail}`;
}
