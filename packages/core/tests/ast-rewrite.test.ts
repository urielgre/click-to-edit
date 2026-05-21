import { describe, expect, it } from "vitest";
import { rewriteJsxText } from "../src/server/ast-rewrite.js";

/**
 * The JSXElement we want to target lives at line/column reported by
 * babel — line is 1-indexed, column 0-indexed. To keep tests stable
 * without manually computing offsets we wrap snippets in known shapes
 * and use line 1 / column 0 (or whatever the first `<` falls on).
 */

describe("rewriteJsxText — JSXText", () => {
  it("replaces a simple JSXText child", () => {
    const src = `export default function P() { return <h1>Hello</h1>; }`;
    // Find the column of `<h1>`.
    const col = src.indexOf("<h1>");
    const out = rewriteJsxText(src, 1, col, "Hello", "World");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain("<h1>World</h1>");
      expect(out.source).not.toContain("Hello");
    }
  });

  it("preserves surrounding whitespace in multi-line JSXText", () => {
    const src = [
      "export default function P() {",
      "  return (",
      "    <h1>",
      "      Welcome",
      "    </h1>",
      "  );",
      "}",
      "",
    ].join("\n");

    // <h1> starts on line 3, column 4 (0-indexed).
    const out = rewriteJsxText(src, 3, 4, "Welcome", "Hello there");
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Whitespace before & after the text should be preserved verbatim.
      expect(out.source).toContain("    <h1>\n      Hello there\n    </h1>");
    }
  });
});

describe("rewriteJsxText — StringLiteral inside expression container", () => {
  it("replaces {\"Hello\"} with {\"World\"}", () => {
    const src = `export default function P() { return <h1>{"Hello"}</h1>; }`;
    const col = src.indexOf("<h1>");
    const out = rewriteJsxText(src, 1, col, "Hello", "World");
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Either `"World"` or `'World'` are acceptable depending on recast quoting.
      expect(out.source).toMatch(/<h1>\{["']World["']\}<\/h1>/);
      expect(out.source).not.toContain("Hello");
    }
  });
});

describe("rewriteJsxText — non-editable expressions", () => {
  it("refuses {variable} with not_editable", () => {
    const src = [
      `export default function P({ name }: { name: string }) {`,
      `  return <h1>{name}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "name", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("not_editable");
    }
  });

  it("refuses {t('key')} (call expression) with not_editable", () => {
    const src = [
      `export default function P() {`,
      `  return <h1>{t('key')}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "key", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("not_editable");
    }
  });

  it("refuses a template literal with not_editable", () => {
    const src = [
      "export default function P({ name }: { name: string }) {",
      "  return <h1>{`hi ${name}`}</h1>;",
      "}",
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "hi", "hello");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("not_editable");
    }
  });
});

describe("rewriteJsxText — error cases", () => {
  it("returns mismatch when oldText doesn't match", () => {
    const src = `export default function P() { return <h1>Hello</h1>; }`;
    const col = src.indexOf("<h1>");
    const out = rewriteJsxText(src, 1, col, "Goodbye", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("mismatch");
    }
  });

  it("returns ambiguous when two siblings match", () => {
    const src = [
      `export default function P() {`,
      `  return <div><p>same</p><p>same</p></div>;`,
      `}`,
    ].join("\n");
    // Target the outer <div> so both <p>same</p> become children of the
    // element we're editing — but the matchable JSXText is _inside_ the <p>,
    // not the <div>. So instead, target nothing-matches at the <div> level
    // and instead construct ambiguity by putting two plain texts in one
    // element. JSX only allows one text node between siblings without an
    // intervening tag, so we use {"same"} containers.
    void src;
    const src2 = [
      `export default function P() {`,
      `  return <h1>{"same"}{" "}{"same"}</h1>;`,
      `}`,
    ].join("\n");
    const col = src2.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src2, 2, col, "same", "other");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("ambiguous");
    }
  });

  it("returns element_not_found when no JSXElement at line:col", () => {
    const src = `export default function P() { return <h1>Hello</h1>; }`;
    const out = rewriteJsxText(src, 99, 0, "Hello", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("element_not_found");
    }
  });
});
