# Reception lists the papers that cite the piece, from OpenAlex

Up: [debate.md](../project/reception.md)

**Status:** built (2026-10-04); § What landed. This is stage 2 of
[261002i](261002i-debate-leads-with-who-has-cited-this-article.md), queue item `qi-aabv7jjy`.

**Superseded in one respect, 2026-10-10:** the arXiv gap named below ("an arXiv preprint shows the
`no-doi` sentence") is closed by
[261010n](261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md): an
agreed arXiv record puts arXiv's DataCite DOI on the article, and an article with no DOI whose own
address is an arXiv page is asked about by that DOI.

## What Greg decided

The question was [Q-citation-index] in
[261003o](261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md): *"Should Reception
list the papers that cite the piece, via OpenAlex? It sends the article's DOI to an outside
service."*

> Q-citation-index ye
>
> — Greg, 2026-10-04, relayed by the Overseer

That is option 1 of 261002i § The question for Greg: OpenAlex, the list and the count, and **not**
what each citing paper says.

## The case it is for

Levin 2024, *Self-Improvising Memory* (Entropy, DOI `10.3390/e26060481`). The open web has no
review, reply or blog post about it, so Reception honestly says it found nothing. 39 papers cite it.
After this, Reception says "39 papers cite this" and lists them.

## Measured, 2026-10-04, from the box, with no key

- `GET api.openalex.org/works/doi:10.3390/e26060481` → the paper, `cited_by_count: 39`, id
  `W4399223951`. Costs 0 of the day's credits.
- `GET api.openalex.org/works?filter=cites:W4399223951&sort=cited_by_count:desc&per-page=200` → 39
  results, all with a DOI and a title, no duplicate DOIs: 28 articles, 5 preprints, 3 reviews, 3
  conference papers. Costs 1 credit of the anonymous 1,000 a day. 141 KB for 39 works, because
  each carries every author's affiliations, and that cannot be trimmed by `select`.
- So a full page of 200 can pass the registry fetcher's 1 MB bound. **v1 asks for one page of 100.**

## What gets built: one stage

```
Reception opens ──► GET /api/citers/<slug>          (owner only)
                      │
                      ├─ no DOI on the article ───────────────► "no DOI" sentence
                      ├─ cache row fresher than 7 days ───────► the stored list
                      └─ ask OpenAlex (2 requests)
                           1. works/doi:<doi>     title must be this article's
                           2. works?filter=cites:<id>, most cited first, 100
                         store, then answer
```

### 1. The client: `src/citation-index.ts`

A model-free function, `citersOf(article meta, deps)`, and the two parsers under it.

- **The identifier is `meta.doi`, and nothing else.** Since 261004a a new import's DOI is one a
  registry agreed is this article. An arXiv id held as a DOI (`10.48550/arxiv.…`) works the same
  way. No title search when there is no DOI (261002i defers it).
- **It is verified before it is trusted.** An older minimal paper's DOI was checked only for
  shape, and a mistyped DOI resolves perfectly to another paper. OpenAlex's record for the DOI must
  carry this article's title: `registryIsThisArticle(meta.title, record.title)`, the rule 261004a
  wrote. A record whose title disagrees is `not-this-article`, and nothing is listed.
- **One page, and it says so.** Up to 100 citers, most cited first (`cited_by_count:desc`). The
  count is OpenAlex's own `meta.count` for the query. When the count is larger than the list, the
  panel says "the 100 most cited of 389". A failed second request fails the whole lookup; a count
  is never stored without its list.
- **Duplicates are merged**, by OpenAlex id and by DOI, first sighting kept.
- **Each citer keeps:** OpenAlex id (`W…`, shape-checked), DOI (shape-checked, optional), title,
  up to the first 20 authors' display names plus the full author count, year, venue
  (`primary_location.source.display_name`), OpenAlex's `type`, and its own `cited_by_count`. Every
  string goes through `plainRegistryText` with a length bound. A result with no title is dropped
  and counted.
- **A link is built by us, never taken from the response:** `https://doi.org/<doi>` when there is a
  DOI, else `https://openalex.org/<W id>`. OpenAlex is an outside party; its strings are text.
- **The wire** is `fetchBibliographicJson` (`src/fetch.ts`): `api.openalex.org` joins
  `BIBLIOGRAPHIC_HOSTS`, so it gets the same honest User-Agent, 8 s timeout, 1 MB bound, one
  attempt and no redirects. The address carries `mailto=` as Crossref's does. **No API key in v1**:
  anonymous access answered, and a key is a secret only Greg can add. If production sees 429s, a
  free key (`OPENALEX_API_KEY`) is the next step; named in the debrief.
- **Politeness reuses the shared machinery** in `src/store/pg-bibliographic.ts`: `openalex`
  becomes a third service (one slot, starts 500 ms apart, the shared cooldown on a 429 or 503 with
  `Retry-After`). A migration widens the `bibliographic_services_service` check and seeds the rows.
- **The suite cannot reach it:** `api.openalex.org` joins `ALSO_REFUSED` in
  `tests/setup/provider-guard.ts`; tests hand the function a `fetchJson`.

The result is a discriminated union:

```ts
type CitersResult =
  | { kind: "no-doi" }
  | { kind: "not-indexed" }        // OpenAlex has no record for the DOI
  | { kind: "not-this-article" }   // it has one, with another title
  | { kind: "unavailable" }        // timeout, 429, 5xx, our own limiter
  | { kind: "found"; count: number; citers: Citer[]; fetchedAt: string };
```

### 2. The cache: two tables, keyed by DOI, not by article

Columns, not JSON ([sql.md](../project/sql.md)).

- `citation_index_lookups`: `work_id` (the `doi:…` key, primary), `state` (`found` |
  `not-indexed`), `openalex_id`, `cited_by_count`, `fetched_at`. Checks: a count and an id only on
  a `found` row, written so a NULL cannot satisfy them (postmortem 261004a).
- `citation_index_citers`: `work_id` (foreign key, cascade), `position`, `openalex_id`, `doi`,
  `title`, `authors` (`text[]`), `author_count`, `year`, `venue`, `kind`, `cited_by_count`. Primary
  key `(work_id, position)`.
- **It holds public bibliographic facts only**, like `bibliographic_records`: no owner, no article
  id, nothing a reader wrote. Two readers of the same paper share one row. RLS as on
  `bibliographic_records` (server only).
- **Fresh for 7 days**, found or not. Citations accrue; a week-old count is close enough and is
  shown with its date. A stale row is replaced in one transaction (lookup row and its citers
  together). When OpenAlex is unavailable and a stale row exists, the stale list is served with
  its date. `not-this-article` and `unavailable` store nothing.
- No per-identifier claim: two simultaneous opens may make two requests. Each costs one credit and
  the second write wins. Not worth the machinery in v1.

### 3. The route: `GET /api/citers/<slug>`

Owner only, with the same owner check and experimental-features gate Debate's own routes use. Reads
the article's `meta`, calls `citersOf`, returns the union. It spends no money and makes no model
call. It logs counts and the outcome, never a title or a DOI's article.

**A visitor to a public article does not get the list in v1** (261002i defers it): the route
refuses a visitor, and the panel draws nothing for them beyond today's Scholar link. Adding it
means a field on the public boundary, which is a change to a defence.

### 4. The panel: a "Cited by" section at the end of Reception

Where the Google Scholar link is today.

```
 [ Reception 0 | Claims 5 ]
 Nobody we could find has written about this piece on the open web.

 Cited by
 39 papers cite this piece, by OpenAlex's count on 4 Oct 2026. Most cited first.
 We have not read what any of them says about it.

  The Multiscale Wisdom of the Body: Collective Intelligence as a …
  Michael G. Levin · BioEssays · 2024 · review · cited 34 times
  A biogenic principle within the constructal law: The flow of …
  William B. Miller, Jaime Fernando Cárdenas-García, František Baluška · Biosystems · 2025 · cited 13 times
  …  (10 shown)
  [ Show all 39 ]
 Also: search Google Scholar ↗
```

- Shown whenever Reception is on screen for the owner, **before the paid search has been run
  too**: the list is free, and it is the fastest answer to "has anyone cited this". It loads by
  itself, with a small spinner in the section, and never blocks or arms the paid search.
- The first 10, then one button for the rest. No sort control, no filter.
- Every state has its own plain sentence ([copy.md](../project/copy.md)):
  - `no-doi`: "This piece has no DOI on record, so we cannot look up who cites it."
  - `not-indexed`: "OpenAlex, the index we ask, has no record of this piece."
  - `not-this-article`: "The DOI on this piece belongs to a work with a different title, so we
    have not listed who cites it."
  - `unavailable`: "We could not reach OpenAlex just now." and a Try again button.
  - `found` with 0: "OpenAlex knows this piece and lists no paper citing it yet."
  - `found`, truncated: "389 papers cite this piece … The 100 most cited are listed."
- The Scholar link stays, under the list, in every state.
- The Reception segment's count stays the count of web-search rows. The citers are a different
  kind of thing (a list we have not read), and adding 39 to "Reception 0" would say otherwise.
- A citer's title is the citing author's words, not the app's: the face comes from
  [fonts.md](../project/fonts.md). Outside links carry `rel="noreferrer noopener"`.
- The (i) says where the list comes from and that only the DOI is sent.

### 5. The privacy page, the help page, the docs

- **Privacy page** (`src/web/PrivacyPage.tsx`, [privacy.md](../project/privacy.md)): OpenAlex is
  named, with what it is sent (the article's DOI, from our server; never its text, never who is
  reading). **Crossref and DataCite are not on the page today although the code has asked them
  about DOIs since 2026-10-01**; they are added in the same sentence, because the page must stay
  true of the code. None of the three is a subprocessor of reader data in the sense of the list in
  privacy.md (they are sent an identifier of a published work), and the page says which it is.
- `/help`'s Debate entry; [debate.md](../project/reception.md); [database.md](../project/database.md)
  where it lists tables; [security-map.md](../project/security-map.md) if it lists outside parties
  whose strings we render; 261002i's status line and 261003o's question, marked answered.

## Not built, named

- **What each citer says, for or against.** OpenAlex has no citing sentence. Semantic Scholar has,
  under a licence that needs asking for (261002i option 2).
- **A visitor's view** of the list on a public article.
- **A title search when there is no DOI**, and **finding the DOI of an article imported before
  261004a**. Such an article shows the `no-doi` sentence until its owner uses Read it again. Greg's
  own copy of the Entropy paper in production is in this state; a backfill is his call (261004a
  left it with him) and is raised in the debrief.
- **More than 100 citers**, paging, sorting by date, hiding self-citations (most of the Entropy
  paper's top citers are its own author).
- **An API key**, and a per-identifier claim.
- **Folding the citers into the stored Debate artefact or its fingerprint.** 261002i's rule ("put
  the chosen identifier in Debate's fingerprint") was for a model labelling each citer inside the
  Debate step. No model reads this list, and it is fetched and cached apart from the paid search,
  so an old stored debate gets it without being searched again.

## The simpler option passed over

Fetch the list inside the Debate step and store it in the Debate artefact. One fewer route and no
new tables. But the list would then exist only after a paid search, an already-stored debate (the
Entropy paper's) would need a second 20-cent search to get it, and it would go stale with the
artefact, which is "searched once and kept".

## Tests, each seen red first

- Parsers: the recorded OpenAlex answers for the Entropy paper (trimmed fixtures) give 39 citers in
  order; a result with no title is dropped and counted; duplicate ids and DOIs merge; markup in a
  title is stripped; a malformed `W` id or DOI is refused; a link is never a string from the
  response.
- `citersOf`: no DOI makes no request; a 404 is `not-indexed`; a different title is
  `not-this-article` and the second request is never made; a failed second request is `unavailable`
  and stores nothing; `count > citers.length` is carried through; a fresh cache row makes no
  request; a stale row plus an unreachable OpenAlex serves the stale list with its date.
- The fetcher accepts `api.openalex.org` and still refuses any other host; the suite's guard
  refuses `api.openalex.org`.
- The store round-trip, and the two checks (a `not-indexed` row cannot hold a count).
- The route: owner gets the union; a visitor and a signed-out caller are refused; the gate.
- The panel: each of the six sentences; the first 10 then all; the section is on screen before
  the search has run and does not start it; absent for a visitor; the Scholar link stays; the
  Reception count is unchanged by citers.
- The privacy page names OpenAlex, Crossref and DataCite.
- Mutation check at the end: drop the title check; store a count when the list failed; take the
  link from the response. The suite must notice each.

Browser check (Sonnet subagent, Playwright on the box) at 1440, 820 and 390 wide: the Entropy
paper with its DOI set in the local database, a piece with no DOI, before and after a search.

## For the chat-as-research work

`citersOf` is model-free, cached and keyed by DOI, so a chat tool ("who cites this paper") can call
it for the article on screen, or for any work whose DOI the chat already holds, without touching
Debate. What it would need that this does not build: a tool result shape for the model, and the
visitor question above.

## GPT Sol's plan review, and what changed

[The prompt](261004h-reception-lists-citers-plan-review-prompt.md),
[the review](261004h-reception-lists-citers-plan-review-sol.md): no P0, nine findings, verdict
*build with the P1 fixes*. All nine accepted, each checked against the code. The text above is the
plan as reviewed; **where a finding changed it, this section wins.**

| | Finding | What changes |
|---|---|---|
| F1 | a cache hit skipped the check that the DOI is this article's, so a second article with a mistyped DOI got the first one's citers | the lookup row keeps the target's title and author names as OpenAlex gave them, and the check runs on **every** return: fresh request, cache hit, stale fallback |
| F2 | the owner's read of `meta` carries a reader's rename (`titleFor`), which would fail a correct DOI | the check uses the revision's original title and authors, read after the owner check |
| F3 | "a new import's DOI is registry-agreed" is false (`withRegistryFacts` keeps an existing DOI when the lookup fails), and two works can share a title | an author must agree as well as the title: OpenAlex's display names go through a small adapter into `registryAuthorIsOurs`. No byline, or no agreement, is one outcome, `unconfirmed`, replacing `not-this-article`. Its sentence does not claim the DOI is another work's: "We could not confirm that the DOI on record is this piece's own, so we have not listed who cites it." |
| F4 | Debate has no server-side experimental gate; the switch only hides controls | the route is owner-only and has no gate |
| F5 | a dropped or merged row makes `count > listed` ambiguous | the result and the cache carry `returned`, `dropped` and `capped`. The sentence prints the number actually listed, and says separately when the page limit left some out and when some records could not be shown |
| F6 | 100 records can still exceed 1 MB, and would fail the same way on every retry | a too-large answer is asked for again once with 25. If that is too large as well, a new outcome `too-large` with its own sentence and no Try again: "OpenAlex's list for this piece is too large for us to read yet." |
| F7 | widening `Registry` would let `openalex` be a record's provenance | a separate union for limiter services; `Registry` stays as it is. The migration, the schema types and `EXPECTED_SLOTS` all hear about the third service |
| F8 | the Scholar link and the segmented control sit inside `debate && ready`, and a normal press on Debate already arms the paid search | the owner's Cited-by section is drawn outside that condition. Tests: a bookmarked arrival asks for citers and starts no job; a normal press starts exactly the one search it starts today |
| F9 | new tables must be known to `tests/action-tables-have-created-at.test.ts`; transactions name their level | `fetched_at` registered for the lookup table, the child table exempted with the reason; the replacing transaction is `READ_COMMITTED` |

Also corrected: an arXiv record that agrees does not put a DOI on the article today, so an arXiv
preprint shows the `no-doi` sentence. Not built here; named in the debrief.

Sol confirmed three of my own doubts as fine: a model-free `GET` that fills a cache (link previews
do the same), two tables with `text[]` authors, and keeping the list out of the visitor's view and
out of the stored Debate artefact.

## Code review

[The prompt](261004h-reception-lists-citers-code-review-prompt.md),
[the review](261004h-reception-lists-citers-code-review-sol.md), of `e8de3e851`. Nine findings,
each fixed by the reviewer with a test seen red, committed as `34176bcf2` after I read the diff and
ran the gates. Verdict: **land with the fixes made in review**. All nine kept.

| | Finding | Fix |
|---|---|---|
| C1 | an author name with a suffix (`Jr.`), in `Family, Given` order, or with a long compound family name failed the author check | the adapter recognises each before falling back to the last word |
| C2 | the hook's ask-once mark outlived the read it described ([postmortem 261004j](../postmortems/261004j-a-request-mark-must-expire-with-the-request-it-describes.md)) | cleared when the article changes |
| C3 | a malformed citer row would throw while drawing | each row's fields are checked; anything else is `unavailable` |
| C4 | a DOI was put into the link address as written | each path segment is encoded |
| C5 | an oversized *target* record was `unavailable`, with a Try again that could never work | it is `too-large` |
| C6 | before a search, the list was outside the band's scroller | it is inside it |
| C7–C9 | copy: the dropped-record sentence, the (i) naming the contact address, the privacy page saying when each service is asked | reworded |

**C10, wider than this stage, reported and not fixed:** three older call sites put a DOI into an
address unencoded (`src/source-guess.ts`, `src/paper-evidence.ts`, `src/citations.ts`). It belongs
to Citations and goes to the Overseer's queue.

One review round. The fixes are small, each came with its test, and none was overruled, so no
second round.

## What landed (2026-10-04)

Built as planned by an Opus subagent, in one stage. Departures from the plan, kept:

- The result and the cache carry `returned`, `dropped` and `capped` (F5), and the count sentence is
  built from them (`citersLines` in `src/messages.ts`).
- Before a debate exists there is no sub-mode control, so the section is drawn under the
  not-searched screen whatever `?debate=` says.
- For the owner the Scholar link reads "Also: search Google Scholar" under the list. A visitor
  keeps today's link and wording.
- A citer's title is in the app's own face, like the source titles above it:
  [fonts.md](../project/fonts.md) leaves third-party text undecided.
- A stale list is also served after `too-large`, never after `unconfirmed`.
- The hook checks the shape of the route's answer, because a `{}` would otherwise take the whole
  Debate band down through the exhaustive switch.
- The privacy page links each service's home page, not its privacy policy.
- The politeness in `src/bibliographic.ts` was pulled out into `inServiceTurn` and `coolAfter`,
  which Crossref, DataCite and OpenAlex now all go through.

Checks:

- **The real OpenAlex**, through the finished `citersOf` with the real fetcher (in-memory cache):
  `found`, count 39, 39 listed; a second call made no request; another article carrying the same
  DOI was answered `unconfirmed` off the cache.
- **Mutations** the suite noticed: no title check; no author check; no check on a cached row; a
  count stored when the list failed; the DOI string taken from the response; no ask-once guard.
- **The full suite**, in tmux, on `53ef7b8af`: 1562 files passed, 1 skipped; 33,617 tests passed.
- **Browser, with the route's answer stubbed** (Sonnet, Playwright, 1440, 820 and 390 wide): every
  state's sentence, the first 10 then all 39, links, no horizontal overflow, the list and the
  Scholar link reachable by scrolling, Try again, a malformed answer and a 500, the (i). Arriving
  by URL started no Debate job. No defects.
- **Browser, end to end, nothing stubbed** (Sonnet, Playwright, a local article given the Entropy
  paper's title, byline and DOI and put back afterwards): 39 citers at 1440, 820 and 390 wide,
  10 then all 39, every title a `doi.org` link. One request to OpenAlex, then seven answers from
  the cache; 1 lookup row and 39 citer rows in the local database. With only the title changed,
  the cached list was refused as `unconfirmed`. An article with no DOI made no request. Signed out,
  the route answers 401. Screenshots: `261004h-shot-<width>-found.png` (real),
  `261004h-shot-<width>-no-doi.png` (stubbed).
- **The migration was rebuilt once before landing.** Two peers' migrations reached `dev` first, the
  second stamped after this one and already applied to the shared local database, so this one
  would have been skipped below the watermark. It had been applied nowhere, so it was regenerated
  on top of the trunk ([database.md § Repairing a fork](../project/database.md#repairing-a-fork-what-the-losing-migration-is-decides-everything))
  as `20261004164715`, byte-identical to the first. The full suite ran before that merge; after
  it, typecheck and the thirteen files that hold lists or the stage's own tests.
