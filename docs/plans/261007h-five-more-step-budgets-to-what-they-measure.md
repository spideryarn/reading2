# Five more step budgets to what they measure

2026-10-07. Builder: Claude (Opus), for the Overseer. Item C6 of
[261007g § Review status](261007g-raise-the-images-and-fetch-step-budgets-to-what-they-measure.md#review-status),
by 261007g's method. The Overseer ruled this class "a bug, not a choice … no need to ask Greg".

## The bug

`STEP_BUDGET_MS` (`src/jobs.ts`) admits a step after an earlier one in the same claim only if
`deadlineAt − now ≥ STEP_BUDGET_MS[next]`. Since 2026-10-07 a product that arrives after our 740 s
deadline is discarded and the step repeats, spending a `REQUEUE_BUDGET` window. Five rows were under
their step's measured production maximum, so each could start on a remnant it could outlive.

## Measured

`revision_step_runs`, production, `status = 'done'` and `attempt_id is not null` (rows the step ran
in that revision), deduplicated; inside `begin read only … rollback` through `.env.prod`'s
`spideryarn_app` URL, durations and counts only. Seconds.

| step | n | min | median | p90 | p99 | max | old row |
|---|---|---|---|---|---|---|---|
| `ideas` | 37 | 32.6 | 95.7 | 159.0 | 325.2 | **357.8** | 120 |
| `tweets` | 28 | 8.1 | 24.9 | 78.8 | 107.0 | **114.7** | 90 |
| `sketch` | 25 | 49.6 | 142.7 | 244.8 | 319.2 | **335.6** | 240 |
| `debate` | 18 | 36.2 | 77.5 | 114.5 | 154.0 | **161.6** | 120 |
| `illustrated` | 15 | 191.0 | 291.9 | 483.0 | 705.0 | **739.3** | 600 |
| `quotes` (precedes `ideas`) | 42 | 7.6 | 24.2 | 43.5 | 50.2 | 51.2 | 240 |

One more run each for `ideas`, `tweets`, `sketch` and `debate` than 261007g counted, a later read
of the same table; the maxima are unchanged. As there, a run that overran and was paused leaves no `done` row.

**Which of them follow another step in one claim.** Read from the code, not the `jobs` table (it
holds 21 rows, current ones only): Skim's job is `["quotes", "ideas", "skim"]`
(`src/auto-mode-steps.ts`), and Illustrated's chain is `["sketch", "illustrated"]`
(`src/web/useIllustrated.ts`). `tweets`, `debate` and `sketch` are queued alone or first by the
client, by a reset (`src/store/pg-revisions.ts`, one step per job) and by a publication; only a
hand-written `POST /api/jobs` puts a step before them.

## The clocks

None of the five has a wall clock of its own:

- `ideas`, `tweets`, `sketch` and the `illustrated` brief are one `streamMessage` call each. It sets
  no timer; the SDK's 10-minute timeout covers the fetch up to the response headers only
  (`@anthropic-ai/sdk` 0.120 `fetchWithTimeout`). Transport retries happen only before
  `message_start`, with backoffs of ~0.5 s and ~1.5 s (±25 %).
- `debate` is up to three `openRouterJson` calls in sequence (two search passes and the synthesis), each a
  `fetch` with no timeout, each re-asked whole up to `TRANSPORT_ATTEMPTS` on a transient failure,
  and the searches run inside the provider.
- `illustrated` then makes up to `MAX_PLATES` (4) image calls in sequence, also unclocked.

What the code does state is each call's `max_tokens`, and `deadlineFor` (`src/token-budget.ts`) is
this repo's conversion of that into time: tokens ÷ 95 a second × 1.25. It is the rule the quiz row
already uses. So the admission estimate here is the full-token time of the largest request the step can
make. This is not a time ceiling. The 95/s was measured on Sonnet 5; all five steps can also
select Opus via High-powered AI, whose rate is not measured here. Prefill, provider waits,
slower streams and failed-request time are outside the conversion. Stream retries stop at
`message_start`, but failed requests can take far longer than their short backoffs. Debate can
retry whole calls, so its 318 s estimate covers one attempt per call, not all attempts; synthesis
is skipped if too few rows survive.

| step | largest `max_tokens` | token time |
|---|---|---|
| `ideas` | `budgetFor(ideasAnswerTokens(MAX_IDEAS = 10))` = 44,600 | 587 s |
| `tweets` | `budgetFor(threadAnswerTokens(15))` = 42,600 | 561 s |
| `sketch` | `budgetFor(SKETCH_ANSWER_TOKENS)` = 52,000 | 685 s |
| `debate` | 8,000 × 3 calls | 3 × 106 = 318 s, plus searches |
| `illustrated` brief | `budgetFor(ILLUSTRATED_ANSWER_TOKENS)` = 72,000 | **948 s**, plus plates |

## What changes

- `ideas` 120 → **600 s**: 13 s over 587 s. Still admitted after production's worst `quotes`
  (51.2 s leaves 688.8 s before other claim overhead). Hands back if total elapsed claim time
  exceeds 140 s, including setup, reads and settlement, not only Quotes runtime.
- `tweets` 90 → **600 s**: 39 s over 561 s.
- `sketch` 240 → **700 s**: 15 s over 685 s; also this table's usual maximum.
- `debate` 120 → **360 s**: 42 s over the single-attempt token estimate, as unmeasured slack for searches and backoffs. No ceiling exists to
  derive; said so in the row.
- `illustrated` 600 → **700 s**, a reservation. The brief's full-token time estimate alone exceeds a claim, so it is not
  stretched and nothing is capped. At 700 s every measured Sketch run before it (fastest measured
  49.6 s, leaving 690.4 s) hands back, and `illustrated` waits for a fresh claim where it is the
  first step and runs ungated with the whole 740 s. A current Sketch, skipped in seconds, still
  admits it in the same claim. At 600 s it admitted Illustrated with at most 140 s of total claim time spent; at 700 s,
  with at most 40 s spent. Faster, unmeasured Sketch runs can still be admitted. Only chains
  spending over 40 s and at most 140 s gain a hand-back; slower chains already handed back.
  Release costs no requeue window. The browser immediately asks again; if capacity is busy it
  retries after one second, with exponential backoff up to eight seconds
  (`src/web/jobEngine.ts`).

To derive the floors from the code, the inline token sizing moved into exports the steps now call:
`ideasAnswerTokens`, `threadAnswerTokens`, `SKETCH_ANSWER_TOKENS`, `ILLUSTRATED_ANSWER_TOKENS`.
`debate`'s were exported already.

**The simpler option passed over**: each row at its measured production maximum with a margin, as
the older rows did (e.g. `ideas` 450 s). Fewer hand-backs, but a number the step's own `max_tokens`
already says it can exceed, which is 261007g's "knowingly under one of the step's own costs".

**Out of scope, unchanged**: the lease, `REQUEUE_BUDGET`, Stop, every other budget, `src/web/`.

## Open design question: Illustrated outlasts a claim

Production's worst `illustrated` step runtime was 739.3 s, only 0.7 s below a fresh claim's
nominal window, before setup, reads and settlement overhead. It does not prove completion inside
the deadline. The brief's estimated full-token time alone is 948 s. A larger budget cannot help (none at or over 740 s is ever satisfied), and
extending the claim beyond the host's current window needs `vercel.json`'s `maxDuration` raised first. The levers are inside the step: a cap
on plates or on the brief's answer per request, or splitting the brief and the plates into two
steps so each gets its own claim. Not decided here.

## The test

`tests/jobs-lease-budget.test.ts`, six cases (including the open-defect pin), floors built from the steps' exported sizing and
`budgetFor`/`deadlineFor`:

- `ideas`, `tweets`, `sketch`: budget ≥ the token time of the largest request, and < the claim.
- `debate`: budget ≥ 2 × `deadlineFor(ANSWER_TOKENS)` + `deadlineFor(SYNTHESIS_ANSWER_TOKENS)`,
  and < the claim. A floor only; the searches are not in it.
- `illustrated`: an exact `PINS AN OPEN DEFECT` witness of the brief's 948 s full-token time
  estimate and the 740 s claim, following `tests/adversarial-shapes.test.ts`. A changed estimate,
  including a larger one, demands reassessment; once fixed, replace the pin with the desired
  fit assertion and account for plates. Separately, budget > claim − 49.6 s (the fastest measured
  Sketch); < the claim. That reservation guard covers the recorded sample.

The cases assume `budgetFor`'s default thinking headroom, which all four call sites pass.

**Red first**: all five failed against the old rows (120 000 < 587 000; 90 000 < 561 000;
240 000 < 685 000; 120 000 < 318 000; 600 000 ≤ 690 400).

**Mutations**, each alone and put back: ideas per-idea tokens 420 → 620, red (614 000);
(420 → 520 stayed green at exactly 600 000, the headroom); thread per-post tokens 140 → 400, red
(612 000); `SKETCH_ANSWER_TOKENS` 14 000, red (711 000); `SYNTHESIS_ANSWER_TOKENS` 20 000, red
(476 000); `ILLUSTRATED_ANSWER_TOKENS` 10 000, the original tripwire red (658 000 < 740 000);
`illustrated` 690 000, red.

## Code-review corrections

The time conversion is an admission estimate at a measured Sonnet rate, not a ceiling for Sonnet,
Opus, retries or Debate's provider searches. The comments and owning doc now say so. Handoff
thresholds refer to total claim time, and “every Sketch” is limited to the recorded sample.
The 739.3 s measurement is step runtime, not evidence of finishing inside a 740 s claim.

The Illustrated tripwire is now an exact open-defect pin, separate from the reservation guard.
**Red-first evidence:** temporarily raising only `ILLUSTRATED_ANSWER_TOKENS` from 32,000 to
33,000 left the original test green (961 s still ≥ 740 s). The exact pin failed with
961,000 ≠ 948,000; the mutation was removed. No token size or budget changed in review.

The reviewer also restored all five pre-change rows temporarily: exactly the five reservation
cases failed; Tier 0 stayed green. All five rows were then put back.

## Review status

GPT Sol reviewed the code (prompt
[261007h-…-code-review-prompt.md](261007h-five-more-step-budgets-to-what-they-measure-code-review-prompt.md),
answer [261007h-…-code-review-sol.md](261007h-five-more-step-budgets-to-what-they-measure-code-review-sol.md)).
**Verdict: ship with these fixes applied.** Its fixes landed as one commit after the build, and
were checked by hand: raising `ILLUSTRATED_ANSWER_TOKENS` by 1,000 turned the new pin red
(961,000 ≠ 948,000), then it was put back.

- **C1 — left, for the owner.** Illustrated's brief alone can take longer than a whole claim (948 s
  estimate against 740 s), before any of its image calls. The 700 s reservation stops it starting
  on a remnant; it cannot make the step fit. The options are a cap on plates or on the brief's
  answer per request, or splitting the brief and the plates into two steps, each with its own
  claim. Not decided here — see § Open design question above.
- **C2 — fixed.** The old Illustrated tripwire stayed green as the estimate got worse. It is now an
  exact `PINS AN OPEN DEFECT` witness, in `tests/adversarial-shapes.test.ts`'s convention, beside a
  separate reservation guard.
- **C3 — fixed (wording).** Token time is an admission estimate at the measured Sonnet rate, not a
  ceiling: Opus, provider waits, slower streams and failed attempts are outside it, and Debate's
  42 s is unmeasured slack. The comments, this plan and `ingest-queue.md` say so.
- **C4 — fixed (wording).** "Every real Sketch" is limited to the measured sample, thresholds are
  total claim time, and 739.3 s is step runtime, not proof of finishing inside a claim.
- **C5 — accepted, recorded.** The newly deferred starts (Ideas after 140–620 s spent, Illustrated
  after 40–140 s, and the cases only a hand-written job reaches) are the right trade; a hand-back
  spends no requeue window.
- **C6 — no defect.** Every moved token size is the one its production call uses, and the 587,
  561, 685, 948 and 318 s estimates are correct.
