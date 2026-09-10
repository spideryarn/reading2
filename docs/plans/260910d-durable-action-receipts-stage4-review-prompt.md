# Review: Stage 4 of plan 260910d — reading receipts, and the clients keeping envelopes

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, React, tsx, vitest. **You have 30 minutes; write
your answer file — the full report — before the last five.**

## The candidate

Committed: the commit whose subject begins "Stage 4 of 260910d" — `git log -1 --format=%H
--grep='^Stage 4 of 260910d'`. `git show --stat <sha>`; `git show <sha> -- tools/ tests/`.
Implemented by an Opus subagent from `docs/plans/260910d-durable-action-receipts-stage4-task.md`.
Start with the three clients (`tools/fleet/web/src/actions-client.ts`, `steer-client.ts`,
`broadcast-client.ts`), the composers in `SessionDetail.tsx`, `MessageOverseerCard.tsx` and
`BroadcastCard.tsx`, and `ReceiptList.tsx`.

## What it is meant to do

The spec is `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` § Stage 4, and the
**"Agreed with `session-continuity`"** block there is authoritative for the drafts ticket seam
(`tools/fleet/web/src/drafts.ts`; postmortem
`docs/postmortems/260910c-a-mutable-text-hook-erased-the-submission-it-produced.md`). In one paragraph: a
client builds one immutable `{requestId, body}` envelope per intention and keeps it until a definitive
answer; only a lost or unreadable answer (`not-confirmed`) keeps it, and an explicit **Check** resends
the same bytes carrying the **original** drafts ticket; a replay is a definitive success and accepts
with the original ticket; 409 and 503 are definitive refusals that keep the draft; a pending envelope
never reaches `accept`; an envelope belongs to one route. `ReceiptList` on the Overseer tab says, per
receipt, what is proven and what is unknown, in words built from fields.

## What you may change

You may edit this worktree: fix what is inside Stage 4, each finding red-first with the test that
reproduces it; report anything wider. Do not commit or change the index or history. Edit only the
files the plan's Stage 4 authorisation lists (plus tests). List every file you changed. My gate
results are at `logs/dar-s4-gates.txt`. (`tests/doc-links.test.ts` fails on two anchors in other
sessions' 260910e plans; not this candidate.)

## Attack it

Independently first. Find a sequence of taps, typing, lost responses, reloads, unmounts, restarts and
server answers after which:

1. **the same message is sent twice** for one intention — a retry that mints a new id, or a route
   fallback reusing an envelope;
2. **a draft is cleared that should not be** — `accept` reached on a pending, refused or replayed-with-
   a-new-ticket request; typing after Send erased by a Check (the 260910c case);
3. a draft is kept and re-sent after a **definitive** success;
4. a response the client cannot read is treated as success;
5. `ReceiptList` says *delivered* or *read* for `keys-submitted`, hides an unknown, or draws a
   reconcile button on a receipt that is not an unknown enacted plan;
6. the reconcile route changes an outcome, accepts a disposition twice differently, or skips the origin
   check.

## My own suspicion — read after your independent pass

**A replay clears the draft whatever its receipt says.** In all three composers the replay arm calls
`accept(originalTicket)` unconditionally (e.g. `hear` in `SessionDetail.tsx`). But a replay whose
receipt is `not-sent` — the first attempt found the session held and typed nothing — or
`outcome-unknown`, or `withdrawn`, stands for an original answer that would have been a refusal and
KEPT the draft; clearing it now throws away words that were never delivered. I believe the right rule
is: a replay accepts only when its receipt shows the action happened — `keys-submitted` or
`completed`, or, on a queue path, queued work (`accepted`/`attempted`/`returned`, i.e. pending) — and
otherwise keeps the draft and shows the receipt's words. The agreed seam's sentence "a replay is a
definitive success" is true of *definitive* and not always of *success*. Fix it red-first in all three
composers if you agree; say so if you do not.

For each finding: an ID continuing from F44, severity (P0 data loss / exploitable security / service
broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design
risk; P3 prose), established or reasoned, (a) the input, (b) your change or the smallest change.
Refuse only on an established P0 or P1. End with one line: "land", "land with the fixes above", or
"rework".
