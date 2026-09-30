# Citations: an *Investigate* button that looks into one cited work, on demand

Status: **planned 2026-09-30; revised after plan review round 1; not built.** Feedback report SPIDERYARN-READING2-5Q (`spya-wtm6qx`),
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Citations mode on
`9689-full-spya-m43th2`:

> Re Citations mode:
> - In previous Feedback, I had suggested that it should search the web and provide extra information
>   about whether the cited paper corroborates the claims and how else it relates to the current paper
>   (with an addendum based on the User Profile and "Why you're reading this one" information).
> - That would still be ideal, but it's probably too expensive to do for every single paper. Perhaps
>   instead, in a citation-item in Citations mode, provide an "Investigate" button that triggers this
>   deeper dive, i.e. don't do it automatically for every single paper every time we run Citations
>   mode.

It follows SPIDERYARN-READING2-5G, whose plan
[260929g](260929g-check-a-cited-paper-supports-the-claim.md) is on `dev` (c5d4c31d) and is the base
this builds on. **5G's rule carries over:** say plainly what was actually read of the work, so the
reader can tell a reading of the paper from a guess about it.

## What exists after 5G

- **Look it up** (per row, owner-only, billed, JSON): *one* web search for the work, keeps a page
  whose title names it, and judges that one page's **search extract** (usually the abstract) against
  *what the article uses it for*: supports / partly / the extract doesn't show it. Every quote is
  found by code in the extract. src/citation-lookup.ts, src/citation-find.ts.
- Every row says what we have read of the work (`readNoteOf`), usually *nothing*.
- The glossary's **Look it up** is the pattern for "one streamed, billed, web-searching answer about
  one entry, kept": it calls the shared `explainStream` (src/explain.ts — the request, the two
  clocks, the end classification, the web-search tool) with a selection, and saves the finished
  answer per `(article, entry id)` (src/term-lookup.ts, `glossary_lookups`).

Look it up answers *does the abstract back the claim* cheaply. It cannot answer the rest of what
Greg asked: how else the work bears on this article, anything past one page's extract, or anything
about this reader.

## What Investigate is (revised after the plan review — see § Review log)

A button on each owner row, **Investigate**, beside *Look it up*. One press = one streamed answer
about that one work, written with a few web searches, and kept. Nothing runs for every row.

The answer is short plain prose in up to three parts, each opening with a plain lead so it scans:

1. **Does it back the claim?** — against *what the article uses it for* and the citing passages:
   what the sources say about whether the work says that, **paraphrased and attributed** ("the
   abstract on arxiv.org says …"), never quoted.
2. **How else it bears on this article** — what the work actually does, and where it agrees with,
   extends, or sits awkwardly with the article beyond the one claim.
3. **For you** — only when the reader has written a profile or *why you're reading this one*.

### No quotes from sources — the rule that makes streaming honest

The first version checked quotes after the stream ended. GPT Sol's P0: the reader has already seen
an unchecked quote as the paper's words by then, and a warning under it does not undo that. So:

- **The prompt forbids quoting any source.** Paraphrase, and name where it came from.
- **The quote guard** (code, after the stream ends): every run of six or more words inside straight
  or curly double quotes must be found (`findQuote`, strict) **in the article itself** — quoting the
  article being read is fine, and it is in the prompt. Anything else: **the answer is not stored**,
  no `done`, and the client replaces the streamed text with *"This answer quoted a source directly,
  which we could not check, so it was not kept."* with *Investigate again*. Exposure is bounded to
  the one viewing, and it is taken back.
- **Verbatim evidence stays with 5G's *Look it up***, the one code-verified quote path. When a
  current lookup is stored for the row, the investigation view shows its verdict and quote beside
  it, with its own provenance line unchanged; when none is, the view offers *Look it up* (a
  separate charge, so not run automatically).

### What was read, said by code, not by the model (5G's rule)

Under the answer, always at the same claim level:

> *We did not obtain the paper itself, or the full text of any page. This was written from search
> extracts of N results (arxiv.org, nature.com, …). It is the AI's reading of those extracts,
> paraphrased, not quoted.*

- N counts only results whose extract was non-empty (Sol P-2).
- **No "one of them matches the work" line** (Sol P-3): applying 5G's identity rule to every
  evidence page answers a weaker question than 5G asks, and "the paper itself was not obtained" is
  the claim we can fully back.
- Sources are listed as `safeUrl`-filtered links, host and title.
- The search is **pinned to Exa** with a small `max_total_results`, and the per-result size the
  model and our copy agree on is settled by the probe (step 1 of stage 1).

### Inputs to the call

- the whole article, as the cached first part (`articleWithIds`, as explain);
- the work: title, authors, year, reference entry, and the article's own link when `linkFrom` is
  not a search (to aim the search);
- `why` and the citing passages (the first-mention paragraph and up to two more, capped);
- the reader's profile and purpose (`resolveProfile(slug)` → `profileSection`, with
  `PROFILE_RULES` in the system prompt), in the second part.

All capped in characters. Search results are strangers' pages reaching a model, exactly as in
explain today: the web-search tool and no other tool, and the answer is labelled as a reading.

### Mechanism: a shared stream runner, extracted from `explainStream` (Sol P-5)

Not a seam on `explainStream`: comments and the glossary depend on its request bytes for their cache.
Instead a **move-only refactor** pulls out the part both need — the deadline and stall clocks, the
`openRouterStream` loop, citation/evidence collection, usage and search-count provenance, and
`classifyEnd` — into a lower-level runner. `explain.ts` keeps its own request, job, logging and
accepted endings, and **snapshot tests of the fully serialised explain request (ordinary, deep,
profiled) are written first and must not change.** A new `src/citation-investigate.ts` builds its
own request under a new AI job `citation-investigate` (models.ts, `AI_JOB_ROUTE`, ai-gateway.md),
its own tools (Exa pinned), and **accepts only a clean `finished` ending** (Sol P-8): unknown finish
reasons and tool requests store nothing.

### The route, the store, the limits

- `POST /api/citations/:slug/:id/investigate`, SSE out, `streamTermLookup`'s shape: refusals as JSON
  before the headers, then `delta`… and one `done` (the stored investigation) or `error`. **`done`
  only after it is stored.** `gone` is not passed to the model, as the glossary lookup, so closing
  the band does not throw away a paid answer. Nothing is read off the body.
- **Own allowance bucket** `citation-investigate` on `fetchAllowanceStore`, concurrency 1, lease =
  timeout + margin; the hourly, daily and global numbers **set from the probe's measured cost** and
  written here with the arithmetic. A new bucket on the existing limiter; no defence is edited.
- A new table `citation_investigations`, one row per `(article_id, entry_id)`, overwritten by a
  second press: owner id, `answer`, `sources` (jsonb `Citation[]`, safeUrl-filtered — a variable
  list, as `glossary_lookups.citations`), `extracts_read` (int, non-empty extracts), `searches`
  (nullable — null is "not reported", not zero) and `searches_from`, `model`, `context_hash`, `at`.
  Checks: entry-id format, non-negative counts. Additive migration.
- **Staleness (Sol P-4, one hash):** `context_hash` over everything sent — the article part, the
  work's fields including link and link source, `why` and citing passages as capped, the rendered
  profile, the prompt version and the model. Attached at read time only on a match; otherwise the
  row reads *Investigate* again. One press regenerates.
- **Private**: never in the public payload; **in export** — the rollback export in
  src/store/export.ts, the bundle (src/store/export-bundle.ts) and `ARTICLE_TABLE_COVERAGE` /
  `readArticleRows` in src/store/article-rows.ts, each tested (Sol P-7).

### UI

On an owner row: **Investigate** (a `ControlTip`: what it does, that it costs money, that it reads
search extracts and never the paper, that the answer is kept). While running, the answer streams
into the row. When done: the answer, the *what was read* line, the sources, *Look it up*'s verdict
beside it or the offer of it, and *Investigated <date> · Investigate again*. A stored investigation
is collapsed to its first lead with a toggle, so the list stays a list. Not on the hover card.

## Stages

1. **Server.** Step 1 is a gate: a real streaming probe (a script, Exa pinned, a small result cap)
   on a few local citations — cost, searches, extract sizes, latency, quote-guard hits — recorded
   here, and the allowance numbers set from it. Then the runner extraction (explain snapshots first),
   the job, the prompt, the guard, the table, the store, the route, the allowance, attach-at-read,
   export, public stripping. Tests red-first. GPT Sol code review.
2. **Client.** The button, the streamed view, the stored view, the tip. Browser check in a
   subagent. GPT Sol code review.
3. **Docs and note.** citations.md, ai-gateway.md's job line, the feedback note.

## Assumptions (product calls taken the simple way)

- Owner-only and behind the experimental switch, like *Look it up*.
- Kept, one per work; a second press replaces it. No history.
- Plain prose with leads, not a structured form: Greg asked for *extra information*, and prose
  streams. Verbatim quotes belong to *Look it up*.
- A quoted source refuses the whole answer rather than flagging it.

## Deferred, named

- **Reading the paper itself** — 5G's proposed later stage (`readPaperText`, an identity ladder,
  passages verified against what was sent). With it, Investigate could quote the paper, verified,
  and the *what was read* line would change. Still a question for Greg, as 5G left it.
- Verified quotes from Investigate's own sources (Sol's option B: buffered, source-bound JSON).
- Investigate from the hover card; *investigate every row*; history of past investigations.

## Review log

- **Plan review, round 1** —
  [260930a-citations-investigate-plan-review-sol.md](260930a-citations-investigate-plan-review-sol.md),
  verdict *rethink* the streaming/verification design, not the feature. All of P-1…P-8 adopted, and
  the design above is the result. The choice between **A** (stream quote-free prose; verified
  quotes stay with *Look it up*) and **B** (a buffered, structured answer with source-bound verified
  quotes, not streamed) was arbitrated by Opus: **A**. B rebuilds 5G's structured check inside a
  slower, unstreamed call and duplicates *Look it up*; what Greg asked for beyond 5G — how else it
  relates, and for you — is interpretive, and paraphrase that names its source serves it. With no
  quotes streamed, the house streaming rule and 5G's rule stop pulling against each other. Opus also
  ruled: extract a runner rather than add a seam (P-5); one hash over everything, profile included
  (P-4); fold the probe into stage 1 as its gate (P-6).
