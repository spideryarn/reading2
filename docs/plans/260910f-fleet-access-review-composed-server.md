# Fleet access review: prove the guards on the composed server

**Queue item** `qi-eypjh56e`, dispatched by the Overseer on 2026-09-10. **The spec** is the roadmap's
[§ Stage: Access review — the bounded hardening Greg requested](260908f-overseer-and-fleet-improvement-roadmap.md#stage-access-review--the-bounded-hardening-greg-requested):
its five checkboxes and its acceptance paragraph. **Loopback stays the default; widening the bind
(Tailscale Serve plus an owner check) is Greg's and is not this stage.** This stage proves what is
there, on the real composed routes, and fixes what that turns up.

## Why

The fleet dashboard binds a private address, sets a CSP before routing and refuses cross-origin
writes. Every one of those is tested **at the unit**: `tests/fleet-headers.test.ts` asserts the
header *values*, `tests/fleet-origin.test.ts` calls each route's check function, and
`tests/fleet-hold-restart.test.ts` greps `server.ts` for the order of two lines. None of them
starts the server. That is the class
[overseer-direction.md § Built, tested, and called from nothing but its own tests](../project/overseer-direction.md#built-tested-and-called-from-nothing-but-its-own-tests)
names twice: a mechanism correct in isolation says nothing about whether the thing that runs
calls it. `applySecurityHeaders` could be deleted from `handler()` today and every test would pass.

## What the recheck found before any code (2026-09-10, 18:20Z)

Measured on the box, read-only:

1. **The live dashboard is bound to the tailnet as well as loopback.** `ss -ltnp` shows
   `127.0.0.1:8787` and `100.92.255.119:8787`; `/etc/fleet-dashboard.env` says
   `FLEET_BIND=127.0.0.1,100.92.255.119`. [overseer-direction.md § A5](../project/overseer-direction.md#access)
   recorded on 2026-09-08 that *"the running dashboard binds `127.0.0.1` only"* and that the
   widening happens *"at the instant `systemctl enable --now` runs"* — that has now happened.
   **And the tailnet has three devices, not two**: `gregs-macbook-pro` has joined beside the box
   and the iPhone. That is the exact failure mode the A5 paragraph predicted (*"months later a
   device joins for convenience — the Mac…"*), eight days early. `tailscale serve status` still
   says *No serve config*, so the precondition that doc attaches to widening — Serve proxying to
   loopback, plus a `Tailscale-User-Login` owner check on writes — is not in place. **This is
   Greg's to decide, not this stage's to change** (the brief, and `infra/` is not in this file set);
   it goes in the debrief as *needs Greg*. All three devices are Greg's, so nothing is known to be
   exposed to anyone else.
2. **The read routes check no `Host`, so DNS rebinding can read transcripts.** `origin.ts`'s
   `addressableHost` refuses a rebound name, but only the write routes call it, and they call it on
   `Origin`. A page at `evil.example` whose DNS re-resolves to `100.92.255.119` (or to `127.0.0.1`
   on a laptop with the ssh forward up) is same-origin by the browser's own lights, so its script
   can `GET /api/state` and `/api/messages?id=…` and read every session's title, pane excerpt and
   last twelve transcript turns — agent-authored text that may quote secrets — and send it home.
   `origin.ts`'s own header explains rebinding; it was applied to the half that types and not to
   the half that reads.
3. **Four inline routes in `server.ts` match by prefix and ignore the method**: `/api/live`,
   `/api/state`, `/api/agents`, `/api/messages`. `GET /api/state.js` or `POST /api/stateanything`
   is answered as the poll. Every route *module* already matches its exact path (each one says
   so in a comment); these four are the ones that were never extracted. Read-only, so this widens
   nothing that can write — the roadmap names it anyway (*"a prefix match must not unintentionally
   widen an API route"*), and it costs a line each.
4. **Hostile text renders as text** at the component level: `tests/fleet-web.test.tsx` renders
   `<img src=x onerror=…>` in a transcript turn (`:5094`), in approval material (`:3949`) and in a
   row title (`:2176`) and asserts it arrives as `textContent`; the client has no
   `dangerouslySetInnerHTML` or `innerHTML`. The roadmap's fourth checkbox is therefore already
   met at the level it can be met without a browser; this stage cites it rather than re-deriving it.
5. **Action attribution is a claim, not an identity, and says so.** Receipts record
   `actor: { kind: "client-claimed", id }` or `unattributed-http` (`receipt-journal.ts:56`,
   `routes-steer.ts:1215`), and `parseSpeaker`'s comment says in capitals that this is **not an
   authentication boundary**. The refusal log carries the peer address and `Origin`
   (`routes-actions.ts` `who()`). Nothing to re-derive; what is unproven is only that the real
   listener hands the route a real `remoteAddress`.

## The harness choice

**Spawn the real entry point, `tools/fleet/server.ts`, as a child process on a free loopback port —
not an extracted `makeHandler()`.** The roadmap allows the extraction *"if composition tests need
it"*; they do not, and the child is the stronger evidence: it is the file systemd runs, with every
route mounted in the order production mounts them, so a guard dropped from `handler()` or a route
mounted above it is seen. The extraction would also have moved 250 lines of `server.ts` that three
other sessions edited today into a new file, turning each of their next edits into a conflict.

What the extraction would have given that this does not: fakes for the routes' state. We do not need
them — every property here is decided before a route reaches its state.

**Isolation, from a read-only survey of every path, command and call the server makes at startup
and on its loops** (2026-09-10; `file:line` for each is in the survey, summarised here):

| Reaches | Derived from | Isolated by |
|---|---|---|
| health, holds + receipt journal (writer locks), readiness stores | `$HOME` | `HOME=<tmp>`, and `FLEET_HEALTH_DIR`, `FLEET_HOLDS_DIR`, `FLEET_READINESS_DIR` explicitly |
| Overseer files (read-only), describe store | `OVERSEER_STORE_DIR` or `~/.overseer` | `OVERSEER_STORE_DIR`, `OVERSEER_DECISIONS_DIR`, `OVERSEER_QUEUE_DIR` |
| `tmux` (no `-L`/`-S` anywhere) | `$TMUX` if set, else `$TMUX_TMPDIR` | **unset `TMUX` and `TMUX_PANE`** — a vitest inside tmux otherwise reaches the live server — and `TMUX_TMPDIR=<tmp>` |
| `git`, worktree log scan (readiness) | cwd | a non-repo temp dir as cwd |
| OpenRouter (describe) | env, else the worktree's `.env.local` | `FLEET_DESCRIBE_MAX_CALLS=0` and a bogus non-empty `OPENROUTER_API_KEY` |
| the drainer | a queue rebuilt from the holds dir | fresh dir ⇒ empty queue; no tmux server ⇒ no panes |
| the built client | `import.meta.url` | none possible: the test **fails** with "run `npm run build:fleet`", like `fleet-decisions-route` already does, rather than skipping — a skipped security test reads as a passing one |

Readiness of the child is its own `fleet on http://127.0.0.1:<port>` line *and* the child still being
alive, never a 200 from the port — a port can be answered by somebody else's server on this box.

## Stages

### Stage 1 — a real listener, and one test per property, each seen to fail

- [ ] Harness: start the composed server on a private loopback port inside the test, isolated from
      the live dashboard's stores, tmux server and model calls.
- [ ] **Bind.** It answers on the configured address and refuses a connection on any other local
      interface address; `FLEET_BIND=0.0.0.0` exits non-zero before listening.
- [ ] **Headers on every response class**: the static shell, a static asset, a 404, `/api/state`,
      `/api/live` (SSE), a route-module GET, a write-route refusal, a 405.
- [ ] **Origin on every write route, over HTTP**: steer message and answer, new session, rename,
      actions (session, box, cancel, clear, hold release, revive, abandon), broadcast, transcribe —
      a rebound `Origin`, a missing one and a literal `null` each get 403; a same-origin request
      gets past the origin gate (a different answer), so the refusal cannot pass by refusing
      everything.
- [ ] **Attribution at the boundary**: a refused action's log line names the real peer
      (`from=127.0.0.1`), not `-`.
- [ ] Mutation for each: remove the property in the source, watch its test go red, put it back.
- [ ] **Roadmap checkbox 4, cited rather than rebuilt** (component and route level; F8):
      hostile text renders as text — `tests/fleet-web.test.tsx` *"…onerror…"* at `:5094`
      (transcript turn), `:3949` (approval material), `:2176` (row title); an unsupported or
      unclassifiable dialog acquires no answer path — `tests/fleet-steer.test.ts:1099` *"refuses a
      dialog it could not classify, exactly as if it were a permission"*, `:599` *"refuses a dialog
      the parser no longer recognises"*, `tests/fleet-web.test.tsx:3961` *"refuses to offer an
      answer when the material could not be read"*; unknown action variants — the server refuses
      any id not in its own catalogue at the body boundary (`tests/fleet-actions.test.ts:110`
      *"refuses an id that is not one of ours"*), and a variant that does not fit its slot is
      explained and not offered (`tests/fleet-web.test.tsx:6441`, a broadcast addressed to a
      session). **One nuance worth keeping:** a catalogue entry the *client* has never heard of is
      deliberately still drawn and pressable (`tests/fleet-web.test.tsx:6419`), because the server
      owns the catalogue and is the gate; "disabled" is the server's refusal, not the button's.
- [ ] One real-browser check against the composed child (a subagent, Playwright on the box): the
      built page renders under its CSP with no violation in the console, and a page that frames it
      is refused.

### Stage 2 — fix what Stage 1 shows, red first

- [ ] **`Host` allowlist before routing**: any request whose `Host` names something
      `addressableHost` refuses gets `421 Misdirected Request` with the security headers, before
      any route — static, read or write — sees it. One line in `handler()` beside
      `applySecurityHeaders`, and a missing `Host` is refused too. Red first: `GET /api/state`
      with `Host: evil.example` is answered 200 today.
- [ ] **Exact path and method for the four inline routes**: `pathname ===`, GET/HEAD only, 405
      otherwise. Red first: `GET /api/stateX` and `POST /api/state` are answered 200 today.
- [ ] **What it could break, checked:** every caller in the repo uses `127.0.0.1`, `localhost` or
      the MagicDNS name (`tools/overseer/source.ts`, `rule-work.ts`, the page's relative URLs);
      nothing names the bare short name `spideryarn-box`. A bookmark that does would now be refused
      on reads as it already is on every write — the refusal body names the reason.
- [ ] The simpler option passed over: putting the `Host` check inside each read route. Rejected
      because it is the same mistake `origin.ts`'s header records — one copy per route is how one
      of them came to lack it.

### Stage 3 — say what is proven

- [ ] A short section in [security-map.md](../project/security-map.md): the fleet dashboard is a
      different product on the same box, what is now proven at the HTTP boundary, and what is
      still source-level (the store-before-listener order; the queue shared with the drainer).
- [ ] Correct the stale sentence in overseer-direction.md § A5 about what the running dashboard
      binds — a fact, not a rule, so it needs no approval; the widening decision stays Greg's.

## Out of scope

The bind itself and `/etc/fleet-dashboard.env` (Greg's, and `infra/`); a Tailscale Serve front or
an owner check (the widening's precondition, Greg's); token authentication (the roadmap refuses it:
every same-user agent could read the token); the action routes' behaviour (session
`action-receipts`); anything in `tools/overseer/` or `tools/fleet/web/src/`.

## Plan review (GPT Sol, 2026-09-10) and what was done with it

Sol refused the first draft (`6f2aa690`) with ten findings, one reasoned P0:
[answer](260910f-fleet-access-review-composed-server-plan-review-answer.md),
[findings](260910f-fleet-access-review-composed-server-plan-review-answer-findings.md). It confirmed
the rebinding diagnosis and the shape of the fix (*"a global pre-routing authority check is the
right fix shape"*). Dispositions:

| ID | Finding | Disposition |
|---|---|---|
| F9 P0 | Positive same-origin controls on real routes could start an agent (`gjd-remote`) or call OpenRouter (`/api/transcribe`) | **Taken.** Every positive control sends a schema-invalid body that the route refuses with 400 before any receipt, tmux, launcher, write or fetch — the route line is cited in the test. Enable flags forced off; `FLEET_NEW_DIR*`, `GJD_REMOTE_*`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME` cleared or redirected; a sentinel fails the file on any launch or provider-attempt log line. |
| F2 P1 | A rebound `Host`+`Origin` cannot be both the routes' 403 and the global guard's 421, and after the guard it proves nothing about a route | **Taken.** Two matrices: hostile `Host` (global refusal), and allowed `Host` with hostile, missing or `null` `Origin` (each route's 403). Each route's origin call mutated independently. |
| F3 P1 | The `Host` test named only `/api/state` | **Taken.** Data-driven over the shell, an asset, state, messages, live, a route-module GET, a write, an unknown path, and a missing `Host`. |
| F4 P1 | Only two of four inline clauses tested; `HEAD /api/live` would subscribe forever | **Taken.** `/api/live` is `GET` only; the other three `GET`/finite `HEAD`; every clause tested and mutated. |
| F5 P1 | The other-interface bind test could pass vacuously | **Taken.** Witness `127.0.0.2`, proven reachable by a control listener first; fails, never skips, if it is not. |
| F1 P1 | `addressableHost` refuses the MagicDNS short name `spideryarn-box` a phone may use | **Taken, by widening the predicate to single-label names** (no dot, `[a-z0-9-]` only). A rebinding page must be served from a name the attacker controls in public DNS, which always has a dot. This also lets the *write* routes answer to the short name, which they refused. The before/after smoke through the ssh forward and the tailnet URL needs the live dashboard restarted, which is the Overseer's; the commands are in the debrief. |
| F10 P2 | Bare `--import tsx` fails from a temp cwd (Sol reproduced it) | **Taken.** The loader is resolved to an absolute path in the parent. |
| F7 P1 | The composed log test proves the peer address, not receipt/speaker attribution | **Renamed** to *audit source*. **The receipt half is overruled on scope** — see F6. |
| F6 P1 | The roadmap asks to *prove* the page's queue is the drainer's; the plan left it source-level | **Overruled on scope, and sent to the Overseer.** Both F6 and F7's receipt half need a request that reaches a real target: either a session the collector will list on an isolated tmux server (a Claude process tree the collector recognises), or a composition seam in `routes-actions.ts`, which is the `action-receipts` session's file and not this stage's. The receipt actor derivation is tested at the route by that session's work (`receipt-journal.ts`, `routes-steer.ts:1215`). The roadmap's checkbox 3 stays unticked. |
| F8 P1 | Two of checkbox 4's three properties were dropped, and the acceptance names a browser boundary | **Partly taken.** The existing witnesses for all three are cited under Stage 1. One real-browser check against the composed child: the built page renders under its CSP with no violation, and a page that frames it is refused. A hostile string *through* the composed server needs a listed session, the same obstacle as F6, so that stays at the component level. |

## Status

Plan written 2026-09-10 and revised after Sol's review; Stages 1 and 2 are being implemented by an
Opus subagent.
