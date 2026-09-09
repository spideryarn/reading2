## Verdict

**Refuse.** No P0, but F19–F23 are established P1s. F19 directly breaks the central attribution invariant; F21 and F22 permit repeated paid calls.

## Findings

### F19 — P1 — established: a fingerprint collision transfers a description between unrelated sessions

(a) The cache is global and indexed only by the 32-bit fingerprint at [describe-pass.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:166). I found this concrete collision:

```text
opening-229599 → 95984682
opening-432382 → 95984682
```

A description cached for the first opening is returned for the second without a call, then written under the second session’s valid key and execution token at [describe-pass.ts:193](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:193). The session/conversation/token key therefore does not require the collision to occur within one identity; it is applied only after the cross-session cache hit.

(b) Fingerprint the canonical model input with SHA-256 or another collision-resistant digest. Do not use a 32-bit hash for a cache whose hit can publish confident prose.

### F20 — P1 — established: an invalid stored record is laundered into a valid current record

(a) The store accepts a record independently of its map key, including `executionToken: null`, at [describe-store.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-store.ts:93). The pass then discards both the old key and token and seeds its cache solely from `record.fingerprint` and `record.described`.

I supplied memory containing:

```text
key: corrupt-key
executionToken: old:1:2
fingerprint: fingerprint(current opening)
description: This describes some other job.
```

The pass made zero calls and emitted:

```text
key: $9|current-conv|new:22:33
executionToken: new:22:33
description: This describes some other job.
```

`readDescriptions` subsequently accepts that reconstructed record. Thus the direct join check at [collect.ts:1006](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/collect.ts:1006) refuses the corrupt original but not its rewritten descendant.

(b) Validate a stored record’s embedded identity against its map key before it may seed the content cache. Records with null or mismatched tokens should not enter the cache. Prefer storing structured session/conversation/token fields and deriving the map key from them.

### F21 — P1 — established: permanent refusals are paid for forever and can starve later sessions forever

(a) A `cannot-tell` verdict increments `couldNotDescribe` but stores no result at [describe-pass.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:177). On the next five-minute pass it is therefore fresh again. Because fresh items are always sorted by fingerprint and the first eight selected at [describe.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe.ts:123), permanent refusals monopolize the same slots.

Concrete two-pass probe with nine distinct openings, `maxCalls: 8`, and permanent `cannot-tell` answers:

```text
pass 1: 8 calls, 0 records, 1 over budget
pass 2: the same 8 calls, 0 records, the same 1 over budget
```

This both pays repeatedly for the same sessions and leaves the ninth valid session undescribed indefinitely. Its row retains the generic `not-yet-described` state rather than the actual refusal reason.

(b) Distinguish permanent “opening does not say” refusals from transient gateway failures. Persist permanent refusals; give transient failures bounded exponential backoff or a circuit breaker. Scheduling must skip backed-off fingerprints or retain a cursor so later sessions receive budget.

### F22 — P1 — established: a persistence failure repeats successful paid calls every five minutes

(a) All model calls finish before `writeDescriptionMemory` runs at [server.ts:491](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/server.ts:491). If the write fails, the result is logged and discarded. The next pass rereads the unchanged old memory and pays again.

A fresh box without `~/.overseer` is already such a state: reading reports `absent`, calls proceed, and [writeDescriptionMemory](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-store.ts:153) tries to open a temporary file inside a directory it never creates. A persistently unwritable directory produces the same loop.

(b) Ensure the store exists and can be written before spending. Retain completed results in process when the final write fails and retry persistence before authorizing more model calls; repeated storage failure should open the paid-call circuit.

### F23 — P1 — established: the cache distinguishes inputs that the paid request makes identical

(a) The pass fingerprints the complete flattened opening at [describe-pass.ts:160](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:160), but `describeOne` sends only its first 4,000 characters at [describe.ts:250](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe.ts:250).

I ran two passes with openings:

```text
"x" × 4000 + "A"
"x" × 4000 + "B"
```

They produced two calls, `secondCached: 0`, while the two paid model inputs were byte-identical. This also occurs naturally while the first six turns are still growing beyond the request cap.

(b) Canonicalize and bound material once, before fingerprinting, planning, and calling. The cache key must hash exactly the bytes that determine the model answer.

### F24 — P2 — established: the transcript identity requirement relies on an upstream convention

(a) `describeKey` verifies `execution.conversation.id` but never compares it with `session.claudeSessionId` at [describe-pass.ts:51](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:51). Production then reads the transcript named by `session.claudeSessionId` at [server.ts:495](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/server.ts:495).

Given claimed transcript A and verified execution conversation B, the gate accepts, reads A, and stores it under B. Current collection code prevents this state upstream, so this is a latent seam rather than wrong production behavior today.

(b) Make `readOpening` return the conversation ID it actually read and compare that with `eligible.conversationId` inside the pass, or at minimum require `session.claudeSessionId === e.conversation.id`.

### F25 — P2 — established: the bookkeeping balances planning, not publication, and is not a runtime self-check

(a) The two equalities at [describe-pass.ts:219](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/describe-pass.ts:219) correctly partition:

- sessions by eligibility/readability;
- distinct fingerprints by planned cache/call/budget outcome.

They do not account for whether each session received a record. The nine-session F21 probe balances `true` with zero records and one session perpetually dropped. A bug that skipped the reconstruction loop entirely would also leave both equalities true. Moreover, `describeBreakdownBalances` is called only from tests, never by production.

(b) Add per-session terminal outcomes—published, refused, over-budget, unreadable, ineligible—and assert they total `sessions`. Check the result in `describeOnce` before publishing.

## Direct answers

1. **No, not as stated.** A record cannot be fetched directly under another identity by `readDescriptions`; the exact key and token prevent that. But its description can be read from the global fingerprint cache and re-filed under another identity. F19 and F20 give established sequences.

2. **There is no torn-read problem.** The sibling temporary file, flush, and rename mean the collector sees either the complete old file or the complete new file. It may lag by one collection, and concurrent writers can overwrite each other’s complete updates, but it will not parse half a write. Identity changes before the collection’s execution reading miss the old key safely. A change after that reading is ordinary whole-snapshot staleness, not a torn description join.

3. **The equalities are mathematically right for their stated buckets, but they do not establish the claimed property.** They can both pass while no description records are produced, while one session remains perpetually over budget, or if reconstruction drops a session. F21’s probe returned `balances: true` on both passes.

Two byte-identical openings are intentionally safe and share one answer. Re-executing a pane changes the execution token and directly misses the old record. Rebuilding memory from the current snapshot is safe for attribution, but sacrifices reuse after a transient omission; a short age-out would preserve that reuse without unbounded growth.

All five scoped suites passed: **497/497 tests**. I changed no files.