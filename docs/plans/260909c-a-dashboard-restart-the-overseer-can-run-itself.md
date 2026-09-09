# A dashboard restart the Overseer can run itself

Status: **in progress** — stage 1 written, stages 2–3 pending.

Greg, 2026-09-09, after restarting `fleet-dashboard` by hand:

> work on making this something you can run yourself, e.g. make it a nice script that you can call,
> and see if the auto-classifier will accept that.

Queue item `qi-7k3vfjbn`. Dispatched by the Overseer, session `restart-script`, worktree
`restart-script`.

## The problem, stated precisely

It is **not** a privilege problem. `greg` has `NOPASSWD:ALL`
(`infra/hetzner/cloud-init.yaml:21`) and `sudo -n true` succeeds from an agent's shell. The problem is
that the Overseer's Claude session runs in auto mode and **its command classifier refuses
`sudo systemctl restart fleet-dashboard`**, every time, while the same session was allowed
`kill -TERM <pid>`, `tmux send-keys` and `npx tsx scripts/tmux-job.ts …` on the night of 2026-09-08.
The classifier judges the command text it sees. Greg's hypothesis is that a script name may read
differently from a `sudo systemctl` line — and **testing that hypothesis is as much the deliverable
as the script**.

`docs/project/overseer.md` § "Steering, and the actions you have" already grants the Overseer the
restart, with a condition:

> Restarting the *live* dashboard or daemon to deploy what the primary now holds is also yours, once
> you have read the steering queue (`GET /api/actions`), because a restart discards it — Greg
> approved, 2026-09-08 — but the classifier may still refuse the command, and then it is Greg's.

So the script's job is to make that condition mechanical rather than remembered, and to be a command
whose text honestly says what it does.

## The simpler option this passed over

**A shell script checked into `scripts/`** — the prototype Greg and the dashboard agent already have
(`ov-restart-dashboard.sh`), moved into the repo unchanged. It works. It was rejected for one reason:
its checks are `[ "$a" = "$b" ] && echo MATCH || echo MISMATCH` lines with **no exit status**, so a
check that could not run prints something reassuring and the script carries on. That is exactly the
shape of `docs/reusable/silent-success.md`, in the one tool whose whole value is telling you the
truth about a service you cannot see. A typed script with tests costs an hour and removes the class.

The **second** simpler option passed over: a `--unit` flag. Rejected deliberately — a flag that names
the unit is a `sudo systemctl restart $ANYTHING` waiting to happen, and a fixed unit name also gives
the classifier a narrower, more honest command text to judge.

## What is being built

### `scripts/fleet-restart.ts`

    npx tsx scripts/fleet-restart.ts check              # preconditions only; never restarts
    npx tsx scripts/fleet-restart.ts restart            # preconditions, restart, verify
    npx tsx scripts/fleet-restart.ts restart --discard-queue

Plus `npm run fleet:restart`, which takes the same mode word and has **no default**.

**Preconditions**, each `pass` / `fail` / `unknown` / `n/a`:

| check | how | refuses when |
|---|---|---|
| the unit | `systemctl show fleet-dashboard -p LoadState,FragmentPath,WorkingDirectory,ControlGroup,ActiveState,MainPID` | `LoadState != loaded`, or no `FragmentPath`, or no `WorkingDirectory` |
| the port | the unit's own `Environment=FLEET_PORT`, else the default that `tools/fleet/server.ts` compiles in | neither can be established |
| the bundle | `<WorkingDirectory>/tools/fleet/web/dist/index.html` names an `index-*.js` | the file is missing or names none |
| the primary is at `origin/dev` | `git -C <WorkingDirectory> fetch origin dev` then `rev-list --count HEAD..origin/dev` | count > 0, or the fetch/count fails |
| the steering queue is empty | `GET /api/actions` → `queues[].items` | any item, unless `--discard-queue` (which prints every item it is discarding) |

**The restart**: `sudo -n systemctl restart fleet-dashboard`. Nothing else, no `--user` path, no
`kill`.

**Verification**, same four verdicts:

| check | how |
|---|---|
| active | the unit's `ActiveState`; `activating` is `unknown`, not either answer |
| the process was replaced | `MainPID` before ≠ after — the check that catches this script lying about its own central act |
| not crash-looping | `NRestarts` did not grow. `Restart=always` + `RestartSec=10` makes a service that cannot stay up look healthy every ten seconds, and one `is-active` cannot tell that apart from one that is fine. `systemctl restart` does not increment it; only a death does |
| the listener is *ours* | a `LISTEN` socket on the port whose pid is in the unit's cgroup |
| HTTP | `GET /` is 200 |
| the bundle is the built one | the `index-*.js` in the served `/` equals the one in `dist/index.html` |
| the Overseer still holds its claim | `overseer status`, before and after, once the daemon has re-collected |

**Why the cgroup check and not just a 200.** Curling a port cannot tell two servers apart: on
2026-09-08 a peer's dev server answered 200 on a port a different agent thought was its own and
sixteen screenshots were taken of the wrong build. A `LISTEN` on 8787 answering 200 is evidence that
*something* is up, and no evidence at all that it is this unit. The cgroup is what makes the claim
honest, and if the cgroup cannot be read the verdict is `unknown` rather than a pass.

**Why `dist/index.html` and not the newest file by mtime.** The prototype compared the served bundle
against `ls -t assets/index-*.js | head -1`, which is a guess about which file the build meant. The
built `index.html` is the build's own answer, so the two sides of the comparison are the build's
statement and what is being served.

**The Overseer claim check waits, because a fresh dashboard is legitimately unreadable for a tick.**
The accidental run above produced a red `FAIL — the Overseer held a claim before and does not now`
seconds after a restart that had gone perfectly: the claim is the *daemon's* folded view of its own
polls, so until it has polled the new process once it honestly says `Overseer unknown — the dashboard
has never completed a collection`. Reading that transient as a loss made the check's loudest output
its least trustworthy. It now polls for up to 60s for the daemon's next collection, and a
`cannot-tell` that never settles is `unknown` — still blocking, because a daemon permanently unable to
see the dashboard is what a genuinely bad restart looks like.

**The exit contract.** `0` all clear; `2` a precondition refused; `3` the restart command itself
failed; `4` restarted but a verification failed **or is unknown**; `1` anything unexpected. *A check
that could not run is never a pass* — `unknown` exits non-zero, and the report says which check and
why.

**No default mode, and the dangerous word is `restart`, not `go`.** Both are scar tissue from this
file's own first hour, and it is worth writing down rather than tidying away: the author ran
`npm run fleet:restart go` to find out whether npm forwards an argument without `--`, it does, and
that restarted the live dashboard he had been told not to touch. Nothing was lost — the script's own
precondition had read the steering queue and printed `empty` a second earlier, and the dashboard came
back on HTTP 200 with the newer bundle — but the lesson stands twice over:

- **`go` is a word you type while thinking about something else.** `restart` is not. The Overseer's
  reading of the same event, 2026-09-09: *"a script whose only argument is the dangerous one wants a
  confirmation shape, not a bare word"*.
- **`npm run <script> <word>` forwards `<word>` without needing `--`**, which is exactly the thing
  that was being tested. So a bare `npm run fleet:restart` prints the help and exits non-zero: a
  default mode would have made the same accident possible with no word at all.

### The composition root, and why the tests are not all fakes

The script splits into a pure planner + interpreter (`scripts/fleet-restart-plan.ts`, no I/O) and a
thin executor that runs `execFileSync`/`fetch` and holds no logic. Almost every test drives the
planner with recorded command output. But injected fakes cannot see whether the real things are
wired together — two guards on this repo have had imaginary coverage that way — so one test
**mutates the composition root**: it builds the real executor with a `record` mode that captures argv
without running it, and asserts the actual commands are `systemctl show …`, `sudo -n systemctl
restart fleet-dashboard`, and no others.

One more cheap drift guard: a test reads `tools/fleet/server.ts` and fails if the port default there
stops matching the constant here.

## Stages

### Stage 1 — the script and its tests

- [x] `scripts/fleet-restart-plan.ts` — types, verdicts, the parsers, the report renderer
- [x] `scripts/fleet-restart.ts` — the executor and the CLI
- [x] `tests/a-restart-that-could-not-check-itself.test.ts` — red first for each refusal
- [x] `package.json`: `fleet:restart`
- [x] `npm test`, `npm run typecheck`, lint the touched files
- [x] GPT Sol review of the code + raw test output

Status: written and green (88 tests in `tests/a-restart-that-could-not-check-itself.test.ts`), typecheck
and lint clean. Two rounds of GPT Sol review, on the plan and then on the code, both applied — see
§ "What Sol changed".

### Stage 2 — the classifier experiment

Ask the Overseer (`SendMessage` to `Overseer`) to run, in this order, and report the **exact**
outcome of each — allowed, or refused with the classifier's reason:

1. `npx tsx scripts/fleet-restart.ts check` — the control. Read-only, no `sudo` anywhere in it.
2. `npx tsx scripts/fleet-restart.ts restart` — the real question. `sudo` is inside the script.
3. `npm run fleet:restart restart` — the same work behind a different command text.

At most three shapes, and **none of them disguises what it does**: the goal is a command whose text
honestly says it restarts a service and is still accepted. If all three are refused, the finding is
written up for Greg with the options that remain.

- [ ] pushed to `dev`
- [ ] **`git -C /home/greg/code/spideryarn2 merge origin/dev` in the primary, and its HEAD checked.**
      A push updates `origin/dev`, not the primary checkout — and the script's own `not behind` check
      would then refuse, or worse, an older copy of the script would run and be recorded as classifier
      evidence. Sol found this; it is the step that makes the experiment about the classifier rather
      than about a stale file.
- [ ] shape 1 run, outcome recorded below
- [ ] shape 2 run, outcome recorded below
- [ ] shape 3 run, outcome recorded below

### Stage 3 — write down what happened

- [ ] the results table below, filled in
- [ ] if all three refused: a paragraph for Greg naming the remaining options. **A scoped sudoers rule
      is not one of them** — Greg already has `NOPASSWD:ALL`, so narrowing that grant is hardening,
      not a fix for a classifier that refuses the visible command (Sol). What is left:
      a root-owned single-purpose helper (a genuinely different command shape, and `infra/`, so
      Greg's), a `systemctl --user` unit for the dashboard, or a route on the dashboard behind the
      acting gate that restarts the service on request — which has the pleasing property that the
      steering queue could be drained by the same call
- [ ] the finding folded into `docs/project/overseer.md` § Steering, if there is one to fold

## Results of the classifier experiment

Three facts per row, kept apart on purpose — *"allowed" can merely mean the script ran and refused a
precondition*, and an exit code says nothing about whether the classifier let the command through
(GPT Sol, 2026-09-09).

| # | session | command | classifier | exit code | restart observed? |
|---|---|---|---|---|---|
| 0 | `restart-script` (mine) | `npm run fleet:restart go` | **allowed** | 4 (a false-alarm claim check) | **yes** — see the accident below |
| 0b | `restart-script` (mine) | `npx tsx scripts/fleet-restart.ts check` | **refused** | — | no |
| 0c | `restart-script` (mine) | `systemctl is-active fleet-dashboard` | **refused** | — | no |
| 1 | `Overseer` | `npx tsx scripts/fleet-restart.ts check` | | | |
| 2 | `Overseer` | `npx tsx scripts/fleet-restart.ts restart` | | | |
| 3 | `Overseer` | `npm run fleet:restart restart` | | | |

**Rows 0–0c are already a result, and they complicate the hypothesis.** A `npm run` line carrying the
restart word was allowed and a read-only `npx tsx …ts check` was refused *minutes later in the same
session*, along with a bare `systemctl is-active`. So the classifier is not judging the literal string
`sudo systemctl restart` and nothing else; something about the session's recent history moves it too.
That is a confound the stage 2 rows have to be read against — the Overseer's session has its own
history, and a refusal there is not necessarily about the command text either. Say which, if it can
be told apart.

## What is not mine

`infra/` and the systemd units, `tools/fleet/**`, `tools/overseer/**`, `scripts/gjd-remote*.ts`. If
the answer turns out to be a sudoers rule, it goes in this file as a before/after for Greg, not into
`infra/`.

## What Sol changed

GPT Sol reviewed the plan (`gpt-5.6-sol`, high effort, 2026-09-09 07:11 UTC) and opened with *"Do not
ship this plan as written. The safety story has three P0 holes."* It was right about most of them.
Every finding, and what happened to it:

| # | finding | verdict |
|---|---|---|
| P0 | **Quarantine holds ignored.** A `QueueView` is on the wire when it has items **or** a hold, and the commonest hold has no items — so counting `items` reads "nothing queued" over a session nothing may be sent to, and a restart erases the hold | **taken.** `summariseQueues` reads holds, `judgeQueue` blocks on them, and a wire with no `quarantine` field at all is `unknown` |
| P0 | **`--discard-queue` turned an unreadable queue into permission.** The authority is *"once you have read the steering queue"* | **taken, reversing my own design.** The override covers known items only; an unread queue on a live service stays blocking |
| P0 | **"Not behind" is not "at origin/dev".** On a feature branch containing dev, and on a local dev two commits ahead, the count is zero | **taken.** Split into three honestly-named checks: `on dev`, `not behind dev`, `fleet files clean` |
| P0 | **`git fetch origin dev` may not update `origin/dev`.** With a changed refspec it writes only `FETCH_HEAD`, and the comparison is against a stale ref | **taken.** Everything compares against `FETCH_HEAD` |
| P0 | **The postflight could combine two servers.** The unit binds loopback *and* a tailnet address; a stranger on 127.0.0.1 with the unit on the tailnet passes both ownership and HTTP, describing different processes | **taken.** Ownership is proven for the loopback socket specifically — the one the HTTP check asks |
| P0 | **One healthy instant precedes a crash-loop.** `Type=simple` is active when ExecStart forks; it can bind loopback, answer 200, fail its second bind and die, and be restarted ten seconds later | **taken.** A 12s stability window (past `RestartSec=10`) requiring the same pid and no `NRestarts` growth, baselined *after* the restart because manual activation can reset the counter |
| P0 | **The queue check is a snapshot, not a barrier.** Something can enqueue between the read and the restart | **partly taken, and the rest is not mine.** The read moved to be the last thing before the `sudo`, shrinking the window from seconds (a network `git fetch`, a `tsx` start) to milliseconds. Closing it needs an atomic quiesce in `tools/fleet/` — see *Follow-up* below |
| P1 | `failed` is not terminal under `Restart=always`; polling must not stop on it | **taken.** Only a healthy sample or the deadline ends the loop |
| P1 | `activating`/`deactivating`/`reloading` must not be classified as dead | **taken.** Only `inactive` and `failed` skip the queue read |
| P1 | A dead unit with a foreign process on the port must refuse before restarting | **taken.** `judgePortIsFree` is a precondition, and it also catches a leftover process of our own |
| P1 | Exit 3 returned immediately, leaving the operator blind | **taken.** The postflight runs either way; the command's outcome and the service's outcome are reported as two facts |
| P1 | The claim check passed `Overseer: Alice` → `Overseer: Bob` | **taken.** The exact line must match |
| P1 | The recorder test is still an injected fake — it cannot show the CLI picks the real executor | **taken.** A subprocess block runs the real file for `--help`, no-mode and a bad argument; the claim about the restart path is narrowed in the comment |
| P1 | The bundle precondition would refuse a fresh checkout | **already true of the code** — the precondition is the *path*, not the file, because `ExecStartPre` builds it |
| P1 | The npm contract is inconsistent, and bare `npm run fleet:restart` does not do what the plan said | **taken, the other way.** There is no default mode at all, for the reason in § *No default mode* |
| P1 | *"Pushed to dev so the primary has it"* is false — a push does not update the primary checkout | **taken**, and it is a real trap: the script's own `not behind` check would then refuse. Stage 2 has a merge step |
| P1 | A sudoers rule is not a remaining option — Greg already has `NOPASSWD:ALL` | **taken.** The options list below is rewritten |
| P1 | The classifier experiment conflates operational success with causal evidence | **taken.** The results table records disposition, exit code and whether a restart was observed, separately |
| P2 | Failure reporting needs systemd's own evidence | **taken.** `Result` and `ExecMainStatus` are reported on every postflight, judged by nothing |
| P2 | The plan pointed at a *"What Sol changed"* section that did not exist | **taken** — you are reading it |
| P1 | "All clear" is misleading for a dead-but-restartable service | **taken.** `check` says so explicitly when the service is down |
| — | Require a completely clean tree | **not taken.** This primary is shared by a dozen agents and is never clean; a blanket rule would refuse every time. The line is drawn at blast radius instead — `ExecStartPre` runs `build:fleet`, so uncommitted work under `tools/fleet/` blocks and everything else does not |

### Round two, on the code

Sol reviewed the built code (2026-09-09 07:44 UTC) and opened with *"The code is not ready for the
live classifier experiment… one still-open P0 and five P1 paths, including two ways to print `all
clear` without completing the claimed verification."* It confirmed the round-one fixes had landed and
then found six more. All taken:

| # | finding | what changed |
|---|---|---|
| P1 | **A failed final `systemctl show` became a passing stability check.** The command's exit status was discarded, so `after` stayed at the first sample and `judgeStable(200,0,200,0)` passed on an observation that never happened — with everything else green, exit 0 | every judgment that reads the unit goes `unknown` when the final read fails, and the `systemd says` line stamps itself as stale rather than sounding current |
| P1 | **The same defect in `ss`**, both before and after: a non-zero `ss` with partial stdout could prove ownership, and a *failed, empty* preflight `ss` was converted into "nothing else holds the port" — a refusal turned into a pass by a command that did not run | `readListeners` returns null on non-zero, and both callers say `unknown` |
| P1 | **A crash during the claim wait escaped the stability window.** systemd and HTTP were sampled, then up to 60s of waiting for the Overseer daemon, then `ss` — so the process could die and be replaced in between, and ownership would describe the new pid while every other judgment described the old one. All passing. The same "two servers" class the window was added to remove | every wait now happens *before* the final sample, and the window reports the time it actually measured rather than the constant |
| P1 | **A pre-restart `cannot-tell` claim read as "no claim to lose"**, no post-reading was taken, and a claim that did exist could be lost at exit 0 — contradicting the rule beside it | `cannot-tell` before is `unknown`, and blocks |
| P1 | **The loopback fix still permitted the two-server pass**, one layer in: grouping `127.0.0.1` with `[::1]` and passing if *any* was ours let the unit's IPv6 socket satisfy ownership while a stranger on IPv4 answered the HTTP | `127.0.0.1` exactly, and *every* owner of it must be ours |
| P1 | **"Fleet files clean" did not cover what `build:fleet` builds**, and the plan's rationale for it was factually wrong | widened to `FLEET_BUILD_INPUTS` (`tools/fleet`, `vite.fleet.config.ts`, `package.json`, `package-lock.json`), switched from `diff --name-only` to `status --porcelain` so untracked files count, and dirty `src/` files are reported unjudged with the closure named as unresolved |
| P2 | `quarantine: false` fell through the object test and counted as no hold | object-or-null, anything else is `unknown` |
| P2 | The envelope was unvalidated, so an error-shaped 200 carrying `queues: []` read as an empty queue | `ok === true && op === "catalogue"` required |
| P2 | `bundleRef` matched the first `index-*.js` **anywhere**, so a comment naming the new bundle passed while a script tag loaded the old one | matches a `src=` attribute, and two distinct references are `unknown` rather than a coin toss |
| P2 | An absent `MainPID` became 0, so `judgeReplaced(0, new)` could pass with no before-reading; `parseCgroupProcs` returned the pids it could parse from a damaged file; `parseEnvironment` mis-split a whole-assignment-quoted `"FLEET_PORT=9999"` into the key `"FLEET_PORT`, silently falling back to 8787 | absent `MainPID` refuses; `parseCgroupProcs` returns null; `parseEnvironment` unquotes the assignment first |
| P0 | **The queue race is still open** | narrowed as far as is possible from outside: a *second* read, as the last act before the `sudo`, refusing if anything arrived. The residual window is microseconds and is stated in the code rather than implied |

**And Sol was right about the tests**: *"the tests miss every failure above"*. Each fix above carries
a case that fails without it. One of them was found by the mutation pass rather than by writing it:
the first version of the failed-`show` test asserted only the stability line, and a deliberate
mutation showed `active`, `process replaced` and `not crash-looping` could all go on reporting the
stale sample with the suite still green. That test now checks all four.

**Follow-up for whoever owns `tools/fleet/`** (not this stage, and not this agent's files): the only
way to close the queue race properly is an atomic quiesce — one call that stops accepting new
steering, returns the complete state, and lets the caller restart knowing nothing arrived in between.
Everything a restarter can do from outside only narrows the window.

## The accidental restart, 2026-09-09 ~07:02 UTC

Recorded here rather than only in a message, because it is the source of two design decisions above
and of one bug that no test had caught.

`npm run fleet:restart go` was run from this worktree to find out whether npm forwards a bare
argument. It does, so it restarted `fleet-dashboard` for real — a thing this stage's brief explicitly
told the agent not to do. What happened, checked directly rather than inferred: HTTP 200 on `/` and
on `/api/actions`, `queues: 0`, the served bundle moved `index-CafjCvVA.js` → `index-BMgLuxOl.js`.
The steering queue was empty **before** the restart too — the script's own precondition read it and
printed `ok steering queue — empty, nothing would be discarded` — so nothing anybody had queued was
lost. Reported to the Overseer within two minutes; it verified the same state independently.

What it bought, which does not excuse it: the Overseer-claim false alarm above, the `restart` naming,
the no-default rule, and rows 0–0c of the classifier table — a real observation that no experiment
had been designed to make.

## Loose end for the Overseer

`qi-7k3vfjbn` is still **a proposal** — `overseer-queue.ts dispatched` refuses to record the dispatch
because nobody has authorised the item, and only Greg can. The work went ahead on the brief; the
queue file has no record of it.
