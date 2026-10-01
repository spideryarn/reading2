# Simple's fidelity guard, built: check each level against its cited passages, retry once, record it

**Status as of 2026-10-01:** built; Sol's plan review taken (one P1 declined, below); one real press run.

Builds the guard that
[261001h § Measuring the guard](261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)
recommends, in the form that section ends on: *"check, retry once on a flag, and store the second
attempt whatever its verdict, recording that it was flagged. If the checker call fails or answers
unreadably, keep the current writer output unchecked and record the checker failure; do not spend
the writer retry."* Part of [summaries.md § Simple](../project/summaries.md#simple-a-plain-words-orientation).

The fault it is for: on the PID paper, Simple says synergy *"grows with more feedback loops"*,
borrowing the paper's name for the connection type that does the opposite. A prompt rule did not
make that rare enough (261001h). A quick-tier checker caught 24 of 30 hand-labelled faults, raised
alarms on 1–2% of paragraphs, and cost $0.0027 a press.

**Not in scope:** the Simple prompt, and the other summary voices. The guard is Simple's alone until
the Overseer says otherwise.

## What a press does now

```
   writer (one level) ──► validate ──fails──► ask again (attempt 2) ─┐
                             │ ok                                    │
                             ▼                                       │
     checker: every paragraph + the text of its own cited blocks     │
     one quick-tier call, one verdict per paragraph                  │
        │            │                    │                          │
      all ok      a "contradicts"     call failed / unreadable       │
        │            │                    │                          │
      store       attempts left?       store, unchecked              │
     (passed)     yes ─► ask again ───────────────────────────────────┘
                  no  ─► store anyway, flagged
```

The three levels still run side by side; each level's check follows its own writer call, so a press
waits roughly one checker call longer (4–5 s measured). **At most two writer calls and two checker
calls a level**, six of each a press: a flag's retry is a writer call and, if it validates, another
check.

- **One budget.** The guard shares `LEVEL_ATTEMPTS = 2` with validation. If validation used the
  first attempt, a flag on the second cannot buy a third writer call: the level is stored flagged,
  and the record says the budget was spent.
- **Fail open.** A checker that throws, times out, or answers in a shape we cannot read is not a
  verdict. The level is stored as written, recorded as unchecked, and the writer retry is not spent.
  261001h reverses its own earlier "fail closed" for this, on availability grounds; Luna had 0 such
  failures in 278 calls, so this path was not measured.
- **Never fails a press.** If the retry a flag bought fails — its call refused or broken, or its
  answer invalid — the flagged first attempt is stored, as it would have been with no guard, and the
  record says so (`stored: 1`). A writer failure with no flag behind it still fails the press, as
  today. (Sol's plan review, P1-1: the first draft of this plan claimed this without doing it.)
- **A job abort is still an abort.** The checker's own 30 s deadline is a failed check, stored
  unchecked; the job's signal, or a sibling level failing, is an abort, rethrown after the check.

## The checker

`src/simple-check.ts`, new. It holds:

- **The probe's system prompt, verbatim.** It names the class of fault, never this paper, and it was
  not tuned on the results. Changing it is a prompt change to be measured, so it carries its own
  version, `simple-check/1`, stored with each record.
- **The probe's user message**: `PARAGRAPH n`, the text, then `ITS PASSAGES` with each cited block's
  text, levels separated as in the probe. The block text is `block.text` of the same body-evidence
  blocks the writer saw.
- **A strict parser.** One verdict per paragraph, in order, `ok` or `contradicts`. Any other shape is
  "unreadable", which is a checker failure, not a pass and not a flag.
- **A deadline** of 30 s. The measured press p90 was 5.8 s and max 12.2 s.

**The call.** A new job, `simple-check`, on the quick tier (Luna today), through `openRouterJson` on
the chat wire with `reasoning: { effort: "low" }` and `max_completion_tokens: 4000` — the request the
probe measured through `link-summary`'s route, given its own name. Registered where every job is:
`AiJob`, its tier, its wire, its model-override env var (`src/models.ts`), its route policy and
reasoning (`src/ai-call.ts`, `link-summary`'s `require_parameters` and no `order`), its cost
category (the same as `simple`'s), and a `PLAIN_WORDS_EXEMPT` line, since a verdict is not reader
prose. High-powered AI does not move it, like `quiz-verdict`.

**Where its cost lands.** The call is made inside the `simple` step's collector, so every check is an
`ai_calls` row with `purpose = 'simple-check'`, attributed to the job, the step and the article by
`runStep`. Nothing to add.

## The record, and how to count it

There are three numbers to watch: how often a level is flagged, how often a flag buys a retry, and
how often the checker itself fails.

**The ledger already counts checks and transport failures**, through the purpose above: rows, cost,
latency, and `outcome` (`error`, `aborted`). It cannot count flags or unreadable answers, because a
row is written when the call ends, before anyone reads the answer, and is never amended. A verdict
column on `ai_calls` would mean amending it, or teaching the gateway about one caller's answer.

**So the verdicts go on the artefact itself**, as an optional `check` field of `SimpleSummary`:

```ts
check: {
  checker: "simple-check/1",          // the prompt version
  requestedModel: "openai/gpt-…-luna", // what was asked; ai_calls has what answered
  levels: { brief: LevelCheck, simple: LevelCheck, fuller: LevelCheck },
}

type LevelCheck = (
  | { result: "passed" }
  | { result: "flagged";   flags: { paragraph: number; why: string }[] }  // the stored text's
  | { result: "unchecked"; failure: "call" | "unreadable" }
) & (
  | { attempts: 1; retriedAfterFlag: false; stored: 1 }
  | { attempts: 2; retriedAfterFlag: boolean; stored: 1 | 2 }
);
```

- `attempts` is writer calls for that level, so a validation retry is visible too.
- `retriedAfterFlag` says the first valid attempt was flagged, and that bought another call.
- `stored` is which attempt's text was kept: `1` after a retry is the retry having failed.
- `flagged` with `retriedAfterFlag: false` and `attempts: 2` is the spent-budget case.
- The impossible combinations do not type-check, and `isUsableSimpleSummary` refuses a record that
  is present but not whole (Sol, P2-1), so a malformed audit record cannot pass as one.
- `why` is the checker's one sentence, kept for a person auditing a stored flagged level. It is never
  logged.

It lives where the artefact lives (the `simple_summary` column of `article_revisions`), published
revisions are kept, and so it is queryable with SQL for as long as the summary is. **A row without
`check` was written before the guard, or with it switched off.** That is how the two are told apart,
so the field is optional and `SIMPLE_VERSION` does not change: the paragraphs are the same shape,
and no stored summary becomes absent or outdated.

The visitor's copy (`publicSimpleSummary`, `src/public/dto.ts`) already picks its fields one by one,
so `check` never reaches a stranger. The owner's GET and their export carry it, which is fine: it is
about their own article.

**The counting.** `scripts/simple-check-report.ts`, read-only, prints over a date range: levels
checked, flagged on first check, retried, kept-first, stored flagged, unchecked by failure kind; and
from `ai_calls`, checker calls by outcome, their median latency and their cost a press. Its tally
(`tallyChecks`) is a pure function with a unit test; the script is the SQL around it. Run it against
production through `.env.prod`, inside a read-only transaction, as every production read is.

**What each source cannot see, and why that is enough here.** Sol's plan review (P1-2) pointed out
that the artefact is a snapshot: a re-run replaces the record on the same revision, and a press that
fails for another reason stores nothing. It asked for an append-only `simple_check_events` table.
**Declined, for now**: the brief was to use the existing cost-tracking path where one fits, and the
ledger covers most of the gap. Every checker call is an `ai_calls` row whatever happens to its
press, so the ledger counts checks, transport failures, latency and spend over *every* press; and
since an invalid answer is never checked, a level's second checker call exists only when a flag
bought a retry. What stays invisible is the verdict of a check whose press then failed or was
re-run — a survivor bias on the flag rate, small while presses rarely fail (22 of 24 stored all
three levels before the guard; the guard adds no failures). If the beta trial's numbers turn out to
need it, the table is the next step, and this paragraph is where to start.

The step's log line gains the same counts (never the `why`), as `dropped` already does.

## Accounting on the run

`SimpleSummaryRun` gets `checkCalls`, `checkInputTokens` and `checkOutputTokens`, **beside** the
writer's totals rather than added into them. The two are on different wires, and the chat wire counts
cache reads inside its input tokens while the Messages wire does not
([ai-gateway.md](../project/ai-gateway.md)); a sum of the two means nothing. `calls` stays the writer's.

## The switch

`SIMPLE_CHECK_ENABLED` in `src/simple-check.ts`, a `const` set to `true`. Setting it to `false` and
deploying turns the guard off completely: no checker call, no retry for a flag, no `check` field. It
is a code constant rather than an env var because changing either needs a deploy on Vercel, and the
constant is the one a reader of the code finds. Tests override it through an injected option on
`generateSimpleSummary`, not by flipping the constant.

## Tests, red first

In `tests/simple-summary.test.ts`, with `openRouterJson` stubbed beside the existing
`streamMessage` stub:

1. A level whose check passes is stored once, recorded `passed`, with one checker call per level,
   carrying each paragraph's own cited block text and nothing else.
2. A flag on the first attempt asks that level again; a pass on the second stores the second,
   recorded `passed` with `retriedAfterFlag`.
3. A flag on both stores the second, recorded `flagged` with its flags. The press succeeds.
4. Validation spends the first attempt, the check flags the second: stored, flagged, `attempts: 2`,
   no third writer call.
5. The checker throws: stored, `unchecked` / `call`, no writer retry. Same for an unreadable answer
   (`unreadable`), including a verdict count that does not match.
6. Switched off: no checker call and no `check` field.
7. The run's checker tokens are reported apart from the writer's.
8. `isUsableSimpleSummary` still accepts a row without `check`, and the public DTO drops it.

Plus the parser and the tally as pure functions, and the registration tests that already enumerate
every job (tier, wire, cost category, reasoning, override variable) going red until `simple-check`
is in each.

Added after Sol's plan review, in `tests/simple-check.test.ts`:

- **The real gateway against a stubbed `fetch`**: the body the checker sends equals, field for field,
  the body the probe sent through `link-summary`'s route, and names the parts the gateway adds:
  `reasoning: { effort: "low" }`, `max_completion_tokens: 4000` and no `max_tokens`,
  `require_parameters` with no `order`, the quick-tier model (P1-3).
- **The measured prompt pinned by hash**, so an edit to it goes red rather than quietly becoming an
  unmeasured checker.
- The deadline as a failed check, the caller's abort as a failed check that the caller rethrows, the
  flagged first attempt kept when the retry's validation or call fails, and malformed stored records
  refused.
- The default-on path is the ordinary one: most guard cases call `generateSimpleSummary` with no
  override, and a test pins `SIMPLE_CHECK_ENABLED` to `true`.

Each new test was seen red: the guard cases against a stub module before any code; the fallback,
transport, tally and validator cases by breaking the code they cover and watching them fail.

## One real press

`npx tsx evals/simple/probe.ts run --arm high-none-guard1 entropy-24-00930-spya-pywwkq` — production's
own `generateSimpleSummary`, guard on, on the PID paper. It stored all three levels; the ledger has
three `simple` rows and three `simple-check` rows, requested and answered by `openai/gpt-5.6-luna`,
3.1–4.7 s each, billed through BYOK (`byok_upstream_nanos`) at $0.0027 for the three — the probe's
figure. Writer spend $0.144. The probe does not save the `check` record, so this run says nothing
about the verdicts; the unit tests do.

## Passed over

- **A verdict column on `ai_calls`.** Simpler to query, but the ledger records a call when it ends
  and is never amended; putting one caller's answer into the gateway's write is the coupling the
  ledger was designed without.
- **A new table of guard events** (Sol's P1-2). Would also count the verdicts of failed and re-run
  presses. Not worth a migration and a second write path for a beta trial; see § The record.
- **Log lines only.** Not queryable a month later.
- **An env var switch.** Same deploy either way on Vercel, and less obvious in the code. (The job
  does have a model-override variable, `SPIDERYARN_SIMPLE_CHECK_MODEL`, because every chat-wire job
  must — `tests/models.test.ts` — but that changes the model, not whether it runs.)
- **Passing the checker's reason to the retry.** 261001h's first follow-up. It is a prompt change and
  needs measuring like one; the retry here is a fresh sample.

## Reviews

- Plan: [261001i-simple-fidelity-guard-plan-review-sol.md](261001i-simple-fidelity-guard-plan-review-sol.md).
  No P0. Taken: P1-1 (the flagged first attempt kept when its retry fails; deadline vs abort), P1-3
  (the wire-level test and the pinned prompt), and all three P2s (a validator and a type that refuses
  impossible states, the spend bound stated, `requestedModel`). Declined: P1-2's events table, for
  the reasons in § The record.
