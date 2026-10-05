The plan has established failures in save ordering, target identity and navigation. Those need resolving before implementation.

I changed no files. `tests/autosaved-text.test.tsx` passed all **19 tests** using `--configLoader runner`; the default loader failed at startup. The passing tests cover the existing hook, not the proposed wiring.

1. **F1 — P0, established: `pagehide` can restore older text.**

   The plan explicitly preserves the queue bypass at [plan:125](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md:125). PATCH A is in flight; the reader types B; `pagehide` sends B independently; the server applies B, then A. The final purpose is A.

   [useAutosavedText.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:165) sends the independent write, and [pg-shelf.ts:389](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/pg-shelf.ts:389) updates without an ordering condition. Idempotence does not help when the values differ.

   **Replacement wording:**

   > “Ordinary and keepalive purpose writes carry ordering information that the server checks atomically before updating the article. An older write cannot overwrite a newer accepted write. The purpose PATCH protocol must change to support this; the current pagehide exception is removed.”

   Client serialization alone cannot provide the requested ordering guarantee during page teardown. Delivery remains best effort.

2. **F2 — P0, established: extracting the existing idle timer unchanged leaves a stopped draft unsaved.**

   Load S, type A and let its PATCH start, then change the box back to S. The hook reports `clean` while `inFlight` remains true. [ProfileBox.tsx:63](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx:63) excludes `clean` from pending work, so [its timer:152](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx:152) schedules nothing.

   When A succeeds, the hook keeps draft S and changes saved to A ([useAutosavedText.ts:199](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:199)). The state becomes dirty, but the unchanged textarea value does not restart the timer. The reader stopped at S; the database stays at A.

   **Replacement wording:**

   > “The idle timer treats an outstanding write as pending even when the draft matches the loaded value. Returning to the loaded value while another save is in flight schedules a correction. Test S → A in flight → S, with no blur or explicit commit, and require the final stored value to be S.”

3. **F3 — P0, established: the proposed `reset()` discards the old article’s correction.**

   The “send, then bump epoch” design at [plan:103](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md:103) is not equivalent to unmount.

   Load S, send A, return the draft to S, then change address. A last-chance flush sees draft equal to saved and sends nothing. Reset fences A’s callback, including its queued correction. A can still update the database. The existing unmount path instead waits for A, then compares and flushes ([useAutosavedText.ts:220](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:220)).

   There is also a **reasoned target-binding risk**: `io.current` changes during render ([hook:130](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:130)), before the address-reset effect. Reset must not use the new render’s slug to flush old words.

   **Replacement wording:**

   > “Reset detaches the old save session, capturing its slug, I/O functions and latest draft. That session finishes any outstanding write and then flushes its latest draft to its captured slug. Its callbacks cannot change the new box. Resetting the UI must not cancel the old session’s corrective write.”

4. **F4 — P0, established: Retry can change the slug without changing the address.**

   [AddPage.tsx:960](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/AddPage.tsx:960) adopts the replacement job. [slugForRetry:4188](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/jobs.ts:4188) can return another published article’s slug for that URL; Retry can also hand back an existing holder at [jobs.ts:3658](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/jobs.ts:3658).

   Concrete path: failed article X has been seeded; another import publishes Y for the same URL; Retry returns Y. The plan resets only on a new address and probes only while unseeded. The box retains X’s saved baseline while subsequent writes target Y. Clearing it can erase Y’s purpose, which the reader never saw.

   **Replacement wording:**

   > “The save session is bound to the confirmed slug, separately from the source address. Retry may change that slug. A target change retires the old session and reads the new target before saving. Preserve reader-entered words, but never carry an untouched seeded value into another article. A clear may erase only the purpose shown for that target.”

5. **F5 — P1, established: the probe can report existence from an offline copy.**

   `/api/reader` is cacheable ([api.ts:937](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/lib/api.ts:937)). On transport failure, `apiFetch` returns cached JSON as HTTP 200 with `x-spideryarn-offline: copy` ([api.ts:714](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/lib/api.ts:714)).

   A previous read can contain `purposeFailed: false`; the article can subsequently be deleted elsewhere. An offline probe then seeds successfully despite there being no current row.

   Also, the handler returns `purposeFailed: false` for missing or invalid slug parameters ([routes.ts:8642](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/routes.ts:8642)). I did not establish a normal job path producing such a slug, so that part is defensive rather than a separate blocker.

   **Replacement wording:**

   > “Seed only from a fresh successful response for the captured, validated slug, with an explicit `purposeFailed: false` and a valid purpose field. An offline-copy response is not evidence that the article exists. Reject responses whose source, slug or probe generation has changed.”

6. **F6 — P1, established: the warning does not protect all departures, especially before seeding.**

   A typed, unseeded draft still has hook state `loading`. The existing `pending()` excludes loading, so extracting [ProfileBox’s warning:166](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/ProfileBox.tsx:166) unchanged attaches no warning.

   Independently, **Back to the shelf** remains an SPA navigation at [AddPage.tsx:1063](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/AddPage.tsx:1063). [Link.tsx:48](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/Link.tsx:48) calls a router that pushes history immediately ([router.ts:1408](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/router.ts:1408)); `beforeunload` does not intervene. Before the row exists, unmount saves nothing. Afterward, best-effort unmount saving still does not satisfy “saved before navigation.”

   **Replacement wording:**

   > “Unsaved work includes reader-entered words before seeding and every outstanding write. App navigation, dismissal and address changes must save and await settlement, or obtain an explicit discard decision, before leaving. The unload warning uses this same predicate. Remove the unconditional pre-row departure exception.”

7. **F7 — P1, reasoned: the probe needs a complete lifecycle, not only a retry count.**

   [Plan:49](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md:49) bounds unsuccessful answers, but specifies neither request deadlines nor rearming after exhaustion. `apiFetch` supplies no fetch timeout ([api.ts:475](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/lib/api.ts:475)).

   A pending request can prevent the give-up path forever. A pre-row failure followed by Retry also needs a fresh bounded attempt. Overlapping probes must not seed twice: the second seed would reset the first save’s queue and epoch.

   **Replacement wording:**

   > “Allow one probe request at a time. Bound each request and the overall attempt; count transport, parsing and purpose-read failures. Consume a successful answer exactly once before seeding. Cancel and fence retired probes. A replacement Retry job starts a fresh bounded probe attempt while preserving reader-entered words.”

8. **F8 — P1, established: several proposed sentences are false on reachable paths.**

   At [plan:113](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md:113), “the import didn’t finish, so there is nothing to save it to” contradicts row creation when the draft opens ([pg-revisions.ts:1269](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/pg-revisions.ts:1269)). An import can fail later while its purpose remains writable.

   “The first modes were queued” is false when automatic modes are off ([pg-revisions.ts:2526](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/pg-revisions.ts:2526)) and on an existing-article completion. “Anything typed since reaches chat” also promises use of words that may still be unsaved. The browser observes completion by polling, so “saved before the import finishes” should name server publication rather than the page’s completion indication.

   **Replacement wording:**

   > Hint: “Optional. Saves after a short pause once the article exists. Automatic first modes use the reason stored when the server publishes the import. For this article only. Never what the article says. You can change it later on Metadata.”
   >
   > Failed or stopped, still unseeded: “Not saved. We haven’t confirmed an article to save this to.”
   >
   > Probe exhausted: “Could not read the article’s saved reason. Your words have not been saved.”
   >
   > Ready: “Ready. Any first modes queued automatically use the reason stored at publication. Later saved changes can shape chat and newly requested generation.”

The stored-purpose display is a reasonable, minimal way to make clearing safe. Keep it: hiding the baseline requires another explicit clearing interaction. However, the plan’s claim that the stored value is **always shown first** is false when the reader typed before the read; describe that path as replacing it with their typed words.

`seed()` → `setDraft(typed)` → `commit()` in one tick is supported by the hook’s synchronous refs ([useAutosavedText.ts:133](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useAutosavedText.ts:133)). The danger is duplicate or wrong-target seeding, not React batching. I found no independent cross-owner read/write hole: both shelf operations use `ownedSlug`.

Extracting `useIdleCommit`, `useUnsavedWarning` and `SaveStatus` is the right reuse; using `ProfileBox` whole would introduce out-of-scope dictation. The hooks should accept explicit pending-work facts, including `inFlight` and unseeded edits. Preserve the existing synchronous navigation claim and source/completion fences; the Done latch alone does not provide those guards.

The extra reader-setting reads are acceptable for a short, bounded probe. I would not add an endpoint solely to avoid them. A single source-and-slug-bound save session, one sequential probe and the existing navigation guard are simpler than loosely coordinated reset, probe and completion refs—but server ordering is still required by the literal `pagehide` invariant.

DO NOT BUILD