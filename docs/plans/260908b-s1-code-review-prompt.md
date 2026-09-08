# Review request: stage S1, the `SessionState.cause` migration

A **code** review of one landed stage. Small in size, load-bearing in intent.

## What to read

Repository `spideryarn2`, this worktree. The change is committed at revision
`1ec23a4cf4a52d18a0f1b1cd8de6bcbcb9e70e0e`; `git show` it, and read the files at
`e98db6a0afef59183aedaff70021d8b7c9a49985` (the merge that put it on `dev`).

- `scripts/gjd-remote-tmux.ts` — `SessionUnknownCause`, `SessionState`, `sessionState()`.
- `tools/fleet/status.ts` — `statusOf`, which lost a mechanism in this change.
- `tools/fleet/collect.ts` — one construction site.
- `tests/gjd-remote-tmux.test.ts` — the exhaustiveness fixture, near "cause: the identifier a
  watcher may diff".
- `tests/fleet-status.test.ts`, `tests/fleet-collect.test.ts`, `tests/fleet-steer.test.ts`.

Context: `docs/plans/260908b-overseer-store-and-clock.md` § S1, and the prior review
`docs/plans/260908b-plan-review-sol.md` finding **F8**, which specified this work.

## What the change is and why

`SessionState`'s `unknown` arm was `{ kind, why }`, its construction sites distinguished only by
their human-readable sentences. A forthcoming daemon records status transitions by comparing
consecutive statuses, so comparing prose would read a reworded sentence as a state *transition* and
its history would show sessions flapping while nothing happened. The arm now carries a
`cause: SessionUnknownCause` — seven string literals, named for the fault, `why` retained for display.

`statusOf` previously distinguished two unknowns by calling `sessionState` a second time with an
empty map and comparing `why` strings; that mechanism and its constant are deleted, replaced by
`state.cause !== "agents-unavailable"`.

## Known and deliberate, so please do not re-report these

- **One `typecheck` error is left standing**: `tools/fleet/routes-steer.ts:380` constructs
  `{ kind: "unknown", why }` without a cause. That file belongs to another agent who has uncommitted
  work in it and has agreed to make the one-line change; sweeping it into this commit would have
  taken their half-finished hunks with it. **Judge the design, not the fact that it is red.**
- The seventh cause, `client-declared`, exists for that route: a status arriving in a request body is
  something a browser asserted, not something the box observed, so the parser must overwrite rather
  than keep whatever the client sent.
- `client-declared` and `no-status-derived` are in the test fixture's `Exclude` rather than having
  entries, because nothing `sessionState` does can produce either.

## Severity scale — use exactly these

- **P0** — a wrong result or a break that nothing would catch.
- **P1** — a real defect, or a design choice that will be expensive to undo.
- **P2** — worth fixing, plan survives without it.
- **P3** — preference or nit.

Give every finding an ID, a severity, a `file:line`, and a concrete consequence — the sequence of
events that produces a bad outcome.

## What I most want judged

1. **Is `statusOf`'s replacement provably equivalent?** The old guard was
   `state.kind !== "unknown" || agents !== null || agentsWhy === null`, plus a second
   `sessionState` call comparing `why`. The new one is
   `state.kind !== "unknown" || state.cause !== "agents-unavailable" || agentsWhy === null`. The claim
   is that `agents-unavailable` is produced only under `agents === null`, so the conditions coincide.
   **Check that claim against the code rather than accepting it**, including any path where a
   `Session` could reach the `agents === null` clause and a different clause on a second call.
2. **Are the seven causes the right cut?** Too many, too few, or wrongly grouped? In particular:
   `unrecognised-agent-status` deliberately does not carry the status name it found, on the grounds
   that a box reporting two unfamiliar statuses in turn has one problem. Is that right, and is the
   information genuinely preserved in `why`?
3. **Is `cause` required rather than optional the right call**, given it forces a change on a file
   whose owner is mid-edit?
4. **Does the test actually constrain anything?** The fixture is annotated as an exhaustive `Record`
   over the causes minus two exclusions. Note that **vitest does not typecheck**, so this guard fires
   only under `npm run typecheck`. Is that guard real, or does it have a hole — e.g. could a new
   cause be added and quietly excluded instead of tested?
5. **Anything in the deleted `LISTED_NOTHING` mechanism that was load-bearing** and has been lost
   with it. The old comment argued it read "the source's structure rather than its prose"; the new
   code claims `cause` does that properly. Is anything else gone?

## Constraints on the code

- `strict` and `noUncheckedIndexedAccess`. Prefer states the compiler rejects over states a test
  catches.
- `scripts/gjd-remote-tmux.ts` is shared with `gjd-remote`, the box's session CLI, which consumes
  only `kind` and `why`. A change here is not local.
- **Do not change any file.** Read-only review.

## My own suspicions, last

- I am not certain the `statusOf` equivalence holds in every case; it is the claim I would most like
  disproved.
- Putting `client-declared` in the `Exclude` rather than giving it a fixture may have weakened the
  guard: a future cause could be waved through by adding it to the `Exclude` with a plausible
  sentence, and nothing would object.
- `no-status-derived` and `client-declared` are both "nobody observed this", which may mean the union
  is really two unions — box-faults and provenance — wearing one type.
