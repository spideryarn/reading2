# Citations: an *Investigate* button that looks into one cited work, on demand

Status: **planned 2026-09-30, not built.** Feedback report SPIDERYARN-READING2-5Q (`spya-wtm6qx`),
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

## What Investigate is

A button on each owner row, **Investigate**, beside *Look it up*. One press = one streamed answer
about that one work, written with up to several web searches, and kept. Nothing runs for every row.

The answer is short plain prose in three parts, each opening with a plain lead so it scans:

1. **Does it back the claim?** — against *what the article uses it for* and the citing passages:
   what the sources show about whether the work says that, with short quotes from them.
2. **How else it bears on this article** — what the work actually does, and where it agrees with,
   extends, or sits awkwardly with the article beyond the one claim.
3. **For you** — only when the reader has written a profile or *why you're reading this one*: one
   short paragraph on why this work matters (or doesn't) for that. Omitted otherwise.

### What was read, said by code, not by the model (5G's rule)

Under the answer, one line that code writes from what the call actually returned:

- *Read: search extracts of N web pages (arxiv.org, nature.com, …) — not the full text of the work
  or of any page.* This is always true: the web-search tool returns the search engine's extracts,
  and nothing in this call fetches a page.
- Whether **one of those pages matches the work itself**, by 5G's strict identity rule
  (src/citation-lookup.ts, the rule *Look it up* uses before it judges anything): *one of them is a
  page matching the work (arxiv.org)*, or *none of them was clearly the work's own page, so what is
  said about the work comes from other pages about it.*
- **Quotes checked.** The prompt asks for anything quoted from a source to be in double quotes.
  After the answer ends, code looks for each quoted run of at least six words in the extracts the
  call returned (`findQuote`, the strict `"spaced"` pass 5G uses). The line says *N quotes found in
  what was read*, and names any that were **not**: *"…" — not found in anything we read; treat it
  as unverified.* The streamed text itself is not rewritten.
- The sources are listed as links (host + title), filtered by `safeUrl` as the glossary's are.

The answer is labelled *the AI's reading of those pages*, never as a fact about the work.

### Inputs to the call

- the whole article, as the cached first part (the same prefix `explainStream` builds);
- the work: title, authors, year, the reference entry as the article gives it, and the article's
  own link when `linkFrom` is not a search (so the search can aim at it);
- `why` (*what the article uses it for*) and the citing passages (the first-mention paragraph and up
  to two more, each capped);
- the reader's profile and purpose through `resolveProfile(slug)` → `profileSection`, in the second
  part (never the cached one), as explain does.

All capped in characters. Text from search results is a stranger's page reaching a model, exactly
as in explain and the glossary lookup today: same tool, no other tools, and the answer is labelled
as a reading.

### Mechanism: `explainStream`, generalised, not a copy

`explainStream` is ~400 lines of invariants (the deadline and stall clocks, `classifyEnd`, empty
answers, search-count provenance). A second copy would drift. So it gains, narrowly:

- a **prompt seam**: the system prompt and the final user part are supplied by the caller (default:
  explain's own, byte-identical, so comments and the glossary are untouched);
- a **job name** for the AI gateway, so the spend is attributed to a new job
  `citation-investigate` (models.ts registry, `AI_JOB_ROUTE` in src/ai-call.ts,
  ai-gateway.md), same model family as explain;
- **opt-in evidence**: when asked, it also collects `collectSearchEvidence` (URL, title, extract)
  and returns it on `done`, so the caller can run the identity and quote checks. Not stored in full.

The web-search tool definition stays byte-identical (`MAX_SEARCHES`, `max_results: 5`). Investigate
has its own system prompt, so its cached prefix is separate from explain's anyway; one tool shape
keeps the reasoning in explain.ts's comment true.

The exact seam (a `prompt` object vs a messages builder) is the implementer's call, checked by the
code review; the constraint is that explain's request is byte-identical for existing callers, and a
test says so.

### The route, the store, the limits

- `POST /api/citations/:slug/:id/investigate`, SSE out, the glossary lookup's shape
  (`streamTermLookup`): refusals (404 no such work, 409 no list) as JSON before the headers, then
  `delta`… and one `done` (the stored investigation) or `error`. **`done` only after it is stored.**
  `gone` is *not* passed to the model — like the glossary lookup, closing the band does not throw
  away a paid answer; it is there next time.
- Nothing is read off the body: the work is found server-side by id.
- **Own allowance bucket** `citation-investigate` on `fetchAllowanceStore` — one at a time, 10 an
  hour, 30 a day, a global daily fuse — taken after the free refusals. A new bucket on the existing
  limiter; no existing defence is edited.
- A new table `citation_investigations`, `glossary_lookups`' shape: `(article_id, entry_id)` key,
  owner id, `answer`, `sources` (jsonb `Citation[]`, safeUrl-filtered), `pages_read`,
  `work_page_host` (null when none matched), `quotes_checked`, `quotes_missing` (jsonb string[]),
  `searches`, `model`, `context_hash`, `at`. One row per work, overwritten by a second press. Private.
  Additive migration.
- **Staleness:** `context_hash` over the work's title, authors, year, reference, `why` and citing
  passages as sent, plus the prompt version. Attached at read time only while it matches (5G's R-4);
  a remade list with a changed `why` hides it and the button reads *Investigate* again. The profile
  is not in the hash: a reader editing their box does not make an investigation of the paper wrong.
- **Never reaches a visitor** (the list's private fields are stripped for the public payload, as
  `lookup` is), and **in export** — both projections in src/store/export.ts, which enumerates by
  hand (5G's R-6).
- The answer is kept only on a clean finish; truncated/filtered/abandoned endings are refused, as
  the glossary's `refuseUnfinished` does.

### UI

On an owner row: **Investigate** (a `ControlTip`: what it does, that it costs money, that it reads
search extracts of web pages and not the paper itself, that the answer is kept). While running, the
answer streams into the row under the provenance line. When done: the answer, the *what was read*
line, the quote check, the sources, and *Investigated <date> · Investigate again*. A stored
investigation is collapsed to its first lead line with a toggle, so the list stays a list.

Not on the hover card (5G's reasoning: a billed action on a hover surface is the wrong place).

## Stages

1. **Server.** The `explainStream` seam (existing callers byte-identical, tested), the
   `citation-investigate` job, the prompt, the identity and quote checks, the table + migration, the
   store, the route, the allowance, attach-at-read with staleness, export, public stripping. Tests
   red-first: a stale hash hides it; a quote not in the extracts is reported missing; the identity
   line; `done` only after save; a visitor never sees it; explain's request unchanged. GPT Sol code
   review.
2. **Client.** The button, the streamed view, the stored view, the tip. Browser check in a
   subagent. GPT Sol code review.
3. **Real runs, docs, note.** A few real investigations on local articles through the real gateway
   (cost, searches, latency, how often a work page is matched, how many quotes check out), recorded
   here; citations.md; the feedback note.

## Assumptions (product calls taken the simple way)

- Owner-only and behind the experimental switch, like *Look it up*.
- Kept, one per work; a second press replaces it. No history.
- Plain prose with three leads, not a structured JSON form: Greg asked for *extra information*, and
  prose streams.
- The quote check reports, it does not rewrite: the reader watched the text arrive.

## Deferred, named

- **Reading the paper itself** — 5G's proposed later stage (fetch the PDF with the existing
  `readPaperText`, an identity ladder, passages verified against what was sent). Investigate is
  built so it could feed on that later: the *what was read* line would gain *the full text from …*.
  Still a question for Greg, as 5G left it.
- Investigate from the hover card; *investigate every row*; history of past investigations; marking
  unverified quotes inline in the prose.

## Review log

(to be filled)
