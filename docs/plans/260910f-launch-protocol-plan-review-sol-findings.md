# Launch protocol plan review — working findings

Status: complete. Verdict: refuse as written on established P1 findings F1–F3; no P0 finding.

## F1 — P1 — established — a dead supervisor is not proof that its launched child ended

Plan D4 lines 94/125 and the explicit remaining-ambiguity paragraph at 261–266 turn `gone` for the PID in `start.json` into `completed (vanished)` and release the reservation. D6 records the tmux job script's bash PID and, for headless work, the wrapper PID. Neither is the launched Claude/Codex process. `scripts/gjd-remote.ts` runs `claude` as a child, waits, then `exec bash -l` (2715–2789); `scripts/subagent-cli.ts:233–374` spawns a detached child process group from the wrapper. SIGKILL of either supervisor can leave its child running. PID reuse is handled correctly by start ticks, and `exec bash -l` keeps the same PID/start ticks (locally probed: PID and ticks were unchanged across `exec`), but those facts identify the supervisor only. Therefore same-boot `gone` is not evidence the launched child ended, and releasing contradicts the roadmap's “Release only on evidence or an attributed operator decision.”

Smallest replacement wording:

> Replace D3's `completed` row with: “`completed` — evidence the launched work ended: a valid `exit.json`, or `other-boot` (all processes from the recorded boot are gone). Same-boot disappearance of a recorded supervisor is not completion evidence.” Replace D4's `start.json` row with: “start artefact + matching live identity or tmux session → `observed-running`; `other-boot` → `completed (rebooted)`; same-boot `gone` without a valid exit artefact → `outcome-unknown`, reservation held.” Replace D6 lines 184–185 with: “The wrapper PID is evidence that the wrapper is alive, not proof about its child after the wrapper disappears. Without `exit.json`, same-boot wrapper disappearance remains `outcome-unknown`.” Delete the contrary headless paragraph at lines 263–266 and add tests where the supervisor dies while a detached child stays alive.

## F2 — P1 — established — `history-lost` has no usable exit

D1 says a holed journal makes every future `plan()` refuse and says D8 disposition is the way out. D8 only accepts an occurrence that the fold can identify as non-terminal. A hole can hide the occurrence or transition needed to identify it, and there is no command that repairs/rotates the journal or attributes acceptance of the global uncertainty. An admission reservation whose occurrence is hidden can also consume the capacity-one owner forever. Thus one corrupt interior line permanently disables both future consumers, contrary to the promised explicit reconciliation/disposition control.

Smallest replacement wording:

> Replace D1's final sentence with: “`history-lost` refuses `plan()` until Greg explicitly runs `overseer-launches resolve-history --why … --accept-hidden-launch-risk`. The daemon records that attributed global decision, preserves the old journal byte-for-byte under a generation name, inventories every parseable occurrence, artefact directory, and admission reservation (including owner-only orphans), requires a disposition for each visible non-terminal/orphan reservation, then starts a fresh journal generation with a `history-reset` record naming the preserved file, request, and acknowledged fact that the hole may conceal an unenumerable launch. Per-occurrence `dispose` is not the way out of a global replay failure.” Add red tests for a hole hiding an accepted occurrence and for an owner-only reservation.

## F3 — P1 — established — the tmux artefact write is atomic but not durable, and its failure path is unspecified

D6 calls `start.json`/`exit.json` durable evidence but specifies only temp + `mv` for the shell writer. Rename gives atomic visibility; it does not flush the file data or containing directory. The existing job script has no `set -e`; every load-bearing step in `scripts/gjd-remote.ts` uses an explicit `|| failTo(...)`. A bare generated writer failure can therefore fall through and launch Claude with no start evidence. This contradicts the roadmap's durable-artifact requirement and D6's “a quickly completed/disappeared session is discoverable.”

Smallest replacement wording:

> Replace D6's tmux writer bullet with: “The first command calls one checked helper that creates a private temp file with `O_EXCL`, writes and fsyncs it, renames it, and fsyncs the artefact directory. Failure is fail-closed through `failTo`: Claude is not invoked. `exit.json` uses the same durable helper while `_gjd_claude_status` is still saved; if it cannot be written, the script leaves an explicit failure note and does not silently claim collection evidence.” Add injected write/fsync/rename failures to the job-script tests.

## F4 — P2 — established — `cannot-tell from any port` discards conclusive evidence from another port

D7 says any `cannot-tell` keeps the record where it is. A valid `exit.json` is conclusive even if `/proc` or tmux is temporarily unreadable; a matching live process is conclusive enough for `observed-running` even if the other observational port fails. The global veto wedges records unnecessarily and obscures the intended evidence hierarchy.

Smallest replacement wording:

> Replace D7's last paragraph with: “Reconciliation applies evidence by precedence: valid `exit.json` → completed; otherwise `other-boot` → completed/rebooted; otherwise matching live identity or matching tmux session → observed-running; otherwise any unreadable/cannot-tell input needed for the decision → leave the state unchanged; otherwise no conclusive evidence → outcome-unknown. A weak or unavailable port never overrides stronger conclusive evidence.”

## F5 — P2 — reasoned — the pinned material is not structurally bound to the bytes launched

D1 calls `material.txt` the exact prompt the child receives, but D4/D6 do not say that the launcher can receive only that material, that it is rehashed before invocation, or what `plan(existingId, differentMaterial)` does. The current scheduler dispatcher accepts `definition.behaviour.what` directly and sends it on `-p -`, so an adapter shaped like today's `launch()` can accidentally launch caller memory while journalling a different pinned file. That would defeat the authorisation/audit purpose of the pin.

Smallest replacement wording:

> Add to D2/D4: “An existing occurrence id with any differing canonical origin, launcher kind, admission class, material byte count, or material hash is a conflict and is refused. Immediately before `launching`, the protocol re-reads `material.txt`, verifies its recorded bytes/hash, and hands the launcher that verified file/bytes; launcher adapters have no separate prompt parameter. A mismatch is `failed-before-launch` only because invocation has not yet occurred.” Add a test that mutates caller input and one that mutates `material.txt` after `planned`.

## F6 — P2 — established — wrapper instrumentation needs an outer lifecycle, not edits at child-close sites

Both wrappers have many `fail()` branches implemented with synchronous `process.exit(1)`; `run-codex` may run two credential attempts and intentionally suppresses fallback for write-capable sandboxes. Writing `exit.json` at `runChild` completion would record the first failed Codex credential as the occurrence's exit even when the wrapper legitimately continues, while a `finally` around `main()` will not run through current `process.exit`. The plan's four tests (success/non-zero/timeout/empty answer) do not cover spawn error, overflow, signal, post-child validation failures, or Codex fallback. The plan's “nothing changes” guarantee is plausible, but not yet mechanically protected.

Smallest replacement wording:

> Add to D6: “Instrumentation wraps the whole wrapper invocation, not `runChild` and not each Codex credential attempt. It injects `SPIDERYARN_LAUNCH_ID` into the already-sanitised child env, leaves `ChildStdin`, argv construction (`codex … -- -`), `claude -p`, fallback policy, and `answerIsUsable` in their current owners, and records one final exit artefact only after the wrapper's existing final classification. Refactor `fail` to report through this outer synchronous finaliser (or an equivalent exit hook); do not rely on `finally` across `process.exit`.” Extend tests to spawn error, signal, overflow, auth fallback (one launch artefact), and write-capable no-fallback.

## F7 — P2 — established — D4 omits crash boundaries on its failure/disposition release paths

The happy-path table covers `completed → release → released`, but `failed-before-launch → release → released` and `disposed → release → released` are also non-atomic. D8's replayed-request rule can make this worse: after `disposed` lands and the daemon crashes, simply refusing the replay as “already applied” does not itself release the still-held reservation. The prose implies the orthogonal reservation fold will handle it, but the crash table and tests do not require that.

Smallest replacement wording:

> Add D4 rows for crashes after `failed-before-launch`, after `disposed`, and after owner release but before `released`: reconciliation releases any still-held reservation licensed by the durable terminal/disposition record; if owner lookup says none, it appends `released`; it does not start a new attempt until that fold is settled. Add the same three boundaries to Stage 1/3 fault injection, including replay of the still-present disposition request.

## F8 — P2 — reasoned — Stage 3 is too broad; D5 is not the first thing to cut

The separate durable owner exercises two explicit roadmap requirements that an in-journal reservation cannot: lost-reply lookup and owner restart. Cutting it would make the drill pass by removing a required crash boundary. Keep D5, but make its `lookup` return only `reserved | none` (not the current whole `Grant`, whose `wait/refused` arms are not reservations) and give its journal the same fail-closed/history-resolution policy as F2.

The over-large part is Stage 3: daemon composition, reconciliation, an inbox/CLI, projection, fleet wire parser, HTTP route, React panel, two composition edits, and the drill under one review. No production launch calls this protocol yet, so the web surface displays only empty fixture-era state and adds four seams before Scheduled dispatch or Gradual recovery needs them.

Smallest replacement wording:

> Replace Stage 3 with “Stage 3a: daemon reconciliation, bounded inbox, `overseer-launches list/show/dispose`, projection, and drill.” Move the fleet route/client/panel and `server.ts`/`App.tsx` composition to Scheduled dispatch, when there is a live occurrence to inspect. In D5 change `lookup(key): Extract<Grant, {kind: "reserved"}> | {kind: "none"}` and state that the owner refuses reserve/release after an unreadable or illegal replay until the F2 attributed history-resolution flow handles its reservations.

## F9 — P2 — reasoned — the `reserved ⇒ no invocation` proof is not yet structural

D4 treats an intact journal ending at `reserved` as proof no launcher was invoked. That is valid only if every production launcher capability is reachable exclusively inside one non-yielding protocol prefix: durable `launching` append succeeds, then the launcher is called. The plan adds exported adapters in `launchers.ts`, says only that `launchOccurrence()` is “shaped” for the scheduler, and does not forbid an `await`, callback, or direct adapter call. Reconciliation also runs every checkpoint; if it can interleave with an active `reserved` prefix, it may mark the occurrence failed and release while that prefix continues into launch.

Smallest replacement wording:

> Add to D4: “The reserve → reserved append → intent write → launching append → launcher-call prefix is synchronous and non-yielding. The concrete launcher capability is private to the protocol composition; scheduler/recovery receive only `launchOccurrence`, never an adapter. Reconciliation cannot run inside that prefix. A failed `launching` append returns without invoking. A repository-boundary test proves production imports call launchers only through `launch-protocol.ts`.” If an async admission owner is later required, add an explicit in-memory current-attempt guard keyed by occurrence rather than retaining the no-interleaving proof.

## F10 — P2 — established — D9's projection is not bounded

“Every non-terminal occurrence plus 50 terminal ones” has no upper bound: planned/waiting occurrences can accumulate independently of the capacity-one reservation, and unresolved occurrences deliberately never expire. Calling that projection bounded repeats the exact hidden-unboundedness the recovery roadmap avoids with a first page and older count.

Smallest replacement wording:

> Replace D9's first bullet with: “The daemon writes a bounded first page: at most N non-terminal occurrences (oldest/most actionable first), the newest 50 terminal ones, `totalNonTerminal`, and `omittedNonTerminal`; omitted records remain in the journal and are reachable by the CLI. Crossing N is a visible degraded/overflow state, never silent deletion.” Add a test with N+1 non-terminal records and assert the JSON byte/item bound and omitted count.

## F11 — P2 — established — disk validation/transition legality is not part of the replay contract

D1 names a holed or unreadable line, but D3's TypeScript union does not validate bytes read from JSONL, and the plan never says that a parseable record in an illegal order (`released` before any reservation, duplicate `launching` attempt, changed origin under one id) makes history lost. This repo's stores already distinguish strict line parsing from legal fold transitions because silently skipping an illegal record manufactures a plausible history.

Smallest replacement wording:

> Add to D1/D3: “Every line has a schema and exact runtime parser. Replay validates occurrence identity, immutable fields, attempt monotonicity, and the transition relation; any unknown schema, malformed known kind, conflicting duplicate, or illegal transition makes the journal `history-lost` at that line. No later line is folded across it.” Add one red test per class. Reuse `parseProcStat`, `readProcessStart`, and `readBootIdentity` from `tools/fleet/execution-identity.ts` (or extract a neutral leaf) rather than adding another `/proc` parser in `launch-artefacts.ts`.

## F12 — P2 — established — the drill's cardinality assertions accept a launcher/owner that does nothing

D11 and Stage 1 require launcher invocations `≤ 1` and reservations held `≤ 1`. Both are true at zero. In the most important crash row—“external effect before `start.json`” ending unknown—a launcher stub that never invokes anything can produce the expected absence/unknown and pass the cardinality claim. This is the repo's documented silent-success class: the check shares the implementation's possible no-op.

Smallest replacement wording:

> Replace the drill assertion with: “For each boundary the table declares exact expected counts: before invocation, launcher effects = 0; at/after the injected external-effect boundary, launcher effects = 1; while reservation should be held, owner lookup = exactly one matching grant; after licensed release, zero. Count the external marker/tmux session independently of the protocol's own callback counter.” Add a negative control that replaces the launcher with a no-op and require the drill to fail at the first post-invocation boundary; report which assertion failed.

## F13 — P2 — reasoned — “absolute, no odd bytes” is not shell-safe validation

`--launch-dir` legitimately allows spaces and shell metacharacters. The value crosses the local shell → ssh → remote shell → tmux command construction in `gjd-remote`; the existing `metaFlags` quotes every value with `shq` for exactly this reason. The plan's tests assert only that the flags are present, not that a path such as `/tmp/a b'$(x)` remains one inert value. The scheduler's current `-p -` placement is also load-bearing because stdin must reach EOF.

Smallest replacement wording:

> Add to D6: “`SPIDERYARN_LAUNCH_DIR` is shell-quoted with the existing `shq` mechanism at every command layer; validation is not used as escaping. The dispatch adapter places both new options before the unchanged final `-p -`, still writes the exact pinned material plus newline to stdin, and closes the pipe.” Add a generated-command test with spaces, a quote, `$()`, and a newline refusal, plus an adapter test asserting the exact `-p -` argv/stdin/EOF contract.

## D10 conclusion (not a finding)

Leaving `schedulerTick` untouched is defensible for this stage. The roadmap deliberately has later consumer stages, and this stage explicitly forbids real launches. Wiring the live scheduler now would either double-record or silently replace a currently armed path before Scheduled dispatch supplies its result vocabulary and page. The acceptance is satisfied here by one public protocol used end-to-end by the fixture and by making the later consumers use it; it does not require this stage to launch scheduled work. Add one sentence that no production caller is composed yet and a grep/entry-point test proving that fact, so “built but uncalled” is an intentional safety property this time.
