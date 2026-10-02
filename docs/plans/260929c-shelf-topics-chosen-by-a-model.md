# Shelf topics, chosen by a model from the program's candidates

Investigation write-up: [docs/investigations/261002e-shelf-topics-which-model-picks-the-pills.md](../investigations/261002e-shelf-topics-which-model-picks-the-pills.md).

**Status:** planned, 2026-09-29. Changes the design in [shelf-terms.md](../project/shelf-terms.md)
("picked without a model"). Follows rounds one to three:
[260928a](260928a-shelf-facet-terms.md), [260928d](260928d-shelf-topics-diversity-coverage-and-detail-view.md),
[260929a](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md).

## What Greg asked for

> - Do we have an OpenRouter key with access to Jev? Run spike
> - I'm still not that happy with the suggestions that are being generated. They're just not that
>   meaningful/relevant (e.g. "food", "female", "bowl" has little to do with my real topics
>   (computational neuroscience, consciousness, Buddhism, AI). Let's try a new approach where we
>   create a prompt plus summaries of articles plus suggestions for topic-pills (along with any
>   metadata about them that might be useful) and ask Jev to pick from them. Run spikes/evals,
>   inspect its output and iterate, perhaps compare with LLMs (e.g. DeepSeek, Luna). If you don't
>   have a database of articles, create one (perhaps with fake or representative short public domain
>   ones), and/or use Opus subagent for LLM-as-judge. Also estimate prices. If you think Jev is good
>   enough and cheap, go with that. If DeepSeek or Luna are much better and not that much more
>   expensive, go with that. I suppose if we store the output, we only need to update it when we
>   add new articles... But I'd still rather this was free/very cheap.
>
> — Greg, 2026-09-29

Relayed by the Overseer with Greg's approval of small paid spike and eval calls, and: keep the
deterministic picker as the candidate generator and as the fallback when the model call fails or
there is no key; store the pick per owner and recompute only when the shelf changes; an additive
migration, applied to production by Greg; send the eval table and the pick before building unless
it is clear-cut and cheap.

## The spike: can our key call Jev? (2026-09-29, `evals/shelf-topics/spike-jev.ts`)

- **Jev is not a chat model.** `~typesafe/jev-latest` (currently `typesafe/jev-1.13`) is TypeSafe's
  *decision* model. OpenRouter refuses it on `/chat/completions` — *"is a decisions model and cannot
  be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead"* — and
  it is absent from the public `/api/v1/models` list. It takes a **state** (any string or JSON) and
  named **questions** of three kinds — *noul* (yes/no with a probability), *choice* (one of named
  options, with probabilities), *score* (a point on an ordered scale, with probabilities) — and
  returns typed answers, no prose. Context 32,000 tokens. **$0.042 per million input tokens; output
  free.** Source: OpenRouter's Jev guide and Decisions API reference (fetched 2026-09-29).
- **`typesafe/jev-router`** is listed (price `-1`, i.e. variable) and *does* answer on chat — but it
  is a router that chooses a model per request: our one-word call was answered by
  **`openai/gpt-6-luna`**. It is not "asking Jev".
- **Our key reached both endpoints' front doors**; the router call cost $0.0000038 upstream (the key
  is BYOK, so OpenRouter reports `cost: 0` and the upstream figure separately).
- **What using Jev would cost us in code:** a sixth wire in the gateway (`/api/alpha/decisions`) —
  route, meter, spend record, and the boundary tests that forbid any other endpoint. Real work, and
  worth it only if Jev wins the eval. For the eval itself, the Jev arm calls the endpoint from the
  eval harness with its spend recorded through the gateway's eval seam (see Stage 1).

Comparison prices (OpenRouter list, 2026-09-29, $ per million tokens in / out):
`~typesafe/jev-latest` 0.042 / free · `~deepseek/deepseek-v4-flash-latest` 0.012 / 0.40 ·
`~deepseek/deepseek-flash-latest` 0.02 / 0.60 · `openai/gpt-6-luna` 0.10 / 0.50.

## The shape of the answer

**The program proposes, a model disposes.** The deterministic chooser (rounds one to three) keeps
doing what it is good at — finding phrases that occur, counting which articles each reaches — and
now produces a **wider candidate list** (about 60–80, each with its label, how many articles it
reaches, and two or three example titles). A model is shown **the shelf** — each article's title
and its one-sentence gist (already stored, `LibraryEntry.gist`), plus the reader's profile interests
if they have written any ([reader-profile.md](../project/reader-profile.md)) — and the candidates,
and **picks and orders about 30**. The model never invents a label, so a pill always matches
articles by the same counted phrase as today, and the model's job is only judgement: which of these
would this reader actually filter by.

Three arms and a baseline:

| arm | how it picks |
|---|---|
| **baseline** | today's deterministic list (round three) |
| **Jev** | one *score* question per candidate — "how useful is this topic for filtering this shelf?" on a 0–3 scale — then today's coverage-and-diversity greedy, using Jev's expected score as each candidate's quality |
| **DeepSeek Flash** | one chat call returning the chosen keys in order, as JSON |
| **GPT-6 Luna** | the same prompt as DeepSeek |

(Jev cannot return an ordered list, only per-question answers, which is why its arm scores and then
reuses our greedy; the chat arms are asked for the order directly, and are also run through the
greedy as a variant if their own order under-covers.)

## Stage 1 — the eval (no product code changes)

- **Data.** (a) The local 38-article shelf (a copy of several of Greg's real articles — repeatable,
  reads free). (b) **Greg's production shelf**, the real test: this box cannot read production, so a
  read-only export command (`evals/shelf-topics/export-shelf.ts --owner <uuid>`, the report script's
  own owner-scoped query, writes a JSON of titles, gists, profile and candidates to a local file) is
  handed to the Overseer to run with the production URL. (c) A small synthetic shelf of short
  public-domain texts on deliberately mixed themes (e.g. Buddhism, neuroscience, cooking, Victorian
  fiction), so a "food / bowl" failure has somewhere to show.
- **Harness** in `evals/shelf-topics/`: builds the candidates with the production chooser, runs each
  arm (twice for the control), records tokens, cost and latency per call, writes each arm's list.
- **Judge.** A fresh Opus subagent reading only a pairs file: the shelf (titles and gists) and two
  anonymised lists; asked which a reader of this shelf would rather filter with, and to score each
  list 1–10 for *meaningful to this reader*, *covers the shelf*, *no near-duplicates*. Sides
  shuffled with `crypto.randomInt`, **the key's side counts checked before judging** (a JS float LCG
  once put one arm on the same side 94 times in 95). An identical-baseline pair checks judge/side
  noise; Luna runs 1 and 2 measure model variation plus judge variation; a side-swapped duplicate
  checks side bias but is not a second independent vote. Plus the numbers the report script already
  prints: coverage@5/8/12, overlap.
- **Output**: a table per shelf — arm, judge wins and mean score, coverage, cost per refresh,
  latency — and the lists themselves, read by me. **This goes to the Overseer before anything is
  built**, unless the pick is clear-cut and cheap as Greg described.

## Stage 1 — what the eval found (2026-09-29)

**Setup.** Nine cases in `evals/shelf-topics/`: *greg-like* (22 model-written articles on
computational neuroscience, consciousness, Buddhism and AI, plus a recipe, a news story and a
lifestyle piece as distractors — Greg's real shelf was not available, and he asked for one shaped
like it), four more synthetic shelves with labelled good topics and planted distractors, and the
local 38-article shelf with three subsets of it. ~80 candidates per case from the production
chooser, through the new `quality` seam (R8). Every arm run three times. **Spend: $0.26**, recorded
in the ledger (the Jev calls through a declared bypass, `shelf-topics-jev`, because the gateway has
no decisions wire).

**Jev works** on `/api/alpha/decisions`: answered by `typesafe/jev-1.13-20260917`, provider
TypeSafe, ~$0.0005 and under a second per shelf (R5 closed). **But its scores never go near 0** —
*food* 0.86, *female* 0.90 on a 0–3 scale — so the greedy still took them, and plain `jev-score` kept
the same three distractors as the baseline on *greg-like*. A floor (score < 1 counts as 0) fixed
that; **the floor was added after seeing the results** and is labelled so everywhere. With it,
Jev's lists shrink to 3–7 topics on the real-article cases.

**DeepSeek V4 Flash** (`deepseek/deepseek-v4-flash-0731`) took 3–8 minutes per call on the
provider's default reasoning, and most of its ordering runs hit the token cap or the deadline —
ruled out as configured.

**Blind judge** (nine fresh Opus subagents, one per case, reading only that case's pairs; 65 pairs;
sides from `crypto.randomInt`, balanced within chance):

| contrast | result |
|---|---|
| Luna (scores) vs today's list | **9–0** |
| Jev (floor) vs today's list | **9–0** |
| Jev (floor) vs Luna (scores) | **4–3, 2 ties — level; *greg-like* 0–1.** The nine side-swapped duplicates reproduced every verdict, so counting them as extra votes would give the former 8–6, 4-tie figure. |
| Luna (orders) vs Luna (scores) | 6–3 |
| controls: identical lists | 9 of 9 ties |
| controls: Luna run 1 vs run 2 | split 4–4–1 |

Raw mean judge score over every appearance (1–10): Luna-order 6.6, Jev-floor 6.3, Luna-score 6.1,
baseline 3.7. These are descriptive, not a four-way ranking: the arms appeared in different
contrasts, and the Jev/Luna side-swapped duplicate and the controls are included.

**Review limitation.** R6 required the judge to see every member title for each topic. The built
pairs showed the first five and only a `+N more` count after that. The verdicts are still evidence
about the labels, ordering and visible memberships, but they are weaker evidence that every topic's
full membership is coherent. Fixing the historical comparison means regenerating the pairs with all
titles and re-judging them; this Stage 1 review made no paid calls, so it has not rewritten the
evidence as though that had happened.

*greg-like*, first 12:
- **today:** model, predictive coding, global workspace theory, neural networks, reinforcement
  learning, **kitchen, female**, Buddhism, consciousness, **bowl**, dopamine, mindfulness
- **Luna orders:** consciousness, Buddhism, predictive coding, neural networks, reinforcement
  learning, model, mindfulness, meditation, dopamine, hippocampus, global workspace theory,
  integrated information
- **Luna scores:** Buddhism, consciousness, dopamine, neural networks, prediction, reinforcement
  learning, hippocampus, meditation, language, training, brain, neuron
- **Jev floor:** prediction, model, Buddhism, consciousness, reinforcement learning, hippocampus,
  meditation, dopamine, neuron, brain, predict, artificial

Reading the lists shows **our greedy costs quality in the score arms**: its containment rule
swallows *predictive coding* into *prediction*, and it drops small, precise topics (*global
workspace theory*, *integrated information*) that Luna's own order keeps.

**Re-judged with full membership** (R6 / Sol S1-3; `make-pairs.ts --full`, a fresh shuffle, nine
fresh Opus judges, `tally.ts --full`; independent votes, swapped duplicates excluded):

| contrast | first round | full membership |
|---|---|---|
| Luna (scores) vs today's list | 9–0 | **9–0** |
| Jev (floor) vs today's list | 9–0 | **9–0** |
| Luna (scores) vs Jev (floor) | 3–4, 2 ties | **5–3, 1 tie** |
| Luna (orders) vs Luna (scores) | 6–3 | **3–6** |
| identical lists tie | 9 of 9 | 9 of 9 |
| swapped duplicates agree | 9 of 9 | 9 of 9 |

Mean judge score (full membership): Luna-score 6.25, Jev-floor 5.9, Luna-order 5.9, baseline 3.8.
The order-vs-score contrast **flipped between rounds**, so it is noise; the earlier reading that
"our greedy costs quality" was drawn from one list and is withdrawn — with every member title
visible, the judge preferred the greedy's lists. On *greg-like* the Luna-score list (*Buddhism,
consciousness, dopamine, neural networks, prediction, reinforcement learning, hippocampus,
meditation, language…*) won five of nine pairs.

**The pick, sent to the Overseer for Greg: GPT-6 Luna scores each candidate 0–3; our greedy
chooses from the scores.** ~$0.001 and ~15 s per refresh on the existing chat wire. It is at worst
level in both rounds and top with full membership; it keeps coverage, dead-pill hiding and the
neighbour rule in our code; Jev is cheaper and faster but behind, alpha, a new wire, and needs a
floor chosen after the fact. (A first pick of "Luna orders" was sent and then withdrawn when the
full-membership round reversed that contrast.) Building unless Greg says otherwise.

## Stage 2 — the build (after the pick)

- If Jev: the decisions wire in the gateway. If a chat model: a new `AiJob` on the existing chat
  wire.
- **Stored per owner and scope**: a table keyed on the owner and whether archived is in scope,
  holding a hash of the shelf the pick was made for (the owner's current revision ids and the
  extractor version), the model, the chosen keys in order, and when. Additive migration; applying it
  to production is Greg's.
- **When it refreshes**: when the stored hash no longer matches — an article added, removed,
  re-extracted or archived/restored in the scope. The terms route returns the deterministic list at
  once when the pick is stale and refreshes in the background, so the shelf is never waiting on a
  model; the next load shows the model's pick.
- **Fallback**: no key, a failed or refused call, or a malformed answer → today's deterministic list,
  silently to the reader, loudly in the log.
- Docs: shelf-terms.md's design section rewritten; ai-gateway.md for a new wire or job.

**Landed (2026-09-29, uncommitted at the time of writing):** job `shelf-topics` on the chat wire,
`openai/gpt-6-luna`, provider default reasoning (what the eval measured); the scorer
`src/shelf-terms/model-scores.ts` (the eval's prompt and `promptCandidates`, moved; a strict
parser; `inputHash` over the exact messages + prompt version + model); `src/shelf-topics.ts` (stored
scores applied — unscored keys left out, program's list if that leaves nothing; claim → allowance →
send → await → fenced write; backoff 2 min ×4 to 6 h; `shelf-topics` rate bucket 12/h, 40/day,
3,000/day global); table `shelf_topic_scores` (`drizzle/20260929065031_shelf_topic_scores.sql`,
additive, with its `auth.users` FK) — **production is Greg's to apply**; the client asks again every
8 s, at most four times, while `refreshing`. Where the text above differs, this is what was built:
the hash is of the model's input (R2), not of revision ids, and a stale row is **used** (not the
program's list) until its refresh lands. The eval's `luna-score` arm now calls the production
scorer. [shelf-terms.md § The model's judgement](../project/shelf-terms.md#the-models-judgement).

## Reviews

*(GPT Sol plan review, stage reviews — recorded as they land.)*
- **GPT Sol, plan** —
  [260929c-shelf-topics-chosen-by-a-model-plan-review-sol.md](260929c-shelf-topics-chosen-by-a-model-plan-review-sol.md)
  (prompt: [260929c-shelf-topics-chosen-by-a-model-plan-review-prompt.md](260929c-shelf-topics-chosen-by-a-model-plan-review-prompt.md)).
  *Revise before building.* Decisions, superseding the text above where they differ:
  - **R5 — the spike overstated.** It proved the chat door (the router), not the decisions door. The
    eval makes real, metered `/api/alpha/decisions` calls and keeps their response, answered model,
    provider and cost. Until then "our key can call Jev" is unproven.
  - **R7 — one method for every arm.** Every model, Jev included, **scores each candidate 0–3 against
    the same anchored rubric** (each question names its candidate; all in one request), and the same
    coverage-and-diversity greedy picks the 30 from those scores. A chat model ordering the list
    directly is a **separately declared secondary arm**, not a rescue.
  - **R8 — a seam before the eval**: a pure, tested way to hand the chooser external per-candidate
    quality, so the eval calls production's own code (prompting-guide.md).
  - **R6 — a bigger eval**: about ten cases (the local shelf, subsets of it, synthetic shelves with
    pre-labelled good topics and distractors like *food*/*bowl*, and Greg's shelf when the export
    arrives), three runs per arm, several same-arm and swapped controls; the judge gets the same
    profile the arms got and each candidate's member titles. Greg's own shelf and his reading of it
    stay the decisive check.
  - **R9 — pin `typesafe/jev-1.13`**, not `~latest`; strict schema, deadline, backoff. **If a chat-wire
    model lands within the eval's noise of Jev, prefer it** — one existing wire beats a new alpha one.
  - **R1–R4 are Stage 2's**: the refresh is awaited after the response is sent (no unrecorded
    late spend); the cache key hashes the actual model input plus prompt and model versions, and only
    the active scope refreshes on archive/restore; an atomic claim with a lease, a failure backoff and
    a per-owner daily fuse; a new `shelf-topics` `AiJob`, request scope, the owner's, not the ingest
    quota; the privacy page names any new provider (and Jev's data-collection terms are checked
    first); no titles, gists or prompts in logs.
- **GPT Sol, stage 1 code** —
  [260929c-shelf-topics-chosen-by-a-model-stage1-review-sol.md](260929c-shelf-topics-chosen-by-a-model-stage1-review-sol.md),
  reviewing 10a21a0e. *Conditional pass.* Fixed S1-1 (Jev's calls were recorded as `wire: "chat"`;
  now a `decisions` wire), S1-2 (**the swapped duplicates had been counted as votes** — the Jev/Luna
  contrast was 4–3–2, not 8–6–4; corrected here and to the Overseer), S1-4 (invalid external scores
  unvalidated on small shelves), S1-5 (the summary's claims). S1-3 (the judge saw five member titles,
  not all) was fixed by the full-membership re-judge recorded above, which reversed the
  order-vs-score contrast and changed the pick.
- **GPT Sol, stage 2 code** —
  [260929c-shelf-topics-chosen-by-a-model-stage2-review-sol.md](260929c-shelf-topics-chosen-by-a-model-stage2-review-sol.md)
  (prompt: [260929c-shelf-topics-chosen-by-a-model-stage2-review-prompt.md](260929c-shelf-topics-chosen-by-a-model-stage2-review-prompt.md)),
  reviewing the uncommitted tree on 10a21a0e. *Approve after its fixes*, no P0–P2 left: S2-1 (the
  client's refetch key missed a re-extraction with the same word count and title/gist changes —
  now keyed on revision, title and gist), S2-2 (a concurrent tab that lost the claim stopped
  polling), S2-3 (candidate labels were an unbounded part of a paid prompt — clipped at 160
  characters), S2-4 (the "data, not instructions" line now covers labels; prompt version 2).

**Status, 2026-09-29 ~12:30:** memory freed; the stage's 15 test files ran (one failure, a pure
test placed inside a block whose teardown unmounts a root it never mounted — moved out). The new
route and scorer tests had never been seen red, so a mutation check broke nine behaviours one at a
time: seven were caught; **two were not** — nothing tested owner isolation of the score row, and the
no-titles-in-logs test caught a leaked title only if it sorted first. Both tests were added and each
shown red under its mutation, then green; the production files were restored byte for byte (`cmp`).
A fixture uuid shared with `library.test.ts` (from S2-1's fix) was made unique. **Push waits for
fb4c's migration `20260929052845` to reach `origin/dev`** — the watermark order is fb4c, this
(`20260929065031`), then fb4j (`20260929091412`). Applying it to production is Greg's.

**After the push (bfdfccf3):** checking the claim to the Overseer that "the route falls back to the
program's list if the table is missing" found it half true — the first read was guarded, **the
claim was not**, so a production deploy ahead of Greg's migration would have turned the Topics row
into a 500. A test that makes the claim throw `relation … does not exist` went red, the claim is now
guarded like the read, green. Every other store call on the path was already guarded.
