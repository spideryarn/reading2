# Review: a plan to add generated session titles/descriptions, an Overseer notification, and a re-laid-out detail view to an agent fleet dashboard

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions`, branch
`worktree-260909a-dashboard-descriptions`. TypeScript + ESM throughout, run with `tsx`, tested with
vitest. This is a **plan review, before any code is written.**

## The candidate

Live pre-commit; base `1fec93c8`.

- **Untracked, and it is the whole candidate:**
  `docs/plans/260909a-dashboard-session-descriptions-and-a-detail-view-that-leads-with-the-last-message.md`
- Tracked files changed: **none.** Nothing has been built.

(Not durable — I will record the resulting commit SHA here once it lands.)

Start with the plan doc. This is where to begin, not the limit of what is in scope: the code it
describes is all under `tools/fleet/`, `tools/overseer/` and `tests/fleet-*`, and you should read
whatever of it you need.

## What this system is, in four sentences

There is a box running 20–35 Claude coding-agent sessions in tmux. A daemon (`tools/overseer/`) and a
web dashboard (`tools/fleet/`, served on :8787) between them show what every session is doing and let
a person steer one. The dashboard's session list currently shows a status pill and, for most rows,
the words "no title yet" — which is the complaint this work answers. The whole thing is a
**convenience with a manual fallback** (`ssh` + a terminal), which rules out expensive answers.

## What the plan is meant to do

Four user-visible things, listed under "The goal" in the doc.

**The invariants it must not break**, all of them house rules with accidents behind them:

- *A reading that could not be taken must not render as a reading*, enforced by types rather than by
  care — and its second clause, that **the consumer must be unable to discard the distinction**. Three
  defects in one evening were all consumer-side: the producer said the careful thing and the caller
  flattened it. `docs/project/overseer-direction.md` § "A higher bar for robustness here than
  elsewhere".
- *Never hide who decided.* A message delivered into an agent's input box arrives as an ordinary user
  turn — the most authoritative thing in its context — so an automated sender must say in the text
  that it is not the human. `tools/fleet/actions.ts:508-525`.
- *Never the word "sent".* Nothing on this box can observe reception; the vocabulary is
  `none | partial | unknown` (`tools/fleet/steer.ts:326-347`), and `partial` specifically means the
  text landed and the Enter did not, so it is sitting unsent in somebody's input box.
- `tools/fleet/wire.ts` **has no imports and must never acquire one** (`wire.ts:1-23`), and a new
  top-level field on the state payload must be **required, not optional** (`wire.ts:1002-1016`).
- Model calls are budgeted and cached by content fingerprint, because 36 sessions must not trigger 36
  model reviews a minute (`tools/overseer/attention-classify.ts:13-30`).

**Deliberately out of scope:** renaming tmux sessions (the name is the address other tools use); any
authentication; paid model calls in tests; a second HTTP client from the daemon to the dashboard.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can build a
throwaway harness under `/tmp`. **You have no network, not even loopback**, so anything needing
Postgres, tmux or a local service will fail or skip — those are mine to run.

Two measurements in the plan came from the live box and you cannot reproduce them; treat them as
given, but **do challenge whether they support the conclusions I draw from them**:

1. 8 live Claude sessions; 3 have an `aiTitle`; 8 have an `aiTitle` or a `customTitle`.
2. Across ~30 transcripts containing a `customTitle`, the last title record of either kind is always
   a `customTitle` — no observed case of an `aiTitle` landing after a rename.

## Attack it

Independently, and before you read my own doubts at the bottom.

The invariant I most want broken: **is there a path through this design where the dashboard shows a
confident sentence about a session that is not true of that session?** A description joined to the
wrong row, a cached summary outliving the conversation it describes, a title from a resumed
conversation, an idle summary that says "finished" about an agent that stopped to ask a question.
That is the failure this whole codebase is organised against, and a plan-stage review is the last
cheap moment to find it.

Second: **the stage boundaries.** Each stage is supposed to end with the tree committable and
coherent. Does any stage leave a half-joined feature — the postmortem this project keeps citing
(`docs/postmortems/260908b-…`) found sixteen features that were built, tested, routed and dead.

For each finding give:

- an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
- (b) the smallest change that closes it — exact replacement wording, since this is a doc

A finding with no (a) goes last.

Severity, graded by consequence and not by which file it is in:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1, and name what established it.**

## Give the question a floor

I am not asking "is this plan good". I am asking three things with answers:

1. Does the daemon-vs-dashboard decision (see "The describer runs in the dashboard, not in the
   daemon") survive contact with the code? I reversed the Overseer's stated default after finding its
   premise was false. **Is the statement I now rest on accurate** — that a daemon-side producer would
   have to join descriptions to fleet rows through the register, and that `wire.ts:1245-1293` refuses
   that join?
2. Is the two-fingerprint cache design (`openingFingerprint` for the description,
   `tailFingerprint` for the idle summary, both plus `tmuxServerPid`) sufficient to make a stale or
   misattributed description **impossible to render**, rather than merely unlikely? If not, name the
   sequence.
3. Is Stage 0 correct and is it really as small as I claim?

## My own suspicions — read last, and worth less than anything you find yourself

These are already my doubts, so confirming them is cheap. Spend most of the run above.

- The `Speaker` union has two arms and I need a third that means "the dashboard itself". My fallback
  is a private prefix constant in a new module, which bypasses the shared `renderMessage` attribution
  machinery. `docs/project/overseer.md` warns that one reviewed exception becomes a way to speak in
  the human's voice. Is the fallback a hole?
- `sendMessage` is synchronous `execFileSync` with up to three tmux calls at 10 s timeouts, called
  from the dashboard's launch path. I plan to bound the timeouts. Is that sufficient, or does this
  belong off the event loop entirely?
- Stage E moves the message history behind a native `<details>`. Greg asked for "a popup panel or
  something". Am I under-building it?

Do not change any file.
