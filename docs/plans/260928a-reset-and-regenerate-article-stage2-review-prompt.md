# Code review, stage 2: the reset button (plan 260928a)

You are the reviewer **and fixer** for this stage. Repo root is the current directory. Candidate:
commit `2bcff564` on top of `6944d44e`. Diff: `git diff 6944d44e 2bcff564`; paths:
`git diff --name-only 6944d44e 2bcff564` — start with `src/web/ResetArticle.tsx`,
`src/web/Metadata.tsx` (`ResetSection`), `src/web/useJobs.ts` (`reset`),
`tests/metadata-reset-section.test.tsx`; that does not limit scope. Spec:
`docs/plans/260928a-reset-and-regenerate-article.md` (the server side is stages 1 and F8 — resets
are single-flight per article and a conflicting second press is a 409).

## What to do
1. An independent attack on the client. Is the reset job actually driven by the tab's job engine
   and found again after a reload (it is identified by `job.reset !== undefined`)? Can the section
   show a wrong state — a stale "done", a spinner that never ends, a failure that vanishes, a
   regeneration list that differs from what the server will do? Is it gated on the experimental
   switch? Does the reader-facing copy make any claim that the code or server contradicts (read
   the confirm text against the plan's *What it keeps*, *What it costs*)? Is the 409 shown in
   plain words? Accessibility of the confirm and checkbox?
2. **Fix what is inside this stage**, narrowly and red-first (these are jsdom tests; you can run
   them: `npx vitest run tests/metadata-reset-section.test.tsx tests/reset-extra-names.test.ts
   tests/metadata-rerun-section.test.tsx tests/client-imports.test.ts`). **Report, do not fix**,
   anything wider. Do not commit. Do not touch the database. Do not start a dev server.

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract
violated; P2 design risk; P3 prose. Refuse only on an established P0/P1 with file:line evidence.
IDs continue from F9. For each finding say fixed (files) or reported. End with a verdict.

## My own suspicions (worth less)
- After the reset, the reading view still holds the old article in memory; the builder chose a
  "Reload" button. Is that honest and sufficient?
- Which extras are named comes from `StageState.done` on the client and from non-null columns on
  the server — can they differ in a way the reader would notice?
- `RESET_EXTRA_NAME` is a second list beside `src/reset.ts`; a test holds them equal. Worth moving
  `RESET_ROLE`/`extraSteps` into a client-safe leaf instead? (Report only.)
