# Check the paper: does the cited work say what this article cites it for?

Status: **stage 1 landed (aed24b71), stage 2 in progress** — 2026-09-29. Feedback report
SPIDERYARN-READING2-5G (`spya-emvua7`), Greg, dictated:

> Okay, so when in citations mode, like the questions that we might want to ask, what were they? You
> said something like, how well does it support what it's being footnoted to support? Yep. And
> generally, what were they doing in that paper? Yeah, okay. So you might need a web research to
> actually read the paper itself, ideally. And if you can't do that, then you should be really clear
> that you couldn't. But if you can, then you should ideally, you know, in the tool tip or whatever,
> include quotes or something that suggests that whether the paper does say what the cited paper
> says what this paper says. be really careful to be clear about whether you could get the actual
> paper, so that we can be sure you're not hallucinating

## What it is for

Citations mode lists what an article leans on. It cannot yet answer the reader's natural next
question — *does that paper actually say what this article says it says?* This adds one button per
cited work, **Check the paper**, that fetches the paper itself, reads it, and answers:

1. **Does it back up what the article cites it for?** — with up to three **passages from the paper**.
2. **What is the paper doing, in general?** — one plain sentence, itself backed by a passage.

The spine of the ask is Greg's *"be really careful to be clear about whether you could get the
actual paper"*. So the answer separates, visibly, **what code established** from **what the AI
thinks**:

- *Established* (drawn plainly): whether the paper was retrieved, from where, how much of it, how
  much of that the AI was shown, and the passages — each one found, by code, in the text we fetched.
- *The AI's reading* (labelled as such): the verdict word, a one-sentence reason, and what the paper
  does.

This fits vision.md's "augments rather than replaces": it points at the paper's own passages that
bear on one claim, and says where the evidence is thin.

## The safety properties (revised after GPT Sol's plan review, P-1…P-6)

1. **Not retrieved → no model call, no claim.** An unreadable outcome says why, in one sentence
   (`paperUnreadableSentence`), and nothing else.
2. **Wrong document → no claim.** Identity is a ladder, never "the title occurs somewhere in the
   body" (a paper that *cites* the work contains its title too — Sol P-2):
   1. an identifier on both sides (DOI; arXiv id) must agree — any disagreement is a refusal;
   2. otherwise a strong normalised title match against the page's `citation_title`, or against the
      **first ~3,000 characters** of the text (a PDF's title page) — never the rest of the body —
      plus the first author's surname or the year there too, where the list has one.
   Applied to the document actually read (after following `citation_pdf_url`).
3. **Every passage shown is a slice of the text the model was shown**, found with
   `findQuote(assessed, quote, undefined, "spaced")` — the strict pass Quotes mode uses, not
   `quoteAppears`, whose whitespace-deleting second pass is a drawing aid (Sol P-3). What is stored
   and shown is **the paper's slice, not the model's spelling**. At least 6 words; at most three.
4. **The text is canonicalised once** — NFKC (folds `ﬁ` into `fi`; `pass0`'s baseline already mends
   line-end hyphens) — and that one string is both what the model sees and what quotes are searched
   in (Sol P-4).
5. **Verdicts carry evidence or say they have none** (Sol P-1, P-5):
   - `supports`, `partly` — need ≥1 verified passage; with none they become `cannot-tell`.
   - `no-support-found` — *"we found nothing in the text we checked that backs this up"*, always
     worded as limited to what was checked, and naming it when only part of the paper was shown.
     There is no categorical *does not support*.
   - `cannot-tell`.
   - `paperDoes` is shown only with its own verified passage; otherwise dropped.
6. **The article's side is the article's own words**: the row's existing `why` and the citing
   passages, not a second model restatement.
7. **Injection** (Sol P-6): no tools on the request; a system rule that both the article passages
   and the paper are evidence, never instructions, repeated after the paper; delimiters defused
   (`untrusted()`); a strict runtime parse of the answer (clean finish, exact enum, bounded strings,
   ≤3 bounded quotes) — anything else is a failure, not a partial answer. Worst case: a hostile paper
   makes its own check say something false *with* a real passage from itself shown beside it.

## How the paper is found (reuse)

1. The row's own address, when the article gave one (`linkFrom` doi / arxiv / article link) or
   *Find it* stored one (`web`).
2. Otherwise **`findWorkPage`** (src/citation-find.ts, 459d3c54, shared with fb5h). A kept page is
   also saved to `citation_finds`, as *Find it* would.
3. **`readPaperText(url)`** (src/paper-text.ts, aed24b71, shared with fb5h): `fetchDocument` only
   (15 MB, one attempt, its redirect cap and SSRF guard on every hop), arXiv `abs` → `pdf`, one hop
   to `citation_pdf_url`, PDF text layer via `pass0` (≤150 pages), 25 s.

No new provider or subscription. Unpaywall deferred.

## What the model is shown (Sol P-5)

If the canonical text fits the budget (~60k characters), all of it. Otherwise deterministic
selection: split into ~2,000-character chunks on paragraph boundaries, always keep the first two
(title, abstract, introduction), then the chunks with the most distinctive-word overlap with the
citing passages + `why` + title, up to the budget, **in document order**, each labelled. The
reader is told both numbers: *retrieved 14,200 words; the AI was shown 8,900 of them*.

## The model call

One non-streamed JSON call, new job **`citations-check`** (chat wire, `capable` tier), no tools,
bounded output tokens, inside the request's one deadline (~90 s end to end). Output:

```json
{"verdict": "supports | partly | no-support-found | cannot-tell",
 "reason": "one or two plain sentences",
 "passages": ["verbatim passage from the paper text", "..."],
 "paperDoes": "one sentence", "paperDoesPassage": "verbatim passage"}
```

**Not streamed, on purpose**, against the house rule: nothing can be shown until the passages are
verified, and streaming would show unverified ones. Sol agreed (P-10 note).

## Stored, owner-only, never stale

A row per `(article, entry id)` in a new table **`citation_checks`** (Sol P-10): owner FK, article
cascade, outcome (`read` | `unreadable`, CHECKed with the nullability of each side), requested URL
and final URL, host, format, retrieved words, assessed words, content hash, **input fingerprint**,
verdict (CHECKed enum), reason, paperDoes, passages (a bounded JSONB array of `{text, chunk?}` —
documented as one opaque display value), dropped-passage count, unreadable reason, model, prompt
version, time.

**The fingerprint** (Sol P-8) hashes the work's title/authors/year, `why`, the citing passages'
text, and the prompt version. A stored check is attached to its row only when the fingerprint
matches the current list; otherwise the row offers *Check again* and says the old check no longer
matches (the list was made again since).

**Presses** (Sol P-9): a new `citation-check` bucket of the shared per-owner allowance with
**concurrency 1** — so two tabs cannot run two checks at once, and an older run cannot overwrite a
newer one — taken after every free refusal and **before** the first billed thing (the search or the
model call). Guesses: 15/hour, 40/day, global fuse. Log: host, format, words, assessed, verdict,
passages kept/dropped, searches, ms — never paper or article prose.

Private (not in the public DTO); in both export projections.

## Where the reader sees it

- **The Citations row**: *Check the paper* (owner-only, behind the experimental switch), with a
  `ControlTip` (what it does, that it costs money, that it says so if it cannot get the paper). The
  result under the row: the provenance line first; the article's side (`why`); the passages, each
  marked *from the paper*; the AI's reading, labelled; *Check again*.
- **The hover card on a citation mark** (Greg's "in the tool tip"): when a current check exists —
  the provenance line, the verdict (labelled the AI's reading), the first passage. No button.

## Stages

1. ✅ **`readPaperText`** — aed24b71.
2. **The check** — src/citation-check.ts, the table + migration, the bucket, the job, the route
   `POST /api/citations/:slug/:id/check`, attaching current checks in `loadCitations`, export.
   Tests red-first for every rule in § The safety properties. Sol code review (also covers stage 1).
3. **UI** — row and hover card; browser check in a Sonnet subagent. Sol code review.
4. **Evals and docs** — real citations from a few local articles (cost recorded here), an injected
   paper, citations.md, the feedback note.

## Assumptions (product calls taken the simple way)

- One button per row, on demand; never at ingest, never all rows at once.
- Four verdicts, none of them a categorical "does not support".
- Stored and shown again while current.
- Owner-only.
- Not streamed.

## Not doing (v1)

Unpaywall / open-access lookup; checking every row; OCR of scans; a visitor's view; streamed
progress; a hard abort inside `pass0` (it takes no signal — bounded by the page cap instead, Sol
P-7; worth doing if logs show slow parses); a page number on each passage.

## Review log

- Plan review: [260929g-check-a-cited-paper-plan-review-sol.md](260929g-check-a-cited-paper-plan-review-sol.md)
  — build with changes; all ten findings adopted above, in the simplest form that answers each. Not
  adopted as written: P-3's per-quote chunk id from the model (verifying against the whole assessed
  text is enough when the assessed text is exactly what was sent); P-7's benchmark of worst-case PDFs
  (bounded by page cap and byte cap; deferred).
