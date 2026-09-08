# Orchestrating the agent fleet

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

**This is the direction, not a plan.** It exists so that every plan doc and every worktree working on
the fleet dashboard is aiming at the same thing, and so that nobody rediscovers the constraints at
the bottom of this page the expensive way. The plans that implement it live in `docs/plans/`,
starting with
[260907e-agent-fleet-dashboard.md](../plans/260907e-agent-fleet-dashboard.md).

Status as of 2026-09-08: **nothing built.** No server, no page, no Tailscale on the box — evidence:
`which tailscale` is empty and there is no `tools/fleet/`.

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
require the next one to be worth having.**

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
- **Address a session by tmux pane handle plus an execution generation, never by name.** Names get
  reassigned when a session dies. Both `gjd-remote` and the third-party system Greg showed us learned
  this independently.
- **Scheduling: the built-in `/loop` offers a cloud schedule that survives the session but runs in
  Anthropic's cloud, so it cannot touch this box's worktrees.** The session-local cron is in-memory
  and dies with its session. So "run job J on the box every M minutes" has no home yet — Greg
  deferred building one on 2026-09-08. See [cron-scheduler.md](cron-scheduler.md), which says the
  same thing from the product side.

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
