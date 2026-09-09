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
   │        schema, previewId, serverInstanceId,                       │
   │        actionId, actionRevision, expiresAt,                       │
   │        material: kill{candidates[]} | broadcast{recipients[]} } } │
   └───────────────────────────────────────────────────────────────────┘
                    │  the client KEEPS this, frozen, in component state
                    │  and renders the confirmation OUT OF IT
                    ▼
   ┌── confirm ────────────────────────────────────────────────────────┐
   │ POST /api/actions/box  { actionId, mode: "run", confirm: true,    │
   │    preview: { previewId, serverInstanceId, actionId,              │
   │               actionRevision },                                   │
   │    pids: [...identities]  |  recipients: [...] }   ← from the     │
   │                                                       ENVELOPE,   │
   │                                                       not `rows`  │
   │                                                                   │
   │ route: instance? known? unexpired? action? revision? material?    │
   │        …every one of those before the fresh probe, and the fresh  │
   │        probe still bounds the effect as it does today             │
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
the identity that closes it, and `tools/fleet/execution-identity.ts` already reads both
(`readProcessStart`, `readBootIdentity`) for the execution-identity stage. This stage reuses those
functions; it does not re-derive a process identity.

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

**Status:** not started. Brief: `260909h-box-contracts-stage2-codex-task.md`.

Merged from what were two stages. The envelope's kill material **is** the identity list, so an
envelope stage that first defined the material as bare pids and an identity stage that then changed
it would be one design written twice.

- [ ] `tools/fleet/wire.ts`: browser-safe request/response shapes — the preview envelope, its two
      material arms, a kill candidate identity, and distinct request arms for kill and broadcast.
      **Types only, no imports, no runtime values**; `tests/fleet-compile-guards.test.ts` enforces
      that and stays passing. Runtime parsers still validate; a shared compile-time type is not
      validation of network data. Shared with the `work-evidence` session, so additions are small,
      targeted, and the file is re-read immediately before each edit.
- [ ] A bounded in-memory preview table on `makeActionRoutes` (32 entries, FIFO eviction, five-minute
      TTL, ids `<serverInstanceId>-p<n>`). It dies with the process, by construction: a restart makes
      every outstanding preview unknown, which is the true answer.
- [ ] `serverInstanceId` becomes an injected `ActionDeps` field, so a test can build two runs in one
      process — the way `SteeringQueue` and `QuarantineBook` already take theirs.
- [ ] `actionRevision`: a short hash over the action's own definition (id, label, scope, effect,
      needsConfirm, and the text/stagger a broadcast renders from). Stable across restarts, and it
      changes the moment the action changes.
- [ ] Both dry-run arms answer with the envelope beside the existing `result`. `result` keeps its
      shape and `RawValue` keeps drawing it: this is additive.
- [ ] `ActionIo` gains `readProcessStart(pid)` and `readBootIdentity()`, wired in `realActionIo` to
      `tools/fleet/execution-identity.ts`'s existing functions and faked in the tests. **No test
      reads a real `/proc`.**
- [ ] `parseBoxBody`: a required `preview` claim on a run, `candidates` (identities) in place of
      `pids`, and a body still carrying `pids` refused rather than ignored.
- [ ] `boxRoute` checks, before any effect and before the fresh probe: instance, known, unexpired,
      action, revision, material. Seven named refusal codes, each with a sentence saying what to do.
- [ ] `killRoute`'s run re-reads each submitted candidate's start ticks and the boot id, and signals
      only where pid **and** start ticks **and** boot id all still match — on top of, not instead of,
      today's fresh-scan-still-matches-the-rule intersection.
- [ ] Tests, all asserting on recorded execution and recipient calls: wrong action, wrong revision,
      expired preview, restart between preview and run (two harnesses, two instance ids — the pattern
      § *"an item id from a previous run of the server"* already uses), a reused pid, an unconfirmable
      candidate, and eviction by age and by cap.

### Stage 3 — the client keeps what it showed

**Status:** not started.

- [ ] `ActionsApi.box` splits into `boxPreview(actionId, rows)` and `boxConfirm(envelope)`, and the
      ~10 call sites — nearly all of them in `tests/fleet-actions-route.test.ts` — follow. A confirm
      with no envelope to give then does not compile.
- [ ] `BoxOutcome` keeps `op`, `action` and the parsed envelope. The envelope is *parsed*, not
      trusted: an answer whose `schema` is unrecognised, whose `dryRun` is absent or false, or whose
      `actionId` is not the action that was pressed, reaches the component as **no envelope**, and no
      Confirm is rendered over it.
- [ ] `BoxActions` freezes the reviewed envelope in component state and the confirm submits **only**
      from it. `rows` is read once, at preview time.
- [ ] The confirmation renders the candidate list / recipient list, the exact action words, and
      explicit counts — including the excluded ones with their reasons. `RawValue` moves under a
      collapsed *diagnostic detail*, kept because a field this page has never heard of must stay on
      the page.
- [ ] Component tests in `tests/fleet-box-confirm.test.tsx`: missing `dryRun`, `dryRun: false`,
      malformed payload, mismatched action — each shows a refusal or unknown state with **no
      executable confirm control**.

## Files

Mine: `tools/fleet/routes-actions.ts`, `tools/fleet/web/src/actions-client.ts`,
`tools/fleet/web/src/ActionButtons.tsx`, `tests/fleet-actions-route.test.ts` and new tests beside it,
and small targeted type-only additions to `tools/fleet/wire.ts`.

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
