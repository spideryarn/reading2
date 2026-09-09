# A `reusable/` top-level folder that can become its own repo

**Status, 2026-09-09: nothing has landed, and that is deliberate.**

Stage 1 — the docs move — is **built, reviewed by GPT Sol, and committed to a worktree branch only**.
It is not on `dev` and must not be pushed there until Greg says so. It renames a directory that six
live sessions' briefs, `AGENTS.md`, and every review recipe currently name, so landing it under them
is a coordination problem rather than a merge — § Landing it, below, is what that costs.

Stage 2 — the code — has a **decision** and no implementation. Greg, 2026-09-09, choosing between
"a directory only", "its own project inside this repo" and "a separate repo now": **a separate repo
now.** He then held it: *"I've told it to stop before implementing the plan … it probably requires
some coordination, including perhaps creating the repo first on GitHub so you can clone and move
stuff in there, and/or pausing other work. So I'd say let's hold off on implementing that until you
have my say-so"* (relayed by the Overseer). § Stage 2 records what that decision costs and the four
things only Greg can answer.

Greg, 2026-09-09:

> I'd like to create a `reusable` top-level folder that we can eventually pull out as its own repo,
> completely separate from the rest of the Spideryarn repo, that other agents can make use of. Move
> `docs/reusable` into `reusable/docs/`, same for reusable scripts, and all the stuff around
> [overseer.md](../project/overseer.md) and the web dashboard and anything related. … In practice I
> don't imagine it'll be quite so straightforward. Do the easy stuff, with review from GPT Sol. Then
> let's discuss the tricky stuff that needs decisions/tradeoffs.

## What this is for, in plain words

Two different things live in this repo. One is Spideryarn — the reading app, its pipeline, its
database, its readers. The other is **the machinery Greg uses to build things with agents**: the
instruction notes ("how to do this kind of task well"), `gjd-remote` for driving the box, the fleet
dashboard, the Overseer that keeps thirty agents moving. The second one has nothing to do with
reading articles. It grew here because this is where Greg was working, and it will be wanted in the
next project too.

The goal is that somebody can lift the tooling out of this repo and have a working thing, rather than
spending a week untangling it. Greg's decision on 2026-09-09 is that this happens **now** rather than
eventually: the tooling becomes its own repository. Whether the 39 instruction notes go with it is
**open** — Q2 in § Stage 2 — and it is not a detail, because they are cited some 2,400 times from
`docs/`.

### Jargon, once

- **Worktree** — a second checkout of the same repo on disk, on its own branch, so several agents can
  work at once without treading on each other.
- **`git subtree split`** — the git command that takes a subdirectory's whole history and produces a
  standalone repo from it. It works cleanly only if the subdirectory is genuinely self-contained.
- **Lane** — this repo runs its tests in three groups (`unit`, `private-postgres`,
  `shared-services`), because some need a database and some must not have one.
- **Pin / fingerprint** — the Overseer refuses to run a standing job unless a hash of *what the job
  does* — including the path and bytes of the document that authorises it — matches a number checked
  into the source. Moving a pinned document therefore stops its job until a person re-pins it.

## Stage 1 — the docs. Built, 2026-09-09

`docs/reusable/` → `reusable/docs/`. 39 files, with the references they contain rewritten for the
new depth.

Everything that named them was rewritten by
[`rw-reusable.py`](260909h-a-reusable-top-level-folder-review-prompt.md) (the script is quoted in
full in the review prompt beside this file), in four rules: 1,414 + 1,033 + 18 + 60 replacements
across 1,296 files, plus fourteen fixed by hand. `tests/doc-links.test.ts` checks every relative
Markdown link and anchor, plus bare doc references in its declared source-comment roots. Runtime
path strings and source comments outside those roots were swept separately; the link test is not an
oracle for them.

The following files needed a decision rather than a path swap:

| File | What changed, and why |
|---|---|
| `tests/doc-links.test.ts` | `SEARCH_ROOTS` and the `EVERGREEN` glob repointed at `reusable/docs`; `reusable/**/*.md` added to `DOC_FILES`; `"reusable"` added to `REPO_ROOTS`, without which a citation into `reusable/…` would have been silently treated as another repo's and skipped |
| `tools/overseer/standing-jobs.ts` | both standing jobs re-pinned — see below |
| `tools/overseer/idea-queue-seed.ts`, `scripts/count-lines.ts` | one path each; these are strings a program reads, not prose |
| `.vercelignore` | `reusable` added beside `docs`, so nothing here can reach a deployed function |
| `AGENTS.md` | the signpost, and one link text that had become a path |
| `reusable/README.md` | new: what the directory is for, and the rule that keeps it liftable |

### The re-pin, which is worth knowing about

Both standing jobs stopped matching their pins, for two different reasons, and the second is the one
that will catch somebody later:

- **`get-ready-to-deploy`** changed in all three path-bearing inputs: the prompt, the document path,
  and the document digest (eleven links or literal paths inside it were rewritten).
- **`feedback-sweep`** moved because `docs/project/feedback-reports.md` — which did not move at all —
  changed five references to three moved docs, so its digest changed.

So: a repo-wide path rewrite is a re-pin ceremony whether or not it touches a pinned job's own file.
Both jobs are switched off today (`infra/hetzner/provision.sh` creates
`OVERSEER_JOBS_ENABLED=0`, and nothing in `infra/hetzner/` sets it to `1`), and
both were re-pinned from `npx tsx scripts/overseer-pins.ts` after reading what changed: link paths and
nothing else.

### The simpler option passed over

Leaving the docs where they were and creating `reusable/` only when code moves. Rejected because the
docs are the more portable half, most of their move is a path rewrite, and doing it now means the
harder half arrives into a directory that already exists and already has a README saying what
belongs in it. The remaining project-specific seams are named in that README rather than treated as
already solved.

## What was measured, not assumed

Taken in this worktree on 2026-09-09. These numbers are what the decisions below rest on.

**The code is far less entangled than it looks.** `tools/` was built to run with the product's server
absent ([overseer-direction.md](../project/overseer-direction.md)), and it has largely kept to it:

| Coupling | Count | Where |
|---|---|---|
| `src/` or `api/` importing from `tools/` | **0** | — |
| `tools/` importing from `src/` | **6 files** | five are dictation (`transcribe.ts`, `routes-transcribe.ts`, `vocabulary.ts`, `web/src/DictationControl.tsx`, `web/src/dictation-client.ts`); one is `readiness-parse.ts` + `readiness-loop.ts` reading `vitest-admission.ts` |
| candidate `scripts/` importing from `src/` | **9 lines** | `gjd-remote.ts` (env, cli-ledger), `gjd-remote-env.ts`, `gjd-remote-envpolicy.ts` (OpenRouter + models), `readiness-loop.ts`, `worktree-check.ts` |
| third-party packages the candidate set needs | **7** | `react`, `react-dom`, `commander`, `smol-toml`, `lucide-react`, `@inquirer/prompts`, `@floating-ui/react` — plus vite and tailwind to build the dashboard |

**The tests cut cleanly.** 138 of the repo's 775 test files belong to the candidate set (80 `fleet-*`,
32 `overseer-*`, 19 `gjd-remote*`, 7 `worktree*`), and **not one of them is in a database lane** — they
are all `unit`. Their fixtures are eight directories under `tests/fixtures/`, all of them
fleet- or overseer-specific.

**The size.** Roughly 122,000 lines across `tools/fleet` (39.7k), `tools/overseer` (24.1k), the
dashboard client (30.8k), `gjd-remote` (15.2k), the overseer/fleet/readiness scripts (8.9k) and the
worktree scripts (3.6k). This repo comments heavily, so that is much less code than it sounds.

## Stage 2 — the code. Decided, not started

**Greg's decision: a separate repo now.** He was shown three levels of separation with their costs
and picked the furthest. The two he passed over, recorded because a plan should say what it did not
do: *a directory only* (move the files under `reusable/`, change nothing else — cheap, but nothing
enforces the separation and extraction day still costs everything below), and *its own project inside
this repo* as an npm workspace (`git subtree split` would then produce a working repo, and the
dashboard's tests would run in a minute rather than inside a 26-minute suite).

### What that decision costs, measured

Neither of these is an argument against it. They are the work it creates, and they were not visible
when the choice was made.

**The tooling is invoked by path, 1,280 times.** `npx tsx scripts/run-codex.ts`, `scripts/tmux-job.ts`
and `scripts/gjd-remote.ts` are how every agent here runs a cross-family review, a long job, or a
box command. Those paths appear **148 times in live docs** (`AGENTS.md` itself, `docs/project/`,
`reusable/docs/`, `infra/`) and **434 times in code**; the rest are in dated plans and postmortems and
can be left as history. Once the files live in another repo, each live one becomes either a
`../<repo>/scripts/…` path or a shim on `PATH`, installed on the box *and* the laptop. A shim is the
better answer: it survives the repo moving again, and it is the only form that reads the same in a
doc as it does in a terminal.

**The box's units name this repo's absolute path.** `overseer.service`, `overseer-watchdog.service`
and `fleet-dashboard.service` all carry `WorkingDirectory=/home/@USER@/code/spideryarn2` and
`ExecStart=…/spideryarn2/node_modules/.bin/tsx scripts/…`. Moving the code means editing those units
**and** `infra/hetzner/cloud-init.yaml` and `provision.sh`, which are the files that build the next
box — so it is a change to the machine and a change to the file that reproduces it, which
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) says must go together.

### Four questions only Greg can answer

1. **Name and location of the new repo**, and it has to be created on GitHub by him: this box has no
   GitHub CLI credential, so nothing here can create a remote.
2. **Do the 39 instruction notes go too?** The fleet *code* has zero inbound references from `src/`
   or `api/`, so it can leave without breaking anything here. The notes are the opposite: they are
   cited some 2,400 times from `docs/` and gated by `tests/doc-links.test.ts`, so taking them out
   turns every one of those into a dangling link. The recommendation is that the notes **stay** and
   only the tooling leaves — but that makes `reusable/` in this repo a docs-only directory, which is
   a different shape from the one asked for, so it is his call.
3. **History, or a fresh start?** `git subtree split` carries every commit that touched those paths
   into the new repo; `git init` starts clean and leaves the history findable only here.
4. **How this repo reaches the tooling afterwards** — sibling directory, git submodule, or PATH
   shims. This is the one that decides what those 1,280 path references become.

### The parts that are not Greg's, with recommendations

Recorded here so whoever implements stage 2 does not re-derive them.

- **The six couplings into `src/`.** Move the three dictation primitives that import nothing
  (`dictation-limits.ts`, `dictation-fillers.ts`, `vocabulary.ts`) into the new repo and let
  Spideryarn depend on *them*, which is the normal direction for a library. Make
  `readiness-parse.ts` take the admission-marker prefix as a parameter instead of importing
  `vitest-admission.ts` — the parsing is generic, the marker is this product's. Give
  `gjd-remote-envpolicy.ts` its own plain `fetch` rather than `src/ai-call.ts`, exactly as
  `tools/fleet` already does and as `src/spend-declarations.ts` explains. Inline `src/is-main.ts` into
  `worktree-check.ts`.
- **The 138 test files** (80 `fleet-*`, 32 `overseer-*`, 19 `gjd-remote*`, 7 `worktree*`) go with the
  code. They cut cleanly: not one is in a database lane, and their fixtures are eight self-contained
  directories under `tests/fixtures/`.
- **The docs that follow the code** out of `docs/project/`: the three Overseer docs, the two
  fleet-dashboard docs, `usage-history.md`, `cron-scheduler.md`, `hetzner-remote-server-box.md`.
  `readiness.md` and `worktrees.md` should **stay** — they are about this repo's checks and this
  repo's branch flow. Anything that leaves `docs/project/` loses its entry-point owner, so
  `AGENTS.md`'s seven-entry-point structure needs a line saying where those went.

## Landing it: what the coordination actually is

The docs move is one rename of a directory that every live session's brief names. It cannot be
landed the way an ordinary change is, and this section is the reason the branch is sitting
uncommitted-to-`dev` rather than pushed.

1. **Greg creates the GitHub repo first** (this box cannot), so the tooling has somewhere to be
   cloned to, and the two moves are not interleaved.
2. **A quiet window, taken at stage boundaries rather than imposed.** Sessions are paused the way the
   Overseer's runbook pauses them — *finish the step you are in, commit and push, then start nothing
   until the Overseer says resume* — not killed. An idle Claude session costs nothing; a session
   halfway through an edit to a file this rename touches costs a conflict nobody can read.
3. **The move lands as one push**, rename and link rewrite together. Splitting it would leave `dev`
   in a state where half the links are wrong, and `tests/doc-links.test.ts` runs against the working
   tree, so every session would go red at once for a reason none of them caused.
4. **Afterwards, every running session must `git fetch && git merge origin/dev` before its next
   edit** — and be told that `docs/reusable/…` is now `reusable/docs/…`, because a brief already in a
   session's context will keep naming the old path and the agent will believe it. The re-run of the
   rewrite script against whatever landed on `dev` in the meantime is part of the landing, not a
   follow-up.

## Status

- [x] Stage 1 — the docs move and its structural edits
- [x] GPT Sol review of stage 1 —
      [260909h-…-review-1-sol.md](260909h-a-reusable-top-level-folder-review-1-sol.md). One P0 (the
      new `reusable/README.md` was outside the citation gate), one real bug (a rewritten comment link
      in `UsagePanel.tsx` one directory short, resolving to `tools/reusable/`), and two claims of mine
      corrected — `OVERSEER_JOBS_ENABLED` is set to `0` by `provision.sh` rather than absent, and
      `get-ready-to-deploy`'s hash moved in all three of prompt, path and digest rather than path
      alone. All fixed in the branch; all four pins verified matching afterwards.
- [x] Gates: `npm run typecheck` green. Full `unit` lane 804/809 — the four reds are three missing
      builds in a fresh worktree (`cold-start-lazy-imports`, `pdf-bundle-trace`, and
      `fleet-decisions-route`, which needs `npm run build:fleet` and fails as
      `process.exit … "2"` rather than saying so) plus the three pre-existing anchor failures in
      `docs/plans/260909g-…`, confirmed red at `HEAD` before this branch existed.
- [x] Stage 2's shape decided by Greg — a separate repo now
- [ ] **Held, awaiting Greg's say-so**: the four questions in § Stage 2, and the landing in
      § Landing it. Nothing is pushed to `dev` but this plan and its review.
- [ ] Stage 2 onwards

### Where the work is

The docs move is committed on branch `worktree-reusable-folder` in the worktree
`.claude/worktrees/reusable-folder`, and **nowhere else**. The commit sha is in the debrief that
accompanies this doc. Do not remove that worktree: the branch is the only copy, and
`npm run worktree:check` is the check to run before anyone ever does.
