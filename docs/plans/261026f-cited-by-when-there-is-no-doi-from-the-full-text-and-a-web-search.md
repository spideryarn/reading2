# Cited by when there is no DOI: from OpenAlex's full text, and a web search on a press

Report `spya-vx23nt` (Greg, admin, a suggestion, 2026-10-26, on Sources for
`index-spya-wq3rud`, *Verbalizable Representations Form a Global Workspace in Language Models*,
transformer-circuits.pub). Session `fbvx23nt-cited-by-web-search`. The mode is
[sources.md](../project/sources.md); the list it extends is
[reception.md § Cited by](../project/reception.md) and *Where it sits*' *After it*. It follows
[261011q](261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md), which
added the OpenAlex title search and the sentence Greg is answering.

## What Greg said

> "We had no DOI for this piece, and searching OpenAlex by its title found no record we could be
> sure is this one, so we cannot list who cites it."
>
> This seems a little bit defeatist. I mean, I understand that it's much easier to tell who cites
> it with OpenAlex, but I feel like it should be possible to do a web search based on author names
> or something with Google Scholar, or I don't know, that would, you would then have to hand to an
> LLM to interpret, that would give us an indication of who cites it, even if that means, yeah, so
> we perhaps we hand excerpts of the potentially citing articles that we found in the web search to
> an LLM to say is this a citation of this article or whatever, and then, yeah, I just feel like it
> should be possible to do this, that as well, the slower and slightly more expensive way, with a
> web search.
>
> — Greg, 2026-10-26 (`spya-vx23nt`)

And the cost rule this sits under:

> if there's something we can do for free, great, let's do that proactively. If there's something
> that's going to cost money, only do that when we open the sources mode. If it's going to cost a
> lot of money, like per citation or something, then maybe we only do that when the user requests
> something for that citation rather than proactively.
>
> — Greg, 2026-10-25 (answer to q-vg2b69)

## What the research found

Written up in full in
[261026a](../investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md).
In short:

1. **A free route exists, and it is better than the web search for papers.** OpenAlex's
   `fulltext.search` filter finds works whose indexed full text contains a phrase. For the reported
   piece it finds 129 works from 2026 that contain its exact title; for Lilian Weng's *LLM Powered
   Autonomous Agents*, 278. Fetching the open copy of the top five hits for twelve pieces and
   asking code whether the title stands next to the author's surname or the piece's own address, as
   a reference entry does: **33 of the 35 readable hits cite the piece (94%) for the pieces whose
   list would be shown**; the reported piece's other two name its real authors, which our record of
   it lacks. **Over every row the panel would show (25 a piece), 143 of 175 (82%)**, or 89%
   counting the reported piece's: the tail is weaker.
2. **It fails on a title that is an everyday phrase** (*Simulators*: 937,178 hits;
   *Normalization of deviance*: 1,031; *How to Do Great Work*). The tell is free too: **works
   from before the piece existed cannot cite it**, so if the phrase turns up at more than a small
   rate per year before the piece's year, it is a phrase, not a citation.
3. **The paid web search we already run does not answer this question.** Reception's search
   (*Pages about it*) looks for pages that say something *about* the piece; on the eleven no-DOI
   pieces with a stored search locally it kept 0 or 1 rows each, from 9–12 results (0 for
   *Dropout* and *The Extended Mind*, both cited tens of thousands of times). A citer search keeps
   any page that cites the piece, which is a different filter on a different query.
4. **Google Scholar cannot be used** (its terms forbid automated queries), and Greg declined
   Semantic Scholar on terms grounds. The web search we pay for is OpenRouter's
   `openrouter:web_search` with Exa ([ai-gateway.md](../project/ai-gateway.md)).
5. **The paid half cannot be measured today.** The box's OpenRouter key is past its monthly limit
   ($602 of $600, until 2026-11-01), and [ai-gateway.md § The box's key has a monthly
   limit](../project/ai-gateway.md#the-boxs-key-has-a-monthly-limit-and-it-runs-out) says to wait
   rather than reach for another key, and not to ship a prompt unmeasured.

## What we will do, in one paragraph

**Plainly, for Greg: the half that ships first is not the one you described.** Where *After it*
(and Reception's *Cited by*) can list nothing because there is no DOI or no sure OpenAlex record, it
shows **Possible citations**: up to 25 research papers whose text matched a search for the piece's
title, free, from OpenAlex, in place of the sentence you called defeatist. It needs no model and
found 129 papers for the piece you reported. **It is behind the experimental switch**: about 8 or
9 rows in 10 it shows really cite the piece, short of the 95% a list shown to everyone should meet
(decision 1). **Your version, the web search with a model judging
each page, is designed here and waits only to be measured**: the box's OpenRouter key is out until
2026-11-01, and a prompt is not shipped unmeasured. It is a queue entry with that date (§ Stage 3),
and it covers what the free list cannot: blog posts and web pages that cite the piece.

A title that is an everyday phrase gets a sentence saying so instead of a list. The no-DOI sentence
is shown only when there is nothing to list, and reworded so it says what we can do.

```
 After it
 Possible citations · 25 of 129                                    newest first
 Research papers whose text matched a search for this piece's title. Most will refer to it;
 we have not checked each one.
   Reader–Writer Coupling in Transformer MLPs
   Smith, Jones et al. · arXiv · 2026
   Interpreting Model Reasoning through Behavioral Counterfactuals
   …                                                                   Show 20 more
 See all 129 at OpenAlex, a free index of research papers ↗
 This finds papers only. Blog posts and web pages that cite it are not here.
 ─────
 [ Look for blog posts and web pages that cite it ]   estimated a few cents     ← Stage 3
```

## Decisions taken without asking

The brief says to ask only about a genuine trade-off, such as a cost well above $0.30. Nothing here
costs that, and each choice below follows from Greg's cost rule or the measurement.

1. **The free list runs on open, behind the experimental switch** (changed after the plan review).
   Greg's rule says free work runs proactively; it does not say unvalidated results leave the
   switch (Sol's F1). Opus would have shipped it to everyone, Sol would keep it experimental below
   95%. The top five measured 94%; **every row the panel would show measured 82%**, or 89% counting
   the reported piece's citers that name its real authors (the investigation's `shown`). So it is
   experimental, which is also where Greg plays with new things (*"I'd rather play than discuss"*,
   2026-10-25), under the name *Possible citations* and never *Cited by*, never added to a count.
   Leaving the switch is a later call, on a measured fix (the investigation names one: the author's
   surname in the full text as well, which is a privacy change).
2. **Only the title is sent**, as the title search already does, and only for an article from a
   public address. The author's surname is not added to the query: it cut Weng's hits by a quarter
   and removed none of *Simulators*' noise (Opus), and leaving it out keeps
   [privacy.md](../project/privacy.md)'s *"Its authors are not sent"* true. The public-address
   condition is new for this list (the title search has none); the full-text list is a stronger
   claim about the title, so it takes the stricter rule `citation-blurbs.ts` §
   `importedFromAPublicAddress` already applies.
3. **The phrase gate** (Opus; exact after Sol's F3). For a piece of year Y, *before* is the count of
   works matching the title dated Y-10 to Y-2 inclusive (nine years), *since* the count dated Y-1 to
   now inclusive (now − Y + 2 years). It is a phrase when *before* ≥ 3 **and** *before* / 9 is
   strictly greater than 5% of *since* / (now − Y + 2); so *since* = 0 with three or more before is
   a phrase, and two or fewer before never is. A year after the current one is treated as no year.
   The panel then says *"Older papers used these words too often for this search to tell citations
   of this piece from other uses of them."* (Sol's evidenced wording.) No year (the reported piece):
   no gate, and the title must have at least six words; with a year, `registryTitleIsDistinctive`
   (three words, two of them distinctive).
4. **Sol's filter corrections**: drop the piece's own records only — the same words as its title,
   or the same after a leading *A*, *An* or *The* (*A Verbalizable Representations…*), not every
   title containing it and not the title with two words added (Sol's F5), so *Response to …*,
   *Comment on …* and *Revisiting …* stay; keep works dated from the year before the piece's (preprints, editions,
   date errors); never sort by citations alone — a piece two years old or less, or with no year,
   is `publication_date:desc`, an older one `cited_by_count:desc,publication_date:desc`; bound the
   list at 25 and link to the rest at OpenAlex rather than fetching them.
5. **No per-row fetch of open copies on open.** It would check most rows for free, but arXiv asks
   automated clients for one request every three seconds, five checks would hold the panel for
   fifteen, and a list half-checked reads as two kinds of row (Sol). Measured in the investigation
   instead; a press to check a row is a later idea.
6. **Not cached** (changed after the plan review). The first draft kept one row per article, as
   *Not cited* does; Sol's F7 and F8 then listed what that table owes — a fingerprint that must
   include the current year (the gate's windows move at New Year), served-stale rules, deletion,
   transfer, both exports, rollback and drift tests. The title search beside it has been made on
   every open, uncached, since 261011q, and the list costs one or two requests more on the same
   shared allowance. So v1 asks each time; a cache is a later change if the allowance bites, which
   is the same condition 261011q queued its own under.
7. **The paid half is a citer search of its own, not Reception's.** Opus proposed pointing at
   *Pages about it* instead. Measured, Reception kept 0 or 1 rows from 5–12 results on every stored
   no-DOI search, including none for *The Extended Mind* and *Dropout*: it looks for discussion,
   not citation. So the button is new, and it reuses Reception's checks (canonical address,
   `namesArticleBy`, copy detection) rather than writing weaker ones (Sol).

## Stages

Each is committed and pushed to `dev`, and leaves Sources working.

### Stage 1 — the free list, on the server, and the privacy page with it (now)

- `src/citation-fulltext.ts`: `possibleCitersOf(identity, deps)` — the eligibility (public
  address, the word counts, a future year as none), the gate's count request and the list request
  through `openAlexInTurn` (the shared polite limiter and the key header), the own-record rule, the
  year filter, parsing with `parseOpenAlexCiters` (the same plain-text bounds as the citers). The
  query is `titleQueryOf`'s: NFKC, lower-cased letter-and-digit runs, cut at a word, the whole
  request built with `URLSearchParams` (Sol's F4). Answers `PossibleCiters` (`src/types.ts`):
  `found` (`total`, `dropped`, `order`, `phrase`, `citers`), `common-phrase`, `none`,
  `unavailable`; null when nothing is asked.
- `loadArticleIdentity` gains `filename` (`raw_filename`, already in the `article` read's grants),
  so the upload rule runs through `importedFromAPublicAddress` itself (Sol's F6).
- The route: `GET /api/citers/:slug?with=possible` adds `possible` to a `no-doi` or `no-match`
  answer; any other `with` is a 400. Without it nothing changes.
- **`/privacy` and [privacy.md](../project/privacy.md) in this stage**, `LAST_UPDATED` 26 October
  2026 (F6: a callable route is a disclosure whether or not today's client calls it).
- Tests, each seen to fail on a mutation of the rule: an upload and an address-less article ask
  nothing; *Simulators* asks nothing; six words with no year; a future year as none; the decoded
  filter exact for a hostile title; the gate at 0, 2 and 3 before, *since* = 0, exactly 5%, the
  current year; the own record dropped and *Response to*, *Comment on*, *Revisiting* kept; one
  request with no year, two with one, their exact windows and sorts; `unavailable` for either
  failing; the phrase never in a log line.

### Stage 2 — the free list, on screen (after 261025h stage 4 is on `origin/dev`)

With the experimental switch on (decision 1; [experimental-features.md](../project/experimental-features.md)
gets its row), `useCiters` asks with `?with=possible` and validates `possible` strictly when present, and draws the
plain sentence when it is absent (an older server after a rollback: Sol's F7); `CitersAnswer` draws
`PossibleCiters` under the `no-doi` and `no-match` sentences (`src/web/PossibleCiters.tsx`, its
rows the same `CiterRow`), in *After it* and in Reception's *Cited by*. The words in
`src/messages.ts`. `/privacy` and [privacy.md](../project/privacy.md) (the list's request, its
timing and the public-address rule), `CITERS_ABOUT`, [sources.md](../project/sources.md),
[reception.md](../project/reception.md) § Cited by, the Sources help page. A browser check by a
Sonnet subagent on the Weng and Graham articles, desktop and phone.

This touches `useCiters.ts` and `ReceptionAndClaimsPanel.tsx`, which the paused 261025h session has
changed and not pushed, so it waits for that work to land, then merges.

### Stage 3 — the paid web search (after the box's key resets on 2026-11-01; queued)

Designed now so the queue entry carries it. Owner only, on the press, never on open.

- **The call**: one Haiku call with Exa (`max_total_results` 10). The prompt asks for at most two
  searches: the piece's public address in quotes, then its exact title in quotes with the first
  author's surname when there is one. JSON answer `[{url, quote}]`, one per result whose extract
  cites the piece. No `citingTitle` from the model: the annotation's title is stored (Sol).
- **Code keeps a row only if**: the URL is one of the call's annotations; it is not the piece's
  address or an alias, and not a copy of the article (Reception's shingle check, run locally, so
  the article's text is never sent); the quote is in a single extract segment (`findQuote`
  strict, never across `EXTRACT_SEPARATOR`); and the quote identifies the piece by its address, or
  by its full title — for a title under six words, the title and the surname. Same-host pages are
  allowed (a later post on the same blog can cite it).
- **A second, tools-free, batched check** over the surviving extracts classifies each as *citing
  work*, *the piece or a copy*, *list or aggregator*, *another work of the same name* or *unclear*,
  and only *citing work* is kept (Sol; measured, and removed if it adds nothing).
- **Stored per article** (reader state, deleted with it), a *none* kept for a week, a fingerprint
  of the identity and the checks' version; its own allowance bucket; one at a time per reader;
  stage frames, not streamed words (the stated exception bibliography.md's web notes use); at most
  five rows shown, each with its checked quote and host, under *Found by a web search*.
- **Measured before it ships**, on the eleven pieces here plus DOI-backed papers with the DOI hidden
  (known positives) and blog-to-blog pairs: recall against those, precision, searches actually made
  and cost per press. If a press costs well above $0.30, it goes to Greg.
- **Before it starts** (Sol's plan review, F9): a per-press spend fuse enforced in code, since
  `max_total_results` caps evidence and not searches and "at most two" is only a prompt's request;
  the title, surname and address fenced as untrusted data in the prompt; the public-address rule
  applied before anything goes to OpenRouter or Exa; rows Reception has already checked reused
  rather than bought again; and the two evidence classes deduplicated by DOI, arXiv id, OpenAlex
  id or canonical address, keeping both provenance labels.

## What is left out, and why

- **Google Scholar and Semantic Scholar**: their terms (Greg, 2026-10-25, on Semantic Scholar).
- **Adopting an identifier a citing paper gives for the piece** (Opus): one citing paper gives the
  reported piece an arXiv number whose DOI OpenAlex resolves to a different paper.
- **`not-indexed` and `unconfirmed`**: a DOI exists in both; v1 is the no-DOI cases Greg reported.
- **Checking each row's open copy** (decision 5).

## The simpler options passed over

- **Only a better sentence, pointing at *Pages about it***: no new code, but measured, that search
  does not find citers (decision 7).
- **Ship the paid web search alone, as Greg described** (Sol's preference): it cannot be measured
  until 2026-11-01, and the free list finds hundreds of papers the web search would not reach in
  ten results.
- **A cache** (the first draft's, passed over in turn): decision 6.

## Persona reviews

Four Sonnet subagents read today's screenshots (`261026f-shot-1` … `-5`, before any change) and the
mock: a UI/UX designer, a product manager, an interpretability researcher and a first-time reader.
Taken, all in the mock above and Stage 2:

- **The list first, the apology only when there is nothing** (designer, first-time reader): the
  reader met *cannot* and then a list. The no-DOI sentence moves to the empty case, and the
  common-phrase sentence says why in plain words.
- **One count** (designer): *Possible citations · 25 of 129*, five rows then *Show 20 more*, one
  link out naming what OpenAlex is (first-time reader: *a free index of research papers*).
- **The plain line**: *Research papers whose text matched a search for this piece's title. Most
  will refer to it; we have not checked each one.* — "full text" read as "copies of my article",
  two hedges in one line read as noise, and (Sol's plan review, F2) OpenAlex's search stems words,
  drops stop words and also searches titles and abstracts, so "contains this exact title" would
  claim more than the search does.
- **Order by the piece's age** (researcher, and Sol's consult): newest first for a piece two years
  old or less, or with no year; most cited first, then newest, otherwise.
- **Say what it does not find** (product manager, researcher): one tail line, *This finds papers
  only. Blog posts and web pages that cite it are not here.* — until Stage 3 adds them.
- **The paid button named by what it finds** (designer, product manager): *Look for blog posts and
  web pages that cite it*, its cost marked *estimated* until measured.
- **Tell Greg the free half is a substitution, up front** (product manager): the plan's first
  paragraph, and the note.

Not taken, and why: a citing snippet per row (researcher) — OpenAlex's full-text search returns no
passage, and fetching copies is decision 5; a per-row "not a citation" button and usage counting
(product manager) — added parts for a list nobody has used yet; folding Stage 3 into *Search the
literature* (product manager) — that dossier is the paused 261025h session's ground, and a
different job (findings, not a list); collapsing *Search the literature*'s grey paragraph
(designer) — the same session's ground, passed to its note below.

**For the 261025h session, not acted on here**: the designer found *Search the literature*'s
explanation pushes *After it* below the fold on a phone (shot 5), and the product manager that
three paid searches on one panel (*Search the literature*, *Pages about it*'s *Search the web*,
and Stage 3's button) need their outcomes named. Both go in this report's note, for whoever next
owns *Where it sits*.

## Design consult

GPT Sol: [261026f-design-consult-sol.md](261026f-design-consult-sol.md) (prompt:
[261026f-design-consult-prompt.md](261026f-design-consult-prompt.md)). Opus, in-session and
read-only, summarised: the paid step as sketched rebuilt Reception, so point to it instead; gate
the free list by the hits from before the piece's year; check shown rows against open copies where
free; newest first for a recent piece; never adopt an identifier a citing paper gives; get a free
OpenAlex key. Taken: the gate, the order, the identifier rule, the label, Sol's filter corrections,
the paid half's evidence rules and batched check. Not taken: pointing at Reception (decision 7);
Sol's hold on the free list (decision 1); per-row checks on open (decision 5). The key: the box has
one; whether production's Vercel environment has `OPENALEX_API_KEY` was not checked here, and is
in the report to Greg.

## GPT Sol's plan review

[261026f-plan-review-sol.md](261026f-plan-review-sol.md) (prompt:
[261026f-plan-review-prompt.md](261026f-plan-review-prompt.md)). No P0; seven P1s and two P2s, all
taken:

- **F1** (keep it experimental): measured over every shown row, 82%; decision 1.
- **F2** (the words claim more than the search does): the plain line says *matched a search*.
- **F3** (the gate not exact): decision 3, exact windows and comparisons, a future year as none;
  tests at 0, 2 and 3 before, *since* = 0, exactly 5% and the current year.
- **F4** (injection): the phrase built by `fulltextPhraseOf` and the request by `URLSearchParams`;
  the decoded filter asserted exactly for a hostile title.
- **F5** (*Response to <title>* would be dropped): the own-record rule is now the same words, or
  the same after a leading article; *Response to*, *Comment on* and *Revisiting* pinned as kept.
- **F6** (privacy): `loadArticleIdentity` carries `filename`, the rule is
  `importedFromAPublicAddress` itself, and `/privacy` ships in Stage 1 with the route.
- **F7, F8** (cache invalidation, table lifecycle): no cache in v1 (decision 6), so neither arises;
  the old-server case is in Stage 2.
- **F9** (Stage 3's spend bound): in Stage 3's *Before it starts*.

Building Stage 1 found one more, which no review had: `titleQueryOf` drops an apostrophe inside a
word, and the full-text index then matches nothing (*Do Things that Don't Scale*: 31 works with it,
none without). `fulltextPhraseOf` keeps it.

## Stage 1's code review

GPT Sol, fixing in place: [261026f-stage1-code-review-sol.md](261026f-stage1-code-review-sol.md)
(prompt: [261026f-stage1-code-review-prompt.md](261026f-stage1-code-review-prompt.md), diff:
[261026f-stage1-code-review.diff](261026f-stage1-code-review.diff)). Six findings, two P1:

- **S1-F1** (P1, fixed by Sol): the list asked `publication_year:>Y-2`, so future-dated records
  entered both the list and the gate's *since*; it now asks Y-1 to the current year.
- **S1-F2** (P1, fixed by Sol): a page with a non-zero count but no usable row on it was `none`;
  `none` now means a zero count, or every result seen and every one the piece's own, so a `found`
  may carry no rows and Stage 2 draws its count and link alone.
- **S1-F3** (fixed by Sol): a repeated `with` slipped past the 400.
- **S1-F4** (taken): route tests in `tests/citation-index-pg.test.ts` — the public article gets
  `possible`, the upload of the same title asks nothing (seen red with `filename` taken out of
  `loadArticleIdentity`), a found list is unchanged, an unknown or repeated `with` is a 400, and
  another reader's slug is a 404.
- **S1-F5** (fixed by Sol): the comments and the privacy wording said *contains the exact title*;
  now *matched OpenAlex's full-text search for the title*.
- **S1-F6** (taken): the spike's `shown` builds its requests with the shipped
  `openAlexFulltextUrl`, and the investigation's whole-list numbers are from that run. Its
  `precision` pass keeps the first draft's own-record rule and is labelled as the first pass.
