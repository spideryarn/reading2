# Plan review: long-document follow-ups (261005c)

You are reviewing a plan before it is built. Read-only: change no file.

The plan: `docs/plans/261005c-long-document-follow-ups-stale-sentence-run-codex-overwrite-guard-breadcrumb-paragraph-source-guess-page-cap.md`

It answers a queue item with eight findings, (a) to (h), from an earlier job (plan
`docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`; the
findings are F3 and F4 in `docs/plans/261005a-long-documents-plan-review-sol.md`, F9 in
`docs/plans/261005a-long-documents-stage-d-review-sol.md`, F29 in
`docs/plans/261005a-long-documents-stage-e-code-review-sol.md`). The queue asked for (a), (e), (f),
(g), (h) to be fixed and (b), (c), (d) written up with a recommendation. The plan fixes (e), (f),
(g), (h) and moves (a) to the write-ups.

Check, against the code at HEAD of this worktree:

1. Each of the four fixes: is the diagnosis right, is the proposed fix correct and the smallest
   sound one, and would the named red-first test actually be red today and green after? Files:
   `src/messages.ts` (`ARTICLE_TOO_LONG_FOR_ONE_PASS`), `scripts/run-codex.ts` (end of `main`),
   `scripts/subagent-cli.ts`, `scripts/run-claude.ts`, `src/web/crumbs.ts`, `src/web/tree.ts`
   (`buildSummaryTree`), `src/web/position.ts` (`sectionDepth`), `src/source-guess-run.ts`
   (`defaultFirstPages`, `makeGuessSource`), `src/pdf.ts` (`pass0`, `Pass0Options`).
2. For (g): is "a stored node with no children and not a supplement" a correct test for "this is a
   paragraph" inside `crumbPath`, given what `buildSummaryTree` does at the depth cut? Could it cut
   a legitimate section crumb?
3. For (h): does aborting `pass0` from `onPage` yield the pages read, or reject? Which of the two
   mechanisms the plan offers is right? Is settling `none / source-unreadable` safe against the
   claim and attempt-cap logic in `makeGuessSource`?
4. For (f): can the snapshot rule misfire — keep a stale file, or overwrite a reviewer's report?
   Consider `--launch-dir`, a retry across credentials (several attempts in one run), and
   `sameWriteTarget`, which opens the path in append mode.
5. Is moving (a) to a write-up justified, or is there a small sound fix the plan missed?
6. Are the four recommendations for (a) to (d) sound and stated accurately against the code?

You may run a single test file that needs nothing outside the tree. You have no network and no
database.

Severity scale: P0 data loss or security; P1 a wrong result a reader or an agent will hit; P2 a
defect with a workaround or a doc that will mislead; P3 polish. Say for each finding whether it is
*established* (you observed it or traced an exact path) or *reasoned*. Give every finding an id,
G1, G2, …. End with a verdict: build as written, build with the changes listed, or do not build.
