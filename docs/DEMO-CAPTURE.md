# Demo GIF capture script

Goal: a 12–18 second silent GIF/MP4 that lands the "Inspect Element but it saves" pitch instantly. This is the single most important visual asset for the launch — it has to be polished.

## Tools

- **macOS:** built-in Screen Recording (Cmd+Shift+5), then convert MP4 → GIF with [Gifski](https://gif.ski/) or [ezgif.com](https://ezgif.com/video-to-gif)
- **Windows:** [ScreenToGif](https://www.screentogif.com/) (free, native), records straight to GIF
- **Either:** [Cleanshot](https://cleanshot.com/) if you have it — best quality

Target output: 800–1000 px wide, 10–15 fps, <2 MB (HN/Reddit auto-play limit is generous but smaller is faster).

## Pre-capture checklist

1. Use **RedditPulse** as the demo target. Run `npm run dev` on port 3004. Wait for it to be fully loaded.
2. Hide your browser bookmarks bar and any clutter. Use a clean profile if possible.
3. Pick a **side-by-side** layout: browser left (~60% width), VS Code right (~40%) showing `hero.tsx` opened to the headline.
4. Make sure the cursor is **visible** in your recording (system pref → make pointer larger if needed).
5. Open `git status` in a small terminal at the bottom (~20% height) so the diff lands visually.

## Capture sequence (12–15 seconds total)

Aim for one clean take. Practice once before recording.

1. **(0:00)** Start on RedditPulse landing page, hero headline visible: "Your next customers are on Reddit."
2. **(0:01)** Press **Cmd/Ctrl+E**. Bottom-right "click-to-edit ON" pill appears (green dot).
3. **(0:03)** Hover the headline → blue outline appears.
4. **(0:04)** Click → headline becomes editable, cursor inside.
5. **(0:05)** Type a change: drop a word or swap "customers" → "buyers" (small visible change; readers will see it land).
6. **(0:08)** Press **Enter**. Green flash on the headline. "Saved" toast bottom-right.
7. **(0:10)** Pan/cut to VS Code (or just point the cursor) — the `hero.tsx` file content has updated on disk; the new text is visible in the source.
8. **(0:12)** Pan to terminal — `git diff` shows the change as a clean +/- line.
9. **(0:13–14)** Hold for a beat on the diff so viewers register it.
10. **(0:14)** End.

Optional: a "click Undo" beat at 0:11 to show the undo button working (delays the ending by ~2 seconds — keep only if total stays under 18s).

## What this communicates

| Beat | Message |
|---|---|
| Hover → blue outline | "It knows where everything came from" |
| Click → editable in-place | "No popup, no modal, no context switch" |
| Type → enter → green flash | "Instant. No round-trip." |
| `git diff` shows the change | "Wrote real source. Permanent. Reviewable." |

That's the whole pitch in 15 seconds.

## After capture

1. Save the file as `docs/demo.gif` in the repo (path matches the README's `![demo](./docs/demo.gif)` link).
2. Commit: `git add docs/demo.gif && git commit -m "docs: add launch demo gif"`
3. Push.
4. The README on GitHub will now show the GIF inline at the top — that's the asset that does the heavy lifting on HN/Reddit/Twitter.

If the file is too large for git (>5 MB), upload it elsewhere (imgur, gfycat, Vercel Blob) and update the README link.

## Notes from launch research

- HN bounces in ~5 seconds without visual proof — the GIF is non-negotiable.
- Twitter native GIF/MP4 plays inline; an external link cuts engagement ~50%.
- Reddit auto-collapses long posts — front-load the GIF.
