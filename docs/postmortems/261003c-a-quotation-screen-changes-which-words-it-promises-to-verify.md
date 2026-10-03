# A quotation screen changes which words it promises to verify

Up: [postmortems.md](../project/postmortems.md) · the investigation:
[261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md).

The review of `b34ad2d3c` found two defects in Tutorial's cheap quotation screen. One allowed
invented short words in an ellipsis quotation; the other silently missed a real quotation with
a comma inside its closing mark. Neither changes a reader's stored data or answer. Their cost
is unreliable evidence about whether the prompt quotes and cites correctly.

## What happened

`quoteCheck` promised that every ellipsis-separated piece must occur, in order, in one block.
It actually discarded pieces shorter than four characters first. Given a block containing
`an intelligent data pattern` but no `not`, it counted
`"not … an intelligent data pattern" [spya-ajt4fw]` as an article quotation rather than an
altered one. A short negation carries meaning even when a matching screen considers it small.

The screen also passed quote-terminal punctuation directly to the source matcher. In
`remember-tutorial.261003i-entropy-after-1.md`, `richRecall`'s second tutor turn asks about
`"facilitates its own transformation,"` without citing that question's quotation. Its comma
belongs to the sentence introducing the phrase. The screen did not recognise the phrase and
therefore never checked its missing citation. Reading only the screen's flagged items cannot
catch an item that the screen silently excludes.

Both behaviors are present in the screen introduced by `b34ad2d3c`. Independent review ran the
new `tests/tutorial-quote-screen.test.ts` against that behavior: **two failed, one passed**.
The terminal-comma case returned `article: 0` instead of `1`; the invented-negation case
returned `article: 1` instead of `0`. A genuinely present short piece, `is`, remained accepted.

## The class: a quotation screen changes which words it promises to verify

The screen treated a size filter as harmless preparation for verification. That changed the
claim it verified: the source contained the surviving long phrase, not necessarily the words
the answer quoted. At the same boundary, it treated sentence punctuation as source content
and silently excluded a genuine quotation. The contract was not defined across those two
transformations, so the same screen admitted altered content and missed faithful content.

There were no direct tests of this screen in the candidate. Testing the underlying matcher
could not defend preparation done before calling it, and inspecting flagged outputs could not
establish that unflagged outputs were safe.

## The fix that is right for the long term

Verify every nonempty ellipsis piece, including short words. Remove only the quote-terminal
sentence punctuation allowed by the screen's quotation convention, retaining internal
punctuation and word boundaries. Keep `findQuote`'s strict `"spaced"` pass: the forgiving pass
is for locating paint in rendered prose, and deleting whitespace would weaken a fidelity check.

Keep the original paid-run files as records of the screen that ran then. Corrections to the
screen and its interpretation belong in the investigation, with the missed real example
acknowledged; silently rewriting historical counts would obscure what the original check did.

The review implemented the screen correction and kept the direct regression tests. With the
screen fixed and the temporary flash mutations restored, all eight reviewed files passed:
240 tests. The two assertions seen failing before the fix now pass. Follow-up review caught
punctuation being stripped from each ellipsis piece, rather than only the quotation's end;
an internal-semicolon test failed before that was corrected. Final verification passed 257 tests
in nine files, including the doc-link checks.

## What would have caught it, ranked by ease against value

1. **Test the screen's transformations at its own boundary.** A few local strings catch invented
   short content, genuinely present short content, and terminal punctuation. These red-first
   tests are the review's immediate countermeasure and require no model or database.
2. **Read some unflagged examples as well as flagged ones.** This inexpensive check challenges
   the screen's coverage, rather than assuming that its flagged set contains every fault.
3. **Another paid evaluation as the primary check — rejected.** More outputs through the same
   broken screen can repeat its false assurance. A new run can measure a changed prompt, but
   local counterexamples are better evidence about the screen itself.

The lesson I would carry forward: before a verifier checks a quotation, I need to account for
every transformation of the quoted string. Removing a short word is a change of meaning;
accepting a conventional closing comma must not become permission to forgive changed words.
