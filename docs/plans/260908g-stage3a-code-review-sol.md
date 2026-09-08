# GPT Sol's review of Stage 3a's CODE, 2026-09-08

Verbatim, as returned. Reviewed the scoped diff `2680b1d0^..2680b1d0`. This is the **second** review
of this stage — the plan review is
[260908g-stage3-plan-review-sol.md](260908g-stage3-plan-review-sol.md) — and it is weighted higher,
per `CLAUDE.md`, because a plan review cannot find a conditional pretending to be a type.

Up: [260908g](260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) § The code
review, which says what each finding changed and which are deferred to 3d with a named condition.

**Note on the last line.** The concurrent uncommitted edit to `docs/project/overseer.md` was mine,
made while this review was running: the `OVERSEER_RULES_ENABLED` paragraph the implementer correctly
declined to write.

---

## Verdict

Block Stage 3a as a reusable protocol for acting rules. The shipped `wedged-work` rule remains non-enacting today, but two protocol guarantees are not actually established.

## Findings

### SC-1 — P0 — Acting rules can outlive the daemon, lose their settlement, and run again

Files: [daemon.ts:858](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/daemon.ts:858), [scheduler.ts:600](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:600), [store.ts:2096](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:2096)

`runRule` returns a hot `done` promise, but the daemon neither retains nor awaits it. The shutdown comment assumes every scheduled job is a separate process; rules run inside the daemon.

Consequences:

- During orderly shutdown, the store is closed while an actor may still be awaiting its HTTP response. The action may land afterwards, while both `rule-settled` and `job-occurrence-finished` fail against the closed store.
- A hung actor may already have acted. When its two-minute lease expires, the occurrence becomes `unknown`; after the interval, the scheduler may invoke it again.
- After a crash between action and settlement, `rule-intended` is replayed but folded into no durable rule state. The occurrence eventually becomes eligible again.
- Therefore `rule-settled` is not durable—or even writable—in every path that could have acted.

This permits repeated messages/spend for a future acting rule and fails gates 3 and 4.

Do instead: maintain a durable rule-run index that retains unpaired `rule-intended` events across checkpoints. An acting occurrence with an unpaired intent must be held for explicit reconciliation, or use an idempotency key and downstream receipt. Also track and await in-process rule promises during graceful shutdown; an `AbortSignal` is useful but does not replace uncertain-outcome recovery.

### SC-2 — P0 — SP-1/QB remain open: `propose` is a conditional in unpinned code, not a structural capability boundary

Files: [scheduler.ts:602](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:602), [scheduler.ts:143](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:143), [rule-jobs.ts:92](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rule-jobs.ts:92)

Every `RuleWork` contains an `act` callback. The only separation is:

```ts
switch (spec.disposition) {
  case "propose": ...
  case "act": await rules.act(...)
}
```

That is precisely the conditional boundary the claim said had been avoided. Worse, `scheduler.ts`—which interprets the hashed disposition—is deliberately absent from `RULE_SOURCES`. A change that bypasses the switch leaves the rule’s authorised hash current. Mutation tests detecting such a change do not make the authorisation fingerprint reject it.

The observer also delegates the meaning of the hashed `"safe-to-kill"` policy to unpinned code in `actions.ts` and `routes-actions.ts`; changing that policy changes what the rule proposes without changing its fingerprint.

The current `refusingActor` independently prevents Rule 2 from killing anything, so the present rule is safe. The claimed structural protocol is not.

Do instead: make proposal-only wiring hold no actor capability at runtime—for example, a `runProposingRule` that accepts only `observe`. Give acting jobs a separate runner/type and capability. Move the disposition interpretation into pinned rule-specific code, or pin/version the protocol and remote policy semantics explicitly.

### SC-3 — P1 — Re-pinning forgets old occurrences and can immediately duplicate an in-flight job

Files: [jobs.ts:548](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:548), [jobs.ts:562](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:562), [standing-jobs.ts:136](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/standing-jobs.ts:136)

`lastRunOf` ignores every occurrence whose definition hash differs from the current hash. I exercised an in-flight `get-ready-to-deploy` occurrence under `07eaeebbfc76` against the new definition: it returns `last: never`, then `due` immediately.

Thus a daemon restarted with the new no-behaviour-change pin can launch another session while the old detached session still exists. A settled old occurrence also stops contributing to cadence.

The plan says these standing jobs have never run, so this specific repin appears not to have a live occurrence to duplicate. I could not verify the production store from the supplied source. The migration behavior remains unsafe for later repins.

Do instead: separate occurrence lineage/hash-schema identity from behavioural authorisation. At minimum, hold same-job unsettled legacy occurrences across hash changes and provide an explicit compatibility mapping for semantic-no-op rehashes.

### SC-4 — P1 — The claimed compiler-enforced hash exhaustiveness is false

Files: [jobs.ts:210](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:210), [rules.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rules.ts:55), [rules.ts:87](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rules.ts:87)

Destructuring fields is not exhaustive in TypeScript. Adding a field to `JobDefinition` or `RuleSpec` does not make these destructures fail compilation. After constructors are updated—or immediately for an optional field—the new behavior can be omitted from the hash silently.

The test named “every knob” enumerates today’s fields manually; it does not protect future fields.

Do instead: define canonical encoders through an exact mapped type such as `Record<keyof RuleSpec, ...>` and the equivalent for `JobDefinition`, so a new key creates a compile error until its encoding is supplied.

### SC-5 — P2 — The round-trip test guards branch existence but not parsed values

File: [overseer-rules.test.ts:513](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-rules.test.ts:513)

The test comment says events are read through the store parser, but `eventsFrom` uses `JSON.parse(line) as OverseerEvent`. Reopening the store correctly catches deletion of the entire rule-family parse branch through `unreadableLines`, so that reported mutation is genuinely caught.

However, mutations that accept the event while changing or dropping parsed fields would pass: for example, returning an empty `processes`, changing `matched`, or replacing the parsed outcome text. `foldEvents` intentionally ignores rule events, so it cannot expose those corruptions.

Do instead: assert event contents from `second.readEvents(0).events`, which passes through `parseEvent`, rather than rereading raw JSON with a cast.

## Direct checks

- QA: The actual `act` callback is called only after `append` returns success, and the real store returns success only after `fsyncSync`. A failed write, full store, or failed fsync prevents `act`. An actor throw becomes a failed settlement attempt. Failures after an action and process death are not safely recovered; see SC-1.
- QB: No. It is a runtime conditional plus a refusing actor, not a structural absence of the actor.
- QC: The shipped rules-only wiring passes only `rules.jobs` and no `spawn`. A session definition injected into that daemon is refused; casts cannot manufacture the missing runtime function. This part passes.
- QD: Both rule kinds are registered, parsed, and accepted across restart. Deleting the family branch is caught. Semantic parser fidelity is not tested; see SC-5.
- QE: All three current pins calculate correctly. Legacy-hash occurrences are ignored, creating the duplication window in SC-3.
- QF: The request body hardcodes `mode: "dry-run"` and omits `confirm`; neither is caller-configurable. The current route performs only the process scan and preview. This part passes.
- QG: The ordering-failure, in-actor disk observation, threshold boundary, disposition, and missing-parser-branch tests are load-bearing. The semantic round-trip and compiler-exhaustiveness claims are weaker than stated.
- Checkpoint state: `armed` plus prose is tolerable for this stage because the current reader prints the detail. It should be widened before another consumer branches on the discriminant.
- Four-hour threshold: still a one-specimen guess, but it is explicit, hashed, and proposal-only. I would gather evidence rather than block 3a on it.

## Verification

- `tests/overseer-rules.test.ts`: 26/26 passed.
- `tests/overseer-standing-jobs.test.ts` and `tests/overseer-daemon.test.ts`: 50/50 passed.
- Requested jobs/store/diff set: 174/175 passed. The sole failure expects probing PID 1 to raise `EPERM`; this sandbox permits it, so no error code was produced.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`.
- Pin calculator confirmed all three hashes.
- `git diff --check` passed.

I changed no files. During review, `docs/project/overseer.md` acquired an unrelated concurrent uncommitted edit; it was not made by me.