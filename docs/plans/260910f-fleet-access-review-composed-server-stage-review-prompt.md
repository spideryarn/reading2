# Review: Stages 1–2 of plan 260910f — the fleet dashboard's access guards, proven on the composed server

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fleet-access-review (a git worktree of the
spideryarn repo), branch `worktree-fleet-access-review`. TypeScript, ESM, Node `http`, vitest.

## The candidate

Committed: the HEAD commit of this branch (`git show --stat HEAD`; the diff is `git diff HEAD~1 HEAD`).
Changed paths: tools/fleet/server.ts, tools/fleet/origin.ts, tests/fleet-composed-access.test.ts
(new), tests/helpers/fleet-child-server.ts (new), tests/fleet-origin.test.ts,
tests/fleet-decisions-route.test.ts, tests/fleet-reports-route.test.ts, docs/project/security-map.md,
docs/project/overseer-direction.md, and the plan docs/plans/260910f-fleet-access-review-composed-server.md.

Start with: server.ts's `unaddressedHost`, `readMethod` and the top of `handler()`; origin.ts;
tests/helpers/fleet-child-server.ts. The plan — especially "The harness choice" and the table of
dispositions of your own plan review (F1–F10) — says what was meant. None of this limits scope.

## What it is meant to do

1. A request whose `Host` names anything `addressableHost` refuses — or names nothing — is answered
   421 with the security headers before any route (static, read, SSE, write, 404). Closes DNS
   rebinding on the read routes (`/api/state`, `/api/messages`, `/api/live`).
2. `addressableHost` now also accepts a single DNS label (the MagicDNS short name), and nothing
   looser; the write routes' Origin checks use the same predicate.
3. The four inline read routes match their exact path; `/api/live` is GET only; `/api/state`,
   `/api/agents`, `/api/messages` are GET/HEAD; others 405.
4. The composed test starts the REAL server.ts as a child, isolated from the live dashboard's stores,
   the live tmux server, the primary checkout and every paid call, and proves bind, headers on every
   response class, the Host matrix, every write route's Origin gate, exact paths/methods and the
   audit-source log line — each seen to fail under a mutation (the implementer's table is in the
   plan's Status).

Invariant: the child must never reach live state or make a side effect (Sol's F9 — every positive
control stops at a 400 before work). Out of scope: the bind itself, Tailscale Serve, token auth,
tools/overseer/, tools/fleet/web/src/, the action routes' behaviour.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review — each finding red-first, with
the test that reproduces it — and leave everything wider as a finding for me to decide. Do not
commit. List every file you changed at the end. Do not touch port 8787, the live dashboard, the
Overseer daemon, the live tmux server or anything under ~/.fleet-* / ~/.overseer. Your sandbox may not
permit loopback; if the composed test cannot run in it, say so and review it statically — I have run
it (62 tests green, raw output below).

Raw results I ran at HEAD: `npx vitest run tests/fleet-composed-access.test.ts tests/fleet-origin.test.ts
tests/fleet-headers.test.ts tests/fleet-decisions-route.test.ts tests/fleet-reports-route.test.ts
tests/fleet-hold-restart.test.ts tests/doc-links.test.ts` — all green after the doc-link fix;
`npm run typecheck` exit 0.

## Attack it

Independently first. Try to: get a hostile name past the Host guard (encodings, userinfo, a trailing
dot, IPv6 zone ids, a `Host` with a path, duplicate Host headers, absolute-form request targets like
`GET http://evil.example/api/state`), get a read route to answer a prefixed or wrong-method request,
find a response path that escapes the security headers, find a positive control that does real work,
find anything the child still inherits from the live environment, and find a test in the matrix that
would pass with its guard removed.

For each finding: an ID continuing from your plan review (start at F11), a severity (P0 data loss /
exploitable security / service broadly unusable; P1 wrong behaviour or contract violated; P2 design
risk; P3 prose), established or reasoned, (a) the input or mutation that shows it, (b) the fix. Refuse
only on an established P0 or P1.

**Write your findings FIRST to
`docs/plans/260910f-fleet-access-review-composed-server-stage-review-answer-findings.md` as soon as
you have them** (the `--output` file is overwritten by your closing message at exit, and reviewers
here have died at their time wall having written nothing). Then fix, then answer.

## Previous findings (your plan review)

All ten are dispositioned in the plan's table. F6 and F7's receipt half were overruled on scope and
are queued for another session (`qi-3mgbkjrn`); do not re-raise them unless the code claims them.

## My own suspicions — read last

- **Orphaned child.** The harness spawns the child `detached` in its own process group; if vitest
  itself is killed (a resource-triage agent on this box does kill vitest under load), the child
  keeps listening on its random port forever. A fix inside the helper that does not need server.ts
  changed — e.g. a tiny wrapper that owns the group and kills it when its stdin pipe from the parent
  closes — is in scope.
- `new URL("http://" + host)` as the Host parser: does anything parse differently from how a browser
  chose the name?
- HEAD on `/api/messages` still does the async transcript read; harmless, or not?
