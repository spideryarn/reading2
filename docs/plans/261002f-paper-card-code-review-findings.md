# Code review findings: paper card on topic article links

Review of `git diff 01a7b5e5b..HEAD` for plan
[261002f](261002f-paper-card-on-topic-article-links.md), including its § Plan review.

## P0

None.

## P1

1. **An archived shared paper is falsely said to be listed publicly.**
   [`src/web/PaperCard.tsx:88`](../../src/web/PaperCard.tsx#L88) always uses `SHARING_ON` for a
   public entry. That sentence says the article is publicly listed, but archiving removes it from
   the public list while leaving its direct public link working (`SHARING_MARK_ON_ARCHIVED` is the
   existing source of truth for this state). The fixture at
   [`tests/paper-card.test.ts:84`](../../tests/paper-card.test.ts#L84) combines archived and public
   but asserts only that the value is truthy, so the false sentence passes. **Fixed:** added an exact
   regression assertion and chose the existing archived-public sentence when `archivedAt` is set.

## P2

1. **The abstract helper does not always cut on a word, contrary to its contract.**
   [`src/web/PaperCard.tsx:108`](../../src/web/PaperCard.tsx#L108) deliberately hard-cuts at 280
   characters when the last word boundary is in the first half of the preview. That can split one
   long token even though the function and plan both say the cut is on a word. The test at
   [`tests/paper-card.test.ts:67`](../../tests/paper-card.test.ts#L67) checks length and prefix only,
   so it would stay green after a mid-word cut. **Fixed:** added the missing boundary case and used any
   available word boundary before the limit, falling back to a hard cut only when the preview begins
   with a token longer than the limit.

2. **The docs retain claims from before the plan-review changes.**
   [`docs/plans/261002f-paper-card-on-topic-article-links.md:22`](261002f-paper-card-on-topic-article-links.md#what-we-build)
   still puts a minimal paper's message in the *Length* fact and puts `entryOf`/`topicsOf` on
   `TermTipScope`, despite § Plan review recording the final *Status* fact and separate `PaperScope`.
   [`docs/project/shelf-terms.md:191`](../project/shelf-terms.md#two-views-pills-and-more-detail) says every card has a length,
   names “every topic,” and “knows nothing about topics.” The implementation gives a minimal paper a
   status instead of length, names at most six topics and then says `+N more`, and knows how to draw
   the supplied topic labels; what it does not know is which topics view supplied them. **Fixed:**
   made the plan and both affected reference descriptions match the final data and ownership.

## Checks with no finding

- The title's `aria-hidden` is on a descendant of the `role="tooltip"` element named by
  `aria-describedby`, so it removes only the duplicate title from the computed description; it does
  not hide the description target. The focus test also pins the actual id wiring supplied by
  `Tooltip`.
- The runtime graph from `PaperCard` through `ShelfEntry` and `ShelfTermChip` has no cycle back to
  `PaperCard`, `ShelfTermsDetail`, or `ShelfTerms`.
- `topicsBySlug` and the expensive hue calculation are memoised against the server's `terms`
  answer. The small `tipScope`/`papers` closures are rebuilt with their already-rendering parent and
  are not dependencies of a memoised child or effect, so memoising them would not avoid work here.
- `.tip-paper .tip-facts` intentionally generalises the adjacent `.tip-gist + .tip-facts` rule to
  cards whose facts follow a byline or title directly. Where both selectors match, they set the same
  declarations; there is no doubled spacing or border.
