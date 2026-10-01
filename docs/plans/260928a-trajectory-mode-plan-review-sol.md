I found no P0s, but several P1 design gaps mean the plan would not reliably deliver Greg’s brief as written. I made no file changes.

## Findings

**F1 — P1 — Option A does not fulfil the “one reusable set of highlights” requirement**

Greg explicitly wants Quotes, article overview, and Trajectory to share one set of selected passages ([trajectory.md:33](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/trajectory.md:33)). Option A creates another model-selected set of block ranges. Omitting copied prose from the artefact does not change that: the ranges themselves are the highlights. Rendering them with the same visual treatment is cosmetic reuse, not data reuse ([plan:117](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:117)).

The case against B also relies on claims the current code contradicts:

- Quotes can contain most or all of a block and are allowed up to 1,200 characters; they are not necessarily “a line” ([quotes.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/quotes.ts:146)).
- Appending preserves existing quote IDs, so a route over quote IDs does not automatically become stale ([quotes.md:586](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/quotes.md:586)).
- The client already knows how to request a prerequisite in the same job through `precededBy`; Illustrated uses it for Sketch ([useStepJob.ts:136](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useStepJob.ts:136), [useIllustrated.ts:283](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useIllustrated.ts:283)).

**Recommendation:** either use a quote-backed route, or state plainly that A deliberately defers Greg’s reuse requirement. Do not claim that A already honours it.

---

**F2 — P1 — The validator does not guarantee three increasing depths**

The representation—one ordered array filtered by `depth <= selectedDepth`—is a good way to guarantee nesting. The validation rules do not guarantee increasing depth, however ([plan:56](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:56)).

Valid outcomes include:

- every stop labelled depth 1, producing 5/5/5;
- every stop labelled depth 3, after which promotion produces roughly 1/1/N;
- overlap and caps removing all additions at depth 2.

All are accepted even though “three increasing depths” is the central product contract ([trajectory.md:19](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/trajectory.md:19)).

**Recommendation:** for articles large enough to support it, require `count₁ < count₂ < count₃` after validation. Fail and retry invalid output rather than inventing semantic membership through promotion. Tiny articles may explicitly use a reduced-depth result.

---

**F3 — P1 — Multi-block stops do not fit the existing passage/highlight machinery**

A stop may span four blocks and is supposed to appear as one current-ring result ([plan:43](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:43), [plan:83](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:83)). Existing `Found` values identify exactly one block and require a unique key ([search-hits.ts:79](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/search-hits.ts:79)); `hitMarks` rings one `openKey` rather than a group of results ([search-hits.ts:1200](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/search-hits.ts:1200)).

The validator also does not keep `firstBlockId` and `lastBlockId` within one hierarchy node. Consequently the section label derived from the first block can misdescribe the rest of the stop.

**Recommendation:** make a v1 stop one body block. That is already a hierarchy leaf in the shared tree. If ranges later prove necessary, add an explicit group identity to passage marks and require the range to stay within an agreed hierarchy parent.

---

**F4 — P1 — The narrow-window design hides the prose that Trajectory is navigating**

On narrow screens an open mode band covers the prose ([narrow-windows.md:59](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/narrow-windows.md:59), [Reader.tsx:471](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/reader/Reader.tsx:471)). Under the plan, tapping a stop scrolls text hidden behind the still-open full-screen band. That breaks the central skim-read-step loop.

The planned browser pass names desktop and iPad but omits the phone-width layout where this is most visible ([plan:170](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:170)).

**Recommendation:** define a compact navigation state that reveals prose after selecting a stop—such as collapsing the band while retaining its route and controls—and test at roughly 420px as well as tablet and desktop.

---

**F5 — P1 — The keyboard behaviour is feasible, but not through the seam described**

`keynav.ts` owns a window-level listener, and currently handles Left/Right as stride movement ([keynav.ts:467](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/keynav.ts:467)). The hook is installed high in `Reader`, before mode panels and their local controller state are created ([Reader.tsx:1041](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/reader/Reader.tsx:1041)). Merely checking `mode === "trajectory"` in `keynav.ts` does not give it the current route or a `nextStop` action.

The product requirement is feasible, and the keyboard doc even records Left/Right as the intended direction for mode-specific behaviour ([keyboard.md:137](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/keyboard.md:137)). The state boundary must be designed explicitly.

**Recommendation:** lift the trajectory controller to `Reader`, or let `useArrowNav` accept an optional horizontal-navigation callback/ref. Preserve the existing typing, modifier, `defaultPrevented`, loading, and non-Trajectory guards, and define behaviour at both route ends.

---

**F6 — P1 — “Not streamed” violates the repository’s explicit interaction contract**

The plan acknowledges that the reader waits for this call but proposes making the complete artefact available only after generation finishes ([plan:105](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:105)). That directly conflicts with the rule to stream model calls a person is waiting on.

FAQ and Ideas are not a clean counter-precedent: both use streaming provider calls and report incremental character progress ([faq.ts:550](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/faq.ts:550), [ideas.ts:927](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/ideas.ts:927)). They still withhold usable content until completion, but that existing shortcoming does not repeal the written rule.

**Recommendation:** emit validated stop records incrementally, or generate the shallow route first and add deeper stops in later streamed phases. A quote-backed no-call v1 would avoid this problem altogether.

---

**F7 — P1 — Personalisation does not reliably update when a profile first appears**

Initial generation with an existing profile is correctly planned. The claim that profile changes will make an existing route stale is incomplete ([plan:35](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:35)).

`profileIsStale` deliberately treats an artefact stamped with `null` as not stale when a profile later appears ([profile.ts:247](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/profile.ts:247)). Meanwhile, auto-run starts only when the artefact status is `none`; a ready generic route will remain ready ([useAutoRun.ts:159](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useAutoRun.ts:159)). Thus a user can have a profile and still see an older generic route without warning or regeneration.

**Recommendation:** either treat `null → profileHash` as stale for Trajectory, or narrow the product promise and expose an explicit “rebuild for me” action.

---

**F8 — P2 — Several repairs can silently change the model’s intended route**

The validation algorithm has unstable priority rules ([plan:60](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:60)):

- “Earlier wins” can let an early depth-3 range remove a later, more important depth-1 stop.
- Dropping a whole stop because `why` is too long throws away valid structural output for a presentation-field defect.
- Demotion and promotion silently change the model’s depth classification.
- It is unclear whether caps are per-depth or cumulative visible-stop caps.

**Recommendation:** validate descriptive fields independently; truncate or discard only invalid `why` text. Resolve conflicts shallowest-depth first, then route order. Define caps as cumulative visible counts. Reject results whose depth structure cannot be preserved rather than relabelling them.

---

**F9 — P2 — The implementation stages omit checklist details needed by this particular mode**

The general instruction to cover “every client total” is useful, but the plan should explicitly include:

- a passage resolver/search-hit branch, required when a mode marks prose ([mode.md:53](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/mode.md:53));
- the new `PassageSlots` state and reset lifecycle, which is not an exhaustive map today ([passages.ts:71](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/reader/passages.ts:71));
- URL history semantics: depth changes should likely push history, stop stepping should replace, and a depth change plus fallback-stop correction should be atomic;
- the corresponding `url-state.md` documentation update.

The plan currently only names the two parameters ([plan:98](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:98)).

**Recommendation:** add these as named Stage 2 tasks and tests rather than relying on the compiler or the broad checklist reference to discover them.

---

**F10 — P2 — Stop counts do not control how much the reader must read**

The rough 5/12/30 numbers come from Greg’s own examples, so using them experimentally is reasonable. Scaling only by block count is weak, though: blocks vary greatly in length, and a 30-stop route with four-block spans may select most of a paper ([plan:56](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:56)).

Two real-article runs are insufficient to calibrate this.

**Recommendation:** record selected word count and percentage of body text at each depth, and inspect a short essay, a normal paper, and a long/deeply sectioned paper. Treat the initial counts as hypotheses, not stable product constants.

## Simpler v1

The cheapest useful experiment is a quote-backed Trajectory with no new model call:

1. Use distinct quote-containing blocks.
2. Order them by the existing quote priority ranking rather than article order.
3. Reveal roughly 5, 12, and up to 30 through the same nested array.
4. Display the whole containing block, with hierarchy-derived section labels.
5. If Quotes do not exist, request them as the disclosed prerequisite.

That tests the essential interaction—nonlinear skim, increasing depth, previous/next, depth control, keyboard navigation, and profiled selection—while actually reusing the highlight set Greg named. If priority order proves insufficiently coherent, add a small second-stage model call that only orders/selects existing quote IDs.

A three-position segmented control is appropriate for v1. Greg said “maybe” a slider, while the product has exactly three discrete states; this is not a plan defect.

Verdict: **rethink**.