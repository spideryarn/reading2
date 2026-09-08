# The Overseer runbook, its gates, and the scheduler that wakes it

Up: [overseer-direction.md](../project/overseer-direction.md), which is the standing direction. This
plan does not restate it.

**What this job is.** Greg asked on 2026-09-08 for "a skill or workflow called `overseer.md`" whose
job is to manage the other agents, and settled several things that the direction doc had recorded the
other way round. This plan turns that into: a runbook the Overseer follows, a small set of gates on
what it may decide on his behalf, a scheduler robust enough to prod the Overseer itself, a queue so
that work is deferred rather than declined, and reboot revival for the fleet as well as for the
Overseer.

**What Greg said he is buying.** In his own words, 2026-09-08:

> My goal is that ultimately I mostly talk to the Overseer. Occasionally I'll kick off new agents and
> then leave it to the Overseer to manage them. And that I won't have to do the sort of minutiae of
> shepherding work tree removal and stuff like that. And that my job is basically new ideas and
> providing product decisions and input.

## What already exists, and it is more than it looks

Surveyed 2026-09-08 before designing anything, because the expensive mistake here is building a
second way to do something. **Most of the action vocabulary is already built.**

- [`tools/fleet/actions.ts`](../../tools/fleet/actions.ts) holds the whole catalogue as a
  discriminated union: **spoken** (`continue`, `compact`, `pull`, `push`, `run-checks`,
  `report-status`, `ease-off`, `sleep-1h/3h/5h/10h`, `ask-fable`, `ask-sol`, `wrap-up`,
  `stop-and-ask`), **enacted** (`remove-worktree`, `kill-session`, `kill-test-suites`,
  `kill-safe-processes`), and **broadcast** (`resource-broadcast`, already staggered). Enacted
  actions need four gates: `mode: "run"`, `confirm: true`, `FLEET_ACT_ENABLED=1`, and an empty
  queue for that session.
- [`tools/overseer/`](../../tools/overseer/) already ranks attention (`attention*.ts`, Stage A of
  [260908f](260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md),
  done) and reads usage limits (`usage.ts`, `usage-carry.ts`, done).
- `~/.overseer/` **is accumulating for real** — 161 KB of `events.jsonl` and a `current.json` written
  minutes ago. The direction doc's *"`~/.overseer` is still empty"* paragraph is retired by this.
  What is **not** true yet: `systemctl is-active overseer.service fleet-dashboard.service` prints
  `inactive` twice. Both run under tmux. **So nothing survives a reboot today**, and the sentence
  that retires *that* paragraph is a unit that is `enabled`.
- [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) already exports
  `forceRemoveThrowawayWorktree`, and `npm run worktree:check` already answers "would deleting this
  lose anything?".

**So this job is mostly not new capability.** It is a runbook, a clock, a queue, and the gates — the
connective tissue between primitives that exist and a supervisor that uses them without being told.

## What is new, and what it replaces

### 1. The Overseer is a permanent session, and its context is a cache

Settled by Greg, quoted in
[overseer-direction.md § What the Overseer is](../project/overseer-direction.md#what-the-overseer-is)
and landed in `28bb2cc6`. The bullet that said *"a session is an action, not a residence"* is gone,
and so is its reason, which was wrong: `claude --resume` replays a transcript that outlives the
reboot.

**The simpler option this passed over** was the one the doc already had — short-lived sessions, no
persistent brain, judgement bought per question. It is genuinely simpler and it was rejected on
Greg's instruction, for a reason worth writing down: he wants **one thing to talk to**, and a
supervisor that forgets between questions cannot hold "I already told that agent to pause". The cost
we are accepting is a long-lived context that drifts, and the mitigation is the store, not
discipline.

### 2. It defers work; it never declines it

Greg, 2026-09-08, answering the objection that dozens of concurrent agents do not fit on one box:

> I don't think the Overseer should ever decline work, but it might kick it off with `--wait` and/or
> perhaps we build some infrastructure for it to write out to a queue that it grabs from every so
> often when things calm down.

**This contradicts A13 as written**, which says *"the most useful automation is declining to start
expensive work"*, and Greg's version is better for a reason he did not have to give: a decline has to
be remembered by whoever was declined, and nothing on this box remembers. A deferral is held by the
thing that deferred it. **A13 is amended rather than dropped** — the caps it asks for become the
condition on *draining* the queue rather than a refusal at the door.

### 3. The gates: four, not six

Fable arbitrated the draft on 2026-09-08 and cut it. The reasoning is in
[§ The gates](#the-gates-and-why-they-are-these-four); the headline is that **"product decision" has
no operational test and foreclosure does**, and that the failure to design against is not a bad
decision but **log blindness**.

### 4. The scheduler owns the clock, and one timer watches the watcher

Researched 2026-09-08 per
[third-party-library-selection.md](../reusable/third-party-library-selection.md). **The
recommendation is to add no library.** Every job named is a plain elapsed-time interval — "every 3
hours", "every 5 minutes", "twice a day" — and none needs calendar semantics, DST correctness or a
cron expression, which is the only genuinely hard part a library would buy. `daemon.ts` already has a
tick loop and an overlap guard in the attention pass. The runner-up is `croner` (v10.0.1, MIT, zero
dependencies, 8.15M weekly downloads), and the trigger to adopt it is the first job that needs a
wall-clock hour or a weekday.

**The one thing that cannot live inside the daemon is the check on the daemon.** A scheduler inside
the Overseer cannot prod the Overseer. That gets a **systemd system timer** — not `systemd --user`,
which needs `loginctl enable-linger` that nothing in this repo enables, so a user unit would be dead
at precisely the moment it was needed.

**Missed runs are better by construction, and that is the argument for hand-rolling.** Because the
scheduler is state-based — *has enough time passed since the last recorded run?* — a job due while
the box was down simply runs on the next tick. `systemd`'s `Persistent=true` fires one catch-up and
only for `OnCalendar=`; cron skips silently.

**The trade-off, named:** interval scheduling drifts across restarts (a "3-hourly" job is measured
from its last actual run, not from a wall-clock boundary) and cannot express "9am on weekdays".
Nothing in the job list needs either.

## The gates, and why they are these four

Greg's instruction, verbatim:

> Yes, it can answer on my behalf (e.g. for questions that don't need my input), but it should be
> crystal-clear that it's the agent rather than me that's answering, and it should log ALL such
> answers/decisions/assumptions somewhere that I can easily review (and add a new mode to the web
> interface for viewing the past/outstanding ones). Yes, avoid really consequential, critical, risky,
> irreversible, sensitive, regrettable. And also be wary about product decisions — I think I mostly
> want to make those. I think it can sometimes edit important .md docs, but ideally only if very
> confident and making very minimal changes — but err on the side of caution. Perhaps write up these
> as gates in overseer.md (or similar) as a small number of short principles.
>
> — Greg, 2026-09-08

A six-principle draft went to Fable to be attacked. It came back four, and three of the cuts are
load-bearing.

**"Product decision" has no test; foreclosure does.** Fable:

> "Reader-visible" is wrong in both directions: a bug fix is reader-visible and needs nobody; a
> prompt rule, a stored field about a reader, or a privacy sentence is invisible and is the most
> product-shaped thing in the repo … the cost of a wrong product call by the Overseer is not "a
> reader sees it" (dev is not prod, and deploy is gated) — it is **agent-hours committed to a shape
> Greg has not seen, and his option space narrowed by what now exists.**
>
> — Fable, 2026-09-08

So the Overseer never *decides* a product question; it **defaults**, taking the standing
simplest-first decision the repo already holds, and logs the default as an assumption pending Greg.
The exception list is enumerable at 3am because it is a question about files rather than taste:
anything that **outlives the branch** — a schema, a prompt, a published sentence, a privacy promise,
a field about a reader, or a case being dropped — waits. Note that the direction doc contradicts
itself on the last of those, assigning "whether a case can be dropped" to Fable in one bullet and to
Greg in the next; **it is Greg's**, because scope is exactly where his fifth options come from.

**The gate nobody had written down: the Overseer never originates work.** Fable's addition, and it is
the one with a mechanical test — *is it in the queue?* Scheduled jobs, plan docs and the feedback
queue are all queued. A job of the Overseer's own devising is a proposal in the log, never a
dispatch. This is the direct expression of *"my job is basically new ideas"*.

**And the gate most likely to bite: never spend what you are rationing.** A30 and the standing
constraint that the Overseer must keep working when the subscriptions are exhausted. It was missing
from the draft entirely.

### The four

1. **Never hide who decided.** Every message is stamped as the Overseer's and never arrives in Greg's
   voice — enforced by `QueuedItem.speaker` being required, not by care. Every answer given on his
   behalf is attributed on delivery so the receiving agent weights it as a peer's suggestion, and
   every decision, assumption and decline is written to the log he reads in the morning. Attribution
   and logging are one principle, not two: they are the same rule pointed at two audiences.
2. **Answer facts, route judgement, default the product call.** "Pull latest" is always yes; "are the
   tests red because of me?" is answered by looking at the other trees; "is the box overloaded?"
   comes from vitals. Judgement goes to Sol (technical, evidence in the tree) or Fable (wording,
   defaults). A product question gets the simplest option that works end to end, logged as an
   assumption — unless it writes something that outlives the branch, which waits.
   **Disagreement escalates on P0 and P1 only**; Sol disagrees with agents as a matter of course, and
   an unbounded disagreement clause would fire constantly.
3. **Never the irreversible, and never work of its own devising.** The list, not a test: no deploy,
   no push to `main`, no write to the production database, no spending, no destroying work with no
   second copy, no keystrokes at a pane with a dialog open (a `1` mints an approval), no killing a
   session with unpushed work. And nothing dispatched that Greg did not queue.
4. **Never spend what you are rationing.** The deterministic tick costs nothing and runs always; the
   model tick is the expensive one and is bounded. Thirty-six sessions must not produce thirty-six
   model reviews a minute.

On editing rule docs, which Greg allowed narrowly: this is not a fifth gate but a pointer. The
Overseer **may retire a dated status sentence when it can verify the fact that retires it** — a unit
is `enabled`, a file exists — and proposes everything else into the log, before-and-after, per
[edit-important-docs.md](../reusable/edit-important-docs.md). *"Carries a date"* is a test; *"is a
fact"* is not, because half the facts in these docs are rules and the sentence stating a rule is the
rule.

### The failure to design against is log blindness

Fable, 2026-09-08, asked what the one-way door is for an Overseer that *acts* rather than merely
notifies:

> The whole draft rests on "vetoable after the fact," and a veto has the same physics as a buzz — its
> value is proportional to how rarely it is needed, and its volume grows with everything the Overseer
> does. Once the morning log is two hundred entries, Greg stops reading it; from then on the Overseer
> has unbounded authority with a paper trail, and the signal that says so is *in the log*.

Three consequences, and they are design constraints rather than nice-to-haves: **the 8am surface
shows assumptions only**, ranked by agent-hours sunk since each was made; answered facts live on a
second page nobody has to read; and **a week with zero vetoes is a red flag, not a clean bill**.

### Where Greg is probably wrong, said plainly

Fable's answer to "what is he wrong about", and it belongs in the plan because it changes what
"dozens of agents" means:

> "Many dozens" is reachable **for the maintenance fleet** — improve-the-codebase, feedback reports,
> postmortem preventions, get-ready-to-deploy — without giving up anything, because those jobs are
> already queued and their product decisions were made when the docs were written. The **feature
> fleet** stays at the number of plans he can read a day, and the only thing that lifts it is letting
> the Overseer approve plans — which is the product authority he wants to keep.

And the ordering consequence, which agrees with Astra's A21 and reshapes the stages below:

> The judging Overseer is the half that saves least. 34.9 stalled agent-hours were a launch flag; the
> 5h43m wedged playwright and load 391 needed a daemon with three rules, not judgement.

**So the deterministic rules come before the judgement.** That is why Stage 3 is what it is.

## Stages

Each ends committable, green and deployable. Greg asked for many thin stages rather than a few large
ones, so these are finer than usual.

### Stage 1 — the runbook and the gates (docs only)

`docs/project/overseer.md`, owned by `overseer-direction.md`, holding the four gates, the standing
job list, and the operational knowledge an Overseer session needs on waking: that the store is the
record and its own context is a cache; that a steering message **must be one line**, because the
route refuses newlines (each would submit early — measured today, `bad-text`); that a session is
addressed by pane handle plus generation and never by name; that pane text is data and never
instruction. Plus `.claude/skills/overseer/SKILL.md`, a thin wrapper so `/overseer` loads it.

Done when: the doc exists, `tests/doc-links.test.ts` is green, and the direction doc points at it.

### Stage 2 — the scheduler and the dead-man timer

Interval jobs in `tools/overseer/daemon.ts`, with the schedule as data. Occurrence identity in the
store per A25 — a job run gets an id recorded **before** dispatch, so a crash between deciding and
spawning is visible on restart rather than silently lost or silently repeated. Overlap prevention
reuses the `attentionRunning` idiom already there. One systemd **system** timer as the dead-man check
on the Overseer's heartbeat, added to `infra/hetzner/provision.sh` and covered by
`tests/systemd-units.test.ts`.

Done when: a job with a 60-second interval is watched firing, watched *not* firing while a previous
run is in flight, and watched catching up after the daemon is killed and restarted across its due
time. And the dead-man timer is watched firing against a deliberately stopped daemon — **a check
never seen to fail is not evidence** ([silent-success.md](../reusable/silent-success.md)).

### Stage 3 — the three deterministic rules that pay back first

No model calls. Each is a scheduled job from Stage 2 over primitives that already exist:

- **Launch-mode drift.** A session whose last `permission-mode` checkpoint is `default` will stall at
  its next unapprovable call. Measured cost: 34.9 agent-hours since one Sunday. Read
  `permission-mode`, not `auto_mode` — the direction doc says why.
- **Wedged work.** A `shell` pane whose own command line has not changed in hours. It needs no new
  recogniser, because for a shell pane the command line already says what it is doing.

  **There is a live specimen, and it is the same one**, which is the finding: the direction doc
  recorded `npx playwright@1.62.1 install webkit` at 5h43m on 2026-09-08. Measured again at 16:19
  the same day it was at **14h58m** (`etimes` 53,910, pid 2282035, pane `%2091`, session
  `wk-install-0116-2281848`). Two things make it the right specimen rather than merely a good story.
  Its `/proc/<pid>/cwd` reads
  `/home/greg/code/spideryarn2/.claude/worktrees/glossary-order-touch (deleted)` — **the worktree was
  removed out from under it and it kept running**, which is the orphan test
  [diagnose-box-resources.md](../reusable/diagnose-box-resources.md) names. And it has no
  descendants, 0.0% CPU and 2.9 MB resident, so **it costs nothing**, which is exactly why nine hours
  of extra wedging passed with the fleet's own direction doc naming it and nobody acting.

  That last point sharpens the rule: **the trigger is age and a dead cwd, not resource consumption.**
  A rule that fired on cost would never have fired on this one, and this one is the case we have.

  **It is deliberately still alive.** Greg, 2026-09-08: *"Yes, let's leave it as a test case for
  later."* So pid 2282035 / session `wk-install-0116-2281848` is a **fixture, not litter** — anybody
  running [diagnose-box-resources.md](../reusable/diagnose-box-resources.md) over this box will find
  it and it will look exactly like the thing that doc says to clean up. Leave it until Stage 3 has
  fired against it, then kill it and record that it was the first thing the rule caught. Its cost for
  as long as it stands is 2.9 MB and one tmux session.
- **Box pressure and usage proximity.** Vitals already exist in `health.ts`; usage already exists in
  `usage.ts`. The action is the existing staggered `resource-broadcast`, **and then the half that is
  always forgotten: check later that they woke up.** Greg asked for this explicitly. A pause that
  nobody verifies is indistinguishable from an agent that died.

Done when each has fired against a real condition on this box and the log says what it did.

### Stage 4 — the deferral queue

Work the box cannot take now is written to the queue with its dispatch intent, and drained when
vitals and usage allow. `gjd-remote new-claude --wait` stays the cheap path for a known delay; the
queue is for "when things calm down", which is not a duration.

Done when: work queued under load is watched draining after the load falls, and a queued item
survives a daemon restart.

### Stage 5 — reboot revival

The daemon resumes the Overseer session, **and a start-fresh path that has been watched working**,
because a resume that quietly produces an empty-headed Overseer looks exactly like one that worked.
Then the fleet: Greg pointed at `gjd-remote resume` and
[find-previous-work.md](../reusable/find-previous-work.md) — a session's `claudeSessionId` is already
in the register, and it is what `claude --resume` wants. Recovery produces **a queue, not a
stampede** (A26): what was interrupted, where its files are, what it proposes next, drained under
Stage 4's admission.

### Stage 6 — CLI ergonomics, and the rename

`node:util`'s `parseArgs`, per `gjd-remote.ts`'s documented choice — **no argument-parsing
dependency**, which is the existing convention and was itself a researched decision. The actions
already exist; what is missing is a session-friendly way to call them, since today they are reachable
over HTTP and from a browser. Then `OrchestratorPanel.tsx` → the Overseer, which Greg approved once
the wave-2 worktrees had calmed down.

## Deliberately not in this job

- **The decision-log web mode.** Greg asked for it; it is the dashboard's tense, and `tools/fleet/`
  belongs to another agent. This job writes the log; the render is handed over with the shape agreed
  at the seam.
- **Multiple Claude Max accounts.** Greg: *"I don't want to deal with multiple simultaneous
  subscription-accounts on the same box just yet"* — so the near-term answer is watching the limit
  and pausing, which is Stage 3.
- **Configuring the schedule from the web interface.** Greg called it a nice-to-have future stage.
- **Renaming `docs/plans/260908f-orchestrator-wave-2-….md`.** A dated plan record, mid-flight.

## The review, and what it changed

**GPT Sol reviewed this plan at `004a12eb` and blocked it: no P0, eleven P1s.**
[The full text](260908g-plan-review-sol.md). Its headline is architectural — *"prose gates cannot
constrain an Overseer that retains unrestricted Bash, `tmux send-keys`, and passwordless sudo"* — and
that one is escalated to Greg rather than settled here (§ S1, below). The rest are taken, and four of
them killed a claim this plan made.

### Claims of mine that were wrong

- **S5 — the store's three-write ordering does not give occurrence identity, and I asserted that it
  did.** Those three writes (append fleet events, save the snapshot baseline, checkpoint the cursor)
  protect *snapshot differencing*. There is no job-occurrence schema, no executor claim, and no
  atomic relationship with process creation. **I took that from writing the plan rather than from
  reading `store.ts`**, which is the exact trap
  [improve-the-codebase.md](../reusable/improve-the-codebase.md) names: every finding is a claim,
  including your own. Stage 2 now has to build occurrence identity rather than inherit it —
  `(job id, scheduled instant, authorised-definition hash)`, with states `reserved`,
  `started`, `finished`, `refused`, `unknown`, claimed durably **before** any side effect. And
  **`unknown` is never auto-retried**, because the crash window between "spawn may have succeeded"
  and "acknowledgement is durable" cannot be closed by ordering — only named honestly.
- **S6 — reusing the `attentionRunning` overlap idiom permits permanent silent suppression.** A
  scheduled job whose promise never settles (a hung model subprocess) leaves the in-memory field
  non-null for ever. Every later tick then *correctly* declines to overlap, the heartbeat stays
  healthy, and **that job never runs again** — a dead job wearing a green light, which is this whole
  area's failure mode. So the guard is a **lease with a deadline**, and an overdue lease is a `stuck`
  state that alarms, not a quiet skip.
- **S11 — an on-box systemd timer is not A27.** I let the dead-man check and A27 collapse into one
  line. They are different: the timer is a local watchdog for a daemon that died, and A27 is about
  the **host** disappearing, which takes the watcher with it. The timer is worth having and **A27
  stays open**, needing an off-box check that is deliberately tested by stopping the thing it
  watches.
- **S7 — Stage 4's acceptance test passes while being wrong.** Thirty deferred jobs each observe one
  low-load sample, each independently passes "vitals allow it", and the drain launches all thirty
  before the next sample sees their cost — the load-391 incident with an extra step. I had written
  this into the direction doc and then failed to write it into the stage it governs. The drain is
  **one heavy job per settled observation window**, against a durable reservation, failing closed on
  a stale or unknown reading.

### S2 — the product gate asks a question that has no answer yet

The sharpest of the design findings, and it is right. *"Outlives the branch"* is not decidable at
dispatch: a task that looks branch-local becomes a schema field or a changed prompt **during**
implementation, by which time gate 2 has already admitted it. Taken literally the gate either permits
the lasting decision silently or escalates every coding task.

**The fix fits machinery this repo already has.** Split it in two: the Overseer may authorise
**investigation and a plan**, which is cheap and reversible; the durable decisions become visible in
the plan doc and the diff, and *that* is where the gate applies and where Greg's veto lands. It is
[engineering-manager.md](../reusable/engineering-manager.md)'s existing shape — a plan reviewed
before it is built — rather than a new mechanism.

### S3 — gate 1 was prose about a log that does not exist

Stage 1 could be declared done — and was — while nothing durable records a single decision, because
the store only understands fleet and session events. So gate 1 needs a **typed durable event
appended before delivery, fail-closed**: decision id, speaker, source authorisation, whether it is an
assumption or a fact or a decline, what it affects, and its status. **A failed append must prevent
the delivery**, and that wants a test.

Sol also caught the runbook overstating itself: `renderSpoken` deliberately emits `/compact` without
the Overseer prefix, so *"every message is stamped as yours"* is not literally true. The exception is
real and documented; the sentence claiming otherwise was mine.

### S12 — gate 4 is not an executable budget

Fair, and P2. Several components each making a "bounded" number of model calls is unbounded in
total. It wants one global budget — concurrency, cost and wall-time — shared across scheduling,
routing and recovery, with an explicit exhausted state.

### Three findings that are live defects, and none of them is mine

Verified in the code rather than taken on the review's word. **All three live in `tools/fleet/`,
which belongs to the dashboard agent**, so they are reported rather than fixed here — reaching into
another stage's code is the thing
[architecture.md § Stage ownership](../project/architecture.md#stage-ownership) forbids.

- **S8 — the resource broadcast skips the agents causing the load.** `drainGate` classifies a
  *working* session as `later`, and `broadcastRoute` only delivers to `now`; the `later` ones get a
  `skippedOutcome` and are **not** durably queued. So under pressure the broadcast reaches the idle
  agents and misses the ones running the test suites, which are by definition working. The code says
  so in its own comment — *"a session that is working [is] left out here"* — and it is honest about
  it in the response, so this is a gap in the action rather than a lie about it. It is still the
  wrong half of the fleet.

  **And the refinement that matters for whoever fixes it: the capability is not missing, the
  broadcast declined to use it.** `steerableStatus` returns `null` for `working` — a working session
  *may* be typed at, and the ordinary `/api/steer/message` route does exactly that; measured tonight,
  a message to a session the page called `working` returned `ok:true` and sent. `drainGate` layers a
  separate *not now* policy on top for the queue, which is a defensible thing for a queue to do. The
  defect is only that the broadcast turns that "not now" into a **skipped outcome rather than a
  durable intent**, so "later" means "never". Fixing it is enqueue-and-confirm, not new plumbing.
- **S9 — a kill plan can report `completed: true` with every kill having failed.** `runPlan` treats
  `best-effort` steps as non-stopping; they are recorded per-step as `failed-ignored`, which is
  honest, but the plan-level `completed` does not reflect them. Whether the route's summary then
  reads as "killed" is the dashboard's call.
- **S4 — the four gates on enacted actions are human-interface checks, not autonomous-caller
  checks.** `confirm: true` proves a caller sent a boolean. `planKillSession` checks tmux identity,
  not dirty state, unpushed commits, debrief status, or an outstanding `partial` delivery. This is
  the one I suspected before the review and it is worse than I guessed.

### S10 — a rebuilt box would come up with a deaf Overseer, and this one is confirmed

`infra/hetzner/provision.sh:1501` runs `systemctl enable overseer.service`. Nothing enables
`fleet-dashboard.service`; line 1337 is a **comment** telling a human to run
`sudo systemctl enable --now fleet-dashboard` once the tmux job is stopped. Both units are installed
and `systemctl is-enabled` reports `disabled` for both today.

So on a box built from this file, after a reboot: **the Overseer starts and the only source it has
for fleet snapshots does not.** It would heartbeat healthily and see nothing, which is precisely
the alive-and-deaf case `lastGoodSnapshotAt` was invented to expose — the field exists, and nothing
would have been watching it at 4am.

**The fix is not simply to enable the dashboard**, and the reason is in that comment: its owner asked
to be consulted first, because two supervisors on one port is a fight in which the loser's failure
looks like a crash. So this goes to the dashboard's owner as a question, with the asymmetry named.

## Risks

- **Two agents in the primary checkout.** `overseer-orchestrator-design-and` is also here. Announced
  and coordinated 2026-09-08 before starting; the code stages move to a worktree.
- **The Overseer acting on a fleet that is mid-change.** Everything it reads is a snapshot of a tree
  that other agents are still editing, so a rule that fires on a stale reading acts on a session that
  has moved on. Stage 3's rules are all chosen to be slow-moving for this reason (hours, not
  seconds), and that is the mitigation rather than an accident.
