# Review: Stage 2 of plan 260910d — request ids and replay, on the steer and enqueue routes

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, tsx, vitest. **You have 30 minutes; write your
answer file before the last five.** A previous review ran out of time in its final hygiene check and
left no answer at all.

## The candidate

Committed: the commit whose subject begins "Stage 2 of 260910d" — `git log -1 --format=%H
--grep='^Stage 2 of 260910d'`. `git show --stat <sha>` lists its paths; `git show <sha> -- tools/
tests/` is the code. It was implemented by an Opus subagent from
`docs/plans/260910d-durable-action-receipts-stage2-task.md`. Start with `tools/fleet/routes-steer.ts`,
the session route in `tools/fleet/routes-actions.ts`, and `tools/fleet/receipt-journal.ts`.

**The same commit carries one small, separate change, written by the implementing session and
also unreviewed:** `QuarantineBook.durable()` in `tools/fleet/quarantine.ts` and a top-level
`holdsDurable` on the `GET /api/actions` catalogue in `routes-actions.ts`, with
`tests/fleet-holds-durable.test.ts`. `scripts/fleet-restart-plan.ts` (already on dev, `66ae9ef2`) lets
a restart go ahead over a steering hold only when that field is literally `true`. Attack it too: is
there a state in which `durable()` says true while a hold opened now would not survive a restart
(a ledger that lost its lock after opening, a failure that cleared, a book built before the ledger)?

## What it is meant to do

The spec is `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` — § The fingerprint,
§ The actor, § Write-ahead, § Retention and § The crash points are authoritative. In one paragraph: a
client-minted `requestId` binds to a sha256 of the canonical raw body minus the id; the lookup runs
**before** catalogue resolution, the speaker rule, preview freshness and the rate limiter; same id and
body replays the stored receipt and does nothing; a different body is `409 request-id-conflict`; an
unknown id outside ±1 h is `409 request-id-expired`; a malformed id is `400`, never downgraded to
unkeyed. A keyed accept that cannot land is `503` with no effect. Direct steer and answer now get
receipts, `accepted` then `attempted` (fail-closed when durable) before the coordinator. **No
automatic retry; a receipt never installs, extends or ends a hold.**

## What you may change

You may edit this worktree: fix what is inside Stage 2, each finding red-first with the test that
reproduces it; report anything wider. Do not commit or change the index or history. Do not edit
`send-coordinator.ts`, `steer.ts`, `server.ts`, `routes-broadcast.ts`, `tools/overseer/` or
`tools/fleet/web/`. List every file you changed. My gate results are at `logs/dar-s2-gates.txt`.

## Attack it

Independently first. Find a sequence of requests, restarts, catalogue changes, write failures and
frozen disks after which:

1. the same keystrokes are typed twice for one `requestId`, or one id replays a receipt for a
   different body;
2. a replay changes anything — a queue item, a limiter slot, a hold, a transport call;
3. a keyed request has an effect with no durable `accepted`, or a durable receipt reaches the
   transport with no durable `attempted`;
4. a receipt claims `not-sent` for a send that may have happened, or `keys-submitted` for one that
   did not complete;
5. message text reaches the journal, a log line, or a replay body.

**Carried from Stage 1b, whose review hit its time cap:** also try the queue's restore and generation
guard (`tools/fleet/queue.ts` `restore`, `concludeRestoredForGeneration`), the drain's
`beginDelivery` slot accounting, and the foreign-id rule in `fromAnotherRun`, against the plan's
crash table. Treat those as not yet reviewed.

For each finding: an ID continuing from F37, severity (P0 data loss / exploitable security / service
broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design
risk; P3 prose), established or reasoned, (a) the input or mutation, (b) your change or the smallest
change. Refuse only on an established P0 or P1. End with one line: "land", "land with the fixes
above", or "rework".
