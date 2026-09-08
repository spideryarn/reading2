No P0s. I found five P1s and four P2s. The focused suite passes all 70 tests, but two counterexamples below reproduce against the current code.

1. **P1 — A failure to attribute a rejection promotes it to `limited`.** [usage.ts:658](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:658), [usage.ts:725](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:725), [usage.ts:830](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:830), [usage.ts:841](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:841)

   `contradictsCachedWindow` returns `null` for both “the observations agree” and “the comparison was impossible.” Both callers interpret `null` as an active rejection. Consequently, unknown auth plus an unreadable cache plus any old account’s unexpired rejection produces `LIMITED`; the ambiguity recorded at line 841 is then unable to change that because `limited` wins. The tests explicitly pin this incorrect behavior at [overseer-usage.test.ts:833](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tests/overseer-usage.test.ts:833).

   The temporal precondition also is not fully positive: `hitAtMs === null` passes, and a cache fetched at exactly the rejection timestamp passes because the comparison is `<`, not `<=`.

   Smallest fix: replace the nullable contradiction result with a three-way per-hit classification: matching attributable window, contradiction, or cannot-attribute. Only the matching arm enters `active`; both other arms create ambiguity. Require a non-null hit timestamp and `cache.fetchedAtMs > hitAtMs` for per-hit comparison. Keep separate account-to-cache attribution for using cache percentages.

2. **P1 — Incomplete scans still claim which known hit gates work longest.** [usage.ts:722](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:722), [usage.ts:730](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:730), [usage.ts:824](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:824), [usage.ts:846](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:846)

   `absenceGap` is consulted only when no active hit was found. Given one known five-hour hit plus an unreadable or truncated transcript containing a later seven-day hit, the verdict correctly remains `limited`, but `activeLimit` incorrectly claims the five-hour reset is when work can resume. `latestHitForConversation` likewise returns the known hit before consulting coverage.

   Smallest fix: let the `limited` level survive, but do not claim a binding/latest hit when coverage is incomplete. With the current types, return `activeLimit: null` and explain the known lower bound; return `cannot-tell` for the conversation. A richer “known hit, possibly not latest” arm would preserve more information.

3. **P1 — A half-written final line without a marker can make a broken scan return `none`.** [usage.ts:1079](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:1079)

   At EOF, any non-empty carry is counted as a line, but it is parsed only if a marker has already been written. I reproduced this with one valid benign line followed by:

   ```text
   {"type":"assistant","timestamp":"2026-09-08
   ```

   The result was `kind: "none"`, two lines scanned, zero candidates. That partial record could acquire the rejection fields moments later. This is an `absenceGap` hole because the incomplete record never reaches coverage.

   Smallest fix: validate every unterminated final carry as JSON, even when it is not a candidate. If invalid, mark the transcript unreadable/incomplete. A valid final record without a newline remains supported.

4. **P1 — A partial rejection shape is counted as a benign quota report.** [usage.ts:396](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:396), [usage.ts:401](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:401), [usage.ts:492](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:492)

   This complete quota object:

   ```json
   {
     "quotaLimits": {
       "status": "rejected",
       "rateLimitType": "five_hour",
       "resetsAt": 1788872400
     }
   }
   ```

   returns `no-error-signal`. Coverage records `quotaLimitsWithoutErrorSignal: 1`, but `absenceGap` ignores that counter, so the scan returns `none`. Thus renaming or removing the two outer rejection fields still fails quietly even though `quotaLimits.status` says `rejected`.

   Smallest fix: classify `quotaLimits.status === "rejected"` without an established outer signal as `malformed`, not benign. Likewise, an outer rejection paired with a readable `status: "allowed"` quota object should be malformed rather than automatically becoming a hit. Keep genuine `status: "allowed"` reports non-fatal.

5. **P1 — Missing organization identity still permits the stale OAuth join.** [usage.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:315), [usage.ts:334](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:334), [usage.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:341)

   The mismatch check runs only when both organization IDs exist. Current auth with `orgId: "NEW-ORG"` plus stale OAuth data `{ accountUuid: "OLD-ACCOUNT" }` and no `organizationUuid` returns a `value` account carrying `OLD-ACCOUNT`. A cache for that UUID can then raise `approaching` or judge transcript hits.

   This repeats the original logical error: “not observed to disagree” is being treated as positive agreement.

   Smallest fix: copy `accountUuid` and `organizationRateLimitTier` from OAuth only when both organization IDs are present and equal. When the linkage is absent, retain the auth identity but return null OAuth-derived fields—or make the whole account unknown. Test both one-sided-null cases.

6. **P2 — Symlinked transcripts and directories are silently outside coverage.** [usage.ts:1011](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:1011)

   A symlinked `.jsonl` containing the only active rejection is neither scanned nor counted unreadable, so a regular benign transcript beside it can support `none`. You measured no symlinks on this box, so this is not presently active.

   Smallest fix: count relevant symlink entries as unreadable/unsupported so `absenceGap` refuses silence. Following them is unnecessary.

7. **P2 — `--max-transcripts` still accepts non-integers.** [overseer.ts:468](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/scripts/overseer.ts:468), [overseer.ts:519](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/scripts/overseer.ts:519)

   `--max-transcripts 0.5` passes validation and `slice(0, 0.5)` selects zero transcripts. Round 1 specifically called for an integer; the shared positive-number parser is appropriate for fractional `--since-hours`, but not this count.

   Smallest fix: add an integer requirement for `--max-transcripts` and an exit-code test.

8. **P2 — Five seconds is wider than the demonstrated representation difference.** [usage.ts:527](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:527), [usage.ts:541](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:541)

   Two accounts whose reset instants differ by four seconds are treated as one window and can produce `limited`. The formats justify less than one second: millisecond ISO versus whole Unix seconds. The source comment also still says “Two minutes.”

   Smallest fix: use a one-second bound and update the comment. I still prefer one second; the five-second argument considers false ambiguity but misses the inverse false attribution.

9. **P2 — The deleted branch is not an equivalent mutant of the returned value.** [usage.ts:576](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:576)

   Removing the `account.accountUuid === null` branch preserves `kind`, but changes the user-visible `why`: with a non-null cache UUID it becomes a mismatch against `null`; with both UUIDs null it blames the cache instead of the account. The comment itself acknowledges that difference.

   Smallest fix: either test the diagnostic because it is intentionally more precise, or remove the branch and accept the generic diagnostic. Do not call the mutant equivalent unless equivalence is explicitly limited to the discriminator.

Direct answers:

1. The ambiguity design is right. Remaining `unknown` until those 27 observations expire is acceptable honesty; the collector is reporting the limits of the available evidence. `limited` should outrank ambiguity only when at least one current-account hit passed every attribution precondition. The current implementation does not enforce that qualification.

2. `absenceGap`’s listed predicates are sound, but coverage and callers leave holes: unmarked partial EOF records are invisible, partial rejection shapes are counted benignly, and a known hit bypasses completeness when selecting the supposedly binding/latest hit. Symlinks are another smaller unrepresented omission.

3. The principal newly exposed defects are the two-valued `contradictsCachedWindow` result, one-sided organization identity, nullable/non-strict hit chronology, and the incomplete reject-shape classification.

Accepted-findings reconciliation: findings 2, 5–9 are implemented as intended. Finding 1 is only partly fixed because attribution failure still becomes active. Finding 3 fixes the three original absence paths but misses maximum/latest assertions made after a hit. Finding 4’s marker fix is correct, but partial rejection signals remain. Finding 10 misreads “number” for “integer.” The equivalent-mutant reasoning is wrong for the full observable return value. I found no second coupled default like the 8-day/500-transcript pair.

**VERDICT: commit with findings 1–5 fixed.**