# Code review: 261007l, an Opus check over Referee's hidden-text findings

You are reviewing and fixing one commit in this worktree: `766624567` (diff: `git show 766624567`).
The spec is the plan, `docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md`,
including § Review of this plan (seven findings from your own plan review, all taken). The plan review is
`docs/plans/261007l-hidden-text-opus-check-plan-review-sol.md`.

**Fix what is inside this commit's scope, narrowly, each fix red-first** with the test that reproduces it
(write the test, see it fail, fix, see it pass). **Report, do not fix, anything wider.** Do not commit (you cannot
in a linked worktree anyway). Do not quote or attribute any words to Greg anywhere. Do not edit
`src/injection-scan.ts`.

Tests you can run yourself (no network needed): `npx vitest run --project unit tests/referee-hidden-check.test.ts
tests/hidden-check-panel.test.tsx tests/hidden-check-stream.test.tsx tests/source-scan-notice.test.tsx
tests/referee-notices.test.tsx tests/call-failure.test.ts tests/client-imports.test.ts`. The route test
(`tests/referee-hidden-check-route.test.ts`), `tests/high-power-routes.test.ts` and `tests/referee-stream-lifetime.test.ts`
need Postgres; I ran them before this review: the private-postgres lane passed in full (229 files, 3792 tests), and
the twelve unit suites above passed (252 tests). `npm run typecheck` is clean.

The implementer's own notes, to check rather than trust:
- Verdict literals are `probably-harmless` / `worth-a-look` (not `typography`, because page-furniture rows are not typography).
- `max_tokens` = 2048 + 300 per sent row, reasoning effort medium.
- The budget stops at the first row that does not fit, so sent rows are always a prefix in panel order.
- The route calls `loadArticle` only to get the article's power, which `powerFor` then overrides.
- The button stays pressable after a run; a second press runs and pays again.
- Weakly tested: the prompt wording (not mutation-tested), "verdict words are the app's" (not mutation-tested), the answer
  surviving a chip change (a source-text tripwire, not a render test), the hook's one-run-at-a-time and abort on slug
  change (not mutation-tested), and the ownership refusal (the route test would not go red if `shelfStore.read` were removed,
  because `loadSource` is owner-filtered too).

Look hardest at:
1. The security property: can anything in the model's answer reach `ordered`, `grouped`, the headline counts, the open
   default, or `sourceScanMark`? Can a reason disguise, overlap or reorder anything when drawn?
2. Validation and the binding of each judgment to its checked inputs (`checkedInputs`/`sameInputs` in `src/scan-groups.ts`).
3. Caps and budget in the prompt builder: is any attacker-controlled field uncapped on its way into the prompt?
4. The stream: malformed frames, a stream that just stops, the reader leaving (`gone` aborts the paid call), error sentences.
5. Anything that would make the shared leaf `src/scan-groups.ts` behave differently from the old inline `ordered`/`grouped`.

Severity scale: P0 (security or data loss), P1 (wrong behaviour shipped), P2 (worth fixing), P3 (nit). Give every
finding an ID (C1, C2…), severity, evidence (file:line), and say whether you fixed it (with the test) or are reporting it.
End with a verdict: land / land after fixes / do not land.
