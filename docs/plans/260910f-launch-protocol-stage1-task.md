# Stage 1 task: the launch protocol, its store, and the admission owner

You are implementing Stage 1 of `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol`. **Read the whole
plan first**, then its review (`docs/plans/260910f-launch-protocol-plan-review-sol.md`) and the
plan's "Review dispositions" section, which override the plan where they differ.

## What this stage is for

The durable core both consumers share: the occurrence/attempt records and their fold, the ordered
steps with a durable write at each boundary, restart reconciliation over injected evidence ports,
and a small file-backed admission owner behind an interface. **No real launcher** — Stage 2 builds
those. Here a launcher is an injected function, and the tests' fake launchers are the only ones.

## Files (yours; create them)

- `tools/overseer/launch-protocol.ts` — ids (D2), event types and the fold (D3), `plan()`, the
  step driver (D4), `reconcile()` (D7), the `Launcher` and evidence port types.
- `tools/overseer/launch-store.ts` — the journal under `<storeRoot>/launches/` (D1): lock via
  `tools/overseer/lock.ts` `takeLock`, torn-tail repair and atomic writes via `tools/overseer/jsonl.ts`,
  per-line validation, replay that stops at the first hole into a `history-lost` state that refuses
  `plan()`, fsync on every append, material and artefact directories at `0700`.
- `tools/overseer/launch-admission.ts` — D5's interface and the local owner.
- `tools/overseer/launch-artefacts.ts` — the `intent`/`start`/`exit` record types, a strict reader
  for each, and the identity check, behind a port so tests inject it. **Reuse**
  `readBootIdentity`, `readProcessStart` and `parseProcStat` from `tools/fleet/execution-identity.ts`
  (F11) — import them; do not write a second `/proc` parser. Writers for `start`/`exit` arrive in
  Stage 2 — but `intent.json` is written by the protocol, so its writer is here.

## The review findings this stage must honour

The plan's "Review dispositions" section is authoritative. For this stage in particular:
**F1** (no `completed` without `exit.json` or `other-boot`; a same-boot supervisor disappearance is
`outcome-unknown`, reservation held), **F2** (`history-lost` refuses `plan()`; a `resolve-history`
decision preserves the old journal and starts a fresh one with `history-reset` — build the store
and fold operation here; the inbox that carries Greg's request is Stage 3), **F4** (evidence by
precedence), **F5** (origin/material conflict is refused; material re-verified before `launching`;
the launcher gets the verified bytes and no prompt parameter of its own), **F7** (a terminal or
disposition record licenses release; crash tests on both sides of the owner's release), **F8**
(`lookup` returns only a `reserved` grant or `none`; the owner's own journal has F2's fail-closed
semantics), **F9** (the reserve-through-invoke prefix is one synchronous function; a failed
`launching` append invokes nothing; concrete launchers are reachable only through
`launchOccurrence`), **F11** (exact runtime parser per record; replay checks immutable fields,
identity, monotonic attempts and legal transitions; an illegal or unknown line is `history-lost`
with nothing folded past it), and suspicion 3 (a test that `launchOccurrence` has no production
caller yet).
- Tests: `tests/overseer-launch-protocol.test.ts`, `tests/overseer-launch-store.test.ts`,
  `tests/overseer-launch-admission.test.ts`, `tests/overseer-launch-artefacts.test.ts`.

**Not yours; do not edit:** anything else. In particular not `scheduler.ts`, `store.ts`,
`diff.ts`, `daemon.ts`, anything in `tools/fleet/`, `scripts/`, or `infra/`. If you find you
need one, stop and say so in your report.

## How to work

- Read `tools/overseer/store.ts`'s header, `lock.ts`, `jsonl.ts`, `scheduler.ts`, `jobs.ts` and
  `rule-protocol.ts` (`record()`) first and **write like them**: discriminated unions, `never`
  exhaustiveness, injected clocks (nothing reads the wall clock itself), result types rather than
  throws at boundaries, and a header comment that says what the file guarantees and what it
  cannot. Match the comment density of those files, but keep it proportionate — say why, not what.
- **Tests first, red then green.** Write the fault-injection harness before the driver: a store,
  an owner and a launcher that can each be told to die (throw a `Crash` sentinel) at a named point,
  then reopen from disk, reconcile, and assert. The plan's Stage 1 list is the minimum; every row of
  D4's crash table is a test.
- Use a temp directory per test (`mkdtempSync` under `os.tmpdir()`), never `~/.overseer`.
- Run `npx vitest run tests/overseer-launch-*.test.ts` as you go, then `npm run typecheck` — read
  its **exit code**, not its last lines (it prints ✓ lines last even when it failed) — and
  `npx biome lint <your files>` (never pass `--formatter-enabled=true`).
- Do not commit. Do not run the full suite. Do not start, stop or touch any tmux session, the
  fleet dashboard (port 8787) or the Overseer daemon.

## What to report back

The files you created, the test count and the exact vitest and typecheck results (exit codes),
every place you departed from the plan and why, and anything in the plan you found to be wrong or
unbuildable. Conclusions, not file dumps.
