## Findings

- **P2 — [GuideNextSteps.tsx:125](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/web/GuideNextSteps.tsx:125): edited search state leaked into a later answer.** Reproduced red: a second answer offering the same original search retained the reader’s earlier edit. Fixed by including the message id in the React key; regression added.

- **P2 — [next-steps.ts:213](/var/tmp/spideryarn-worktrees/guide-action-buttons/evals/guide/next-steps.ts:213): the paid eval claimed to test terminal-round behavior but never failed on an extra request.** It only recorded `requests` and `lastCallWasSteps`. Fixed by tracking the request containing the accepted sole-tool offer and scoring any subsequent request. Paid evals were not rerun.

- **P2 — [guide-next-steps-tool.test.ts:169](/var/tmp/spideryarn-worktrees/guide-action-buttons/tests/guide-next-steps-tool.test.ts:169): fragile turn-ending cases lacked direct coverage.** Added tests proving usage and truncation survive the shortcut, thrown offers continue, and an empty late offer reaches `MAX_TOOL_ROUNDS`’ tool-disabled final round. Existing mixed `offer_to_save` and stopped/truncated UI behavior remain covered.

- **P3 — stale comments/signposts.** Corrected the terminal conditions in [converse.ts:263](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/converse.ts:263) and [chat-tools.ts:628](/var/tmp/spideryarn-worktrees/guide-action-buttons/src/chat-tools.ts:628), the archive wording, `stepsOf` → `stepsIn`, and the missing plan link in Live documentation.

- **P3 — [security-map.md:118](/var/tmp/spideryarn-worktrees/guide-action-buttons/docs/project/security-map.md:118): the defence inventory does not yet mention this new model-output-to-button surface.** Left unchanged because the hard limit forbids editing listed defences. The implementation itself remains press-only: stored JSON is revalidated, modes/searches pass through `chipFor`, and the row nulls `GuideActContext`.

No P1 findings.

## Verification

- Explicit unit equivalents: **90/90 passed**.
- Doc links: **18/18 passed**.
- Typecheck via the non-IPC entry point: **all projects passed**.
- Scoped lint: no errors; existing `converse` complexity advisory remains.
- The exact requested Vitest command matched no unit files and then could not reach local Postgres from the sandbox. `npm run typecheck` likewise hit sandbox-denied `tsx` IPC; the equivalent non-IPC typecheck passed.

**Verdict: land with fixes.**

Files I changed:

- `docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md`
- `docs/project/live-conversation.md`
- `evals/guide/next-steps.ts`
- `src/chat-tools.ts`
- `src/converse.ts`
- `src/next-steps.ts`
- `src/web/GuideNextSteps.tsx`
- `tests/guide-next-steps-row.test.tsx`
- `tests/guide-next-steps-tool.test.ts`