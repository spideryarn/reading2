## Findings

- **F1 — P1 — fixed:** A jump to a missing block did not cancel an older glide, allowing the older callback to later report `settled` and flash the wrong destination. Fixed by cancelling before reporting `missing`. Red → green: `is cancelled by a newer scroll whose target is missing`. [scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/scroll.ts:779)

- **F2 — P1 — fixed:** A covered pending flash survived when a newer jump began but was subsequently cancelled. Exposing the prose could therefore resurrect the older destination. `beginJump` now drops the superseded pending flash immediately. Red → green: `drops an older covered landing when a newer jump begins but is cancelled`. [keynav.ts](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/keynav.ts:353)

- **F3 — P1 — fixed:** The delegated card could remain attached to a removed anchor, leaving Floating UI positioned against detached DOM. It also retained stale content if the provider index changed while React preserved the anchor. Added open-only detachment observation and index-driven content refresh. Both behaviors were reproduced red before passing. [BlockLinkCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/BlockLinkCard.tsx:181)

- **F4 — P1 — fixed:** Escape did not cancel a pending hover-open timer, and a touch arriving while a mouse-open card existed left that card behind. Both dismissal paths now close correctly. Red → green tests cover pending Escape and touch takeover. [BlockLinkCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/BlockLinkCard.tsx:256)

- **F5 — P1 — fixed:** Search-result paragraphs conflicted with the flash’s `box-shadow`. Animated flashes erased the literal-search rail temporarily; under reduced motion, later search rules replaced the still flash completely. The shadows now compose for literal search, while semantic-search rows receive a sufficiently specific still wash. Three CSS regression checks went red → green. [prose.css](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/styles/prose.css:145)

- **F6 — P2 — fixed:** Reader unmount cleared only a pending flash; a live flash retained its detached cell and timer until the 1.2-second timeout. `resetFlash` now clears both. Red → green timer test confirms no timer remains. [flash.ts](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/flash.ts:89), [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/reader/Reader.tsx:521)

## Verification

- Requested four suites: **56 tests passed**
- Thirteen broader related suites: **228 tests passed**
- Typechecking wrapper via `node --import tsx`: all four projects passed; all 2,270 source files covered
- Exact `npm run typecheck`: **exit 1**, before compilation, because the sandbox denied tsx’s `/tmp/tsx-1000/*.pipe` IPC socket
- `npm test`: **exit 1**, because local Postgres/Docker was unavailable; it did not produce a test verdict
- Targeted lint: no errors; three existing complexity notices
- `git diff --check`: passed
- No commit made. The pre-existing untracked review-prompt file was untouched.

**Verdict: approve with the working-tree fixes. No unresolved stage-local findings.**