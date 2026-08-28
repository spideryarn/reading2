# Third look at stage 2

You refused stage 2 twice. The second refusal's four findings are fixed in `80e7190`; the first
round's are in `6a928ae`. Review `80e7190` against your own list.

## Your findings, and what was done

1. **Tombstone not migrated at `turn.began`.** Fixed, and it was wider than the tombstone: operations
   are keyed by thread id too, so a second question typed before the first frame arrives registered a
   turn naming the conversation provisionally, then drew into a thread that no longer existed and the
   answer landed nowhere. There is one `renamed()` applied in `turn.began` covering `base`, tombstones
   and every operation. New tests use a **different** server thread id, which no test in this repo
   had ever done.

   You should know why you had to raise this twice: it never reached the implementer. I restructured
   your first review's four findings when writing the brief and dropped this one in the renumbering.
   Your phrase "the previous blocker unchanged" is what caught it.

2. **The repair overwriting newer same-ID work.** The rule now: a live operation needs no protection,
   because it draws over `base` and is re-projected over whatever lands — so the only thing at risk is
   what **retired while the repair was out**. Each write into `base` tells the repairs in flight for
   that conversation which rows moved (`touched` on the repair), and the merge keeps this tab's
   version of those in the server's position. Three tests, one per rewrite shape: retry, edit,
   recovery.

   This is the third time this bug has been fixed — `refreshThread`, then the repair replacing, then
   the repair merging. **Please say plainly whether this rule closes the class or narrows it again.**
   That is the single most important judgement I need from you.

3. **The old controller's live callback.** `controller.detach()` clears `#onThreadId` from the hook's
   effect cleanup, covering unmount and slug change. The intent commands are the controller's own
   work and continue; only what it was doing on somebody else's behalf stops.

4. **Superseded repair failures still reporting.** Not patched branch by branch — supersession was
   being asked five times with the branches disagreeing, so it is asked **once**, in `reduce`, for
   every kind: a superseded operation retires and does nothing else. Five per-branch checks deleted.

## Evidence

16 chat suites, 138 tests, green (the builder reports 27 suites / 345 tests across a wider set).
I probed the single supersession rule myself: disabling that one line reddens five tests across
renames, repairs, recoveries, intents and tombstones.

A caution about my probes, twice over. One earlier probe of mine passed because a `sed` had missed a
link in the import chain and my sabotage never ran; another because the pattern matched twice and the
script refused to edit, which I would have misread as "the check is not load-bearing" had an
assertion not told me nothing was patched. If you find a guard that looks untested here, consider my
instrument before the test.

Typecheck and suite noise from other agents: `ProseHoverCard.tsx`, `note-markers`, `supplement`,
a root-level `scratch-mint-session.ts`, and a half-written `src/store/export.ts`. None is chat.

## What I need judged

- Finding 2 above: **closed, or narrowed a third time?**
- Anything the single supersession rule now over-applies to — is there a kind where a superseded
  operation *should* still do something?
- `renamed()` — does it reach everything keyed by thread id, or is there a fourth place?
- Is stage 2 done? Stage 3 is the seven invariant permutations plus the rename fence
  (`expectedTitle`).

Read-only. Change no file. Say plainly whether it ships.
