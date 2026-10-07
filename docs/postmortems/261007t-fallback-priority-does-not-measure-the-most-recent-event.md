# Fallback priority does not measure the most recent event

Code review of [plan 261007o](../plans/261007o-mcp-private-link-and-admin-user-tools.md) found that the new `list_users` tool could hide a recently signed-in account below an older active account. Its promised order is “most recently active first”, but `lastActive` in [src/mcp/tools.ts](../../src/mcp/tools.ts) chose the first available timestamp. This was caught in the uncommitted change; no evidence of a shipped instance was found.

## Fallback priority does not measure the most recent event

The helper used `lastReadAt ?? lastSignInAt ?? createdAt`. Reading and signing in are independent events, so having a read timestamp does not imply that it is newer than the sign-in timestamp. A reader who last opened an article in September and signed in today would still sort by September. With a result limit, they could disappear from the returned accounts despite being the most recently active.

The root cause was treating timestamp availability as chronological precedence. The comment described the same mistaken hierarchy (“reading, else signing in, else signing up”), while the tool's public description promised a chronological maximum. The types allow either date order. Searching `src/` and `tests/` found no sibling combining these same two activity timestamps with nullish fallback.

## Provenance and the fixture gap

`git blame` attributes the helper to `0000000000` (“Not Committed Yet”); `git log -S 'function lastActive' -- src/mcp/tools.ts` has no introducing commit. The reviewed base is `a373ada00f5db33125dcdc2ad71cd75447020159`. This defect belongs to the new working-tree implementation, not that base commit.

The existing ordering fixture in [tests/mcp-tools.test.ts](../../tests/mcp-tools.test.ts) gives both returning accounts a last read after their last sign-in. Its expected order agrees with both the intended maximum and the mistaken fallback, so it cannot distinguish them. The third account has neither optional timestamp; that tests absence, not reversed chronology.

The review added the reversed chronology before fixing it: `returned@example.com` read on September 3 and signed in on October 7, while Ada last read on October 6. The test failed because the returned account sorted behind Ada; it passed after comparing maximum timestamps.

## The narrow fix and what would catch the class

The fix chooses the maximum across the available activity dates and account creation date. It compares canonical ISO strings, which preserve chronological order here because [src/store/pg-admin.ts](../../src/store/pg-admin.ts)'s `iso` helper emits `toISOString()` for these fields. No store, route, or new persisted activity field is needed.

Countermeasures, ranked by cost against value:

1. **A fixture with event chronology reversed** — added and observed red before the fix, then green. It directly distinguishes a temporal maximum from a fallback by putting a recent sign-in after an old read, beside a competing account whose read falls between them, and asserting that the first account survives `limit: 1`.
2. **Exercise independent timestamp orderings when promising “latest”** — cheap test design: include each source being newest, and optional sources being absent. This catches the class across any names used for the event dates.
3. **A new stored `lastActiveAt` or a generic activity aggregation layer** — rejected. It adds writes or abstraction while the dates already available are sufficient. The missing evidence was an adversarial ordering, not a missing activity subsystem.
