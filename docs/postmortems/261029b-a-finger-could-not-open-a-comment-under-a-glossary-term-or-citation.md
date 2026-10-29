# A finger could not open a comment under a glossary term or citation

**What happened.** On a touch screen, a comment or chat the reader had made could not be opened by
tapping words that were also a glossary term or a citation. The tap showed the term's card (or did
nothing useful) and the comment stayed shut. A mouse was never affected. Nobody reported it; GPT Sol
found it on 2026-10-29 while reviewing the plan for underlining explained passages
([261029j plan review, P1](../plans/261029j-plan-review-sol.md) and
[code review, first finding](../plans/261029j-code-review-sol.md)). The bug is older than that
plan, and it was found only because that plan was about to add a third selector with the same fault.

**Root cause.** [`annotate.ts`](../../src/web/annotate.ts) merges every mark kind that covers a run
of words into **one** `<mark>` with several classes: a comment over a term is
`<mark class="cmt term">`, deliberately, so two underlines never stack
([glossary.md](../project/glossary.md): *"a question you asked does not stop being openable because
a glossary term happens to sit inside it"*). That merge is what keeps the comment clickable by
mouse: TableView's click handler on `mark.cmt` / `mark.chat` opens it. But the touch path decides
ownership with a different question. `useHoverCard` claims a touch tap on anything that matches
`tapSelector` and then cancels the click that follows, so TableView never hears it. The selector
was `mark.term:not(.xref), mark.cite:not(.xref), …`, which asks "is this a term?" and not "is this
*only* a term?". A merged mark answers yes, so the term's handler took the tap off the comment.

Why nobody saw it: the mouse path and the touch path share the mark but not the handler, and the
tests for each used a mark with one class.

**The class: a merged multi-class element claimed by one kind's handler.** When several kinds share
one DOM node, every selector that matches by one class is a claim on all the others' events too.
Each handler is correct for the element it imagined, a mark of its own kind alone, and wrong for
the element that exists. It is the same shape as the cross-reference bug, where `:not(.xref)` had to
be added so that a term which was also a cross-reference did not swallow the xref's tap. That fix
was made for one pair and never became a rule.

**The commit that introduced it.** `tapSelector` entered `ProseHoverCard.tsx` in `cce3f7767`
(2026-08-27, "A finger gets the card the pointer always got, and a second tap the glossary", plan
[260827ak](../plans/260827ak-touch-glossary-card.md)) as `"mark.term"`. Comments already merged
with terms by then, so the fault was there from the first line. Its message lists the ways a finger
is *not* asking for a card (scroll, long press, selection dismissal, pinch) and none of them is "the
words are also something else the reader owns". `5ad4585b5` / `aca29e0a4` (2026-09-16, citations)
copied the pattern as `mark.cite`, and `9d6158004` (2026-09-30, xref) added `:not(.xref)` to both
without asking whether `.cmt` and `.chat` needed the same.

**The fix, shipped and long-term.** Shipped: `:not(.cmt):not(.chat)` on the term, cite and explained
entries of `tapSelector`, so a mark that is the reader's own is left to TableView's click, with
regression tests in `tests/explained-prose.test.tsx` (comment alone, comment on a term, chat on a
term). That is right for now but still a list of exclusions written out by hand in a string, and the
next mark kind has to remember to add itself to it. The long-term shape is for the hook to be told
which kind owns a merged mark (an order of precedence defined once next to `MarkKind`, with the
reader's own marks first) rather than every selector excluding every other kind.

**What would have caught the class, ranked by ease against value.**

1. **A test over every pair of mark kinds for tap and click ownership.** Merge each pair, tap it,
   and assert exactly one handler ran and it was the right one. `xref-prose.test.tsx` does this for
   xref only; widening it to all kinds would have failed on the first run in August. Cheap, and the
   only item here that fails on the next new kind. Do this when a kind is added; the mode checklist
   ([mode.md](../project/mode.md)) is the place to say so.
2. **A rule at the selector: a `tapSelector` entry names the classes it excludes, and a comment says
   why.** Costs a sentence. The comment now in `ProseHoverCard.tsx` does this for the instance.
3. **The precedence table described above.** The right design, and a real refactor of the hook
   contract; worth doing the next time a kind is added rather than before.
4. Rejected: a Playwright touch test for every kind. The failure is in selector logic, which a
   jsdom test over the merged markup reaches in milliseconds; a browser would be slower and add
   nothing.
