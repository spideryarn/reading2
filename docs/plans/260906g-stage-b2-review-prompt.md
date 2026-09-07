# Review: Stage B2 of "back to where you jumped from" — opening a question vs stepping between them

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from`, branch
`worktree-back-to-where-you-jumped-from`. TypeScript + ESM, React 19, vitest, nuqs 2.10.0.

**You have refused this work four times** — twice on the plan (F1–F12), once on Stage A's code
(F13–F18) and once on Stage B's (F19–F21). All twenty-one findings were checked against the source
and accepted; none was overruled. **This stage exists because of your F9.**

## The candidate

Committed: `c09d4db1` (HEAD).

```
git show c09d4db1 --stat
git diff 5ad06e14..c09d4db1
```

Changed paths, complete:

- `src/web/comment-jump.ts` — **new**. `jumpToComment`, `stepToComment`, and the shared
  `passageToBringIntoView` that holds the on-screen guard.
- `src/web/App.tsx` — `goToComment` is gone; two `useCallback`s replace it, wired to the two drawer
  closures and the four dialog arrows respectively.
- `tests/comment-jump.test.ts` — **new**, 8 cases, asserting on **history entry counts**.
- `docs/project/comments.md` — § Reading order gains a sub-section saying which half of its old
  claim still holds.
- `docs/project/url-state.md` — § Position replaces history gains the jump transaction from Stages
  A and B. **Not part of this stage's code**, but new prose and fair game.
- `docs/plans/260906g-back-to-where-you-jumped-from.md` — Stage B2 ticked, plus what it found.

## What it is meant to do

Your F9: `goToComment` was two intents wearing one function, and the plan's first draft would have
made **both** of them push.

- **The drawer's list** is a table of contents for the reader's own questions. Choosing one flings
  them an arbitrary distance, which `url-state.md` calls a deliberate act — so it pushes, through
  the Stage A jump transaction, and one selection costs one press of Back.
- **The dialog's Prev/Next** are traversal. `comments.md` says they behave like the arrow keys and
  write no position state of their own. Twenty questions must not cost twenty presses of Back.
- **The stamp survives the traversal's replaces**, so after stepping through several questions the
  chip still names where the reader *entered* the traversal from.
- **When the passage is already on screen, nothing moves and nothing is pushed** — existing
  deliberate behaviour, so two comments in one paragraph do not jolt the page.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You may run
`npx vitest run tests/comment-jump.test.ts` and any other **pure** suite
(`tests/jump-history.test.ts`, `tests/return-chip.test.tsx`, `tests/url-state.test.ts`,
`tests/router.test.ts`, `tests/reading-position.test.ts`). **No network, not even loopback** —
anything needing Postgres will fail, and that is not a finding.

Gates run here on an unloaded box: `npm run typecheck` clean across all three projects, and
`npm test` green — 770 files, 13985 tests, exit 0.

## Attack it

Independently, before my questions below.

The invariant: **after this lands, does each of the two paths cost exactly the history it should?**
One entry for a drawer selection that moves the page, none at all for a traversal step, none for
either when the passage is already on screen — and the chip, throughout, naming the place the reader
would actually be returned to. A path that pushes twice, a path that pushes when it should not, a
stamp that is lost or inherited, or a reader stranded with a chip that lies, all count.

Second: **the wiring, not the module.** The tests exercise `comment-jump.ts` directly. The stage's
own report admits nothing in the type system stops a future edit calling `jumpToComment` from an
arrow closure. Read the six call sites in `App.tsx` and say whether the wiring today is actually
right — and whether there is a cheap structural way to make the wrong wiring not compile that I have
missed. There is also a **seventh** closure, `TableView`'s `onOpenComment`, which the stage left
alone as needing no change; check that judgement, and note that its declared parameter type says
`BlockId` while what it receives is a comment id.

Third: **`?note=` and `?at=` are claimed to land on one entry because they are set in the same
tick**, relying on nuqs merging pending updates and any push option upgrading the combined flush.
Is that true for every path through `jumpToComment`, including when `setNote` is called and the
passage turns out to be on screen, and when the same comment is selected twice?

Fourth: **the new prose in `comments.md` and `url-state.md`** — does any of it contradict the
source, as F7 and F18 did?

For each finding give an **ID** (continue from `F22`; reuse an earlier ID only for the same
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

Worth less than anything you find yourself. Spend most of the run above.

1. The drawer path now inherits Stage A's F10 abort: a comment on a paragraph tall enough to cross
   the reading line with its top above the viewport is not `isBlockOnScreen`, so the old code
   scrolled to it and `beginJump` now does nothing at all. Accepted as the same trade F10 accepted —
   but is it worse here, where the reader picked a specific question out of a list and gets no
   feedback whatsoever?
2. `stepToComment` sets `?note=` and then scrolls, and relies on `useReadingPosition`'s listener to
   replace `?at=`. Is there a case where that listener does not fire — a step whose scroll distance
   is below whatever threshold it uses, or a step during an existing smooth scroll — leaving `?at=`
   naming the previous question?
3. Both paths call `setNote` before deciding whether to move. Is there a state where the note opens
   and the page does not move and that combination is wrong?

Do not change any file.
