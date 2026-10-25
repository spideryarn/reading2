# 261025d A citation's web note may come from a page that looks like the work's own

Up: [plans.md](../project/plans.md). Follows
[261018o](261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md) § Stage 2;
the area is [bibliography.md § A note from one web search](../project/bibliography.md#a-note-from-one-web-search).
Report `spya-m53cdk`; question [q-x9srvv](../user-feedback/questions/q-x9srvv.md), part 2. The
numbers are [261025d](../investigations/261025d-citation-web-note-looser-rule-yield.md).

## What Greg asked

q-x9srvv's part 2 offered A, keep the page rule strict (only `doi.org/<doi>` or the arXiv page),
or B, also accept *"other pages whose title is exactly the work's and that name its first author (a
publisher's page, a catalogue, an author's copy), and label the note 'from a page that looks like
this work's, which may be someone else's description of it'"*. Greg, 2026-10-25:

> re q-x9srvv - I don't fully understand, but I don't think we want to be so restrictive that we
> only trust DOI or archive pages. I think we want to be looser.

And in the brief for this work: accept such pages *"provided the page shows clear signs it is
about this work: for example, its title matches the work's and it names the first author"*, label
the note honestly, and keep: the page is one the search returned; it is not the article or a copy;
quotes found by code; a second check.

## Before

On the Butlin paper (70 works; 28 get an abstract note locally, so 42 have none), the shipped rule
gives **4 notes from 42 presses**: 26 rows are refused free for having no DOI or arXiv id, 16 are
searched, 4 of those keep a note ($0.13, 20 model calls). Most of the 26 are books, chapters and
arXiv papers the list cites by title alone.

## Where "looser" stops (decided with Opus, 2026-10-25)

Two tiers, decided by code, stored with the note:

- **`own`** — exactly today's `pageIsTheWork`: `doi.org/<the DOI>` or arXiv's own
  `/abs|pdf|html/<id>`. Unchanged.
- **`looks-like`** — any other page the search returned, when **all** of these hold
  (`pageLooksLikeTheWork`, new, beside `pageIsTheWork`):
  1. its title names the work under `titleNamesWork` (src/citation-lookup.ts): `whole` — the
     work's title token for token, optionally followed by a short site tail ("… | Nature") — or
     `truncated` (the engine cut it, "…") backed by the year as well as the surname;
  2. **the first author's surname** is in the page's title or extract. A row with no authors has
     no looser tier;
  3. a title of **two tokens or fewer** ("Mind", "Being You") also needs the row's year in the
     page: a whole short title is too easily somebody else's;
  4. the host is **not on a short refused list** — pages that are about a work by design and that
     no title rule can refuse, since their title is the work's and they name its author:
     encyclopedias (`wikipedia.org`, `wikiwand.com`, `britannica.com`, `plato.stanford.edu`,
     `iep.utm.edu`), reader reviews and shops that carry them (`goodreads.com`, `amazon.*`), a
     review journal (`ndpr.nd.edu`), and summary sites (`sparknotes.com`, `litcharts.com`,
     `gradesaver.com`, `supersummary.com`, `coursehero.com`, `enotes.com`, `shortform.com`,
     `blinkist.com`, `bookey.app`). Matched on the registrable host and its subdomains.

  And one fix to `titleNamesWork` itself, which every caller wants: a site tail whose first token
  is `reviews` is refused as `review` already is. NDPR's *"<title> | Reviews | Notre Dame
  Philosophical Reviews"* passed because `"reviews" !== "review"`; *Physical Review* still passes.

**The residual risk, named and accepted**: a page not on the list, titled exactly as the work and
naming its author, that is someone else's account of it — a blog post, a podcast's page, a
syllabus, a publisher's marketing blurb. The label is what makes it acceptable, and the check is
told to refuse praise (below). A same-titled work by an author of the same surname is rarer.

**An identified row may also take a `looks-like` page.** The prompt still asks for the doi.org or
arXiv result first; when the search returns neither, a publisher's page titled as the work is
better than nothing, and it is labelled as what it is.

**A row with no identifier is now searched**, by its title and first author — but only:

- for an article imported from a public web address, as the registries' title search (G6 in
  [261017h stage 3](261017h-stage-3-design-citation-blurbs.md)): an uploaded file may be a
  confidential manuscript whose "works" are unpublished, and a web search sends the title further
  than Crossref does. An uploaded file's title-only rows keep today's free 409;
- when the row has a title and a first author's surname (`resolveWorkId`'s
  `no-identifier-or-title`, an author–year label, stays refused).

**A registry that is busy** while resolving a title-only row's DOI keeps today's 503: searching
without the anchor would store a weaker note, or a week-long *none*, from degraded input, and a
retry is free.

## The check and the writer learn one rule

A publisher's or catalogue page carries praise ("a landmark study…"); a note must say what the
work argues or finds, not someone's verdict on it. So:

- the writer's prompt: *"Say what the work itself argues or finds, never praise or anyone's
  judgement of it."*
- the check, for web extracts only, a new optional `CheckEvidence.alsoFalse` line: *"Answer false
  if the sentence gives someone's praise or judgement of the work rather than what the work itself
  argues or finds."* The abstract notes' check prompt stays byte for byte.
- for a `looks-like` page the check is told its evidence is *"an extract of a web page that may be
  that work's own or someone else's description of it"* (`WEB_LOOKALIKE_EVIDENCE`).

`CITATION_WEB_NOTE_PROMPT_VERSION` → `/3`.

## Stored, and shown

- **A column, `page_basis`** (`own` | `looks-like`), on `citation_web_notes`, by an additive
  migration: a CHECK that it is set exactly when `state = 'note'`, and the migration backfills
  `own` on every existing note, since every one passed the strict rule. sql.md's columns over JSON;
  the rest of the row is columns already.
- `CITATION_WEB_NOTE_VALIDATION_VERSION` → `/4`. **A `/3` note is still shown** (as `own`: the
  strict rule is a subset of today's and the owner may have read it); **a `/3` *none* is no longer
  trusted**, because the looser rule may find a page where the strict one could not. One branch in
  `shownWebNote` / `searchedRecently`.
- `shownWebNote` rebuilds `basis` and refuses `own` unless the host is `doi.org`, `dx.doi.org`,
  `arxiv.org` or `export.arxiv.org` — a cheap cross-check that the column and the address agree.
- On screen, `own` is unchanged. `looks-like`:
  - the row: *From a web search · philpapers.org · may not be the work's own page*;
  - the card: *A short note an AI wrote from one web search for this work: the search engine's
    extract of a page at philpapers.org whose title and first author match this work's. It looks
    like the work's own page, but it may be someone else's description of it, such as a catalogue
    entry, a publisher's blurb or a review. Read on 25 October 2026. It is not a reading of the
    work, and it can be wrong.*
  - the band's (i) sentence drops "the work's own web page" for "a web page that is, or looks
    like, the work's own".
- `WEB_NOTE_NO_IDENTIFIER`'s words now say why (an uploaded file's title-only work, or a row with
  no title and author to recognise its page by), since "no DOI or arXiv id" is no longer the reason.

## Docs

bibliography.md § A note from one web search (Greg's quote, the two tiers, the residual risk, the
Deferred line removed), the header of src/citation-web-note.ts, privacy.md and `PrivacyPage.tsx`
(a title-only work of a public-address article is now searched by its title and authors;
`LAST_UPDATED`), database.md (the column), the investigation.

## Tests, red first

1. `pageLooksLikeTheWork`: whole title + surname ⇒ yes; whole title, no surname ⇒ no; a row with
   no authors ⇒ no; truncated + surname without the year ⇒ no, with it ⇒ yes; a two-token title
   without the year ⇒ no; `en.wikipedia.org`, `www.amazon.co.uk`, `ndpr.nd.edu` ⇒ no; a
   `"… | Reviews | …"` tail ⇒ no; "Review of <title>" ⇒ no.
2. `readWebNote`: doi.org ⇒ candidate `own`; a publisher page for an identified row ⇒ `looks-like`;
   no anchor ⇒ only `looks-like` is possible; the article's own page still refused.
3. The press: a title-only row of a public-address article searches (one writer call) with no
   identifier in the prompt; the same row of an uploaded file ⇒ 409, no call; no authors ⇒ 409;
   the stored note carries `basis`; the check is sent `WEB_LOOKALIKE_EVIDENCE` for a `looks-like`
   page.
4. `shownWebNote`: `/3` note shown as `own`; `/3` none not `searchedRecently`; `own` on a
   non-doi/arXiv host ⇒ null; `looks-like` passes through.
5. Store round trip with `page_basis`; the CHECK refuses a note without it.
6. Client: the `looks-like` row label and card words.

## The simpler option passed over

**Accept any page `resultIsTheWork` accepts** — the rule *Find it* uses — with no refused list
and no new column, deriving the tier from the host. Fewer parts, but `resultIsTheWork`'s no-anchor
branch passes a page on the year alone, or with no author at all, and passes Wikipedia's page for
*What is it like to be a bat?*; and a host cannot say the tier, since a `looks-like` page can be a
doi.org page for a different DOI (a chapter's, a preprint's record).

## The plan review, and what it changed

GPT Sol, read-only: [prompt](261025d-plan-review-prompt.md), [answer](261025d-plan-review-sol.md).
*Proceed with fixes*, no P0, three P1s. **Each item below overrides the sections above where they
disagree.**

- **#1 (P1), taken.** One explicit predicate for a title-only search (`searchableByTitle` and
  `identify` in src/citation-web-note.ts): a public-address article, a first author, and a registry
  answer about the registry (`not-found`, `not-identified`, `no-abstract`). **A `conflict` is
  refused**, as are an author–year label, *unpublished*, a plain title and title search off. Each
  refusal is tested with no model call.
- **#2 (P1), taken.** A doi.org or arXiv page for a *different* identifier is neither `own` nor
  `looks-like` (`namesAnotherWork`). The anchor is not stored; instead the read guard shows `own`
  only at an address an `own` page can have (`couldBeOwn`: a resolver path that parses as a DOI,
  or arXiv's `/abs|pdf|html/` with an id), and hides one that fails.
- **#3 (P1), taken differently.** The column is **`page_kind`** (`pageKind`), not `page_basis`,
  and it is **nullable on a note, a null reading as `own`**, rather than a two-deploy migration:
  the deployed writer names no `page_kind` and took only strict pages, so the migration is purely
  additive with no backfill, and that writer can still insert during the deploy or after a code
  rollback. The CHECK allows a value only beside a note, and only the two. The rollback export
  carries the field.
- **#4 (P2), taken.** Hosts match exactly or by dot-delimited subdomain, Amazon by its own pattern;
  **the scholarly encyclopedias (SEP, IEP, Britannica) are off the list**, because an entry there is
  often the very work cited. Real-shaped fixtures: PubMed, Cell, PMC, Semantic Scholar, PhilPapers,
  Google Books, a university subdomain; an author's PDF titled by its file name is refused, a limit
  named in the investigation.
- **#5 (P2), already so.** Only a lone `Reviews` tail part is refused, so *Reviews of Modern
  Physics* still passes.
- **#6 (P2), taken.** The card says what code checked: *whose title matches this work's and which
  names its first author*. `WEB_NOTE_SEARCHING`, `WEB_NOTE_NONE`, `WEB_NOTE_SEARCHED`,
  `WEB_NOTE_NO_IDENTIFIER`, the band's (i) and the Sources help page no longer say *own page* or
  *DOI and arXiv only*.
- **#7 (P2), taken.** The after-run, judged:
  [261025d](../investigations/261025d-citation-web-note-looser-rule-yield.md). It changed the
  prompt once more: with no identifier, name a page *whose text as the search returned it names
  the work's first author*, after the first after-run lost eight works to a doi.org pick whose
  extract named nobody.

## Reviews

- Plan: GPT Sol, read-only — above.
- Code: GPT Sol, workspace-write — [prompt](261025d-code-review-prompt.md),
  [answer](261025d-code-review-sol.md). Six findings, all fixed by the reviewer and read before
  committing: **#1 (P1)** the deployed writer's upsert names no `page_kind`, so on a row a newer
  writer had touched it would inherit `looks-like` (a strict note mislabelled) or fail the CHECK
  on a *none*; a `BEFORE` trigger, `citation_web_notes_normalise_page_kind`, clears it for a `/3`
  write and for every *none* (migration `20261025121700`). **#2 (P1)** an article that became an
  upload while a press waited for its slot kept its title-search permission; the re-read now
  re-asks. **#3 (P1)** two test fixtures failed `npm run typecheck` (my gate had been a bare
  `tsc -p .`, which does not cover them). **#4–#6** wording that claimed more than code checks
  (the help page now names the refused hosts and says the rest can still be someone else's
  description), stale comments, and tests for host normalisation, Amazon's country domains and the
  upload race. The reviewer's sandbox could not reach Postgres; run here, its trigger turned one
  of my CHECK assertions (a *none* with a page kind is now cleared, not refused), which I rewrote.
