# Review: the reading view's top bar now hides on scroll at every width, not just on phones

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls`, branch
`worktree-hierarchy-column-controls`. TypeScript + ESM, React client under `src/web/`, hand-written
CSS in `src/web/styles/` (one file per area; the import order in `src/web/styles.css` is
load-bearing), Vitest under `tests/`.

**This is the second round.** You reviewed the plan; this is the code built from it. Weight this
pass higher than the first — a plan-stage review cannot see a selector that lost its specificity in
the move.

## The candidate

Live pre-commit; base `70040b0b`.

**Modified (tracked):**
- `src/web/scroll.ts`
- `src/web/useColumnContext.ts`
- `src/web/ContextPanel.tsx`
- `src/web/styles/shell.css`
- `src/web/styles/narrow-window.css`
- `src/web/styles/column-context.css`
- `tests/mobile-chrome.test.ts`
- `tests/spine-width.test.ts`
- `docs/project/column-context.md`, `docs/project/touch.md`, `docs/project/performance.md`

**Untracked (new — a pathspec cannot name these, so here they are explicitly):**
- `tests/bar-motion.test.tsx`
- `docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md`
- `docs/plans/260907b-plan-review-prompt.md` (my round-one prompt; not part of the change)
- `docs/plans/260907b-plan-review-sol.md` (your round-one answer; not part of the change)

`git diff 70040b0b -- <the tracked paths above>` shows the tracked half.

> **Closed 2026-09-07.** This prompt named a working tree, which is not durable. What it saw is
> `cb8ffccf`; the fixes for the findings it returned are `b86b6726`, and both are on `dev` via
> `b12a8fa1`.

**Start with** `src/web/scroll.ts`, `src/web/styles/shell.css` and
`src/web/styles/column-context.css`. That is where to begin, not the limit of scope.

The plan doc is the contract; read it first.

## What it does

1. **`watchBarVisibility` lost its `matchMedia` gate.** It used to hold a `SMALL_DEVICE` copy of
   `@media (max-height: 620px), (max-width: 731px)` and attach its scroll listener only while that
   matched. The constant is gone; the listener is unconditional.
2. **The top bar's hidden-state rules moved from `narrow-window.css` § a small device into
   `shell.css` § the bar that leaves while you read** — `--bar-bottom`, `--bar-hide`, the
   `transition: top` list, `:root:has(.controls:focus-within, .mode-band)` and
   `:root:has(.mode-band) .controls`. **The dock's half stayed behind** inside the media query
   (`--dock-bottom: 0px`, its own `:has()` guard, `:root:has(.mode-band) .dock`), deliberately: the
   Dock does not hide on a laptop.
3. **The fisheye panels now slide with the bar.** `:where(table.zoom > thead) > tr > th` left both
   `transition: top` lists (it is a zero-height invisible measuring stick, and animating it made the
   panels chase a travelling number); `.ctx-panel` gained a transition scoped to
   `:root[data-bar-moving]`, an attribute `scroll.ts` sets when it flips `data-bars` and clears on
   the bar's `transitionend` with a `BAR_MOVE_MAX_MS` backstop.
4. **`useColumnContext` re-samples on a `data-bars` mutation** (MutationObserver → `schedule()`).
5. **`ContextPanel`'s `place()` reads `rect.top`** (the destination) rather than the panel's live
   interpolated rect.
6. **`stickyOffset()` returns the destination coverage** — `rect.bottom <= safeTop ? safeTop :
   rect.height + safeTop` — instead of clamping the current rect.
7. **The overflow fade joined the `prefers-reduced-motion` list**, which had omitted it.

All seven of 3–7 are your F1–F3 from round one.

## Invariants it must not break

- A deep link / keyboard jump lands with its target clear of the bar, in **every** bar state
  including mid-transition.
- A keyboard reader tabbing the granularity pills never has the bar slide out from under them.
- A panel is never left out of step with its column.
- Chrome never answers to a scroll *we* started (`markOurScroll` / `quietUntil`).
- The Dock does not move on a laptop.

Out of scope: the pills themselves, deleting the bar (that is 260905g stage 3), moving the Dock.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/bar-motion.test.tsx` or `tests/mobile-chrome.test.ts`) and a script
(`node --import tsx <script>`). **No network, not even loopback**, so nothing touching Postgres, a
dev server or a browser will run.

**What I ran, so you do not have to assert it:**

- `npm run check` — **786 test files, 14,329 tests, 35 skipped, EXIT=0**. `npm run typecheck` clean.
- **Three mutations, each red, then restored green** (red-first only tests the diff):
  - `attributeFilter: ["data-bars"]` → `["data-nothing"]` → `bar-motion` "takes a fresh measurement
    from a `data-bars` change alone" fails.
  - the `setTimeout(stopMoving, BAR_MOVE_MAX_MS)` backstop removed → "goes on when the bar gives way
    and off when the transition never ends" fails.
  - `stickyOffset` restored to `Math.max(safeTop, Math.min(rect.height + safeTop, rect.bottom))` →
    "reserves the whole bar while the bar is still travelling" fails.
- **A browser pass** (Playwright, system Chrome on this box, dev server proved to be this worktree's
  by grepping the served `scroll.ts` for `BAR_MOVE_MAX_MS`), article
  `antikythera-mechanism-spya-zhxrzm`, signed in, at 1440×900, 1280×800, 900×800, 390×844 and
  **844×390** (the landscape phone from your F4):

  | width | bar hides / returns | panel `top` vs its `th` `bottom`, at rest | same, hidden + still 600ms | scrolling 0–150px in 30px steps | `data-bar-moving` cleared | `.dock` moved |
  |---|---|---|---|---|---|---|
  | 1440×900 | yes / yes | 0.00px (2 panels) | 0.00px | 0.00px | yes | **no** |
  | 1280×800 | yes / yes | 0.00px (2) | 0.00px | 0.00px | yes | **no** |
  | 900×800 | yes / yes | 0.00px (1) | 0.00px | 0.00px | yes | — |
  | 844×390 | yes / yes | 0.00px (1) | 0.00px | 0.00px | yes | hides, as before |
  | 390×844 | yes / yes | no panels exist at this width | — | — | yes | hides, as before |

  Band mode (`?mode=summary`, 1440×900): `data-bars` becomes `"hidden"` and `.controls` does **not**
  move (`{top: 0, bottom: 44}` before and after) — the `:has(.mode-band)` guard holds after the move
  to `shell.css`. Plain hides. The current entry stays within 0.5px of the 40% focus line. A deep
  link with the bar hidden lands at −0.078px against a bar bottom of 0.

  Frame-by-frame trace, because a 0.00px delta is equally consistent with the transition never
  running: `data-bar-moving` is present for 5 frames during a hide (`.controls` top 0 → −43.3 → −44
  across +182…+318ms) and 7 during a reveal; mid-slide the panel deliberately diverges from its `th`
  by up to 10.4px, which is the head snapping while the panel glides.

## Attack it

Independently, and before you read my suspicions at the bottom.

The invariant I most want broken: **that the move from `narrow-window.css` to `shell.css` preserved
behaviour.** `shell.css` is imported *second* and `narrow-window.css` *near the end*, and that file's
header says nearly every rule in it wins by being later rather than by specificity. Check every moved
declaration against everything that could now beat it, in both files and in the ones between them
(`table.css`, `column-context.css`, `mode-band.css`, `dock.css`, `spine.css`, `dock-fit.css`).
Cascade layers are in play — `styles.css` is imported as `layer(app)`; check that does not change the
answer.

Second target: **`stickyOffset`'s new form**. It reads no attribute by design. Enumerate the states
`.controls` can be in — not stuck yet, stuck, mid-hide, mid-reveal, fully hidden, held down by
either `:has()` guard while `data-bars="hidden"` is set, absent entirely, and `prefers-reduced-motion`
where the transform is instant — and find one where the new expression is worse than the old.

Third: **the `data-bar-moving` lifecycle**. `startMoving` calls `stopMoving` first, queries
`.controls` fresh each time, and adds a `transitionend` listener. Look for a leak, a listener that
outlives its element, a `transitionend` from a *descendant* bubbling up and clearing the attribute
early (`.controls` contains shadcn `Toggle`s that transition `color`, `background-color` and
`border-color` — see `src/web/pill.ts`), and what happens if the bar flips twice inside 180ms.

Fourth: **what else reads `--bar-bottom`, `--bar-hide` or `data-bars`** that was only ever exercised
on a phone and is now exercised on every laptop. `grep` for all three.

For each finding give:
- an ID (F6, F7, … — F1–F5 are taken by round one; number new ones above the highest issued)
- a severity (P0/P1/P2/P3) and whether it is **established** or **reasoned**
- (a) what shows it fails its own claim — the input or mutation I can run, or the exact reachable
  source path
- (b) the smallest change that closes it — a code block, or exact replacement wording

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by file. **Refuse only on an established P0 or P1**, and name what
established it.

## Round one's findings and where they landed

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| F1 | `.ctx-panel` would lag during ordinary scrolling with a standing `transition: top`; `place()` uses the interpolated rect | fixed | `:root[data-bar-moving]` scoping (`column-context.css`, `scroll.ts`); `place()` reads `rect.top` and takes it into its `useCallback` deps |
| F2 | `stickyOffset()` reads a bar mid-transition; `scrollToBlock` fixes its destination from that reading | fixed | the two-line destination form in `scroll.ts` |
| F3 | reduced-motion list omits the overflow fade | fixed | added, with `:root[data-bar-moving] .ctx-panel` beside it at matching specificity |
| F4 | a landscape phone at 844×390 has both a panel and a hiding bar, so the "no panels on a phone" claim was false | fixed | plan § what is true today; 844×390 added to the browser matrix and exercised (0.00px) |
| F5 | 44px is 11% of a 390px viewport, not a third | fixed | plan § the two costs |

Treat those fixes as unreviewed code written by someone else.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **`transitionend` bubbles.** `.controls` holds shadcn `Toggle` pills that transition four
   properties over 120ms. If one of those events reaches my listener, `stopMoving` runs ~60ms early
   and the panels stop mid-glide. I did not filter on `e.target === bar` or `e.propertyName ===
   "transform"`. I think this is a real bug and I want you to confirm the reachable path rather than
   agree with me.
2. **The browser pass measured a one-frame overlap I had claimed was impossible**: `scrollTo(0, 400)`
   from the top hides the bar on the frame the panel is still measured unsettled, so it glides 244px
   instead of snapping to 44 and sliding. I softened the claim in three places rather than fixing it.
   Is leaving it right?
3. `tests/spine-width.test.ts` lost the half that paired the CSS query with the TypeScript constant,
   and gained `expect(scroll).not.toMatch(/SMALL_DEVICE\s*=/)`. I may have removed the wrong half.
4. Decision 3 keeps `.mode-band` in the "bar stays" guard at every width, so the bar hides in Plain
   and Hierarchy and stands still in the twelve band modes. Coherent, or an inconsistency a reader
   will notice?
5. Thresholds unchanged (`BAR_HIDE_AFTER = 24`, `BAR_KEEP_UNTIL = 160`). 24px is a much smaller
   fraction of a 900px viewport than of a 390px one; a laptop reader may find it twitchy.
