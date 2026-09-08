# Agent fleet dashboard

**Status as of 2026-09-08: running.** Serving on the box at `127.0.0.1:8787` and on the tailnet at
`100.92.255.119:8787`, showing ~36 sessions with status, and rendering the pending question for
blocked ones. Evidence: `tools/fleet/` holds seven modules, 163 tests pass across six files, and
`curl -sN /api/live` streams a `snapshot` event. Tailscale 1.102.3 is installed and logged in.

**Not yet reachable from the page:** `steer.ts` (no route calls it) and the React client (in
flight). One claim in an earlier version of this plan was **retracted** — see
[Evidence](#evidence-what-was-actually-tested), which records what failed as well as what worked.

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

### Stage v0.2d: the dashboard is a privileged renderer of hostile content

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

### Stage v0.3: status

- [ ] working / idle / blocked, from the two-source join in `sessionState` — never from
      `claude agents --json` alone, which is incomplete by measurement.
- [ ] Sort blocked to the top, and show the count.

### Stage v0.4: what it is blocked on

- [ ] Scrape the pending question and its numbered options from the pane.
- [ ] Tap an option → send that digit. The narrow, safe case, and the one that pays for the phone.

### Stage v0.4b: Sessions becomes master–detail

Greg, 2026-09-08 — quoted in full in
[orchestrator-direction.md](../project/orchestrator-direction.md#what-greg-asked-for-on-2026-09-08).

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

### Stage v0.4c: recent messages

The detail pane's "recent messages" needs a source. Transcripts are on disk and are tens of
megabytes; `gjd-remote ls` greps whole ones and costs 10–12s, which is the thing this tool exists
not to do.

- [ ] Read the **tail** of a session's transcript, not the whole thing, and only for the one
      session being looked at.
- [ ] `~/.claude/projects/<slug>/` is a **slugified cwd and is lossy** — resolve the path from
      `row.meta.dir` plus `row.claudeSessionId`, and say plainly when it cannot be found rather
      than showing an empty conversation.

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

### Stage v0.6b: the Orchestrator tab does something

- [ ] Send a message to the Orchestrator, with the same input machinery as everything else.
- [ ] Broadcast to all agents — the same mechanism as v0.5c's resource broadcast, so there is one
      implementation of "say this to everybody" and not two.

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
