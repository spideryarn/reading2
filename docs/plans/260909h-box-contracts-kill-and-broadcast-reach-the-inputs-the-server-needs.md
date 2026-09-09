# Box contracts: make Kill and Broadcast reach the inputs the server needs

**Roadmap stage.** `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § *"Stage: Box
contracts — make the existing actions reach their intended inputs"*. That stage's checkboxes and its
acceptance paragraph are the spec; this doc is how it gets built, and where the decisions taken
along the way are written down.

**Dispatched by the Overseer** (queue item `qi-qsxergb4`) on 2026-09-09. Implementation is delegated
to GPT (`docs/reusable/codex-cli-as-subagent.md`); this session writes the plan, writes or commissions
the red tests, runs the gates, reviews, and commits.

## What is actually broken today

Two buttons on the fleet dashboard advertise an effect and cannot produce it, for two different
reasons, and a third problem sits under both of them.

1. **Kill can never run.** `boxActionBody` in `tools/fleet/web/src/actions-client.ts` builds
   `{ actionId, mode, confirm, speaker, recipients }` — and **no `pids` field at all**. `killRoute`
   in `tools/fleet/routes-actions.ts` intersects the fresh scan with `new Set(r.pids)`, so the
   intersection is always empty and every confirmed kill is refused `nothing-to-kill` with the
   sentence *"nothing on the list you confirmed still matches the rule"*. The refusal is honest about
   its own rule and completely misleading about what happened: the list the person confirmed was
   never sent. `boxActionBody`'s own header already says so — *"An enacted kill reads `pids` rather
   than this field and has the same gap; that is the preview envelope's to close"*.

2. **Nothing binds the preview to the run.** Both presses call `api.box(action.id, dryRun, onScreen)`
   with `onScreen = rows ?? NO_ROWS`, which is **live**: the rows prop re-renders every time the
   snapshot polls. So the list Greg read in the preview and the list the confirm sends are two
   different readings of the fleet that happen to be built by the same function. Nothing on the wire
   carries *which* preview this run is confirming, so the server cannot tell a confirm-of-what-I-showed
   from a confirm-of-something-else, and a restart between the two presses is invisible to both ends.

3. **`op` and `action` are discarded.** `makeActionsApi().box` reads `dryRun`, `result` and `why` off
   the answer and throws the rest away. The route sends four distinct `op` words — `dry-run`, `ran`,
   `broadcast-preview`, `broadcast` — and the page cannot tell a kill preview from a broadcast
   preview except by sniffing the shape of `result`, which is what `parseBoxEffect` does. That is a
   guess where the server sent a fact.

Broadcast, by contrast, **does** reach recipients as of `d188b8e0` (2026-09-09): `recipients` is on
the body and the route selects from it. What it does not do is freeze them — the same live-`rows`
problem — or report exclusions in a shape the confirmation can render.

## The shape of the fix

A **preview envelope**: the dry run answers with a bounded, volatile, server-minted receipt naming
what it showed, and the run has to hand that receipt back along with the material it describes. The
route checks the receipt **before any effect**, and refuses with a sentence rather than silently
re-previewing.

```
   ┌── press ──────────────────────────────────────────────────────────┐
   │ POST /api/actions/box  { actionId, mode: "dry-run", recipients }  │
   │                                                                   │
   │ 200 { op, action, dryRun: true, result, preview: {                │
   │        schema, previewId, serverInstanceId, actionId, expiresAt,  │
   │        material: kill{ confirmable[], excluded[] }                │
   │                | broadcast{ speaker, recipients[] } } }           │
   └───────────────────────────────────────────────────────────────────┘
                    │  the client KEEPS this, frozen, in component state
                    │  and renders the confirmation OUT OF IT
                    ▼
   ┌── confirm ────────────────────────────────────────────────────────┐
   │ POST /api/actions/box  { actionId, mode: "run", confirm: true,    │
   │    preview: { previewId, serverInstanceId, actionId },            │
   │    material: <the envelope's own, echoed verbatim> }              │
   │                                        ↑ from the ENVELOPE,       │
   │                                          never from `rows`        │
   │                                                                   │
   │ route: origin → scope/mode/confirm → FLEET_ACT_ENABLED            │
   │        → envelope: instance? known? unexpired? action? material?  │
   │        → rate/cooldown → ATOMIC CLAIM (fresh→claimed)             │
   │        → fresh re-probe → effect                                  │
   └───────────────────────────────────────────────────────────────────┘
```

**The envelope binds material, not authority.** It does not replace the origin check, the
`FLEET_ACT_ENABLED` gate, the rate limiter or the fresh re-probe. It answers exactly one question —
*is this a confirmation of the thing I showed you?* — and the fresh probe still answers *and does it
still hold?*.

### Why not just add `pids`

The roadmap's own rejected alternative, and it is right: `pids: [17234]` fixes today's refusal and
leaves two holes open. A pid is reused, so a confirm can name a process that has died and been
replaced by a different one wearing its number. And an unknown preview stays a valid confirmation
target — there is nothing to be unknown *of*.

Fable's suggestion of pid-plus-elapsed-age is also insufficient and the roadmap says why: preview a
one-second-old process, let it be replaced, leave the dialog open until the replacement is two
seconds old, and the age comparison passes on a different process. **Start ticks plus boot id** is
the identity that answers it, and `tools/fleet/execution-identity.ts` already reads both
(`readProcessStart`, `readBootIdentity`) for the execution-identity stage. This stage reuses those
functions; it does not re-derive a process identity.

**And it answers the minutes-wide case, not the milliseconds-wide one.** `pid + startTicks + bootId`
identifies a Linux process exactly; it does not make a subsequent `kill -TERM <pid>` land on that
process, because the verified process can exit between the `/proc` read and the signal and its pid
can be reused in the gap. The case the roadmap is worried about — a preview left open while the box
turns over — is minutes wide and is closed.

**What is left is wider than "a few milliseconds", and this paragraph said that until Sol's code
review established otherwise.** The gap for any one candidate runs from its own identity read to its
own `kill` step, and the run reads every candidate's identity first and then signals them in order —
so the first candidate in a list of sixty waits through fifty-nine `/proc` reads and fifty-nine
signal steps. A second, separate limit: the fresh scan establishes rule membership **at scan time**,
and a process's command line and cwd can change afterwards without its pid or start ticks changing,
so `killVerdict`'s judgement is as old as the scan. Both are written into the comments beside the
code. See § *What Sol changed* for why the pidfd fix that would close the first is not in this stage,
and on what condition it comes back.

## Product decisions taken here (recorded, not asked — per the brief)

- **A preview expires after five minutes.** `PREVIEW_TTL_MS = 5 * 60_000`. Long enough to read a list
  of thirty processes on a phone; short enough that a dialog left open over lunch cannot be confirmed
  into a box that has completely turned over.
- **A mismatch is a refusal with the reason shown, never a silent re-preview.** Re-previewing behind
  the person is how a confirmation stops meaning anything: the second press would then confirm a list
  nobody read. Every mismatch arm names which check failed and what to do (reload, press again).
- **Destructive confirmation for kill is offered only for candidates whose identity is complete** —
  pid *and* start ticks *and* boot id. A candidate whose `/proc` read failed is listed under the
  preview as *cannot be confirmed*, with the reason, and is **not** in the submitted set. If that
  leaves nothing, there is no Confirm at all. This is the roadmap's *"Extend identity beyond PID to
  start time/boot context before enabling destructive confirmation"* read at candidate granularity
  rather than all-or-nothing, so one unreadable `/proc` entry cannot disable the button for the other
  twenty-nine — and the exclusion is on the page, not silent.
- **`FLEET_ACT_ENABLED` stays exactly as it is.** Nothing in this stage turns it on, and the acting
  gate keeps running before any of the new checks matter. Repairing the code does not enable it.
- **`box(actionId, dryRun, rows)` is replaced by `boxPreview(actionId, rows)` and
  `boxConfirm(envelope)`**, rather than gaining an optional envelope parameter. A confirm that has no
  envelope to give then does not compile, which is the difference between a rule and a convention —
  `AGENTS.md` § *Let the types catch it*. It costs about ten call-site edits, nearly all of them in
  tests.
- **`pids: number[]` is removed from the request rather than deprecated**, and a body still carrying
  it is refused with a sentence rather than having the field ignored. The roadmap's rejected
  alternative is precisely "adding `pids` alone"; a field that is quietly dropped is how that
  alternative walks back in.
- **The run resubmits the material even though the server already holds it.** Naming the previewId
  alone would be simpler and would make an unreviewed set unrepresentable — but it would also make
  the check blind in the one direction that matters: if the page rendered something other than what
  the server previewed, a previewId-only confirm would sail through. Resubmission makes the check a
  join between what the server stored and what the client displayed, which is the roadmap's wording
  (*"and match the reviewed target material"*) and the reason for it.


## What GPT Sol changed about this plan

Reviewed 2026-09-09 (`260909h-box-contracts-plan-review-sol-r1.md`, `--sandbox review`). No P0. Six
P1s and two P2s, and two of the P1s are defects this plan would otherwise have shipped. Every one is
accepted; the two that change what gets built are written into the stages below, and the reasoning
that is worth keeping is here.

**A preview receipt was replayable, and that is the one that mattered.** The table as planned
recorded whether a preview was *known* and *unexpired* and nothing about whether it had already been
confirmed — so a double-tap, a retry after a lost response, or two concurrent requests could execute
one confirmation twice. The broadcast's ten-minute cooldown hides it; the kill's rate limiter does
not, and a kill spends real time awaiting a process scan with the receipt still valid underneath it.
So an entry now has a lifecycle — `fresh → claimed` — and the transition happens **atomically, before
the first `await`**, with a tombstone kept until expiry so a replay is told *this confirmation was
already submitted; look before acting again* rather than *unknown, preview again*. Those are
different sentences and only one of them invites pressing the button a third time.

Sol's admission order, adopted whole:

```
origin/body → scope/mode/confirm → FLEET_ACT_ENABLED → envelope validation
            → rate/cooldown admission → atomic claim → fresh revalidation → effect
```

The point of putting envelope validation before rate admission is that **a malformed envelope must
not spend rate-limit capacity**; the point of leaving `FLEET_ACT_ENABLED` where it already is, is
that repairing this code must not be able to turn acting on.

**Two overlapping presses could put one action's envelope under another action's name.** The
component holds `pending` and `preview` as separate state and each async press writes them
independently, and React's `busy` flag does not synchronously stop a second event. Press A, press B,
B answers, A answers second and overwrites `preview` — the panel now reads *Confirm: B* over A's
envelope, and `boxConfirm` then correctly and obediently runs **A**. Freezing the rows does nothing
about it. So the component holds **one** state value, `{ generation, action, outcome }`, discards any
response from an older generation, and renders and confirms only out of that. There is a test with
two deliberately out-of-order preview promises.

**`speaker` changed the sentence from outside the bound material.** The broadcast's material was
going to be the recipient list alone, and `speaker` was going to ride along as an ordinary sibling
field — which the route defaults to `overseer` when it is absent. The displayed words and the
delivered words could therefore differ while every check passed. The general rule Sol draws out of it
is the right one and is now the rule: **no value that determines the effect may live outside the
equality check.** So the canonical broadcast material carries the speaker, every recipient claim and
its declared status, the recipient order (it decides the stagger position), and the computed pause
assignment. The kill material grows an explicit split between the confirmable identities and the
display-only exclusions, which also resolves a genuine ambiguity: as originally written, an
unconfirmable candidate had to be in the envelope for rendering, out of the submission, and still
somehow pass "material matches".

**`actionRevision` is cut, and this is the one place the plan now does less than the roadmap asked.**
Sol's argument is that it cannot fire: `ACTIONS` is a static literal, so a changed definition needs a
code change, which needs a restart, which mints a new `serverInstanceId` — and the instance check
refuses the preview several steps before the revision is ever compared. It also hashes the wrong
boundary, being a digest of a few literal fields rather than of `selectForKill`, `SAFE_KILL_RULES` or
the renderer, so it would look stronger than it is. A check that cannot fail is a claim rather than a
reading, and this repo has a habit of saying so. It comes back the day an action can be edited
without a restart; there is no such day scheduled. **Named here rather than dropped quietly, because
the roadmap does name the field.**

**The Health tab's Broadcast is still dead, and the plan had not noticed.** The roadmap's checkbox
says rows go through `HealthPanel` *and* `OrchestratorPanel`; `OverseerPanel` already passes them and
`HealthPanel` does not, and `App` does not give it any — so Broadcast on Box Health previews with
nobody in it and is refused, exactly as the Overseer tab's was until 2026-09-09. Three files this
plan had not listed. They are listed now.

**And the identity does not close the race it was sold as closing.** `pid + startTicks + bootId`
identifies a Linux process exactly, and that is not the same claim as *this `kill -TERM <pid>` will
reach that process*: the verified process may exit between the `/proc` read and the signal, and its
pid may be reused in the gap. The durable fix is a pidfd — open a handle, verify the start token
against the process bound to it, and signal through the handle — and Node has no pidfd binding, so it
is a native dependency or a helper binary, which is more than this stage should take on
(`AGENTS.md` § *Prefer boring*, § *Simplest version first*).

So: the identity re-read moves to the **last** thing before the plan runs, and the wording everywhere
stops claiming closure. What start ticks actually buy is the case the roadmap was worried about — a
preview left open while the box turns over — and that case is minutes wide. What remains is a window
of a few milliseconds requiring a pid to wrap through the whole pid space inside it. That is worth
naming and is not worth a native module today. **Recorded for the Overseer as a known residual, not
as a solved problem**, and the pidfd fix has a condition attached: the day a kill acts on something
other than test suites and orphaned browsers.

A failure to read the **boot identity** is different, and is a whole-request refusal: nothing can be
verified without it. A single candidate's vanished `/proc` entry is ordinary churn and excludes only
that candidate, with its reason on the page.
## Stages

Each stage is implemented by GPT from a task prompt, then reviewed by GPT Sol (`--sandbox
workspace-write`, so the reviewer fixes inside the stage), then gated and committed by this session.

**Stages 1 and 2 leave the suite red on purpose**, because the join tests cannot pass until the
client half exists. They are committed on the worktree branch as they land and **pushed to `dev` only
once the whole thing is green** — a knowingly-red trunk is everybody else's problem, and the
readiness gate reads it.

### Stage 1 — the red tests

**Status: done.** Three tests appended to `tests/fleet-actions-route.test.ts` §
*"a box action confirms the preview it was given, and nothing else"*, driving the real
`makeActionRoutes` through the real client via `browserFetch`, asserting on `ran` (the argv the box
was handed) and `sent` (who the delivery module was asked to speak to). All three watched red.

They fail on `api.boxPreview is not a function`, which is a **weak red** — it says the API is absent,
not that the behaviour is wrong. The behavioural record of the same defect is the test already in
that file, § *"asks for a real run in the field this route reads"*, which asserts `nothing-to-kill`
with `ran` empty and names the gap in its own comment. Stage 3 turns that one round; it is not
deleted.

- [ ] `tests/fleet-box-contracts.test.ts` (new), driving the **real** `makeActionRoutes` with fake
      probe/run/steer deps and the **real** client through `browserFetch`, which
      `tests/fleet-actions-route.test.ts` already builds. Assert on recorded execution and recipient
      calls, never on HTTP 200.
  - [ ] kill preview → confirm: the fake `runStep` records exactly the pids the preview listed.
        **Red today**: the confirm is refused `nothing-to-kill` and nothing is recorded.
  - [ ] broadcast preview → confirm: the fake send records exactly the recipients the preview listed.
  - [ ] `op` and `action` survive into the parsed `BoxOutcome`. **Red today**: both discarded.
### Stage 2 — the envelope, minted and checked, with kill identity in its material

**Status: done**, in `2c9a6d9a` and then `b47d7828`. Implemented by GPT from
`260909h-box-contracts-stage2-codex-task.md`; sixteen server cases watched red first. Reviewed by
GPT Sol with fix authority (`260909h-box-contracts-stage2-code-review-sol-r1.md`), which found **four
established P1s in the committed stage** and fixed all four red-first:

- **The preview could display one process and store another's identity.** The scan came first and the
  start-tick reads came after, so a pid that turned over in between joined the old process's command
  line and rule to the replacement's token. Now bracketed the way `execution-identity.ts` brackets
  its own — token, re-scan, token, and both reads must agree — with the displayed details taken from
  the settled scan, so what is shown and what is stored are one observation.
- **The tombstone was a sentence rather than a behaviour**: one confirmation and 32 dry runs evicted
  the claimed receipt, and the replay went back to saying *unknown*. Only fresh entries are evicted
  now, and a table of 32 live tombstones refuses to mint until one expires. **That is a real trade** —
  a burst of confirmations can block previews for up to five minutes — and it is the right way round,
  because the alternative silently invites a second irreversible press.
- **The server could not confirm its own preview** when a recipient's opaque status carried a `-0`,
  which `JSON.stringify` renders as `0` and `isDeepStrictEqual` then rejects. Both operands cross a
  JSON boundary in opposite directions, so the comparison is now by JSON value semantics.
- **~2,000 nested arrays fit under the 64 KiB cap**, survived the preview, and made the confirmation
  throw `RangeError` and answer 500. The comparator is iterative, and still exact on array order and
  object key sets.

It also answered the accuracy question against me: *"immediately before signalling"* was not
established, because an early candidate waits through every later identity read and every earlier
signal step; and the fresh scan establishes rule membership only at scan time, since command and cwd
can change without the pid or the start ticks changing. Both comments now say so.

Merged from what were two stages. The envelope's kill material **is** the identity list, so an
envelope stage that first defined the material as bare pids and an identity stage that then changed
it would be one design written twice.

- [x] `tools/fleet/wire.ts`: browser-safe request/response shapes — the preview envelope, its two
      material arms, a kill candidate identity, and distinct request arms for kill and broadcast.
      **Types only, no imports, no runtime values**; `tests/fleet-compile-guards.test.ts` enforces
      that and stays passing. Runtime parsers still validate; a shared compile-time type is not
      validation of network data. Shared with the `work-evidence` session, so additions are small,
      targeted, and the file is re-read immediately before each edit.
- [x] A bounded in-memory preview table on `makeActionRoutes` (32 entries, five-minute TTL, ids
      `<serverInstanceId>-p<n>`). Expired entries are purged before capacity is considered, then the
      oldest goes — which is also the one closest to expiring. It dies with the process, by
      construction: a restart makes every outstanding preview unknown, which is the true answer.
- [x] **`fresh → claimed`, atomically, before the first `await`**, with a tombstone until expiry. A
      replay is told *this confirmation was already submitted* — a different sentence from *unknown*,
      and the only one of the two that does not invite pressing again.
- [x] `serverInstanceId` becomes an injected `ActionDeps` field, so a test can build two runs in one
      process — the way `SteeringQueue` and `QuarantineBook` already take theirs.
- [x] Both dry-run arms answer with the envelope beside the existing `result`. `result` keeps its
      shape and `RawValue` keeps drawing it: this is additive.
- [x] The broadcast's canonical material carries **the speaker, the recipient claims and their
      declared statuses, the order, and the computed pause assignment** — everything that decides the
      sentence or who hears it. Nothing outside the equality check may determine the effect.
- [x] The kill's material splits `confirmable` (full identity) from `excluded` (display-only, with
      the reason), so "the material matches" has one meaning rather than three.
- [x] `ActionIo` gains `readProcessStart(pid)` and `readBootIdentity()`, wired in `realActionIo` to
      `tools/fleet/execution-identity.ts`'s existing functions and faked in the tests. **No test
      reads a real `/proc`.**
- [x] `parseBoxBody`: a required `preview` claim on a run, the echoed `material` in place of `pids`,
      and a body still carrying `pids` refused rather than ignored.
- [x] `boxRoute` admits in Sol's order — origin/body, scope/mode/confirm, `FLEET_ACT_ENABLED`,
      **envelope validation, then** rate and cooldown, then the atomic claim, then the fresh re-probe,
      then the effect. A malformed envelope must not spend rate-limit capacity, and the acting gate
      stays where it is so that repairing this code cannot turn acting on.
- [x] `killRoute`'s run re-reads each submitted candidate's start ticks and the boot id **as the last
      thing before the plan runs**, and signals only where pid **and** start ticks **and** boot id all
      still match — on top of, not instead of, today's fresh-scan-still-matches-the-rule intersection.
      An unreadable boot identity refuses the whole request; one vanished `/proc` entry excludes one
      candidate.
- [x] Tests, all asserting on recorded execution and recipient calls: wrong action, expired preview,
      restart between preview and run (two harnesses, two instance ids — the pattern § *"an item id
      from a previous run of the server"* already uses), **a replayed receipt, two concurrent
      confirms**, a reused pid, a mutated candidate token, a mutated recipient status, a changed
      recipient order, a changed speaker, an unconfirmable candidate, and eviction by age and by cap.
      Each must record **zero** effects.

### Stage 3 — the client keeps what it showed

**Status:** not started.

- [ ] `ActionsApi.box` splits into `boxPreview(actionId, rows)` and `boxConfirm(envelope)`, and the
      ~10 call sites — nearly all of them in `tests/fleet-actions-route.test.ts` — follow. A confirm
      with no envelope to give then does not compile.
- [ ] `BoxOutcome` keeps `op`, `action` and the parsed envelope. The envelope is *parsed*, not
      trusted: an answer whose `schema` is unrecognised, whose `dryRun` is absent or false, or whose
      `actionId` is not the action that was pressed, reaches the component as **no envelope**, and no
      Confirm is rendered over it.
- [ ] `BoxActions` holds **one** state value — `{ generation, action, outcome }` — and discards any
      response from an older generation. Press A, press B, B answers, A answers second, and the old
      two-field shape puts A's envelope under B's name while `boxConfirm` obediently runs A. Freezing
      the rows does nothing about that; one value and a generation counter does.
- [ ] The confirm submits **only** from that frozen envelope. `rows` is read once, at preview time.
- [ ] The whole answer has to agree before a Confirm exists: the expected preview `op`, the top-level
      `action`, `dryRun === true`, the envelope's `actionId`, a material discriminator matching the
      action's effect, and material that parses **all or nothing**.
- [ ] `rows` reach `HealthPanel` too — `App → HealthPanel → BoxActionsCard`. The roadmap asks for both
      panels; `OverseerPanel` passes rows and `HealthPanel` never has, so Broadcast on Box Health
      previews with nobody in it and is refused, exactly as the Overseer tab's was until 2026-09-09.
      A Health-tab test equivalent to the Overseer hop test.
- [ ] The confirmation renders the candidate list / recipient list, the exact action words, and
      explicit counts — including the excluded ones with their reasons. `RawValue` moves under a
      collapsed *diagnostic detail*, kept because a field this page has never heard of must stay on
      the page.
- [ ] Component tests in `tests/fleet-box-confirm.test.tsx`: missing `dryRun`, `dryRun: false`,
      malformed payload, mismatched action, a contradictory `op`, and **two preview promises resolved
      out of order** — each shows a refusal or unknown state with **no executable confirm control**,
      or confirms the action whose name is on the button and no other.

## Files

Mine: `tools/fleet/routes-actions.ts`, `tools/fleet/web/src/actions-client.ts`,
`tools/fleet/web/src/ActionButtons.tsx`, `tests/fleet-actions-route.test.ts` and new tests beside it,
and small targeted type-only additions to `tools/fleet/wire.ts`.

Added after Sol's review, and **the dashboard's own agent is live in two of them**, so the edits are
one threaded prop and nothing else: `tools/fleet/web/src/HealthPanel.tsx` and
`tools/fleet/web/src/App.tsx`. Without them the roadmap's `HealthPanel` checkbox cannot be ticked and
Broadcast on Box Health stays dead.

Not mine, and named here so a later reader knows the boundary was deliberate:
`tools/fleet/routes-new.ts`, `tools/overseer/dispatch.ts`, `scripts/gjd-remote.ts`,
`tools/overseer/` in general, and the readiness files. The dashboard's own agent and the
runbook/scheduler agent are live in this tree.

## The simpler option passed over

Sending `pids` and freezing `rows` in a `useRef` would take an afternoon and would make both buttons
work. It is rejected in the roadmap and rejected again here: it leaves a confirmed kill pointing at a
pid rather than at a process, and it leaves the server unable to tell a confirmation of what it
showed from a confirmation of something else. Both of those are silent, and both of them end with
something dying that nobody agreed to. The envelope is roughly twice the work and it is the part that
makes the confirmation mean something.
