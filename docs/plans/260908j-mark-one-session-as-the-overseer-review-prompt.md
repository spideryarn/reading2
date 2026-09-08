# Review this plan before it is built

You are GPT Sol, giving a cross-family review of a plan doc in the Spideryarn repo, before any code
is written. Be adversarial. Rank findings P0 (must fix before building) / P1 (should) / P2 (worth
knowing). Say plainly if the plan is fine.

## The job

There is a "fleet" of 20-35 Claude Code coding agents running in tmux sessions on one Linux box. One
of them is meant to be "the Overseer", a permanent supervising session. Right now nothing on the box
marks which session that is: the runbook says "you become the Overseer by reading this file", so two
sessions can both believe they are it, and a scheduler that wants to prod the Overseer cannot find it.

The task: a way to mark exactly one live session as the Overseer, refuse a second claim, make the
claim visible in `gjd-remote ls`, in the fleet dashboard (a React page fed by a JSON snapshot), and in
`npx tsx scripts/overseer.ts status`. The brief insists on the simplest thing that works, and points
at the tmux session environment, where session identity is already pinned at launch.

## What to check

1. Is the mechanism (a role string in the tmux session environment) actually adequate, or is there a
   failure mode the plan has not seen? Especially: anything that would make a reader report the WRONG
   answer rather than an honest "I cannot tell".
2. Is the "advisory, not a mutex" trade-off honestly stated, and is the residual race genuinely
   tolerable given the reader treats >1 holder as a fault?
3. The decision NOT to bump `METADATA_VERSION`. Is the reasoning sound?
4. The `SessionRole` union and where `cannot-tell` is produced. Is any claimed producer wrong, or any
   real producer missing?
5. Anything in the staging that will not survive contact with the code.
6. Is anything here more complexity than the job needs? The house rule is "simplest version first",
   and the plan should be attacked from that side too, not only from the side of missing rigour.

## Context you need about the code

- `scripts/gjd-remote-tmux.ts` builds a shell script that runs `tmux ls -F` and then, per session, a
  handful of `tmux show-environment -t "$sid" VAR` calls. Each session becomes one `|`-separated line
  with 13 fields (free text fields are base64'd). `parseSessionLine` requires EXACTLY 13 fields and
  refuses anything else. `parseSessions` refuses a short listing outright rather than reporting a
  smaller fleet.
- `META` is `{version: GJD_METADATA_VERSION, kind: GJD_KIND, repo: GJD_REPO, dir: GJD_REMOTE_DIR}`.
  `parseMeta` returns `{version:"legacy"}` only when ALL FOUR are absent; a version it does not know
  FAILS THE WHOLE LISTING with a message.
- `tools/fleet/collect.ts` imports that reader and turns `Session` into `FleetRow` for the dashboard.
  `tools/fleet/wire.ts` holds only types that cross HTTP and must never acquire an import;
  `FleetState<Row, Health>` is generic in the row. The browser client re-declares the row in
  `tools/fleet/web/src/types.ts` and parses it defensively.
- Verified on a disposable tmux socket before writing the plan: `show-environment -t <session> VAR`
  does not fall back to the global environment; `set-environment -u` removes it; the variable is gone
  when the session is killed.
- House rules that bind: strict TypeScript with `noUncheckedIndexedAccess`; "let the types catch it";
  an absent reading must never be reported as a negative one; a check that has never been seen to
  fail is not evidence.

## The plan

(The file `docs/plans/260908j-mark-one-session-as-the-overseer.md`, verbatim, follows.)
# Mark one session as the Overseer, and make the box able to find it

Up: [overseer-direction.md](../project/overseer-direction.md) — the direction. The runbook the claim
protects is [overseer.md](../project/overseer.md).

**Status: in progress, 2026-09-08.** Dispatched by the Overseer (session `Overseer`, `$2514`, peer
name `spideryarn2-a6`) from Greg's ask the same evening.

## What this is for

> Perhaps rename yourself as Overseer? And/or we would ideally like a way to mark you/this session as
> the singleton Overseer somehow? Maybe kick off an agent to handle this?
>
> — Greg, 2026-09-08

Tonight the Overseer is a Claude session Greg started by hand, and **nothing on the box can tell it
from any other session**. Peers saw it as `spideryarn2-a6`; the dashboard had no idea it was special;
the runbook says *"you become the Overseer by reading this file"*, which means **two sessions can
both believe they are it** and neither can find out. The scheduler being built under
[260908g](260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) needs to *prod
the Overseer*, so it needs the same fact — and a fact only one program knows is not a fact.

`overseer.md` says *"You are the **sole** Overseer for the whole box"*. That sentence currently has
nothing behind it. This gives it one bit of machinery.

## The design, and the simpler thing it is

**A role string in the tmux session environment, read by the readers that already read that
environment.** No lock file, no store schema change, no daemon change, no new store.

Session identity — `GJD_KIND`, `GJD_REPO`, `GJD_REMOTE_DIR`, `CLAUDE_SESSION_ID` — is already pinned
into the tmux environment at launch (`META` in
[`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts)), and both `gjd-remote ls` and
[`tools/fleet/collect.ts`](../../tools/fleet/collect.ts) already read it. So the role goes in the
same place, and every existing reader is one field away from carrying it.

Three properties fall out of that choice rather than being built:

- **The claim dies with the session.** A tmux session environment is the session's; killing the
  session takes it. There is nothing to garbage-collect and no stale lock to break.
- **The claim dies with the tmux server**, so a reboot or a `tmux kill-server` leaves *no* Overseer.
  That is the safe direction: the failure state is "nobody holds it", never "somebody who is gone
  still does". Whatever restarts the Overseer after a reboot claims it again.
- **A session-scoped claim cannot be faked by a global.** Verified on a disposable socket:
  `tmux show-environment -t <session> GJD_ROLE` does *not* fall back to the global environment, so
  `set-environment -g GJD_ROLE overseer` marks nothing.

### What the claim is not

**It is advisory, not a mutex.** `claim-overseer` reads the fleet, refuses if somebody else holds the
claim, sets the variable, and re-reads to check it is alone — but two simultaneous claims can both
pass the first read. That is why every *reader* treats "more than one holder" as a loud fault rather
than picking one. Locking it properly would mean a lock file with an owner pid and a liveness check
— the machinery the whole design is trying not to add — for a verb a human runs about once a week.
Named here so the next reader knows the refusal is a courtesy. (Raised by `spideryarn2-b6`.)

**A pane already running does not see it.** `set-environment` on a live session does not reach
processes that are already running in it, so a claimed session's own `process.env.GJD_ROLE` is empty.
The claim is for *readers looking in from outside*, which is exactly who needs it.

### `SessionRole` is a union, not `string | null`

Requested by `spideryarn2-b6` while reviewing the shape, and it is right:

```ts
type SessionRole =
  | { kind: "none" }
  | { kind: "overseer" }
  | { kind: "other"; name: string }
  | { kind: "cannot-tell"; why: string };
```

> Zero holders and "I could not look" are different facts and `null` collapses them. … it is the
> fourth instance today of an absent reading standing in for a negative one, and two of them were
> mine.
>
> — `spideryarn2-b6`, 2026-09-08

It matches `PaneAutoMode` and `Pause` rather than inventing a shape, and it means a caller cannot
write `role === "overseer"` against a value that was never read. **Where `cannot-tell` is actually
produced** matters more than the arm existing, and there are two real producers, neither of them
hypothetical:

- **the wire** — a dashboard server that predates the field sends rows with no `role` key at all, and
  a client that read absent-as-`none` would report "no Overseer" about a box that has one. This is
  `attemptedAt`'s documented problem in [`wire.ts`](../../tools/fleet/wire.ts), one field over.
- **a malformed value** — the variable is set to something this reader cannot decode. Something is
  there and we could not read it, which is neither none nor overseer.

It is *not* produced by "tmux was unreachable": that fails the whole listing and yields no rows at
all, which is a different and already-handled refusal.

### Why the version discipline is *not* bumped

`METADATA_VERSION` is `"1"`, and `parseMeta` fails **the whole listing** for a session whose version
it does not know. Bumping it to `"2"` would therefore break `ls` for every session alive on the box
right now. And the role is genuinely not one of those four: they are pinned at launch and are
all-or-nothing (`legacy` means *all four absent*), whereas a role is set and unset at runtime, on
sessions of any vintage. So `GJD_ROLE` joins `META` as a **name constant** and is read on its own,
the way `CLAUDE_SESSION_ID` and `GJD_PROVISIONAL` already are. The four-field invariant is untouched.

### The simpler option passed over

**`new-claude --overseer`**, claiming at launch. Not built: it threads a flag through the job-script
generation for a case that composes perfectly well out of `new-claude` followed by `claim-overseer`,
and the session that most needs claiming tonight is one Greg started by hand, which the flag could
never have helped. If the daemon later starts the Overseer itself, that is when the flag earns its
place.

**A lock file under `~/.overseer/`.** Rejected above: a second store for one bit, with a liveness
problem the tmux environment does not have.

### A correction to the brief

The brief says the role becomes an *"additive `wire.ts` field"*. **There is no row type in
`wire.ts`** — `FleetState<Row, Health>` is generic in its row, and the row is declared twice on
purpose: `FleetRow` in `collect.ts` (server) and again in `web/src/types.ts` (client), because
`collect.ts` reaches `node:child_process` and the client project has no node types. `SessionMeta` is
already handled exactly this way. So the additive block goes in those two files, `wire.ts` is not
touched at all — which also removes the collision the brief was worried about, since two other agents
are adding blocks to `wire.ts` tonight.

## Stages

1. **The reader.** `META.role`, `OVERSEER_ROLE`, `SessionRole`, the 14th field on the wire line,
   `parseRole`, `Session.role`. Tests: the parse (all four arms), and the end-to-end shell test with
   stub binaries. Red first.
2. **The verbs.** `gjd-remote claim-overseer <session>` / `release-overseer <session>`, the refusal,
   the post-set verification, and `ls` marking the row and stating the claim (including the absent
   state). Help text.
3. **The fleet.** `FleetRow.role` in `collect.ts`, the client mirror and parse in `web/src/types.ts`,
   an Overseer badge in `SessionsPanel.tsx`, and the header line in `Header.tsx`:
   *Overseer: `<name>`* / *no Overseer session* / a loud fault when more than one claims it.
4. **`overseer.ts status`** prints the same line. (`spideryarn2-b6` confirmed it is done editing that
   file; its stage 3b touches `scheduler.ts` and `rule-jobs.ts` instead.)
5. **Claim the live Overseer** — session `Overseer`, `$2514`. The one live-fleet mutation authorised.
6. **Docs**: the new verbs where `gjd-remote`'s verbs are documented; and a proposal for
   `overseer.md` § "You are the Overseer", which is rule text and goes to Greg rather than into a
   commit.

## Evidence

Written as each stage lands.

- **Stage 1–2 (2026-09-08).** The verbs work against real tmux on a disposable socket:
  claim refuses a second holder by name, release frees it, and **killing the holder releases the
  claim** — checked rather than assumed, in `tests/gjd-remote-overseer-claim.test.ts`.
