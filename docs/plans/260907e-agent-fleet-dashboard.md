# Agent fleet dashboard

**Status as of 2026-09-07: designed, nothing built.** No code, no domain bought, no `cloudflared`
installed — evidence: `ls tools/` returns nothing, `which cloudflared` is empty. The three
mechanism tests in [Evidence](#evidence-what-was-actually-tested) were run and passed; everything
else here is a proposal.

## Goal

One web page, readable from Greg's phone from anywhere, showing every coding agent running on the
box — across harnesses and across repos — and letting him send a message to any one of them.

> I would like to create a web page that shows me all of the currently running Claude agents. And
> this needs to be externally visible on the internet somehow. Could be by IP address. And so we'll
> need some kind of authentication and security. Probably a TypeScript webserver with nice CLI
> interface.
>
> One approach would be to actually host it on spideryarn.com in the /admin section. But I might
> prefer it to be reusable (i.e. across repos/projects), so maybe it makes more sense to host it on
> this box.
>
> — Greg, 2026-09-07

> I definitely want to be able to see this on my phone, and to communicate 2-way with the agents.
> Cloudflare Tunnel sounds promising, or anything else that will make authentication
> straightforward and something that you can mostly do for me. I'd like to avoid the hassle of a
> VPN, though I'd consider it.
>
> — Greg, 2026-09-07

> I'd rather not make this Claude-specific, and I think the Claude Code UI is weak, and we want to
> extend/improve on what's possible by building our own custom UI.
>
> — Greg, 2026-09-07

Scope chosen by Greg on 2026-09-07, from three options offered: **dashboard + nudge** — see the
fleet, message one agent, get pushed at when one is blocked. Explicitly *not* orchestration (a
coordinator directing worker agents); see [Alternatives](#alternatives-considered-and-rejected).

Greg then added **recurring nudges** ("every 3h, do X") — Stage F. That is a message on a timer down
the same path, so it stays inside the chosen scope; it does *not* reopen orchestration. But it is the
first thing here that acts without a human present, and Stage F says why the target, not the timer,
is the hard part.

## Context

The box runs ~20 Claude Code sessions in tmux, one tmux session each, across ~15 worktrees of this
repo plus `hellozenno`, plus Codex runs via `scripts/run-codex.ts` and bare shells via
`scripts/tmux-job.ts`. `gjd-remote ls` prints this today but takes **10–12 seconds** every time,
and only from a terminal.

Greg supplied a description of a third party's equivalent system ("the landing board") on
2026-09-07 — reproduced in the [Appendix](#appendix-the-reference-architecture). Much of this plan
is a deliberate response to it, and the three places we diverge are called out below.

## References

- [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) — the box, the tmux-per-session
  model, and `gjd-remote`, whose data layer this reuses in places.
- [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) — `Session`, `SessionState`,
  `buildSessionScript()`, `parseSessions()`. The `Session.id` doc comment is the argument for
  addressing by tmux handle rather than name; we are keeping that rule.
- [`scripts/gjd-remote.ts:2550`](../../scripts/gjd-remote.ts) — where `new-claude` builds the
  `claude --session-id …` command. The place a `--remote-control` flag would go, if we ever want it.
- [`.claude/hooks/primary-checkout-notice.sh`](../../.claude/hooks/primary-checkout-notice.sh) and
  `.claude/settings.json` — the existing `SessionStart` hook, the shape the token-registry hook copies.
- [security-map.md](../project/security-map.md) — the untrusted parties. This adds a new one: anything
  that can reach the dashboard can run code on the box.
- [`infra/hetzner/main.tf`](../../infra/hetzner/main.tf) lines 59–96 — the cloud firewall, SSH/mosh/ICMP
  only, and the comment explaining why there is no web rule. **This plan does not change it.**
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — followed for the
  stack choice; the answer was "add nothing", see below.
- [logging.md](../project/logging.md) — a server in a request path logs through `src/log.ts`, never
  `console.log`.

## Principles and key decisions

**Nothing new in `package.json`.** Plain `node:http` and one hand-written HTML page. The repo has no
HTTP framework today; adding Express would be the first, and
[vision.md § Principles](../project/vision.md#principles) says check before adding a third exception
to "prefer boring". The CLI half reuses the colour and column helpers already in `gjd-remote`.
Sonnet's library research recommended Express 5 on pretraining-data grounds and named `node:http` as
legitimate at this size; we are taking the smaller option.

**`claude agents --json` is the data source, not `gjd-remote ls`.** It returns all 18–20 sessions in
**~1 second**, spans repos, and is first-party. `gjd-remote ls` takes 10–12s because it greps whole
multi-MB transcripts for `aiTitle`. We steal only the title trick from it, and read the tail of the
transcript rather than the whole file.

**One adapter per harness, one common record.** This is what makes it not-Claude-specific, and it is
the seam every other decision hangs off:

```ts
type AgentSession = {
  key: string;            // stable, machine-scoped; never the display name
  harness: "claude" | "codex" | "shell";
  machine: string;
  address: { tmuxPane: string | null; pid: number };
  repo: string | null;    // derived from cwd
  worktree: string | null;
  status: "working" | "idle" | "needs-you" | "unknown";
  title: string | null;
  startedAt: number;
  lastActivityAt: number;
  canMessage: false | { via: "socket" } | { via: "keys"; degraded: true };
};
```

**Address by tmux pane handle and pid, never by display name.** Names get reassigned when a session
dies and another takes it. `gjd-remote` learned this the hard way (see the `Session.id` comment) and
so did the reference system ("two windows sent gate requests to a stale name for an hour"). Two
independent systems converging is the strongest evidence available.

**Use the supported message channel where one exists; degrade loudly where it does not.** Claude Code
publishes an inbox socket protocol. Tested and working (below). Codex and shells get `tmux send-keys`,
and the record says `degraded: true` so the UI can show it differently. The reference system types at
*everything*, and pays for it — its own description mentions handling "the second-Enter quirk and
Codex's type-ahead queue".

**Access: Cloudflare Tunnel + Access on a throwaway domain.** Greg would rather not run a VPN client,
which rules out the reference system's "the tailnet is the password". Same essential property —
the server binds loopback, nothing is ever public, identity is established outside our code.

**Verify the Access JWT. Never trust the email header alone.** This is the one *new* failure mode we
take on relative to the reference design, and it must be in from the first commit. A tailnet IP is
unforgeable at the network layer; an HTTP header is not. If the origin were ever reachable directly,
a forged `Cf-Access-Authenticated-User-Email` would be a complete bypass of a dashboard that can run
code. So: bind `127.0.0.1` only, and verify `Cf-Access-Jwt-Assertion` against Cloudflare's public
keys on every request, including the JSON ones.

**No inbound firewall change.** `cloudflared` is outbound-only. `infra/hetzner/main.tf` stays as it is,
and its "no inbound rule for the web server on purpose" comment stays true.

**Deploy from git, and put the commit SHA on the page.** The reference system's own handover notes
that its served board has drifted from its repo. A `/api/version` endpoint and a one-command deploy
cost nothing and make that class of bug impossible to miss.

**The simpler options passed over.** Three of them, and each has a real case:

- *Nothing at all — use Remote Control.* Most box sessions already have it on (11 of 19 had a
  non-null `bridgeSessionId` on 2026-09-07), so Claude sessions are probably already reachable from
  the Claude phone app. Rejected because it is Claude-only and one-session-at-a-time, and Greg's
  stated reason for building is that he wants the fleet view and a better UI than that.
- *Push notifications only, no page.* `agentPushNotifEnabled` is already `true`. Cheapest thing here
  and genuinely answers "does anyone need me". **Not rejected — folded in as Stage E**, because it
  is complementary and small.
- *A route in the spideryarn.com `/admin` section.* Rejected: the data is box-local, so `/admin`
  would need Vercel reaching into Hetzner or the box pushing to Supabase — a new cross-machine seam
  and a path from a public product into agent sockets. Fable and GPT Sol rejected it independently.

## Stages

Ordered so the value lands early: after Stage B there is a useful page, and everything after that
is improvement.

### Stage A: the collector, and its tests

- [ ] Pull latest `origin/dev` first. Work in a worktree, not the primary checkout.
- [ ] Write tests first, against captured fixtures, before any collector code:
  - [ ] `claude agents --json` output parses into `AgentSession[]` — including the `waiting` +
        `waitingFor: "input needed"` case, which is what "needs you" means.
  - [ ] A cwd inside `.claude/worktrees/<name>` resolves to the right repo *and* worktree.
  - [ ] A malformed/truncated JSON line fails the whole listing rather than silently returning a
        short list — the rule `gjd-remote`'s `parseSessions` already holds, and for the same reason:
        a caller handed a partial list reasons from its absences.
  - [ ] A session with no `aiTitle` yet renders as a title-less row, not a crash.
- [ ] Build the Claude adapter: `claude agents --json` + `aiTitle` from the **tail** of the
      transcript, not a whole-file grep.
- [ ] Build the shell/Codex adapter from tmux state only.
- [ ] `npm test` and `npm run typecheck` green.

### Stage B: the page and the CLI, on loopback only

- [ ] `node:http` server binding `127.0.0.1`. Routes: `/` (HTML), `/api/agents`, `/api/version`.
- [ ] One HTML page, polling `/api/agents`. Phone-shaped first — this is the primary target, not an
      afterthought. Counts at the top ("2 need you · 7 idle · 9 working"), rows below, sorted so
      blocked agents are at the top.
- [ ] The CLI: same collector, table to stdout, plus `--json`. Reuse `gjd-remote`'s colour helpers.
- [ ] Verify over an SSH tunnel from Greg's Mac before anything is exposed. **Stop and review with
      Greg here** — this is the last cheap moment to change the design.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` on touched files.
- [ ] Commit. GPT Sol review of the code, per AGENTS.md.

### Stage C: the message channel

- [ ] **Risk-first spike, before anything else in this stage**: a `SessionStart` hook writes
      `{sessionId, socketPath, token}` to a 0600 file; a separate process reads it and delivers a
      message to a *different* session. The single-session half is already proven (see Evidence);
      what is unproven is that the hook sees the same values and that a third party can use them.
      **If this fails, stop and tell Greg** — the fallback is `tmux send-keys` for everything, which
      is what the reference system does, and that is a materially worse product.
- [ ] The hook goes in `~/.claude/settings.json`, not the repo's, so it covers `hellozenno` and any
      other checkout. That is a machine-level change — per AGENTS.md, ask Greg whether to make it
      now, going forwards, or both, and get it into whatever file builds the next box.
- [ ] Tests: a message to an unknown key is rejected; a stale registry entry (session died, pid
      reused) is detected and refused rather than delivered to the wrong session.
- [ ] `POST /api/agents/:key/message`, JWT-verified, rate-limited, and logged through `src/log.ts` —
      never the message text, per logging.md.
- [ ] Codex/shell fallback via `tmux send-keys`, surfaced in the UI as degraded.
- [ ] `npm test`, `npm run typecheck`. Commit. GPT Sol review.

### Stage D: exposure

- [ ] **Greg's actions**, and only these three: buy a throwaway domain at Cloudflare Registrar
      (~$10/yr `.com`; *not* `spideryarn.com` — its nameservers stay at Namecheap); click authorize
      once for `cloudflared login`; pick the SSO provider in the Zero Trust dashboard.
- [ ] Everything else scripted: install `cloudflared`, create the named tunnel, write
      `/etc/cloudflared/config.yml` pointing at `127.0.0.1:<port>`, install and enable the systemd
      service.
- [ ] Access policy: Greg's identity only. Session duration set to the one-month maximum so the
      phone does not re-auth constantly.
- [ ] JWT verification against Cloudflare's JWKS, with a test that a **request carrying a forged
      email header and no valid JWT is refused**. This test must be seen to fail against a
      header-trusting implementation before it is allowed to pass — a check never seen red proves
      nothing ([silent-success.md](../reusable/silent-success.md)).
- [ ] Confirm from the phone, on cellular with wifi off.
- [ ] Separately, and not blocking: turn on `ufw` as defence in depth. The Hetzner cloud firewall is
      the real gate, but the reference box runs both.

### Stage E: the nudge

- [ ] A timer that diffs the "needs you" set and pushes one line per newly-blocked agent.
- [ ] Check first whether Claude Code's own `agentPushNotifEnabled` already covers this well enough
      for Claude sessions — if it does, this stage is only for Codex and shells, and shrinks a lot.

### Stage F: scheduled nudges

Added at Greg's request, 2026-09-07:

> One other thing. We'll want a way to give the orchestrator a nudge on a regular schedule (e.g.
> every 3h, do X).
>
> — Greg, 2026-09-07

Depends on Stage C — a scheduled nudge is just a message on a timer, down the same path, so it
should add almost no new mechanism.

- [ ] A schedule is a small record: target agent key, cron-ish interval, message text, enabled flag,
      `lastFiredAt`. Stored as a file next to the token registry, not in Postgres — this daemon must
      not depend on the Spideryarn database.
- [ ] Fire through the **same** `POST /api/agents/:key/message` code path as a manual nudge, so
      there is one delivery mechanism and one set of failure modes, not two.
- [ ] **The hard part is the target, not the timer.** An agent key is machine-scoped and a session
      dies; a schedule pointing at a dead session must not deliver to whatever took its pid or pane.
      Decide explicitly what a schedule targets: a *session* (and goes dormant when it dies), or a
      *worktree/repo* (and finds the current session there, or starts one). Ask Greg — these are
      materially different products and the second is much larger.
- [ ] Show the schedules on the page, with when each last fired and what happened. A schedule you
      cannot see is the failure mode below.
- [ ] Tests: a schedule whose target is gone is skipped and marked, not delivered elsewhere; a
      daemon restart does not re-fire something that already fired; two overlapping ticks deliver once.
- [ ] `npm test`, `npm run typecheck`. Commit. Cross-family review.

**A note on what this quietly becomes.** [cron-scheduler.md](../project/cron-scheduler.md) opens
with "**There is no scheduler.** Nothing in this app runs on a clock", and documents two sweepers
written against a runner that does not exist — correct code with no caller, which the next reader
believes is running. This daemon would be the first always-on scheduled runner on the box, and the
temptation to hang `sweepAbandonedDrafts` and friends off it will be immediate. **Resist it in this
project.** This scheduler nudges agents; it is not a general job runner for Spideryarn, and wiring
product cleanup into an ops dashboard would couple them in exactly the way we rejected `/admin` for.
If a real scheduler is wanted, that is its own decision — worth telling Greg the option now exists,
and letting him make it separately.

### Stage G: write it down

- [ ] A new evergreen doc under `docs/project/`. **Ask Greg** where it hangs — it is arguably under
      `dev-and-deployment-overview.md` next to `hetzner-remote-server-box.md`, but it is also the
      first thing here that is not about Spideryarn at all.
- [ ] A note in `docs/reusable/` if the thing turns out to be genuinely portable.
- [ ] Test consolidation sweep via subagent: fold brittle low-level tests into fewer end-to-end ones.

## Evidence: what was actually tested

Run on the box, 2026-09-07, before this plan was written.

- **`claude agents --json` works and is fast.** 18 sessions, ~1s, spanning `spideryarn2` and
  `hellozenno`, with `status` values `busy`/`idle`/`waiting` and `waitingFor: "input needed"`.
- **`gjd-remote ls` takes 10–12s**, measured three times (12.5s, 11.2s, 10.2s).
- **~~The Claude inbox socket protocol works from an external process.~~ RETRACTED, 2026-09-07.**
  The first version of this line claimed a successful delivery. **It was wrong, and the way it was
  wrong is the point.** A Node script wrote `{"type":"auth","token":…}` and
  `{"type":"message","message":…}` to `$CLAUDE_CODE_MESSAGING_SOCKET`, the socket accepted the
  connection, no error was returned — and the transcript then matched the test string. The match was
  **my own tool-call command text**, echoed into the transcript, not a delivered message.
  Textbook [silent-success.md](../reusable/silent-success.md): the write cannot fail, and the check
  shared an assumption with the thing it was checking.
  Settled by two controls: a **nonce generated inside the script and written only to a file** (so it
  can never appear in a typed command) returned **0** transcript hits; and a separate idle target
  session, sent three frames, displayed nothing at all.
- **All three auth variants behaved identically — correct token, wrong token, and no auth line at
  all — none errored, none delivered.** So the socket write is not a channel we have working, and
  "no error" carries no information about it.
- **The `SessionStart` hook capture half does work.** A hook launched via `claude --settings <file>`
  wrote its session's `{socket, token, pid}` to a file. So the capture is fine; it is the *delivery*
  that is unproven.
- **The token is not readable from another session's process.** `/proc/<pid>/environ` is readable
  (same user) but does not contain `CLAUDE_CODE_MESSAGING_TOKEN` — it is minted after exec and
  exported only to children.
- **`tmux send-keys` demonstrably answers a modal dialog.** `Down` then `Enter` selected "Yes, I
  trust this folder" on a real trust prompt. **This is currently the only message mechanism proven
  to work here**, which inverts the plan's original preference and vindicates the reference
  system's choice.
- **"Needs you" is usually a numbered modal dialog**, not a text prompt — captured live from a
  blocked session showing a 4-option `/loop` scheduling menu. So the valuable phone action is
  *answering a question*, which a message cannot do.
- **Remote Control is already on for most sessions.** 11 of 19 had a non-null `bridgeSessionId`
  with no flag passed; `claude --remote-control <name>` sets it explicitly (tested with a throwaway
  session, since killed).
- **The Hetzner cloud firewall allows SSH, mosh and ICMP only.** Read from `infra/hetzner/main.tf`.
  Not verified against live Hetzner state — the box has no `hcloud` CLI and no Hetzner token by
  design. **Greg should confirm with `hcloud firewall list` from the Mac.**
- **`spideryarn.com` uses Namecheap nameservers** (`dns1.registrar-servers.com`), serving Vercel at
  `76.76.21.21`. Cloudflare's partial/CNAME zone setup is Business-plan-only ($200/mo), per
  [Cloudflare's own docs](https://developers.cloudflare.com/dns/zone-setups/partial-setup/) — hence
  a separate domain, and no nameserver change to the production site.

## Alternatives considered and rejected

**Full orchestration, as in the reference system.** A coordinator directing worker panes with a
GATE/LAND/BLOCKED vocabulary and a landing queue. Offered to Greg on 2026-09-07 and declined in
favour of dashboard-plus-nudge. Worth noting that in the reference system the board is a *byproduct*
of the orchestrator — taking the board alone is roughly a week; the orchestrator is a different
project, and is the least-finished part of theirs (cross-box is "planned Stage 4").

**Tailscale, with the tailnet as the access control.** What the reference system does, and it has the
smallest blast radius of any option — no public listener at all, and `tailscale whois` gives you the
viewer's identity for free. Rejected only because it needs a VPN client on the phone, which Greg
would rather avoid. If Cloudflare Access proves annoying, this is the fallback, and the server code
does not change: only the thing in front of it does.

**A passkey login on a public HTTPS server** (Caddy + sslip.io + `@simplewebauthn`). Rejected: it
exposes the box's real IP and puts hand-rolled session code directly in front of something that can
execute commands. Largest blast radius of the credible options.

**Tailscale Funnel, and TryCloudflare quick tunnels.** Excluded outright — both are unauthenticated
by default, which is disqualifying for a surface that can type into agent sessions.

**Reverse-engineering the inbox socket for external clients, or reading tokens out of process
memory.** Rejected. The hook route gets the same capability using documented interfaces.

## Appendix: the reference architecture

Greg supplied a description on 2026-09-07 of a third party's system — a Hetzner box hardened to
SSH-only, with a Node "landing board" on port 8787 bound exclusively to the machine's Tailscale IPv4,
refusing to start without one. No password: "reachability is the access control". `tailscale whois`
on each peer IP identifies the viewer; POST endpoints 403 unless the viewer's login is in
`owner-logins.txt`. Agent-to-agent coordination is three primitives — JSONL files on disk, tmux
keystroke injection, and the local HTTP API — with a fixed line vocabulary (READY / LAND / LANDED /
BLOCKED / GATE / FEED: / STUCK) so shell watchers can react without an LLM. Authentication is by
pane, not identity. Cross-box is metadata-only snapshots over an SSH forced-command responder, and is
only partly built.

What we take from it: the private-interface-instead-of-a-login-page principle; identity from the
transport layer; the read/write split; addressing by pane; secrets as presence rather than content;
and outbound notification.

What we change: the message channel (supported socket, not keystrokes, for Claude); the access layer
(Cloudflare Access, not a VPN — with JWT verification to replace the network-layer guarantee we give
up); and deploying from git with a visible commit SHA, since their own handover reports the served
board has drifted from its repo.
