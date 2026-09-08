# Wide review: the Overseer and its web interface, as a whole approach

**This is not a code review.** It is a request for judgement on a direction, while it is still cheap
to change. We have built one thin slice and planned the next; almost everything is still soft. Tell
us what we are getting wrong, what we have not thought of, and what we should do that is not on the
list.

Greg (the owner) asked for this review in these words:

> get a review of the overall plan & approach (across the whole setup, from Overseer to web
> interface) … with a wide brief, e.g. security, UI, agent-capability, options/functionality/features
> we might want to include, concerns, actions we might want to give the Overseer, things we might
> want to signal to the user, storage, robustness, better ways for agents to communicate, etc etc etc

So: **breadth is wanted more than depth**, and an important idea we have missed entirely is worth
more than a refinement of one we have.

## The situation

A single Hetzner box runs ~36 Claude Code sessions in tmux, one tmux session each, across ~15 git
worktrees of one repo plus another repo, plus Codex batch jobs and bare shells. They are autonomous
coding agents working on a real product with real paying users. One person (Greg) supervises all of
them, increasingly from a phone.

The box is under genuine strain: load 33–41 against 16 cores, 23 of 30 GB RAM and 18–23 GB of 31 GB
swap in use, and it reached load 391 with the OOM killer firing on 2026-09-08.

Two things are being built at once, by two different agents:

1. **The fleet dashboard** — a web page on the box showing every running session, its status, and
   what a blocked one is asking. Running today. `tools/fleet/`.
2. **The Overseer** — a long-running daemon that watches the fleet over time and eventually
   coordinates it. Planned, not built. `tools/overseer/`.

## What to read

Repository `spideryarn2`, this worktree. Read from git at revision
`{{REV}}`.

Start here:
- `docs/project/orchestrator-direction.md` — **the most important file.** The standing direction:
  Greg's priorities, the constraints measured on the box, the seam between the two agents, what is
  known about usage limits, and the access model.

Then the two plans:
- `docs/plans/260907e-agent-fleet-dashboard.md` — the dashboard, largely built.
- `docs/plans/260908b-overseer-store-and-clock.md` — the Overseer's first stage, planned.

Then the code that exists:
- `tools/fleet/` — `server.ts`, `collect.ts`, `status.ts`, `health.ts`, `steer.ts`, `pane.ts`,
  `live.ts`, `config.ts`, and `web/` (a React client). Note `steer.ts` is built but deliberately
  not routed: nothing can currently write to a session.
- `scripts/gjd-remote-tmux.ts` and `scripts/gjd-remote.ts` — the existing box tooling that owns
  session inventory, launching and killing. The Overseer is meant to reuse it, not fork it.

Useful background, as needed:
- `docs/project/hetzner-remote-server-box.md` — the box.
- `docs/project/security-map.md` — how this project thinks about untrusted parties.
- `docs/reusable/engineering-manager.md` — how work is run here.
- `AGENTS.md` (symlinked as `CLAUDE.md`) — the working agreements every agent on the box follows.

## The current direction, in brief

- The Overseer is a **daemon** that owns a clock, a durable store and its own restart; a Claude
  session is an *action* it takes when judgement is needed, not a persistent brain. Rationale: it
  must keep working when the Max subscriptions are exhausted, and a transcript does not survive a
  reboot.
- **The dashboard is the only collector**; the Overseer consumes its HTTP/SSE API. A collection costs
  ~12s of transcript grepping, so a second one is a real cost.
- **Store:** append-only JSONL of *events* (not samples) outside the repo, in `~/.overseer/`.
- **Access control is reachability** — Tailscale and an SSH forward, no login page, no auth code.
  Greg has said authentication is "PERHAPS NEVER" needed.
- **Autonomy today:** the Overseer may dispatch scheduled jobs unattended, and nothing else.
  Steering a live session or killing anything still needs a human.
- **Delivery to a session is `tmux send-keys`** — the only channel proven to work. The Claude inbox
  socket was tried and does not deliver; that claim was retracted after a false positive.
- Planned later stages: attention triage, reboot recovery, usage-limit visibility, a job scheduler,
  a decision log, and eventually creating and killing agents.

## What we want from you

Anything you think matters. The list below is a prompt, not a boundary — **add categories we did not
think to name.**

- **Security.** The honest position is that anything reaching the dashboard can run code on the box,
  and the mitigation is that nothing can reach it. Is that defensible as the fleet grows, as write
  actions land, and as it moves to a phone? What is the cheapest thing that would materially reduce
  the blast radius without becoming a login page Greg does not want? Note a real asymmetry: the
  *readers* of this page are one person, but the *content* rendered on it — session titles, pending
  questions, transcript excerpts — is written by autonomous agents processing untrusted input.
- **Agent capability, and what the Overseer should be able to do.** What actions are worth giving it,
  in what order? Which should stay behind a human confirmation permanently, and which are safe to
  automate sooner than we think? What are we likely to regret automating?
- **What to signal to the user, and how.** With ~36 agents and one person, attention is the scarce
  resource. What should reach a phone at 2am, what should wait, and what should never interrupt? Is
  ranked-list-plus-push the right shape, or is there a better one?
- **Robustness.** Where will this break in ways that look like working? This project has a repeated
  failure class it calls "silent success" — a mechanism that reports success while doing nothing,
  with the obvious check agreeing because it shares an assumption with the code. Where is the next
  one here?
- **Storage.** Is JSONL-of-events right, or will it be regretted? What should be recorded that we
  have not thought to record — and what are we planning to record that is not worth it?
- **How agents communicate.** Today: `tmux send-keys` for delivery, files on disk, and a shared git
  tree they all commit to. There is no agent-to-agent protocol. Is one worth having, and if so what
  is the smallest version that pays for itself? (A third-party system Greg saw uses a fixed line
  vocabulary — READY / LAND / BLOCKED / GATE — in JSONL files, so shell watchers can react without a
  model. That is described in the appendix of the dashboard plan.)
- **UI.** What should a fleet view show that ours does not? What is the phone view for, specifically,
  as distinct from the desktop one?
- **Scale and cost.** Multiple Max subscriptions is medium-term; multiple boxes is "someday maybe".
  What should be designed now so those are not rewrites, and — more usefully — what should we
  deliberately *not* design for yet?
- **Sequencing.** Given ease and value, what should be built next, and what on our list should be
  dropped or deferred? **Naming something as not worth building is as useful as proposing something.**

## How to answer

- **Give every item an ID** (`A1`, `A2`, …), and tag each with **value** (high/medium/low) and
  **effort** (small/medium/large) as you see them. We will prioritise on the combination, so an item
  without those is harder to act on.
- **Separate "you have a bug in your thinking" from "here is something else you could do".** Both
  are wanted; conflating them makes the list hard to sequence.
- Say plainly when something we have decided is **wrong**, not merely improvable — including the big
  ones: the daemon-not-a-session choice, reachability-as-access-control, one-collector, JSONL, and
  the decision to build this at all rather than use an existing tool.
- Where you are speculating rather than reasoning from what you read, say so.
- **Do not change any file.** This is a read-only review.

## Constraints that are not up for review

Not because they are right in general, but because they are settled here and re-litigating them
wastes the review:

- One box, one person, no team. No multi-tenancy, no user accounts, no RBAC.
- TypeScript, ESM, `tsx` to run. Nothing new in `package.json` without a strong reason; there is no
  HTTP framework and `node:http` is deliberate.
- It must not depend on the product's database or anything under `src/`.
- It reuses `gjd-remote` for session inventory, launching and killing rather than growing a second
  way to do those.
- Greg does not want a login page, and does not want a VPN client to be the *only* route.
