# Review request: the Outline mode code, as built

You reviewed the **plan** for this earlier (`docs/plans/outline-mode-review-sol.md`) and said
"revise before building" with three blocking findings. This is the second review: **the code**. Per
this repo's working agreements the code review is weighted higher than the plan review, because a
plan-stage review reads prose and cannot find a handler that writes one field and then rejects the
request.

Repo: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Read-only.

## What to read

**The plan, as revised after your review:** `docs/plans/outline-mode.md`. Its § "The plan-stage
review" records what was accepted and what was not, and why.

**The code, which is the point of this review:**

- `src/web/outline.ts` — the pure projection. Decides what is drawn AND which row is current.
- `src/web/OutlinePanel.tsx` — the DOM half: choosing which rung fits, and the keyboard.
- `tests/outline.test.ts` — the projection's tests.
- `tests/outline-panel.test.tsx` — the panel's tests.

**The wiring, which is currently UNCOMMITTED in the working tree** (peers hold several hundred
uncommitted lines in each of these files, so it could not be committed safely yet). Read it with
`git diff -- <path>` and look only at hunks mentioning `outline`/`outln`/`OutlinePanel`/
`EMPTY_DEPTHS`/`Focus`:

- `src/web/params.ts` (`MODES`), `src/web/Dock.tsx` (the pill), `src/web/visitor.ts` (a visitor
  gets it free), `src/web/page-title.ts`, `src/web/App.tsx` (the band, the memo, the sampler),
  `src/web/styles.css` (`§ outline mode`, at the end of the file), and the two test files
  `tests/page-title.test.ts` and `tests/visitor-gaps.test.ts`.

**Context that decides several of the questions below:** `docs/project/column-context.md` (the
per-column fisheye this reverses a decision from), `docs/project/summaries.md` (§ Which row is "the
relevant one"), `docs/project/granularity-zoom.md` (§ Node shape — the `gist`/`navLabel` contract,
and § The supplement node), `docs/reusable/silent-success.md`.

## How your plan-stage findings were resolved

Check each of these against the code rather than taking my word for it. Where I claim your finding
was addressed, I may have addressed it wrongly or only partly.

1. **`currentEntryId`/`showsChildren` cannot express selective expansion** — accepted. There is now
   one pure `outlineProjection` and neither of those functions is called. Verify it does not have
   the same class of duplicated-rule bug internally.
2. **`?at=` is section-granular** — accepted, and **my proposed remedy was wrong**. I claimed
   `LiveContext.focusRow` was the exact row; it is `sections[activeSectionIndex(…)].row`, which is
   the section's first row. So both routes are section-granular, and your second option is what is
   built: `PARAGRAPHS_ARE_NEVER_CURRENT` in `outline.ts`. **Is stopping the mark at the section
   actually right, and is it enforced everywhere it needs to be** — including the `here` chain, the
   `now` walk, `aria-current`, and the panel's roving-focus initialisation?
3. **`buildSummaryTree` walks raw children and draws blank rows** — accepted. `rowText` falls back
   to `navLabel` and returns null for a node with no text, and a null row is dropped. **Is the
   navLabel fallback defensible here**, given the contract in granularity-zoom.md § Node shape? I
   argue it is navigation chrome beside visible prose, and that this is why rung 5 is dropped when
   the band covers the prose. Attack that argument.
4. **Character-count fitting cannot prove the list fits** — accepted. The panel now renders all five
   candidates off-screen in identical markup and measures them. **Look hard at whether the
   measurement is actually valid**: the candidates' width, the `visibility: hidden` vs
   `display: none` choice, whether `scrollHeight` on those elements means what the code thinks,
   whether there is a loop, and whether the `ResizeObserver`s can fire in a state where
   `clientHeight` is 0.
5. **The band covers the prose below ~856px** — accepted. `proseBeside` is passed as
   `fit.modeW > 0` rather than a hardcoded width. But **the narrow-window interaction design is not
   built**: no tap-to-jump-and-close, no 44px targets. I consider that incomplete rather than done.
6. **Unfocusable rows** — accepted. One tab stop, `role="tree"`, roving focus, `aria-current`.
   Compare it against Diagram mode's implementation, which is the pattern I was told to copy.

## What I most want from you

1. **Where is this silently wrong?** The repo's recurring bug is a check that agrees with the code
   because it shares an assumption. Candidates I am already unsure about: the interaction between
   `focusRow` changing and the `useEffect` that resets roving focus; whether `candidates` being a
   dependency of the layout effect causes measurement on every scroll; whether the tier calculation
   changing font sizes can change measured heights *after* the rung was chosen from them (a
   self-invalidating measurement).
2. **The fit's honesty.** `tests/outline-panel.test.tsx` says plainly that jsdom does no layout, so
   "the list fits" cannot be asserted there and needs a browser. Is the stubbed-height test still
   testing something real, or have I written a test that only exercises my own stub?
3. **The churn.** The plan claims that in one merged list the reflow at a boundary is small because
   one branch closes as another opens. `constitution` crosses from a 3-section part to a 15-section
   part. Read `outlineProjection` and say what actually moves.
4. **Anything the tests cannot fail on.** I mutated the code six ways and each mutation reddened
   only the tests that name it, but that is not proof of coverage — tell me what a mutation would
   *not* have caught.
5. **The wiring.** Particularly `visitor.ts` (does a visitor genuinely reach nothing they should
   not?), and whether adding a mode has obligations I have missed — url-state.md, keyboard.md,
   touch.md, the Dock's ordering, anything that enumerates modes.

Be specific: name the file, the function, the article shape, or the window size. If a finding is
taste rather than a defect, say so.
