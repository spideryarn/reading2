# Shelf topics: which model should pick the pills?

Written 2026-10-02 from the working of 2026-09-29, in [plan 260929c](../plans/260929c-shelf-topics-chosen-by-a-model.md)
(§ Stage 1 — what the eval found; Sol's reviews of the plan and of stage 1). The numbers sit in
`evals/shelf-topics/results/summary.md`; this doc keeps the question, the options and the dead ends
in one place.

## The question

The deterministic chooser (`docs/project/shelf-terms.md`) filled a reader's topic pills with words
like *food*, *female*, *bowl*. Could a model, shown the shelf's titles and gists plus the program's
candidate topics, pick better ones, cheaply?

> I'm still not that happy with the suggestions that are being generated. They're just not that
> meaningful/relevant (e.g. "food", "female", "bowl" has little to do with my real topics
> (computational neuroscience, consciousness, Buddhism, AI).
>
> — Greg, 2026-09-29 (quoted in the plan)

## Options measured

The program proposes about 60-80 candidates per shelf; each arm judges them, and production's own
coverage-and-diversity greedy picks 30 (Sol's R7: one method for every arm).

| arm | method |
|---|---|
| baseline | today's deterministic list |
| Jev (`typesafe/jev-1.13`) | a 0-3 *score* question per candidate via `/api/alpha/decisions`, then the greedy |
| `jev-floor`, `jev-floor-0.75` | Jev's saved scores with anything below 1.0 (or 0.75) set to 0. **Added after seeing the results; not predeclared.** |
| DeepSeek V4 Flash | scores (and, secondary arm, orders) on the chat wire |
| GPT-6 Luna | scores (and, secondary arm, orders) on the chat wire |

Nine cases (the "greg-like" synthetic shelf standing in for Greg's own, four more synthetic shelves with
labelled good topics and planted distractors, the local 38-article shelf and three subsets), three runs per arm.
Spend $0.26 (plan, 2026-09-29).

## The numbers

Source: [evals/shelf-topics/results/summary.md](../../evals/shelf-topics/results/summary.md)
(`summarise.ts`, 2026-09-29) and the plan's judge tables (`make-pairs.ts --full`, `tally.ts --full`).

- **Blind judge, nine fresh Opus subagents, 65 pairs, full member titles shown:** Luna (scores) vs
  today's list **9-0**; Jev (floor) vs today's **9-0**; Luna (scores) vs Jev (floor) **5-3, 1 tie**
  (the first round, with only five member titles shown, had it 3-4, 2 ties, so the contrast is noise).
  Controls: identical lists tied 9 of 9. Mean judge score (1-10): Luna-score 6.25, Jev-floor 5.9,
  Luna-order 5.9, baseline 3.8.
- **greg-like, distractors among the first 12 (planted, six were candidates):** baseline 3.0, jev-score 3.0,
  luna-score 0.0, luna-order 0.0. Expected-good: baseline 8.0 of 11, luna-score 7.0, luna-order 9.3.
- **Cost and speed per call, greg-like:** Jev ~$0.0005, 0.6 s; Luna ~$0.001, 14 s; DeepSeek ~$0.004, ~316 s.
- Jev's expected scores never reached 0 (food 0.86, female 0.90 on 0-3), so plain `jev-score`
  kept the same three distractors as the baseline.

## Decision

**GPT-6 Luna scores each candidate 0-3; our greedy chooses from the scores** (job `shelf-topics`, chat
wire; ~$0.001 and ~15 s per refresh). It was at worst level in both judging rounds, kept coverage and
the neighbour rule in our code, and used the existing wire. Lives in the plan and in
[shelf-terms.md](../project/shelf-terms.md). Sol's R9 had said: if a chat model lands within the eval's
noise of Jev, prefer it, since one existing wire beats a new alpha one.

## Dead ends

- **Jev**: cheaper and faster, level with Luna, but alpha, would need a sixth gateway wire, and only
  worked after a floor chosen after the fact.
- **DeepSeek V4 Flash** (`deepseek-v4-flash-0731`): 3-8 minutes a call on default reasoning, most
  ordering runs hit the token cap or deadline. Ruled out as configured; reasoning effort was not tuned.
- **`typesafe/jev-router`**: answers on chat, but it is a router (our call was answered by
  `openai/gpt-6-luna`), so it is not "asking Jev".
- **"Luna orders"** was sent to the Overseer as the pick, then withdrawn when the full-membership
  round flipped order-vs-score from 6-3 to 3-6. An earlier claim that "our greedy costs quality" was
  drawn from one list and withdrawn.
- Swapped duplicates were first counted as votes (Jev vs Luna read 8-6); Sol found it, the real
  figure was 4-3, 2 ties in round one.

## Caveats

Mostly synthetic shelves; Greg's own shelf was unavailable, and his reading of his own shelf stays
the decisive check. The judge is the same model family as the author of the synthetic articles. The
first round's pairs showed only five member titles. The `jev-floor` arms were post hoc.

## Re-run

README: [evals/shelf-topics/README.md](../../evals/shelf-topics/README.md). `run-arms.ts` is PAID;
delete `results/` before a fresh run. The `luna-score` arm now calls the production scorer.

Up: [research.md](../project/research.md)
