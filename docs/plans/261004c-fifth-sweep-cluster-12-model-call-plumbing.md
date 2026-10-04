# Fifth sweep, cluster 12: model-call plumbing

Up: [plans.md](../project/plans.md) ·
umbrella: [261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md)
(§ The clusters, row 12)

Five small items from the fifth codebase sweep, all in the code that sits between a feature and the
model gateway, plus one adjacent finding from a GPT Sol review (F11, queue item `qi-7mpz6n48`). The
evidence for each is in
[261003b-fifth-sweep-server-request-layer.md](../investigations/261003b-fifth-sweep-server-request-layer.md)
(R2, R3, R6) and
[261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md)
(X13a). Every grep below was re-run on 2026-10-04 against `origin/dev` at `6f7aadb85`.

None of these is a defect a reader has met. Two are latent hazards (R3, F11), one is reproduced
drift (R2), the rest are tidying whose point is that the next editor finds one thing, not two.

## The items, as they stand today

### R3: seven key pre-checks that read a key nothing uses

`src/converse.ts`, `explain.ts`, `quiz-mark.ts`, `search.ts`, `referee-claims-run.ts`,
`referee-criteria-run.ts` and `referee-mirror.ts` each open with:

```ts
loadEnvLocal();
const key = process.env.OPENROUTER_API_KEY;
if (!key) { line.error("OPENROUTER_API_KEY is not set — every … will fail"); throw new Error(NOT_CONFIGURED.message); }
```

`key` is never used again. The call goes through `src/ai-call.ts`, whose `apiKey()` reads the key
itself and throws the same `NOT_CONFIGURED` sentence. And `loadEnvLocal()` in a request path is what
`apiKey()`'s and `messagesClient`'s comments both forbid: a library that re-reads `.env.local` hands
back a key a test deleted on purpose, and a paid call follows. It is harmless today only because
`src/db/client.ts` calls it at import and it latches.

`src/transcribe.ts` has the same block but a different answer (a 503 and `[mic-not-set-up]`, which
the client reads). `src/embeddings.ts` § `apiKeyFromEnv` uses its key (it passes it to the gateway
as an override).

**Do:**

- Delete the seven blocks and their `loadEnvLocal` imports.
- `apiKey()` logs the operator's half once, in fixed words with nothing interpolated:
  `log("model").error("OPENROUTER_API_KEY is not set, so every model call on this wire will fail")`.
  Its comment, which says callers log this themselves, is corrected.
- `transcribe.ts` keeps its check and its 503, and drops `loadEnvLocal()`.
- `embeddings.ts` keeps its check and drops `loadEnvLocal()`; its comment, which says the reload is
  how every other caller gets the key, is corrected.

**What could go wrong, and the check for each:**

1. *A runner's `catch` rewrites the gateway's error.* The pre-check threw before any `try`; the
   gateway throws inside the call. So first, a characterisation test per runner, green on today's
   tree: with the key unset, each of the seven rejects with exactly `NOT_CONFIGURED.message` and
   makes no `fetch`. It must stay green after the deletion. If a runner's `catch` does rewrite it,
   that is a finding to fix in the runner.
2. *An entry point relied on the library to load `.env.local`.* A CLI, an eval or a script that
   reaches one of these nine modules without loading the file at its own edge and without importing
   `src/db/client.ts` would start answering "not set up" on a laptop. Swept before the deletion:
   every importer of the nine under `scripts/`, `evals/`, `tools/` and each module's own `main`.
   Any that relied on it gets `loadEnvLocal()` at its edge, which is where the rule says it belongs.
3. *The rule reaches two sites again.* A census test (red today, nine extra sites): the set of
   files under `src/` with an executable `loadEnvLocal()` call equals a short allowlist, each entry
   with its reason **and its count of calls** (`env.ts`, `db/client.ts`, `cli-ledger.ts`,
   `pdf-read.ts`'s CLI main). The count is Sol's F2: a set of file names alone would not notice a
   second call added inside a request function of a file already on the list.

The sweep for point 2 was run before building (a Sonnet subagent walking static imports, and Sol
independently over the 23 direct importers): **no entry point needs a new load.** Every one that
calls a model through these nine either calls `loadEnvLocal()` itself or reaches `src/db/client.ts`.
And for point 1: no runner's `catch` rewrites the error; all seven end in `throw explainAbort(err)`,
which returns the same error unless a clock fired. `tests/no-undeclared-spend.test.ts` lists the
seven as "presence check only"; those seven entries go, and its count is corrected.

### R2: two `Retry-After` parsers that disagree

`src/ai-call.ts` § `retryAfterMs(headers)` and `src/fetch.ts` § `retryAfterMs(header, now)`, same
name, both exported:

| header | ai-call | fetch |
|---|---|---|
| `0` | null | 0 |
| `1.5` | 1500 | 0 |
| `0x10` | 16000 | null |
| `-5` | null | 0 |
| a past HTTP date | null | 0 |

**Do:** one parser in a new leaf, `src/retry-after.ts`:
`parseRetryAfter(header: string | null, nowMs: number): number | null`. Both old functions are
deleted, not wrapped. Callers: `ProviderRefused` and `fetch.ts`'s `readBody`, plus
`src/structure-deepen.ts` (one import and one call; it is outside the cluster's file list, and it is
the only other caller of the export being deleted).

A leaf rather than `fetch.ts`, because `fetch.ts` is the page fetcher (DNS, undici, the blob store)
and the gateway should not import it for eight pure lines.

**The behaviour, decided on purpose:**

- Seconds are digits only (RFC 9110 `delay-seconds` is `1*DIGIT`). `1.5`, `0x10`, `-5` are not a
  number of seconds.
- Anything else is tried as an HTTP date. To stop V8's lenient `Date.parse` reading `1.5` as a day
  in 2001, a date must start with a letter (every HTTP-date form starts with a weekday name).
- **An HTTP date is UTC, including the form that does not say so** (Sol's plan review, F1).
  `Date.parse` reads the zone-less asctime form (`Sun Oct  4 12:00:30 2026`) in the machine's local
  time, so on a machine in London a wait of 30 s parsed as an hour ago. Both of today's parsers
  have this; the shared one reads that form as UTC. This is a second behaviour correction, beside
  the zero one. Tested for all three date forms under `TZ=UTC` and `TZ=Europe/London`.
- **A wait that is not positive is `null`.** That covers `0` and a date in the past. `null` already
  means "no usable instruction, use your own backoff" at every caller, and it is the safe reading:
  a `0` passed through makes `fetch.ts` retry at once, makes the width gate skip its cool-off and
  makes embeddings retry a 429 with no wait.

  What this changes for the three `fetch.ts` callers that used to see `0`: the page fetcher waits
  its jittered backoff (up to 4 s) instead of retrying at once; a bibliographic service that
  answers 429 with `Retry-After: 0` cools for the default 60 s instead of 1 s; link previews do not
  change (they already floor at ten minutes). `tests/fetch.test.ts` pins "past date → 0" today and
  is changed with this decision named in it.

  The option passed over: keep `0` as "the server said now" and make each caller floor it. It is
  more faithful to the header and it leaves five callers each needing to remember.

**Test first:** a table test over the five rows plus the ordinary ones (surrounding whitespace,
the three date forms in two time zones), red on both of today's parsers. And one caller-level
assertion that makes the zero decision executable: a bibliographic 429 with `Retry-After: 0` cools
for the default, not for a second.

### R6 and the product simplification: one `[ai-unusable]` sentence, in `messages.ts`

`CLAIMS_UNUSABLE` (`src/referee-claims-run.ts`) and `ANSWER_UNUSABLE`
(`src/referee-criteria-run.ts`) are two sentences sharing one code, outside the catalogue whose
"closed vocabulary" the Sentry allowlist relies on. Their comments still tell the next editor to
register the code, which was done on 2026-09-06.

Today:

> The model answered and none of what it returned could be found in the paper, so there is nothing
> to show. That is about the answer rather than about the paper, and asking again usually works.
> [ai-unusable]

> The model pointed at passages but did not give a usable answer about any of them, so there is
> nothing to show. That is about the answer rather than about the paper, and asking again usually
> works. [ai-unusable]

**Do:** one `ANSWER_UNUSABLE: ReaderFacingFailure` (`kind: "retry"`) in `src/messages.ts`, thrown by
both runners, and added to the list `tests/messages.test.ts` round-trips. The sentence:

> The model answered, but nothing it returned could be used, so there is nothing to show. That is
> about the answer rather than about the paper, and asking again usually works. [ai-unusable]

It is true of both: a Criteria row is dropped for a quote that is not in the paper, a block id that
does not exist, or no anchor at all, which is "could not be used" and not always "pointed at
passages". This is the tiny product simplification the umbrella assigned to this cluster.

`CLAIMS_UNUSABLE` goes. The stale "two mechanical steps" paragraphs in both runners and the "raised
outside this file" and "two sentences share one code" notes in `messages.ts` are rewritten to say
what is now true; the history of why it took four days stays, shortened. Pointers in
`src/web/ClaimsPanel.tsx`, `src/web/CriteriaPanel.tsx`, `src/routes.ts` (comments only),
`docs/project/referee-mode.md` and the two tests that name the constants follow the move.

**Test first:** `tests/referee-copy-is-about-the-model.test.ts` imports the one constant from
`messages.ts` (red until it exists), and a new assertion that both runners throw that exact
sentence.

### X13a: three unchecked `SPIDERYARN_PIPELINE_EFFORT as Effort` casts

`src/models.ts` § `effortFor`, `src/citations.ts`, `src/skim.ts`. A typo (`hgih`) or an empty string
goes to the provider as the effort.

**Do:** `EFFORTS = ["low", "medium", "high"] as const` in `models.ts`, `Effort` derived from it, and
one exported `pipelineEffortOverride(): Effort | undefined` that all three call. Unset or empty is
`undefined`. Anything else that is not one of the three **throws**, naming the variable and the
three values: it is a developer's knob, set on purpose for an eval, and a run that silently used
the default instead would be a wrong measurement.

**Test first:** unset, empty, each valid value, and `hgih` throwing; red on today's `effortFor`
for empty and for `hgih`. Each of the three call sites is tested for its own fallback, not only the
helper.

### F11: the gateway drops `usage` on a non-2xx answer

`openRouterJson` judges the status before it parses the body, so a 429 or 5xx whose body carries
`usage` leaves an unpriced error row. The image seam (`openRouterImage`) was fixed for exactly this
on 2026-09-03 and its comment says the JSON seam "has not been changed … a gap rather than a
decision". The streaming seam's `refuse()` has the same shape. Both are in `src/ai-call.ts`, so this
is inside the cluster's file set.

**Do:** the same order as the image seam, in both: read the body once, parse it, hand any `usage`
(and model and provider) to the meter, then judge the status. The body is still never quoted. The
other three seams (image, transcription, decisions) already do this.

One difference is kept on purpose (Sol's F3): the streaming seam's `refuse()` reads the body with
`.catch(() => "")`, so a refused stream whose body fails to read is still a `ProviderRefused` with
its status and its `Retry-After`. Copying the image seam literally would turn that into a transport
error. A characterisation test pins it: a 429 whose body rejects stays `ProviderRefused`, one error
record, no body text.

No non-2xx on this wire has been observed carrying usage, so this is a hypothesis about the provider
and a proof about our code: if one ever does, today's row is wrong.

**Test first:** a stubbed 429 whose body has `usage` with a cost; the spend record must carry the
cost. Red today on both seams.

## Stages

One stage per item, each committed green, in this order (ease and value together, and so that the
two edits to `apiKey`'s neighbourhood do not interleave):

1. R2, the one parser.
2. R3, the seven deletions, the two reloads, the census test.
3. F11, usage before status.
4. R6, one sentence in `messages.ts`.
5. X13a, the effort parser.

Then one GPT Sol code review over the whole cluster (it is small), the full gates, and the
umbrella's row updated.

## Not doing

- **A shared "require the key" helper for the runners.** The previous two sweeps proposed one; the
  key being unused makes deletion the whole fix.
- **Moving `transcribe.ts`'s check into the gateway.** Its 503 and its code are a different
  contract, read by the dictation client.
- **Two codes for the two unusable answers.** One sentence serves both, so one code is now correct.
- **Retrying on the OpenAI-shaped wire** (`qi-wwhdcejd`, from plan 261003m). A separate question
  with its own queue entry; nothing here changes when a call is retried.

## Questions for Greg

None that block. One to note in the debrief: the unified Referee sentence above is a (small) change
to words a reader sees.

## GPT Sol's plan review

[The review](261004c-fifth-sweep-cluster-12-plan-review-sol.md), verdict *change first*. Four
findings, all accepted and written into the sections above:

- **F1 (P1, pre-existing):** the zone-less HTTP-date form is parsed in local time. The shared parser
  reads it as UTC.
- **F2 (P2):** a census of file names cannot see a second call in an allowlisted file. It counts
  calls per file.
- **F3 (P2):** keep the streaming seam's tolerant body read when adding the usage read.
- **F4 (P3):** the X13a red cases were misnamed.

It also confirmed the entry-point sweep, that the unified sentence is true of both discard paths,
that `Meter.saw` overwrites rather than accumulates (no double count), and that the leaf module, the
census and the effort helper are each worth their keep.

## What landed

| Stage | Commit | Red first |
|---|---|---|
| 1, R2 | `8398d68a5` | the table failed 9 rows on the gateway's old parser and 11 on the fetcher's |
| 2, R3 | `7cc5c3cb1` | the census (13 files against 4) and the operator line (0 against 1); the seven no-key cases were green before and after |
| 3, F11 | `9dfdc96e5` | a priced 429 left `source: "none"` on both seams |
| 4, R6 | `17ac8705e` | both runners threw their old sentences |
| 5, X13a | `46b94d73f` | empty and `hgih` went through at all three sites |
| review fixes | `20507c82d` | below |

Built by an Opus subagent from this plan; I read the diffs and ran the gates.

**Decided while building, beyond the plan:**

- The census pins the *enclosing function* of each `loadEnvLocal()` call, not only a count per file,
  and reports an aliased import or a renamed re-export as a finding.
- F11 is one shared function, `meterBody`, used by `openRouterJson` and by `refuse`.
- `tests/messages.test.ts` needed no list edit: it round-trips every exported `ReaderFacingFailure`.
- `docs/project/copy.md` never named either constant, so it is unchanged.

## GPT Sol's code review

[The review](261004c-fifth-sweep-cluster-12-code-review-sol.md), verdict *land after these fixes*.
It ran eight mutations; the suite missed two, and it closed both.

- **F5 (P1, fixed by Sol):** the builder had widened the UTC rule to "append `GMT` to any date
  whose zone is not recognised", which broke a date naming some other zone. `GMT` now goes only on
  the complete zone-less shapes. Kept as written.
- **F6 (P2, fixed by Sol):** the census missed a renamed re-export. Kept.
- **F7 (P2, reported):** `evals/simple/probe.ts` offered a `max` arm that only ever worked through
  the unchecked cast. `Effort` never included `max` and no recorded run used that arm, so I removed
  it from the probe. Widening `EFFORTS` to four values is the option passed over: nothing in
  production asks for `max`, and the day an eval wants it is the day to add it, with its budget.
- **F8 (P2, fixed by Sol):** the no-key runner tests now also assert no *pending* spend entry.

One round. Nothing was overruled.

## Known and left

- With no key, a runner now logs two lines: the gateway's, which names the variable, and its own
  generic "no reply from …" failure line. Sol judged that acceptable; the first line carries the
  diagnosis.
- `docs/project/overseer-queue.md` row K ("one missing-key check for seven readers") is done by
  stage 2. The queue is the Overseer's; reported in the debrief, not edited here.
- No refusal on the chat wire has been observed carrying `usage`. F11 is a proof about our code.

## Gates

- `npm run typecheck`: green, on the tree merged with `origin/dev`.
- Full suite (`npm test`, in tmux, on the merged tree with the review fixes in): green, 1518 files
  passed and 1 skipped, 32,669 tests passed and 37 skipped, exit 0.
- `npm run check` was not run separately: it is the same suite again.

## Progress

- [x] GPT Sol review of this plan
- [x] Stage 1 (R2)
- [x] Stage 2 (R3)
- [x] Stage 3 (F11)
- [x] Stage 4 (R6)
- [x] Stage 5 (X13a)
- [x] GPT Sol code review
- [x] Gates, umbrella row, push
