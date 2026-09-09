# Stage 2 — the preview envelope, minted and checked, with kill identity in its material

You are implementing one stage of a plan in the Spideryarn repo. You may edit the working tree. **Do
not commit** — the session that dispatched you reads your diff, runs the gates and commits.

## Read first

1. `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md` — the
   plan. Its "Product decisions taken here" and "What GPT Sol changed about this plan" sections are
   **settled**; do not relitigate them. The second one is where an earlier review of this same plan
   found six P1s, and the design below is what came out of it.
2. `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Box contracts — make the
   existing actions reach their intended inputs" — the spec the plan implements.
3. `tools/fleet/routes-actions.ts` — the whole of `parseBoxBody`, `boxRoute`, `killRoute`,
   `broadcastRoute`, `ActionIo`, `ActionDeps`, `realActionIo`, `realActionDeps`, and the header
   § "What a box action answers".
4. `tools/fleet/execution-identity.ts` — `readProcessStart`, `readBootIdentity`, `parseProcStat`,
   `BootIdentity`, `ProcessStartTicks`. **Reuse these. Do not write a second process identity.**
5. `tools/fleet/instance.ts` — the per-run server instance id and the `<instance>-<local>` id
   convention.
6. `tools/fleet/actions.ts` — `ACTIONS`, `planKillProcesses`, `renderBroadcast`, `staggerMinutes`.
7. `tests/fleet-actions-route.test.ts` — `harness()`, `fakeIo()`, `browserFetch()`, `call()`, and the
   block at the end, § "a box action confirms the preview it was given, and nothing else". Those
   three tests are red now and are **Stage 3's** to turn green; this stage must not break the rest of
   the file, and where an existing test asserts today's broken behaviour you change that test and say
   so in your report.
8. `AGENTS.md` § "Writing code". Comments in this codebase carry intent and the accident behind a
   rule — not descriptions of the code.

## Scope: server only

`tools/fleet/routes-actions.ts`, and **small, targeted, type-only** additions to `tools/fleet/wire.ts`
(re-read that file immediately before each edit; another session is adding a type to it). You may add
tests to `tests/fleet-actions-route.test.ts`.

**Do not touch** `tools/fleet/web/src/**` (Stage 3), `tools/fleet/routes-new.ts`,
`tools/overseer/**`, `scripts/gjd-remote.ts`, or anything readiness-related.

## What to build

### 1. Wire types (`tools/fleet/wire.ts`, types only — no imports, no runtime values)

`tests/fleet-compile-guards.test.ts` enforces the no-imports/no-values rule; keep it passing.

```ts
export type FleetActionPreview = {
  schema: "fleet-action-preview/1";
  previewId: string;
  serverInstanceId: string;
  actionId: string;
  /** Epoch ms. Past this the preview is gone, whatever else matches. */
  expiresAt: number;
  material: FleetActionMaterial;
};

/**
 * THE CANONICAL MATERIAL — and everything that decides the effect is inside it.
 * Nothing that changes what happens, who it happens to, or what is said may sit
 * outside this object as a sibling request field.
 */
export type FleetActionMaterial =
  | {
      kind: "kill";
      /** Full identity. These, and only these, may be confirmed. */
      confirmable: readonly KillIdentity[];
      /** Shown so the person can see what was left out, and why. Never submitted. */
      excluded: readonly { pid: number; why: string }[];
    }
  | {
      kind: "broadcast";
      /** It changes the sentence AND its authority; outside the check, the words could differ. */
      speaker: "greg" | "overseer";
      /** Order is material: it decides each recipient's stagger position. */
      recipients: readonly BroadcastRecipientClaim[];
    };

/** A confirmable process: the pid, the exact start tick, and the boot it started in. */
export type KillIdentity = { pid: number; startTicks: number; bootId: string };

/** One recipient, exactly as the page claimed it, plus the pause it was promised. */
export type BroadcastRecipientClaim = {
  paneId: string; sessionId: string; claudeSessionId: string | null; panePid: number | null;
  /** The server's own status object, verbatim off the snapshot. */
  status: unknown;
  /** The stagger this row was shown. Bound, so the delivered wait cannot differ from the read one. */
  minutes: number | null;
};

/** What a run hands back to name which preview it is confirming. */
export type FleetActionPreviewClaim = {
  previewId: string; serverInstanceId: string; actionId: string;
};
```

Give kill and broadcast **distinct request arms**, as the roadmap asks. Also add a display view for
the preview's candidates (the fields `killRoute` already builds — pid, rule, why, comm, args, rssKiB,
etimeSeconds) so `result` keeps its shape.

**There is no `actionRevision`, deliberately.** The roadmap names one; the review that produced this
brief showed it cannot fire — `ACTIONS` is a static literal, so a changed definition needs a code
change, needs a restart, mints a new `serverInstanceId`, and the instance check refuses the preview
several steps earlier. Do not add it back.

### 2. The preview table

On `makeActionRoutes`: at most 32 entries, ids `<serverInstanceId>-p<n>`, `PREVIEW_TTL_MS =
5 * 60_000`. On every touch, purge expired entries **first**, then evict the oldest if still over the
cap (the oldest is also the one closest to expiry).

**Each entry has a lifecycle — `fresh` then `claimed` — and the transition is atomic.** Change the
state **before the first `await`** on the run path, so two concurrent confirms cannot both pass.
Keep a claimed entry as a tombstone until its `expiresAt` so that a replay is answered *this
confirmation was already submitted; look at what happened before acting again* rather than *unknown*.
Those are different facts and only one of them invites pressing the button a third time.

`serverInstanceId` must reach `makeActionRoutes` as an injectable dep (add it to `ActionDeps`, wired
in `realActionDeps` from `serverInstanceId()`), so a test can build two runs in one process. That is
how the queue and the quarantine book already take theirs, and the tests depend on it.

### 3. The dry-run arms answer with the envelope

Both `killRoute`'s and `broadcastRoute`'s dry-run responses gain `preview: FleetActionPreview`
**beside** the existing `result`, which keeps its shape exactly — `RawValue` on the page still draws
it, and this is additive. Register the preview in the table as you send it.

**Kill material.** For each candidate, read its start ticks (`readProcessStart`) and the boot id
(`readBootIdentity`, **once** per request). A candidate with a complete identity goes in
`confirmable`; one whose `/proc` read failed goes in `excluded` with the reason, is still listed in
`result` so the person can see it, and can never be submitted. **If the boot identity itself cannot
be read, refuse the whole request** — nothing can be verified without it, and a preview whose every
candidate is unconfirmable is not a preview.

**Broadcast material.** The speaker, and one claim per recipient carrying the five identity fields
verbatim plus the `minutes` that row was shown — computed by the same `staggerMinutes` call the send
will make, in the page's order. Order is preserved and is part of the material.

### 4. `ActionIo` gains the two reads

```ts
readProcessStart(pid: number): ProcessStartTicks;
readBootIdentity(): BootIdentity;
```

Wired in `realActionIo` to `execution-identity.ts`'s functions, and faked in `fakeIo()` so the tests
drive a synthetic box. **No test reads a real `/proc`.**

### 5. The run request, and the checks

`parseBoxBody` gains:

- `preview: FleetActionPreviewClaim` — required for `mode: "run"` on a box action.
- `material: FleetActionMaterial` — the envelope's own, echoed back verbatim.
- **`pids` is gone**, and a body still carrying it is refused with a sentence saying identity is now
  required, rather than being silently ignored. The roadmap's rejected alternative is exactly "adding
  `pids` alone"; a field that is quietly dropped is how that alternative walks back in.

`boxRoute` admits in **this order**, and the order is load-bearing:

```
origin/body → scope/mode/confirm → FLEET_ACT_ENABLED → envelope validation
            → rate/cooldown admission → ATOMIC CLAIM (fresh→claimed) → fresh revalidation → effect
```

A malformed envelope must **not** spend rate-limit capacity, which is why validation precedes
admission. `FLEET_ACT_ENABLED` stays where it already is, so that repairing this code cannot turn
acting on.

Envelope validation, each arm with its own code and a sentence saying what to do:

1. `preview-required` — a run with no claim.
2. `other-instance` — a different server run. Say so the way the queue's own `other-instance` refusal
   does: that run is gone, nothing is being held on its account, reload and look again.
3. `preview-unknown` — no such preview here (evicted, or never existed).
4. `preview-expired` — found, past `expiresAt`. Evict it.
5. `preview-already-used` — found, and already claimed. Name what it was, and do not invite a repeat.
6. `preview-mismatch` — the claim's `actionId` is not the request's action, or not the preview's; or
   the echoed material is not equal, by value and in order, to the stored material's confirmable set.

**A mismatch is a refusal with the reason shown. Never a silent re-preview** — re-previewing behind
the person is how a confirmation stops meaning anything, because the second press would then confirm
a list nobody read.

### 6. The kill run re-probes identity, last

`killRoute`'s run keeps today's both-lists rule — *the fresh scan authorises and the shown list
bounds* — and adds identity on top. Re-read each submitted candidate's start ticks and the boot id as
the **last** thing before `runPlan`, and signal only where pid **and** start ticks **and** boot id all
still match. A candidate that no longer matches goes into `skipped` with a reason naming the
replacement (*that pid is now a different process*). If nothing survives, refuse `nothing-to-kill`
with a sentence distinguishing *the rule no longer matches* from *the process was replaced*.

**Do not write a comment claiming this closes pid reuse.** It does not: the verified process can exit
between the `/proc` read and the `kill`, and the pid can be reused in that gap. What it closes is the
minutes-wide case — a preview left open while the box turns over. Say exactly that, and say that the
durable fix is a pidfd, which Node cannot open without a native dependency.

## Tests you must write (red first, and say in your report which you watched fail)

In `tests/fleet-actions-route.test.ts`, driving the **real** `makeActionRoutes` with fakes and
asserting on **recorded execution and recipient calls** — never on HTTP 200. Every negative case must
record **zero** effects.

- kill preview → run: the recorded argv names exactly the previewed pids.
- broadcast preview → run: the recorded sends name exactly the previewed recipients, in order.
- a claim naming the **wrong action**.
- an **expired** preview (advance the harness clock past five minutes).
- a **replayed** receipt: the same claim confirmed twice — the second is `preview-already-used` and
  the effect happens once.
- **two concurrent confirms** of one receipt, started before either awaits — one effect, one refusal.
- a **restart between preview and run**: preview against one harness, run against a second built with
  a different `serverInstanceId`. Follow § "an item id from a previous run of the server".
- a **mutated candidate token**, a **mutated recipient status**, a **changed recipient order**, and a
  **changed speaker** — each refused as a material mismatch.
- a **reused pid**: the candidate's start ticks change between preview and run; nothing is signalled
  for it and the reason names the replacement.
- an **unreadable boot identity** refuses the whole preview request.
- a candidate whose `/proc` read failed is `excluded` in the material and cannot be submitted.
- the table evicts by age and by cap, and an evicted preview is `preview-unknown`.

## Constraints

- `npx vitest run tests/fleet-actions-route.test.ts tests/fleet-actions.test.ts
  tests/fleet-broadcast-route.test.ts tests/fleet-compile-guards.test.ts` must pass apart from the
  three named below, and `node --import tsx scripts/typecheck.ts` must be clean for what you touched.
- The three tests in § "a box action confirms the preview it was given" **stay red** — they need
  Stage 3's client. Do not delete them, do not weaken them, do not build the client to satisfy them.
- Never touch a live tmux session, the live dashboard on port 8787, or a real process table.

## Report

A short markdown report as your final answer: what you built, which tests you watched red first,
anything in the plan you found wrong or underspecified and what you did about it, and anything you
deliberately left for Stage 3.
