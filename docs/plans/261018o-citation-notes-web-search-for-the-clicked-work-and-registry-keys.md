# 261018o Citation notes: a web search for the clicked work, and Semantic Scholar and OpenAlex keys

Up: [plans.md](../project/plans.md). Follows
[261017h](261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md) and its
[stage 3 design](261017h-stage-3-design-citation-blurbs.md); the numbers are
[261017c](../investigations/261017c-citation-blurbs-cost-and-quality.md). Queue item
`qi-nkc5gbyh`; report `spya-m53cdk`; question [q-ny49p3](../user-feedback/questions/q-ny49p3.md).

## What Greg asked

Greg's reply `spya-dzhqj8` to q-ny49p3, 2026-10-18T10:37Z, verbatim:

> 1B / 2B

The two options he picked, as the question put them:

> 1. When you press Open in Sources on a citation that has no note, should we also run a quick web
>    search for that one work? … B. Yes, for the clicked work only. It would take only the work's
>    own page, never someone else's, and require a quote the code finds in the page. About 0.8
>    cents and 6 seconds a press. Even with those checks, expect roughly 1 sentence in 6 to say
>    more than the page does.
>
> 2. Should I get free API keys for Semantic Scholar and OpenAlex? … B. Yes. Semantic Scholar holds
>    abstracts Crossref lacks … OpenAlex could then also be searched by title. You would create the
>    two accounts and add the keys to the box; I would add them to the env setup and the code.

## A finding that changes 2B: Semantic Scholar's free licence is non-commercial

The question did not say this, and it should have. Semantic Scholar's API licence
(api.semanticscholar.org/license, read 2026-10-18) limits use to *"legitimate, non-commercial,
research and/or educational purposes"*, forbids *"embedding or installing the API into products
for Licensee's own commercial gain"*, and asks that public displays of its data link back with
`utm_source=api` and carry its name and logo. Spideryarn has charged since 2026-09-03. Plan
[261002i](261002i-debate-leads-with-who-has-cited-this-article.md) found the same in October.
OpenAlex is CC0 and has no such limit.

So: **build both, each switched on only by its key**, and put the licence to Greg in the new
question (stage 3) — request the key describing Spideryarn's paid use and ask AI2 whether it is
covered, or leave the Semantic Scholar key unset. The code does nothing without the key, so
building it commits him to nothing. The row's label names Semantic Scholar and links to its page
with `utm_source=api` (the attribution the licence asks); the logo on visitors' pages is left for
the licence answer.

## Stage 1 (2B): Semantic Scholar for abstracts, OpenAlex for title search, keys optional

### The env

- `SEMANTIC_SCHOLAR_API_KEY`, `OPENALEX_API_KEY`: `.env.example` (commented, no value),
  `scripts/gjd-remote-env.ts`'s allowlist (the box's build file for keys,
  [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)),
  and `setup-dev.md § Secrets`. Production reads them from Vercel's env; the question asks Greg to
  add them there too, or production gets nothing. **Never** a value in any file, and never
  `.env.local`.
- One reader, `src/registry-keys.ts`: `semanticScholarKey()` and `openAlexKey()`, each the trimmed
  value or `null`. Read per call (not at import), so a test can set and unset them.

### The key never reaches a log, an error or a stored row

`FetchFailure` carries the URL, and errors reach logs and Sentry, so **no key ever goes in a URL**.
OpenAlex accepts `Authorization: Bearer <key>` as identical to its `api_key` parameter
(help.openalex.org/api/authentication, read 2026-10-18); Semantic Scholar takes `x-api-key`.

- `fetchBibliographicJson` gains one option, `registryKey: "openalex" | "semantic-scholar"`, and
  adds the header itself from `src/registry-keys.ts`; a caller never handles the value. The
  header is set only for the matching host (a test: `registryKey: "openalex"` on a Crossref URL
  sends no key).
- A test makes a request with a key set, forces a 429 and a network error, and asserts the key's
  characters are in neither the error's message, its `url`, nor anything the logger was given.
- `api.semanticscholar.org` joins `BIBLIOGRAPHIC_HOSTS`, with the same fixed bounds.

### Every OpenAlex call sends the key when there is one

`citation-evidence.ts` (DOI abstracts, and now title search), `citation-index.ts` and
`related-work.ts` (Reception, cited-by) all pass `registryKey: "openalex"`. Ten times the free
budget is what the key buys: $1 a day instead of about $0.10, where a single-work get is free, a
filtered list $0.0001 and a search $0.001 (help.openalex.org/access/example-costs). Keyless, that
is about 100 searches a day for the whole box, which is why the spike ran out; with the key, about
1,000. The existing `mailto` stays.

### The cascade, with keys

```
row with DOI / arXiv id ─► lookupWork (Crossref, DataCite) ─► abstract? ─► done
                                       └─ no abstract ─► Semantic Scholar by id   (key only)
                                                          └─ none ─► OpenAlex by DOI (as now; never a book or chapter)
title-only row ─► Crossref title search ─► strict rule ─► abstract? ─► done
                         │                              └─ matched, no abstract ─► the DOI's cascade above (from S2)
                         └─ not found ─► OpenAlex title search (key only) ─► strict rule ─► its DOI's cascade
```

- **Semantic Scholar by id**: one `POST /graph/v1/paper/batch?fields=title,abstract,year,authors,externalIds`
  for all of a run's id rows whose registry record has no abstract (≤ 500 ids a call; a run has
  ≤ ~150), through the limiter as a new `LimiterService` `"semantic-scholar"` (spacing 1,100 ms:
  1 request a second with a key). Its answer counts as the work's only when its own DOI or arXiv id
  equals the one asked **and** its title agrees with the row's under `titlesAgree` — the same id
  can be mismatched in S2 (the spike saw it). `abstract` only, **never `tldr`** (model-written).
  New `EvidenceSource` `"semantic-scholar"`, `kind: "author-abstract"`.
- **OpenAlex title search**: `GET /works?search=<title words>&filter=...&per-page=5&select=id,doi,display_name,type,publication_year,authorships,abstract_inverted_index`
  only when Crossref found no match and the key is set; the same strict rule as Crossref's
  (`crossrefItemIdentifies`'s clauses, refactored into one rule over a small normalised record so
  both registries' items go through the same code: title agrees, **first** author's surname, year
  ±1, type refusals, book-looking ⇒ book type). A match must have a DOI; the abstract then comes
  from the DOI cascade, and OpenAlex's own reconstruction is the last resort as today (never for
  `book` / `book-chapter`). Counts against the same `MAX_TITLE_SEARCHES` cap; `via: "title"`.
  Only for an article imported from a public web address, as Crossref's title search (G6).
- **No key**: neither source is asked, and nothing is logged as a failure. Exactly today's
  behaviour, which the existing tests keep pinning.
- A 401/403 from either with a key set is a configuration fault: logged at error (no key in it),
  that source off for the run, rows transient.

`EVIDENCE_HASH_DOMAIN` does not change (the rules for *what is evidence* are the same), but
`CITATION_BLURBS_VALIDATION_VERSION` does not need to either: a new source adds entries; it does
not change the checks. Registry negatives already expire after seven days (G9), so an article made
before the keys gets the new sources on its next run.

### On screen

`blurbHolder` / `blurbBasis` (src/citation-blurb-words.ts) learn the new source: *From the abstract
· Semantic Scholar*, its card saying *as Semantic Scholar holds it*. The evidence's `url` stays the
doi.org / arxiv.org address, code-built from `workId` as for every other note; the card adds a
second link, *Semantic Scholar*, to `https://www.semanticscholar.org/paper/<paperId>?utm_source=api`
(the licence's link-back), where `paperId` is S2's 40-hex id, stored on the evidence and
re-validated at the read by a regex. The DTO guard, `shownBlurb`, and the public DTO pin the new
field.

### Privacy

`privacy.md` and `PrivacyPage.tsx`: Semantic Scholar is sent cited works' DOIs and arXiv ids;
OpenAlex is also sent a cited work's title and first author's surname when Crossref could not find
it (public-address articles only). Only when the keys are set — but the page says what the product
may do, so it says it now, under "when enabled".

### Tests, red first

1. Key redaction (above), both services.
2. No key ⇒ no Semantic Scholar or OpenAlex-search request at all (the fetch spy sees none).
3. S2 batch: id agrees and title agrees ⇒ evidence; id agrees, title does not ⇒ none; `tldr`
   present, `abstract` null ⇒ none; a 401 ⇒ off for the run, transient, error logged.
4. OpenAlex title search under the shared strict rule: the Crossref title-rule tests re-run over
   OpenAlex-shaped items; a match without a DOI refused; a book-looking row and a `book-chapter`
   refused.
5. Cascade order: Crossref's abstract wins over S2's; S2's over OpenAlex's reconstruction.
6. Labels and the S2 link; the public DTO re-validates `paperId`.

### The measurement

Once the keys exist (Greg's step), the `production` phase of `evals/citation-blurbs-spike.ts` on the
Butlin fixture, as 261017c's last section ran it, appended there: coverage before and after, by
source. Until then the claim is *"expected ~55%"*, not a number. A queue item waits on the keys.

## Stage 2 (1B): a web search for the one work a reader pressed

### When it runs

**Only on *Open in Sources* from a citation's card in the prose, for a row with no note**, by the
article's owner (not a visitor — the press would spend the owner's money). Not on opening Sources,
not on a row click, never for every work. One press, one search; a second press on the same row
reads what the first stored.

### What it does

`POST /api/bibliography/:slug/:entryId/web-note`, SSE out, owner-scoped:

1. Free refusals first: 404 for an unknown slug or entry; 409 if the row has a current abstract
   note or a current web note or a web-note negative under seven days old (answered from the store,
   no spend). Then the `dig-deeper` allowance (`admitDig`, 429/503) — the same bucket as the other
   per-work press, so a script cannot spend more through this door than through that one.
2. `stage: "searching"` — one Haiku call (`CITATION_BLURBS_MODEL`) with `openrouter:web_search` on
   Exa, 5 results, *"Run ONE web search"* — `citation-find.ts`'s request shape and its
   `require_parameters`. Answer `{url, sentences: [{text, quote}]}`, strict schema, thinking ceiling
   sized (the spike's lesson: 2,500 was enough, 800 was not).
3. Code, every clause required, in this order:
   - the URL is one of the call's own annotations (`readFind`'s rule 1), and the page stored is the
     annotation's;
   - **`resultIsTheWork` says the page is the work itself** — never a page that merely names it
     (`readFind`'s looser rule is not used);
   - the page is not the article being read: not its source URL, and its extract is not a copy of
     the article (`sourceIsCopy`, src/shingles.ts) — the spike's essay case;
   - `judgeNote` (src/citation-blurbs.ts) over the page's extract: ≤ 2 sentences, ≤ 400 characters,
     each sentence's 6–30-word quote found in that extract.
4. `stage: "checking"` — the abstract notes' separate check call (`checkRequest`), given only the
   extract and the sentences; anything but *supported* keeps no note. (This is beyond what 1B
   promised; it is what took arm A from 4.6% to 1.3% unsupported, and costs ~0.05 ¢.)
5. Stored, then `done` with the note, or `done` with *none* and a reason the row says in one line:
   *"We searched the web for this work's own page and found none we could be sure of."*

The prose is not streamed: no sentence may be shown before code and the check have passed it, and
a note is one or two sentences. The stages are, so the ~6 s wait says what it is waiting for
(`runStream` / `readAnswerStream`, the shared plumbing).

Cost-tracked by construction: two new `NonTaskAiJob`s, `citation-web-note` and
`citation-web-note-check`, registered where `citation-blurbs` is (`src/models.ts`, `src/ai-call.ts`,
`src/cost-categories.ts` as `reader-press`-like disposition), so the ledger has them.

### Where it is kept

A table `citation_web_notes (article_id, entry_id, identity, state, sentences jsonb, url, host,
title, read_at, model, prompt_version, validation_version, searches, created_at)`, one row per
entry, overwritten by a later press (`citation_finds`' shape, owner-scoped store). `state` is
`note` | `none` (with `why`). `loadBibliography` attaches it as `CitedWork.webNote` only while
`identity` equals the row's current `rowIdentity` and `validationVersion` is current, and only when
the row has no abstract note (an abstract note wins). An additive migration.

*Passed over*: writing the web note into the `citation_blurbs` artefact — a second writer of a
step's artefact, from a route, against its stamp. And *not storing it* — every reopen would spend
again.

### What the reader sees

The same `CiteBlurb` as an abstract note, in the AI's face, with its own basis line: *From a web
search · <host>*. Its card: *"A short note an AI wrote from one web search for this work: the search
engine's extract of what looks like its own page at <host>, read on <day>. It is not a reading of
the paper, and a web page can say more or less than the paper, so it can be wrong. Code checked
that it rests on these words of the page: …"* then *Ask in chat to look closer*. The page link is
the annotation's URL, `isWebUrl`-checked, `rel="noopener noreferrer nofollow"`. On the row and on
the prose hover card. While it runs, the row says *Looking for this work's own page on the web…*.

**Not for visitors and not for chat in v1**: a visitor's page and chat read the abstract notes
only. Deferred, named in `bibliography.md § Deferred`.

### Tests, red first

1. A URL not in the annotations ⇒ none. A page `resultIsTheWork` refuses ⇒ none. The article's own
   URL, and a copy of its text ⇒ none.
2. A quote not in the extract ⇒ none; the check says *not supported* ⇒ none.
3. Stored note attached; changed identity ⇒ hidden; abstract note present ⇒ web note not shown.
4. Route: a second press with a stored note or a fresh negative spends nothing (no model call);
   a visitor ⇒ 404; the allowance's refusal ⇒ 429.
5. Client: the press on a row with no note starts the request once; the stages draw; the note
   draws with its label and card; a row with a note does not start it.

## Stage 3: bookkeeping

- A new question file (plain, per [ask-me-questions.md](../reusable/ask-me-questions.md)): create
  the two accounts and add `SEMANTIC_SCHOLAR_API_KEY` and `OPENALEX_API_KEY` to the box
  (`gjd-remote push-env`'s source) and to Vercel's production env; with the licence finding above
  and what to tell AI2.
- q-ny49p3: the reply quoted, `acted: spya-dzhqj8`, status answered; the `spya-m53cdk` note's
  comment updated; `npx tsx scripts/feedback-endings.ts`.
- Docs: `bibliography.md` (the web note, the new sources, Deferred), `setup-dev.md` (the keys),
  `privacy.md`, `database.md` (the table), `ai-gateway.md` if its job list needs the two jobs, the
  help page for Sources.
- Queue: the coverage measurement, waiting on the keys.

## The simpler option passed over

**Ship only the env lines and the S2/OpenAlex code, and leave 1B unbuilt** (the question's 1A).
Greg chose 1B with its known 1-in-6 rate, so that is not ours to undo; the separate check call is
the one addition, because it is cheap and measured.

## Reviews

- Plan: GPT Sol, read-only — `261018o-plan-review-sol.md`.
- Code: GPT Sol, workspace-write — `261018o-code-review-sol.md`.

## The plan review, and what it changed

GPT Sol, read-only: [prompt](261018o-plan-review-prompt.md), [answer](261018o-plan-review-sol.md).
*Proceed with fixes*, no P0, five P1s. **Every item below overrides the sections above where they
disagree.** (The plan reviewed still appended OpenAlex's key to the URL; it moved to the header
during the review, which F10 confirms is the right design.)

- **R1 (P1), taken — and it narrows 1B.** `resultIsTheWork` matches a title; it cannot prove a page
  is the work's own and not somebody else's (its own header says so, and its tests accept a blog).
  So a web note needs an **identifier anchor**: the row's DOI or arXiv id, or the DOI the strict
  title rule found (Crossref, or OpenAlex with a key). A page is the work's own only when it is
  `doi.org/<doi>`, `arxiv.org/abs|pdf/<id>` (host checked), or carries the exact DOI (in its URL or
  extract) **and** `titleNamesWork` says *whole*. A row with no anchor gets no search and no spend:
  the route answers *none: no identifier* free. That keeps the promise Greg chose ("only the work's
  own page, never someone else's") at the price of firing on fewer rows — most rows with no note
  have no identifier. Whether to loosen it (pages titled as the work, labelled as possibly someone
  else's) goes to Greg as a question, with the yield once measured.
- **R2 (P1), taken differently.** No batch `POST`: one `GET /graph/v1/paper/DOI:<doi>` (or
  `ARXIV:<id>`) per row still without an abstract, through `fetchBibliographicJson` (GET only, the
  host added to its fixed list), the limiter spacing 1,100 ms. Simpler than a second fetch path and
  enough for the ~15–40 rows an article has without an abstract. `semantic-scholar` joins the
  limiter's database CHECK, its seed row and `pg-bibliographic.ts`'s expected services, by an
  additive migration.
- **R3 (P1), taken.** A **source-policy stamp** (which optional sources are on, e.g.
  `crossref,datacite,openalex-doi` / `+s2` / `+openalex-title`) joins the step's input hash and each
  registry-negative entry; a negative made under another policy is re-asked. Notes are kept and
  shown as now. `EVIDENCE_HASH_DOMAIN` is bumped.
- **R4 (P1), taken in part.** The table keeps one row per `(article, entry)` with `owner_id`,
  `state note | none`, `why`, `checked_at`; only a completed *no acceptable page* is stored as a
  negative (seven days); a call failure, a cut-off or unreadable answer, or a *not supported* that
  came from an unreadable check stores nothing. **No claim columns**: the new allowance runs one
  press at a time per reader (R7), and the store is re-read after the allowance is taken, so a
  second press waits and then finds the first one's answer. The table joins deletion, transfer,
  `ArticleRows`, export and rollback, as `citation_finds` does.
- **R5 (P1), taken.** Semantic Scholar runs only with its key **and**
  `SEMANTIC_SCHOLAR_COMMERCIAL_USE=approved`, a flag Greg sets once AI2 has said yes. A key alone
  does nothing. OpenAlex needs only its key.
- **R6 (P2), taken.** The evidence cascade becomes phases: (1) resolve each row to a canonical work
  id — the row's own, or one a strict title match found (Crossref, then OpenAlex) — keeping any
  abstract the registry gave; (2) Semantic Scholar per id still without an abstract; (3) OpenAlex's
  reconstruction by DOI, as now. A bad or absent optional key falls through, never suppresses.
  OpenAlex has its own adapter to a normalised record (title = `display_name`; first author =
  `author_position === "first"`, `raw_author_name`; year; DOI; a kind mapped from OpenAlex's own
  type vocabulary, with `book-review`, `erratum`, `retraction`, `paratext`, `peer-review` refused)
  and one strict rule over that record for both registries. Query: `search.title`,
  `filter=has_doi:true`, `per_page=5`, a small `select`, built with `URLSearchParams`.
- **R7 (P2), taken.** Its own allowance, `citation-web-note`, one at a time per reader, its own
  hourly and daily ceilings and the global fuse, taken after every free refusal, freed in
  `finally`.
- **R8 (P2), taken.** The check is made provenance-neutral (the word *abstract* becomes the
  evidence's name, passed in: *abstract* or *extract of a web page*), no tools, the extract fenced.
  A `shownWebNote` read guard rebuilds every field, caps lengths, requires `isWebUrl` and no
  credentials in the URL, recomputes the host, checks identity and version. Never in the public DTO.
  Prompt injection through the extract is a residual risk the docs name; the quote and the check
  narrow it, they do not remove it.
- **R9 (P2), taken.** Stages-only SSE is written into `bibliography.md` as a stated exception to
  *stream what a person waits on*, with the reason. Once the paid call has started, the server
  finishes and stores after a disconnect; before, a dead connection spends nothing. The client test
  is on the hover card's *Open in Sources* callback, not on a row click.
- **R10 (P3), noted.** Keys in headers only; no query-string fallback.

## The code reviews, and what they changed

- **Stage 1**, GPT Sol, read-only: [prompt](261018o-stage-1-code-review-prompt.md),
  [answer](261018o-stage-1-code-review-sol.md). *Rework*, six findings, all fixed (commit
  74125968d): Semantic Scholar refused at the one request door unless key **and** approval are set;
  no OpenAlex key in any URL, the eval included, swept by a test; a keyed request's failure rebuilt
  from safe fields, so a transport error cannot carry the key; the keyless budget boundary as
  before; a 429 test; "four public indexes".
- **Stage 2**, GPT Sol, write mode: [prompt](261018o-stage-2-code-review-prompt.md),
  [answer](261018o-stage-2-code-review-sol.md). *Rework*. It fixed five itself (DOI boundaries, the
  re-read after the allowance now re-reads the row and the article, malformed answers transient,
  client failures shown, the (i) sentence). Of the three it reported:
  - **#2 (P1), taken, and it narrows R1 again.** A page carrying the DOI with the work's exact
    title can still be a citation index or a review. So a page is the work's own **only at the
    DOI resolver (`doi.org/<doi>`) or arXiv's own `/abs|pdf|html/<id>`**; the prompt asks for the
    doi.org result when there is one. Accepting the publisher host the registry gives for a DOI is
    deferred, in `bibliography.md § Deferred`, and loosening is q-x9srvv's question 2.
  - **#5 (P2), taken as a stated limit.** A second press while one runs is refused *busy* (429),
    not made to wait: no duplicate spend, and the reader's tab sends one at a time. R4's
    wait-then-reread is not built.
  - **#8 (P3), taken.** Route tests for the registry's 503 and for the two ledger rows.

## Live smoke (2026-10-19, $0.049)

Three real presses' writer calls, on the shipped request (`citation-web-note`, Haiku, Exa):
Bryson, *Robots should be slaves* (DOI) — a supported note from `doi.org`; Nagel, *What is it like
to be a bat?* (DOI) — declined, the extract was a fragment; Chollet, *On the measure of
intelligence* (arXiv) — refused *too-long* at first, then, with the limit in the prompt, a note
from `arxiv.org/abs`. 4–7 s and $0.008 a call. The request without a `response_format` schema
answered readable JSON every time.
