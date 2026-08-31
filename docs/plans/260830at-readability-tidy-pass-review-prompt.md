# Review: a model pass that tidies what Mozilla Readability kept

You are reviewing a **spike write-up with a recommendation**, plus the two instruments it was
measured with. Nothing has been shipped. Be adversarial: this project's culture is that a review's
job is to find the number that is wrong, the claim the evidence does not carry, and the check that
could never have failed.

Read, in the repo at the paths given:

1. `docs/plans/260830at-readability-tidy-pass.md` — the write-up under review.
2. `docs/plans/260827ab-readability-repair-pass.md` — the sibling plan, from a previous round. Its
   methodology rules (measure against the residual not against stock; print rather than score where
   there is no gold; a control that includes the answer measures the control) are the standard the
   new file claims to follow. Check whether it actually does.
3. `evals/extraction/probe.mts` — the new instrument. Reports `markers` (gistable block, no letter
   anywhere) and `tiny` (<=6 chars, has a letter, not a heading) plus longest-block.
4. `evals/extraction/tidy.mts` — the model arm. Sends every gistable block as `id, tag, chars,
   snippet`; the model returns ids to drop plus a reason enum, nothing else.
5. `evals/extraction/fixtures/README.md` — twenty-one fixtures, five added for this spike.
6. `evals/results/extraction-tidy-openai-gpt-5-6-luna-20of20.json` — the full Luna run,
   and the `-terra-14of15` / `-sonnet-5-9of15` files beside it.
7. `evals/extraction/inventory.mts` and `corpus.mts` — the pre-existing instruments, for context on
   `compare()` and `gainedText`.

## The questions that matter most

- **Is the headline finding real?** The claim is that Paul Graham's essay scores ratio 1.000 with
  zero dropped characters and is nevertheless broken, 87 of 328 blocks being punctuation. Check that
  the numbers in the doc match what the code produces and what the results files say. Several numbers
  in the doc are quoted from different runs; find any that are inconsistent with each other.
- **Is `markers` vs `tiny` the right cut, and is either one wrong?** `markers` is "no letter
  anywhere". What real article content has no letter in it? Numbered list items, chemical formulae,
  chess notation, mathematical expressions, CJK text (which contains no `\p{L}`? check), verse in a
  non-Latin script, table cells of pure numbers. The plan recommends shipping this rule
  deterministically in stage 3 — say plainly what it would destroy.
- **Does the eval's control actually discriminate?** The claim is that `shakespeare_hamlet.html`
  (52 verse lines) and the short headings/definition terms on Tufte/MDN/WHATWG stop a
  "drop everything short" policy from scoring well. Construct the trivial policy and say what it
  would actually score on this corpus. If it does well, the corpus does not discriminate and the
  whole result is weaker than claimed.
- **The false-positive rate.** "One false positive in three runs on one of twenty pages." Is that a
  defensible way to state it? What would the confidence interval be? What is the base rate this
  corpus cannot speak to?
- **The `PROSE_CHARS` threshold** was 200, missed a 177-character real footnote, and is now 100. Is
  moving it the right response, or does it just relocate the blind spot? Is there a better signal
  than length?
- **Model comparison.** Luna vs Terra vs Sonnet, one run each on most fixtures. Terra found RFC
  9110's 307-item table of contents where Luna found one block; Luna's marker recall was 2/18 on one
  page. Does the write-up over- or under-claim from this? Sonnet's rfc9110 run hit `max_tokens` and
  is absent from its results file — does the comparison table handle that honestly?
- **Ordering and scope.** The recommendation is: free regex first, model on the residual, do not act
  automatically yet, do not pay for Terra/Sonnet. Argue against that ordering if you can.
- **What the arm cannot do.** Two fixtures (`whitman.html` at 67,890 chars in one block,
  `hacker_howto.html` at 14,572) are failures a drop-mask cannot fix. The doc says splitting them is
  stage 3's job and does not recommend a model for it. Is that the right call?
- **Prompt design.** Greg asked whether the prompt should be "lots of before/after examples". The
  prompt in `tidy.mts` is instead two lists of one-line cases plus an explicit keep-when-unsure
  asymmetry. Is that the better shape? What is missing from either list? Name concrete additions.
- **Anything that could not have failed.** Every check, every number, every control: which of them
  would look identical if the thing it measures were broken?

## What to hand back

Findings ranked by how much they change the recommendation, each with: the claim, why it is wrong or
unsupported, and what would settle it. Say explicitly which claims you checked and found sound —
a review that lists only problems cannot be told from one that found everything wrong. If you think
the recommendation should change, say what to instead.
