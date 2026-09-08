# Review request: stage S2, the Overseer's observation contract and diff

A **code** review of one landed stage — the first code of a new tool.

## What to read

Repository `spideryarn2`, this worktree, at revision `33ea17a4` (the change itself is `d54a87e6`).

The stage:
- `tools/overseer/observation.ts` — strict parse of the dashboard's snapshot from `unknown`.
- `tools/overseer/admissible.ts` — `accept | duplicate | reject`.
- `tools/overseer/diff.ts` — events, canonical keys, the generation rule.
- `tests/overseer-observation.test.ts`, `tests/overseer-diff.test.ts`, `tests/overseer-fixtures.ts`.
- `tests/fixtures/overseer-snapshots/` — REAL captured snapshots, and a README whose "what these do
  NOT cover" section is load-bearing.

Context, in this order:
- `docs/plans/260908b-overseer-store-and-clock.md` — the plan. Read § "Identity, and the three ways a
  session can stop being there" and the `claudeSessionId` correction above it.
- `docs/project/overseer-direction.md` — the direction and the constraints.
- `scripts/gjd-remote-tmux.ts` — `SessionState`, `SessionUnknownCause`, `reportedStatus`.
- The producer being consumed: `tools/fleet/collect.ts`, `tools/fleet/state.ts`, `tools/fleet/server.ts`.

## What this is for

A daemon will subscribe to the fleet dashboard's snapshot stream and record what the fleet does over
time, so that later stages can rank what needs a human, and rebuild the fleet after a reboot. **This
stage is pure logic only** — no I/O, no daemon, no timers. Every import in the three modules is
`import type` by design.

The hazard the whole design is organised around is not crashing but **plausible wrongness**: a
history that reads correctly and is false. Two named instances: a snapshot that was not really
re-collected being recorded as change, and a session whose conversation was replaced without the
tmux environment noticing.

## Known and deliberate — do not re-report

- **`health` and `question` are carried verbatim as opaque JSON and never validated.** They are
  stored, not interpreted; pinning their shape would fail whole snapshots when the producer grows a
  field, which it did twice during this stage's construction.
- **A clock going backwards is `reject`, not `duplicate`.** Equal has an innocent explanation every
  minute; earlier does not.
- **The committed fixtures contain no `waiting` status**, so several cases are constructed from a
  real fixture and labelled `CONSTRUCTED` in the test name. This is documented in the fixtures README.
- `session-replaced` cannot be trusted by its absence; that is a known limitation with a pinned test.

## Severity scale — use exactly these

**P0** a wrong result or break nothing would catch · **P1** a real defect or an expensive-to-undo
design choice · **P2** worth fixing, survives without it · **P3** preference.

Give every finding an ID, a severity, a `file:line`, and the concrete sequence of events that
produces a bad outcome.

## What I most want judged

1. **Is the strict parse actually strict, and strict in the right places?** It fails the whole
   snapshot on any malformed row, duplicate id, bad timestamp or unknown schema, rather than dropping
   rows — because dropping rows would manufacture "session gone" events. Is there any input that gets
   past it and produces a wrong event rather than a rejection? Try to find one.
2. **The generation rule.** `generationRelation` is three-armed — `same | changed | unverifiable` —
   and on `changed` the diff refuses to compare, emitting closures for the old world and sightings
   for the new. Is `unverifiable` (either side null) treated correctly by diffing normally, or is that
   the wrong default? What happens across a null→number transition?
3. **The canonical key.** `statusKey` is `kind` + `shell.busy` + `unknown.cause` + `reportedStatus`.
   Does it drop anything that a consumer would care about, or include anything that varies for
   reasons a consumer would not?
4. **Event ordering and completeness.** Order is asserted as part of the contract. Are there
   transitions that produce no event and should, or two events where one is right? In particular:
   a session appearing and disappearing between two observed collections is invisible — is that
   acceptable, and is it documented?
5. **Are the branded types earning their keep**, or are they ceremony? `ClaimedConversationId`,
   `SessionKey`, `StatusKey`.
6. **Is anything here not worth having?** Reducing this stage is a legitimate finding.

## Constraints

- `strict` and `noUncheckedIndexedAccess`. Wrong states should be uncompilable.
- Nothing new in `package.json`; no import from `src/`; no I/O in this directory.
- **Do not change any file.** Read-only review. You may run
  `npx vitest run tests/overseer-observation.test.ts tests/overseer-diff.test.ts` — it needs nothing
  outside the tree.

## My own suspicions, last

- The `unverifiable` generation arm may be wrong. Diffing normally when we cannot verify the world is
  the same is the optimistic choice, and everything else in this design takes the pessimistic one.
- `admissible` takes a `ParseResult` rather than a snapshot, so a parse failure and a stale snapshot
  produce verdicts from the same function. That may be conflating two things.
- The fixtures' inability to exercise the noise they were captured for suggests the test suite may be
  weaker than its numbers imply. Which of these tests would survive a semantically wrong
  implementation that is not merely mutilated?
