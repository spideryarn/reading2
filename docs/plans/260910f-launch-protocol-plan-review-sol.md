Verdict: refuse as written. No P0. F1–F3 are established P1s.

The complete findings record is at [260910f-launch-protocol-plan-review-sol-findings.md](/tmp/260910f-launch-protocol-plan-review-sol-findings.md).

### F1 — P1 — established: supervisor disappearance is not child completion

(a) [D4/D7](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md:94) turns `gone` into `completed (vanished)` and releases. But D6 records either the tmux job-script bash PID or the headless wrapper PID—not Claude/Codex. [`gjd-remote`](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/scripts/gjd-remote.ts:2715) runs Claude as a child before `exec bash -l`; [`runChild`](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/scripts/subagent-cli.ts:233) spawns a detached child process group. SIGKILL of either supervisor can leave its child running.

Start ticks correctly defeat PID reuse, and `exec` preserves PID/start ticks—I confirmed that with a local process probe. Neither proves anything about descendants. Releasing contradicts the roadmap’s “Release only on evidence or an attributed operator decision.”

(b) Replace the relevant wording with:

> `completed` requires a valid correlation-bound `exit.json`, or `other-boot`, which proves every process from the recorded boot ended. A same-boot disappearance of the recorded supervisor is not completion evidence. Without `exit.json`, it becomes `outcome-unknown` and keeps its reservation.

Delete the contrary headless ambiguity paragraph at lines 263–266. Add tests where the wrapper/job shell dies while a detached child remains alive.

### F2 — P1 — established: `history-lost` has no usable exit

(a) [D1](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md:65) says a hole disables every future `plan()` and that D8 disposition is the way out. D8 only accepts a non-terminal occurrence the fold can identify. A hole may hide that occurrence or its transition entirely. It may also leave an owner-only reservation consuming the sole slot. There is no global repair, rotation, or attributed acceptance of the unenumerable uncertainty.

Thus one interior corrupt line permanently disables launches.

(b) Replace D1’s last sentence with:

> `history-lost` refuses `plan()` until Greg submits an attributed `resolve-history --why … --accept-hidden-launch-risk` request. The daemon preserves the old journal byte-for-byte, inventories all parseable occurrences, artefact directories and owner-only reservations, requires disposition of every visible unresolved reservation, then starts a fresh generation with a `history-reset` record naming the preserved file and acknowledging that the hole may conceal an unenumerable launch. Per-occurrence `dispose` is not the repair for global replay failure.

Test a hole hiding an occurrence and an admission reservation with no recoverable launch record.

### F3 — P1 — established: the shell artefact is neither durable nor fail-closed

(a) [D6](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md:168) specifies temp + `mv`. Rename gives atomic visibility, not durable file contents or directory metadata. The current generated job has no `set -e`; its load-bearing operations use explicit `|| failTo(...)`. A bare generated artefact command can fail and fall through into Claude, leaving no durable start evidence. The scratch drill would still see page-cache writes and cannot prove durability.

(b) Replace the bullet with:

> The first command calls one checked helper that creates a private temporary file with `O_EXCL`, writes and fsyncs it, renames it, and fsyncs the artefact directory. Failure is fail-closed through `failTo`: Claude is not invoked. `exit.json` uses the same helper while `_gjd_claude_status` remains saved; failure leaves an explicit note and never silently claims durable evidence.

Inject write, fsync, and rename failures in the generated-job tests.

### F4 — P2 — established: `cannot-tell` wrongly overrides stronger evidence

(a) D7 says `cannot-tell` from any port prevents movement. A valid exit artefact remains conclusive when `/proc` or tmux is temporarily unreadable; a matching live identity remains evidence of running when another port fails. The global veto creates avoidable manual holds.

(b) Replace it with:

> Apply evidence by precedence: valid exit → completed; otherwise other boot → completed/interrupted; otherwise matching live identity or tmux session → observed-running; otherwise any unavailable input needed for the remaining decision leaves state unchanged; otherwise absence is inconclusive and becomes `outcome-unknown`. Weak or unavailable evidence never overrides stronger conclusive evidence.

### F5 — P2 — reasoned: pinned material is not structurally bound to launched bytes

(a) D1 calls `material.txt` the exact prompt, but the plan does not say the launcher may receive only that file, that it is rehashed immediately before invocation, or that an existing ID with different material is rejected. Today [`dispatch.ts`](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/tools/overseer/dispatch.ts:127) sends `definition.behaviour.what` directly through `-p -`; a superficially compatible adapter could journal one value and launch another.

(b) Add:

> An existing occurrence ID with a differing canonical origin, launcher kind, admission class, material byte count, or material hash is a conflict, not an idempotent return. Immediately before `launching`, re-read and verify `material.txt`; the launcher receives those verified bytes/path and has no independent prompt parameter.

Test changed caller input and post-`planned` material tampering.

### F6 — P2 — established: wrapper instrumentation needs one outer lifecycle

(a) Both wrappers’ `fail()` functions call `process.exit(1)`, so ordinary `finally` blocks do not cover their many post-spawn failure branches. Conversely, writing `exit.json` when `runChild` settles would be premature for `run-codex`, whose read-only credential fallback can legitimately run a second attempt. Its no-fallback rule for write-capable runs is also load-bearing.

(b) Add:

> Instrument the whole wrapper invocation, not `runChild` or individual credential attempts. Add the launch ID to the already-sanitised child environment; leave `ChildStdin`, argument construction, fallback policy, output copying and `answerIsUsable` in their existing owners. Write one final exit artefact only after existing final classification, using a synchronous outer finaliser/exit hook where required by `process.exit`.

Extend tests to spawn error, signal, overflow, post-child validation failure, read-only fallback, and write-capable no-fallback.

### F7 — P2 — established: failure and disposition release crashes are missing

(a) The table covers `completed → release → released`, but not the equally non-atomic:

- `failed-before-launch → release → released`
- `disposed → release → released`

After `disposed` lands and the daemon crashes, refusing the replayed inbox request as already applied does not itself release the reservation.

(b) Add crash rows stating:

> A durable terminal/disposition record licenses reconciliation to release any still-held reservation. If owner lookup already says none, append `released`. No new attempt begins until that orthogonal reservation state is settled.

Test crashes after the terminal/disposition append and after owner release but before `released`.

### F8 — P2 — reasoned: Stage 3 is too broad; D5 is not the first cut

(a) D5’s separate owner exercises two explicit roadmap boundaries: lost reservation replies and owner restart. Folding reservation into the launch journal would make the test pass by deleting the required failure mode.

The oversized part is Stage 3: daemon composition, reconciliation, inbox, CLI, projection, fleet parser, route, React panel, two composition edits, and the drill in one review. Since no production caller exists yet, the web surface can show only empty state.

Also, `lookup(): Grant | none` wrongly admits `wait` and `refused` as lookup results.

(b) Replace the stage split with:

> Stage 3a: daemon reconciliation, bounded inbox, CLI list/show/dispose, projection, and drill. Move the fleet route/client/panel and `server.ts`/`App.tsx` composition to Scheduled dispatch, when live occurrences exist.

Keep D5, but change lookup to:

```ts
lookup(key: ReservationKey):
  | Extract<Grant, { kind: "reserved" }>
  | { kind: "none" };
```

Give its journal the same fail-closed/history-resolution semantics as F2.

### F9 — P2 — reasoned: `reserved ⇒ never invoked` is not yet structural

(a) The reserved crash row is valid only if every production path executes a non-yielding sequence:

```text
reserve → append reserved → write intent → append launching → invoke
```

The plan exports adapters, merely says `launchOccurrence()` is “shaped” for the scheduler, and does not prohibit direct adapter calls or an interleaving reconciliation tick. An interleaved tick could mark a current reservation failed and release it while its original invocation continues.

(b) Add:

> The reserve-through-launcher-call prefix is synchronous and non-yielding. Scheduler and recovery receive only `launchOccurrence`; concrete launcher capabilities remain inside protocol composition. Reconciliation cannot interleave with that prefix. A failed `launching` append returns without invocation. A repository-boundary test proves production imports do not call adapters directly.

If a future owner becomes asynchronous, add an explicit current-attempt guard rather than relying on this proof.

### F10 — P2 — established: the projection is not bounded

(a) “Every non-terminal occurrence plus 50 terminal ones” is unbounded. Planned/waiting records can accumulate independently of the one held slot, and unknown records deliberately never expire.

(b) Replace D9’s first bullet with:

> Publish at most N non-terminal occurrences, ordered oldest/most actionable first, plus the newest 50 terminal records, `totalNonTerminal`, and `omittedNonTerminal`. Omitted records remain CLI-accessible. Crossing N is a visible overflow/degraded condition.

Test N+1 records and assert both the item/byte bound and omitted count.

### F11 — P2 — established: replay legality is unspecified

(a) A TypeScript union does not validate JSONL bytes. The plan names malformed lines but does not say that parseable illegal transitions—duplicate attempts, changed immutable origin, `released` before reservation—make history lost. Silently ignoring one can manufacture plausible safe-looking state.

(b) Add:

> Every record has an exact runtime parser and schema. Replay validates immutable fields, occurrence identity, monotonic attempts, and legal transitions. Unknown schema, malformed known kind, conflicting duplicate, or illegal transition makes history `history-lost`; no later line is folded across it.

Reuse the existing `/proc` parser and boot/process readers from [`execution-identity.ts`](/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol/tools/fleet/execution-identity.ts:463), or extract a neutral leaf.

### F12 — P2 — established: the drill accepts a complete no-op

(a) `launcher invocations ≤ 1` and `reservations ≤ 1` both pass at zero. In the external-effect-before-start row, a launcher that never runs can still produce “nothing found → unknown.” This is precisely the repo’s silent-success class.

(b) Replace the acceptance wording with:

> Assert exact expected counts per boundary: effects are zero before invocation and one at/after it; a reservation lookup returns exactly one matching grant while held and none after licensed release. Count the external marker/tmux session independently of the protocol callback counter.

Add a negative control that substitutes a no-op launcher and require the first post-invocation row to fail with the relevant assertion.

### F13 — P2 — reasoned: path validation is not shell quoting

(a) An absolute path may contain spaces, quotes, `$()` and other shell syntax. `--launch-dir` crosses local command construction, SSH, the remote shell and tmux. Existing `metaFlags` uses `shq` for exactly this reason. Merely validating “absolute; no odd bytes” is insufficient. The existing final `-p -`, stdin write, and EOF are also load-bearing.

(b) Add:

> Shell-quote `SPIDERYARN_LAUNCH_DIR` with the existing `shq` mechanism at every command layer; validation is not escaping. Place both new options before the unchanged final `-p -`, write the verified pinned material plus newline, and close stdin.

Test a path containing spaces, a quote and `$()`, reject newlines, and assert the dispatch adapter’s exact argv/stdin/EOF contract.

### The three suspicions

1. The ordering is enforceable, but not by the plan as written. It needs F9’s single non-yielding capability-owning prefix. Otherwise the `reserved` row is an assumption.

2. `gone` is unsafe on the same boot. `exec` retaining the PID and start ticks is fine, and changed ticks correctly detect reuse; the defect is that the identified process is only the supervisor. F1 is the blocker.

3. Leaving `schedulerTick` untouched is defensible. The roadmap deliberately has later Scheduled dispatch and Gradual recovery stages, and this stage forbids real launches. Wiring it now would replace or double-record an armed path before the scheduled-result vocabulary exists. Add an entry-point test proving there is intentionally no production caller yet, so “built but uncalled” is explicit rather than accidental.

I made no repository changes. The only runtime evidence I added was a `/tmp` bash probe confirming PID/start-tick continuity across `exec`; scratch tmux socket creation was denied by this review sandbox, so I did not independently repeat the plan’s `new-session -e` measurement.