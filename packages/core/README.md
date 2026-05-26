# click-to-edit

> Click any text in your Next.js app, edit it inline, save to source.

## What it is

You built a site with Claude Code (or Cursor, or Lovable, or just your own hands). Now you're staring at a headline that should say "Get started in seconds" instead of "Get started fast" and you really, really don't want to write another prompt for it.

`click-to-edit` is a dev-mode overlay for Next.js App Router apps. Toggle edit mode, click any text on the page, type the new version, hit Enter. The change is written back to your `.tsx` source file. Save your AI prompts for the work that actually needs them.

## 30-second demo

<!-- gif coming once the overlay ships — capture from the example app -->
![demo](./docs/demo.gif)

## Status

**v0.1 alpha.** Expect rough edges and missing pieces. Specifically:

- **Dev-mode only.** The provider is a no-op in production builds and the route handler hard-refuses any request unless `NODE_ENV === "development"`.
- **App Router only.** Pages Router support is on the roadmap, not in v0.1.
- **Next.js only.** Vite / Remix support is on the roadmap.
- **Text edits only.** Style and structural edits come later.

## Install

```bash
npm install -D click-to-edit
# or
pnpm add -D click-to-edit
```

There are two pieces to wire up: the **provider** in your root layout, and a **route handler** that takes POSTed edits and writes them to disk.

> An `npx click-to-edit init` command is coming in v0.2. For now, copy-paste the two files below.

### 1. Wrap your root layout

```tsx
// app/layout.tsx
import { ClickToEditProvider } from "click-to-edit";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClickToEditProvider>{children}</ClickToEditProvider>
      </body>
    </html>
  );
}
```

### 2. Add the dev route handler

```ts
// app/api/__cte/edit/route.ts
import { createEditHandler } from "click-to-edit/server";

export const POST = createEditHandler();

// Optional: block other verbs so the route's behavior is unambiguous.
export const GET = () => new Response("Method Not Allowed", { status: 405 });
```

That's it. Run your dev server, open your app, press `Cmd/Ctrl+E`, and click something.

## Keyboard shortcuts

| Shortcut       | What it does                |
| -------------- | --------------------------- |
| `Cmd/Ctrl + E` | Toggle edit mode on / off   |
| `Esc`          | Cancel the current edit     |
| `Enter`        | Commit the current edit     |
| `Cmd/Ctrl + Z` | Undo the last committed edit |

## What can and can't be edited

`click-to-edit` only touches **literal text in JSX**. If a piece of text is computed at runtime — from a variable, a function call, a template literal, a translation key — it stays read-only. The overlay grays those nodes out so you can see what's editable at a glance.

```tsx
// EDITABLE — JSXText literals
<h1>Welcome to my app</h1>
<p>Click the headline above with edit mode on.</p>

// EDITABLE — StringLiteral inside a JSX expression container
<button aria-label="Close">{"Close"}</button>

// NOT EDITABLE — identifier
<h1>{title}</h1>

// NOT EDITABLE — function call (this is what i18n looks like)
<h1>{t("home.headline")}</h1>

// NOT EDITABLE — template literal
<p>{`Hello ${name}`}</p>

// NOT EDITABLE — conditional expression
<p>{count > 0 ? "first branch" : "second branch"}</p>
```

If two identical literals are siblings inside the same JSX element, the server refuses to guess which one you meant and returns an `ambiguous` error. Reword one of them and try again.

## Safety

This package writes to your source files. Some things to know:

- **Dev-only.** The route handler returns 404 in any environment other than `NODE_ENV=development`.
- **Path-restricted.** Edits are rejected if the resolved path escapes `process.cwd()` or lands in `node_modules`, `.git`, or `.next`.
- **Extension-restricted.** Only `.tsx`, `.jsx`, `.ts`, and `.js` files are eligible.
- **`oldText` match required.** The server only commits an edit if the literal currently in the file matches what the overlay sent. If the source has changed since the page loaded, the edit is rejected.
- **Atomic writes.** Files are written via a temp file + rename so a crash mid-write can't leave a half-broken source file.
- **Git is your backstop.** Treat this like any other code change. Commit before big editing sessions, and review the diff before pushing.

## Options

Pass an options object to either side. Both accept the same shape.

```tsx
<ClickToEditProvider
  options={{
    editRoute: "/api/__cte/edit",
    hotkey: "Mod+E",
    undoLimit: 50,
  }}
>
  {children}
</ClickToEditProvider>
```

```ts
export const POST = createEditHandler({
  editRoute: "/api/__cte/edit",
});
```

| Option       | Type     | Default              | Notes                                                                                            |
| ------------ | -------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `editRoute`  | `string` | `/api/__cte/edit`    | Route path the client POSTs to. Must match the actual route file location in your app.           |
| `hotkey`     | `string` | `Mod+E`              | Toggles edit mode. `Mod` is Cmd on macOS, Ctrl elsewhere. Tinykeys-style binding format.         |
| `undoLimit`  | `number` | `50`                 | Maximum number of edits in the in-memory undo stack. Set to `0` to disable undo entirely.        |

## FAQ

**Does this work in production?**
No. The provider renders children unchanged in production builds, and the route handler refuses any request unless `NODE_ENV === "development"`. Production-mode persistence (via a pluggable CMS layer) is on the v0.3+ roadmap, not in v0.1.

**Will this break my files?**
It shouldn't. The server only edits a node if the `oldText` you sent matches what's currently on disk, it parses the file with recast (so formatting and comments are preserved), and writes are atomic. Combine that with committing before big editing sessions and you have plenty of safety nets. That said, it's alpha software — please review diffs before pushing.

**What about i18n? My text comes from `t("...")` calls.**
Those nodes are non-editable by design. `click-to-edit` only touches JSX literals, so translated strings stay in your translation files where they belong. If you want to edit a specific string, edit the value in your locale JSON, not the JSX.

**Does it work with Pages Router?**
Not yet. App Router only in v0.1. Pages Router support is on the roadmap.

**Does it work with Turbopack?**
It should. The package relies on React's `_debugSource` fiber field, which `@babel/preset-react` sets in dev — Turbopack does the same. If you hit an issue, please file it with a minimal repro.

**How is this different from Tina / Onlook / Stagewise / Builder.io?**
Most visual editors are either (a) CMS-first — content lives in their database, you render it via their SDK — or (b) production-grade editing tools with a price tag. `click-to-edit` is neither. It edits your actual source files, in dev, and gets out of your way. Think of it as "Inspect Element, but it saves." If you outgrow it and need a real CMS, you'll know.

## Limitations

`click-to-edit` is bounded on purpose. Here's what it does and doesn't handle, with examples — so you know what to expect before you install it.

### What's reliably editable

| Pattern | Example | Status |
|---|---|---|
| Plain JSX text | `<h1>Welcome</h1>` | ✅ Always |
| Multi-line JSX text | text wrapped across two source lines with indentation | ✅ Whitespace-normalized |
| Mixed-content text nodes | `<h1>foo <span>bar</span></h1>` — click "foo" to edit just that text node | ✅ Text-node mode |
| Marketing data in arrays | `const plans = [{name: 'Free', desc: '...'}]; plans.map(p => <h3>{p.name}</h3>)` | ✅ Via follow-variable |
| Inline array `.map()` | `{[{title: '...'}, ...].map(o => <p>{o.title}</p>)}` | ✅ Via file-scoped fallback |
| `.find()` / `.filter()` / `.filter().map()` chains | `const featured = items.find(i => i.flag); <p>{featured.role}</p>` | ✅ Via file-scoped fallback |
| Indirect const chains | `const A = 'x'; const B = A; <h1>{B}</h1>` | ✅ Via file-scoped fallback |
| Ternary literal branches | `<h1>{isPro ? 'Pro' : 'Free'}</h1>` | ✅ Position whitelist |
| `\|\|` / `??` defaults | `const x = props.label \|\| 'Default'` | ✅ Position whitelist |
| Block-scoped consts inside components | `function Page() { const x = "..."; return <h1>{x}</h1> }` | ✅ Via fallback |

### What correctly refuses (with friendly error)

| Pattern | Why we refuse |
|---|---|
| `<h1>{user.name}</h1>` where `user` is a prop | Text isn't in source — it's whoever passed the prop in. |
| `<p>{post.title}</p>` from a `fetch()` / database / API | Same — text lives in the data source. Edit it there. |
| `<h1>{t('home.title')}</h1>` (i18n call) | Displayed text is the translation, which lives in your locales file. |
| Cross-file imports: `import { plans } from './data'` | We only search the same file. Move the data into the file, or edit the imported file directly. |
| Same exact text in 2+ places in the same file | We refuse with `ambiguous`. Edit a unique nearby string first, then come back. |
| Template literal interpolations (`` `hi ${name}` ``) | Can't safely splice parts of a runtime-built string. |
| Computed property access (`obj[key]`, `arr[0]`) | We don't statically evaluate. Use a stable const for now. |
| Anything inside `className`, `href`, `key`, `style`, `aria-*` | Excluded — these aren't display content. |
| Anything inside `t()`, `console.log()`, function call args | Excluded — likely an i18n key or debug string, not display content. |

### Other boundaries

- **App Router only.** Pages Router (`pages/`) support is on the roadmap.
- **Dev-mode only.** The provider is a no-op in production builds; the route handler hard-refuses any non-`NODE_ENV=development` request. There is no production click-to-edit (yet).
- **One file at a time.** Each edit modifies exactly one `.tsx`/`.jsx`/`.ts`/`.js` file. No multi-file refactors.
- **No collaborative editing.** One user, one machine.
- **No style edits in v0.1.** You still go to code for `className`, padding, color, font. (Phase 2.)
- **No structural edits.** You can change text; you can't reorder elements, add new ones, or delete elements via the overlay. (Phase 2.)
- **Empty text allowed but ambiguous.** Saving an empty edit leaves an empty JSXText in source; if you didn't mean to clear it, use Cmd/Ctrl+Z or `git checkout`.
- **`fragment` roots not editable directly.** A component whose JSX root is `<>...</>` has no opening element to stamp with `data-cte-loc`. Wrap the root in a real element (`<div>...</div>`) if you need editability there.

### When in doubt

If a piece of text refuses with no clear reason and you believe it's marketing copy, paste the exact text + the file path into a GitHub issue. The architecture is bounded but uniform — anything broken in your app is likely broken in others, and the fix is general.

## Roadmap

Rough order, no dates:

- `v0.2` — Pages Router support, `next.config` auto-patching during `init`, selection-toolbar (highlight text → toolbar with options).
- `v0.3` — Style edits via the selection toolbar (bold/italic/underline + color/font/size by Tailwind class swap).
- `v0.4` — Structural edits (move/reorder elements).
- `v0.5` — Vite / Remix adapters.
- `v0.6+` — Production-mode persistence via a pluggable CMS layer.

## Contributing

See [CONTRIBUTING.md](https://github.com/urielgre/click-to-edit/blob/main/CONTRIBUTING.md). Issues and PRs welcome.

## License

MIT
