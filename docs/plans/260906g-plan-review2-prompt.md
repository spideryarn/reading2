# Review round 2: the revised plan for "back to where you jumped from"

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from`, branch
`worktree-back-to-where-you-jumped-from`. TypeScript + ESM, React, vitest.

**You refused round 1 on F1–F4. All seven findings were checked against the source and accepted, and
the plan has been rewritten around them.** This is the revision. Still a plan — no code has been
written yet.

## The candidate

Committed: `0c4609ee` (the revision), whose parent `224d8977` was the draft you refused.

```
git show 0c4609ee --stat
git diff 224d8977..0c4609ee -- docs/plans/260906g-back-to-where-you-jumped-from.md
```

Changed paths: `docs/plans/260906g-back-to-where-you-jumped-from.md` (rewritten),
`docs/plans/260906g-plan-review-sol.md` and `260906g-plan-review-prompt.md` (round 1's artefacts,
committed unchanged).

Read the revised plan whole rather than only the diff — its § "What the review changed" and § "What
the research turned up" are new sections that carry most of the load.

## Previous findings

| ID | Finding, verbatim (abbreviated) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | `?at=` is not the location being left — null at the top, stale fine block within a section, `throttle(0)` cancels the queued write | **fixed** | Stage A now *measures* the origin with `measureRow()` at jump time and writes the predecessor's `?at=` and its stamp as one transaction. Your suggested wording was adopted nearly verbatim |
| F2 | The section hide rule suppresses valid returns | **fixed** | The hide rule is deleted. The chip lives exactly as long as the entry's stamp |
| F3 | nuqs propagates stale stamps onto non-jump pushes | **fixed** | Stage A: every same-path push strips the inherited stamp and adds one only when a jump has armed an origin |
| F4 | Not every deliberate jump uses `jumpTo` — `goToComment` | **fixed** | New Stage B2 routes `goToComment` through the transaction when it actually moves the page, holding still when the target is on screen |
| F5 | Stage D has no implementable identity contract | **fixed** | Stage D deleted; deferred to its own plan, with the three things it must decide named |
| F6 | No reactive store for `history.state` | **fixed** | Stage B specifies `useJumpOrigin` (`useSyncExternalStore`, snapshot includes the stamp, subscribes to `popstate` **and** `NAVIGATED`), and Stage A suppresses a push when origin and target are the same block |
| F7 | `pushAddress` does not exist | **fixed** | Corrected to `navigate` throughout |

Treat these fixes as unreviewed work by someone else, and spend most of the run on what changed.

## What it is meant to do

Unchanged from round 1. A reader jumps (glossary term, citation, spine band) and, in an iOS
home-screen PWA with no browser chrome, has no way back. The fix exposes the browser's own history
stack — which already distinguishes jumps from scrolling — rather than building a second one. A chip
appears when the current history entry carries a stamp naming a block in this article; pressing it
calls `history.back()`.

Contracts it must not break: `docs/project/url-state.md` (the URL is the only source of truth;
scrolling replaces, jumps push), `docs/project/block-ids.md` (address content by stable block id),
and nothing about this feature may ride along in a shared link.

## Key code

`src/web/router.ts` (`watchHistoryWrites` ~1174, `navigate` ~1092, `useAddress` ~1205,
`carriedSearch` ~552), `src/web/App.tsx` (`useReadingPosition` ~1569, `jumpTo` ~1666, `goToComment`
~2516), `src/web/position.ts` (`positionToWrite`, `buildSections`, `activeSectionIndex`),
`src/web/keynav.ts` (`measureRow` ~217), `src/web/scroll.ts`, `src/web/last-view.ts`,
`node_modules/nuqs/dist/adapters/react.js`.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run **one test
file** (`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). **No
network, not even loopback** — anything needing Postgres will fail, and that is not a finding.
`tests/url-state.test.ts`, `tests/router.test.ts` and `tests/reading-position.test.ts` are pure.

## Attack it

Independently, before my questions below.

The invariant: **after this lands, is there any sequence of ordinary reader actions where the chip
is drawn and pressing it does something other than "put me back exactly where I jumped from"?**
Landing at the top, landing somewhere they have never been, leaving the article, undoing a setting,
or doing nothing at all all count.

Second: **is the jump transaction in Stage A actually atomic as specified, given nuqs's setter
queue and the debounce?** It writes the current entry's `?at=` and then pushes. If those are two
separate nuqs operations they can be coalesced or reordered.

Third: **does anything in the revision contradict the code, as F7 did?**

For each finding give an **ID** (continue from `F8` — do not reuse F1–F7 for new findings), a
**severity** (P0/P1/P2/P3), and whether it is **established** or **reasoned**; then (a) the concrete
scenario or the contract it contradicts, with file and line, and (b) the smallest change that
closes it — exact replacement wording, or the code shape it should specify.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1**, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself.

1. Rewriting the current entry's `?at=` at jump time is new and a little sly — a reader who presses
   Back now lands somewhere the URL never said out loud while they were there. Is that defensible,
   or does it break the "the URL is always current" property `url-state.md` opens with?
2. Stage B2 changes what Back means for comment stepping. Someone reading through twenty questions
   would now accumulate twenty history entries — exactly the misery `keynav.ts` refuses for arrow
   keys. Is the `isBlockOnScreen` guard enough to keep that rare, or is B2 wrong?
3. The chip now persists for the whole time the stamp is on the entry, which could be the rest of a
   long reading session. Is there a state where that is actively annoying, and is there a rule
   better than "never hide" that does not reintroduce F2?

Do not change any file.
