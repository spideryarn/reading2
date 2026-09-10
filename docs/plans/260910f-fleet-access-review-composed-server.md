# Fleet access review: prove the guards on the composed server

**Queue item** `qi-eypjh56e`, dispatched by the Overseer on 2026-09-10. **The spec** is the roadmap's
§ *Stage: Access review — the bounded hardening Greg requested* in
[260908f](260908f-overseer-and-fleet-improvement-roadmap.md):
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

**The Overseer's answers, 2026-09-10 ~19:20Z.** The tailnet bind without Serve and an owner check is
Greg's and is in front of him; this stage does not change the bind. F6 and F7's receipt half are
queued as `qi-3mgbkjrn`, after `action-receipts`' Stage 4; checkbox 3 stays unticked. The Host guard
fails closed on an absent `Host`, and the allowed set is written down in one place (`origin.ts`'s
header): IP literals, `localhost`, `*.ts.net`, and single-label names — each with why it is safe
from rebinding. **It is deliberately not narrowed to the exact bind addresses**: an IP-literal
`Host` involves no attacker-controlled name, so pinning the list would couple the guard to
deployment config and buy nothing. And the child harness is written up as a reusable helper,
`tests/helpers/fleet-child-server.ts`, so the next composition test uses it rather than a second one.

## Stage review (GPT Sol, fixer, 2026-09-10 19:20–19:44Z) and what was done with it

Sol reviewed `3718fd6d` with write access, refused on two P1s, and fixed all six of its findings
itself: [answer](260910f-fleet-access-review-composed-server-stage-review-answer.md),
[findings](260910f-fleet-access-review-composed-server-stage-review-answer-findings.md).

| ID | Finding | Disposition |
|---|---|---|
| F11 P1 | A killed vitest orphaned the detached child and its listener | **Taken.** An owner process (`tests/helpers/fleet-child-owner.mjs`) holds the child's process group and kills it when its IPC pipe from the parent closes; a subprocess test SIGKILLs the caller and waits for the port to close. |
| F12 P1 | `new URL("http://" + host).hostname` let `localhost/path`, `evil.example@localhost` and percent-encoded names through as `localhost` | **Taken.** The raw `Host` must be exactly one authority — no userinfo, path, query, fragment, backslash, `%` or whitespace; a bracketed IPv6 or a host, then at most `:<digits>` — before `URL` extracts the name. |
| F13 P2 | Two `Host` fields were reduced by Node to one | **Taken.** Counted from `rawHeaders`; exactly one is required. |
| F14 P2 | The helper's `env` option let a caller undo its own isolation | **Taken.** Replaced by a typed `bind` option; the isolation values cannot be overridden. |
| F15 P2 | `DELETE /api/actions/cancel` was not in the Origin matrix | **Taken.** |
| F16 P2 | `*.ts.net` accepted `.ts.net`, empty and edge-hyphen labels | **Taken.** One DNS-label validator (63 bytes, `[a-z0-9-]`, no edge hyphen) for every label. |

**Sol's sandbox could not bind loopback, so it never ran the composed file.** Run for real, 154 of
156 focused tests passed and two of Sol's new ones failed: the `DELETE` row (`ECONNRESET`) and the
parent-death test (the listener survived). The fixes went to an Opus subagent. **Sol also reported
that "an independent Sol review accepted" its fixes; that is not relied on here** — a nested run
that cannot start reviews its own work and reads identically.

**Both failures were the tests', not production's** (Opus subagent, 2026-09-10 ~20:05Z):

- **`ECONNRESET` on `DELETE`**: Node's client chunks a `POST` body but sends a `DELETE` body with
  neither `Content-Length` nor `Transfer-Encoding`, so the server rightly read a bodiless `DELETE`
  followed by garbage, and reset. The test's `request()` now sets `Content-Length` whenever there is a
  body. `routes-actions.ts` needed nothing.
- **The listener survived its parent's death** because the test killed the `tsx` CLI while a node
  *grandchild* held the owner's IPC channel. The fixture now runs as one process
  (`node --import tsx`) and prints its own pid, which the test asserts is the one it kills. **And
  the test was still not a witness once that was fixed**: with the owner's disconnect handler
  deleted it stayed green, because the owner's EPIPE fallback fired on the server's next log line
  (55 ms by disconnect, 568 ms by EPIPE). The fixture now reports ready only after the server has
  been silent for 1.5 s, so only the disconnect handler can close the listener — mutated, and red.
- **Mutations on Sol's F12/F13/F16 fix**: reading `req.headers.host` instead of `rawHeaders` goes
  red on the `localhost, evil.example` order (the other order is refused either way); dropping the
  character regex goes red only on `%6cocalhost`, because `new URL()`'s own checks still refuse
  userinfo, path, query and fragment — so the regex is the percent-encoding guard; dropping the
  `.ts.net` label check goes red in `tests/fleet-origin.test.ts`.
- The composed file: 76 tests, three consecutive green runs.

**The narrow check of the two P1 fixes (GPT Sol, read-only, 20 minutes, on `f3674e36`)** asked
whether two statements are accurate, not whether the fixes are sound:
[prompt](260910f-fleet-access-review-composed-server-p1-check-prompt.md),
[answer](260910f-fleet-access-review-composed-server-p1-check-answer.md),
[findings](260910f-fleet-access-review-composed-server-p1-check-answer-findings.md). Verdict on both:
**accurate** — the owner's death closes the listener and its group, the disconnect mutation is red,
and it cannot signal another group; malformed or multiple `Host` fields get 421 while every listed
legitimate authority passes. No F17. It too could not bind loopback, so it reasoned from the
committed blobs and the recorded mutations; the execution evidence is the runs above. No
disagreement to arbitrate, so the brief's Fable step was not needed, and there is no further round.

## Status

Plan written 2026-09-10 and revised after Sol's review. **Stages 1 and 2 built by an Opus subagent**
(not Codex — the brief for this account said Opus or Fable), reviewed and gated by the manager;
Sol's stage review follows.

- `tests/fleet-composed-access.test.ts`: 62 tests, ~3.6 s, over `tests/helpers/fleet-child-server.ts`.
- **Red before each fix**: `expected 200 to be 421` on `/api/state`, `/`, `/api/live` and
  `expected 404 to be 421` on `/api/messages` with a hostile `Host`; `/api/stateX` and
  `POST /api/state` answered 200; `addressableHost("spideryarn-box")` was false. A missing `Host`
  must be sent over HTTP/1.0 — Node refuses its absence on HTTP/1.1 with a 400 before `handler()`.
- **Every positive control stops at a 400 before work** — the body `this is not json`, refused at
  each route's parse, before any receipt, `listSessions`, launcher, rate limiter or fetch — and a
  final test reads the child's log for any launch or provider line.
- **Mutations**, each restored byte-for-byte:

  | Mutation | Went red |
  |---|---|
  | drop `applySecurityHeaders` | 33 header checks |
  | disable the `Host` guard | 16 in the `Host` matrix |
  | allow a missing `Host` | the 8 no-`Host` rows |
  | `listen()` without a host | bind, and the audit-source log (peer becomes `::ffff:127.0.0.1`) |
  | prefix match on live / state / agents / messages, each alone | that route's suffixed-path test |
  | drop the method gate on live, state+agents, messages | their 405 tests |
  | skip the origin check in steer / new / rename / actions / broadcast / transcribe, each alone | that route's origin tests |
  | peer address removed from the actions log | the audit-source test |
  | drop the single-label rule | the allowed-names test |

- **Fallout, fixed**: `tests/fleet-decisions-route.test.ts` and `tests/fleet-reports-route.test.ts`
  call the real `handler()` with `headers: {}`, which the guard now refuses; each gained a `host`.
- **What the plan had wrong**: `TMUX_TMPDIR` is read by tmux itself, never by our code; `tsx` runs
  the script in a grandchild, so the harness spawns detached and signals the group.
- **Known gap, handed to the stage review**: if vitest itself is killed, the detached child keeps
  listening on its random port.
- Gates: the focused set green, `npm run typecheck` exit 0, biome clean on the new files.
- **The browser boundary (F8), 2026-09-10 ~19:25Z**, headless Chrome through Playwright against a
  child started by the helper: the built page rendered at both `127.0.0.1` and `localhost` with **no
  console line at any level** — no CSP or permissions-policy violation. A page on another loopback
  port that framed it was refused, Chrome's own words:
  `Framing 'http://127.0.0.1:38295/' violates the following Content Security Policy directive:
  "frame-ancestors 'none'". The request has been blocked.` The headers on `/` matched
  `SECURITY_HEADERS` exactly. A hostile string *through* the composed server stays at the component
  level, for the reason given under F8.
