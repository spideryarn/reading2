1. **S1 — P1: `rename` can still revive a cancelled pair.** It snapshots records, removes the old key, then writes the snapshot back under the renamed identity. [Evidence]( /home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/stored-pairs.ts:115).

   Interleaving: tab A’s `rename(M, N)` reads `{ quickId: Q, meaningId: M }`; tab B’s `forget(M)` or `invalidate(Q)` removes it; A then writes `{ quickId: Q, meaningId: N }`. Cancellation has been undone. A later tidy finds Q and N finished with matching words and deletes Q. This persists until a later load, beyond the accepted T3 window.

   Separate keys close R1’s **unrelated-pair stale-list writeback**, but not this remaining read-then-write. The smallest conservative fix is to forget records on rename without rewriting them; the in-tab pair can still follow the rename.

2. **S2 — P1: select-all bypasses cancellation.** Individual ticks and row presses forget the record, but `onToggleAll` arrives unchanged through `{...panel}` and only updates the active ids. [Individual handlers]( /home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:219), [bulk handler]( /home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:770).

   Open a recorded pair while thorough is pending; select all, then deselect all and tick only quick. Leave, let thorough finish, and reopen. The record survived the reader’s selection of thorough, so tidy deletes their retained quick row. Wrap `onToggleAll` to revoke records for the visible thorough rows it affects.

Leaving `slug` out is sound for the stated article-switch case: the first render retains the old `loaded` value, so tidy does not rerun; `useSearch` then resets it to false, and the new article’s opening response sets it true with its own rows. [Reset and response]( /home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/useSearch.ts:357), [tidy dependencies]( /home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/auto-thorough.ts:452).

No other P0/P1 findings. R4 and the documented T3 race remain accepted. No files edited or checks run.

land with the changes named: forget on rename, and revoke pairs on select-all.