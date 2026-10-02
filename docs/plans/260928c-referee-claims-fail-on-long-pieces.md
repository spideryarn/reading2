# Referee claims fail on long pieces

Research write-up: [docs/research/261002m-chat-web-reach-faq-levels-remember-brevity-and-referee-claims-effort.md](../research/261002m-chat-web-reach-faq-levels-remember-brevity-and-referee-claims-effort.md).

**Status, 2026-09-28: done — three stages built, measured, reviewed twice by GPT Sol, and on `dev`.**

Found by the plain-words session
([260926a-plainer-summaries-and-glossary.md](260926a-plainer-summaries-and-glossary.md) § the
Referee claims note): on the 8,000-word Noema essay, *Pull the paper's claims* failed on every
attempt, once with *the answer was longer than there was room for* and once with *ran out of room
before it wrote anything*, under both the old prompt and the new one.

## What is actually happening

**The model spends the whole allowance thinking, and never gets to the answer.**

`runClaimsStream` ([src/referee-claims-run.ts](../../src/referee-claims-run.ts)) sends Sonnet 5
through OpenRouter with `max_tokens: 12000` and no `reasoning` field. On this route Sonnet 5 thinks
before it answers, and **`max_tokens` covers the thinking as well as the answer** — the same fact
[src/token-budget.ts](../../src/token-budget.ts) was written around for the pipeline stages after
[260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md). The thinking grows with the
paper. The comment above `max_tokens: 12000` sizes it for the answer alone.

Reproduced on the first try, on the committed fixture
`tests/fixtures/data-root/data/noema-mythology-of-conscious-ai` (141 blocks, 8,290 words, 20,240
prompt tokens), with the exact messages `buildClaimsMessages` builds, calling `openRouterStream`
directly (a scratch script, since deleted; every run's numbers are one line each in
[evals/results/referee-claims-long-pieces-260928.jsonl](../../evals/results/referee-claims-long-pieces-260928.jsonl)):

| request | reasoning tokens | answer tokens | answer | finish | time | cost |
|---|---|---|---|---|---|---|
| today: 12,000, no `reasoning` | **12,000** | 0 | nothing | `length` | 127 s | $0.12 |
| 48,000, no `reasoning` | 7,963 | ~4,800 | 12 claims, 38 passages | `stop` | 113 s | $0.13 |
| 24,000, `effort: "high"` | 13,212 | ~5,000 | parses | `stop` | **160 s** | $0.19 |
| 24,000, `effort: "medium"` | 0 | 5,606 | 15 claims, 41 passages, 0 dropped | `stop` | 53 s | $0.11 |
| 12,000, `effort: "low"` | 0 | 5,103 | 12 claims, 45 passages, 1 passage unquoted | `stop` | 47 s | $0.10 |

So the two production errors are one cause at two points: thinking took *all* of the 12,000 (no
text at all — `[ai-no-room]`), or took most of it and cut the JSON off mid-object
(`[ai-overflowed-fixed]`). Which one you get is luck: two unconstrained runs over the same essay
thought for 12,000+ and 7,963 tokens.

And there is a **second limit waiting behind the first**: at `high` — which is roughly what "no
`reasoning` field" behaves like — the call took 160 s against a 180 s `CLAIMS_TIMEOUT_MS`. Raising
`max_tokens` alone would have moved the failure from the token ceiling to the clock on a slightly
longer paper.

**Nothing changed to break it; it was never tested this long.** `max_tokens: 12000` arrived with
the claims run itself in `9b636cc1` (2026-09-01), whose comment sizes it for the JSON alone, and
`anthropic/claude-sonnet-5` was already the model then (unchanged since 2026-08-26). No commit ever
sent `reasoning` from this file. OpenRouter maps `reasoning.effort` onto Anthropic's
`output_config.effort` on these models
([260827e-ai-cost-authoritative-sources.md](../research/260827e-ai-cost-authoritative-sources.md),
second-hand); the chat wire takes `none … max` and refuses `adaptive`
([ai-gateway.md](../project/ai-gateway.md)). That `medium` spent **zero** thinking tokens here is
new, measured once per effort, and is the reason the thinking reservation below is not zero.

The answer itself is small: ~5,000–5,600 tokens for 12–15 claims. The worst the caps allow
(`MAX_CLAIMS` 20 × `MAX_PASSAGES` 8) is ~19,000 tokens at the measured ~107 tokens a passage and
~80 a claim.

## The fix

1. **Say how hard to think: `reasoning: { effort: "medium" }`.** Effort is the leash; `max_tokens`
   is not (token-budget.ts § `THINKING_HEADROOM`, *"the answer is almost certainly a lower effort
   rather than a bigger number"*). Medium, measured above, answered in 53 s with the most claims and
   nothing dropped. Low is cheaper by a few cents and dropped a passage; the saving is not worth a
   step down in the one thing a referee relies on. The job's route already has
   `require_parameters: true`, so an upstream that cannot honour `reasoning` refuses rather than
   answering unleashed.
2. **Size `max_tokens` as answer + thinking**, written as the two terms: room for the largest answer
   the caps allow, plus a reservation for whatever thinking `medium` still does on a harder paper.
   `max_tokens` is a ceiling, not a purchase — unused room is not billed.
3. **A deadline that fits the largest answer.** At the measured ~110 tokens/s, a worst-case
   ~19,000-token answer is ~175 s of writing alone. The deadline goes up; the 45 s stall clock is
   what catches a hung stream and does not move. `api/**` has `maxDuration: 800`.
4. **Log reasoning tokens** on the success line and on the no-text line. This failure was invisible
   in the logs: the no-text line said `finishReason: "length"` and nothing about where the tokens
   went.

## The simpler option passed over

**Just raise `max_tokens`** to 48,000. It works on this essay (row 2) and is a one-number change,
but it leaves thinking unbounded — the effort-high row shows the next failure is the 180 s clock —
and it pays for ~8,000 tokens of thinking a run (~$0.08) that the medium row shows buys nothing
visible.

**Chunking or batching the paper** — splitting it and asking per part — was the brief's other
suggestion. Not needed: the input (20k tokens) is nowhere near a limit, and the answer fits in one
response with room to spare. It would also break the job's shape: claims are made up front and
taken up later, so a chunk sees half of each pair.

## Tests

- **Red first**: the outgoing request body for a claims run carries `reasoning.effort` and a
  `max_tokens` that covers the worst-case answer plus the reservation. Red today (no `reasoning`,
  12,000).
- The deadline covers the worst-case answer at the measured rate.
- A stream that ends `length` having sent only reasoning deltas logs the reasoning count.
- The eval `evals/referee-claims.ts` re-run at the new effort (five short papers, one call each) —
  the adequacy rule is held mostly by the prompt, and a change in thinking could move it.
- The Noema essay re-run through `runClaims` itself, twice.

## What the plan review changed

GPT Sol, read-only, on the plan and the stage-1 draft:
[260928c-referee-claims-fail-on-long-pieces-review-sol.md](260928c-referee-claims-fail-on-long-pieces-review-sol.md)
— *build with changes*. All eight findings taken:

- **F1 (P1) — the deadline could not fit the budget.** 300 s was sized from the answer alone; a run
  that thinks *and* writes a long answer is the one it would kill. `CLAIMS_TIMEOUT_MS` is now
  derived from `CLAIMS_MAX_TOKENS` at the slower measured rate (~95 tokens/s, thinking) plus a
  quarter: 519 s. `api/**` allows 800.
- **F2 — estimates written as bounds.** The caps bound rows, not their length, so
  `CLAIMS_ANSWER_ROOM` is described as an estimate; `max_tokens` goes through `budgetFor`, so the
  model's own ceiling is checked. The thinking reservation is 16,000 (a little over what an unleashed
  run spent on the essay) and is explicitly not a claim about a paper several times that length —
  the longest local paper is measured below.
- **F3 (P1) — the eval's one flag was the fail-safe misfiring**, not a weaker rule: *"states that no
  cross-domain transfer experiments were performed"* restates the paper's own limitations sentence,
  and the unanchored `no … experiments were` arm of "the paper contains no such thing" blanked it.
  Anchored at the start of the line (the scope frame beside it already was), red-first in
  `tests/referee-claims-accounting.test.ts`, and pinned `fires: false` in the eval's `SELF_CHECK`.
  The other withheld line in the `overclaim` re-runs (*"frames what other methods need, against
  which the no-tuning claim is set"*) is a real comparison against the claim and stays caught.
- **F4 (P1) — the no-text sentence.** `saidNothing("length")` told every caller's reader the AI
  "was given too much at once" and to "ask about a shorter stretch". The first is false for every
  caller — the input does not count against `max_tokens` — and the second is a control Claims,
  Criteria and Mirror do not have. The replacement says only what `finish_reason: "length"` proves:
  the allowance was used before this caller received text. It is `retry`, because identical runs
  have varied 2.4× in their reasoning and these fixed-ask callers offer no narrower request
  ([src/messages.ts](../../src/messages.ts) § `saidNothing`).
- **F5 — criteria's literature kind is different** (tools, 6,000, its own clocks) and was not
  measured. Measured before deciding; see § Siblings.
- **F6 — stage 3 needs an enforceable decision.** Taken in a smaller form than Sol's
  `openRouterArticleStream`; see stage 3.
- **F7 — the tests pinned less than the plan decided.** They now assert `medium` exactly, the named
  budget and the model ceiling, a deadline sized from the whole ceiling, and — in a child process,
  because the logger is silent under `NODE_ENV=test` — a reasoning-only `length` stream's log line
  and reader sentence (`tests/referee-claims-no-room-log.test.ts`).
- **F8 — evidence.** Per-run numbers go to `evals/results/referee-claims-long-pieces-260928.jsonl`;
  the medium-effort eval is kept as `evals/results/referee-claims-effort-medium-260928.md`, and the
  canonical `referee-claims.md` (whose hand-written analysis a run overwrites) is left as it was.

And the `overclaim` case was re-run twice more at `medium`: `medium` spent **1,207** thinking tokens
on one of them. So `medium` is not "no thinking", and the reservation is doing real work.

## Stages

1. **Claims**: the fix, its tests, the eval and the live re-run.
2. **Criteria**, the same fix — the sibling measurement below shows it one notch from the same
   failure.
3. **The class**: a guard so the next call cannot ship without deciding this, and a loud log line
   when any chat call's thinking eats its allowance. Postmortem.
   - **`CHAT_REASONING: Record<ChatJob, ReasoningDecision>`** in [src/models.ts](../../src/models.ts),
     beside the per-job tier and env-var tables: either `{ effort }` or
     `{ providerDefault: "<why>" }`. Exhaustive, so a new chat job does not compile until somebody
     has written down how hard it thinks. Every existing job that sends no `reasoning` today is
     entered as `providerDefault` with its reason, so **no other feature's behaviour changes**.
   - **The gateway sends it, and callers cannot.** `outgoing` in src/ai-call.ts adds `reasoning` from
     the table; `AiRequestBody` gains `reasoning?: never`, the way it already forbids `provider`, so
     there is one place the decision lives. `link-summary`'s `effort: "low"` moves into the table.
   - **A warning at the one place every stream ends**: `openRouterStream` logs, with the job, when a
     stream stops on `length` having spent reasoning tokens — the line that would have named this bug
     the first time it happened, for any caller.
   - Smaller than Sol's `openRouterArticleStream` with a discriminated budget: a second entry point
     is a second way to call the gateway, and the budget arithmetic stays with the caller, who is the
     only one who knows the shape of its answer. What the class needs is that the decision cannot be
     *absent*, and the table does that.

Sol code review at the end of stages 1–2 together (they are the same change twice) and of stage 3.

## Siblings

Measured by an Opus subagent on the same essay, one or two calls each, no `reasoning` field:

| caller | `max_tokens` | thinking | total out | finish | answer starts | verdict |
|---|---|---|---|---|---|---|
| search | 4,000 | 44 / 194 | 1,132 / 1,278 | `stop` | 3–6 s | safe, ~30% used |
| criteria (`single`) | 4,000 | 1,558 / 1,349 | **3,762 / 3,404** | `stop` | 18–21 s | **85–94% used** |
| criteria, `effort: "low"` | 4,000 | 0 | 1,421 | `stop` | 2 s | 11 results against 14–16 |
| criteria, `effort: "medium"` | 4,000 | 0 | 1,766 | `stop` | 1.5 s | 14 results, 19 s in all |
| literature criteria | 6,000 | 1,878 | 4,173 | `stop` | 31 s | 9 results, 4 searches |
| literature, `effort: "medium"` | 6,000 | 851 | 4,278 | `stop` | 18 s | 8 results, 7 searches, citations intact |
| **claims, as fixed**, on a 152,077-word PDF (360,716 prompt tokens) | 39,400 | 4,716 / 11,511 | 9,339 / 15,900 | `stop` | — | 9 claims each, 80 s / 145 s, ≤ 40% of the ceiling |

Criteria's answer starts 18–21 s in against a 30 s stall clock and a 60 s deadline, so it is close on
time as well as tokens. `literature` at `medium` still thinks a little (between its searches), keeps
its citations and starts answering 13 s sooner — so **one `medium` row covers all three kinds**,
which matters because they share one job name. Mirror reads comments, not the article, so it is
outside the class.

**The long PDF is the envelope we can now state:** claims at `medium` on the longest paper in the
local database passed twice, and its thinking varied 2.4× on identical input. `medium` narrows the
spread and does not fix the amount; the 16,000 reservation had room to spare both times. It also
dropped 7–8 passages a run as unquoted — a quoting problem on long PDFs, not a budget one, and not
this plan's.
The other whole-article chat callers with a fixed ceiling and no `reasoning` field are
`src/explain.ts` (1,500), `src/converse.ts` (4,000; 12,000 for candidates), `src/quiz-mark.ts`
(1,200) and `src/debate.ts` (8,000, over an evidence subset). None has failed that we know of; each
is now a `providerDefault` row with its reason, and the gateway's warning is what will say if one
does.

**Why not one shared effort inside `openRouterStream`.** The calls think very different amounts for
their own reasons — ~100 tokens for search, ~1,500 for criteria, 8,000+ for claims — and a literature
criterion that searches the web may genuinely want the thinking. One hidden constant would change the
quality of seven features to fix two. Each job names its own, next to its own `max_tokens`, so the
two are sized together.

## What landed

- **Stage 1, claims** — `reasoning` `medium` (from the table), `max_tokens` 39,400 =
  `CLAIMS_ANSWER_ROOM` 23,400 + `CLAIMS_THINKING_ROOM` 16,000 through `budgetFor`, deadline
  `deadlineFor(39,400)` = 519 s, `reasoningTokens` on both log lines. The fail-safe frame narrowed
  (F3). The shared no-text sentence rewritten (F4).
- **Stage 2, criteria** — `medium`; `max_tokens` 13,750 for `single`/`diverging` and 20,750 for
  `literature` (answer room from `MAX_RESULTS` at measured rates, plus 10,000 thinking); deadlines
  181 s and 274 s from `deadlineFor`. Stall clocks unchanged.
- **Stage 3, the class** — `CHAT_REASONING` / `effortOf` in src/ai-call.ts, `reasoning?: never` on
  `AiRequestBody`, link-summary's `low` moved into the table, `warnIfThinkingAteTheCeiling`,
  `STREAM_TOKENS_PER_SECOND` and `deadlineFor` in src/token-budget.ts. Postmortem
  [260928b](../postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md).
- **Tests**, each watched red: the claims request (effort, budget, deadline), the criteria request
  for all three kinds, the reasoning-only `length` stream in a child process (log line, gateway
  warning), its reader sentence and throw in-process, the fail-safe restatement, and
  `tests/chat-reasoning.test.ts` — every row of the table read off the wire. Mutation checks:
  removing the gateway's injection reds 8 tests; removing the warning or the claims log field reds
  the child-process test.
- **Caught by the full suite, not by me**: `CRITERION_ORPHAN_GRACE_MS` (src/routes.ts), how long
  another process waits before burying a `pending` criterion, was a flat 150 s with a module-load
  assertion that it outlast `LITERATURE_TIMEOUT_MS`. The new 274 s deadline tripped it in 71 test
  files. It is now derived (`LITERATURE_TIMEOUT_MS + 30 s`), the way `CLAIMS_ORPHAN_GRACE_MS`
  already was — so a claims or criteria run abandoned mid-stream now waits about five (criteria) or
  nine (claims) minutes before it can be re-run from another process, where it was two and a half
  and three and a half. That is the price of a deadline that fits the ceiling.
- **Full suite**: after that fix, the only reds were the five that need a build a fresh worktree
  does not have (`cold-start-lazy-imports`, `pdf-bundle-trace`, three `fleet-*` wanting
  `tools/fleet/web/dist`).
- **Spend**: roughly $3–4 of dev-scale model calls in all (estimated, not reconciled), most of it the 152,000-word PDF's cache
  write.

## Code review

GPT Sol, write-capable, on `29ec8f2d`:
[260928c-referee-claims-fail-on-long-pieces-code-review-sol.md](260928c-referee-claims-fail-on-long-pieces-code-review-sol.md)
— **ship with the fixes made**. Its fixes were read, re-gated (typecheck; the twelve affected test
files, 215 tests) and one mutation re-run, then committed as its own commit:

- **C1 (P1)** — the `[ai-no-room]` sentence still guessed at a cause (*"working out its answer"*)
  that `saidNothing` cannot know, since some callers receive tool-call deltas and none pass usage
  in; and `blocked` was too strong given 2.4× variance on identical input. Now it says only that the
  room ran out before any text, and it is `retry`. **Every caller of `saidNothing` now offers Retry
  on this code**, which none did before.
- **C2** — the eval's prompt ablation still sent 12,000, which would confound prompt with budget;
  it imports `CLAIMS_MAX_TOKENS` now.
- **C3** — `ReasoningEffort` lacked `xhigh` and `max`.
- **C4** — the child-process test ran the `tsx` CLI (needs an IPC socket) and accepted a child that
  logged and then crashed; it now runs `node --import tsx` and requires a clean exit.
- **C7** — the postmortem said the table *stops* the next instance; it forces the decision, and
  does not prove the decision good.

Not fixed, and left open deliberately:

- **C5 — a trickling stream now takes longer to fail.** The stall clock resets on every raw read,
  keepalives included, so a connection that trickles without progress waits out the whole deadline —
  now 181 s for a criterion where it was 60 s. The right fix is a clock on *progress* (content or
  reasoning tokens), not on bytes, and it belongs in `sseChunks` for every caller, not here.
- **C6 — a model override that does not support `reasoning` now fails closed.** With
  `require_parameters: true`, pointing `SPIDERYARN_REFEREE_CLAIMS_MODEL` (or criteria's, or
  link-summary's) at a model with no reasoning control gets a refusal rather than an answer. That is
  the intended behaviour — an unleashed answer is the bug — and it touches no default.
