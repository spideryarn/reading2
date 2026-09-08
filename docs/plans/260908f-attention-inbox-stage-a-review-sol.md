I would not approve Stage A yet. The first four findings can produce materially wrong inboxes.

1. **Critical — classifier failure and budget exhaustion publish a false “nothing needs you.”**  
   [attention-pass.ts:196](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-pass.ts:196), [attention-pass.ts:217](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-pass.ts:217), [attention.ts:201](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention.ts:201)

   Concrete reproduction: one ended turn, classifier returns `unreadable` because OpenRouter returns 429. `endedTurns` makes `sessionsRead === 1`, the unreadable verdict produces no observation, and the published result is:

   ```json
   {"kind":"list","items":[],"sessionsScanned":1}
   ```

   That verdict is cached, so the next unchanged pass makes zero calls and repeats the calm result forever. I reproduced this against the current code. Setting `maxCalls: 0` similarly produces an empty list with `overBudget: 1`.

   There are two more variants:

   - `sessionsScanned === 0` returns a calm list, despite the wire comment explicitly calling zero-of-zero a broken probe.
   - `noInputBox` counts as read even though that arm expressly includes an unrecognised dialog; a harness dialog-format change can therefore turn every question into a calm fleet.

   `breakdownBalances()` only proves every row entered a bucket. It does not prove the deciding half ran successfully, and the daemon discards the breakdown before publishing the list.

   I would make completeness part of the published result: no calm list when any candidate is over budget or lacks a valid verdict, do not cache `unreadable`, and distinguish proven non-Claude panes from unrecognised no-input-box panes. A partial-list arm with explicit unclassified counts would preserve findings already obtained; the simpler alternative is `unknown`.

   This also changes the prompt-injection assessment. A crafted tail can induce a valid `{"asked":false}` response and have that false negative cached indefinitely. It can also manipulate topic, rank, grouping, and displayed explanation. It cannot directly send keystrokes or access the API key, so the no-answer-control boundary is valuable—but “the worst is one invented card” is false.

2. **High — `waitingSince` survives exactly the unobserved gap the store says must reset it.**  
   [attention-memory.ts:139](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-memory.ts:139), [attention-cli.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-cli.ts:267), [attention.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention.ts:162), [store.ts:1608](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/store.ts:1608)

   The store deliberately resets its in-memory published list on restart, but `attentionRunner()` reloads persisted waits from `attention.json`. Input:

   - At 09:00, session `$1` asks Q.
   - The daemon stops.
   - Q is answered, then `$1` asks the same Q again while the daemon is down—or tmux restarts and reuses `$1`.
   - The daemon restarts and observes Q at 12:00.

   `rememberWaits()` finds the old key and publishes “waiting since 09:00,” spanning a gap nobody observed. The existing restart test checks only `Store.attention`; it never runs through the persisted attention memory.

   Keep verdict caching across restarts, but reset waits on a new daemon/tmux generation unless continuity can be proven. At minimum the wait key needs the tmux generation or daemon observation epoch.

3. **High — the checkpoint and memory parsers are not total over their claimed types.**  
   [store.ts:1086](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/store.ts:1086), [attention-memory.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-memory.ts:73), [overseer.ts:367](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/scripts/overseer.ts:367)

   `parseAttentionList()` validates `evidence.kind`, two IDs, and the timestamp, then casts the rest. It accepts, among other things:

   ```json
   {
     "id": "x",
     "sessionId": "$1",
     "waitingSince": "2026-09-08T10:00:00.000Z",
     "evidence": {"kind":"dialog"}
   }
   ```

   I wrote that shape into a real checkpoint. `readCheckpoint()` returned a valid `kind:"list"` and `inboxLines()` threw because `duplicates` was missing. Missing `kind`, `sessionName`, arm-specific evidence fields, invalid `answerability`, and malformed duplicate entries likewise escape the parser. `{kind:"dialog"}` is also enough to cross the evidence boundary without a question or options.

   `parseAttentionMemory()` has the same issue: it accepts `classifiedAt: "not-a-date"` and `verdict: {kind:"question"}`, then casts them to `CachedVerdict`.

   Degrading malformed attention instead of rejecting the register is sound. The implementation should exhaustively parse every field and every union arm, returning `unknown`/`unusable` on the first mismatch rather than using either cast.

4. **High — `readTurnTail()` does not actually return only what the agent said.**  
   [turn-tail.ts:300](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/turn-tail.ts:300)

   The backward walk skips rule lines but does not stop at the preceding input prompt. I reproduced this pane:

   ```text
   ❯ Should I deploy this now?

     Done with the implementation.

   ✻ Cooked for 1m 2s · done 1:12 PM
   ❯
   [Opus ...]
   ⏵⏵ auto mode on
   ```

   It returns:

   ```text
   ❯ Should I deploy this now?

     Done with the implementation.
   ```

   The classifier is told all of that is the agent’s finished turn, so a short answer can inherit Greg’s earlier question and become a false attention card. The fingerprint then caches the contamination.

   Stop at the previous input-prompt boundary, or preserve explicit speaker boundaries and refuse captures where the final assistant span cannot be isolated.

5. **Medium — single-flight holds only within one live daemon instance.**  
   [daemon.ts:497](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/daemon.ts:497), [daemon.ts:581](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/daemon.ts:581), [attention-cli.ts:287](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-cli.ts:287)

   `attentionRunning` correctly prevents interval overlap. Shutdown merely clears the interval, however; it neither aborts nor awaits the active pass. `stopHere()` then releases the store lock while the old runner can still finish and write `attention.json`. A newly started daemon—or a default-writing manual CLI invocation—can read and write the same file concurrently, causing duplicate calls, stale overwrite, or a torn memory file.

   Pass an abort signal through classification, await the active pass before releasing ownership, and make the final memory write conditional on still owning the daemon instance. The memory write should also be atomic.

6. **High — the supplied measurement record contradicts its headline in several places.**  
   [plan:238](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/docs/plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md:238), [evidence:1](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/scratch-review-evidence.txt:1), [evidence:69](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/scratch-review-evidence.txt:69)

   Specifically:

   - The comparison labelled as the classifier run reports **2 of 3**, not 3 of 3.
   - The three cold runs contain **2**, not 3, false positives among the 84 repeated confident-negative decisions. A third false positive appears only if the separate comparison run is added, making the denominator 112.
   - The plan says zero ended tails changed over 4.5 minutes. The verbatim evidence says **8 new or changed fingerprints**, hence eight paid calls.
   - The frozen panes were captured at 12:40 UTC, while the dashboard snapshot used for the Fable-labelled comparison says 12:43:42. That is not simultaneous. The genuinely simultaneous 13:10 capture is a different fleet and contains one `needs-you` row.
   - `7/9` is three stochastic readings of the same three positive examples, not nine independent positives. It measures repeatability, not population recall.

   The defensible conclusion is: “On this three-positive development capture, each shipped-prompt run found at least two, while the later dashboard snapshot labelled all three idle.” That supports the mechanism and the narrow observation, not a general recall claim. Freezing the panes was correct, and keeping Fable’s `cannot-tell` outside the negative denominator was also correct. The next gate should be a fresh, held-out, exactly simultaneous capture with human adjudication; the post-fix 8/8 belongs in prompt-development evidence, not validation.

What checked out: `maxCalls` is enforced for the daemon’s fixed finite value, producer sorting is correct, the evidence kinds remain distinct in normal producer flow, permission dialogs are counted and excluded as specified, and `wire.ts` has no imports or runtime declarations. The six relevant test files passed—108 tests—and the browser-only wire compilation passed. The full `npm run typecheck` wrapper was blocked by this sandbox’s Unix-socket restriction.