# Code review: Situate stage 4, the landing gap (261024o)

You are reviewing a **small uncommitted change** in this worktree for Spideryarn. House rule: fix
what you find inside it, report anything wider. Do not commit, push, deploy, touch production,
`.env.local`, `infra/` or systemd, or make paid calls. Never run git commands that discard work.

A real browser run of the Situate dossier (plan
`docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md`;
results in `docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md`
§ The built step, run for real) showed that when a first run's job finished, the section drew the
before-run "Search the literature" button and disclosure for one poll, until the refresh read
landed. The fix: `src/web/useSituate.ts` wraps the `onFinished` it gives `useStepJob` so a `landing`
flag is true from the job's end until `refresh()` settles, and reports `starting: queue.starting ||
landing`. Tests: `tests/situate-dossier.test.tsx`, describe "a run finishing while its read is still
out". Diff: `git diff HEAD -- src/web/useSituate.ts tests/situate-dossier.test.tsx`.

Also in the diff, prose only: the investigation's new section, the plan, and the feedback note
`docs/user-feedback/261023_2305-sources-situate-the-piece-in-the-literature.md` — check that every
claim in the note and the investigation is true of the code and the numbers (the ledger figures are
in the investigation; the queue ids are real).

Look at: can `landing` stick true (a job cancelled or failed, the slug changing mid-read, an
unmount); does reporting `starting` during landing break `useRewriteHold`'s waiting state, the Stop
button, or `JobProgress`; is this the pattern other hooks should share (say so, don't refactor).
Grade P0–P3 with IDs (`L1`…); run `npx vitest run tests/situate-dossier.test.tsx
tests/rewrite-hold.test.tsx tests/read-error-matrix.test.tsx` and the typecheck (`node --import tsx
scripts/typecheck.ts` if tsx's pipe is blocked). One-paragraph verdict.
