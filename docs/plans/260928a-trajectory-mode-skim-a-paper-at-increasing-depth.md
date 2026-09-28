# Trajectory mode — skim a paper at increasing depth

The vision, with Greg's dictated brief verbatim and the Questions for Greg, is
[trajectory.md](../project/trajectory.md). This is the build. Run unattended by an Overseer-started
session on 2026-09-28: Greg approved building it and said he cannot answer questions, so every
product call below is a default, recorded in trajectory.md § Questions for Greg.

## What v1 is

```
  TRAJECTORY — same spine, same article; the band walks a route through it

 ┌───────────┬────────────────────────────────────┬──────────────────────────────┐
 │ spine     │  ‹  Stop 2 of 5  ›     depth ●1 ○2 ○3 │  … and the effect held in    │
 │  ▇▇▇▇     │                        5 · 12 · 28    │  all four cohorts (Table 2), │
 │  ▇▇       │  1  Results › Main finding            │ ┃the first time it has been  │
 │  ▇▇▇▇▇▇   │     The headline result, first.       │ ┃shown outside the lab …     │
 │  ▇▇▇      │▶ 2  Results › Robustness              │                              │
 │  ▇▇▇▇     │     Why the result is not a fluke.    │  (the current stop's         │
 │           │  3  Methods › Design                  │   passage is marked and      │
 │           │     How they got it, in one para.     │   scrolled to)               │
 │           │  4  Introduction › The gap            │                              │
 │           │  5  Discussion › Limits               │                              │
 └───────────┴────────────────────────────────────┴──────────────────────────────┘
      ← / → step the stops while Trajectory is open;  ↑ / ↓ stay the article's
```

- **One model call over the piece, written once and stored** — a pipeline step `trajectory`,
  exactly the shape of `faq` and `ideas`: messages wire, the capable model, `high` effort, the `ids`
  renderer over the body evidence, so the request is byte-identical to Ideas'/FAQ's up to the cache
  breakpoint and joins that cache group (placed contiguously in `STEP_ORDER`,
  `tests/article-cache-group.test.ts`). Off `DEFAULT_INGEST_STEPS`, in `FORCE_ONLY_WHEN_NAMED`,
  started by opening the mode (`useAutoRun`, unforced verb). The user message carries the tree
  skeleton, as Ideas' does, so the model sees the sections.
- **Profiled**, the way Ideas is: `profileSection(profile)` from [`src/profile.ts`](../../src/profile.ts)
  (the reader's *About you* plus the article's *Why you're reading this one*), `PROFILE_RULES` in the
  system prompt, `profileHash` in the stamp so a changed profile marks it stale, and the existing
  *written for you* label. With no profile, the prompt's default reader is "reading this for the
  first time, wants the main point first".
- **What is stored — an ordering over passages, nothing else:**

  ```ts
  interface TrajectoryStop {
    id: string;              // mintUniqueId — block-id shaped so ?stop= validates like ?quote=
    first: BlockId;          // an inclusive, contiguous run of body blocks
    last: BlockId;           // same as first for a one-paragraph stop
    depth: 1 | 2 | 3;        // the shallowest pass this stop belongs to
    why: string;             // ≤ 120 chars: why stop here, now — never what the passage says
  }
  interface Trajectory { stops: TrajectoryStop[]; dropped: {...counts}; /* stamp fields as FAQ */ }
  ```

  **The array order is the route. Depth *d* shows every stop with `depth ≤ d`, in array order.**
  So the passes nest by construction (depth 2 contains depth 1, in the same relative order) and one
  list is the whole artefact — no three lists that could disagree.
- **Sizes, scaled to the piece.** From the body block count *n*: depth 1 aims at `min(5, ⌈n/8⌉)`
  stops, depth ≤ 2 at `min(12, ⌈n/4⌉)`, depth ≤ 3 at `min(30, ⌈n/2⌉)`. The prompt gets those
  numbers as targets; the validator enforces caps of 7 / 15 / 36. A stop is at most
  `MAX_SPAN = 4` blocks.
- **Validation, the FAQ/Citations way — the model's ids are never trusted:** both ids must be body
  evidence blocks, `first` at or before `last` by **index** (never by id string,
  [block-ids.md](../project/block-ids.md)), span ≤ `MAX_SPAN` (an overlong stop is dropped, not
  trimmed), a stop overlapping an earlier-kept stop is dropped, `why` trimmed and capped (over the cap
  → dropped as malformed, not truncated), a `depth` outside 1–3 is malformed. **Over a depth's cap,
  the excess is demoted to the next depth rather than dropped** (in array order), and over the total
  cap it is dropped. **If depth 1 is empty after validation, the lowest-depth survivors are promoted
  until it has one** — never a route with no first pass. Counts on the artefact (`unknownIds`,
  `reversed`, `tooLong`, `overlap`, `malformed`, `demoted`, `overCap`) and logged. Three empty
  outcomes as FAQ: no `stops` array → fail; a non-empty array validation empties → fail with counts,
  nothing written; the model's deliberate `[]` → fail too (unlike FAQ, every piece has a first pass;
  an empty route is a broken answer, not a finding).
- **A re-run replaces; ids are minted fresh.** `?stop=` is the only thing that addresses a stop; a
  stale one falls back to the first stop, so inheritance is not worth its machinery yet (FAQ and Quiz
  made the same call).
- **The band** (`TrajectoryPanel` in `ModeSurface`): head row `‹ Stop k of N ›` and the depth
  control (three buttons, each with its stop count — a segmented control rather than a range slider,
  because three discrete positions are easier to hit on an iPad and read the same with a keyboard).
  Body: the stops at the current depth, each numbered, with **its place from the hierarchy** — the
  titles of the part and section containing `first` (read from the tree, which the reading view
  already has; no generated heading) — and its `why`. The current stop is highlighted; pressing a row
  goes to it. Foot: one sentence on what the route is and is not (the passages are the article's; the
  choice and order are the model's reading, shaped by your profile if you gave one).
- **The prose**: the current stop's blocks are the mode's `Found` passages (`selectPassages`), so the
  ring, the paragraph bar and the rail mark it with the machinery every passage-marking mode uses.
  Quotes are marked in the prose in every mode already ([quotes.md](../project/quotes.md)), so a quote
  inside a stop shows without Trajectory asking. **Stepping always scrolls** the stop's first block
  into view — a non-linear step is arriving somewhere new, the "selecting jumps" rule of
  [ideas.md § Prev / next](../project/ideas.md#prev--next-in-both-modes). No wrap at either end,
  matching `BlockNav`.
- **Changing depth keeps your place**: if the current stop is in the new depth it stays current;
  otherwise the current becomes the next stop in route order that is in the new depth (or the last,
  if none follows). Pure function, tested.
- **Keys**: while Trajectory is the mode, ← / → step the stops. They are spoken for globally
  ([keyboard.md](../project/keyboard.md): ← / → choose the stride), so this is a documented exception
  claimed in `keynav.ts`'s own listener — the one place that already owns arrows — rather than a second
  window listener racing it. Same guards as the arrows already have: no modifiers, not in a text
  field, no auto-repeat. ↑ / ↓ untouched. keyboard.md gets the exception.
- **URL**: `?mode=trajectory&depth=2&stop=<id>` through [`params.ts`](../../src/web/params.ts)
  ([url-state.md](../project/url-state.md)); names checked against the existing params first (rename
  if `depth` or `stop` is taken).
- **Touch**: the ‹ › and depth buttons at the control height ([controls.md](../project/controls.md)),
  rows are ordinary buttons; no swipe in v1 (swiping the band is a gesture the article already uses
  for other things — [touch.md](../project/touch.md) — and the buttons are enough to judge the idea).
- **Behind the experimental switch, owner-only** — a visitor gets the explanatory band, as FAQ.
- **Billing**: the step runs through the same job route as every artefact step, so the existing
  per-account job limits apply; no new spend path. Model calls through the AI gateway as FAQ's do
  ([ai-gateway.md](../project/ai-gateway.md)). **Streaming**: not streamed, the same call as FAQ
  and Ideas make — the reader sees the job's progress, and a route is not usable until its first
  pass has been validated as a whole (a half-list of stops would be re-ordered under them). Named here
  as a deliberate departure from "stream anything a reader waits on"; the sentence goes in
  trajectory.md's Questions.
- **Plain words**: the `why` line follows the prompt rule in
  [new-mode.md § The words the mode puts in front of the reader](../project/new-mode.md#the-words-the-mode-puts-in-front-of-the-reader),
  ending on "plainer than the article, never further from it" — and the shared plain-words guide if
  the fb44 session has landed it on `dev` by then (`docs/project/prompting-guide.md`).

## Reuse — what the trajectory borrows, and the version we did not build

Greg: *"let's try and have one reusable set of highlights that we think are most important."* The
tension is real: a route needs judgment about **order** and about **how much of the piece each pass
covers**, which no existing artefact holds.

**Built (A): a new, thin artefact that is only an ordering over passages.** It stores block ranges,
a depth and one short line each; everything else it shows is borrowed — section names from the
hierarchy, quote marks already in the prose, the jump/mark machinery from `Found`. It is not another
set of highlighted *text*: it has no extracted quotes, no summaries, no claims. One model call, on the
cached article prefix.

**Not built (B): the trajectory as an ordering over Quotes.** Level 1 = the top few quotes, level 2
more, level 3 the hierarchy's sections; a small model call only orders quote ids. Why not in v1:

1. **Quotes are not built by default** (off `DEFAULT_INGEST_STEPS`), so opening Trajectory would
   first buy Quotes — two calls and a dependency between steps, which only `illustrated` has today
   and which refuses rather than pulls.
2. **A quote is a line, not a passage.** Level 1 would be five sentences, which is quote-skimming,
   not reading; level 3 ("a bigger proportion of the paper") cannot be made of quotes at all.
3. **Freshness couples.** Quotes' *Find more* appends; every append would stale the route.
4. **The quotes are chosen for being worth keeping, not for being where to start.** The best first
   stop is often a plain results paragraph with no quotable line in it.

What would change our mind: if Greg finds the stops and the quotes are mostly the same passages, B
becomes the cheaper story and v2 can seed the prompt with existing quotes as hints.

**Not built (C): no model call at all** — the hierarchy's parts in a fixed "results, methods,
background" order by heading keywords. Free, but it cannot personalise, most essays have no such
headings, and it cannot choose *which* paragraph within a section is the one to read.

*(Settled with GPT Sol's plan review and an Opus second opinion — see the ledger below.)*

## Stages

0. **Vision doc and plan** — `docs/project/trajectory.md` (Greg verbatim), its line under
   reading-view-overview.md, this plan; GPT Sol plan review (read-only) and an Opus second opinion
   on the reuse question and the band. Commit.
1. **The artefact and the step** (server) — follow FAQ's stage-1 commit `b31d8b87` as the file list,
   and Ideas (`src/ideas.ts`) for the profile plumbing: types, `ArtifactKind`/`StepName`, every total
   the compiler asks for ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one)),
   the migration (column + the step-name CHECK, checked by `tests/db-step-constraint.test.ts`),
   `src/trajectory.ts` (prompt, parse, validation, sizes, `PROMPT_VERSION`), the GET route, `CACHEABLE`,
   export, cost category, cache-group docs. Tests red first for every validation rule above, the
   demote/promote rules, the stamp/stage fingerprint agreement including the profile hash, and not
   forced by an earlier forced step. **A real run on two local articles** (one paper, one essay),
   with the routes written into Progress and judged: does depth 1 alone give the gist? does it
   start somewhere sensible? Then GPT Sol code review (write-capable), gates, commit.
2. **The mode** (client) — follow FAQ's stage-2 commit `0e947eb4`: `MODES` and every client total
   ([new-mode.md § The client](../project/new-mode.md#the-client)) and the tests that go red without
   a type error; `useTrajectory`; `TrajectoryPanel`; the pure step/depth functions with tests; the
   ← / → claim in `keynav.ts` with a test; params; `experimental: true` and `BEHIND_THE_SWITCH`; the
   card's two sentences; the row in experimental-features.md; keyboard.md's exception; trajectory.md
   updated to what shipped. A browser check in a Sonnet subagent (Playwright on the box) at desktop
   and iPad widths on a real local article with a generated route. Then GPT Sol code review, gates,
   commit.
3. **v2, only if v1 is solid: the scrapbook** — beside each stop, client-side only, what already
   exists for its range: the quotes inside it, glossary terms first used in it, the gist of the
   section it sits in. No model call, no new artefact; each piece shown only if its artefact exists.
   Chosen over web search because it is pure reuse and serves skimming directly (trajectory.md
   § Version two). Sol review, browser check, commit. **Skipped** if stage 2 left doubts.
4. **Full suite, push, clean up** — the full suite through `scripts/tmux-job.ts`, push to `dev`,
   `npm run worktree:check`, remove the worktree.

## Review ledger

*(filled in as reviews arrive)*

## Progress

- 2026-09-28 — plan and vision doc written; worktree `trajectory-mode`.
