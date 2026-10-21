## Findings

F1 — Medium — [PrivacyPage.tsx](/var/tmp/spideryarn-worktrees/chat-reading-progress/src/web/PrivacyPage.tsx:230) overstated the disclosure as applying to every chat. The code excludes Candidates and omits the line when reading-time loading fails ([routes.ts](/var/tmp/spideryarn-worktrees/chat-reading-progress/src/routes.ts:4048)). I corrected both privacy-page references and strengthened [privacy-page.test.ts](/var/tmp/spideryarn-worktrees/chat-reading-progress/tests/privacy-page.test.ts:225). `docs/project/privacy.md` was already accurate.

F2 — Medium — [261020g-chat-reading-so-far-measured.md](/var/tmp/spideryarn-worktrees/chat-reading-progress/docs/investigations/261020g-chat-reading-so-far-measured.md:64) overstated the evidence. The verdicts and keys show 9 old replies and 6 new replies marked with problems—not 9 and 4—and only 4 of the cited 13 tool calls came from line-bearing arms. I corrected the counts and bounded “never leaked” to the tested runs.

F3 — Low — The eval artifacts recorded the reading arm but did not hash the file containing the experimental line. I added `reading-so-far.ts` to future provenance hashes in [run.ts](/var/tmp/spideryarn-worktrees/chat-reading-progress/evals/chat-principles/run.ts:465) and documented that the completed artifacts lack it.

F4 — Low — Coverage did not prove that Candidates avoids the store read, that a failed read still answers without the line, or that the composed help turn preserves its forbidden-word rule. I added those checks in [chat-reading-route.test.ts](/var/tmp/spideryarn-worktrees/chat-reading-progress/tests/chat-reading-route.test.ts:148) and [reading-so-far.test.ts](/var/tmp/spideryarn-worktrees/chat-reading-progress/tests/reading-so-far.test.ts:127).

The main implementation otherwise checks out: quiz-equivalent body filtering and 70% threshold, correct `shareWords` boundaries, stored `thread.kind` gating, all typed send/retry/edit/help paths, Live/spoken exclusion, byte-identical cached prefix, pure server-safe imports, and the `ReadingTimeStatus` move.

## Files I edited

- `src/web/PrivacyPage.tsx`
- `tests/privacy-page.test.ts`
- `tests/reading-so-far.test.ts`
- `tests/chat-reading-route.test.ts`
- `evals/chat-principles/run.ts`
- `docs/investigations/261020g-chat-reading-so-far-measured.md`
- `docs/user-feedback/questions/q-rwkq2e.md`
- `docs/user-feedback/261019_2015-the-principles-every-chat-shares.md`
- `src/feedback-endings.generated.ts`

## Checks

- Equivalent full typecheck passed: 3,883 source files covered. The exact `npm run typecheck` wrapper was blocked by sandbox-denied `tsx` IPC, so I ran the same script through `node --import tsx`.
- Five unit/doc suites passed: 97 tests.
- Feedback generated-file check passed.
- Scoped lint exited successfully with informational complexity notices.
- The requested combined Vitest command could not start its private-Postgres lane: sandbox denied `127.0.0.1:54362` and Docker access. Therefore `tests/chat-reading-route.test.ts` remains runtime-unverified here.

Verdict: **push after the listed fixes**. The fixes are already applied; rerun the requested Vitest command where local Postgres is reachable before pushing.