# Stage 3 — the client keeps what it showed, and can only confirm that

You are implementing one stage of a plan in the Spideryarn repo. You may edit the working tree. **Do
not commit** — the session that dispatched you reads your diff, runs the gates and commits.

## Read first

1. `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md` — the
   plan. Its "Product decisions taken here" and "What GPT Sol changed about this plan" sections are
   **settled**; do not relitigate them.
2. The server half, which landed in commit `2c9a6d9a` and is what you are now talking to:
   `tools/fleet/wire.ts` § "BOX ACTION PREVIEWS", and in `tools/fleet/routes-actions.ts`
   `validatePreview`, `boxRoute`, `killRoute`, `broadcastRoute`, `mintPreview`, `parseBoxBody`.
3. `tests/fleet-actions-route.test.ts` — especially the helpers `confirmation()`, `killPreview()`,
   `previewAndConfirm()`, `browserFetch()`, and the block § "a box action confirms the preview it was
   given, and nothing else", whose **three tests are the acceptance criterion for this stage**.
4. `tools/fleet/web/src/actions-client.ts` — `boxActionBody`, `addressableRows`, `BoxOutcome`,
   `parseBoxEffect`, `ActionsApi`, `makeActionsApi`.
5. `tools/fleet/web/src/ActionButtons.tsx` — `BoxActions`, `BoxActionsCard`, `BoxEffectSummary`,
   `effectHeadline`, `RawValue` usage.
6. `tools/fleet/web/src/steer-client.ts` — `SteerTargetBody`, `steerTargetBody`, and the header rule
   that **no identifying value is ever refetched or rebuilt by the client**.
7. `AGENTS.md` § "Writing code". Comments here carry intent and the accident behind a rule.

## What the server now does, concretely

A dry run answers `{ ok, op, action, dryRun: true, result, preview }` where `preview` is a
`FleetActionPreview`: `{ schema: "fleet-action-preview/1", previewId, serverInstanceId, actionId,
expiresAt, material }`.

A run must post:

```json
{ "actionId": "<same>", "mode": "run", "confirm": true,
  "preview": { "previewId": "…", "serverInstanceId": "…", "actionId": "…" },
  "material": <the envelope's own material, echoed verbatim> }
```

**The whole material is echoed, `excluded` included** — the route deep-equals what you send against
what it stored, so anything dropped or reordered is `preview-mismatch`. `speaker` now lives *inside*
the broadcast material, so a run posts no top-level speaker. A run posts no `recipients` and no
`pids`; `pids` is refused outright.

A dry run still posts what it always did: `{ actionId, mode: "dry-run" }` for a kill, and
`{ actionId, mode: "dry-run", speaker: "greg", recipients: [...] }` for a broadcast, where
`recipients` are `addressableRows(rows).map(steerTargetBody)` exactly as today.

## Scope

`tools/fleet/web/src/actions-client.ts`, `tools/fleet/web/src/ActionButtons.tsx`,
`tests/fleet-actions-route.test.ts`, and a new `tests/fleet-box-confirm.test.tsx`.

Plus **two small threaded-prop edits, and nothing else in those files**:
`tools/fleet/web/src/HealthPanel.tsx` and `tools/fleet/web/src/App.tsx`. Another session is live in
both — make the minimum edit and do not reformat or refactor around it.

**Do not touch** `tools/fleet/routes-actions.ts`, `tools/fleet/wire.ts`, `tools/fleet/routes-new.ts`,
`tools/overseer/**`, `scripts/gjd-remote.ts`, or anything readiness-related.

## What to build

### 1. `actions-client.ts` — parse the envelope, strictly

`BoxOutcome`'s ok arm gains `op: string | null`, `action: string | null`, and
`preview: FleetActionPreview | null`. `op` and `action` are read off the answer and kept; today they
are read and discarded, so the page has to sniff the shape of `result` to tell a kill preview from a
broadcast preview — a guess where the server sent a fact.

**The envelope is parsed, not trusted, and it is all or nothing.** It reaches the component as
`null` — meaning *no Confirm may be rendered* — unless **every** one of these holds:

- `schema === "fleet-action-preview/1"`
- `dryRun === true` and it was actually stated (not inferred from the request)
- the top-level `action` is the action that was pressed
- `op` is the expected preview op for that action's effect: `"dry-run"` for an enacted kill,
  `"broadcast-preview"` for a broadcast
- the envelope's `actionId` is the same action
- `material.kind` matches the action's effect (`kill` for `enacted`, `broadcast` for `broadcast`)
- every field of the material parses — no partial material, ever. A half-read candidate list is a
  confirmation of something nobody saw.

A contradictory answer — a kill preview carrying `op: "ran"`, a broadcast envelope under
`op: "dry-run"` — must never acquire a Confirm button merely because `dryRun` is true.

### 2. `actions-client.ts` — split the API

Replace `box: (actionId, dryRun, rows) => Promise<BoxOutcome>` with:

```ts
boxPreview: (actionId: string, rows: readonly FleetRow[]) => Promise<BoxOutcome>;
boxConfirm: (preview: FleetActionPreview) => Promise<BoxOutcome>;
```

A confirm that has no envelope to give then **does not compile**, which is the difference between a
rule and a convention. Update every call site — there are about ten, nearly all in
`tests/fleet-actions-route.test.ts`, including the `replay(...)` ones, the `PageRow` type alias
(`Parameters<…["box"]>[2][number]`), and `tests/fleet-questions-panel.test.tsx`'s stub.

Keep one body builder per request, in this file, as `boxActionBody` was. Do not add a second.

### 3. `ActionButtons.tsx` — one state value, and a generation

`BoxActions` currently holds `pending` and `preview` as separate state, written independently by each
async press. Press A, press B, B answers, A answers second and overwrites `preview`: the panel then
reads *Confirm: B* over A's envelope, and the confirm obediently runs **A**. React's `busy` flag does
not synchronously stop the second press, and freezing the rows does nothing about it.

So: **one** state value, `{ generation, action, outcome }`, incremented per press, and any response
whose generation is not the current one is **discarded**. Render and confirm only out of that value.

`rows` is read **once**, at preview time. The confirm submits only `envelope.material`.

### 4. `ActionButtons.tsx` — the confirmation says what it will do

Replace the generic `RawValue` confirmation for these two operations with:

- **Kill**: the confirmable candidates as a list — pid, comm, a truncated argv, the rule that matched
  — with an explicit count; and the **excluded** ones under their own heading with each reason, so a
  denominator that quietly shrank is impossible. If there is nothing confirmable, there is no Confirm.
- **Broadcast**: the recipients as a list with the pause each was promised, an explicit count, and the
  exact sentence the server sampled. The rows dropped as unaddressable are already counted in this
  component; keep that sentence.
- The **exact action words** in both cases — the action's own label, not a paraphrase.

`RawValue` stays, moved under a collapsed *diagnostic detail* disclosure. Nothing the server sends
stops being on the page: a field this build has never heard of must still be readable.

### 5. `HealthPanel.tsx` and `App.tsx` — the Health tab's Broadcast is dead

`BoxActions` takes an optional `rows`, and without it `boxActionBody` sends `recipients: []` and
`broadcastRoute` refuses on its first line. `OverseerPanel` passes `rows`; `HealthPanel` never has,
and `App` does not give it any — so Broadcast on Box Health previews with nobody in it and is refused,
exactly as the Overseer tab's was until 2026-09-09.

`App.tsx` already has `const rows = feed.state?.rows ?? []` in scope at line ~200 and passes
`rows={rows}` to `OverseerPanel` at ~424. Thread the same value to `HealthPanel`, and from there to
its `BoxActionsCard`. **That is the whole edit in those two files.**

## Tests

**The acceptance criterion** is the three tests in `tests/fleet-actions-route.test.ts` §
"a box action confirms the preview it was given, and nothing else" going green **without being
weakened**. They assert on `ran` (the argv the box was handed) and `sent` (who the delivery module
was asked to speak to), never on a status code. One of them uses `material.candidates`; the canonical
spelling is `material.confirmable` — fix the test's spelling, not the wire.

Also turn round the test § "asks for a real run in the field this route reads", which asserts today's
`nothing-to-kill` refusal and names the gap in its own comment. **Do not delete it** — it is the
record of the defect. Rewrite it to assert what now happens, and keep the history in the comment.

New `tests/fleet-box-confirm.test.tsx` (jsdom lane, like `tests/fleet-broadcast-card.test.tsx`):

- an answer with **no** envelope (an older server) → no executable confirm control
- `dryRun` absent, and `dryRun: false` → no confirm control
- a malformed / half-parsable material → no confirm control
- a mismatched `actionId` between the button and the envelope → no confirm control
- a contradictory `op` (kill material under `op: "ran"`, broadcast envelope under `op: "dry-run"`) →
  no confirm control
- **two preview promises resolved out of order**: press A, press B, resolve B then A. The panel must
  show B, and confirming must submit **B's** envelope and no other.
- a kill preview with some excluded candidates renders both counts and every exclusion reason.

## Constraints

- These must pass: `npx vitest run tests/fleet-actions-route.test.ts tests/fleet-actions.test.ts
  tests/fleet-broadcast-route.test.ts tests/fleet-broadcast-card.test.tsx tests/fleet-web.test.tsx
  tests/fleet-questions-panel.test.tsx tests/fleet-box-confirm.test.tsx tests/fleet-imports.test.ts`
- `node --import tsx scripts/typecheck.ts` must be **clean** — this stage is where the seven
  `boxPreview`/`boxConfirm` errors go away. Judge it by its exit code; its last two lines always
  print a tick.
- Never touch a live tmux session, the dashboard on port 8787, or a real process table. No network.

## Report

A short markdown report as your final answer: what you built, which tests you watched red first,
anything in the plan you found wrong or underspecified and what you did about it, and every file you
changed.
