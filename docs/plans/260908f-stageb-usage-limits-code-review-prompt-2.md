# Round 2 — Stage B usage-limits collector, after your ten findings

You reviewed this module and returned no P0s, seven P1s and three P2s. **I accepted all ten.** This
round asks whether the fixes are right, and whether they opened anything new.

Read your round-1 answer as given; I am not re-arguing any of it. What follows is what changed, what
I measured before changing it, and the three places I most want you to look now.

## What I did with each finding

**1 (P1, cache disagreement is not proof of another account).** Accepted, and this is the biggest
change. Two parts:

- A new `attributeCache(account, cache, hitAtMs)` gates the comparison. Every clause must be
  POSITIVELY true: the account was read (`kind: "value"`), it has a non-null `accountUuid`, the cache
  has a non-null `accountUuid`, the two are equal, and the cache was fetched AFTER the rejection
  being judged. Your phrase — "not proven to belong to somebody else is not proven to belong to this
  account" — is quoted in the source. I also took your third suggestion: `parseAuthStatus` now
  returns `unknown` when `auth status.orgId` and `.oauthAccount.organizationUuid` disagree, so a
  config stale relative to the login cannot contribute an `accountUuid` at all.
- **A contradiction no longer filters anything.** It raises an ambiguity. `computeUsageVerdict`
  returns `unknown` (never `ok`, never `approaching`) when an unexpired rejection contradicts an
  attributable cache, and `latestHitForConversation` returns `cannot-tell` rather than `none`. The
  prose names the previous-account explanation as "the likeliest explanation by far" and then says
  "that is an explanation, not a proof". `limited` still wins over an ambiguity — a rejection we
  COULD attribute is a fact, and a second one we could not does not make the first less true. **Is
  that last precedence rule right?**
- Tolerance 2min → **5s**. You said ~1s; I went to 5s because with the new design a too-tight
  tolerance produces spurious AMBIGUITY rather than spurious acceptance, and I would rather not
  manufacture doubt from a representation difference. The observed difference is under 1s and the
  real difference between two accounts' windows is days, so 5s sits in a very wide gap. **Say if you
  think 1s is still better.**

**2 (P1, 24h scan can miss an active seven-day rejection).** Accepted. `LONGEST_ACTIVE_WINDOW_MS`
(7d) and `DEFAULT_SINCE_MS` (8d) are now exported constants, the default `sinceMs` is 8 days, and
`absenceGap` refuses to conclude an absence from any window shorter than 7 days. **This made the
default scan cost 45s and 2.9 GB on this box** (1,770 transcripts, 870,799 lines), up from ~2-10s.
That is a deliberate trade and it is documented as one.

**3 (P1, several broken scans still satisfy the positive control).** Accepted, all three paths. The
three ad-hoc tests became ONE exported predicate, `absenceGap(coverage): string | null`, used by
`summariseRateLimitScan`, by `computeUsageVerdict` and by `latestHitForConversation`. It refuses an
absence when: nothing was opened, no lines were read, ANY transcript was unreadable,
`candidateLines > linesParsed`, any malformed candidate exists, the transcript bound truncated, or
the mtime window was shorter than the longest active window. Your third path — a known hit
short-circuiting before the malformed check — is fixed by `hits` still being returned (what was
found was found) while every CALLER asks `absenceGap` before inferring an absence.

**4 (P1, drift in the marker itself is silent).** Accepted. Three independent markers now —
`rateLimitType`, `"rate_limit"`, `"apiErrorStatus"` — and the parse tests the REJECTION SIGNAL first,
so a rejection whose quota object was renamed or moved is `malformed` rather than `not-a-hit`.
Measured cost before changing it, over 866,185 lines: `rateLimitType` alone matched 244 lines, the
union matched 267. So 23 extra `JSON.parse` calls across the whole corpus.

**5 (P1, a generic API error can be promoted to a hit).** Accepted. `isApiErrorMessage` is out of the
OR; a hit now requires `apiErrorStatus === 429` or `error === "rate_limit"`.

**6 (P1, malformed auth JSON reported as logged out).** Accepted. Only `loggedIn === false` is
logged-out; anything else non-true is `unknown`. A `value` account additionally requires an email or
an orgId.

**7 (P1, invalid percentages).** Accepted, `0 <= utilization <= 100`, else the window's `unknown` arm.

**8 (P2, the known-window list is not exhaustive against its type).** Accepted and you were exactly
right that the comment claimed otherwise. Now a `Record<KnownUsageWindow, true>`, with
`KNOWN_USAGE_WINDOWS` derived from its keys and `isKnownUsageWindow` using `Object.hasOwn` (so
`"toString"` is not a known window; there is a test).

**9 (P2, the chunk-boundary tests do not reach a boundary).** Accepted, and this was the most useful
P2 because both tests were passing for the wrong reason. Both now compute the padding IN BYTES and
**assert the offset before scanning**: the marker must start before byte 1,048,576 and end after it;
the two bytes of "é" (0xC3, 0xA9) must land at `buf[CHUNK-1]` and `buf[CHUNK]`. Verified by mutation:
dropping the carry buffer now turns them red, and did not before.

**10 (P2, unvalidated CLI flags).** Accepted. A three-armed `positiveNumberFlag` — absent / value /
invalid — and an invalid flag exits 1 with a message (verified: exit code 1, not 0).

## One defect I introduced while fixing yours

Raising the default `sinceMs` to 8 days made the *other* default wrong: `maxTranscripts` was 500,
which was ample for a 24h window (~240 files) and cut a 1,770-file window in half. The first live run
after the change opened 500 of 1,770 and every verdict came back `unknown` because the scan had
truncated itself. Two defaults each defensible alone and wrong together. `maxTranscripts` is now
5,000. **Is there another pair like that in here?**

## What I measured rather than assumed

You should know which claims in this code are backed by a number, because one of them was previously
a guess I had written into a comment as fact:

- **Unparsed candidate lines: ZERO** out of 267, across 1,766 transcripts and 866,185 lines. The old
  comment excused `candidateLines > linesParsed` as normal ("a live session's final line can be
  half-written"). That was speculation, it was wrong, and your finding 3 is what made me measure it.
  It is now treated as drift.
- Marker cost, above: 244 → 267 candidate lines.
- Default scan: 1,770 files, 2.9 GB, 870,799 lines, 45s.
- The same 235-file scan measured 1.8s and 9.7s two hours apart, purely from box load.

## The mutation pass, and what it exposed

After making your fixes I broke the finished code ten ways, one at a time. **Seven of the ten were
NOT caught** — I had fixed the code and written tests for only three of the fixes. I checked that
each mutation genuinely applied to the file before believing a "not caught", then wrote the missing
tests. Now 9 of 10 are caught. The tenth — deleting the `account.accountUuid === null` early return
in `attributeCache` — I verified is an EQUIVALENT MUTANT: the uuid-inequality check two lines later
rejects a null on either side, so no behaviour changes. I enumerated all six null/non-null
combinations to confirm that rather than assert it, and left a comment saying not to write a test for
it. **Tell me if you think that reasoning is wrong.**

## What I want from this round

1. **Is the ambiguity design right**, or have I now over-corrected into a collector that says
   `unknown` so often it is useless? On this box it currently returns `unknown` and will keep doing
   so until the 27 unattributable rejections expire on 2026-09-12. Is that acceptable honesty or a
   feature that no longer answers its question?
2. **Does `absenceGap` have a hole**, the way the three ad-hoc checks did?
3. **Anything the fixes broke or newly exposed**, especially around the `attributeCache` precondition
   and the new reject-shape test in `parseRateLimitLine`.

Please also say if any of my ten "accepted" is actually a misreading of what you meant.

## Evidence: the collector against the live box, after all fixes

```
account   greg@rehearsable.ai  max  tier default_claude_max_20x  uuid eddd4c75-0024-4636-b7ca-d727eaeca66b
verdict   UNKNOWN
          cannot say this account has headroom — see the ambiguities below
          140 rate-limit rejection(s) found, none of them in force for this account (113 already reset, 27 unattributable)
          27 unexpired rejection(s) contradict the logged-in account's own cache and cannot be attributed either way: this seven_day rejection says the window resets at 2026-09-12T18:00:00.000Z, but the logged-in account's own cache — fetched after it, and carrying the same accountUuid — says its seven_day window is 22% used and resets at 2026-09-15T04:59:59.790550+00:00. One account has one current seven_day window, so these two cannot both describe it. The likeliest explanation by far is that the rejection belongs to an account that has since been swapped out with /login, because a transcript 429 carries no account id at all — but that is an explanation, not a proof, so this rejection is neither counted as in force nor dismissed
cache     fetched 73 min ago, account eddd4c75-0024-4636-b7ca-d727eaeca66b
          five_hour: 1% used, resets 2026-09-08T16:49:59.790529+00:00
          seven_day: 22% used, resets 2026-09-15T04:59:59.790550+00:00
          nimbus_quill: unknown — no resets_at, so the utilization (0) cannot be checked for validity — reporting it would be reporting a number that may describe a window that no longer exists
          spend: unknown — no resets_at, so the utilization (absent) cannot be checked for validity — reporting it would be reporting a number that may describe a window that no longer exists
          member_dashboard_available: unknown — window entry was not an object: false
scanned   1770/1770 of 1770 transcripts, 870799 lines, 282 candidates, 45359ms
429       2026-09-08T06:23:02.314Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 3dbdbfcb-3264-4b23-9243-1c3013826ae9
429       2026-09-08T06:04:01.839Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 3dbdbfcb-3264-4b23-9243-1c3013826ae9
429       2026-09-08T06:02:47.112Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:46.605Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:46.527Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 490f2556-4e1c-45c5-a5ba-361ee5860c90
429       2026-09-08T06:02:45.947Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 490f2556-4e1c-45c5-a5ba-361ee5860c90
429       2026-09-08T06:02:42.649Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 30d04781-3d44-411f-b9ae-a18ec4fb4861
429       2026-09-08T06:02:38.002Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:26.186Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:26.168Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 913bc3ec-f5b3-4f25-903c-b7270474386d
          (130 more)
took      46332ms, at 2026-09-08T13:04:48.954Z
```

`npx tsx scripts/overseer.ts usage --max-transcripts nope` prints
`✗ --max-transcripts must be a positive number, got "nope"` and exits 1.

## Test results

70 tests pass in `tests/overseer-usage.test.ts`. `npm run typecheck` clean across all four
projects including the browser one that compiles `wire.ts`. Biome lint clean.

## READ THESE FILES FROM DISK

The tree is available to you read-only, and the full source is too large to paste into this
prompt (the first attempt overflowed the argv limit). Read these, from the repository root
`/home/greg/code/spideryarn2/.claude/worktrees/usage-limits`:

- `tools/overseer/usage.ts` — the module under review, in full.
- `tests/overseer-usage.test.ts` — its tests, in full.
- `tools/fleet/wire.ts` — the published types (the usage section is at the end). No imports and
  no runtime values are allowed in this file.
- `scripts/overseer.ts` — the `usage` subcommand, `usageLines` and `positiveNumberFlag`.
- `tests/fixtures/overseer-usage/` — the fixtures. Everything named `-real` is a real capture
  from this box; `claude-json-stale.json`, `claude-json-no-cache.json`,
  `auth-status-logged-out.json`, `transcript-429-malformed.jsonl` and
  `transcript-429-renamed-quota.jsonl` are fabricated and declared as such in the test header.
- Your round-1 answer is at `docs/plans/260908f-stageb-usage-limits-code-review-sol-r1.md` if
  you want to check what you actually said against what I claim above.

The diff since round 1 is large and touches almost every function, so read the current state
rather than a patch.

## How to report

One numbered finding per issue: severity (P0 blocks the commit / P1 fix now / P2 worth noting),
file and line, the concrete failure with inputs and state, and the smallest fix. Say explicitly
if you find nothing at a severity rather than padding. Answer the three numbered questions above
directly, and say if any of my ten "accepted" misreads what you meant.

END WITH A ONE-LINE VERDICT: commit as-is, commit with named fixes, or rework.
