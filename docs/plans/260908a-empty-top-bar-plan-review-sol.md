Do not build as written: three P1 issues remain.

1. **P1 — The selectors and JS queries confuse application chrome with article markup.** [plan:95](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:95), [scroll.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/scroll.ts:93), [sanitize-policy.ts:593](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/sanitize-policy.ts:593)

   Article classes survive sanitisation; I confirmed `<p class="controls">…</p>` survives unchanged. Once the real bar is omitted, that authored element makes `:has(.controls)` true and becomes the element returned by all three `scroll.ts` queries. `--bar-bottom`, deep-link offsets, `?at=`, transition listeners and the probe can then read arbitrary prose as the bar.

   Scope the semantic selector to the application-owned element everywhere, including JS and tests. For example, `:where(#root > .reader) > .controls` preserves the proposed specificity: the no-bar selector remains `(0,2,0)` and the guarded selector remains `(0,4,0)`. Scope `.mode-band` similarly. Add an authored `.controls` decoy test, following the existing authored-`thead` precedent.

2. **P1 — Stage 2 does not say to remove `commentError` from the predicate.** [plan:117](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:117), [plan:137](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:137)

   Stage 1 needs `commentError` because it still renders the span. After Stage 2 removes that span, retaining the predicate term makes an error render an empty `.controls`, reproducing the 44px jump the stage claims to eliminate. The final test matrix still explicitly includes “error/no error”, reinforcing the wrong contract.

   Either build Stage 2 first, or explicitly say Stage 2 removes `commentError` from `BarContents` and `barHasContent`. Add a final-state assertion that an owner-side transport error produces no `.controls`. If Stage 1 is separately landable, its temporary predicate must use `Boolean(commentError)` to match the JSX’s truthiness exactly.

3. **P1 — `title` makes the transport failure unavailable to a sighted touch reader and contradicts Dock’s accessibility model.** [plan:125](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:125), [Dock.tsx:2652](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:2652), [Tooltip.tsx:275](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Tooltip.tsx:275)

   `DockTab` deliberately has no `title`; it uses a rich tooltip as the description and keeps the stable accessible name “Comments”. The tooltip implementation explicitly records that `title` does not exist on touch devices. Putting the error into the accessible name also changes the control’s identity instead of describing its state.

   Keep `aria-label="Comments"`. Put the error into `ControlTip.state`, an `aria-describedby`-referenced `sr-only` node, and a visible warning mark. Also show the sentence visibly inside the opened drawer so pressing the marked control reveals the failure on touch. Add a Dock test for marker, description, drawer copy, count replacement and `fitSignature` invalidation.

4. **P2 — The proposed verification never exercises the new specificity guard.** [plan:133](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:133), [bar-motion.test.tsx:52](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/tests/bar-motion.test.tsx:52)

   The owner-mode browser cases exercise “no bar”; Hierarchy exercises “bar without mode band”. None exercises the newly modified state containing both `.controls` and `.mode-band`. `bar-motion.test.tsx` uses jsdom and cannot test CSS cascade or geometry. I ran the three named suites: all 67 tests pass, but they do not establish the ladder.

   Add real-browser cases for a visitor in a band mode with `data-bars="hidden"`, and a hidden Hierarchy bar with a focused pill. Cover both ordinary and narrow media; inject nonzero `--safe-top`, and disable transitions or use reduced motion for deterministic measurements.

5. **P2 — The `display:none` alternative is dismissed on a false premise.** [plan:157](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md:157), [scroll.ts:161](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/scroll.ts:161)

   A `display:none` element generates no flow box. Its zero rect also makes both sticky-offset functions return `safeTop`. The existing `:has(.controls)` guard would indeed need changing, but this plan is already changing it.

   Reconsider the smaller CSS-derived version: hide a scoped empty bar with `:empty`, and make the root guard test the scoped non-empty bar. That removes the duplicated predicate/JSX contract entirely. If actual DOM absence remains a diagnostic requirement, state that as the reason; the current layout and scroll arguments do not establish it.

The specificity calculations themselves are correct: `(0,4,0)`, `(0,2,0)`, `(0,2,0)`, `(0,1,0)`. The tie is harmless, including inside `narrow-window.css`, because its later hidden-state rule only adds `--dock-bottom`. Safe areas and reduced motion do not change the cascade. The `-2F` separation is also sound: it is the Dock’s deliberate mode-exit policy, not the empty top bar’s cause.