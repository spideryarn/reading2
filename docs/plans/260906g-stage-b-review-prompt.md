# Review: Stage B of "back to where you jumped from" — the chip, plus your six Stage A fixes

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from`, branch
`worktree-back-to-where-you-jumped-from`. TypeScript + ESM, React 19, vitest, nuqs 2.10.0.

**You have refused this work three times** — twice at the plan stage (F1–F12) and once on Stage A's
code (F13–F18). All eighteen findings were checked against the source and accepted; none was
overruled. This round has two jobs, and the second matters more than its size suggests.

## The candidate

Committed: `6e270bf2` (HEAD). Two things to review, in one tree:

**1. Stage B — the chip** (new work, never reviewed):

- `src/web/ReturnChip.tsx` — **new**. The pill, its label, the rule for when it is drawn.
- `src/web/router.ts` — `useJumpOrigin` (~1490) and `dismissJumpOrigin` (~1380), plus the
  module-level `capturedReplace` set inside `watchHistoryWrites`.
- `src/web/position.ts` — `sectionIndexContaining`, extracted from `sectionContaining`.
- `src/web/styles.css` — `.return-chip` and its two buttons.
- `src/web/App.tsx` — `useReadingPosition` returns `rowOf`; `<ReturnChip>` renders before `<Dock>`.
- `tests/return-chip.test.tsx` — **new**, 12 cases.

**2. My fixes for your F13–F18** (in `src/web/keynav.ts`, `src/web/jump-history.ts`,
`src/web/router.ts`, `tests/jump-history.test.ts`). **Check them rather than assuming them.** A
finding accepted and then fixed wrongly is worse than one refused, because everybody has stopped
looking at it. Say plainly if any of the six is not actually closed.

```
git show 6e270bf2 --stat
git diff 25a16a38..6e270bf2 -- src/web tests docs/plans
```

`25a16a38` is the Stage A commit you reviewed. Note that `a65c8e74` mixes the two jobs above, and
that `ea697517` merged 40 commits from `dev` in between — the merge was clean and touched nothing in
this feature, but it is why the range is wider than the work.

## What Stage B is meant to do

A reader jumps and, in an iOS home-screen PWA with no browser chrome, has no way back. Stage A put a
stamp on the pushed history entry naming where the reader was standing. Stage B draws it:

- A pill, bottom left, above the dock, reading `↩ back to <section>`.
- Drawn **exactly when** the current entry carries a stamp naming a block this article has. There is
  deliberately **no other hide rule** — not distance, not section-equality. That was your F2.
- Pressing it calls `history.back()` **and nothing else**: popstate → nuqs → `useReadingPosition`'s
  restore effect does the scrolling, which is the same path a pasted link takes.
- A `{ kind: "top" }` origin reads "back to the beginning" (your F8).
- A × strips only the current entry's stamp, with a replace, adding no history entry (your F12).

Contracts it must not break: `docs/project/url-state.md`, `docs/project/block-ids.md`,
`docs/project/design-css-overview.md` § the z-index budget, and nothing about this feature may ride
along in a shared link.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You may run
`npx vitest run tests/return-chip.test.tsx`, `tests/jump-history.test.ts`, and any other **pure**
suite (`tests/url-state.test.ts`, `tests/router.test.ts`, `tests/reading-position.test.ts`), and
scripts with `node --import tsx`. **No network, not even loopback** — anything needing Postgres will
fail, and that is not a finding.

Gates run here, on an unloaded box, after the merge: `npx tsc -p src/web/tsconfig.json` clean, and
`npm test` green at 13766 passing. The two `tests/dock-corner-controls.test.tsx` `navLabelStatus`
TS2741 errors are another agent's in-flight work on `dev` and are not this branch's.

## Attack it

Independently, before my questions below.

The invariant, unchanged from Stage A and now reachable by a reader: **is there any sequence of
ordinary reader actions where the chip is drawn and pressing it does something other than "put me
back exactly where I jumped from"?** Drawn when it should not be, absent when it should be there,
naming the wrong place, or pressing it landing somewhere else — including landing somewhere the
reader has never been, or leaving the article.

Second: **is `useJumpOrigin` actually a correct `useSyncExternalStore`?** It caches an object keyed
on `JSON.stringify` of the parsed stamp, because returning a fresh object each call would loop. Is
the cache correct under every path that changes `history.state` — including two entries that differ
only in state, a `popstate` that restores an entry the cache last saw, and the server snapshot.

Third: **does the × actually strip, on a real page?** It calls the `replaceState` captured inside
`watchHistoryWrites`, deliberately getting underneath the wrapper that would otherwise re-apply the
stamp. What happens when `watchHistoryWrites` was never called, when it is called twice, and when
the module is imported by a route that never installs it?

Fourth — **the F13–F18 fixes.** Take each in turn and say whether it is closed. F13 now decides
"top" from whether the first `tr[data-block]` has crossed the reading line rather than from
`window.scrollY`; F14 gives the arm the address it was set at and clears it on `popstate`; F15
requires a strict plain object; F16 settles stampability before the predecessor rewrite; F17 adds a
tap between the two history patches; F18 is prose.

Fifth: **does anything in the code or the plan's new prose contradict the source**, as F7 and F18
did?

For each finding give an **ID** (continue from `F19`; reuse an earlier ID only for the same
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

1. `ReturnChip` renders inside the reading view and takes `sections` and `rowOf` as props. On a
   route where the article is not loaded, or mid-swap between articles, can it draw a stamp from the
   previous article against the new one's sections and name a section that is not where Back goes?
2. The chip is drawn from `history.state` and the label from React props. Those two update on
   different schedules. Is there a frame where the label names the wrong place?
3. A section with an empty title falls back to "back to where you were" rather than drawing nothing.
   I think that is right — the return is valid and only its name is missing — but say if it is the
   wrong trade.

Do not change any file.
