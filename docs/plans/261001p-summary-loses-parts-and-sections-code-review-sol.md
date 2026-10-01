Review complete. No in-scope P0/P1 defects; four P2 findings fixed.

### Findings

- P2 — [SummaryMode.tsx:281](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/modes/summary/SummaryMode.tsx:281): the new endpoint buttons were removed from keyboard and accessibility navigation, had no names, and exposed roughly 17px touch targets. A keyboard or screen-reader user could not use the shortcuts, while touch users had undersized targets. **FIXED:** named, focusable buttons with focus/hover tooltips, decorative SVGs hidden, and 44px coarse-pointer targets in [summary.css:61](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/styles/summary.css:61). Main-control tooltips remain immediate-action on touch, matching the project’s documented policy.

- P2 — [pressing-a-chip-arms-it.test.tsx:298](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/tests/pressing-a-chip-arms-it.test.tsx:298): tests explicitly blessed the inaccessible endpoint behavior, and neither visitor endpoint presses nor an actual Summary command-bar row were exercised. That allowed endpoint or command-row activation to leave a token or arm visitors while helper-only tests stayed green. **FIXED:** accessibility, visitor non-arming, and real `Summary › Fuller` command-row activation are now tested; see [command-bar-sub-modes.test.tsx:337](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/tests/command-bar-sub-modes.test.tsx:337).

- P2 — [Reader.tsx:442](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/reader/Reader.tsx:442): the accepted plan-review finding requiring one shared `bandShape` value was not implemented; `fitView` and `notesFit` independently called the helper. There was no current divergence because the helper is pure, but a later change could make Marginalia’s hypothetical fit disagree with the layout it opens. **FIXED:** both consumers now receive one computed value.

- P2 — [types.ts:163](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/types.ts:163), [BlockRef.tsx:5](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/BlockRef.tsx:5), [activation.ts:1](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/activation.ts:1): source comments still assigned Socratic questions, citations, styling, or activation to the deleted Summary outline/“Simple chip.” A future change following those ownership notes would target dead UI. **FIXED:** swept and corrected the affected `src/` comments.

### Wider findings

- P1 — [activation.ts:265](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/activation.ts:265): “Generate the main modes” still omits Summary because `MODE_TARGET.summary` is `none`, so [modeStep:365](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/src/web/activation.ts:365) returns `null`. **NOT FIXED:** this is the plan’s explicitly deferred fb7t-7v product decision.

- P2 — [chat-empty-reads-from-the-top.test.tsx:126](/home/greg/code/spideryarn2/.claude/worktrees/fb7q-7r-summary-remove-parts/tests/chat-empty-reads-from-the-top.test.tsx:126): repository typechecking already fails because this older test omits required `ChatPanel.canStartOver`. **NOT FIXED:** unrelated and present in the parent commit.

Activation, legacy URLs/restoration, visitor behavior, ModeBoundary targeting, deleted exports/classes, and roomy fit/notesFit wiring otherwise checked out.

Verification:

- All nine focused review suites passed, including activation/spend, command-bar, last-view, public network, layout, and Summary panel tests.
- `git diff --check` passed.
- `npm run typecheck` could not start under the sandbox because `tsx` received `listen EPERM`. Running the same checker through `node --import tsx` passed the web, root, and fleet projects, then found only the unrelated test error above.
- Documentation changes visible in the worktree were left untouched. No commit was made.