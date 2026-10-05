# Code review: long-document follow-ups (261005c)

You are reviewing built code, and you may fix what you find. Your sandbox lets you write in this
worktree.

**The candidate** is the four commits `93620b647..HEAD` on this branch: run
`git diff 93620b647..HEAD` and `git log --oneline 93620b647..HEAD`. One commit per item:

- (e) `src/messages.ts`, `src/token-budget.ts` — a stale sentence removed.
- (g) `src/web/crumbs.ts` — the breadcrumb stops at a stored block leaf.
- (h) `src/pdf.ts` (`firstPages` on `pass0`), `src/source-guess-run.ts` (`defaultFirstPages`).
- (f) `scripts/subagent-cli.ts` (`snapshotWriteTarget`, `placeAnswer`), `scripts/run-codex.ts`,
  `scripts/run-claude.ts` — a report the run wrote to `--output` itself is kept.

The plan is
`docs/plans/261005c-long-document-follow-ups-stale-sentence-run-codex-overwrite-guard-breadcrumb-paragraph-source-guess-page-cap.md`;
its section "What the plan review changed" wins over the text above it. Your own plan review is
`docs/plans/261005c-long-document-follow-ups-plan-review-sol.md` (G1 to G9).

**What to do**

1. Attack each fix. Does it do what the plan says, are G1 to G5 and G8 really closed, and does it
   break anything nearby? Run the test files that need nothing outside the tree:
   `npx vitest run tests/headings-crumbs.test.ts tests/pdf-page-cap.test.ts tests/source-guess-run.test.ts tests/token-budget.test.ts tests/run-codex.test.ts tests/run-claude.test.ts`.
   You have no network and no database; do not claim a result for a test you could not run.
2. Mutate: for each fix, break it and confirm a test goes red. Restore every mutation.
3. Check the docs touched (`docs/project/experimental-features.md`,
   `docs/reusable/codex-cli-as-subagent.md`, `docs/reusable/claude-cli-as-subagent.md`) and the
   plan's four write-ups (a) to (d) say what the code does.
4. **Fix what is inside these four items**, narrowly and red-first: write the failing test, see it
   red, fix, see it green. **Report, do not fix, anything wider** you notice. Do not commit; leave
   your changes in the working tree. Do not attribute any words to Greg that are not already
   quoted in the repo.

**Where I am least sure** (read after forming your own view):

- `placeAnswer`: the `holdsSomethingElse` test uses `answerIsUsable(target)`; a kept report under
  `--launch-dir` is placed before the failure ladder, so a run that then fails has already written
  a sidecar. Is anything left in a misleading state on a failed run?
- `runPlan` snapshots at the top and again per attempt. When the model family cannot be resolved it
  returns early; is `targetBeforeAttempt` right there?
- `crumbPath`: a tree that is only root → block leaves now gives an empty trail. Does
  `src/web/HeadingsCrumbs.tsx` draw an empty trail sensibly?
- `pass0` with `firstPages`: does any other field of the result, or the furniture / scan logic,
  misbehave on two pages in a way `defaultFirstPages` would feel?
- (h) changes behaviour: an upload of 151 to 250 pages now gets the one paid search. Is the
  per-owner rate limit still taken on that path?

**Write your report to stdout as your final message** (not to a file). Severity: P0 data loss or
security; P1 a wrong result a reader or an agent will hit; P2 a defect with a workaround or a doc
that misleads; P3 polish. For each finding: an id (H1, H2, …), severity, *established* or
*reasoned*, what you did about it (fixed with the red output, or reported), and the files you
changed. End with a verdict: ship, ship with the fixes made, or do not ship.
