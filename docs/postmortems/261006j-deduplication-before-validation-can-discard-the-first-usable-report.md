# Deduplication before validation can discard the first usable report

Code review of the uncommitted [261006g candidate](../plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md)
reproduced lost GPT-Live backend usage. Provider occurrence and reader exposure were not established.
The marker defect was introduced by this candidate, so it has no introducing commit yet.

## The class: deduplication before validation

The reducer marked a response `billed` as soon as a terminal event carried any usage object. The
meter separately required valid input and output totals. An error carrying `{}` therefore consumed
the marker but produced no report; a later failed event with usable totals was discarded. A
subagent independently reproduced the same sequence with empty and partial totals.

The regression test `does not consume billing when an early error carries unusable usage` failed
with `expected [] to deeply equal` a backend report. Missing totals and invalid totals now leave
the marker available. The fix uses the existing pure `backendReport` reader before setting it,
so the decision to deduplicate uses the same definition of reportability as the consumer.

There was a second gate: `completed()` returned on tool state before looking at later usage.
`created → completed(no usage) → completed(valid usage)` lost the bill in final, waiting and
continued states. This guard predates the candidate, in commit
`a8b7a4873dcfb91268e5898d0a8e71890a518dee` (GPT-Live's three pure reducers). Three new regression
cases failed with `expected [] to deeply equal [ 'usage' ]`. Repeated completions now emit usage
without replaying finals or tool continuations. A dead response still cannot become a completed bill.

## Why the checks agreed

The plan-review regression supplied no usage at all on the early error. That never set the marker,
so its recovery test passed. It did not supply an object that the next layer refused. Completion
tests supplied usable totals on the first completion, so duplicates correctly produced nothing.
All 165 existing database-free assertions passed before the review added these sequences.

## Countermeasures, ranked by cost and value

1. **Test rejected input followed by valid input under the same id.** Done: empty, partial and
   invalid totals precede a usable failure report. The completed-state cases also verify that
   accounting recovery does not replay operational effects.
2. **Validate before consuming a once-only marker.** Done using the consumer's existing pure
   reader. Repeating its validation rules in the reducer would introduce a second definition
   that could drift.
3. **A meter acknowledgement protocol or durable outbox.** Rejected for this stage: the defect
   occurs before a report is queued, and neither mechanism fixes that boundary by itself.

The long-term fix is the same boundary used here: deduplicate reportable usage independently of
tool progression. A later report cannot recover a response whose events never arrive, and
conflicting terminal types still follow the candidate's accepted authority policy. These tests
establish reducer behavior, not that the provider emits the reproduced sequences.

Up: [postmortems.md](../project/postmortems.md).
