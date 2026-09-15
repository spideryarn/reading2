# A search result's card opens from the score, and pressing the result goes there

Sentry `SPIDERYARN-READING2-3T`, 2026-09-12 10:48Z, kind `suggestion`, from Greg (an admin).
Standing on `temporal-context-reinstatement-spya-dhqkf9`, build `d358f773`.

> When I click on an entry, like one of the Search results, it shows me a rich explanatory tooltip
> that doesn't seem to go away, and it's just too intrusive. I think it should only show that rich
> tooltip (that explains what the bar and the score is) if I click on the bar and the score, not on
> the entry itself, because I want to be able to click on the entry to be taken to that place in
> the text.

**Ending: shipped** — on `dev`.

The search result's card moved off the whole row and onto the left-hand gutter (the confidence
number and the place bar). Pressing the words jumps to the passage and opens nothing. Pressing the
gutter shows the card and does not jump. Glossary, Quotes and Citations were checked and already
behaved this way, since their card is on the score bars rather than on the row. The plan, the
reasoning and what was passed over are in
[260915c](../plans/260915c-search-result-score-card-only-from-the-score.md).
