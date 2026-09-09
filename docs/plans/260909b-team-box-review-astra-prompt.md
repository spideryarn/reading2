# Design review: one big box for a whole team, and what that does to the Overseer

**This is not a code review.** It is a request for judgement on a direction before anything is
built. Nothing here is decided. We want the shape of the answer, the trade-offs, the questions we
should be asking the owner, and anything better that we have not thought of.

Greg (the owner) asked in these words, 2026-09-09:

> I'm contemplating renting a much bigger remote box, and making it available to my whole team.
> Perhaps we'd all share the same Overseer? There might be multiple Claude accounts. Perhaps each
> person would have the Tailscale setup to authorise their access, but would we still need some
> authentication mechanism (ideally Google SSO, but really easy to setup)? Or just ask them to input
> their email address and trust them? Would we restrict it so that any accounts they set up use only
> their Claude account-subscriptions? Can they view/edit other agents that other people set up? I'm
> leaning yes. Or maybe they can only affect things via the Overseer? Shared Overseer or one per
> person? Any other questions?
>
> In an ideal world/long-term, maybe each person has their own box, but somehow the
> agents/boxes/overseers communicate/coordinate with one another. That seems tricky, so I'm leaning
> towards just putting everyone on one box. Downsides/tradeoffs, or any even better solution?

## The situation today

One Hetzner box (16 cores, 30 GB RAM) runs 20–35 Claude Code sessions in tmux, one per session,
across ~15 git worktrees of one repo (`spideryarn2`, a real product with paying readers). Codex batch
jobs and bare shells run beside them. **Everything runs as one Unix user, `greg`, with passwordless
sudo.** The box is reached over ssh and over a two-device Tailscale tailnet (the box and Greg's
phone). A fleet dashboard (`tools/fleet/`, a Node server plus a React page) binds loopback and is
reached by ssh forward; it can steer any session by typing into its tmux pane, launch sessions, kill
them, remove worktrees, and broadcast to the fleet. It has **no authentication**: the standing
argument is that anyone who can reach it already owns the box (the direction doc calls this A7).

An **Overseer** (a long-running Claude session plus a daemon, `tools/overseer/`) keeps the fleet
moving: rations the shared Claude subscription's usage windows, closes out finished agents, pulls
work from a queue Greg authorises, and logs every decision it takes on his behalf. Its runbook is
`docs/project/overseer.md`; its four gates are the whole of what it may decide. The reasoning is
`docs/project/overseer-direction.md`.

**Accounts**: as of today every session bills one Claude Max subscription (Greg's). A plan in flight
(`docs/plans/260909g-…`) adds several Claude accounts on the box, a registry, and a launcher that
picks one per session (`--account auto`); usage is read per account. Codex runs bill one ChatGPT
subscription; Greg says the work cannot continue without both families, so both are rationed.

**The team**: a handful of people (assume three to six), all trusted colleagues on one product, not
strangers. Some may be less comfortable in a terminal than Greg. Each would probably bring their own
Claude (and maybe ChatGPT) subscription.

## What to read

Repository at `/home/greg/code/spideryarn2`, revision `51e3df60`. Read only; change nothing; run
nothing that starts a session or speaks to another session.

Start with:

- `docs/project/overseer.md` — the runbook, especially the four gates.
- `docs/project/overseer-direction.md` — § The horizon (what Greg tagged NOW/SOON/PERHAPS NEVER —
  note "PERHAPS NEVER: no authentication needed" and "SOMEDAY MAYBE: multiple boxes"), § Access,
  § The backlog (A5, A7, A12), and § Appendix: security and hardening, deferred. You reviewed this
  system on 2026-09-08 as `docs/plans/260908b-whole-approach-review-astra-v2.md`; A5 and A7 are the
  rows this question reopens, so say plainly what changes when the "one user, all devices Greg's"
  premise those rows relied on stops being true.
- `docs/plans/260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md`
  — the accounts mechanism being built (per-account config dirs with a shared `projects/`).
- `docs/project/hetzner-remote-server-box.md` — § The shape, § Tailscale, § Known holes.
- `docs/project/version-control.md` § What protects `main` — nothing mechanical does; any pane can
  deploy to production.
- `docs/project/worktrees.md` and the "Working in a tree several agents share" section of
  `AGENTS.md` — the collaboration rules agents already live under.
- `tools/fleet/server.ts`, `tools/fleet/routes-steer.ts`, `tools/fleet/routes-new.ts`,
  `tools/fleet/actions.ts` — the write surface, to judge what "authentication" would actually gate.
- `scripts/gjd-remote.ts` — how sessions are launched, named, and claimed (`--help` text near the
  top is enough).

## What we want back

Write for Greg, who will read your answer directly. Plain words, jargon explained once. He has said
that a bare "A, B or C?" with one-line labels is a question he cannot answer; each option needs an
example of what it looks like in use, what it costs and what it gives up.

1. **One box or one box each?** Argue both, then recommend. Include the middle options (one box now
   with a design that does not preclude several; one box per person with a shared queue; etc.). Be
   concrete about what "boxes coordinate" would actually have to mean here and what is genuinely
   tricky about it versus merely unfamiliar.

2. **Identity and authentication on a shared box.** Given everyone shares one Unix user today: is a
   login page (Google SSO, Tailscale identity headers, a typed email) worth anything, and for which
   of the surfaces — ssh, the dashboard reads, the dashboard writes, session launch, `git push`?
   Say which of these is a *boundary* and which is only *attribution* (knowing who did it), because
   the direction doc has already established that a token stored under the shared user is not a
   boundary. If separate Unix users per person is the honest answer, say what it breaks (the shared
   `~/.claude/projects/` memory and transcripts, the shared worktrees, `gjd-remote ls` reading every
   session, the Overseer typing into anyone's pane) and whether that is worth it.

3. **Accounts.** Should a person's sessions be pinned to their own subscription? What is the
   cheapest thing that makes "whose subscription is this session spending" true rather than hoped,
   given the registry in 260909g. What about Codex/ChatGPT accounts.

4. **Who may touch whose agents.** Greg leans towards everyone seeing and steering everyone's
   sessions. The alternative is "only via the Overseer". Is there a third shape (see-all,
   steer-own, ask-the-Overseer-for-the-rest; or a claim/ownership column that is attribution only)?
   What does the Overseer's gate 1 ("never hide who decided") need once there are several people
   who can decide?

5. **Shared Overseer or one per person.** The runbook says there is one Overseer per box and its
   budget is global. With several people and several subscriptions, what does it ration, whose queue
   does it pull from, whose product defaults does it take, and who reviews its decision log in the
   morning? If one Overseer, how does it keep people's intents separate; if one each, what do they
   share?

6. **The questions Greg should be asked**, especially about intent: what the team is for, what they
   would do on the box, how much they would share (one repo? several? one product?), how much
   isolation he actually wants versus how much he is assuming he needs, what he wants to happen when
   one person's agents starve another's. Rank them: the ones whose answer would most change the
   design first.

7. **Anything better** we have not listed. And the smallest version of this worth building first —
   the one that finds out whether a shared box actually helps the team before anything is hardened.

Keep it to what changes the decision. Value and effort per recommendation, as before. Say what you
did not verify.
