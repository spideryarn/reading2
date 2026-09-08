# Agent fleet dashboard

**Status as of 2026-09-08 09:15: important work left — one restart that is Greg's, and one queue
that nothing drains.**

Two things, in order of how much they cost:

1. **Nothing drains the action queue** —
   [Stage v0.5f](#-stage-v05f-nothing-drains-the-queue-the-one-thing-that-is-worse-than-not-built).
   The routes, the client and the queue are all built and tested; no production code path ever calls
   `queue.next()`. A queued action waits thirty minutes and is dropped. A button that says *queued*
   and means *never* is worse than no button.
2. **The live server predates the code** — see the section below. Restarting it is Greg's.

Everything else below is real but optional.

Serving on `127.0.0.1:8787` and on the tailnet at `100.92.255.119:8787`, under
`scripts/tmux-job.ts` so it survives memory pressure. ~24 sessions with status, the pending question
for blocked ones, Box Health, a master–detail Sessions view with steering, rename, and the action
vocabulary. Evidence: **1006 tests pass** across the fleet, overseer and worktree suites; all four
typecheck projects are clean; a browser check at 390px reports one expected console error, no
horizontal overflow, and the dialog card rendering its refusal rather than a button.

**Verified end to end, not at the call site.** A message sent from the client's own body-builder,
through the real server, arrives in the target pane and nowhere else — nonce generated inside the
script and written only to a file. Starting a session through `POST /api/sessions/new` produces a
real Claude that answers. A rename held through a real `gjd-remote ls` that renamed two *other*
sessions in the same run.

**Answering a dialog is back on, narrowed rather than blanket-off** — see
[Stage v0.2e](#-stage-v02e-what-answering-a-dialog-does-decides-whether-it-may-be-answered-landed-2026-09-08).
What answering *does* now decides whether it may be answered, and `unknown` is refused with
`permission`.

**One thing is still switched off:** enacted actions need `FLEET_ACT_ENABLED=1`. The catalogue, the
queues and the dry runs are live; removing a worktree and killing a session are not. That default is
right until Greg has looked at what the buttons say they will do.

**Read Stage v0.4d first.** Fable read all 38 live panes and broke this plan's premise: the sessions actually waiting
on Greg are hiding under `idle`, and the dialog-answering this write path was built for is a
rounding error. That reframing is worth more than anything below it.

Two claims in earlier versions of this plan were **retracted** — the inbox socket, and "no shell
anywhere" in the launch path. Both are in
[Evidence](#evidence-what-was-actually-tested), which records what failed as well as what worked.

## The running server is older than this code, and only Greg can restart it

The process on 8787 has been up since 04:34 and predates `routes-actions.ts` and `PaneGate`. The
client is built and live; the server is not. Two visible consequences, both correct behaviour rather
than breakage:

- `GET /api/actions` **404s**, once per ten-second poll. `useActions` keeps the last good feed and
  shows the error beside it, so the page does not break — but the action buttons, the queues and Box
  Health's controls have nothing to render from.
- Every dialog reads **"Not offered: I could not tell what this is — this server did not say what
  answering this dialog would do."** That is `parseGate` failing towards `unknown`, which is the
  designed answer for a server too old to send the field, and it means answering is currently
  offered for nothing at all.

**The fix is one restart, and it is Greg's to make** — the standing instruction here is not to
restart or kill the live server. The job runs under `scripts/tmux-job.ts`; restart it the same way it
was started, with `FLEET_BIND=127.0.0.1,100.92.255.119`. Once it is up, `curl -s localhost:8787/api/actions | head -c 200`
answering with JSON rather than a 404 is the whole check.

## Do not remove this worktree while the dashboard is running

**`npm run worktree:check` will say `fleet-dashboard-v01` is safe to delete, and it is wrong.** That
check asks whether any *uncommitted file* would be lost. It knows nothing about a *running process*
whose entrypoint, `node_modules` and served files all live under the path it is about to delete —
and the live dashboard is exactly that. Measured 2026-09-08 by the `orchestrator-setup` session:

```
421175  132280  sh -c ( env FLEET_BIND=... npx tsx tools/fleet/server.ts )
        > .../worktrees/fleet-dashboard-v01/logs/tmux-jobs/fleet-server-0434-421054.log
```

**The page dies immediately, not at the next restart.** `serveStatic` in `server.ts` calls
`readFileSync` on every request rather than reading the bundle into memory at boot, so the first
request after the files go finds nothing to serve. The Node process would go on running and
answering nothing but 404s — which is worse than being down, because the port stays open and
anything watching the port says it is up. A textbook [silent success](../reusable/silent-success.md),
arriving from the tidy-up direction rather than the build one.

So: **move the server to the primary checkout before removing this worktree**, and prove the new one
answers before the old one goes.

## Nothing here survives a reboot, and the fallback needs the page to exist

The server's ppid is `132280`, which is the tmux server itself — the same pid `collect.ts` records as
`tmuxServerPid`, because session and pane handles are only meaningful within one tmux server and
`generationDrift` exists to notice when that number changes mid-collection. Here it means something
blunter: one reboot takes the tmux server, the dashboard
and all ~36 sessions in a single stroke. There are **no systemd units on this box** —
`/etc/systemd/system/` holds only stock ones, `~/.config/systemd/user/` is empty, and
`loginctl show-user greg` reports `Linger=no`, so a *user* unit would not start at boot even if one
existed. Both facts checked 2026-09-08.

That matters more than it looks, because
[orchestrator-direction.md](../project/orchestrator-direction.md) leans on *"if the orchestrator
broke I could just ssh in and use Claude Code in the terminal"* as the reason a high robustness bar
still has a ceiling. After a reboot there is no page to fall back **from** — and, worse, nothing to
tell you the fleet is gone, because the thing that would have told you went with it. The ssh
fallback is real; it just is not automatic, and this plan should stop implying that it is.

`orchestrator-setup` is building a **system** unit (`User=greg`, `ExecStart` in the primary
checkout, installed and verified by `infra/hetzner/provision.sh`) for the Overseer, and is making it
generic so a second one can serve this dashboard. We take that offer rather than inventing a second
mechanism. **The consequence, named rather than discovered later:** running from the primary
checkout means booting whatever is on `dev` at that moment, including a red `dev` — which is
[Q12](../project/open-questions.md) arriving from a direction neither session argued from.

The standing direction is [orchestrator-direction.md](../project/orchestrator-direction.md); this
plan is one implementation of it. **Read that first** — it holds the constraints, and it outlives
this file.

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

**The scope moved on 2026-09-08, and this section is the record of it.** On 2026-09-07 Greg chose
"dashboard + nudge" over orchestration. On 2026-09-08, asked who "the orchestrator" is, he chose
**a coordinator agent** rather than himself with a mouse. So orchestration is back on the horizon —
but as a destination, not as work to start. What it changes today is only this: every steering action
is a typed function before it is a button, so a program can drive it later.

He also asked for the work to be cut into **many very thin stages**, and for v0.1 to be a read-only
list of session titles, after which I stop. Recurring nudges are deferred (the built-in `/loop`
covers reminders for now), and so is the decision log.

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

**~~`claude agents --json` is the data source.~~ CORRECTED 2026-09-08.** It is fast (~1s, cross-repo)
but **incomplete**, and the repo already knew: `sessionState` in
[`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) says *"being absent from it does not
mean not running"*, measured twice on 2026-09-01 when a live session went unlisted for 35+ seconds.
So the data source is that file's **two-source join** — the agents list for busy/idle/blocked, the
process table for what is actually running — which exists, is tested, and must not be reimplemented.
What we do take from the speed finding: `gjd-remote ls` costs 10–12s only because it greps whole
multi-MB transcripts for `aiTitle`, so read the tail instead.

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

**~~Use the supported inbox socket.~~ RETRACTED 2026-09-08 — `tmux send-keys` is the only proven
channel.** The socket claim was false (see Evidence). What actually works is a keystroke to a pane,
demonstrated by answering a real trust dialog with `Down` then `Enter`. That inverts the earlier
preference and vindicates the reference system's choice — but only for a **narrow** case: a digit or
an arrow at a dialog we can see. And it is not universal: Codex batch jobs spawn with
`fd 0 = 'ignore'` and cannot receive keystrokes at all, while a bare shell would *execute* the text.
Those must be shown as read-only, not as a degraded channel.

**Access: Tailscale, for now** (Greg, 2026-09-08). Reachability is the access control — the server
binds the tailnet interface and there is no public listener and no auth code. Chosen as scaffolding
to get something onto a phone quickly, over Cloudflare Access, which needs a throwaway domain and
several of Greg's clicks. **No inbound firewall change either way**; `infra/hetzner/main.tf` stays as
it is, and its "no inbound rule for the web server on purpose" comment stays true.

**If it ever moves to Cloudflare Access, one thing must be designed in rather than discovered:** a
tailnet IP is unforgeable at the network layer and an HTTP identity header is not. Verify the
`Cf-Access-Jwt-Assertion` JWT — issuer, this app's `aud`, algorithm, expiry, clock skew, fail closed
when JWKS is unreachable — and never trust `Cf-Access-Authenticated-User-Email` alone. Add CSRF on
mutations: an Access cookie proves whose browser it is, not that a human pressed Send. Kept here
because it is the migration's whole risk, and it is cheap to remember and expensive to retrofit.

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

**Re-sliced on 2026-09-08 at Greg's request** — "let's use engineering-manager to slice this into
many many very thin stages that we can iterate through quickly. But get to the v0.1 first and stop."
The direction these serve is [orchestrator-direction.md](../project/orchestrator-direction.md).

Each slice must be **visible in a browser** and must **not need the next one to be worth having**.
The earlier A–G staging is superseded; what it got right survives in the direction doc.

### ✅ Stage v0.1: a page listing session titles — READ ONLY (landed 2026-09-08, `ec4110de`)

Shipped and running. 37 sessions on a page, served from `tools/fleet/`, reachable over an ssh
forward (`ssh -N -L 8787:localhost:8787 greg@188.245.166.213` → `http://localhost:8787`).

- ✅ `tools/fleet/collect.ts` — calls `buildSessionScript`/`parseSessions` through `bash` rather than
  `ssh`, since we are already on the box they want to ask.
- ✅ `tools/fleet/page.ts` — pure render. **Separate from the server on purpose**: the first draft put
  `esc()` next to `server.listen()`, so importing it from a test bound port 8787 as a side effect.
  Splitting it took the test file from 19s to 4s.
- ✅ `tools/fleet/server.ts` — `node:http`, binds `127.0.0.1`, background refresh every 30s.
- ✅ 16 tests, and the escape was mutated to confirm the suite goes red without it.
- 📔 One collection costs ~12s, so the cache is load-bearing rather than an optimisation. A failed
  refresh keeps the last good snapshot and says STALE.
- ✅ `tools/` added to `tsconfig.json` — box utilities that run the way `scripts/` does and must not
  import from `src/`.

### Stage v0.1b: what it says about itself (in flight, 2026-09-08)

Greg, 2026-09-08: *"ideally i'd like to be able to hit refresh on that webpage (or even better still,
for it to hot-reload) and see things improving steadily over time."* So the slices below land one at
a time, each pushed as it goes green, rather than batched.

Running as parallel subagents against **disjoint file sets**, which is the only reason they can share
this worktree — `tools/fleet/status.ts`, `tools/fleet/pane.ts`, and `infra/hetzner/provision.sh`.
Wiring each into `server.ts`/`page.ts` is the orchestrator's job, so those two files have exactly one
writer.

- ✅ Tailscale installed, and Greg logged in 2026-09-08. `spideryarn-box`, `100.92.255.119`,
  MagicDNS `spideryarn-box.taildc3f16.ts.net`. **The ssh forward stays as the fallback that depends
  on nothing**, which is why the server binds a list of addresses rather than one.
  `tailscale serve` was NOT used: it wants an HTTPS toggle in the admin console and hung waiting for
  it. Plain HTTP over the tailnet is what the reference system does, and WireGuard already encrypts it.
- ✅ [agent-fleet-dashboard.md](../reusable/agent-fleet-dashboard.md) — the carry-elsewhere version.
- ✅ `status.ts` wired in: status per row, blocked first, tally in the header.
- ✅ `pane.ts` wired in: the pending question and its options, for blocked rows only.
- ✅ `live.ts` wired in: `/api/live` streams a `snapshot` event; `/api/state` is the same bytes for
  pollers, built by one function so the two cannot drift.
- ✅ `health.ts` built — not yet on the page; needs a `health` field in the payload.
- ✅ `steer.ts` built — deliberately **not** reachable: no route calls it yet.
- [ ] The React client, and the modes (Sessions / Box health / Orchestrator).

**📔 A hand-launched Claude session is classified as a shell.** Found on 2026-09-08 trying to fake a
blocked session for testing: `sessionState` keys off the `CLAUDE_SESSION_ID` that `gjd-remote` pins
into the tmux environment at launch, and off a process matching `claude --session-id <that uuid>`. A
session made with plain `tmux new-session` running plain `claude` has neither, so it is `shell,
busy`. Everything on this box comes from `gjd-remote`, so it costs nothing today — but a dashboard
that claims to show every agent does not, quite.

**📔 End-to-end proof came from a real blocked session, not the probe.** While trying to manufacture
one, an actual agent hit a genuine question — five options about upload policy — and the parser read
it correctly, digits and all. Worth more than the fixture it was meant to replace.

### Stage v0.1 (original scope, for the record)

The whole of it. No status, no colours, no actions, no CLI, no auth code.

- [ ] Pull latest `origin/dev`. Work in a worktree.
- [ ] `tools/fleet/collect.ts` — return `{ title, repo, worktree, startedAt }` per session. Reuse
      `buildSessionScript()` / `parseSessions()` from
      [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) rather than writing a second
      inventory; read the transcript **tail** for `aiTitle` instead of grepping whole files.
- [ ] One test, against a captured fixture: a well-formed listing parses, and a malformed one throws
      rather than returning a short list.
- [ ] `tools/fleet/server.ts` — `node:http`, binds `127.0.0.1`, two routes: `/` and `/api/agents`.
      Escape every field on the way into HTML; titles are agent-authored text.
- [ ] Tailscale: install on the box, `tailscale up` (needs Greg's browser click once), bind the
      server to the tailnet address, `tailscale serve`. **Greg installs the phone app.**
- [ ] Look at it on the phone. **Stop here.** Do not start v0.2 without Greg.
- [ ] `npm test`, `npm run typecheck`. Commit.

### ✅ Stage v0.2: send a steering message to one session (server side landed 2026-09-08, `c06438b7`)

- [x] `POST /api/steer/message` and `POST /api/steer/answer` — `tools/fleet/routes-steer.ts` over
      `tools/fleet/steer.ts`, wired into `server.ts` in one line, before `serveStatic` so no file
      that ever lands under `web/dist/` can shadow the only write path in the tool.
- [x] Delivery by `tmux send-keys` to the pane — the only channel proven to work. Text with `-l`
      (literal), then `Enter` as a separate call. **`-l` is load-bearing**: without it the string
      `"C-c"` is a keystroke name, not three characters.
- [x] **Refuses anything that is not a Claude session at a prompt.** `steerableStatus` is a
      `switch` with a `never` default, so an eighth `SessionState` arm stops it compiling rather
      than inheriting a yes. A shell is refused with "it is a shell, which would EXECUTE the
      message". Codex rows are read-only for a different reason and were never candidates —
      `subagent-cli.ts:216` spawns with `fd 0 = 'ignore'`, so they cannot receive keystrokes at all.
- [x] Addresses by pane handle **plus the conversation uuid plus the pane pid**, re-checked against
      live tmux immediately before sending, with an ancestry walk proving the Claude that answers to
      that uuid is running *under that pane*. The three ids are not interchangeable and each catches
      a different way the world moves — see the header of `steer.ts`, and the commit message.
- [x] CSRF: `Origin` must be present, non-`null`, and host-equal to `Host`; the hostname must be an
      IP literal, `localhost` or `*.ts.net` (the DNS-rebinding guard); `content-type` must be
      `application/json`, which is not a CORS-simple type, so a cross-origin `fetch` needs a
      preflight this server never answers. GETs stay side-effect-free — a GET to a steer path is 405.
- [x] Rate limited: a 1500ms floor per pane, and a whole-box ceiling of 6 in 10s, so twenty panes
      cannot each sit at their own floor. A held key on a phone repeats far faster than either.
- [ ] **The client half is not built.** No text box, no Send button, no option tap. The routes are
      reachable and proven; nothing in the UI calls them yet.

**What the CSRF check does not do, stated because it will otherwise be assumed.** It is not
authentication and cannot be: anything on the tailnet that sets its own headers — `curl`, a script,
another agent on this box — is indistinguishable from the dashboard. It stops the
browser-as-confused-deputy case only. The rest is still reachability, and reachability is now
guarding a write path into ~36 agent sessions rather than a list of titles. That trade should be
re-decided rather than inherited.

### 🔵 Stage v0.4d: the inbox is under "idle", not under "needs you" — READ THIS FIRST

**Fable's finding, 2026-09-08, and it is the most useful thing anybody said all day.** Asked for a
product judgment on whether answering dialogs from a phone is worth building, it went and read all
38 live panes instead of reasoning from the abstract, and came back with the premise broken.

**The numbers.** 38 panes: 8 batch shells, 5 `gjd-remote` sleep timers with no Claude started yet,
**25 interactive Claude sessions** — 2 `needs-you`, 7 working, 16 idle.

**1. Twenty-four of the twenty-five are in auto mode.** So a numbered permission dialog is already
answered by a classifier, not by Greg. The single session sitting on one, `fb2f-…`, is also the
single session *not* in auto mode — and its eight siblings, launched from the same batch within two
minutes, all entered it (their transcripts carry an `auto_mode` record; fb2f's does not).

> That is a launch defect, not a product gap. — Fable

And the answer Greg would give that dialog is almost certainly its option 3, *"Yes, and switch to
auto mode"* — the one that hands the session to the classifier and makes the phone irrelevant
afterwards. **So the case we built the write path for is one session in twenty-five, caused by a
bug, and the right answer to it removes the need for the button.**

**2. The real blocked-on-Greg population is hiding under `idle`.** Ten of the fifteen idle panes
Fable read end their turn by handing him a decision in prose:

> "both loosen a safety classifier, which is why they're yours" · "One decision I left for you" ·
> "F63's single paid smoke run, still yours to call" · "Say the word and I'll shut it down" ·
> "if you'd rather I land it on typecheck plus that one file, say so — otherwise I'll hold the push"

**None of these is a dialog. None of them appears on the page as needing him.** Our status
vocabulary calls them `idle`, which is the word for "nothing is happening", and the whole reason
`status.ts` exists is that we refuse to let two different facts share one word. We did it anyway,
one level up.

**3. Each one already has a proposed answer sitting in its input box** — the harness's suggested
reply, in Greg's voice, rendered dim. Fable's favourite was *"make the button floor any-pointer too
— I use a keyboard case"*: a fact about Greg that the model guessed. Ten one-line decisions, each
with a plausible and possibly-wrong answer attached, is exactly the shape a phone is good at, and
exactly the *augment rather than replace* shape this project is supposed to have.

- [ ] **`idle` splits.** A session that ended its turn with a question is `waiting for you`, and it
      belongs at the top with the blocked ones. `status.ts` is another session's file — coordinate.
- [ ] **The unit on the page becomes the question, not the session.** The direction doc already says
      this; the list does not do it yet.
- [ ] **Show the harness's suggested reply**, with "send this" and "say something else". Do not
      send it silently and do not hide that it was written by a model rather than by Greg.
- [ ] Find out why `fb2f` did not enter auto mode when its eight siblings did. **That one
      investigation removes more blocked hours than the entire write route.**

**The line Fable drew, which answers Sol's F6 better than anything I had:**

> Pane text as executable UI is acceptable when execution means "a user turn", and not acceptable
> when it means "grant a permission". A forged menu can then make Greg send the digit "2" to an
> agent that was going to misbehave anyway; it cannot mint an approval.

An `AskUserQuestion` menu — the agent's own question — is on the right side of that line, and its
material is *already fully visible* to the parser, because the option text is below the rule rather
than above it. The permission dialog is on the wrong side. **That is a much sharper rule than
"answering is off".**

**The one question only Greg can answer** (Fable's framing, and I agree it is the right one):

> Is the auto-mode classifier the fleet's permission gate, officially — every session in auto mode,
> and any session that is not is a defect?

If yes, phone dialog-answering should not exist at all. If no — if some sessions are kept in default
mode as a deliberate human gate — then those are precisely the sessions where a half-read tap at 2am
is the least trustworthy thing on the box, and the answer is still "not from the phone"; what
changes is that the launcher needs a way to say which sessions are which.

**What Fable did not verify, in its own words:** that the dim input text is a suggested-reply
feature (inferred from the SGR and the first-person voice), why `fb2f` missed auto mode, what
"/rc failed" means on 10 of 24 sessions, and whether auto mode still escalates some commands to a
prompt — which would put a small residue back into the dialog case.

**And what I checked myself afterwards, because a claim that decides a design should not rest on one
model's reading:**

- **Auto mode: confirmed, and stronger.** Counted mechanically across all 38 panes at 04:05:
  **23 of 23** interactive Claude sessions had "auto mode on" in the status bar; 15 panes were
  shells or sleep timers. Fable said 24 of 25 with one exception; by the time I counted, the
  exception was gone. Either way the conclusion holds and is not marginal.
- **Idle-hiding-an-inbox: confirmed by inspection, not by my count.** My first check grepped the
  last lines of each pane for a question mark and found **1 of 23**, which looked like a refutation.
  It was not — it was a worse instrument. Reading one pane properly showed a session whose turn
  ended *"My only recommendation is about packaging: Stage E … It's a plan doc of its own"* — a
  decision handed to Greg, ending in a full stop. **Fable read the meaning; I grepped the
  punctuation, and the punctuation was not the signal.** Its 10-of-15 is better evidence than my
  1-of-23, and the discrepancy is worth recording because it is also the *feature's* central
  difficulty: **"has this agent asked Greg something?" is a judgement, not a parse.** A regex will
  not build this stage. Something has to read the turn.
- The suggested reply in the input box is real; I saw one (`❯ make Stage E its own plan doc`). I
  could not count them reliably — the panes redraw between captures — so the "ten with a proposed
  answer attached" figure stays Fable's observation rather than a measured one.

### 🔴 Stage v0.2b: an approval must bind to what is being approved — BLOCKS v0.4

**Found by GPT Astra, 2026-09-08, by experiment rather than by reading**, and confirmed here
against `promptAbove` in `pane.ts`. It changed a proposed file's contents from `hello` to
`goodbye` in a pinned fixture and `parsePane` returned an **identical** question and options.

The cause is structural, not a slip. `promptAbove` walks back from the first option and stops at a
horizontal rule — and Claude Code puts a rule between the diff and the question. So the captured
prompt is `Do you want to create notes.md?` and the *content being written* is discarded. Then
`sameQuestion` in `steer.ts` compares prompt and option labels, both of which are unchanged, and
happily accepts an answer for a **different proposed action** than the one displayed.

Two consequences, and the second is worse than the first:

- the re-capture guard passes when the material has changed underneath it;
- **the phone can ask Greg to approve something without showing him what it is.**

- [ ] `PaneQuestion` carries the **material**: the command, the diff, the destination path, the
      permission scope — whatever is above the rule, not merely the sentence below it.
- [ ] `sameQuestion` compares the material. A capture that cannot read it is a **refusal**, not a
      question with an empty material field.
- [ ] Where the capture is incomplete, offer a handoff (`gjd-remote resume <name>`) rather than a
      button. Astra's recommendation, and the right shape: a button that cannot be honest should
      not exist.
- [ ] **"Yes once" and "yes, and don't ask again" get visibly different treatment.** One is a
      decision about this action; the other changes the session's permission posture for
      everything that follows, and they currently render as two adjacent list items.

### ✅ Stage v0.2e: what answering a dialog *does* decides whether it may be answered (landed 2026-09-08)

Answering was switched off outright while Greg slept. He pushed back on the shape of that, not on
the caution:

> Yes auto mode is the default. But mightn't there be other reasons why it needs to answer with
> multiple choice to a session etc?
>
> — Greg, 2026-09-08

He is right, and off-for-everything was the wrong answer to the wrong question. An agent's own
`AskUserQuestion` is not a permission grant, and refusing it bought nothing at all. **Fable drew the
line the code now implements:**

> Pane text as executable UI is acceptable when execution means "a user turn", and not acceptable
> when it means "grant a permission".

A forged menu can make you send a digit to an agent that was already misbehaving; it cannot mint an
approval. So the residual hazard Sol named — pane text is not provenance, and is not fixable — is
**accepted for one class of dialog and refused for the other**, which is a decision rather than a
gap.

- [x] `PaneGate` in `pane.ts`: `permission` | `conversation` | `unknown`. Three arms, not four —
      the harness's own menus (`/loop`, the model selector) are drawn by the *same widget* as
      `AskUserQuestion`, so a `configuration` arm would be a guess wearing the clothes of a fact,
      and it would change no behaviour because a caller must refuse it exactly as it refuses
      `permission`.
- [x] **`conversation` is the only arm reached by positive evidence.** The signal is the
      `AskUserQuestion` widget's `☐ <header>` on the **first non-blank line of the body** — matching
      it anywhere would flip a permission dialog whose diff happens to contain a markdown to-do.
      Everything else falls through to `unknown`, which is refused alongside `permission`: being
      unable to tell has to cost the same as knowing it is dangerous, or "I could not tell" becomes
      the way through.
- [x] Two independent permission signals in front of that, so overlap lands safe: any option
      classified `persistent` (the harness offering to widen its own gate), and first-option `once`
      + last-option `decline` read off `consequence` rather than off the words.
- [x] **Enforced in `steer.ts`, on the fresh capture, never on the request body** — a gate computed
      from what the client sent is a gate the client chooses. `routes-steer.ts` recomputes it in
      `parseQuestion` exactly as it recomputes `consequence`, so the two computations cannot
      disagree. There is a test that hands over a `seen` claiming `conversation` for a permission
      dialog and watches it refuse.
- [x] After `sameQuestion` rather than before it, and the order is about the sentence rather than
      the safety — both refuse. When the dialog has been replaced, "the pane is asking something
      else now" is true and useful; "this would grant a permission" would describe a dialog the
      person never saw.
- [x] `FLEET_ANSWER_ENABLED` inverted: **on unless it is exactly `0`**. It is a kill switch now, not
      the discrimination.
- [x] Classified correctly across the whole fixture corpus: 5 permission, 2 conversation, 3 unknown,
      13 not-a-dialog. Three new fixtures, two of them live captures of other agents' panes.

**Two things this leaves open, both named rather than closed.** The TOCTOU window — Greg taps a real
`AskUserQuestion`, it is answered from the terminal in the milliseconds after, and a permission
dialog takes its place — is not touched by classification at all; it is closed only by the
re-capture, which is why the gate must read `now`. And **the arrows branch of `keysFor` is now
unreachable in production**: every real cursor menu is a permission dialog and every real
`AskUserQuestion` is numbered. The branch stays, tested against a synthetic capture, because that is
a fact about today's widgets rather than a guarantee.

### Stage v0.2c: delivery has a third outcome, and it is "I do not know"

Astra's A11. The nonce proved the transport *can* work; it says nothing about what happened to any
later request. A phone loses connectivity after the keys land but before the response arrives; the
text arrives and the Enter fails; an identical-looking dialog recurs and the rate limiter, which
keys on time and pane, does not deduplicate it.

- [ ] An action id minted by the client, carried through, and returned.
- [ ] Five states, not two: accepted / keys submitted / reception observed / refused / **outcome
      unknown**.
- [ ] A repeat of the same action id retrieves the receipt rather than sending again.
- [ ] **Never an automatic keystroke retry** after an ambiguous failure. A retry is a second
      message, and there is no way to take the first one back.

### ✅ Stage v0.2d: the dashboard is a privileged renderer of hostile content (CSP landed 2026-09-08, `0a5a3008`; the tailnet grant is Greg's)

Astra's A6, which is explicit that it names an architectural exposure rather than claiming an
exploit exists — it calls the React text rendering a good decision. What it wants *before* answer
buttons ship:

- [ ] A restrictive `Content-Security-Policy`, and anti-framing headers. An `Origin` check does not
      stop a malicious page **framing** the real dashboard and getting somebody to click through
      it, and an XSS here would defeat the CSRF protection anyway.

And Astra's A5, which is the sharpest thing in the review: **the reference architecture in this
plan's own appendix checks the caller against an `owner-logins.txt` before any POST.** Its write
boundary was never reachability alone. We copied the half we liked.

- [ ] A device-scoped tailnet grant — the dashboard port reachable from Greg's phone and laptop
      only, not from the tailnet at large. Tailscale's default policy is permissive, so **the
      policy has to be read rather than assumed**. Keep the ssh forward.

### ✅ Stage v0.3: status (landed 2026-09-08)

- [ ] working / idle / blocked, from the two-source join in `sessionState` — never from
      `claude agents --json` alone, which is incomplete by measurement.
- [ ] Sort blocked to the top, and show the count.

### ✅ Stage v0.4: what it is blocked on — reading it, not answering it (landed 2026-09-08)

- [ ] Scrape the pending question and its numbered options from the pane.
- [ ] Tap an option → send that digit. The narrow, safe case, and the one that pays for the phone.

### ✅ Stage v0.4b: Sessions becomes master–detail (landed 2026-09-08, `44f60619`)

Greg, 2026-09-08 — quoted in full in
[orchestrator-direction.md](../project/orchestrator-direction.md#what-greg-asked-for-on-2026-09-08-in-his-own-words).

- [ ] Left column: every session, with orderings — how long it has been running, **status
      (default)**, and whatever else earns its place.
- [ ] Right column on click: what input it needs, the recent messages, and more than the list can
      hold. Steer and answer from here.
- [ ] **The client must send `row.question` back byte-identical**, never rebuilt from parsed
      fields. It is a stale-but-honest claim the server checks against live tmux; a client that
      reconstructs it defeats every guard, and a client that *parses* it silently drops any field
      the server adds later — which is exactly how v0.2b's material would go missing.
- [ ] Narrow windows collapse to one column and the detail is a push, not a squeeze —
      [narrow-windows.md](../project/narrow-windows.md).

### ✅ Stage v0.4c: recent messages (landed 2026-09-08, `ec05379c`)

The detail pane's "recent messages" needs a source. Transcripts are on disk and are tens of
megabytes; `gjd-remote ls` greps whole ones and costs 10–12s, which is the thing this tool exists
not to do.

- [ ] Read the **tail** of a session's transcript, not the whole thing, and only for the one
      session being looked at.
- [ ] `~/.claude/projects/<slug>/` is a **slugified cwd and is lossy** — resolve the path from
      `row.meta.dir` plus `row.claudeSessionId`, and say plainly when it cannot be found rather
      than showing an empty conversation.

### 🔴 Stage v0.5f: NOTHING DRAINS THE QUEUE — the one thing that is worse than not built

**The queue accepts items and no code path ever delivers them.** `SteeringQueue` is built, tested and
routed; `POST /api/actions/session` defaults to `mode: "enqueue"`; the client renders the queue and
lets you cancel. But `queue.next()` is called from `tests/fleet-actions-route.test.ts` and **from
nowhere else in the product**. A queued action sits until it goes stale at thirty minutes and is then
silently dropped.

That is worse than the feature being absent, and it is worse in the specific way this project keeps
writing about. An absent button teaches you to go to the terminal. A button that says *queued* and
means *never* is a promise the page cannot keep, and the person who pressed it goes away. It is
`silent-success.md` arriving inside the product rather than inside a check.

Greg's words are what makes the queue the point rather than a nicety — *"ideally these would
queue/steer if it's currently running, so that one could press more than one, in combination with
messages"* — so this is the difference between v0.5 being built and v0.5 working.

- [ ] A drain pass in `server.ts`'s refresh loop: for each session in the fresh snapshot, ask
      `drainGate(row.status)`, and when it says `now`, lease one item and deliver it.
- [ ] **One item per session per pass**, not a flush. The point of the queue is that an agent gets a
      turn between instructions.
- [ ] It must be handed the SAME `SteeringQueue` instance the routes use — `handleActionRequest`
      keeps one module-level instance, so the drain goes through the same function or takes it as an
      argument. Two instances would be two queues, and the one the page shows would be the one
      nothing delivers from.
- [ ] A delivered item leaves a receipt the page can render. "It was sent" and "it is still waiting"
      are the two states the queue exists to distinguish.
- [ ] **Until this lands, the client should say so** rather than implying delivery — one sentence
      under the queue, not a silent omission.

### Stage v0.5: the steering vocabulary

Greg's list, 2026-09-08: continue, compact, pull, push, remove worktree, exit, `sleep` for
1h/3h/5h/10h, get input from Fable or GPT Sol and then use your judgment.

- [ ] Each button is a **typed action** before it is a button, so the coordinator agent has
      something to call and does not have to synthesise a click.
- [ ] The line the direction doc already draws: most of these are *sentences you would type*, but
      `remove worktree` has an effect outside the conversation and is an action the tool takes via
      `gjd-remote` — not a sentence an agent is asked to obey. `exit` is on the same side of it.
- [ ] **Queue rather than race.** Greg: "ideally these would queue/steer if it's currently running,
      so that one could press more than one, in combination with messages". An agent that is
      working cannot be typed at usefully, so the queue is the feature, not a nicety: it holds an
      ordered list per session and drains one item at a time when the session is at a prompt.
- [ ] A queued item is visible and cancellable while it waits. A queue you cannot see is a queue
      that surprises you an hour later.

### Stage v0.5b: dictation and live chat, ported

Greg wants the product's voice machinery on every input box here — new session, steering, answers.
See [dictation.md](../project/dictation.md) and
[live-conversation.md](../project/live-conversation.md).

- [ ] This **crosses the standing rule that `tools/` does not reach into `src/`**. So it is a port,
      and whether that boundary should move is a real question to answer rather than assume —
      name it in the plan and let Greg decide it.
- [ ] There is **no audio input device on this box** (measured), so this cannot be verified here
      the way the rest can. Say so rather than claiming it works.

### Stage v0.5c: Box Health can act, not only report

Greg's list, against [diagnose-box-resources.md](../reusable/diagnose-box-resources.md).

- [ ] Kill what is safe to kill. "Safe" has to be a rule with a name, not a judgement made at the
      moment of the click.
- [ ] Kill the running test suites — the biggest single lever on this box, and the one whose loss
      costs least.
- [ ] A broadcast telling every agent the box is short of resources, asking them to pause and to
      drop anything cheap to restart. **Staggered**, per Greg: thirty-six agents told to pause for
      an hour all resume in the same second, and the box falls over at the far end instead of the
      near one. Spread the resume times across the window.

### Stage v0.6: create and kill agents

- [ ] ✅ `gjd-remote new-claude` behind `POST /api/sessions/new` (landed 2026-09-08, `a59d65cb`).
      The client half is stage v0.4b.
- [ ] `gjd-remote kill`. Do not grow a second way to do either.
- [ ] Killing needs a confirm step; it is the one irreversible action here.

### ✅ Stage v0.6e: rename a session (landed 2026-09-08)

Greg, 2026-09-08: *"add a way to rename sessions"*. `POST /api/sessions/rename`, addressed by tmux
handle.

**The trap, and it is the whole of the work.** `gjd-remote ls` runs `adoptTitles`, which renames any
still-*provisional* session to Claude's own title. So a rename that does not also clear
`GJD_PROVISIONAL` is correct on the page until somebody lists the fleet, and then silently wrong.
Both halves go in one tmux invocation, so there is no window between them.

Verified by renaming a probe and then running a real `gjd-remote ls` — which renamed two *other*
sessions in the same run and left the probe alone.

- [x] Renaming to the name it already has is **allowed**, because it still clears the flag. That is
      how somebody pins a name Claude chose and wants kept, and a naive "is it taken?" check refuses
      exactly that case.
- [ ] The client half — an edit-in-place near the title in the detail pane, not a field per card.
- [ ] The payload does not say which sessions are **provisional**, so the page cannot yet offer
      *"save to keep this name"* on one Claude is about to rename. One field on `FleetRow` when the
      client wants it.

### Stage v0.6b: the Orchestrator tab does something

- [ ] Send a message to the Orchestrator, with the same input machinery as everything else.
- [ ] Broadcast to all agents — the same mechanism as v0.5c's resource broadcast, so there is one
      implementation of "say this to everybody" and not two.

### Stage v0.6c: the other harnesses are invisible, not read-only

The horizon says **NOW/SOON: multiple model-families/harnesses — Claude Code and Claude agents now,
OpenAI Codex/GPT soon**. This plan has been recording that Codex rows are shown *read-only* because
`scripts/subagent-cli.ts:216` spawns them with `fd 0 = 'ignore'` so they cannot receive keystrokes.

**That was the wrong shape of the problem.** Checked 2026-09-08 04:20: there were **4 running
`codex exec` processes and 0 Codex tmux sessions.** Codex does not get a session here — it runs as
a subprocess inside the Bash tool of the Claude session that asked for a review. So it is not a row
that needs disabling; it is **work in flight that the fleet page cannot see at all.**

That matters more than it sounds, because a GPT Sol review is 15–45 minutes of wall clock and real
money, and the session that launched it looks *idle* the whole time. Two of tonight's own sessions
were in exactly that state.

- [ ] Show a session's in-flight subprocesses — at minimum a paid review, which is the expensive,
      slow, invisible one. `pgrep -af "codex exec"` plus ancestry to the pane pid is the same walk
      `steer.ts` already does in `descendsFrom`; reuse it rather than writing a second one.
- [ ] A session waiting on a review is not `idle`. Same defect as v0.4d, different cause.
- [ ] Only then ask whether Codex deserves rows of its own. It probably does not while it has no
      sessions — a row per subprocess is a different product from a row per agent.

### Stage v0.6d: when something is red, say whose it is

**Measured twice on the night of 2026-09-08, by two sessions that were not looking for it.** A
shared-fixture collision landed on `dev` from this worktree. One session spent **twenty minutes**
proving an earlier red was not theirs; another spent a **full 24-minute gate** discovering the same
thing. Both times the answer was in the failure message from the start — it names the files.

> Twice tonight the expensive part was not the red, it was attribution. […] If the dashboard ever
> surfaces a red, the field worth showing first is not the assertion but *which worktree last
> touched the files it names.*
>
> — `split-routes-one-slice`, 2026-09-08

That is a better idea than anything in this plan about test results, and it is cheap: the failure
message contains paths, `git log -1 --format=%s -- <path>` names the commit, and the worktree is in
the branch name. It also generalises past tests — it is the same question as "who do I ask about
this", which is the one thing a fleet of forty agents makes hard.

- [ ] When a red is surfaced, lead with **the worktree that last touched the files named in the
      failure**, not with the assertion.
- [ ] Say plainly when the answer is *not* attributable — a red with no file paths, or files last
      touched by a merge. Guessing an owner is worse than saying nobody knows, because the guess
      sends somebody to read code that is not theirs.
- [ ] **Name the signal that produced the name**, so a reader can discount it without having to
      know it was a guess. `cheap-postmortem-preventions`, who reached the right commit by this
      exact heuristic and said so: it got lucky, and *"the same heuristic on a merge commit would
      have named me for your files, since my merge shows all four fleet tests as changed."*
- [ ] The same field belongs on a session row: **what has this agent touched**, so the reverse
      lookup works too.
- [ ] **Say how old the run is, next to its result.** A fourth session hit the same red and
      reported it *after* merging the fix, because its gate had started 24 minutes earlier:

      > A 24-minute gate is long enough that its output is a report about a tree that no longer
      > exists.

      That is a different failure from attribution and it is not fixed by naming an owner. A test
      result is a claim about a *sha*, so show the sha and its age — and if the current tip is
      ahead of it, say so before showing the failure. This is the same rule the page already
      applies to the fleet snapshot, aimed at CI instead.

**One thing this stage should not do**, learned from the guard that caught the incident. Three
sessions read `fixture-ids.test.ts`'s failure message, and all three reached for the remedy it
suggests first — *give each file its own id* — which would have been wrong here: those files insert
nothing, and four ids would have asserted that four fixtures differ where the point is that they are
one conversation. **The remedy a guard suggests is the part people act on**, more than the
diagnosis, so a remedy that is right for the common case and silently wrong for a class is worse
than no remedy at all. If this surfaces a suggested fix, it should be the *question* to answer, not
the answer.

Two costs to keep honest about. `git log` on a path is a per-file subprocess, so this must be
computed for the handful of paths in one failure and never for the fleet. And the last commit to
touch a file is a heuristic, not an author — a merge commit or a sweeping rename will name the wrong
worktree, which is precisely why the "not attributable" arm has to exist rather than be a fallback.

### Stage v0.7+: the decision log

Deferred by Greg on 2026-09-08 — "eventually both, start simple, defer this to a middle stage".
Agents self-report through a small CLI plus a rule in [AGENTS.md](../../AGENTS.md); a transcript
scrape later as the backstop. Ranked by importance then confidence, product-facing counting as more
important. The dashboard makes decisions *visible*; it does not enforce the thresholds.

### Later: the coordinator agent

The orchestrator is eventually a program, not Greg (his call, 2026-09-08). Nothing here builds it,
but every action above is a typed function before it is a button, so it has something to call.

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
- **…but it does not stay working, and that is the strongest argument for this tool existing at
  all.** Counted 2026-09-08 04:15: **8 of 23** live interactive sessions showed `/rc failed` in
  their status bar. A third of the fleet, silently — the only evidence anywhere is one word at the
  bottom of a terminal nobody is looking at. So "Remote Control already does this" is true of a
  session at launch and unreliable of the same session an hour later, which is precisely when you
  reach for a phone. Noticed by Fable while it was reading the panes for something else; counted
  independently afterwards.
- **The Hetzner cloud firewall allows SSH, mosh and ICMP only.** Read from `infra/hetzner/main.tf`.
  Not verified against live Hetzner state — the box has no `hcloud` CLI and no Hetzner token by
  design. **Greg should confirm with `hcloud firewall list` from the Mac.**
Added 2026-09-08, after the steering route was wired (`c06438b7`).

- **A message posted through the HTTP route arrives as a user turn, and the far-end Claude answers
  it.** A throwaway session (`gjd-remote new-claude steer-e2e-probe`), a nonce from `/dev/urandom`
  written only to a file, `POST /api/steer/message` → the nonce appears **once** in the target pane
  and **zero** times in an unrelated pane, and the probe replied "Probe received: … Steer delivery
  to this session works". Session killed afterwards.
  **The controls are the point.** This is the same shape as the retracted socket claim above, and
  the same two controls settle it: a nonce that was never typed into a command, and a second pane
  that must show nothing. "The `send-keys` call returned 0" would have proved exactly what the
  socket write proved, which is nothing.
- **Every refusal was exercised against the live box, and each named the real world rather than a
  guess.** `GET` → 405; missing `Origin` and `Origin: http://evil.example` → 403; `text/plain` →
  415; empty body → 400 *"paneId is missing, and it is the address"*; a stale session handle → 409
  *"pane %1646 is in session $1643 now, not $1"*; a wrong pane pid → 409 *"it was respawned"*; a
  two-line message → 400 *"each newline would submit it early"*; a declared `shell` → 409 *"it is a
  shell, which would EXECUTE the message"*; a second keystroke inside the floor → 429 *"that session
  had a keystroke 298ms ago"*. Nothing marked `NEVERSENT` reached the pane; grepped.
- **A malformed status is refused as a bad request, not as an unsteerable session.** `{"kind":
  "shell"}` without `busy` returned `bad-request`, not `declared-not-steerable` — the two are
  different failures and the codes say so. Worth recording because the first run of this check read
  as a false negative until the payload was fixed: the union has required fields per arm, which is
  the type doing its job.
- **30 of 37 live rows carry all three ids** (`paneId`, `panePid`, `claudeSessionId`); the other
  seven are shells and legacy sessions, which are the rows that *should* be unsteerable. Before this
  commit, **zero** rows carried the last two, so the Send button would have been dead on arrival and
  the 400 would have looked like a bug in the route.

Added 2026-09-08 04:35, closing the one gap both UI and route agents named in the same words.

- **The client's own body-builder produces a body the real server accepts.** Both agents reported
  that every wire assertion on either side was against *that side's restatement* of the contract —
  so if `parseTarget` and `steerMessageBody` disagreed, every test on both sides stays green and the
  first real tap 400s. Run for real: a throwaway session, `parseFleetState` applied to the server's
  own payload, the row handed to the client's `steerMessageBody`, and the result POSTed. **200**,
  and the nonce (generated in the script, written only to a file) appears **once** in the target
  pane and **zero** times in a control pane. The body the client sends is exactly
  `claudeSessionId, paneId, panePid, sessionId, status, text`.
- **The answering refusal is real on the live server**, not just in tests: `503`,
  `answering-disabled`, with the sentence that names the hazard and the way round it.
- **A live blocked row now carries its material.** Captured from the running dashboard:
  `{"q":"question","material":"read","opts":["unknown","unknown","unknown","unknown","unknown"]}` —
  an `AskUserQuestion` whose five custom labels all classify conservatively, which is the right
  answer and the one the UI must render as *at least* as alarming as `persistent`.

- **A `claudeSessionId` on a row does NOT mean a Claude exists**, and this surprised everyone who
  looked at it. `CLAUDE_SESSION_ID` is written into the tmux environment by `tmux new-session -e …`
  **before Claude runs at all** — so a `gjd-remote new-claude --wait 6h` session carries a
  conversation uuid for six hours while its pane runs `sleep 21600`. Measured on the live payload
  2026-09-08 04:45: **30 of 35 rows carry a uuid, and 5 of those are `waiting`** with no process to
  match. Two consequences:
  - **Steering is protected twice over, by accident rather than design.** `steerableStatus` refuses
    `waiting`, and `verifyTarget` independently requires a live `claude --session-id <uuid>`
    descended from the pane. Either alone would do; it is worth knowing both are load-bearing.
  - **Anything that reads a transcript by uuid must not treat its absence as "this agent has said
    nothing".** It usually means the agent has not started.
- **The id also outlives the conversation, which is the harder half.** The tmux environment is set
  once and never updated, so if a pane's Claude exits and someone starts a fresh one, the row still
  names the *first* conversation. A transcript reader keyed on it then returns real, well-formed,
  correctly-attributed turns from a conversation that is not on screen — the most convincing wrong
  answer available. `transcript.ts` reports `lastModified` for exactly this: **a transcript last
  written hours ago on a row the collector calls `working` is this bug**, and the page must say so.
- **The transcript is not where `meta.dir` says it is, most of the time.** Building the slug from
  the launch directory found the file for only **7 of 30** sessions with a uuid. Not lossy
  slugification — `EnterWorktree` writes a `relocated` record and *moves the file* to the worktree's
  slug while `meta.dir` still names the primary. So the uuid is the identity and the directory is
  only a hint: try the slug, else scan. Being wrong about the slug then costs milliseconds instead
  of an answer.
- **Reading the tail is three orders of magnitude cheaper than the alternative.** Biggest transcript
  on the box is **33.0 MB**; a 12-turn read takes **262 KB (0.79%) in 4.5 ms**. Across all 35 live
  rows: 318 ms total, mean 9.1 ms, 13 needing the directory scan. `gjd-remote ls`, which greps whole
  transcripts, takes 10–12 s.
- **Tool traffic is ~80% of a transcript by volume** (census of one real 33 MB file: 2718 `tool_use`,
  2718 `tool_result`, 1353 `thinking`, against 1017 assistant text blocks and 280 typed user turns).
  Tool *results* are dropped — that is where hostile web content lives — and the count is reported so
  the page can say "and 40 tool results" rather than implying silence.
- **Rendering every `role: "user"` record as Greg is wrong more than four times in five.** Measured
  across two real transcripts: `human` 64, `task-notification` 319, `peer` 4, `auto-continuation` 2.
  And a peer message carries *both* `isMeta: true` and `origin.kind: "peer"`, so checking `isMeta`
  first labels every message from another agent "injected" — which the agent building it did, and
  caught.

- **Run the server under `scripts/tmux-job.ts`, not backgrounded from a session — demonstrated
  rather than argued, 2026-09-08 04:39.** An earlier, orphaned copy of the server that had been
  started with a plain `&` was OOM-killed while the box was at load 28 with 21 GB of swap in use.
  The tmux-job copy, on the same box at the same moment, kept collecting. Backgrounded processes are
  killed on *system* memory pressure rather than their own, so the dashboard would have gone down
  precisely when it was most worth looking at — and the only evidence would have been a phone
  showing a connection error indistinguishable from a Tailscale hiccup. Start it with:

  ```
  npx tsx scripts/tmux-job.ts --name fleet-server env FLEET_BIND=127.0.0.1,$(tailscale ip -4) \
    npx tsx tools/fleet/server.ts
  ```

  The `env` prefix matters: the variable does not otherwise reach the child, and the failure is
  quiet — the server binds loopback only, so it works from the box and not from the phone.

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
