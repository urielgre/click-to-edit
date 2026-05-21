import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEnv, validatePath } from "../src/server/guards.js";

describe("validateEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when NODE_ENV=development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(validateEnv()).toBe(true);
  });

  it("returns false when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateEnv()).toBe(false);
  });

  it("returns false when NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(validateEnv()).toBe(false);
  });
});

describe("validatePath", () => {
  it("accepts a relative path inside cwd ending in .tsx", () => {
    const result = validatePath("app/page.tsx");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolute).toBe(path.resolve(process.cwd(), "app/page.tsx"));
    }
  });

  it("rejects ../outside/file.tsx with not_in_project", () => {
    const result = validatePath("../outside/file.tsx");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_in_project");
    }
  });

  it("rejects node_modules paths with not_in_project", () => {
    const result = validatePath("node_modules/foo/bar.tsx");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_in_project");
    }
  });

  it("rejects .next paths with not_in_project", () => {
    const result = validatePath(".next/static/foo.tsx");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_in_project");
    }
  });

  it("rejects non-source extensions with invalid_extension", () => {
    const result = validatePath("app/page.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_extension");
    }
  });

  it("rejects an absolute path outside cwd with not_in_project", () => {
    // Pick a path guaranteed to be outside the project. On Windows we use the
    // root of a different drive; on POSIX we use /tmp/elsewhere/file.tsx.
    const outside =
      process.platform === "win32"
        ? "Z:\\elsewhere\\file.tsx"
        : "/tmp/elsewhere/file.tsx";
    const result = validatePath(outside);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_in_project");
    }
  });
});
