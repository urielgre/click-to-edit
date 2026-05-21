import { describe, it, expect } from "vitest";
import { wrapLayoutWithProvider } from "../src/cli/codemod-layout.js";

describe("wrapLayoutWithProvider", () => {
  it("wraps {children} and adds the import on a vanilla layout", () => {
    const source = `import * as React from "react";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("wrapped");
    if (result.kind !== "wrapped") return;
    expect(result.source).toContain(
      'import { ClickToEditProvider } from "click-to-edit";',
    );
    expect(result.source).toContain(
      "<ClickToEditProvider>{children}</ClickToEditProvider>",
    );
  });

  it("returns already-wrapped if <ClickToEditProvider> already surrounds children", () => {
    const source = `import { ClickToEditProvider } from "click-to-edit";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <ClickToEditProvider>{children}</ClickToEditProvider>
      </body>
    </html>
  );
}
`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("already-wrapped");
  });

  it("does not duplicate the import if it is already present", () => {
    // Imported but not yet wrapping — should add the wrap, not a second import.
    const source = `import { ClickToEditProvider } from "click-to-edit";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("wrapped");
    if (result.kind !== "wrapped") return;
    const importMatches = result.source.match(
      /from "click-to-edit"/g,
    );
    expect(importMatches?.length).toBe(1);
    expect(result.source).toContain(
      "<ClickToEditProvider>{children}</ClickToEditProvider>",
    );
  });

  it("places the new import after existing imports", () => {
    const source = `import * as React from "react";
import { Inter } from "next/font/google";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("wrapped");
    if (result.kind !== "wrapped") return;
    const importIdx = result.source.indexOf(
      'import { ClickToEditProvider } from "click-to-edit";',
    );
    const fontImportIdx = result.source.indexOf(
      'import { Inter } from "next/font/google";',
    );
    expect(importIdx).toBeGreaterThan(fontImportIdx);
  });

  it("returns error when {children} cannot be found", () => {
    const source = `export default function RootLayout() {
  return <html><body>no children here</body></html>;
}
`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("error");
  });

  it("returns error on unparseable source", () => {
    const source = `this is not valid TypeScript {{{`;
    const result = wrapLayoutWithProvider(source);
    expect(result.kind).toBe("error");
  });
});
