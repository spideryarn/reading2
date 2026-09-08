# Plan review: chat and live sessions join the route table

You are reviewing a **plan, before any code is written**. Nothing in `src/routes.ts` has been
touched. The deliverable I want from you is whether this plan is safe to build as written, and
where it is wrong.

## The candidate

**Durable, committed.** Repo `/home/greg/code/spideryarn2`, branch `dev`.

- The plan under review: `docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md`
  (committed on `dev`; if it is not yet in your checkout, `git log --oneline -3` will show it as the
  most recent commit).
- The tree it plans against: `origin/dev` at `fd7aa74d`.
- The code it moves: `src/routes.ts:8407`–`:8528`, plus the table at `:6687` and the dispatch at
  `:8553`.

Start with the plan doc, then the twelve guards. **That is a reading order, not a scope limit** —
anything in the repo is fair game.

Background you will probably want, in this order:

- `docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md`
  — the previous slice. It has the method, the capture/normalise script's design, your own narrowing
  of the "once, not per domain" ruling at 23:40 on 2026-09-07, and your correction of both sessions'
  `return;` model. This plan inherits all three and should be checked against them.
- `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md` — the umbrella migration.
- `docs/project/security-map.md` (line 87 names the two defences in this file) and
  `docs/project/auth.md`.
- `tests/authenticated-api-route-contract.test.ts` — the static contract reader.
- `tests/turn-order.test.ts` — read its header. It is the reason Stage 1 is shaped the way it is.
- `tests/chat-route.test.ts` and `tests/routes.test.ts:215` — the harnesses Stage 1 reuses.

## What to attack

Attack it independently before you read my own doubts at the bottom. In particular:

1. **Ordering.** The claim is that a contiguous bottom-up move of the chain's last twelve guards
   into a table dispatched immediately below them reorders nothing, **by construction rather than by
   audit**. Is that claim actually true for these twelve? Is there any path or method for which the
   move changes which handler answers?
2. **The `/api/chat/:slug/live-tool` overlap.** `chatLiveTool` (POST) and `oneThread` (PATCH,
   DELETE) both match that path. The plan says the methods separate them and contiguity preserves
   their relative order for free. Check it.
3. **Stage 1's decomposition.** The plan asserts two distinct mutations with two distinct catchers,
   and asserts that the oracle it builds is red under one and green under the other — and says so in
   advance rather than discovering it. Is that decomposition sound, is the predicted red/green right,
   and is there a *third* mutation this migration could introduce that neither catcher sees?
4. **The return-count rail.** The plan adds a rail refusing automatic body comparison for any guard
   whose own function scope holds a return other than exactly one final argumentless `return;`. Does
   that rail fire on exactly the guards it should in this block? Is "hand-argued `chat` GET" an
   adequate substitute for the automatic comparison it refuses?
5. **The security-map properties.** Does the plan's account of where the gate lives after the change
   hold — the one `requireUser` call site, `slugPart` for every capture that becomes a directory
   name, and guards 6–8 correctly using `part` rather than `slugPart`?
6. **Size.** Twelve guards in one slice, or two slices of six? I want a recommendation, not a survey.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by which file the defect is in — a defect in this plan doc that will cause
a P1 to ship is not a P3 because it is made of prose.

**Refuse only on an *established* P0 or P1** — direct evidence with no unresolved material
inference. If a load-bearing premise is still inferred, the finding is *reasoned*: it ranks and
informs, but does not block.

**Give every finding a stable ID** — `F1`, `F2`, … one per finding, used again in later rounds only
for the same finding.

You have no network and cannot reach Postgres, so do not promise a runtime result. You *can* read
and reason over any file in the tree, and a finding you can point at an exact reachable source path
for outranks one you reasoned to.

## End with a verdict

One of: **build it as written**, **build it with these changes**, **this slice is the wrong slice**,
or **do not build this**. Then say which of your own findings you would drop if I told you I had one
hour rather than four.

---

## My own suspicions, worth less than yours — spend most of the run above

These are already mine, so finding them again is not worth your time.

- I think Stage 1's oracle is *easier* than the previous slice's, and I am suspicious of that. The
  referee slice needed a real stream-lifetime instrument; this one claims a plain response-shape
  assertion suffices, because a dropped `await` makes `JSON.stringify` emit `{"threads":{}}`. If that
  reasoning has a hole, it is the hole that matters most in this plan.
- I am unsure whether the `?summary=1` early return in `chat` GET is genuinely the only guard in the
  block that trips the return-count rail, or whether I have missed one by reading rather than
  parsing.
- I have not checked whether any `/api/chat/` or `/api/live/` path is also matched by
  `src/public/routes.ts`, which is dispatched *before* `requireUser`. I believe not; I have not
  proved it.
- The whole migration makes `src/routes.ts` **longer** — 8,180 to 8,575 lines over five slices,
  while Biome cognitive complexity on `serveAuthenticatedApi` falls 244 → 153. File extraction is
  out of scope by the repo owner's decision. If you think that makes this slice not worth building,
  say so plainly; "the stage costs more than it is worth" is a legitimate verdict here.
