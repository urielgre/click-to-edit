# click-to-edit

> Click any text in your Next.js app, edit it inline, save to source.

**Status:** v0.1 alpha — under active development

A lightweight Next.js dev-mode overlay that lets you (or your non-developer collaborators) edit text directly in the browser. Built for the Claude Code / Cursor / Lovable era: when you want to tweak copy on your site without context-switching back to your AI agent.

This is the monorepo. **For install instructions, usage, FAQ, and limitations, see [`packages/core/README.md`](./packages/core/README.md)** — that's the README that ships to npm and the one you want if you're trying to use the package.

## Repository layout

This is a pnpm workspace.

```
.
├── packages/
│   ├── core/      # The published package (npm name: click-to-edit)
│   └── example/   # Local dogfood app — not published
├── pnpm-workspace.yaml
└── package.json
```

- **`packages/core`** — the actual `click-to-edit` npm package. Contains the client provider, the server-side edit handler, the shared types, and the build setup. This is what users install.
- **`packages/example`** — a Next.js App Router app that consumes the workspace version of `click-to-edit`. We use it to dogfood the overlay end-to-end while developing. Not published.

## Development

You'll need [pnpm](https://pnpm.io) (v11+) and Node 20+.

```bash
# 1. Clone
git clone https://github.com/urielgre/click-to-edit.git
cd click-to-edit

# 2. Install (sets up the workspace, links packages/core into packages/example)
pnpm install

# 3. Build the core package once so the example can resolve it
pnpm --filter click-to-edit build

# 4. Run the example app
pnpm dev:example
# → http://localhost:3005
```

Useful scripts from the repo root:

| Command                          | What it does                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| `pnpm build`                     | Build every workspace package                                 |
| `pnpm test`                      | Run tests in every workspace package                          |
| `pnpm dev:core`                  | Build `packages/core` in watch mode                           |
| `pnpm dev:example`               | Start the example Next.js app on port 3005                    |
| `pnpm --filter example typecheck`| Type-check the example app against the current `core` build   |

When iterating on the core package, run `pnpm dev:core` in one terminal and `pnpm dev:example` in another — the example picks up rebuilds automatically.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
