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

  it("matches DOM-collapsed oldText against multi-line JSXText source", () => {
    // Source: text broken across two lines with leading indentation.
    // The DOM-rendered version collapses the newline+indent into a single
    // space, so client sends a single-line oldText. Must still match.
    const src = [
      "export default function P() {",
      "  return (",
      "    <p>",
      "      Stop scrolling through subreddits. RedditPulse surfaces the best conversations",
      "      to join each day, with AI-suggested replies that actually fit in.",
      "    </p>",
      "  );",
      "}",
      "",
    ].join("\n");

    const col = src.split("\n")[2]!.indexOf("<p>");
    const collapsedOld =
      "Stop scrolling through subreddits. RedditPulse surfaces the best conversations to join each day, with AI-suggested replies that actually fit in.";
    const newText =
      "RedditPulse surfaces the best Reddit conversations for your product.";

    const out = rewriteJsxText(src, 3, col, collapsedOld, newText);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain(newText);
      expect(out.source).not.toContain("Stop scrolling");
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
  it("refuses {variable} when the variable is a prop", () => {
    const src = [
      `export default function P({ name }: { name: string }) {`,
      `  return <h1>{name}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "name", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // Either "not_editable" (couldn't trace) or "mismatch" (traced but no
      // literal in this file). Both are valid refusals.
      expect(["not_editable", "mismatch"]).toContain(out.error);
    }
  });

  it("refuses {t('key')} — the i18n key argument is NOT a marketing literal", () => {
    const src = [
      `export default function P() {`,
      `  return <h1>{t('key')}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "key", "World");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // 'key' appears as a CallExpression argument (an i18n key) — the
      // marketing-position filter rejects it. Refusal can manifest as
      // either not_editable or mismatch.
      expect(["not_editable", "mismatch"]).toContain(out.error);
    }
  });

  it("refuses a template literal interpolation", () => {
    const src = [
      "export default function P({ name }: { name: string }) {",
      "  return <h1>{`hi ${name}`}</h1>;",
      "}",
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "hi", "hello");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // Template literal parts are TemplateElements, not StringLiterals,
      // so the file-scoped fallback can't find them. Refusal valid.
      expect(["not_editable", "mismatch"]).toContain(out.error);
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

describe("rewriteJsxText — follow-variable", () => {
  it("Case 1: follows {identifier} to a `const X = 'literal'`", () => {
    const src = [
      `const title = "Hello";`,
      `export default function P() {`,
      `  return <h1>{title}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 3, col, "Hello", "Welcome");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('const title = "Welcome";');
      expect(out.source).not.toContain('"Hello"');
    }
  });

  it("Case 2: follows {obj.prop} to a `const obj = { prop: 'literal' }`", () => {
    const src = [
      `const config = { title: "Hello", subtitle: "world" };`,
      `export default function P() {`,
      `  return <h1>{config.title}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 3, col, "Hello", "Welcome");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('title: "Welcome"');
      expect(out.source).toContain('subtitle: "world"');
    }
  });

  it("Case 3: follows {p.prop} inside arr.map over const array of objects", () => {
    const src = [
      `const plans = [`,
      `  { name: "Free",  description: "Get started." },`,
      `  { name: "Pro",   description: "For serious founders." },`,
      `];`,
      `export default function P() {`,
      `  return plans.map((plan) => <h3>{plan.name}</h3>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[5]!.indexOf("<h3>");
    const out = rewriteJsxText(src, 6, col, "Pro", "Premium");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('{ name: "Premium",');
      expect(out.source).toContain('{ name: "Free",'); // Free unchanged
    }
  });

  it("Case 4: follows {item} inside arr.map over const string array", () => {
    const src = [
      `const features = ["Fast", "Reliable", "Cheap"];`,
      `export default function P() {`,
      `  return features.map((f) => <li>{f}</li>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<li>");
    const out = rewriteJsxText(src, 3, col, "Reliable", "Trusted");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Trusted"');
      expect(out.source).toContain('"Fast"'); // unchanged
      expect(out.source).toContain('"Cheap"'); // unchanged
    }
  });

  it("refuses with friendly error when variable can't be traced (e.g. function param from props)", () => {
    const src = [
      `export default function Greeting({ user }) {`,
      `  return <h1>{user.name}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Alice", "Bob");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // Could be `not_editable` (couldn't trace) or `mismatch` (traced but
      // not to a literal). Either way, NOT a successful edit.
      expect(["not_editable", "mismatch"]).toContain(out.error);
    }
  });

  it("file-scoped fallback: follows {x.field} through .find() (not just .map)", () => {
    const src = [
      `const testimonials = [`,
      `  { role: "D2C Skincare Founder", author: "Sarah" },`,
      `  { role: "B2B Marketer", author: "Marcus" },`,
      `];`,
      `export default function P() {`,
      `  const featured = testimonials.find((t) => t.author === "Sarah");`,
      `  return <p>{featured.role}</p>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[6]!.indexOf("<p>");
    const out = rewriteJsxText(
      src,
      7,
      col,
      "D2C Skincare Founder",
      "Founder",
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Founder"');
      expect(out.source).toContain('"B2B Marketer"'); // unchanged
    }
  });

  it("inline-array-mapped: {opp.title} where the array is inline in JSX (not a const)", () => {
    // This is the hero.tsx pattern that fails in real usage:
    //   {[{ title: '...' }, ...].map(opp => <p>{opp.title}</p>)}
    const src = [
      `export default function P() {`,
      `  return (`,
      `    <div>`,
      `      {[`,
      `        { score: 92, title: 'Looking for a tool to find Reddit customers...' },`,
      `        { score: 87, title: 'How do you guys market on Reddit without getting...' },`,
      `      ].map((opp, i) => (`,
      `        <p key={i}>{opp.title}</p>`,
      `      ))}`,
      `    </div>`,
      `  );`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[7]!.indexOf("<p");
    const out = rewriteJsxText(
      src,
      8,
      col,
      "Looking for a tool to find Reddit customers...",
      "PROBE",
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain("'PROBE'");
      expect(out.source).toContain("'How do you guys market on Reddit without getting...'"); // unchanged
    }
  });

  it("file-scoped fallback: follows {x.field} through .filter().map() chain", () => {
    const src = [
      `const items = [`,
      `  { label: "Hidden", visible: false },`,
      `  { label: "Show Me", visible: true },`,
      `];`,
      `export default function P() {`,
      `  return items.filter(i => i.visible).map((it) => <span>{it.label}</span>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[5]!.indexOf("<span>");
    const out = rewriteJsxText(src, 6, col, "Show Me", "Visible Item");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Visible Item"');
      expect(out.source).toContain('"Hidden"'); // unchanged
    }
  });

  // ---- diverse patterns from real-world Next.js apps ----

  it("default-exported function component is walked (not skipped by export)", () => {
    const src = [
      `export default function Page() {`,
      `  return <h1>Marketing Headline</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Marketing Headline", "New");
    expect(out.ok).toBe(true);
  });

  it("named arrow component export with same-file const", () => {
    const src = [
      `const heading = "Hello world";`,
      `export const Page = () => <h1>{heading}</h1>;`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Hello world", "Hi friend");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Hi friend"');
    }
  });

  it("const defined inside the component body (not module-scoped)", () => {
    const src = [
      `export default function Page() {`,
      `  const headline = "Block-scoped";`,
      `  return <h1>{headline}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 3, col, "Block-scoped", "Fixed");
    // We currently only collect top-level consts. Block-scoped const may
    // not be resolved structurally, but the file-scoped fallback should
    // find it since the literal exists in source.
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Fixed"');
    }
  });

  it("conditional rendering: {condition && <div>Marketing</div>}", () => {
    const src = [
      `export default function P({ show }: { show: boolean }) {`,
      `  return <div>{show && <h1>Marketing Text</h1>}</div>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Marketing Text", "Conditional");
    expect(out.ok).toBe(true);
  });

  it("spread element in array literal still finds the matching string", () => {
    const src = [
      `const base = [{ label: "First" }];`,
      `const all = [...base, { label: "Second" }];`,
      `export default function P() {`,
      `  return all.map((x) => <li>{x.label}</li>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[3]!.indexOf("<li>");
    const out = rewriteJsxText(src, 4, col, "Second", "Updated");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Updated"');
    }
  });

  it("arrow component with implicit return", () => {
    const src = [
      `const Title = () => <h1>Implicit Return</h1>;`,
      `export default Title;`,
    ].join("\n");
    const col = src.split("\n")[0]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 1, col, "Implicit Return", "Updated");
    expect(out.ok).toBe(true);
  });

  it("Fragment-wrapped content: <>{...}</>", () => {
    const src = [
      `export default function P() {`,
      `  return <><h1>Inside Fragment</h1><p>Body</p></>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Inside Fragment", "Updated");
    expect(out.ok).toBe(true);
  });

  it("imported data: correctly refuses (literal lives in another file)", () => {
    // Mimic: `import { plans } from './data'; ...{plan.name}...`. Since `plans`
    // is imported (no local const), our resolver shouldn't find it, and the
    // file-scoped fallback won't find the literal in THIS file.
    const src = [
      `import { plans } from "./data";`,
      `export default function P() {`,
      `  return plans.map((plan) => <h3>{plan.name}</h3>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<h3>");
    const out = rewriteJsxText(src, 3, col, "Pro", "Premium");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(["mismatch", "not_editable"]).toContain(out.error);
    }
  });

  it("children prop: <Button>Click me</Button> — child is JSXText, editable", () => {
    const src = [
      `function Button({ children }: { children: React.ReactNode }) {`,
      `  return <button>{children}</button>;`,
      `}`,
      `export default function P() {`,
      `  return <Button>Press here</Button>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[4]!.indexOf("<Button>");
    const out = rewriteJsxText(src, 5, col, "Press here", "Click me");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain("Click me");
    }
  });

  it("optional chaining {user?.name}: correctly refuses (dynamic)", () => {
    const src = [
      `export default function P({ user }: { user?: { name: string } }) {`,
      `  return <h1>{user?.name}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Alice", "Bob");
    expect(out.ok).toBe(false);
  });

  it("multiple const references: const A='x'; const B=A; <h1>{B}</h1>", () => {
    const src = [
      `const A = "Indirect";`,
      `const B = A;`,
      `export default function P() {`,
      `  return <h1>{B}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[3]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 4, col, "Indirect", "Direct");
    // B isn't directly a string literal; our resolver may not chase const A
    // -> B. But the file-scoped fallback should find the literal "Indirect"
    // in the const A declaration.
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Direct"');
    }
  });

  it("JSX text inside conditional ? : ternary", () => {
    const src = [
      `export default function P({ isPro }: { isPro: boolean }) {`,
      `  return <h1>{isPro ? "Pro Plan" : "Free Plan"}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[1]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 2, col, "Pro Plan", "Premium Plan");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Premium Plan"');
    }
  });

  it("default value with ||: const x = props.label || \"Default\"", () => {
    const src = [
      `export default function P({ label }: { label?: string }) {`,
      `  const text = label || "Default label";`,
      `  return <h1>{text}</h1>;`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[2]!.indexOf("<h1>");
    const out = rewriteJsxText(src, 3, col, "Default label", "Updated");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toContain('"Updated"');
    }
  });

  it("refuses with friendly error for ambiguous matches in followed array", () => {
    const src = [
      `const items = [`,
      `  { label: "Click me" },`,
      `  { label: "Click me" },`,
      `];`,
      `export default function P() {`,
      `  return items.map((it) => <button>{it.label}</button>);`,
      `}`,
    ].join("\n");
    const col = src.split("\n")[5]!.indexOf("<button>");
    const out = rewriteJsxText(src, 6, col, "Click me", "Press me");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("ambiguous");
    }
  });
});
