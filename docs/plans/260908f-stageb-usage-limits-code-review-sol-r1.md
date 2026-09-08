No P0 findings. I found seven P1 defects and three P2s. The worktree’s current focused suite has 53 passing tests; the two boundary tests below are the only ones I found passing without exercising the behavior named.

1. **P1 — Cache disagreement is not proof that a rejection belongs to another account.** [usage.ts:445](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:445), [usage.ts:547](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:547)

   `ownCache` means “not proven to belong to somebody else,” rather than “proven to belong to this account.” With unknown auth or either UUID absent, a live cache whose reset differs from a genuine unexpired hit disqualifies that hit and produces `OK`. `latestHitForConversation` is worse: it accepts `report.cache` without the account, so after `/login` a previous account’s cache can disqualify a current account’s rejection.

   Even with matching UUIDs, reset disagreement proves only that two snapshots describe different window states. It does not prove why: another account is compelling for the live example, but reset recalculation or another same-account state change remains possible because these fields have no supported stability contract. The code also does not require the cache to have been fetched after the hit.

   Smallest safe fix: stop filtering contradictory hits as “another account’s.” Return `unknown`/`cannot-tell`, display both observations, and label the old-account explanation as likely. If retained as a heuristic, require explicit non-null UUID equality, a cache fetched after the hit, and verified agreement between `auth status.orgId` and `.oauthAccount.organizationUuid`.

   The two-minute tolerance is also unsupported: the observed representation difference is under one second. Use about one second; larger disagreements should become ambiguity, not attribution.

2. **P1 — The default 24-hour scan can miss a still-active seven-day rejection and return `OK`.** [usage.ts:841](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:841), [usage.ts:887](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:887)

   Concrete reproduction: an unexpired seven-day 429 in a transcript last modified two days ago, plus one fresh benign transcript. The old file is excluded; the result is `RateLimitScan { kind: "none" }`, and with an unreadable cache the verdict is still `OK`. `latestHitForConversation` likewise returns `none`, because it only recognizes `maxTranscripts` truncation—not mtime exclusion.

   Smallest fix: an absence may be conclusive only over at least the longest possible active window and without transcript truncation. Otherwise represent it as partial/unknown and prevent both the overall verdict and per-conversation result from becoming `OK`/`none`.

3. **P1 — Several broken scans still satisfy the positive control.** [usage.ts:351](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:351)

   Three concrete paths:

   - One readable benign transcript plus any number of unreadable selected transcripts returns `none`.
   - One parsed false candidate plus one truncated candidate returns `none`, because only “all candidates unparsed” is rejected.
   - Any known hit makes the function return `hits` before checking malformed candidates. If the known hit has expired, `computeUsageVerdict` returns `OK` despite the unreadable candidate possibly being the active rejection.

   This also masks the current oversized-line protection: that transcript becomes unreadable, but another readable file can restore `none`.

   Smallest fix: treat `transcriptsUnreadable > 0` and `candidateLines > linesParsed` as incomplete coverage. Preserve known hits if useful, but callers must return `unknown`/`cannot-tell` whenever they would otherwise infer absence from incomplete coverage.

4. **P1 — Shape drift in the very marker being searched for is silent.** [usage.ts:301](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:301), [usage.ts:705](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:705)

   If a future rejection retains `error: "rate_limit"` and `apiErrorStatus: 429` but renames or moves `rateLimitType`, the line contains no marker, is never parsed, and a quiet-looking `none` is possible. The nested `quotaLimits` fallback does not protect against this case.

   Smallest fix: prefilter on independent rejection markers such as `error":"rate_limit"` and `apiErrorStatus`, then inspect parsed record fields. A record with a rejection signal but no readable quota object must be `malformed`, not `not-a-hit`.

5. **P1 — A generic API error can be promoted to a rate-limit hit.** [usage.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:304)

   The three signals are ORed. For example, `{ isApiErrorMessage: true, quotaLimits: { status: "allowed", rateLimitType: "five_hour", resetsAt: ... } }` becomes a hit and can produce `LIMITED`, despite having neither status 429 nor `error: "rate_limit"`.

   Smallest fix: require the established rejection shape. If only part of it is present, classify it as malformed/unknown rather than manufacturing a hit.

6. **P1 — Malformed auth JSON is reported as definitely logged out.** [usage.ts:254](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:254)

   `parseAuthStatus("{}")` returns `{ kind: "logged-out" }`; so do renamed or wrongly typed `loggedIn` fields. Conversely, `{ loggedIn: true }` produces a `value` account with every identity field null.

   Smallest fix: return `logged-out` only for `loggedIn === false`; any missing or invalid discriminator should be `unknown`. Validate enough identity fields before producing the `value` arm.

7. **P1 — Invalid percentages produce a trusted `value` arm.** [usage.ts:219](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:219)

   Despite the wire contract saying 0–100, `utilization: -1` or `101` is accepted. A `-1` reading marks the cache usable, so if transcript scanning fails the final verdict can be `OK` based solely on invalid data.

   Smallest fix: require `0 <= utilization <= 100`; otherwise return the window’s `unknown` arm.

8. **P2 — The runtime known-window list is not exhaustive against its type.** [usage.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tools/overseer/usage.ts:97)

   Contrary to the comment, adding a member to `KnownUsageWindow` without adding it to the array compiles successfully; `isKnownUsageWindow` then returns false for a value the type declares known.

   Smallest fix: use a `Record<KnownUsageWindow, true>` runtime map so missing and extra keys both fail compilation.

9. **P2 — The two chunk-boundary tests do not place their target at a boundary.** [overseer-usage.test.ts:429](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tests/overseer-usage.test.ts:429), [overseer-usage.test.ts:760](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/tests/overseer-usage.test.ts:760)

   The marker begins at byte 1,208,518—159,942 bytes into the second chunk—and the `·` begins 157,235 bytes into the second chunk. Both target records are wholly inside that chunk. These tests prove that later chunks are scanned, not that the marker or UTF-8 sequence survives a split.

   Smallest fix: calculate padding in bytes so `rateLimitType` crosses byte 1,048,576 and the first byte of `·` lands at byte 1,048,575, then assert those offsets before scanning.

10. **P2 — Numeric CLI flags are unvalidated.** [overseer.ts:491](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits/scripts/overseer.ts:491)

   `--max-transcripts nope` produces `NaN`, disables the bound, and scans everything in the mtime window. `--max-transcripts -1` selects all but the last transcript. A missing flag value silently restores the default.

   Smallest fix: parse finite, non-negative integers and return a nonzero usage error for absent or invalid values.

The expired cache arm itself is sound: no numeric utilization field escapes it, only explanatory prose. The current buffer implementation also handles raw UTF-8, CRLF, no trailing newline, and empty files correctly; its remaining correctness problem is incomplete-scan propagation in finding 3. `wire.ts` contains no imports or runtime values.

**VERDICT: Commit only with findings 1–7 fixed; the categorical `contradictsCachedWindow` filter should become an explicit ambiguity, not ship as-is.**