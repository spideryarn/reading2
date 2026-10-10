# Citations: a row says only what the bibliography supports

Up: [plans.md](../project/plans.md) · the mode: [citations.md](../project/bibliography.md)

Greg, through the Feedback button, 2026-10-03 (`spya-zmdb7y`), on the Entropy article:

> it seems as though it's actually just giving some kind of paraphrase of what's already in the text
> about that piece and not adding anything. If that's the case, and I mean that kind of makes sense,
> that's all it can do without searching the web. That's almost no value. … And we don't want to
> mislead the reader into thinking that that's what the paper actually says when actually there's no
> new information beyond what's in the text. So instead, I think citations mode should perhaps err
> on the side of saying, you know, nothing about a paper beyond what's available in the
> bibliography, but I know we have a dig deeper or something button that can then go out to the web.
> Great. So better to say less and allow the user to ask for more and be explicit about the
> limitations

The full report is in the feedback note.

## What a row says today

Title, authors · year, the entry from the reference list — all the article's own. Then one sentence
the model wrote, `why`, labelled *what the article uses it for*, then *We have not read this work,
only the article that cites it.* The same sentence is on the hover card in the prose, and in
Marginalia's opened citation note, where it has **no label at all**.

`why` is the only thing on a default row that is the model's own words about the work. It is written
from the citing paragraph, so it can only restate that paragraph. The label was added on 2026-09-29
(260929g) to stop it reading as the paper's content; Greg's report says it still does.

## Measured before

`evals/citations-say-less.ts`, free, over the five local articles with a stored list (194 rows);
the write-up is
[261003d](../investigations/261003d-what-a-citations-row-says-and-where-it-came-from.md):

| article | rows | `why` words a row | `why` words in all |
|---|---|---|---|
| spider-silk | 80 | 8.9 | 711 |
| antikythera-mechanism | 46 | 12.5 | 574 |
| scaling-hypothesis | 58 | 11.8 | 682 |
| openai-huggingface | 8 | 17.5 | 140 |
| vb | 2 | 18.0 | 36 |

Every row carries the sentence: 2,143 words of model paraphrase across 194 rows. Between a third and
a half of each sentence's content words are not in the citing paragraphs, which is what a paraphrase
looks like; reading thirty of them found none that told me something the citing paragraph did not.

The same script flags a row when a word of its title, authors or year is nowhere in the article's
text or the row's entry. It is a lexical flag over the whole article, so it catches a name the
article never says and cannot see a name given to the wrong work. It flagged eleven rows, read by
hand in the write-up. Seven are titles the model built where the article gives none (*"Roon's
Twitter reply"*), which the prompt asks for. Two years are false alarms (`1963` glued to `63ya`).
Three are authors: **one from the model's memory** (*The Bitter Lesson · Sutton*, where the article
never names Sutton), one the model correcting the article's typo (*Dojolonga*), one carrying the
model's gloss (*Archimedes (attributed by Pappus of Alexandria)*).

## What changes

1. **The band's row** no longer draws `why` by default. It draws it, with its label, only once the
   row has something it was checked against: a *Dig deeper* answer or a quick-check reading
   (`showsWhy` asks about the assessed lookup and the displayed investigation view). There the sentence is the
   claim under test — the verdict line reads *supports what the article uses it for*, which means
   nothing if the reader cannot see what that is.
2. **The hover card** in the prose: the same function (`showsWhy`), asked only about the quick
   check. The card draws no *Dig deeper* answer, so a kept answer alone does not bring `why` back
   there: each surface shows the claim exactly when it shows something checked against it.
3. **Marginalia's opened citation note** drops `why` and shows the article's own reference entry
   instead, when the row has one. A lone work with neither a by-line nor an entry shows its title, so
   the opened note is never empty.
4. *We have not read this work, only the article that cites it* stays on every row and card. With no
   sentence above it, it is now the whole of what we say, which is the point.

5. **Code drops authors or a year the article never gives**, when the list is made
   (`locateInArticle` in `src/citations.ts`). Added after GPT Sol's plan review (P1): the plan first
   left this as a question, and the review's point was that a known exception to the rule being
   built should not ship beside it. Every word of the authors must be a word of the article's text
   or its PDF reference list; a bare four-digit year must be in it somewhere, while a suffix or
   date phrase must occur together. Otherwise the field
   goes, the row stays, and `authorsUnfound` / `yearUnfound` count it. The check is the
   conservative one: it does not try to match a corrected spelling, so the typo row loses its
   by-line too. It cannot tell a name given to the wrong work. A list already stored keeps what it
   has until it is made again; `PROMPT_VERSION` is not bumped, because no prompt changed.
6. **The entry's caption** loses *We have not looked the work up*, which is false on a row *Dig
   deeper* has read (P6). It now reads *…copied from the article, not from the work.*

In the band the sentence also shows while an answer streams, before anything is kept: the quick
check can find nothing while the answer still streams (P2). Progress alone does not show the
sentence, including during a retry that temporarily replaces the kept answer.

A visitor has no lookup and no investigation, so a visitor never sees `why`.

**Not changed**: the prompt, the schema, `PROMPT_VERSION`. `why` is still written
and stored, because *Dig deeper* is built on it — the quick check judges the search extract against
it, the paper's passages are picked by it, the streamed answer is told it, and both fingerprints
cover it (`citation-lookup.ts`, `citation-paper-passages.ts`, `citation-investigate.ts`). Chat's
`article_citations` tool still returns it, labelled *used for*; that is the reader asking.

So nothing needs re-running for the display change, and a list made last week is drawn the new way
at once.

## Measured after

**The display.** No row, card or Marginalia note draws `why` until something is checked against it.
That is held by rendering tests, not by the script: `tests/citations-panel.test.tsx`,
`tests/citation-hover-card.test.tsx` and `tests/marginalia-shut-notes.test.tsx`, each seen red
first. On the 194 stored rows, none of which has a *Dig deeper* answer locally, that is 2,143 words
before and 0 after.

**The original guard measurement.** The block-only replay called `locateInArticle` on stored rows
with no entry: it
drops **3 by-lines in 194 rows and no years** — exactly the three authors above. The two glued
years are kept. Code review corrected the replay to use `toDrafts` for every stored row, including
HTML entries, and to read a PDF's reference list. Remeasured with the corrected
replay on 2026-10-03, outside the sandbox: the same three by-lines and no years.

Code review also separated the pre-guard folding key from displayed metadata and normalized old
metadata when inheriting IDs. Removing an unsupported by-line must not merge different works,
split a shorthand from its entry, or change an otherwise uniquely matched row's ID. Regression
tests cover all three; ambiguous old matches inherit nothing.

## The simpler option passed over, and the larger one

- **Simpler: delete `why` from the row and never show it.** Passed over because after *Dig deeper*
  the verdict refers to it, and hiding the claim under test makes the verdict unreadable.
- **Larger: stop the model writing `why` at all.** It would save about 12 output words a row and
  remove a field nobody sees by default. Passed over for now because the on-request path would need
  a new statement of the claim (the citing passage alone), three prompts changed and re-measured,
  and two fingerprints bumped, which hides every kept *Dig deeper* answer. [Q-stop-writing-why].

## Questions for Greg

**[Q-stop-writing-why]** Above. Recommend leaving it until *Dig deeper*'s prompts are next touched.

**[Q-influence]** The *influence* bar is the model's memory of how well known a work is. That is
something we say about the paper that the bibliography does not support. It is disclosed in the
band's (i), and it feeds the default *prioritised* order.

- **A. Keep it** (what is built). The order stays useful; the claim is small and disclosed.
- **B. Drop the bar from the row, keep it in the order.** The row says less; the order is then
  shaped by a number the reader cannot see.
- **C. Drop influence altogether**, ordering by relevance alone.
- Recommend **A**: it is a ranking hint, not a statement of what the paper says, which is what the
  report objects to.

## GPT Sol's plan review

[The review](261003j-citations-say-less-plan-review-sol.md): *build after fixes*, seven findings.

| | finding | what was done |
|---|---|---|
| P1 | the default row still says more than the article: an author from memory, the influence bar, registry-filled authors | **Author and year: fixed**, change 5. **Influence: left, as [Q-influence]**: it is a ranking hint and not a statement of what the paper says, and removing it changes the default order. **Registry authors: left**: they come from Crossref by the article's own DOI, are marked *from Crossref*, and are bibliographic facts, not our reading of the paper. |
| P2 | a streaming answer can need `why` before the rule allows it | fixed: the row being dug shows it; test added |
| P3 | the hover card shows no *Dig deeper* answer, so must not use the kept answer | already so: the card asks only about the quick check |
| P4 | "one row in 194" is a hand reading, not what the script establishes | reworded here and in the write-up; the script's header says what it cannot see |
| P5 | the script swallowed read failures and did not measure "after" | it now skips only a missing list and throws otherwise; "after" is the rendering tests plus the guard replay |
| P6 | the entry caption's *We have not looked the work up* is false after a lookup | fixed, change 6 |
| P7 | keeping `why` stored is right for a first version; no other surface draws it | agreed |

## GPT Sol's code review

[The review](261003j-citations-say-less-code-review-sol.md): *land*. It fixed six things in place,
each read and re-run by me: dropping a by-line was changing how rows fold together and inherit
their ids (C1, the serious one, now with a separate fold key and three regression tests); the band
showed `why` during progress with no answer on screen (C2); possessives on apostrophe names and
year suffixes (C3); the cache ignored the reference list (C4); the eval's replay differed from
production (C5); two fixtures shared one `why` (C6). Left open, C7: the PDF-entry check, which is
older than this plan, drops a year with no four digits (*n.d.*, *in press*). Not changed here.

## Browser check

Sonnet subagent, Playwright, 1440, 820 and 390 wide, on three local articles: no sentence on any
default row (70 rows, 0 `.cite-why`), spacing even, hover and tap cards tidy with no stray gap,
Marginalia's opened note shows title and by-line, the three local rows with a quick-check verdict
still show the sentence, no console errors. Not seen in a browser: Marginalia's entry line (no local
work has one; its test covers it) and a row with a *Dig deeper* answer (none locally, and pressing
it costs money).

## Stages

One stage: the three surfaces, their tests seen red first, citations.md, a browser check at desktop,
iPad and phone widths, GPT Sol's code review.
