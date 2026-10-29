# Ideas off the import, and Quiz in the margin

Two of Greg's reports, filed 2026-10-29 while reading *Consciousness in Artificial Intelligence*
(`arxiv-2308-08708-spya-xax6v4`) in production with the margin open:

> I don't think the ideas mode is that helpful, and from memory, I think it's quite expensive. I'm
> not sure if that's true, but if it is, I'd be inclined to say that we shouldn't run it by default.
>
> — Greg, 2026-10-29 (`spya-shwpw5`)

> I think probably one of the most useful things that we could do is sort of active learning, or at
> the very least test-driven learning. And so let's say the quiz mode does run as one of the
> default modes whenever you open marginalia mode, for example, because I think we include the quiz
> questions in the marginalia annotations. If not, we should, to really encourage the user to
> reflect on what they're reading. […] And if you have ideas for other ways in which we could be
> encouraging active learning, let's discuss those separately.
>
> — Greg, 2026-10-29 (`spya-fytjtf`)

Notes: [261029_0035](../user-feedback/261029_0035-ideas-no-longer-made-on-import.md),
[261029_0037](../user-feedback/261029_0037-quiz-runs-with-the-margin-and-its-questions-sit-there.md).
The separate discussion is question [q-ejp09q](../user-feedback/questions/q-ejp09q.md).

## What the ledger says (production, read-only, 2026-10-29)

Per article, summing every call of the step on that article. 30 days unless stated.

| Step | Articles | Median | Mean | p90 |
|---|---|---|---|---|
| `simple` (Summary) | 43 | $0.28 | $0.36 | $0.59 |
| **`ideas`** | 37 | **$0.18** | **$0.19** | $0.33 |
| `bibliography` | 21 | $0.16 | $0.16 | $0.30 |
| `glossary` | 36 | $0.11 | $0.14 | $0.25 |
| `quotes` | 36 | $0.12 | $0.13 | $0.23 |
| `crossrefs` | 32 | $0.09 | $0.11 | $0.22 |
| `skim` | 32 | $0.04 | $0.05 | $0.08 |
| `relations` (margin) | 17 | $0.17 | $0.23 | $0.33 |
| **`quiz`** | 13 | **$0.17** | **$0.24** | $0.36 |

All-time Ideas: 55 articles since 2026-09-03, median $0.19, mean $0.21, $11.44 in all, one
Sonnet 5.5 call per article. On Greg's article it was $0.25. **So yes, it is expensive for what
it is**: the second-dearest step on the import after Summary, about a sixth of the roughly $1.14 an
import's modes cost on average. Quiz marking is about **$0.08 per answer** (5 marks, a small
sample) and the hidden verdict a hundredth of a cent; those are paid only when the reader answers.

The query is the one in this plan's § Measurement, run against `.env.prod` inside a read-only
transaction that was rolled back.

## Stage 1 — Ideas leaves the import

`AUTO_MODE_STEPS` loses `ideas`. Opening Ideas still writes it (its press is unchanged), so this is
"not by default", not "gone".

**The wrinkle is Skim.** Skim's route reads the Ideas, and its import job carries its reads
(`autoModeRequests`: `["quotes", "ideas", "skim"]`). Taking `ideas` off the list alone would
change nothing: Skim's job would still buy it on every import. So the job an import queues carries
only the reads that are themselves on the import's list: Skim's becomes `["quotes", "skim"]`, and
its route is planned without Ideas, which the step already supports (`ideas: null`, rendered as
"unavailable" and hashed, so Ideas made later mark the route stale). A stale route is not
re-planned by itself: the band shows its banner and *Plan it again*, about $0.05 (GPT Sol, F1 on
this plan; the first draft said the next open re-plans it).

**Author gifts too.** The same list prepares a gift (`enqueueMainModesIn`, shared by
`pg-main-modes.ts` and `pg-gift-prep.ts`), so a gift is prepared without Ideas and with a
Quotes-only Skim route. That follows from "not by default", and is said here so it is chosen
rather than inherited (Sol F2). Jobs queued before the deploy still carry `ideas`.

What that costs Skim, measured in 260928a § Stage 6: with Ideas the Gist pass covered 7 of 21 key
ideas against 5 without (that comparison also changed the prompt), More 13–14 against 9–13; the
stop card loses its *Ideas it bears on* chips. The margin loses its *assumes / introduces* stamps on
new articles too, since they come from Ideas. Greg finds Ideas unhelpful, so we take that; the
question file offers the other way (keep Ideas for Skim's sake, which saves nothing).

- `src/auto-mode-steps.ts`: drop `ideas`; `autoModeRequests` filters reads to `AUTO_MODE_STEPS`.
- `src/web/auto-modes.ts`: the derivation leaves Ideas out by name (`NOT_ON_IMPORT`), with the
  reason, as Marginalia and the thread are.
- `tests/auto-modes.test.tsx`: the new list, Skim's job without Ideas, and Ideas absent; and the
  four database tests that spell the list out (`gift-prep`, `publication-queues-the-main-modes`,
  `publication-of-an-awaiting-tree`, `open-before-structure-queue`).
- No backfill (principles.md § 1): articles already imported keep their Ideas.

**Simpler option passed over**: leave Skim's job as it is and only remove Ideas' own job. It is a
one-line change and saves nothing, because the step runs inside Skim's job anyway.

## Stage 2 — Quiz runs when the margin is shown, and its questions sit in it

**Cost, stated first**: about $0.17 median, $0.24 mean per article, once per article, the first
time its owner has the margin on screen with no quiz there; plus about $0.08 for each answer the
reader asks to be marked. With Ideas off the import, an article read with the margin open costs
about what it did before.

**Run on show, as the relation words are.** `OwnerMarginFeed` is handed the owner's quiz read
(`useQuizRead` in `OwnedArticle`, already shared by the prose and the band) and calls
`useAutoRunOnArrival(slug, "quiz", …)` with the same gates as `useRelations`: only while the notes
are on screen (`shown`), not while the article is still showing its opening outline, nothing while
viewing as another reader, one unforced attempt per article per page load. Only `none` runs: a
stale or outdated quiz is left for the band, because a rewrite mints a new batch and the reader's
kept answers stop showing. The job is followed quietly (`useStepJob(…, "quiet")`) with no refresh
of its own: `useQuizRead` already hears the step finish and refreshes, and a second callback would
arm a trailing second GET (Sol F3).

**The questions move from the prose into the margin while the margin is on screen.** Today each
question is a muted line in the prose after the block holding its last evidence passage, in every
mode (quiz.md § In the prose). Greg thought they were in the margin; they are not. Drawing them in
both places would put the same sentence twice side by side, so while the column is on screen
(`marginRoom`) the prose draws none and the margin draws them; with the column off, or no room for
it, the prose has them as now.

- A new note kind, `quiz`, placed by the prose's own rule (`questionsByAnchor`), at the end of the
  block's note, after the shut lines: it is the question to ask yourself having read the passage.
- **Open, not shut.** The question is the whole of it, and a shut *2 questions* line hides the
  thing meant to make the reader reflect. Each question is a button, with the prose line's icon,
  in the model's face; pressing it opens Quiz at that question, the prose line's press
  (`openQuizAt`), through a context so the margin's memo does not hear about the handler.
- A *Quiz* stamp with a house card (`tips.ts`): what it is, that the AI wrote it, and that pressing
  it opens the question in Learn › Quiz to answer.
- Owner only, as the prose lines are; never a stale quiz.

**Simpler option passed over**: run Quiz on margin open and leave the questions in the prose. Greg
asked for them among the margin's notes, and two copies are worse than either.

**Tests** (`tests/marginalia-quiz.test.tsx`, seen red with the hook and the placement switched
off): one unforced POST on show with no quiz, once under StrictMode and across a remount; none
while hidden or awaiting structure; none for a stale or outdated quiz; a failed read re-reads
rather than spending; placement beside the last evidence block, last in the note. The prose
suppression is one condition shared with the notes (`marginRoom`) and is checked in the browser
(Sol F5).

**Docs**: marginalia.md (§ Quiz's questions, and the "runs nothing else" line), quiz.md (§ In the
prose, § The artefact), skim.md (§ It waits for the Ideas), ideas.md (Sol F4).

## Stage 3 — the active-learning discussion

A question file, not code: [q-ejp09q](../user-feedback/questions/q-ejp09q.md), proposals grounded in
the reading-research digest.

## Measurement

```sql
with per as (
  select step_name, article_id,
         sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))::numeric/1e9 usd
  from spideryarn.ai_calls
  where started_at > now() - interval '30 days' and article_id is not null
  group by step_name, article_id)
select step_name, count(*), percentile_cont(0.5) within group (order by usd), avg(usd) from per group by 1;
```

## What waits

The box's OpenRouter key is over its monthly limit until 1 November, so no model call was made
here: neither change was exercised against a real model on this machine. The browser check uses
an article that already has a quiz, and the auto-run is checked by the job it posts, not by a
finished run.
