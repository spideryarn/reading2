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

**The contract is eventual detection, not mutual exclusion.** That wording is the fix for what this
section said first — *"advisory, but the re-read means a race cannot happen quietly"* — which GPT Sol
took apart (P1-1): A and B both read no holder; A sets and re-reads and is satisfied; B then sets;
the box is contested and A was told it succeeded. The re-read narrows the window and catches the
ordinary case, and it is not a lock. What holds the line is that **every reader reports two holders
as a fault rather than picking one**, so a double claim is visible on the next quiet read instead of
silently deciding which session the scheduler prods. A test asserts that two decisions from one
snapshot are *both* allowed, so nobody later reads `decideClaim` as a mutex.

Accepted rather than fixed: a real mutex means a lock file with an owner pid and a liveness check —
the machinery this design exists to avoid — for a verb a person runs about once a week. (The
question was first raised by `spideryarn2-b6`, who thought it tolerable; Sol agreed it was, and
objected to how it was described.)

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
produced** matters more than the arm existing, and there are four real producers:

- **a role read that failed** — GPT Sol's P0-1, and the one this plan got wrong first. The plan said
  an unreachable tmux fails the whole listing, which is true of the opening `tmux ls` and **not** of
  the per-session lookups: `show-environment -t X VAR` exits 1 both for a variable that is not set
  and for a session that has gone, and both landed as an empty field, i.e. `none`. So a session that
  died mid-listing counted as evidence that nobody is the Overseer. Fixed by dumping the session's
  own environment instead — that exits 0 iff the session is still there — and sending `?` when it
  does not. Tested with a stubbed `tmux` whose `ls` succeeds and whose dump fails, since the race
  cannot be arranged against a real server on demand.
- **the wire** — a dashboard server that predates the field sends rows with no `role` key at all, and
  a client that read absent-as-`none` would report "no Overseer" about a box that has one. This is
  `attemptedAt`'s documented problem in [`wire.ts`](../../tools/fleet/wire.ts), one field over.
- **a decoded value that is not a role token** — something is there and we could not read it, which
  is neither none nor overseer. (Undecodable *base64* is a different thing and fails the line, like
  an undecodable name: the script always encodes this field, so anything else did not come from the
  script. Sol's P2, and the plan had the two muddled.)
- **an incomplete snapshot** — below.

### The aggregate, and the case that reads as an answer but is not

Sol's P0-2, and the implementation had already got it wrong once. **One known holder plus one row we
could not read is not singleton ownership**: the unreadable row might be a second claimant, and
*exactly one* is the entire promise. The truth table, now in one place
([`tools/fleet/overseer-claim.ts`](../../tools/fleet/overseer-claim.ts)) because it was written two
different ways in one afternoon:

- two or more known holders → `contested`, and that survives an incomplete reading, because more rows
  could only make it worse;
- any uncertainty with zero or one known holder → `cannot-tell`, **naming the known holder in the
  `why`**, so a caller that only wants somebody to prod keeps the address and loses only the
  guarantee;
- exactly one holder, complete reading → `one`;
- zero holders, complete reading → `none`.

*Complete* is the caller's declaration, because a row list is not a snapshot: the dashboard drops
rows it cannot parse and counts them, serves its last good rows after a collection fails, and has no
rows at all before the first collection.

### Why the version discipline is *not* bumped

`METADATA_VERSION` is `"1"`, and `parseMeta` fails **the whole listing** for a session whose version
it does not know. Bumping it to `"2"` would therefore break `ls` for every session alive on the box
right now. And the role is genuinely not one of those four: they are pinned at launch and are
all-or-nothing (`legacy` means *all four absent*), whereas a role is set and unset at runtime, on
sessions of any vintage.

The brief said to extend `META`; **it is a standalone `SESSION_ROLE_ENV` instead**, on Sol's P1-3.
`META` *means* the versioned quartet — code and tests read it as that set — so a fifth member would
blur the one thing that type is for, and weaken the very argument above. The four-field invariant is
untouched, and the role is read on its own, the way `CLAUDE_SESSION_ID` and `GJD_PROVISIONAL` are.

### The simpler options passed over

**Rename the session to `Overseer`** — Greg's own first suggestion, and the plan omitted it until
Sol's P1-4 pointed that out. It is genuinely stronger in one respect: tmux session names are unique
per server, and `rename-session` onto a taken name fails atomically (verified), so it would give real
mutual exclusion where `GJD_ROLE` gives eventual detection. Not taken, for three reasons.

The runbook already rules on the first two: *"Names are reassigned when a session dies"* and
*"Address a session by pane handle plus generation, never by name"* — so a name is exactly the thing
[overseer.md](../project/overseer.md) says is not an identity, and a claim carried by one would be a
claim a dead session's successor inherits silently. Second, names are already overloaded as the job
claim register (`fb<short-id>-…`, `<plan-id>-<stage>`), so a session could not be both named after its
work and marked as the Overseer. Third, and empirically: the tmux session in question **was already
called `Overseer`** on the night this was written, and it changed nothing — no reader looked at it,
and `gjd-remote ls`, the dashboard and the scheduler each had to be told separately anyway.

What the rename does give is a human-legible label, and it is free to keep. The two are not
alternatives so much as a display name and a fact.

**`new-claude --overseer`**, claiming at launch. Not built: it threads a flag through the job-script
generation for a case that composes perfectly well out of `new-claude` followed by `claim-overseer`,
and the session that most needs claiming tonight is one Greg started by hand, which the flag could
never have helped. If the daemon later starts the Overseer itself, that is when the flag earns its
place.

**A lock file under `~/.overseer/`.** Rejected above: a second store for one bit, with a liveness
problem the tmux environment does not have.

**Dropping the `other` arm** — Sol's P2, on the grounds that no second role exists. Kept, and the
reason is the aggregate rule above rather than a future feature: an unrecognised role has to be
*known not to be the Overseer*. Without `other` it would be `cannot-tell`, and one such session would
poison the whole box's reading for every older copy of `gjd-remote` on it.

### A correction to the brief, and where the vocabulary ended up

The brief says the role becomes an *"additive `wire.ts` field"*. **There is no row type in
`wire.ts`** — `FleetState<Row, Health>` is generic in its row, and the row is declared twice on
purpose: `FleetRow` in `collect.ts` (server) and again in `web/src/types.ts` (client), because
`collect.ts` reaches `node:child_process` and the client project has no node types. So `wire.ts` is
not touched at all, which also removes the collision the brief was worried about — two other agents
were adding blocks to it the same night.

The vocabulary itself lives in a **new leaf module**,
[`tools/fleet/overseer-claim.ts`](../../tools/fleet/overseer-claim.ts): the role type, the role
string, the wire parse, the aggregate rule and the snapshot reader. It has no imports and must never
acquire one — the argument `attempt-clock.ts` already makes at length — which is what lets
`scripts/gjd-remote-tmux.ts`, the dashboard's node side and the browser bundle all import the *same*
implementation rather than three twins. The one twin that would have remained (`OVERSEER_ROLE`) was
what made this worth doing: the whole exclusivity rule is string equality on two sides of a
compilation boundary, and a divergence would have been silent and total.

It costs one import out of `scripts/` into `tools/`, which is a new direction. Taken deliberately
after Sol's P0-2: the alternative was two copies of the truth table, and that table had *already*
been written two different ways in a single afternoon.

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

## The second review, and the shape every finding had

[260908j-…-review2-sol.md](260908j-mark-one-session-as-the-overseer-review2-sol.md). Two more P0s and
three P1s, and **every one of them was the same defect wearing different clothes: a reading that
could not be made, reported as a reading that was.** Worth naming, because the plan-stage review had
already found that class twice and the code still shipped five more of it.

- **The page could say STALE and *Overseer: alpha* in the same breath** about a session that died an
  hour ago. `OverseerLine` looked only at the row count. It now reads the same `Freshness` the STALE
  banner is drawn from, plus the payload's own `error` — and `ReadingCompleteness` grew a second
  arm, because *the list is short* and *this may not describe now* are not equally bad. `contested`
  survives the first and not the second: two holders in an old snapshot do not prove two holders now,
  since killing one is exactly what somebody would have done about it.
- **The multiline fix caught only the value its test used.** Counting lines matching `^GJD_ROLE=`
  rejects `overseer\nGJD_ROLE=evil` and accepts `overseer\njunk`. The role is now read **by name**
  with its whole output shape validated — exactly one line beginning `GJD_ROLE=` — and `has-session`
  asked *afterwards* to tell an absent variable from a vanished session. That also closed a hole
  nobody had noticed: reading from a dump let another variable whose value contained a `GJD_ROLE=`
  line answer for this one.
- **A release printed a green success when the target's role could not be read.** `releaseSucceeded`
  now accepts two things and no others: the session is gone, or its role is positively `none`.
- **`claimFromSnapshot` accepted four malformed authority fields** — a missing `error`, an `error`
  that was an object, a `collectedAt` in the future, an id that was not a tmux handle. Sol confirmed
  each against the function before reporting it.
- **Three paths printed session names raw into a terminal**, which is what `escapeName` has existed
  for since before any of this. The known holder now travels on `cannot-tell` as a **field** rather
  than as words inside `why`, so a name is escaped where it is drawn rather than where it is composed.

And one test that could not have failed: *"it still says WHO"* asserted `why` contained `"b"`, which
passes on the word "be" in "could not be read". Found while re-reading, not by the reviewer.

Sol's own audit of its earlier findings, verbatim on the two that were arguments rather than bugs:
P1-4 (rename the session instead) — *"the decision is defensible, not mere rationalisation. Rename
remains stronger and simpler, but overloading names and losing the work-name are real costs."* The
`other` arm — *"your reasoning is sound. A valid, non-`overseer` token is positive evidence that this
session is not the Overseer."*

**Left undone deliberately.** The five older per-session metadata reads have the same
absent-versus-unaskable shape as the role read did, and are out of scope here; Sol agreed leaving
them is reasonable for a scoped change. And nothing calls `cmdRole` or `cmdLs` in a test — the
decisions inside them are extracted and tested (`decideClaim`, `releaseSucceeded`, `claimLine`,
`readOverseerClaim`), but the CLI wiring itself is covered only by having been run against the live
box.

## Evidence

- **Against real tmux, on a disposable socket** (`tests/gjd-remote-overseer-claim.test.ts`): claim
  refuses a second holder by name; release frees it; a global `GJD_ROLE` marks nothing; a role with a
  newline in it is unreadable rather than a claim; another variable carrying a `GJD_ROLE=` line
  cannot answer for the real one; and **killing the holder releases the claim** — checked rather than
  assumed, which is the fact the whole no-lock-file design rests on.
- **Against a stubbed tmux** whose `ls` succeeds and whose lookups fail: the role reads as
  `cannot-tell` and never as `none`. That race cannot be arranged against a real server on demand.
- **On the live box.** `gjd-remote claim-overseer Overseer` succeeded; `ls` grew a `ROLE` column and
  the line `— overseer: 'Overseer'`; a second claim was refused naming the holder.
- **And once by accident, which is better than a test.** While this was being built, another agent
  created a session with an invalid `GJD_REPO`, which fails the whole listing by pre-existing design.
  `overseer status` printed *"Overseer unknown — the dashboard's last collection failed (…), so its
  rows are not current"* rather than naming a stale holder — the P0-3 fix working, on a failure
  nobody arranged.
- `npx tsx scripts/typecheck.ts` exits 0; the affected suites are green
  (`gjd-remote-overseer-claim`, `fleet-overseer-badge`, `gjd-remote-tmux`, `gjd-remote-tmux-script`,
  `fleet-collect`, `fleet-web` — 655 tests).
