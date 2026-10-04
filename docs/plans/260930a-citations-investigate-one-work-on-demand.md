# Citations: an *Investigate* button that looks into one cited work, on demand

Status: **shipped to `dev` 2026-09-30, not deployed.** Planned and settled after two plan-review rounds; built in three stages, each reviewed by GPT Sol; the quote guard settled after three narrow checks (§ Review log). Feedback report SPIDERYARN-READING2-5Q (`spya-wtm6qx`),
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

### No quotes from sources, checked inside the stream (settled after round 2)

The first version checked quotes after the stream ended; the second refused a finished answer that
had quoted a source. Both let the reader see unchecked quote-shaped text first (Sol P-1, Q-1, P0).
The settled design moves the guard **into the stream**, so it holds text back before it is sent:

- **The prompt allows quotation marks only around this article's own words** (and the work's title),
  and no block quotes. Everything from a source is paraphrased and attributed.
- **The server holds back** any text from an opening `"`, `“` or `‘` (U+2018) to its close, and
  any line beginning `>` to its end. A held span is sent only once code has found it (`findQuote`,
  normalised) in one of the **allowed texts**: the article's blocks, the work's title and reference
  entry as supplied, and — only when the Look it up match below applies — Look it up's two stored,
  code-verified quotes. Short spans are held and checked too; a one-word article term passes.
- **A span that is not found, or that is still open after 400 characters or at the end of the
  stream, stops the answer there**: the span is never sent, nothing is stored, and the client
  **replaces the whole streamed answer** with *"This answer tried to quote a source directly, which
  we can't check, so it was stopped and not kept."* and *Investigate again*. A disconnect can only
  lose text, never show unchecked text.
- Straight single quotes (apostrophes) are left to the prompt. Verbatim prose without quotation marks
  is not guarded; it carries no attribution, and the provenance says the AI *was instructed not to
  quote*, not that it did not.
- Verbatim evidence stays with 5G's *Look it up*. When a current lookup exists, the view shows its
  verdict and quote beside the investigation with its own provenance line; when none does, the view
  offers *Look it up* (a separate charge).
- The probe counts stops by cause; if a cause is common, fix the prompt, not the guard.

### Which result is the work (Sol Q-3, settled)

Investigate does not run its own identity check: that needs a structured URL pick, which breaks
streamed prose. Instead:

- If the row has a **current Look it up that identified a page** (5G's two-gate rule passed), that
  page's URL, title and two verified quotes go into the prompt as *the result we matched to this
  work*. The provenance says *one result (host) was matched to the work by Look it up* **only if
  code finds that URL (normalised) among this answer's own non-empty-extract results**; otherwise the
  line would credit a page this answer never read.
- Otherwise the provenance says *we could not confirm that any result is this work itself*, and the
  prompt says: describe a result as this work only when its title, authors and year match those
  given; otherwise say the work itself was not found and describe only what the results that
  mention it say.

*Sol still objects to Q-3's residual* (without a code-checked identity, the prose may describe a
look-alike as the work). **Overruled**, on Opus's arbitration: the provenance line then declares the
gap in plain words, so the claim is no stronger than what we know. The fuller fix — offer
Investigate only once Look it up has identified the work — is a product call left open for Greg.

### What was read, said by code, not by the model (5G's rule)

Under the answer, from what the call returned (Sol Q-2):

> *Web search returned extracts for N results (arxiv.org, nature.com, …), the longest about W
> words. We did not fetch any page ourselves; an extract may be an abstract or part of a paper's
> text. The AI was asked to base what it says about the work on those extracts, and used this
> article [and your profile and purpose] to relate them. It was instructed not to quote them.*
> (Wording changed after the probe found one extract was most of a PDF — § The probe.)
> plus one of the two identity lines above.

- **At least one non-empty extract is required to store.** An answer with none is refused.
- The sources listed, N and the hosts are exactly the results with a non-empty extract.
- Search pinned to Exa with a small `max_total_results`; the per-result configuration is set by the
  probe and written here.

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

**A failed *Investigate again* keeps the old answer** (Sol Q-4): the new run replaces nothing until
it is stored, so on a stop or error the client restores the previous stored answer with *The new
investigation was not kept; the previous one is still shown.*

## Stages

1. **Server.** Step 1 is a gate: a real streaming probe (a script, Exa pinned, a small result cap)
   on a few local citations — cost, searches, extract sizes, latency, quote-guard hits — recorded
   here, and the allowance numbers set from it. Then the runner extraction (explain snapshots first),
   the job, the prompt, the guard, the table, the store, the route, the allowance, attach-at-read,
   export, public stripping. Tests red-first. GPT Sol code review.
2. **Client.** The button, the streamed view, the stored view, the tip. Browser check in a
   subagent. GPT Sol code review.
3. **Docs and note.** citations.md, ai-gateway.md's job line, the feedback note.

## The probe (stage 1, step 1), 2026-09-30

Six real streamed calls on four local articles, Exa pinned, `max_total_results: 8`,
`max_results: 5`, the draft prompt. Full table and answers:
[260930a-probe-results.md](260930a-probe-results.md); the script is
`scripts/probes/260930a-investigate-probe.ts`. **$0.72 in all.** (Both probe files were deleted on 2026-10-04 (plan 261004b § A5); read them with `git show 9b611dfe2:scripts/probes/260930a-investigate-probe.ts` and `…-prompt.ts`)

- **$0.120 a press on average, $0.153 worst** (a ~49k-token article). The model reads the article
  twice per press (before and after its search), so cost scales with length: budget $0.30 for the
  longest. First token 6.4 s, whole answer 13.7 s. 1–2 searches a call; every call ended `stop`.
- **Exa and the cap honoured**; annotation `content` is present and non-empty on the streaming wire
  (31 of 31, 94–9,998 characters). `max_characters` is accepted (not in our docs; tested): set
  **`max_characters: 8000`** so the model's extract and ours (`MAX_EVIDENCE_EXCERPT`) agree.
- **An extract can be most of a paper.** One was ~10k characters of the whole PDF. So the provenance
  line must not say "we did not read the full paper". It says what was read and **how much**: *Web
  search returned extracts for N results (hosts), the longest about W words. We did not fetch any
  page ourselves; an extract may be an abstract or part of a paper's text.* The prompt forbids
  claiming the full text (2 of 6 answers did) and opening with "I".
- **Quote guard: 1 of 6 stopped, both causes false**: the work's own title in quotes (already
  allowed by the plan) and an article quote with a comma inside the closing mark. Trailing
  punctuation inside a span is stripped before matching.
- **The article cache did not hit between two presses on one article 30 s apart.** Not a blocker (the
  cost above is the uncached cost); a follow-up to compare with explain's `cacheReadTokens`.

**Allowance**, from a maximum acceptable loss of $20 a day and $0.30 worst case: **global fuse 60 a
day** ($18); **per reader 20 a day, 8 an hour, one at a time**.

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
- **Plan review, round 2** —
  [260930a-citations-investigate-plan-review-2-sol.md](260930a-citations-investigate-plan-review-2-sol.md),
  verdict *rethink*: P-3…P-8 closed; Q-1 (P0: the post-stream guard still showed unchecked
  quote-shaped text first), Q-2 (the provenance sentence claimed more than the wire shows), Q-3 (P1:
  nothing ties an extract to the work), Q-4 (a failed rerun). Settled by me after two rounds and
  checked by Opus, who accepted it with five changes, all adopted: cap held spans and fail an
  unclosed one; replace the whole streamed answer on a stop; let the work's title and reference
  count as allowed quotes; guard U+2018; claim Look it up's match only when its URL is among this
  answer's own extracts, and pass its verified quotes in. Q-1: moved the guard into the stream, which
  closes the P0 (nothing quote-shaped is sent before it is checked). Q-2 and Q-4 adopted. **Q-3
  partly overruled** — § Which result is the work.
- **Code review, stage 1** —
  [260930a-citations-investigate-code-review-sol.md](260930a-citations-investigate-code-review-sol.md),
  *approve with the fixes made*. Sol fixed, red-first, C-1 (P0: a plural possessive `dogs’ owners`
  inside a `‘…’` span let an unchecked continuation stream out; the guard now holds `s’ ` until the
  next character decides, replays what follows a close, and fails the irreducibly ambiguous case),
  C-2 (the fingerprint now covers the rendered article head: title, byline, site, URL), C-3 (Look it
  up's match — URL, title, verified quotes — is in the fingerprint), C-4 (the match compares scheme
  and port too). It accepted every declared deviation: the stop message's retry tail, "a current
  Look it up that identified a page" = assessed or unreadable with quotes only from assessed, a
  straight inch mark stopping an answer, a failed profile read over-invalidating. Gates re-run by me
  after its fixes: typecheck 0, 96 unit, 127 Postgres. **C-1's fix is the reviewer's own code and is
  checked narrowly in the stage-2 review.**
- **Code review, stage 2** —
  [260930a-citations-investigate-code-review-2-sol.md](260930a-citations-investigate-code-review-2-sol.md),
  *approve with the fixes made*: D-1 (C-1's fix refused legitimate prose such as `‘fitness’ is`;
  refixed without reopening the leak, tested at every split), D-2 (the tip said "not the paper
  itself"; now says an extract may be an abstract or part of a paper). Gates after: typecheck 0,
  114 unit. **D-1 is the guard's third version and the reviewer's own; checked narrowly below.**
- **Browser check** (Sonnet, Playwright, 390px and desktop; shots in `260930a-shots/`): streams
  progressively (first text ~6 s, whole ~13 s), kept across reload, visitor sees nothing, no quote
  marks in the answer. Two defects found and fixed after: **the AI said "This search turned up the
  work itself" above code's "We could not confirm that any result is this work itself"** — the
  prompt now leaves that claim to code; and **one tap on a phone both opened the tip and started the
  paid call** — the same was true of *Look it up*; both now reveal on the first tap and act on the
  second, the shelf's rule (touch.md). The check spent two presses (~$0.24).
- **Narrow re-checks of the quote guard**, the P0 fix outside every reviewed snapshot:
  [re-check 1](260930a-citations-investigate-guard-recheck-sol.md) found G-1 (P0: a `>` line after a
  bare `\r` leaked) and two false refusals. The curly-single state machine had now been patched
  three times, so it was **replaced** by one conservative rule (b6ec2f10): a paragraph with a `‘`
  is held to its end, each `‘` checked out to its farthest possible close, then replayed through the
  other rules. False refusals cost a retry; leaks are what the rule exists to prevent.
  [Re-check 2](260930a-citations-investigate-guard-recheck-2-sol.md) found the same class once more
  (P0: a no-break-space indent hid a `>`); `isBlank` now counts every Unicode space and the
  zero-width characters, red-first. Its G-2 (P3: a punctuation-only quote like `"!"` passes) is
  accepted: no words can leak through it. Settled with an Opus adversarial check of the last fix,
  below.
- **Full suite** (one run, on 423ef1b4): 1,223 files passed; 4 failed. Three are the fleet tests
  that need `npm run build:fleet` in a fresh worktree (known, not this work). The fourth,
  `env-reads-are-literal`, pinned "fourteen" model overrides; Investigate's job is the fifteenth.
  Updated.
- **Opus adversarial check of the guard** (the settlement the rule requires after the narrow
  re-checks): found the quotation marks of other languages unguarded (`«…»`, `„…“`, `「…」` and
  others; P1: a model writing about a French or German paper uses them) and the rest of the
  invisible-character class before a `>` (bidi marks, combining marks, fillers; P2). Both fixed
  red-first: a `PAIRS` table of openers and their closers, `isBlank` as the class (`\s`, `\p{Cf}`,
  `\p{Mn}`, `\p{Me}`, the fillers), full-width `＞`, and a delta ending on half a surrogate pair now
  waits for the rest. Mutations of the class and the surrogate hold each turn tests red. **Accepted
  and named in the guard's header:** backticks, `‛…’`, `‚…‘`, `″`, and `>` look-alikes such as `›` or
  `❯` — forms a reader is unlikely to take as a quotation and the model unlikely to write. Discovery
  on the guard is closed.
