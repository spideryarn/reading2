F1 — P1 — established

(a) The revision model can claim more than was recorded. In a shared mutable checkout, ESM dependencies may load before the top-level stamp is captured, and Vite continues reading files after its initial stamp. A file can therefore change around the read while the stamp records a clean `HEAD`. Dirty starts are also typed as `kind: "known"`. The resulting “same as HEAD” verdict can be mistaken for “the running bytes match,” contradicting the roadmap’s runtime-record conclusion that only the checkout observation is known ([plan](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md:50), [runtime record](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:412)).

(b) Replace D1 and Stage 2’s revision-verdict bullet with:

> **D1. Record a checkout observation at start, not a code identity.** Each process records `{kind:"recorded-head", sha, dirtyAtRead, readAt} | {kind:"unknown", why}` once during startup. The sha names the checkout’s base commit at that instant; it does not prove which mutable working-tree bytes were loaded. A dirty observation always renders `code revision unknown — base HEAD <sha>, checkout dirty at start`. A clean observation may be compared only as `recorded start HEAD matches / is N commits behind / is not an ancestor of this checkout’s HEAD`; no CLI or web text says that the running code or bundle “is”, “matches”, or “runs” that revision unless its build inputs were immutable or independently verified.

F2 — P1 — established

(a) D5’s payload cannot support the web view promised by Stage 3 or the roadmap. It contains the dashboard start stamp and current disk-bundle stamp, but no daemon start revision, no bundle stamp captured when the server started, no store-path label, and no health-reading age. A generic file probe provides none of those. After an in-place client rebuild, the page cannot distinguish the server-start bundle from the new disk bundle ([plan lines 68–74](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md:68), [roadmap contract](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1740)).

(b) Replace D5 with:

> **D5. The web summary is fleet-owned and reads the file seam, not Overseer modules.** `DiagnosticsSummary` carries: the dashboard’s recorded start-HEAD observation; the client build stamp captured once before listeners open; the client build stamp currently on disk; collector attempted/collected/error clocks; the latest health-reading age; the resolved store-path label; bounded probes of the fixed store-file allow-list; and the daemon start stamp selected by a fleet-owned tolerant reader of `daemon.jsonl`, correlated to the checkpoint’s `instanceId`. Missing, malformed, torn, or uncorrelated records produce `unknown`. The route imports no `tools/overseer/` module.

Also name `tools/fleet/web/src/HealthPanel.tsx` explicitly in the File set instead of “a one-line mount … in the Box health panel.”

F3 — P1 — established

(a) `daemonStanding` cannot safely be reused as proposed. At candidate commit `2c751326`, it accepts one global `lastNote` and treats any `daemon-stopped` note as describing the checkpoint. Scenario: daemon A writes a checkpoint and is killed; daemon B starts and stops cleanly before its first checkpoint. The checkpoint remains A’s, while the last note is B’s stop. Diagnose can consequently combine A’s checkpoint/revision with B’s clean-stop explanation.

(b) Add `tools/overseer/status-cli.ts` and `tests/overseer-cli.test.ts` to the File set, and replace Stage 2’s standing phrase with:

> Resolve daemon standing from the ordered start/stop lifecycle, correlated by `instanceId`: a stop closes only its matching start, and a checkpoint describes only its matching instance. If the newest instance has not written a checkpoint, report that state explicitly and never combine it with an older checkpoint. Add the regression `A checkpointed and was killed; B started and stopped before its first checkpoint`.

F4 — P1 — reasoned

(a) “`/api/diagnostics` — or unreachable” does not specify a deadline or response bound. A dashboard that accepts the connection but never finishes headers/body can hang `overseer diagnose` indefinitely—the exact failure mode an operational command must survive. A very large body can likewise exhaust memory. The existing dashboard-claim reader’s five-second timeout does not automatically apply to this new fetch.

(b) Append to Stage 2:

> The dashboard read uses an injected `fetch`, a 5-second `AbortSignal` deadline, a bounded response body, an explicit non-2xx result, and the runtime parser. Timeout, oversized body, non-2xx, or malformed JSON renders `dashboard diagnostics unusable — <bounded reason>`; the remaining report still renders and follows D4’s exit-code rule.

F5 — P1 — established

(a) The real-dashboard process test is not isolated by the listed environment. At `2c751326:tools/fleet/server.ts:233–253`, startup constructs readiness with `primary: process.cwd()` and immediately scans checkout/worktree job logs. Running the child from this repo therefore reads live sessions’ files. Separately, `describeOnce()` calls `openRouterKey()` before applying the zero-call budget; that reader consults the real repo’s `.env.local`. The cited test environment also omits `OVERSEER_QUEUE_DIR`. Scratch tmux redirection protects the live tmux socket, but not these paths.

(b) Replace the beginning of the dashboard-process checkbox with:

> Spawn the absolute `server.ts` entry with `cwd` set to a disposable minimal git checkout. Set `HOME`, `TMPDIR`, `TMUX_TMPDIR`, `FLEET_DIST`, `FLEET_HEALTH_DIR`, `FLEET_HOLDS_DIR`, `FLEET_READINESS_DIR`, `FLEET_NEW_DIR`, `OVERSEER_STORE_DIR`, `OVERSEER_DECISIONS_DIR`, and `OVERSEER_QUEUE_DIR` beneath the scratch root; unset `TMUX`; set `OPENROUTER_API_KEY` to an invalid test sentinel, `FLEET_DESCRIBE_MAX_CALLS=0`, `FLEET_ACT_ENABLED=0`, `FLEET_BROADCAST_ENABLED=0`, and `FLEET_ANSWER_ENABLED=0`. Assert every resolved filesystem target is beneath the scratch root before spawning. Do not treat `fleet-decisions-route.test.ts`’s environment list as exhaustive.

F6 — P1 — established

(a) The killed-daemon process test is optional, although the requested boundary is process crash/restart on scratch state. An aborted `runOverseer` is a graceful shutdown, not a crash. The CLI can be run without paid or tmux work: use the scratch source, `--no-attention`, `--no-usage`, and disable both job systems. Therefore the stated escape clause is unnecessary and leaves the crash boundary unproved ([plan lines 149–155](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md:149)).

(b) Replace the optional checkbox with:

> **Killed daemon process—required:** spawn `scripts/overseer.ts run` against the scratch store and scratch source with `--no-attention --no-usage`, `OVERSEER_JOBS_ENABLED=0`, `OVERSEER_RULES_ENABLED=0`, and every decisions/report path beneath scratch. Wait for `daemon-started` and a checkpoint, send `SIGKILL`, assert `diagnose` reports that instance killed, then spawn a second child on the same root and assert it acquires the lock and writes a different instance. Always kill/reap children in `finally`.

F7 — P1 — reasoned

(a) Stage 4 names the right failed-source control, but it never requires an accepted source reading before the outage. An implementation could begin with an unavailable source, keep `lastGoodSnapshotAt: null`, observe advancing heartbeats and degraded/restored notes, and go green without ever observing a previously moving source clock stop. That would not earn the roadmap’s acceptance condition ([roadmap acceptance](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:1763)).

(b) Replace the source-outage checkbox’s assertions with:

> First deliver and wait for an accepted snapshot whose checkpoint records non-null `lastGoodSnapshotAt=t0`. Make the same source URL unavailable, observe `condition-degraded`, then observe at least two later checkpoint writes and assert `heartbeat.ticks` and `lastTickAt` advanced while `lastGoodSnapshotAt` remained exactly `t0`; `diagnose` must render that stopped source clock. Restore the same URL, deliver `t1>t0`, and assert both `condition-restored` and `lastGoodSnapshotAt=t1`.

F8 — P2 — reasoned

(a) The generic per-request probe is asked to inspect every store file and detect JSONL tails, but it has no byte, file-type, or symlink contract. Reading the growing JSONL histories wholesale can block the single-threaded diagnostic server precisely during trouble; a FIFO or unexpected symlink can be worse. Existing fleet code explicitly avoids scanning `events.jsonl` in a request.

(b) Append to D5:

> Store probing uses a fixed filename allow-list and `lstat`; symlinks and non-regular files are reported, not followed. JSON files have a byte ceiling. JSONL probes inspect only a bounded final chunk sufficient to classify newline-complete versus torn; they never scan or parse the whole log in a request. Too-large or indeterminate inputs render `unknown` with a bounded reason.

F9 — P2 — established

(a) Stage 5 calls an unreachable destination a test that “the monitor’s own failure fails loud.” It is only a host-to-provider delivery-path test. If the provider itself is down, it cannot emit the alert; the plan correctly admits that two paragraphs earlier, then contradicts itself.

(b) Replace test-plan item 5 with:

> (5) make the destination unreachable from the disposable pinger → it logs the failed delivery locally and exits non-zero; if the external provider remains healthy, its missing-ping alert proves host-to-provider delivery failure is visible. This does not test provider outage: provider or notification-channel failure remains a stated residual risk, covered only by the monthly end-to-end receipt test or by a separately authorised independent monitor.

Verdict: request changes. Established P1s F1, F2, F3, F5, and F6 prevent approval; no P0 was found.

I reviewed the plan at commit `2c751326` and pinned source inspection to that commit. The branch advanced to implementation commit `cb4c3ba7` during the review, with further uncommitted work present; I excluded all of it. No tests were run because this is a plan-only review and the permitted environment forbids even loopback networking.

I could not create the requested findings file because the sandbox permits writes only under `/tmp` and selected caches. No file was changed.