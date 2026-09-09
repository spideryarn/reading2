## Verdict

**Not fit to build.** The tab is the right product shape, and dropping the rule detector is correct, but the plan’s reconciliation and write-safety model are not yet sound. It can show stale facts as current, attach one question’s ranking to another question’s buttons, and offer controls that either always fail or answer an inferred non-question.

## P0 — must change before implementation

### P0-1: The join has no question identity and no temporal ordering

The missing fourth case is:

> **Both sides contain a question for the same session, but they describe different questions.**

That includes:

- Inbox says dialog A; row says dialog B.
- Inbox says prose A; row says dialog B.
- The prompt/options happen to match, but the underlying material differs.

Joining on `sessionId` silently attaches A’s age, consequence, and “why it matters” to B’s controls. The answer route’s `sameQuestion` check only proves that B is still on the pane when clicked; it does not prove that the inbox metadata belonged to B. See [`sameQuestion`](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/steer.ts:1399).

The plan also assumes the row is newer. That is not guaranteed. `statePayload` reads the checkpoint at request time, but its attention content has its own `scannedAt`; the row has `collectedAt`. Either observation can be newer. Therefore:

- “dialog-gone” may mean the row was collected before the dialog opened.
- “row-only new dialog” may be a dialog already gone by the newer attention scan.
- “live payload row” is an incorrect name for cached collection data.

What I would do instead:

- Give every observed dialog an opaque identity derived from the same fields as `sameQuestion`: prompt, material fingerprint, option labels, consequences, and keys.
- Carry both observation clocks.
- Attach inbox ranking/age only on an exact identity match.
- Represent disagreement explicitly as `observations-disagree`; do not infer `dialog-gone` without establishing that the row observation is newer.
- Treat unmatched observations according to which source is newer and whether that source was complete.

### P0-2: Prose answering still violates `AttentionPanel` agreement (a)

The proposed defence protects option clicks, but it does not protect free-text replies.

A prose card is inferred. The free-text action is an ordinary `/api/steer/message`; it binds to a destination row, not to the excerpt that caused the card to exist. The server verifies the current address and that the input box is empty, but it never verifies:

- that the displayed prose came from the current conversation;
- that the same tail is still on screen;
- that it was an agent question rather than Greg’s quoted message;
- that the inferred question still exists.

Thus the prior bug remains actionable: the classifier can present Greg’s own words as a question, and the new control invites him to answer it. The message’s bytes are Greg’s, but the premise that somebody asked is fabricated.

There is a second target-switch path. `AttentionItem.id` identifies a grouped question, while its primary session can change when a duplicate disappears ([producer code](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention.ts:257)). If card-local draft state is keyed by that stable ID, a draft begun for session A can remain mounted after the card starts targeting session B. The server will correctly verify B and produce a green receipt.

What I would do instead:

- Either keep prose cards read-only in v1, selecting `SessionDetail`; or
- Add a guarded prose-answer operation analogous to `answerQuestion`: send an expected tail fingerprint, re-capture immediately before sending, and refuse unless the same ended-turn evidence is still present.
- Key/reset draft and receipt state by question identity **plus session identity plus execution identity**, not the grouped attention ID.
- Quarantine a draft whenever any part of that identity changes.

### P0-3: `QuestionsView` cannot substantiate an empty result

The proposed `list` arm still has a placeholder for positive controls:

```ts
{ kind: "list"; items: ...; /* …the inbox's positive controls… */ }
```

That is the most important part of the type. As written, `items: []` can render as “nothing needs you” without proving:

- a fleet collection completed;
- no client rows were dropped;
- the row snapshot is fresh;
- the attention checkpoint and scan are fresh;
- the attention scan judged every session;
- the new `questions` field parsed successfully.

`inbox-unavailable` also collapses several observed states and gives `rowsOnly` the shape of a complete answer.

What I would do instead:

```ts
type QuestionsView =
  | { kind: "complete"; items: QuestionItem[]; observed: ... }
  | { kind: "partial"; items: QuestionItem[]; gaps: NonEmptyArray<QuestionGap> }
  | { kind: "not-observed"; cause: ... };
```

Only `complete` may render “nothing needs you.” Preserve exact causes such as checkpoint absent, checkpoint unreadable, list unknown, client field unreadable, rows never collected, rows dropped, and stale source.

Rename `rowsOnly` to something such as `observedDialogs` inside `partial`, with visible copy: “Live-dialog observations only; prose questions and ranking are unavailable.”

## P1 — substantial correctness gaps

### P1-1: Dialog free text and the rewrite chip cannot work through the existing route

[`sendMessage`](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/steer.ts:1312) accepts only an `empty-input` surface and explicitly returns `pane-is-asking` when a dialog is present. Therefore:

- The promised text box on every dialog card cannot submit while the dialog remains open.
- “Rewrite this so I can choose” will always be refused while it is relevant.
- If the dialog has disappeared, the general message may succeed—but then it is no longer bound to that dialog.

The browser seam also hard-codes message authorship to `"greg"` ([`SteerMessageBody`](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/steer-client.ts:94)), so the proposed `"overseer"` chip is not currently available through `SteerApi`.

What I would do instead:

- In v1, show option buttons only on dialog cards and free text only on guarded prose cards.
- Remove the rewrite chip unless a new atomic operation is designed to verify the same dialog, leave it safely, and submit the coordinator message.
- If that operation is built, acknowledge it as a new write operation and test the full server path.

### P1-2: The wire types form an invalid Cartesian product

`ask` and `answerHere` being separate permits states such as:

- prose + options;
- dialog-gone + options;
- dialog + an option count different from `options.length`;
- unreadable + words-only;
- permission dialog + words-only, although messages cannot be sent at dialogs.

Several names also describe implications rather than observations:

- `dialog-gone`
- `words-only`
- `not-addressable`
- `inbox-unavailable`

The dialog arm omits `material`, despite the plan promising to show material beside every answer. `FleetQuestion.material` exists specifically because a prompt alone is insufficient ([client type](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:137)). An unreadable material arm also means `sameMaterial` will necessarily refuse an option.

What I would do instead: define complete item arms such as `matched-dialog`, `row-dialog`, `attention-prose`, `observations-disagree`, and `attention-item-without-row`. Put each arm’s permitted action inside that arm; do not cross-product evidence and capability. Never copy an option count separately.

### P1-3: “Row question with no inbox item” is not necessarily a fresh question

The attention producer deliberately excludes permission and unknown-class dialogs. A row can therefore have a question and no inbox item because it was intentionally deemed **not Greg’s attention item**, not because the two-minute scan has not caught up.

The plan would publish such a row as `kind: "other"`, fabricating a model judgement that never occurred and reintroducing permission/configuration dialogs into the “needed from me” list.

What I would do instead:

- Admit row-only questions only when `row.question.gate.kind === "conversation"`.
- Never synthesize `AttentionKind: "other"`; represent “not ranked by the inbox” directly.
- Test permission, unknown, and malformed-gate rows.

### P1-4: Duplicate questions are lost or duplicated, and their target can change

`AttentionItem` groups equivalent questions and carries additional sessions in `duplicates`. `QuestionItem` drops that field entirely. “Fan-out answering” may be out of scope, but visibility is not:

- Showing only the primary hides other blocked sessions.
- Treating duplicate rows as row-only creates repeated cards with lost waiting/ranking metadata.
- Retaining the grouped ID while the primary changes creates the draft-to-wrong-session hazard described above.

What I would do instead: explicitly choose either one card per waiting session or one grouped card listing every session. If fan-out is omitted, individual answer controls must target individual sessions.

### P1-5: The queue pointer cannot be droppable under the current product claim

The plan correctly says `QueueItemWait.needs-greg` is genuinely “needed from me,” then permits shipping the Questions tab without even its count. That makes “everything that needs Greg’s input” knowingly false.

What I would do instead:

- Make the counted queue pointer acceptance-critical; or
- Rename and word the tab as “Agent questions,” explicitly excluding queued-authority requests.

## P2 — plan quality and efficiency

### P2-1: The refresh path is I/O-free, but not free

The code supports the narrow claim: composition can use the existing snapshot and the one checkpoint read in [`statePayload`](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/state.ts:175). It adds no capture, subprocess, file read, or model call.

The required pushed field does duplicate existing data, however. Prose evidence is capped at 4,000 characters; 20 distinct prose items can therefore duplicate roughly 80 KB before JSON overhead, plus questions and descriptions, every cycle to every reader. That is not a practical size problem at ~20 sessions, but “costs nothing” is false.

Prefer a compact server-produced reconciliation containing source references and match/conflict decisions, while rendering the already-present attention and row records. At minimum, measure and add a payload-size regression fixture.

### P2-2: The test list contradicts the detector decision and misses the dangerous cases

Stage 1 still requires “the detector’s flag and its silence” after the plan deletes the detector. More importantly, it omits:

- dialog A versus dialog B;
- prose versus dialog for one session;
- either source being newer;
- permission/unknown row-only questions;
- duplicate-primary changes with a non-empty draft;
- `answeringEnabled` false/not-reported;
- material unreadable;
- successful, partial, and unknown sends leaving stale controls active;
- queue omission;
- a genuinely empty but partial observation.

## Detector decision

Dropping the automatic rule detector is correct. [`dialogText()`](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention-pass.ts:342) is prompt + optional parsed material + option labels; it does not contain the surrounding explanation the rule is meant to judge. The pane tail is also limited to one alternate-screen screenful. The fallback `no-explanation-on-screen` name would be observationally honest, but using it to withhold answering would still systematically penalize explanations that scrolled off-screen.

The proposed replacement chip does not rescue that decision because the existing message route cannot send it while the dialog is open.

## Reuse assessment

The plan currently rebuilds several existing shapes:

- `QuestionAsk.dialog` duplicates `FleetQuestion`.
- `QuestionAsk.prose` duplicates `AttentionEvidence.prose`.
- `QuestionAnswerHere` duplicates gate, material, address, and answering-enabled decisions.
- `QuestionsView` partially duplicates `AttentionFeed`’s absence vocabulary while discarding distinctions.
- `about` duplicates the session-description projection.

Keep the new server logic to **reconciliation only**: exact source references, identity match/mismatch, temporal relationship, and completeness. Reuse the existing source records for display and the existing steer route for option answers. A guarded prose answer is the one genuinely new operation this feature requires if prose answering in place remains mandatory.