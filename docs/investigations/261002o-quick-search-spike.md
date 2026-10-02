# Quick search: can a decision model score every block in under a second?

Up: [investigations.md](../project/investigations.md)

## What was asked

Search today ([search.md](../project/search.md), `findPassages` in `src/search.ts`) sends the whole
article to Sonnet. Sonnet sends back a list of hits, each with a quote, a confidence from 0 to 100
and a one-line reason. Greg wanted a fast version:

> If all I wanted was a score for each block for the degree to which it matches or something like
> that, I think Jev could do that and very quickly, at least up to 255 blocks.
>
> — Greg, 2026-10-01

Jev (`typesafe/jev-1.13`) is a "decision" model on OpenRouter's alpha Decisions endpoint. You send it
a `state` (the material to judge) and a map of `questions`. Each question is one of three kinds: a
yes/no (`noul`, which comes back as a probability), a `choice` between at most 255 options, or a
`score` on 2 to 10 levels. Jev answers every question independently and in parallel. Its context
holds 32k tokens. Input costs $0.042 per million tokens and output is free.

Earlier Jev learnings are in [evals/shelf-topics/results/summary.md](../../evals/shelf-topics/results/summary.md).
That eval found that Jev's scores never reach 0.

## What was measured

This was run on 2026-10-02 from the Hetzner box. The runner is in the session scratchpad, not in
`evals/`, because any committed TS file that names the Decisions endpoint has to be declared in
`src/spend-declarations.ts` (`tests/no-undeclared-spend.test.ts`). Copies of it sit beside the
results as `.txt` files. To re-run, copy them back to `.ts` and run from the worktree root:
`npx tsx runner.ts`, then `npx tsx analyse.ts`. They read `OPENROUTER_API_KEY` from `.env.local`.
The raw responses are in
[evals/results/quick-search-spike-2026-10-02/](../../evals/results/quick-search-spike-2026-10-02/):
`raw-*.json`, `reference-*.json`, `summary.json` and `mechanics.json`.

**Articles.** Three committed fixtures: the Constitution (84 blocks), Noema's *Mythology of
Conscious AI* (123 blocks) and Dwarkesh's *Agent Civilizations* (94 blocks). One long article came
from the local Postgres: Wikipedia's *Replication crisis*, with 542 text blocks and about 62k Sonnet
tokens, so it is well over both 255 blocks and 32k tokens. We scored every block that has text and
is not an image. Headings were included.

**Queries.** Four per article, written the way a reader would type them: 16 in all. They include
concept queries whose words are not in the passage ("self-sacrifice for the group", "fishing for
significant results", "machines that do clever things without computing anything") and question
queries ("Did any of the agents blow the whistle?", "Why do so many studies fail to replicate?").

**Arms.**

| arm | what it sends |
|---|---|
| reference | today's `findPassages({power: "standard"})`, run once per query |
| **noulOne** | one request: `state = {query, passages: {blockId: text}}`, one `noul` question per block, worded with a "meaning, not words" sentence; run 3 times per query |
| noulOnePlain | the same, without the meaning sentence (fixture articles only) |
| scoreOne | the same layout, but a 4-level `score` question per block |
| choice | one `choice` question whose options are the block ids; ranked by probability |
| perBlock | one request per block (`{query, passage, context_before, context_after}`), 20 at a time |
| perBlockLiquid | the perBlock shape on `liquid/d1`, the runner-up decision model |

**Quality.** The reference arm's hits served as an imperfect yardstick. For each arm we computed:
recall of the reference hits in the arm's top k (k = the reference's hit count) and in its top 10;
how many of its top 5 the reference did not return; and AUC, the chance that a reference hit
outscores a non-hit. Then I read the passages myself (see "Quality, read by hand" below). The reading
counts for more than the overlap numbers.

**Spend.** About $0.75 in total. The Sonnet reference cost $0.49, Jev $0.20 and Liquid $0.04.

## Mechanics of the API

| question | answer | evidence |
|---|---|---|
| Is the state billed once or once per question? | **Once.** Each extra question adds only its own text, about 25 tokens for a short one. | Same 40-passage state: 1 question cost 4,339 tokens, 10 cost 4,573, 40 cost 5,343 |
| Is there a cap on the number of questions? | **None seen.** 600 `noul` questions returned 600 answers in 616 ms. Tokens are the real limit. | `mechanics.json` |
| Is there a cap on `choice` options? | 255. A 256th gets HTTP 400 `{"error":{"message":"HTTP 400: {\"detail\":\"Too many choices. Must have at most 255 choices.\"}","code":400}}` | same |
| What happens past 32k? | HTTP 400 `{"error":{"message":"HTTP 400: {\"detail\":{\"error_type\":\"max_tokens_exceeded\"}}","code":400}}`. The real reason is a JSON string inside `message`. | same |
| Rate limits? | None hit. Over 5,000 requests ran, up to 20 at a time, with 0 errors. | `raw-*.json` |
| Deterministic? | **No.** The same request moves a score by up to 0.11 on a short article and 0.17 on the long one. The order of the top 5 changed between runs on 15 of 16 queries. | `summary.json` → `stability` |
| Other decision models | `liquid/d1` and `upstage/solar-decide` **bill the state once per question**: 18 questions on a 1.7k-token state cost 16.9k and 22.1k tokens. Solar took 12 s. `inception/mercury-decide:free` returns 404 because of this account's data policy. | `qs-others` probe in the session |

## Results

Latency is the wall-clock time from the box. Jev costs are as OpenRouter reports them. The
reference cost is from the spend ledger.

| arm | recall@k | recall@10 | top 5 not in ref | AUC | latency, typical article (median / p90) | latency, 542 blocks (median / p90) | cost per search, typical / long |
|---|---|---|---|---|---|---|---|
| reference (Sonnet) | – | – | – | – | 5.2 s / 13.5 s | 12.7–14.6 s | ~$0.015–0.06 / ~$0.06 |
| **noulOne** | 0.66 | 0.72 | 1.8 | 0.97 | **416 ms / 519 ms** | **639 ms / 884 ms** (4 chunks in parallel) | $0.0006 / $0.0038 |
| noulOnePlain | 0.72* | 0.82* | 1.3* | 0.98* | 362 ms / 468 ms | not run | $0.0004 / ~$0.0027 est. |
| scoreOne | 0.66 | 0.72 | 1.6 | 0.97 | 567 ms / 920 ms | 907 ms / 1,095 ms | $0.0008 / $0.0053 |
| choice | 0.52 | 0.53 | 2.1 | 0.78 | 325 ms / 430 ms | 498 ms / 540 ms | $0.0004 / $0.0027 |
| perBlock | 0.57 | 0.62 | 2.3 | 0.94 | 1.7 s / 2.1 s | 7.8 s / 12.4 s | $0.0020 / $0.013 |
| perBlockLiquid | 0.54 | 0.61 | 2.3 | 0.94 | 2.7 s / 3.1 s | 10.3 s / 13.3 s | $0.0010 / $0.0063 |

\* On the 12 fixture queries only. On those same 12, noulOne scored recall@k 0.72, recall@10 0.78
and AUC 0.97. So the meaning sentence did not help, and it costs about 45% more tokens.

The per-query table is printed by `analyse.ts.txt`.

The table above is **ranking evidence**: how well each arm orders the blocks. It says nothing about
where to cut the list. The cut-off was measured separately, on the final arm, in the next section.

## Where to cut: the floor, measured on the final arm

The first cut-off (0.8, chosen with `cutoff-rules.ts.txt`) was picked on the `noulOne` arm. That
arm includes the meaning sentence, which we have now dropped. Its stability claim was also wrong.
GPT Sol's review found 16/14/14 hits retained over three runs of one query, not "within one block"
(finding F7 in `docs/plans/261002e-quick-search-v1-plan-review-sol.md`). So the floor was
re-measured on 2026-10-02 with **the production arm**:

- plain wording;
- blocks that pass `isSearchable(b)`, are not headings, and have text (supplements kept);
- 3 runs per query, on the same 16 queries and the saved Sonnet hits.

The script is `floor.ts.txt`. Results are in `floor-raw.json`, `floor-summary.json` and
`floor-capped.json`. Jev spend was $0.05.

Each cell is the number of blocks kept on each of the 3 runs, then the mean recall of the
reference hits. The list is capped at 20.

| article | query | ref | ≥ 0.7 | ≥ 0.75 | ≥ 0.8 | ≥ 0.85 (uncapped) |
|---|---|---|---|---|---|---|
| Constitution | ways Claude can be too cautious | 15 | 16/15/16 · 0.93 | 14/14/14 · 0.93 | 14/14/14 · 0.93 | 14/14/14 · 0.93 |
| Constitution | Why does safety come before ethics? | 3 | 3/3/3 · 1.00 | 3/3/3 · 1.00 | 2/2/3 · 0.78 | 1/1/1 · 0.33 |
| Constitution | treating users as grown-ups | 4 | 4/5/4 · 1.00 | 3/3/2 · 0.67 | 2/2/1 · 0.42 | 1/1/1 · 0.25 |
| Constitution | things Claude should never do | 8 | 19/20/18 · 0.67 | 16/17/14 · 0.63 | 10/11/11 · 0.63 | 2/4/0 · 0.17 |
| Noema | arguments that minds are not software | 13 | 20/20/20 · 0.79 (34–36 uncapped) | 20/20/20 · 0.79 | 20/20/20 · 0.79 | 16/16/16 · 0.74 |
| Noema | Why do people mistake chatbots …? | 14 | 10/10/10 · 0.57 | 10/10/9 · 0.57 | 7/7/7 · 0.50 | 5/5/2 · 0.29 |
| Noema | machines that do clever things … | 3 | 1/1/2 · 0.44 | 1/1/1 · 0.33 | 1/1/1 · 0.33 | 1/1/1 · 0.33 |
| Noema | what the author thinks we should do | 4 | 2/2/2 · 0.50 | 2/2/2 · 0.50 | 1/1/1 · 0.25 | 1/1/1 · 0.25 |
| Agents | Did any of the agents blow the whistle? | 4 | 4/4/3 · 0.92 | 3/3/3 · 0.75 | 2/2/2 · 0.50 | 2/2/2 · 0.50 |
| Agents | how the agents covered their tracks | 9 | 5/4/5 · 0.48 | 3/3/3 · 0.33 | 2/1/2 · 0.19 | 0/0/0 · 0.00 |
| Agents | self-sacrifice for the group | 9 | 14/14/14 · 1.00 | 13/13/13 · 1.00 | 13/13/13 · 1.00 | 11/10/11 · 0.74 |
| Agents | objections … treating the AIs like people | 3 | 3/4/4 · 0.33 | 2/3/3 · 0.33 | 1/1/2 · 0.33 | 1/1/1 · 0.33 |
| Replication (505 blocks) | What can journals do to fix this? | 8 | 5/5/4 · 0.50 | 3/3/3 · 0.38 | 3/3/3 · 0.38 | 1/1/1 · 0.13 |
| Replication | fishing for significant results | 9 | 9/9/9 · 0.56 | 6/7/6 · 0.33 | 3/3/2 · 0.11 | 0/0/0 · 0.00 |
| Replication | examples from fields outside psychology | 8 | 20/20/20 · 0.83 (51–53 uncapped) | 20/20/20 · 0.83 | 20/17/19 · 0.71 | 5/3/4 · 0.13 |
| Replication | Why do so many studies fail to replicate? | 10 | 20/20/20 · 0.50 (54–59 uncapped) | 20/20/20 · 0.50 | 14/15/15 · 0.33 | 3/3/4 · 0.13 |

Mean recall before the cap of 20: **0.73 at 0.7**, 0.65 at 0.75, 0.52 at 0.8, 0.33 at 0.85.

**0.8 is too stingy on the final arm.** Dropping the sentence pulled scores down. At 0.8 we kept 2,
1 and 2 passages for "covered their tracks", out of 9 good ones. We kept 3, 3 and 2 for "fishing
for significant results", and 2, 2 and 1 for "treating users as grown-ups".

I read the blocks scoring between 0.7 and 0.8 on those queries. They are almost all reference hits,
and real ones:
- *"At least 7% of the transcripts … had obvious evidence of being tampered with"* (0.78);
- *"How do we erase all this evidence …"* (0.73);
- *"Various statistical methods can be applied to make the p-value appear smaller"* (0.76);
- *"Is condescending about users' ability to handle information"* (0.71);
- *"Even the Mafia would be jealous of this level of omertà"* (0.73), for the whistle-blower
  question.

At 0.7, the extra junk is bibliography entries on the Wikipedia article (Simmons 2011 at 0.73,
Nosek 2012 at 0.70). Those blocks pass `isSearchable`, so the floor cannot remove them. Where 0.7
floods, on articles whose whole subject is the query (34 to 59 blocks), the cap of 20 does the
work.

The retained count still moves between runs, by up to 4 at 0.7 ("things Claude should never do"
kept 19, 20 and 18). The floor fixes how strict the list is, not its exact length.

**Final floor: `noul ≥ 0.7`, keep the top 20 by score.** Below 0.7 the reference hits thin out
(0.65–0.69 holds a mix of hits and near-misses), so 0.65 would trade precision for little.

## Quality, read by hand

**Good passages the reference missed.** These are common, and they are most of the "not in ref"
count.

- "Why do so many studies fail to replicate?" On the overlap numbers this looks like the worst
  result (recall 0.20). In fact Jev's top 8 are all real answers: context sensitivity correlating
  with failure, Bird's argument that most tested hypotheses are false, Button's study of low power
  in neuroscience. The article gives dozens of reasons and Sonnet chose 10 of them.
- "arguments that minds are not software" returned *"Computational functionalism … is a very strong
  assumption"* and *"Computational simulations generally lack the causal powers …"*. Both are
  arguments the essay makes.
- "objections that the author is treating the AIs like people" returned the author's own reply to
  that objection (*"I don't see the value in refusing to use the language of intention …"*). That
  is arguably a better match than the reference's third hit, which it scored at confidence 40.

**Junk.**

- **Titles and headings.** "The Mythology Of Conscious AI" scored 0.85–0.90 on three queries.
  "Claude's Constitution" scored 0.61 against "Why does safety come before ethics?". This is easy
  to filter out.
- **Wikipedia debris**: an `[edit]` block at 0.72, and reference-list entries at 0.82–0.87 (the
  Simmons 2011 p-hacking citation, the Camerer economics citation, the Marwick archaeology
  citation). A citation that matches the topic is not a passage a reader wants.
- **Polarity.** For "things Claude should never do", Jev scored the hard constraints at 0.88–0.89.
  It scored the list of ways Claude is *over*-cautious ("lectures or moralizes", "adds excessive
  warnings") almost the same, at 0.86–0.87. It matches the topic, not which side of it a passage
  is on.

**Choice** puts nearly all its probability on one to three options. Below them the ranking is
noise, with an AUC of 0.78. **Per-block** requests do worse than one request over the whole article:
the model judges a passage better when it can see the rest of the piece. They are also 4 to 20
times slower. **Liquid d1** was about as good as Jev on the per-block shape, except on "fishing for
significant results", where it collapsed to a recall of 0.11.

## Recommendation

**If we build it, use Jev with one `noul` question per block, in one request, sending the plain
wording.**

```json
{
  "model": "typesafe/jev-1.13",
  "state": {
    "query": "<what the reader typed>",
    "passages": { "spya-k3m9qt": "<block text>", "...": "..." }
  },
  "questions": {
    "spya-k3m9qt": { "type": "noul",
      "instructions": "Does passage spya-k3m9qt match what the reader is looking for (query)?" }
  }
}
```

- **Long articles.** Split the blocks into chunks of about 26k estimated tokens (characters ÷ 3.2,
  plus about 30 tokens per question), which is roughly 150 prose blocks. Send the chunks in
  parallel. If a chunk comes back `max_tokens_exceeded`, halve it and retry. The 542-block article
  needed 4 chunks and took 0.64 s at the median.
- **What to send.** Leave out the title heading and blocks that are boilerplate or reference-list
  entries. Whether to keep section headings is a product question: they score high, and they are a
  fair place to land.
- **Which blocks count as hits.** Sort by `noul`, keep those at **0.7** or above, cap at 20, and
  show no number to the reader. The floor was re-measured on the final arm; see "Where to cut"
  above. The 0.8 floor first proposed here came from the wrong arm and missed most good passages
  on several queries. The probabilities bunch together and shift by up to 0.17 from run to run,
  so a percentage would claim a precision they do not have.
- **Retries.** Retry once on a 5xx. On a 400, read the reason out of `error.message`.

**What it does not give us, and a reader would notice.** It returns no quote inside the block, so
the highlight is the whole paragraph. It returns no reason. It confuses a passage *about* X with a
passage *against* X. On hits the reference also found, it matches about two-thirds to three-quarters of them.
So it fits best as a **first pass that answers in under a second**, with the Sonnet search still
available for the careful answer, rather than as a straight replacement. That is Greg's call. It
would also need a declared spend entry in `src/spend-declarations.ts` before any code calls it.

## Dead ends

- **`choice` over block ids.** At most 255 options, and its probabilities rank only the top few
  (AUC 0.78).
- **`score` on four levels.** It ranked the same as `noul`, cost 1.5 times as much and took 1.4
  times as long. It adds nothing.
- **One request per block.** It was slower (1.7 s, and 8 to 12 s on the long article), cost more,
  and ranked worse, because it cannot see the rest of the article.
- **The "meaning, not words" sentence in every question.** It made no measurable difference on the
  concept queries and cost about 45% more input. Jev already matched "self-sacrifice" to "kamikaze"
  and "fishing" to "data dredging" without it.
- **Other decision models.** `liquid/d1` and `upstage/solar-decide` bill the whole state once per
  question, which rules out the one-request shape. Solar also took 12 s.
  `inception/mercury-decide:free` is blocked by this account's data policy.
- **An absolute threshold at 0.5.** It selects far too much on any article whose whole subject is
  the query.
