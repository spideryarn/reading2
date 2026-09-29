# Trajectory: deeper passes add detail, one door at the end, the promise in a tooltip, the list follows the stop

Three of Greg's reports on Trajectory from production (build `43f99ecb`), 2026-09-29. The mode is
[trajectory.md](../project/trajectory.md); its build history is
[260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md); the session before this one,
fb4k, landed `013a0383` (compact marker, opening at stop 1, centring, and the end-of-pass door split
into *Go round again* and *More detail ›*).

Not in this plan: removing *Plan it again* (report 53) — another session owns that button, with the
Metadata re-run work. Nothing here touches it.

## What Greg asked

> For Trajectory mode, let's assume the reader has read the coarser levels already, so the more-detailed levels should be adding extra detail/subtlety/complexity.
> And maybe we don't need a button for "do this level of detail again" - they can just press left a bunch of times.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-51

> In Trajectory mode:
> - Remove "The passages are the article's own words, chosen by Quotes. The order and the cues are the model's reading, shaped by your profile. This pass stops at N of the article's M quotes." Instead, move that into a tooltip somewhere.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-52

> In Trajectory mode, if I click left/right step buttons that takes us off the top/bottom of the scroll window of the left-hand Trajectory-mode column, it should scroll accordingly to keep them visible.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-54

## The stages

Two, because the deploy cutoff is 05:10 BST and the first is client-only and small; the second is a
prompt change that needs a measurement run.

### Stage 1 — client (aimed at the 05:10 cutoff)

- **54 — the list follows the stop.** When the current stop changes by any path (‹ ›, ← →, the door,
  a depth change, a deep link), the band's own scroller (`.tl-scroll` in `TrajectoryPanel`) scrolls
  just enough to show the current row — the nearest edge, not centred, and never the page. Not
  `scrollIntoView`, which scrolls every scrolling ancestor, the window included, and would fight the
  prose scroll that is landing the passage at the same moment: a direct `scrollTop` on the list's
  own scroller. Instant under reduced motion. **A failing test first** (the row outside the
  scroller's visible box after a step; the scroller's `scrollTop` must move and `window.scrollTo`
  must not be called).
- **51b — one door at the end of a pass.** Remove *Go round again* from the end-of-pass door; *More
  detail ›* stays. ← still walks back, and ← on stop 1 still goes to stop 1's passage (4K). At the
  deepest pass, where there is no *More detail*, the end of the pass has no door button (the line
  saying which pass ended stays). The `again()` verb on `TrajectoryControl` goes if nothing else
  uses it.
- **52 — the promise into a tooltip.** The two foot sentences (`trajectoryPromise`, `coverageNote`)
  leave the band's foot and become the tooltip of a small info control in the band's head, using the
  house tooltip ([tooltips.md](../project/tooltips.md)) — reachable by keyboard and touch, not a
  `title` attribute. The words themselves stay as they are. *Plan it again* stays where it is.

Then Sol code review, the gates, a Sonnet browser check (1440, 820×1180, 420), a feedback note per
report in `docs/user-feedback/`, commit, push.

### Stage 2 — the deeper passes add detail (prompt, `trajectory/8`)

The route call today asks each pass to cover as many Ideas as the quotes allow, the headline few at
Gist. Greg's report says a reader at More has **already read Gist**, and at Most has read More: so
the stops each deeper pass *adds* should bring extra detail, subtlety and complexity — the method,
the caveats, the exceptions, the evidence behind a headline — not a second telling of the headline.
One prompt change, read against [prompting-guide.md](../project/prompting-guide.md), one
`PROMPT_VERSION` bump; the cues of the added stops should say what they add. Nesting, quote-only
stops and the Abstract rule are unchanged.

**Measured** the way the prompting guide says, offline, on the three test articles of 260928a,
old prompt twice and new prompt twice against one Quotes/Ideas snapshot:

- Idea coverage per pass (the existing `scripts/eval/trajectory-coverage-eval.ts`) must not fall;
- a blind read, shuffled with `crypto.randomInt`, key recorded: for each article, the stops *added*
  at More and at Most under each arm, judged on "given that you have read the pass before, does
  this add detail, subtlety or complexity, or does it repeat what the earlier pass said?".

Kept only if it wins the blind read beyond the old-vs-old control and holds coverage.

**Handover to fb4p** (report 4P, snippet variety within and between levels, starting 14:08 BST):
what stage 2 changed in the prompt is written here, under *Progress*, once it lands.

## Progress

- 2026-09-29 03:50 — plan written.
- 03:47 — GPT Sol plan review ([prompt](260929b-trajectory-plan-review-prompt.md),
  [answer](260929b-trajectory-plan-review-sol.md)), *approve with changes*, all taken:
  **F1** the list-follow must re-run when a narrow window's band comes back (it is `display: none`
  while away); **F2** the eval harness is pinned to /6-vs-/7 and must be generalised; **F3** the
  blind judge sees the preceding pass with each added stop, and coverage may vary within the
  old-vs-old range; **F4** the house `Tooltip` needs explicit touch control, the info button last
  in the head; **F5** trajectory.md still describes two end doors. `.tl-scroll` is confirmed as the
  scroller.
- Stage 2 — **measured and not kept**; the route stays at `trajectory/7`
  ([eval](260929b-trajectory-stage2-deeper-passes-eval.md), Opus, $0.29). The trial prompt added one
  paragraph: a reader at More has read Gist and at Most has read More, so each deeper pass adds what
  the earlier one left out (Ideas not yet reached; then method, evidence, caveats, exceptions,
  complications), "not a second telling", and each added stop's cue says what it adds. Ideas
  covered (of 21), Gist/More/Most: new 8,7 / 13,13 / 15,15 against old 7,8 / 12,13 / 15,15. Blind,
  preceding pass shown beside each added stop, key balanced and written first: new 2 wins, old 2,
  2 ties — the old-vs-old control went 3–2–1; per added stop, "adds detail" 25 vs 26, "repeats"
  3 vs 2. (The judge also wrote the prompt; the verdicts were saved before the control was read.)

  **Why, and the handover to fb4p (report 4P, snippet variety):** Most is every quote offered, so
  the route prompt can only move quotes between More and Most — whichever pass gains loses the
  other. The repeats come from the quotes themselves. The levers that can make deeper passes add
  rather than retell are upstream or structural: **better quotes** (Quotes choosing lines that
  carry method, caveats, evidence, not only headline restatements), or **letting the route drop a
  quote that only restates an earlier stop** — the rules already allow "leave one out only if it
  adds nothing", and no run used it. Nothing in `src/trajectory.ts`'s prompt changed; a comment at
  `PROMPT_VERSION` records the attempt. The eval harness now takes any two same-shaped prompt
  modules (`scripts/eval/trajectory-coverage-eval.ts`) and `scripts/eval/trajectory-depth-blind.ts`
  builds the blind fixtures — both reusable for 4P.
