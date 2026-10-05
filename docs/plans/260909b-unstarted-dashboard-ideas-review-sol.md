## Verdict

The evidence is not sound enough to approve unchanged. There are no P0 findings, but four material corrections:

- S4 is already built and tested.
- O1/O2 have a built producer/store/CLI foundation, though not the requested browser surfaces.
- S1 stands only at this checkout’s `HEAD`; its process probe is already being wired by the named execution-identity work.
- The 8-of-14 measurement is not reliable enough to support the stated conclusion. It found a real product gap, but not with the claimed oracle or root cause.

I reviewed the current working-tree version, which now ranks S2 and X1 at 7–9 rather than presenting S2/L1/L2/X1 as the top four.

## P1 findings

### P1 — S4 is a duplicate: parser, wire shape, renderer, and tests all exist

The row at [260909b:148](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md:148>) is false.

- [`classifyConsequence`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/pane.ts:755>) classifies bare “Yes” as `once`, persistent markers as `persistent`, refusals as `decline`, and everything unfamiliar as `unknown`.
- [`toOption`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/pane.ts:763>) places that classification on every parsed option.
- [`Consequence`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/web/src/SessionParts.tsx:266>) renders a distinct labelled pill, and [`Option`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/web/src/SessionParts.tsx:342>) appends it to every choice.
- The actual clickable button shares structural styling, but the choice row is visibly differentiated. That satisfies S4’s product wording.
- Tests explicitly verify the badge reaches the page and that persistent/unknown grants are louder than one-shot choices at [fleet-web.test.tsx:2462](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tests/fleet-web.test.tsx:2462>).

Disposition: remove S4 from the census. Fable’s product argument against building it is moot; the stronger reason is that it already exists.

### P1 — The 8-of-14 measurement overstates what the probe establishes

The underlying observation is useful, but [260909b:113–128](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md:113>) turns a heuristic into “the true answer.”

`meta.dir` is indeed immutable launch metadata:

- [`metaFlags`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote.ts:1140>) records the directory in `GJD_REMOTE_DIR`; its comment explicitly calls it the starting directory.
- It is installed when tmux is created at [gjd-remote.ts:2738](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote.ts:2738>).
- The collector re-reads the tmux environment at [gjd-remote-tmux.ts:591](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote-tmux.ts:591>), but nothing refreshes the directory. The only analogous mutable metadata setter is for role at [gjd-remote-tmux.ts:1311](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote-tmux.ts:1311>).

But `row.worktree` is not independent evidence. It is derived directly from `meta.dir` at [collect.ts:348](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/collect.ts:348>) via [`worktreeOf`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/collect.ts:239>). Therefore:

- `worktree: null` is the correct value for “launched in a plain checkout.”
- [`whereLine`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/web/src/view.ts:259>) truthfully renders launch metadata, but hides the distinction between primary checkout and unknown/currently elsewhere.
- The root problem is that a launch-location field is being read as current execution location, and that current location is absent from the collector. Do not overwrite `meta.dir` or silently change `worktree` semantics; add an explicit current execution location.

The described probe is not a sound Claude-CWD oracle:

- It examines only direct children and only the first three, without identifying which is the harness.
- The launcher runs `bash <job>` and that script starts `claude` without `exec` at [gjd-remote.ts:2706](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote.ts:2706>), so ancestry varies across launcher, hand-created, resumed, and post-Claude shell states.
- A pane whose PID is Claude or a shell may temporarily have a `git`, `npm`, MCP, or background child in another directory. Selecting that child yields a false worktree result.
- Conversely, the real harness may be a grandchild or the fourth child.
- `pgrep` and `readlink` race process exit and PID reuse.
- Even the correct Claude process’s CWD is its default working context, not proof of which files it is editing; absolute paths and subprocesses can reach elsewhere.

The positive and negative controls show the probe does not always emit one answer. They do not prove it selected Claude on each of the eight rows.

Disposition: preserve the finding as “launch location is being presented ambiguously and current execution location is missing.” Re-measure the count using an exactly identified harness before retaining “8 of 14.”

### P1 — O1/O2 are overstated as “nothing”

The requested general surfaces remain unbuilt, but the code now contradicts the inventory at [260909b:171–172](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md:171>).

There is a narrow durable rule-proposal log:

- [`runProposingRule`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/overseer/rule-protocol.ts:192>) runs proposal-only rules.
- [`intend`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/overseer/rule-protocol.ts:245>) appends `rule-intended` with the proposal and finding.
- [`settleRule`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/overseer/rule-protocol.ts:293>) appends `rule-settled`.
- The CLI reads the event tail at [scripts/overseer.ts:227](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/overseer.ts:227>) and renders rule intents/outcomes at [scripts/overseer.ts:290](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/overseer.ts:290>).
- Production wiring supplies `ProposingRuleWork` at [scripts/overseer.ts:754](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/overseer.ts:754>).

What is still absent is the general “decisions made for Greg since last looked” model and any browser review/read/acknowledge lifecycle. No rule-intent events cross the fleet wire or render in the fleet client.

Disposition:

- O1: general decision log not built; narrow automated-rule log built.
- O2: browser review surface not built; proposal producer, durable store, and CLI presentation built.
- Describe both as partial or built-not-wired, not “nothing.”

### P1 — S1 stands at current `HEAD`, but is already time-stale

I found no production imports, dynamic dispatch, module-object lookup, or string-keyed calls to either identifier in this reviewed checkout. Only their definitions and comments exist:

- [`classifyPaneWork`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/overseer/work.ts:693>)
- [`probeProcessTable`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/overseer/work-probe.ts:58>)

So “zero non-test callers” is checked and stands for this `HEAD`, matching the authority table at [260908f:466](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:466>).

However, the active `260908f-exec-identity` worktree already imports `probeProcessTable` and calls it from `readExecutions`:

- [exec-identity collect.ts:44](</home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/collect.ts:44>)
- [exec-identity collect.ts:780](</home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/collect.ts:780>)
- [exec-identity collect.ts:852](</home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/collect.ts:852>)

It wires `classifyPaneHarness`, not `classifyPaneWork`. Therefore the generic work classifier remains unbuilt, while the shared process probe no longer does once that branch lands.

Disposition: S1’s classifier half stands; its “both unused” evidence and ownership must be refreshed after execution identity lands.

## Claims checked and standing

- S2 — checked, stands. There is no fleet draft persistence through local/session storage, IndexedDB, a persistence hook, or a form/store library. The detail composer is plain `useState` at [SessionDetail.tsx:646](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/web/src/SessionDetail.tsx:646>), and the new-session prompt is plain `useState` at [NewSessionPanel.tsx:215](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/web/src/NewSessionPanel.tsx:215>).

- X1 — checked, stands. Fleet Vite has no `define` or revision injection at [vite.fleet.config.ts:49](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/vite.fleet.config.ts:49>); the state payload has no stamp at [state.ts:84](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/tools/fleet/state.ts:84>); server routes expose no revision header. This agrees with [260908f:408–430](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:408>).

- S1 — checked, stands at current `HEAD`, with the imminent-caller qualification above.

- O1 — the full general decision log stands as unbuilt, but “only manual” no longer stands.

- O2 — the human review surface stands as unbuilt, but “nothing” does not stand.

## P2 design corrections

The execution-identity coupling is sound at the acquisition layer, but “do not add a second read” at [260909b:404](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md:404>) is literally false. Execution identity reads `/proc/<pid>/stat`; current CWD requires a separate `readlink("/proc/<pid>/cwd")`. It should share the same process-table scan, harness identification, cadence, and execution token—not the same syscall or identity semantics. A CWD change must not mint a new execution.

There is also a cheaper first-party input already being discarded: `claude agents --json` reports `sessionId`, `pid`, `cwd`, and `status`, documented at [gjd-remote-tmux.ts:466](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote-tmux.ts:466>). [`parseAgents`](</home/greg/code/spideryarn2/.claude/worktrees/dashboard-ideas-review/scripts/gjd-remote-tmux.ts:1366>) currently retains only session ID and status. Its CWD could be carried when present, with the verified harness `/proc` path as fallback because the command is known to omit young live sessions.

S2 should cover two namespaces, not only “localStorage keyed by session id”:

- Per-execution/session detail drafts should be bound to verified execution identity so a replaced process cannot inherit stale text.
- New-session drafts have no session ID and need their own key.
- Clear only after accepted send, queue, or launch—the existing components already follow that acceptance rule in memory.

For L2, transcript mtime is a defensible cheap “last wrote” signal. “Last commit/pushed” is not yet sound: a CWD identifies a repository/worktree, not which session authored a commit, and shared branches make attribution ambiguous. I would defer that half until the attribution contract exists.

## Recommendation

Among the small, unowned candidates, my order would be:

1. X1 — bounded, independently verifiable, and it protects every subsequent dashboard investigation from stale-build mistakes.
2. L1 — valuable, but only after replacing the measurement with exact harness identification and introducing a distinct current-location field.
3. S2 — real and cheap, with execution-bound draft keys.
4. L2’s transcript-mtime/list signal — useful and factual; defer the git-attribution half.

I would refuse S4 as duplicate work, refuse a generic S1 classifier for now, and refuse any implementation that overwrites launch metadata or infers “this session committed/pushed” solely from CWD.

## Verification run

- `npx vitest run tests/fleet-web.test.tsx` — 1 file passed, 349 tests passed.
- Repository-wide `rg` sweeps covered persistence mechanisms, S1 call sites and dynamic dispatch, build/revision channels, and rule proposal events.
- No network was used.
- I could not independently reproduce the historical 8/14 count: the outside-repo scratch script was unavailable here, tmux access was denied by the sandbox, and `claude agents --json` returned an empty list. The methodology review above therefore does not call the count false; it says the described probe cannot establish it reliably.