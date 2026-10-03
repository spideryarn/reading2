# The fallback outcome stands in for evidence of the preferred path

Up: [postmortems.md](../project/postmortems.md) · the change:
[261003i](../plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md).

The review of `b34ad2d3c` found two tests that could stay green while quotation flashing was
broken. This was caught before landing; no reader incident was established. The implementation
was correct at these seams, but its claimed protection was not.

## What happened

The new quote flash has a preferred outcome, painting the quoted words, and a fallback, washing
the paragraph. Existing drawn passage marks also take precedence over a quote supplied beside
their passage key.

The review removed three protections separately and restored each afterward. Removing
`quotesBefore`'s sentence-break rule failed three tests. Removing `quoteRanges`' footnote-control
skip failed one. Removing `marks.length === 0` from `flashBlock` left all 77 tests in
`quote-flash.test.tsx` and `block-flash.test.ts` passing. Neither suite supplied both a drawn
passage and a matching quote, so the precedence condition never distinguished the two paths.

The new `beginJump` quote tests had a second gap: they supplied quotes in a browser stub with no
Highlight API, against empty prose cells, then asserted a paragraph wash. A jump that discarded
the quotes produced the same wash. The comment called this evidence that the quote arrived;
the assertion established only that some flash arrived.

Both gaps were introduced by `b34ad2d3c`, which added the quote path and its tests. The existing
passage-only tests did not become wrong; the new alternative made their isolated coverage
insufficient to establish precedence.

## The class: the fallback outcome stands in for evidence of the preferred path

A check observes an outcome shared by the intended path and its fallback, then credits that
outcome to the intended path. Separate tests of each alternative miss the same problem when
the contract is which alternative wins. More passing tests do not help unless a fixture makes
the outcomes distinguishable.

## The fix that is right for the long term

Keep the useful fallback tests, and add assertions at the seams that distinguish the preferred
behavior. Supply `flashBlock` with both a drawn passage and a different matching quote; require
the passage class and an empty quote registry. Give `beginJump` matching prose and the fake
Highlight registry already used by the quote tests; require the registered Range's text and
the absence of a cell wash in both its settled-scroll and already-there branches.

The review added these tests and repeated the mutations. Removing precedence then failed one
test, with 79 passing across the quote-flash and block-flash suites. Discarding quotes in
`beginJump` failed both new forwarding cases, with 14 passing. After restoring the implementation
and fixing the separately reviewed quotation screen, all eight reviewed files passed: 240 tests.
Final verification, including another screen boundary test and doc-link checks, passed 257 tests
in nine files.

## What would have caught it, ranked by ease against value

1. **Make both eligible alternatives produce different observable outcomes.** Two small fixture
   changes catch both gaps without a browser or database. This is the review's immediate fix.
2. **Delete the behavior an assertion claims to protect.** Targeted mutations expose fallback
   equivalence and missing combinations directly. They are cheap for a small, silent behavior
   change; a green mutation identifies the precise assertion still needed.
3. **Full browser snapshots as the primary check — rejected.** They cost more to run and inspect,
   and a visible paragraph wash can still look like success. Browser checks remain useful for
   rendering the highlight colour, but these gaps concern observable routing and precedence.

The lesson I would carry forward: when a graceful fallback is part of the design, a green test
of that fallback says nothing about whether the preferred path was reached. I need a fixture
where losing the preferred behavior changes the assertion.
