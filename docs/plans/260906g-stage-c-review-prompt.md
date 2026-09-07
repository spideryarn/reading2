# Review: Stage C of "back to where you jumped from" — one mark in the spine

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from`, branch
`worktree-back-to-where-you-jumped-from`. TypeScript + ESM, React 19, vitest.

**You have refused this work five times** — twice on the plan (F1–F12) and three times on code
(F13–F18, F19–F21, F10 again + F22–F26). All twenty-six findings were checked against the source and
accepted; none was overruled. This is the last stage.

## The candidate

Committed: `1df91b3b`.

```
git show 1df91b3b --stat
git diff c09d4db1..1df91b3b
```

Changed paths, complete:

- `src/web/spine-marks.ts` — `jumpOriginMark(rows, origin)` and an `OriginMark` type.
- `src/web/Spine.tsx` — calls `useJumpOrigin()` and renders one `.spine-from` element.
- `src/web/styles.css` — `.spine-from`.
- `tests/spine-marks.test.ts` — five arithmetic cases added.
- `tests/spine-jump-origin.test.ts` — **new**, ten cases.
- `docs/plans/260906g-back-to-where-you-jumped-from.md` — Stage C ticked.

**Note:** the tree also has uncommitted work fixing your F10/F22/F23 from the last round, in
`src/web/comment-jump.ts`, `src/web/scroll.ts`, `src/web/App.tsx` and `tests/comment-jump.test.ts`.
That is **not** this candidate — ignore it, and review `1df91b3b` as committed. You will get it in
the next round.

## What it is meant to do

Greg asked for previous locations marked in the spine, *fading over time so only the most recent few
are visible*. That was recommended against and **one** mark built instead, because the rail's own
stated rule is that it "acquires marks when the reader asks for them and at no other time"
(`Spine.tsx`), and a decaying trail is ambient information with no action attached. The single mark
earns its place by answering what the chip's label cannot — *how far did I come?*

- One faint mark at the origin block, **drawn only while the return chip is up**.
- **Nothing** for a `{ kind: "top" }` origin (your F8 — no block to mark) and nothing for a stamp
  naming a block this page no longer has.
- **It must not take a search lane or move the search marks sideways.** The rail is 12px wide and
  already carries the bands, the you-are-here marker, and one lane per active search.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You may run
`npx vitest run tests/spine-jump-origin.test.ts`, `tests/spine-marks.test.ts`,
`tests/spine-here.test.ts`, `tests/return-chip.test.tsx`, `tests/jump-history.test.ts` and other
**pure** suites. **No network, not even loopback.**

Gates: `npm run check` green — 771 files, 14001 tests, exit 0. A browser check is running separately
and its results are not in yet, so treat anything that needs real layout as unverified.

## Attack it

Independently, before my questions below.

The invariant: **the mark and the chip are one fact with two views.** Is there any sequence where
they disagree — a mark with no chip, a chip whose mark is in the wrong place, a mark that survives
the ×, a mark that outlives the article it belongs to?

Second: **does it really take no lane?** The claim is that this is structural rather than a
discipline — a different function, a different shape, and an element outside `.spine-matches`. Check
it against `spine-marks.ts`'s lane packing and the search marks' geometry, and say whether an
article with several active searches can be made to shift.

Third: **the arithmetic.** `jumpOriginMark` places the mark from the row geometry; `.spine-from`
clamps with `top: min(var(--from-top), 100% - 3px)` so a mark near the end does not grow out of
`.spine { overflow: hidden }`. Is the clamp right, is the placement right for a row that is very
tall or zero-height, and is the `rows` array it reads the same one the other marks read?

Fourth: **`Spine.tsx` subscribes to `useJumpOrigin()` itself** rather than taking a prop, which puts
a `useSyncExternalStore` on a component that renders on every scroll. The claim is that this is safe
because `jumpOriginSnapshot` caches its object. Check that claim, and whether the rail can now
re-render more than it did.

Fifth: does anything in the code or the plan's new prose contradict the source?

For each finding give an **ID** (continue from `F27`; reuse an earlier ID only for the same
finding), a **severity** (P0/P1/P2/P3), and whether it is **established** or **reasoned**; then (a)
the concrete scenario or the contract it contradicts, with file and line, and (b) the smallest
change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1**, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself.

1. The stage reported a **pre-existing** bug it deliberately did not fix: `.spine-match` has no
   clamp, so a search hit in an article's final block is clipped away by the rail's `overflow:
   hidden`. Confirm or deny it, and say whether leaving it was right.
2. The mark is `--ink-faint` at 0.55 opacity and 3px minimum. Is it distinguishable from the 1px L2
   hairlines, and does it read as "a place" rather than as structure? You cannot see it, so answer
   from the tokens and the other rules rather than guessing.
3. Is one mark actually the right product call, or does Greg's fading trail deserve another look now
   that the machinery exists? Say so if you think the plan talked itself out of the better feature.

Do not change any file.
