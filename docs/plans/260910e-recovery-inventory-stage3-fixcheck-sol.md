F27 — **closed**.  
F28 — **not closed**.  
F29 — **closed**, including the deliberate stale-view exception.  
F30 — **not closed**.  
F31 — **closed**.  
F32 — **closed**.  
F33 — **closed**.

### F28

There remains a usable swap gap between the final check and filesystem mutation in [overseer-recovery-drill.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/scripts/overseer-recovery-drill.ts:259).

Concrete input: target `/tmp/safe/new-drill`, with `/tmp/safe` initially a real directory and `/srv/live` the protected store. After `refuseUnsafeTarget(root)` returns, replace `/tmp/safe` with a symlink to `/srv/live`. The subsequent recursive `mkdirSync(root)` creates `/srv/live/new-drill`. The `realpathSync` check notices afterward, but creation has already happened. A similar swap after that check can redirect child creation and later deletion.

Smallest robust fix: anchor operations to opened directory descriptors. Open and validate the nearest existing ancestor with no-follow semantics, create/open each missing component relative to that descriptor, and perform every later create/write/delete through the held root descriptor (for example via `openat2`/`mkdirat`, or an equivalent fd-rooted helper). Path rechecking alone cannot close the race.

The listed non-racing cases—symlinked ancestors, missing leaves, relative and `..` paths, absolute configured stores, and the default store—are otherwise covered.

### F30

The parser still accepts contradictory inventory claims. I verified it accepts:

- a checked, trusted inventory claiming `rows: 0`;
- one unresolved, otherwise valid record classified `already-live`, carrying a live row;
- consistent `total`, `unresolved`, `olderCount`, and page length.

The page consequently renders both “0 sessions” and “Already live” with that live session’s details.

Smallest fix: for a trusted inventory, collect the distinct `tmuxId`s referenced by `already-live` and `present-but-unmatched`; reject when their count exceeds `inventory.rows`. Also reject differing facts for repeated occurrences of the same `tmuxId`.