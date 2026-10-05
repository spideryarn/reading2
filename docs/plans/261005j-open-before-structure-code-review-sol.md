Fixed six defects within scope. No commits made.

- **F1 — P1 — ESTABLISHED — FIXED:** failed article reads left Structure saying “being built” indefinitely. Added an honest failed-check state and a **read-only retry**. Changed the hook, owner wiring, notice and messages; hook and notice tests saw red then green.
- **F2 — P1 — ESTABLISHED — FIXED:** an in-flight read could install an older tree after a new Structure job began. Active work now invalidates that read. Real-hook regression saw red then green.
- **F3 — P1 — ESTABLISHED — FIXED:** after a stall, a new job first observed already `done` never triggered another read. The hook now also hears completion signals. Real-hook regression saw red then green.
- **F4 — P2 — ESTABLISHED — FIXED:** image redraws cleared genuine Diagram hover, keyboard selection and Outline’s held row. Resets now follow stored-node identity. Redraw tests saw red then green; separate mutations verified genuine replacement still resets state.
- **F5 — P2 — ESTABLISHED — FIXED:** resumed imports rebuilt their completed temporary outline. Marked, unpublished imports now count that work as done; published successors still replace it. Unit regression saw red then green. Production normally has 740 seconds against assets’ 185-second budget, so ordinary production looping was **not established**. The revised short-claim queue test remains unexecuted.
- **F6 — P2 — ESTABLISHED — FIXED:** the new step detail falsely attributed headingless windows to headings. Notice copy also claimed knowledge of building/failure that visitors lack. Wording now describes only what is known. Headingless-step and notice tests saw red then green.
- **F7 — P2 — ESTABLISHED — FIXED coverage / LEFT verification:** added tests for `boundToOlderBase`, recovery after that holder terminalises, live queue-slot adoption, and an earlier-queued mode meeting the gate. **Postgres setup was denied by the sandbox; none executed, and no red-green is claimed.**
- **F8 — P2 — REASONED — LEFT:** the gate’s read and Sentry logging. Reading before freshness skipping prevents a bypass; it affects only structure-dependent steps. Existing blocked refusals use the same error-reporting path. Changing that convention is wider policy work.
- **F9 — P2 — REASONED — LEFT:** live replacement after final-headings `StructureNotice` retries. The notice split is clean. Extending replacement to that lifecycle also requires coordinating arc refresh; it is larger than a small notice edit.
- **F10 — P2 — ESTABLISHED — LEFT:** older fallback detail clauses still say “from its headings,” although that builder can produce windows. This predates the new early-publication clause; it remains a wider copy correction.

The original plan findings resolve as follows:

| Plan finding | Code assessment |
|---|---|
| F1 | Closed, with the redraw correction and real keyboard-focus coverage above. |
| F2 | Closed. Removing the real hook’s freshness barrier made its stale-list test fail. |
| F3 | Deliberately narrowed: older-base deduplication is reported, then owner recovery is offered. Added database test awaits execution. |
| F4 | Deliberately narrowed: earlier modes can end `blocked`; the message explains recovery. Added ordering test awaits execution. |
| F5 | Closed: ordered structural-field comparison, direct fetch, normalization and request/session fencing. |
| F6 | Closed: temporary-outline wording makes no authored-heading claim. |
| F7 | Closed: explicit, exhaustive source handling; early detail corrected above. |
| F8 | Closed: arc is not swapped; generation waits without spending its once-guard. |
| F9 | Closed: keyboard aim follows the replacement depth. Image redraw reapplies the unchanged fallback harmlessly. |
| F10 | Closed: subscriptions and actions stay behind the owner boundary. |

`publishRevisionIn` reads the previous tree under the article lock and uses one combined main-mode predicate. Resets intentionally use their own regeneration list. Excluding imports that themselves contain structure-dependent steps from `headingsFirst` is sound. Retry reconstructs the request; hand-back preserves step JSON; adoption recalculates eligibility; reset and “Read this” remain full builds. The unconditional owner Structure subscription is quiet and starts nothing by itself.

Validation: **173 focused assertions passed**. The three presentation assertions—including Expanded—and the under-minimum guard were separately mutation-checked. Publication-clause mutations remain unverified. `npm run typecheck` hit the sandbox’s IPC restriction; invoking the **same script** with `node --import tsx scripts/typecheck.ts` passed all four projects. Scoped lint had existing advisories. No full suite or `npm run check` ran.

Every file changed by this review:

- [src/messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/messages.ts)
- [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/pipeline.ts)
- [DiagramPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/DiagramPanel.tsx)
- [OutlinePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/OutlinePanel.tsx)
- [ArticlePage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/article/ArticlePage.tsx)
- [useLateStructure.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/article/useLateStructure.ts)
- [StructureArriving.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/modes/structure/StructureArriving.tsx)
- [diagram-panel-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/diagram-panel-hover.test.tsx)
- [late-structure.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/late-structure.test.tsx)
- [open-before-structure-queue.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/open-before-structure-queue.test.ts)
- [outline-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/outline-panel.test.tsx)
- [publication-of-an-awaiting-tree.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/publication-of-an-awaiting-tree.test.ts)
- [structure-arriving.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/structure-arriving.test.tsx)
- [structure-step-headings-first.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/tests/structure-step-headings-first.test.ts)
- [261005n postmortem](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/docs/postmortems/261005n-derived-tree-identity-mistaken-for-stored-tree-replacement.md)
- [261005o postmortem](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/docs/postmortems/261005o-a-one-shot-read-guard-must-follow-every-work-episode-boundary.md)
- [261005p postmortem](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/docs/postmortems/261005p-a-successor-completion-rule-must-not-undo-the-producer-on-resume.md)

Concurrent `docs/project` edits are not mine. No Greg quotations were changed.

**Verdict: ready after the listed items**—run the two changed Postgres test files and independently mutation-check the two publication clauses. F8–F10 are wider decisions, not additional blockers for this scope.