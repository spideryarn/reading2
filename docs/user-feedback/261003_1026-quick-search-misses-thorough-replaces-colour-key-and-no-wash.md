---
reports: spya-ats9dk, spya-z4bae4, spya-pra2h3, spya-fwcwun, spya-m59qg0
ending: shipped
---
# Search mode: quick search misses a one-word topic, "thorough" replaces it, the colour key, and the text wash

From Greg (admin), five reports filed 2026-10-03 between 10:25 and 11:21 BST from Search mode on
`/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, relayed by the Overseer. One
session took all five because they are one screen.

**Ending: Shipped**, on `dev`, not deployed.

Plan: [261003i](../plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md).
The eval: [261003c](../investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md).

## `spya-ats9dk` — quick search found nothing for "Buddhism"

> I tried a quick search in this article for Buddhism, and it didn't find anything, even though at
> one point it talks about Buddhist notions of no self. If I did the flesh out for the quick search,
> then it did find it. So it feels like the quick search is not working all that well. Can we do some
> evals on it to see if there's a different way to prompt it or anything like that? Or indeed, perhaps
> we might need to switch out the model. I think we could still do a quick search with an LLM that
> just responds with block IDs, and it won't be as quick as Jev, but it might still be quicker.

The eval came first, as asked. On the old wording the paragraph was the model's top answer but
scored 0.70–0.75, on the 0.7 cut-off, and scores move a little between runs. The exact empty result
was not reproduced, so "it fell just under" is likely rather than shown. The question asked whether
a paragraph *matches* what you typed, and a paragraph that only mentions a topic scored low. It now
asks whether the paragraph *mentions or discusses* it. On 18 short searches the old wording missed
109 of 141 literal mentions and the new one misses 17. "Buddhism" on this article now finds the
paragraph at 95. The price is more wrong paragraphs on broad words: "Evolution" on this article
returns 18 to 20, about a third of them only loosely related. The cut-off stays at 0.7.

An LLM that answers with block ids was measured too (three models). It works. It takes 1.2 to 1.5
seconds on an ordinary article against 0.4, finds more on phrases and questions, and returns more
wrong paragraphs on one-word topics. Not adopted; whether to add it as a middle tier is a question
for Greg.

## `spya-z4bae4` and `spya-pra2h3` — "flesh out" should replace the quick search, and be called "thorough"

> If I do a quick search and then click flesh out, I think the flesh out should replace the quick
> search because the flesh out version is presumably going to be better in every respect.

> And if I do a quick search and then click flesh out, I don't think that phrase, flesh out, is very
> clear. Perhaps we could replace it with "thorough".

The button says **thorough**. Pressing it starts the full search and removes the quick one in the
same press, and the new search keeps the quick one's colour. The simpler version was built: the
quick answer goes at once, so if the thorough search fails it is not there to fall back on (it takes
a second to ask again). Keeping it until the thorough one succeeds needed a database change; the
plan says why that was passed over.

## `spya-fwcwun` — which colour is which search

> In the Search mode UI, it's not obvious enough next to the search terms which color they
> correspond to.

Each saved search has a solid square of its colour beside its words, and the coloured edge of its
row is full strength whether or not the search is ticked.

## `spya-m59qg0` — the wash on the text is noise

> When I search for something and it matches against a block, I think it now adds a vertical line
> next to the block. That's good. It adds a vertical indicator in the spine. That's good, using the
> color of the search. Great. The only thing is it looks like it also sort of highlights the actual
> text of the block with the same color, which I think is probably not helpful because at the moment
> search only works at the level of a block, so it doesn't make sense to highlight the actual text,
> and it's just a little bit too much extra visual noise on top of all the other annotations we
> already have.

A quick search's hit no longer paints anything on the words: the line beside the paragraph and the
mark in the spine only. A thorough (meaning) search still highlights the words it quotes, because
there the highlight is a sentence inside the paragraph, not the whole paragraph. Whether that should
go too is a question for Greg.

## Greg's answers, 2026-10-03

> Q-thorough-keep Well, I was inclined to go with B because it felt more robust. But I guess if it's really going to be half a day, maybe it's not worth it. I haven't tried it enough to have an opinion about whether it's likely that I'll lose a thorough search. Probably not. Use your judgment.

**Left as A** (the Overseer's call): Thorough replaces the quick search the moment it is pressed. If losing a quick answer to a failed thorough search ever shows up, keeping the quick one until the thorough one succeeds is the fix (about half a day).

> Q-meaning-wash A Ah, I may have misunderstood then. I didn't realize that the thorough search does highlight sentences. If that's the case, I guess that's cool.

**Kept**: a thorough search still highlights the sentence it matched.

> Q-quick-model A

**Stays on Jev**, with the new wording.

> Q-literal-first I would hope that if the word literally matches that it will have a high confidence. I think we should rely on that rather than adding weird special string match cases.

**Not built.** If a literal mention scores low, fix it in the prompt or the model, never with a string-match special case.
