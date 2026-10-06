# GPT-Live's backend report carries its terminal status (qi-p78m9ch9)

Queue item qi-p78m9ch9, from GPT Sol's finding F30 in
[261006f's plan review](261006f-plan-review-sol.md). Up:
[plans.md](../project/plans.md) · area doc:
[live-conversation.md](../project/live-conversation.md).

## The bug

GPT-Live is the second live-conversation engine: a voice model that hands questions to a text
model (the *backend*). Each backend response is billed in tokens, and the browser reports those
tokens to `/api/live/:sessionId/usage` as a `backend` report, which becomes one `ai_calls` row.

A backend response can end three ways on the wire: `response.completed`, `response.failed`,
`response.incomplete`. All three carry `usage`, and the browser reports all three
(`ended()` in `src/web/live/gpt-live/delegations.ts` forwards the usage of a failed one). But the
report has no status field, and `backendRow` in `src/live.ts` writes `outcome: "ok"`,
`providerStatus: "completed"` for every one. So a failed or cut-short backend response is in the
ledger as a success, and the failure counts on `/admin/costs` cannot see it.

## The fix

Carry the status the wire gave, end to end, and map it the way Realtime's `response` rows already
are mapped.

1. **`delegations.ts`**: the `usage` effect gains `status: "completed" | "failed" | "incomplete"`.
   `completed` from `response.completed`; `failed` from `response.failed` and from a nested
   `error` that somehow carries usage; `incomplete` from `response.incomplete`. Read off the
   event type, not off `response.status`, because the event type is what the reducer already
   branches on and the two cannot then disagree.
2. **`meter.ts`**: `backendReport(responseId, usage, status)` puts `status` on the report. The
   browser's `GptLiveUsageReport` and the server's `GptLiveUsage` stay pinned to each other by
   the two-way type check in `tests/gpt-live-meter.test.ts`.
3. **`src/live.ts`**: `parseLiveUsage` reads `status` for a `backend` report: one of
   `completed`, `failed`, `incomplete`, or absent. Anything else is refused with a 400.
   `backendRow` maps it through the existing `REALTIME_OUTCOME` (`failed` → `error`,
   `incomplete` → `aborted`), writes the raw value to `provider_status`, and sets
   `failure_class: "abort"` on an `aborted` row, exactly as a Realtime response row does since
   261006f.
4. Docs: one sentence in `live-conversation.md` under the `backend` bullet.

### The one judgment call: a report with no status

A tab opened before the deploy keeps running the old code and sends reports with no `status`.
Three choices:

- **Refuse it (400).** The browser stops retrying a 400, so the row, and its cost, is lost. No.
- **Treat it as `completed`.** That is today's bug, kept for old tabs.
- **Accept it, `outcome: "ok"`, `provider_status: null`.** Chosen. The cost is counted, and the
  null says "not reported" instead of claiming a status nobody sent. `outcome` has no "unknown"
  value and is not being widened for a case that ends when the old tabs close. The type is
  `status: BackendStatus | null`, so the new browser always sends one and only the parser makes
  a null.

### Simpler option passed over

Stop reporting usage for failed responses. One line, but it throws away money OpenAI billed,
which is the other thing the ledger is for.

### Not doing

- No migration: `provider_status` is free text and the outcome column already has the three values.
- Old rows are not rewritten; a failed backend response before this stays `ok / completed`.
- No reader-facing change, so no browser pass: the report is a background POST and the row is
  read by `/admin/costs` and the cost CLI, whose folds already handle `error` and `aborted`
  realtime rows.
- **What still gets no row** (G3): a terminal event with no usable usage, a backend response still
  running when the reader hangs up, a top-level session error, and a nested `response.cancelled`
  if that wire ever sends one (nothing here has seen it). This fix is about the handled terminal
  events that carry usage, and no more.
- **Old tabs still hide failures** (G5): a statusless row is `ok`, so the failure counts stay
  short by whatever old tabs failed, until those tabs close.

## Tests, each red first

- `tests/gpt-live-delegations.test.ts`: the `usage` effect of a failed response says `failed`,
  of an incomplete one `incomplete`, of a completed one `completed`.
- `tests/gpt-live-meter.test.ts`: `backendReport` carries the status and `parseLiveUsage` takes
  it as built.
- `tests/realtime-usage.test.ts`: a `failed` backend report builds an `error / failed` row, an
  `incomplete` one `aborted / incomplete / abort`, a statusless one `ok / null`; a status outside
  the three is refused. Cost is priced the same in every case.
- `tests/gpt-live-session-flow.test.tsx`: a `response.failed` with usage posts a report whose
  status is `failed` (the seam between the reducer and the meter, which is where the status was
  dropped).

## Review notes

GPT Sol's plan review is [261006g-plan-review-sol.md](261006g-plan-review-sol.md): build with
changes. All five findings checked against the code and accepted.

- **G1, fixed.** A nested `error` (no usage) followed by `response.failed` (usage) for the same
  response dropped the usage, because the reducer returned early on a dead response. A response
  now carries `billed`, apart from its tool `state`, and a dead, unbilled one is billed by the
  later event without being revived. Red first. The code review tightened the marker to
  **reportable** usage; an object with missing or invalid totals does not consume it (H1).
- **G2, fixed by the same flag.** A response that completed with tools still running and then
  failed emitted usage twice, with two statuses, under one ledger id; which one landed depended on
  which POST arrived. Now the first terminal event with reportable usage bills it, once. Red first.
- **G3, G5**: the two bullets added under Not doing.
- **G4**: tests added for a nested error with usage, and for an event type that disagrees with
  `response.status` (the event type wins). Both passed on arrival: characterisation, not red.
  Also never red, as Sol says: the cost-equality and same-row-id assertions, and the
  Postgres-backed route test, which was written after the fix.

The code review also fixed late usage on repeated completions without replaying tools or finals
(H2), refused an explicit `undefined` status while retaining an absent key (H3), and narrowed the
comments and area doc to handled events with usable totals (H4). Five new regression assertions
were seen red, then all four database-free files passed: 169 tests. Typecheck and scoped lint passed.
The review could not rerun the Postgres-backed route suite. The accounting marker's root cause is
recorded in [the postmortem](../postmortems/261006j-deduplication-before-validation-can-discard-the-first-usable-report.md).

## Progress

- [x] Plan reviewed by GPT Sol
- [x] Red tests (11 failing before the fix, then 2 more for G1 and G2)
- [x] Fix
- [x] Sol code review (ship with the fixes; its diff read, H1 to H4 kept)
- [ ] Gates, push
