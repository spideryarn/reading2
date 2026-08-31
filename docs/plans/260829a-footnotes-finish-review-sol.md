Verdict: **BLOCK**. One real correctness gap remains.

## Blocker

1. **A valid deeper tree still splits the fisheye from `?at=`.**

A supplement is shallower than a body tree with leaf depth 4. At the section column, its cells are therefore continuations. [`itemsFromCells`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/context.ts:108>) drops every continuation, while [`buildSections`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:78>) keeps them.

I constructed a sound depth-4 body tree and appended one note:

```text
checkTree problems: []
leafDepth: 4
sectionDepth: 3
fisheye supplements: []
?at= sections: [Notes]
```

This shape is reachable: [`buildTree`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:489>) accepts arbitrary recursive depth, and the invariants impose no maximum. The prompt requests three levels, but model output is not a contract.

The new property test does not catch this. It compares `navigableItems` directly with `buildSections`, which itself uses `navigableItems`; it never exercises the fisheye’s continuation filter. It also runs every case against the same depth-3, single-supplement topology. See [`supplement.test.ts`](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/supplement.test.ts:545>).

Add the deeper valid tree and compare `itemsFromCells(...).items` with `buildSections`. The likely fix is to drop continuations only when they are not supplements.

## Review artifact issue

[`260829a-footnotes-finish.diff`](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260829a-footnotes-finish.diff:355>) omits two current test hunks totalling 53 added lines:

- The Wikipedia thirteen-backlink regression test.
- The projection “property” test above.

Regenerate the scoped diff before preserving this review.

## The other attack points

- **Shared `AMBIGUOUS`:** correctness-safe. I checked tab, newline, and NUL across every relevant field in `example/` plus `data/`; all counts are zero. Separate predicates would minimize unverified production-cache invalidation, but the union is not a correctness blocker.
- **`assertTreeSound`:** correct placement and failure policy. I found no common valid shape it rejects.
- **F6’s new child requirement:** correct, but it does not close the deeper-tree projection route.
- **F7:** sound. The raw attribute comparison preserves the Wikipedia one-note/thirteen-backlink case; the current regression test marks exactly the selected return path.