# Stage 4 review — GPT Sol, 2026-09-10, findings recovered from the activity log

**Why this file was rebuilt.** The reviewer wrote its full report into this file and then
`scripts/run-codex.ts` overwrote the same path (`--output`) with the reviewer's closing message, which
was only a pointer back here — the same thing happened to the Stage 2 review. The six findings below
are the reviewer's own sentences, copied verbatim from the run's activity log
(`…-stage4-review-sol.md.activity.log`, not committed). Its closing message, also verbatim:

> Found and fixed six established P1 issues, including the suspected replay draft loss, double-tap
> duplicate sends, malformed success handling, route/receipt mismatches, and hidden
> `unknownWithoutHold` data. … 17 test files, 988 tests passed · All four TypeScript projects passed ·
> `git diff --check` passed · No commit or index changes. **land with the fixes above**

## Findings, verbatim

**F45 — P1, established: two taps could send one intention twice.** (a) Two `Send` clicks in the same
React turn, before `busy` rendered, minted and posted two envelopes; the red test observed two calls
while the first never answered. The same race existed in the session and broadcast composers. (b) I
added synchronous in-flight refs shared by Send/Queue/Check in all three composers; the regression is
green.

**F46 — P1, established: a replay of an action that did not happen cleared its draft.** (a) Send → lost
answer → Check → replay carrying `not-sent` cleared session, Overseer, and broadcast text.
`outcome-unknown`, `withdrawn`, and `plan-stopped` had the same branch. Four composer regressions were
red. (b) A shared predicate now accepts only `keys-submitted`/`completed`, plus
`accepted`/`attempted`/`returned` for the queue path. Every other replay remains definitive, drops the
envelope, shows the receipt's words, and keeps the original draft.

**F47 — P1, established: status/body contradictions were accepted as success.** (a) Each client
accepted a valid replay or ordinary success body under HTTP 500; a composer could clear its draft from a
response that was not the API's success shape. Six parameterised cases were red. (b) Replays and
ordinary successes now require HTTP 200; keyed 409/503 arms require their specified status.
Contradictions become `not-confirmed`.

**F48 — P1, established: the keyed actions client did not distinguish the two intentions sharing
`/api/actions/session`.** (a) Its real `op: "ran"` action success became `not-confirmed`, while another
gesture's readable success could be accepted by a queued-message caller. The focused regression was
red. (b) `keyedAction` now receives the expected intention: queue accepts only `enqueued`/`queued`; run
accepts only matching `ran`, action id, and `dryRun: false`.

**F49 — P1, established: an absent `unknownWithoutHold` became an empty safety list.** (a)
`parseReceiptsFeed` returned a good feed with no warning when that field was missing; the red test
proved the unknown was hidden. (b) Missing/non-array is now an unreadable poll, preserving the last good
feed and surfacing the read failure; malformed rows remain visible placeholders.

**F50 — P1, established: a replay carrying another operation's receipt was accepted.** (a) All three
clients accepted an `enacted-box` receipt as the replay of a steer, queue, or broadcast envelope; three
cases were red, and a `completed` mismatch could consume a draft. (b) Each keyed client now checks the
replay receipt's operation, origin and applicable target/parent relationship against its own intention;
a mismatch is `not-confirmed`.

## Disposition

All six read in the diff and kept. F46 is the suspicion the prompt named. The implementing session's
gate run over the fixes is recorded in the commit that lands them.
