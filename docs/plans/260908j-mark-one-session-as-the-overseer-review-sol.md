The plan is not ready to build. The tmux-session environment is adequate as an advisory locator, but three fail-closed paths are missing.

## P0 — Must fix before building

### P0-1 — A failed role read currently becomes “no role”

The plan says tmux being unreachable fails the whole listing ([plan](/home/greg/code/spideryarn2/.claude/worktrees/overseer-singleton-claim/docs/plans/260908j-mark-one-session-as-the-overseer.md:90)). That is true for the initial `tmux ls`, but not for the per-session environment reads.

The reader pattern suppresses stderr and pipes through `cut`:

[`scripts/gjd-remote-tmux.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-singleton-claim/scripts/gjd-remote-tmux.ts:584)

A genuinely absent variable and any `show-environment` failure both produce `mrole=""`. A disappearing target, server failure between listing and lookup, or another lookup error can therefore become `{kind:"none"}`.

Make the shell protocol distinguish:

- command succeeded and key was absent → `none`;
- command succeeded and returned a value → parse it;
- command failed or the session changed → fail/retry the listing or produce `cannot-tell`.

Add a test where `tmux ls` succeeds but the role lookup fails. It must never produce `none`.

### P0-2 — Whole-fleet “cannot tell” is not designed end to end

The plan defines four row states, but its dashboard output specifies only three global states ([plan](/home/greg/code/spideryarn2/.claude/worktrees/overseer-singleton-claim/docs/plans/260908j-mark-one-session-as-the-overseer.md:131)).

Several cases can conceal a holder:

- an old server omits `role`;
- a role field is unreadable;
- the browser drops an otherwise malformed row;
- the initial dashboard payload has `collectedAt: null`;
- a cached snapshot is stale or accompanied by a collection error.

The global truth table should be explicit:

- two or more known holders → `contested`;
- any uncertainty with zero or one known holder → `cannot-tell`;
- exactly one holder, with a complete trustworthy reading → `one`;
- zero holders, with a complete trustworthy reading → `none`.

In particular, “one known holder plus one `cannot-tell` row” does not establish singleton ownership. The implementation appearing during this review currently returns `one` in that case in [`overseer-claim.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-singleton-claim/tools/fleet/overseer-claim.ts:117).

The aggregate must also receive snapshot completeness/freshness, not merely the retained rows. Otherwise the dashboard can say “no Overseer session” during initial collection or after dropping the holder’s malformed row.

### P0-3 — `overseer.ts status` and the motivating scheduler have no safe data path

[`statusLines`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-singleton-claim/scripts/overseer.ts:307) is currently synchronous and reads the checkpoint/register. Neither `ObservedRow` nor `RegisterEntry` carries the role. Yet the plan promises the status line while also saying “no daemon change, no store schema change.”

Choose and specify one source:

- a small direct tmux role reader shared with the watchdog/scheduler; or
- the dashboard snapshot, passed through its existing strict schema, completeness, error, and freshness checks.

Do not perform an ad hoc `{rows}` parse. The implementation now emerging fetches `/api/state` but ignores `schema`, `error`, `collectedAt`, staleness, and malformed rows. Because the dashboard deliberately serves last-good rows after collection failure, this can confidently name a dead former Overseer.

The scheduler motivation is also not completed merely by rendering a browser badge. State which callable API the systemd watchdog or scheduler will use to locate the holder, and how it refuses stale, incomplete, contested, or unknown readings.

## P1 — Should fix

### P1-1 — The race is understated

The refusal is honestly called advisory, but the post-set reread does not ensure the race “cannot happen quietly”:

1. A and B both read no holder.
2. A sets its role.
3. A rereads and reports success.
4. B sets its role.
5. The final state is contested.

Also, because roles are read one session at a time, a concurrent transfer can produce a hybrid snapshot that never existed atomically.

This is probably tolerable for a human operation performed weekly, provided the contract says **eventual detection on the next quiescent read**, not mutual exclusion. If “refuse a second claim” is literal acceptance criteria, this design does not meet it.

Add a test demonstrating that two decisions made from the same empty snapshot are both allowed; the test should then establish that a later stable read reports contention.

### P1-2 — Release verification needs a target-specific postcondition

If two holders exist and the operator releases one, the successful result is one remaining holder—not necessarily `none`. Likewise, another claimant may appear immediately after a valid release.

Define release success as “the target no longer has the Overseer role.” Either:

- allow release to repair a contested state and verify the target specifically; or
- refuse release while contested except through a dedicated repair operation.

Do not verify every release by demanding globally zero holders.

### P1-3 — Keep the role outside `META`

Not bumping `METADATA_VERSION` is correct. The role is mutable and does not change the interpretation of the pinned version-1 quartet.

But putting it at `META.role` weakens that reasoning: `META` currently means the versioned quartet, and code/tests already use `Object.values(META)`. Use a standalone constant such as `SESSION_ROLE_ENV = "GJD_ROLE"`. Then the type and name agree that it is outside versioned metadata.

### P1-4 — The obvious simpler mechanism is not considered

Greg explicitly suggested renaming the session, and tmux session names are unique server-side. Reserving the exact name `Overseer` would provide atomic refusal, visibility, and automatic release on session death with almost no new machinery.

It has trade-offs—role becomes coupled to display name, and release needs a replacement name—but the plan must name why those are unacceptable. At present, the “simpler options” section omits the option already present in Greg’s request.

## P2 — Worth knowing

- “Malformed value cannot be decoded” is imprecise. Invalid base64 means the entire record is unreadable; a successfully decoded value that violates the role-token grammar is the case producing `cannot-tell`.
- The `other` arm is speculative today. If no second role exists, `none | overseer | cannot-tell` is enough. Keep `other` only if generic roles are an intentional near-term contract.
- Final evidence should exercise all three surfaces after the live claim, plus contention, holder death, old-server omission, incomplete initial collection, and stale cached snapshots.

The decision not to bump `METADATA_VERSION` is sound. The advisory trade-off can also be sound, but only after the plan stops presenting best-effort/eventual uniqueness as a refusal guarantee and makes every incomplete reading propagate as `cannot-tell`.