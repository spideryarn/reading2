# 260929g — a guessed link back to the web for an uploaded paper

Feedback report SPIDERYARN-READING2-5H (`report_id` spya-wsz0q4), from Greg, so trusted input:

> If someone uploads a paper, maybe as part of the import process, we should do a quick Google to try
> and find the canonical link for that paper and then add it, maybe with a question mark somehow to
> say that we've guessed at where the original URL was from. And if we can't find it for sure, if
> we're not, we don't find an exact match, then don't, don't link.

## What it is for

An uploaded PDF has no address, so the masthead says *uploaded* and the Metadata page says *there
is no web address to go back to*. For a paper there nearly always is one — arXiv, the publisher, a
DOI — and a reader wants it: to cite it, to share it, to check the version. We go and look for it
once, and show what we found **as a guess**, marked with a question mark. When the page we found
cannot be shown mechanically to be the same paper, we show nothing.

## The one safety property

**A guessed link is shown only if code, not a model, has shown the page is this paper.** The model
is a pointer into search results (as Citations' *Find it* already is — `citation-find.ts`); after it
points, code decides. A wrong link is worse than no link, because the reader will cite it.

## Decisions, and the assumptions in them (Greg's brief: simplest version, say so)

1. **Reuse Citations' search, not a new provider.** The search is one OpenRouter
   `openrouter:web_search` call (Exa, 5 results): `findWorkPage` in `src/citation-find.ts`, extracted
   by the fb5g session (459d3c54). Fetching and reading the candidate page is fb5g's `readPaperText`
   in `src/paper-text.ts` (HTML via Readability plus `citation_*` / `dc.identifier` meta, PDF via the
   free pdf.js text layer). We are their second caller and write neither. No new paid provider.
2. **Triggered by opening the article, not by a new pipeline step.** *Assumption, and a relaxation
   of "every upload" for Greg to see:* **an upload whose article is never opened is never
   searched.** Nothing is lost that anyone could see — the guess is only ever drawn on the article —
   and nothing is spent. The first open that finds no settled answer fires
   `POST /api/source-guess/:slug` and forgets it; the answer fills the line in when it comes.
   - **Once per upload** is a server-side claim: a row inserted if absent, with a fresh
     `claim_token`; the result is written only `WHERE status='searching' AND claim_token=$1`, so a
     stale writer's answer is discarded (Sol F4). A claim older than the deadline plus a margin is
     reclaimable; `attempts` is incremented inside the claim and capped at **2**, after which the row
     is `none` (Sol F5). The client fires whenever the status is neither `found` nor `none`, and the
     server decides whether that means *wait* or *reclaim*.
   - **One deadline covers the search and the page fetch together**, and the route answers only
     when the work is done: a Vercel function is frozen once it has answered.
   - **The version passed over: a successor job** queued by `publishRevisionIn`, as `labels` is
     (Sol F3's recommendation). Opus arbitrated, 2026-09-29: a successor is driven by the owner's
     browser too (`pump` is a no-op on Vercel), so B does not survive a closed tab either; the real
     difference is "from any page" vs "from the article", and `/add/upload/<id>` lands the owner on
     the article. B costs a new `StepName` registered in ~26 files and a step whose output is a row,
     not an artefact. *Sol F3 overruled on that reasoning.*
3. **Every upload, PDF or HTML**, provided it has a real title: not one that fell back to the
   filename, and at least three significant words.
4. **Owner-only, v1.** *Assumption.* A visitor to a public upload sees no guess; deferred because a
   guessed address wants its own public projection, as `final_url` has `publicSourceUrl`.
5. **No retry button.** *Assumption.* A settled `none` is final; Metadata says we looked and found no
   page we could be sure of.
6. **Bounded like *Find it*.** Its own `AiJob` id, `upload-source-guess`, passed into `findWorkPage`
   explicitly (its default is `citations-find`), and its own allowance bucket — concurrency 2, a
   per-owner hourly and daily count, a global daily fuse — because the provider can run many billed
   searches for one call (citation-find.ts header, the 36-search probe).

## What counts as "an exact match" — code

**Measured first, and it changed the rule.** Of the 65 uploaded PDFs in the local database, 43
have a DOI somewhere in their blocks, only 18 in the first 40, and 1 an arXiv id there — and a DOI
in a paper's text is as likely to be a *cited* work's as its own. The front-matter reader
deliberately drops DOI lines and arXiv stamps as furniture (`src/pdf-frontmatter.ts`), and pass 0
leaves sideways text — where arXiv prints its stamp — out of `PageText.text` (`src/pdf.ts`). So
"the upload's DOI" cannot be read off the blocks, and an identifier found in them is never evidence
on its own (Sol F1).

**The upload's identity** (`paperIdentity`, pure): the revision's title; its authors' surnames; the
identifiers in its **raw first two pages** (pass 0 text of the stored PDF, or the stored HTML's text
and `citation_*` meta for an HTML upload) — read from the source, not the blocks (Sol F6); and its
opening prose (the first ~150 words of body text after the front matter).

**A candidate** — the URL the search returned and the model pointed at, read by `readPaperText` —
**is this paper only if all three hold** (`isSamePaper`, pure):

1. **Title, exactly**: the candidate's title (`citation_title` meta, else the read title) has exactly
   the upload's significant title words, in order (`wordsOf`, both ways).
2. **First author**, when the upload has authors: their surname is among the candidate's meta
   authors or in its text.
3. **One independent agreement**:
   - **its own identifier is in the upload** — the candidate's DOI or arXiv id, taken from its URL or
     its `citation_doi` / `dc.identifier` / `citation_arxiv_id` meta (never its body text, which
     cites other works), appears among the identifiers of the upload's raw first pages; **or**
   - **its text says the same thing** — at least half of the distinct 4-word shingles of the upload's
     opening prose appear in the candidate's text. Shingles rather than one exact 12-word run,
     because the upload's words came through a model transcription and the candidate's through HTML
     or pdf.js, which disagree on hyphens and spacing (`src/pdf-score.ts`) (Sol F6). **This branch
     is on probation**: stage 2's real-page eval decides whether it ships (below).

**With no authors, the identifier is not enough** (Sol round 2, F1): an upload whose authors were
not extracted — `Meta.authors` is often absent — must pass the content branch, since then only title
and identifier stand between us and a cited work of the same name. If the identifier agrees as well,
the link is still the constructed canonical one.

If the upload carries an identifier of the same kind and the candidate carries a **different** one,
that is a no, whatever else agrees (truth table in the tests). Anything else — no title, a page that
could not be read (paywall, bot wall, timeout), a title that merely overlaps — keeps nothing.

**What is stored and drawn (Sol F2).** When the candidate's DOI or arXiv id was verified, the stored
link is the **canonical one we construct from it** — `https://doi.org/<doi>` or
`https://arxiv.org/abs/<id>` — and it is labelled *probably the original*. Otherwise it is the URL
the search returned (an exact `url_citation` key, never one the model typed), labelled *a page that
matches this paper*: same paper is not the same as original, and an author's copy is not the
publisher's.

## Stored where (Sol F7)

A table `upload_source_guesses`, one row per article (`article_id` PK, FK cascade), owner-scoped
through the article:

`status` (`searching` | `found` | `none`) · `url`, `host` · `kind` (`canonical` | `matching`) ·
`matched_by` (`doi` | `arxiv` | `content`) · `why` (the no-match reason, logged vocabulary) ·
`claim_token` · `attempts` · `searches` · `model` · `claimed_at` · `finished_at`, with SQL `CHECK`s
tying each status to the columns it requires and forbids.

**Not `final_url`, and not `meta.url`** — those mean *the address this article was fetched from*,
the base relative links resolve against, the dedup key, and what a visitor is shown
(content-extraction.md § the document with no address). And **not on `Meta`** either, which is
revision extraction metadata: the owner's article payload gets a required
`sourceGuess: SourceGuess | undefined` — a discriminated union — beside the other article-level
state, so a store projection that forgets it is a type error.

## Shown how

- **Masthead `OriginLine`** (owner, uploaded, found): after *uploaded*, the host-first address, a
  trailing **?**, dimmer than a real origin line, with a `ControlTip` (not a `title`, which touch
  devices never show — tooltips.md). For a `canonical`: *We searched the web for this paper and found
  its DOI (or arXiv) page — the title, first author and identifier all match your file. You uploaded
  the file, so this is our guess at where it came from.* For a `matching`: *…found a page with the
  same title, first author and text. It may be a copy rather than the original.*
- **Metadata `Origin`**: the upload sentence, then *Probably the original: <link> ?* (or *A page
  that matches this paper*) with the same tip; after a settled no-match, *We looked for it on the web
  and found no page we could be sure was this paper.* Nothing while searching or never searched.

## Stages

1. **The judge** — `src/source-guess.ts` pure half: `paperIdentity`, `isSamePaper`, the canonical-URL
   construction, with red-first tests (the truth table: matching and conflicting DOIs and arXiv ids,
   a cited work with the same DOI but a different title, a perfect title with the wrong author, a
   filename title, content shingles over hyphenation differences).
2. **The row, the route, and the eval** — migration + store, `POST /api/source-guess/:slug`
   (claim → `findWorkPage` → `readPaperText` → `isSamePaper` → fenced save), the allowance, the job
   id, `sourceGuess` on the owner's article payload; tests with the search and the read injected.
   **Then a real-page eval** on 8–10 uploaded papers from the local database, run for real (a few
   cents each): for each, what was found, which branch passed, and a human check of whether the
   link is right. The content branch ships only if it produced no wrong link in the eval *and* found
   something the identifier branch missed; otherwise it is cut and the plan says so.
3. **The reading view** — the fire-once hook in `OwnedReader`, the masthead and Metadata lines, the
   tip. Browser check (Sonnet subagent) against a real uploaded paper.
4. **Docs and bookkeeping** — ingest-queue.md § Uploading a PDF gets a short section; citations.md
   notes the second caller of `findWorkPage`; `docs/user-feedback/` note.

GPT Sol reviewed this plan read-only
([review](260929g-canonical-link-for-an-uploaded-paper-plan-review-sol.md): F1–F7, verdict *rework*);
this revision answers each, and a second round checks it. The code gets its own review at the end.

## Deferred, deliberately

A visitor seeing the guess; a retry button; Crossref or another bibliographic API (free, but a new
dependency) for pages the fetch cannot read.

## Progress

- 2026-09-29: plan written; shared helpers agreed with fb5g (they build `findWorkPage` — landed as
  459d3c54 — and `readPaperText`). Sol round 1: *rework*. Revised: identity from the raw source, all
  of title + author + an independent agreement, constructed canonical URL, fenced claim with an
  attempt cap and an allowance, `sourceGuess` off `Meta`. F3 overruled after Opus arbitration.
- Sol round 2 ([review](260929g-canonical-link-for-an-uploaded-paper-plan-review-2-sol.md)): F2–F5,
  F7 resolved; F6's remainder is a P2 (sideways arXiv stamps are out of pass-0 text — safe false
  negatives; the eval will show whether it matters); F1 still open for an authorless upload, fixed
  above by requiring content agreement then. Discovery closed; the verdict line still read *rework*
  on F1 alone, and that fix goes to the code review to check.
- Stage 1 landed (8a348fac), stage 2 (8b714537).
- **The eval** ([260929g-…-eval.md](260929g-canonical-link-for-an-uploaded-paper-eval.md),
  `scripts/eval-source-guess.ts`): 7 distinct uploaded papers (all the local set has), 7 billed
  searches, $0.15. **3 links shown, 3 right, 0 wrong**; 3 missed, every one a page `readPaperText`
  could not read (two publisher 403s, one JavaScript-built preprint page) — no rule refused a page
  it could read. **The content branch ships**: 6 of 7 uploads have no extracted authors, so under the
  authorless rule it is the only way they get a link, and all three right links needed it.
  Not built, for Greg: when the found page is bot-walled, ask doi.org for the DOI's registered title
  (free) — but that is title + identifier without author or text, the combination F1 refused.
  The safer lever is better author extraction for PDF uploads, which is outside this report.
