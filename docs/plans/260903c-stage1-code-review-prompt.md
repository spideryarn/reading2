# Review the built code for stage 1

You reviewed the plan for this job and found seven must-fixes; your review is at
`docs/plans/260903c-gate-unpolished-modes-behind-experimental-features-review-sol.md` and all seven
were folded into the plan. **This is the built code for stage 1 only.** Weight this review higher
than the plan-stage one: a plan review cannot find a token that is bumped in the wrong place.

You are in the git worktree that holds the work. Read any file, and **run
`npx vitest run tests/experimental-store.test.tsx tests/profile-settings.test.tsx` yourself** — a
finding you reproduced outranks one you reasoned to.

## What stage 1 was for

Nothing visible changes. Two things had to become true:

1. **The answer has one home.** Your finding 1: `App.tsx` is the router, so Metadata and Tweets each
   mount their own `Dock`, and a per-component hook let a new Dock's `GET` overtake the old one's
   `PATCH`. The fix is a module-level store read through `useSyncExternalStore` — not a React
   context, because `Dock` is mounted from four production sites and four test files that render it
   bare.
2. **A signed-out reader is off because we decided, not because a request 401'd.** That was
   `silent-success.md`'s shape: right answer, wrong reasoning.

## Read these

- `docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md` — the revised plan. Your
  findings are folded in; § *What the store must get right* is the lifecycle table stage 1 implements.
- `src/web/experimental-store.ts` — **the new file, and the whole of the stage.** Read every comment.
- `src/web/useExperimental.ts` — now 40 lines over the store. It kept its name, its returned shape,
  and gained `signedIn` (your finding 2, which stage 3 needs).
- `tests/experimental-store.test.tsx` — one test per row of the lifecycle table.
- `/tmp/claude-1000/-home-greg-code-spideryarn2/ba9c8220-9856-4dc5-832f-dd637fe6604f/scratchpad/stage1.diff`
  — the diff for the five *modified* files (the two new files are not in it; read them whole).

## What I already found and fixed, so you can check my work rather than repeat it

Reviewing the subagent's output I found a race it had not covered, wrote the test, and watched it go
red at the predicted line:

> A reader signs in and presses the switch before the opening `GET` returns. The `PATCH` commits
> *on*. The older `GET` then lands and writes *off* over it. UI says off, database says on.

`set()` did not invalidate an in-flight load. The fix is `loadToken += 1` in `set()`, plus — in the
`PATCH`'s `catch` — a `reload()` when `!state.loaded`, because a save that cancelled a read and then
failed would otherwise leave the store at `loaded: false` for the session with the control
permanently disabled.

**Check both.** Specifically: is `loadToken += 1` in the right place relative to `busy` and the epoch
capture? Is the `catch`-path `reload()` reachable in a loop, or able to fire for a *previous* epoch?
Is `!state.loaded` the right condition, or should it be "we superseded a load"?

## What I want you to attack

1. **The token scheme.** There are three counters — `epoch` (session), `loadToken` (loads), and
   `saveToken` (saves) — plus a `busy` flag. Is that the right number? Enumerate the interleavings
   they are meant to exclude and say which, if any, still gets through. Pay attention to
   `announceSession` clearing `busy` while a `PATCH` from the previous account is in flight, and to
   the `finally` block's `if (myEpoch !== epoch) return`.

2. **Snapshot stability under `useSyncExternalStore`.** `put()` compares eight fields with `same()`
   and skips the write if they match. Is the comparison total over what a consumer can observe? Can
   `snapshot()` ever return a new object for an unchanged state (React will loop) or an old one for a
   changed state (a component will not re-render)? Note `set`/`reload` are module-level functions
   carried on every snapshot.

3. **The lifecycle table.** Nine tests claim one row each. Are any of them passing for the wrong
   reason — asserting the end state without ever entering the state under test? The subagent flagged
   one such hazard itself in `tests/profile-settings.test.tsx` (an announcement in `beforeEach` would
   let the GET settle before the first render). Are there others?

4. **`resetForTests()`.** It bumps all three counters and does not clear listeners. Right call?

5. **The `public-network-trace.test.tsx` change.** The store adds a third request for a signed-in
   non-owner (`GET /api/reader`), which that file's parity test pinned at two. It was pinned at
   *exactly once for a signed-in reader, zero for a stranger* rather than filtered away. Is that
   assertion actually load-bearing, and is "zero for a stranger" proved where it is written?

6. **Anything in `useExperimental.ts` that lost an argument in the move.** The old hook's comments
   recorded two of your previous reviews. The claim is that every comment moved with the mechanism it
   explains. Verify it — name anything whose reasoning is now missing or now wrong in its new home.

7. **Stage 2 readiness.** Stage 2 gives `Dock` a required `experimental` prop (Fable arbitrated this;
   see § *`Dock` is told the answer*). Does the shape `useExperimental()` returns support that
   cleanly, and is there anything in stage 1 that will make stage 2 awkward?

Rank findings: **must-fix before I commit**, **should**, **noted**. Be concrete about the failing
case. Do not rewrite the code.
