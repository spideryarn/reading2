# Review: a plan to prove the fleet dashboard's access guards on the real composed server

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fleet-access-review (a git worktree of the
spideryarn repo), branch `worktree-fleet-access-review`. TypeScript, ESM, Node's `http` module, no
framework; tests are vitest.

## The candidate

A plan, committed: `docs/plans/260910f-fleet-access-review-composed-server.md` (the commit that adds
it is HEAD of this branch; `git show --stat HEAD`).

Start with the plan, then `tools/fleet/server.ts` (`handler()` from line ~701, `serveStatic`, the
listeners at the bottom, the bind parsing at ~95), `tools/fleet/origin.ts`, `tools/fleet/headers.ts`,
`tools/fleet/config.ts` (`parseBinds`), and the existing unit tests `tests/fleet-headers.test.ts` and
`tests/fleet-origin.test.ts`. The spec the plan answers to is
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Access review — the bounded
hardening Greg requested" (line ~1716). The access history is `docs/project/overseer-direction.md`
§ Access and § A5 (~1288–1460). None of this limits scope.

## What it is meant to do

Prove, with a real listener on a private loopback port and real HTTP requests, that the fleet
dashboard's bind, security headers (CSP/anti-framing), origin checks on every write route, and
action attribution hold on the composed server — one test per property, each seen to fail when
the property is removed. Fix what that turns up, red first: the plan names a missing `Host` check
(DNS rebinding can read `/api/state` and `/api/messages`) and four prefix-matched, method-blind
inline routes. Then a short note in `docs/project/security-map.md`.

Deliberately out of scope: changing the bind or `/etc/fleet-dashboard.env` (Greg's decision),
Tailscale Serve or an owner check, token auth, the action routes' behaviour, `tools/overseer/`,
`tools/fleet/web/src/`.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp is writable. You can run one test file (`npx vitest run
tests/<one>.test.ts`) and `node --import tsx <script>`. You have no network, not even loopback, so
you cannot start the server yourself.

## Attack it

Independently, before you read my suspicions. The questions that matter:

1. Is the plan's diagnosis right? Is the `Host`-less read path genuinely reachable by DNS rebinding
   from a browser on a tailnet device or via an ssh forward, and is a `Host` allowlist using
   `addressableHost` before routing the right fix — or does it break a legitimate caller, or miss a
   path (SSE `/api/live`, static files, the 404)?
2. Is spawning the real `server.ts` as an isolated child the right harness, and is the isolation
   table complete? Anything that would still touch the live dashboard's stores, the live tmux
   server, or make a paid model call, is a P0 for this plan.
3. Are the tests the plan lists sufficient to meet the roadmap stage's acceptance, and would each
   actually fail if its property were removed? Name any property that would pass vacuously.
4. Anything in the roadmap stage's five checkboxes the plan silently drops.

For each finding give an ID (F1, F2, …), a severity (P0 data loss / exploitable security / service
broadly unusable; P1 wrong behaviour or authoritative contract violated; P2 design risk; P3 prose),
whether it is established or reasoned, (a) the concrete scenario it does not handle, and (b) the
smallest change to the plan that closes it. Refuse only on an established P0 or P1.

**Write your findings FIRST to `/tmp/260910f-fleet-access-review-plan-review-findings.md` as soon
as you have them** (the tree is read-only to you; I will copy it into the repo) (your closing message overwrites the `--output` file at exit, and
reviewers here have died at their time wall having written nothing). Then give your final answer.

## My own suspicions — read last

- The 421 status for a refused `Host`: is there a better code, and does anything on the box (the
  Overseer's SSE client, `scripts/fleet-restart.ts`'s readiness probe) send a Host this would refuse?
- Whether the bind test ("refuses a connection on any other local interface address") can pass
  vacuously on a machine with only loopback.
- Whether "prove production composition shares the queue with the refresh drainer" (roadmap
  checkbox 3) can honestly be left source-level.

Do not change any file other than the findings file in /tmp.
