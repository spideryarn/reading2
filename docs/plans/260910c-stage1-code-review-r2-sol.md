The two commits as committed do not satisfy the guarantee, so I refuse them on F17–F21. The amended, uncommitted worktree fixes every established P1; I found no remaining P0/P1 in Stage 1.

## Findings

1. **F17 — P1, established: payload/refusal arrival order was reversed by React batching.**

   (a) Deliver an enabled payload, then resolve `answering-disabled` in the same `act`. The old layout-effect ref still named the preceding commit, so the enabled payload incorrectly cleared the later refusal and restored three buttons.

   (b) [useFleetState.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/useFleetState.ts:53) now records the latest delivered payload synchronously; [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/App.tsx:231) latches against that delivery boundary.

2. **F18 — P1, established: React batching erased intermediate continuity evidence.**

   (a) Two same-turn mutations failed before the fix:

   - `conflicting → unknown` lost the established transcript conflict.
   - `question A → no question → identical question A` retained the old dialog refusal and withheld the new dialog’s buttons.

   (b) Each low-frequency transport snapshot is now committed atomically with `flushSync` at [useFleetState.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/useFleetState.ts:99). A postmortem records the event-versus-snapshot failure class: [260910b-react-batching-erased-transport-evidence.md](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/docs/postmortems/260910b-react-batching-erased-transport-evidence.md).

3. **F19 — P1, established: two current-server transcript refusals masqueraded as old-server answers.**

   (a) `/api/messages` produced unstamped responses when the session row was absent and when the supposedly non-throwing reader rejected. Under an asked claim C, the browser accepted both instead of producing `moved`.

   (b) The 404 now stamps `null`; the catch arm stamps the captured row claim in [server.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/server.ts:768).

4. **F20 — P1, established: the `moved` refusal made claims the evidence did not support.**

   (a) A null stamp was described as a transcript read after the session “had already moved.” But null can mean that no row—and therefore no transcript read—existed. C→D→C also makes “wait until this page catches up” false.

   (b) [RecentMessages.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/RecentMessages.tsx:832) now says only that the answer named a different claim, and offers a truthful “Read again … as it is now” action. The null-stamp test was red before this final wording.

5. **F21 — P1, established: Questions claimed a refusal withheld buttons that could never exist.**

   (a) Draw a dialog item, no corresponding readable row, and an App refusal. No option buttons were eligible, but the alarm said the refusal withheld them.

   (b) [QuestionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/QuestionsPanel.tsx:32) now shares the row/target eligibility predicate between the actual button gate and the panel-level alarm.

6. **F22 — P2, established: the provenance wrapper stamped mutable post-await options.**

   (a) Start `readRecentMessages` with `claudeSessionId: null`, mutate the options object to a UUID before it settles, and the old code returned the UUID stamp.

   (b) [transcript.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/transcript.ts:1065) snapshots the primitive options before awaiting.

7. **F23 — P2, established coverage gap: first-known world and claim were mutation-survivors.**

   (a) Changing the first-known epoch from `0` to `1` passed the old suite and erased a draft on `null → first known`.

   (b) Added a regression covering first-known tmux world and first-known claim independently. It failed under that mutation.

8. **F24 — P2, established coverage gap: two provenance policies were mutation-survivors.**

   (a) Exempting `unreadable` mismatches, or accepting a present non-string/non-null stamp as unstamped, passed the old suite.

   (b) Added explicit regressions: unreadable mismatches become `moved`; malformed present provenance becomes `no-answer`.

## The questions that did hold

- The render-phase `setLastConflict` and permission-refusal clearing are guarded against loops. Updates from an abandoned render are discarded; the maps and returned epochs cannot partially commit.
- The held key behaves correctly for known→null→same, known→null→different, first-sight null→known, and disappearance/return. All three epoch calculations describe the same render.
- Empty-string claims are correctly unknown: collection normalizes them to null and the transcript reader treats them as no ID.
- `readRecentMessages` stamps every internal return arm through its wrapper. `routes-recent-feed.ts` safely ignores the additional field because it keeps each reading coupled to the row supplied to that read.
- A response after C→D→C is protected by the newest-request counter; the corrected refusal copy no longer assumes which claim is current.
- Removing each accepted round-one protection—conflict retention, arrival-time latch, permission clearing, the shared Questions latch, held-known keying, or provenance comparison—made its regression fail.

## Verification

- Final affected suite: **569/569 passed**.
- Expanded fleet suite: **3,201/3,202 passed**. The sole failure was unrelated and environmental: `mkfifo … EPERM` in `fleet-readiness`.
- TypeScript: all four projects passed; all 1,938 source files covered.
- `git diff --check`: passed.
- No commit made.

Files I changed:

- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/App.tsx)
- [useFleetState.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/useFleetState.ts)
- [QuestionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/QuestionsPanel.tsx)
- [RecentMessages.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/RecentMessages.tsx)
- [server.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/server.ts)
- [transcript.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/transcript.ts)
- [fleet-web.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-web.test.tsx)
- [fleet-questions-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-questions-panel.test.tsx)
- [fleet-transcript.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-transcript.test.ts)
- [260910b-react-batching-erased-transport-evidence.md](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/docs/postmortems/260910b-react-batching-erased-transport-evidence.md)

The modified plan and untracked review prompts shown by `git status` are concurrent work, not mine.