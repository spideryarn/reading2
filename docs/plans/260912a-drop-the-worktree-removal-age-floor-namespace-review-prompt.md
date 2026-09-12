# Review prompt: the PID-namespace fix to 260912a, and whether liveness alone now protects a live tree

You are GPT Sol, reviewing **findings-only**. Do not edit any file. Write your findings as your answer.

## What this is for

`npm run worktree:remove` (and the sweep, `scripts/worktree-sweep.ts`, which calls the same
`liveness()`) removes a git worktree that other AI agents on this shared Linux box may be working in.
Until commit `1203d2ff` (2026-09-12) a third party could only remove a tree that had been idle for 24
hours. Greg removed that floor: a finished tree may now be removed at once, by anybody, on evidence
alone. Plan: `docs/plans/260912a-drop-the-worktree-removal-age-floor.md`.

Your own first review of that change (`docs/plans/260912a-drop-the-worktree-removal-age-floor-code-review-sol.md`)
said **REFUSE**, on a High finding: inside a private PID namespace — your own Codex sandbox, measured —
`/proc` omits a live owner outside it, so the lock's pid reads as gone (stale) and no process sits in
the tree, and a live peer's tree reads as idle and removable.

The session then fixed it: `classifyPidNamespace` in `scripts/worktree-inuse.ts` requires
`readlink /proc/self/ns/pid` to be `pid:[4026531836]` (`PROC_PID_INIT_INO`); anything else, or an
unreadable link, is `unknown`, and `unknown` refuses. `liveness()` in `scripts/worktree-remove.ts`
asks it before either signal. Tested red-first by injecting a namespace link into the real `/proc`
table, because an unprivileged `unshare` is refused on this box. **That fix has not been back to you.**
This is that review.

## Evidence

- The scoped code diff of `1203d2ff` (scripts, tests, tools):
  `/tmp/claude-1000/-home-greg-code-spideryarn2/c4047636-0c5e-40ea-b154-97bd05405aa2/scratchpad/1203d2ff-code.diff`
  — nothing in these files has changed on `dev` since.
- Current files: `scripts/worktree-remove.ts`, `scripts/worktree-inuse.ts`, `scripts/worktree-sweep.ts`,
  `scripts/worktree-check.ts`; tests `tests/worktree-remove.test.ts` (the namespace tests are the
  `describe("liveness, from inside a private PID namespace")` block, ~line 604),
  `tests/worktree-inuse.test.ts` (`describe("classifyPidNamespace")`), `tests/worktree-sweep.test.ts`.
- The host box's own link: `readlink /proc/self/ns/pid` → `pid:[4026531836]` (read just now, outside
  your sandbox).
- Your sandbox last time denied git subprocesses (`spawnSync git EPERM`), so the git-backed tests may
  fail in setup there; the process-only tests ran. That is expected, not a finding.

## Questions, in order

1. **Is the namespace fix correct and closed?** In particular:
   - **Run it for real in your sandbox**, which is the case it was written for: e.g.
     `node --import tsx -e 'import("./scripts/worktree-remove.ts").then(m => console.log(JSON.stringify(m.liveness(process.cwd(), "claude session peer (pid 1 start 1)"))))'`
     (adjust as needed). Report what `readlink /proc/self/ns/pid` says in there and whether
     `liveness()` now returns `unknown` naming the namespace. That is the check the session could not
     run, and the one I most want.
   - Is inode `4026531836` really fixed for the initial PID namespace on every kernel this could run on
     (Linux ≥ 3.8)? Any case where a *non-initial* namespace could present that inode, or the initial
     one could present another (e.g. different procfs/nsfs device)? Does comparing the inode without the
     device number matter?
   - Mismatched `/proc`: a process in the host PID namespace but with a `/proc` mounted from a child
     namespace, or the reverse (private namespace, host procfs bind-mounted). Does either fail open?
   - Is the test a real test — would it go red if the gate were removed, and does it prove anything the
     `classifyPidNamespace` unit tests do not? Is the control test's weakening (asserting "not the
     namespace reason" rather than `idle`) acceptable?
2. **Other ways `/proc` can be complete-looking and wrong in the host namespace.** For example
   `hidepid=1/2/invisible` on the `/proc` mount (check `mount | grep proc` / `/proc/self/mountinfo` if
   you can), or a session running under a **different uid** — signal B skips every foreign-uid process
   (`if (uid === null || uid !== me) continue`), and signal A treats an unreadable owner stat as gone.
   Is any of that reachable on this box in practice (all agents run as `greg`, as far as I know — check
   rather than trust that)?
3. **Without the floor, does the remaining evidence still protect a live peer's tree?** The evidence
   is: `worktree:check` safe; every commit the tree names (tip, branch reflog, the tree's HEAD reflog) on
   a freshly fetched `origin/dev`; no live `(pid,start)` in the lock that is not the asker's ancestor;
   no same-uid process with its cwd inside, excluding the asker's ancestors and its process group;
   any unknown refuses. Look for a concrete live-peer scenario that passes all of those and gets its
   tree removed — beyond the two the plan already concedes (a session that never entered the tree with
   `EnterWorktree`/`claude --worktree`; a session that exited meaning to come back — Greg accepted that
   one). Think about: the ancestor and process-group exclusions being wider than intended (e.g. the
   Overseer or a tmux server as a common ancestor), a Claude session between tool calls, a resumed
   session whose lock names a dead pid, the sweep's report vs. the removal's verdict drifting, and
   ordering (liveness is read once, before the unlock and removal).
4. Anything else in the diff that is wrong. The renamed-tree-reads-as-ghost finding from your last
   review is known and deliberately out of scope; don't repeat it unless the floor's removal made it
   worse.

## The conclusion I would least like to be wrong about

"On this box, from a host-namespace session, a tree whose Claude session is alive can no longer be
removed by `worktree:remove` or be printed REMOVABLE by the sweep — and from any non-host namespace,
nothing live is ever removed." Try to break that.

## Output

Findings ranked by severity (P0 / P1 / P2 / P3), each with file:line, a concrete failure scenario, and
whether you reproduced it. Then a one-line verdict: **ACCEPT**, **ACCEPT WITH FIXES** (name them), or
**REFUSE**.
