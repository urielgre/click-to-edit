# Contributing to click-to-edit

Thanks for your interest. This is an early-stage project with a single maintainer, so the bar for "good contribution" is low: a clear bug report or a small focused PR is plenty.

## Quick start

You'll need [pnpm](https://pnpm.io) (v11+) and Node 20+.

```bash
git clone https://github.com/urielgre/click-to-edit.git
cd click-to-edit
pnpm install
pnpm --filter click-to-edit build
pnpm dev:example
# → http://localhost:3005
```

Run `pnpm dev:core` in a second terminal to rebuild the package on change while you work.

## Where the code lives

- **`packages/core/src/client/`** — the React provider and overlay.
- **`packages/core/src/server/`** — the dev route handler that parses and rewrites source files.
- **`packages/core/src/shared/types.ts`** — the wire contract between client and server. Treat this as public API; changes are breaking.
- **`packages/example/`** — the Next.js demo app used to dogfood changes end-to-end.

## Tests

Tests run with [Vitest](https://vitest.dev).

```bash
pnpm --filter click-to-edit test         # run once
pnpm --filter click-to-edit test:watch   # watch mode
```

When fixing a bug, add a failing test first that captures it, then make it pass. When adding a feature, add at least one test per `EditErrorCode` branch you touch (see `packages/core/src/shared/types.ts`).

## Code style

- TypeScript, ES modules, `"use client"` only where actually needed.
- Prefer small, focused functions. Keep the public surface (anything exported from `packages/core/src/index.ts` or `server.ts`) minimal.
- Don't add dependencies casually — every dep ships to users.
- No emoji in source or docs.

## Filing issues

Please include:

- Your Next.js version, React version, and Node version.
- App Router vs Pages Router (Pages Router is unsupported in v0.1).
- A minimal repro if you can — even a snippet of the JSX that misbehaved helps.

## Filing PRs

Keep PRs scoped to one thing. If you're not sure whether a change is welcome, open an issue first to discuss. Make sure `pnpm build`, `pnpm test`, and `pnpm --filter example typecheck` all pass locally before pushing.
