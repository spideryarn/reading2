## Verdict

**Not ready to build as written.** The read-only half—`tick` and `last`—is sound after some extraction. The mutating half has four gate violations or incomplete transaction protocols: `closeout`, `dispatch`, `pause`, and `log`.

The plan’s recurring mistake is treating “checked immediately before” as equivalent to “one atomic operation.” It is not, especially when the next step launches, kills, removes, commits, or sends keystrokes.

## P0 — must fix before building

### P0-1 — `closeout` contradicts the gate and normally cannot complete anyway

The branch-deletion reasoning is technically careful but still unauthorized. The runbook explicitly names “branch or tag deletion” as forbidden, without an exception for proved-landed refs ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:140)). A compare-and-swap proves safety; it does not grant authority. The brief’s “never delete a branch” settles the question.

There is also a functional failure: `worktree:remove -- --branch …` waives its 24-hour floor only when the worktree’s owning Claude process is an ancestor of the removal process. A command launched by the Overseer is not the owner. Before killing, removal refuses because the tree is in use; after killing, it refuses because the fresh tree is under the 24-hour floor ([worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/scripts/worktree-remove.ts:679)). This is deliberate—the helper’s own plan says a third party should wait.

The proposed order also has a real TOCTOU:

1. `worktree:check` says safe.
2. The session writes or receives queued steering.
3. `gjd-remote kill` kills it with new unpushed work.
4. The removal helper rechecks and refuses—but the prohibited kill already happened.

A post-kill recheck preserves the files but cannot undo “killing a session with unpushed work.” The plan also omits the objective refusal for outstanding `partial` or `unknown` steering required by the runbook ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:149)).

What I would do:

- Make `closeout` initially a **check/report command**, not an all-in-one destroyer.
- Require an exact session generation—pane handle plus Claude conversation id—not only a mutable name.
- Require the action queue to be empty and free of `partial`/`unknown` holds.
- Reuse the existing generation-aware `kill-session` action rather than creating another kill sequence ([actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/fleet/actions.ts:805)).
- Keep the branch unconditionally.
- After killing, mark the worktree pending removal and let the existing 24-hour third-party policy reap it. If immediate removal matters, have the owning session invoke the sanctioned removal before it exits, after the Overseer explicitly tells it to.
- Remove `--sha` as a safety gate. The helper’s full tip-and-reflog proof is stronger. Keep the SHA only as debrief metadata.

If immediate third-party removal is desired, that is a policy change requiring Greg’s approval, not an implementation inference.

### P0-2 — “debrief-shaped” is invented mechanical judgement

The CLI cannot infer whether a turn is a satisfactory debrief. The runbook explicitly documents why prose-shape heuristics fail, and `/api/messages` may lag the live pane by one or two turns.

A check for words, question marks, headings, SHAs, or test names will produce both false refusals and false approvals. Worse, approving on content would treat another agent’s prose as authority, even though the runbook says it is data.

The honest design is:

- Heuristics may **warn**: “the latest readable assistant turn does not mention a commit or checks.”
- The destructive command should **refuse unless the Overseer explicitly attests that it read the debrief**, e.g. `--debrief-reviewed <turn-uuid>` or a separately recorded acknowledgement.
- The CLI may verify that the named turn belongs to the same conversation generation. It must not claim to verify its adequacy.
- `partial` or `unknown` steering remains an objective refusal, not a warning.

This preserves the judgement boundary: the Overseer judges; the CLI records who made that judgement.

### P0-3 — `dispatch` has neither an authorization boundary nor a launch transaction

Two separate failures:

1. `--brief <file>` allows an arbitrary file to become the real instruction after Greg authorized the queue item. The queue authorizes a specific revision, but not the supplied brief or the proposed common document. That violates the rule against acting on changed instructions or documents ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:151)).

2. Launch first, then append `dispatched` is not atomic. The session can start and the queue append can then fail because of a stale version, lock contention, crash, or disk error. The queue still says the item is dispatchable. Reusing the same name prevents one simple duplicate, but leaves an unreconciled paid session and does not solve retries with a changed name.

The queue already has a careful locked append protocol ([idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/idea-queue.ts:1243)), but it lacks the lifecycle event this operation needs.

What I would do:

- Add a durable `dispatch-reserved`/`dispatching` event before launching. It names the queue revision, session name, assembled-brief digest, and command/idempotency id.
- Greg’s authorization must cover the assembled brief digest—or the queue item must directly contain/pin all instruction documents and their hashes.
- Launch through a generic primitive extracted from the existing tested `gjdRemoteDispatch()` adapter, which already handles argv, stdin EOF, missing `tsx`, spawn errors, and exit outcomes ([dispatch.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/dispatch.ts:114)).
- Settle the reservation as `dispatched`, `failed-before-launch`, or `unknown`.
- On retry, reconcile the reservation against `gjd-remote ls`; never blindly launch again.
- Derive tick ownership from the queue reservation/lifecycle rather than following launch with a separate `mine add` that may fail.

Without this protocol, `dispatch` is the command most likely to pass its test while failing in production.

### P0-4 — `pause` records a fact before it exists and uses the wrong delivery door

“Record first, send second” records “paused” when only “pause attempted” is true. On `none`, the session was never paused. On `partial`, text is sitting unsent in its input. On `unknown`, nobody knows. Those cannot share one `PauseRecord`.

The immediate steer route also requires exact pane, tmux session, Claude conversation, and declared-status claims—not a session name ([routes-steer.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/fleet/routes-steer.ts:701)). More importantly, it types immediately. An agent still working should receive a queued action at its next prompt; that is exactly what the existing action queue is for. The runbook says to call the existing action vocabulary rather than grow a second mechanism ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:299)).

What I would do:

- Drop the sending half of `pause`/`resume`.
- Use `SendMessage` when available and `/api/actions/session` otherwise; add the reviewed “finish this step, commit, then stop” sentence to the existing spoken-action vocabulary.
- Retain a narrower `paused record|check|clear` command if durable intent history is needed.
- Model states honestly: `requested`, `queued`, `delivery-uncertain`, `acknowledged/scheduled`, `woke`.
- Use the existing transcript-derived pause reader to check actual scheduled wake-ups instead of inferring them from CLI bookkeeping.
- Never retry `partial` or `unknown`.

This sending command is the one most likely to be built and then bypassed: the runbook already prefers `SendMessage`, while the dashboard action system already owns the fallback.

### P0-5 — `log` is an unsafe temporary git robot

`overseer log '<one line>'` does not mechanically hold attribution: the one line can omit who decided or claim Greg decided something. Yet attribution is the gate it says it enforces.

The git workflow is worse:

- It does not define or verify that it is operating in a dedicated worktree rather than the primary, although primary writes are forbidden.
- A merge conflict leaves the Overseer’s checkout in a half-merged state.
- A successful append and commit followed by a rejected push leaves the decision absent from the shared record.
- Concurrent log calls can commit each other’s text.
- `check:staged-revert` does not protect against concurrent working-tree edits.
- A constant naming today’s plan doc becomes tomorrow’s stale constant.
- `date -u` is unnecessary in TypeScript; `new Date().toISOString()` is UTC by construction.

What I would do instead:

- Either defer this until the real decision log is designed, or make v1 only format/append a structured record.
- Require fields such as `--by overseer|greg`, `--kind decision|assumption|decline|fact`, and the text; generate the timestamp and attribution.
- Write an append-only local record under a short-lived dedicated lock, or print the correctly formatted line for the existing temporary doc.
- Do not merge and push on every log entry.

## P1 — should fix

### P1-1 — rename atomicity does not prevent lost updates

Two processes can both read `{mine:["a"]}`, independently add `b` and `c`, then atomically rename their files. The final state contains either `a,b` or `a,c`. Neither file is torn, but one valid update vanished.

The current in-progress implementation already explicitly accepts “last writer wins” ([cli-state.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/cli-state.ts:38)); that is the wrong conclusion for the list that decides which sessions are supervised.

Use the existing lock code with a distinct `cli-state.lock`:

1. Acquire lock.
2. Read.
3. Validate.
4. Modify.
5. Write and fsync temp.
6. Recheck `stillOurs`.
7. Rename and release.

The daemon holding `overseer.lock` does **not** lock the directory. A second data file is fine, and a separate lock filename will not contend with the daemon. Do not reuse the daemon’s long-lived lock.

Add a schema/version field too. This state is important enough that a future incompatible shape must be `unusable`, not partially defaulted.

### P1-2 — `mine` contradicts “sole Overseer for the whole box”

The runbook says this session oversees the whole box ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:15)). A hand-maintained subset guarantees that sessions launched elsewhere, resumed after reboot, or missed after a failed `mine add` disappear from `tick`.

Drop `mine` and derive the set from the fleet register, queue lifecycle, and standing-job occurrences. If exclusions are genuinely needed, store an explicit ignored set with reasons and expiry—not a positive allowlist whose omissions look like a quiet fleet.

### P1-3 — `tick` omits the mandatory claim preflight and underspecifies its key rules

The first runbook instruction is “check you hold the claim before anything else” ([overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/project/overseer.md:21)). The proposed read-only `tick` does not say it will refuse when another session holds it.

It also needs to surface the deterministic-rule results: default permission mode, a long-unchanged shell command, and missed wake-ups. Merely printing the register and inbox is not demonstrably equivalent.

I would not add another `claim` implementation—`gjd-remote claim-overseer` already exists. Put a reusable preflight in `tick` and every mutating command:

- another holder → refuse;
- no holder → say exactly which existing command takes it, or take it only under the already approved runbook rule;
- claim unknown/stale → refuse mutation;
- own claim → proceed.

### P1-4 — composition is right, but importing `scripts/overseer.ts` is the wrong seam

`collectHealth()` is a good leaf: no import-time I/O, independent unknown arms. `statusLines()` is not. Importing it from `scripts/overseer.ts` loads daemon, attention, scheduler, standing-job, dashboard, usage-history, and now Commander code before `tick` can print anything.

Do not add a duplicate bash reader as a degraded path. Instead:

- Extract status rendering and its small dependencies into a leaf `tools/overseer/status-cli.ts`.
- Run tick sections independently and convert a section failure into a named `unknown`.
- Use dynamic imports or injected collectors where useful so one broken optional module does not erase load, usage, and session output together.
- Consider `collectHealth({includeSwapActivity:false})` for the cheap tick; the synchronous worst case otherwise includes several five-second command timeouts.

### P1-5 — the plan missed existing implementations

At least five overlaps need resolution:

- URL encoding and four-arm response parsing already exist in [messages-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/fleet/web/src/messages-client.ts:78). Extract a platform-neutral core rather than create an unrelated `cli-messages.ts`.
- `tools/fleet/actions.ts` and `/api/actions/session` already own reviewed messages, speaker attribution, generation checks, queueing, partial delivery, and session killing.
- `tools/fleet/pause.ts` already derives actual scheduled wake-ups and overdue state from session evidence.
- `scripts/overseer-queue.ts` already provides `show`, dispatchability checks, and the guarded `dispatched` transition.
- `tools/overseer/dispatch.ts` already provides the tested `gjd-remote new-claude` spawning seam.

There is also already a dashboard `remove-worktree` action, but it still calls `worktree:sweep`, not the newer removal helper ([actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/fleet/actions.ts:765)). Adding `closeout` as another removal route creates the second mechanism the plan says it avoids. Update or compose the existing action vocabulary.

### P1-6 — Stage 1 is too much blast radius

Converting seven existing commands, changing root help, adding a dependency, adding state, and adding `mine` is not one reviewable stage. “Byte-identical behavior” is also incompatible with Commander unless supported and malformed invocations are explicitly enumerated: unknown flags, missing values, default-with-no-command, and help/error formatting will differ.

Sequence it as:

1. Merge the other Commander work first; do not install independently.
2. Add black-box characterization tests for supported existing invocations.
3. Convert only the parser and help, with an explicit compatibility table.
4. Add `last` and `tick`, read-only.
5. Add locked pause-intent state, without delivery.
6. Add the dispatch reservation protocol.
7. Build closeout only after the branch and third-party-removal policy is settled.
8. Defer the git-writing `log` workflow.

The parser conversion is worth doing, but it should be its own stage.

## Required mutation checks

| Stage | Mutation that must make tests fail |
|---|---|
| Commander/state | Delete one existing command’s `.action()`; a real child-process CLI test must miss its sentinel output. Remove the state lock and release two barrier-synchronised child processes; the final state must lose neither update. Change corrupt-state handling to empty; the test must catch the overwrite attempt. |
| `tick`/`last` | Replace `encodeURIComponent(id)` with raw `$…`; assert the fake server received `?id=%24…`. Delete the health collector or turn usage `unknown` into `0%`; assert sentinel critical/unknown values appear in output. |
| `closeout`/`log` | Move kill before the unsafe check; assert the kill stub was never invoked. Create work after the first check and before kill; the command must refuse. Assert the branch still exists. Run log tests under a non-UTC `TZ` and assert the stored instant ends in `Z`; inspect the remote ref and committed path, not only exit code. |
| `dispatch`/pause | Replace the launcher with a no-op; a marker file recording argv and stdin must be absent and the test must fail. Force the queue settle to fail after launch, then rerun; launch count must remain one. Return `partial`; assert one delivery attempt, no retry, and no false `paused` record. Remove `speaker:"overseer"`; the route-body assertion must fail. |

`dispatch` is the highest silent-success risk because a stub returning exit 0 can let every assertion pass without a session, stdin brief, or durable queue transition ever existing.

## Recommended command set

- Keep: `tick`, `last`.
- Redesign: `dispatch`.
- Narrow: `closeout check`; destructive closeout later.
- Replace: `pause`/`resume` sending with existing actions; retain `paused record|check|clear` if necessary.
- Drop: `mine`.
- Replace: git-heavy `log` with a structured formatter/append operation.

No eighth top-level command is clearly needed. The missing recipe is a **claim/generation/delivery preflight**, but it should be a reusable guard inside `tick` and every mutating command; the actual claim verb already exists.

## Corrections to the plan’s factual claims

- HEAD is still `f17a8cd1`, equal to the merge-base with `origin/dev`.
- “Nothing built” and “Commander appears in neither package nor node_modules” are no longer true in this worktree. There are uncommitted Stage 1 changes, `commander@15.0.0` is installed, and `package.json` currently records `^15.0.0`, not an exact pin.
- The heading “one parser in the repo” is false even after converting `scripts/overseer.ts`: `scripts/overseer-queue.ts` still contains its own hand-rolled parser.
- The library-selection process has not produced the checked-in decision artifact required by [third-party-library-selection.md](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/docs/reusable/third-party-library-selection.md:13). Commander is a reasonable outcome, but this plan currently relies on an unlanded transcript as its authority.
- `fleetUrl` and `HELP` are private implementation details in `scripts/overseer.ts`, not currently composable exports.

My recommendation is **build with substantial changes**: land only the parser characterization/conversion and the read-only commands first; stop before any of the four mutating workflows.