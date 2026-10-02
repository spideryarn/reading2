# Code review: summary sentences point at their passage (261002e)

You are reviewing **and fixing** committed code in this worktree (write-capable sandbox).

Candidate: commits `0d03d3e3e..1f323ceea` on this worktree's branch, on base `e23212480`.
`git diff e23212480 1f323ceea --stat` lists every changed path. The code is commit `28f99cdf1`; the
rest is docs and eval results. Start with:
- `src/simple-summary.ts` (prompt, schema, `toParagraphs`/`keptSentences`, `ANSWER_TOKENS`, prompt version)
- `src/types.ts` (`SimpleSentence`, `SimpleParagraph.sentences`, `usableSentences`)
- `src/public/dto.ts`, `src/public-types.ts`
- `src/web/SimplePanel.tsx`, `src/web/styles/summary.css`
- tests: `tests/simple-summary.test.ts`, `tests/simple-panel.test.tsx`, `tests/public-dto.test.ts`,
  `tests/stage-stamp-agreement.test.ts`, `tests/meta-fallback-fingerprint.test.ts`
That list does not limit scope.

The spec is `docs/plans/261002e-summary-sentences-point-at-their-passage.md` (including your own
plan review's F1–F3, accepted). The measurement is
`docs/investigations/261002o-summary-sentences-that-name-their-passage.md`.

Look for, independently first: wrong behaviour a reader could reach; places a stored row without
`sentences` (or with a malformed one) breaks anything (owner read, visitor payload, export, Dock,
simple-check, pipeline stamp); the schema vs the strict-output rules in
`docs/project/prompting-guide.md` § What the model writes back; whether `ANSWER_TOKENS` can still
truncate Fuller; the CSS interacting with the on-screen wash rule (`src/web/on-screen.ts`), the card
(`src/web/BlockLinkCard.tsx`) and `.block-ref-missing`; accessibility; tests that could pass while the
feature is broken.

**Fix what is inside this change**, narrowly, red-first (a failing test, then the fix). **Report, do
not fix**, anything wider. You can run `npx vitest run <file>` for files that need no database or
network; the box's Postgres is not reachable from your sandbox, so say which assertions you could not
run. Do not commit; leave your edits in the working tree.

Severity: P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or a
contract violated; P2 design/maintainability risk; P3 prose. ID every finding (C1, C2…), with
file:line, severity, and whether you fixed it. End with a one-line verdict.

## My own suspicions (worth less; spend most of the run elsewhere)
- `sentences?: unknown` on the type: does anything serialise or compare paragraphs in a way that now
  includes `sentences` unexpectedly (e.g. React keys, dedupe on text, export bundles)?
- A sentence that is a link at rest has no visible cue until hovered or washed — acceptable?
- The `Fragment` with a `" "` separator inside `.simple-text`: whitespace or wrapping oddities.
