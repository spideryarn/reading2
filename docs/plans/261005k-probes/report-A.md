# Report A: Greg's permissions and preferences, and Overseer practice

Stage 1 of [261005k](../261005k-port-overseer-auto-memory-into-docs.md), batch A, 22 memory files,
read 2026-10-05. Nothing was edited. 9 files are *eligible*, 13 are *retain*; 4 edits (`AE1`–`AE4`)
and 10 proposals (`AP1`–`AP10`).

## Table

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `greg-allows-overseer-to-deploy` | `9624ca9d64cd` | L1 (the Overseer may deploy, migrations included) already: `overseer.md` § Deploying — "You are the only one who deploys." L2 (read pending migrations, a destructive one goes to Greg) already: same section, step 2 — "Anything that would destroy reader data goes to Greg first". L3 (read the `Target:` line, deploy only a checked commit, say what went out) already: same section, steps 5–6 — "It is not deployed until three things agree". L4 (never push to `main` by hand) already: `overseer.md` § gate 3 — "no push to `main` except through `npm run deploy`". L5 dropped: stale, "the keys may not be in place yet" — `overseer.md` § Deploying now says "The credentials are on the box". | eligible |
| `greg-allows-overseer-to-kill-finished-sessions` | `6ab170cd6601` | L1 (standing permission to kill finished sessions to free memory) propose AP1 — the close-out in `overseer.md` § Dispatching agents says "only then close the session", but not that a bulk kill for memory is the Overseer's, and not Greg's words. L2 (only after debrief, nothing unpushed) already: `overseer.md` § gate 3 — "no killing a session with unpushed work" and "Closing a session before its debrief". L3 (old Playwright Chrome dies with its session) rides in AP1 as a clause. L4 dropped: duplicate — walking `/proc` to measure per-session memory is the lesson of `ps-grep-counts-its-own-apparatus` (another batch). | retain |
| `greg-allows-removing-safe-worktrees-and-temp-files` | `e5d1b2c7d68b` | L1 (remove a worktree whose work is pushed) already: `overseer.md` § Dispatching agents — "you don't need my input to remove worktrees". L2 (also a tree agreed to be thrown away, and safe temp files) propose AP2. L3 (what "safe" means: no commits past `origin/dev`, `data/` equal to the fixtures, `.env.local` compared without printing) already: `worktrees.md` § Before you remove one — "file by file, by content", and § "`.env.local — DIFFERS`, and how to settle it without printing a secret". The memory's `git worktree remove --force` is corrected by the tree: the doc's command is `npm run worktree:remove`. L4 (new trees go under `/var/tmp/spideryarn-worktrees/`) already: `worktrees.md` § Where a worktree's bytes live — "On the box a new worktree is at `/var/tmp/spideryarn-worktrees/<name>`". L5 (a full `/home` breaks peers) already: `hetzner-remote-server-box.md` § Traps — "`/home` is the small disk". | retain |
| `greg-allows-deleting-old-codex-transcripts` | `78e1605361b9` | L1 (standing permission, Codex rollouts older than a week, not Claude transcripts) propose AP3. | retain |
| `weekly-claude-usage-is-not-a-gate` | `ee5fc5e28706` | L1 (do not slow the fleet for Claude's weekly limit; run to 100% and tell Greg) propose AP4 — **contradicts** `overseer.md` § The tick step 2, "The seven-day window … is rationed the same way". L2 (the 2026-10-03 breach, and that a heads-up at about 95% is fine) rides in AP4. L3 (Codex has its own rule) already: `overseer.md` § The standing jobs, Usage limits — "work stops; it does not step down". | retain |
| `sol-limit-stops-work-never-luna` | `23d9d9bec1d8` | L1 (no Luna stand-in, no skipped review; pause) already: `overseer.md` § The standing jobs, Usage limits — "DO NOT fall back to Luna for important stuff or skip the GPT reviews", and `engineering-manager.md` § Delegate — "Never a stand-in for Sol". L2 (tell Greg at once, he can reset it) already: same two passages — "I can do a reset to get extra. But you need to let me know." L3 (the second Claude login was removed) already: `overseer.md` § The standing jobs — "Since 2026-09-30 there are none". | eligible |
| `fix-bugs-and-free-improvements-without-asking` | `ab97a059832f` | L1 (bugs and no-trade-off, low-complexity improvements are authorised and dispatched without asking; trade-offs, complexity, destructive production writes and rule wording still go to Greg) propose AP5. | retain |
| `session-cap-covers-greg-directed-work` | `144e8147cb3c` | L1 (every new session counts against what the box carries, Greg-directed ones included; queue the work when he answers many at once; check the box before any `new-claude`) propose AP6. L2 (the heavy-command lock, `flock /var/tmp/spideryarn-heavy.lock`) rides in AP6; the file exists on the box and review prompts under `docs/plans/` use it, but no doc under `docs/project/` names it. | retain |
| `supabase-access-token-needs-greg-each-time` | `8a699c4916c9` | L1 (the token is on the box) already: `hetzner-remote-server-box.md` § Where things are — "until Greg put it on, 2026-10-01". L2 (every use needs a fresh yes from Greg; a past yes is not relayed as standing; never printed) propose AP7. | retain |
| `gregs-answer-is-often-a-fifth-option` | `da400e1ad3f4` | L1 (offer options but expect an answer that is none of them) already: `ask-me-questions.md` § How to ask — "Expect a fifth option anyway: often the answer is neither", and `overseer.md` § gate 2 — "Scope is where his fifth options come from". L2 (explain the trade-off and its mechanism before the options) already: `AGENTS.md` § Explain plainly and briefly — "each option explained fully and plainly". L3 dropped: stale — "one question at a time" (2026-09-06) is superseded by `overseer.md` intro, Greg 2026-09-08, "ask me questions upfront! Much more convenient for me than dribbling them out", and `ask-me-questions.md` — "At most three at a time". L4 (when he overrules evidence, build it but hold the irreversible part for his sign-off) already: `overseer.md` § gate 2 — "Except where it outlives the branch … a published sentence, a privacy promise"; the instance is in `dictation.md` — "which is Greg's call and not a benchmark's". L5 dropped: the three 2026-09-06 examples are one day's story. | eligible |
| `pull-latest-on-waking-up` | `ef0f7dcad733` | L1 (merge `origin/dev` first thing on waking, not at push time) propose AP8 — `worktrees.md` § The workflow has the merge only "when a piece of work is done". L2 (re-run tests after the merge) already: `worktrees.md` § The workflow — `npm test && npm run typecheck` follows the merge. L3 (merge, never rebase) already: `AGENTS.md` — "Always merge, never rebase". L4 (the fast-forward-only form for the shared primary) rides in AP8 as its last paragraph. L5 dropped: duplicate — fetch and merge as separate commands is the lesson of `worktree-session-refuses-compound-shell` (another batch). L6 dropped: stale — "a conflict is shown to Greg rather than resolved unilaterally" is reversed by `AGENTS.md`, "resolve it yourself … It goes to Greg only if it is a real product trade-off (Greg, 2026-09-10)". | retain |
| `research-gets-a-docs-research-writeup` | `72525104f302` | L1 (an eval, model comparison or spike gets a write-up in `docs/investigations/`; external work in `docs/research/`) already: `investigations.md` § The rule — "gets a write-up here before the work is called done", with both of Greg's quotes; and `engineering-manager.md` — "write it up in the project's investigations folder before the stage is called done". L2 dropped: stale, "rule wording … pending Greg's approval" — the rule is in `investigations.md`. | eligible |
| `granularity-zoom-is-one-of-several-core-features` | `d4f23efdb9d0` | L1 (granularity-zoom is one core feature, not the yardstick for ranking work) propose AP9 — `vision.md` says only "The first feature built on this is granularity zoom" and files the rest under "Where this goes after granularity zoom". L2 dropped: stale — the phrase "the feature this whole app is for" is no longer in `AGENTS.md` or anywhere under `docs/project/` (grepped). | retain |
| `announce-before-taking-a-queued-slice` | `4a9efee524bb` | L1 (check who is on a queued slice before starting it, and make the claim visible) already: `overseer.md` § Dispatching agents — "Read `gjd-remote ls` before you dispatch anything … two agents building the same slice from the same queue, which this box has already paid for once", and "Name a session after what claims it". L2 dropped: duplicate — the clean merge that kept both sets of rows is `merge-can-duplicate-what-it-does-not-conflict-on` (another batch). L3 dropped: superseded — "answer a peer on timing, not ownership" was for agents claiming slices among themselves; slices are now dispatched and named by the Overseer (`overseer.md` § Dispatching agents). L4 dropped: stale — "no machinery for this" (2026-09-07, a paraphrase of Greg) predates the claim register the same section now describes. | eligible |
| `get-ready-to-deploy-loop-lives-in-a-session` | `af886449f903` | L1 (a session cron dies with its session) already: `get-ready-to-deploy.md` § Running it on a timer — "A `/loop` lives in its session", and `cron-scheduler.md` — "a session cron dies with its session". L2 (the only evidence is a gap in `logs/loops/get-ready-to-deploy/<yyMMdd>.md`) already: `cron-scheduler.md` — "the only evidence is a gap in a log nobody is reading"; the path is in `get-ready-to-deploy.md`. L3 (the durable form is a system cron, a change to the box) already: `get-ready-to-deploy.md` — "a system `cron` running `claude -p`". L4 dropped: the job ids and the five one-shots of 2026-09-06/07 are one finished job. | eligible |
| `public-read-audit-plan-not-built` | `5c1520af3681` | L1 dropped: the built/not-built status of plan 260902j is one job, and the plan's own Progress log is the record (the plan exists; the memory says the same). L2 (a vitest timeout inside `act()` fails every later test in the file) edit AE4 — it is in the plan's log only, not in `testing.md`. L3 (a reference sweep that skips `scripts/` misses callers) already: `rename-or-move.md` — "postmortems, tests, fixtures, scripts, `package.json`", and `AGENTS.md` § Delegating — "code, docs, plans, tests, fixtures, scripts". | retain |
| `pool-account-sessions-have-no-sentry` | `1398fda36ade` | L1 dropped: stale — pool accounts are gone: `overseer.md` § The standing jobs, "Since 2026-09-30 there are none … every session runs on the default login". L2 (a report session tries the Sentry tool before assuming it is absent) already: `feedback-reports.md` § Into the Overseer's queue — "still holds for a session that can". L3 (the sweep does the Sentry write at the start of its run from the note) already: same passage — "the next sweep marks the issue in Sentry from that note at the start of its run". L4 dropped: queue entry `qi-a38gypaj` is marked done (2026-09-12) in the Overseer's queue store. | eligible |
| `classifier-accepts-fleet-restart-script` | `20efa6d52fe9` | L1 (`npx tsx scripts/fleet-restart.ts restart` is accepted, a hand-typed `sudo systemctl restart` is not, prefer the bare `npx tsx` form) already: `overseer.md` § Steering, and the actions you have — "the classifier accepted that command unattended on 2026-09-09 … and so was one `npm run` form". L2 (a refusal is not evidence about the command alone; session history seems to count) edit AE1. L3 (do not retry what the classifier has just refused) propose AP10. | retain |
| `classifier-refuses-production-reads-in-auto-mode` | `3f63229cb311` | L1 (the classifier refuses reads of real reader data from an unattended session, and a chat yes from Greg does not change it; what was allowed instead) edit AE2. L2 (try once, write Greg a one-command script, say the data was not looked at) propose AP10. | retain |
| `remote-control-is-already-on-for-box-sessions` | `1273f09adf54` | L1 (check for the first-party phone client before building a dashboard) already: `agent-fleet-dashboard.md` — "Check first whether your harness already gives you a phone client". L2 (it fails quietly: 8 of 23 on 2026-09-08) already: `overseer-direction.md` § Remote Control fails quietly — "8 of 23 live sessions had Remote Control broken". L3 dropped: stale — the check by `bridgeSessionId` in `~/.claude/sessions/*.json`: of 8 such files on the box today one carries the field and it is null, so the field no longer says what the memory says. L4 (`claude agents --json` is the fast source) already: `overseer-direction.md` — "`claude agents --json` is fast (~1s, cross-repo) but incomplete". L5 dropped: stale — "`gjd-remote ls` takes 10–12s": `hetzner-remote-server-box.md` § How slow it is measures 1.85s. | eligible |
| `use-opus-not-fable` | `a63607bb5779` | L1 (Opus where a doc says Fable; Sol stays the cross-family check; Sonnet for research and browser; Luna for light work) already: `AGENTS.md` § Delegating — "Fable is retired (Greg, 2026-09-28)", and `engineering-manager.md` § Delegate — "Stop using Fable. Let's just rely on Opus 5.5". L2 dropped: stale, "the repo docs may still mention Fable" — they have been updated. | eligible |
| `peer-discovery-is-per-config-directory` | `c0391078ad96` | L1 (`ListAgents` and `SendMessage` find peers per Claude config directory; an empty list is not a dead peer) edit AE3. L2 dropped: superseded — the `DEBRIEF` marker in assistant turns as the fallback channel: every session has run under the default directory since 2026-09-30 (`overseer.md`), and reporting to the Overseer is now `work-reports.md`. | retain |

## Edits

### AE1 — `docs/project/overseer.md` § Steering, and the actions you have

**Anchor (text to be replaced, two lines, exact):**

```
`sudo systemctl restart` is still refused, and so was one `npm run` form; if the script is ever
refused too, it is Greg's. The daemon is separate: its relaunch is still the `tmux-job` pair under
```

**Text:**

```
`sudo systemctl restart` is still refused, and so was one `npm run` form; if the script is ever
refused too, it is Greg's. A refusal is weak evidence about the command on its own: on 2026-09-09
both sessions that had done a real restart were refused commands afterwards, a bare read-only
`systemctl is-active` among them, and the refused `npm run` form had also been piped through grep,
so the wrapper, the pipeline and the session's history cannot be told apart. Unproven, but the
classifier does not seem to judge the text alone. The daemon is separate: its relaunch is still the
`tmux-job` pair under
```

Carries `classifier-accepts-fleet-restart-script` L2.

### AE2 — `docs/project/hetzner-remote-server-box.md` § Traps

**Anchor (insert a new bullet directly after this line, the last of the `/home` bullet):**

```
  else large and disposable belongs on `/` too.
```

**Text:**

```
- **Holding the production credential is not being allowed to read with it.** On 2026-10-03 the
  auto-mode classifier refused an unattended feedback session three reads of real shelf data: a
  read-only dump of production ("Production Reads"), `evals/shelf-topics/build-cases.ts` against
  the local shelf's real titles ("PII Data Handling"), and a one-row read-only lookup made after
  Greg had said yes in chat. The refusal is about the outcome, so a yes in chat does not change it.
  What was allowed: synthetic shelves, and a query for an owner that does not exist, which proves
  the SQL. The work was finished with a one-command read-only script for Greg to run himself
  (`npm run shelf-topics:preview`).
```

Carries `classifier-refuses-production-reads-in-auto-mode` L1.

### AE3 — `docs/project/overseer.md` § Things that will catch you

**Anchor (insert a new bullet directly after this line, the last of the `SendMessage` bullet):**

```
  `/rename`, and it is not the tmux session name.
```

**Text:**

```
- **An empty `ListAgents` is not a dead peer.** `ListAgents` and `SendMessage` find peers per Claude
  config directory. A session started under another one sees only the sessions registered there,
  and its `SendMessage` to you answers *"No agent named 'Overseer' is reachable."* Seen 2026-09-10,
  from the first session on a pool account, which reported it as a fault. Every session has run
  under the default directory since 2026-09-30, so this comes back only if a second login does.
```

Carries `peer-discovery-is-per-config-directory` L1.

### AE4 — `docs/project/testing.md` § A test that spawns a process needs its own timeout

**Anchor (insert a new paragraph, with a blank line before it, directly after this line):**

```
[260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.2.
```

**Text:**

```
**And one timeout can fail the rest of its file.** A vitest timeout inside React's `act()` leaves
the root mid-render, and every later test in that file renders an empty host. On 2026-09-02 three
sweeps measuring 3.6–3.8s against the 5-second default met a load spike: one timed out, and twenty
further tests failed with nothing wrong. So in a file like that the first failure is the real one —
[260902j](../plans/260902j-public-read-only-access-audit-and-improvements.md), progress log.
```

Carries `public-read-audit-plan-not-built` L2.

## Proposals

### AP1 — `docs/project/overseer.md` § Dispatching agents

**Before:** new, after the paragraph that ends

```
([worktrees.md § Removing one](worktrees.md#removing-one)).
```

**After:**

```
**Killing finished sessions to free memory is yours too.** Greg, 2026-09-29, after running the
Overseer's `tmux kill-session` list himself: *"You're allowed to run that command and similar
yourself in future to free up memory."* That day swap was full, vitest's memory guard had blocked
four sessions' tests for hours, and killing 17 finished sessions took available RAM from 7 to 12 GB
and swap from 31 to 21 GB. Gate 3 still picks which: only a session that has debriefed, with no
worktree holding uncommitted or unpushed work. A session's old Playwright Chrome goes with it. If
the classifier asks, cite this.
```

Why here: it is the close-out paragraph, which already says closing a finished session is the
Overseer's; this adds the bulk kill and Greg's words. Carries
`greg-allows-overseer-to-kill-finished-sessions` L1, L3.

### AP2 — `docs/project/overseer.md`, a new subsection before `### Dispatching agents`

**Before:** new, after the line

```
deploy's push; `npm audit --audit-level=high` in the primary is the second opinion.
```

**After:**

```
### Keeping `/home` from filling

`/home` on the box is the small disk, and when it is full it is peers' commits and worktree
creation that fail ([hetzner-remote-server-box.md § Traps](hetzner-remote-server-box.md#traps)).
Greg gave two standing permissions on 2026-10-05, the day it reached 100%.

**Worktrees and temp files.** *"You are allowed to remove worktrees where it's safe to do so (e.g.
we've already pushed their contents, or we have explicitly agreed that we are throwing them away)
And you are allowed to remove temp files where safe to do so"*. Safe for a worktree is still what
`npm run worktree:check` says inside it
([worktrees.md § Before you remove one](worktrees.md#before-you-remove-one)), and the removal is
still `npm run worktree:remove`. What this adds to the close-out under *Dispatching agents* is the
tree you and Greg agreed to throw away, and temp files. The Overseer's notes count
`npm cache clean --force` as one of those.
```

Why here: it is a permission for the Overseer, beside the other things it may do unasked
(Dependabot, deploying). Carries `greg-allows-removing-safe-worktrees-and-temp-files` L2.

### AP3 — `docs/project/overseer.md`, the same new subsection

**Before:** new, as the last paragraph of the subsection AP2 adds.

**After:**

```
**Old Codex transcripts.** *"Ok, you have permission any time to delete Codex transcripts more than
a week old"*. That is the `rollout-*.jsonl` files under `~/.codex/sessions/` last modified more
than seven days ago, and the directories that leaves empty:
`find ~/.codex/sessions -type f -name 'rollout-*.jsonl' -mtime +7 -delete`. They were 6.8 GB that
day, half of it older than a week. A review's conclusions are in the repo's `*-sol.md` files.
Claude's transcripts under `~/.claude/projects/` are **not** covered.
```

Why here: the same permission family as AP2. If AP2 is refused, this needs its own home (the
`/home` bullet in `hetzner-remote-server-box.md` § Traps). Carries
`greg-allows-deleting-old-codex-transcripts` L1.

### AP4 — `docs/project/overseer.md` § The tick, step 2

**Before:** new, after the line that ends step 2 (the new paragraph is indented three spaces, inside
the list item)

```
   room. Watch both budgets, and ration against the tighter one.
```

**After:**

```
   **Claude's seven-day window is no longer rationed, since 2026-10-01.** Greg, after the Overseer
   said it would slow new session starts at 92% of the week: *"Keep going until you hit 100% of
   your weekly usage limits, and then I'll find a way to reset them."* So do not hold the queue or
   slow releases because Claude's weekly figure is high, and when sessions do stop at 100%, tell
   him plainly. A line to him at about 95% is fine. The Overseer broke this on 2026-10-03: at 97% it
   held the queue for about three hours, reasoning that at 100% every session stops, itself
   included. That is the trade he had already chosen. A GPT limit is different and still stops work
   (*Usage limits*, above).
```

Why here: this paragraph is where the weekly window is rationed, and the new one reverses it. The
paragraph above it ("at ~4 points a day it lasts the week", and Greg's 2026-09-09 "slow things down
a bit") would then be history; Greg may prefer it rewritten rather than added to. Carries
`weekly-claude-usage-is-not-a-gate` L1, L2.

### AP5 — `docs/project/overseer.md` § gate 2 (Answer facts, route judgement, default the product call)

**Before:** new bullet, after the *Low-stakes decisions* bullet, whose last two lines are

```
  A decision he has not seen is still a decision he can reverse, so the record is the whole of the
  permission.
```

**After:**

```
- **Bugs, and improvements that cost nothing, you authorise yourself.** Greg, 2026-10-04: *"if you
  see bugs, fix them without asking me."* and *"if there are clear no-tradeoffs-improvements that
  won't add much complexity, you should always do them"*. So a plain bug fix, or an improvement with
  no trade-off and little added complexity, does not wait in the queue as *needs Greg*: run the
  queue's `authorize … --by greg` citing this, and dispatch it. What still goes to him as a tagged
  question is a real product trade-off, added complexity, a destructive write to production, and
  the wording of a rule doc.
```

Why here: gate 2 is the list of what the Overseer may decide on Greg's behalf. Carries
`fix-bugs-and-free-improvements-without-asking` L1.

### AP6 — `docs/project/overseer.md` § Dispatching agents

**Before:** new, after the *Three at a time at most* paragraph, which ends

```
spend the evening investigating the box.
```

**After:**

```
**Every new session counts against what the box can carry, whoever asked for it.** Work started for
an answer Greg has just given is not exempt. On 2026-10-05 about fifteen sessions were started in
two hours, one per answer. With about twenty running, up to eight `tsc` runs at once (1–3 GB each),
dev servers and browser agents, load reached about 170 and swap 31 of 32 GB; Greg's ssh crawled and
peers' gates were killed. The 30 GB box fits about six to eight active sessions. So when Greg
answers several questions at once, record the decisions straight away, put the work at the front of
the queue, and release it as sessions finish. Check load, memory and swap before **any**
`gjd-remote new-claude`, not only before a release from the queue. A heavy command can be made to
wait its turn with `flock /var/tmp/spideryarn-heavy.lock <command>`.
```

Why here: it sits beside the existing concurrency limit and the 2026-09-08 "eight sessions in twenty
minutes" story in the same section. Carries `session-cap-covers-greg-directed-work` L1, L2.

### AP7 — `docs/project/hetzner-remote-server-box.md` § Where things are, the `gjd-remote-env.ts` bullet

**Before:**

```
  Supabase project) was too, until Greg put it on, 2026-10-01: *"I know there is risk, but I think
  it'll be fine."* Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
```

**After:**

```
  Supabase project) was too, until Greg put it on, 2026-10-01: *"I know there is risk, but I think
  it'll be fine."* **Its being on the box is not permission to use it.** It went on for one run of
  `scripts/supabase-auth-config.ts templates`, and Greg, the same day: *"You have my permission
  this time to run the command … But going forwards, you still need to ask my permission for any
  action that involves SUPABASE_ACCESS_TOKEN."* So every action that uses it, by any session, needs
  a fresh yes from him for that action. Do not pass an earlier yes to a peer as though it were
  standing, and never print the value.
  Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
```

Why here: it is the one passage that says the token is on the box, so it is where an agent finds
out it could use it. Carries `supabase-access-token-needs-greg-each-time` L2.

### AP8 — `docs/project/worktrees.md` § The workflow

**Before:** new, after the code block that ends

```
git diff origin/dev...HEAD     # THREE dots. Two is a trap; see below.
```

(and its closing fence), before the paragraph that begins `**Type the three dots.**`

**After:**

```
**Merge `origin/dev` when you wake up as well, not only when the work is done.** A session resuming
from a cron, a long wait, a compaction or a `--resume` fetches and merges before it does anything
else.

> when you wake up, pull the latest changes to avoid a big merge conflict at the
> end
>
> — Greg, 2026-09-06

That day a change sat in a worktree for about two hours, and `dev` moved three times during the
push sequence itself: the merges brought in 64, then 11, then 84 files, each one after the tests
had run, and each forcing another run. Merged early, the same changes are an ordinary integration,
and a conflict arrives while there is still time to think about it. Run the affected tests again
after the merge.

In the shared primary, look first: if `git rev-list --left-right --count HEAD...origin/dev` shows
nothing local-only, `git merge --ff-only origin/dev` moves the branch without a merge commit and
without touching what other agents have uncommitted there.
```

Why here: this section is the merge recipe, and it currently places the merge at the end of the
work. Greg may prefer `docs/reusable/long-waits.md`, which is where an agent about to wait looks.
Carries `pull-latest-on-waking-up` L1, L4.

### AP9 — `docs/project/vision.md`, the opening section

**Before:**

```
The first feature built on this is [granularity zoom](granularity-zoom.md).
```

**After:**

```
The first feature built on this is [granularity zoom](granularity-zoom.md). It is one core feature,
not the reason the app exists:

> granularity-zoom is *a* core feature, but by no means the only reason the app
> exists! The glossary, concept-search, remembering, diagramming, etc all feel
> novel and interesting.
>
> — Greg, 2026-09-07

So weigh a piece of work by what it does for the whole set of reading modes
([reading-view-overview.md](reading-view-overview.md)), not for the tree alone. Work on extraction
quality usually feeds all of them, which is the stronger argument for it.
```

Why here: it is the sentence that introduces granularity zoom, and the one an agent ranking work
would read. Carries `granularity-zoom-is-one-of-several-core-features` L1.

### AP10 — `docs/project/hetzner-remote-server-box.md` § Traps

**Before:** new bullet, directly after the bullet AE2 adds (or, if AE2 is not applied, after
"else large and disposable belongs on `/` too.").

**After:**

```
- **Do not retry a command the classifier has just refused.** Whether it runs is not the agent's
  call. Try a read of real reader data at most once from an unattended session. If it is refused,
  write the one-command read-only script for Greg to run, do not plan an eval around a real shelf,
  and say plainly in the report that the data was not looked at.
```

Why here: beside the fact it acts on (AE2). Carries `classifier-accepts-fleet-restart-script` L3 and
`classifier-refuses-production-reads-in-auto-mode` L2.

## Quotes, and doubts

### Quotes to check against the transcripts

Every string below is copied from inside quotation marks (or a blockquote) in the memory file.

| used in | exact string | date | memory file |
|---|---|---|---|
| AP1 | "You're allowed to run that command and similar yourself in future to free up memory." | 2026-09-29 | `greg-allows-overseer-to-kill-finished-sessions` |
| AP2 | "You are allowed to remove worktrees where it's safe to do so (e.g. we've already pushed their contents, or we have explicitly agreed that we are throwing them away) And you are allowed to remove temp files where safe to do so" | 2026-10-05 | `greg-allows-removing-safe-worktrees-and-temp-files` |
| AP3 | "Ok, you have permission any time to delete Codex transcripts more than a week old" | 2026-10-05 | `greg-allows-deleting-old-codex-transcripts` |
| AP4 | "Keep going until you hit 100% of your weekly usage limits, and then I'll find a way to reset them." | 2026-10-01 | `weekly-claude-usage-is-not-a-gate` |
| AP5 | "if you see bugs, fix them without asking me." | 2026-10-04 | `fix-bugs-and-free-improvements-without-asking` |
| AP5 | "if there are clear no-tradeoffs-improvements that won't add much complexity, you should always do them" | 2026-10-04 | `fix-bugs-and-free-improvements-without-asking` |
| AP7 | "You have my permission this time to run the command … But going forwards, you still need to ask my permission for any action that involves SUPABASE_ACCESS_TOKEN." (the "…" is in the memory, so the original is longer) | 2026-10-01 | `supabase-access-token-needs-greg-each-time` |
| AP8 | "when you wake up, pull the latest changes to avoid a big merge conflict at the end" (a blockquote in the memory, wrapped after "the") | 2026-09-06 | `pull-latest-on-waking-up` |
| AP9 | "granularity-zoom is *a* core feature, but by no means the only reason the app exists! The glossary, concept-search, remembering, diagramming, etc all feel novel and interesting." (a blockquote in the memory) | 2026-09-07 | `granularity-zoom-is-one-of-several-core-features` |

Paraphrases, not written as Greg's words anywhere above:

- AP2: "`npm cache clean --force` is fine" is the Overseer's own reading of "temp files", and the
  text says so.
- AP4: "a heads-up at about 95% is fine" is the Overseer's own conclusion, not Greg's.
- AP6: the memory quotes Greg asking "how the box got so overloaded, and what we can do to avoid
  it" (2026-10-05). Not used in the text. The cap and the queueing are the Overseer's answer to
  that question, not something he is recorded as saying.
- `announce-before-taking-a-queued-slice` L4: "Greg said just tell me, no action" (2026-09-07) is a
  paraphrase; the lesson is dropped as stale, so it lands nowhere.

In AE3 the string "No agent named 'Overseer' is reachable." is a tool's error message, not Greg.

### Doubts

1. **AP4 contradicts the runbook as it stands, and that is the biggest call here.** `overseer.md`
   § The tick step 2 rations the seven-day Claude window on Greg's 2026-09-09 words; the memory
   records him reversing that on 2026-10-01. The proposal adds a paragraph rather than rewriting
   the old one. Whether "100%" covers only the weekly window (as written) or the five-hour one too
   is not in the memory.
2. **AP6: "the pacer" and its "cap of 6" are not in the tree.** No file under `tools/`, `scripts/`
   or `docs/project/` contains the word *pacer*, so the proposal states the limit as a measured
   capacity ("about six to eight") rather than naming a mechanism. It also sits awkwardly with the
   runbook's opening "a fleet of 20–35 coding agents" and with § The tick's "surfing close to the
   edge"; Greg should see all three together.
3. **AP5 and gate 3.** Gate 3 ends "nothing dispatched that Greg did not queue". The memory reads
   the 2026-10-04 words as a standing authorisation for bugs and free improvements; the proposal
   says so through the `authorize … --by greg` step but does not edit gate 3. Whether a bug the
   Overseer itself noticed counts is his to say.
4. **`feedback-reports.md` § Into the Overseer's queue looks out of date.** It says "report sessions
   run on a pool account" and that "the Sentry status write is the sweep's, not the report
   session's", while `overseer.md` says there have been no pool accounts since 2026-09-30. I
   proposed no change: who closes a report in Sentry is a workflow rule, and no memory in this batch
   carries Greg's word on it.
5. **`hetzner-remote-server-box.md` § The status line** says "Both Claude config directories on the
   box point at it." A second directory still exists on disk, but `overseer.md` says its login was
   removed. Possibly stale; not touched.
6. **AE1 softens a sentence elsewhere.** `overseer.md` § Things that will catch you says "The
   classifier judges each command alone". The memory's observation that session history seems to
   count is marked unproven in both the memory and the edit; the two sentences can both stand, but
   a reader may notice the tension.
7. **`remote-control-is-already-on-for-box-sessions` L3 was dropped on a thin check.** Today one of
   eight files under `~/.claude/sessions/` carries `bridgeSessionId`, and it is null. That shows the
   memory's "11 of 19" no longer describes the box; it does not show whether the field is still the
   right test. The other half of its check (the `/rc failed` word in the status bar) is in
   `overseer-direction.md` only as "one word at the bottom of a terminal".
8. **`gregs-answer-is-often-a-fifth-option` L4** (when Greg overrules evidence, build it but hold
   the irreversible part) is marked *already* on gate 2's outlives-the-branch list. That list says
   the irreversible part waits for him; it does not say "build the rest anyway". If Sol reads that
   as not the same lesson, the file moves to *retain*.
9. **`announce-before-taking-a-queued-slice` L3** is dropped as superseded by the Overseer's claim
   register. An agent working outside the Overseer (on the Mac, say) still has no written rule to
   message peers before taking a slice a plan doc names.
10. **AP8's last paragraph** (`git merge --ff-only` in the shared primary) is a recipe I did not
    run. `AGENTS.md` forbids switching or rebasing there but not a fast-forward merge; Greg can
    strike the paragraph without touching the rest.
11. **AP2 and AP3 create a subsection.** No new doc is suggested anywhere in this report.
12. `database.md` § Connecting to the remote prints the production project's reference id. Not
    repeated here; mentioned only because the brief forbids hostnames in reports and the next
    reader of that section should know it is there.
13. **Not machine-checked.** Because the file could not be written, `check-mapping.py` was not run
    against this table, and the 100-column wrap of the suggested text was checked by eye only. The
    hashes were taken with `sha256sum` when each file was read.
