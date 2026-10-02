# Quick search: a meaning search in about a second, on Jev

Up: [search.md](../project/search.md) · feedback report `spya-c77zuq` · spike:
[261002o-quick-search-spike.md](../investigations/261002o-quick-search-spike.md)

## What Greg asked for

> I really love the idea of our kind of search that can search by concepts or ideas or questions,
> but it's quite slow. And so I was wondering about using TypeSafe.ai's Jev model through OpenRouter
> to at least provide a quick version of it, even if it's not as powerful.
>
> So right now the search mode provides a whole bunch of metadata like confidence and maybe even some
> text as well. If all I wanted was a [score] for each block for the degree to which it matches or
> something like that, I think Jev could do that and very quickly, at least up to 255 blocks.
>
> And maybe we could do it. We could call it multiple times for really long texts. […] I'm torn
> between trying to create a new mode or add a quick search bar versus adding it as a sort of toggle
> in the existing mode.
>
> And maybe the quick search bar would have a way to sort of save it, which would add it to the
> existing mode or it would automatically be saved. But then there'd be a way to say flesh this out
> with all the extra metadata. I'm not sure. So I guess why don't we just try and get the first
> version of it live and we can iterate on it afterwards.
>
> So try and get a V1 working that's fun to play with without too much complexity, assuming that
> we'll evolve the UI from there.
>
> — Greg, 2026-10-01 (dictated; "gore" corrected to "score")

"TypeSafe.ai's Jev" is not a mis-transcription: Jev is TypeSafe's "System One" decision model, on
OpenRouter as `typesafe/jev-1.13`, served only on `POST /api/alpha/decisions`. It returns typed
probabilities, not text — a yes/no (`noul`), a pick among ≤255 options (`choice`, the "255" Greg
remembered), or a position on a 2–10 level scale. $0.042 per million input tokens, output free,
32k-token context. The repo already calls it once, from the shelf-topics eval, through a declared
bypass (`shelf-topics-jev` in [`src/spend-declarations.ts`](../../src/spend-declarations.ts)).

## The decision: a third arm of the toggle, saved like a meaning search

```
  ( words )  ( ⚡quick )  ( ✦meaning )        ← one box, three ways of matching
  ───────────────────────────────────
  ☑ ▌ arguments against the main claim   quick · flesh out   ✕
  ☑ ▌ statistical evidence                                    ✕
```

- **quick** sits between the two existing matchers. Type, press Enter (or *find*): every text block
  of the article is scored by Jev for how well it matches, and the blocks above a floor come back as
  hits — whole paragraphs, with the score printed as the confidence. About a second.
- **It is saved automatically**, into the same list as meaning searches, with the same colours,
  ticks, spine lane and *Prioritised* bar. A quick row says **quick** beside it.
- **flesh out** on a quick row runs today's full meaning search with the same words — quotes,
  reasoning, the lot — as a new row, and unticks the quick one so the two do not paint over each
  other. The quick row stays in the list for comparison until the reader deletes it.

Why this over the alternatives Greg named:

- **A new mode** would duplicate the box, the list, the marks, the colours, the rail lane and the
  URL state — search.md's whole design is "one box, one list; a third way of matching is a third arm
  of one ternary". It would be two places to look for one thing.
- **A separate quick search bar** (e.g. always visible over the prose) is the more ambitious UI and
  may be where this ends up, but it needs a home in the layout and its own save/discard story. The
  toggle gets the speed in front of Greg today and keeps every option open.
- **Not saving quick runs** would make them the toy search.md § Saving warns about, and would make
  *flesh out* need its own state. Saving costs nothing new: a quick run is a `SearchRun`.

## How it works

```
  SearchPanel  ── matcher=quick ──►  useSearch.ask(criterion, "quick")
                                         │ POST /api/search/<slug> { id, criterion, kind: "quick" }
                                         ▼
  routes.ts § search ── kind? ──► quick-search.ts: quickPassagesStream   (Jev, one or more requests)
                     └──────────► search.ts:       findPassagesStream    (unchanged)
                                         │ the same events: hit… then done{hits, model}
                                         ▼
                         searchStore.finish(…)   search_runs.kind = 'quick' | 'meaning'
```

- **One new gateway seam**, `openRouterDecisions` in [`src/ai-call.ts`](../../src/ai-call.ts),
  modelled line for line on `openRouterTranscription`: its own job type (`DecisionJob =
  "search-quick"`), a row in `AI_JOB_ROUTE` on the `"decisions"` wire (already in `Wire`), the
  `/alpha/decisions` path, a `Meter`, usage mapped from `input_tokens`/`output_tokens`/`cost`. So
  every quick search lands in `ai_calls` attributed to the article like any other call
  ([cost-tracking.md](../project/cost-tracking.md)). The shelf-topics eval's bypass stays as it is.
- **[`src/quick-search.ts`](../../src/quick-search.ts)** builds the requests, splits a long article
  into chunks under the context and question limits, runs the chunks in parallel, and turns
  probabilities into `SearchHit`s: `quote` = the block's whole text (so `findQuote` places it and
  the wash covers the paragraph), `confidence` = round(p × 100), `reasoning` = "", `start` = 0.
  Hits below the floor are dropped; the rest are sorted best first and capped at `MAX_HITS`.
  The request shape, floor and chunk sizes are the spike's — see § Spike results.
- **`search_runs.kind`**, a new text column, `'meaning'` by default, `'quick'` for these. Stated on
  the row rather than inferred from `model`, because a pending row has no model yet and the panel
  has to label it, and because "infer it from a field that usually agrees" is the
  [silent-success](../reusable/silent-success.md) shape. An additive migration.
- **Client**: `MATCHERS` gains `"quick"` (`?match=quick`); the box asks with the matcher's kind;
  `retry` resends a run with its own kind; the saved list shows in both quick and meaning; a quick
  row gets its tag and a *flesh out* button.
- **Which blocks** are scored: `isSearchable` ([`src/block-policy.ts`](../../src/block-policy.ts)),
  the predicate that already decides whether a search hit may be shown, plus a local filter that
  drops headings, which the spike found Jev rates highly for any query about the title (0.90).
  It keeps notes and references,
  deliberately, because that predicate's policy is Greg's: a note is part of what a reader searches.

## Stages

1. **Spike** (done, see the investigation): request shape, latency, cost, quality against today's
   search on real articles, chunking.
2. **Server**: the gateway seam, `quick-search.ts`, the `kind` column and migration, the route
   branch. Tests first: the hit conversion, the chunking, the floor, the route's kind validation,
   the ledger row on the decisions wire, `tests/ai-call.test.ts`'s wire table.
3. **Client**: the third toggle arm, the tag, *flesh out*, retry by kind; then a browser check in
   a Sonnet subagent.
4. **Docs**: search.md (a section, the table of matchers, the pieces diagram), url-state.md for
   `?match=quick`, ai-gateway.md for the sixth wire in the product, `/help`, and the feedback note.

## Spike results

Full write-up: [261002o-quick-search-spike.md](../investigations/261002o-quick-search-spike.md).

- **Shape:** one request, `state = {query, passages: {<blockId>: text}}`, one `noul` question per
  block (`"Does passage <id> match what the reader is looking for (query)?"`). The state is billed
  **once**, not per question (1, 10, 40 questions on one state: 4,339 / 4,573 / 5,343 tokens). No
  question cap seen up to 600; the limit is the 32k-token context, which answers 400
  `max_tokens_exceeded`.
- **Speed:** median 0.4 s, p90 0.5 s for an 84–123-block article; 0.64 s median for a 542-block one
  in four parallel chunks. Today's search measured 5–16 s on the same articles.
- **Cost:** about $0.0004 a search, $0.003 for the long article — roughly a hundredth of today's.
- **Quality:** 66–72% of today's hits are in Jev's top k, and on a question-shaped query whose
  overlap was only 0.20 every one of Jev's top 8 was a genuine answer today's search had not chosen.
  Its real failure: *about* versus *against* ("things Claude should never do" scored the passage on
  being over-cautious nearly as high as the hard limits).
- **Floor 0.7 (was 0.8 — see F7 below), cap 20, best first.** There is no natural break: the top ten bunch at 0.85–0.94 and
  0.5 lets in 34–255 blocks. Scores wobble by up to 0.17 between identical requests, so the order of
  close hits is not stable — another reason the row says *quick*.
- **Ruled out:** one `choice` over block ids (ranks only the top few), a four-level `score` (no
  better, 1.5× the cost), one request per block (slower and worse), a "meaning, not words" sentence
  (no measurable gain, +45% input), and the other decision models (`liquid/d1` and
  `upstage/solar-decide` bill the state per question; `mercury-decide:free` is refused by our
  account's data policy).
- **Chunking:** split at ~26k estimated tokens (characters ÷ 3.2 plus ~30 per question); on a
  `max_tokens_exceeded` 400, halve that chunk and retry it, once per level.

**What the confidence number means here.** It is Jev's probability of *yes*, ×100, so a quick
search's 88 and a meaning search's 88 are different numbers. The row's *quick* tag and its title
say so; the number is still printed, because search.md's rule — a mark's strength is printed as well
as drawn — is about not hiding uncertainty, and hiding it here would hide the one thing a quick
result has to offer beyond its position.

## What this does not do (yet)

- No search-as-you-type, even though a second is fast enough to make it tempting: every keystroke
  pause would be a saved row and a call. A natural v2.
- No quote inside the paragraph: Jev scores blocks, so a quick hit washes the whole paragraph.
- No reasoning line. That is what *flesh out* is for.

## Plan review (GPT Sol, 2026-10-02) and what changed

[261002e-quick-search-v1-plan-review-sol.md](261002e-quick-search-v1-plan-review-sol.md) — *proceed
with changes*. All nine findings accepted:

- **F1 (P1)** `isSearchable` does not drop headings — ordinary headings are gistable. Quick search
  additionally drops `kind === "heading"` locally; the shared predicate is untouched.
- **F2** a whole-block quote bypasses the snippet budgets (a 6,499-character hover). Quick hits keep
  the whole-paragraph wash but get a bounded preview.
- **F3** the gateway classifies the provider's overflow 400 as `context-exceeded` without exposing
  provider text, so the halving retry is possible.
- **F4** every question must come back answered, `noul` in [0,1], or the run fails — never a
  silent empty success; one deadline over all chunks and retries.
- **F5** `kind` is part of retry identity (`withRun` and its SQL); in-flight duplicate suppression
  is per kind + criterion, so the box can start meaning while quick is pending;
  *flesh out* itself appears only on a finished quick row.
- **F6** `kind` is carried through export, the public reader and its DTO, and the seed helper.
  Visitors see the quick tag and hits, never *flesh out*.
- **F7** the 0.8 floor was measured on the arm with the sentence we dropped. Re-measured on the
  final arm (plain wording, headings dropped, 16 queries × 3 runs): recall of today's hits is 0.73
  at 0.7 and 0.52 at 0.8, and what lies between is nearly all genuine. **The floor is 0.7**; the cap
  of 20 does real work on queries about the whole article (34–59 blocks clear 0.7).
- **F8** Jev is a fixed-model, non-tier job like dictation; the privacy page names it.
- **F9** the quick label reaches each result's score explanation, not only the saved row.
