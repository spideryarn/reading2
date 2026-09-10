Refuse.

1. **F21 — P1, established: `replay: not-run` still allows derived dispositions on the accepted-payload path.** The recovery-tick gate is correct, but [`appendDerived()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:888) has no gate and is called directly after accepting an inventory at [daemon.ts:1657](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:1657).

   (a) Start from `recovery.json` with an unresolved candidate; append its dismissal followed by a malformed complete log line, making tail replay `not-run`; then accept an inventory containing the same verified conversation under a different token. The stale fold still says unresolved, so a false `resumed` event is appended and published despite the unseen dismissal.

   (b) Put the invariant at the common write boundary:

   ```ts
   const appendDerived = (): boolean => {
     if (store.recovery.replay.kind === "not-run") return true;
     const derived = deriveDispositions(
       store.recovery,
       inventory.kind === "trusted" ? inventory.rows : null,
       now().toISOString(),
     );
     // existing body
   };
   ```

2. **F22 — P1, established: the bounded inbox scan can permanently starve valid requests.** [`pendingRequests()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/recovery-inbox.ts:135) spends the shared 200-entry budget on `processing/` first, including junk it neither removes nor advances past.

   (a) I created 200 non-request files in `processing/` and one valid dismissal in the public inbox. Six consecutive drains all returned `{applied: 0, refused: 0}` and left the request untouched. The directory iteration restarts at the same junk every tick.

   (b) Preserve the cap but guarantee progress: atomically quarantine every examined non-request entry out of the scanned directories, except the two reserved directories and a recently created `.tmp-*`; quarantine stale temp files after a short grace period. Alternatively persist a continuation cursor. Add a regression with 200 junk entries asserting a valid request is reached on a later bounded pass.

3. **F23 — P1, established: an exceptional daemon shutdown can loop forever while waiting for recovery work.** The source catch awaits [`settleInFlight()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:1206) before timers are cleared in the subsequent `finally` at [daemon.ts:1319](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:1319).

   (a) Set `viewIntervalMs: 0`, use an evidence `stat` slower than `tickMs`, and make the source throw. While the catch waits, each live tick sets `viewWanted`; every completing view starts another, so the loop never quiesces, the lock is never released, and systemd cannot replace the daemon.

   (b) Factor timer cancellation and invoke it before either settlement path:

   ```ts
   const stopTimers = (): void => {
     clearInterval(ticker);
     if (attentionTicker !== null) clearInterval(attentionTicker);
     if (usageTicker !== null) clearInterval(usageTicker);
     if (jobsTicker !== null) clearInterval(jobsTicker);
   };

   } catch (cause) {
     stopTimers();
     await settleInFlight();
     stopHere(/* existing reason */);
     throw cause;
   } finally {
     stopTimers();
   }
   ```

4. **F24 — P1, established: retention can remove a record from the fold while persisting it in the user-facing view.** [`buildRecoveryView()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/recovery-view.ts:519) snapshots expired resolved records before [`checkpoint()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/store.ts:3582) prunes them.

   (a) Restart with a resolved record older than 30 days. The startup pass includes it; publishing that pass calls `checkpoint()`, which prunes the fold and then serializes the already-built view. `recovery.json.records` omits the record while `view.page` still shows it.

   (b) Apply the same retention predicate before sorting the view:

   ```ts
   const checkedAtMs = deps.now().getTime();
   const checkedAt = new Date(checkedAtMs).toISOString();
   const records = [...index.records.values()]
     .filter(
       (record) =>
         record.resolution.disposition === "unresolved" ||
         checkedAtMs - Date.parse(record.resolution.at) <= RECOVERY_RESOLVED_RETENTION_MS,
     )
     .sort(recoveryOrder);
   ```

5. **F25 — P2, established: a malformed derived `view` can crash an otherwise readable CLI index.** `readRecoveryIndexFile()` deliberately returns `view` unvalidated, but [`describeEvidence()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/scripts/overseer-recovery.ts:107) dereferences `dir.kind`, `transcript.kind`, and `lastActivity.source` after casts.

   (a) In an otherwise valid `recovery.json`, change one view item’s evidence to `{"kind":"checked"}`. `list` throws before listing the retained records.

   (b) Make `viewItems`/`describeEvidence` total runtime parsers. Any malformed item should be ignored with `view evidence unreadable`, never dereferenced through a cast.

6. **F26 — P2, reasoned: F20 duplicated the shared transcript locator instead of extending it.** [`transcriptLookup()`](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/recovery-view.ts:333) reimplements UUID validation, slug guessing, scanning, newest-copy selection, and error wording from `tools/fleet/transcript.ts`, contrary to the plan’s explicit reuse rule.

   (a) Any later correction to slugging, relocation, file validation, or duplicate selection in the shared locator will not reach recovery evidence.

   (b) Extract a shared bounded locator in `tools/fleet/transcript.ts`; have both `findTranscript` and recovery call it, with recovery supplying the directory cap.

F15–F20:

- **F15:** Sound for the stale-pass race; F24 is a separate retention mutation not represented by its revision.
- **F16:** Sound; malformed or non-canonical timestamps are refused.
- **F17:** Not sound; F21 is an accepted-inventory bypass. The persistent hold itself is visible in startup output, `list`, and the untrusted view.
- **F18:** Not sound overall because of F22. `O_NOFOLLOW`, bounded reads, async draining, and retained `appliedRequests` are otherwise sound; retention does not drop applied request IDs.
- **F19:** Sound; same-token selection is row-order independent, and a missing previous token cannot invent resumption.
- **F20:** Behaviorally conservative and bounded, but carries the duplication risk in F26.

The F11 boot-change held path does call `trustInventory({kind: "untrusted"})`; I found no route from that arm to trusted classification.