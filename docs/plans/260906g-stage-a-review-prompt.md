# Review: Stage A of "back to where you jumped from" — the jump transaction

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from`, branch
`worktree-back-to-where-you-jumped-from`. TypeScript + ESM, React 19, vitest, nuqs 2.10.0.

**You have refused this work twice already, at the plan stage, on F1–F12.** All twelve findings were
checked against the source and accepted; none was overruled. This is the first *code* round, and
`docs/reusable/code-quality-overview.md`'s rule is that a code review outranks a plan review,
because a plan review cannot find a wrapper that writes one entry and silently drops the other.

## The candidate

Committed: `25a16a38`. Its parent `2258f65a` is the plan you last refused.

```
git show 25a16a38 --stat
git diff 2258f65a..25a16a38
```

Changed paths, complete:

- `src/web/jump-history.ts` — **new**, pure. The stamp on `history.state` and the arm.
- `src/web/keynav.ts` — `measureOrigin` and `beginJump` added, beside the `measureRow` they use.
- `src/web/router.ts` — `watchHistoryWrites` rewritten; `addressAt` extracted.
- `src/web/App.tsx` — `jumpTo` reduced to a call to `beginJump`.
- `src/web/BlockRef.tsx` — `blockHref` delegates to `addressAt`.
- `tests/jump-history.test.ts` — **new**, 24 cases.
- `tests/eager-client-graph.test.ts` — one line added to `SHARED_WITH_READER`.
- `docs/plans/260906g-back-to-where-you-jumped-from.md` — Stage A marked built, with what it learnt.

Start with `jump-history.ts` and `router.ts`; that does not limit your scope.

## What it is meant to do

A reader jumps (glossary term, citation, spine band, search result) and, in an iOS home-screen PWA
with no browser chrome, has no way back. Rather than build a second history stack, this exposes the
browser's own — which already distinguishes jumps from scrolling, because
`docs/project/url-state.md` § "Position replaces history; deliberate acts push" made it so.

Stage A puts the record in place. Stage B (not built) will draw a chip from it and call
`history.back()`. So the question here is only: **is what lands on the history entries true?**

Two writes make a jump:

1. the entry being **left** is rewritten so its `?at=` names where the reader actually was — measured
   from the layout at jump time, never read from `?at=`, which is stale by design in three ways;
2. a new entry is **pushed** with the destination and a `spya` stamp on `history.state` naming that
   origin.

Both are performed by `watchHistoryWrites`'s `pushState` wrapper against the inner functions it
captured at patch time, because nuqs's setter queue cannot express the pair (your F11).

Contracts it must not break: `docs/project/url-state.md` (the URL is the only source of truth;
scrolling replaces, deliberate acts push), `docs/project/block-ids.md`, and nothing about this
feature may ride along in a shared link.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You may run
`npx vitest run tests/jump-history.test.ts` and any other **pure** test file
(`tests/url-state.test.ts`, `tests/router.test.ts`, `tests/reading-position.test.ts`), and scripts
with `node --import tsx`. **No network, not even loopback** — anything needing Postgres will fail,
and that is not a finding.

I have run the gates myself, on an unloaded box: `npm run check` — build, cycles and chain green. Two typecheck errors and one test failure are **not this branch's** and are not findings: the `committed` gate reproduces the typecheck pair in a clean extract of HEAD (`bea197dc`, another agent's in-flight `navLabelStatus`), and `tests/chat-web-links.test.ts`'s timing-ratio test passes 44/44 when run alone.

## Attack it

Independently, before my questions below.

The invariant: **after a jump, is the pair of history entries true?** That is, does the entry the
reader is standing on name where they went and where they came from, and does its predecessor,
when restored, put them back exactly where they were standing when they jumped? Landing at the
top, landing on an entry stamped with an origin two jumps old, a stamp surviving something it
should not have survived, a stamp lost by something ordinary, and the pair coming apart so that
one write lands and the other does not, all count.

Second: **the wrapper is now the choke point for every history write in the app**, including ones
that have nothing to do with this feature — `navigate` out of the article, `last-view.ts`'s
restore, `AuthCallback`, `useBilling`, and nuqs's own writes for all ~35 parameters. Does any of
those now behave differently in a way nobody intended? Look for the write that used to be a plain
forward and is now conditional.

Third: **do the tests test the code, or do they test themselves?** Three specifically:
`§ never renders the intermediate origin` claims to establish atomicity, `§ writes the top of the
article by taking ?at= away` claims a `scrollY` it cannot observe in jsdom, and
`§ discards a position write that was still queued` depends on nuqs's timing.

Fourth: **does anything in the code or the plan's new prose contradict the source**, as F7 did?

For each finding give an **ID** (continue from `F13` — F1–F12 are spent, and reuse one only for the
same finding), a **severity** (P0/P1/P2/P3), and whether it is **established** or **reasoned**;
then (a) the concrete scenario or the contract it contradicts, with file and line, and (b) the
smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1**, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself. Spend most of the run above.

1. The arm is module-level state consumed by a wrapper that sees every push in the app. `beginJump`
   clears at the top of every jump, and `consumeArmedJump` matches on pathname and target — but an
   arm whose push never comes still survives until the next jump. Is there a sequence where it is
   claimed by the wrong push?
2. The `replaceState` wrapper reads the stamp off `history.state` rather than the caller's argument,
   so it preserves. Is there a replace that *should* drop the stamp and now does not — a mode change
   that replaces rather than pushes, say, or `last-view.ts`'s restore?
3. `measureOrigin` uses `window.scrollY <= stickyOffset()` for "top". `positionToWrite` decides the
   same question a different way. If those two disagree, in which direction, and does it matter?

Do not change any file.
