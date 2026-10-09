NOT READY

**F1 — P1: Accepting the in-process subagent residual exceeds the stated permission.**  
Evidence: `docs/plans/261009v-worktree-removal-on-macos-and-an-automatic-sweep.md:3-10,110-122`; `docs/project/worktrees.md:770-775`.

The plan explicitly allows removing a tree belonging to an agent that is still working between tool calls. Clean and landed does not establish “successfully finished.” The earlier acceptance of an exited session’s possible future continuation does not settle this different case.

**Recommendation:** Choose neither unrestricted (a) nor a quiet window as proof of completion. A quiet window reduces exposure but eventually deletes a long-thinking agent’s tree. The durable solution is a cooperative ownership record created or refreshed when entering/resuming a tree, tied to the parent session’s process identity and explicitly released when finished. Keeping it while the parent lives conservatively protects in-process subagents on both platforms. There is no universal OS signal for a logical agent whose process has neither cwd nor an open descriptor in that tree. Until ownership is available, leave ambiguous agent trees out of bulk removal.

**F2 — P1: Excluding the entire process group can hide an independent live job.**  
Evidence: plan `:46-47`; `scripts/worktree-inuse.ts:765-779`; `tests/worktree-sweep.test.ts:44-48`.

PGID is not invariably “this pipeline.” Noninteractive shells and ordinary non-detached children can share it across independent jobs. I spawned a child with a different cwd: `lsof -F pgn` showed parent and child sharing a PGID. The proposed Darwin classifier returned `idle` for that arrangement despite the child’s cwd being under the target. Existing fixtures deliberately detach their children, avoiding this case.

**Recommendation:** Do not make shared PGID sufficient for exclusion. Keep self/ancestor exclusions; retain ambiguous siblings as vetoes unless pipeline membership is positively established. Add a same-PGID independent-job refusal test. This limitation also exists in the Linux implementation.

**F3 — P1: Path plus `realpath` is insufficient for macOS cwd matching.**  
Evidence: plan `:48-53`; `scripts/worktree-inuse.ts:680-699,771-779`; `scripts/worktree-remove.ts:294-303`.

Two reproduced cases:

- On this case-insensitive filesystem, lowercase access to a mixed-case directory succeeded. `realpath` preserved the lowercase spelling, while `lsof` printed the mixed-case spelling. Neither proposed root string matched.
- A newline in a directory name became literal `\n` in `lsof` output. `-F pn0` still escaped it; changing field terminators alone does not fix comparison.

Also, a syntactically valid `n` field is not necessarily a usable cwd. The developing parser accepted `nunknown`; the classifier treated that process as placed outside the tree and returned `idle`.

**Recommendation:** Decode the documented field escaping, validate cwd records semantically, and use filesystem identity when pathname spelling cannot establish containment. Unresolved paths must become `unknown`. A failed root `realpath` must also refuse rather than silently fall back to the unresolved path. Add capitalization, escaping, invalid-name, missing-name, and resolution-failure tests.

**F4 — P2: The bulk plan omits live detached trees and needs explicit caller-tree protection tests.**  
Evidence: plan `:72-82`; `scripts/worktree-sweep.ts:175,276-277`; `scripts/worktree-remove.ts:602-618`.

The plan sends detached **ghosts** to “needs a look,” but a live detached tree can also classify as `REMOVABLE` without a branch. Passing its absent branch to the underlying remover selects the caller’s tree instead.

**Recommendation:** Explicitly skip **every** branchless candidate unless a path-targeted removal API is added. Never use `undefined` as a bulk target. Preserve the original caller-tree exclusion, including path aliases, and test running the sweep from a secondary worktree with multiple candidates.

For branch-bearing candidates, sequential calls to `removeOne` do preserve re-earning: each call fetches, checks contents, proves history, and repeats liveness before deletion (`scripts/worktree-remove.ts:674,694,719,782,801`). Detached ghosts remaining untouched is safe.

**F5 — P1: Keep `.env.local — DIFFERS`, but correct the settlement recipe’s conclusion.**  
Evidence: plan `:95-100`; `docs/project/worktrees.md:664-680`; `scripts/worktree-check.ts:793-814`.

The documentation says that no worktree-only key names means the worktree is a stale copy. That does not follow: a locally changed value, deleted key, reordered duplicate assignment, or unique comment can all produce no output from that command. The plan relies on this recipe for operator settlement.

**Recommendation:** Keep the blocker. Describe the command as detecting added key names only; it cannot establish staleness. Require comparison of values and the complete file’s meaningful differences without printing secrets.

There is no safe automatic narrowing for existing differing copies from their two current snapshots alone. For future trees, a protected digest recorded **when copying the file**, checked against the current worktree copy, could prove it remained unchanged without retaining the primary’s full history. That is optional additional scope.

**F6 — P2: Expand the validation plan to cover platform assumptions and scan limits.**  
Evidence: plan `:33-53,124-134`; original `tests/worktree-inuse.test.ts:127-131`; `tests/worktree-sweep.test.ts:50-60`.

The existing tests contain unconditional `/proc` reads. My observed runs failed **1/35** liveness tests, **7/26** sweep tests, and **19/53** removal tests. Implementation files changed concurrently, so these are review-time results, not a verdict on the eventual implementation.

**Recommendation:** Port or explicitly Linux-gate those fixtures, retain injectable tests for removal orchestration, and run the Darwin integration outside this sandbox: `ps` here returns `EPERM`.

Clarify two protocol details:

- The normal “all requested PIDs disappeared” `ps -p` result needs a narrowly specified exit-status exception; blanket rejection remains safe but unnecessarily refuses.
- These are ordered observations, not an atomic snapshot. A process born after the initial `ps` and invisible to `lsof` is outside the recheck set. State that limit alongside the existing final-observation race.

The **pid-only lock-owner proposal is conservative in the relevant direction**: a reused unrelated PID over-refuses; reuse by an actual ancestor means the original owner has already died. That conclusion depends on a complete, successfully parsed process table and a genuine parent chain.

I made no repository edits and used no network. Implementation edits appeared from another actor during the review.