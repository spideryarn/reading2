## Findings

### G11 — P1 — Established: the pinned account is stale before launch

The account is resolved before several later awaits (`tools/overseer/recovery-resume.ts:912-930`). After recapturing the observation, `decisionFor` reuses that earlier `headLocated` and `headAccount` (`tools/overseer/recovery-resume.ts:942`, `:1087-1098`), gates their account at `:1129`, and passes it to the launcher at `:1009`.

A ledger append or registry change during those awaits can therefore make the launch use an account other than the conversation’s latest pinned account. This violates G4 and G5 even though there is no literal `await` in the final stretch.

Fix: have account resolution return synchronously recheckable evidence—ledger and registry identities/metadata—and validate it inside the synchronous stretch. If anything changed, defer and resolve again. Prefer a synchronous bounded account lookup for the final check.

### G12 — P1 — Established: a transcript line from before launch can satisfy verification

`launchedAt` is the resume pass’s time taken before writing the attempt and before calling the protocol (`tools/overseer/recovery-resume.ts:945`, `:984-1009`). The actual protocol records `launching` later and invokes later still (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1527-1537`).

Verification independently checks file growth and scans the whole tail for any matching line whose timestamp exceeds that earlier clock value (`tools/overseer/recovery-resume.ts:524-535`). Consequently, a pre-existing future-dated matching line plus a later unrelated append satisfies both conditions. The existing test explicitly demonstrates that a pre-launch line already sets `sessionLineSeen` (`tests/overseer-recovery-resume.test.ts:840-857`).

Fix: expose the protocol’s durable `launching.at`, persist it, and record a transcript byte boundary tied as closely as possible to invocation. Require the matching line to begin after that boundary and compare its timestamp with the protocol launch instant, not the resume pass’s earlier clock.

### G13 — P1 — Established: `planned` and `waiting-admission` occurrences never resume

A normal admission wait leaves the request pending (`tools/overseer/recovery-resume.ts:1028-1031`). Every later pass sees `planned` or `waiting-admission` and only defers (`tools/overseer/recovery-resume.ts:594-597`, `:967-970`).

The protocol’s reconciler deliberately does nothing for those states (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1756-1758`); progression requires `resumeOccurrence` (`:1973-1987`). But `ResumeLaunchPort` exposes only `inspect`, `inFlight`, and `launch` (`tools/overseer/recovery-resume.ts:124-134`). Thus a request that once waits for capacity waits forever after capacity returns.

Fix: expose a synchronous “drive existing occurrence” operation backed by `resumeOccurrence`. After rerunning current gates and revalidation, use it for stored `planned`/`waiting-admission` occurrences without replanning. The occurrence disposition must be adjusted accordingly; a permanent `defer` cannot provide liveness.

### G14 — P1 — Established: immediate failed-before-launch outcomes contradict G1

Every immediate `failed-before-launch` outcome is moved to `refused/`, without inspecting whether its reservation is held or released (`tools/overseer/recovery-resume.ts:1022-1026`). G1 instead requires:

- released: continue into attempt 2;
- held: defer until release.

The tests currently encode the weaker “refuse, then require another tap” behavior (`tests/overseer-recovery-resume.test.ts:892-923`). For a held failure, the page initially offers Resume again rather than retaining the request and exposing the stuck slot.

Fix: keep these requests pending. A released occurrence should proceed through fresh gates and revalidation into attempt 2; a held occurrence should remain deferred and visibly include the disposal instruction if release remains stuck.

### G15 — P1 — Established: malformed or oversized ledger rows can select the wrong account

The account reader accepts any JSON object containing only `schema`, `sessionUuid`, and `accountName` (`tools/overseer/recovery-resume.ts:231-237`). The actual ledger record requires provider identity, launch name, timestamps, and a valid outcome (`scripts/claude-accounts.ts:1099-1141`). A foreign or malformed line naming an existing registry account can therefore override the valid last row and pin the launch to that account.

The bounded-tail handling also fails to discard the leading fragment when a tail contains no newline: `indexOf("\n")` returns `-1`, so `slice(0)` preserves it (`tools/overseer/recovery-resume.ts:217-242`). A line larger than 4 MiB can consequently be parsed from an incomplete tail.

Fix: share the full `LaunchRecord` validator, validate timestamps/outcomes, and reject a truncated first fragment unless a newline boundary was found. Treat an oversized relevant line or semantically malformed newest mapping as unknown rather than selecting an account.

### G16 — P1 — Established: failed terminal moves are silently projected as success

`moveToDone` and `moveToRefused` report failure with `false` (`tools/overseer/recovery-resume-request.ts:462-469`, `:485-492`). Their caller ignores every result and unconditionally sets `headMoved = true` (`tools/overseer/recovery-resume.ts:946-964`). Projection then removes that pending head (`tools/overseer/recovery-resume.ts:1261-1263`).

If the terminal write fails, the request remains pending on disk but disappears from the published state for that pass. Persistent failures keep it permanently invisible, without even a log line.

Fix: retain each failed file as pending, set `headMoved` only when all files actually moved, and log/project the failure explicitly. Handle partial coalesced-group settlement without dropping the remaining files.

### G17 — P1 — Established: unknown-account manual instructions omit the required account warning

For an unknown account, the panel emits plain `claude --resume` because only pinned accounts supply `configDir` (`tools/fleet/web/src/RecoveryPanel.tsx:373-385`). The warning explaining that `CLAUDE_CONFIG_DIR` must identify the transcript-owning account is rendered only when `account === null` (`:395-400`).

Supported records pass their non-null `{kind:"unknown"}` preview account (`:657-662`), so precisely the account-uncertain case omits the warning and can lead Greg to resume under the ambient account.

Fix: show the config-directory warning whenever the account is absent or `kind === "unknown"`. Better, distinguish the proven default-login case from an unreadable/ambiguous account and only show the plain command for the former.

### G18 — P1 — Established: a valid but absent candidate is accepted and then silently disappears

The POST route accepts any syntactically valid candidate ID when no projected state exists and returns `202 queued` (`tools/fleet/routes-recovery-resume.ts:123-134`). The daemon later refuses an ID absent from the recovery index (`tools/overseer/recovery-resume.ts:679-683`) and projects that refusal (`:1288-1310`).

At the sole write point, however, `resumeForFile` silently drops every request whose candidate is absent from the fold (`tools/overseer/store.ts:3067-3075`). The page therefore shows neither the refusal nor an unreadable-state alarm. A stale tab or direct valid request receives “queued” and then loses all visible status.

Fix: preserve an explicit projection problem for dropped/orphaned requests and display it without affecting base records. Where the route has authoritative candidate membership, reject an absent candidate before writing.

### G19 — P1 — Established: terminal occurrences with held reservations can block forever without an escape

The occurrence shape models `state` and `reservationHeld` independently (`tools/fleet/wire.ts:4925-4933`), but the supposedly exhaustive switches are exhaustive only over `state` (`tools/overseer/recovery-resume.ts:585-607`, `:1208-1234`).

The protocol includes any occurrence with a held reservation in `inFlight`, even when terminal (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:2087-2093`). Yet pace calls only `outcome-unknown` and held `failed-before-launch` stuck (`tools/overseer/recovery-resume.ts:629-640`). A `completed` occurrence whose release owner remains unavailable is displayed as `ended-unverified` without a dispose command (`:1223-1224`) while blocking every later request as “waiting … to be verified running,” which can never happen.

Fix: model the valid state/reservation/disposition combinations as a discriminated union. Any terminal occurrence that still holds a reservation should surface as `needs-greg` with the disposal command and be treated as a stuck pace blocker.

## Verdict

**Refuse.** G11–G19 are established P1 contract or user-visible failures.