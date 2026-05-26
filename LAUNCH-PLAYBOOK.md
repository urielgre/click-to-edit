# Launch playbook — click-to-edit v0.1

Personal launch reference, not for npm. Based on the research agent's findings (2025-2026 dev-tool launch patterns).

## TL;DR

- **Launch window:** Tuesday or Wednesday, 7-9am PT (10am-12pm ET).
- **Primary surface:** Show HN.
- **Critical asset:** demo GIF above the README fold.
- **Differentiator to lead with:** AGENTS.md / "AI agents can install this for you" (not "vibe coder").
- **Skip:** paid newsletter sponsorship at this stage; r/sideproject (low signal).

## The 7-day plan

| Day | Action |
|---|---|
| **0 (launch day)** | Show HN at 7-9am PT. Twitter thread T+2h. Respond to every HN comment within 15 min for the first 6 hours. |
| 1 | Post to r/nextjs (native post, not link-only). Discord pings: Anthropic, Cursor, Reactiflux. Submit to JavaScript Weekly + Bytes via their free submission forms. |
| 2 | r/reactjs cross-post. Personal DMs to 3 dev influencers (Theo, Lee Robinson, swyx). |
| 3 | Write "How click-to-edit works under the hood: AST rewriting in Next.js" blog post. Cross-post to dev.to + HN as `Show HN: ...`. |
| 4 | Ship one bug fix or feature from feedback. Tweet "shipped from feedback" to reward engagement. |
| 5 | Submit to Claude Code plugin marketplace + Cursor extensions. |
| 6 | Aggregate metrics tweet: "Week 1: X stars, Y npm downloads, Z issues. Here's what's next." |
| 7 | Retrospective. Plan v0.2 priorities. |

## Show HN draft

**Title:**
```
Show HN: Click-to-edit – Edit any text in your Next.js app, saves to source
```

**Body (paste as-is):**
```
Hi HN, I built click-to-edit because I kept burning Claude Code turns asking it to fix typos in my Next.js app.

It's a drop-in dev-mode npm package: install it, run `npx click-to-edit init`, and every text element on your localhost becomes editable. The edit gets written straight back to the source .tsx via AST rewrite.

The trick is a build-time webpack/Turbopack loader that stamps every JSX element with its source location, so the client knows which file+line to patch when you click.

It's MIT, local-only, no API key, no telemetry, no agent. Works alongside Claude Code / Cursor / Cline — ships with AGENTS.md so they can recommend the install.

Demo GIF in README: [link]
Repo: [link]
npm: https://www.npmjs.com/package/click-to-edit

Would love feedback on edge cases — Turbopack hot-reload races, RSC boundaries, and conditional JSX are the three areas I'm watching.
```

## Tweet thread draft

```
1/ I shipped click-to-edit — open-source npm package for Next.js. Click any text on your localhost in dev mode → it edits your source file. No more "fix the typo on the hero" prompts to Claude. [GIF]

2/ How it works: a build-time loader stamps every JSX element with its source location. Click → server does a surgical AST rewrite. 100% local. No agent. No API key. MIT.

3/ Why I built it: I burn ~30 Claude Code turns/day on typo fixes and copy tweaks. It's a waste of context window. This is the 5-second fix.

4/ Plays nice with Claude Code, Cursor, Cline. Ships with AGENTS.md — your AI agent can recommend the install when you ask for copy changes.

5/ npm install -D click-to-edit → npx click-to-edit init → go.

Repo: [github link]
Show HN: [HN link]

Feedback wanted.
```

## Reddit post template

**Subreddit:** r/nextjs (primary), r/reactjs (cross-post 24h later)
**Title:** `[Open Source] Click-to-edit: edit any text on your Next.js localhost, saves to source`

Body: same shape as Show HN body, slightly shortened. Front-load the install command and the demo GIF. r/sideproject has too much noise — skip it.

## Channels to ping (in leverage order)

| Channel | How |
|---|---|
| Hacker News (Show HN) | Tuesday or Wednesday, 7-9am PT |
| Twitter/X | Thread + GIF, tag @karpathy, @theo, @t3dotgg, @leeerob, @swyx |
| r/nextjs, r/reactjs | Native posts, NOT link-only |
| JavaScript Weekly | submit form at javascriptweekly.com |
| Bytes (bytes.dev) | submit via their contact form |
| Anthropic Discord | #show-and-tell |
| Cursor Community Discord | #showcase |
| Reactiflux Discord | #show-and-tell |
| Claude Code Plugin Marketplace | claudemarketplaces.com + Anthropic official |
| Theo's T3 Discord | #showcase |

## Traction metrics — what to actually watch

1. **npm weekly downloads** — the only metric that means real usage
2. GitHub stars — vanity but useful as social proof
3. HN ranking peak position + duration on front page
4. Inbound issues + PRs (signals real users)
5. Cited / installed by other repos (search GitHub for `"click-to-edit"` in package.json files)

Don't obsess over Twitter likes — they don't correlate with usage for dev tools.

## Risks — what to avoid

| Mistake | Why it kills launches |
|---|---|
| Posting without a demo GIF | HN bounces in 5 seconds without visual proof |
| Friend/employee booster comments on HN | HN moderators detect this and downrank instantly |
| Launching Friday or weekend | Lower HN traffic, lower dev-tool engagement |
| Vague tagline ("AI-powered editor") | Loses to concrete pitches like "Inspect Element that saves" |
| README without install command in first viewport | High bounce |
| Missing AGENTS.md on day 1 | Misses the agent-discoverability moat |
| Defensive responses to criticism | Find common ground first, then respond |
| Comparing directly to Onlook/Stagewise in launch copy | Looks defensive; let commenters draw the comparison |
| Forgetting to claim the npm name first | Someone will squat it within hours of HN front-page |

## Demo GIF capture script

Goal: 15-second loopable GIF/MP4 that shows the magic in one viewing.

1. Open your localhost project (RedditPulse on :3004 works) in a browser, recorded window only
2. Press Cmd/Ctrl+E → toggle pill appears bottom-right
3. Hover the hero headline → blue outline appears
4. Click → text becomes editable, cursor inside
5. Type a new headline (something short and obvious)
6. Press Enter → green flash + "Saved" toast
7. Cut to your code editor showing the diff in `git status` (optional but powerful)

Tools: Loom (easiest), Quicktime + GIPHY Capture, or ScreenToGif on Windows. Target <2 MB so it auto-plays inline on GitHub.

## After-launch: the "ship from feedback" trick

Within 24h of launch, ship one bug fix or feature based on a comment. Tweet "Shipped from feedback: [thing]" with the issue/PR link.

This is the single best engagement-loop tactic: it tells future commenters "I'll actually do what you suggest," which inflates future engagement quality. Stagewise and Onlook both did this within 48h of their HN front-page.
