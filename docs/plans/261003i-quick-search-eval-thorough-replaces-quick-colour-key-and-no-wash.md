# Quick search: an eval of what it misses, "thorough" replaces a quick row, a clearer colour key, and no text wash on a whole-paragraph hit

Up: [plans.md](../project/plans.md) · the area's doc is [search.md](../project/search.md)

Five feedback reports from Greg, all filed 2026-10-03 from Search mode on one article. His words:

> I tried a quick search in this article for Buddhism, and it didn't find anything, even though at
> one point it talks about Buddhist notions of no self. If I did the flesh out for the quick search,
> then it did find it. So it feels like the quick search is not working all that well. Can we do some
> evals on it to see if there's a different way to prompt it or anything like that? Or indeed, perhaps
> we might need to switch out the model. I think we could still do a quick search with an LLM that
> just responds with block IDs, and it won't be as quick as Jev, but it might still be quicker.
>
> — `spya-ats9dk`

> If I do a quick search and then click flesh out, I think the flesh out should replace the quick
> search because the flesh out version is presumably going to be better in every respect.
>
> — `spya-z4bae4`

> And if I do a quick search and then click flesh out, I don't think that phrase, flesh out, is very
> clear. Perhaps we could replace it with "thorough".
>
> — `spya-pra2h3`

> In the Search mode UI, it's not obvious enough next to the search terms which color they
> correspond to.
>
> — `spya-fwcwun`

> When I search for something and it matches against a block, I think it now adds a vertical line
> next to the block. That's good. It adds a vertical indicator in the spine. That's good, using the
> color of the search. Great. The only thing is it looks like it also sort of highlights the actual
> text of the block with the same color, which I think is probably not helpful because at the moment
> search only works at the level of a block, so it doesn't make sense to highlight the actual text,
> and it's just a little bit too much extra visual noise on top of all the other annotations we
> already have.
>
> — `spya-m59qg0`

Two stages, on disjoint files, so they run side by side: **A** is the eval (no production code until
it reports), **B** is the four UI changes.

## Stage A — why did quick search miss "Buddhism", and what would fix it

Quick search asks Jev one yes/no question per paragraph and keeps those at probability ≥ 0.7, top 20
([`src/quick-search.ts`](../../src/quick-search.ts); every number measured in
[261002o](../investigations/261002o-quick-search-spike.md)). That spike used 16 queries that were
mostly phrases and questions. Greg's miss is a different shape: **a one-word topic, against a
paragraph that mentions it in passing**. The spike never measured that shape.

1. **Reproduce.** Read the article's blocks from production, read-only, into a gitignored place (the
   text is not ours to commit). Find the paragraph(s) on Buddhist no-self. Ask Jev exactly as
   production does, three times, and record that paragraph's score and rank. That says which of
   these it is: under the floor, crowded out by the cap, lost to a chunk boundary, or never asked.
2. **An eval set for the shape that failed.** About 30 queries over 4–5 articles: the spike's 16
   (their Sonnet reference answers are already saved), plus new short topic and keyword queries
   whose target is a passing mention, on the Entropy article and the committed fixtures. The
   yardstick is the meaning search's hits plus a hand reading, as in the spike.
3. **Arms.**
   - Jev as shipped.
   - Jev with other question wordings (for example *mentions or is about*), and other floors,
     including a floor relative to the article's own top score.
   - **A small fast LLM that answers with block ids only** — Greg's suggestion. Two or three
     candidates through OpenRouter, chosen for speed. Measured: recall against the yardstick, junk in
     the top results read by hand, latency (median and p90 from the box, first id and last id), cost.
4. **Write it up** as
   [261003c](../investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md),
   with a recommendation.

**What ships from A.** A change of wording or floor that the eval shows is better ships in this
job, with `search.md` and the constants' comments updated to the new measurements. **Swapping the
model does not ship here**: it is a new prompt, a new model in `models.ts`, a new spend declaration
and probably streaming, so it goes to Greg as a question with the numbers. The simpler option passed
over is "lower the floor until Buddhism appears"; one query is not a measurement, and the spike
already showed 0.5 floods.

Spend ceiling for the eval: $5.

## Stage B — four UI changes

**B1. "flesh out" becomes "thorough"** (`spya-pra2h3`). The button's label, its tooltip, the help
page, `search.md`. The CSS class and internal names may stay or change; whichever the sweep finds
cheaper, but no reader-visible "flesh out" survives.

**B2. Thorough replaces the quick row** (`spya-z4bae4`). Today it adds a meaning row and unticks the
quick one, which stays. New behaviour: **pressing thorough starts the meaning search and deletes the
quick row at once**, in the browser, with the two calls the panel already has (`onAsk`, `onDelete`).
No server change.

- **The new row wears the quick row's colour.** Sol's note: use the browser's *resolved* slot (an
  automatic colour is not stored), written to the new row's existing `colour` field. The reader's
  marks should not change hue because they asked for more care.
- **What it costs, accepted:** the quick marks go the moment the button is pressed, and the
  thorough ones arrive one at a time over the next half minute. If the thorough search fails, its
  row says so and has the retry button; the quick answer is gone, and is a second and $0.0004 to
  ask again.
- **Passed over: delete the quick row only when thorough succeeds.** That was this plan's first
  version and GPT Sol's review took it apart (F1–F3 in
  [the review](261003i-quick-search-plan-review-sol.md)): it has to be done on the server, because
  the hook that could do it in the browser unmounts when the reader leaves Search mode; and done
  there it needs the source row protected from the 30-row trim while it waits, a re-check and a
  transaction at the finish, and a stored link from the meaning run to its source so a retry after
  a failure still replaces — a new column. Three mechanisms and a migration to keep a quick answer
  that costs a second to get back.
- Passed over: **upgrading the row in place** (same id, kind flips to meaning — the `revises`
  path). `withRun` deliberately refuses to revise across kinds.

**B3. The colour key** (`spya-fwcwun`). A saved row says its colour with a 2px left edge at 30%
strength and the tick's accent, which shows only when ticked. Add **a solid swatch of the search's
colour beside its words, at full strength whether or not the row is ticked**, and make the left edge
full strength too. `SearchPanel.tsx`'s comment argued a dot would be noise; Greg's report is the
evidence that it is not enough without one. The swatch is decoration (`aria-hidden`), not a fifth
control.

**B4. No wash on the words of a whole-paragraph hit** (`spya-m59qg0`). A quick hit's "quote" is its
whole paragraph, so the wash and the coloured rules under every line say nothing the bar down the
paragraph's edge does not. A hit whose quote is the whole block by design (quick) draws **the
paragraph bar and the spine mark only**. Pressing its row still shows which paragraph it is (the
open-hit ring stays). A **meaning** hit keeps its wash and rules, because there the words are a real
quote inside the paragraph, and so does a **words** match. Whether meaning's should go too is asked
of Greg, not decided here.

How, from Sol's F8: "whole paragraph by design" is not the `whole` flag on `Found` (that one means
quote placement *failed*). Carry an explicit flag from a quick run through `Found` and `Mark`. A
quick hit adds nothing to the wash strength or the stripes but keeps its `data-hit` identity,
because scrolling and flashing find the wrapper by it (`rows.ts`). The open-hit ring today needs
`data-wash`, so an opened quick hit gets an outline of its own. Tests: a quick hit overlapping a
meaning hit, a Quote, a comment and a glossary term, and a meaning hit whose quote fell back to the
whole paragraph (which keeps its wash).

**Plan review.** GPT Sol, 2026-10-03: [261003i-quick-search-plan-review-sol.md](261003i-quick-search-plan-review-sol.md).
F1–F3 answered by making B2 smaller (above). F4–F7, on the eval's controls and yardstick, were sent
to the eval as written: a boundary counterfactual and paired queries for the failing case, target
blocks declared before the arms run, absent-topic queries, precision after the cap, held-back
queries, and the same eligibility and cap for the LLM arms. F8 is the paragraph above.

**Checks for B.** Red-first tests for B2 (route and client) and B4 (annotate / marks); tests updated
for B1 and B3. `npm test`, `npm run typecheck`. A browser pass by a Sonnet subagent at desktop, iPad
and phone widths. The help page and `search.md` in the same stage.

## Open questions for Greg (asked in the debrief; nothing waits on them)

- **[Q-quick-model]** if the eval favours an LLM that returns ids: switch quick search to it?
- **[Q-meaning-wash]** should a meaning hit lose its text highlight too?
- **[Q-thorough-keep]** is losing the quick answer when a thorough search fails acceptable?

## What landed

**Stage B** (commit `bddc97fbc`, then GPT Sol's fixes). Built as planned. Two things differ from
the plan's wording:

- The new row's colour is pinned (it goes through the stored `colour` field), so it no longer follows
  the automatic hash. The reader can set it back to Automatic.
- `Found.bare` is the flag B4 carries; it is set where a quick run already asks for its preview
  from the top of the paragraph.

GPT Sol's code review ([261003i-quick-search-code-review-sol.md](261003i-quick-search-code-review-sol.md))
found and fixed two P1s, each red first: **C1**, a colour chosen in this tab was written back on
every later revision or retry, over a newer choice from another tab (now once, at the row's first
`begin`); **C2**, a quick hit's invisible mark still blocked the tap that selects a paragraph on
touch. Its write-ups are postmortems
[261003b](../postmortems/261003b-a-rendering-override-becomes-an-unrequested-persistence-command.md)
and [261003c](../postmortems/261003c-a-visual-marker-outlives-the-interaction-it-used-to-imply.md).
C3 and C4 were stale lines in `search.md` from before this job; fixed.

**Stage A.** The eval is
[261003c](../investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md);
spend about $1.50. The cause was the question's verb. Shipped: the question asks whether a passage
*mentions or discusses* what the reader wants, not whether it *matches*. The floor (0.7) and the cap
(20) stay. Checked on the real code path after the change: "Buddhism" on Greg's article returns the
Buddhist no-self paragraph at 95–96, three runs of three, and a topic the article lacks returns
nothing. Not shipped, and asked of Greg: an ids-only LLM as a middle tier, and literal matches
ahead of Jev's hits.
