# Plan review: the contents list and its search box, above the page on a narrow window

You are reviewing a **plan**, read-only, before it is built. Do not edit anything.

## The candidate

A live pre-commit candidate in this worktree. Base: `ed16143cb` (origin/dev). One untracked file,
which `git diff` will not show you:

- `docs/plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md` — the plan.
  Read it first.

Nothing else is changed yet. Code the plan will touch, to read as it stands:

- `src/web/PageContents.tsx` — the whole file; the `<nav>` at the bottom is what changes
- `src/web/Metadata.tsx` — the `<PageContents>` mount (about line 933), the `<main>` after it, and
  the stretch from the title down to the first `<Section>` (about lines 950 to 1085)
- `src/web/ProfilePage.tsx` — the mount (about line 227) and the top of `<main>`
- `src/web/PageSection.tsx` § `Section`, `src/web/flash.ts` § `scrollToAndFlash`
- `src/web/help/HelpPage.tsx` § `HelpContents` — the precedent for a folded list below `lg`
- `src/web/styles/narrow-window.css` § a field iOS zooms into
- `tests/profile-sections-collapsed.test.tsx`, `tests/metadata-contents-reveal.test.tsx`,
  `tests/page-contents-reached.test.tsx`, `tests/metadata-page-order.test.tsx`
- `docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md`,
  `docs/plans/261003n-profile-gets-the-contents-list-and-search-box.md`

This list is where to start, not a limit on scope. You may run any of those four test files with
`npx vitest run <file>`; say if one turns out to need a database, and skip it.

## What to do

Attack the plan independently first. Is this the right change for what Greg reported (his words are
quoted at the top of the plan)? Is it the simplest version that will still be good to work with?
What breaks, on which window widths and input devices, once the `<nav>` is a child of `<main>`
rather than its sibling: the fixed placement from 1024px up, the scan of `[data-section]`, the two
`MutationObserver`s and the `ResizeObserver` on `<main>` (the nav now mutates and resizes inside
the element they watch), `useRevealOnArrival`, tab order, the existing tests' queries? Are the
planned tests able to fail for the right reason, and is anything load-bearing left untested?

## Severity and findings

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID (`F1`, `F2`, …), its severity, whether it is **established** (direct
evidence, no unresolved inference) or **reasoned**, and the fix you would make. End with one line:
`VERDICT: build` / `VERDICT: build with fixes` / `VERDICT: do not build` — refuse only on an
established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether the list shut by default below 1024px is the right reading of the report, against open by
  default. The plan says why; say if you think it is wrong.
- Whether any ancestor of either page's `<main>` creates a containing block for `position: fixed`
  (a `transform`, `filter`, `contain`, `will-change`), which would move the list at desktop width.
- Whether the nav's own filtering, inside `<main>`, can loop the `ResizeObserver` → `measure` →
  `setHere` path, or make `changesIndex` rescan on every keystroke.
- Whether hiding the list with a class below `lg` while leaving it mounted is sound for a screen
  reader, given `aria-expanded` on the button.
