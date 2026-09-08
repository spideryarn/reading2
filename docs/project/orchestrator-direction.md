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

Status as of 2026-09-08: **the dashboard is running, the Overseer is not.** `tools/fleet/` serves a
live page on the box and the tailnet, with per-session status and the pending question for blocked
sessions. There is no `tools/overseer/`, no store, and nothing that survives a reboot.

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
- **A session is an action, not a residence.** When judgement is needed — is this one stuck, what is
  the one sentence to send — the daemon spawns a short-lived Claude that reads the store, answers,
  and exits. A persistent brain can come later and the daemon can supervise one; it should not be
  first, because a persistent session's context is precisely the thing that does not survive the
  reboot Greg wants survived.
- **The dashboard is the face**, and belongs to whoever is building it — [§ Two tenses](#two-tenses-the-seam-between-the-overseer-and-the-dashboard).

**Autonomy, as of 2026-09-08: it may dispatch scheduled jobs unattended, and nothing more.** Greg's
choice from four options, the other three being observe-and-notify-only, steering live sessions, and
pausing/killing. So starting a `get-ready-to-deploy` session on its cadence needs no permission;
sending a live agent a steering message, or killing anything, still does.

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
the stream drops, and falls back to its own `collect()` only when the server is unreachable — slowly,
because a fallback that grazes every 12 seconds on a swapping box is worse than a gap in the history.
The dashboard collects on a chain (60s from the *end* of each run, 5× backoff after a failure), not
on a fixed interval, for the same reason.

**The coupling this creates runs the opposite way, and is accepted knowingly:** the Overseer now
depends on the dashboard being up. Hence two clocks in the state file rather than one — `writtenAt`
(the Overseer last wrote) and `lastGoodSnapshotAt` (it last heard from the dashboard). They come
apart exactly when something is wrong, and a single number would hide the case where the Overseer is
alive but deaf. **A dead dashboard is a fact the Overseer records, not a silence it sits in.**

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

**Multiple Max subscriptions is medium-term.** Greg, 2026-09-08:

> Right now, I have a couple of Claude Max subscriptions, and I run /login every couple of days to
> switch when I hit limits. In future I expect to have more. But let's say that multiple Claude Max
> subscriptions is MEDIUM-TERM, i.e. out of scope for the next day or two.

So the near-term usage-limit work is **visibility** — how close is the current account, and what
should stop when it is near — and not rotation.

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
- **Address a session by tmux pane handle plus an execution generation, never by name.** Names get
  reassigned when a session dies. Both `gjd-remote` and the third-party system Greg showed us learned
  this independently.
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

| | what | owner |
|---|---|---|
| **A9** | **Approval must bind to the material, not the sentence.** Astra changed a proposed file's contents from `hello` to `goodbye` and the pane parser returned an identical question and options — it keeps *"Do you want to create notes.md?"* and discards the diff. So an approval can be accepted after the thing being approved has changed, and the phone can ask for approval without showing what it is. Bind to command, diff, destination and permission scope; hand off to a terminal when the capture is incomplete; and make *"yes once"* and *"auto-approve this session"* visibly different. | dashboard |
| **A10** | A live Claude descendant does not prove an **empty input box owns the keystrokes** — the text may append to a draft, hit a modal, or reach a foreground program. Make arbitrary prose a narrower capability than answering a recognised dialog. | dashboard |
| **A11** | Delivery needs an **uncertain** state. A nonce proves the transport *can* work; it says nothing about later requests. Action IDs, and five states — accepted, keys submitted, reception observed, refused, outcome unknown — with a repeat retrieving the receipt. **Never auto-retry keystrokes.** | dashboard |
| **A5** | **Reachability, but narrower.** The reference system we copied checked callers against `owner-logins.txt` before POSTs — *its write boundary was never reachability alone*, and we took the half we liked. The cheap fix is a device-scoped tailnet grant, not a login page. Tailscale's default policy is permissive, so verify rather than assume. | both |
| **A6** | Treat the dashboard as a **privileged renderer of hostile content**: CSP and anti-framing before answer buttons. Origin checks do not stop a malicious page framing the real one. | dashboard |
| **A12** | **An Overseer message must not acquire Greg's authority** by arriving as a user turn. A worker can meet malicious instructions, report them, and get them back as authoritative steering. Display *Greg requested* / *Overseer proposed* / *policy authorised* distinctly. A model's recommendation must not mint its own approval. | overseer |

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
in orchestrator-direction, but ignore it for now."** So this is a record, not a backlog — nothing
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
- **One adapter per harness, and honest about what each can do.** Claude, Codex and bare shells have
  genuinely different capabilities; flattening them into one "message an agent" verb produces a UI
  that lies.
- **Actions before buttons.** Because the orchestrator is eventually a program, every steering action
  is a typed function first and a click second.
- **This is not Spideryarn.** It runs on the box, spans repos, and must not depend on the product
  database or on anything under `src/`. If it ever earns its own repo, that should be a move, not a
  rewrite.
