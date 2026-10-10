# A stale Referee criterion overflow, and the calls one notch from it

Report: spya-hrfj6q (SPIDERYARN-READING2-GN, #540), filed by Greg 2026-10-09 on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz?mode=referee`. Queue item
qi-75r4ct5p.

**Status, 2026-10-10: built, after a Sol plan review that changed it (§ What the plan review
changed, at the end, which supersedes § The fix where they differ).**

> The answer was longer than there was room for, so it arrived incomplete and could not be used.
> Trying again sometimes gets one that fits. [ai-overflowed-no-ask]
>
> — the message Referee showed Greg, 2026-10-09

## What actually happened

**The failing call was five weeks old, and its cause was fixed twelve days before the report.**

Production, read-only:

- The article's one `referee_criteria` row (`spya-rzbb90`, kind `single`) is `status: error` with
  exactly that sentence, created **2026-09-05 07:04:49**. No `referee_claims` row exists, so Claims
  never ran here. (The hidden-text check can produce this code too, through `parseHits`, but the
  stored error is on the criterion row and the ledger names `referee-criteria`.)
- `ai_calls` holds the call: `referee-criteria`, `anthropic/claude-sonnet-5`, **2026-09-05
  07:04:52, 4,000 output tokens, 2,359 of them reasoning**, which was exactly the ceiling of the
  time. The JSON was cut off and `parseHits` reported `[ai-overflowed-no-ask]`.
- **No Referee model call was made on this article on 2026-10-09.** Greg opened the mode (the chat
  and dictation calls of 23:48–23:54 are the guide offering Referee, plan 261009x) and was shown
  the stored row.

That is the class [260928c](260928c-referee-claims-fail-on-long-pieces.md) fixed on 2026-09-28:
`max_tokens` covers thinking as well as the answer, and a ceiling sized for the answer alone loses
to an unleashed think. Criteria now sends `effort: "medium"` and 13,750 tokens (3,750 answer room
plus 10,000 thinking).

**Reproduced against today's code, it passes.** The local database has the same paper
(`m1-kuhn-spya-a2zrjb`, 2,046 blocks, 152,077 words; production has 2,030 blocks, 152,163 words,
which is a different extraction of the same PDF). Four runs through `runCriterionStream`, the
route's own function:

| criterion kind | model | results | output tokens | time |
|---|---|---|---|---|
| single | Sonnet 5.5 | 14 | 1,369 | 10 s |
| single | Sonnet 5.5 | 13 | 1,422 | 9 s |
| diverging | Sonnet 5.5 | 13 | 1,378 | 11 s |
| single | Opus 5.5 (high-powered) | 20 | 3,366 | 44 s |

The largest is 24% of the ceiling. The row's *Try again* (`CriteriaPanel.tsx`, `worthRetrying`)
re-runs it under today's budget, so the reader is not at a dead end. The panel just does not say
the error is from September.

Production since the fix agrees: the only stored `[ai-overflowed-no-ask]` rows are this one
(09-05) and one Claims row (09-03), both before 2026-09-28. No job's steps have ever stored the
overflow sentence.

## Where the same failure is still waiting

The brief asked whether other modes share the path. A sweep of every `ai_calls` purpose since
2026-09-28, peak output against the ceiling each call sends (a subagent mapped the ceilings
read-only), found that the stages sized by `budgetFor` with `THINKING_HEADROOM` are all under 55%.
**The risk is in the few request-shaped calls that still send a fixed, answer-sized ceiling and
leave thinking to the provider default**, which is the shape 260928c's postmortem named:

| job | ceiling | peak output | of which thinking | used |
|---|---|---|---|---|
| `debate`, per pass ([src/debate.ts](../../src/reception.ts) § `ANSWER_TOKENS`) and synthesis ([src/debate-themes.ts](../../src/reception-themes.ts) § `SYNTHESIS_ANSWER_TOKENS`) | 8,000 each | 7,839 (9,296 once, across web-search rounds) | up to 7,966 | **98%** |
| `search` ([src/search.ts](../../src/search.ts), `max_tokens: 4000`) | 4,000 | 3,739 | 1,632 | **93%** |
| `pdf-frontmatter` ([src/pdf-frontmatter.ts](../../src/pdf-frontmatter.ts) § `MAX_TOKENS`) | 2,000 | 1,673 | 748 | **84%** |

The synthesis call has overflowed before: its own comment records one debate in nine running out
at 2,000, and the fix was another answer-sized number. `CHAT_REASONING`'s `search` row says
"about 30% used", measured on an 8,290-word essay; production has since used 93%.

And **the early warning cannot see two of them.** `warnIfThinkingAteTheCeiling`
([src/ai-call.ts](../../src/ai-call.ts)) runs only at the end of `openRouterStream`. Debate and
pdf-frontmatter go through `openRouterJson`, so if either stops on `length` after thinking, nothing
names the cause. That is the postmortem's own title,
[*a lesson kept in a helper does not reach the other wire*](../postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md),
happening a second time.

Left alone: `chat` at 63% of its per-round 4,000 (it has its own truncation path, and 6,000 on
high power), `citations-find` (the 700 peak is almost certainly the 1,200 lookup, 58%), and `pdf`
at 54%.

## The fix

1. **Size each of the three as answer + thinking, through `budgetFor`, and leave effort alone.**
   Each keeps its `providerDefault` row and its answer room. Only a thinking term is added:
   - debate pass and synthesis: 8,000 answer + **16,000** thinking = 24,000 (twice the largest
     think seen);
   - search: answer room from `MAX_HITS` at criteria's measured ~150 tokens a hit, plus a quarter
     (3,750), + **6,000** thinking = 9,750;
   - pdf-frontmatter: 2,000 answer + **4,000** thinking = 6,000.
   `max_tokens` is a ceiling, not a purchase, so a run that thinks no more than today costs no more.
2. **Clocks that fit.** Search is the only one of the three with a deadline: 60 s, with
   `SEARCH_ORPHAN_GRACE_MS` 90 s asserted above it. The deadline becomes
   `deadlineFor(SEARCH_MAX_TOKENS)` (129 s) and the grace becomes deadline + 30 s, derived, the way
   260928c did for criteria. The 30 s stall clock, which is what catches a dead stream, does not
   move. Debate and pdf-frontmatter run inside a pipeline job with no per-call deadline. Their
   largest calls took 99 s.
3. **The warning on the other wire.** `openRouterJson` logs the same line when a chat-wire body
   comes back `finish_reason: "length"` with reasoning tokens spent. It reads only counts and
   names, never the text. `CHAT_REASONING`'s `search` and `debate` rows get the new measurements.

### The simpler option passed over

**Name an effort instead** (`medium`, as criteria and claims got). That leashes the thinking and
would let the ceilings stay small. But it changes what those features produce. Debate's row says
*"thinking is the job"*, and no one has measured Search or Debate at `medium`. A bigger ceiling
changes nothing a reader sees on any run that succeeds today, and only stops the runs that fail.
The effort question is worth an eval of its own and is not a fix for this report.

**Also passed over: date the stored error on screen** ("This failed on 5 September"). It would
have told Greg the row was stale. But it is a product change to how every Referee error reads,
not a fix. It is listed for Greg in the feedback note instead of built.

## Tests (each watched red first)

- Debate pass and synthesis request bodies carry `max_tokens` of 24,000, the named answer room
  plus thinking room, through `budgetFor` (red today: 8,000).
- Search's request carries 9,750, and `SEARCH_TIMEOUT_MS === deadlineFor(9,750)`. The orphan
  grace is above the deadline (the existing module-load assertion keeps doing that job).
- pdf-frontmatter's request carries 6,000.
- `openRouterJson` warns on a `length` + reasoning body, in a child process, because the logger
  is silent under `NODE_ENV=test` (`tests/referee-claims-no-room-log.test.ts`'s harness).

## Stages

1. The three budgets, the search clocks, and their tests.
2. The JSON-wire warning and its child-process test, plus the `CHAT_REASONING` row text.

Sol code review over both. Then the feedback note, `feedback-endings.ts` and the queue item.

## What the plan review changed

GPT Sol, read-only:
[261010f-plan-review-sol.md](261010f-plan-review-sol.md). The verdict was *build with changes*,
and the plan above was rebuilt around its findings.

- **F2 (P1) and F4: Debate is dropped from the fix.** Two 24,000-token Debate calls need 632 s of
  token time against a 360 s step reservation and a 740 s claim
  (`tests/jobs-lease-budget.test.ts` holds that invariant). And the 98% was never a fact about
  one generation. Split by `web_searches` in production: the **search-free synthesis peaked at
  2,045 of 8,000**, and the searching pass's 9,296 output is a total across the provider's
  internal search rounds. It *exceeded* the 8,000 ceiling and still finished `stop`, so the
  ceiling applies per round and the total cannot be compared with it. Debate has no proven risk.
  The new JSON-wire warning (below) will name the first real one. That is the right point to
  measure per round, not a reason to redesign its clocks now.
- **F3 (P2): a bigger ceiling is not behaviour-neutral at the provider default.**
  src/token-budget.ts records adaptive thinking that grew from ~26,000 to ~64,000 when given room.
  So each change was measured first, effort and budget together, and Search moved to an effort,
  not a bigger number alone:

  | Search on the 152,000-word Kuhn paper (local, Sonnet 5.5) | default | `medium` |
  |---|---|---|
  | "Where are the strongest objections to any theory?" | **overflowed** (2,454 thinking, 4,000 out, 27 s); then 19 hits, 1,986 out, 14 s | 11 hits, 1,150 out, 9 s; 12 hits, 1,298 out, 10 s |
  | "Where does the author compare theories…?" | **overflowed** (2,453 thinking, 27 s) | 15 hits, 1,303 out, 9 s |
  | "which theories make testable predictions…?" | 9 hits, 1,171 out, 9 s | 8 hits, 1,064 out, 8 s |
  | "Where does the paper discuss IIT?" | 1,901 out, no thinking, 13 s | — |

  Two of five default runs failed, and the reader waited 27 s for the failure. Every `medium` run
  thought for none and gave its first hit in about 2 s. `medium` returned fewer hits on the
  broadest query (11–12 against 19). That is the one cost, and it is named for Greg in the
  feedback note. Production's 1,632-token thinking peak shows the default thinks on real
  articles too.
- **pdf-frontmatter stays at the provider default with a modest thinking term** (2,000 + 2,000),
  not the planned 4,000. It is an ingest-time pass with no clock, it fails soft to the title
  ladder (`src/pdf-read.ts` § `frontMatterOrNothing`), and it has no fixture to measure an effort
  against. The JSON-wire warning covers it from now on.
- **F5: Mirror, Hidden text and Citations Find, not changed.** Mirror (2,000, provider default) has
  no production calls with output to measure, and it streams, so the existing warning already
  covers it. Hidden text's fixed 60 s deadline against a ceiling that grows with rows (Sol: ~100
  rows ⇒ 32,048 tokens ⇒ ~422 s of token time) is a real mismatch but a different bug. It is not
  an output overflow, and it is written up as follow-up work rather than folded in here.
  Citations Find's 700 is a total across web-search rounds, like Debate's.
- **F1:** the Hidden-text sentence was wrong. It *can* produce `[ai-overflowed-no-ask]` (it calls
  `parseHits` with the fixed-ask default), though not on this article. The production reads were
  counts and timestamps, in `begin read only`, from a scratch script since deleted. Its queries
  and results are the tables in this doc.
- **F6:** Search's deadline is `deadlineFor(SEARCH_MAX_TOKENS)` = 129 s, and the orphan grace is
  derived at +30 s = 159 s. Nothing else is tied to 60 s. At `medium` the measured runs finished in
  8–15 s, so the longer deadline fires only on a run still writing.
- **F7:** the warning is called from `openRouterJson` after `meterBody` (which reads the
  reasoning count), only when `wireOf(job) === "chat"`, because embeddings share the entry point
  and have no `choices`.
- **F8:** the tests pin the orphan grace exactly (`=== SEARCH_TIMEOUT_MS + 30_000`), the ceilings
  as `budgetFor(answer, thinking)` of exported terms, the effort, and in a child process the
  warning's job, ceiling, reasoning, output and effort. The test also checks that a clean `stop`
  does not warn and that the answer's text never reaches the log.

## What landed

- **Search** ([src/search.ts](../../src/search.ts)): `CHAT_REASONING.search` is `medium`.
  `SEARCH_MAX_TOKENS` = `SEARCH_ANSWER_ROOM` 3,750 + `SEARCH_THINKING_ROOM` 6,000 = 9,750 through
  `budgetFor`. `SEARCH_TIMEOUT_MS` = `deadlineFor` = 129 s, and `SEARCH_ORPHAN_GRACE_MS` = +30 s
  ([src/routes.ts](../../src/routes.ts)). The stall clock is unchanged at 30 s.
- **pdf-frontmatter** ([src/pdf-frontmatter.ts](../../src/pdf-frontmatter.ts)):
  `FRONT_MATTER_MAX_TOKENS` = 2,000 + 2,000 through `budgetFor`.
- **The warning on both wires** ([src/ai-call.ts](../../src/ai-call.ts)):
  `warnIfThinkingAteTheCeiling` takes a finish reason, and `openRouterJson` calls it for
  chat-wire bodies.
- **Tests, each watched red first:** `tests/search-stream.test.ts` (effort, budget, deadline,
  grace), `tests/pdf-frontmatter.test.ts` (budget), `tests/json-wire-thinking-ceiling-log.test.ts`
  (new, child process), and `tests/chat-reasoning.test.ts` (search's row is `medium`; the
  override check moved to `quiz-mark`, still a provider-default row).
- **Not changed:** Criteria (the reported call). Its 2026-09-28 budget passed four of four runs
  on the same paper, and its *Try again* re-runs under that budget.

## Follow-up, not done here

- **Hidden text's 60 s deadline is fixed while its ceiling grows with rows**
  (`src/referee-hidden-check.ts` § `outputTokensFor`, Sol F5). Either cap the rows sent to what the
  deadline can serve, or derive the deadline. It is a timeout, not an overflow, and it needs its
  own measurement.
- **A stored Referee error carries no date on screen.** Greg read a five-week-old failure as a
  current one. Showing *"failed on 5 September"* would be a product change to every Referee error
  row, so it is a question for Greg, asked in the feedback note.

## Code review

GPT Sol, write-capable: [261010f-code-review-sol.md](261010f-code-review-sol.md). Its verdict was
*do not ship* until two things were done. Both are now done:

- **C1 (P2): Chat's `search_article_meaning` shares the `search` job**, so it inherits `medium`
  and the 9,750 ceiling under its own 45 s `MEANING_TIMEOUT_MS`. Kept, and the reason is written at
  the constant ([src/chat-tools.ts](../../src/chat-tools.ts)). It is one tool inside a chat turn
  with its own budget. At `medium` the measured searches took 8–15 s, and the runs the 45 s clock
  used to cut short were the default's thinking ones (27 s just to fail). So the change makes the
  tool *more* likely to finish. chat-tools.md's stale "20-second … `TOOL_TIMEOUT_MS`" is corrected.
- **The database-backed `tests/store-wiring.test.ts`**, which Sol's sandbox could not reach, was run
  here and passes, with the other targeted suites (275 tests), typecheck, and lint on the touched
  files (pre-existing complexity infos only).
- Sol's own fixes, read and kept: stale "4,000" and "search is provider-default" comments in
  src/models.ts and src/ai-call.ts, ai-gateway.md's "the warning is stream-only", a wire check
  that `require_parameters` goes with `medium`, and the JSON-warning test now also proving that
  the returned body is unchanged and that embeddings never warn.
