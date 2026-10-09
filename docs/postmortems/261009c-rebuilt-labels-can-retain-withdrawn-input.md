# Rebuilt labels can retain withdrawn input

Up: [postmortems.md](../project/postmortems.md) · change: [plan 261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md)

Found in the built-code review before this change shipped. No production write was made during
the review. A public article could influence a topic label, be un-shared, and still supply that
wording to the next tree through the previous-label prompt. The new memberships omitted its id,
so the anonymous projection stopped withholding the label.

The class is **derived-data provenance laundering through rebuilds**: current memberships were
treated as the complete history of inputs, while cached labels preserved older inputs. Even an
article filed into no topic can influence a label because the naming call reads the whole shelf.

The previous-label continuity mechanism dates to `062ef8404` (261003f); the privacy defect arose
when the uncommitted 261008j change reused it for the public shelf. It is harmless on a reader's
own shelf, where a deleted article's previous wording remains theirs.

The existing un-share tests checked memberships and nonempty new topics. Their fake model always
returned fixed labels and ignored previous wording. The new regression instead follows the
prompt's instruction to retain a supplied label. Before the fix it failed:

```
expected [ [ 'Secret project Nightingale' ] ] to deeply equal [ [] ]
```

The fix in `src/shelf-topic-sets.ts` clears all previous topics when `rethinkWhenGone` is enabled
and an old membership key is missing from the current shelf. Reader label continuity is preserved.

Countermeasures, ranked by effort against value:

1. **Make a regression preserve previous wording**, then verify both prompt inputs and the public
   projection. Added to `tests/shelf-topic-sets.test.ts`, including an unplaced withdrawn article.
2. **Treat derived strings as inputs when checking withdrawal**, not just their current membership
   ids. Clearing prior labels is the complete fix for this public rebuild boundary.
3. **Store provenance for every label across generations** — rejected here. Every label can depend
   on every supplied article, so clearing the previous tree on withdrawal is simpler and sufficient.
