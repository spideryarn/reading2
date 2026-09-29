# Citations: say whether we saw the cited paper, and quote it when we did

Status: **re-scoped 2026-09-29 on Greg's clarification; stages 1–3 built; waiting on a push credential.** Feedback report
SPIDERYARN-READING2-5G (`spya-emvua7`), Greg, dictated:

> Okay, so when in citations mode, like the questions that we might want to ask, what were they? You
> said something like, how well does it support what it's being footnoted to support? Yep. And
> generally, what were they doing in that paper? Yeah, okay. So you might need a web research to
> actually read the paper itself, ideally. And if you can't do that, then you should be really clear
> that you couldn't. But if you can, then you should ideally, you know, in the tool tip or whatever,
> include quotes or something that suggests that whether the paper does say what the cited paper
> says what this paper says. be really careful to be clear about whether you could get the actual
> paper, so that we can be sure you're not hallucinating

And his clarification, relayed by the Overseer the same afternoon:

> re 5G I was specifically thinking about Citations mode. I was basically thinking of ways to tweak
> that prompt/UI

The Overseer's reading of it, which this plan follows: *a tweak to the existing Citations mode's
prompt and UI, not a new on-demand pipeline. Use whatever retrieval Citations already has. If doing it
well genuinely needs new fetching machinery, write that up as a proposed later stage and ask.*

## What changed, and what was undone

The first version of this plan (in git history at `48c10568`) built a new **Check the paper** pipeline: fetch the paper, read
its full text, a new model job, a new table, a new route. Stage 2 of it was half built when the
clarification arrived; it was **stopped and taken out of the tree** (never migrated, never
committed) and is now § Proposed later stage below.

Two pieces had already landed and stay, because a second session (fb5h, canonical link for uploaded
papers) uses both:

- `findWorkPage` in src/citation-find.ts (459d3c54) — *Find it*'s search core, pulled out;
  behaviour unchanged.
- `readPaperText` in src/paper-text.ts (aed24b71) — a paper's text from its address. Nothing in
  Citations calls it yet.

## What Citations already retrieves

- **The list** is one model call over the article. It never sees a cited paper. Each row's `why`
  (*what this piece uses it for*) is written from the article.
- **Find it** (per row, owner-only, billed) makes one Exa web search for the work. The model picks a
  result and code keeps it only if it is a real result that names the work. Every result arrives
  with the **search engine's own extract of the page**, up to 8,000 characters
  (`MAX_EVIDENCE_EXCERPT`, src/openrouter-stream.ts). For a paper's page that extract is typically
  its abstract, often more. Today it is used only to check the title, then thrown away.

So the only text of a cited paper that Citations ever holds is that extract. Debate mode already
checks model quotes against these extracts
([260905f § Attribution](260905f-debate-mode-what-the-web-says-about-this-piece.md)), so that
check is not new either.

## The tweak

### 1. Every row says what we have, plainly (UI only, no model)

A row and its hover card say which of these is true:

- **Not looked at.** *We have not read this paper. The line above is what the article uses it for,
  taken from the article.* This is the default for every row, which today says nothing on the point.
- **Looked at, from its search extract** — after a lookup (below). *Checked against the search
  result's extract of the paper (about 310 words, from arxiv.org), not the full paper.*
- **Looked up, but no page was clearly this paper.** *We could not find the paper, so nothing here
  comes from it.*

`why` is relabelled so it reads as the article's claim, not the paper's content.

### 2. The lookup also reads the extract (a tweak to Find it's one call)

In the **same single call**, when the model names the work's own page, it also answers from that
result's extract:

```json
{"url": "...",
 "paperDoes": "one sentence: what the paper does", "paperDoesQuote": "verbatim from the extract",
 "support": "supports | partly | not-in-extract",
 "supportQuote": "verbatim from the extract, or null"}
```

The prompt gains the article's side: the row's `why`, and the citing passage (the first mention's
paragraph, capped).

**Everything shown is checked by code, and the check is the safety property:**

- Quotes are verified against **that result's extract**, `findQuote(excerpt, q, undefined, "spaced")`,
  the strict pass Quotes mode uses (Sol plan review P-3). What is stored and shown is the extract's
  slice, not the model's spelling. A quote must be at least 6 words long.
- `supports` or `partly` needs a verified `supportQuote`. Without one it becomes `not-in-extract`.
- `paperDoes` is shown only with a verified `paperDoesQuote`. Otherwise it is dropped.
- `not-in-extract` is always worded as limited to the extract: *"the extract we saw doesn't show
  this; the full paper may"*. There is no "does not support" (Sol P-1).
- The judgement is kept only if the **result's own title** names the work (`namesTitle`), not merely
  its extract. A page that cites the paper carries the paper's title in its text too (Sol P-2).
- The judgement is labelled as the AI's reading. The quotes are labelled *from the paper's search
  extract*.
- It is stored with a hash of the `why` and citing passage it was judged against. If the list is
  made again and those change, the judgement is not shown; the link stays (Sol P-8).

### 3. The lookup is offered on every row, not only unlinked ones

Today *Find it* shows only on rows with no link, and a row whose article gave a DOI or arXiv link
has no way to be looked at. The button becomes **Look it up** on every row. On a row the article
already linked, the page found is used **only** for its extract and never replaces the article's
link: the rule that *a link the article gave always wins* stays. Its tooltip says it costs money and
what it will and won't tell you. Same rate bucket, same limits.

## Storage

Additive columns on `citation_finds`: the judgement (verdict, reason-free), the two verified quotes,
the extract's word count and the input hash. A lookup that found no page stores nothing, as today.
On a linked row the stored `url` is the page whose extract was read, and it is never drawn as the
row's link (`attachFinds` upgrades only `search` rows, as now). Private; already in export.

**Which retrieval, stated in the row**, from what is stored: not looked up / looked up from a search
extract of N words at host.

## After the second plan review — what changes (settled, round two)

[260929g-citations-say-what-we-saw-plan-review-sol.md](260929g-citations-say-what-we-saw-plan-review-sol.md),
*build with changes*. All eight findings are adopted; this section overrides anything above it.

- **R-8: stage 1 is UI-only.** The provenance line and the relabelled `why` are most of the trust
  value, and need no schema or prompt change. They ship first and stand on their own.
- **R-1 (P0): a title-matching result is not the paper.** The wording never says *from the paper*.
  Quotes are *from the search extract of <host>*, the verdict is *the AI's reading of that extract*,
  and the provenance line says *we have not read the paper itself*. Identity is also tightened
  before a judgement is kept:
  - a row the article linked by DOI or arXiv id keeps a judgement only if the result URL carries
    that same id;
  - any other row needs a strict title match (the normalised work title contained whole in the
    result's title) plus the first author's surname or the year in the result's title or extract,
    where the list has them.
  `namesTitle` stays what it is: *Find it*'s looser rule for choosing a link.
- **R-2: the states are a discriminated union**, drawn from what is stored:
  - never looked up;
  - a result was kept but it had no extract;
  - an extract was assessed.

  *No matching result* is a transient notice after a press, as today, and the row does not promise
  to remember it. A missing extract is never shown as *not in extract*.
- **R-3: a separate private `lookup` field** attached to every owner row. Link selection stays
  independent: a `search` row may still be upgraded to the found URL, and a linked row's `url` and
  `linkFrom` never change. The POST response returns the lookup separately from the link. Tests
  cover a linked row, a late reply after the list was made again, and the found URL never becoming
  a linked row's link.
- **R-4: two hashes.** A context fingerprint over the exact capped strings sent (title, authors,
  year, reference entry, `why`, citing passage), plus the prompt version and model; a lookup
  attaches only when that fingerprint matches the current list. An evidence hash over the chosen
  result's URL, title and excerpt, kept for provenance.
- **R-5: a strict parse** — clean finish, an exact verdict enum, `paperDoes` only with its quote,
  maximum lengths on prose and quotes. An adversarial extract fixture. Debate's residual-injection
  wording is carried into the doc.
- **R-6:** both export projections (export.ts enumerates fields by hand) and a public-boundary test.
- **R-7: caps** — citing passage ≤ 1,200 characters, prose ≤ 240, quotes ≤ 400 — and the answer
  ceiling raised to fit them. Before and after, the old and new prompts are run on the same
  citations: URL agreement, searches, tokens, latency and cost are recorded here.

## Stages

1. **Provenance, UI only.** Relabel `why` as what the article uses the work for. Every row and every
   hover card says *we have not read this paper*. After *Find it*, say only that a web page matching
   its title was found. No schema change, no prompt change. Browser check.
2. **The extract assessment**, as amended above. Tests red-first. GPT Sol code review.
3. **Real runs, docs, and the feedback note.** The A/B on real citations, citations.md, the note.

## Real runs (stage 3), 2026-09-29

14 works cited by three local articles (5 DOI rows, 4 arXiv rows, 5 unlinked), each sent to the old
*Find it* request (A) and the new *Look it up* request (B) through the real `openRouterJson`
(`anthropic/claude-sonnet-5`), and judged by the real `readFind` and `judgeLookup`. No ledger rows
and no database writes. **Total cost $0.73 for 28 calls.**

| | A (Find it) | B (Look it up) |
|---|---|---|
| searches per call | 1.0 | 1.0 |
| prompt / completion tokens | 7,167 / 123 | 9,798 / 401 |
| latency | 6.2 s | 8.1 s |
| cost per press | $0.023 | $0.029 (+27%) |

- **URL pick:** the same URL on 10 of 14 works. The other 4 were a different page of the same work.
  `readFind` kept or refused identically on both arms. No regression.
- **B's states:**
  - 5 assessed: 3 supports, 1 partly, 1 not-in-extract;
  - 5 not-identified;
  - 1 unreadable;
  - 2 with no find in either arm.
- **Quotes:** 9 offered, 8 kept. The one dropped was a Kaplan sentence the model wrote from memory,
  not present in the 803-character extract. Code dropped it and downgraded *partly* to
  not-in-extract, which is the property working.
- **Honesty read of the assessed rows:** no *supports* looked wrong. The nearest to misleading was
  *1000 spider silkomes*. It supports `why` (it is the database the article uses), but its quote
  does not show the specific figure in the citing paragraph. The verdict is worded against *what the
  article uses it for*, which is `why`, so it is accurate as labelled.

**Three rules refused correct results, fixed after the run:**

1. **DOI rows (4 of 5 not-identified).** Publisher URLs omit the DOI. Now a DOI row also accepts
   the DOI in the extract, provided the title rule passes too.
2. **Truncated titles.** Exa ends long titles with "…". A truncated title now matches as a long
   enough prefix run.
3. **One quote over its cap discarded the whole reading.** Now only that field is dropped.

Unchanged: a row titled only "Thompson et al 2020" can never be found by title. That is *Find
it*'s existing rule, and out of scope here.

## Proposed later stage: read the paper itself (not built; a question for Greg)

A search extract is usually the abstract. That answers *what were they doing in that paper* well,
but *does it support what it's cited for* only when the abstract happens to say so. Doing that
properly means reading the paper. The design is written and reviewed (the earlier version of this
plan, commit above, and its Sol review
[260929g-check-a-cited-paper-plan-review-sol.md](260929g-check-a-cited-paper-plan-review-sol.md)):

- `readPaperText` fetches the PDF or page (already built);
- an identity ladder (DOI, arXiv id, then title and author on the first page);
- chosen chunks of the text sent to a model;
- passages verified against exactly what was sent;
- a `citation_checks` table with an input fingerprint;
- concurrency 1 per owner.

It costs perhaps 5–10¢ a check, and needs new moving parts: a model job, a table, a route. The
half-built code was never committed; this section and the Sol review are what survive of it.

## Assumptions (product calls taken the simple way)

- The judgement rides on the existing per-row lookup. Nothing runs for every row automatically.
- The lookup is offered on linked rows too (§ 3).
- Three verdicts, none of them a categorical "does not support".
- Owner-only, like *Find it* today.

## Review log

- Plan review of the first version:
  [260929g-check-a-cited-paper-plan-review-sol.md](260929g-check-a-cited-paper-plan-review-sol.md).
  P-1, P-2, P-3 and P-8 carry over into § 2 above. The rest were about the fetching pipeline and
  belong to the proposed later stage.
