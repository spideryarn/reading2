# The Overseer, and orchestrating the agent fleet

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

**This is the direction, not a plan.** It exists so that every plan doc and every worktree working on
the fleet is aiming at the same thing, and so that nobody rediscovers the constraints at the bottom
of this page the expensive way. The plans that implement it live in `docs/plans/`, starting with
[260907e-agent-fleet-dashboard.md](../plans/260907e-agent-fleet-dashboard.md).

**The Overseer is Greg's name, from 2026-09-08, for the agent whose job is to oversee all the other
sessions.** Until then this page called it "the orchestrator"; the two mean the same thing, and the
new name is the one to use. It is the *actor*. The **fleet dashboard** is its face, and the two are
built by different agents against the seam in [§ Two tenses](#two-tenses-the-seam-between-the-overseer-and-the-dashboard).

Status as of 2026-09-08 evening: **both exist; one of them has not yet run where it will live.**
`tools/fleet/` serves a live page on the box and the tailnet, with per-session status and the pending
question for blocked sessions. `tools/overseer/` is built — the store, the clock, the differ, the
daemon and the work classifier.

**Half of that sentence retired itself at 16:04 the same evening, and the half that did not is the
interesting one.** The retiring condition set here was *"events are accumulating in
`~/.overseer/events.jsonl` under a unit that is `enabled`"*, and it was two conditions wearing one
sentence. The first is now met: `~/.overseer/` holds 161 KB of `events.jsonl` and a `current.json`
written minutes ago, against the real store root rather than a scratch one. The second is not:
`systemctl is-active overseer.service fleet-dashboard.service` prints `inactive` twice, because both
are running under `tmux`. **So nothing survives a reboot yet**, and what retires the rest of this
paragraph is a unit that is `enabled` — not a process that happens to be up. [260908b](../plans/260908b-overseer-store-and-clock.md) is the plan and holds
the evidence.

## What we are going towards

> - running sessions, with an indicator of their status, and especially whether they need something
>   from me or are blocked, with a way for me to add steering input if i want
> - decisions that have been made on my behalf, prioritised by 1) how important they are, and 2) how
>   confident the model was (with rules that say product-facing decisions are more important, and it
>   should ask Fable for product input and/or GPT Sol for technical input, and below some threshold
>   it should stop and ask for user input)
> - for the orchestrator to be able to provide steering input (e.g. keep going, pull the latest
>   changes, run unix sleep to wait/pause for some period, be aware that resources on the box are
>   limited, harmonise with some other agent, remove the worktree, etc)
> - for the orchestrator to be able to create new agents, and shut down old agents
>
> — Greg, 2026-09-08

**The orchestrator is eventually a coordinator agent, not a person.** Greg chose that on 2026-09-08
over "me, via the dashboard". That does not mean building it now — it means the steering actions get
a seam a program can drive, not only a button a human can press. Every action should exist as a
function with a typed argument before it exists as a click.

Greg also asked, on 2026-09-08, that the work be sliced into **many very thin stages** that can be
iterated through quickly, rather than a few large ones. So the numbering below is deliberately
finer-grained than a normal plan's:

- **v0.1** — a page listing session titles. Read-only. *Stop here and look at it.*
- **v0.2** — send a steering message to one session.
- **v0.3** — status: working / idle / blocked, and what it is blocked on.
- **later** — the decision log; creating and killing agents; the coordinator itself.

The rule that generates that ordering: **each slice must be visible in a browser and must not
require the next one to be worth having.** Those four are the **dashboard's** slices; the Overseer's
are in [§ The order of work](#the-order-of-work).

## The horizon

Greg, 2026-09-08, on what the Overseer and its web interface eventually have to do. The tags are
his, and they are the priorities — this list is the thing to check a proposed slice against:

> - **NOW** across multiple sessions & agents
> - **NOW/SOON** accessible via the web on desktop (NOW) and phone (SOONISH), via SSH tunnel and/or
>   VPN
> - **PERHAPS NEVER** no authentication needed for the foreseeable future
> - **SOMEDAY MAYBE** multiple boxes
> - **SOON** multiple Claude Max subscriptions (perhaps rotating or round-robin or something),
>   paying attention to when one is about to hit usage limits and reapportioning to others, or
>   pausing it, or taking action some other way
> - **NOW/SOON** multiple model-families/harnesses, starting with Claude Code and Claude agents
>   (NOW) and then OpenAI Codex/GPT (SOON)
>
> Goals:
> - **NOW** Staying up-to-date on progress automatically
> - **SOON** Staying up-to-date on usage limits
> - **SOON** Running periodic jobs, e.g. `get-ready-to-deploy.md` every couple hours,
>   `feedback-reports.md` a couple of times per day, `improve-the-codebase.md` every few days, etc
> - **SOON** Responding to agents that need help/guidance, taking action (e.g. requesting input from
>   Fable/GPT) and/or surfacing questions to the user on the web
> — **SOON** paying attention to resource usage on the box (CPU, RAM, swap, hard disk, what else?,
>   etc etc) and taking action as needed (pausing, killing tests, and various other options, etc etc)

Note what "PERHAPS NEVER no authentication" does and does not license. It is a statement that a login
page is not coming, **not** that the surface is safe to expose: anything that can reach the Overseer
can run code on the box. The access control is reachability, and it stays that way —
see [§ Access](#access).

## What the Overseer is

Asked on 2026-09-08 whether the Overseer is a daemon, a long-running Claude session, or a daemon
supervising a session, Greg declined all three:

> I'm not certain what the right answer is. It may be that there's both a daemon and a long-running
> session, plus the web interface, and maybe some kind of store (probably gitignored, could be json
> or sqlite or something else, but start simple for now) so that we can resume easily if the session
> got killed (and ideally the overseer should be able to resume itself and all the running sessions
> if the box got rebooted).
>
> — Greg, 2026-09-08

**So the store is the centrepiece, and the daemon and the session are both clients of it.** That is
the load-bearing consequence, and it settles the question the three options were really asking:
*where does the state live?* Not in a transcript. A transcript compacts, drifts, and cannot be read
by a program; a store can be read by the daemon, by a session, by the dashboard, and by Greg with
`less`.

The division that follows:

- **The daemon owns the clock, the store and the restart.** A tick loop under systemd with
  `Restart=always`. It costs nothing when idle, which matters more than it looks: **the Overseer must
  keep working when the subscriptions are exhausted, because that is exactly when it is needed.** A
  thinking loop that burns the quota it is supposed to be rationing has a bad failure mode.
- **A permanent session, resumed by the daemon.** Settled by Greg on 2026-09-08, and it replaces
  what this page said the same morning:

  > I think I am leaning towards a permanent session plus daemon, but I don't fully understand the
  > counterargument above. And even if the box got rebooted, presumably the daemon *could* resume
  > that session, no?
  >
  > — Greg, 2026-09-08

  **It could, and the counterargument was wrong in the way that mattered.** This bullet used to read
  *"a session is an action, not a residence"*, on the grounds that a persistent context is exactly
  what a reboot destroys. It is not: `claude --resume <id>` replays the transcript out of
  `~/.claude/projects/`, which survives the tmux server and the reboot both. So the objection does
  not hold as stated, and the short-lived-session design it was defending is dropped.

  **What survives the correction is why the store is still the record, and it is three things.** A
  resumed session recovers *the Overseer's* memory and not *the fleet's* — every other session died
  with the tmux server and its identity lived in that server's environment, so a perfectly resumed
  Overseer wakes with an accurate memory of yesterday and an empty box in front of it. A transcript
  cannot be queried: *"which agents did I tell to pause, and did they wake up?"* is a grep over
  `events.jsonl`, and is not reliably re-derivable by re-reading a conversation. And **the
  auto-compaction Greg wants is itself what makes that conversation untrustworthy as a record**,
  because compaction drops the boring bookkeeping first — which is a fair description of a pause
  issued forty minutes ago.

  **So the session's context is a cache of the store, and never the record.** That is what demotes
  resume from load-bearing to convenient: if it works the session keeps its feel, and if it fails, a
  fresh session reading `current.json` is only slightly worse. **Which means the daemon needs a
  start-fresh path that is exercised**, not only a resume path nobody has watched fail — a resume
  that quietly produces an empty-headed Overseer looks exactly like one that worked
  ([silent-success.md](../reusable/silent-success.md)).
- **The dashboard is the face**, and belongs to whoever is building it — [§ Two tenses](#two-tenses-the-seam-between-the-overseer-and-the-dashboard).

**Autonomy, widened by Greg the same evening.** This page said until then that the Overseer *"may
dispatch scheduled jobs unattended, and nothing more"* — his choice from four options, the others
being observe-and-notify-only, steering live sessions, and pausing/killing. **That is superseded.**
Handed a proposed list to confirm, he took all of it and added to it:

> Yes, pretty much all of that Unattended list. Dispatch scheduled jobs, steer live sessions, tell
> agents to pause/stagger/kill their own tests and/or webserver or other processes, route questions
> to Fable/Sol and pass the answer back to the agent, and/or surface it to me as needed, spawn agents
> with `gjd-remote new-claude`, tell an agent to debrief, decide on that basis whether to tell it to
> keep going and/or do more/different work, close a session and remove the worktree and kill the
> Claude Code process, etc.
>
> — Greg, 2026-09-08

**One item goes past what was proposed, and it is the one to notice: the Overseer may remove a
worktree itself**, not merely tell the agent living in it to. The proposal drew that line
deliberately — an agent running `npm run worktree:check` inside its own tree *is* the check, and the
Overseer reaching in from outside is a different act — and Greg crossed it knowingly. So the check
has to travel with the capability: an Overseer that removes a worktree runs `worktree:check` in it
first and refuses on anything it cannot account for, because `data/` and `.env.local` are gitignored
and a clean `git status` will say "safe" over the top of work nothing else has a copy of
([worktrees.md § Before you remove one](worktrees.md#before-you-remove-one)).

What it may *not* do is [§ The gates](#the-gates), which is the other half of the same conversation
and is written as principles rather than as a list, because a list of forbidden actions is a list
somebody has to keep complete.

## The gates

**The other half of the autonomy conversation, and Greg asked for it as principles rather than as a
list**, because a list of forbidden actions is a list somebody has to keep complete:

> Yes, it can answer on my behalf (e.g. for questions that don't need my input), but it should be
> crystal-clear that it's the agent rather than me that's answering, and it should log ALL such
> answers/decisions/assumptions somewhere that I can easily review (and add a new mode to the web
> interface for viewing the past/outstanding ones). Yes, avoid really consequential, critical, risky,
> irreversible, sensitive, regrettable. And also be wary about product decisions — I think I mostly
> want to make those. I think it can sometimes edit important .md docs, but ideally only if very
> confident and making very minimal changes — but err on the side of caution.
>
> — Greg, 2026-09-08

**The gates themselves live in [overseer.md](overseer.md), because that is the file the Overseer
reads.** Three things about them belong here, where the reasoning goes.

**"Product decision" has no operational test, and foreclosure does.** Fable arbitrated a six-gate
draft on 2026-09-08 and rejected the hinge before answering it:

> "Reader-visible" is wrong in both directions: a bug fix is reader-visible and needs nobody; a
> prompt rule, a stored field about a reader, or a privacy sentence is invisible and is the most
> product-shaped thing in the repo … the cost of a wrong product call by the Overseer is not "a
> reader sees it" (dev is not prod, and deploy is gated) — it is **agent-hours committed to a shape
> Greg has not seen, and his option space narrowed by what now exists.**
>
> — Fable, 2026-09-08

So the Overseer never *decides* a product question; it **defaults** to the standing simplest-first
decision this repo already holds, logs the default as an assumption pending Greg, and stops at
anything that **outlives the branch** — a schema, a prompt, a published sentence, a privacy promise,
a field about a reader, or a case being dropped. That list is enumerable at 3am because it asks about
files rather than about taste.

**This page contradicted itself and the contradiction is resolved against itself.**
[§ Route by who has the information](#route-by-who-has-the-information-not-by-confidence) gives
*"whether a case can be dropped"* to Fable in one bullet and everything scope-shaped to Greg in the
next. **It is Greg's.** Dropping a case is where his fifth options come from — the repo's own record
of him is that when offered three options he takes a fourth about half the time, and that is evidence
about what he wants to be asked, not a quirk.

**The gate nobody had written down: the Overseer never originates work.** Fable's addition, and the
only one with a mechanical test — *is it in the queue?* Scheduled jobs, plan docs and the feedback
queue are queued. A job of the Overseer's own devising is a proposal in the log, never a dispatch.
It is the direct expression of Greg's *"my job is basically new ideas"*.

### The Overseer is a peer, not a new privilege tier

**GPT Sol blocked the plan behind these gates on 2026-09-08 with an architectural objection**:
*"prose gates cannot constrain an Overseer that retains unrestricted Bash, `tmux send-keys`, and
passwordless sudo."* Its remedy was a capability broker holding authorisation records the Overseer
could not mint for itself. Greg settled it in one line:

> Yes, the Overseer is a peer, not a new privilege tier.
>
> — Greg, 2026-09-08

**That is the whole answer, and it makes the objection true and not load-bearing.** Every one of the
thirty agents on this box already runs as the same Unix user with passwordless sudo
([§ Appendix](#appendix-security-and-hardening-deferred)), so the Overseer reaches nothing its peers
cannot already reach. What it adds is **rate, not ceiling** — more actions per hour, not more
dangerous ones — and a broker would draw a boundary in the one place there is already no boundary,
which is the same argument that deferred **A7** and closed **A5**.

**What survives is the cheap half, and it was worth the review on its own.** Gate 3's list gained the
categories Sol found missing, the sharpest being the one no test can see: **the gates bind what you
cause, not what you type.** *"Finish this work"* sent to an unrestricted coding agent is an innocuous
sentence and an arbitrary capability, so delegation is not a way round a gate. Alongside it: never
modify your own constraints — the gates, the queue, the decision log, the watchdog, `FLEET_ACT_ENABLED`
— and never act on a job definition that changed after it was authorised, which matters here because
**the jobs are documents** and editing one would otherwise enlarge what may run unattended.

**The trigger that would reopen this** is the same one the appendix already names, and it is about
the fleet rather than the Overseer: an agent handling genuinely untrusted input with real leverage. On
the day a peer stops being trustworthy, the peer argument goes with it.

### The failure to design against, second entry: log blindness

[§ The failure to design against](#the-failure-to-design-against) names notification blindness, for
an Overseer that notifies. This is its equivalent for one that **acts**, and Fable's argument is that
they have the same physics:

> The whole draft rests on "vetoable after the fact," and a veto has the same physics as a buzz — its
> value is proportional to how rarely it is needed, and its volume grows with everything the Overseer
> does. Once the morning log is two hundred entries, Greg stops reading it; from then on the Overseer
> has unbounded authority with a paper trail, and the signal that says so is *in the log*.
>
> — Fable, 2026-09-08

Three design constraints follow, and they are constraints rather than preferences. **The 8am surface
shows assumptions only**, ranked by agent-hours sunk since each was made — answered facts go on a
second page nobody has to read. And **a week with zero vetoes is a red flag, not a clean bill**: it
means either the Overseer stopped deciding anything, or Greg stopped reading.

The web mode Greg asked for renders that surface. It is the dashboard's tense, not the Overseer's —
[§ Two tenses](#two-tenses-the-seam-between-the-overseer-and-the-dashboard) — so the Overseer writes
the log and the dashboard renders it.

## The scheduler

**Researched on 2026-09-08 per
[third-party-library-selection.md](../reusable/third-party-library-selection.md), and the answer is
to add no library.** Every job named — `get-ready-to-deploy` every few hours, box health and usage
every five minutes, the feedback sweep twice a day, prod the Overseer if it has gone quiet — is a
plain elapsed-time interval. The genuinely hard part a scheduling library sells is cron-expression
arithmetic across DST and leap years, and nothing here needs a wall-clock hour or a weekday. The
runner-up is `croner` (MIT, zero dependencies, TypeScript-native, ~8M weekly downloads), and the
trigger to adopt it is the first job that needs calendar semantics rather than an interval.

Greg had asked for something *"robust and external to the session"*, and named the reason: one of the
scheduler's jobs is to prod the Overseer when it looks unresponsive. **A scheduler inside the
Overseer cannot prod the Overseer**, so that one job — and only that one — is a **systemd system
timer**. Not `systemd --user`, which needs `loginctl enable-linger` that nothing in this repo enables,
and would therefore be dead at exactly the moment it was wanted.

**Missed runs come out better than either alternative, and that is the argument for hand-rolling
rather than an accident of it.** A state-based scheduler asks *has enough time passed since the last
recorded run?*, so a job due while the box was down simply runs on the next tick. `systemd`'s
`Persistent=true` fires one catch-up and only for `OnCalendar=`; `cron` skips silently, and a user
crontab additionally strips the environment so `node` and `tsx` are not on its `PATH`.

**The trade-off, named at the point of choosing** per
[vision.md § Simpler first](vision.md#simpler-first): interval scheduling drifts across restarts — a
"three-hourly" job is measured from its last actual run, not from a wall-clock boundary — and cannot
express "9am on weekdays". Nothing in the job list needs either.

**What this does to [cron-scheduler.md](cron-scheduler.md) is narrower than it looks, and the
distinction is that doc's own.** It ends with *"the always-on box, which is not the app and should
not become its scheduler"*, and this scheduler does not change that: it runs agent-fleet jobs on the
box, and the app's periodic work — staging litter, orphaned blobs, a library-wide re-run after a
prompt change — is still unreached and still wants the Vercel cron that doc weighs.

**What it does close is one specific thing that doc names as broken.** Its last section says the
answer is *not* a cron in an agent's session, because a session cron dies with its session and the
only evidence is a gap in a log nobody reads — and then observes that
[feedback-reports.md](feedback-reports.md)'s loop runs exactly that way today and is watched by a
person for that reason. **That loop is one of the Overseer's standing jobs**, so it moves off a
session cron and onto the daemon's clock, under `Restart=always`, with its dispatches recorded. The
failure that doc describes is the failure this scheduler exists to end.

## The store

**Nothing on this box durably records what is running.** Session identity — `claudeId`, `GJD_KIND`,
`GJD_REPO`, `GJD_REMOTE_DIR` — is pinned into the **tmux environment** at launch (`META` in
[`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts)), and a reboot takes the tmux server
and all of it. Transcripts survive under `~/.claude/projects/`, so `--resume` has material and the
working directory is recoverable from the transcript's own path — but **which** sessions were alive,
and what each was for, is recorded nowhere. Verified 2026-09-08: `gjd-remote` writes only a log, and
there are 208 transcripts for the primary checkout alone with nothing to say which of them matter.

That absence is why the store is stage one rather than scaffolding. What it must hold, minimally:

- **the session register** — per session, the four `META` fields plus `claudeId`, name and tmux
  handle, and when it was last seen alive. This is the reboot-resume material.
- **the clock** — status transitions, tick over tick. This is what turns "blocked" into "blocked for
  40 minutes", and ranked attention needs the duration, not the state.
- **the heartbeat** — last tick, tick count, pid. So the dashboard can say *the Overseer is dead*,
  which is the failure this whole area keeps having ([silent-success.md](../reusable/silent-success.md)).
- **what has been dispatched and escalated** — so a restart does not re-dispatch, and so a question
  put to Greg is not asked twice.

**JSONL first, SQLite when a query needs an index** — Greg's "start simple", and naming the
trade-off at the point of choosing, per [vision.md § Simpler first](vision.md#simpler-first).
Append-only is crash-safe by construction, adds nothing to `package.json`, and a human can grep it.
The thing that would force the change is a read that has to scan history to answer a page load. And
**record events, not samples**: a row when something changes plus a heartbeat per tick, rather than a
full snapshot every tick — 36 sessions sampled every minute is ~52k rows a day of mostly nothing.

Gitignored, per Greg. Which means [worktrees.md](worktrees.md)'s warning applies to it: a clean
`git status` will say "safe to delete" over the top of it.

## Two tenses: the seam between the Overseer and the dashboard

Two agents are building here at once, so the boundary is a rule rather than an intention:

- **The dashboard owns the present tense** — what is true right now. Collection, status, the pending
  question, rendering, SSE, delivering a steering message. Its unit of work is a request.
- **The Overseer owns the past and future tense** — what has been true over time, and what should
  happen next. The store, the vitals history, ranked attention, the job schedule. Its unit of work is
  a tick.

In practice: the Overseer writes a current-state file, the dashboard reads and renders it and never
writes it; the Overseer lives in `tools/overseer/` and never edits `tools/fleet/server.ts`,
`page.ts` or the client; and it **imports** `collect.ts` and `status.ts` rather than reimplementing
them, which is the same discipline `tools/fleet/` applied to `gjd-remote-tmux.ts`.

**There is one collector, and it is the dashboard's.** Settled between the two agents on
2026-09-08. A collection costs ~12 seconds of transcript grepping, so a second one is a real cost
rather than untidiness — this box hit load 391 with the OOM killer firing that morning. Two options
were on the table (coexist on staggered ticks; the Overseer collects and the dashboard reads it) and
the dashboard agent supplied a third that beats both: **the Overseer is a consumer.** It subscribes
to the dashboard's `/api/live` SSE stream and appends on each `snapshot` event, polls `/api/state` if
the stream drops. The dashboard collects on a chain (60s from the *end* of each run, 5× backoff
after a failure), not on a fixed interval, because a collector that grazes every 12 seconds on a
swapping box is worse than a gap in the history.

**This paragraph used to end *"and falls back to its own `collect()` only when the server is
unreachable"*, and that has not been true since the plan removed it** — corrected 2026-09-08 after
the sentence was quoted in a review and then checked against the code.
[`source.ts`](../../tools/overseer/source.ts) says so in its own header: *"it never calls
`collect()`, and there is deliberately no local fallback that would"*, because a local collection
would return a different contract — `FleetSnapshot` has no `health` field — and a second contract
wearing one name is worse than no fallback.

**So the consequence is sharper than "the Overseer depends on the dashboard".** The `/api/state`
poll is not a second source; it is the same source down a slower pipe. **When the dashboard is down
the Overseer has nothing at all**, and the thing that must therefore never be allowed to look healthy
is a daemon ticking against an empty stream — which is exactly what the two clocks below are for, and
exactly what a watchdog reading only the heartbeat would bless.

**The coupling this creates runs the opposite way, and is accepted knowingly:** the Overseer now
depends on the dashboard being up. Hence two clocks in the state file rather than one — `writtenAt`
(the Overseer last wrote) and `lastGoodSnapshotAt` (it last heard from the dashboard). They come
apart exactly when something is wrong, and a single number would hide the case where the Overseer is
alive but deaf. **A dead dashboard is a fact the Overseer records, not a silence it sits in.**

**What one eye costs, measured 2026-09-08.** The single collector is a deliberate purchase — a
collection costs the box around twelve seconds of transcript grepping, and this is the box that hit
load 391 in a morning — so one eye is the right trade and this is the price of it, stated once so
nobody has to rediscover it. A hand-made tmux session with `GJD_REPO=spideryarn2`, which is neither
an `owner/name` slug nor the sanctioned `unknown`, made `parseMeta` refuse the **whole** listing; for
about twenty minutes `gjd-remote ls`, the dashboard's collector and `overseer status` could
simultaneously say nothing about a box carrying fourteen healthy sessions.

**The refusal is right and should not be softened.** A short list read as a complete one is worse
than no list, it named the session and the variable, and the repair was one `tmux set-environment`.
What the incident actually shows is not that `parseMeta` is too strict but that **we bought a single
point of failure on purpose, and its blast radius is every reader at once** — which is the same fact
as *"when the dashboard is down the Overseer has nothing at all"*, arriving by a different door. The
twenty minutes was how long it took a person to look, not how long the diagnosis took.

**And the way it arrived is worth more than the incident.** The malformed session was a *specimen*,
made deliberately to test the rule that watches for sessions in the wrong launch mode — so the test
of the thing meant to watch the fleet blinded every watcher of the fleet. That is not bad luck: a
rule whose specimens are anomalous sessions will keep producing anomalous sessions, and the fleet's
readers are strict by design. The guard belongs in whatever *makes* a specimen — run `gjd-remote ls`
and refuse to proceed on a non-zero exit — rather than in the memory of whoever is making one.

**Divergence, 2026-09-08: the vitals history is being built in the DASHBOARD, not here.** The bullet
above assigns it to the Overseer and `daemon.ts` says outright *"No health history and no local
collection"*; both are now describing an intention rather than the code. Agreed between the two
agents rather than decided by one: the reading already exists in-process where it is collected, so
writing it at the source removes a transport hop **and** removes the dependency on the Overseer being
up — which matters most in exactly the hour Greg is opening the graph to ask about. It gets its own
root, `~/.fleet-health/`, so there is never a question of two writers on one file. **Recorded here
before the code lands, not after**, because until it is written down this page points the rest of the
wave at the wrong owner. Whether the assignment above should change is Greg's call, not ours.

**And the one-writer discipline moved to a leaf so it would not be written a third time.** The
retention needs the same kernel-backed exclusion the store has — a second dashboard on a different
`FLEET_PORT` sharing the same directory is a second writer, and two starts can race before either
observes an async bind failure. So `takeLock` / `stillOurs` / `isProcessAlive` / `LockHolder` /
`LockRefusal` came out of `store.ts` into
[`tools/overseer/lock.ts`](../../tools/overseer/lock.ts), which imports nothing but node builtins and
`jsonl.ts`. **The third copy would have been the simplified one, and that is the copy that is wrong
in the way nobody notices** — the same argument `jsonl.ts`'s own header makes about the rule it
holds.

### The seam is a file, not a function — `~/.overseer/current.json`

Written 2026-09-08, once the Overseer existed and the sentence *"the Overseer writes a current-state
file, the dashboard reads and renders it"* stopped being a plan and became something that needed a
shape. Six files, all under `OVERSEER_STORE_DIR` (default `~/.overseer`):

| file | what it is | who may read it |
|---|---|---|
| `current.json` | the checkpoint: two clocks, the cursor, the heartbeat, the session register, the attention inbox and the last usage reading | anyone, any time |
| `events.jsonl` | the append-only history the register is a fold of | anyone, any time |
| `daemon.jsonl` | the daemon's own facts — started, stopped, conditions degraded and restored | anyone, any time |
| `attention.json` | the attention pass's memory (schema 1; keys `epoch`, `waits`, `verdicts`): when each session was first seen asking each question, and the cached model verdict per `tailFingerprint` | the daemon only |
| `last-snapshot.json` | the differ's baseline — the last snapshot seen, so a restart emits changes rather than re-announcing the fleet | the daemon only |
| `overseer.lock` | the single-writer claim | the daemon only |

**This table said "four files" until 2026-09-08 12:15, and `last-snapshot.json` was the one missing**
— the file that exists precisely so a restart does not re-announce all 21 sessions as new. It is the
daemon's private working state rather than part of the seam, which is why it was easy to leave out
and why it is listed anyway: a reader deciding what `~/.overseer` contains should not have to discover
a fifth file by running `ls`.

**And it said "five files" until 2026-09-08 evening, when `attention.json` turned out to be the sixth**
— found by the Baseline census of plan [260908f](../plans/260908f-overseer-and-fleet-improvement-roadmap.md).
Same class as the omission above and the same cure: it is the attention pass's private memory rather
than part of the seam, so nothing outside the daemon reads it, and it is listed for exactly the reason
`last-snapshot.json` is.

**Reads are lock-free and writers are single**, which is what makes this a seam rather than a
coupling: `readCheckpoint()` takes no lock, and the daemon is the only writer of any of them. A
reader can be wrong about the *present* — it may read a checkpoint written a tick ago — and can never
be wrong about the past.

**Two write guarantees, because "lock-free" is worth nothing without them** — asked for by the
dashboard agent on 2026-09-08, and the right question: a reader that can observe a half-written file
is not one tick stale, it is parsing rubble, and the worst case is a truncated JSON that happens to
close and parses *successfully*.

- **`current.json` is replaced atomically, never rewritten in place.** Temp file in the same
  directory, `fsync`, `rename` over the target, then an `fsync` of the directory. `rename` is atomic
  within a filesystem, so a reader sees the whole old file or the whole new one and never a seam.
- **`events.jsonl` and `daemon.jsonl` are appended one record per write on an `O_APPEND` fd, and a
  reader must still tolerate an incomplete final line.** The write loops until every byte lands, so a
  short write cannot tear a record — but a process killed mid-loop can, and pretending otherwise is
  the failure this whole area is about. **The contract is therefore: forgive the LAST line, and only
  the last.** The daemon repairs the file by truncating to the final newline when it opens it, which
  matters more than it looks: skipping bad lines on read is *not* a substitute, because the next
  append lands immediately after the corrupt bytes and welds a good record onto a broken one — and
  one append later the malformed record is no longer last, so a forgiving reader silently loses a
  good record too.

**The dashboard should parse `current.json` itself rather than importing the Overseer's parser**, and
this is the load-bearing part. `tools/overseer/` already imports `collect.ts` and `status.ts` from
`tools/fleet/`, so a `tools/fleet/` that imported `readCheckpoint` would close a cycle between the
two things this seam exists to keep apart. **The file is the contract; the function is one
implementation of reading it.** Parse it at the boundary the way the client already parses the
server's JSON — tolerantly, checking `schema` as a **number it knows** rather than as "not something
else", so that an unknown schema renders as *I cannot read this* rather than as a page with fields
quietly missing.

**There is a second reason, and on 2026-09-08 it turned out to be the stronger one.**
`parseCheckpoint` fails the **whole** checkpoint on one malformed register entry — deliberately, and the four
refusals in `tools/overseer/store.ts`'s own header argue for it, because a register folded across a
hole is a plausible history that is wrong about which agents are running. But a dashboard that imported that
parser would inherit the refusal for a field it never asked about: **an unrelated bad register entry
would render on the page as *the coordinator is unreadable* while the attention list sat there
perfectly intact.** Reading only the projection you need — `schema`, `writtenAt`, `attention` — means
the Overseer's register problems stay the Overseer's register problems. The cycle argument above says
why the import is wrong in principle; this says what it would have cost on a specific Tuesday. Found
by GPT Sol reviewing a fleet design that had proposed exactly that import, having not read this
paragraph.

**The schema is `2`, and the bump happened the day after this was written**, which is the argument
for that paragraph rather than a footnote to it: `statusSince` changed from a bare timestamp to the
pair below, and a reader still pinned to `1` would have done `Date.parse` on an object, got `NaN`,
and rendered a blank age instead of an error. The rule for a bump is *a reader that ignored the
change would be WRONG rather than merely poorer* — adding a field is not a bump.

**What it can answer that the dashboard cannot**, which is the whole reason for the seam and the
thing to build first when this is rendered:

- **`statusSince` turns a state into a duration — and says whether that duration is a measurement or
  a floor.** *"Blocked"* becomes *"blocked for 40 minutes"*, which is what
  [§ Attention](#attention-and-who-the-overseer-is-really-watching) needs and what no amount of
  collecting can produce, because the present tense has no yesterday. It is a **pair**,
  `{ kind: "observed" | "lower-bound", at }`: `observed` means the daemon watched the transition,
  `lower-bound` means the session was already in that state when the daemon first saw it, so all the
  number says is *at least this long*. **Render the two differently** — `overseer status` prints `40m`
  and `≥13m`. The first run against a real store printed four identical `13m` durations against
  sessions that had been working for hours, because the daemon had been up for thirteen minutes; a
  restart resets every floor together, which is worst on exactly the surface that ranks by them.
- **`heartbeat` lets the page say the Overseer is dead.** `pid`, `instanceId`, `startedAt`,
  `lastTickAt`, `ticks`. This is [§ The failure to design against](#the-failure-to-design-against) in
  one field: *"the Overseer was last seen 40 minutes ago"* belongs **where the count would be**, not
  in a footer, because a quiet page and a healthy fleet are the same picture.
- **`writtenAt` against `lastGoodSnapshotAt` distinguishes deaf from dead.** They come apart exactly
  when something is wrong: the first says when the Overseer last wrote, the second says when it last
  heard from the dashboard. One number would hide the case where the Overseer is alive and not
  listening.

**Box vitals belong to the dashboard, and are built.** [`tools/fleet/health.ts`](../../tools/fleet/health.ts)
implements [diagnose-box-resources.md](../reusable/diagnose-box-resources.md) — load against cores,
available rather than free memory, swap as a cliff, `vmstat` si/so, and memory attributed by process
kind — with every field a discriminated union that can say *I could not tell* instead of returning a
zero that reads as healthy. The Overseer stores that object verbatim per event and does not interpret
it a second time, so a change at the source changes the history's shape rather than drifting from it.
What the Overseer adds is only the tense the dashboard does not have: **nobody records health over
time**, so "what was running when the box hit 391" is unanswerable today.

## The order of work

Greg, 2026-09-08, asked which capability to build first, and reordered the options:

> attention triage, then perhaps box vitals and throttling, then account usage limits, then scheduler
> (ideally we'd build a bunch of these in parallel with engineering-manager.md)

Two notes on reading that. **Attention triage arrives first but cannot be built first**, because
ranking by "who has needed me longest" requires a duration and a duration requires the store — so the
store is not a detour before triage, it is triage's first half. And **the scheduler is last by Greg's
choice despite having no home today** ([cron-scheduler.md](cron-scheduler.md)); that is a deliberate
ordering, not an oversight, and it should not be quietly promoted.

### It defers work; it never declines it

**A13 says the most useful automation is *declining* to start expensive work. Greg overruled that on
2026-09-08**, put the objection that dozens of concurrent agents do not fit on one 30 GB box, and
answered:

> I don't think the Overseer should ever decline work, but it might kick it off with `--wait` and/or
> perhaps we build some infrastructure for it to write out to a queue that it grabs from every so
> often when things calm down.
>
> — Greg, 2026-09-08

**His version is better than A13's for a reason he did not have to give: a decline has to be
remembered by whoever was declined, and nothing on this box remembers.** A deferral is held by the
thing that deferred it. So A13 is **amended, not dropped** — the caps it asks for become the
condition on *draining* the queue rather than a refusal at the door, and the load-391 incident is
still what they are for.

The trap that comes with the amendment, and it is the incident with an extra step: **a queue that
drains when vitals allow will drain everything at the instant the load falls.** Whatever drains it
does so one item at a time against a fresh reading, for the same reason the resource broadcast is
staggered — thirty agents told to resume in the same second is the far end of the same failure.

**And "many dozens of agents" needs splitting before it can be answered.** Fable, 2026-09-08, asked
what Greg is wrong about here:

> "Many dozens" is reachable **for the maintenance fleet** — improve-the-codebase, feedback reports,
> postmortem preventions, get-ready-to-deploy — without giving up anything, because those jobs are
> already queued and their product decisions were made when the docs were written. The **feature
> fleet** stays at the number of plans he can read a day, and the only thing that lifts it is letting
> the Overseer approve plans — which is the product authority he wants to keep.
>
> — Fable, 2026-09-08

That is a trade Greg may want to take for a class of jobs, and it is his to take; it is written here
so that it is offered rather than assumed.

## Usage limits

**Multiple Max subscriptions is medium-term.** Greg, 2026-09-08:

> Right now, I have a couple of Claude Max subscriptions, and I run /login every couple of days to
> switch when I hit limits. In future I expect to have more. But let's say that multiple Claude Max
> subscriptions is MEDIUM-TERM, i.e. out of scope for the next day or two.

So the near-term usage-limit work is **visibility** — how close is the current account, and what
should stop when it is near — and not rotation.

**Asked the same evening whether the Overseer should have a subscription of its own**, so that the
thing rationing the quota is not throttled by it, Greg agreed in principle and declined in practice:

> Ideally it would have its own account, but I don't want to deal with multiple simultaneous
> subscription-accounts on the same box just yet, so perhaps it keeps an eye on the usage limits, and
> proactively tells other agents to pause if getting close (and then checks later that they woke up!).
>
> — Greg, 2026-09-08

**The parenthesis is the requirement, not an aside.** A pause nobody verifies is indistinguishable
from an agent that died, and this page's whole argument is that those two must never render the same
([silent-success.md](../reusable/silent-success.md)). So *pause* and *confirm the wake* are one
action with two halves, and the second half is the one that will be skipped if it is not written
down. It applies to the staggered resource broadcast identically.

### Ticks on more than one timescale

Greg, 2026-09-08, and it is the design that lets the Overseer obey *never spend what you are
rationing*:

> perhaps we have ticks on multiple timescales, e.g. cheap deterministic tick that checks box health
> and usage limits every 5 minutes, and then stuff that involves the model's input less often.
> Ideally all of these could be configured in the web interface, but that's a nice-to-have
> future-stage.
>
> — Greg, 2026-09-08

**The cheap tick is the one that must never stop**, because it is what still works when the
subscriptions are exhausted — which is exactly the hour it is needed. The model tick is the
expensive one and is bounded, per A30: thirty-six sessions must not produce thirty-six model reviews
a minute. Configuring either from the web interface is explicitly a later stage.

### What is actually observable about usage limits

Researched and then re-verified by hand on 2026-09-08, because the headline finding is the kind that
is easy to believe and wrong in a specific way.

- **`~/.claude.json` → `.cachedUsageUtilization`** is the polling target. Per-window `utilization`
  percentages with an ISO `resets_at` — `five_hour`, `seven_day`, and a set of per-model windows —
  plus `fetchedAtMs` and the `accountUuid`. Verified present and populated.
- **It is a CACHE, and a stale entry reads exactly like a current one.** Checked live: the file was
  48 minutes old and its `five_hour` window had reset 27 minutes earlier, so the `utilization: 70`
  in it described a window that no longer existed. The file always parses and always yields a
  plausible number; nothing in it announces that the number is void.
  **So `resets_at` is not decoration, it is the validity check** — a reading whose `resets_at` is in
  the past must be reported as *unknown*, never as a percentage. Same shape as everything else in
  [silent-success.md](../reusable/silent-success.md), and the same rule `health.ts` already follows:
  a field that can say *I could not tell* beats a zero that reads as healthy.
- **A real 429 is written into the session's own transcript**, with `"error":"rate_limit"`,
  `"isApiErrorMessage":true`, `apiErrorStatus: 429`, and a `quotaLimits` object carrying
  `rateLimitType` (`five_hour` / `seven_day`) and a `resetsAt` unix timestamp. Found in real
  transcripts on this box, both variants. This is exact, greppable, and carries a machine-readable
  reset — **the cheapest reliable signal available**, and unlike the cache it cannot be stale.
- **`claude auth status`** returns JSON non-interactively with `email`, `orgId` and
  `subscriptionType`; `.oauthAccount` in the same file adds `organizationRateLimitTier`. That is how
  the Overseer knows *which* account a reading belongs to — which matters the moment there is more
  than one.
- **There is no `claude usage` subcommand** (verified: it falls through to top-level help), and no
  pre-warning text was found in any transcript — only post-hoc 429s. So *"approaching the limit"* has
  to be derived from the cache, and the cache is the untrustworthy source. **Treat the transcript 429
  as the ground truth and the cache as a hint**, not the other way round.

### Can we call an API instead? Mostly no, and not with an admin key

Greg offered, 2026-09-08: *"If absolutely necessary I can provide an Anthropic admin key in the
.env.local that gets pushed by gjd-remote to this box."* **The answer is that it would not help, so
do not ask him for one.** Researched the same day, sources in the answer below.

- **The Admin API is the wrong billing system.** Every usage and cost endpoint under
  `/v1/organizations/*` — including the Claude-Code-specific `usage_report/claude_code` — reports
  **Console API-key spend**, in daily aggregates, an hour behind. Anthropic's own FAQ says it flatly:
  *"This API only tracks Claude Code usage on the Claude API."* It has no 5-hour or 7-day window, no
  `resets_at`, and nothing shaped like the subscription quota that actually throttles Claude Code
  here. Independently, **admin keys are minted for a Console organization and are documented as
  unavailable for individual accounts**, so a personal Max subscription may have nothing to attach
  one to.
- **The documented `anthropic-ratelimit-*` headers are also API-key-shaped** — organisation RPM and
  TPM, described entirely in terms of workspaces and usage tiers. They do not describe subscription
  traffic.
- **What does carry the real numbers is undocumented**: an `anthropic-ratelimit-unified-*` header
  family (5h and 7d utilisation, reset, and which window is currently binding) returned on ordinary
  OAuth-authenticated requests, and a `GET /api/oauth/usage` endpoint using the session's own token.
  Multiply corroborated, including in Anthropic's own `claude-code` issue tracker. Almost certainly
  where `cachedUsageUtilization` comes from — which explains why that cache goes stale: it is a
  snapshot of headers from the *last* call, not a polled value.
  **Treat as unsupported.** It is unversioned and unannounced, the endpoint is currently reported
  returning persistent 429s for Max users, and there is evidence of fingerprinting against callers
  that are not Claude Code. Nobody found a successful response body to confirm the shape.
- **OpenTelemetry is documented and supported but carries no quota metric** — sessions, tokens and
  cost, which is spend rather than headroom.

**So the design stands where [the section above](#what-is-actually-observable-about-usage-limits)
left it**, and the research is what makes that a decision rather than a shrug: the transcript 429 is
ground truth, the local cache is a hint that must be checked against its own `resets_at`, and there
is no supported API that would do better. Revisit if Anthropic ships the feature request asking for
these headers to be exposed to hooks and statuslines.

**Multiple accounts on one box is mechanically possible.** `CLAUDE_CONFIG_DIR` isolates config,
credentials and the projects directory — verified empirically by pointing it at a scratch directory
(`loggedIn:false`, isolated `projectsDirectory`, real credentials confirmed untouched). Running two
accounts *concurrently*, each logged in under its own config dir, follows from that but has **not**
been tested. Recorded because it is what a medium-term rotation would be built on; it is not a reason
to build one now.

## Reboot revival, and the thing `gjd-remote resume` does not do

Greg, 2026-09-08, pointing at the machinery he expected to cover this:

> see `gjd-remote resume` and also [find-previous-work.md](../reusable/find-previous-work.md) — it
> should be possible to resume other agents after reboot and/or inspect their conversation logs. If
> necessary, write scripts to make this kind of thing easier.
>
> — Greg, 2026-09-08

**`gjd-remote resume` will not do it, and the reason is worth knowing before anybody builds against
it.** It is a literal alias for `attach` — `case "resume": case "attach":` in
[`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — which lists the **live** tmux sessions,
resolves a name among them, and hands you the terminal. After a reboot the tmux server is gone and
that list is empty, so `resume` has nothing to attach to and correctly says so. It resumes a
*connection*, not a *conversation*.

This is [name-is-evidence.md](../reusable/name-is-evidence.md) again, and in its first form: **a name
that does not identify what you think it does.** Two different operations are called resuming — tmux
reattachment and `claude --resume` — and only the second survives a reboot.

**What does survive is enough, and it is already in two places.** The transcripts under
`~/.claude/projects/` outlive everything, and their uuid is exactly what `claude --resume <uuid>`
wants; and the Overseer's register already holds `claudeSessionId` per session alongside the
directory, which is the join key. `find-previous-work.md` is the manual form of the same recovery.

**So revival is a new verb rather than an existing one**: create a fresh tmux session in the recorded
directory, running `claude --resume <claudeSessionId>` instead of a new conversation. That is a small
amount of code beside `new-claude`, which already writes exactly this kind of job script — and it is
the script Greg's *"if necessary"* is asking for.

Two constraints on it, both already established on this page. **The goal is not "restore 36
sessions"** (A26) — a stampede recreates the incident, so revival produces a queue drained under
admission. And **a shell pane is not a resumable agent**: it has no conversation, so it gets a manual
path and an honest label rather than a pretence.

## The four capabilities, and what each really needs

**Seeing the fleet.** The cheapest thing here and the first slice. Note the data problem in
Constraints below — one source is not enough.

**Steering input.** The examples Greg gave — keep going, pull the latest changes, sleep for a while,
be aware the box is short of resources, harmonise with another agent, remove the worktree — are
mostly *text you would type to an agent*, not new mechanisms. That is good news: one delivery
channel serves all of them. The exceptions are the ones with an effect outside the conversation
(removing a worktree), which should be actions the fleet tool takes itself, not sentences it asks an
agent to obey.

**The decision log.** The novel part, and the one nothing currently emits. Two ways to fill it:
agents self-report through a small CLI (cheap, harness-agnostic, needs a rule in
[AGENTS.md](../../AGENTS.md) and agents that honour it), or a model pass over transcripts (needs no
cooperation and works on sessions already running, but costs and lags). Greg's call, 2026-09-08:
**eventually both, start simple, and not before a middle stage.**

Ranking is by *importance* then *model confidence*, with product-facing decisions counting as more
important, and a threshold below which the agent should stop and ask rather than decide. Note that
this is a **rule for agents to follow**, not something the dashboard enforces — the dashboard's job
is to make the decisions visible so a bad threshold shows up.

**Creating and killing agents.** `gjd-remote` already does both
(`new-claude`, `kill`) and has the hard-won safety properties — see
[hetzner-remote-server-box.md](hetzner-remote-server-box.md). Reuse it; do not grow a second way.

## What Greg asked for on 2026-09-08, in his own words

The first three capabilities above got concrete on the day the read-only page started working.
Quoted rather than paraphrased, because the specifics are the point — several of them name a
mechanism, and a paraphrase would lose it.

> For the `Sessions` mode, ideally list all the sessions in the left-hand column, with different
> ways to order them (how long they've been running, status (the default), anything else that might
> be ueful, etc). And then if I click on a session, show much more information about it in the right
> column, e.g. input it requires from me, the recent messages, and anything else that might be
> useful. Allow me to send steering messages to it, answer its questions, etc

> I want a way to add a New session, with a text input box, perhaps using `gjd-remote new-claude
> -p ...` so that I can still use that machinery to manage things.

That parenthesis is load-bearing rather than a preference. Session identity lives in the tmux
environment `new-claude` pins at launch, so a session started any other way is classified as a bare
**shell** and arrives on the page anonymous and unsteerable. Reuse is not tidiness here; it is the
difference between a row that works and a row that does not.

> Ideally reuse the same machinery for voice-dictation and live-chat that we use in Spideryarn, for
> any session-input-message boxes (e.g. new session, steering messages, answering questions, etc)

See [dictation.md](dictation.md) and [live-conversation.md](live-conversation.md). Note the standing
rule that this tool does not reach into `src/` (Principles, below) — so this is a *port*, and the
question of whether the boundary should move is a real one to answer rather than assume.

> Add action-buttons we can take in a given Session, e.g. continue, compact, pull, push, remove
> worktree, exit, run unix sleep for 1h/3h/5h/10h, get input from Fable/GPT Sol and then use your
> judgment, and anything else you can think of. (And ideally these would queue/steer if it's
> currently running, so that one could press more than one, in combination with messages)

**"Queue" is the hard word in that sentence**, and it is the right instinct: an agent that is
working cannot be typed at usefully, and pressing three buttons should not race. It also crosses a
line the doc already draws — most of these are *sentences you would type*, but `remove worktree` has
an effect outside the conversation and should be an action the tool takes itself.

> Add action-buttons that we can take in Box Health (see
> [diagnose-box-resources.md](../reusable/diagnose-box-resources.md)), e.g. kill anything that's
> safe to do, send a broadcast message to all agents telling them about box resources and asking
> them to pause for a staggered period of up to an hour and/or kill stuff they can easily restart,
> kill all the running tests

**Staggered** is the word to build against. Thirty-six agents told to pause for an hour all resume
in the same second, and the box falls over at the far end instead of the near one.

> Add functionality to the Orchestrator tab, e.g. send a message to the Orchestrator (reusing
> voice-dictation/live-realtime/etc), send a broadcast message to all agents.

And on how to work:

> Get product judgments from Fable primarily, and more of the technical reviews from GPT Sol

## A higher bar for robustness here than elsewhere, and its ceiling

Greg, 2026-09-08, asked for this to be written down:

> We want a higher bar for robustness for this orchestrator work, because the orchestrator needs to
> be the one that fixes other problems. But at the end of the day, if the orchestrator broke I could
> just ssh in and use Claude Code in the terminal, so it still wouldn't be the end of the world.

Both halves matter, and the second one stops the first becoming an excuse for gold-plating.

**Later the same day he made it a gradient, and named the web interface**, closing
[open-questions.md](open-questions.md)'s Q12:

> Briefly broken is fine for dev, have a slightly higher standard for the orchestrator and its web
> interface, and a higher standard still for keeping things working in prod.
>
> — Greg, 2026-09-08

Two things follow that a reader of the paragraph above would not have known. **The licence in
[AGENTS.md](../../AGENTS.md) does apply to `dev`** — that was genuinely in question, and the argument
against it (a red trunk is inherited silently by every worktree that pulls, and agents cannot consent
to absorbing that the way beta readers consented) was put to him and ranked below moving fast anyway.
That is his call and this is the record of it. **And the dashboard is in the middle tier with the
daemon, not the bottom one with the product** — which matters because the dashboard is the half that
looks like an ordinary web page and is therefore the half where the product's habits creep in.

**Why higher than the product's bar.** [CLAUDE.md](../../CLAUDE.md) says this is a beta and speed
still wins — that a thing being briefly broken is not the end of the world. That is a judgement
about *readers*, who are few and know what they signed up for. It does not transfer here, because
**this is the tool you reach for when something else is wrong**. A monitoring tool that fails at the
same time as the thing it monitors has told you nothing, and worse, has told you nothing in a way
that looks like good news: a quiet page and a healthy box are the same picture. Every "I could not
tell" arm in this codebase exists for that reason and they are not decoration.

Concretely, the bar is:

- **A reading that could not be taken must not render as a reading.** Enforced by types, not by
  care — `unknown` carries a cause, an empty list is meaningless without a clock.
- **And the half that was missing until 2026-09-08: an honest type does nothing if its consumer
  flattens it.** Every "I could not tell" arm in this codebase is a producer-side discipline, and
  three separate defects that evening were all consumer-side — the producer said the careful thing
  and the caller collapsed it:
  - `parseAttempt` returned *cannot tell*; the daemon kept the previous positive timestamp, and
    announced **"collector stopped for 420s"** about a collector it simply could not see.
  - The fleet server computed a per-item `stale` flag and put it on the wire; **the page threw it
    away**, so a dead queue item drew as a waiting one.
  - `statusSince` was a floor for any session already running at startup, and nothing in its shape
    said so, so every renderer would have shown it as a measurement.

  **So the rule has a second clause: the consumer must be unable to discard the distinction**, which
  in practice means passing the discriminated value rather than a primitive extracted from it.

  **And the class is wider than "server says, client drops" — that framing was too narrow, corrected
  the same evening by the agent that found the counter-example.** The same defect runs the other way,
  where **the page is the producer and the route is the consumer**: a box-action body sent `dryRun`
  and the route only ever parsed `mode`, so **every box action ever pressed was a dry run reported as
  "Done."** *Kill test suites* killed nothing and said it had. So the honest statement of the class is
  **two hand-written declarations of one contract, in either direction** — and the request side is the
  worse of the two, because a wrong read draws a wrong page while a wrong write runs, or fails to run,
  a command that kills processes. The
  attempt-clock fix is the model — the repair was not a new branch, it was changing
  `collectorVerdict`'s parameter from `number | null` to the three-armed reading, so that flattening
  it stopped being expressible. **A `T | null` at a seam is where two different facts get to share one
  slot**, and by that evening's count five or six of this system's "cannot tell" arms exist because
  one did.
- **The thing must survive the conditions it reports on.** It runs under `scripts/tmux-job.ts`,
  because a backgrounded process is OOM-killed on *system* memory pressure — demonstrated
  2026-09-08, when an orphaned copy died at load 28 while the tmux copy kept collecting.
- **A write refuses rather than degrades.** There is no second-best action; "sent" and "did nothing"
  must never be the same response.

**And the ceiling, which is the useful half.** The fallback is `ssh` and a terminal, and it is
complete: `gjd-remote` does everything this page does and predates it. So this is a **convenience
with a manual fallback**, not infrastructure — which rules out the expensive answers. No high
availability, no second box, no state that only this process knows how to reconstruct, and nothing
that would make the ssh path harder if this were switched off tomorrow. Where a choice is between
"correct and unavailable" and "plausible and up", take the first: being down is recoverable in one
command, and being confidently wrong is not.

## Constraints already established

These were measured on the box, mostly on 2026-09-07, and several cost real time to learn. **Read
these before designing anything that talks to a session.**

- **"Needs you" is usually a numbered modal dialog**, not a text prompt — captured live from a
  session blocked on a 4-option menu. So the valuable action is *answering a question*, which no
  free-text message can do.
- **`tmux send-keys` works and is currently the only proven channel.** `Down` then `Enter` answered a
  real trust dialog. Narrow use — a digit or an arrow at a dialog we can see — is far safer than
  typing prose into an unknown UI state.
- **Delivery over the Claude inbox socket is NOT established.** An early claim that it worked was
  retracted on 2026-09-07: the socket accepts the connection and returns no error whether the token
  is right, wrong, or absent, and nothing arrives. The apparent success was the test string being
  read back out of the sender's own transcript. Capturing `{socket, token}` from a `SessionStart`
  hook *does* work; it is the delivery that does not. If anyone revisits this, **use a nonce
  generated inside the sending script and written only to a file**, so it cannot appear in a command
  and be mistaken for a delivery ([silent-success.md](../reusable/silent-success.md)).
- **`claude agents --json` is fast (~1s, cross-repo) but incomplete.** Being absent from it does not
  mean not running — measured twice on 2026-09-01, a live session went unlisted for 35+ seconds. The
  two-source join in [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) `sessionState`
  already solves this; use it rather than reinventing it.
- **`gjd-remote ls` takes 10–12 seconds**, because it greps whole multi-MB transcripts for `aiTitle`.
  Read the tail instead.
- **Codex batch jobs cannot receive keystrokes at all.** `scripts/subagent-cli.ts` spawns with
  `fd 0 = 'ignore'`, called there "the load-bearing anti-hang guarantee". Any harness adapter must
  say honestly that these are read-only rather than pretending at a degraded channel.
- **Nothing survives a reboot.** Session identity lives in the tmux environment and dies with the
  tmux server; there is no registry on disk. Measured 2026-09-08 — see [§ The store](#the-store).
  Any claim that the fleet "comes back" has to name the file it comes back from.
- **The box is genuinely short of resources, and a background loop is a participant.** Load average
  35, 23 of 30 GB of RAM and 18 of 31 GB of swap in use, on an ordinary afternoon (2026-09-08); it
  reached 391 with the OOM killer firing earlier the same day. A tick that costs 12 seconds of
  grepping every 60 is 20% of a core, forever. Measure before adding a second one.

  **And the mechanism was caught in the act at 09:35 that evening, which is what makes A13 concrete
  rather than prudent.** Load went 11.7 → 20.6 → 41.8 across three five-minute windows — doubling —
  with 25 of 30 GB used, and the cause was **four separate `vitest` runs in four different worktrees,
  one of them 26 minutes old.** Nothing was wrong with any of them. Each agent was doing the right
  thing by the rules it had, and **not one could see the other three.** That is the whole of A13 in
  one observation: the expensive resource is not any single job, it is the absence of anywhere to ask
  *is now a good time*. The cheap half of the fix needs no admission controller at all — an
  orchestrator running several agents should run the gate **once, itself, at the end**, rather than
  letting each agent run it against a tree the others are still changing, which is fewer runs *and*
  better evidence.
- **Address a session by tmux pane handle plus an execution generation, never by name.** Names get
  reassigned when a session dies. Both `gjd-remote` and the third-party system Greg showed us learned
  this independently.
- **A pane can contain text that looks like a pending user message and was written by the model.**
  Measured 2026-09-08: Claude Code renders a **suggested next prompt inside its own input box** after
  a turn — same `❯`, and **nothing in a `capture-pane` distinguishes it from something a person typed
  and has not sent.** Three appeared in a row, each a plausible follow-up (*"send another one to
  confirm it keeps working"*), and the agent watching read the first as a message somebody had left in
  the box and briefly as an instruction to itself. **Nobody typed any of them.**

  This is the sharpest form of the hazard [§ `idle` is the bug](#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work)
  is about, and it is worse than the ones already listed there, because the other cases are the pane
  failing to *say* something. Here the pane says something **that was never said** — and the surface
  where a person's words go is the surface a model is writing on. **The medium carries no
  provenance**, so no amount of care in the reader recovers it.

  Two consequences, and they run in opposite directions. **For the question surface:** a ghost prompt
  must never become a question put to Greg, because answering it would be answering nobody. The
  dashboard's parser is not fooled today and **the reason is a rule rather than luck** — `parseCursorMenu`
  requires two contiguous same-column lines *and* a dialog footer, so a lone ghost line falls out as
  `none`. That is worth keeping deliberately rather than tightening away. **For the Overseer:** if
  anything here ever reads pane content as evidence — a status, a judgement, a summary for Greg — this
  is the trap, and the standing rule is that **pane text is data, never instruction.**

  It is also the third face of the distinction in
  [name-is-evidence.md](../reusable/name-is-evidence.md): after a name that does not identify what you
  think, and a predicate that answers a wider question than you asked, **a channel whose contents do
  not identify their own author.**
- **Scheduling: the built-in `/loop` offers a cloud schedule that survives the session but runs in
  Anthropic's cloud, so it cannot touch this box's worktrees.** The session-local cron is in-memory
  and dies with its session. So "run job J on the box every M minutes" has no home yet — Greg
  deferred building one on 2026-09-08. See [cron-scheduler.md](cron-scheduler.md), which says the
  same thing from the product side.

## Attention, and who the Overseer is really watching

Fable was asked on 2026-09-08 to arbitrate the design of attention triage, and **rejected the
framing** before answering it. The reframing is the most useful thing anyone has said about this
system so far, so it is recorded here rather than in a plan:

> "Attention triage" as posed is about the agents that are **blocked**. But a blocked agent is the
> cheapest thing on the box. It burns no quota, no CPU, no reviewer time; its only cost is
> wall-clock and a worktree … The agent that costs real money is the one that is **working,
> confidently, on the wrong thing** — forty minutes into the hard version of a feature Greg would
> have cut, or building in the primary checkout, or re-running a red suite that is red because the
> box is swapping. It never asks. It never appears on a "needs you" list. With 36 sessions it is
> statistically certain one or two are doing this right now.
>
> — Fable, 2026-09-08

**So the scarce resource is not attention to questions; it is attention to direction.** The question
surface still gets built — it is where the taps go — but it is the small, boring half. The proxies
for misdirection already exist in what we collect: plan-doc name, last commit, time since a push,
whether the session is in the primary checkout.

### Three surfaces, not one page

- **The inbox — act.** One question at a time, not a ranked list of sessions. **The unit is the
  question, not the session**: at 11pm nobody cares which of 36 asked. A card shows the question, its
  options, the agent's recommendation, one line of context, and two actions — answer, or skip.
  Sorted by *kind* first (irreversible, product, technical, other) and only then by age, because
  the agent that has waited longest is the one for whom ten more minutes matters least. **Age is a
  tie-breaker, not a rank.**
- **The log — calibrate.** What was decided on Greg's behalf since he last looked, by whom, and what
  landed. This is his own first bullet from § What we are going towards, and it is the 8am surface.
- **The roster — look.** The full fleet, for when you want to look around.

Two things the inbox does that a list cannot: **collapse duplicates** (with 36 agents on one box
several hit the same wall at once — "tests are red, is it me?" — so answer once and apply to all,
and a repeated duplicate is the strongest available signal that a *policy* is missing), and **mark
which questions are answerable from a phone at all**, since one whose answer needs reading a diff
just makes him feel behind.

### Push almost nothing

Two categories only, per Fable: **something irreversible or externally visible** (a deploy, a
production write, spending money, a push to `main`, removing a worktree with uncommitted work), and
**the box or the Overseer dying**. An agent blocked on a question is *not* enough to push, at any
duration.

> notification blindness is a one-way door. Once he learns the buzz is usually an agent asking
> whether it may run `npm test`, the buzz that says "about to push to main" is lost too, and no
> ranking buys that back.
>
> — Fable, 2026-09-08

Every other failure here is recovered by waiting; that one is not. The named escape hatch, if agents
sit too long: one daytime nudge, *"N things have waited more than two hours"*, at most every two
hours — and the signal that the strict version was wrong is a median wait past ~4 hours, or Greg
saying "I'd have wanted to know sooner" twice.

### Route by who has the information, not by confidence

Greg's rule in [§ What we are going towards](#what-we-are-going-towards) says agents should escalate
below a confidence threshold. Fable's amendment: **confidence is the wrong hinge** — a model's
self-reported confidence is its least reliable output, and a threshold on it is exactly the tuned
parameter this design should not have. Route on *who holds the information*, with reversibility as
the override:

- **The Overseer answers only what it can verify**, never what it must judge — "pull latest" is
  always yes; "are the tests red because of me?" is answered by checking other trees; "is the box
  overloaded?" from vitals it already has; and a question already answered today for another session
  gets the same answer.
- **Sol** for technical questions whose evidence is in the tree; **Fable** for wording, defaults, and
  whether a case can be dropped.
- **Greg** for anything irreversible or externally visible, anything changing a rule doc, anything
  where the routed model *disagreed with the agent's own recommendation* (**disagreement is the
  signal, not a low score**), and any question of the form *would a small product tweak remove a lot
  of this engineering?* — because his answer to those is often a fifth option nobody offered.

Two disciplines keep this honest: every non-Greg answer is **attributed** on delivery ("Fable via the
Overseer, not Greg") so the agent weights it correctly, and every one is **vetoable after the fact**
from the log. A veto is just a steering message.

### `idle` is the bug: the vocabulary describes the pane, not the work

**Measured on the live fleet, 2026-09-08, and it invalidates the premise triage was about to be built
on.** `needs-you` means *Claude Code says a dialog is open*. That is not the question Greg needs
answering, and there are at least two populations of sessions that are anything but idle while the
page calls them idle:

- **Sessions that finished a turn by asking Greg something in prose.** Fable read all 38 live panes:
  **ten of fifteen** sessions genuinely waiting on him had ended their turn handing him a decision in
  sentences, and **not one of them showed as needing him**. A mechanical check found 1 of 23 by
  grepping for question marks — because the decisions end in full stops.
- **Sessions waiting on a Codex subprocess.** **4 running `codex exec`, 0 Codex tmux sessions**: a
  review runs inside a Claude session's Bash tool, so a session waiting 15–45 minutes on a paid
  review reads as `idle` for the whole of it.

- **Sessions with a dialog open that the status does not know about.** `needs-you` is derived from
  `claude agents --json`; the pending question is scraped from the pane. **They are different
  sources**, so a row can be honestly `working` while a numbered dialog is on screen. Found by GPT
  Sol reviewing the steering path, where its consequence is worse than a mis-sorted list: a steering
  message beginning "1" arriving while a dialog is up **is an approval**, and the route returned 200.

The dashboard agent's phrasing is the finding, and it is worth keeping exactly:

> our vocabulary describes the pane, and the thing Greg wants to know is about the work.
>
> — 2026-09-08

**Three cases, three different reasons, and none of them is a bug in `sessionState`** — which is the
point. It reports faithfully what its two sources say. The gap is between *what the box can observe
about a pane* and *what a person needs to know about a piece of work*, and no amount of care inside
the status function closes it.

**The two halves need different machinery, and that is the useful part.** Subprocess ancestry is in
the process table, so the Codex case is *mechanically* detectable and should be — a status arm, not a
model call. The prose-question case is not: **"has this agent asked Greg something?" is a judgement,
not a parse**, and it is exactly what the Overseer's short-lived model calls are for. A ranked list
built on `statusOf` alone would have ranked the wrong sessions, confidently.

**Measured on 2026-09-08, and it corrects the second bullet above rather than confirming it.** The
Codex arm was built, and then run against the live fleet: **40 samples 60 seconds apart over 40
minutes, 927 session-rows. Of the 623 rows the page called `idle`, the number with child work under
them was zero.** A live probe agrees. That zero is real rather than a broken path — a positive
control caught a deliberately-started `vitest` at depth 5 with a correct age, and four other sessions
*were* found working, all hand-checked, no false positives.

**The reason is the interesting part, and it narrows the original claim.** Throughout a real, paid
`codex exec`, the dashboard reported that session as **`working`, not `idle`** — because its agent
was mid-turn in the same session. **A review inside a foreground Bash call already reads as
`working`.** So the population the bullet above describes is not "sessions running a review"; it is
the narrower "sessions whose agent **ended its turn** while a backgrounded review carried on", and
how many of those exist depends on how agents happen to dispatch reviews rather than on anything
structural. The arm is correct. Its yield is smaller and more conditional than the finding implied,
and that is worth knowing before ranking work on top of it.

**And the number that made the case is not a constant.** A dispatched `codex exec` sits eight levels
below the pane *with a `timeout` wrapper*, seven without, five for a plain `npx vitest run`, and
three under `scripts/tmux-job.ts`. A depth limit tuned to eight would have been tuned to one
person's typing. What survives intact is the counting trap: **five processes in that chain carry
`run-codex.ts` and exactly one carries `codex exec`**, so a recogniser matching the wrapper reports
one review five times.

**The best thing the sweep found was not a Codex run.** `npx playwright@1.62.1 install webkit` had
been running **5 hours 43 minutes** under a `shell` pane, present in all 40 samples, almost certainly
wedged, and nobody had noticed. It needs no new recogniser: **for a `shell` pane the pane's own
command line already says what it is doing**, so reading that generalises further than growing a
table of recognised tools. That is the shape of the whole section — the box usually already knows;
the vocabulary is what discards it.

**Who builds which half, settled between the two agents on 2026-09-08.** The mechanical half is the
Overseer's, and *not* as a new arm on `SessionState`:

> **The dashboard reports the pane; the Overseer decides what the work is.** `panePid` is a fact
> about a pane; "this session is waiting 40 minutes on a paid review" is a judgement about work, and
> judgements belong on the Overseer's side. Adding a `SessionState` arm would encode a conclusion in
> a field whose whole job is to report an observation — the exact thing `sessionState` gets right.
>
> — agreed between this agent and the fleet dashboard agent, 2026-09-08

So the Overseer takes `panePid` out of the snapshot it already receives and walks the process tree
itself, inside `tools/overseer/`. No shared contract changes and no coordination cost.

**And the `needs-you` sub-kind, which came out of the same exchange.** *An agent asked me something*
and *the harness wants a permission* are different work items — and on this box the second is nearly
always a **launch defect**, since auto mode should have handled it. A live capture on 2026-09-08 had
the harness saying so in the prompt itself: *"Tip: auto mode handles these prompts for you."* So a
permission-class dialog is not a queue item for Greg at all: **the action is to fix how that session
was started**, pointed at a different person entirely. The dashboard agent's phrasing of the rule
underneath it, from Fable: pane text as executable UI is acceptable when execution means *"a user
turn"*, and not acceptable when it means *"grant a permission"* — a forged menu can then make Greg
send a digit to an agent that was already misbehaving, but it cannot mint an approval.

This also sharpens [§ Attention](#attention-and-who-the-overseer-is-really-watching): Fable said the
expensive agent is the one working confidently on the wrong thing, and never asks. Add to it the
agent that *did* ask and whose asking is invisible.

**And the measurement that turns that last sentence into a number, 2026-09-08.** The fleet dashboard
agent investigated which permission mode sessions actually start in, and the answer was a coin flip:
**28 auto, 7 default across `gjd-remote` launches since 09-06** — two sessions launched 25 seconds
apart from identical generated job scripts came up in opposite modes. A `default`-mode session runs
normally until its first unapprovable call — a `git fetch`, a `git log`, `npm run worktree:setup`, an
MCP read, so within the first minute of almost any brief here — and then waits for somebody who is
asleep. **Longest single stalls: 7.38h, 6.34h, 5.75h, 5.35h, 5.33h, 4.30h — 34.9 agent-hours since
Sunday**, independently reproducing an earlier finding of 41.6 agent-hours since 09-01. The longest
stall in *any* always-auto session over three days is **21 minutes**.

**And the fix landed, measured 2026-09-08 12:20 — 35 `auto`, 1 `default`, against 28/7 before.**
`gjd-remote new-claude` now passes `--permission-mode auto` explicitly, with the reasoning in a
comment beside it rather than in a doc nobody opens. Greg asked for this on 2026-09-08 —
*"if there's a tweak that ensures the fleet is in auto-permissions mode, let's do that"* — believing
he had already done it, which he had not.

**The measurement is worth more than the flag, because a flag being present is not a fleet being in
auto mode.** Every transcript touched in the previous six hours was read for its **last**
`permissionMode` checkpoint — the current mode, not the launch mode, so a session converted mid-life
is counted where it actually is. **36 of 78 carried one**, which is the positive control: a probe that
found none would be broken rather than reporting a clean fleet
([silent-success.md](../reusable/silent-success.md)). And the single `default` is not a
counter-example — a 17-line *"Reply with the single word: pong"* probe from 05:44 that never went
through the launcher at all. **Nothing launched by `gjd-remote` came up in `default`.**

**Nothing on this box notices**: `gjd-remote log` lists a stalled session as `running`, identical to a
healthy one. So this is the sharpest available instance of *the agent that did ask and whose asking is
invisible* — and unlike most of this page it comes with a rate rather than an anecdote.

**A candidate Overseer arm, deliberately not built in O1**, because it is new capability rather than a
gap between the code and the plan. Two notes for whoever does build it. **Read `permission-mode`, not
`auto_mode`** — the latter is a per-*turn* attachment, so its absence means "no turn ever ran in auto
mode", which reads identically for a session that entered auto mode late and misreports every session
converted mid-life; `permission-mode` is a checkpoint written at every turn boundary and is
authoritative. And note what the two sides see: a pane-status substring answers *"is this session
showing a prompt right now"*, while `permission-mode` answers *"will this session stall the next time
it does anything"* — **a prediction rather than an observation**, which is the more valuable of the
two and the reason to build it properly rather than quickly.

### Remote Control fails quietly, which is A27's shape again

**8 of 23 live sessions had Remote Control broken**, measured 2026-09-08 — the feature that was
originally offered as the reason this dashboard might be unnecessary. It is reliable at launch and
unreliable an hour later, which is exactly when you would reach for it, and **the only evidence
anywhere is one word at the bottom of a terminal nobody is looking at.**

So the redundancy argument was right about launch and wrong about steady state. Recorded here rather
than only in the dashboard's plan because it is the same shape as **A27**: a thing that reports fine
until the moment it is needed, with no signal reaching anyone. Two local heartbeats cannot report the
box disappearing, and a status bar cannot report its own channel dying.

### Does the augmentation principle apply?

Partly, and not the obvious part. In reading, the understanding *is* the product, so a summary that
replaces it defeats the point; in supervising, the **decision** is the product, and it is fine for
the Overseer to summarise what 36 sessions did overnight. What carries over is the other half:
**never hide that a decision was made, or who made it.** The thing to refuse is a tool that makes the
fleet *look* supervised — a calm page, a green count — when judgement was quietly substituted.

### The failure to design against

**Notification blindness**, because it is the only one that cannot be undone by waiting. And its
sibling, which this project keeps meeting: **the Overseer silently dead while the page says "nothing
needs you"** — an absence reported as success. Hence the heartbeat, and hence *"the Overseer was last
seen 40 minutes ago"* belongs where the count would be, not in a footer.

### Things the framing was missing

Fable's list, kept because each is a candidate stage: an answer that lands in a dead pane looks
exactly like one that worked, **so a card should disappear when the session's status changes, not
when Send is pressed**; *finishing* is attention too, so "done, green, ready to remove" belongs in
the inbox as a one-tap and shrinks the roster; **every answer Greg gives is a candidate rule**, and
the third identical answer should say so, which is how the inbox shrinks over weeks without anyone
designing a threshold; steering costs the target its context, so batch it and time it for idle; and
quiet hours are one line of config.

## Access

**Tailscale for now** (Greg, 2026-09-08) — the server binds a private interface, and reachability is
the access control. Chosen as scaffolding to get something on a phone quickly, over the
Cloudflare Tunnel route which needs a throwaway domain and several manual steps.

If this later moves to Cloudflare Access, the thing that changes is not the server but the trust
model, and one difference must be designed in rather than discovered: **a tailnet IP is unforgeable
at the network layer; an HTTP identity header is not.** Verify the `Cf-Access-Jwt-Assertion` JWT —
issuer, this application's `aud`, algorithm, expiry, clock skew, fail closed when JWKS is
unavailable — and never trust `Cf-Access-Authenticated-User-Email` on its own. Add CSRF protection
on mutations too: an Access cookie proves who the browser belongs to, not that a human pressed Send.

## The backlog, after the wide review

**GPT 6 Astra reviewed the whole approach on 2026-09-08** at Greg's request — Overseer and dashboard
together, wide brief. Its verdict: *"The direction is worth pursuing, but the live write path has
outgrown the original security argument."* It endorsed the daemon, the fleet layer and one collector,
and asked us to change the assumptions around authorisation, approval context, delivery receipts and
recovery **before** adding autonomous coordination. Full text:
[260908b-whole-approach-review-astra-v2.md](../plans/260908b-whole-approach-review-astra-v2.md).

Two caveats on reading it. It reviewed revision `35e4d368`, so **`bad6eee5` and the new-session route
postdate it** — its A15 complaint that `FleetRow` loses the directory and metadata was fixed while it
was running. And where it says *"I am identifying an architectural exposure, not claiming an exploit
exists"*, that distinction is its own and should survive being quoted.

Ordered by value against effort, with the owner named because two agents are building here.

### Securing the live write path — a stage, but not the top one

**Greg, 2026-09-08: "Let's include it as a stage, but it doesn't have to be the top-priority."**
Astra put this block first, ahead of everything Greg had ordered, on the grounds that the write path
was designed when it was read-only. Greg has read that argument and ranked it anyway, which is his
call to make — the tailnet is small, the devices are his, and the fleet's actual failure so far has
been resource collapse rather than anything hostile. So this is scheduled work rather than a stop.

**A9 is the exception worth watching**, because it is not a hardening item: an approval that binds to
the question sentence rather than to the diff is wrong even with no attacker at all — it can show
Greg one thing and approve another after an ordinary re-render.

**A9 and A10 landed on 2026-09-08** and are ticked in the table below rather than removed from it,
because each carries a finding worth keeping. A9's is that binding an approval to the question
sentence discards the diff *by construction*, not by a slip. A10's is sharper than the row says: the
gap is not only that prose might append to a draft but that it **does**, and the concatenation is
submitted as one turn — so the dashboard can deliver an approval nobody wrote, through the prose
door rather than the dialog one. Proved end to end on a throwaway session, and the fix, the two
things it cost and the two conclusions that turned out to be wrong are in
[260908f-prose-needs-an-empty-input-box-not-merely-a-box.md](../plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md).

**One thing A10 did NOT close, stated because the row implies otherwise.** *"Or reach a foreground
program"* is still open. Neither `#{pane_current_command}` nor `/proc`'s `tpgid` can see it —
Claude, the pane's bash and any child share one process group on this box, measured on three panes.
**And Claude Code's own `~/.claude/sessions/<pid>.json` is not the answer either**, which is worth
recording because it looks like one: a guard on its `status: "shell"` was built and removed on
2026-09-08, after GPT Sol read the 2.1.263 binary and found that the field means *idle with an
unfinished `local_bash` task* — true whenever a backgrounded job is running behind a session that is
perfectly able to receive a message. The guard would have refused every message to such a session
indefinitely and starved its queue. The expression is quoted in `steer.ts`'s KNOWN GAPS so nobody
rebuilds it from the same wrong premise.

| | what | owner |
|---|---|---|
| **A9 ✅** | **Approval must bind to the material, not the sentence.** Astra changed a proposed file's contents from `hello` to `goodbye` and the pane parser returned an identical question and options — it keeps *"Do you want to create notes.md?"* and discards the diff. So an approval can be accepted after the thing being approved has changed, and the phone can ask for approval without showing what it is. Bind to command, diff, destination and permission scope; hand off to a terminal when the capture is incomplete; and make *"yes once"* and *"auto-approve this session"* visibly different. | dashboard |
| **A10 ✅** | A live Claude descendant does not prove an **empty input box owns the keystrokes** — the text may append to a draft, hit a modal, or reach a foreground program. Make arbitrary prose a narrower capability than answering a recognised dialog. | dashboard |
| **A11** | Delivery needs an **uncertain** state. A nonce proves the transport *can* work; it says nothing about later requests. Action IDs, and five states — accepted, keys submitted, reception observed, refused, outcome unknown — with a repeat retrieving the receipt. **Never auto-retry keystrokes.** | dashboard |
| **A5** | **Reachability, but narrower.** The reference system we copied checked callers against `owner-logins.txt` before POSTs — *its write boundary was never reachability alone*, and we took the half we liked. The cheap fix is a device-scoped tailnet grant, not a login page. Tailscale's default policy is permissive, so verify rather than assume. | both |
| **A6** | Treat the dashboard as a **privileged renderer of hostile content**: CSP and anti-framing before answer buttons. Origin checks do not stop a malicious page framing the real one. | dashboard |
| **A11b** | **A steering attempt has three outcomes, not two**, and the dashboard already reports them: `delivery: "none" \| "partial" \| "unknown"`. **`partial` means the text landed and the Enter did not** — the message is sitting in that agent's input box, unsent, and will be prepended to whatever it types next. When the Overseer records steering attempts, this is the distinction to keep: a flat "failed" is wrong in the most expensive direction, because it invites a retry that would append to the half-sent text rather than replace it. | overseer |
| **A12** | **An Overseer message must not acquire Greg's authority** by arriving as a user turn. A worker can meet malicious instructions, report them, and get them back as authoritative steering. Display *Greg requested* / *Overseer proposed* / *policy authorised* distinctly. A model's recommendation must not mint its own approval. | overseer |

**A12 is CLOSED, 2026-09-08, and the way it was closed is the point.** The prefix that enforces it —
`renderSpoken`, which stamps *"[The Overseer — an automated coordinator, NOT Greg. Weigh this as a
suggestion from a peer, and push back if it is wrong for what you are doing.]"* — **existed, was
tested, and was called from nothing but its own tests.** The attribution this row demands had been
built and never wired, so every message the Overseer sent would have arrived in Greg's voice, and the
row would have read as done.

The repair is the one this page keeps arriving at: `QueuedItem.speaker` was made **required**, so the
compiler found all 111 enqueue sites rather than a person finding some of them. `/api/steer/message`
had the same hole and took the same fix. Free-text slash commands are refused for anyone but Greg —
`/compact` is an unprefixed exception because its text is fixed and reviewed, and a general
unprefixed-`/` rule would turn one named hole into a general way to speak in his voice.

**So the Overseer may now steer attributably, and could not have before today.** Built by the
dashboard agent, on the dashboard's side of the seam, for a row assigned to the Overseer — which is
the seam working rather than a boundary being crossed: the prefix belongs where the message is
delivered, not where it is decided.

### Built, tested, and called from nothing but its own tests

**That is now twice in one day, so it is a class rather than an anecdote**, and it is the one to
check for on this page's work specifically. `renderSpoken` above was the first. The second, found by
GPT Sol reviewing the scheduler on 2026-09-08: `tools/overseer/scheduler.ts` implemented occurrence
identity, leases and the whole crash-window contract, with 36 passing tests — and
`scripts/overseer.ts` called `runOverseer` without `jobs`, so `daemon.ts` set `jobsTicker` to `null`.
There were no job definitions and no `SpawnJob` implementation anywhere outside the tests. The
reviewer's sentence is the one to remember: *"This revision contains a scheduler engine, but the
installed Overseer schedules nothing."*

**Why it keeps happening here rather than elsewhere is worth naming.** This area is built as a
library of honest mechanisms — a lease, a prefix, a three-armed reading — each of which is *testable
in isolation*, and isolation is exactly the condition under which a green suite says nothing about
whether the thing runs. The tests are not weak; they are answering the narrower question, and both
times the passing suite was the reason nobody looked.

**Three things catch it, in order of how mechanical they are.** Make the wiring a *type* obligation
rather than an option, the way `QueuedItem.speaker` was made required so the compiler found 111 sites
— an optional `jobs` parameter is the whole of this defect in one word. Failing that, **a test that
exercises the real entry point**, not the engine: the daemon test that pinned "no jobs, no occurrence
events" was faithfully describing the shipped state and reading as a pass. And failing that, ask of
every new mechanism *what calls this in production*, and answer it with a grep rather than from
memory.

**And the reporting rule that follows**: a capability that is off must never render the same as a
capability that has nothing to do. The scheduler's opt-in exists for that reason as much as for
safety — *armed and idle* and *not armed* are different sentences, and this page's whole argument is
that a quiet surface and a healthy one must not be the same picture.

**A5 is CLOSED too, 2026-09-08, and the answer was none of the options.** Astra's row said *"Tailscale's
default policy is permissive, so verify rather than assume"*, and nobody had verified. Greg's
instruction: *"Get input from GPT Sol and/or Fable then use your judgment about whether/how to deal
with this now."* Measured first, arbitrated second.

**What the box actually says.** The tailnet has **exactly two devices** — this box
(`100.92.255.119`) and Greg's iPhone, both his — and `tailscale serve status` and `funnel status` both
report **"No serve config"**, so nothing is public. **The running dashboard binds `127.0.0.1` only**;
it is not tailnet-reachable at all today, and Greg reaches it over an ssh forward. The repo's unit
already says `Environment=FLEET_BIND=127.0.0.1`, and
[a test enforces exactly that string](../../tests/systemd-units.test.ts). **The widening is not in the
unit — it is in `/etc/fleet-dashboard.env`**, which exists on this box, contains
`FLEET_BIND=127.0.0.1,100.92.255.119`, and is read at start because `EnvironmentFile=` comes after
`Environment=`. So the surface widens at the instant `systemctl enable --now` runs, and not before.

**Fable's verdict, and it reframes the row rather than answering it:**

> A5 hardens a boundary against parties that don't exist yet while A7 (deferred, reasonably) leaves
> the real one open. Fixing A5 now buys nothing that A7 hasn't already given away.
>
> — Fable, 2026-09-08

All 27 agents share one Unix user and can already reach `127.0.0.1:8787`. **The untrusted parties that
actually exist are on the loopback side of the bind, not the tailnet side**, so the two deferrals are
consistent and fixing one without the other is not.

**And the "cheap fix" Astra proposed is not cheap, for a reason worth keeping.** *Tailscale ACLs have
no deny rule* — everything is allow. Restricting `:8787` to one device cannot be done by adding a
grant beside the default `*:*`; it means deleting the wildcard and enumerating everything else that
must still work, **including the ssh Greg reaches the box by**, in a console no agent can read or
test, with lockout as the failure mode. That is a whole-policy rewrite, not a paste.

**So the rule attaches to the widening, not to a backlog.** The dashboard binds loopback and has no
write-path auth because the only parties who can reach it already own the box (A7). **Anyone widening
the bind to the tailnet does it with `tailscale serve` proxying to the loopback bind, and an owner
check on the `Tailscale-User-Login` header for every write** — not an ACL grant, because a device is
not a person and Greg's phone being on the tailnet does not mean Greg is holding it. On a one-user
tailnet that check is redundant today, which is exactly why it is a precondition on the widening
commit rather than work to schedule now.

**The likely failure mode of the deferral is not an attacker**, and naming it is the point: someone
enables the unit as written; months later a device joins for convenience — the Mac, a collaborator's
laptop, a tagged node for the scheduler — and nobody re-reads the policy, because *"it's on the
tailnet"* has become the reason it is safe. The cost is keystrokes into any pane, which is root plus
every key in `.env.local`, plus **`git push origin HEAD:main` from any pane — an unreviewed deploy to
paying readers, with nothing mechanical to stop it**
([version-control.md § What protects `main`](version-control.md#what-protects-main-and-what-does-not)).
**Two devices today is what makes deferring safe; it is not something to build on.** Build on the
bind, which the box controls and `ss -ltnp` can verify, rather than on tailnet membership, which only
the admin console knows.

### Then — so the box does not collapse again

| | what | owner |
|---|---|---|
| **A13** | **Resource admission before richer triage.** After a load-391 incident the most useful automation is *declining to start expensive work*: caps on concurrent heavy tests, browser jobs and reviews, and no-overlap defaults. Attribute consumption to jobs including children — counting sessions misses most of it. Note: **`SIGSTOP` does not release resident memory**, so pausing is not relief. | overseer |
| **A17** | **Alarm semantics must match normal operation.** The client calls data stale at 30s while collection waits 60s after a ~12s run, so *healthy operation spends most of its time alarming* — which teaches Greg to ignore it. Also, health refresh sits after successful fleet collection, so the failure that most needs explaining can prevent a fresh health reading. | both |
| **A27** | **Something off-box must notice the box disappearing.** Two local heartbeats cannot report total host failure. A minimal external dead-man check, deliberately tested. Nobody had thought of this. | overseer |

### Then — O1, corrected

A14, A15 and A16 are already folded into
[260908b](../plans/260908b-overseer-store-and-clock.md) — they overlap Sol's findings and mostly
agree with them. Astra adds two things Sol did not: **a drained or freshly rebooted box legitimately
has zero sessions**, so rejecting every empty snapshot could preserve a fleet of ghosts forever; and
**"timestamp advanced" is not a complete freshness contract** across clock corrections and restarts,
so prefer a source generation and sequence.

**A26 changes the goal of recovery**, and is the sharpest thing said about O4:

> "Restore 36 sessions" may recreate the incident. The useful target is restoring valuable work with
> understood state.
>
> — Astra, 2026-09-08

So reboot recovery produces a **queue** — what was interrupted, where its files and transcripts are,
what evidence survives, what it proposes next — resumed gradually under resource admission, with
shells given a manual path rather than pretended to be resumable agents.

### Then — the inbox, which both reviewers reached independently

Astra's A19–A20 and Fable's answer agree, having been asked different questions: **the phone is a
decision inbox, not a ranked list of sessions.** Astra adds the interaction rule Fable did not —
*do not reorder or replace a card's options while his finger is approaching them*, and preserve
drafts across phone suspension. Its notification default matches Fable's near-zero position: wake for
suspected destructive activity or imminent data loss; notify in waking hours for a decision blocking
valuable work or a persistent loss of visibility; digest everything else. **Group correlated events —
thirty agents hitting one quota limit is one incident, not thirty notifications.** Keep transcript
excerpts off the lock screen.

**A18 independently confirms Fable on confidence**: ranking by self-reported confidence promotes
exactly the confident mistakes you most want caught. Rank by consequence and reversibility; treat
confidence as an annotation until it has been measured.

### Two fan-out loops, and which one should absorb the other

Since 2026-09-09 there are two ways this tool says something to many sessions at once, and that is a
temporary state with a named direction rather than a drift.
[260909b](../plans/260909b-messaging-the-overseer-and-broadcasting-to-all-agents-from-the-dashboard.md)
§ D4 has it in full; the two things to know before touching either:

**The generic one should absorb the special one.** `resource-broadcast` is a fan-out whose text
varies by recipient index; free text is the same fan-out with a constant renderer. So the end state
is one loop taking a `render(index, total) => string`, with `broadcastRoute` in `routes-actions.ts`
calling `routes-broadcast.ts`'s and not the reverse. `fanOut` already takes that callback so the
extraction is a move. Agreed with `claude-agents-dashboard`, and Sol's verdict on it: *"Let the
existing, reviewed ease-off loop guide the extraction, while the new route supplies the second real
caller that proves the abstraction."*

**The shared thing is the mechanics, never the authority.** Iteration, the deadline, the yield,
per-recipient outcome collection and the quarantine belong below; who may speak, the `Speaker`
prefix, `renderMessage`'s slash rule, the confirm/dry-run envelope, the enable flag **and the
cooldown** stay at the caller. The two cooldowns are not one number: the ease-off one prevents
conflicting resume times, a free-text one prevents interrupting the fleet twice, and a loop that
owned "the cooldown" would hand the next caller whichever policy it happened to have. In one
sentence, from the session that owns the other loop:

> A general fan-out is a good abstraction and an excellent place to accidentally launder authority.
> Keep the loop ignorant of who is allowed to say what; give it strings that are already rendered and
> already permitted.
>
> — session `claude-agents-dashboard`, 2026-09-09

### Later, and deliberately not now

**A21 — narrow operational actions before conversational authority.** The earliest unattended actions
should be: defer new jobs, reduce monitoring frequency, deduplicate alerts, restart a failed
dashboard or Overseer. **Explicitly not** generic *keep going*, *pull latest*, *remove the worktree*
or *approve the prompt* buttons — "their consequences depend too heavily on context", which is a
direct contradiction of [§ The four capabilities](#the-four-capabilities-and-what-each-really-needs)
and is the better argument.

**A22 — a small event protocol before agent-to-agent routing.** Start with `progress`, `blocked`,
`decision`, `completed`, carrying event and job ids and artifact references, and **distinguish
self-reported claims from independently observed facts**. Defer the READY/LAND/GATE state machine
until those words have precise meanings — *"READY must not silently mean reviewed, tested, merged and
safe to deploy."*

**A23 — coordinate shared resources, not just conversations.** Worktrees do not isolate the shared
database, the dev server, test capacity or version control. Lightweight declarations — *using the
shared test database*, *ready to land revision X* — may save more than more messaging. **Display
honestly that a claim file is a coordination aid, not a lock.**

**A25 — a scheduler needs occurrence identity.** A `dispatched` flag cannot close the crash window
between recording a launch and performing it. Reserve the identifiers now, build when scheduling
arrives. **Pin the job definition revision that was authorised, so editing a doc cannot silently
enlarge unattended authority** — which matters here, where the jobs *are* documents.

**A30 — put a budget and a success measure on the Overseer itself.** Interruptions per day, time
valuable work spends blocked, tasks needing rework, resource time spent on supervision. And bound the
judgement calls: **thirty-six sessions must not trigger thirty-six model reviews a minute.**

### What Astra says to defer outright

Exhaustive transcript mining, a general multi-agent chat network, a custom terminal, predictive quota
optimisation, and multi-box scheduling. *"Keep polling if it is adequate. None of those is necessary
to find out whether this system actually saves Greg attention."*

**And A7 is not a feature at all** — every agent shares one Unix user with passwordless sudo, so one
compromised agent already reaches its peers and the control machinery. Greg's call, 2026-09-08:
deferred, and written up in
[§ Appendix: security and hardening, deferred](#appendix-security-and-hardening-deferred).

## Appendix: security and hardening, deferred

**Greg, 2026-09-08, on the item below: "let's add this to an appendix on future security/hardening
in overseer-direction, but ignore it for now."** So this is a record, not a backlog — nothing
here is scheduled, and it is written down because the reasoning is expensive to rediscover and
because the day one of these matters is not the day to work it out.

**One compromised agent already has the box.** Every agent runs as the same Unix user with
passwordless sudo, so any one of them reaches its peers, their files, their worktrees and the control
machinery. GPT 6 Astra, 2026-09-08, on what follows from that:

> Network controls reduce entry points; they do not contain a compromised agent … A dashboard token
> stored under that same user would not establish an isolation boundary.

Two consequences worth holding on to:

- **A token is not a boundary here.** Any credential the dashboard could check is readable by
  everything it would be protecting against. So the honest description of "reachability is the access
  control" is that it keeps *strangers* out, and there is currently nothing between one agent and
  another. That is a fair trade today — the agents are ours and the box is private — and it stops
  being one the moment an agent processes something hostile with enough leverage.
- **The first real containment work is not authentication.** Astra's ordering: review which
  production credentials and privileged operations routine agents actually need, and keep
  control-service configuration and deployment out of ordinary writable worktrees. Reducing broad
  sudo changes the possible damage far more than any number of HTTP header checks. **None of this
  requires user accounts or RBAC in the product.**

The related items, all deferred with it and each already argued in
[§ The backlog](#the-backlog-after-the-wide-review) where they sit in priority order: device-scoped
tailnet grants rather than whole-tailnet reachability (**A5**), CSP and anti-framing on a page that
renders agent-authored text (**A6**), and keeping Overseer-authored messages from acquiring Greg's
authority by arriving as ordinary user turns (**A12**).

**What would make this urgent**, so the trigger is written down rather than felt: an agent handling
genuinely untrusted input with real leverage — a reader's uploaded article reaching an agent's shell,
a public issue tracker feeding a job, a dependency with a post-install script — or the dashboard
becoming reachable from anywhere that is not a device Greg controls.

## Principles

- **Read-only until a channel is proven.** The retraction above is why. A write path that silently
  does nothing is worse than no write path, because it looks like it worked.
- **Reuse `gjd-remote`, don't fork it.** It owns session inventory, naming, launching and killing,
  and it has absorbed a lot of accidents. New surfaces should call it.
  <br>↳ And **no argument-parsing dependency**, which is that file's own researched decision rather
  than an accident: `node:util`'s `parseArgs`, per subcommand. Greg asked on 2026-09-08 for *"nice
  CLI scripts … using the same third-party argument-parsing library etc that we use elsewhere"* —
  the honest answer is that there isn't one, deliberately, and the convention to match is `parseArgs`
  plus the local-helper idiom in `run-claude.ts`. `gjd-remote.ts` is ~5,900 lines and its own comment
  says Commander becomes right *"for a bigger surface"*; that judgement is close, and whoever adds
  the tenth subcommand should make it rather than inherit it.
- **One adapter per harness, and honest about what each can do.** Claude, Codex and bare shells have
  genuinely different capabilities; flattening them into one "message an agent" verb produces a UI
  that lies.
- **Actions before buttons.** Because the orchestrator is eventually a program, every steering action
  is a typed function first and a click second.
- **This is not Spideryarn.** It runs on the box, spans repos, and must not depend on the product
  database or on anything under `src/`. If it ever earns its own repo, that should be a move, not a
  rewrite.
  <br>↳ The one narrowing of this, and what it cost:
  [260908f § Stage E](../plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md).
  Greg asked for the product's voice dictation to be **reused** rather than copied, so leaf,
  browser-only, product-agnostic modules may be imported and nothing else may.
  `tests/fleet-imports.test.ts` names the twelve files that reach and fails on a thirteenth — the
  list is the cost of the move, and it is meant to be reviewed rather than extended.
