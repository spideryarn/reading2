The commit closes PR-1’s persisted wrong-answer path, but I found two P1 problems in how the refusal reaches callers. No files changed; this was a static review, using your supplied test results.

1. **S0-1 — P1, established: rename/delete can commit and then report failure.**  
   [pg-chat.ts::rawPgChatStore.rename/remove](/var/tmp/spideryarn-worktrees/learn-rename/src/store/pg-chat.ts:680) commit their transactions before calling `threadsFor`.

   With a normal Chat thread and an unknown `learn` thread, deleting Chat permanently deletes its messages, then the remaining Learn row makes the response fail with 500. Renaming likewise persists the new title while reporting “couldn’t rename.” This exceeds a temporary refusal: the requested change sticks despite the failure response.

   **Do:** read and validate the returned thread list inside the same locked transaction, so an unknown-kind exception rolls back the mutation. Add regression coverage asserting that a refused rename/delete leaves the rows unchanged.

2. **S0-2 — P1, established: the 500 commits a rejected retry/edit into browser state.**  
   [types.ts::UnknownStoredThreadKind](/var/tmp/spideryarn-worktrees/learn-rename/src/types.ts:4042) becomes a scrubbed 500. In [effects.ts::runTurn](/var/tmp/spideryarn-worktrees/learn-rename/src/web/chat/effects.ts:166), only **409** invokes `sink.refused`; a 500 invokes `sink.failed`.

   [reduce.ts::applyTurn](/var/tmp/spideryarn-worktrees/learn-rename/src/web/chat/reduce.ts:1010) handles that failure by committing the optimistic operation. A rejected retry therefore replaces the displayed original answer with an empty error answer. A rejected edit rewrites the displayed question and removes subsequent turns, although Postgres retained them. No repair is requested on this path, so the discrepancy survives until reload.

   **Do:** make this pre-stream refusal use a safe response the already-deployed client recognises as refusal—409 is the existing mechanism. Test retry/edit through the response-to-reducer path, asserting that the original answer and later turns remain visible.

The remaining paths look safe for PR-1:

- New turns, retries, edits and spoken appends validate through `threadsFor` before transactional writes. Realtime and GPT-Live setup load threads before issuing sessions.
- `markHintOpened` does bypass the helper, but an unknown kind produces the existing 400 refusal before any stamp. It cannot mislabel or create a thread.
- `pg-admin` counts threads without interpreting their kinds. The export bundle preserves the raw stored kind; rollback `exportArticle` now throws before writing `chat.json`.
- `exploreNotes` catches read failures and omits its optional digest; `reader_notes` explicitly reports unavailable data. Neither substitutes a thread list used for creation or prompt selection.
- `sweepPending` still updates eligible stale answers before its final read throws, but retains its existing lease/keep conditions and retry path. `finish` does not read kinds, so an answer already underway can finish. Failed live appends restore the words visibly as unsaved in the tab; they are not durably stored.
- The newly exported `threadsFor` is currently used directly only by the test. I found no production caller bypassing the guarded store through that export.

The tests are honest for the **two changed read seams**: reverting only the `threadsFor` guard breaks its test; reverting only the export guard breaks the export test. They do not cover either failure consequence above.

**Verdict: request changes for S0-1 and S0-2 before deploying stage 0.**