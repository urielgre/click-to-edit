/**
 * Demo page intentionally containing a variety of JSX patterns so we can
 * verify what is/isn't editable by the overlay.
 *
 * NOTE: this is a Server Component (no "use client" directive). The overlay
 * uses its text-search fallback to map clicks back to source. Yellow outlines
 * indicate "search mode"; blue outlines (on Client Components) indicate
 * "exact mode" via fiber source.
 *
 * Editable (JSXText / StringLiteral literals):
 *   - The h1 text, the p text inside .hero, the link label.
 *
 * Non-editable (the overlay should gray these out):
 *   - {dynamicTitle}    → identifier
 *   - {t("home.cta")}    → function call
 *   - {`Hello ${name}`}  → template literal
 *   - {count > 0 ? "..." : "..."} → conditional expression
 *
 * Ambiguous (two identical literal siblings — server must refuse to guess):
 *   - The two "same text" paragraphs at the bottom.
 */

const dynamicTitle = "This is dynamic";
const name = "world";
const count = 1;
const t = (_key: string) => "translated string";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
        Welcome to click-to-edit
      </h1>

      <section
        className="hero"
        style={{ marginBottom: "3rem" }}
      >
        <p style={{ fontSize: "1.125rem", lineHeight: 1.6, color: "#444" }}>
          Click the headline above with edit mode on. This paragraph is also
          editable. Press Cmd/Ctrl+E to toggle edit mode.
        </p>
        <a
          href="https://github.com"
          style={{ color: "#0070f3", textDecoration: "none" }}
        >
          Read the docs
        </a>
      </section>

      <section style={{ marginBottom: "3rem" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          Non-editable patterns
        </h2>
        <p>Identifier (not editable): {dynamicTitle}</p>
        <p>Function call / i18n (not editable): {t("home.cta")}</p>
        <p>Template literal (not editable): {`Hello ${name}`}</p>
        <p>
          Conditional (not editable):{" "}
          {count > 0 ? "first branch" : "second branch"}
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          Ambiguity test
        </h2>
        <p>same text</p>
        <p>same text</p>
        <p style={{ color: "#888", fontSize: "0.875rem" }}>
          The two paragraphs above contain identical text. The server should
          refuse to guess which one to edit.
        </p>
      </section>
    </main>
  );
}
