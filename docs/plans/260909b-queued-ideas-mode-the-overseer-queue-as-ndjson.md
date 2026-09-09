# "Queued ideas" mode — the Overseer's queue as NDJSON, editable from the dashboard

**Status, 2026-09-09 01:15 UTC: PAUSED AT THE SKELETON, nothing built.** The Overseer asked every
session it had dispatched to stop before spending anything: the five-hour usage window went 8% → 40%
in the 84 minutes to 23:50 UTC with half the current session count, it resets at 02:50 UTC, and Greg
had gone to bed having asked for agents to be paused rather than risk the fleet freezing the window
shut. So this file is the design as far as reading the tree got it, written down so the next session
— or this one after "resume" — does not have to re-derive it. **No code, no tests, no Sol review, no
subagent has run.**

Up: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) via
[overseer-queue.md](../project/overseer-queue.md), which is the doc this work turns into a file.

## What Greg asked for

> add a mode for "Queued ideas" that shows a list of ideas that will each get turned into a prompt
> for their own new-claude agent (probably running engineering-manager.md). I think we said that as a
> stopgap we'd create @docs/project/overseer-queue.md that we could write ideas to - it occurs to me
> that this would be much better if it was NDJSON, to make it easier to append, query, include
> metadata etc. Ideally the UI would allow the user to edit ideas, reorder the queue, and get an
> estimate of how long the wait time is. And also to add a new item (choosing whether it goes to the
> front or back of the queue).
>
> — Greg, 2026-09-08

## What this queue is, and why that constrains the design

The queue is not a todo list; it is **the Overseer's authorisation**.
[overseer.md § gate 3](../project/overseer.md) ends *"nothing dispatched that Greg did not queue"*,
and its test is literally *"is it in the queue?"*. Three consequences the design has to respect:

- **Editing, reordering and adding are Greg's acts.** Every write records who did it and when, and
  the dashboard writes as speaker `greg` — the same `Speaker` discipline
  [`wire.ts`](../../tools/fleet/wire.ts) already enforces, and for the same reason (gate 1: an
  Overseer proposal must never acquire Greg's authority by looking like his instruction).
- **The Overseer reads the queue and does not reorder it.** A supervisor that can promote its own
  proposals has no gate 3 left.
- **An item is two things at once:** Greg's idea *in his words*, and enough metadata for the
  Overseer to write the brief it would otherwise compose by hand. Tonight's dispatches show what a
  brief needs — the quoted words, the file set, the sessions already in flight, and the reusable doc
  to run — so those are the metadata fields, not a guess at what might be useful.

## The decision that has to be made before any code: one line per item, or append-only events

Greg said NDJSON, which settles the format and not the shape. Two shapes, and this plan recommends
(b):

**(a) One line per item, file rewritten on reorder or edit.** Simple to read and to reason about.
Loses history, so *who moved this to the front and when* is unanswerable. Two writers lose each
other's edit with nothing to say so.

**(b) Append-only events — `added`, `edited`, `moved`, `dispatched`, `done`, `dropped` — folded to
the current list.** Append is the only write, so the file is never rewritten and a torn line is the
only failure mode (and [`jsonl.ts`](../../tools/overseer/jsonl.ts) already repairs exactly that, on
open, for the two logs that came before this one). History and provenance are free rather than a
feature. A reorder is a `moved` event naming the neighbour ids. The fold is a pure function with a
test, which is the part worth having a test for.

**Recommendation: (b).** The repo has two precedents and both are append-only —
`~/.fleet-health/health.jsonl` (writer under `writer.lock`,
[`health-wiring.ts`](../../tools/fleet/health-wiring.ts), bounded reader in
[`routes-health-history.ts`](../../tools/fleet/routes-health-history.ts)) and
`src/web/changelog-versions.ndjson`, whose rule
([changelog.md](../project/changelog.md)) is *"a run adds lines to the end and never rewrites what is
above"*. And the two primitives this needs — append-only discipline and single-writer exclusion —
exist already as [`jsonl.ts`](../../tools/overseer/jsonl.ts) and
[`lock.ts`](../../tools/overseer/lock.ts), both extracted precisely because the rule had been written
twice. Shape (a) would reuse neither. **To confirm with Sol before Stage 1 is built.**

### Where the file lives — *needs Greg*

A product call that outlives the branch, so it goes to the Overseer as *needs Greg* rather than being
defaulted quietly:

- **In the repo** (versioned, visible to every agent and to Greg's Mac) — but a live web page editing
  a checked-in file leaves the primary checkout dirty and collides with other agents' commits, and
  the queue would then change under `git merge`.
- **On the box, `~/.overseer/queue.jsonl`** (single writer, survives a reboot, no merge conflicts,
  same directory and the same lock discipline as everything else the Overseer owns) — but not
  versioned, and invisible from the Mac.

**Default while waiting: the box file**, beside the store the Overseer already treats as the record,
with a CLI that can print or export it so nothing is trapped there.

## Item shape (proposed, for Sol)

`id` · Greg's `text` verbatim · optional `title` · position · metadata (`source` plan, `waitingOn`,
size guess, files/areas touched, the reusable doc to run — e.g. `engineering-manager.md`) ·
`status` (`queued` | `blocked-on-greg` | `dispatched` with session name | `done` | `dropped`) ·
`addedBy`/`addedAt` · edit history (free, given shape (b)).

## The wait estimate: honest, or absent

Position in queue × observed median session length ÷ the concurrency the Overseer is actually running
at. Session lengths come from the store — `RegisterEntry.startedAt` in
[`store.ts`](../../tools/overseer/store.ts), and `session-seen`/`tmux-session-gone` in
`events.jsonl`. Shown **as a range with its assumptions printed beside it**, never a single confident
number, and **"cannot estimate yet" when there is no history** — a survey cannot see an
absent state, and a fabricated estimate is worse than a blank.

Times in UTC/London/Athens. `tools/fleet/zones.ts` does not exist yet (checked: not on `dev` at
`15e2d48b`) — it is landing from `260908f-roadmap-usage`, so this must not hard-depend on it.

## Stages

- [ ] **Stage 1 — the file, the fold, the CLI, the migration, and a read-only mode.** The queue
      module and its pure fold (test first, red then green); `npx tsx scripts/overseer-queue.ts
      list|add|move|edit|drop`, because the Overseer works from a terminal; the sixteen clusters and
      their *waiting on* column from [overseer-queue.md](../project/overseer-queue.md) migrated in as
      the first items; a `GET` route on the fleet server; and the "Queued ideas" mode showing the
      queue in order with status, waiting-on and the estimate. `overseer-queue.md` keeps its one
      parent and becomes the explanation, pointing at the file and the mode — pointers need no
      approval, but rewording its rule sentences is an approved-set edit
      ([edit-important-docs.md](../reusable/edit-important-docs.md)).
- [ ] **Stage 2 — writes from the page.** Add (front or back), edit text and metadata, reorder (drag
      on a desktop, up/down buttons on a phone), drop. Each a `POST` with the
      client-claims-server-checks shape of [`routes-rename.ts`](../../tools/fleet/routes-rename.ts) —
      same-origin check, the hostname allowlist that closes DNS rebinding, a body cap, an error
      `Record` so a new code fails to compile rather than inheriting a guess. **A write whose base
      version is stale is refused, not merged over.**
- [ ] **Stage 3 — design only.** The Overseer taking the head of the queue into a brief and a
      `new-claude`, and what it writes back (`dispatched`, session name, plan path). Dispatch stays
      `gjdRemoteDispatch` in `tools/overseer/jobs.ts` and belongs to the coordinator session; **this
      stage builds no launcher** and is not started before the coordinator and Greg agree.

## The simpler option this passed over

**Leaving it as prose in `overseer-queue.md`.** It works today, costs nothing, and needs no route, no
fold and no lock. It is being replaced because Greg asked for the three things a Markdown table
cannot do — reorder, edit and estimate from a phone — and because *"is it in the queue?"* is a
question a gate asks mechanically, which wants a file with ids rather than a table somebody greps.

## File set

Mine, and new: the queue module and its fold, the CLI, the route, the client, the mode component,
the tests. `docs/project/overseer-queue.md` — pointers freely, rule sentences by approved set.
`server.ts` — one mount line. `wire.ts` — one new block at the END only.
`tools/fleet/web/src/mode.ts` and `Dock.tsx` — my own entries in `MODES`, `MODE_ICONS`, `MODE_TIPS`,
`MODE_LABELS`, added in one commit, never touching another mode's; and **count the entries after
merging `origin/dev`**, because a merge can drop one with no conflict marker. `App.tsx` — one
additive mount.

Not mine: `tools/overseer/jobs.ts`, `scheduler.ts`, `infra/` (the coordinator, session
`overseer-md-agent-coordinator`); actions/steer/kill/drain and `tools/fleet/queue.ts`, which is the
dashboard's **steering** queue and is why this one must not be called `queue.ts`
(`claude-agents-dashboard`); `collect.ts`/`store.ts`/`daemon.ts`/`diff.ts`; `scripts/gjd-remote*.ts`;
`docs/project/overseer.md`, whose rule text is Greg's.

Keys already taken in `MODES` by sessions in flight tonight: `usage`, `messages`, `deploys`, and
`readiness-tab` is choosing one. On `dev` at `15e2d48b` the list is still the original three
(`sessions`, `health`, `overseer`), so all four are unlanded and this must merge before it counts
entries.

## What was verified rather than assumed, at `15e2d48b`

- `MODES` on `origin/dev` is `["sessions", "health", "overseer"]` — the four new keys are all still
  in flight.
- `tools/fleet/zones.ts` does not exist on `dev`, so the multi-zone clock is a soft dependency.
- `jsonl.ts` (`truncateToLastLine`, `writeAll`, `writeAtomically`) and `lock.ts` (`takeLock`,
  `stillOurs`, `releaseLock`) are importable and know nothing about stores — they take a path. This
  needs no new append-only or locking code.
- `~/.overseer/` holds `events.jsonl`, `current.json`, `daemon.jsonl` and `overseer.lock`; the queue
  file would be a fifth thing in a directory that already has one writer and one lock convention.
