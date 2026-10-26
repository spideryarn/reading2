# Design consult: Cited by for a piece with no DOI and no OpenAlex match

You are consulted while the design is still open. Read-only: do not edit any file. Answer in
under 1,200 words: what you would build, what in my sketch is wrong or risky, and anything I have
missed. Be concrete.

## The report (Greg, the admin, 2026-10-26)

Sources mode, on a piece with no DOI whose OpenAlex title search found nothing, says: *"We had no
DOI for this piece, and searching OpenAlex by its title found no record we could be sure is this
one, so we cannot list who cites it."* Greg: "a little bit defeatist … it should be possible to do
a web search based on author names or something with Google Scholar … hand excerpts of the
potentially citing articles that we found in the web search to an LLM to say is this a citation of
this article … the slower and slightly more expensive way, with a web search."

His standing cost rule (2026-10-25): free work may run proactively; paid work only when Sources is
opened; anything costing a lot, or per item, only on the reader's press. Here the brief says: a
button where that sentence is now. Ask him only if a run would cost well above $0.30.

## Constraints already fixed

- No Google Scholar scraping (its terms forbid automated queries); Greg declined Semantic Scholar
  on terms grounds. The web search we already use and pay for is OpenRouter's server tool
  `openrouter:web_search` with `engine: "exa"`. Every paid call goes through OpenRouter.
- We keep only URLs that are among the call's own `url_citation` annotations, and every quote is
  verified by code against that annotation's extract (`findQuote`, strict, at least six words).
  An extract is Exa's query-relevant snippet text, 1–2.5k characters, sometimes several joined
  with " ... ". In a sample of 427 stored extracts from another feature, the piece's title appeared
  in some: e.g. Zvi's blog post extract starts "Response to (Scott Alexander): Heuristics That
  Almost Always Work".
- Privacy: a title is sent out only for an article from a public address (an uploaded file's title
  may be confidential). The article's text is never sent.
- Code: `src/citation-index.ts` (OpenAlex citers, title search, `searchableTitle`,
  `titleMatchOf`), `src/citation-web-note.ts` (a similar paid, press-only, Haiku + one Exa search,
  code-checked note, with its allowance, staged SSE frames and a stored "none" for a week),
  `src/bibliography.ts` (`titleNamesWork`, `pageLooksLikeTheWork`), `src/openrouter-stream.ts`
  (`collectSearchEvidence`). Reception (`src/reception.ts`, docs/project/reception.md) is a
  separate paid search for "pages about the piece". Docs: docs/project/bibliography.md
  § A note from one web search; docs/project/sources.md § Where it sits.

## A free finding that changes the shape

OpenAlex's `filter=fulltext.search:"<exact title>"` (free, no key) returns works whose indexed full
text contains the phrase. Measured today, dropping works whose own title contains the phrase:

| Piece (no DOI) | title only | + author surname |
|---|---|---|
| Verbalizable Representations Form a Global Workspace in Language Models (2026, the reported one; no author on record) | 134, all 2026, top ones arXiv interpretability papers | — |
| LLM Powered Autonomous Agents (Weng, 2023 blog) | 279 | 210 (ChatDev, multi-agent surveys) |
| Do Things that Don't Scale (Graham) | 31 | 23 |
| More Is Different for AI (Steinhardt) | 4 | 1 |
| Understanding LSTM Networks (Olah) | 1,473 (stemmed phrase: also "Understanding LSTM Network Behaviour") | 1,061 |
| Simulators (janus) | 937,178 — useless | 2,657, mostly before 2022 — useless |
| Heuristics That Almost Always Work (Scott Alexander); Why working quickly… (Somers) | 0 | 0 |

So OpenAlex full text covers papers that cite a web piece; the web search covers what OpenAlex
does not index (blogs citing blogs). Neither covers one-word titles.

## My sketch

Shown only where today we say we cannot list (no-match; no-doi with a searchable title from a
public address; perhaps not-indexed).

1. **Free, on open** — OpenAlex full text: the exact title, plus the first author's surname when
   there is one; works titled as the piece dropped; works dated before the piece's year dropped;
   only for a title `searchableTitle` accepts (perhaps a stricter word count). Most cited first,
   five then *Show all*, cached seven days like the citers rows. Labelled: *papers whose full text,
   in OpenAlex's index, contains this piece's exact title (and its author's name) — a sign they
   cite it, not checked one by one.* No AI.
2. **Paid, on press** — *Search the web for works that cite it*: one Haiku call, the Exa tool, the
   prompt asks for one or two searches (the title in quotes, with the surname), about ten results;
   the model answers JSON `[{url, citingTitle, quote}]` naming each result whose extract cites or
   names the piece. Code keeps a row only if: the URL is an annotation's; the host is not the
   piece's own; the quote is in that extract; the quote itself names the piece (its title by
   `titleNamesWork`-like run, or the author's surname with the year); and it is not the piece
   itself or a copy. Stored per article (reader state, like `citation_web_notes`), a *none* kept
   for a week, its own allowance, stage frames rather than streamed words. Labelled *Found by a
   web search, not a citation index*, each row with its checked quote. Estimated cost: about 1–3
   cents a press (Bibliography's one-search Haiku note measures 0.8 cents).
3. **Measure** recall and precision on about eight no-DOI pieces locally: the free list's
   precision by fetching a sample of hits' open full text and finding the title in their
   references by code; the web search's yield and cost per press.

## Questions for you

1. Is the free full-text list honest enough to show unverified, or should code verify each shown
   row (e.g. fetch arXiv HTML) first? What precision would you want before showing it on open?
2. Should the free list and the paid web rows be one list or two? How to dedupe them?
3. Is "the quote names the piece" the right code check? How do you stop an extract that is a
   namesake, the piece's own page, an aggregator (Hacker News, a reading list) or a syndicated copy
   from passing?
4. A second LLM check (as citation notes do) or is one call plus code enough here?
5. What would you cut for a v1?
