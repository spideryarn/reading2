# Copying a derived command vocabulary can silently drop aliases

Review of [261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md)
found that `rerun social` no longer selected Thread. This is established against candidate
`655cd40a1`; whether a reader encountered it is unknown. The repair is uncommitted.

## The class: an incomplete manual replacement for a derived vocabulary

Retiring Tweets removed `RERUN_MODE.tweets`, which had supplied the mode's label and every
catalog alias to `rerunNames`. Its replacement in
[`rerun-commands.ts`](../../src/web/rerun-commands.ts) copied selected names and missed `social`.
The same word still opened Summary's Thread through the sub-mode row, so opening and regenerating
one destination now recognised different vocabularies. Commit `655cd40a1` introduced this.

The code needed a separate re-run vocabulary: borrowing Summary's names would make
`rerun summary` regenerate a thread. The error was incomplete migration, not that separation.
A read-only subagent traced the deleted derived row and its replacement independently.

## Why the checks agreed

The matcher tests exercised `tweets`, `thread` and `twitter`, but no assertion covered `social`.
All 13 existing tests passed. The new Social regression in
[`command-match-rerun-and-find.test.ts`](../../tests/command-match-rerun-and-find.test.ts)
failed with `rerun social: expected undefined to match object … rerun-tweets` before the fix;
all 14 then passed.

## The repair and the longer-term boundary

Restore `social` in the thread's explicit re-run aliases. Keep the deliberate exclusion of
`x`, whose reason is beside the list. A shared alias vocabulary would be worthwhile if more
sub-modes acquire re-run aliases, with an explicit exclusion for words too ambiguous for paid
commands; introducing another helper for this one missing word buys little today.

## What would have caught the class, ranked

1. Exercise every retained old alias when moving a derived vocabulary to a manual list. The added
   regression checks `rerun social`, `regenerate social` and `social again` select only Tweets.
2. Review the old source list against the new one, recording deliberate exclusions. This also
   distinguishes `social` from the deliberately excluded `x`.
3. Rejected: an end-to-end browser test per nickname. The defect is in pure command ranking; the
   existing command execution tests already cover what happens after a row is selected.
