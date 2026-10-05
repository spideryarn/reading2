No runtime regression found in the candidate. I fixed two prose findings and reproduced one wider defect, which remains untouched.

- **C1 — P3, fixed:** [scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/src/web/scroll.ts:650) and the mobile test comment still described a destination measured once using `stickyOffset`; `aimAt` now remeasures using `stickyDestination`. The settlement test also referred to the deleted window expiring. Corrected after failing temporary text checks.
- **C2 — P3, fixed:** The [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md:59) claimed Diagram’s timer and glide necessarily “stay in step.” Their separate callbacks provide no such guarantee. Corrected after a failing check.
- **C3 — P1, wider; not fixed:** [DiagramPanel’s chain timer](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/src/web/DiagramPanel.tsx:1283) can expire while a glide remains pending. A second Next press then repeats the first target. I independently ran the [controlled reproduction](/tmp/261005-review-diagram-bucfabu3/diagram-review.test.tsx:526): expected `[spya-b2, spya-b3]`, received `[spya-b2, spya-b2]`. Browser frequency is unmeasured.

Validation:

- Requested suite: **7 files, 107 tests passed**, including after all edits and mutation restoration.
- Actual parent code: both late-event tests failed at the intended assertions.
- Clock and tolerance mutations, separately for anchor and bar: **all four detected**.
- The quarter-pixel test covers F1, rather than the original incident. The jsdom tests prove handler behavior, not browser timing.
- Typecheck passed through `node --import tsx scripts/typecheck.ts`; the npm entry point hit sandbox IPC denial. Scoped lint and whitespace checks passed.

Retaining `ourScrollY` after instant moves or `scrollToTop` is consistent with the new rule: a different position is processed immediately. The cited history is accurate; no further defect found in the three project-doc additions.

Only comments and postmortem wording changed. Nothing committed.

VERDICT: approve with changes