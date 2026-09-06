/**
 * Find many rows by block id in **one pass over the table**.
 *
 * ## Why this exists
 *
 * Two effects needed the DOM row for every section, and both wrote the obvious
 * loop:
 *
 * ```ts
 * sections.map((s) => document.querySelector(`tr[data-block="${CSS.escape(s.blockId)}"]`))
 * ```
 *
 * That is one document scan per section. On the article the complaint was filed
 * from — 2,046 blocks, 47,398 nodes — `querySelector` was **38.1% of all script
 * time**, the single largest entry in the profile, and it is what made a mode
 * switch cost 4.7 seconds where the same switch on a 186-block article cost
 * 203ms. Eleven times the blocks, twenty-three times the time: the loop is
 * `sections x nodes`, so length hurts twice.
 *
 * One `querySelectorAll` and a `Map` is the same answer in `O(rows)`.
 * docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md has
 * the measurements and the method.
 *
 * ## Why it returns nulls rather than a Map
 *
 * Callers want the rows **positionally**, lined up with the sections they asked
 * about — `rows[i]` belongs to `sections[i]`, and a section whose row is not in
 * the DOM has to stay in the array as a hole rather than vanish from it, or
 * every index after it points at the wrong section. That is exactly what the
 * `.map(querySelector)` it replaces did, nulls included.
 *
 * ## The one way this could differ from the loop, and does not
 *
 * `querySelector` returns the **first match in document order**. Ids are unique
 * (docs/project/block-ids.md), so the question is academic — but "academic"
 * is how a range check goes silently wrong, so the map keeps the *first*
 * element it sees for an id and never overwrites it. The selector is
 * `tr[data-block]` unscoped, matching what the loop matched: scoping it to
 * `tbody` here would silently drop a row the old code would have found.
 */
/**
 * The same lookup for **one** block, and the only spelling of the selector.
 *
 * `querySelector` rather than the map above, because for a single id the map
 * builds an entry for every row in the table to answer a question about one —
 * and `querySelector` may stop at its first match. (Only *may*: nothing in the
 * DOM spec promises an index, and an earlier draft of this sentence claimed one.
 * The honest statement is that it need not scan the whole table, where the map
 * must.) The two agree by the argument in § *The one way this could differ from
 * the loop, and does not*: ids are unique, and where they were not, both take
 * the first match in document order.
 *
 * They can differ outside the id contract, which is worth naming because that
 * contract is exactly the sort of thing a caller stops honouring quietly:
 * `CSS.escape` rewrites a value like U+0000 while the map compares the raw
 * `dataset.block`, so a malformed id could match here and not there. Block ids
 * are minted by us and match `spya-[a-z0-9]+` (docs/project/block-ids.md), so
 * this is a statement about the boundary rather than a live case.
 *
 * It exists so that `tr[data-block="${CSS.escape(id)}"]` is written once.
 * `src/web/scroll.ts`'s header says it is the one place a block is resolved for
 * scrolling, and it contained two hand-rolled copies of this expression while
 * saying so; two more elsewhere were absorbed into `rowsForBlockIds` on
 * 2026-09-05 and the remaining pair was recorded, unfixed, by two consecutive
 * codebase sweeps. `CSS.escape` is the part that must not be forgotten by a
 * fifth copy — a block id is minted by us and is safe today
 * (docs/project/block-ids.md), which is exactly the reasoning that makes an
 * unescaped copy survive review.
 *
 * Not a fifth caller: `internal-links.ts` runs the same selector against an
 * arbitrary `doc`, not the live page, so it is a different question.
 */
export function blockRow(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(blockId)}"]`);
}

export function rowsForBlockIds(blockIds: readonly string[]): (HTMLElement | null)[] {
  const byId = new Map<string, HTMLElement>();
  for (const el of document.querySelectorAll<HTMLElement>("tr[data-block]")) {
    const id = el.dataset.block;
    /* First wins, so this agrees with `querySelector` even if a duplicate id
       ever reaches the DOM. */
    if (id !== undefined && !byId.has(id)) byId.set(id, el);
  }
  return blockIds.map((id) => byId.get(id) ?? null);
}
