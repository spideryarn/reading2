## Overall judgement

The plan is well researched and its dated findings are accurate: I verified E-actions, E-confirm, E-queue, E-seam, E-work, E-blocking, E-stream and E-session against the current tree, and none has been fixed upstream. It preserves Greg's ordering, the Wave 2 commitments, the one-collector rule, the loopback and A5 decisions, and the daemon's single-writer store. Its weakness is sequencing and proportion, not facts. The first batch is roughly eighteen agent-days before the plan says it is safe to stop, and the first visible value is gated behind a one-day identity stage it does not need. Several fixes that the tree already names as small are wrapped in machinery sized for a later tier.

## Findings

**F1. Execution identity gates read-only value it does not need. Blocker for the ease/value ordering.**
Section: priority table and the Overseer status, Box contracts and Session continuity dependencies. The register in `tools/overseer/store.ts` already keys on tmux id plus claimed conversation id and carries `tmuxServerPid`, `paneId` and `panePid`. That triple is generation-aware and is enough for a read-only status join and an inbox card, labelled as a claimed identity. Sol's R2 offered exactly that cheaper option, "degrade to unknown rather than claim replacement detection", and the plan took the expensive one. Revision: move Execution identity out of the first batch. Let Overseer status and Attention inbox join on the existing triple and render it as claimed. Make Execution identity a prerequisite only for kill confirmation with start-time checks and for draft continuity.

**F2. The Box contracts preview envelope is disproportionate for the middle tier. Blocker for proportionality.**
Section: Box contracts. The existing test at `tests/fleet-actions-route.test.ts:980` already drives the real browser client through the real route and names the fix: send the shown candidates' pids back. The route already re-scans and intersects with the shown set. Candidates already carry `etimeSeconds`, so PID reuse is caught by sending pid plus elapsed time and refusing any pid whose current age is smaller than shown. Revision: send candidates with elapsed time and the displayed recipient rows, echo a `serverInstanceId` so a restart invalidates the preview, and gate Confirm on an explicit `dryRun: true`. Drop the preview id table, action revision hash and expiry. Reword the "simpler alternative rejected" note accordingly, since the rejected alternative is now most of the stage.

**F3. The Attention inbox stage does not say who produces the cards.** Blocker for a weaker agent.
Section: Attention inbox. The `AttentionList` shape already sits in `wire.ts`, and Wave 2 Stage A says the daemon writes it into the checkpoint and the page renders it. The roadmap's stage text lists sources without an owner, so an implementer could build a second detector in the fleet server from `needs-you`, which is the option Wave 2 explicitly rejected. Revision: state that dialog and duration cards come from the daemon's list via the `/api/overseer` projection, that the dashboard adds only visibility cards such as a stale heartbeat or source, and that no fleet-side question detector is permitted.

**F4. Baseline's `handler` seam is not needed for its stated purpose.** Optional.
Section: Baseline. The client-to-route join already exists through `browserFetch(routes)` against `makeActionRoutes`. The seam only earns its keep for URL prefix tests, which belong to Access review. Revision: cut it from Baseline and move it to Access review.

**F5. Three one-line fixes are buried in later stages.** Optional but high ratio.
Section: Session continuity and Failure containment. In `NewSessionPanel.tsx:133` a failed poll returns before the give-up check, so permanent failure polls forever. In `RecentMessages.tsx:389` adding `row.claudeSessionId` to the effect dependencies covers the resume case the file's own header describes. For SSE, Node's `writableNeedDrain` lets `broadcastFrame` skip a subscriber until drain, which makes the existing "drop, don't queue" comment true without disconnecting phones. Revision: put the first two in Baseline and offer the third as the default policy in Failure containment, with close-on-false as the fallback.

**F6. No mechanical misdirection card anywhere before Bounded judgement.** Optional.
Section: Attention inbox. The direction doc says the proxies for an agent working confidently on the wrong thing already exist in what is collected: primary checkout, plan-doc name, time since push. The roadmap reaches misdirection only through model calls. Revision: add one cheap card kind to the inbox stage, "working in the primary checkout" and "working N hours with no push", as observed facts with no inference.

**F7. Attention completeness should name the credential its classifier burns.** Optional.
Section: Attention completeness. A short-lived classifier spawned by the daemon uses the same Max account the fleet is exhausting, and the direction says the Overseer must keep working when quota is gone. The stage acknowledges exhaustion but should say the call goes through the existing `run-claude` wrapper and that quota refusal is a visible state on the inbox, not a silent empty scan.

**F8. Put the executable default at the top.** Optional.
The "do this first, stop here" paragraph sits at lines 176 to 183 inside a 960-line document. A weaker agent needs a six-line numbered list under Goal and scope with the stop line, and the stage sections as reference.

## Recommended first delivery batch

1. Baseline, trimmed: record versions, fix the two freshness tests, land the two one-line client fixes from F5.
2. Failure containment: single-flight latch around collection, the drain guard on SSE, a deadline on error bodies in `source.ts`.
3. Box contracts, small form per F2.
4. Delivery uncertainty: quarantine the target after partial or unknown, instance-prefixed item ids, honest queue states.
5. Overseer status: the projection and the panel replacement, joined on the existing claimed triple.
6. Work evidence: wire the classifier into the daemon tick.
7. Attention inbox v1, rendering the daemon's list plus visibility cards and the F6 proxies.

Then Attention completeness by integrating Wave 2 Stage A. Stop there. Defer Execution identity until kill confirmation with start-time checks or draft continuity is next. Defer the preview table, Responsive collection beyond a measurement, and everything from Resource history onward.

## Unverified and verdict

I could not run git, so the commit SHAs in the reconciliation section are unverified. The roadmap credits `1534a908` for `wire.ts` while Wave 2 credits `3df3e833`. The test counts, the live schema-1 checkpoint, and the systemd installation state are taken on trust. Glob timed out on this box, so directory listings came from grep. I did not check `answeringOff`, the `q1` counter reset, or the unreadable-queue hiding claim.

Verdict: **REVISE**. No factual defect in the verified findings, but F1 to F3 change what gets built first and how big it is.