# Stage 2 — the preview envelope, minted and checked, with kill identity in its material

You are implementing one stage of a plan in the Spideryarn repo. You may edit the working tree. **Do
not commit** — the session that dispatched you reads your diff, runs the gates and commits.

## Read first

1. `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md` — the
   plan. Its "Product decisions taken here" section is settled; do not relitigate it.
2. `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Box contracts — make the
   existing actions reach their intended inputs" — the spec.
3. `tools/fleet/routes-actions.ts` — the whole of `parseBoxBody`, `boxRoute`, `killRoute`,
   `broadcastRoute`, `ActionIo`, `ActionDeps`, `realActionIo`, `realActionDeps`, and the header
   § "What a box action answers".
4. `tools/fleet/execution-identity.ts` — `readProcessStart`, `readBootIdentity`, `parseProcStat`,
   `BootIdentity`, `ProcessStartTicks`. **Reuse these. Do not write a second process identity.**
5. `tools/fleet/instance.ts` — the per-run server instance id.
6. `tests/fleet-actions-route.test.ts` — `harness()`, `fakeIo()`, `browserFetch()`, `call()`, and the
   block at the end, § "a box action confirms the preview it was given, and nothing else". Those
   three tests are red now and are Stage 3's to turn green; **this stage must not break the rest of
   the file**, and where an existing test asserts today's broken behaviour you change that test and
   say so in your report.
7. `docs/project/code-quality-overview.md` and `AGENTS.md` § "Writing code" for house style. Comments
   in this codebase carry intent and the accident behind a rule, not descriptions of the code.

## Scope: server only

`tools/fleet/routes-actions.ts`, and **small, targeted, type-only** additions to `tools/fleet/wire.ts`
(re-read that file immediately before each edit; another session is adding a type to it).
You may add tests to `tests/fleet-actions-route.test.ts`.

**Do not touch** `tools/fleet/web/src/**` (Stage 3), `tools/fleet/routes-new.ts`,
`tools/overseer/**`, `scripts/gjd-remote.ts`, or anything readiness-related.

## What to build

### 1. Wire types (`tools/fleet/wire.ts`, types only — no imports, no runtime values)

`tests/fleet-compile-guards.test.ts` enforces that; keep it passing.

```ts
/** The envelope a dry run answers with, and the receipt a run has to hand back. */
export type FleetActionPreview = {
  schema: "fleet-action-preview/1";
  previewId: string;
  serverInstanceId: string;
  actionId: string;
  actionRevision: string;
  /** Epoch ms. After this the preview is unknown, whatever else matches. */
  expiresAt: number;
  material: FleetActionMaterial;
};

export type FleetActionMaterial =
  | { kind: "kill"; candidates: readonly KillCandidateView[] }
  | { kind: "broadcast"; recipients: readonly BroadcastRecipientClaim[] };

/** A process this kill would signal, and whether it can be identified well enough to confirm. */
export type KillCandidateView = { /* the fields killRoute already builds */ identity: KillIdentity };

export type KillIdentity =
  | { known: true; pid: number; startTicks: number; bootId: string }
  | { known: false; pid: number; why: string };

/** One recipient claim, verbatim as the page sent it. Same five fields as `SteerTargetBody`. */
export type BroadcastRecipientClaim = { … };

/** What a run hands back to say which preview it is confirming. Material is NOT in here. */
export type FleetActionPreviewClaim = {
  previewId: string; serverInstanceId: string; actionId: string; actionRevision: string;
};
```

Give kill and broadcast **distinct request arms** as the roadmap asks. A shared compile-time type is
not validation of network data; the runtime parsers below still check everything.

### 2. The preview table

On `makeActionRoutes`, a bounded in-memory table: at most 32 entries, ids `<serverInstanceId>-p<n>`
(the `<instance>-<local>` convention `tools/fleet/instance.ts` documents and `SteeringQueue` already
follows), `PREVIEW_TTL_MS = 5 * 60_000`. Evict expired entries on every touch, then evict the oldest
if still over the cap. It is volatile by construction: a restart makes every outstanding preview
unknown, which is the true answer, and the refusal must say *a different run of this dashboard* the
way the queue's `other-instance` refusal already does.

`serverInstanceId` must reach `makeActionRoutes` as an injectable dep (add it to `ActionDeps`, wired
in `realActionDeps` from `serverInstanceId()`), so a test can build two instances in one process.
That is how the queue and the quarantine book already do it and the tests depend on it.

### 3. `actionRevision`

A short stable hash (sha256, first 12 hex) over a canonical serialisation of the action's own
definition — id, label, scope, effect, needsConfirm, and whatever text/stagger a broadcast renders
from. Pure function, exported, tested: the same action gives the same digest across two calls, and a
changed definition gives a different one.

### 4. The dry-run arms answer with the envelope

Both `killRoute`'s and `broadcastRoute`'s dry-run responses gain `preview: FleetActionPreview`
**beside** the existing `result`, which keeps its shape exactly — `RawValue` on the page still draws
it, and this is additive. Register the preview in the table as you send it.

Kill material is the candidate list **with identity**: for each candidate, read its start ticks
(`readProcessStart`) and the boot id (`readBootIdentity`, once per request). A candidate whose
`/proc` read fails gets `identity: { known: false, pid, why }` and is still listed — the person must
see it, and see that it cannot be confirmed. Broadcast material is `r.recipients`, verbatim.

### 5. `ActionIo` gains the two reads

```ts
readProcessStart(pid: number): ProcessStartTicks;
readBootIdentity(): BootIdentity;
```

Wired in `realActionIo` to `execution-identity.ts`'s functions, and faked in `fakeIo()` so the tests
drive a synthetic box. **No `/proc` is read by any test.**

### 6. The run request, and the checks

`parseBoxBody` gains:

- `preview: FleetActionPreviewClaim` — required for `mode: "run"` on a box action, refused
  `preview-required` when absent.
- kill: `candidates: KillIdentity[]` where every entry is `known: true` — the reviewed, confirmable
  set. **`pids` is gone**, and a body still carrying it is refused with a sentence saying identity is
  now required rather than being silently ignored. (The roadmap's rejected alternative is exactly
  "adding `pids` alone"; a field that is quietly dropped is how that alternative comes back.)
- broadcast: `recipients` as today.

`boxRoute`, **before any effect and before the fresh probe**, in this order, each with its own
refusal code and a sentence naming what to do:

1. `preview-required` — a run with no claim.
2. `other-instance` — the claim names a different server run. Say it was a different run of this
   dashboard and that nothing is being held on its account; reload and look again.
3. `preview-unknown` — no such preview here (evicted, or never existed).
4. `preview-expired` — found and past `expiresAt`. Evict it. A distinct code from `unknown`, because
   *your preview aged out* and *I have never heard of this* are different facts and only one of them
   invites simply pressing again.
5. `preview-mismatch` — the claim's `actionId` is not the request's action, or not the preview's.
6. `preview-stale-action` — the revision differs.
7. `preview-mismatch` again for the material: the submitted candidate identities (or recipient
   claims) must equal the stored material's confirmable set, by value, in order.

**A mismatch is a refusal with the reason shown. Never a silent re-preview** — re-previewing behind
the person is how a confirmation stops meaning anything, because the second press would then confirm
a list nobody read.

Existing gates keep their existing places relative to each other: `wrong-scope`, `confirm-required`,
`acting-disabled` (`FLEET_ACT_ENABLED`) and the rate limiter are unchanged, and **nothing here turns
the acting gate on**.

### 7. The kill run re-probes identity

`killRoute`'s run path keeps today's both-lists rule — *the fresh scan authorises and the shown list
bounds* — and adds identity on top: for each submitted candidate, re-read its start ticks and the
boot id, and act only where pid **and** start ticks **and** boot id all still match. A candidate that
no longer matches goes into `skipped` with a reason naming the replacement (*that pid is now a
different process*), not into the signalled set. If nothing survives, refuse `nothing-to-kill` with a
sentence that distinguishes *the rule no longer matches* from *the process was replaced*.

## Tests you must write (red first, and say in your report which you watched fail)

In `tests/fleet-actions-route.test.ts`, driving the **real** `makeActionRoutes` with fakes, asserting
on **recorded execution and recipient calls**, never on HTTP 200:

- kill preview → run: the recorded argv names exactly the previewed pids.
- broadcast preview → run: the recorded sends name exactly the previewed recipients.
- a run whose claim names a **wrong action** is refused, and nothing is recorded.
- a run whose claim names a **wrong revision** is refused, and nothing is recorded.
- an **expired** preview (advance the harness clock past five minutes) is refused, and nothing is
  recorded.
- a **restart between preview and run**: preview against one harness, run against a second built with
  a different `serverInstanceId`, refused `other-instance`, nothing recorded. Follow the pattern in
  § "an item id from a previous run of the server".
- a **reused pid**: the candidate's start ticks change between preview and run; nothing is signalled
  for it and the reason names the replacement.
- a candidate whose `/proc` read failed is in the preview marked unconfirmable, and a run that tries
  to submit it is refused.
- the preview table evicts by age and by cap, and an evicted preview is `preview-unknown`.

## Constraints

- `npm test` and `node --import tsx scripts/typecheck.ts` must pass for the files you touched. Run
  `npx vitest run tests/fleet-actions-route.test.ts tests/fleet-actions.test.ts
  tests/fleet-broadcast-route.test.ts tests/fleet-compile-guards.test.ts` at minimum.
- The three tests in § "a box action confirms the preview it was given" stay red — they need Stage
  3's client. Do not delete them, do not weaken them, and do not implement the client to satisfy them.
- Never touch a live tmux session, the live dashboard on port 8787, or a real process table.
- House comment style: say why, and say what went wrong that makes the rule necessary.

## Report

Write a short markdown report as your final answer: what you built, which tests you watched red
first, anything in the plan you found wrong or underspecified and what you did about it, and anything
you deliberately left for Stage 3.
