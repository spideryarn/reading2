# An article is found by the address it was asked for, and a redirect that ends on a paper source imports the paper

Status as of 2026-10-06: **plan reviewed (GPT Sol, one round), being built.** Queue entry `qi-fbrh4kck`, deferred from
[261005m](261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md) § Deferred
(report `spya-ayettj`, part 2). Greg said yes to the new column on 2026-10-06 (*"qi-fbrh4kck yes"*),
relayed by the Overseer with one condition: the column must be additive.

## Goal

A reader pastes a link that is not the paper's own address but leads to it: a `doi.org` link, or a
shortener (`bit.ly`, `t.co`, `lnkd.in`). Today we follow the redirect and import whatever page it
ends on, so a short link to `arxiv.org/abs/1706.03762` imports arXiv's abstract page, a few hundred
words, where pasting the arXiv link itself imports the paper.

**What should happen:** if the address the link ends on is one `src/paper-sources.ts` recognises, we
import that paper, exactly as if the reader had pasted that address.

**Why it was blocked.** "Do we already have this article?" is asked of one address per article:
where its bytes came from (`article_revisions.final_url`). After the change above, a short link's
article has the paper's address there, and the short link's own key matches nothing. So pasting the
same short link a second time would import it again and charge for it again (GPT Sol's G1 on
261005m). The article has to be findable by the address it was *asked for* as well.

## Background, in plain words

- **`urlKey(url)`** (`src/ingest.ts`) turns an address into the string two addresses share when
  they are one article. For a paper source it is the paper's key, whichever shape was pasted.
- **The shelf lookup** is `slugForUrlKey(key)` in `src/store/find-article.ts`. It reads every
  article the reader owns with its published revision's `final_url`, and compares `urlKey` of each
  in JavaScript. `freeSlug` and `slugForRetry` in `src/jobs.ts` call it.
- **`article_revisions.requested_url` is not the pasted address** (Sol's G14): it is what
  `fetchDocument` was asked for, and for a paper source that is a candidate we derived.
- **A refresh** is a job with no address of its own: `enqueue` gives it `urlForSlug(slug)`, the
  article's `final_url` (`src/jobs.ts`, the line `request.url ?? … urlForSlug(slug)`).
- **The fetch step** (`STEPS.fetch` in `src/pipeline.ts`) asks `resolvePaperSource(url)`. A paper
  goes to `fetchFromPaperSource`, which tries the paper's candidates in order. Anything else is one
  `fetchDocument(url)`.

## Design

### Stage 1: `articles.asked_url`

One new nullable text column on **`articles`**, written once, when the row is born, with the job's
own address. Never updated afterwards. Null for an upload, and for every article that exists today.

```
articles
  slug        why-trees-spya-k3m9qt
  short_id    spya-k3m9qt
  asked_url   https://bit.ly/3xYz        <- new: what the reader pasted
article_revisions (the published one)
  final_url   https://arxiv.org/html/1706.03762   <- where the bytes came from
```

- **Where it is written:** `lockOrCreateArticle` in `src/store/pg-revisions.ts` is the only line
  that inserts an `articles` row. It already takes a `birth` argument that is ignored when the row
  exists. The asked-for address joins it. **One exception, for Sol's K1:** a row that exists, has
  never published a revision and has a null `asked_url` is given the address too. That is the row a
  failed import left behind before the column existed, being retried. Only an import job reaches an
  unpublished article with an address (a job with none of its own gets `urlForSlug`, which answers
  nothing for an unpublished article), so the address is still the pasted one. Once the article has
  published, or once the column is set, nothing changes it: a refresh and a late-stage re-run both
  find a published row.
- **How the address gets there** (Sol's K5): the job's `url` is in hand in `claimSession`
  (`src/jobs.ts`) and has to be threaded through `openPgStoreSession` and `openOrBeginJobDraft`
  (`src/store/pg-session.ts`, `src/store/pg-revisions.ts`) to `lockOrCreateArticle`, keeping the
  article-before-job lock order. The test goes through `claimSession`, not the writer.
- **Where it is read:** `slugForUrlKey`. An article matches when `urlKey(final_url)` equals the key,
  as today, **or** when its `final_url` is an address a paper source recognises and
  `urlKey(asked_url)` equals the key. A match by `final_url` wins over a match by `asked_url` when
  two different articles match. An article with no published revision still never matches.
- **Nothing else reads it on purpose.** It is not on any reader-facing read, not in `Meta`, not
  shown. It is the owner's own pasted string and can carry a token in its query, so it stays off
  every public projection. The owner's export serialises the whole `articles` row bar a short list
  (`articleJson`), so it will appear in `article.json` (Sol's K7; `requestedUrl` is in
  `content/revision.json`). That is right for an owner's own export, and the stage checks it.
- **The migration** is `alter table articles add column asked_url text`: additive, nullable, no
  default, no backfill, no index (the lookup is not SQL). Made with `npm run db:generate`.

**Why on `articles` and not on the revision, beside `requested_url`.** The revision is rewritten by
every fetch. A refresh's job address is the article's `final_url`, so a column the fetch step
writes would be overwritten with the paper's address on the first refresh, and the short link would
stop finding the article. Keeping it there would mean either teaching the fetch step whether its
address came from a reader or from the shelf, or sending every refresh back through the pasted
link (and a dead short link then breaks refresh). On `articles` it is written once by the one line
that creates the row, and it skips the revision's column inventories (`RAW_COLUMNS`, the carry
policy, the read projections). It is also what the fact is: which address made this article.

**The column is kept for every article; the lookup uses it only for papers** (Sol's K3). The first
draft matched every article by its asked-for address, so a `t.co` link to a blog post pasted twice
would find the first article. Sol showed what that breaks: a link that is meant to move
(`example.com/latest`) would find the old article for ever, and Refresh could not fix it, because
Refresh reads `final_url` and never goes back to `/latest`. A paper's link does not move. So the
asked-for address finds an article only when that article's `final_url` is a paper a source
recognises. An ordinary redirecting link pasted twice still imports twice, as today. Widening it
is a product call for Greg, and the column is already there if he wants it.

**Not solved, and the same as today:** the reader holds the arXiv paper, then pastes a short link
to it. The short link's key matches nothing, a second article is minted, and the fetch step finds
out too late that it is the same paper. Today that second article is the abstract page; afterwards
it is the paper. Catching it means the fetch step failing a job with "you already have this", which
is new machinery and its own plan.

### Stage 2: the redirect look

In `STEPS.fetch`, when `resolvePaperSource(url)` is null, the address is fetched as today. Then:

```
doc = fetch(url)                                  as today
paper = doc.url !== url ? resolvePaperSource(doc.url) : null
if paper is null            -> keep doc           as today
else                        -> fetchFromPaperSource(paper), with doc on hand
```

- **Only where the fetch ended**, never a hop in the middle, and only when it moved.
- **The document already fetched may satisfy a candidate** (Sol's G6). The candidates are walked in
  the usual order. When a candidate's address is the address `doc` ended on, by `sameTarget`
  (`src/urls.ts`: the same request, ignoring only a fragment; Sol's K6), `doc` is used in place
  of a second request, and is held to the same promise (kind and marker). So a short link to
  `arxiv.org/pdf/<id>` asks arXiv's HTML first, and if that is absent uses the PDF it already holds.
  A short link to an abstract page fetches the candidates, since a landing page is never one.
- **Nothing new is trusted.** The candidates are the fixed `https://` strings the registry builds
  from a closed id pattern; each still goes through `fetchDocument` with every defence on. What the
  redirect contributes is which paper, read off its final address by the same patterns a pasted
  address goes through. [security-map.md](../project/security-map.md).
- **A failure is the paper source's failure**: `[fetch-paper-missing]` when the last candidate is
  absent, and the same `warn` line, with no address.
- **The job card** says `312 KB, ACL Anthology PDF`, as for a pasted paper address.

With stage 1, the article's `asked_url` is the short link and its `final_url` is the paper's, so
the short link, the paper's landing page and the paper's PDF address all find it.

**Stages 1 and 2 reach `dev` in one push** (Sol's K4), so there is no deploy in which a short link
is remembered but still imports the abstract page.

### Stage 3: NBER and OSF — decided by the probe

**The probe, 2026-10-06** (`261006i-evidence/probe-nber-osf-redirects.txt`, 28 requests through
`fetchDocument`): NBER's PDF address answered a PDF for `w30000` and for two papers from this week;
no held paper was found, so what one answers is unmeasured. NBER's DOI ends on the PDF itself.
OSF's download ends on `storage.googleapis.com/…/<content hash>` with a signed query that changed
between two requests ten seconds apart. **So NBER is built and OSF is not**: it is re-queued, and
what it needs is the paper's `canonicalUrl` as the article's address, not this column alone. (The
probe's subagent found one SocArXiv id through `api.osf.io`, which OSF's robots file disallows:
one request, not repeated, and no code here calls it.)

The same queue entry carries two sources that waited on stage 1. Each is one object in `SOURCES`
if a live probe (free, `docs/plans/261006i-evidence/`) comes back clean:

- **NBER**: build it only if a recent paper's PDF address answers something the fetch step already
  treats as a clean failure or a PDF. If a held paper answers an HTML page with a 200, the import
  would fail as "not what its source promised", which is `retry` and wrong. Then it stays deferred.
- **OSF / PsyArXiv / SocArXiv**: its PDF ends on a signed, expiring Google Storage address. Stage 1
  makes the article findable again. It does not make that address a usable source link or a usable
  Refresh, since both read `final_url`. So OSF needs either the paper's `canonicalUrl` stored as
  the article's address, or Refresh sent through `asked_url`. **This plan does not build OSF unless
  the probe shows the final address is stable**; otherwise it is re-queued with that finding.

## The simpler options passed over

- **Recognise more DOI prefixes by pattern, with no fetch** (as arXiv's and ACL's DOIs are today).
  No column needed. It does nothing for shorteners, and most publishers' DOI suffixes are not the
  id their site uses.
- **Reuse `requested_url`.** No migration. It is the wrong address for a paper source (G14), and it
  is overwritten by a refresh.
- **Match every article by `asked_url`.** The first draft. Withdrawn for K3, above.

## Stages

Each: tests first and seen red, built by an Opus subagent, `npm test` and `npm run typecheck`,
a GPT Sol code review (write-capable, fixes inside the stage), one commit.

### Stage 1: the column and the lookup

- [ ] Red: `tests/find-article.test.ts` — an article whose `asked_url` is a short link and whose
      `final_url` is a paper address is found by the short link's key, by the paper's key, and not
      by an unrelated key; **an article whose `final_url` is not a paper is not found by its
      `asked_url`**; an unpublished article with an `asked_url` is not found; two articles, one
      matching by `final_url` and one by `asked_url`, answer the `final_url` one.
- [ ] Red, through `claimSession`: the row a URL job creates carries the job's address; a second
      job on the same published slug with a different address leaves it unchanged; an upload's row
      has null; **an existing unpublished row with null gets the retry's address** (K1).
- [ ] Schema, migration (`npm run db:generate`, `npm run db:chain`), `lockOrCreateArticle`,
      `slugForUrlKey`. Applied locally; `Target:` line read.
- [ ] Mutations seen red: drop the `asked_url` half of the match; write `asked_url` on every lock
      rather than on insert.
- [ ] Docs: `database.md` or `ingest-queue.md` (whichever owns "do we already have this"),
      `find-article.ts`'s header.

### Stage 2: the redirect look

- [ ] Red, in the fetch step's tests with a fake `fetchDocument` that counts requests: a short link
      ending on `arxiv.org/abs/<id>` fetches arXiv's HTML and stores it; one ending on
      `arxiv.org/pdf/<id>` with the HTML absent makes **no second request for the PDF**; one ending
      on an ACL landing page fetches the PDF; one ending on an unknown host is kept as it is with
      one request; an address that did not move is never re-resolved; the last candidate absent
      fails `[fetch-paper-missing]`; the detail says the source.
- [ ] Build it in `src/pipeline.ts`. `fetchFirstCandidate`'s rules for moving on are unchanged.
- [ ] `evals/paper-sources/resolve-live.ts` gains the redirecting cases the probe found; output
      under `261006i-evidence/`.
- [ ] Mutations seen red: resolve a middle hop; skip the promise check on the held document; always
      refetch.
- [ ] Docs: `fetching.md` (the sources section), `ingest-queue.md`, `paper-sources.ts`'s header
      (which says a source known only after a fetch "does not fit here").
- [ ] A full import of one short link through the queue on the local stack, and a second paste of
      the same link, checked in the browser at three widths by a Sonnet subagent: the second paste
      opens the first article.

### Stage 3: NBER, OSF

- [ ] NBER, by 261005m's rules for a source: `nber.org` and `www.nber.org`, `/papers/w<N>`,
      `/papers/w<N>.pdf`, `/system/files/working_papers/w<N>/w<N>.pdf`, and its DOI
      `10.3386/w<N>` by pattern; one candidate, the `system/files` PDF; the key is what `urlKey`
      gave the landing page before. Live-checked.
- [ ] OSF: not built. Re-queue recommended in the debrief.

## Questions and decisions

- **The column is on `articles`, written once.** § Why on `articles`.
- **Only a paper is found by its asked-for address.** Widening it to every redirecting link is
  flagged for Greg in the debrief.
- **NBER built, OSF re-queued.** § Stage 3.

## Reviews

- **Plan review, GPT Sol, round 1** (`261006i-plan-review-sol.md`, on commit `1f7731bac`): *build it
  after fixing K1, K2 and K3*. Its audit of the plan's claims about the code found them correct
  bar K7. Each finding was checked against the code.

  | ID | Finding | Disposition |
  |---|---|---|
  | K1 (P0) | A row a failed import left before the column existed keeps a null `asked_url` when it is retried, so the next paste imports and reads the paper again | **Fixed in the plan**: an unpublished row with a null value is given the address. Not in the reviewed snapshot, so the code review checks it first |
  | K2 (P0, inherited) | A second paste that finds the article still spends an import slot: the route calls `withIngestSlot` for any request with an address, and an all-skipped job charges | **Not fixed here; raised with Greg.** It is true of every repeat paste today and `billing.md` records it as known (*"a re-added URL adopts the shelf's article and charges again … Defensible"*). This plan makes the same paste cheaper, not dearer: one slot, where before it was a slot, a second article and a second read. Changing what a slot is charged for is a billing decision |
  | K3 (P1) | Matching every article by its asked-for address strands a moving link on its old article, and Refresh cannot recover it | **Accepted**: the lookup uses the column only when the article is a paper |
  | K4 (P1) | Stage 1 deployed alone would remember short links whose article is still the abstract page | **Accepted**: one push for both stages |
  | K5 (P2) | The job's address is not an argument at the first creation call | **Fixed in the plan**: the chain is named and the test goes through `claimSession` |
  | K6 (P2) | "The same address" for the held document should be `sameTarget`, not string equality and not `urlKey` | **Accepted** |
  | K7 (P3) | The export puts the column in `article.json`, not beside `requestedUrl` | **Fixed** |

  One round on the plan: the fixes are checked in the stage's code review.
