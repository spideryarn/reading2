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

## Status, 2026-09-08 evening

**Done enough to stop here.** Stages 1, 2 and half of 6 are on `dev`, green, and coherent on their
own: the Overseer has a runbook with gates, a scheduler with real occurrence identity, a local
watchdog, and a tab called Overseer. What remains is real and optional — the fleet works today the
way it worked this morning, and nothing half-built is load-bearing.

| stage | state |
|---|---|
| **1** — the runbook and the gates | **done**, `dev`. `docs/project/overseer.md`, four gates. The `/overseer` skill was deleted on 2026-09-08 — see the stage. |
| **2** — the scheduler and the watchdog | **done**, `dev`, after two GPT Sol rounds. **Armed by `OVERSEER_JOBS_ENABLED` and OFF.** |
| **3** — the three deterministic rules | **3a done, 2026-09-08 evening; Sol's code review answered the same night.** The protocol and rule 2 are built, fired against the live specimen, and green. 3b–3d not started. Fable arbitrated how much each rule may act; Sol blocked the first draft with four P0s, all accepted, then reviewed the code and raised four more — four fixed, three deferred onto 3d. The acting rule is still last, now behind **five** named preconditions. |
| **4** — the deferral queue | **not started.** |
| **5** — reboot revival | **not started.** Needs a new verb: `gjd-remote resume` is `attach`. |
| **6** — CLI ergonomics, and the rename | **the rename is done**; the CLI is not started. |
| **7** — gate 4's global budget | **new, and named because it was twice "acknowledged in prose".** |

**The one thing a reader should not miss: the scheduler is off, and turning it on is a decision.**
`OVERSEER_JOBS_ENABLED=1` starts real `gjd-remote` sessions on a shared box, and **both standing jobs
fire about thirty seconds after it is armed**, because neither has ever run. The dispatch path has
never been executed for real — only through an injected spawner — so the first arming is also the
first live test of it.

**There is now a second switch, and it is the safe one.** `OVERSEER_RULES_ENABLED=1` arms the
deterministic rules and nothing else: the daemon is handed no session dispatcher at all, so it
cannot start a Claude session or spend anything, and a session job that reached it would be refused
rather than run. That is the switch to use to watch a rule fire — GPT Sol's SP-4, and it is why
*"watch each rule fire for real"* no longer means arming the paid jobs.

### Stage 7 — gate 4's global budget

Split out on 2026-09-08 rather than attempted, because Sol has now twice found it *"acknowledged, not
answered"*, and a third acknowledgement would be worse than an admission. Gate 4 says the model tick
is bounded; nothing bounds it. Several components each keeping to a locally sensible number of model
calls is unbounded in total, and the seam has to be shared across scheduling, question-routing and
recovery or it is not a budget.

**It becomes load-bearing exactly when the scheduler is armed**, which is why it is next rather than
later, and why the runbook now says plainly that the gate is not enforced yet instead of implying it
is.

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

**The wrapper is gone, on Greg's instruction, 2026-09-08.** Its two live facts — read the store
rather than your memory, and check `gjd-remote ls` before dispatching — moved into the runbook, and
the runbook now says outright that there is no skill, so nobody rebuilds one. What it bought was
discovery: the skill's `description` sat in every agent's context, so an agent could be *told* to
oversee. Without it the role is entered by being handed the file, which is how the daemon does it
anyway. Nothing in `tools/overseer/` or `infra/hetzner/` ever referenced the skill.

Done when: the doc exists, `tests/doc-links.test.ts` is green, and the direction doc points at it.

### Stage 2 — the scheduler and the dead-man timer

Interval jobs in `tools/overseer/daemon.ts`, with the schedule as data. Occurrence identity in the
store per A25 — a job run gets an id recorded **before** dispatch, so a crash between deciding and
spawning is visible on restart rather than silently lost or silently repeated. One systemd **system**
timer as the dead-man check on the Overseer's heartbeat, added to `infra/hetzner/provision.sh` and
covered by `tests/systemd-units.test.ts`.

**This paragraph used to end "Overlap prevention reuses the `attentionRunning` idiom already there",
which S6 then demolished** — and the implementing agent flagged that the sentence was still standing
here, contradicting this plan's own § The review two screens further down. It is struck rather than
quietly deleted, because a plan that silently drops the thing a review corrected is how the next
reader concludes the review was about something else. **The scheduler path has no in-memory guard at
all**: overlap is the durable lease, so there is no field that can stay non-null for ever.

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

  **The rule fired against it at 20:10 on 2026-09-08** — pid 2282035, `cwd-deleted`, 19.9 hours, in
  a `rule-intended` event that round-trips out of the store. So the condition for killing it is met
  and **it is still alive**, deliberately: 3a's brief said not to, and the first thing the rule
  caught is now a line in a log rather than a story, which was the point of keeping it. Whoever kills
  it should quote the event.
- **Box pressure and usage proximity.** Vitals already exist in `health.ts`; usage already exists in
  `usage.ts`. The action is the existing staggered `resource-broadcast`, **and then the half that is
  always forgotten: check later that they woke up.** Greg asked for this explicitly. A pause that
  nobody verifies is indistinguishable from an agent that died.

Done when each has fired against a real condition on this box and the log says what it did.

#### How the three rules behave: Fable's arbitration, 2026-09-08 evening

I put the obvious fork to Fable — should v1 **act**, or **observe and surface**? The answer was
neither, and it is better than both:

> **Attempt through the real route, and let the existing switches decide whether it lands.** The
> act/observe framing treats the three rules as one thing. They are not, and the codebase already
> has the two-phase shape you need: every action has a dry-run/preview arm that runs real code
> (`selectForKill`, `renderBroadcast`), and `actEnabled()` is read per request. So in v1 each rule
> **always runs the whole path** — detect, plan, dry-run, then call the same gate functions the panel
> uses — and writes a store event saying what happened: `sent to 31 of 36`, or
> `refused: FLEET_ACT_ENABLED unset`, or `proposed: needs confirm`. Off and nothing-to-do never
> render the same, which is the direction doc's own rule. That kills the "called from nothing but
> its own tests" class without granting anything new.
>
> — Fable, 2026-09-08

That is the design. **The rule is exercised end to end on the day it lands**, against the live
specimen, and the only thing between a proposal and an action is a switch Greg already owns. It is
the direct answer to the class this job hit twice in one day.

Per rule, ordered by reversibility — because they are not equally reversible and the plan had been
treating them as one thing:

- **Rule 3 (box pressure and usage) — acts, behind `FLEET_ACT_ENABLED`.** The reversible one: a
  spoken message that agents weight as a peer's suggestion. Two conditions Fable attached, both
  cheap: fire only on a usage reading that is **not `unknown`** — a stale cache must never fire it,
  and `resets_at` in the past is the validity check that says so — and **once per stagger window**,
  which `BROADCAST_COOLDOWN_MS` (10 minutes) already half-provides.
- **Rule 2 (wedged work) — proposes, never kills, in v1.** The specimen already matches
  `cwd-deleted` in `SAFE_KILL_RULES`, so the *plan* exists and the rule computes and records it. But
  running it unattended is a different grant from a person clicking confirm, and Greg said to leave
  the specimen standing until the rule has fired against it. Nineteen hours of wedge costs 2.9 MB; a
  wrong unattended kill is not symmetric.
- **Rule 1 (launch-mode drift) — observes only, by construction.** There is no reversible act: you
  cannot type `/permission-mode auto`, and you may not answer the dialog. The only fix is
  kill-and-relaunch, the least reversible thing on the list. **And the ground has moved under this
  rule**: the launcher fix landed at 12:20 today, and at 20:25 all eight agent rows read
  `{kind:"auto"}` with the other seven `not-applicable` shells. The 34.9 hours are sunk, not
  ongoing. Rule 1 is now a **regression alarm** on that fix, which is the right shape for it — and
  it is the reason rule 1 moves from first to last in the build order.

**Gate 4 does bite, and not where I assumed.** I had reasoned that deterministic rules make no model
calls and are therefore outside gate 4. Sound for the rules, wrong for their effects: a broadcast is
thirty-six user turns, and a re-broadcast loop is unbounded spend.

**And the sentence that used to end this paragraph — *"the cooldown closes it"* — was wrong**,
found by the fleet dashboard's owner on 2026-09-08 when I sent them the finding above and asked them
to confirm rather than assume. `lastBroadcastAt` is stamped *after* the `total === 0` refusal has
already returned, so **a call refused for "nobody to tell" never spends the cooldown**:

> An unattended rule firing on a fully-loaded box is refused, the clock is not started, and it may
> re-fire immediately — as fast as its own schedule permits. There is no *send* loop, because nothing
> is delivered. There is an unthrottled *refusal* loop, and every attempt costs a route's worth of
> work on a box already under pressure. So your rule must carry its own interval and must not retry
> on a refusal, because the route will not throttle you on exactly the condition that triggers you.
>
> — the fleet dashboard's owner, 2026-09-08

So rule 3 carries **its own interval**, and **a refusal ends the attempt rather than starting a
retry**. That is a constraint on 3b today, not a future tidy-up, and it is a good example of why the
finding went to its owner rather than into my own patch: I had the defect right and the consequence
wrong, and the correction inverted which half was dangerous.

They also asked for something I had not planned: **record the refusals too**, with
`recipients.length` as the denominator, because *"a run that reached nobody is the most informative
reading of all and it currently leaves no trace"*. And they confirmed the delivery-time fix is
theirs and idiomatic rather than novel — `drain.ts`'s `sendable()` already renders attribution at
delivery for exactly the argument I made about the stale minute count.

Their pushback is fair and is kept here because it widens the defect: *"for a person clicking the
button it is defensible"* was doing too much work, since the person who clicked at 20:25 also
reached three rows of fifteen. **But they then corrected themselves, in the direction of less
alarm, and that correction belongs here too** — the route answers `result: {total, recipients:
outcomes}` and the page draws it, so every excluded recipient and its reason does reach a person. It
reaches them as a JSON dump they read by eye rather than as a sentence, which is a presentation gap
and not a dropped join. **The useful consequence for this stage is that rule 3 and the page read the
same object** rather than two hand-written declarations of the same idea, so the denominator the
rule records is the denominator the page shows.

#### What the survey found, and the two things that change the design

Surveyed before writing any code, because the expensive mistake here is a second way to do
something. Two findings changed the shape.

**1. The seam for an in-process job already exists, and needs no new type.** `SpawnJob` is
`(definition, key) => JobSpawn`, and nothing in `scheduler.ts` or `jobs.ts` knows that today's only
implementation shells out to `gjd-remote`. A rule job is an `AuthorisedJob` plus a dispatcher that
switches on `definition.id`. ~~**So Stage 3 adds no scheduler machinery at all**~~ — which is what a
good seam is supposed to buy, and it is worth saying out loud because the plan had budgeted for
widening one.

**Both halves of that were wrong, and 3a proved it twice over.** Sol's SP-2 demolished the
conclusion: `SpawnJob` has no store and its `JobOutcome` has nowhere for a finding to go, so the
scheduler grew a two-phase rule protocol. And SP-1 demolished the premise: switching on
`definition.id` is precisely the hole, because the id is in the fingerprint and nothing about what
the id then selected is. What landed switches on the definition's own hashed `work` arm, and the
seam widened after all. Struck rather than deleted, because a plan that quietly drops the sentence a
review corrected is how the next reader concludes the review was about something else.

**2. `resource-broadcast` cannot reach the sessions that cause the load, and fails hardest exactly
when it is needed most.** `broadcastRoute` keeps only recipients whose `drainGate` is `{kind:"now"}`.
A `working` session gates `{kind:"later"}` and is dropped — deliberately, and the comment says so.
Measured on the box at 20:25: fifteen rows, seven shells, five working, three idle, so a broadcast
reaches **three of fifteen**, and the five it excludes are the load. Worse, `total === 0` refuses the
whole call with *"none of the rows you sent is at a prompt right now, so there is nobody to tell"* —
so at the limit, where every agent is working, the action does not degrade, it refuses.

**The easy fix is wrong**, which is presumably why it was not taken: the queue and `drain.ts` could
hold `later` rows until they reach a prompt, but the broadcast text says *"arm a wake-up ~N minutes
from now"* and N is rendered at send time. A queued delivery would arrive carrying a number that had
gone stale, which is worse than not arriving.

**And the real fix is bigger than that**, which the dashboard's owner established by checking their
own first answer rather than mine. Broadcasts are not merely un-queued, they are **forbidden** from
queueing: `routes-actions.ts:505` refuses `enqueue` for a box-wide action outright, on the stated
ground that *"there is no single session to be ordered against"*. So the fix is two changes, and only
the second is the idiomatic one:

1. A box-wide action would have to become queueable per session, **which means answering the
   objection at `:505` rather than deleting it.** Their reading — that a broadcast wants a *held
   delivery* in each of many sessions rather than a position in one session's order, and that the
   two are separable — is probably right and is, in their words, *"exactly the kind [of argument]
   that looks obvious and turns out to have a reason."*
2. Then render `index`/`total` at delivery, which `drain.ts`'s `sendable()` already precedents.

**This raises the value of the instrumentation rather than lowering it.** Crossing a refusal
somebody wrote deliberately needs better evidence than *it would reach more sessions*. A series
showing reachable steady at two or three of fifteen while `working` sits at five is the shape of
argument that would justify it — **and a series showing it recovering on its own would kill the
stage, which is a result worth having too.**

So rule 3 does not work around it. It goes through the real route as Fable says, and **its store
event records the denominator and the reason for it** — `sent to 3 of 15; 5 excluded because
working` — which turns an invisible structural limit into a number that accumulates. That number is
also the evidence that would justify the fix, and it is reported to the dashboard's owner rather than
patched from here.

#### Where the findings go, and the option not taken

A new `RuleEvent` arm on `OverseerEvent`. The rejected option was `daemon.jsonl` via `notes.ts`,
which is cheaper — one file instead of five. It loses on two counts: gate 1 requires that every
decision the Overseer makes on Greg's behalf be **somewhere he can easily review**, and `daemon.jsonl`
is not on the wire and not in the panel; and `notes.ts` is explicitly for facts about the Overseer's
own condition — being deaf, losing a record — where a rule firing at the fleet is not that.

**I first wrote that a new event kind costs five compiler-enforced updates. It is six, and the sixth
is not compiler-enforced.** Checked before the number went into a brief, because an unchecked claim
in a brief is how a wrong number becomes a comment in the source.

1. `tools/overseer/diff.ts:616` — the union itself.
2. `tools/overseer/store.ts:952` — `EVENT_KINDS`, a `Record<OverseerEvent["kind"], true>`, so a
   missing key does not compile.
3. `tools/overseer/store.ts:1837` — `foldEvents`.
4. `tools/overseer/jobs.ts:594` — `foldOccurrences`'s explicitly-named ignore list.
5. `scripts/overseer.ts:189` and `:243` — a **second** `EVENT_KINDS` and `describeEvent`.
6. **`tools/overseer/store.ts:1097` — `parseEvent`, and this one is a runtime parser.**

Six is the fact; the sixth is the finding. `EVENT_KINDS` being a total record means the *key* cannot
be forgotten, but **the parse branch for the new arm can be**, and nothing refuses to compile if it
is. The failure that produces is the shape this project keeps meeting: the event appends to
`events.jsonl` perfectly, and comes back on the next read as
*"kind … is not an event this version knows"*. A write that succeeds and a read that quietly refuses
it — [silent-success.md](../reusable/silent-success.md) with the halves in the inconvenient order,
because the damage is done in one process and discovered in another.

So the acceptance test for the new arm is **round-trip, not append**: write one, read it back through
`parseEvent`, and assert on what comes out. An append that returns `ok` proves nothing here.

#### The plan review, and what it changed — GPT Sol, 2026-09-08

Sol reviewed `848938a7` before anything was built and **blocked the stage as written**, with four
P0s. It is right about all of them and none is overruled. The full review is in
[260908g-stage3-plan-review-sol.md](260908g-stage3-plan-review-sol.md). The four that block:

- **SP-1 — the rule implementation is outside the authorisation fingerprint.** `definitionHash`
  covers `id`, `everyMs`, `leaseMs` and `what`. A dispatcher that selects executable code by
  `definition.id` means **changing a threshold or an action leaves the pin valid**, so rule 3 could
  go on acting after its behaviour changed. That is precisely the hole gate 3's *"never act on a job
  definition that changed after it was authorised"* exists to close, and the code version of it is
  worse than the document version it was written for. The fix needs no new machinery: thresholds and
  the chosen action become **data in the hashed definition**, and the rule's source file goes into
  `documents`, which is already a list of `{path, sha256}` for exactly this purpose.
- **SP-2 — the seam cannot record the event, and logging after the action is not fail-closed.**
  Verified: the store is opened privately inside `runOverseer` (`daemon.ts:424`) under an exclusive
  lock, so a dispatcher cannot open a second one. And `SpawnJob` returns a `JobOutcome` that is an
  exit code or a reason — there is nowhere for a rich finding to go. The deeper half is the
  ordering: **gate 1 wants the decision recorded before the action, not after.** A broadcast followed
  by a failed append is an action nobody can review. The fix is the pattern Stage 2 already
  established for occurrences — append and fsync the intent, act only if that succeeded, then append
  the outcome — so it is the same machinery generalised rather than new machinery. **But my claim
  that Stage 3 adds no scheduler machinery is false, and Sol says so plainly.**
- **SP-3 — a `RuleEvent` does not reach the surface gate 1 requires.** This is the one that
  embarrasses the argument above it. I chose `events.jsonl` over `daemon.jsonl` on the ground that
  gate 1 needs reviewability and events are in the panel. **They are not.** Verified:
  `tools/fleet/attention.ts` parses *only* `schema`, `writtenAt` and `attention` out of
  `current.json` and explicitly ignores the rest; `events.jsonl` is not on the wire at all, and the
  Overseer panel says the decision log is later. The only reader of event history is the CLI. So the
  distinction I drew between the two logs was **false in the direction that flattered my choice** —
  and it is the fifth claim of mine today that was about a domain and checked against a subset of it.
- **SP-4 — the acceptance test cannot be run without arming the paid jobs.** There is one global
  `OVERSEER_JOBS_ENABLED`, and arming it supplies the two standing jobs as well as any rule
  definitions. Both standing jobs have never run and are immediately due — my own status paragraph
  says they fire about thirty seconds later. So *"watch each rule fire for real"* would start paid
  model sessions under a gate 4 this plan admits is unbuilt. **A deterministic-only arming path is
  needed**, and it is worth having anyway: being able to run one job is a thing you want at three in
  the morning.

Two of the P1s change what gets built, rather than how:

- **SP-7 — rule 3 has not been granted the confirmation its route demands.** `resource-broadcast`
  carries `needsConfirm: true`, and the route checks `confirm` *before* it checks
  `FLEET_ACT_ENABLED`. So *"the only thing between a proposal and an action is a switch Greg owns"*
  is wrong: the rule would also have to assert `confirm: true`, and **an unattended process
  asserting a human-facing confirmation is the authority grant itself.** This converges exactly with
  the one question Fable said to put to Greg, and sharpens it from a policy question into a
  mechanical one.
- **SP-8 — the broadcast text is false for the triggers proposed.** The fixed text asserts that load
  and memory are both high and that processes are being OOM-killed. Rule 3 might fire because usage
  is near a quota, or because of disk alone. **Telling fifteen agents a thing that is not true is a
  worse failure than not telling them**, and it is not fixed by tuning a threshold. Separate
  messages per predicate, and a trigger table that says which levels combine with OR and which with
  AND.

The remaining P1s are folded in where they belong: **SP-5** (a persisted `approaching` verdict can
age into staleness, so recompute at execution and never branch on the stored level), **SP-6** (a
durable `WakeExpectation` rather than a 10-minute in-memory cooldown against 5–60 minute pauses),
**SP-9** (merged with the six-place count above; Sol adds that `parseEvent` casts to
`SessionEvent["kind"]`, which is why the omission is not compiler-enforced), **SP-10** (a required
new `ObservedRow` field would turn historical log lines into replay holes and could put the ledger
into `history-lost`, **holding every job** — a consequence I had not seen, and it turns my decision
not to thread `observation.ts` from a preference into a requirement), and **SP-11**, below.

#### The reframe: what four P0s actually cost, which is less than it looks

Taken literally the review turns a quick payback stage into a large one. It does not, and the reason
is a coincidence between two findings.

**SP-7 forces rule 3 to be dry-run-only in v1 regardless** — asserting `confirm: true` unattended is
a grant only Greg can make. And **SP-3's review surface is only required before a rule acts.** Gate 1
governs decisions taken on Greg's behalf; a rule that computes a plan, takes no action and records to
a log the CLI can read has not yet decided anything on his behalf.

So the two findings cancel: v1 does not act, therefore v1 does not need the web surface, therefore
the largest P0 is **deferred behind a named condition rather than dropped**. It becomes a
precondition on rule 3 ever acting, which is a stronger statement than a to-do, because the thing it
gates cannot happen without Greg anyway.

#### Build order, revised twice

- **3a — the rule protocol, with rule 2 as its first consumer. DONE, 2026-09-08.** Sol's recommended
  order and it is right: the authorisation that covers the implementation (SP-1), the two-phase
  append-fsync-act-append runner with the store passed in (SP-2), the deterministic-only arming path
  (SP-4), and the `RuleEvent` arm with a **round-trip** test (SP-9). Rule 2 rides on it, proposing
  and never killing. See § What 3a landed below.
- **3b — rule 1.** Small, observe-only, reading the raw payload rather than widening `ObservedRow`.
- **3c — the review surface.** A bounded rule-event projection into `current.json`, the independent
  fleet-side parser, the wire type, and the Overseer panel. **This is the gate on 3d, not a
  nice-to-have.**
- **3d — rule 3, acting.** Gated on 3c *and* on Greg's answer about unattended confirmation. Carries
  SP-5's recomputed verdict, SP-6's durable `WakeExpectation`, and SP-8's trigger table and honest
  per-predicate messages. It is the whole broadcast-and-wake lifecycle or it is nothing: Sol is right
  that abandoning 3d half-built, with automatic broadcasting and no wake accounting, is worse than
  not starting it.

  **Five preconditions, not two.** The three below came out of Sol's code review of 3a and are
  deferred here rather than dropped, because each is about *acting* and none of them can bite until
  something acts. They are written down as conditions on this stage, not as a to-do list, so 3d
  cannot start by satisfying itself.

  1. **A durable rule-run index — SC-1 in full, and it is why 3d cannot be built by flipping a
     disposition.** An acting rule that dies between its action and its settlement leaves a
     `rule-intended` that is replayed on the next boot and folded into no durable state; the
     occurrence eventually becomes eligible again, so the action can happen twice. The fix is an
     index that retains unpaired intents across checkpoints and holds such an occurrence for explicit
     reconciliation — or an idempotency key and a downstream receipt. An `AbortSignal` is not a
     substitute: it addresses shutdown, not uncertain outcomes. (The *live* half of SC-1 is fixed —
     the daemon awaits its in-process rule runs — and that fixes nothing here.)
  2. **The policy's meaning has to be inside the fingerprint — SC-2's second half.** `"safe-to-kill"`
     is a hashed word whose meaning lives in `tools/fleet/actions.ts` and `routes-actions.ts`, which
     no rule pin covers, so **changing what that policy selects changes what the rule proposes
     without changing its fingerprint.** Pinning `scheduler.ts` closed the protocol half of SC-2 and
     leaves this one open. It crosses into the fleet dashboard's territory — the policy is theirs,
     not ours — so it needs their owner as well as ours, which is a reason to raise it before 3d
     rather than during it.
  3. **Occurrence lineage has to be separated from behavioural authorisation — SC-3.** `lastRunOf`
     ignores every occurrence whose definition hash differs from the current one, so a re-pin makes a
     job **immediately due even with an old-hash occurrence in flight**. Sol exercised it against a
     live in-flight `get-ready-to-deploy` under the old pin and got `last: never`, then due
     immediately. Today's re-pins are harmless only because neither standing job has ever run —
     **luck, not design** — and 3d re-pins an *acting* rule, where a duplicate is a duplicate action.
     Wants same-job unsettled legacy occurrences held across hash changes, and an explicit
     compatibility mapping for a semantic no-op rehash.

**What this ordering buys** is that the acting rule is last and behind named preconditions rather
than behind a flag — which is what the gates were asking for all along, and which the original
ordering would have reached only by accident.

#### What 3a landed, 2026-09-08, and the four places it contradicts what is written above

Built, green, and **fired for real** against the live specimen — a real daemon, the real dashboard's
real dry run, against a scratch `OVERSEER_STORE_DIR` rather than `~/.overseer`, because the live
Overseer holds that store's exclusive lock. The evidence is one line, read back out of the log by
`overseer events` after a restart that replayed 17 events with **0 unreadable**, which is the round
trip rather than the append:

```
20:10:15  rule  wedged-work@2026-09-08T20:10:15.373Z#210968a360b9 wedged-work —
          proposed: kill 4 of 4 candidate process(es) — rule cwd-deleted — needs confirm;
          oldest is pid 2282033 (sh -c ( 'npx' 'playwright@1.62.1' 'install' 'webkit' ) …) at 19.9h
```

pid **2282035** is the second entry in that event's `finding.processes`; it was still alive when this
was written, and nothing in this build could have ended it. (By the end of the review fixes that
night it and its three siblings were gone, ended by something else — see below.)

**What exists now.** `tools/overseer/rules.ts` (pure: the spec, the finding, the decision),
`rule-work.ts` (the impure half: the dashboard's dry run — and, until the code review, an actor that
refused), `rule-jobs.ts` (the definition and its pin), the `RuleEvent` arm across all six places SP-9
names, the rule runners in `scheduler.ts`, and `scripts/overseer-pins.ts` — which prints every job's
current fingerprint, because re-pinning had become a thing you found out by reading a refusal.

**Four things here were wrong or incomplete, and each is corrected in place above rather than left
standing:**

1. **"The rule's own source file" is two files, not one** — and, after the code review, three.
   SP-1's fix pins the implementation in `documents`. Pinning only `rules.ts` would have left the
   actor — the thing that decides whether a proposal becomes a kill — outside the fingerprint, which
   is SP-1 word for word one file along. `scheduler.ts` was left out on `standing-jobs.ts`'s argument
   that shared machinery in a pin is a tripwire that mostly fires falsely; **that was wrong, and
   SC-2 says why in one line — it is the code that interprets the hashed `disposition`.** It is
   pinned now, and the argument is written out at `RULE_SOURCES`.
2. **`definitionHash` gaining `work` re-pinned the standing jobs too.** `07eaeebbfc76` →
   `bfc37addeea1` and `858c70da4976` → `8aa20daa8b85`. Nothing either job does changed; the
   definition now says out loud that it starts a session, and saying so moved the hash. That is the
   mechanism, not a cost.
3. **The deterministic-only arming is a capability, not a filter.** `OVERSEER_RULES_ENABLED=1` hands
   the daemon **no `SpawnJob` at all**, so no code in that process can create a session however due
   a job is; a session job meets a `refused` naming the missing dispatcher. `ruleJobs()` also
   returns `AuthorisedRuleJob[]`, which a session job cannot inhabit — two independent guards, one
   at the type level and one at the capability level. The plan's *"a filter a future job could fall
   through"* is exactly what this is not.
4. **The checkpoint still says only `off` or `armed`.** Rules-only reads as `armed` with a detail
   sentence that begins *"deterministic rules only … NO SESSION DISPATCHER WAS BUILT"*. Widening
   `scheduler.kind` is a persisted-schema change and was not worth it for 3a; **if 3c projects rule
   events into `current.json` it should widen this at the same time**, because a third arming that
   only a sentence distinguishes is one restatement away from being lost.

**And one thing the plan got right that is worth confirming, because it was a claim rather than a
measurement:** `killRoute`'s dry run really does answer with `etimeSeconds` on every candidate and
spends no limiter. Measured on this box: 753 processes scanned, 4 candidates, sub-second.

**The mutation check**, run because this job has twice shipped something called from nothing but its
own tests. Five deliberate breakages, all caught: the threshold ignored (4 tests), the threshold off
by one at its boundary (2), the intent appended **after** the action instead of before (2), a
`cannot-see` rendered as `nothing-to-do` (2), and `disposition: "propose"` no longer gating the
actor (1). The one worth reporting is the fourth-and-a-half: **deleting the `parseEvent` branch for
the rule family compiles cleanly** — the only complaint is two now-unused functions, which would not
exist at all if the branch had simply never been written — and the round-trip test catches it as
`unreadableLines: 2`. SP-9 is exactly right, and an append-only test would have passed.

**One test was too weak and was strengthened when the mutation exposed it.** Asserting the finished
log's order cannot tell append-then-act from act-then-append, because both leave the same two lines
in the same order. The test now reads the file **from inside the actor**, which is the one moment
that distinguishes them.

#### Verified again independently, and one outcome arrived by accident

*"Done, all tests pass"* is a claim rather than a result, so the stage was re-run from outside the
session that built it: 7 files / 271 tests green (245 baseline + 26 new, exactly as reported),
`npm run typecheck` exit 0, and a rules-only daemon started by hand against a scratch
`OVERSEER_STORE_DIR`.

The ledger reads, in order, and this is the whole design visible in five lines:

```
reserved   wedged-work@…#210968a360b9 — lease until 20:28:47
started    wedged-work@…#210968a360b9 — pid 126654
intends    wedged-work@…#210968a360b9 — kill 4 of 4 candidate process(es) — rule cwd-deleted
           — needs confirm; oldest is pid 2282033 (…playwright@1.62.1 install webkit…) at 20.2h
rule       wedged-work@…#210968a360b9 — proposed: kill 4 of 4 …
finished   wedged-work@…#210968a360b9 — exit 0
```

`intends` is a **separate event appended before** the settlement, so the fail-closed ordering is not
a claim about the code, it is a thing you can read off the disk.

**And the third outcome was got by luck rather than design, which is the part worth keeping.** The
first verification run happened to land while the fleet dashboard was restarting, and the rule
settled as:

> `refused: could not reach the fleet API at http://127.0.0.1:8787/api/actions/box: fetch failed`

So `refused`, `proposed` and `nothing-to-do` have now all been *seen* rendering differently on a real
box, rather than only in tests — which is exactly the property the direction doc asks for and the one
a suite is least able to prove.

It also surfaces a real dependency nobody had written down: **rule 2 goes blind whenever the
dashboard is down**, because its only eye is that HTTP route. It says so distinctly instead of
reporting an empty candidate list, which is the right behaviour and the reason `cannot-see` exists as
its own arm. But it is the same shape as A27 and as the deaf-Overseer asymmetry in `provision.sh`:
**the thing you reach for when something is broken shares a dependency with the thing that broke.**
Worth naming in 3c, where the review surface will have the same problem.

#### The code review of 3a, and the finding I had already seen and talked myself out of

Sol reviewed the shipped code (`docs/plans/260908g-stage3a-code-review-sol.md`) and blocked it **as a
reusable protocol for acting rules**, while agreeing the shipped rule is safe today. That distinction
is the right one and it is the one this plan's ordering already assumed.

**SC-2 is the finding that matters, and I had it in my hands.** Reading the diff I noticed that
`disposition` is a runtime `switch` rather than a type-level guarantee — and then argued myself out
of it: *the conditional is on hashed data, so changing it changes the hash and the job is refused.*
That is wrong, and Sol says why in one line: **`scheduler.ts`, which interprets the hashed
disposition, was deliberately left out of `RULE_SOURCES`.** So a change that bypasses the switch
leaves the rule's authorised hash perfectly current. The fingerprint guards the threshold and not the
thing that decides whether to act on it.

I had even written the suspicion into the review prompt — *"the protocol that decides whether to act
is arguably more load-bearing than the rule whose threshold it reads"* — and then shipped the
opposite. **This is a different failure from the day's others**: not an unchecked claim, but a
checked observation reasoned away. The others were cured by looking; this one needed somebody else.

Four fixes, all of which make a claim true that is currently false:

- **SC-4** — `definitionHash` and `ruleSpecHash` **destructure**, and destructuring is not exhaustive
  in TypeScript, so a new field is silently outside the fingerprint. This defeats SP-1 directly, and
  the test named "every knob" enumerates today's fields by hand. Replaced with exact mapped types, so
  a new key is a compile error until its encoding is supplied.
- **SC-2's cheap half** — a `runProposingRule` handed only `observe`, so the absence of an actor is
  structural rather than conditional, and `scheduler.ts` goes into `RULE_SOURCES`.
- **SC-5** — the round-trip test uses `JSON.parse(line) as OverseerEvent`, so it proves the parse
  branch *exists* and not that it parses *correctly*. Asserted through `readEvents` instead.
- **SC-1's live half** — `runRule` returns a hot promise the daemon never awaits, and the shutdown
  path assumes every job is a separate process. An orderly shutdown can close the store mid-`observe`
  and lose the settlement, leaving a `started` occurrence with no ending. Nothing acts, so nothing is
  dangerous; it manufactures exactly the unaccountable-run noise Stage 2 exists to make meaningful.

**Three findings are deferred to 3d with named conditions rather than dropped**, because each is
about *acting* and 3d is the acting stage: SC-1 in full (an acting rule that dies between action and
settlement leaves an unpaired intent and becomes eligible again — **this is why 3d cannot be built by
flipping a disposition**); SC-2's second half (the meaning of `"safe-to-kill"` lives in unpinned
fleet code, so the policy can change without changing the fingerprint); and SC-3.

**SC-3 deserves its own sentence, because its safety today is luck.** `lastRunOf` ignores every
occurrence whose definition hash differs, so a re-pin makes a job **immediately due even with an
old-hash occurrence in flight** — Sol exercised it and got `last: never`, then due. Today's re-pin is
harmless only because neither standing job has ever run. That is not design, and it is a live trap
for every later re-pin.

#### What the four fixes actually did, 2026-09-08 night

Built and green: **7 files / 276 tests**, up from 271 — five net new, and one deleted. Every one of
them was watched going red first. `npm run typecheck` exit 0.

**SC-4 — the encoders are a mapped type now, and the guarantee is real.** `RULE_SPEC_ENCODERS` and
`DEFINITION_ENCODERS` are `{ [K in keyof T]-?: (value: T[K]) => string }`, so a new field is a
compile error until somebody says how it is hashed. The runtime half is
`RULE_SPEC_HASHED_FIELDS`/`JOB_DEFINITION_HASHED_FIELDS`, derived from the tables and held against
the type's own keys by a test — so **reverting to a destructure deletes the export and takes the test
with it**, which is the one thing a runtime test can say about a compile-time property. One honest
limitation: a destructure that still named every field would be invisible to the runtime test; what
the mapped type stops is the *next* field, which is the failure SC-4 is actually about.

**SC-2 — the capability is split, and `scheduler.ts` is pinned.** `RuleWork` became two types:
`ProposingRuleWork` (`selfPid`, `observe`) and `ActingRuleWork` (that plus `act`), run by two
functions, reached through two separate `TickInput` fields. `runProposingRule` **has no actor in
scope**; `runActingRule` needs `input.acting`, which `daemon.ts` has no option for and no shipped
wiring supplies, so an `"act"` spec meets a refusal naming the missing actor — the same shape as a
session job in a process with no `spawn`. `refusingActor` is **deleted**: a refusing actor is a
capability the process holds, and Sol is right that that is a conditional wearing the clothes of a
boundary. The test that asserted it refused politely is replaced by one asserting the shipped wiring
has no `act` key at all.

**The pins.** `wedged-work` `210968a360b9` → **`6a62bed1e623`**, and *nothing the rule decides
changed*: `scheduler.ts` joined `RULE_SOURCES`, `rule-work.ts` lost its actor, and `rules.ts`
relabelled the first line of the canonical spec. The standing jobs did **not** move —
`bfc37addeea1` and `8aa20daa8b85` are unchanged, because the definition encoding is byte-identical to
the destructured one it replaced. That was deliberate: a refactor that re-pinned two jobs for no
behavioural reason is exactly the false tripwire this stage keeps arguing against.

**SC-5 — the round trip goes through `parseEvent` now.** The test helper reads
`store.readEvents(0)` and asserts `unreadable` is empty, rather than casting a `JSON.parse`. The
proposal test asserts the whole `finding` — every denominator, not the conclusion — and that the
settled sentence is the intended one. Proved by mutation: a `parseEvent` that accepts the event and
returns `processes: []` was green before and is red now.

**SC-1's live half — the daemon holds its rule runs and waits for them.** `schedulerTick` hands each
in-process rule run to `onRuleRun`; the daemon keeps them in a self-emptying set and awaits them in
`settleInFlight` (which was `settlePasses`, and the name was part of how this got in — a rule run is
in-process too). The wait is bounded by `RULE_SETTLE_GRACE_MS`, fifteen seconds against a
ten-second observer timeout, because `Restart=always` means a hung observer would otherwise cost a
daemon that will not die. **The bound is an outcome, not a give-up**: every run still unsettled gets
the same durable `job-record-lost` note a failed completion append gets. Sessions are deliberately
not tracked — a child with a durable reservation is exactly what the old comment described, and it
was right about half the cases.

**The mutation check.** Three deliberate breakages, all caught. Reverting the encoders to a
destructure: caught by *"THE FIELD LIST IS THE TYPE'S OWN"* (the export vanishes) and by *"THE PIN IS
CURRENT"*. Letting the `"act"` arm fall back to the looking capability: caught by *"AN ACTING SPEC
MEETS A REFUSAL…"* and, now that `scheduler.ts` is pinned, by *"THE PIN IS CURRENT"* — **which is the
fingerprint doing the thing it could not do before this change**. Corrupting a parsed `finding`:
caught by the round-trip test.

**And one test was quietly broken and is worth naming.** *"editing the IMPLEMENTATION moves the
fingerprint"* tampered with a digest by replacing its last character with `0` — a no-op whenever the
digest already ended in `0`, which `rules.ts` did after the first edit of this session. A
one-in-sixteen test that had been green by luck. It flips to `1` when it has to now.

**pid 2282035 was gone by the end of this work**, along with 2282033/4/6 — the whole specimen family.
Nothing here could have ended it: the build holds no actor, and no kill was run from this session. It
is worth knowing that the live specimen this rule was sized against no longer exists, so a future
demonstration needs a new one.

#### Three pushbacks from the implementer, and how each was settled

All three are good, and one improves on Sol's own fix. Settled by me rather than inherited, which is
the point of asking for them.

**1. The SC-4 test is a proxy, and they said so themselves.** A destructure that still names all four
fields is behaviourally identical to the mapped type, and no runtime test can see the difference —
what the new test actually catches is the *deletion of the exported field list*, which a revert
entails as written. **The real guarantee is compile-time only.** Accepted as stated: the value is
that a *new* field cannot be silently omitted, which was SC-4's actual complaint, and the honest note
is better than a test claiming more than it does.

**2. Pinning `scheduler.ts` is over-broad, and this is a better answer than Sol's.** Sol offered two
fixes and the implementer took the pin, then argued the cost Sol had not priced: `scheduler.ts` also
carries session dispatch, the sweep, and `describeReport`'s wording, so **every rule's authorisation
is now hostage to a file that changes for reasons having nothing to do with rules.** It re-pinned
twice in one session; with three rules, editing a log sentence would disarm all three.

They also refused Sol's alternative — *"move the disposition interpretation into pinned rule-specific
code"* — because it gives every rule its own copy of the append-before-act ordering, which is exactly
what SP-2 refused. That is right.

**Decision: 3b splits the rule protocol out of `scheduler.ts` into its own file and pins that.** Same
guarantee, far fewer false trips, and it is first in 3b rather than a note. The failure mode
meanwhile is fail-safe — a stale pin *refuses* the job with a message — so it is annoying rather than
dangerous, which is why it waits for 3b instead of reopening 3a.

**3. `refusingActor` was deleted, taking defence in depth from two guards to one.** Beyond the letter
of the brief, correctly flagged for me to decide rather than absorb. **Accepted, and it is my call
now, not theirs:** the structural guard — the acting capability being absent from the process — is
strictly stronger than a polite refusal, and an unwired refusing actor is a liability rather than a
belt, because it looks like protection and invites somebody to wire it up. One real guard beats one
real guard plus a decorative one.

#### The mutation that was a no-op one time in sixteen

Reported by the implementer and worth more than the fix it came from. A test asserting *"editing the
implementation moves the fingerprint"* tampered with a digest by replacing its **last character with
`0`** — which does nothing at all whenever the digest already ends in `0`. It had been passing by
luck, and the luck ran out on an unrelated edit, so it went red for a reason that had nothing to do
with the change being made.

**A mutation test whose mutation is sometimes a no-op is a test that is sometimes not a test**, and
nothing about it looks wrong: it is green, it is specific, and it names the right property. Same
family as everything else today, and the narrowest instance of it — the check was not weak, it was
*probabilistically absent*. Fixed to flip the character rather than set it.

#### The specimen died on its own, after the rule had caught it

pid 2282035 and its family (2282033/4/6) are **gone**, confirmed independently. Nothing in this build
could have ended them — it holds no acting capability, and `daemon.jsonl` records no kill — so
something else on the box did it, twenty hours in.

The demonstration had already happened: the rule proposed against it at 20:26, and that event is in
the ledger. But two consequences stand. **The four-hour threshold was sized against exactly one
specimen and that specimen no longer exists**, so it remains the guess Sol called it, now without
even the one case. And Greg's instruction — leave it standing as a test case — was overtaken by
events rather than followed, so **a future demonstration needs a new specimen**, which is a thing to
make deliberately rather than wait for.

#### SP-11, and a number I sent to somebody else

Sol is right that *"3 of 15"* mixes eight agent sessions with seven shells, and that `working`
describes a Claude pane's state rather than proving those sessions were consuming the machine. The
honest statement is **"3 of 8 agent sessions were deliverable; 5 were held because working; 7 shells
were never eligible"**, and attributing load to sessions needs `health.ts`'s attribution evidence
rather than a status word.

This one matters more than a P2 usually would, because **I had already sent the weaker number to the
fleet dashboard's owner**, who is deciding on that evidence whether to cross a deliberate refusal in
their own code. The sampler now records categorical counts, and they have been told which number
changed and why.

#### `working` is not a proxy for busy either, and the measurement nearly said otherwise

The dashboard's owner then checked the live board against `ListAgents` as an independent oracle and
found something neither of us had assumed: **a row the board calls `working` can be a session whose
turn has ended** with something backgrounded behind it. Claude Code's own `status: "shell"` means
`idle && hasUnfinishedLocalBash`, and such a session is at a prompt and can be messaged — but
`drainGate` excludes it. So `working` is a poor proxy for load *and* an unreliable proxy for busy,
and some of what the exclusion drops was reachable all along.

Measured 2026-09-08 at 20:53: **one of three `working` rows was at a prompt**, with no unknowns.

**The instrument nearly reported the opposite, and how it nearly did is the durable part.** The
oracle is `~/.claude/sessions/*.json`, and the join is **not** the pid in the filename: measured
pairs are pane `1921921` against file `1921927`, pane `3184904` against `3184909`, and (from
`pause.ts`, which already joins correctly) `124240` against `124250`. The pane pid is the shell and
Claude is a descendant at no fixed offset. My first attempt joined on the filename and returned
*unknown for four rows out of four*.

Had `unknown` been folded into "no", it would have reported `working_but_at_prompt = 0` — clean,
plausible, precise, and false — and that number would have gone to the person deciding the stage.
**An absent reading standing in for a negative one**, which is [silent-success.md](../reusable/silent-success.md)
in its purest form and the shape this whole day kept producing.

My second attempt walked the process tree instead. It returned zero unknowns, so it *looked*
correct — and read `0` where the identity join reads `1`. **A join that returns no unknowns is not
thereby a join that answers the right question**; ancestry is merely adjacent to identity. The
sampler now joins on the `sessionId` inside each file, the way `pause.ts` always did, and reports
`unknown` as its own column so the next reader can check it rather than trust it.

**The reason both joins were kept rather than the loser deleted**: letting two answers to the same
question disagree is what caught the ancestry error, and it caught a second thing within minutes.

The dashboard's owner drew a cheap fix out of the finding above — `working` plus a pause of
`{kind: "background-work"}` should gate `now` rather than `later`, since the server already knows
which working rows have merely backgrounded something. That would reach some deferred sessions
**without touching the `:505` refusal and without the design argument the expensive version waits
on**, which is a much better stage. It rests entirely on `background-work` picking out the rows that
are genuinely at a prompt.

Measured 2026-09-08 at 20:56, first reading with both joins: `working_but_at_prompt=1`,
`server_bg_work=0`, `joins_disagree=1`, `oracle_unknown=0`. The two working rows were

| row | Claude's own status | the server's `pause` |
|---|---|---|
| `overseer-md-agent-coordinator` | `busy` | `cannot-tell` |
| `overseer-orchestrator-design-and` | `idle` | `cannot-tell` |

The second is the one at a prompt, and its pause is not `background-work` — it is `cannot-tell`,
**with a reason string identical to the busy row's**. At that instant `pause` did not discriminate
between them at all. `background-work` is real and does occur (observed at 20:25 with
`sinceMs: 326418`); what is unproven is that it *coincides* with being reachable.

**One reading of two rows is not a refutation**, and it stays recorded as an open question rather
than an answer: the overnight series says how often the two coincide, and `joins_disagree` makes the
misses visible instead of leaving them to be inferred from a total.

**The cause was found within minutes, and it is one line.** I had flagged the likeliest error as
mine — that the column might be treating Claude's own `idle` as reachable when `idle` could mean
something a broadcast should not interrupt. It does not. `status` is computed as
`baseStatus === "idle" && hasUnfinishedLocalBash ? "shell" : baseStatus`, read out of the 2.1.263
binary and verified against it, so **`shell` is a subset of `idle` rather than something beside
it**, and both mean the turn has ended. The column measures reachability, and if anything
conservatively.

The error was in `pause.ts`'s `readShellState`:

```ts
if (entry.status !== "shell") return { kind: "not-background-work" };
```

The store's `idle` — the *direct* evidence of being at a prompt — is read and then collapsed into a
negative, so `background-work` names only the `shell` subset. That is why my two working rows came
back with the **identical `cannot-tell` reason string**: the collapse showing through. The proposed
cheap fix named a field that could not pick out the rows it was meant to pick out.

Its author calls it *"the lossy-join half of `260908b` occurring inside the fix for it"* — the
producer said the careful thing and the consumer threw it away, in a module written that morning to
close exactly that class. The cheap fix survives as a different change: stop reducing the store's
status to a boolean about background work.

**What did the catching is worth more than what was caught.** The disagreement was found because a
second join was built *so that it could contradict the first*, after an ancestry join had returned
zero unknowns and the wrong answer. **Two joins that disagree are a measurement; one join that
agrees with itself is a fixture** — the same animal as a test that shares an assumption with the code
it checks, and a sharper statement of it, because the ancestry join was not weak. It answered a
different question competently.

#### The Overseer sees less of the fleet than the fleet sends, and the rules should not fix that by widening the differ

The three fields the rules most want are all outside `ObservedRow`: `permissionMode`, `pause`, and
`health`. Each is on the wire and each is dropped by `parseRow()` before anything in
`tools/overseer/` sees it.

The obvious move is to thread them through `observation.ts`. **Do not.** Two reasons, and the second
is the real one:

1. That file belongs to a worktree that is still active, and this stage does not need to open it.
2. `ObservedRow` and `diff.ts` exist to answer *what changed about a session's identity and status
   over time*. `pause` and `permissionMode` flicker for reasons that are not events —
   `pause` is recomputed from a transcript tail on every collection — so threading them through the
   differ manufactures a stream of "changes" that mean nothing. **That is the same argument
   `source.ts` already made about `health`** and settled the same way: *"a missing health block would
   read as a health change."* Widening the differ would be re-deciding a question that has been
   decided once, in the direction it was decided against.

The resolution costs nothing, because the daemon already holds what the rules need.
`SourceMessage` carries `{kind: "payload"; json: unknown}` — **the whole raw wire payload, before
`parseRow` narrows it.** The rules parse the two or three fields they want out of that same value,
with their own narrow parser and their own unknown arms. No second HTTP client, no edit to another
worktree's file, and no diff noise.

This is the seam the direction doc describes doing its job: the differ answers past-tense questions,
and a rule asking *is anything wrong right now* is a present-tense question that was never its
customer.

#### The wake-check is nearly built, and I had it down as the least designed thing here

I flagged "check later that they woke up" as the weakest part of this plan. It is the strongest,
because `pause.ts` already computes it: `Pause.overdue` is set only when the wake-up time **was
actually read**, is more than `OVERDUE_GRACE_MS` (5 minutes) in the past, **and nothing has run
since**. That third clause is the whole difficulty — it is what tells a wake-up that never fired
apart from one that fired and went quiet — and it is already written and already tested.

So the wake-check has no detector to build.

**I then wrote that nothing anywhere reads `overdue`, and that was wrong.** The field's author
checked it end to end rather than from memory and found the reader: it crosses the wire in
`types.ts`, deliberately untouched by the clock-skew shift because it is the server's judgement
rather than a time the browser may reinterpret, and `PauseLine.tsx:175` draws it in the alarm colour
— *"wake-up — overdue 22m"*, with the due time on the card. It landed with its consumer this
afternoon.

The mistake is worth keeping because of its shape. *"Nothing reads it"* is a claim about the whole
repository, and I checked it against `tools/overseer/`, which is the directory I was standing in.
The field is declared in `wire.ts` and its only reader is in the browser, so the search I ran could
only ever have found the producer. **Same class as the census that counted its own `grep`, and as
the impossibility claim that did not name its domain** — a claim about a domain checked against a
subset of it, and the third instance today.

**What survives is sharper than what I wrote, not weaker.** `overdue` has a *human* consumer and no
automated one. So does the kill machinery — `selectForKill` is reached by a person pressing a button
on a phone. That is the real pattern, and it is the case for the Overseer stated in one line: the
mechanisms here are built, correct, and each waits on somebody noticing. The scheduler seam was the
one genuine orphan.

For 3b this means the wake-check is a one-line read plus the durable record of who was told and
when — the smallest piece of the stage rather than the largest, and its hard half is already written,
already tested, and already trusted enough to be drawn in the loud colour.

#### The one question that is Greg's, and it blocks nothing

May an unattended rule run an **enacted** action — a kill under a named safety rule — without a
confirm? It is an authority grant, the same class as the parked question about whether the watchdog
may restart the daemon, and Fable was strict that it is not minutiae. **The default answer is no,
propose only**, which is what gets built either way, so this is asked in the debrief rather than as a
mid-run stop.

What is explicitly *not* Greg's, so it is settled here: thresholds, which surface the events land on,
the cooldown, and building rule 3 behind `FLEET_ACT_ENABLED`. He owns *flipping* that switch;
building behind it forces nothing on him.

#### What would overturn rule 2's verdict, stated as a number

Fable named the one thing that changes its mind, and it is a rate: if `cwd-deleted` orphans recur at
more than one a day, a proposal inbox becomes the two-hundred-entry log this design says it cannot
survive, and rule 2 must act rather than propose. Today n=1. **The events rule 2 writes are how that
rate gets measured**, so the observation is not merely a record, it is the instrument that decides
the next version.

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

## Two judgement calls the implementation raised, and how they went

**A `stuck` lease RELEASES the job rather than holding it.** The brief said `stuck` must be visible
and reported, and did not say whether the job may then run again. Holding is S6 wearing a different
hat — a guard that can only tighten — so the lease releases: the unaccountable run is written down as
`unknown` permanently, and the *next* run is a different occurrence at a different instant, which
makes it a new occurrence rather than a retry of the one we cannot account for. That distinction is
what keeps "never auto-retry `unknown`" true while still letting the job live.

**`Checkpoint.jobs` keeps only the 50 most recent unknowns, and the number is arbitrary.** Flagged
by the implementer as arbitrary, which it is. It is nevertheless safe in the direction that matters:
**`events.jsonl` keeps every unknown for ever**, and the checkpoint is a convenience view that exists
so `current.json` does not grow by one entry per crash. So the bound can lose an *alarm* on a very
unlucky box, never a *record*. The thing that would make it wrong is an acknowledgement mechanism —
once somebody can mark an unknown as seen, retention should follow that rather than a count.

**And one it did not have to raise, because the types made it.** `stuck` is not stored. It is
`started` plus a deadline that has passed, so the same bytes are `in-flight` a minute earlier; a
stored `stuck: boolean` would go on saying "fine" for exactly as long as the daemon was dead. That is
the same distinction the direction doc draws for `statusSince` between an observed transition and a
lower bound, arrived at independently.

## The watchdog is honest and its verdict reaches nobody

Noticed on reading the diff, 2026-09-08, and worth writing down before it becomes the thing we
congratulate ourselves on. `overseer-watchdog` distinguishes its three failure states properly and
exits non-zero when the daemon has stopped ticking. **That exit code goes into the journal and
`systemctl is-failed`, and nothing on this box looks at either.**

Which is the shape of **A27** at a smaller scale, and the same shape as the Remote Control finding
already on this page: *a thing that reports fine until the moment it is needed, with no signal
reaching anyone.* A watchdog whose alarm is a line in a log nobody reads has moved the silence, not
removed it.

**Two things follow, and only the first is in this job.**

- **Write the verdict where something already looks.** The watchdog appends its result to the store,
  so the dashboard can render *"the watchdog last said the daemon was stale, 40 minutes ago"* on the
  surface that already exists for exactly this — the direction doc's rule that *"the Overseer was
  last seen 40 minutes ago"* belongs where the count would be, not in a footer.
- **Restarting the daemon is the tempting next step and is deliberately not taken yet.** The case the
  watchdog catches — a process that is alive and not ticking — is precisely the one
  `Restart=always` cannot see, so a restart is the obviously right action. But `systemctl restart` on
  a system unit needs root, the watchdog runs as `greg`, and the polkit rule or `sudoers` line that
  would fix that is **a change to the box, so it is a change to the file that builds the next one**
  ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)),
  and it hands an unattended timer the ability to restart services. That is Greg's call, not a
  detail to slip into a stage about scheduling.

## Deliberately not in this job

- **The decision-log web mode.** Greg asked for it; it is the dashboard's tense, and `tools/fleet/`
  belongs to another agent. This job writes the log; the render is handed over with the shape agreed
  at the seam.
- **Multiple Claude Max accounts.** Greg: *"I don't want to deal with multiple simultaneous
  subscription-accounts on the same box just yet"* — so the near-term answer is watching the limit
  and pausing, which is Stage 3.
- **Configuring the schedule from the web interface.** Greg called it a nice-to-have future stage.
- **Renaming `docs/plans/260908f-orchestrator-wave-2-….md`.** A dated plan record, mid-flight.

## The review OF STAGE 2, and what it changed

**GPT Sol reviewed the built Stage 2 and blocked it: no P0, four P1s.**
[The full text](260908g-stage2-code-review-sol.md). Its crash-window table passed on all five rows,
and every P1 was about the same thing from a different angle — **something correct in isolation that
was not true in operation.** What was done about each:

- **C1 — the scheduler was installed and scheduled nothing.** `scripts/overseer.ts` called
  `runOverseer` with no `jobs`, so `daemon.ts` built no timer, and there were no definitions and no
  `SpawnJob` anywhere outside the tests. Now there are:
  [`tools/overseer/standing-jobs.ts`](../../tools/overseer/standing-jobs.ts) holds the two jobs that
  are pure documents (`get-ready-to-deploy`, the feedback sweep) and
  [`dispatch.ts`](../../tools/overseer/dispatch.ts) starts each as `gjd-remote new-claude <name>
  --no-attach -p -`.
  **It is off unless `OVERSEER_JOBS_ENABLED=1`**, in the spirit of `FLEET_ACT_ENABLED`, because
  arming it starts real Claude sessions on a shared box and that is Greg's decision rather than a
  consequence of merging. `overseer status` prints ARMED or OFF from a field the daemon writes into
  the checkpoint — not from the reader's own environment, which is a different one, and not inferred
  from an empty occurrence list, which is what *off* and *nothing to do* both look like.
- **C2 — the definition hash separated history and did not gate anything, and the effect ran
  backwards.** An edited definition read as *never run*, `due()` reads *never* as due now, so an edit
  dispatched the edited job immediately — the opposite of the runbook's gate 3. The authorisation is
  now a **pin**: a hash constant beside each definition, compared before `due` is asked anything, and
  a mismatch is its own refusing state. The document's own digest is inside the definition, so
  editing `get-ready-to-deploy.md` moves the fingerprint even though the prompt did not — which is
  the only version of this that means anything for jobs that *are* documents.
- **C3 — a cold recovery discarded the ledger and let jobs run again.** `openStore` deliberately
  comes up with an empty occurrence map when the log has a hole or exceeds the replay ceiling. That
  is right for the session register and wrong for a ledger of what has been done. The store now
  carries `occurrenceHistory`, and a `lost` one holds every job rather than dispatching it.
- **C5 — only the reservation append was fail-closed.** The four later appends dropped their
  results, so reports disagreed with durable history. They are reported now (`unrecorded`) or, for
  the completion that lands after the tick has returned, sent to `onLostRecord` and written into
  `daemon.jsonl` as `job-record-lost`. None of them throws: losing the record must not also lose the
  child's outcome.
- **C6 — the watchdog and the daemon did not share the deadline they thought they shared.** Both
  called `staleAfterMs`, which prevents formula drift and not input drift: 300,000ms against
  325,000ms under the documented normal values. The daemon now writes the deadline it is using into
  the checkpoint and the watchdog reads it.
- **C7 — `Persistent=true` does not prove missed-run catch-up here.** `systemd.timer(5)`: it only
  affects `OnCalendar=` timers, and this one has `OnBootSec=`/`OnUnitActiveSec=`. The setting stays
  (harmless, and correct if the timer ever moves); the comment and the test now name `OnBootSec=2min`
  as what actually covers a box that was off, and the neighbouring "parses as a valid unit" test runs
  `systemd-analyze verify` instead of checking that a line exists.
- **C8 — one watchdog test did not test what its name said.** It compared internal `state` tags and
  never called `formatVerdict`, so all four rendered messages could have become identical. It renders
  them now.

**C4 — the global model-call budget — is deliberately not done here.** It is its own stage.

## The review OF THE PLAN, and what it changed

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
