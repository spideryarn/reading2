# A rich `overseer` CLI: the Overseer's regular recipes, one command each

**Status as of 2026-09-09: Stage 1 built and committed (`0fe613bf`); Stage 2 in progress; Stages 3
and 4 stopped before building, on GPT Sol's review.** Evidence: `commander@15.0.0` in
`package.json`, 309 tests green across nine overseer suites, `npm run typecheck` clean.

Session `overseer-cli`, worktree `overseer-cli`, queue item `qi-njy5v8ze`. Dispatched by the
Overseer.

## What changed after Sol read this plan

The plan below was written first and reviewed by GPT Sol
([260909d-plan-review-sol-r1.md](260909d-plan-review-sol-r1.md)). Its verdict was **not ready to
build as written**: the read-only half is sound, and **four of the seven subcommands — `closeout`,
`dispatch`, `pause`/`resume`, `log` — each cross a gate or lack a transaction**. Its diagnosis of the
common fault is worth quoting, because it is the thing to check in anything built here later:

> The plan's recurring mistake is treating "checked immediately before" as equivalent to "one atomic
> operation." It is not, especially when the next step launches, kills, removes, commits, or sends
> keystrokes.

**One of those findings is a fact rather than a judgement, and it settles `closeout` on its own.**
`npm run worktree:remove` waives its 24-hour idle floor only when the owning session's `(pid, start)`
is in the *removing process's* ancestor chain (`shouldWaiveFloor` in
[`scripts/worktree-remove.ts:752`](../../scripts/worktree-remove.ts)). A command the Overseer runs is
not that process. So the sequence in the brief refuses at both ends:

- **before the kill**, `live.inUse.kind === "in-use"` → *"refused: this worktree is in use"*;
- **after the kill**, the owner is gone, the floor is no longer waived, and a tree that was active
  four minutes ago is under a 24-hour floor → *"refused: … under the 24h floor"*.

That floor is deliberate — [260908k](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md)
says *"nothing running in it is not the same as finished"*, and it is wrong in exactly one direction
on purpose. **Third-party immediate removal is a policy question for Greg, not something an
implementation may infer.**

So the scope is now:

| command | what happened |
|---|---|
| Stage 1: the parser, the help, `mine` | **built** — `0fe613bf`, with Sol's Stage-1 fixes applied |
| `tick`, `last` | **built** — read-only, Stage 2 |
| `closeout` | **not built** — needs Greg: may the Overseer remove a worktree it does not own, and may the sanctioned tool delete the branch? |
| `dispatch` | **not built** — needs a durable reservation *before* the launch, and Greg's authorisation must cover the assembled brief, not just the queue item |
| `pause` / `resume` | **not built** — the sending half belongs in the existing action vocabulary, not here |
| `log` | **not built** — a merge-and-push per log entry is a git robot in a tree several agents share |

Each is written up under [What is not built, and why](#what-is-not-built-and-why) with what would
unblock it. **This is the "important work left" ending**, not "finished".

## Goal

Greg, 2026-09-09:

> look for ways to make your own job easier, e.g. if there are actions you're performing regularly,
> create little tools (e.g. a rich `overseer` CLI that you can call that does most of this stuff for
> you. You might want to ask an agent to do most of the work & testing for you to your broad design
> specifications, with input from GPT Sol (which is our go-to for technical input/review).

> And use the same argument-parsing CLI library for this that we use elsewhere - as per
> docs/reusable/third-party-library-selection.md

The Overseer is a Claude session running [overseer.md](../project/overseer.md). Every recipe in that
runbook is today a hand-typed chain of shell living in that session's context, and the chains drift:
four log timestamps were written in BST on the morning of 2026-09-09 because the chain that wrote
them used `date` rather than `date -u`. **A drifting chain in a context window is the failure mode;
a subcommand with a test is the fix.**

So each recipe becomes one subcommand of `scripts/overseer.ts`, which already has `run`, `status`,
`usage`, `events`, `notes`, `attention` and `reconcile-jobs`. Each prints what it did **and what it
refused**, and does no more than its recipe.

### What this is not

Not a second Overseer. The CLI holds **no judgement** — it never decides whether a session should be
paused, whether a stage is finished, or what to dispatch. It executes a recipe the Overseer has
already chosen, and refuses by name when a gate in [overseer.md § The gates](../project/overseer.md)
would be crossed. That division is the whole point: the gates are worth more when a machine holds
them than when a tired context window does.

## References

- [overseer.md](../project/overseer.md) — the specification. § The gates (what every subcommand must
  refuse), § The tick (the order, and the pause sentence), § Dispatching agents (the close-out and
  the claim check), § Things that will catch you (the `%24` trap, `partial` deliveries).
- [overseer-direction.md](../project/overseer-direction.md) — why the Overseer's own tooling holds a
  higher robustness bar than a feature branch.
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — Greg's pointer.
- [engineering-manager.md](../reusable/engineering-manager.md) — how this job is run.
- Code this composes rather than reimplements:
  - `scripts/overseer.ts` — `statusLines`, `schedulerWiring`, `fleetUrl`, `HELP`.
  - `tools/fleet/health.ts` — `collectHealth()`, the box's load/memory/swap reading with an
    *I could not tell* arm on every field. overseer.md: *"Do not re-derive it by shelling out."*
  - `tools/overseer/usage.ts` — `parseUsageCache(claudeJson, nowMs)`, the `~/.claude.json`
    `.cachedUsageUtilization` reader that already refuses to read an absent cache as 0%.
  - `scripts/worktree-check.ts` — `gather`/`blockers`, the *would anything be lost* check.
  - `scripts/worktree-remove.ts` — `npm run worktree:remove -- --branch <name>`, the sanctioned
    removal, written after the Overseer hand-typed git on 2026-09-08
    ([260908k](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md)).
  - `scripts/overseer-queue.ts` / `tools/overseer/idea-queue.ts` — `show`, `isDispatchable`,
    `whyNotDispatchable`, `dispatched`.
  - `tools/fleet/routes-steer.ts` — `POST /api/steer/message`, `speaker: "overseer"`.

## The subcommands

The Overseer's brief proposed eight. This plan keeps seven and says why, in the order the Overseer
would use them on a tick.

| command | what it replaces | gate it holds |
|---|---|---|
| `tick` | the whole `ov-tick.sh` chain | none — read-only |
| `last <session>` | a hand-built `curl` with the `%24` encoding | none — read-only |
| `closeout <session> --sha <sha>` | ancestor check, `worktree:check`, kill, remove, log line | 3: no destroying work with no second copy; no killing a session with unpushed work |
| `dispatch <qi-id> --name --brief` | queue `show`, claim check, brief assembly, `new-claude`, queue `dispatched` | 3: nothing dispatched that Greg did not queue |
| `log '<one line>'` | `date -u`, append, `check:staged-revert`, commit, merge, push | 1: never hide who decided |
| `pause` / `resume <session>` | the pause sentence through the steer route, and the record | 1: `speaker: "overseer"`, never Greg's voice |
| `mine list \| add \| rm` | the hand-maintained `grep -E` alternation in the specimen | none — it is the list the others read |

**`ls-mine` is dropped as a separate spelling.** The brief asked for `ls-mine` *and* `mine add|rm`;
two spellings for one noun is the drift this whole plan is against. `mine` with no argument lists.

**Everything else in the brief is kept**, including `pause`/`resume`, which is the one I nearly
dropped: the Overseer prefers `SendMessage` for a Claude session, so the CLI's send is a fallback.
But **the record is the part that is missing today** — overseer.md § The tick says *"Log who is
paused … and check they woke up"*, and a pause the Overseer cannot remember is a session lost for the
day. So `pause` records first and sends second, and `--record-only` exists for the case where the
Overseer sent the sentence itself with `SendMessage`.

## Design decisions

### Commander, and one parser in the repo

`gjd-remote` chose Commander this morning, on Sol's advice over a hand-rolled spec table, in session
`gjd-remote-argument-parsing`. Its reasoning, quoted from that session's own turn:

> `defineCommand`, generated help, arity checks, aliases, error normalization, spelling suggestions,
> and special pass-through behavior collectively amount to a local CLI framework. That is no longer
> "no dependency"; it is a dependency maintained inside this repository. Commander is the boring
> choice now.

And its shape, which this plan copies rather than reinvents: **Commander owns grammar and metadata;
the prose root help stays hand-written, with its flag rows generated from Commander's registered
command objects.** That is what stops the help drifting from the behaviour without giving up the
one-screen overview.

That session had not landed on `dev` when this plan was written and is not in `ListAgents`, so it
could not be asked directly. Its decision was read from its own transcript via
`GET /api/messages`. **Risk owned here:** we both add `commander` to `package.json`, and the merge
keeps both lines. The mitigation is the one from
[a-merge-duplicates-what-it-does-not-conflict-on] — after merging `origin/dev` before the push, run
`npm run typecheck` and grep `package.json` for a duplicated key rather than trusting a clean merge.

### Compose the tested parts; do not shell out

The specimen is bash, so it shells out to `overseer status`, `overseer usage`, `free`, `/proc/loadavg`
and `python3`. **The CLI is TypeScript in the same tree, so it imports instead**: `collectHealth()`
for load and memory, `parseUsageCache()` for the direct five-hour read, `statusLines()` for the
daemon/scheduler/register/inbox block. Three reasons, and the third is the one that matters:

1. Every one of those already has an *I could not tell* arm and a test. `free -g | awk` has neither.
2. A subprocess per line is ~7 `npx tsx` starts on a box whose load is the thing being measured.
3. **Two renderings of one measurement is how a page and a terminal come to disagree** — the reason
   `scripts/overseer.ts` already imports `groupUsageIncidents` from the dashboard rather than
   restating it.

The simpler option passed over: *port the bash specimen to a TypeScript file that runs the same
commands.* It would have been an afternoon rather than a stage, and it would have shipped a second
reader of `~/.claude.json` and a second opinion about what "load" means.

### `closeout` delegates the removal; it does not type git

The brief says closeout should `git worktree unlock` and `git worktree remove`. **It should not**,
and this is a deliberate departure: those are the exact keystrokes the Overseer typed on 2026-09-08,
and [260908k](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md)
exists because of them. `npm run worktree:remove -- --branch <name>` does the same job and adds four
things the hand-typed pair does not have: a landed proof taken **before** anything is destroyed and
covering every commit the branch ever pointed at (tip *and* reflogs, so an A→B→A excursion is
counted); a scoped removal that touches no other registration's metadata; a restored lock if the
removal fails halfway; and a compare-and-swap branch deletion (`git update-ref -d <ref> <oid>`)
rather than `git branch -D`.

**That last one is a departure from the brief's "never delete a branch", and it needs the Overseer's
read.** The gate in overseer.md is *"no `git` command that throws work away"*, and 260908k's
argument is that a CAS deletion behind a complete landed proof throws nothing away — the proof
refuses on anything it cannot account for. The ban is on **hand-typed** branch deletion, which is
what the pre-commit hook in that plan enforces. Recorded here as a decision, raised in the debrief.

So closeout's recipe, each step its own refusal:

1. `--sha` is an ancestor of `origin/dev` (after a fetch), or stop.
2. The session's last assistant turn is debrief-shaped, or stop **naming what was looked for**.
3. `npm run worktree:check` **inside** the worktree says SAFE, or stop and print the blockers
   verbatim. This runs before the kill, because gate 3 forbids killing a session with unpushed work.
4. `gjd-remote kill <session>`.
5. `npm run worktree:remove -- --branch worktree-<name>`, printing its steps.
6. `mine rm <name>`.
7. Print the log line to paste (it does **not** write the log itself — `log` is a separate decision).

**Never kill anything on the Overseer's behalf at step 3's failure.** A blocker is printed and the
command exits non-zero; what to do about it is the Overseer's call.

### Where the CLI's own state lives

`~/.overseer/` is the store, and **the daemon is its single writer** — so the `mine` list and the
pause list cannot go in the checkpoint. They go in `~/.overseer/cli-state.json`, a file the daemon
neither reads nor writes, with this CLI as its single writer: read, modify, write to a temp file,
`rename`. It honours `OVERSEER_STORE_DIR` like everything else, which is also how the tests point it
at a temp directory.

The simpler option passed over: *a constant in the script.* The brief explicitly rules it out, and
rightly — the list changes several times a tick, and a list you edit by editing code is a list that
gets edited by whoever is not the Overseer.

### What refusing looks like

Every refusal prints the **gate's name** and what was checked, exits non-zero, and changes nothing.
A subcommand that has already changed something and then hits a refusal prints what it did first.
The wording of these lines goes to Fable — the Overseer reads them under time pressure, and
"refused: gate 3 — worktree:check found 2 blockers" is a different sentence from "Error: unsafe".

## Stages

Each stage: red-then-green tests, `npm test` + `npm run typecheck`, a GPT Sol review of the scoped
diff, then a commit.

### Stage 1 — Commander, the skeleton, and `mine`

- [x] `npm i commander` — 15.0.0.
- [x] Convert `scripts/overseer.ts`'s hand-rolled `flag`/`positiveNumberFlag`/`switch` to Commander,
      keeping every existing subcommand's behaviour and exit codes identical.
- [x] Root help stays prose; the usage rows are generated from the registered commands
      (`tools/overseer/cli-help.ts`).
- [x] `tools/overseer/cli-state.ts` — typed read/write of `~/.overseer/cli-state.json`.
- [x] `overseer mine [list] | add <name> | rm <name>`.
- [x] Tests: `tests/overseer-cli-parse.test.ts` (new — nothing tested argv before) and
      `tests/overseer-cli-state.test.ts`. 68 pass across the three suites; `npm run typecheck` clean.

**Why the conversion is in scope rather than "new commands only":** two parsers in one file is
exactly the second-way-to-do-the-same-thing that AGENTS.md § Prefer simple over easy forbids.

**Status: done.** Built by Claude before the Overseer's "GPT implements" instruction arrived
mid-stage; Stages 2–4 go to Codex. Four things the plan did not know:

1. **`option.mandatory`, not `option.required`.** They read like synonyms. `required` means *this
   option's value is not optional* (`--sha <sha>` has it); `mandatory` means *the command refuses to
   run without it*. Using the first printed `--sha <sha>` as compulsory in the generated rows.
2. **A Commander subcommand copies its parent's settings when it is CREATED.** A `configureOutput`
   applied to the program afterwards reaches the root and nothing under it, so `error: unknown
   option '--max-transcipts'` went on being written to the real stderr by the function whose whole
   job is to return it. Found in a passing test run's output, not by an assertion — so there is now
   an assertion (`parsing writes nothing to the real streams`), and the capture is applied
   recursively.
3. **Three latent bugs the old parser had, now refused at parse time.** A misspelled flag was a
   silent no-op (`indexOf` found nothing); `--limit nope` was `NaN` and `--limit 0` was a bound that
   selected nothing; `reconcile-jobs --why ''` got past the emptiness check only because the check
   was there — Commander's `requiredOption` cannot refuse a value it was given, so that check stays
   in the command body and a test names the seam.
4. **A group command gets no usage row of its own** — `mine` is not runnable, `mine add <name>` is.
   `usageRows` recurses to the leaves.

Sol's plan review (below) had not returned when this stage finished; its findings are applied to
Stages 2–4 and, where they bear on Stage 1, in a follow-up commit.

### Stage 2 — `tick` and `last`

- [ ] `tools/overseer/cli-messages.ts` — `GET /api/messages?id=%24…`, the last N assistant turns with
      times, `%24` encoded once and tested for it.
- [ ] `overseer last <session> [--turns N]`.
- [ ] `overseer tick` — reproduces the specimen's output from composed parts, then improves it:
      load/memory from `collectHealth()`, the daemon/scheduler/usage/register/inbox block from
      `statusLines()`, the direct five-hour read from `parseUsageCache()` with the 55/70/85
      thresholds named, and the last assistant line for each name in `mine`.
- [ ] Tests against a fake dashboard (fixtures for `/api/state` and `/api/messages`) and a fixture
      `~/.claude.json`: a stale cache is dated, an absent one is *unknown* and never 0%, a session in
      `mine` that the dashboard cannot see says so rather than being omitted.

Status: not started.

### Stage 1a — Sol's Stage-1 fixes

Applied after the plan review, before Stage 2:

- [x] **Every write takes a lock.** `updateCliState` does the whole read-modify-write under a
      separate `cli-state.lock` (never the daemon's `overseer.lock`, which is long-lived). The first
      draft accepted last-writer-wins in a comment; that was wrong, and the reasoning it gave against
      a lock is answered by `lock.ts` already clearing a lock whose holder is dead.
- [x] **A `schema` field**, so a file from a newer build is `unusable` rather than partially
      defaulted. A file without the field is read as schema 1, because that is what it is.
- [x] **The lost-update test is two real child processes with a barrier**, not two calls in one
      process and not a sleep. Two earlier drafts of this test **passed under the mutation** — the
      first because the read-modify-write is fast enough that two processes serialise by luck, the
      second because A waited on "B has started" rather than "B has read", leaving a window in which
      A could finish first. Both are exactly the shape `silent-success.md` warns about, in a test
      written to catch that shape.

Mutation checked: pointing the lock at a per-process path makes the final state
`['agent-a','agent-b']` instead of `['agent-a','agent-b','agent-c']` — `agent-c` silently gone.

### Stages 3 and 4 — stopped before building

See [What is not built, and why](#what-is-not-built-and-why). `closeout` is blocked on a question for
Greg and would not work as briefed in any case; `dispatch` needs a queue event that is in another
agent's file set; `pause`/`resume`'s sending half belongs in `tools/fleet/actions.ts`; `log` should
not merge and push per line.

## What is not built, and why

Four of the seven subcommands are **deliberately not built**. Each is here with what it would take to
unblock it, so that none of this has to be rediscovered. The common shape is Sol's sentence at the
top: *checked immediately before* is not *one atomic operation*.

### `closeout` — blocked on a policy question for Greg

Two independent blockers, and the first is mechanical.

**1. The sanctioned removal tool will refuse, at both ends.** `npm run worktree:remove` waives its
24-hour idle floor only when the owning session's `(pid, start)` is in the removing process's own
ancestor chain (`shouldWaiveFloor`, [`scripts/worktree-remove.ts:752`](../../scripts/worktree-remove.ts)).
A command the Overseer runs is a third party. So: before the kill it refuses because the tree is in
use; after the kill it refuses because the tree was active four minutes ago. **There is no ordering
that makes the briefed recipe work.** The floor is deliberate — 260908k's own words are *"nothing
running in it is not the same as finished"*.

**2. The branch deletion crosses a gate.** This plan originally argued that a compare-and-swap
behind a complete landed proof throws nothing away, so it is not the *"no git command that throws
work away"* gate. Sol's answer is right and I withdraw the argument:

> A compare-and-swap proves safety; it does not grant authority.

`docs/project/overseer.md` § gate 3 names *"branch or tag deletion"* without an exception, and the
brief said *never delete a branch*.

**What would unblock it — a question for Greg, in one piece:**

*Today, a finished agent's worktree can only be removed by the agent itself (which is gone) or by
waiting 24 hours (during which nine worktrees accumulated in one night and none could be removed).
The Overseer would like to remove them when it has read the debrief and proved the work landed. Two
ways: (a) let the Overseer pass a flag to `worktree:remove` that waives the floor when it attests it
read the debrief, keeping the branch; or (b) have the Overseer tell the finished agent to run
`npm run worktree:remove` on itself as its last act, which needs no new authority at all. (b) is
simpler and is what I would do; its cost is that an agent that has already exited cannot be told.*

Until that is answered, the honest command is **`overseer closeout check <session> --sha <sha>`**,
which verifies and reports and destroys nothing. That is Sol's recommendation and it is small; it is
not built here only because the budget ran to Stage 2.

### `dispatch` — needs a reservation before the launch, not a record after it

Two failures, both real:

- **`--brief <file>` lets arbitrary text become the instruction after Greg authorised the queue
  item.** The queue authorises a specific *revision of the item*; it does not authorise the brief
  file or the common document. That is gate 3's last bullet (*acting on a job's instruction or its
  documents when either changed after it was authorised*).
- **Launch-then-record is not atomic.** The session starts, then the queue append fails on a stale
  version or a lock, and the queue still says the item is dispatchable — leaving a paid session
  nothing has reconciled. Sol: *"`dispatch` is the command most likely to pass its test while
  failing in production."*

What it needs: a durable `dispatch-reserved` event written **before** the launch, naming the queue
revision, the session name, **a digest of the assembled brief**, and an idempotency id; then a settle
to `dispatched` / `failed-before-launch` / `unknown`; and on retry, reconciliation against
`gjd-remote ls` rather than a second launch. The launch itself should go through the already-tested
`gjdRemoteDispatch()` in [`tools/overseer/dispatch.ts`](../../tools/overseer/dispatch.ts) rather than
a second spawner. **That is a change to the queue's event vocabulary, which is not this session's
file set** — `tools/overseer/idea-queue.ts` is explicitly not mine.

### `pause` / `resume` — the sending half belongs to the existing action vocabulary

`POST /api/steer/message` **types immediately**, and it addresses a session by pane handle, tmux
session id, Claude conversation id and declared status — not by a name. A session that is *working*
should get a queued action it reads at its next prompt, which is what `tools/fleet/actions.ts` and
`/api/actions/session` already are, and `docs/project/overseer.md` § Steering says to call that
vocabulary rather than grow a second one.

And **"record first, send second" records a fact that is not yet true**. A steer has three outcomes
(`none`, `partial`, `unknown`) and only one of them is *paused*. `partial` is the dangerous one: the
text is sitting unsent in the agent's input box.

What survives is the *record*, which is genuinely missing today: `overseer paused record | check |
clear`, with honest states (`requested`, `queued`, `delivery-uncertain`, `woke`) and **no retry ever**
on `partial` or `unknown`. `tools/fleet/pause.ts` already derives actual scheduled wake-ups from
session evidence and should answer "did it wake up?" rather than CLI bookkeeping.

### `log` — a merge-and-push per line is a git robot in a shared tree

`overseer log '<one line>'` was to append a UTC line, commit, merge `origin/dev` and push. In a tree
several agents share that is: a half-merged checkout on a conflict; a decision that exists locally and
nowhere else when the push is rejected; concurrent calls committing each other's text; and a constant
naming today's plan doc that is tomorrow's stale constant. It also does not mechanically hold the
gate it claims to — a free-text line can omit who decided.

What v1 should be: **format and append, and nothing else.** Required `--by overseer|greg` and
`--kind decision|assumption|decline|fact`, the instant generated (`new Date().toISOString()` is UTC
by construction — `date -u` is a shell habit that does not belong in TypeScript), appended under a
short lock, and the correctly-formatted line printed for a human to land. The real decision log is
`docs/project/overseer.md` § gate 1's **NOT BUILT** block and should be designed there, not inferred
here.

## Open questions for the Overseer

1. **Third-party worktree removal** — the question for Greg, worded above under `closeout`. Nothing
   in that command can be built until it is answered.
2. **`mine` is an annotation, not a filter.** Sol wanted `mine` dropped: the Overseer is *"the sole
   Overseer for the whole box"*, so a hand-maintained allowlist guarantees that a session started
   elsewhere, resumed after a reboot, or missed by a failed `mine add` silently disappears from the
   tick — an omission that looks like a quiet fleet. That argument is right about the *filter* and
   wrong about the *cost*: fetching the last turn of all 18–35 sessions every half hour is one HTTP
   call each. So `tick` lists **every** session in the register, and `mine` decides only whose last
   line is fetched — and **the tick names the sessions it did not fetch**, so an omission is visible
   rather than invisible. Recorded as a decision; say if the Overseer disagrees.
3. **A doc section in `docs/project/overseer.md` § What you actually do** pointing at the CLI is a
   rule-doc edit, so it is *not* in this branch's commits. It goes to the Overseer in the debrief as
   before/after, per [edit-important-docs.md](../reusable/edit-important-docs.md).
4. **`scripts/overseer-queue.ts` still hand-rolls its own parser**, so "one parser in the repo" is
   not yet true even after this stage — Sol's correction, and it is right. Converting it is a small
   follow-up and belongs in whoever's file set that is.
5. **The library-selection decision has no checked-in artifact.** `docs/reusable/third-party-library-selection.md`
   asks for a doc recording the choice; this plan's authority for Commander is an unlanded sibling
   session's transcript. When `gjd-remote-argument-parsing` lands, its plan is that artifact and this
   should cite it.
