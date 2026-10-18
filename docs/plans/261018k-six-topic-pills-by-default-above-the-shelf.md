# Six topic pills by default above the shelf

Report `spya-qawppt` (SPIDERYARN-READING2-JW), an admin suggestion filed 2026-10-18 from the
signed-in shelf, queue item `qi-m6dfr3xm`:

> By default, initially just show a half dozen or so topic pills on the logged in page above the
> shelf.
>
> — Greg, 2026-10-18

Up: [shelf-terms.md § Two views](../project/shelf-terms.md#two-views-pills-and-more-detail).

## What is there now

The Topics row ([`ShelfTerms.tsx`](../../src/web/ShelfTerms.tsx)) draws the first
`COLLAPSED_CHIPS = 12` topics in the server's rank order, plus any chosen one further down, and an
**All N topics** button that expands the same row to every pill, shown only when there are more
than twelve. So "a way to see the rest" already exists; this is the number.

The public shelf's row ([`PublicShelfTopics.tsx`](../../src/web/PublicShelfTopics.tsx)) has its own
`COLLAPSED = 12`, with a comment saying it is "as many pills as the reader's row shows". Greg's
principle of 2026-10-18 (`spya-r8arjm`) is to give the public shelf the same when that is
straightforward and costs no AI, and here it is one constant.

## The change

1. **`COLLAPSED_CHIPS = 6`.** "Half a dozen or so": six. Broad subjects come first in the server's
   order, so the six are the broadest, which is the right default for a first look.
2. **The public shelf imports `COLLAPSED_CHIPS`** instead of keeping a second `12`, so the two
   cannot drift again (one home per fact). Its "All N topics" button follows.
3. **One shared helper, `collapsedTopics`** in `shelf-narrow.ts` beside the constant: the first
   six of what `withinChosenFirst` returns, plus any chosen topic further down. Both rows call it,
   and the "All N topics" button shows when it leaves something out (`available.length >
   collapsed.length`) rather than when there are more than six, so the button never reveals
   nothing.

   *Dropped after the plan review*: a first draft also kept every topic directly inside a chosen
   one in the collapsed row, so a chosen subject's finer topics would never be cut off by the six.
   GPT Sol (finding 1): a subject can have up to twenty finer topics, so the "collapsed" row could
   grow to twenty-six pills or more, which is not what Greg asked for. And choosing a subject drops
   every topic that shares nothing with it, which usually brings the chosen one near the front
   anyway. So a chosen subject's finer topics fill the slots after it, and the rest are behind
   "All N topics", as they were behind twelve before.
4. **The loading placeholder follows**: five ghost pills instead of eleven (the spinner takes the
   first pill's place), and the invisible "All N topics" reservation now applies whenever the ghosts
   do (any shelf of eight rows or more can have more than six topics). The row being shorter also
   makes the placeholder-to-row jump queued as `qi-z9qc9f3s` smaller; that item is not otherwise
   touched.
5. **Docs**: shelf-terms.md § Two views, § A topic with nothing to show and § Where the code is,
   public-shelf.md § Topic pills, the comments that say "twelve", and a line in `choose.ts` saying
   its @12 metrics date from the twelve-pill row (Sol finding 5; @5 and @8 bracket six, so no new
   metric).

Not touched: the per-card pills (three and `+N`, plan 261005a), the More-detail view (every topic,
as before), the tag row above (tags are the reader's own, uncapped), and `qi-rysqd6xc` (a card's
pill filtering), which is independent of how many the row shows.

## Simpler option passed over

The constant alone, with the public shelf's own `12` changed to `6` by hand. It is one line fewer,
but leaves two copies of one number that already drifted once in intent (the public one's comment
says it mirrors the reader's), and the All button's "more than N" test, which is wrong as soon as a
chosen topic sits beyond the six.

## Tests

- `tests/shelf-topics.test.tsx`: the collapsed row draws six and "All N topics" when there are more;
  with a subject chosen in sixth place, its finer topics are behind "All N topics"; the
  placeholder's ghost count and reservation follow the constant.
- `tests/shelf-topics-detail.test.tsx`: the "All 14 topics" expansion from six.
- `tests/shelf-narrow.test.ts`: `collapsedTopics` with nothing chosen, a subject chosen with its
  finer topics, and a chosen one beyond six.
- The public shelf's row draws six and its All button with more than six.

## Reviews

Plan: GPT Sol, read-only — [plan-review-sol](261018k-six-topic-pills-plan-review-sol.md), verdict
*revise*. Findings 1 (item 3 dropped), 2 (the All condition), 3 (the detail test), 4 and 5 (docs and
the metrics wording) all taken. Code: GPT Sol, fixes in scope.
