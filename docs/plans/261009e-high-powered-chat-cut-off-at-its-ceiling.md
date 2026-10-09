# High-powered chat cut off at its ceiling

A bug found by an investigation, not a reader report, so no feedback note. Fixed under Greg's
standing rule:

> You are definitely authorised to fix bugs any time you notice them
>
> — Greg, 2026-10-09

[261009a](../investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md) said
Opus's critical chat answer on *Entropy* *"was cut off at production's 4,000-token chat
ceiling"*, and that High-powered chat ([high-powered-ai.md](../project/high-powered-ai.md)) runs
Opus at `high` against the same ceiling. The worry: a reader sees an answer that simply stops,
which looks like finishing.

## What looking found

Three things, and the first changes the picture.

1. **The eval's cut-off was mostly a harness artefact.** Its saved answer
   (`evals/results/digest-2026-10-09/entropy-24-00930-spya-pywwkq/chat-q2/A-opus.json`) spent
   **102** tokens thinking and the other ~3,900 writing twenty-odd `<invoke name="web_search">`
   blocks out as text, because chat's prompt names tools the eval never sent — the same artefact the
   investigation already set aside for Sonnet on Seth. Opus's five other chat answers, at `high`,
   used **1,195–1,825** of the 4,000 (502–1,117 of it thinking). So 4,000 is not routinely too
   small for Opus. It is still thin: on Sonnet 5 a single tool round once spent **4,550** tokens
   thinking before writing a word (`src/converse.ts`, the comment on `max_tokens`), and Opus at
   `high` thinks harder than Sonnet at its default.

2. **Chat already tells the reader live — and forgets on reload.** `converse` computes
   `truncated`, the route puts it on the `done` frame and on the patch to `chatStore.finish`, and
   `ChatPanel` prints *"This answer ran out of room and stopped mid-sentence. Try again."* But
   `chat_messages` has no `truncated` column: the Postgres store neither writes it (`finish`,
   `messageRow`) nor reads it (`toMessage`). So after a reload — or on the reconnect path, which
   asks the store whether the answer finished — a cut-off answer reads as a whole one. Also
   `src/web/guide-acts.ts` treats a not-`truncated` answer as safe to act on. **This is the real
   bug**, and it is a class this file has met at least four times (`tools`, `passages`,
   `interrupted`, `help`): `src/store/pg-chat.ts` maps fields by enumeration, so a field it does not
   name is silently dropped.

3. **Explain on a high-powered article is the worse sibling.** Explain sends `max_tokens: 1500`
   (`src/explain.ts`), a high-powered article puts it on Opus at `high` (`wireEffort`), and a probe
   on 2026-10-01 already saw Opus stop on `length` at that 1,500 before it had written much
   (`src/dig-deeper.ts` § `DIG_ANSWER_TOKENS`). And explain stores a cut-off answer as a clean
   `done` — `Comment` has no field to say otherwise.

## What changes

| # | Change | Where |
|---|---|---|
| 1 | `chat_messages.truncated boolean not null default false`, written by `messageRow` and `finish`, read by `toMessage`, **reset by `retry`** (a clean finish omits the flag, so only the retry can clear an old `true`). Additive migration. | `src/db/schema.ts`, `drizzle/`, `src/store/pg-chat.ts` |
| 1b | The rollback export and its restore-side seeder name `truncated` — and `passages` and `interrupted`, which both were also dropping. | `src/store/export.ts`, `tests/helpers/seed-reader-state.ts` |
| 2 | **The class guard, twice.** A `Required<ChatMessage>` fixture, every value non-default, through `messageRow` → `toMessage`; and a `finish` patch typed `Required<Omit<ChatMessage, NotFinishable>>` through `begin` → `finish` → `load`, then `retry` → clean `finish` → the flag gone. A new field will not compile into either until it is listed; once listed, each fails until the store names it. Both seen red by deleting the line under test. | `tests/pg-chat-row-roundtrip.test.ts`, `tests/chat-truncated-stored.test.ts` |
| 3 | Chat's ceiling on the **high-power model**: **6,000**, else 4,000; Candidates keeps 12,000 on either. `chatCeiling(kind, model)`, keyed on the model like `wireEffort`. | `src/converse.ts` |
| 4 | Explain's ceiling on the high-power model: `DIG_ANSWER_TOKENS` (4,000), the figure already chosen for Opus at `high` on explain's own prompt. Standard stays 1,500. | `src/explain.ts` |
| 5 | Correct the investigation's sentence: the cut-off was the harness, the risk is smaller than it said. The eval harness's `CHAT_MAX_TOKENS` is relabelled as that day's value, kept so the run reproduces. | `docs/investigations/261009a-…`, `evals/digest/run.ts` |
| 6 | Postmortem naming the class. | `docs/postmortems/261009e-a-flag-the-store-did-not-keep.md` |

**Why 6,000.** This was 9,000 in the draft and GPT Sol rejected it (F4), rightly: the 4,550
tokens of thinking it was built on were a Candidates run, not a chat round, and 9,000 used in full
needs `deadlineFor(9_000)` = 119 s — the whole of `CHAT_TIMEOUT_MS`'s 120 s, which also has to
cover earlier rounds and their tools. The two limits on one stream are the ceiling and the deadline,
and the ceiling is only worth raising as far as the deadline can follow. `deadlineFor(6_000)` is
79 s, leaving room for a tool round first. And 6,000 is over three times the largest whole Opus chat
answer measured (1,825, with 1,117 of it thinking). It costs nothing unused: output is billed as
produced, and nothing reserves spend against `max_tokens` (`src/ai-call.ts` reads the ceiling only
into the length-stop warning). There is no production measurement to size it better: Sentry holds
no logs (searched 2026-10-09: zero log lines in 7 days), so `warnIfThinkingAteTheCeiling`'s line is
visible only in Vercel's short-lived runtime logs.

GPT Sol's alternative (F9) was to persist the flag and leave 4,000 until production shows a need.
Passed over because a high-powered reader's only remedy for a cut-off is the retry, which runs the
same call into the same ceiling; and the raise is free and bounded by the deadline argument above.

**Why 4,000 for explain on Opus**, not a new figure: explain's deadline (`EXPLAIN_TIMEOUT_MS`,
120 s) and the comment lease built on it (`COMMENT_ANSWER_LEASE_MS`) already cover a dug answer at
4,000 on Opus, and the probe that set `DIG_ANSWER_TOKENS` is the only measurement there is.
Compatible with both clocks; not shown safe by an eval (GPT Sol F5).

**Copy.** None changes. Chat's sentence already exists and is in plain words; it overclaims
"mid-sentence" when the cut fell inside a tool call (`src/types.ts` § `truncated` records that as
Greg's call) — left as it is.

## The simpler options passed over

- **Raise chat's ceiling for everyone.** Sonnet's answers used a third of 4,000; and the ceiling
  is per round, so the deadline would bind sooner for every reader. Keyed on the model instead,
  the way effort already is.
- **Leave the ceiling, only persist the flag** (GPT Sol's F9) — answered above.
- **Store `truncated` inside an existing JSON column.** The table is columns-over-JSON
  ([sql.md](../project/sql.md)), and `stopped` and `interrupted` beside it are booleans.

## Siblings — other streamed answers a reader watches

From a sweep of every request-path answer:

| Answer | On a `length` stop | Here |
|---|---|---|
| Chat — and Learn, Tutorial, Explore, Guide and Candidates, which share `converse` | flagged live; **lost on reload** | fixed (1, 2) |
| Explain (a comment's AI reply) | **stored as a whole answer** | ceiling raised on Opus (4); the flag is follow-up |
| Dig deeper | **stored as a whole answer** (explain's path), 4,000 on Opus | follow-up, with explain |
| Glossary asked-term | thrown, `GLOSSARY_CUT_OFF` | fine |
| Help chat | flagged, "This answer was cut short." | fine |
| Quiz / Learn marking | thrown, `MARK_CUT_OFF`; 1,200 on Opus at `high` may be tight | noted |
| Citations Investigate | thrown | fine |
| Link summary | thrown | fine |
| Search, Referee mirror / claims / criteria / hidden check | left to the JSON parse: a cut-off object fails and the reader is told; a `length` after the object closed is accepted | small gap, noted |
| Debate synthesis | rejects a `length` stop and fails the step | fine |
| Live conversation | `incomplete` maps to `aborted`; no dedicated notice, though partial audio may already have played; ceiling 32,000 | low risk, noted |

**The follow-up for Greg**: telling a reader an explain or dig-deeper answer was cut off needs a
field on `Comment`, a column, the store, the export and a sentence in the comment card — and
`src/explain.ts` and `src/term-lookup.ts` both record that sentence as a product decision. With
(4) in, the case is rarer; it is not gone.

**Found on the way, not fixed here:** `Meta.quality` (the PDF transcription checker's complaints,
`src/types.ts`) has no column and is not in `metaColumns` (`src/store/artifacts-pg.ts`), so it is
always absent after a Postgres round trip, while `src/feedback-article.ts` reads it. The same class,
in another stage's store — reported to Greg rather than reached into.

## Review

GPT Sol on the plan: [261009e-plan-review-sol.md](261009e-plan-review-sol.md), verdict REJECT. All
nine findings taken: F1–F2 and F7 are rows 1, 1b and 2; F3 the override tests; F4 and F9 the
change from 9,000 to 6,000 and its argument above; F5 the explain wording; F6 the eval label and
`src/models.ts`'s note; F8 the sibling table.

GPT Sol on the code: [261009e-code-review-sol.md](261009e-code-review-sol.md), APPROVE WITH
CHANGES MADE. It fixed four: `retry` also clears `editedAt`; the override tests now go through the
production seams (`SPIDERYARN_CHAT_MODEL`, `SPIDERYARN_EXPLAIN_MODEL`) rather than the eval-only
`model` argument; the rollback and restore tests assert `truncated`, `passages` and `interrupted`;
stale comments and docs corrected. It left two as wider than this change — explain's flag and
`Meta.quality`, both above. Its sandbox could not reach Docker, so the database suites were run
afterwards, outside it: green.

## Tests

- `tests/chat-truncated-stored.test.ts` — the route, a stubbed stream that stops on `length`:
  the answer comes back from `chatStore.load` with `truncated: true`. Red before (1).
- `tests/chat-truncated-stored.test.ts` also holds `finish`'s patch and the retry reset (2).
- `tests/pg-chat-row-roundtrip.test.ts` — (2).
- `tests/converse-ceiling.test.ts` — the request `converse` sends carries 6,000 on the high-power
  model, 4,000 on the standard one, 12,000 for Candidates on either; explain sends 4,000 on the
  high-power model and 1,500 on the standard one; and an explicit model override moves the
  ceiling with it in both directions, for both. Red before (3, 4).
