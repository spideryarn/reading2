# Agent fleet dashboard

**Status as of 2026-09-08 15:40: important work left, and most of it is other sessions landing
rather than this one building. Six of the seven wave workstreams are on `dev`; two branches are
finished and unpushed.**

**The buttons work.** All seventeen session actions and the three box actions render on the real page,
checked in a browser at phone width and not merely in a suite. Recent messages are wired. A queued
message is delivered. That was not true this morning, and in three cases it had never been true.

**What was actually wrong, and it was not what anybody thought.** Four separate features were built,
tested, routed, shipped and *dead* — the line joining them missing, every gate green, and the page
saying something confident and false about each:

1. **The queue had no drain.** Items accepted, rendered, cancellable, dropped at thirty minutes.
2. **The action catalogue never reached the page.** The route sends `{session, box}`; the client asked
   `Array.isArray`. So Continue, Compact, Pull, Push, Remove worktree, Exit and the sleeps have
   **never appeared**, replaced by a dashed box blaming the server for being old.
3. **Every box action ever pressed was a dry run reported as "Done."** The page sent `dryRun`; the
   route has only ever parsed `mode`. *Kill test suites* killed nothing and said it had.
4. **The attribution prefix reached nothing.** `renderSpoken` — the rule that an automated
   coordinator must not acquire Greg's authority by arriving as a user turn — was called from its
   tests and from nowhere else.

All four are fixed and pushed. The postmortem is
[260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md) and it
found **sixteen** instances, not four.

**What is verified right now:** 1,203 tests across 30 suites and `npm run typecheck` clean at
`fa9d3cc2`, plus `npm run check` green on every gate. And — the check that actually mattered here —
**a real browser at 390px**, because a suite of 196 tests passed for weeks over a wire shape that did
not exist.

**`wire.ts` landed at 13:07 (`3df3e833`), and it works.** One leaf module with no imports, holding
the seven types the queue endpoint puts on the wire. Adding a field to it turns **both** ends red —
server and client — which is the property the postmortem asked for and did not know it could get.
The no-imports rule turned out to **enforce itself**: the client project compiles the module's whole
transitive closure under DOM-only libs, so one `import type` makes the typecheck fail on sight. One
endpoint of four is migrated; see Stage v0.8a for what is left and for the two corrections the plan
doc needed.

**What is left, in order.** Rewritten on the evening of 2026-09-08, against the code rather than
against the previous version of this list. **Four stages landed since it was last written** — v0.6f
(the attention inbox joined end to end), v0.4j (the phone's clock), v0.8b (the fleet-state endpoint
behind the shared type, and four dropped fields read) and v0.8c (the last two live missing joins) —
each with a cross-family review and a fix round after it.

*This list is the part of the doc most likely to be acted on without checking, which is exactly what
happened earlier today: two items marked as urgent safety work had already been fixed during the
wave and the paragraph still said they were live. Re-grep before briefing anybody off it.*

1. **The rest of v0.8a — two endpoints, not three.** The actions catalogue, and
   steer/new/messages/rename. Fleet state is done (v0.8b). `FleetRow` still cannot migrate the same
   way at all and the reason is written into `wire.ts` beside the generic hole it leaves.
2. **v0.9a — the broadcast cannot reach the sessions that caused the load.** Found by
   `spideryarn2-b6`, written up below, and **deliberately waiting on evidence**: a 24-hour sampler is
   running, and a series showing reachability recovering on its own kills the stage. It is two
   changes rather than one, because a box-wide action is *forbidden* from queueing on a stated
   ground that has to be answered rather than deleted.
3. **The systemd cutover**, which is Greg's to run — `sudo systemctl enable` is refused for agents on
   this box. Script prepared 2026-09-08 12:00, unrun. **Step 3 is a decision, not a check**: it is
   the moment the dashboard becomes tailnet-reachable, and `w2-fleet-dictation` measured that
   `navigator.mediaDevices` is *absent* (not degraded) at the tailnet address, so HTTPS there is a
   feature prerequisite rather than a nicety.
4. **v0.2c's other half** — delivery receipts and action ids. The browser now reads `delivery`; the
   five states and the repeat-retrieves-the-receipt rule are not built. **The related overclaim is
   fixed**: the page no longer says a keystroke *landed*, because `verifyTarget` runs before the send
   and nothing looks at the pane afterwards.

**Done since this list was last written, so nobody fixes them twice:** the attention inbox has a
consumer; every server timestamp is converted into the browser's clock at the parse boundary;
`answeringEnabled`, `tmuxServerPid`, `verified` and `resolution`/`startedDir` are read; `clear()` has
a route and a button; `/api/agents` is an alias whose description was the thing that was wrong; and
`renderSpoken`'s compile guard — the half of that safety item that never landed — exists.

**Two product questions are Greg's and are not blocked on anything.** Whether the cutover should
widen the bind at all, and what to do about a card that draws **five identical full-width
UNCLASSIFIED pills** — every option on an agent-authored `AskUserQuestion` is unclassified by
construction, so the badge distinguishes nothing *within* that card while teaching a reader to stop
seeing it. `CONSEQUENCE_TONE`'s inequality is right and is not the thing to change.

**Who is doing what, agreed 2026-09-08 13:00 across six sessions.** Greg asked for the remaining work
to be fanned out; this is the split, and the seam in every case is a **type**, not a schedule.

| Workstream | Session | Boundary |
|---|---|---|
| `wire.ts`, v0.4g, v0.4h, delivery receipts (A11) | this one | owns `queue.ts`, `drain.ts`, `status.ts`, `SessionDetail.tsx`, `wire.ts` |
| Approval binds to the material (A9) + prose into an unestablished pane (A10's open half) | `fleet-approval-binding` | owns `pane.ts`; has `steer.ts` for the afternoon |
| Box Health: 24h retention and charts | `fleet-health-history` | owns `health.ts`, `HealthPanel.tsx`; appends inside `refreshOnce` |
| Usage limits: the collector and the 429 ground truth | `w2-usage-limits` | publishes types; this session renders the arm |
| Codex/GPT harness adapter | `w2-harness-adapter` | owns `tools/overseer/harness.ts`; the *capability* half goes in `wire.ts` |
| Voice dictation on every message box | `w2-fleet-dictation` | has `OrchestratorPanel.tsx` and `NewSessionPanel.tsx` now; `SessionDetail.tsx` after v0.4g |
| The attention inbox | `orchestrator-setup` | decides the ranking; this session renders it |

**Two findings from those sessions that are not stages and should not get lost.** `w2-harness-adapter`
found **two paid `gpt-5.6-sol --effort high` reviews running under `ppid 1`** — orphaned when the
Bash-tool shell that launched them was reaped, attributable to no pane, invisible to this dashboard
and unstoppable through it. That is a cost question. And `fleet-approval-binding` captured **three
live drafts sitting in other agents' input boxes**, one of them the words *"yes, shut it all down"* in
a session running in auto mode: a Send from this dashboard would concatenate with that text and our
Enter would submit it. That is the approval-binding bug arriving through the prose door, and it is
live right now.

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

## The server that predated its code, and what one restart proved

**Fixed 2026-09-08 09:18.** The process on 8787 had been up since 04:34 and predated
`routes-actions.ts` and `PaneGate`; the client was built and live and the server was not. Greg asked
for the restart, so the standing instruction not to touch the live server was lifted for it. Started
the way it was documented to be started, with `npm run build:fleet` first — `server.ts` refuses to
boot without `web/dist/index.html`, and without the build it would have served the old bundle:

```
npx tsx scripts/tmux-job.ts --name fleet-server env FLEET_BIND=127.0.0.1,100.92.255.119 \
  npx tsx tools/fleet/server.ts
```

**Two symptoms, and what each turned into.** `GET /api/actions` had been 404ing once per ten-second
poll — `useActions` kept the last good feed and showed the error beside it, so the page never broke,
but the action buttons, the queues and Box Health's controls had nothing to render from. And every
dialog read *"Not offered: I could not tell what this is — this server did not say what answering
this dialog would do"*, which is `parseGate` failing towards `unknown`: the designed answer for a
server too old to send the field, and the reason answering was offered for nothing at all. Both
cleared on the restart.

**The restart is also the first evidence the gate works on real dialogs rather than on fixtures**,
which is worth more than the fix. Within four seconds of the server coming up, the two blocked
sessions in the live snapshot were classified in opposite directions:

- `fb2f-dock-always-visible-landscape` — `permission`, because *"an option widens what the session
  will approve on its own"*, quoting the option that does it. Four options, no answer button, the
  refusal rendered with its reason.
- `get-ready-for-deploy` — `conversation`. Three options, answerable.

That is `PaneGate`'s whole claim — *pane text as executable UI is acceptable when execution means "a
user turn", and not acceptable when it means "grant a permission"* — holding against two panes
nobody wrote a fixture for. `answeringEnabled: true` and `attemptedAt` present in the same payload
confirm the other two changes of that night are live.

**What the failure had cost, and the lesson under it.** Greg pressed a number and a button on his
phone and nothing happened, and the diagnosis took a Playwright run against a throwaway server on
8791 to reach. Everything was built, tested, committed and pushed; none of that put it on the port
he was looking at. **A deploy is not a commit, and on a long-running server it is not a build
either.** The two facts that would have said so immediately are now in the payload: `attemptedAt`
moves whether or not a collection completes, and `answeringEnabled` is TOLD rather than inferred, so
a server too old to send it is visibly a server too old to send it.

**When the systemd unit lands** (`orchestrator-setup`'s S5, below), 8787 stops being started this
way. Two supervisors for one port is a fight in which the loser's failure looks like a crash, so
tmux-job stays correct only until that unit is installed and enabled. The unit will need `FLEET_BIND`
in its environment — the failure without it is quiet, binding loopback only, so it works from the box
and not from the phone — and an `ExecStartPre` that runs `npm run build:fleet`, without which a `dev`
that moves the client serves a stale page rather than failing loudly. `FLEET_ACT_ENABLED` stays out
of it until `routes-actions.ts` has had its review.

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
[overseer-direction.md](../project/overseer-direction.md) leans on *"if the orchestrator
broke I could just ssh in and use Claude Code in the terminal"* as the reason a high robustness bar
still has a ceiling. After a reboot there is no page to fall back **from** — and, worse, nothing to
tell you the fleet is gone, because the thing that would have told you went with it. The ssh
fallback is real; it just is not automatic, and this plan should stop implying that it is.

`orchestrator-setup` is building a **system** unit (`User=greg`, `ExecStart` in the primary
checkout, installed and verified by `infra/hetzner/provision.sh`) for the Overseer, and is making it
generic so a second one can serve this dashboard. We take that offer rather than inventing a second
mechanism. **The consequence, named rather than discovered later:** running from the primary
checkout means booting whatever is on `dev` at that moment, including a red `dev`.

**Greg decided that, 2026-09-08, and it is a gradient rather than a yes or no:**

> Briefly broken is fine for dev, have a slightly higher standard for the orchestrator and its web
> interface, and a higher standard still for keeping things working in prod.

So this page sits in the **middle tier, named explicitly** — not held to production's bar, and not
covered by the licence `dev` gets. The unit still boots whatever is on `dev`, because a page that
refuses to start until somebody fixes the trunk is unavailable exactly when it is most worth having;
what the middle tier buys is that a fault here is worth stopping for, where the same fault on `dev`
would not be. The decision lives in `AGENTS.md` under *This is a beta, and speed still wins* and in
[overseer-direction.md § A higher bar](../project/overseer-direction.md).

**The failure that standard points at is a stale client, not a red one.** The unit's `ExecStartPre`
builds only when `tools/fleet/web/dist/index.html` is *missing* — deliberately, because with
`Restart=always` an unconditional build is a vite build every ten seconds through a crash loop on a
box that has reached load 391. A missing build therefore heals itself and fails loudly; a **stale**
one does not. A `dev` that moves the client without a rebuild leaves the old bundle in place and the
page serves it with no error anywhere, which is [silent success](../reusable/silent-success.md)
arriving through the deployment door. Making it impossible in the unit costs more than it saves, so
the fix belongs here and it is to make the staleness **visible**: see
[Stage v0.7a](#stage-v07a-the-page-says-which-code-it-is).

The standing direction is [overseer-direction.md](../project/overseer-direction.md); this
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
The direction these serve is [overseer-direction.md](../project/overseer-direction.md).

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

#### How `idle` splits, decided 2026-09-08 — an added fact, not an eighth status

**The obvious move is to add a `waiting-for-you` arm to `FleetStatus`, and it is the wrong one.**
`status.ts`'s header spends its first paragraph explaining that the status is not ours:
`FleetStatus = SessionState`, re-exported rather than restated, because *"a second copy of a
seven-arm discriminated union is a copy that stops matching the day somebody adds an eighth arm."*
The union lives in `scripts/gjd-remote-tmux.ts`, which `gjd-remote` itself depends on, and it is
joined from `claude agents --json` plus the process table. **A session that ended its turn with a
question genuinely IS idle by every measure that union is built from** — no process is running and
Claude reports idle. Nothing about the process table has changed. What has changed is what the pane
SAYS.

So the new fact belongs where the other pane-derived fact already lives: beside `question` on the
row, produced by `pane.ts`, which is the module whose whole job is reading what is on the screen.

- [ ] **A new additive field on `FleetRow`**, alongside `question`. A discriminated union, not a
      boolean: *asked a question* and *we could not tell* must not share a value, which is the
      mistake this area keeps making one level up from wherever it was last fixed.
- [ ] **`FleetStatus` is not touched.** Three exhaustive switches now depend on that union —
      `triageRank`, `steerableStatus` and `drainGate` — and `drainGate`'s second branch exists
      precisely to refuse a status it has no rule for rather than inventing one. An eighth arm would
      make every one of them a decision, and none of those decisions is about a session that ended
      its turn politely.
- [ ] **Triage order is where the two facts meet**, and triage order is already declared ours:
      *"a question about a screen and not about a session, so it does not belong in the inventory."*
      An idle session that asked a question sorts with the blocked ones; its status still reads
      `idle`, because that is what it is.
- [ ] **The detection is the hard part and it is not a regex.** Ten of fifteen idle panes ended on a
      decision handed to Greg, in prose, with no dialog and no marker. The cheap signals — a
      trailing question mark, "say the word", "yours to call" — will both miss and over-fire, and
      an over-firing inbox is worse than none because it teaches him to stop looking. Spike this
      against the real panes before designing around it, and count the false positives on the
      fifteen Fable already read rather than on invented examples.
- [ ] **The suggested reply is evidence, not an answer.** The harness renders its own proposed reply
      dim in the input box. Show it, attribute it to the model, and never send it without a press —
      *augment rather than replace* is the project's first principle and this is the exact shape of
      it.

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

### ✅ Stage v0.2b: an approval must bind to what is being approved (landed 2026-09-08, `6fbb1f56` · `688bd699` · `44f60619`)

**This stage read 🔴 and "BLOCKS v0.4" for most of a day after it had shipped, and that cost
somebody most of a morning nearly rebuilding it.** The plan doc being three commits behind the code
is the same class as the bug it describes: a document that says a safeguard is missing when it is
present is as expensive as one that says a safeguard is present when it is missing — the first
buys a rebuild, the second buys an incident. Fixed 2026-09-08 by the session that went looking for
the work and found it done. v0.4 shipped; the block is lifted.

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

- [x] `PaneQuestion` carries the **material**: the command, the diff, the destination path, the
      permission scope — whatever is above the rule, not merely the sentence below it. `6fbb1f56`.
      Three arms rather than a nullable string, because `no-material` (a `/loop` menu, where the
      options are the whole question) and `unreadable` (there is a dialog here and we could not see
      what it is about) are opposite claims that would draw the same empty box. `materialAbove` is
      bounded by the dialog's **top** border rather than by the last rule, which was the bug.
- [x] `sameQuestion` compares the material. A capture that cannot read it is a **refusal**, not a
      question with an empty material field. `688bd699`. `sameMaterial` returns false for
      `unreadable` **including against another `unreadable`**: two screens we could not read are not
      evidence that they are the same screen.
- [x] **Half done, and now finished.** An `unreadable` material already takes the buttons away
      whatever the caller asked for (`44f60619`) — but the card said only "Answer it in the
      terminal", which is correct and useless to somebody holding a phone in another room. It now
      prints the command, `gjd-remote resume <name>`, as selectable monospace text. A refusal that
      does not name the next move is a refusal a person can do nothing with.
- [x] **"Yes once" and "yes, and don't ask again" get visibly different treatment.** `44f60619`.
      `classifyConsequence` reads the label into `once` | `persistent` | `decline` | `unknown`,
      recomputed server-side in `parseQuestion` rather than believed off the wire, and the client
      draws a `Consequence` pill beside each option. **`unknown` is drawn at least as loudly as
      `persistent`**, held by an inequality over `CONSEQUENCE_TONE` that the suite asserts — draw
      the conservative default in neutral grey and it becomes the safest-looking badge on screen,
      which would inverse the guarantee by a colour choice.

**Verified in a browser on 2026-09-08, not only in the suite.** A dialog was provoked on a
throwaway session and the card drew all of it: the *"What you would be approving"* box with the
material in it, the sha256 fingerprint and its sentence, the options as buttons with their
keystrokes, and a consequence badge on every option with a working tooltip. Every part of this stage
had tests before it had a screenshot, and this repo has four features that were built, tested,
routed, shipped and dead.

**One thing the screenshot showed that the tests could not.** On an agent's own `AskUserQuestion`
every option is `unknown` by construction, so the card draws five identical full-width red badges on
a phone. The tone rule is right and is not being softened — but it was calibrated for a permission
dialog where the badge tells `once` from `persistent`, and a badge on every option distinguishes
nothing within its own card. Left as a design question for Greg in
[260908f](260908f-prose-needs-an-empty-input-box-not-merely-a-box.md), not patched here.

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

### ✅ Stage v0.2f: prose needs an EMPTY input box, not merely a box (landed 2026-09-08)

**The other half of Astra's A10**, and the half v0.2e above does not touch: v0.2e is about which
recognised *dialogs* may be answered, and this is about prose typed at a pane whose state nobody has
established. Its own doc, because two agents are editing this file today:
**[260908f-prose-needs-an-empty-input-box-not-merely-a-box.md](260908f-prose-needs-an-empty-input-box-not-merely-a-box.md)**.

`inputSurface` established that an input box EXISTS and never read what was in it. Measured
read-only across every pane on this box on 2026-09-08: of seventeen Claude sessions with a prompt on
screen, thirteen were empty and **three held a live draft** — `%218` on `❯ yes, shut it all down`,
in a session running in auto mode. A Send there types our text onto the end of Greg's and our Enter
submits the concatenation, so the dashboard delivers an approval nobody wrote, at a moment nobody
chose, against whatever is on screen by then. **That is v0.2b's bug arriving through the prose door
rather than the dialog door.**

The existing fixture `none-typed-numbered-message-in-input-box.txt` reproduces it with no tmux — and
the suite listed it under *"sends to every real screen that does have one"*, so until today the
defect was not merely untested, it was asserted as correct.

The fix is a narrowing rather than a check: `inputSurface` moved into `pane.ts` as a four-arm
`PaneSurface` union — `dialog | empty-input | occupied-input | unrecognised` — and `sendMessage`
requires `empty-input` where `answerQuestion` requires `dialog`, both under a `never`. Prose stops
being established by absence and starts requiring strictly more evidence about the screen than
answering does, which is what A10 asks for. **`occupied-input`, not `drafted-input`**: a capture
cannot tell a person's half-typed reply from a suggestion the harness offered or the greyed hint a
never-used session draws, and the name must not claim provenance the parser does not have.

Refused in a real browser and then allowed in one — and two rounds of GPT Sol, the second of which
found a comment in the first version that denied what the code beneath it did. Both are in
260908f.

### 🟡 Stage v0.2c: delivery has a third outcome, and it is "I do not know" (the browser reads it, 2026-09-08 `91e1f3a0`; receipts and action ids not started)

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
[overseer-direction.md](../project/overseer-direction.md#what-greg-asked-for-on-2026-09-08-in-his-own-words).

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

**The tick is honest and it was not the whole feature: this landed a *reader*, not something a
person can see.** `tools/fleet/transcript.ts` and `GET /api/messages?id=` were built, tested and
correct, and for a day no page called either of them — the detail pane went on drawing *"Recent
messages are not wired up yet."* while this heading said done. Greg found it by looking at the
page. The half that was missing is **Stage v0.4f** below;
the tick stays because the half that landed is real.

The detail pane's "recent messages" needs a source. Transcripts are on disk and are tens of
megabytes; `gjd-remote ls` greps whole ones and costs 10–12s, which is the thing this tool exists
not to do.

- [ ] Read the **tail** of a session's transcript, not the whole thing, and only for the one
      session being looked at.
- [ ] `~/.claude/projects/<slug>/` is a **slugified cwd and is lossy** — resolve the path from
      `row.meta.dir` plus `row.claudeSessionId`, and say plainly when it cannot be found rather
      than showing an empty conversation.

### ✅ Stage v0.5f: nothing drained the queue (landed 2026-09-08)

**`tools/fleet/drain.ts`, `tools/fleet/refresh.ts`, and the narrowing in `queue.ts`.** A queued
message is now delivered by the next refresh pass — one item per session per pass, after the snapshot
has been published, inside its own try/catch.

**The design below was reviewed by GPT Sol before anything was built, and it came back "do not build
this as written."** Two P0s, both confirmed against the source, and they are worth keeping because
each is a general shape rather than a bug:

**P0-1 — `steerableStatus` answers a wider question than the one being asked.** The design says *ask
`drainGate(row.status)`, and when it says `now`, deliver*. `drainGate` is built on `steerableStatus`,
which answers *"may this session be steered at all"*; `needs-you` passes it. But `sendMessage`
refuses a pane that is showing a dialog (`steer.ts:1117`, `pane-is-asking`). So the drain would have
leased the item, been refused, settled it as spent, and **destroyed the person's instruction** — once
a minute until the queue emptied, while the agent sat on one dialog. The fix is `deliveryGate`, a
second function differing from `drainGate` in exactly one arm, obtained by *asking* `drainGate`
rather than copying its list, so the two cannot drift.

*The general shape, and it is the third instance in one night:* a signal whose name promises more
than its definition delivers. See `docs/reusable/name-is-evidence.md`.

**P0-2 — a synchronous delivery inside the loop that draws the page.** `sendMessage` is up to six
`execFileSync` calls at ten seconds each, and `Promise.race` cannot bound one: the timer cannot fire
while the event loop is blocked. Unbounded, a fleet where everybody has something queued is ~36
minutes of dead dashboard. The fix is three bounds — publish the snapshot *before* delivering,
`MAX_SENDS_PER_PASS`, and `DRAIN_BUDGET_MS`, the last two checked *between* rows, because a send
already under way cannot be abandoned.

**And one retreat, recorded rather than dropped.** `QueuedPayload` now holds a `SpokenAction`, so an
*enacted* action — `remove-worktree`, `kill-session` — cannot be represented as a queued item at all.
The header's original argument (queue them, for ordering: "push, then remove the worktree" must not
become the reverse) is right and was overruled: delivering one means running a plan of `execFile`s
that deletes a directory, from the one loop whose failure takes the dashboard down with it, and that
surface is the least-reviewed in the tool. The narrowing is structural rather than a check, so the
drain has no branch for the case and could not compile one.

**Three things it does that the design did not ask for**, each because the review found the hole:

- **`release()`** — the one hole in *never auto-retry a keystroke*, and it is not a retry. When the
  transport says `delivery: "none"` with an empty `sent` list, nothing left this process; the item
  goes back to the **head** of its queue. Without it the commonest refusal on this box —
  `pane-is-asking`, because the pane opened a dialog in the thirteen seconds since the collection —
  destroys the message rather than delaying it. The type can only be built by `nothingWasSent`.
- **`noteGeneration()`** — a tmux restart re-issues every `$…` and `%…` handle to different sessions,
  so the whole queue is invalidated at once, with a *sentence* rather than a deletion, and the page
  draws it.
- **`refresh.ts`** — the missing line was in `server.ts`, which no test can import, because importing
  it binds 8787. So the *order* moved to a file a test can drive, and `server.ts` keeps only the
  dependencies. This is Sol's D8, and it is the reason the original hole was invisible to a suite in
  which every individual part was tested.

**Untrue prose is a defect, and this stage produced one.** The confirm strip said *"if this session is
working, this waits its turn in the queue"* about an action that is now refused outright. The test
that pinned that sentence went red, which is what it was for; it now pins the new rule and asserts
the old one is nowhere on the page. **Prose is a second copy of a rule and the compiler does not
check it.**

**Still open, deliberately.** `broadcastRoute` picks its recipients with `drainGate` and has the same
P0 shape — nothing is destroyed, because a broadcast has no queue, but it should ask `deliveryGate`.
Receipts, an abandon-stuck route, and the per-pane mutex (*"the day any of this becomes async, the
mutex arrives in the same commit"*) are named in the source and not built.

<details>
<summary>The original stage text, kept because the review is only legible against it</summary>

**The queue accepts items and no code path ever delivers them.**

`SteeringQueue` is built, tested and routed; `POST /api/actions/session` defaults to `mode: "enqueue"`; the client renders the queue and
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

#### The design, decided 2026-09-08

**A new `tools/fleet/drain.ts`, called once per refresh, delivering at most one item per session.**

- [ ] **`drainOnce(rows, deps)`** — pure over its inputs, taking the fresh snapshot's rows and
      returning a list of receipts. It holds no clock, no timer and no transport of its own:
      `queue.next()` decides whether there is anything to send, `sendMessage` sends it, `settle()`
      closes the lease. The same `next → deliver → settle` seam the queue was built around, now
      with a caller.
- [ ] **The same instance, guaranteed by construction rather than by care.** `makeActionRoutes`
      gains a `drain(rows)` on the returned `ActionRoutes`, and `routes-actions.ts` exports
      `drainSharedQueues(rows)` alongside `handleActionRequest` — both go through the one lazy
      `shared`. There is then no way to call the drain without the queue the routes filled, because
      there is no second constructor to call. A test still gets its own via `makeActionRoutes({...})`.
- [ ] **One item per session per pass, and no rate limiter.** A pass happens when a collection
      succeeds — every 60 seconds — so the cadence is already one message per session per minute,
      well inside `MIN_INTERVAL_MS`. Spending a limiter token here would let the drain push a
      person's own urgent message further away, which is Sol's F18 in the enqueue path pointing the
      other way. Eight queued items therefore take eight minutes to drain, and that is the feature:
      *"the point of the queue is that an agent gets a turn between instructions."*
- [ ] **The row is the address; the item is the claim.** `next()` is passed the row's status and the
      row's `claudeSessionId`, and refuses `orphaned` when the pane now holds a different
      conversation. `sendMessage` is then given a `SteerTarget` built from the same row —
      `paneId`, `sessionId`, `claudeSessionId`, `panePid` — so the box is verified against what the
      collector just saw, not against what somebody typed half an hour ago.

**What the drain does NOT do, and why the queue must stop accepting it.**

- [ ] **Enacted actions are refused at enqueue time.** `enqueueAction` accepts a session-scoped
      *enacted* action today — `remove-worktree`, `kill-session` — and nothing in this stage will
      run one. Delivering an enacted item means calling `runPlan` from inside the refresh loop:
      several `execFile`s with a two-minute timeout each, deleting a directory, on the one code path
      whose failure takes the dashboard down with it. That is the largest, least-reviewed surface in
      the tool, and `FLEET_ACT_ENABLED` is off precisely because it has not been reviewed.
      So the route refuses the enqueue, in one sentence naming the alternative (dry-run it, then run
      it with a confirm), and the promise is never made.
- [ ] **Refused unconditionally, not only while the flag is off.** A refusal conditional on
      `actEnabled()` would re-create the silent promise the day the flag is turned on — the queue
      would start accepting items that still nothing drains. One rule, one sentence, no trap left
      behind for whoever flips the flag.
- [ ] This gives up the ordering argument `queue.ts`'s own header makes — *"push, then remove the
      worktree" must not become the reverse*. That argument is right and this is a retreat from it,
      recorded rather than quietly dropped: ordering across a spoken action and a destructive one is
      worth less than not running `git worktree remove` from an unreviewed loop. When
      `routes-actions.ts` has had its Sol review and the flag goes on, extending the drain to plans
      is the follow-up, and the enqueue refusal is the thing to delete first.

**Receipts, because "sent" and "still waiting" is the distinction the queue exists to draw.**

- [ ] A bounded per-session ring of receipts — `delivered`, or `refused` with steer.ts's own code
      and sentence — carried on `QueueView` next to the items, so the page reads both from the one
      place it already polls. Bounded because this is a server-lifetime structure on a box that
      runs out of memory.
- [ ] **A throw leaves the lease alone.** If `sendMessage` throws, nothing can tell a request that
      died before the keystrokes from one that died after, so the item is neither settled nor
      requeued: it becomes `stuck`, and a person decides. That is the queue's rule already
      (*"never auto-retry keystrokes"*) and the drain must not be the place it is quietly relaxed.
- [ ] **A `stuck` item blocks its session's queue and there is no route to clear one.** `settle` is
      not exposed; `cancel` refuses an in-flight item. Found while designing this, and it is part of
      the stage rather than a note for later, because the drain is what will start producing stuck
      items. `POST /api/actions/settle` with outcome `abandoned`, and the page offers it only on an
      item the snapshot reports as in-flight past its lease.

**How it is checked.**

- [ ] The red test first, and it is a test that would have caught the original hole: assert that a
      queued message is delivered by a refresh pass, driving `drainOnce` with a fake `sendMessage`
      and a fake clock. Before the drain exists it fails because nothing sends.
- [ ] **The hole itself was invisible to the suite**, which is the more useful lesson: every part
      was tested and the wiring between them was not. So one test asserts the wiring by name —
      `drainSharedQueues` and `handleActionRequest` reach the same queue, proven by enqueueing
      through the route and draining through the export.
- [ ] Then mutate: make the drain settle without sending, and make it deliver to the wrong session,
      and check the suite goes red for both.

</details>

### ✅ Stage v0.4e: the page says when a session launched in the wrong mode (landed 2026-09-08)

The fix in `provision.sh` stops it happening again; this is what makes it *visible* when it happens
anyway — a different box, an older session, a launcher nobody has updated.

`readPaneMode` in `pane.ts` reads the mode off the status bar and returns one of four arms:
`auto` / `not-auto` (carrying the name) / `cannot-tell` (with a reason) / `not-applicable`.

**The design call worth keeping is the anchoring.** A mode line counts only when the line *directly
above* it is the status bar's chrome line. Measured before it was written: across 24 pinned fixtures
and 19 live panes, **43 mode lines, 43 anchored, 0 loose** — and a test splices a real auto-mode line
into a real manual-mode pane's transcript, where the naive substring rule fires and the anchored one
correctly says `not-auto`.

**And the second: an unfamiliar mode name is `cannot-tell`, not `not-auto`.** "Anything that isn't
auto is the defect" turns every row red the day Claude Code renames a mode — a false alarm across the
whole fleet at once.

Live on 20 rows the day it landed: 14 `auto`, 6 `not-applicable`, **0 `not-auto`, 0 `cannot-tell`**.
The six were blank shell panes, which the detector alone called `cannot-tell` and `modeApplicability`
correctly turned into "there is no mode to have". The cost is 19 captures in 176ms, median 9ms.

**It is silent when healthy.** A green tick on every row makes the one without it harder to spot.

**One thing the brief got wrong, and it inverted the premise:** the dashboard did *not* already
capture every pane — only `needs-you` rows. The mode is the one thing a blocked session's pane cannot
tell you (the modal covers the status bar), so a check reusing only the existing captures would have
fired approximately never.

### ✅ Stage v0.4f: recent messages, which was half-landed and read as done (landed 2026-09-08)

**Done.** `tools/fleet/web/src/messages-client.ts` parses the reply, `RecentMessages.tsx` draws it,
and `SessionDetail.tsx`'s dashed placeholder is gone. Nothing in `transcript.ts` or `server.ts`
changed — the route was right, and no bug was found in it.

Four design calls worth keeping:

- **Four arms, not three.** `RecentMessages` has `found` / `not-found` / `unreadable`; the client
  adds `no-answer` for *this page never got a reply it could read*. Collapsing that into
  `unreadable` would put the browser's own network trouble on screen in the server's voice, and
  it is the same distinction `catalogueOffered` draws in actions-client.ts.
- **`reachedStartOfFile` is `boolean | null`.** A server that did not send it has made no claim,
  and defaulting it either way invents one — so the page has a third sentence saying it does not
  know.
- **`transcriptAge` fires only on `working`, at thirty minutes.** The threshold is a trade: the
  full gate on this box runs 24 minutes and writes nothing to the transcript, so anything shorter
  would fire on the healthiest thing a session does. `needs-you` is excluded on purpose — a
  session parked on a dialog is silent for hours by design, and that is the row Greg opens the
  page to see.
- **The read is keyed on `row.id`, never the row object.** A new snapshot replaces every row
  object each minute; depending on the object would have put a multi-megabyte disk read on the
  sixty-second refresh loop, which is the one thing this section must not do.

Ten mutations were applied to the finished code and every one was caught by the suite, including
the brief's named minimum (an `unreadable` payload falling back to an empty `turns` array).

**What was briefed, kept because the diagnosis is the interesting part:**

**Greg, 2026-09-08:** *"Show the recent message(s) for each session when I click on it in `Sessions`
mode, no matter what status."*

**The server route exists and works. No page has ever called it.** `GET /api/messages?id=` is wired
in `server.ts` and backed by `tools/fleet/transcript.ts` (42KB, tested); `SessionDetail.tsx:522` still
draws *"Recent messages are not wired up yet."* and points at this stage. So v0.4c is marked ✅ above
and the thing a person can see is absent — which is the same class as the queue that nothing drained,
caught this time by Greg looking at the page rather than by a check.

- [x] Call `/api/messages?id=` from the detail pane and render the reply's arms — it is a
      discriminated union with `unreadable` and `not-found` cases, and those are the ones that must
      not collapse into an empty conversation.
- [x] **No matter what status**, which is Greg's actual words and the easy thing to get wrong: a
      `shell` or `no-claude` row has no transcript, and the honest answer there is a sentence, not a
      blank panel.
- [x] It is agent-authored text from a process that may have handled hostile input. React escapes it;
      nothing may add markup. Same rule as the pane capture.
- [x] Fix `OrchestratorPanel.tsx:65`, which calls v0.4c `"next"`, and the ✅ on v0.4c above.

### ✅ Stage v0.5g: Queue on an idle session is a worse Send

**Greg, 2026-09-08:** *"I tried using "Queue" to send a message to an idle session, and nothing
happened, because it's waiting for something - if the session is idle, either hide the Queue button
and/or auto-send."*

**Half of this is v0.5f and is now fixed** — *nothing happened* was the queue having no drain, and a
queued message now goes out on the next pass. But the rest of the report stands, and it is a product
point rather than a bug: on an idle session the two buttons do the same thing, one of them a minute
later, and the page offers no reason to prefer the slow one.

- [x] When the row is `idle`, **Send is the only button**. Not "hide Queue if the queue is empty" —
      the condition is the status, because that is the condition the person is reasoning about.
- [x] When something is already queued for that session, Queue stays, and it stays for the reason
      the queue exists: order. Two buttons that both send *now* would interleave with what is
      waiting.
- [x] Say the delay out loud wherever Queue is offered. It is *"within a minute or so"* and the real
      cadence is ~73 seconds, not 60 — the collection itself takes about 13.
- [x] The failing test first, and it is a rendering test: an `idle` row shows no Queue button.

**Built 2026-09-08.** `offerQueue` in `SessionDetail.tsx` carries the condition and the reason it is
the status rather than the queue's length, plus the distinction the file's own header would otherwise
make this look like an exception to: hiding a button is a claim about which of two ACCEPTED gestures
is worth offering, not a second copy of the server's refusal rules. Both places that mention the
queue now say ~73 seconds instead of *"within a minute or so"*. Four tests in
`tests/fleet-web.test.tsx` § *queueing a message*; five mutants, each killed by the test that names
its rule.

### ✅ Stage v0.4g: the session detail view is cluttered (landed 2026-09-08, `a07b9528`)

**Greg, 2026-09-08:** *"Use Playwright or similar to take screenshots and make the Session detail view
less confusing and cluttered and more user-friendly (with product input from Fable)."*

This is the first stage in the plan whose deliverable is a judgment rather than a mechanism, and the
brief names both halves of how to get one: **screenshots of the real page**, because tests going
green is not evidence a reader can see it, and **Fable**, because the question is what a person needs
first and that is not a technical fork.

- [x] Playwright against system Chrome on the box. Six full-page captures at 390px and 1280px,
      before and after.
- [x] **Measured rather than described.** A needs-you detail view was **3,398px tall at 390px wide —
      four screens of scrolling — with 31 buttons and two text inputs**. An idle session with nothing
      to report still ran to two and a half screens.
- [x] Fable ruled on ordering and density, and on Greg's four open questions.

#### The rule, which is the part that outlives this stage

The prose on this page is *deliberate* and it is *good*: several paragraphs exist because somebody was
previously misled by a bare number, and this tool's non-negotiable rule is that a number without its
caveat is a lie. So the question was never "less prose or more". Fable's answer, 2026-09-08:

> **A caveat stays on screen only if it would change what you do on this screen in the next ten
> seconds. If it only changes what you would *believe*, it lives one tap away, attached to the fact it
> qualifies. If it qualifies something that is not on screen — an empty section, a state this session
> is not in — it goes.**

Two corollaries did most of the work. **An honest label replaces a paragraph**: `Queue (~73s)` says
what a sentence was saying, `Ask it to…` says these are requests an agent may decline, `(dry run)`
says the server will not act. And **the tap is on the number, never on a separate help link** — which
is what keeps the non-negotiable rule intact, because the page still renders no bare numbers. It
renders numbers wearing their caveats, and `Explain` is how they wear them.

#### What changed

- [x] Composer above the button strip. The commonest thing a needs-you session wants is an answer in
      prose, and it was third, behind fifteen buttons.
- [x] Fifteen spoken buttons became **four visible** — Continue, Where are you?, Pull latest, Wrap up
      — with the rest under a `More` disclosure grouped into **Work / Pause / Hand off**.
- [x] The rename field is behind a `Rename` disclosure, and the page shows **one name** rather than an
      italic *no title yet* above a box holding the real one.
- [x] *Where it is* is collapsed, with the repo in its summary.
- [x] **`wrote 21m ago` in the header**, beside the badge — the one number that tells a working
      session from a stuck one, previously buried a screen and a half down as the first line of
      *Recent messages*. It asks `transcriptAge` for the alarm threshold rather than recomputing it,
      so the header and the section cannot disagree, and `useRecentMessages` is exported so one
      transcript read serves both.
- [x] **A shell gets one sentence and none of the controls**, which reverses a rule in
      `SessionDetail.tsx`'s own header. The old rule — do not reimplement `steerableStatus` here —
      was written to stop the page second-guessing a *refusal*, and it was right about that. But the
      page already branches on `status.kind` to draw the SHELL badge, so hiding the composer on the
      same branch adds no second source of truth, and fifteen buttons and a text box that cannot work
      under a badge saying they cannot is the more expensive lie. The header now separates the two
      questions: this file does not decide **refusals**, and it does decide **what to offer**.
- [x] Two deletions. A section headed *What it needs from you* whose entire content was *"Nothing. It
      is not asking you anything."* — a heading whose only content was the news that it had none. And
      a *Say something to it* heading nested inside a section of the same name and repeated 300px
      lower over the composer, so the page said the same four words about two different things.
      Fable: the single most confusing thing in the screenshots.

#### The one part that could lose a feature, and it has a watched test

`groupSpoken` sorts by **id, from a list written in the client** — and the *server* owns this
catalogue and can add to it. A grouping that silently dropped what it did not recognise would be a
fresh instance of [260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)'s
class. So anything unrecognised lands in an **Other** group and is still pressable, and
`still draws an action this build has never heard of` goes red when that one line is removed —
measured, hatch out, test fails, file restored byte-identical.

Related, and caught by the tests rather than by review: *What each of these actually says* was first
placed inside the `More` disclosure, per the ruling — which is right when More holds ten buttons and
makes it **unreachable when the catalogue is small enough to have no More at all**. It renders
unconditionally.

#### Fable's answers to the four questions that are Greg's

- **(a) Rename from the phone?** Almost never, and when he does it is because a card says *no title
  yet*. So: no field, a disclosure — and show one name, not two.
- **(b) Last prose turn, or the raw pane tail?** The prose turn, **with its age**. The pane tail is
  forty lines of tool output a phone cannot fit, and the prose turn is what *Where are you?* would
  return anyway. A prose line without an age is the misleading number, so the age is part of the
  ruling. **Built.**
- **(c) Should a working session's composer default to Queue?** **No.** Send stays primary in every
  state; typing at a working agent means *steer it now*, and a 73-second default is wrong for a tool
  used in a hurry. The exception is already built: when the queue is non-empty, ordering is the
  point.
- **(d) Same order on the desktop?** Yes, one column, as the 1280px capture already had it. Desktop
  gets the width for the transcript, not a second map — and the coordinator agent will read both.

#### Two of Fable's rulings NOT taken, named rather than quietly dropped

- **Cut `Sleep 5h`.** Deleting an action touches the catalogue, the `SpokenActionId` union in
  `wire.ts`, and anything already queued under that id — for a cosmetic gain the `More` disclosure
  already delivers. Kept, in the **Pause** group.
- **Put the `Force` group below the queue.** Separating the loud red block from the strip it is the
  exception to makes it easier to lose than to find. Kept adjacent.

Both are Greg's to overrule in a word.

### The pane shows text nobody typed, and it reads as an instruction

Found 2026-09-08 while proving the drain end-to-end against a throwaway session. After each turn,
Claude Code renders a **suggested next prompt** inside its input box — same `❯`, same colour in a
`capture-pane`, no marker of any kind that distinguishes it from something a person typed and has not
yet sent. Three of them appeared in a row, each a plausible follow-up to what had just happened:
*"send another one to confirm it keeps working"*, *"count from 1 to 20 the same way"*, *"send another
one while you're idle this time"*.

**I read the first one as a message somebody had left in the box, and briefly as an instruction to
me.** Nobody typed any of them.

**The question parser is not fooled, and it is worth knowing why**, because the reason is a rule and
not luck: `parseCursorMenu` requires at least two contiguous same-column lines *and* a dialog-like
footer, so a single ghost line falls out as `{ kind: "none" }` (`pane.ts:849`). That is the tightness
described in its own comment — *"a multi-line message Greg typed, echoed back into the transcript
under a `❯`, is exactly this shape minus the footer"* — earning its keep against a case it was not
written for.

**What it does bear on:**

- **v0.4d**, which will read a *turn* rather than a substring to find a question in prose. A suggested
  prompt is model-authored text sitting exactly where a person's words go.
- **Any pane preview on the page.** Rendering the input line under a heading like "waiting to be
  sent" would be a confident wrong answer about a person's intent.
- **v0.2d's argument, arriving from a direction it did not anticipate.** That stage is about the
  dashboard as a privileged renderer of *hostile* content. This is not hostile — it is the harness
  being helpful — and it is indistinguishable from typed input by anything in a capture. The defence
  is the same one: never claim provenance you did not read.

### ✅ Stage v0.4h: "working" is hiding at least three different things (landed 2026-09-08 — reader `aade22b0`, render `91ce727c`, scoping `2bfe48dc`, usage seam `86151d30`)

**Greg, 2026-09-08:** *"can you try and distinguish between statuses like `Working`, `Hit usage
limits`, and `Paused/waiting` (e.g. because it's been asked to run Unix sleep or idle waiting for a
CronCreate or similar, i.e. it's kind of idle, but with an intention to reactivate, and ideally make
a note of when it should reactivate (and whether it's overdue)). This might require regexes and/or
matching on the recent messages and other metadata about the session? Get input from Fable, and you
can run spikes with dummy sessions you've created, then get a review from GPT Sol."*

**Start from what already exists, because half of one arm is built and it does not cover the case
Greg means.** `SessionState` has a `waiting` arm carrying `secondsLeft`, and
`sessionState()` in `scripts/gjd-remote-tmux.ts:971` produces it from `s.proc.kind === "wait"` — the
process probe seeing a `sleep` as the session's **foreground** process. That is the launcher's own
scheduled session: a job script that sleeps three hours and *then* starts Claude. It is checked
before the agents lookup, so it works, and it is the easy case.

**The case Greg is describing is the opposite one and reads as `working`.** An agent that has been
*told* to sleep runs `sleep` as a child of a live `claude`; the foreground process is Claude, Claude
Code reports `busy`, and the row says **Working** for three hours. Same for a session parked on a
`CronCreate`, and same — differently — for one that has hit a usage limit, which is not in the agents
map's vocabulary at all and so lands on `working` or `idle` depending on timing.

So the fleet's most common long-lived states are three facts wearing one word, and the dashboard's
whole claim is that you can tell at a glance which sessions need you.

**What makes this hard, and it is the thing to establish before designing anything.** The evidence is
in three different places and they disagree about what they can prove:

- **`proc`** — what is actually running. Strong evidence, and it can see a `sleep` **child**, not just
  a foreground one. It cannot say why.
- **The pane capture** — already taken once a minute for every row since v0.4e. Shows what Claude
  Code is *saying*: a usage-limit message, a countdown, a tool call in flight. Strong for the
  usage-limit case and the only source for it. Untrusted text.
- **The transcript tail** — v0.4f. Says what was *asked for*: "sleep for 3h", a `CronCreate`. This is
  the only source that can supply an **intended reactivation time**, which is the half of Greg's ask
  that nothing else can answer.

**The rule this stage must not break.** `FleetStatus` has seven arms and **three exhaustive switches
depend on it** — `triageRank`, `steerableStatus` and `drainGate`, now `deliveryGate` too. v0.4d
already decided the general form of this question: *"how `idle` splits is an added fact, not an
eighth status"*. Read that decision before proposing an eighth arm here. A paused-with-intent session
is genuinely `working` by every measure `FleetStatus` is built from, and the new facts probably belong
**beside** `question` and `permissionMode` on the row. If the research says otherwise, that is a
finding worth arguing, not a licence.

**And the rule the whole tool runs on.** Every one of these signals has a negative case that is
ambiguous, which is the mistake this project made three times in one night. *"No sleep found"* and
*"could not look"* are different facts. **A `cannot-tell` arm, with a reason, or it is not built.**

#### What the research found, 2026-09-08 — read this before designing anything

The research pass is done, on the live box, with spikes rather than reading. **Two of the four
premises above were wrong, and both were mine.**

**The `waiting` arm is narrower than I said, and the correction makes the stage bigger.** I wrote that
it fires on a foreground `sleep`. It needs three things together (`scripts/gjd-remote-tmux.ts:516–543`):
a well-formed uuid, the pane process being a `/gjd-remote/jobs/` script, **and** the sleep being that
pane process's *direct child*. Proved by three spike sessions, not by reading: `sleep 900` under a
jobs script with a `CLAUDE_SESSION_ID` reads `waits 14m`; the byte-identical tree without the id, and
a bare `sleep 600` as the pane process, both read `shell busy`. And the `claude` branch is tested
first regardless, so a live Claude wins unconditionally. In the case Greg means, the real tree is

    sleep 15  ←  /bin/bash -c source …/shell-snapshots/…  ←  claude --session-id …  ←  pane

so the sleep is a **grandchild** and the branch could not fire even if the ordering allowed it.

**The states are mostly hiding under `idle`, not `working`.** A 32KB transcript tail across the 14
live Claude sessions — 9ms for all of them — found **a pending `CronCreate` wake-up on 8 of the 11
idle rows**, reactivating in 23 minutes, 203 minutes, and so on. A rate-limited session lands on
`idle` too: it prints the error, ends its turn and stops. This is v0.4d's finding one level down, and
it means the stage's value is mostly in splitting `idle`, not `working`.

**The cost objection was against a number nobody had measured.** Live `tookMs` is **3013**, not the
~13 seconds I quoted; all 20 pane captures cost 147ms; a transcript *tail* is 9ms at 32KB and 116ms at
512KB. `server.ts:18` warns off transcripts because whole files are 1.5–19MB — **a tail is a
different act**. Cost gates nothing here.

**Where each state is actually visible:**

| State | Best source | How good | Cost |
|---|---|---|---|
| Hit usage limits | Transcript tail — **fully structured**, no regex: `error:"rate_limit"`, `apiErrorStatus:429`, `quotaLimits{status, resetsAt, rateLimitType}` | Exact. 140 such records across `~/.claude/projects` | ~1ms/session |
| | The pane says `You've hit your session limit · resets 7:30am` | Until it scrolls; the time carries no date | free |
| | `claude agents --json` | **Blind — no vocabulary for it** | — |
| Paused on a cron | Transcript tail: a `CronCreate` `tool_use` carrying the expression | Good; needs dedupe on `tool_use.id` and must honour `CronDelete` | ~1ms/session |
| | Anything else | **Nothing.** The tool's own result says *"Session-only (not written to disk, dies when Claude exits)"* — no store to read | — |
| Parked in a shell call | `~/.claude/sessions/<pid>.json` → `status:"shell"` + `statusUpdatedAt` | Strong: held `shell` for 6+ minutes while `claude agents --json` said `busy` | 0.9ms for all 14 |

**The find that matters most.** `~/.claude/sessions/<pid>.json` is the store behind `claude agents
--json`, and **the CLI throws away two fields**: `statusUpdatedAt`, which is dwell time — one row read
`busy` for 2,293 seconds — and a fourth status value, `shell`, which the CLI normalises to `busy`.
`get-ready-for-deploy` was `shell` for six minutes with `sleep 10`/`sleep 20` descendants while the
board said **Working**. That is precisely Greg's complaint, and the fix is a field that already exists
and is discarded one layer above us.

**Named honestly:** that is an undocumented private file. This repo already depends on that class
(`transcript.ts`, the `aiTitle` grep), and a Claude Code upgrade can change it under us. The boring
alternative for dwell time is for the server to remember its own previous snapshot — no private
dependency, blind before the last restart. `status:"shell"` has no such alternative.

**Overdue is computable, and it is the most actionable thing on the board.** Worked example from that
morning: `30d04781` hit its limit at 06:02 with `resetsAt` 06:30, and the next record is a human
typing "Continue" at **08:21** — 111 minutes of a session that could have gone again and nobody told
it to. *Fired* and *overdue* are told apart by whether any session turn exists after the time.

**The recommended shape, respecting v0.4d — one added fact, no eighth status arm.** The researcher
looked for an argument against that decision and did not find one: a cron-parked session is genuinely
`idle` (it is at a prompt, and typing at it works), and so is a rate-limited one. And a correction to
this doc: there are **five** exhaustive switches on `FleetStatus`, not four — `modeApplicability` in
`collect.ts:292` is the fifth.

    type Pause =
      | { kind: "none" }
      | { kind: "rate-limited"; limit: "five_hour" | "seven_day"; resetsAt: string; overdue: boolean }
      | { kind: "scheduled-wakeup"; at: string; overdue: boolean; source: "cron" }
      | { kind: "in-a-shell-call"; sinceMs: number }
      | { kind: "cannot-tell"; why: string; cause: PauseUnknownCause }

with six distinct `cannot-tell` causes, of which **`tail-window-exhausted` is the one that will
bite**: we read 32KB without reaching the start of the file, so older evidence may exist above, and
folding that into `none` is the ambiguous-negative mistake this project made three times in one night.
`overdue` may be set **only** when `at` was actually read.

**What could not be found out, said plainly rather than papered over:**

- **No live rate-limited session was seen**, and **no pane fixture of one exists anywhere in the
  repo.** Everything about the pane side of that state is reconstructed from historical transcript
  records. Quota was deliberately not burned to make one. The cheap honest route is to capture it
  opportunistically the next time the box hits a limit; the strings are `hit your session limit` and
  `hit your weekly limit`.
- `status:"waiting"` was never observed in the session store, because no session was on a dialog. That
  the store uses the CLI's token is an assumption.
- The `CronDelete` path was not tested, so a pending cron found in a tail may already have been
  cancelled.
- Nothing was measured under the box's load spikes; all timings are from a quiet-ish 10:25.

- [x] **Research first, and from evidence.** Done, 2026-09-08 — three spike sessions, four live
      process trees, a 32KB tail across 14 sessions, and the session store. Findings above.
- [x] **Spikes with dummy sessions** — three `v04h-*` sessions, all killed by name afterwards. They
      are what corrected the `waiting` claim; reading the code alone had produced the wrong answer.
- [ ] **Fable on the product shape**: how many states a person can hold in their head at a glance,
      and what "overdue" should do to the sort order. That is a product call, not a technical fork.
- [ ] **The reactivation time, and whether it is overdue** — Greg asked for it specifically, and the
      answer is **yes, exactly, and only from the transcript**: `quotaLimits.resetsAt` is unix epoch
      seconds and needs no parsing; a cron expression resolves against the record's own `timestamp`
      (next occurrence at or after — the expression carries no year, so assuming one is a bug). A
      recurring or non-literal expression (`*/5`) must yield **no** time rather than a wrong one.
      "Overdue" is a claim: an intended time we could not read is not an intended time of zero.
#### Fable's product call, 2026-09-08 — and it corrects the premise the stage was written on

**A rate-limited session does not come back by itself, and that changes everything downstream.** The
stage was framed as three flavours of "paused". Fable's reading, from the research's own evidence: a
cron, a `sleep` and the launcher's `waiting` arm all resume unaided at time T; a 429'd session **ends
its turn and stops**, and nothing re-prompts it until a person types *Continue*. So it is not *"back
at 06:30"*, it is *"can resume from 06:30, and won't unless nudged"* — which means **every
rate-limited session becomes overdue at `resetsAt`, deterministically.** The 111 minutes measured that
morning were not an unlucky morning; they are the default outcome.

*(One thing that rests on: that no Claude Code version on this box auto-retries after a reset. The
research observed that it does not. Worth re-checking before this ships, because the whole argument
turns on it.)*

**The reader holds three questions, not eleven states** — *does it need me*, *is it moving*, *will it
come back by itself and when* — and that is the same number of pills as today:

- **needs you** (loud) — a dialog, a question in prose (v0.4d), **or overdue**
- **working**
- **paused · back in 23m** — cron, sleep, launcher-wait, all one word with the reason in the detail slot
- **paused · can resume 06:30** — rate-limited, phrased differently *because the promise is different*
- **idle** — nothing pending that we could find
- **unknown**, and the greys, unchanged

`waiting 2h13m` is already "paused" in all but name; merge the rendering rather than adding beside it.
Which limit it is (5-hour or 7-day) is a fact about the **account**, not the row — say it once in the
header, not on six rows.

**Overdue goes in the loud colour, and the argument is made against the principle rather than around
it.** The loud colour means *only a person can move this, and it is one tap*. Overdue is exactly that
— a user turn, not a permission, and reversible. A badge on a quiet pill is what the loud colour
exists to save a person from scanning thirty rows for, and a header that said *"0 need you"* over six
stopped sessions would be a calm page over a wrong one. Two guards so it does not dilute the colour:

1. **Overdue is claimed only when the time was READ, is past, and the transcript shows no activity
   after it.** A transcript we could not read past T is *"could not tell whether it resumed"* and
   stays quiet. **The one row we cannot vouch for is the one row that must not shout.**
2. A few minutes' grace, named in code, because crons fire late on a box that has reached load
   average 391.

**An unreadable reactivation time is shown, and it costs no line** — it lives in the slot the pill
already has: `paused · back in 23m` / `paused · scheduled, time unread` / plain `idle`. The shrug
appears only where a schedule was *found and not parsed*, not beside eight rows in twenty, and it
carries a real message: *this one can never go loud, so it is yours to glance at*.

**What Fable would drop, and this is the part worth obeying:**

- **"Working but parked in a sleep loop."** `working` is *true*, and the reader's question — does it
  need me — is answered correctly. Six minutes is noise beside 34.9 hours. **This is the finding I
  was most pleased with and it is the one to cut**, which is what asking was for.
- Reason as a visual distinction (cron vs sleep vs limit). One pill; reason in the detail view.
- Overdue heuristics for the unreadable case. By construction it cannot exist.
- Anything from `.cachedUsageUtilization` — the direction doc already ruled it untrustworthy, and the
  transcript's 429 record is the only honest source.

**So the stage ships two things**: `paused` with a readable time, and `overdue` in the top band with a
one-tap **Continue**. Everything else is detail-view material.

**The overdue row, in Fable's words**, because the wording is the product here:

> Pill **needs you**, loud. Then one line: *"Hit the 5-hour limit at 06:02. Resumable since 06:30 —
> nothing has run since, 1h 51m late."* And one button, **Continue**, which sends that literal word
> through the existing steer path and is labelled as a nudge, not an answer.

Four facts, each **read** rather than inferred: what stopped it (the transcript's 429), when it became
resumable (`resetsAt`), that nothing has happened since (no record after it), and how late. Never
*"will resume at"*, because it will not. And when the transcript could not be read past `resetsAt`,
the same row says *"Resumable since 06:30 — could not read whether it went on"* and stays quiet.

**One open question this creates for the Overseer (v0.6b):** *Continue after reset* is a verify-not-
judge action, so it is the first thing the coordinator should do by itself. The loud row is the
interim, not the destination.

- [ ] Red test first, mutations after, and a GPT Sol review at the end of the stage, which is
      obligatory here rather than optional — this touches the type five switches are built on.

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

### 🟡 Stage v0.5b: dictation and live chat, ported (dictation landed 2026-09-08, `c2d19b93`; live chat not started)

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

**The Overseer's history is read through a file, and the shape is already decided** —
[overseer-direction.md § The seam is a file, not a function](../project/overseer-direction.md),
written by `orchestrator-setup` on 2026-09-08 so that neither of us negotiates it at the moment of
building. Four files under `OVERSEER_STORE_DIR` (default `~/.overseer`); one writer, lock-free
readers.

- [ ] **Parse `current.json` here; do not import `readCheckpoint`.** `tools/overseer/` already
      imports `collect.ts` and `status.ts` from this directory, so an import back the other way
      closes a cycle between the two things the seam exists to keep apart. **The file is the
      contract and `readCheckpoint` is one implementation of reading it.** Agreed rather than
      conceded: it is the same rule the client already applies to the server's JSON.
- [ ] **Check `schema` as the number it is, not as "not something else"**, so an unknown schema
      renders as *I cannot read this* rather than as a page with fields quietly missing. That is
      `parseMeta`'s rule (`web/src/types.ts`) pointed at somebody else's file.

      **`STORE_SCHEMA` IS `2` AS OF 2026-09-08, AND IT MOVED WHILE THIS LINE SAID `1`** — inside the
      hour between the seam being agreed and anything being built against it. That is the rule
      earning its keep on its author within a morning: a consumer pinned to 1 would `Date.parse` a
      `statusSince` that is now an object, get `NaN`, and render a blank age — **wrong, not merely
      poorer**. Read the constant, do not hardcode the digit from this doc, which has now been stale
      once already. The bump is S7-04 of
      [260908b](260908b-overseer-store-and-clock.md), which is where the reasoning lives.
- [ ] **`statusSince` IS NOT A TIMESTAMP — it is a two-armed reading, and the arm names are for a
      person reading the raw file:**

          type StatusSince =
            | { kind: "observed";    at: string }
            | { kind: "lower-bound"; at: string }

      So `less ~/.overseer/current.json` shows `"kind": "lower-bound"` and that says what the number
      is worth without opening any types. Render it as `40m` against `≥13m`; **sort ignoring the
      arm**, because a floor can only rank a session too low and can never promote one above a
      session that deserves attention more.

      **AND `observed` MEANS "BETWEEN TWO OF OUR OBSERVATIONS", NOT "AT THIS INSTANT".** Found by
      GPT Sol reviewing the fix, and left open rather than fixed because it cannot be fixed in
      `store.ts`: across a daemon restart the first new snapshot is diffed against a restored
      baseline, so a state that began and ended during three hours of downtime is recorded as
      `observed` at the moment the daemon came back. It is the same class as the bug that arm was
      created to prevent — a number that reads as a measurement — but **bounded by the downtime
      rather than unbounded**, and `Restart=always` makes restarts routine. `orchestrator-setup`'s
      recommendation, which I accept: render `observed` as exact and accept one wrong tick per
      restart, rather than hedging every duration on the page. **Choose it knowing that, rather than
      inheriting it.**

- [ ] **Three fields are worth more than the rest, because collection structurally cannot produce
      them.** `statusSince` turns a state into a duration — *blocked* becomes *blocked for forty
      minutes*, which is what triage actually needs and what a present-tense collector has no
      yesterday to compute. **It is a pair, not a timestamp**:
      `{ kind: "observed" | "lower-bound", at }`. `observed` means the Overseer watched the
      transition; `lower-bound` means the session was already in that state when it first looked, so
      the duration is a floor with no upper bound — render the two differently (`overseer status`
      prints `40m` and `≥13m`). A renderer that shows a floor as a measurement is the 13m bug, which
      is what S7-04 was. `heartbeat` lets the page say **the Overseer is dead**, which belongs
      where the count would be rather than in a footer, because a quiet page and a healthy fleet are
      the same picture. And `writtenAt` against `lastGoodSnapshotAt` tells *deaf* from *dead* — the
      second is our own `collectedAt`, so a disagreement there is as likely to be about us.
- [ ] **`current.json` is written atomically** — temp file in the same directory, a `writeAll` loop
      because a short write is rare rather than impossible, `fsync`, `rename` over the target. So a
      reader sees the whole old file or the whole new one and never a seam. Confirmed from the code
      by `orchestrator-setup` on 2026-09-08 after we asked: without it, "lock-free reads, one writer,
      never wrong about the past" would not hold, and the failure would have been a truncated JSON
      that happens to close and parses *successfully* — landing on this side looking like our parser
      being flaky.
- [ ] **The history files forgive the LAST line and only the last.** One record per write on an
      `O_APPEND` fd, looping until every byte lands, so a short write cannot tear a record — but a
      process killed mid-loop can. The daemon truncates to the final newline when it opens the file,
      and **skipping bad lines anywhere is not a substitute for that**: the next append welds a good
      record onto the broken bytes, so one append later the malformed record is no longer last, and
      a reader that forgives everywhere silently loses a good record too. Forgiving only the final
      line degrades correctly; forgiving everywhere launders corruption into history.
- [ ] **The store does not exist yet.** Every Overseer run so far used a scratch root under a
      session scratchpad; `~/.overseer` is absent and `overseer status` reports *NEVER RUN*
      (measured 2026-09-08). Nothing about the seam changes — but the file this stage reads has
      never been written where it will be read, and closing that is the systemd stage's acceptance
      rather than work for this one. Do not build a reader against a path and then report it working
      because it degraded politely.

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

### Stage v0.7a: the page says which code it is

**A stale client bundle is served silently, and the systemd unit makes that likelier rather than
less likely.** The unit's `ExecStartPre` rebuilds only when `tools/fleet/web/dist/index.html` is
*missing* — right, because with `Restart=always` an unconditional build is a vite build every ten
seconds through a crash loop on a box that has reached load 391. The cost is that **missing fails
loudly and stale does not**: a `dev` that moves the client without a rebuild leaves the old bundle
in place, and the page serves it with nothing in any log to say so.

This is the same failure that cost the night of 2026-09-08 from the other direction — the server on
8787 predating its own code for five hours while everything was committed, pushed and green. **A
deploy is not a commit, and on a long-running server it is not a build either.** The fix that worked
there was to make the fact visible rather than to make the mistake impossible: `attemptedAt` moves
whether or not a collection completes, and `answeringEnabled` is told rather than inferred.

- [ ] **The server reports its own identity** — `git rev-parse HEAD` of the checkout it is running
      from, and its process start time, in the payload the page already polls.
- [ ] **The bundle reports its own identity**, stamped at build time, so the two can disagree.
      One value each; the page compares them.
- [ ] **A disagreement is shown, not logged.** Whoever needs to know is looking at the page, and a
      line in a log on the box is exactly the place the last one hid for five hours.
- [ ] **Do not make it fatal.** A page that refuses to render because its bundle is behind is
      unavailable at the moment it is most worth having, which is the same argument that put the
      unit in the primary checkout. Say so and carry on.
- [ ] Proposed by `orchestrator-setup` while writing the unit, and taken rather than argued with:
      the failure it catches is specifically the one where *somebody else* deploys, which is
      precisely the case neither session can test for itself.

### Stage v0.7+: the decision log

Deferred by Greg on 2026-09-08 — "eventually both, start simple, defer this to a middle stage".
Agents self-report through a small CLI plus a rule in [AGENTS.md](../../AGENTS.md); a transcript
scrape later as the backstop. Ranked by importance then confidence, product-facing counting as more
important. The dashboard makes decisions *visible*; it does not enforce the thresholds.

### 🟡 Stage v0.8a: the joins, which nothing here has ever checked (the module landed 2026-09-08, `3df3e833`; the migration is one endpoint of four)

**Sixteen times in one day, a part was built, tested, reviewed and ticked while the line joining it
to anything was missing** — including, for several days, **the dashboard's entire action vocabulary**,
which never once rendered on the real page because the server sends `actions: {session, box}` and the
client asked `Array.isArray()`. Neither commit introduced it: the server side landed in `0955fab4`
and the client side in `18800ff6`, each internally coherent, so no reviewer of either diff could have
seen the pair. **Ten of the sixteen are lossy joins and six are missing edges, and the lossy half
holds every expensive one** — which is why the first half of this stage is a type rather than a
check. The write-up is
[260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md);
this is the rearchitecting it asks for. Filed at the finish line is filed and never done, so it is a
stage.

**Seven of the sixteen were live at 11:03 on 2026-09-08, and two of them were safety mechanisms.
✅ BOTH OF THOSE TWO ARE NOW FIXED** — during the wave, by other sessions, and this paragraph told
whoever read it next to go and fix them again. Re-measured on the evening of 2026-09-08 before
briefing anybody, which is the only reason it was caught:

- ✅ **The attribution prefix reaches the wire.** `SessionActionRequest` carries a `speaker`
  (`routes-actions.ts:395`, parsed at `:439`), `Speaker` is in `wire.ts`, and `drain.ts:292` returns
  `renderSpoken(action, item.speaker)` from `sendable()`. It had six test callers and zero product
  callers; it now has one, on the path that matters — the single-session instruction, which is how
  the Overseer talks to an agent.
- ✅ **The "what would this destroy" preview says so when it cannot.** `routes-actions.ts:1148` sends
  `result: { steps: built.plan.steps }` on a dry run, so the client's read finds a value. And the
  empty case no longer draws the literal grey word *"null"* in the shape of an answer: it is a
  sentence in the alarm colour naming what is missing, **and the Confirm button is not offered at
  all**. A confirmation that cannot say what it would do no longer looks like one that can.

**The lesson is about this document rather than about that code.** Both entries were true when
written and false by the evening, and nothing in the repo would have said so — a plan is exactly the
artefact `260908f` warns about: authored to be trusted later, in a place nobody re-derives. The next
agent to open this would have briefed a subagent to fix two things that are not broken, and the
subagent would have found working code and either invented a problem or reported confusion. **Re-grep
a plan's factual claims before acting on them, especially the ones marked urgent** — urgency is what
makes a stale claim get acted on without checking.

The other five live ones: `SteerResponse.verified` (which pane the send was aimed at, as the server
verified it in the moment BEFORE typing — not where the keystrokes ended up; dropped by
`steer-client.ts`), `answeringEnabled`/`tmuxServerPid` (absent from the client's `FleetState`),
`LaunchRecord.resolution`/`startedDir`, `SteeringQueue.clear()`, and `/api/agents`.

**There are two classes here and they want different things, which is the whole design of this
stage.** Confusing them gets you a linter for a problem the compiler should have refused.

- **A missing join** — `queue.next()`, `/api/messages`, `revive()`, `renderSpoken()`, `clear()`,
  `/api/agents`. The edge does not exist. The detector is a question about the graph — *who reads
  this?* — and no type can express "somebody must call this". **Wants a tool.**
- **A lossy join** — `stale`, `stuck`, `deliverable`, `invalidated`. The edge exists and the
  consumer drops the value. The detector is a question about one type — *can the consumer express
  dropping this?* — and the repair makes the mistake un-writable rather than detectable.
  **Wants a type.**

#### The type half, and it is the item worth doing first

- [x] **`tools/fleet/wire.ts`, a leaf module with no imports at all**, holding `QueuedItemView`,
      `QueueView` and the other types that cross the HTTP boundary. **The no-imports rule is forced,
      not stylistic**: `tools/fleet/web/tsconfig.json` is a separate project with no node types, and
      every existing home for these types reaches `node:child_process` transitively (`queue.ts` →
      `steer.ts`; `status.ts` → `scripts/gjd-remote-tmux.js`), so a client `import type` against any
      of them fails on sight. That is *why* the twins exist — the duplication is structurally
      forced, which is why four rounds of "keep them in step" have not worked.
- [x] **The client DERIVES from it. It does not adopt it, and this line used to say the wrong
      thing.** It said `parseQueue` returns the imported type; building that would have shipped a
      bug. The client's `QueueView` is *deliberately weaker* than the wire's — `deliverable: number
      | null` where the wire says `number`, and `stale`, `stuck` and `speaker` all nullable —
      because **a server too old to send a field has made no claim**, and returning the wire type
      verbatim would force `parseQueue` to invent `false` or `0` for it. That is instance 16, the
      one this whole stage is about, reintroduced by the fix for it. The form that works is
      `Omit<QueueViewWire, …the fields it re-types or declines…> & { … }`: a new **required** wire field
      is not in the `Omit`, so it lands in the client type and the object literal stops compiling,
      and the escape hatch is **adding a name to a list** — a named, reviewable decision rather than
      a silence. *(An OPTIONAL wire field crosses untouched — GPT Sol's M2, 2026-09-08. Both object
      literals may omit it, so neither end goes red. The mechanism is therefore paired with a
      compile guard in `tests/fleet-compile-guards.test.ts` that refuses an optional top-level key on
      the shared wire state; the guarantee is "required fields are carried by construction, optional
      ones are refused at the door", and this line said the first half only.)* The twin is derived, not deleted, and that turned out to be the correct end state
      rather than an interim one.
- [x] **Prove it against the original shape, not a tidied one.** Done twice, and the second time by
      hand. Adding one field to `QueueView` in `wire.ts` turns **both** ends red —
      `routes-actions.ts:1019` and `actions-client.ts:471` — with the mutant asserted present
      exactly once before the run and zero times after, and the file restored byte-identical. Also
      proved against the exact shape of instance #4: a field added to `QueuedItem` crosses on
      `{...i, stale, stuck}` with **no line written at the boundary**, so the server does not error
      and the *client* does. That is the case a reviewer cannot see and a spread cannot be blamed
      for.
      **The probe itself nearly lied**, which is worth more than the result: its first version read
      `subprocess.run(...).stdout`, and `npm run typecheck` writes passing projects to stdout and
      **failing ones to stderr** — so it printed two ✓ lines, reported "TYPECHECK WENT RED: False",
      and would have disproved a mechanism that works. Judge that command by its exit code.
- [x] **The no-imports rule enforces itself, which was not expected.** The client project compiles
      wire.ts's entire transitive closure under DOM-only libs, so appending a single `import type` to
      `wire.ts` turns `npm run typecheck` red immediately. Measured. Two residual holes, both small
      and both written into the file's header: the errors name the *leaf that was reached* rather
      than `wire.ts`, so a reader is sent to the wrong file; and an import of a genuinely import-free
      leaf (`config.ts`, `origin.ts`) would compile and could put a runtime `const` in the browser
      bundle. A ~30-line test modelled on `tests/client-imports.test.ts` would buy the *error
      message*, not the enforcement.
- [ ] **The remaining two endpoints.** The module landed with queues (`Speaker`, `SpokenActionId`,
      `SpokenAction`, `QueuedPayload`, `QueuedItem`, `QueuedItemView`, `QueueView`); **`FleetState`
      followed on 2026-09-08 as v0.8b**, and with it the four fields the client had been dropping.
      Left: the actions catalogue, and steer/new/messages/rename. Split by endpoint, one stage each,
      each typechecked and its own suite run.
      **`FleetState` is generic — `FleetState<Row, Health>` — and whoever does the next one should
      copy that rather than the queue's shape.** `rows` and `health` are holes because the types that
      fill them (`collect.ts`'s `FleetRow`, `health.ts`'s `HealthReport`) reach `node:child_process`,
      which wire.ts may not import; the server fills them with its own types and the client with its
      projection. Everything outside those two fields is shared, and that is where all six dropped
      fields were. Proved by mutation: one **required** field added to the wire type turns the server
      project, the client project *and* the fixtures red, judged by `npm run typecheck`'s exit code.
      An **optional** one turns none of those red — measured 2026-09-08, and the reason the compile
      guard above exists. `FleetState<Row, Health>` also lost its `= unknown` defaults that day, so a
      caller has to say what it is putting in each hole rather than inherit two it may not know are
      there.
- [ ] **`FleetRow` will NOT migrate the way the others do, and whoever starts it should know
      first.** `FleetRow.meta` resolves to `scripts/gjd-remote-tmux.ts`'s `SessionMeta` (`kind:
      SessionKind; repo: string; dir: string`) while the client's says all three nullable — and
      `Session.created` is a `Date`, which does not survive `JSON.stringify`. So the wire type for
      that surface is **not the server type; it is a JSON projection of it**, and sharing it verbatim
      would be wrong rather than merely impossible. It also reaches out of `tools/fleet/` into
      `scripts/`, which is a wider blast radius than the postmortem implies.
- [ ] **The other four modules publish through it too.** Agreed 2026-09-08 with `orchestrator-setup`
      (Overseer store types), `w2-usage-limits` (`RateLimitHit`, `UsageWindowReading` and the rest of
      the usage contract), `w2-harness-adapter` (the *capability* half of the harness types; the
      `Harness` union and `classifyPaneHarness` stay in `tools/overseer/harness.ts`) and
      `w2-fleet-dictation` (the transcribe request/response). `~/.overseer/current.json` is the same
      kind of boundary with none of the protection, and it is the **worse direction**: a wrong read
      draws a wrong page, a wrong write runs — or fails to run — a destructive command.
- [x] **Fix the live lossy joins while you are in there** — `verified`, `answeringEnabled`,
      `tmuxServerPid`, `resolution`, `startedDir`, **all five read and drawn in v0.8b**, each with a
      test whose failure was watched by breaking the read. `would`/`result` (#11, the safety
      preview) was already fixed before that stage started, by whoever wrote
      `routes-actions.ts:1148` and `actions-client.ts:992` — this line went on naming it as live,
      which is the third time this document has done that to a reader. The queue cluster (`stale`,
      `stuck`, `deliverable`, `invalidated`) was repaired by hand on the night of 2026-09-08, four
      separate times; **that treadmill is the argument for this stage**, not a reason to think the
      area is now safe.
      **`attemptedAt` was declined in v0.8b and read in v0.8b's fix pass**, and the reasoning for
      declining it was wrong rather than merely cautious. It ran: reading it honestly needs
      `readAttemptClock`'s three arms (absent means either *never attempted* or *a server too old to
      report it*), that is a runtime value, wire.ts cannot hold a runtime value, so both sides cannot
      share one. The middle step does not follow — **what the browser project cannot tolerate is a
      NODE dependency; "no runtime values" is wire.ts's own rule about its own file.** So
      `tools/fleet/attempt-clock.ts` is a leaf module with no imports, the server, the Overseer
      daemon and the browser all import the one implementation, and `Header.freshness` says which
      kind of stale a stale snapshot is: a run that began and hung, or a loop that stopped. GPT Sol's
      M5.
- [ ] **`would` is a different failure from the rest and needs a different check.** Both ends are
      internally consistent and disagree about a *name*, so an "unread field" sweep cannot see it —
      only a shared type can. Fix it by importing the type, not by renaming one end and moving on.
- [ ] Beware the spread. `items: s.items.map((i) => ({ ...i, … }))` puts every field of `QueuedItem`
      on the wire with no line written at the boundary — which is how `invalidated` crossed, and why
      `git log -S invalidated -- tools/fleet/routes-actions.ts` finds nothing.
- [x] **Type the fixtures with the shared type too, and this is not optional.** `actionsWire()` in
      `tests/fleet-web.test.tsx` built `{actions: []}`, a flat array the route has never sent, and
      ~196 tests passed over it while **every action button on the real page was invisible** — under
      a doc comment correctly explaining that the fixture must be the wire shape. *A fixture is a
      claim about the producer that nothing checks against the producer.* A fixture annotated
      `: QueueView` (or built by the server's own serialiser) cannot make that claim falsely.
      **Done for the state payload in v0.8b**, and the shape that worked is worth copying: the
      fixture builder takes `{[K in keyof FleetStateWire]?: FleetStateWire[K] | undefined}` — partial
      because most of these fixtures deliberately ARE payloads from an older server, and `| undefined`
      because `exactOptionalPropertyTypes` otherwise refuses the explicit absence they are testing.
      A fixture that is deliberately malformed goes through a second builder called `malformed()`,
      so reaching for the escape hatch is visible in the diff rather than hidden in a cast.
- [ ] **Prefer a named union to a boolean wherever the client reports on the server.** Two sessions
      independently reached this repair on the same evening: `catalogueOffered: boolean` became
      `CatalogueReading = absent | unreadable | read`, and the Overseer's `Checkpoint | null` became
      `CheckpointRead` taken whole. *Absent* and *present but unreadable* are different sentences to
      a person, and a boolean cannot hold both — which is how a live daemon came to be reported as
      `NEVER RUN`.

#### The tool half

- [ ] **A mounted-route-with-no-client-caller check.** Enumerate the paths `server.ts` and the
      `routes-*.ts` files compare against, grep `tools/fleet/web/src/**` for each, fail on zero.
      **Measured on this tree: 12 paths, 2 raw candidates, 1 real** (`/api/agents`), and the other
      was a self-inflicted false positive because `steer-client.ts:51` writes `"api/steer/message"`
      with no leading slash — so match on substring, not prefix. Small surface, low noise, and it
      needs a short allowlist for the paths the Overseer and `curl` use honestly. **Gate it**, on
      `scripts/check.ts`'s own rule — but note that `/api/agents` was resolved by keeping the alias
      and fixing the prose (next entry), so **it is an allowlist entry rather than a zero**: the one
      real finding on this tree is a deliberate exception now, and the check has to be able to say so
      or it will be turned off the first time it fires.
- [x] **Resolve `/api/agents`**: either delete the alias or fix the five places in `live.ts` that
      still call it "the poll". It is harmless — same handler — and it is the reason the check above
      is not green on day one. **Resolved the second way, 2026-09-08: the prose changed and the alias
      stayed.** Deleting a working endpoint to tidy a name is the worse trade — it costs one clause,
      and a note or a bookmark outside this repo may still hold it. All five occurrences in `live.ts`
      now say `/api/state`, with a paragraph at the top of that file and a comment at the mount in
      `server.ts` saying that `/api/agents` is the original name, retained as an alias, called by
      nothing here. **Which means the route check above still needs its allowlist** — this entry did
      not make it green, it made the reason for the exception written down.
- [x] **`renderSpoken()` reaches the drain.** `speaker` onto `SessionActionRequest`
      (`routes-actions.ts:395`, parsed at `:439`), carried on `QueuedItem`, applied in `drain.ts`'s
      `sendable()` at `:292`. **The wiring landed during the wave and the guard did not**, which is
      the half that matters: the property held and nothing stopped it being un-held. Measured on the
      evening of 2026-09-08 — `tests/fleet-compile-guards.test.ts` had eight `@ts-expect-error`
      guards and not one mention of `Speaker`. Now it has one, asserting that a `QueuedItem` with no
      speaker and one with a speaker this build does not know both refuse to compile, with the pair
      that should compile built beside them as the runtime positive.
      **Verified by mutation, which on this kind of guard means typecheck rather than vitest**:
      making `speaker` optional in `wire.ts` turns the directive unused and
      `npm run typecheck` fails with `TS2578: Unused '@ts-expect-error' directive` — restored
      byte-identical, zero deletions in the file's diff. The failure it prevents is silent: an item
      built without a speaker does not throw and does not look wrong, it just reaches an agent as
      words indistinguishable from Greg's.
- [x] **`clear()` gets a route or gets deleted.** Either is fine; leaving a tested method nothing can
      reach is not. **It got a route** (`POST /api/actions/clear`, `routes-actions.ts`) and a button
      (*Clear the queue*, in `SessionQueue`), 2026-09-08. Two things came out of building it that the
      box did not anticipate. **`keptInFlight` is the feature, not a return value**: `clear()`
      deliberately keeps a leased item, so both the confirmation and the result name what will NOT
      go, by its words — a page that said only "cleared" would be the ambiguous negative this
      postmortem is about. And **the body carries the item ids the reader was looking at**, frozen at
      the tap, so an item queued by the Overseer between the preview being drawn and the tap is
      refused (`stale-view`, 409) rather than destroyed unread; `{sessionId}` alone, which is all
      `clear()` needs, cannot express *the list I read*. Verified by mutation: removing the route's
      call to `clear()` reddens `expected [] to deeply equal [ 'q2', 'q3' ]` in
      `tests/fleet-actions-route.test.ts`, which drives the real client over the real handler.

#### The rule, which is the part that generalises

- [ ] **A file that binds a port may hold dependencies and nothing else.** `refresh.ts` already is
      this, carved out of `server.ts` in `bc2c3e61` precisely because the missing line was in the one
      file no test can import — importing `server.ts` binds 8787, and none of the twenty
      `tests/fleet-*` files imports it. Write the rule down next to `refreshOnce`, and move anything
      that is still an ordering decision inside `server.ts` out to where a test can drive it.
- [ ] **Add "who reads this?" to the stage-completion checklist.** For each value a route computes,
      grep the client for the field name; for each symbol a stage exports, partition the callers into
      product and tests. That question found five of the ten in an afternoon, after the other five
      had been found by Greg opening the page.

#### What this does NOT catch, stated so nobody files it as done

- **A field parsed and then not rendered.** The type half forces `parseQueue` to *read* `stale`; it
  cannot force `ActionButtons.tsx` to draw anything with it. A parser that assigns the field to a
  property nothing displays compiles perfectly.
- **A route called by the client on a page nobody can navigate to.** The route check answers "does
  any client file mention this path", not "can a person reach the component that calls it".
- **Wrong values.** Both halves are about *whether* a value crosses, never whether it is right.
- **The other direction** — a field the *client* sends that the server ignores. Same class, opposite
  arrow; not covered here, and worth a sweep before assuming it is clean.
- **Anything outside `tools/fleet/`.** `tools/overseer/` has the same shape and the same two
  tsconfig projects. This stage does not touch it.
- **`knip` still cannot see any of this.** Adding `tools/**` to `knip.jsonc` is worth doing on its
  own merits and is **not part of this stage**: it catches none of the ten and arrives with 162
  findings, and a fresh backlog that size is how the check that would catch the next one gets
  ignored.

### ✅ Stage v0.4j: the page reads the box's clock with the phone's

**Found by `fleet-health-history` on 2026-09-08, in their own chart, and flagged to
everyone else.** Their version: `Math.max(serverEdgeMs, Date.now())` on the right-hand edge of the
axis, so a phone an hour fast turned a current sample into a one-hour outage — *an outage
manufactured by a clock*. They fixed theirs by letting the server's edge stand.

**It is live here and it is broader.** Every age on this page is
`browserNow − Date.parse(aServerTimestamp)`:

| What | Where | What a fast phone does |
|---|---|---|
| `collectedAge` | `view.ts:71`, via `freshness` | **STALE banner permanently on.** Threshold is 2.5 × cadence ≈ 2m 30s, so a phone three minutes fast is enough. |
| `transcriptAge` | `messages-client.ts` | *"This may not be this session's conversation"* on every working row. Threshold 30 min. |
| `uptime` | `view.ts:79` | Every session reads older than it is. Cosmetic. |
| `LastWrote` | `SessionDetail.tsx` | The header age, and its alarm colour, both wrong. |
| `PauseLine` | overdue duration | The *decision* is safe — `pause.overdue` is computed server-side and this page never recomputes it — but the printed duration is wrong. |

The first two are the expensive ones, because they are **alarms**, and an alarm a clock can
manufacture is the same failure as a caveat drawn on 29 of 32 rows: it is on when nothing is wrong,
so it stops being read.

#### Why the obvious fix is wrong

Subtracting a skew from `useNow()` breaks the comparisons that are **already correct**. `freshness`
computes `heardAge = now − receivedAt`, and both of those are browser-clock values — an
honest measurement of *how long since this page last heard anything*, which needs no correction.
Correcting `now` globally would corrupt it by exactly the skew.

**So the correction belongs at the boundary, not at the clock:** a server timestamp is converted
into browser-clock terms once, where it is parsed, and everything downstream compares in one clock.
That is this module's own rule — normalise at the seam — and it is why this is a stage rather than a
line.

#### What it needs

- [x] **A `servedAt` on the state payload**: the server's clock at the moment it answers. Neither
      `collectedAt` nor `attemptedAt` can stand in — the gap between either of those and receipt is
      *genuine snapshot age*, up to a full cadence, and cannot be told apart from skew. `servedAt`
      minus `receivedAt` is skew plus network latency, and latency here is milliseconds against a
      threshold of minutes.
- [x] **One conversion at the parse boundary**, applied to every server timestamp the client reads —
      `collectedAt`, `startedAt`, `lastModified`, `pause.at`, `pause.resetsAt`, and since v0.6f
      `attention.coordinatorWrittenAt` and `attention.list.scannedAt`. Not to `receivedAt`, which is
      already the browser's.
- [x] **Say it out loud when the skew is large.** A phone minutes off is worth one line on the page,
      because it is a fact about the reader's device that nothing else will ever tell them, and
      because it explains any residual oddness. Silence here would make a corrected page and a
      broken clock look identical.
- [x] A test that fixes the browser clock some minutes ahead of the server's and asserts the STALE
      banner does **not** appear. Watched failing first: without the correction it appears.

**Built 2026-09-08**, and two things came out different from the write-up above.

**`lastModified` is not on `FleetState` and never was.** It arrives on `/api/messages`, a second
boundary with no clock of its own — so it is corrected by the skew `/api/state` measured, applied by
a `withClockSkew` wrapper around the `MessagesApi` in App.tsx. A `servedAt` on that route too was
rejected: it is a second measurement of one fact, the two would differ by a few milliseconds of
latency, and a page whose transcript ages and snapshot ages were corrected by different numbers is
harder to reason about than one corrected by the same number. The alternative was drilling a `skew`
prop through four components that have no business knowing about clocks.

**`AttentionPanel`'s tolerance shrank rather than vanishing, and the constant it left behind is a
different fact.** `CLOCK_SKEW_MS` is deleted as the stage says. What replaces it is
`RENDER_SLACK_MS = 5_000`, and it is not an allowance for a device: `useNow` ticks once a second, so
a render triggered by an arriving payload compares a just-corrected timestamp against a `now` up to
a tick old. With a hard `age < 0` refusal, a checkpoint written moments before it was served flashes
*"at a time this page could not read"* on a healthy fleet — the alarm-a-clock-manufactures failure
with a different clock in it. One tick plus room for a slow render, two orders of magnitude below
the five- and six-minute thresholds it must not swallow.

Every new test carries its own positive control — the same fixture minus `servedAt`, which is
exactly the pre-stage build — because *no STALE on the page* is also what a blank page says. Two
mutations were run: disabling the shift reds 4 of them with the intended assertions, and forcing the
skew to `unknown` reds 5.

#### v0.6f raised the price, and paid a deposit that this stage collects

The attention panel decides whether to say *nothing is waiting on you* by asking how old the scan is,
so a phone whose clock is minutes ahead can make a live inbox read as a dead one — the same alarm-a-
clock-manufactures failure as the STALE banner, on the panel the page exists for.

GPT Sol's C2 caught the sharp edge of it: `ageMs` clamped a negative age to zero, so a timestamp
*ahead* of the browser read as **"0s ago" forever** and suppressed the staleness check permanently.
That is fixed. What it was fixed WITH is a placeholder: a flat `CLOCK_SKEW_MS = 2 * 60_000`
allowance, beyond which a timestamp is treated as unreadable rather than fresh. Two minutes is a
number chosen for being obviously generous, not measured — it is wrong in the safe direction and it
is still wrong.

**This stage deletes that constant.** Once a server timestamp arrives already in browser-clock
terms, a future `scannedAt` means a genuinely broken clock rather than an ordinary phone, and the
panel can say so instead of tolerating a window.

### ✅ Stage v0.6f: the attention inbox has a producer and no consumer

**This is a live instance of the class this whole plan spent 2026-09-08 removing**, and it is mine.

`w2-attention-inbox` built the deciding half — `tools/overseer/attention.ts`, ranked, duplicate-
collapsed, with a `sessionsUnreadable` floor and an `unknown` arm that refuses to publish a calm
inbox off an incomplete pass. The types are in `wire.ts` (`AttentionList`, `AttentionItem`,
`AttentionEvidence`, `AttentionKind`, `AttentionAnswerability`). The seam was negotiated in detail:
they decide and sort, this page renders, and I said so.

**And nothing renders it.** Measured 2026-09-08 16:05:

    grep -rln "AttentionList|AttentionItem" tools/fleet/web/src/   →  (nothing)
    grep -rn  "attention"                   tools/fleet/web/src/   →  (nothing)

Worse than a missing component: **the fleet server cannot see the data at all.** The list is written
to `~/.overseer/current.json` as a field on `Checkpoint`, and nothing in `tools/fleet/` reads that
file — `grep -rln "Checkpoint" tools/fleet/` finds nothing. So there are two missing edges, not one,
and the type check cannot see either: a type nobody imports is not an error.

That is exactly
[260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)'s **Class
A**, a missing join — *"the edge does not exist; the detector is a question about the graph, and no
type can express 'somebody must call this'"* — and it was created **on the day the postmortem was
written**, by the person who wrote it, through the mechanism the postmortem names: two halves each
internally coherent, each reviewed, joined by an agreement in a conversation rather than by code.

`wire.ts` does not help here and was never going to. It holds the SHAPE across a boundary that
exists; it has no opinion about a boundary nobody crossed.

- [x] **The fleet server reads the Overseer's checkpoint** — `tools/fleet/attention.ts`, its own
      parser, taking only `schema` / `writtenAt` / `attention`. **Both halves of what this box first
      said were wrong and the review caught them.** It said "a `CheckpointRead`-shaped result", which
      meant importing the Overseer's parser and closing a cycle the seam exists to prevent; and it
      said an absent file renders as *the coordinator is not running*, which is a positive claim an
      absent file cannot support. The arm is `checkpoint-absent` and it says **no checkpoint has been
      published here** — the coordinator may be starting, running against another root, or failing
      before its first write. Never an empty inbox, which was the box's one correct instinct.
- [x] **A route or a field on `/api/state`.** Prefer the field: the inbox is the thing the page
      exists to show, and a second request for it is a second thing that can be stale on its own.
- [x] **The client parse, deriving rather than adopting**, with its own fifth state
      (`feed-unreadable`) for a field that is present but wrong — because "this server did not look"
      is false about a server that looked and sent something unreadable. **`sessionsUnreadable` is
      NOT defaulted to `0`**, which is what this box originally said: a `list` arriving without it
      degrades to `unknown` with the reason. Zero is a positive claim that every attempted judgement
      succeeded, and nobody made it. The same default was a live defect in the producer's own parser,
      found by this review and fixed by `orchestrator-setup` in `290b1ac3`.
- [x] **The render, holding three agreements made with `w2-attention-inbox` and `orchestrator-setup`
      and written down here so they survive the conversation:**
      **(a)** a `prose` item gets **no answer control at all** in v1 — it is inferred from a pane
      tail, and their `readTurnTail` bug proved a card could quote *Greg's own last message* back as
      an agent's question, so a button would have acted on his sentence;
      **(b)** the producer sorts and the renderer must not re-sort;
      **(c)** `sessionsUnreadable` renders **only when non-zero**, and when it does the count reads
      as a floor — *"AT LEAST 4 need you… (1 could not be judged, so there may be more)"* — because
      a sentence and its retraction in the same block is worse than either.
- [x] **A test that fails if nothing imports it.** The lesson of the class is that the join is the
      thing to check, and the check is *who reads this?*

**Cost of leaving it:** the wave's headline feature is invisible, and it will stay invisible while
looking finished from either end. Every part has tests and passes them.

#### What the design review changed, and the version we are not building

The first design had the fleet server call `readCheckpoint()` from `tools/overseer/store.ts` and map
its three arms. **GPT Sol refused it, against documentation this session had not read.**
[overseer-direction.md § the store](../project/overseer-direction.md) already said the dashboard must
parse `current.json` itself, and gave the reason: `tools/overseer/` imports `collect.ts` and
`status.ts` from `tools/fleet/`, so the reverse import closes a cycle between the two things the seam
exists to keep apart.

The stronger argument turned up while checking that one, and is now written into that paragraph:
`parseCheckpoint` fails the **whole** checkpoint on one malformed register entry, so the import would
have rendered an unrelated bad register field on this page as *the coordinator is unreadable* while
the attention list sat there intact. Independent parsers keep the Overseer's register problems the
Overseer's. **The file is the contract; the function is one implementation of reading it.**

So `tools/fleet/attention.ts` parses only the projection this tool needs — `schema`, `writtenAt`,
`attention` — and checks `schema` as a number it knows rather than as "not something else".

Four more findings, each of which changed the shape rather than the code:

- **`no-coordinator` became `checkpoint-absent`.** An absent file proves only that no checkpoint
  exists at the configured path — not that the coordinator is down. It may be starting, running
  against another root, or failing before its first write. Same discipline as `Pause`'s `none`.
- **The reader must be incapable of throwing, root resolution included.** `storeRoot()` throws on a
  relative `OVERSEER_STORE_DIR`, and `deps.publish()` in `refresh.ts` sits *outside* the try/catch
  that guards collection — so a throw out of `statePayload()` ends the refresh loop and leaves the
  dashboard wearing its last good timestamp. The silent stall `attemptedAt` exists to expose.
- **`fleetState()`'s new parameter is required, not optional.** Optional-to-keep-callers-compiling
  is precisely the escape hatch that let this bug exist: a production join that can go missing with
  nothing going red. Backward compatibility belongs at the HTTP parse boundary, where an older
  *server* omits the field — not in the current server's composition root.
- **The join test as first written was green by construction.** Hand-wiring
  `readAttention → fleetState → parseFleetState → App` inside a test stays green after `server.ts`
  stops calling the reader: the test has rebuilt the missing edge itself. That is shape 4 from
  [260908e](../postmortems/260908e-a-fixture-that-means-now-decays-into-the-state-it-asserts-against.md),
  reached while fixing an instance of Class A. The payload composition therefore moves out of
  `server.ts` into `state.ts`, and the test drives the function production composes through.

#### What the first real pass taught us, which no fixture would have

The Overseer was restarted onto current code at 15:36 and published a real list three minutes later.
Measured from `~/.overseer/current.json` rather than described:

    items=2 · sessionsScanned=11 · sessionsUnreadable=1 · both items `prose` · both `answerability: phone`

- **`sessionsUnreadable: 1` on the first live pass.** The floor phrasing is exercised against real
  data on day one instead of against a fixture written to agree with itself — and a wild `0` would
  have hidden the false-zero defect in the producer's parser (fixed by `orchestrator-setup`,
  `290b1ac3`) for longer.
- **The excerpts are 1,116 and 1,736 characters, 17 and 21 lines**, one of them a wrapped table of
  process states. An unbounded excerpt is a card taller than a phone. **So the card inverts:** the
  producer's one-sentence `why` is the always-visible headline and the excerpt lives one tap away —
  Fable's caveat rule, since the excerpt changes what you would *believe* about the inference rather
  than what you would *do* in the next ten seconds.
- **The excerpt is selected by position, not by whether it contains the sentence the `why` is
  about**, which is why a process table is offered as evidence for a claim about what an agent said.
  The producer's fix, not ours. Ours is to label the disclosure as *the tail of that session's pane*
  rather than as a quotation — an unlabelled excerpt that does not contain the relevant sentence
  teaches a reader to distrust a `why` that was correct. Live on the first pass, in the direction
  that costs us the reader's confidence in the feature.
- **No live example of two paths**: every item had zero duplicates and none was `needs-a-screen`.
  Those are written from the type and are untested against reality; say so rather than assuming.

`attention.kind === "unknown"` now arrives from three places — no pass has run yet, a pass ran and
failed, a stored list was unreadable — each carrying its own `why`. **We do not split the arm.** The
producer keeps it deliberately as one thing, *nobody can tell you*, and splitting it here would put
the same reasoning in two places. The `why` is rendered on screen rather than behind a disclosure,
because "no pass has run yet" means wait and "the pass failed" means go and look.

### 🔵 Stage v0.9a: the broadcast cannot reach the sessions that caused the load

**Found by `spideryarn2-b6` on 2026-09-08 while building the Overseer's resource rules**, handed over
rather than patched, and every claim below was re-measured here before it was written down.

`broadcastRoute` keeps only recipients whose `drainGate` is `{kind: "now"}`
(`routes-actions.ts:1705-1707`). A shell — where the text would be *executed* — and a session that is
*working* are both left out. For a person pressing **Ease off**, that is defensible and the comment
above it says so.

**For a rule that fires *because* the box is under pressure, it inverts.** The more sessions are
working, the fewer the broadcast reaches.

**The first two numbers in this paragraph were wrong, both in the direction that favoured the stage,
and the correction came from the person whose stage it was.** GPT Sol caught it reviewing their plan;
`spideryarn2-b6` passed it on unprompted.

- *"3 of 15"* mixed **8 agent sessions with 7 shells**. A shell was never eligible to be spoken to,
  so counting shells in the denominator overstates what the route is missing. The honest reading of
  20:25 is **3 of 8 agent sessions deliverable, 5 held because working, 7 shells never eligible** —
  and the first reading off the corrected sampler is **4 of 7**.
- *"the 5 it excluded were the ones consuming the box"* was **an inference nobody had earned**.
  `working` describes a Claude pane's state; it does not establish that those sessions were
  consuming the machine. Attributing load to sessions needs `health.ts`'s own attribution evidence,
  which this dashboard has and that argument was not using.

**What survives is the structural claim, and it is the part this stage rests on**: every working row
is excluded by construction, and an all-working fleet makes the route refuse rather than degrade.
That does not depend on any denominator. What the numbers were doing was saying how *often* the
exclusion bites — which is the question the sampler exists to answer, and which was being
overstated.

**The sharp end is `total === 0`** (`:1710`). When every agent is working — the exact condition the
action exists for — the route refuses the whole call with *"none of the rows you sent is at a prompt
right now, so there is nobody to tell"*. It does not degrade. It declines, and it declines hardest at
maximum need.

#### The cooldown does not protect the path that fires under load

`lastBroadcastAt = at` is stamped at `:1769`, **after** the `total === 0` refusal returns at `:1712`
and after the dry-run branch. So a refused call never spends the cooldown: an unattended caller is
refused, the clock is never started, and it may re-fire immediately. There is no *send* loop, because
nothing is delivered — there is an unthrottled *refusal* loop, on a box already under pressure.

**That is a constraint on every automated caller today**, not a future one, and it is why
`spideryarn2-b6`'s rule carries its own interval and treats a refusal as the end of an attempt rather
than the start of a retry.

#### Why the obvious fix is wrong, and what the real one costs

`drainGate` returns `{kind: "later"}` for a working session, and `queue.ts` and `drain.ts` already
exist to hold and deliver exactly that. But `broadcastText` carries *"arm a wake-up ~N minutes from
now"* and `renderBroadcast` computes N **at send time on purpose** — a slow fan-out must not hand out
stale minute counts. Queue a broadcast for a session that reaches a prompt forty minutes later and it
arrives telling the agent to wake at a time that has passed. **Worse than not arriving.**

So the fix is to render at delivery rather than at enqueue — and it is **two changes, not one**:

1. **A box-wide action would have to become queueable per session**, which means ANSWERING the
   refusal at `:505` rather than deleting it: *"a box-wide action cannot be queued against one
   session"*, because there is no single session whose order it belongs to. The argument not yet
   made is that a broadcast wants a **held delivery in each of many** rather than a position in one
   session's order, and that those are separable. That looks obvious, which is the reason to be
   careful with it.
2. **Then render `index`/`total` at delivery**, which is idiomatic here rather than novel:
   `drain.ts`'s `sendable()` already renders the attribution at delivery for the same reason, and
   says so — *a sentence written twenty minutes before it is typed has decayed by the time anybody
   reads it*.

#### Not started, and deliberately waiting on evidence

Crossing a deliberate refusal needs better evidence than *it would reach more sessions*.
`spideryarn2-b6` is sampling **both denominators** — agent sessions and total rows — with the full
status histogram and the load ratio, every 30 seconds for 24 hours, recording an unreadable snapshot
**as unreadable rather than as zero rows**. Reading it against agents rather than rows is the
correction above; the series will allow either framing to be judged rather than requiring anybody to
take one.

**The early readings do not obviously support the stage.** Load `ratio1` has fallen to 0.26 and the
agent count is dropping as sessions finish, which is the *recovers on its own* case — the one that
kills this stage. One reading is not that result, but it was reported alongside the ones that
favoured the fix rather than instead of them, which is the only reason it is worth anything.

**A series showing reachability recovering on its own kills this stage**, which is the cheaper
outcome and the one to hope for.

#### A cheaper option, found after the stage was written, and it should be tried first

**`drainGate` excludes every `working` row, and some of them are at a prompt.**
`queue.ts:155` takes only a `FleetStatus`, and `working` becomes
`{kind: "later", why: "it is working, and keystrokes sent to a busy Claude do not queue themselves
anywhere useful"}`. That reason is sound for a session mid-turn. It is **false for a session whose
turn has ended with something running behind it** — Claude Code's `status: "shell"` is
`baseStatus === "idle" && hasUnfinishedLocalBash`, so that session is at a prompt and typing at it
works. `claude agents --json` normalises `shell` to `busy`, which is why the board calls it *Working*
and why this was invisible.

**The server already computes the distinction.** `pause.ts` reads the session store and produces
`{kind: "background-work"}` for exactly those rows, joining on the `sessionId` inside each file
rather than the pid in its name. Two such rows were live at 20:43 on 2026-09-08, and
`spideryarn2-b6` — sampling with this module's own join after their pid-ancestry version disagreed
with it — measured **`agents=7 reachable=4 working=3 working_but_at_prompt=1 oracle_unknown=0`** at
20:53. One of three *working* rows was messageable.

So a broadcast could reach some of the sessions it currently defers **without touching the enqueue
refusal at all**: `working` + `background-work` is `now`, not `later`. That is a smaller change than
making a box-wide action queueable, it needs no rendering-at-delivery, and it uses a fact this
dashboard already has rather than one it would have to invent.

**Two things to settle before building it**, neither of them hard but neither of them skippable:

- **`drainGate` is the drain's rule too, not only the broadcast's.** Widening it would also send
  queued items to those sessions sooner. That is probably right for the same reason, but it is a
  second behaviour change and it should be argued rather than inherited.
- **Where the pause comes from at the route.** `broadcastRoute` reads `declaredStatus` off the
  request, and the pause must NOT arrive the same way — a client echoing a value the server told it,
  checked by the server against itself, is failure mode 5 in `routes-steer.ts`'s header. The server
  should read it from its own latest snapshot.

**And this is the honest order:** try the cheap fix, measure whether the residue still matters, and
only then argue the `:505` refusal. The stage below may turn out to be unnecessary, which is the
outcome to hope for.

**CORRECTION, 20:56 the same evening: the item above named the wrong field, and it was contradicted
by measurement within the hour.** `spideryarn2-b6` added a second join so the two could disagree, and
they did:

    20:56  agents=7 reachable=5 working=2 working_but_at_prompt=1
           server_bg_work=0 joins_disagree=1 oracle_unknown=0

The row that was at a prompt reported `pause: {kind: "cannot-tell"}`, and its reason string was
**identical to the genuinely-busy row's** — so `pause` did not discriminate between the two at all.

**The cause is one line in `pause.ts`, and it is Class B in a module written the same day.**
`readShellState` does `if (entry.status !== "shell") return { kind: "not-background-work" }`, so a
store entry whose status is `idle` — the *direct* evidence of at-a-prompt — is read and then
collapsed into a negative. `background-work` is only the `shell` subset (idle **and** unfinished
bash). The row they counted was plain `idle`, which is the larger set and the one reachability
actually wants. **The producer said the careful thing and the consumer threw it away**, which is the
lossy-join half of `260908b` occurring inside the fix for it.

So the cheap fix is still available and it is a *different* field: keep the store's own status rather
than reducing it to a boolean about background work. That also answers the open question left over
from v0.4h about `choosePause`'s precedence, which put `background-work` above `cannot-tell` back
when that arm meant *blocked*.

**One reading, two rows, and the coverage is an open question rather than a settled one.** Their
`joins_disagree` column now makes the misses visible instead of inferable from a total, and the
overnight series says how often the store's `idle` and the board's `working` actually coincide. If
they rarely do, this is cheap and nearly useless and the expensive stage below survives; if they
usually do, this is sufficient and the stage below can be deleted.

- [ ] Try the cheap fix first, **on the store's status rather than on `background-work`**: stop
      collapsing a non-`shell` status into `not-background-work`, and let a row the store calls
      `idle` be deliverable. Read server-side from our own snapshot, never off the request.
- [ ] Revisit `choosePause`'s precedence at the same time; it was ordered when `background-work` was
      believed to mean *blocked*.
- [ ] Answer or overturn the `:505` refusal, in writing, before any code.
- [ ] Render `index`/`total` at delivery, following `sendable()`.
- [ ] Say on the page what the route already answers: *"sent to 3 of 15 — 5 were working, 7 are
      shells"*. The per-recipient outcomes are already in `result` and already drawn, but as a JSON
      dump a reader scrolls past rather than a sentence they read. **Not a missing join** — checked —
      a presentation gap.
- [ ] A test that a refused call does not stamp the cooldown, so the behaviour above is a decision
      rather than an accident. Whichever way it is decided, it should be decided.

### Later: the coordinator agent

The orchestrator is eventually a program, not Greg (his call, 2026-09-08). Nothing here builds it,
but every action above is a typed function before it is a button, so it has something to call.
**Stage v0.8a's `renderSpoken()` item is a prerequisite rather than a nicety**: until the attribution
prefix reaches single-session actions, a coordinator's suggestion arrives in an agent's input box
indistinguishable from Greg's own instruction.

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
