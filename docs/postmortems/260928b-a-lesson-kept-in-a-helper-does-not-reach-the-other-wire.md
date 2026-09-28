# A lesson kept in a helper does not reach the other wire

**2026-09-28.** Referee Claims failed on every attempt on an 8,000-word Noema essay, in production,
with *"the answer was longer than there was room for"* and *"ran out of room before it wrote
anything"*. Found by the plain-words session
([260926a](../plans/260926a-plainer-summaries-and-glossary.md)); fixed under
[260928c-referee-claims-fail-on-long-pieces.md](../plans/260928c-referee-claims-fail-on-long-pieces.md),
which has every measurement.

## What broke

The claims call sent Sonnet 5 through OpenRouter with `max_tokens: 12000` and no `reasoning` field.
With no effort named, the model thinks before it answers for as long as it likes, more on a longer
input — and **`max_tokens` covers the thinking as well as the answer**. On the essay it thought for
all 12,000 and wrote nothing, or for most of it and cut the JSON off mid-claim. Reproduced on the
first try from the committed fixture: `reasoning_tokens: 12000`, zero characters, `finish_reason:
"length"`, 127 seconds, $0.12.

## The root cause

Not the number 12,000. **The app already knew this, in a place this call could not see.**

On 2026-08-25 the hierarchy stage hit exactly this ceiling
([260826a-toc-max-tokens.md](260826a-toc-max-tokens.md)), and the lesson — *`max_tokens` is
thinking plus answer; effort is the leash* — was written down properly: into
[src/token-budget.ts](../../src/token-budget.ts) (`budgetFor`, `THINKING_HEADROOM`) and into each
pipeline stage's `output_config.effort`. Every one of those is on the **Messages wire**, the
pipeline's. Referee Claims was built a week later on the **chat wire**
(`openRouterStream` in [src/ai-call.ts](../../src/ai-call.ts)), which imports none of it. Its author
sized the ceiling carefully — the comment above it reasons from `MAX_CLAIMS` and `MAX_PASSAGES` —
and sized it for the JSON alone, because nothing on the path they were working in said otherwise.

It was never tested on a long piece: every test stubs `fetch`, and the eval's five papers are a few
hundred words each. The failure lived entirely in the gap between a short fixture and a long
article.

Two things made it slower to see than it should have been:

- **The log line said the wrong thing by omission.** The no-text line logged
  `finishReason: "length"` and nothing about where the tokens went, so it read as *the input was too
  big*.
- **So did the reader's sentence**, and more confidently. `saidNothing("length")` in
  [src/messages.ts](../../src/messages.ts) told every caller's reader the AI *"was given too much at
  once"* and to *"ask about a shorter stretch of the article"*. The input does not count against
  `max_tokens` at all, so the diagnosis was false for every caller, and the advice named a control
  that Claims, Criteria and Mirror do not have.

## The class

**A lesson kept in a helper does not reach the other wire.** A hard-won fact about how an external
system behaves gets written into the module that the code which first hit it happens to import. It
is documented well there, and it is invisible to the next caller, who goes to the same external
system by a different path. The fact is about the *model*; the fix was filed under the *pipeline*.

The test for whether you have one: *is this lesson true of the thing we call, or of the code that
called it?* If it is true of the thing we call, it belongs at the seam every call passes through.
Anything further in is somewhere a new caller can miss it.

A second instance was one notch away when this was found: Referee Criteria used 85–94% of its 4,000
ceiling on the same essay, 1,349–1,558 tokens of it thinking.

## Which commit

`9b636cc1` (2026-09-01, *"Three empty states, because two of them were the same lie told twice"*),
which introduced the claims run with `max_tokens: 12000`. `anthropic/claude-sonnet-5` was already
the model (unchanged since 2026-08-26) and no commit ever sent `reasoning` from that file. Nothing
changed to break it; it was broken from its first commit on any input long enough.

## The fix, and the right one for the long term

Shipped:

1. **Claims and Criteria name an effort, `medium`**, and size `max_tokens` as two named terms —
   answer room plus thinking room — through `budgetFor`, with a deadline derived from the ceiling
   (`deadlineFor`, [src/token-budget.ts](../../src/token-budget.ts)) so the two limits cannot
   disagree. At `medium` the essay's claims came back in about 50 seconds instead of failing, and a
   152,077-word PDF passed twice, using at most 40% of the ceiling.
2. **The effort is decided at the seam, for every chat job.** `CHAT_REASONING` in
   [src/ai-call.ts](../../src/ai-call.ts) is a `Record<ChatJob, …>`: each job either names an
   effort or says `providerDefault` with its reason. It is exhaustive, so a new job does not compile
   until somebody has decided. The gateway sends the row after the caller's body, and
   `AiRequestBody.reasoning` is `never`, so there is one place the decision lives. Every job that
   sent nothing before is `providerDefault`, so no other feature's behaviour changed.
3. **The gateway warns**, for any streamed chat job, when a stream stops on `length` having spent
   reasoning tokens, with the job and the ceiling. That is the line that would have named this bug
   the first time it happened.
4. **The reader's sentence is true now.** It says only that the allowance was used before this
   caller received text, without guessing whether the missing text was preceded by reasoning, a
   tool call or another non-text field. It is `retry`: reasoning varied 2.4× on identical input,
   and these fixed-ask callers offer the reader no narrower request.

**That is also the long-term shape**, with one thing left open: the budget arithmetic still lives
with each caller, which is right, since only the caller knows the shape of its answer. But a caller
that names `providerDefault` and sets a small ceiling is still possible. The table makes that a
written decision rather than an accident; it does not make it a good one. The warning is what
reports it when it goes wrong.

## What would have caught it, ranked by ease against value

1. **Say how hard the model thinks, at the seam, for every job** — done. It is the table above.
   Cheap, and the only one of these that forces the next caller to make the decision before it
   ships. It does not prove the chosen effort or budget is good; the measurements below do that for
   Claims and Criteria.
2. **Log reasoning tokens wherever a `length` is logged** — done centrally, and on the claims lines.
   It cost two fields and would have turned a day's confusion into one log line.
3. **Run one long article through any new whole-article call before it ships.** A habit rather than
   a check, and the one that would have caught this exact instance on the day it was built — the
   Noema essay is in the committed fixtures. Recommended, and written here rather than enforced: a
   test that makes a paid call cannot run in the suite.
4. **Push the thinking lesson out of `token-budget.ts` and into the gateway entirely** — have
   `openRouterStream` compute `max_tokens` from a declared answer size. Rejected for now: that is
   Sol's `openRouterArticleStream` (plan review F6), a second entry point into the gateway, and
   what the class needs is that the decision cannot be *absent*, which the table already gives.
   Revisit if a `providerDefault` row fails this way.
5. **Evals on long inputs by default.** Rejected as a rule: a long-input eval costs dollars per
   run, and the evals that exist are about prompt behaviour, which short papers test better. Item 3
   covers the gap more cheaply.

## Left open

- **Every `providerDefault` row but search is unmeasured** — explain (1,500), chat, quiz-mark,
  debate, candidates and the PDF reader among them. None has failed that we know of. The warning
  will say if one does. Measuring them is a one-call-each job, listed here rather than done,
  because changing their effort changes their answers and each wants its own look.
- **On the 152,000-word PDF, 7–8 passages per claims run were dropped as unquoted.** That is a
  quoting problem on long PDFs, not a budget problem, and it is not this fix's.
