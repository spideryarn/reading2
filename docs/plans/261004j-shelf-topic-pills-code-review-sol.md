Ship with the fixes below. No P0 findings.

1. **P1 — fixed: widening deadline could extend beyond the actual lease.** The deadline was based on `refresh` starting, after the claim, rereads, allowance check, and response send. A delay over the 30-second margin could let widening continue after another request could reclaim the row. It is now anchored before the database claim in [shelf-topic-sets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-topic-sets.ts:414).

2. **P2 — fixed: identical finer labels became ambiguous in the flat prompt.** The tree deliberately permits, for example, two *Methods* pills under different parents. Once indentation was removed, their IDs were indistinguishable to the model. The prompt now says to select every ID sharing the applicable visible label; selecting the parent still narrows to that branch. Changed [model-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/shelf-terms/model-topics.ts:293), its test, and the reference doc.

3. **P2 — fixed: the interface still implied parent containment.** “Inside Neuroscience” and “finer topics inside it” could be read as a membership guarantee that is no longer true. The cards now explain that the tree records where a label was grouped and that the pill may contain matching articles outside that parent. Changed [ShelfTerms.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/web/ShelfTerms.tsx:94), [ShelfTermChip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/src/web/ShelfTermChip.tsx:176), and [shelf-terms.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/docs/project/shelf-terms.md:105).

4. **P2 — fixed: the tests still described the retired ancestor invariant and omitted the requested depth-2 case.** Test names now distinguish `withAncestors` from general membership, and `filedInto` explicitly covers a depth-2 topic accompanied by a non-ancestor broad topic. Changed [shelf-topic-model.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmdp0em-topic-pills-public-and-looser/tests/shelf-topic-model.test.ts:635).

5. **P2 — not fixed; wider product limitation:** shelves over 150 works do not re-think to version 2. They retain their v1 tree and memberships while new arrivals use v2 filing. That is technically coherent and preserves the deliberate cap, but “every reader’s tree once” is not literally true. A resumable large-shelf re-think remains the real fix.

6. **P2 — conclusion for Greg:** the measurements establish greater inclusiveness, but not that the sharpness cost is objectively “acceptable.” Intended-topic recall rises from about 0.81 to 0.87, while strict placement precision falls from about 0.35 to 0.25 and forgiving wrong placements roughly double. I would describe this as a substantial, measured loss of sharpness that matches Greg’s stated preference—not explain it away. For the beta, the real-shelf result and explicit preference support shipping.

No further hierarchy dependency was found: server projection, storage, `unplaced`, draining, narrowing, counts, colours, paper cards, and `withinChosenFirst` all operate on explicit membership intersections. `widen`’s union, deduplication, ordering, retry/failure handling, omitted-work behavior, and `SAME_AS_PARENT` intersection check are sound. Clearing all additions conservatively restores the original bound.

Changed files:

- `src/shelf-terms/model-topics.ts`
- `src/shelf-topic-sets.ts`
- `src/web/ShelfTerms.tsx`
- `src/web/ShelfTermChip.tsx`
- `tests/shelf-topic-model.test.ts`
- `docs/project/shelf-terms.md`

Checks:

- Biome: passed.
- Unit slice: 96 tests passed.
- Rendered shelf-topic tests: 43 passed.
- Typecheck covered 3,022 files; only the six pre-existing `src/backfill-registry-facts.ts` errors appeared.
- The exact combined gate could not collect the route/Postgres suites because local Postgres was unavailable. `npm run db:start` was blocked by the sandbox making `/home/greg/.supabase` read-only. The database-backed gate still needs rerunning before push.

VERDICT: ship with the fixes I made