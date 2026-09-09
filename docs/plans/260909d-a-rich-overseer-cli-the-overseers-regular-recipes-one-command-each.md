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
4. ~~**A group command gets no usage row of its own** — `mine` is not runnable, `mine add <name>` is.~~
   **This was wrong, and Sol's code review caught it.** `mine` *is* runnable: its default subcommand
   is `list`, and this branch's own parser test asserts that bare `mine` works. So `usageRows`
   recursing to the leaves makes the generated help omit a supported spelling — in the one file
   whose entire claim is that generated help cannot drift from the parser. The fix is to render the
   default-child spelling, `overseer mine [list]`.

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
- [x] Tests against a fake dashboard (fixtures for `/api/state` and `/api/messages`) and a fixture
      `~/.claude.json`: a stale cache is dated, an absent one is *unknown* and never 0%, a session in
      `mine` that the dashboard cannot see says so rather than being omitted.

**Status: done. Implemented by GPT Codex** (`gpt-5.6-sol`, `--sandbox workspace-write`) from
[260909d-stage2-codex-task.md](260909d-stage2-codex-task.md); its answer is
[260909d-stage2-codex-answer.md](260909d-stage2-codex-answer.md). I reviewed the diff, ran the tests
and typecheck outside its sandbox, and exercised the real command against the live box. This is the
first stage under Greg's 2026-09-09 instruction to delegate implementation to GPT while the Claude
weekly window is at 76%.

Verified rather than taken on report: 87 tests green across the four suites, `npm run typecheck`
exit 0, `npx tsx scripts/overseer.ts tick` and `… last <session>` both correct against the live
fleet. **Codex reported one test failing in its sandbox and it was not its code** — `tsx` is denied
its Unix IPC socket there, so the two child processes in the lost-update test cannot start; both
pass here.

Three things worth keeping:

- **The `messages-client.ts` reuse did not work, for a checkable reason.** Importing the browser's
  parser drags `tools/fleet/web/src/messages-client.ts` into the root NodeNext project, where its
  Vite-valid extensionless `./types` import is TS2835. Fixing that is a `tools/fleet/` edit, outside
  the file set, so `cli-messages.ts` preserves the same four-arm contract locally. The shared core is
  still the right end state.
- **The skipped-session list is one line, not one per session.** The first shape printed
  *"not in mine; last turn not fetched"* for every session — honest and unreadable: thirteen of them
  pushed the register, the inbox and the usage band off a screen the Overseer reads under time
  pressure. Collapsed, every skipped name is still printed and counted. **The two reasons stay
  distinct**, because "not in mine" is a choice and "the list could not be read" means nothing was
  fetched for anybody — a broken tick wearing a quiet tick's clothes. Mutation checked.
- **Codex's own test caught my change to it**, which is the thing you want from a delegated test.

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

### Stage 1b — the Stage-1 code review's findings

[260909d-stage1-code-review-sol-r1.md](260909d-stage1-code-review-sol-r1.md). Done:

- [x] **P0 — a malformed known field became valid empty state.** `o["mine"] ?? []` meant
      `{"mine": null, "paused": null}` parsed as a legitimate empty list: `mine list` said *nothing
      is being looked after* and the next `mine add` replaced the malformed file. **The module's
      central guarantee, defeated by the one line that did not think of itself as a parse** — and a
      test of mine (*"missing keys are empty lists, because a first write need not carry both"*)
      had certified it, while no writer that omits a field exists. Both keys are now required and
      `null` is `unusable`; that test now asserts the opposite.
- [x] **P2 — the pause instant did not enforce its own stated contract.** `Date.parse` accepts
      offsets, so `2026-09-09T09:00:00+02:00` (07:00Z) sorted *after* `2026-09-09T08:00:00.000Z`
      under the lexicographic sort, and *"resume oldest-first after the reset"* would have woken the
      fleet in the wrong order with nothing looking wrong. Canonical `toISOString()` form is now
      required on read and on `recordPause`.

Mutation checked, both: restoring `?? []`, and relaxing `isCanonicalInstant` to
`!Number.isNaN(Date.parse(s))`, each turn their test red.

Still open, and they live in `scripts/overseer.ts` which a Codex run holds while Stage 2 is built:

- [ ] **`usage --help` exits 1 as an unknown option.** `.helpOption(false)` is inherited at
      creation, so every subcommand's `--help` is an unknown option. Re-enabling help alone is not
      enough: `exitOverride` then throws a `CommanderError` with `exitCode === 0` and code
      `commander.helpDisplayed`, which the current catch would still turn into an error. Keep stdout
      and stderr captures separate and classify on `CommanderError.exitCode`/`code`.
- [ ] **`overseer mine [list]` is missing from the generated help** — see the correction above.
- [ ] **`reconcile-jobs` lost its safety-specific refusal.** An absent `--why` used to print four
      lines telling the operator to look at the log and `gjd-remote ls` before clearing a hold that
      exists because nobody can tell whether a job already ran; it now prints Commander's generic
      *required option not specified*. Worse: **deleting the `why.trim()` check leaves the new suite
      green**, because the blank-reason test only asserts that parsing succeeds. That is a hole in a
      test I wrote about a seam I had explicitly noticed.
- [ ] **P2 — `NAME_RULE` is imported from an HTTP route module.** Not dangerous today (no
      import-time effects, and the seam test guards the other direction), but the session-name
      grammar should be a dependency-free leaf that both the route and the CLI use. `tools/fleet/`
      is not this session's file set.

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

**And the waiver is narrower still than "the owner may."** `shouldWaiveFloor` is
`live.authorised && live.inUse.kind === "idle"`
([`worktree-remove.ts:362`](../../scripts/worktree-remove.ts)) — so an **inconclusive** liveness
check costs the waiver *even when the owner is the one asking*. That is deliberate (an `unknown` that
failed open would fail open for exactly the caller most in a hurry), and it means the obvious
work-around is not a complete fix either. Read out of the source by session `codex-usage` on
2026-09-09 and confirmed here; `MIN_IDLE_HOURS` is reachable only through `RemoveOptions.minIdleHours`
and the CLI parses just `--branch` and `--dry-run`, so no flag reaches it.

**What would unblock it — a question for Greg, in one piece:**

*Background: every agent works in its own git worktree, a throwaway copy of the repo. When it
finishes, somebody has to delete that copy. Today only two things can: the agent itself, while it is
still running; or anybody at all, once the directory has been untouched for 24 hours. That floor
exists because "nothing is running in it" is not the same fact as "the work is finished", and
deleting a worktree destroys the only copy of anything not committed.*

*The problem: the Overseer reads an agent's final debrief a few minutes after it stops, which is
exactly when it knows the work is done and exactly when it may not act. Nine worktrees accumulated in
one night and none could be removed.*

*Three ways, and none is free:*

*(a) **Let the Overseer waive the floor when it attests it read the debrief** — a flag on
`worktree:remove` recording who attested and why. Cost: the attestation is a self-declaration, so the
protection becomes a governance rule rather than a mechanical one — the same trade the queue's
`--by greg` already makes. Keeps the branch either way.*

*(b) **Have each agent remove its own worktree as its last act**, on the Overseer's say-so. Cost: it
needs no new authority at all, but it only works while the agent is alive — an agent that has already
exited, crashed or been killed cannot be told, and those are a good share of the cases. It also does
not always work: if the liveness check is inconclusive the owner loses the waiver too.*

*(c) **Leave it as it is** and let worktrees sit for a day. Cost: disk, and a `git worktree list`
nobody can read — but nothing is ever lost.*

**Two measured facts that make (c) less bad than it sounds, and one catch-22 that does not exist.**
The floor is counted from `lastActivityAt`, the latest of the HEAD reflog, the branch reflog and the
admin directory's mtime — so it is **24 hours from the tree's last git write, not from when the
session ended**. For an agent that commits as it goes and then spends two hours on review rounds,
the clock started at the last commit. And the obvious catch-22 — the Overseer is *required* to run
`npm run worktree:check` first, so if checking touched the admin directory it would reset the very
clock it is waiting on, putting removal permanently out of reach — **does not happen**: measured on
this worktree, admin-dir mtime `1788941260` before `npm run worktree:check` and byte-identical
after. So the check is free to poll as often as a tick likes. Found and measured by session
`codex-usage`, reproduced here independently. Recorded because a plausible failure that did not
reproduce is the thing most likely to be re-suspected by the next person.

*I would ask for (a), because (b) fails in exactly the cases where a worktree gets stranded and (c)
is what we have now. But it converts a mechanical protection into a recorded promise, and that is
your call rather than mine.*

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
