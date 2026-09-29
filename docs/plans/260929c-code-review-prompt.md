# Code review — 260929c (no outdated-prompt notice; FAQ and Citations re-run from Metadata)

Reviewer and fixer, narrowly. Candidate: commits `f46e2dc7` and `9f506a03` on branch
`worktree-no-outdated-prompt-notice` (`git show --stat` each). Spec:
`docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md` with its Sol plan-review
ledger in Progress. Do not touch access/visitor code (another session owns it).

Attack:
1. In each of the nine panels: is only the *outdated* notice gone — stale and profile-changed
   banners and their buttons intact, no empty box, no duplicate footer? Does a job on an outdated
   result (started from Metadata) still show its progress, Stop and failure in every panel?
2. Glossary's hidden *Find more* on an outdated list, and Quotes' new status-only foot: right, and
   consistent with each other?
3. The two new Metadata rows: are the three answers in `src/rerun-steps.ts` true (one call, no web
   search for Citations, no prerequisite, safe publish)? Does a forced `citations` run keep the
   links "Find it" stored (ids preserved)? Anything on the Metadata page, the reset card or the
   job queue that assumed exactly ten rows?
4. Docs describing an outdated banner that still exist (grep "older version of the prompt").

Run `npx vitest run tests/trajectory-panel.test.tsx tests/faq-panel.test.tsx tests/citations-panel.test.tsx tests/glossary-compact-header.test.tsx tests/quotes-find-more-panel.test.tsx tests/mode-surface-changes-no-markup.test.tsx tests/metadata-rerun-steps.test.ts tests/metadata-rerun-section.test.tsx tests/metadata-reset-section.test.tsx`
and `node --import tsx scripts/typecheck.ts`. Fix inside this change, red-first; report anything
wider. Do not commit. Severity P0–P3; IDs from **F10**. Verdict: accept / accept after fixes /
reject. Short.
