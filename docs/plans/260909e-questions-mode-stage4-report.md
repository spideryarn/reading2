# Questions mode Stage 4 report

## What changed

### QM2-01 — one local answerability predicate, two consumers

`isLocallyAnswerableDialog` now lives in the browser-safe `types.ts`. Its status branch is an
allow-list: `needs-you`, `working` and `idle` may continue; `waiting`, `no-claude`, `shell` and
`unknown` return false; a future status arm reaches a load-bearing `never`. The comment names
`tools/fleet/steer.ts` § `steerableStatus` as the server authority and explains why that Node module
cannot be imported into the browser.

The predicate also requires a conversation gate, readable material, and pane/session/conversation
identifiers matching the same shapes as the route's `checkTarget`. Both `resolveDialogReference`
and `AnswerableDialog` call it. Reference validation
downgrades a reported addressable dialog whose row is locally inadmissible; the panel withholds its
controls. Target identity remains a separate cross-reference check, and a legitimate
`dialog-unaddressable` item remains visible without being misreported as a new gap.

### QM2-02 — local state includes question identity

Dialog card keys now contain the row id, execution token, and the fields used by the server's
`sameQuestion` safety comparison: exact prompt, material identity, and every option's label,
consequence and full raw key in order. `questionSafetyKey` reads those fields from `rawQuestion`,
which is already preserved at the parse boundary, because the rendering parser deliberately
normalises arrow presses and collapses unfamiliar keys. The comment records that this is a
stale-answer safety comparison, not the semantic grouping withdrawn in § What round three changed,
3.

A changed dialog on the same row and execution therefore remounts its card, discarding the previous
receipt and repeat lock. An unchanged question on the same execution still keeps its state.

### QM2-03 — inverse coverage before `complete`

The client resolver now records reported dialog row ids and prose item ids separately, then compares
them with the independently parsed source observations:

- every row whose parsed question has a conversation gate;
- every top-level prose attention item in a published list.

Missing coverage adds `eligible-observation-omitted`, whose nested exhaustive reference names either
the dialog row or prose item actually observed. No item is dropped or invented; `complete` becomes
`partial`, while an already `not-observed` view stays `not-observed` and gains the observed gap.
Inbox `dialog` evidence is explicitly ignored, prose duplicates do not become cards, and the check
does not re-compose targets or copied fields.

### QM2-04 — the prose guard checks behaviour

The prose regression now clicks the real card through `App` with a recording `SteerApi`. It keeps the
textarea/button structural checks, proves the hash navigates to the asking session and clears stale
`selpid`, and asserts that neither `message` nor `answer` was called.

### QM2-05 — the hold notice has something to explain

The answering notice now renders only when the current view contains a `dialog` item. Empty,
prose-only, `dialog-unaddressable` and not-observed views do not get a notice about withheld option
buttons; the ordinary dialog case still does.

### QM2-06 — one runtime home for freshness thresholds

`tools/fleet/question-freshness.ts` is an import-free browser-safe leaf exporting the fleet cadence,
checkpoint and scan thresholds. Its comment explains that the values are not in `wire.ts` because
that module is a types-only contract. Both the server composer and browser selector import the same
constants. Their separate stale-checking functions remain separate.

The regression imports the shared values, verifies both production modules consume the shared home,
and drives both server and browser at the exact threshold and one millisecond beyond it. The fleet
case uses a non-default cadence so it proves the multiplier rather than an accidentally equal
duration.

## Tests watched red before the fixes

- **QM2-01:** the four generated status cases (`waiting`, `no-claude`, `shell`, `unknown`) and the
  separate `no-material` case each found two enabled option buttons. This proved the panel admitted
  every locally retained row the server-side rule would refuse.
- **QM2-02:** after answering A, the same row and execution rendered B's new prompt while retaining
  A's `Sent.` receipt. This proved the old React key preserved both receipt and repeat lock across a
  changed question.
- **QM2-03:** both client-parser omission cases received `complete` instead of `partial`, and the DOM
  case rendered `Nothing needs you.` for an omitted live dialog. This proved reference validation had
  no inverse coverage. The ordinary realistic payload containing its matching dialog and prose items
  **passed before the fix with no omission gap**; this is the no-false-positive control that prevents
  the cure becoming an A17 second composer.
- **QM2-04:** because production already navigated without writing, I temporarily applied the
  reviewer's mutation: the same prose click called `steer.message` and then navigated. The strengthened
  test reached the correct Sessions hash, cleared `selpid`, and failed only because the recorder saw
  one message call. This proved it catches the hidden write the old structural test missed. The
  mutation was then removed.
- **QM2-05:** with the original unconditional notice temporarily restored, the separated empty-list
  and prose-only tests both failed on the hold sentence; the dialog positive control passed. This
  proved both misleading surfaces independently rather than stopping at the first failure.
- **QM2-06:** the structural half failed because the browser selector did not import any shared
  threshold names. The boundary cases already passed while the literals happened to agree; together
  those two facts demonstrate the exact defect—agreement by duplication, with no coupling.
- **Post-review F1:** changing only an unfamiliar raw option key from `future-a` to `future-b` kept
  the previous `Sent.` receipt. This proved the rendering parse was too lossy to supply a safety
  identity even though it was sufficient to draw the option.
- **Post-review F2:** malformed non-null pane id, session handle and conversation UUID cases each
  exposed two enabled buttons. This proved presence checks were weaker than the route's target-shape
  checks.

## Verification

- `npx vitest run tests/fleet-questions-panel.test.tsx tests/fleet-questions.test.ts tests/fleet-questions-client.test.ts`
  — 3 files, 84 tests passed.
- `git diff --check` — passed.

The obligatory GPT Sol end-stage review first refused on the two P1s above. Its narrow review of
their repairs concluded that both were closed and found no established P0/P1 in the fixes. The
review is recorded in `260909e-questions-mode-stage4-review-sol.md`.

Per the task, I did not run `npm test`, `npm run typecheck`, or commit.

## Review disagreements and work left

I found no incorrect finding in `260909e-questions-mode-stage2-review-sol-r2.md`: QM2-01 through
QM2-05 all reproduced as described. QM2-06 was also real, but its existing literals agreed, so only
the new structural/shared-boundary regression could make the maintenance defect observable.

Nothing from the requested Stage 4 fixes is left undone. The queue-pointer region and every excluded
file were left unchanged.
