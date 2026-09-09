# Review this plan before it is built: a rich `overseer` CLI

You are GPT Sol, reviewing a **plan** (not code) for the spideryarn2 repo. Be adversarial. Your job
is to find what will go wrong, what is over-built, and what the plan has assumed without checking.

## The context you need

The "Overseer" is a permanently-running Claude Code session on a shared Linux box that supervises a
fleet of 20-35 coding agents. Its runbook is `docs/project/overseer.md` (read it — it is the
specification). It has four **gates** — things it may never do on the user's (Greg's) behalf:

1. Never hide who decided (every message it sends is attributed to it, never to Greg).
2. Answer facts, route judgement, default the product call.
3. Never the irreversible, and never work of its own devising. Concretely: no deploy, no push to
   `main`, no production DB write, no spending money, **no destroying work that has no second copy**
   (so `npm run worktree:check` INSIDE a worktree before removing it), **no killing a session with
   unpushed work**, no keystrokes at a pane with a dialog open, no git that throws work away, and
   **nothing dispatched that Greg did not queue**.
4. Never spend what you are rationing (the shared Claude usage quota).

Today, every recipe the Overseer runs regularly is a hand-typed chain of shell inside its context
window. The chains drift — four decision-log timestamps were written in BST instead of UTC on the
morning of 2026-09-09 because the chain that wrote them used `date` rather than `date -u`. The plan
turns each recipe into a subcommand of an existing CLI (`scripts/overseer.ts`, which already has
`run`, `status`, `usage`, `events`, `notes`, `attention`, `reconcile-jobs`).

Repo conventions that bear on this:
- `AGENTS.md` (= `CLAUDE.md`): prefer boring; prefer simple over easy; simplest version first; let
  the types catch it (`strict`, `noUncheckedIndexedAccess`); `console.log` from a CLI, `src/log.ts`
  from a server; reproduce a bug with a failing test before fixing; "a check you have never seen
  fail is not evidence" (`docs/reusable/silent-success.md`).
- Tests are vitest. Long runs go through `scripts/tmux-job.ts`.
- Several other agents are editing `tools/overseer/` and `tools/fleet/` concurrently right now.

## The plan

# A rich `overseer` CLI: the Overseer's regular recipes, one command each

**Status as of 2026-09-09: planned, nothing built.** Evidence: `git log --oneline -1` on
`worktree-overseer-cli` is `f17a8cd1`, the merge-base with `origin/dev`; `commander` appears in
neither `package.json` nor `node_modules/`.

Session `overseer-cli`, worktree `overseer-cli`, queue item `qi-njy5v8ze`. Dispatched by the
Overseer.

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

- [ ] `npm i commander`, pinned.
- [ ] Convert `scripts/overseer.ts`'s hand-rolled `flag`/`positiveNumberFlag`/`switch` to Commander,
      keeping every existing subcommand's behaviour and exit codes byte-identical.
- [ ] Root help stays prose; the flag rows are generated from the registered commands.
- [ ] `tools/overseer/cli-state.ts` — typed read/write of `~/.overseer/cli-state.json`.
- [ ] `overseer mine [list] | add <name> | rm <name>`.
- [ ] Tests: every existing subcommand still parses and refuses the same way; `cli-state` round-trips,
      tolerates an absent file, and refuses a corrupt one rather than starting empty.

**Why the conversion is in scope rather than "new commands only":** two parsers in one file is
exactly the second-way-to-do-the-same-thing that AGENTS.md § Prefer simple over easy forbids.

Status: not started.

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

### Stage 3 — `closeout` and `log` (the two that touch git)

- [ ] `overseer closeout <session> --sha <sha>` per the recipe above, `--dry-run` supported.
- [ ] `overseer log '<one line>'` — `date -u`, append to the decision-log plan doc named by a
      constant, `npm run check:staged-revert`, `git add` + `git commit -F` + pathspec, merge
      `origin/dev`, push, print the sha.
- [ ] Tests: a disposable git repo with a real remote for both; a stub `gjd-remote`; a stub
      `worktree:remove`. Mutation-check the refusals — comment out the `worktree:check` step and the
      test must go red.

Status: not started.

### Stage 4 — `dispatch`, `pause`, `resume`

- [ ] `docs/project/overseer-brief-common.md` — the common "How to run this" brief, moved out of the
      Overseer's scratchpad, with a signposting line under
      [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md).
- [ ] `overseer dispatch <qi-id> --name <session> --brief <file>` — queue `show`, refuse unless
      `isDispatchable` (printing `whyNotDispatchable`), `gjd-remote ls` claim check refusing on an
      existing name, assemble brief + common, `gjd-remote new-claude <name> --no-attach -p -`, then
      queue `dispatched --by overseer --session <name>`, then `mine add`.
- [ ] `overseer pause <session>` / `resume <session>` — the exact sentence from overseer.md § The
      tick, through `POST /api/steer/message` with `speaker: "overseer"`, recorded in `cli-state`.
      `--record-only` for when the Overseer sent it itself. `resume --check` reports which paused
      sessions have since written a turn.
- [ ] Tests: a stub `gjd-remote` and a fake steer route; a `partial` delivery is reported as
      `partial` and **never** retried.

Status: not started.

## Open questions for the Overseer

1. **The branch deletion** in `closeout` — see above. Implemented as delegation to `worktree:remove`;
   say if the Overseer wants `--keep-branch` instead.
2. **A doc section in `docs/project/overseer.md` § What you actually do** pointing at the CLI is a
   rule-doc edit, so it is *not* in this branch's commits. It goes to the Overseer in the debrief as
   before/after, per [edit-important-docs.md](../reusable/edit-important-docs.md).


## What I want from you

Rank findings P0 (must fix before building) / P1 (should) / P2 (opinion). For each, say what
concretely goes wrong and what you would do instead.

Please cover at least:

1. **The subcommand list is a spec to challenge.** Which of the seven would you drop or merge, and
   why? Which is the one most likely to be built and then never used? Is there a recipe in
   `docs/project/overseer.md` that clearly deserves a subcommand and is missing from this list?

2. **`closeout`'s departure from the brief.** The brief said "never delete a branch"; the plan
   delegates to `npm run worktree:remove -- --branch <name>` (read `scripts/worktree-remove.ts`),
   which deletes the branch behind a landed proof and a compare-and-swap. Is that reasoning sound,
   or is the plan talking itself past a gate? Is the ORDER of closeout's seven steps right — in
   particular, is there a TOCTOU between the `worktree:check` at step 3, the kill at step 4 and the
   removal at step 5, and does it matter?

3. **"Debrief-shaped" is a judgement the plan claims is mechanical.** `closeout` refuses if the
   session's last turn is not debrief-shaped. `docs/project/overseer.md` § Things that will catch
   you records that a mechanical check for question marks found 1 of 23 sessions that were actually
   waiting, because "decisions end in full stops". What is the honest version of this check, and
   should it refuse or merely warn?

4. **Composing rather than shelling out.** The plan imports `collectHealth()`, `parseUsageCache()`
   and `statusLines()` instead of running `free`, `python3` and `npx tsx scripts/overseer.ts status`.
   What breaks when a subcommand that is meant to keep working during a box emergency is now
   importing a large module graph? Is there a case for the tick keeping a degraded path?

5. **State.** `~/.overseer/cli-state.json`, written by read-modify-write + rename, this CLI as sole
   writer, the daemon never touching it. Two concurrent `overseer mine add` invocations. Is
   rename-atomicity enough, or does this need the repo's existing lock (`tools/overseer/lock.ts`)?
   The daemon holds a lock on that directory — does a second file in it create a problem?

6. **Testability.** Each subcommand is meant to be testable against a fake dashboard, a disposable
   git repo, and a stub `gjd-remote`. Which of the seven is the one that will end up with a test
   that passes without exercising anything (`docs/reusable/silent-success.md`)? Name the specific
   mutation each stage's tests must fail against.

7. **Stage boundaries.** Four stages: (1) Commander + state + `mine`, (2) `tick` + `last`,
   (3) `closeout` + `log`, (4) `dispatch` + `pause`/`resume`. Is stage 1's conversion of the
   existing seven subcommands to Commander worth its risk, given other agents are editing
   `tools/overseer/` concurrently? Would you sequence differently?

8. **Anything the plan has assumed without checking.** Especially: is there an existing thing in
   this repo that already does one of these seven, that the plan has missed?

Read the actual files before answering — `scripts/overseer.ts`, `scripts/worktree-remove.ts`,
`scripts/worktree-check.ts`, `scripts/overseer-queue.ts`, `tools/fleet/routes-steer.ts`,
`tools/fleet/health.ts`, `tools/overseer/usage.ts`, `docs/project/overseer.md`.

**Check the plan's own conclusions, not only its reasoning.** If the plan's "Status as of" line, its
table, or its claim about what already exists is wrong, say so.
