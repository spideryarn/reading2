The sandbox rejected both attempts to create `docs/plans/260910f-gradual-recovery-plan-review-sol-findings.md`; this run has no workspace write permission. No files were changed. The complete findings follow so the runner’s output retains them.

## Findings

### G1 — P1 — established: occurrence handling suppresses valid retries and loses terminal meaning

The plan says any existing occurrence becomes `settled`/`done`, while also saying `failed-before-launch` becomes refused and may be retried (`candidate e1615d30:70-76, 100-102, 146-150`). The launch protocol explicitly makes a released, undisposed `failed-before-launch` occurrence retryable (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:415-422`; launch plan `:444-450`).

It is worse when release fails: `launchOccurrence` returns `failed-before-launch` even though `releaseIfLicensed`’s result is not included (`launch-protocol.ts:1248-1253`). Recovery would free the request name, then the re-tap would find a held existing occurrence and silently become done without launching.

The same collapsed handling leaves no page state for a launch that reaches `completed` with exit 1 before inventory verification, although the plan explicitly identifies that outcome (`candidate:220-227, 437-438`).

Fix: replace “occurrence exists ⇒ settled” with an exhaustive state/reservation/disposition table. A fully released `failed-before-launch` continues through gates and revalidation into attempt 2. Held releases defer. Completed-without-verified-resume gets an explicit failed/ended state and evidence. Test release failure, retry after release, `not-launched` in each possible folded state, and exit before verification.

### G2 — P1 — established: `resumed` does not verify transcript identity

The plan’s pacing premise says the existing `resumed` disposition proves “metadata, pane and transcript identity” (`candidate:36-41`). The roadmap requires metadata, pane, and transcript verification before the next launch (`roadmap:1648-1649`).

In reality, execution identity explicitly says it does not establish which transcript is being written (`tools/fleet/execution-identity.ts:44-51`). `deriveDispositions` uses only the verified process token and conversation read from the live row (`tools/overseer/recovery.ts:748-759, 781-815`). It never reads a transcript.

A process briefly presenting `--resume <uuid>` can therefore resolve the candidate permanently and start the spacing clock before any post-launch transcript evidence exists.

Fix: add a dedicated recovery verification step. Require the matching new execution plus correlation evidence and a post-launch append to the intended transcript, validated from a bounded tail. Pace from that result, not bare `resumed`. Test that a live process without transcript growth remains unverified and blocks the next request.

### G3 — P1 — established: daemon/dashboard version skew can launch before the collector understands resumed argv

Stage 3 changes both the fleet collector’s argv reader and the daemon’s launch capability (`candidate:398-406`). They are separate runtime processes. Today the collector deliberately treats `--resume [value]` as unreadable (`tools/fleet/claude-argv.ts:233-238`).

If the new daemon runs against the old dashboard/collector, the capability gate passes and the session launches, but the collector cannot verify its conversation. The occurrence becomes observed-running while the recovery disposition never becomes resumed. The next request blocks indefinitely; with the old dashboard, the queue state is not visible either.

Fix: add a producer capability/version marker to accepted fleet observations. The daemon must defer before launching until it has accepted a snapshot declaring support for verified `--resume <uuid>`. Test new daemon + old producer and the reverse. Deployment order alone is not a durable compatibility contract.

### G4 — P1 — established: quota gating is neither fresh nor about the account that will run

At `e1615d30`, the gate consumes the latest stored usage verdict without an age rule (`candidate:48-50, 109-122`). Stored usage explicitly may be old and carries `collectedAt` so consumers can detect that (`tools/overseer/store.ts:596-602`; `tools/fleet/wire.ts:544-550`). A stale `ok` therefore authorizes a resume.

There is also an account mismatch. `collectUsage` reads the ambient `~/.claude.json` and ambient authentication (`tools/overseer/usage.ts:1362-1385`), while an omitted account defaults to `auto` (`scripts/gjd-remote-account.ts:13-15`) and `gjd-remote` resolves a pool account (`scripts/gjd-remote.ts:2678-2686`). That resolver obtains separate live per-account readings and may choose an unknown account (`scripts/claude-accounts.ts:1375-1413`). Thus “unknown holds” can describe an unused ambient account while the actual selected account has another verdict.

Fix: make account selection idempotent by occurrence, pin the selected account in the launch request, and gate on that account’s fresh reading. Alternatively constrain v1 to one explicit account whose report the daemon actually holds. Add stale-report and ambient-versus-pool tests.

The uncommitted working-copy amendment adding `usageStaleAfterMs` addresses the freshness half, but not the account mismatch, and is not part of `e1615d30`.

### G5 — P1 — established: current-identity revalidation precedes an async gap

The no-live-conversation check occurs before the asynchronous transcript search (`candidate:125-140`). The final synchronous section stats only the directory and transcript (`candidate:138-141`). It does not re-read inventory or live processes.

While the locator awaits, the daemon can accept a newer fleet snapshot or somebody can manually resume the conversation. The old decision then launches anyway. The remote fallback scans tmux environment, which does not identify `claude --resume` typed into an existing shell.

Fix: perform all asynchronous work first, then recapture the latest accepted observation and repeat classification, resolution, conversation, and no-live checks immediately before `launchOccurrence`. Add a test that pauses transcript lookup, injects a newer live matching execution, then proves zero invocations. Narrow the prose claim; a synchronous event-loop turn does not freeze external processes.

### G6 — P1 — established: the recovery decision has no supported way to inspect protocol state

Steps 1–3 require journal status, lookup by recovery origin, and inspection of every recovery occurrence (`candidate:97-108`). Yet the plan says recovery holds only `LaunchProtocol["launchOccurrence"]` (`candidate:142-145, 405`), matching the cross-session agreement.

The actual composed protocol exposes no fold, status, lookup, or snapshot (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1651-1669`), and its comment says recovery gets `launchOccurrence` and nothing else (`:1658-1661`). The pace and settled decisions therefore cannot be implemented through the named seam.

Fix: agree a narrow read-only composed capability such as `inspectRecoveryOccurrences()` or have the daemon parent derive immutable occurrence summaries and pass them to the pure recovery decision. Do not hand recovery `LaunchParts` or the journal.

### G7 — P1 — established: adding `tmux-resume` will bypass tmux reconciliation unless called out explicitly

The plan claims extending the discriminated union will make the compiler identify every switch (`candidate:244-247`). Current reconciliation instead contains a non-exhaustive equality check that probes tmux only when `launcherKind === "tmux"` (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1405-1409`).

After adding `tmux-resume`, a crash after tmux creation but before `start.json` will skip the correlation-id tmux probe, producing `outcome-unknown` for a running resumed session and blocking the queue.

Fix: define an exhaustive launcher-family function or a `usesTmux` property and include `tmux-resume`. Add the exact crash test: tmux external effect exists, no start artefact, reconciliation reaches observed-running.

### G8 — P1 — established: disposal does not clear the stated pace predicate

The plan says a blocker clears when Greg dismisses the candidate or disposes the launch (`candidate:103-107`). Its predicate, however, checks only launch state and whether the candidate is `resumed`.

Protocol disposal is orthogonal to state: a disposed record remains `launching`, `observed-running`, or `outcome-unknown` (`launch-protocol.ts:557-560, 1598-1628`). A dismissed recovery candidate is also “not resumed.” Either remains a blocker under the stated rule.

Fix: pace only on undisposed launch occurrences. Decide explicitly whether candidate dismissal is intended to waive verification; for `outcome-unknown`, dismissal alone should probably not waive possible load—protocol disposal should. Test both controls.

### G9 — P2 — established: the second projection is not justified by schema compatibility

The plan rejects an optional field in `recovery.json` because it supposedly requires a schema bump and would make version skew unreadable (`candidate:164-171, 300-301`). The existing parsers do not reject unknown top-level fields (`tools/overseer/store.ts:2783-2838`; `tools/fleet/recovery-feed.ts:614-633`). The existing derived `view` was added beside the fold specifically without a schema bump (`tools/overseer/store.ts:2931-2962`).

Fix: put an optional versioned `resume` projection beside `view` in `recovery.json`. Old dashboards ignore it; new dashboards treat absence as unsupported; old daemons may drop and later rebuild it without losing request files. This removes a file, endpoint/feed, poll, and cross-file consistency problem.

### G10 — P2 — established: the request filename is only idempotent while it remains pending

`O_EXCL` protects `pending/<candidate>.json`, but the daemon then moves that name into `done/` or `refused/` (`candidate:63-76`). No atomic operation spans those separate names. A route that checked terminal state just before the move can create a new pending file immediately afterwards, so “a tap after done writes nothing” is too strong.

This does not produce a duplicate launch because the occurrence remains authoritative. The specific refusal race is likewise safe for launching: refusal is decided before the name is freed. But the request layer can contain both terminal and pending records and can overwrite a same-named done receipt on its next move.

Fix: describe the filename as pending coalescing, not durable idempotence. Prefer unique nonce-named request files—the existing inbox shape—and coalesce them by candidate/occurrence in the daemon projection. Let the launch occurrence be the sole duplicate-launch guarantee.

## Simpler design

A materially simpler design does meet the spec:

- Keep the explicit request inbox; tap-time queueing and recovery-specific revalidation do not belong in the generic launch journal.
- Use nonce-named requests and rely on the recovery occurrence for idempotence.
- Put the daemon’s optional resume projection inside `recovery.json`.
- Add one narrow protocol inspection capability and one dedicated post-launch transcript verifier.
- Model every launch state exhaustively instead of treating “occurrence exists” as a terminal fact.

This retains “nothing automatic,” preserves unknown records, and removes the second projection/feed plus the fragile cross-directory idempotence claim.

The plan does preserve unchanged unknown recovery records conceptually, but the version-skew tests should also prove an absent/unreadable resume projection never hides the base recovery list.

## Verdict

*Not ready.* G1–G8 are established P1 contract or user-visible failures. The core duplicate-occurrence foundation is sound, but pacing, verification, retry, runtime compatibility, and quota evidence need revision before implementation.