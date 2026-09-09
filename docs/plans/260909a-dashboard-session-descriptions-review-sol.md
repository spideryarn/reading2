## Verdict

**Refuse as written.** No P0, but F1–F7 are established P1s. The strongest refusal basis is F1: the current transcript reader explicitly documents that it can return the previous conversation from a reused pane, while the proposed fingerprints and `tmuxServerPid` all continue to match.

### Direct answers

1. **The dashboard-side decision survives, but its stated premise does not.** A daemon producer need not publish “through the register”; it already receives current rows and could publish a separate identity-keyed projection. [`wire.ts`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/wire.ts:1245) refuses joining the existing historical register, not all daemon-to-row joins. Dashboard ownership is still preferable because it owns the bounded transcript reader and avoids an extra publish/join boundary.

2. **No, the two fingerprints plus `tmuxServerPid` do not make stale or misattributed text impossible.** F1 and F2 give concrete sequences. A tmux PID is also not a durable generation token across PID reuse.

3. **Stage 0’s extraction is small, but Stage 0 is not correct as the title solution.** Web launches deliberately create a non-provisional `web-…` Claude name; that becomes a `customTitle`, making `row.title` non-null, so Stage C never uses the generated title. The existing route documents this exact consequence.

## Findings

### F1 — P1 — established: a reused pane renders the previous conversation’s description

(a) [`transcript.ts`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/transcript.ts:202) states that `CLAUDE_SESSION_ID` is fixed in tmux and can still name conversation A after the pane starts or resumes conversation B. `readRecentMessages` then faithfully reads A. The tmux server PID, session handle, pane handle and pane PID can all remain unchanged. Both fingerprints are calculated from A, match A’s cached record, and A’s confident description renders on B’s row. Waiting for the Execution identity stage does not help unless this plan explicitly consumes its verified conversation reading.

(b) Replace the cache-key paragraph with:

> A description is renderable only when the row’s Execution identity is `verified` and its verified conversation id is the id of the transcript read. `claimed-only` or `unknown` identity produces `cannot-tell`; it never falls back to `CLAUDE_SESSION_ID`. Every stored record carries the verified execution token, verified conversation id, tmux identity and content fingerprints, and all must match at render time. `tmuxServerPid` alone is not durable identity.

Add the reused-pane sequence as a required join test.

### F2 — P1 — established: the proposed reader cannot detect that its cached idle summary is stale

(a) The plan says `collect()` “only ever reads” `descriptions.json`, but also says it checks the current opening and tail fingerprints. Rows contain neither fingerprint, so there is nothing current to compare with. A key-in-record check proves only that a record was filed under its own key.

Concrete sequence: T1 is summarized and stored; the session emits T2 and becomes idle; collection reads the unchanged file before the async pass refreshes it; stored `tailFingerprint(T1)` agrees with itself and the tmux PID agrees, so the UI renders T1’s summary beside the T2 session. If the pass wedges, there is no planned attempt reading that makes the stale result visible.

(b) Replace the refresh-loop design with:

> The async pass is bound to one immutable fleet snapshot and publishes an in-memory overlay for that snapshot, not a timeless row cache. A new snapshot immediately hides the previous overlay. Before publishing after a model call, the pass rereads the transcript identity and fingerprints and discards the answer if either changed. `statePayload` attaches an overlay only when its snapshot token, verified execution identity and fingerprints match the snapshot being serialized. Pass state is a required reading (`pending | current | cannot-tell`), so a stopped pass cannot leave an old description appearing current.

Persistence may still cache model answers; it must not itself license rendering.

### F3 — P1 — established: `readRecentMessages` cannot produce `openingFingerprint`

(a) The cited reader reads backwards from EOF and retains the newest 12 turns, at most 1 MiB. If a session is over budget initially and is first described after turn 13, its “opening” becomes a moving tail. That makes the description about later activity and invalidates the claim that the fingerprint is stable for the conversation.

(b) Replace the Stage B material bullet with:

> Add a separate bounded `readOpeningMessages` reader over the head of the located transcript. It returns the same honest refusal arms and an explicit “opening complete/truncated” reading. Only it supplies description/title material and `openingFingerprint`; `readRecentMessages` supplies idle-summary material and `tailFingerprint`. Test a session first described after more than 12 turns.

### F4 — P1 — established: web-launched sessions are ineligible for generated titles

(a) [`routes-new.ts`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/routes-new.ts:405) deliberately passes an opaque `web-…` name. That makes gjd-remote invoke `claude --name`, records a `customTitle`, and makes the session non-provisional. Stage 0 reads that title; Stage C generates only where `row.title === null`. Therefore the exact sessions Greg asked to improve keep their clock-shaped titles.

(b) Insert before Stage C:

> Add a gjd-remote launch option for a **tmux-only name**. It names the tmux session, is not passed as Claude’s `--name`, and does not permit `adoptTitles` to rename the tmux session. The web launcher uses this option for its opaque name. Test end to end that the tmux address stays fixed, the initial row has no Claude title, the generated display title is eligible, and a later `aiTitle` replaces it only in the dashboard.

This makes Stage 0 larger than claimed.

### F5 — P1 — established: the private notification prefix violates the attribution gate

(a) `overseer.md` says attribution is enforced through required `Speaker`, “and you should not work around it.” The plan explicitly works around it with a private constant. A coordination conflict with another branch is not a reason to create the second handwritten attribution mechanism the gate forbids.

(b) Replace Coordination item 1 with:

> Add `"dashboard"` to `Speaker`. Update the exhaustive `SPEAKER_PREFIX` and `parseSpeaker` consumers, then compose the notice through `renderMessage(text, "dashboard")`. The prefix says that the fleet dashboard generated the notice and that it is not Greg. Merge the delivery-receipts work first if necessary; a temporary build conflict does not justify a second attribution path.

This leaves `wire.ts` import-free.

### F6 — P1 — established: nullable notification state permits the consumer to lose the result

(a) A nullable field permits `{state:"started", notification:null}`—indistinguishable between pending, not attempted, and a dropped wiring edge. That is precisely the `T | null` seam prohibited by the cited robustness contract.

(b) Replace the nullable-field bullet with:

> Make `LaunchRecord` a discriminated union. `starting` carries `notification:{kind:"not-attempted"}`; after launch success, `started` carries `notification:{kind:"pending"} | NotifyOutcome`; `failed` carries `notification:{kind:"not-applicable"}`. No started record can omit notification state. `NewSessionPanel` exhaustively renders every arm.

### F7 — P1 — established: bounding individual synchronous calls still blocks the dashboard

(a) The path can synchronously execute `list-panes`, `pgrep`, `ps`, `capture-pane`, text `send-keys`, and Enter `send-keys`. At the current ten-second bounds that is roughly 60 seconds, not “up to three tmux calls” or 30 seconds. Lower per-call bounds reduce the outage but retain event-loop blocking under the exact loaded-box condition this dashboard reports.

(b) Replace the timeout bullet with:

> Do not run `sendMessage` on the dashboard event loop. Execute the existing synchronous verifier/sender in a bounded worker or child process, with one total deadline. Preserve its typed result; if the worker deadline expires after an effect may have begun, record `unknown`, never `refused`. Mark the launch `started` with notification `pending` before starting this work so notification cannot delay the launch result.

### F8 — P1 — reasoned: a stale claim can notify a former Overseer

(a) `sendMessage` revalidates pane, process and conversation, but not `GJD_ROLE`. Between the last fleet snapshot and delivery, holder A can release the claim while remaining in the same pane. Every send guard passes and the notice goes to a session that is no longer the Overseer.

(b) Add to Stage D:

> Resolve through `claimFromSnapshot` with its freshness gate, then re-read the complete live claim set immediately before delivery. Deliver only if exactly the same verified execution still uniquely holds `overseer`; otherwise return `no-holder`, `contested` or `cannot-tell`. Process identity does not substitute for current role ownership.

### F9 — P1 — reasoned: “must not say finished” has no implementation requirement

(a) The risk section recognizes that `idle` means only “stopped generating,” but neither Stage A nor Stage E constrains the model or frames the output. A model can turn an idle question into “The task is finished,” which the UI then presents as the session summary.

(b) Add to Stage A/E:

> `idleSummary` summarizes the last completed turn, never the session’s completion state. The prompt requires reported speech and forbids inferring `finished`, `completed`, success or failure from `idle`. The UI labels it “Generated from its last completed turn” and always retains the mechanical status beside it. Assert these constraints in the captured gateway request and test question-ending and completion-report fixtures.

### F10 — P2 — established: Stages A and B deliberately end with dead joins

(a) Stage A’s done condition is “nothing else imports the new module”—Class A from the cited postmortem. Stage B ends with bytes on `/api/state`; Stage C is the first reachable consumer. Both contradict the plan’s claim that every stage ends with the join exercised.

(b) Replace Stages A–C with one delivery stage, allowing internal review checkpoints but one completion boundary:

> This stage is complete only when the production `statePayload` output passes through the real browser parser and renders every description arm in `SessionsPanel`. Unit-only describer/store checkpoints may be reviewed, but are not completed or landed stages.

### F11 — P2 — established: the daemon rationale overstates what `wire.ts` refuses

(a) The daemon consumes current dashboard snapshots, not only its register. It could publish a separate description projection keyed by verified identity. `wire.ts` refuses treating historical register entries as current rows; it does not forbid such a projection.

(b) Replace lines 125–129 with:

> A daemon producer could consume the current rows and publish a separate identity-keyed description projection; it need not misuse the historical register. That design would, however, add another persisted contract and a second temporal join back onto the dashboard’s current rows. The dashboard already owns both those rows and the bounded transcript reader, so producing here removes that boundary and is the smaller design.

### F12 — P3 — established: the plan’s status is internally stale

(a) The header says “planned, nothing built,” while Stage 0 is checked and tracked Stage 0 edits appeared during this review.

(b) Replace it with:

> **Status as of 2026-09-09: Stage 0 implemented locally but uncommitted; Stages A–F unbuilt.**

The native `<details>/<summary>` decision is proportionate. “Popup panel or something,” an established disclosure pattern, and explicit 390 px browser validation make Stage E’s choice a sound simplest-first implementation.

I did not run a test: the reviewed candidate was described as doc-only, and the decisive findings are contract and composition defects visible statically. During the review, Stage 0 tracked edits appeared in the shared tree; I treated them as concurrent work, not as part of the originally stated candidate.