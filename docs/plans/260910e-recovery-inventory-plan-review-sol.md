Not ready — established P1s F1–F4 permit unsupported classifications or loss of a later recovery episode. No P0 found.

### F1 — P1 · established: an ordinary final session close is classified `interrupted`

(a) Concrete scenario:

1. Baseline: producer run A, tmux G1, one working session.
2. That session exits normally; because it was the last session, tmux exits.
3. The next successful snapshot is run A, `rows: []`, `tmuxServerPid: null`.
4. The candidate is `generation: "unverifiable"`, `producerRun: "same"`, `watched: true`.

The table correctly calls this `unknown` ([plan line 79](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:79)), but classifier step 5 calls every watched `unverifiable` disappearance `interrupted` ([line 187](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:187)). The generation relation itself says null means unverifiable, not changed ([diff.ts line 838](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/diff.ts:838)).

(b) Replace classifier steps 5–6 with:

> 5. **`interrupted`**: `watched` is true and either (a) `generation` is `changed`, or (b) `generation` is `unverifiable` and `producerRun` is `changed`; and none of the preceding arms matched.  
> 6. **`unknown`**: everything else. In particular, `generation: "unverifiable"` with an unchanged or unreadable producer run is indistinguishable from the final session closing normally, and every `watched: false` record is unknown.

Also change the `tmux kill-server` table row to say it is classified `unknown`: it is observationally identical to the ordinary final-close case.

### F2 — P1 · established: `resumed` matches a stale claim and does not require a replacement execution

(a) The current contract explicitly says `claimedConversationId` can outlive its conversation ([observation.ts line 182](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/observation.ts:182)); for `conflicting`, `observed` is the live conversation and `claimed` is stale ([wire.ts line 1782](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/wire.ts:1782)).

Concrete false resolution:

- Candidate entry claims C, but its final verified reading is `conflicting { claimed: C, observed: D }`: interrupted work was D.
- A later execution genuinely runs C.
- The plan matches that current execution against the candidate’s claim C and records D’s candidate as `resumed`.

Separately, a temporarily omitted row returning with the same execution token is also marked `resumed`, although the roadmap requires a “replacement execution” ([roadmap line 1560](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1560)).

(b) Replace the `resumed` and `superseded` bullets with:

> - Define a candidate’s verified conversation as `lastSeen.conversation.id` for `verified`, `lastSeen.conversation.observed` for `conflicting`, and unknown otherwise. The stored claim is displayed only as a claim.  
> - `resumed`: a live verified execution has the same non-null verified conversation as the candidate, and its execution token differs from the candidate’s final verified execution token. Evidence records both tokens. A matching conversation with the same token is `already-live` but is not disposed as resumed. Missing prior execution or conversation verification cannot produce `resumed`.  
> - `superseded`: a newer candidate has the same non-null verified conversation. Claims alone never supersede another record.

Replace the transcript/resume bullets with:

> Transcript lookup and resume support use the candidate’s verified conversation. If only a claim survives, the page may show a transcript found under that claim, explicitly labelled unverified, but `resume` remains `not-supported`.

### F3 — P1 · established: the idempotency key violates the spec and conflates distinct disappearances

(a) The roadmap requires “previous execution + disappearance event” ([roadmap line 1556](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1556)). The candidate key contains only session/run fields ([plan line 88](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:88)).

Sequence:

1. A row is absent during a dashboard-run handover, producing unknown candidate X.
2. It returns with the same key, tmux PID, `startedAt`, and execution token.
3. X is dismissed.
4. A later real reboot removes that same run.
5. The second candidate hashes to X; “keep first” leaves the real interruption dismissed, with no new unresolved record or stub.

(b) Replace the idempotency paragraph with:

> **Idempotency.** The id hashes the previous execution identity together with a stable identity for the accepted observation that produced the disappearance. For a readable stamp, that identity is `(producer.instance, producer.inventory)`; otherwise it is the accepted collection’s `collectedAt`, which the admissibility gate already requires to name one invariant collection body. The arrival-time `at` is excluded. Thus a crash re-deriving the same accepted collection produces the same id, while two distinct disappearance collections for the same execution produce different ids. Legacy replay uses a deterministic identity derived from the original disappearance event and its position within its event batch.

Add a test: dismiss one disappearance, reintroduce the identical row, disappear it in a later collection, and require a new unresolved ID.

### F4 — P1 · established: `ended-before-reboot` trusts state from before an unwatched gap

(a) Step 4 accepts either `lastSeen` or the durable entry ([plan line 184](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:184)), before step 6 handles `watched: false`.

A register can say `no-claude`, then while the daemon has no baseline a new Claude can start and be killed by the reboot. `goneWhileAway` produces a candidate with `watched: false`; the plan nevertheless classifies it `ended-before-reboot` from stale pre-gap state.

(b) Replace step 4 with:

> 4. **`ended-before-reboot`**: `watched` is true, `lastSeen` exists, and that immediately preceding accepted observation says `no-claude` or `shell:false`. The page phrases this as “last observed stopped before the world change” and shows the observation clock. `entry` alone, a replay record, or any `watched:false` record cannot establish this classification.

### F5 — P1 · reasoned: a reboot can reuse the numeric tmux PID and erase the old run without a gone event

(a) `tmuxServerPid` is only a PID. The execution-token contract explicitly includes a boot UUID because PIDs and start ticks can repeat after reboot ([wire.ts line 1737](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/wire.ts:1737)).

If post-reboot tmux receives the same numeric PID and a row reuses the same handle/claim, `generationRelation` says `same`. `diff()` can emit only `session-execution-changed`; no `tmux-session-gone` exists for candidate insertion. The pre-reboot work then has no recovery record.

(b) Add under the candidate rule:

> A tmux world is identified by `(hostBootId, tmuxServerPid)`, not by the numeric PID alone. Persist/read the host boot id and treat a changed boot id as `generation: "changed"` before row comparison, even when the tmux PID repeats. Candidate creation must close every old-world register entry before folding rows from the new boot. An unreadable boot id is `unverifiable`, never assumed equal.

### F6 — P1 · reasoned: the legacy “reboot signature” also describes ordinary `goneWhileAway`

(a) With a restored register but no baseline, the current daemon emits `goneWhileAway` closures followed by `diff(null, next)` sightings in one batch ([daemon.ts line 1324](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:1324)). If all old sessions ended normally while the daemon was down and an unrelated G2 session now exists, the log has exactly:

- same-`at` `absent-from-snapshot` gones emptying the register;
- next `session-seen` under a different PID.

That proves a world change, not interruption. The replay section does not say what `watched` becomes.

(b) Append to the legacy-signature bullet:

> This pattern is also the exact shape produced by `goneWhileAway`; therefore derived candidates from it always use `watched: false` and classify `unknown`. Only an explicit historical `why: "tmux-server-changed"` establishes that the daemon compared two baselines and may use `watched: true`.

### F7 — P2 · established: several named types/files do not build as written

(a)

- `RecoveryCandidateEvent.entry` is non-null ([plan line 38](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:38)), while legacy replay constructs `entry: null` ([line 154](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:154)).
- Adding recovery arms to `OverseerEvent` makes the exhaustive switches in `foldOccurrences` ([jobs.ts line 980](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/jobs.ts:980)) and `describeEvent` ([status-cli.ts line 131](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/status-cli.ts:131)) fail typecheck, but neither file is in Stage 1.
- If `recovery-replay-done` remains, there are three new event arms, not the stated two.
- The present `openStore` computes only one replay from `current.json`’s cursor ([store.ts line 3168](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/store.ts:3168)); recovery needs a genuinely independent replay from its older cursor.

(b) Replace the event field with:

> `entry: RegisterEntry | null; // null only for a legacy stub whose original entry is unavailable`

Replace Stage 1’s file paragraph with:

> `tools/overseer/jobs.ts` and `tools/overseer/status-cli.ts` explicitly handle every recovery event arm; `store.ts` parses the recovery family independently and performs two bounded replays after the single torn-tail repair—one from `current.json`’s cursor and one from `recovery.json`’s cursor. The recovery fold must never receive only the tail selected for `current.json`.

### F8 — P2 · established: the worktree path and transcript mtime do not exist where named

(a) `entry.worktree` is a directory name, not a path; `worktreeOf()` returns only the segment after `worktrees` ([collect.ts line 280](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/collect.ts:280)). `findTranscript()` returns path/via/copies, not mtime ([transcript.ts line 328](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/fleet/transcript.ts:328)).

(b) Replace the evidence bullets with:

> - `worktree`: `entry.worktree` is display text, never a stat target. A worktree path is recorded only when `entry.meta.dir` itself is under `.claude/worktrees/<entry.worktree>`; stat that absolute `meta.dir`. Otherwise report `not-recorded` rather than reconstructing a path.  
> - `transcript`: call `findTranscript(...)`; on `found`, stat its returned absolute path once to obtain mtime. `findTranscript` itself does not return mtime.

### F9 — P2 · reasoned: appending replay-derived candidates plus a marker is unnecessary design

(a) The original session events already are the durable evidence. Appending synthetic replay candidates and `recovery-replay-done` adds another event kind, startup mutation, duplicate-tail recovery, and parser/fold cases. A missing recovery checkpoint can deterministically derive the same index again.

(b) Replace lines 158–161 with:

> Legacy candidates are derived directly into the in-memory recovery fold and then written to `recovery.json`; they are not appended to `events.jsonl`, and there is no replay-done event. Existing live candidate/disposition events are folded normally. Deterministic legacy IDs make rebuilding after loss of `recovery.json` produce the same records and allow later disposition events to reattach.

This is the smaller design with the same durability guarantees.

### F10 — P2 · established: the overflow instruction points to data the CLI cannot list

(a) Beyond 500, candidates are omitted from `recovery.json`, while `list` reads only that file. The page nevertheless says the CLI contains all older records ([plan line 135](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md:135)).

(b) Replace the first-page wording with:

> The CLI lists every record retained in the bounded recovery index. When `overflow > 0`, neither the page nor the CLI claims to list those omitted records; both say that their full events survive only in `events.jsonl`, with the exact overflow count.

The core same-append ordering is sound, and the separate recovery cursor can be sound if it truly drives its own replay. A dashboard restart does not flood candidates for every session—only rows that disappear during the handover—but those records correctly remain `unknown`. No tests were run: this was a read-only plan/code audit, and the blockers follow directly from the declared event sequences and types.