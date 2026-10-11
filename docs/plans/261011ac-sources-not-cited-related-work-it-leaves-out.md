# Sources › Not cited: related work the piece leaves out

Queue item `qi-bk9r7kgc`. Idea C ("Sources: what it does not cite") of
[261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md)
§ Ideas, item 3. Greg's answer to part 4 of [q-fkq30v](../user-feedback/questions/q-fkq30v.md):

> 4 all? Use your judgment based on that combination of ease and value.
>
> — Greg, 2026-10-10 (reply spya-dbfeqh)

The research's own words for it: *"Reception's web search, aimed at work on the same question that
the piece does not cite. ICML and EC added this question to their reviewer forms. One caveat:
reviewers who ask authors to cite the reviewer's own work approve less often (eLife, 37,000
reviews), so every suggestion must say why it is relevant, and the reviewer decides."*

## What we build

A fifth Sources sub-mode, **Not cited**, after Bibliography:

```
 ┌ Bibliography 42 │ Not cited 18 │ Links 61 │ Reception 3 │ Claims 8 ┐
 │ Not cited — papers close to this one that its bibliography does not list
 │ Found by OpenAlex's search on this piece's title and opening, closest first.
 │ Whether any of them belongs in it is yours to judge.
 │
 │  Non-Autoregressive Neural Machine Translation               ↗
 │  Gu, Bradbury, Xiong, … · 2017 · cited 506
 │  "Existing approaches to neural machine translation condition…"   (its abstract, a stranger's text)
 │  …
```

**Free, and no model.** One OpenAlex request: `GET /works?search.semantic=<title + opening>` with
`filter=publication_year:<Y+1` when we know the piece's year, 25 results, `select` trimmed to id, doi,
title, year, authors, venue, cited-by count and the abstract. Measured 2026-10-11: 10 credits, i.e.
$0.001 of the anonymous $0.10/day allowance, no key. On *Attention Is All You Need* it returned
almost entirely machine-translation-with-attention papers from 2014–2017: ConvS2S, Luong's
attention, Sutskever's seq2seq, ByteNet, non-autoregressive NMT.

**The exclusion is ours, not OpenAlex's.** OpenAlex's `referenced_works` for that paper holds 28
works and misses Sutskever 2014 and ByteNet, both of which the paper cites. Excluding by it would
tell a reviewer the paper omits work it cites — the worst error this view could make. So a
candidate is dropped when it matches **our Bibliography** for the article: the same DOI or arXiv id
(the `key`), or its normalised title equal to a row's title, or contained in a row's `entry` (the
article's own reference text), or found in the article's prose. And the piece itself (its own title)
is dropped. With no Bibliography yet, the view does not guess: it says the bibliography has to be
listed first (Bibliography is made on import, so this is rare) and offers nothing to press.

**Why it is relevant, without a model.** The research asks that every suggestion say why. A
model-written line per row would be the stronger answer, but it adds a paid call, its storage, a
press rule, a rate policy and a prompt to maintain. v1 says why in facts the reader can check: it
is close to this piece by OpenAlex's search on the piece's own title and opening (rank order), and
here is its abstract's opening so the reader judges for themselves. The framing sentence says the
reviewer decides. A model-written "why" is the named next step if the list proves useful.

**Every row says what we know, not what we infer**: "not in its bibliography as we read it", never
"the piece should cite". The chip's card says how the rows were found and what was checked.

### Caching

The search's address carries the article's title and opening, so it is never logged
(citation-index.ts § What may be logged). A new table, `related_work_searches`, keeps OpenAlex's
answer under **a hash of the query and the year filter** (sha256, versioned): public bibliographic
results, no owner, no article id, no text of the article — so it is anonymous and safely shared,
and it keeps the allowance from being spent on every open. Fresh 7 days, as Cited by. The
exclusion runs at read time against the current Bibliography, so a Bibliography made again is
respected at once. Politeness is the shared limiter's (`inServiceTurn("openalex", …)`).

### Who sees it

**The owner only, as Cited by is.** The route goes through the owner filter
(`loadArticleIdentity`'s path); a visitor's band does not draw the chip. A visitor spending our
OpenAlex allowance is the reason, and is the same call 261004h made.

### When it runs

Only while the Not cited chip is showing (the read is mounted with its panel, not in every
sub-mode), and with no press: it is free in money and cached, like Cited by. Its chip has no
number until it has been read. Activation arms nothing for it (`activationForSources` → `null`, as
Links).

### States, each its own sentence

no-bibliography · no-query (no title and no prose to search with) · unavailable (Try again) ·
none (nothing close that it does not cite) · found (the list, with the date it was searched when
from the cache).

## Passed over

- **Reception-style paid web search** (the research's literal suggestion): ~20 cents a press,
  needs the whole quote-verification machinery, and returns web pages more than papers. OpenAlex's
  semantic search returns the papers themselves, for a tenth of a cent.
- **OpenAlex `related_works`** (free, on the piece's record): on the Transformer paper it gave
  ImageNet, LSTM, GloVe, Dropout, BERT (published later) and a digital-humanities paper. Too loose.
- **Bibliographic coupling** (`filter=cites:<its references>`, ranked by shared references): one
  credit, but the page is sorted by citation count, so it returned MobileNets and GANs. Too loose.
- **A model-written why per row**: deferred, above.
- **A section at the foot of Bibliography** instead of a chip: fewer files, but it would sit under
  a 40-row list; Links set the precedent that a new view of Sources is a chip.
- **Visitors**: not in v1, as Cited by.

## Stages

1. **Server** — `src/related-work.ts` (pure: query from the article, OpenAlex URL, parse, the
   exclusion matcher; then the orchestration with injected deps as citation-index.ts does), the
   `related_work_searches` table and migration, the Postgres store, `GET /api/related-work/:slug`,
   the result type in `src/types.ts`, its sentences in `src/messages.ts`. Tests: parse, matcher
   (including the two Transformer misses), cache key, every state.
2. **Client** — `not-cited` in `SOURCES_SUB_MODES` and the params, `NotCitedPanel`, the hook, the
   chip (owner only), the card text, command-bar aliases, the help page, docs (sources.md, a line in
   bibliography.md), and the tests the Links commit had to touch for a new chip.
3. Browser check (Sonnet subagent), GPT Sol code review, push to dev, bookkeeping.

## Done looks like

On the owner's Transformer import, Not cited lists 2014–2017 attention/NMT papers, none of them in
its bibliography, and Sutskever 2014 is not among them. `npm test`, `npm run typecheck` green.

## GPT Sol's plan review, and what changed

[Review](261011ac-sources-not-cited-plan-review-sol.md): BUILD WITH CHANGES, nine findings. Each
was checked against the code; all accepted, some reshaped. **This section overrides the body above
where they differ.**

- **F1 (P1), the article's words leave for OpenAlex.** Cited by sends only a DOI or a title, and
  [privacy.md](../project/privacy.md) promises OpenAlex never gets the rest of the text; a referee
  may have uploaded a confidential manuscript. So **the search runs on the owner's press**, not on
  opening the chip: *Search OpenAlex for related work*, with a line under it saying it sends the
  piece's title and the opening of its text (its abstract, on a paper) to OpenAlex. Once searched,
  the stored answer is drawn on every later open without a press; *Search again* re-sends. The
  privacy page, privacy.md, `LAST_UPDATED` and the privacy test change in the same stage.
- **F2 (P1), the cache key.** Not a global hash-keyed table: **one row per article**
  (`related_work_searches`, `article_id` primary key, `on delete cascade`), holding the input
  fingerprint (versioned sha256 of the query and year filter, never logged), OpenAlex's parsed
  results and `searched_at`. Deleting the article deletes it.
- **F3 (P1), the exclusion matcher**, tiered, false "not cited" being the worse error:
  1. identifier: a candidate's DOI (normalised; arXiv's `10.48550/arxiv.<id>` and a bare arXiv id
     are one identity) equals a Bibliography row's `doi:`/`arxiv:` key or its row's resolved DOI,
     ignoring an identifier the row marks as conflicting;
  2. title: the candidate's title agrees with a row's title by the registry's own title test
     (`registryTitleAgrees`), allowing for a row title cut at 120 characters (prefix agreement on a
     distinctive title, `registryTitleIsDistinctive`);
  3. entry: a distinctive candidate title found in a row's `entry` (the article's own reference
     text).
  No matching against the article's prose (a work merely discussed is not cited). The piece itself
  is dropped by DOI, or by title plus an author or the year — never by title alone. Tests cover
  misses and false exclusions both: subtitle and punctuation variants, a cut title, arXiv vs DOI, a
  generic title ("Introduction") that must not exclude, a conflicting DOI.
- **F4 (P1), a stale or capped Bibliography.** The rows always say *not among the works Spideryarn
  found in its bibliography*, never *not cited*; and the panel puts a warning above the list when
  the Bibliography is stale (made from an older version) or `capped` (some works were left out),
  saying the list may include works the piece does cite. No list at all → its own sentence, with no
  search button.
- **F5 (P1), OpenAlex's answer is a stranger's text** ([security-map.md](../project/security-map.md)):
  the request built with `URLSearchParams`; ids and DOIs shape-checked; every string through
  `plainRegistryText` with a bound; the abstract rebuilt from the inverted index with bounds on
  tokens, positions and length; ids deduplicated; every link built by `citerUrl`; nothing logged
  that could carry the query.
- **F6 (P1), the missing paths.** A server loader for the owner that reads, in one snapshot, the
  imported title, authors, year, the opening blocks and the current Bibliography with its
  freshness. Client: `SOURCES_VIEWS`, `ReceptionAndClaimsView`, both bands, `sourcesCounts`,
  `countOf`, `VIEW_HOW`, `activationForSources`. **A visitor never sees the chip**, and
  `?sources=not-cited` on a visitor's page degrades to Bibliography. Tests for URL state, the
  command bar, the owner-only route, the surface shape, the count, the visitor.
- **F7 (P2), the recipe**, version `related-work/1`: the imported title, then `meta.abstract` if
  there is one, else the article's first prose blocks (paragraphs, not headings) up to 1,000
  characters cut at a word; title alone if there is no prose. Year filter
  `publication_year:<Y+1` only when the piece's year is known; otherwise the panel says the list is
  not limited by date.
- **F8 (P2), two cold searches at once.** With a press and the button held until the answer is
  read, the race is two tabs pressing in the same second, each spending $0.001 of the free
  allowance; the second write wins. Accepted and written in the module header; no claim table.
- **F9 (P3).** The mock row is now one the paper does not cite.

So the routes are `GET /api/related-work/:slug` (the stored answer, filtered at read time, or
`not-searched`; never calls OpenAlex) and `POST /api/related-work/:slug` (searches, stores,
answers). Both owner-only.
