# Report B: box, tmux, waiting and process traps

Stage 1 of [261005k](../261005k-port-overseer-auto-memory-into-docs.md), batch B: 23 memory files.
No doc was edited. Hashes are `sha256sum`, first 12 characters, taken when each file was read on
2026-10-05.

Counts: **3 eligible, 20 retain. 11 edits (BE1–BE11), 12 proposals (BP1–BP12).** No Greg quote is
used anywhere below.

## Table

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `tmux-outlives-closed-tabs` | `e94681084d0f` | L1 (closing a tab detaches; judge a session by its transcript's last message, not tmux activity or mtime) already: `hetzner-remote-server-box.md` § tmux keeps sessions alive and does nothing else — "So closing a tab never ends `claude`". L2 (`sessions.mjs` is not in the repo; `--selftest`) edit BE1. L3 (a running `sleep`/`until` child means the session scheduled its own wake-up; a kill loses nothing, `claude --resume` brings it back) propose BP1. L4 (`idle` is not abandoned: armed `CronCreate`; the percentage is the context bar; a pane-reader's progress claim loses to `git log`) propose BP1. L5 (`waits Nh` is its own state) already: same doc § What `gjd-remote ls` is telling you — "is still counting down; Claude has not started". | retain |
| `long-waits-need-a-persistent-monitor` | `a85e129c1498` | L1 (the limits table) already: `docs/reusable/long-waits.md` § What each mechanism actually gives you — "**600 s, hard**". L2 (the ten-minute story was wrong) already: same doc § A note on the ten-minute story — "It is wrong. Four variants". L3 (CronCreate one-shot resumes this session; `at` if the machine may not last; never a foreground `sleep`) already: same doc § Choosing — "It is the only mechanism that does this". L4 (background Bash is killed under load; `killed` is no information) propose BP2. L5 (never pipe a test run through `tail`) already: `static-analysis.md` § The gate/advisory split — "Redirect rather than pipe", and `typechecking.md` § Four ways to report it clean while it is red. L6 (tell load noise from a real failure: re-run alone, then a detached worktree at the commit before yours) dropped as duplicate of `postgres-suites-fail-from-contention` L1 (BP5); the worktree half already: `testing.md` § A green run here proves less than it looks like — "reproduce in a worktree with `node_modules` symlinked". L7 (`nohup … &` survives the kill sweep) dropped: superseded, `scripts/tmux-job.ts` exists and `overseer.md` § Things that will catch you says "Long jobs need `scripts/tmux-job.ts`"; `nohup` is named in no doc. L8 (a background `sleep` does not make time pass; read `ps -o etime=`) propose BP3. L9 (the trigger is memory, not only load; arm two `CronCreate` one-shots) propose BP2. L10 (a `Monitor` survived where two Bash waiters died; a dead waiter says nothing about the job) propose BP2. | retain |
| `subagents-end-turns-while-their-jobs-run` | `b66d85928bd9` | L1 (a subagent starts a loop and ends its turn; give it work that finishes in one turn, own the wait yourself) propose BP4. L2 (`TaskStop` leaves its tmux sessions running; kill by exact name) propose BP4. | retain |
| `full-suite-needs-tmux-on-this-box` | `3f562ff6bc55` | L1 (run long commands under `tmux-job.ts`; a backgrounded run is killed and reported exit 0) already: `testing.md` § Run the suite in tmux — "is killed under load and reported as a success". L2 (no `--` before the command) already: same — "`--name` is its only flag, and there is no `--` separator". L3 (unique name, `EXIT=` last line, session ends with the command, the husks) already: same, and `hetzner-remote-server-box.md` § Sessions nobody made on purpose — "runs the command as the pane's own process so the session ends with it". L4 (logs live in `logs/tmux-jobs/`; deleting the directory orphans a run) edit BE2. L5 (the kill is the harness's own low-memory guard, on system memory) edit BE3; the bare fact already: `overseer.md` § Things that will catch you — "OOM-killed on *system* memory pressure". L6 (the waiter is killed too, and that is not the job failing) edit BE3. L7 (watch with a Monitor that fires on `EXIT=` or on the session vanishing) propose BP3. L8 (the exit code lies both ways; read the summary line) already: `static-analysis.md` § The gate/advisory split — "Read its summary line, not the exit code you were handed", and `testing.md` § A nuqs write outlives the test that started it — "every test still reported green". L9 (a `timeout` wrapper: `EXIT=124` announced as exit 0) edit BE3. L10 (`npm run check` contains the suite, so not beside `npm test`) already for the fact: `static-analysis.md` top — "a second full suite ran for half an hour, in parallel with a deliberate one"; the 2026-09-05 measurement and "end one" edit BE4. L11 (the box dies of concurrent suites, 18 at load 391) already: `testing.md` § Run the suite in tmux — "load 391, swap full, 18 suites at once". L12 (check load and memory first; stagger the retry) already: same — "a re-run straight away tends to meet the same fate", and § So a crowded machine may refuse to start a run at all, which now does the check mechanically. L13 (the admission refusal) already: `testing.md` § So a crowded machine may refuse… — "the run **stops, loudly**, saying `NO TESTS RAN`"; the `REFUSING TO START` string and the fast-red signature edit BE5. L14 ("leave the reserve file alone") dropped: the doc decides otherwise — "If a run is refused and you are certain, delete the file or set a smaller reserve" — see Doubts. | retain |
| `postgres-suites-fail-from-contention` | `916d05c26f68` | L1 (re-run each red file alone before calling it a regression) propose BP5. L2 (the signatures) already: `testing.md` § One database, many suites — "The failures do not say \"contention\". They arrive as `expected 'busy' to be 'claimed'`", and § `TEST DATABASE CONTENDED`. L3 (plan 260903e exists to remove this) dropped: built — `testing.md` § `TEST DATABASE CONTENDED` says "It should be rare now — that is what the private lane is for". L4 (re-gating after a merge is a treadmill; pick the re-run from what the merge brought in) propose BP6. | retain |
| `vitest-process-count-is-five-per-suite` | `e2646e65ad0e` | L1 (`pgrep -fa vitest` counts about five processes per suite; count suites, or read load and memory) propose BP7. L2 (a proxy invented in an incident inherits its units) propose BP7, one clause. | retain |
| `npm-run-check-runs-the-full-suite` | `4da852e0e6dd` | L1 (`check` is the whole suite and a production build, 26 minutes) already: `static-analysis.md` top — "**`npm run check` runs the whole test suite, and this line used to say `~20s`.**". L2 (the last four rows are advisory) already: same doc § What we run and § The gate/advisory split — "runs everything and fails on **gates** only". The "seven gates" count is stale: `scripts/check.ts` has nine `gate: true` entries today. L3 (commit on the fast gates and read `check`'s verdict when it lands) propose BP12. L4 ("prints nothing until it finishes") dropped: `scripts/check.ts` prints a `── <name> (gate)` header as each step starts. | retain |
| `ps-grep-counts-its-own-apparatus` | `c78e3cd870e3` | L1 (`ps … \| grep -c` counts its own wrappers and any command that names the flag; walk `/proc` and match argv elements; print what matched) propose BP8. L2 (`pkill -f` kills its wrapper shell, exit 144, and everything chained after it never runs) propose BP9; the first half already: `docs/reusable/diagnose-box-resources.md` § The traps — "`pkill -f <string>` will match your own shell". | retain |
| `polling-a-log-burns-turns-not-time` | `4e819ee4a40e` | L1 (a poll spends a turn, not time; arm one waiter and end the turn) propose BP3. | retain |
| `prove-the-relaunch-before-stopping-the-old-process` | `d4f932c2c521` | L1 (run the relaunch shape against something harmless first) already: `overseer.md` § Things that will catch you — "Prove the relaunch before you stop a process." L2 (worktree isolation is a second gate: probe the other worktree's path too) propose BP10. L3 (the way out is `ExitWorktree` with `keep`, telling the Overseer first) propose BP10. L4 (a peer cannot be asked to run the blocked half) propose BP10. | retain |
| `a-port-you-bound-may-be-a-strangers-now` | `f2870b0363eb` | L1 (a pid found by port may be a peer's; read `/proc/<pid>/cwd` before killing) propose BP11. L2 (a port changes hands) already: `browser-testing.md` § And check the port, not just the server — "And the port you were given can change hands while you work." | retain |
| `npm-run-forwards-a-bare-argument` | `64df6b07e1a5` | L1 (`npm run <script> <word>` forwards the word; `go` restarted the live dashboard) edit BE8 — the story is in Git only as the header comment of `scripts/fleet-restart.ts`, in no doc. L2 (mode words: no default mode, `restart` not `go`) already in the code it describes: `scripts/fleet-restart.ts` header — "There is no default mode"; pointed at by BE8. | retain |
| `wait-for-real-notifications` | `2fdc24b6d8a5` | L1 (do not write a notification into your own turn; arm one waiter and end the turn) propose BP3. L2 (run `date` before stating a time) propose BP3. L3 (`kill -0 <pid>` fails from the sandbox) dropped: did not reproduce — on 2026-10-05, from an agent's Bash call on the box, `kill -0` returned 0 for a child and for another of the user's processes. See Doubts. | retain |
| `grep-c-fallback-fires-immediately` | `1174cfbe1761` | L1 (`grep -c … \|\| echo 0` yields `0\n0`; use `grep -q`) propose BP3. L2 (a monitor that fires suspiciously fast gets checked by hand) propose BP3. | retain |
| `browser-subagents-kill-shared-dev-servers` | `7ddf1b9c5ef9` | L1 (never `pkill -f vite`; put the constraint in the brief) already: `browser-testing.md` § And check the port — "**Never `pkill -f vite`**" and "Put the constraint in the prompt when you dispatch browser work". L2 (a pattern cannot tell worktrees apart; an env-var prefix is not in the cmdline) edit BE9. L3 (`$!` is the npx wrapper; kill the listener, then check the port) already: same section — "which stops the npx wrapper and leaves the node child holding the port" and "kill the **listening** PID". | retain |
| `box-traps-moved-to-docs` | `2be458902b0f` | L1 dropped: about the memory system itself — a pointer to the 2026-10-01 sweep, whose mapping is `docs/plans/261001i-probes/report-W3.md` and `report-W4.md`. | eligible |
| `no-production-db-access-from-this-laptop` | `04f6e8b9b052` | L1 (`.env.prod` is on the box) already: `overseer.md` § Deploying — "The credentials are on the box", and `feedback-reports.md` — "on a machine with `.env.prod` (the box has it)". L2 (`.env.local` and the Supabase MCP point at the local stack) already: `infra/hetzner/README.md` § Why Supabase needs no credential, and what that buys — "so it cannot reach production". L3 (read inside `begin read only`, never a bare `SET`) already: `database.md` § remote connection — "**Never `SET` anything on the transaction pooler**". L4 (no `psql` on the box; a `pg` script with the committed CA; `ESSLREQUIRED`; the classifier refuses `rejectUnauthorized: false`) edit BE10. L5 (the bucket's `object/info` read, and its 400 control) edit BE10. L6 (writing is still Greg's call; a credential is not an approval) already: `AGENTS.md` § Working agreements — "Real data belongs to the reader, not to us". | retain |
| `no-vercel-credential-on-this-machine` | `cbb9b926ad4b` | L1 (the CLI is logged out, so no deploy from here) dropped: stale — `overseer.md` § Deploying says "the Vercel CLI login in `~/.local/share/com.vercel.cli/auth.json`", and that file exists on the box, dated 2026-09-29. L2 (never `git push origin main` instead) already: `AGENTS.md` — "Pushing to `main` yourself is an unreviewed deploy to real readers". L3 (`npm run deploy -- --dry-run` runs every local gate) already: `deployment.md` flags table — "every local gate, nothing external". L4 (the Vercel MCP reads production logs, including the message Sentry withholds) already: `vercel-hosting-deployment.md` § Searching the logs — "Sentry withholds that sentence on purpose". L5 (the result overflows into a file) edit BE11. L6 (in an unattended session some MCP tools are refused; a refusal is not a lost credential; same for the Supabase MCP) edit BE11. | retain |
| `no-github-cli-credential-on-this-box` | `6d1ba5afe9c1` | L1 (`gh` is installed and logged out; `git` works; the API steps are Greg's) edit BE6 — the fact is in `worktrees.md` only inside the trunk-flip history ("which has no authenticated `gh`"), not where a reader with the problem would look. Re-checked 2026-10-05: still logged out. L2 (`git remote set-head origin -a` is not a substitute) already: `version-control.md` — "the explicit form, because the `-a` spelling asks", and `worktrees.md` — "`git remote set-head origin -a` was wrong, and wrong in the direction that hides". | retain |
| `gjd-remote-runs-from-the-box-with-one-var` | `94da63f70d12` | L1 (from the box, `npx tsx scripts/gjd-remote.ts`; the address comes from `/etc/gjd-remote-host`) already: `hetzner-remote-server-box.md` § Running `gjd-remote` from the box — "There is no `gjd-remote` on the box's PATH, so the `npx tsx` form is the only one that runs". L2 (a prompt on stdin needs `--no-attach`) already: same doc § Starting a session with a prompt — "you get told to use `--no-attach` and `resume`, rather than a hang". L3 (why the old note was wrong: `/etc/profile.d/`) already: same doc — "It was an export in `/etc/profile.d/` until 2026-09-05, and that was wrong for every agent". L4 (it supersedes two earlier notes) dropped: about the memory system. | eligible |
| `write-tool-refuses-paths-outside-the-repo` | `d9421850ae90` | L1 (`Write` refuses a path outside the working directory, finally so in an unattended session; a quoted Bash heredoc works) edit BE7. | retain |
| `codex-usage-limits-are-free-to-read` | `a98106c2c38c` | L1 (`account/rateLimits/read` on the app-server, no model call, live) already: `usage-history.md` § The Codex subscription reading — "Every observation is a real fetch from the service, not a locally cached value". L2 (`primary`/`secondary` are positions) already: same — "are positions, not window names". L3 (`window_minutes` against `windowDurationMins`) already: `tests/fixtures/codex-usage/README.md` — "the session log writes snake_case with `window_minutes`", and `docs/reusable/codex-subscriptions.md` § Knowing what each account has left. L4 (the handshake, 1.9 s and 117 MB, `codex doctor` hangs) already: `docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md` — "**`initialize` requires `clientInfo`**", "**117 MB peak RSS**", "**Dead end: `codex doctor`.**". | eligible |
| `taskoutput-on-a-running-agent-dumps-its-transcript` | `b217bfe07385` | L1 (`TaskOutput` on an unfinished subagent returns its raw transcript; wait for the notification) propose BP4. | retain |

## Edits

Facts and traps, each for the one doc that owns the subject. BE6, BE7 and BE8 share an anchor and go
in that order.

### BE1 — `docs/project/hetzner-remote-server-box.md` § tmux keeps sessions alive and does nothing else

**Anchor** (insert directly after, as a continuation of the same bullet):

```
  activity time or the file's mtime, both of which move on idle sessions.
```

**Text**

```
  The script is not in this repo and nothing under `infra/hetzner/` installs it: `~/gjd-remote` on
  the box is a drop directory, so it survives a rebuild only because `/home` does. `--selftest`
  checks its classifier.
```

Carries: `tmux-outlives-closed-tabs` L2. (The memory also says the source is on Greg's laptop; that
is not checkable from the box and is left out.)

### BE2 — `docs/project/testing.md` § Run the suite in tmux, because a killed run and a passing run look the same

**Anchor** (insert a new paragraph directly after):

```
minutes — `npm run typecheck`, an eval, a codex review.
```

**Text**

```

The logs are in `logs/tmux-jobs/`, which is gitignored. Deleting that directory while a job is still
writing to it orphans the run, and nothing says so (2026-09-05).
```

Carries: `full-suite-needs-tmux-on-this-box` L4.

### BE3 — `docs/project/testing.md`, same section

**Anchor** (insert two new paragraphs directly after):

```
tends to meet the same fate.
```

**Text**

```

**Whatever is watching the job gets killed too, and that says nothing about the job.** The harness
stops background Bash tasks with *"stopped because the system is running low on memory"*. That is
its own guard, not the kernel's (`dmesg` showed no kills on 2026-09-05), and it picks by system
pressure rather than by size: six `until grep -q EXIT= …; do sleep 60; done` loops of a few KB each
were stopped in a row that day while the tmux job they watched carried on. The job's log, and
whether its tmux session still exists, are the only evidence about the job.

**A `timeout` in front of the command is one more way to be told it passed.** On 2026-09-06 a
`timeout 400 npm run check … | tail` was killed at its deadline — the output held `Terminated` and
`EXIT=124` — and the harness announced *"completed (exit code 0)"*, which is the pipeline's status.
A deadline that feels generous is still far shorter than `check`.
```

Carries: `full-suite-needs-tmux-on-this-box` L5, L6, L9.

### BE4 — `docs/project/static-analysis.md`, the note under the command list

**Anchor** (insert a new paragraph directly after the paragraph that ends with this line):

```
*system* memory pressure here. `--fast` skips the build but **not** the suite.
```

**Text**

```

Started beside an `npm test` it is two full suites. On 2026-09-05 both ran in tmux at once: each
took over half an hour, available memory fell to 6 GB of 30, and six waiters were OOM-killed in one
burst. Ending the `check` session let the suite finish in minutes.
```

Carries: `full-suite-needs-tmux-on-this-box` L10.

### BE5 — `docs/project/testing.md` § So a crowded machine may refuse to start a run at all

**Anchor** (insert a new paragraph directly after):

```
and you are certain, delete the file or set a smaller reserve.
```

**Text**

```

The message begins `REFUSING TO START`. Inside `npm run check` it arrives as `✗ test FAILED` and
`EXIT=1` after about three minutes rather than twenty-five (measured 2026-09-08), so a check that
went red that fast is usually this and not the change: grep the log for the string before reading
the red.
```

Carries: `full-suite-needs-tmux-on-this-box` L13. The string was checked in `vitest-admission.ts`.

### BE6 — `docs/project/hetzner-remote-server-box.md` § Traps

**Anchor** (insert a new bullet directly after; BE6 first, then BE7, then BE8):

```
  else large and disposable belongs on `/` too.
```

**Text**

```
- **`gh` is installed and not logged in.** `gh auth status` answers *"You are not logged into any
  GitHub hosts"* and `GH_TOKEN` is unset (2026-09-02, unchanged 2026-10-05). `git` push and fetch to
  `origin` work, so the gap is only the GitHub API: the default branch, pull requests, repository
  settings, Actions. Those are done from Greg's Mac.
```

Carries: `no-github-cli-credential-on-this-box` L1.

### BE7 — `docs/project/hetzner-remote-server-box.md` § Traps

**Anchor**: directly after BE6's bullet.

**Text**

```
- **The `Write` tool refuses a path outside the session's working directories.** `/tmp/foo.txt`
  comes back as *"Path is outside allowed working directories"*, and in an unattended session that
  refusal is final, because it counts as a permission request nobody can answer (2026-09-22). Bash
  has no such limit: a quoted heredoc (`cat > /tmp/foo.txt <<'EOF'`) writes the file and keeps
  backticks and `$` literal.
```

Carries: `write-tool-refuses-paths-outside-the-repo` L1.

### BE8 — `docs/project/hetzner-remote-server-box.md` § Traps

**Anchor**: directly after BE7's bullet.

**Text**

```
- **`npm run <script> <word>` passes the word to the script, with no `--`** (npm 11). On 2026-09-09
  `npm run fleet:restart go`, typed to find out whether npm forwards a bare argument, restarted the
  live fleet dashboard. The header of [`scripts/fleet-restart.ts`](../../scripts/fleet-restart.ts)
  has the story, and it is why that script has no default mode.
```

Carries: `npm-run-forwards-a-bare-argument` L1, L2.

### BE9 — `docs/project/browser-testing.md` § And check the port, not just the server

**Anchor** (insert a new paragraph directly after):

```
symptom is a stale bundle hash, which reads as a cache problem.
```

**Text**

```

A pattern cannot tell one worktree's server from another's, because each spells the path the same
relative way: on 2026-09-08 a `kill` of pids matched by `ps | grep "[t]sx tools/fleet/server.ts"`
took two belonging to another session. And an environment-variable prefix is not in the command
line at all, so `pkill -f FLEET_PORT=8791` matches nothing and leaves the server running.
```

Carries: `browser-subagents-kill-shared-dev-servers` L2.

### BE10 — `docs/project/database.md`, the remote-connection section

**Anchor** (insert a new paragraph directly after):

```
same query via 5432 says `off`; `reset default_transaction_read_only` via 6543 clears it.
```

**Text**

```

**There is no `psql` on the box.** A production read from there is a small node script: `pg`
imported by absolute path from a tree's `node_modules`, the committed CA passed as `ssl: { ca }`,
and every query inside `begin read only` … `rollback`. Without `ssl` the pooler answers
`ESSLREQUIRED`. The auto-mode classifier refuses `rejectUnauthorized: false` as TLS weakening, and
on 2026-09-30 a session that reached for it lost the lookup. The source bucket can be read with
`GET /storage/v1/object/info/sources/sha256/<hash>.<ext>`; a made-up hash answers 400, which is the
control.
```

Carries: `no-production-db-access-from-this-laptop` L4, L5. `which psql` was empty on 2026-10-05.
The bucket path was not exercised (it would mean a production request); see Doubts.

### BE11 — `docs/project/vercel-hosting-deployment.md` § Searching the logs, which is where handled failures actually are

**Anchor** (insert two new bullets directly after):

```
  store. One day of retention, then it is gone.
```

**Text**

```
- **The result usually overflows the tool limit and is written to a file.** Grep that file rather
  than reading it.
- **An unattended session may be refused the call while the credential is fine.** Measured
  2026-09-20 and 2026-09-21 in the feedback sweep: `list_teams` answered, and `list_projects` and
  `get_runtime_logs` were each refused with *"requires approval, and this session has no approval
  surface"*. Some tools are pre-approved and these are not, so a refusal there is a permission
  answer and not a lost login. The Supabase MCP was refused the same way on 2026-09-19.
```

Carries: `no-vercel-credential-on-this-machine` L5, L6.

## Proposals

Each adds or changes what an agent is told to do, or sits in `docs/reusable/`.

### BP1 — `docs/project/overseer.md` § Things that will catch you

**Before**: new, after the bullet that ends

```
  found one of twenty-three, because decisions end in full stops.
```

**After**

```
- **`idle` is not abandoned either.** Measured 2026-09-06 across sixteen sessions: most `idle` ones
  had armed a `CronCreate` one-shot hours ahead and stopped on purpose. Before calling a session
  stuck or finished, `tmux capture-pane` and look for a `CronCreate` near the tail, and check for a
  running `sleep` or `until` child: a session that scheduled its own wake-up is not to be killed.
  The percentage in its status line is the context bar, not progress — "7%" was once reported as
  "stage 1 not yet coded" on a branch eight commits deep — so take `git log origin/dev..<branch>`
  and the plan doc's status line over any reading of the pane. Killing a finished session loses
  nothing: its edits are on disk and `claude --resume <session-id>` brings the conversation back.
```

Why here: it is the Overseer's judgement about which sessions to end, and the 2026-10-01 sweep left
it for this doc. Carries: `tmux-outlives-closed-tabs` L3, L4.

### BP2 — `docs/reusable/long-waits.md` § Choosing

**Before**: new section, after the paragraph that ends

```
explanation when somebody reports a long wait "cancelled after about ten minutes".
```

**After**

```

## On a loaded machine, the waiter dies before the job

"No cap found" in the table is true of a quiet machine. On a box shared by many agents the harness
stops background Bash tasks when the *system* is short of memory, whoever is using it: on 2026-09-03
five background runs in a row were reported `status: killed` with nothing written, and on
2026-09-05 a waiter that was only a sleeping shell was stopped at 63 minutes, launched at a load of
17.7 with 9 GB free. So checking `uptime` and `free -g` first is necessary and not sufficient.

- **`killed` is no information about the thing you were running.** Read the job's own log.
- **Run the job itself somewhere the harness does not own** — a tmux session — and treat the waiter
  as disposable.
- **For "resume this conversation in N hours", arm two `CronCreate` one-shots a few minutes apart**
  rather than one plus a `Monitor`. A one-shot is scheduled inside the Claude process, so there is
  no child to kill.
- **A `Monitor` is hardier than background Bash, not immune.** On 2026-09-08, with 7 GB available,
  two Bash waiters were killed within minutes while a `Monitor` on the same condition delivered its
  event. When a Bash waiter dies, check the `Monitor` before assuming it went too.
```

Why here: this doc's table and its "pair it with a `Monitor`" advice are what the measurements
correct. Carries: `long-waits-need-a-persistent-monitor` L4, L9, L10.

### BP3 — `docs/reusable/long-waits.md`

**Before**: new section, directly after BP2's (or after the same anchor line if BP2 is declined).

**After**

```

## While you wait

- **Arm one waiter, then end the turn.** A poll does not advance time, it spends a turn: on
  2026-09-08 over a hundred turns of `grep EXIT= <log>` went by while the clock moved about seven
  minutes. For a tmux job, one `Monitor` that fires on the log's `EXIT=` line or on the session
  vanishing is enough.
- **A background `sleep` does not make time pass for you.** `run_in_background` returns at once, so
  several of them run side by side while you carry on. Read `ps -o etime=` on the job's pid, or run
  `date`, before saying how long anything has taken or what time it is.
- **A notification is something that arrives, never something you write.** On 2026-09-30 an agent
  waiting on a review wrote completion notices into its own turns and then acted on them. Real ones
  come as system turns.
- **In a poll loop use `grep -q`, never `grep -c PATTERN file || echo 0`.** With no matches
  `grep -c` prints `0` and exits 1, so the fallback runs too, the value is two lines, and a test
  against `"0"` is true at once. On 2026-09-07 that announced two running jobs as done within
  seconds. A waiter that fires suspiciously fast gets its condition checked by hand.
```

Why here: the doc says which mechanism to pick and nothing about how to behave once it is armed.
Carries: `polling-a-log-burns-turns-not-time` L1; `long-waits-need-a-persistent-monitor` L8;
`full-suite-needs-tmux-on-this-box` L7; `wait-for-real-notifications` L1, L2;
`grep-c-fallback-fires-immediately` L1, L2.

### BP4 — `docs/reusable/engineering-manager.md` § Delegate

**Before**: new paragraphs, after

```
Run them in parallel only when their file sets don't overlap.
```

**After**

```

**Give a subagent work that finishes inside one turn, and own the long waits yourself.** A subagent
told to run a long loop starts it and ends its turn with "I'll wait for that to complete",
reporting nothing: the harness counts it finished because a tmux job it spawned is not a child it
tracks. Resuming it repeats the pattern — on 2026-09-06 three did this and one spent 152k tokens on
idle re-checks. Ask for the instrument and a bounded measurement, tell it to block in the foreground
rather than background anything, and read its artefacts yourself. Stopping such an agent leaves its
tmux sessions running: list them and end each by exact name.

**Do not read a subagent's output before its completion notice arrives.** On an agent still running,
`TaskOutput` returns the tail of its raw transcript, every tool call and diff included — about 18k
tokens for one call on a busy agent. After it finishes the same call returns the report. To watch
progress meanwhile, poll something cheap and external: a file it is due to write, or
`git status --short`.
```

Why here: § Delegate is where a brief's shape is decided. Carries:
`subagents-end-turns-while-their-jobs-run` L1, L2;
`taskoutput-on-a-running-agent-dumps-its-transcript` L1.

### BP5 — `docs/project/testing.md` § A test that spawns a process needs its own timeout

**Before**: new paragraph, after the line

```
[260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.2.
```

**After**

```

**So re-run each red file alone before calling any of them a regression.** A file that passes alone
was the box; one that fails alone is yours. On 2026-09-03 three full runs produced 22, 2 and 2
failures and all but three assertions passed in isolation — and those three were real, hiding in a
batch of twenty.
```

Why here: the paragraph above it tells the same story and stops short of saying what to do.
Carries: `postgres-suites-fail-from-contention` L1 (and `long-waits-need-a-persistent-monitor` L6).

### BP6 — `docs/project/testing.md` § A scoped run answers a smaller question than it looks like

**Before**: new bullet, after the bullet that ends

```
  drive a route.
```

**After**

```
- **After merging `dev`, choose the re-run from what the merge brought in, not from what your change
  is about.** `git diff --name-only HEAD...origin/dev` first; then typecheck and the suites those
  files touch. A full gate after every merge reports on a tree that has already gone: on 2026-09-08
  `dev` gained 74 commits in 55 minutes, two full re-gates went red, and neither red belonged to the
  change being gated. Keep the full gate for the tree you push.
```

Why here: it is a rule about which scoped run to choose. It also bears on `AGENTS.md` § Before you
call it finished, which this does not change. Carries: `postgres-suites-fail-from-contention` L4.

### BP7 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**: new paragraph, after the paragraph that ends

```
tooling. `pgrep -x` matches the executable name; `-f` is for when you genuinely mean the arguments.
```

**After**

```

**`pgrep -fa vitest | wc -l` counts about five processes per suite.** One `npx vitest run` is the
shell wrapper, `npm exec`, `sh -c`, the `.bin/vitest` node and its worker. On 2026-09-08, 24
processes were about five single-file runs on a box with load 13 and 13 GB free, and a threshold of
"eight vitest processes" written after that morning's overload would have blocked a healthy gate.
Count suites — `pgrep -fa "vitest run" | grep -c "\.bin/vitest"` — or read load and available
memory, which measure the thing itself. A threshold invented during an incident inherits that
incident's units.
```

Why here: it is the process-counting trap this section collects; the 2026-10-01 sweep proposed the
same (its P3/K3), not yet landed. Carries: `vitest-process-count-is-five-per-suite` L1, L2.

### BP8 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**: new paragraph, directly after BP7's (or after the same anchor line).

**After**

```

**`ps -eo args | grep -c <flag>` counts its own apparatus.** On 2026-09-08 it answered 3 for a flag
no process was using: the two `bash -c` wrappers whose argv carried the whole pipeline, and the
grep itself. Under an agent harness any flag merely *named* in a command becomes a phantom, because
the tool shell puts the entire command line into argv. Walk `/proc` instead: read each
`/proc/<pid>/cmdline`, split on NUL, and match argv *elements*; report how many entries were scanned
and how many were unreadable, so a permission failure cannot read as zero. And print what matched,
not just the count, before quoting it to anybody.
```

Why here: same section, same family. Carries: `ps-grep-counts-its-own-apparatus` L1.

### BP9 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**

```
**`pkill -f <string>` will match your own shell.** Your command line contains the string you are
searching for, so the shell running `pkill` kills itself, and the exit code looks like a failure of
the thing you meant to kill. Kill by PID, or filter out `$$`.
```

**After**

```
**`pkill -f <string>` will match your own shell.** Your command line contains the string you are
searching for, so the shell running `pkill` kills itself, and the exit code looks like a failure of
the thing you meant to kill. Kill by PID, or filter out `$$`. Anything chained after it with `&&` or
`;` then never runs: on 2026-09-08 a `pkill -f … && <restart>` returned 144 twice, and the second
time it looked as though the restart had worked, because the old process was gone and the new one
had never started. Run it alone in its own call and confirm with a separate `pgrep`.
```

Why here: it completes the paragraph with the consequence that cost the time. Carries:
`ps-grep-counts-its-own-apparatus` L2.

### BP10 — `docs/project/overseer.md` § Things that will catch you

**Before**

```
- **Prove the relaunch before you stop a process.** The classifier judges each command alone: it
  allowed `kill -TERM` of the daemon and refused every relaunch, and the daemon was down eleven
  minutes on 2026-09-08 until Greg typed it. Run the exact relaunch shape against something harmless
  first; if that is refused, leave the old one running and hand Greg both halves as one command pair.
```

**After**

```
- **Prove the relaunch before you stop a process.** The classifier judges each command alone: it
  allowed `kill -TERM` of the daemon and refused every relaunch, and the daemon was down eleven
  minutes on 2026-09-08 until Greg typed it. Run the exact relaunch shape against something harmless
  first; if that is refused, leave the old one running and hand Greg both halves as one command pair.
  Worktree isolation is a second gate of the same shape: on 2026-09-09 a session in a worktree was
  allowed to stop the readiness loop and refused every way of starting it, because the launch runs
  git in another worktree. So probe the real path, not only the command's shape. Do not ask a peer
  to run the half you were refused. The way out of an isolation refusal is `ExitWorktree` with
  `action: "keep"`, which returns the session to the primary, where restarting a service is an
  ordinary operation; say so to the Overseer before doing it.
```

Why here: it extends the existing rule with its second mechanism and adds a permission. Carries:
`prove-the-relaunch-before-stopping-the-old-process` L2, L3, L4.

### BP11 — `docs/project/browser-testing.md` § And check the port, not just the server

**Before**

```
So: kill the **listening** PID (`lsof -ti :PORT`, or find the `vite` child), then check the port is
actually free before starting another. And prove *which code* is being served before you trust a
```

**After**

```
So: kill the **listening** PID (`lsof -ti :PORT`, or find the `vite` child), then check the port is
actually free before starting another. **Before killing a pid you found by port, read
`/proc/<pid>/cwd` and confirm it is your own tree**: on 2026-09-08 a session's own server was
already gone and the listener on its port was a peer's dev server, bound in the gap. And prove
*which code* is being served before you trust a
```

Why here: the sentence it amends is the one that sends a reader to kill by port. Carries:
`a-port-you-bound-may-be-a-strangers-now` L1.

### BP12 — `docs/project/static-analysis.md`, the note under the command list

**Before**

```
working. `npm run check` is the pre-commit gate, and you should expect to wait — run it under
[`scripts/tmux-job.ts`](../../scripts/tmux-job.ts), because a backgrounded process is OOM-killed on
*system* memory pressure here. `--fast` skips the build but **not** the suite.
```

**After**

```
working. `npm run check` is the pre-commit gate, and you should expect to wait — run it under
[`scripts/tmux-job.ts`](../../scripts/tmux-job.ts), because a backgrounded process is OOM-killed on
*system* memory pressure here. `--fast` skips the build but **not** the suite. Start it early rather
than waiting on it in series: commit on the fast gates — `npm run typecheck`, the suites you
touched, and `npx vitest run tests/doc-links.test.ts` after any doc edit — and read `check`'s
verdict when it lands.
```

Why here: it is where the cost of `check` is stated. **It loosens `AGENTS.md`'s "`npm run check`
before you commit"**, so it is Greg's to decide, and if he takes it AGENTS.md wants the matching
line. Carries: `npm-run-check-runs-the-full-suite` L3. (BE4's paragraph follows this one whichever
lands first; BE4's anchor is the last line of this Before block.)

## Quotes, and doubts

**Quotes.** None. No edit or proposal above quotes or paraphrases Greg. The only mention of him in
this batch's memories that is close to a quote is `tmux-outlives-closed-tabs` ("Greg assumed closing
a tab ended the session"), a paraphrase, and it is not used.

**Doubts.**

- **Biggest: three of the proposals overlap proposals from the 2026-10-01 sweep that are still
  pending** in `docs/plans/261001i-probes/proposals.md` — its F1 (long-waits: subagents, polling,
  `grep -c`, `kill -0`) against BP3 and BP4, and its K3 (vitest process count) against BP7. Putting
  both sets to Greg would ask him the same thing twice. Mine are fuller and split by owning doc; the
  orchestrator should retire one set.
- **`kill -0` (`wait-for-real-notifications` L3) did not reproduce** on 2026-10-05: it returned 0
  from an agent Bash call for a child and for another of the user's processes. It may have been true
  of a differently sandboxed session on 2026-09-30. Dropped rather than ported; F1 above still
  carries it and should lose it.
- **`full-suite-needs-tmux-on-this-box` contradicts `testing.md` on the admission reserve.** The
  memory says leave `~/.config/spideryarn/vitest-memory-reserve-gb` alone; the doc says "If a run is
  refused and you are certain, delete the file or set a smaller reserve." The doc is later and
  deliberate, so the memory's line is dropped (L14), not proposed.
- **BP12 changes a gate.** The memory's "commit on the fast gates" is one agent's habit, written as
  advice to itself. It is a proposal only because the alternative was dropping a workflow claim
  unasked.
- **`npm-run-forwards-a-bare-argument`** is fully told in Git already, but in a script header, not a
  doc. BE8 is a pointer so the brief's "a doc says it" holds; if a code comment counts, the file is
  eligible without it.
- **BE10's bucket sentence is unverified.** I did not send a request to production to check the
  `object/info` path or the 400. It is ported from the memory (2026-09-30); cut the sentence if that
  is not enough.
- **BE1**: I checked that no file under `infra/` or `scripts/` mentions `sessions.mjs`, and that the
  file exists on the box. Where its source lives is the memory's word only.
- **BE2** ("deleting the log directory orphans the run") and the mechanism in **BE3** ("the harness's
  own guard") are the memory's observations, ported with dates; neither can be re-measured cheaply.
- **BE7 was confirmed in a different form today**: this subagent's own `Write` of the report was
  refused by the harness (as a subagent report file, not as an outside path). The memory's
  outside-path refusal itself was not re-tested.
- **Identifiers left out on purpose.** `no-vercel-credential-on-this-machine` holds the Vercel team
  and project ids and `no-production-db-access-from-this-laptop` names the database role and pooler
  port. None of that is in this report or the suggested text. The loopback address in
  `gjd-remote-runs-from-the-box-with-one-var` is already printed in `hetzner-remote-server-box.md`.
- **Tools I could not check.** `TaskOutput`, `TaskStop`, `CronCreate` and `Monitor` are named in BP2
  to BP4 on the memories' word and on `long-waits.md`'s; this session has no `TaskOutput` or
  `CronCreate` to test against.
- **Docs found out of date or thin.** `database.md`'s safe-read example is written as `psql "$DB" …`,
  which the box cannot run (BE10 says so beside it). `long-waits.md` says its numbers are for Claude
  Code 2.1.258 on 2026-09-02 and has none of the later measurements (BP2). `worktrees.md` is the only
  doc that says the box has no `gh` login, inside the trunk-flip history. `npm-run-check…`'s "seven
  gates" is stale against `scripts/check.ts` (nine), and `static-analysis.md` rightly cites the table
  rather than a count.
- **`postgres-suites-fail-from-contention` L1 may be weaker than it reads.** The private test
  database (260903e) removed most of the Postgres contention it was written about; BP5 keeps the
  practice because load timeouts still produce the same batch-of-reds shape (2026-09-08).
- **Anchors.** Each single-line anchor was grepped and is unique in its file as of 2026-10-05, except
  BE4's (its `**not**` defeated the grep; read by eye, it appears once). The primary checkout is
  shared and moving, so re-check before pasting.
