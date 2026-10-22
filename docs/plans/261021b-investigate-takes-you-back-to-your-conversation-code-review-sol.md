1. **should-fix** — [Reader.tsx:2893](/var/tmp/spideryarn-worktrees/fbnhwy3d-investigate-thread/src/web/reader/Reader.tsx:2893): arrival could open a chat over an unfinished Referee annotation. Added `annotating` to `occupied`, updated the documentation, and added a regression test that failed before the fix.

2. **nit** — [reception-lens-in-chat.test.tsx:806](/var/tmp/spideryarn-worktrees/fbnhwy3d-investigate-thread/tests/reception-lens-in-chat.test.tsx:806): the tests did not prove the two named races. Summary loading is now controllable, proving that an occupied visit stays spent after becoming empty and that late summaries cannot replace a fresh Chat navigation.

3. **nit, no change recommended** — [Reader.tsx:2899](/var/tmp/spideryarn-worktrees/fbnhwy3d-investigate-thread/src/web/reader/Reader.tsx:2899): the added memo dependencies are necessary and do not materially increase rendering because `SourcesBand` already re-renders with `Reader`. `note` covers `openComment`; `thread` and `chatDraft` cover every `ChatTarget`; the Help card is panel-local; visitors never mount `InvestigatePanel`.

Checks: targeted suites passed, 442 tests with 18 skipped; the full typecheck script passed all four projects. The `npm` wrapper itself hit a sandbox `tsx` IPC error, so the same script was run directly. Full `npm test` could not start because local Postgres/Docker was unavailable. No commit made.

Verdict: **approve after the annotation fix; no remaining blocker or should-fix finding.**