# Code review: the where-am-I rail on three lines on a narrow window, and the phone-and-touch map

You are the stage reviewer, and by this repo's house rule you **fix what you find inside this
stage**, narrowly and red-first, and **report, without fixing, anything wider**. You are in a git
worktree; edit files in place and do not commit. I read your diff as a proposal, run the gates and
commit it.

**The candidate** is commit `84ad9e8bd` (its parent `a4d682ac9` is the plan alone).
`git show --stat 84ad9e8bd` lists every path. Start with:

- `src/web/styles/crumbs.css` § a narrow window, `src/web/HeadingsCrumbs.tsx`
- `src/web/reader/Reader.tsx` (`layoutKey`, `showCrumbs`, and the comments that changed)
- `tests/crumbs-narrow.test.ts`, `tests/headings-crumbs-wiring.test.tsx` (the new signed-in
  non-owner case), `tests/mobile-chrome.test.ts` (the taller-bar case), `tests/helpers/stylesheets.ts`
- `docs/project/phone-and-touch.md` (new), and the lines added to `AGENTS.md`,
  `reading-view-overview.md`, `touch.md`, `narrow-windows.md`, `experimental-features.md`
- `docs/user-feedback/261003_1538-where-am-i-rail-three-lines-on-a-phone-and-a-phone-and-touch-map.md`

That list is where to start, not a limit. The plan, with the experiment's numbers, your
plan-stage review and what was done about each of its findings, is
`docs/plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md`.

## What to do

1. **An independent pass on the code.** Does a reader on a narrow window get the three-line
   breadcrumb without anything else breaking: what is pinned under the bar, jumps and reading
   position, keyboard focus and the screen-reader's view of the list, the bar's hide-on-scroll
   guards in `shell.css`, the View-only chip sharing the bar, a path of one crumb, a path of four,
   a title in the author's or the model's voice (`withVoice`), a tooltip opening from a crumb whose
   `li` is now `position: absolute`. And is every window wider than 731px untouched?
2. **Run these yourself** (they need nothing outside the tree):
   `npx vitest run tests/crumbs-narrow.test.ts tests/headings-crumbs-wiring.test.tsx tests/mobile-chrome.test.ts tests/spine-width.test.ts tests/doc-links.test.ts`.
   Then check each new test can actually fail: break the thing it is about and see it go red.
3. **Check `docs/project/phone-and-touch.md` claim by claim against the code and the docs it links
   to.** It is a map: every policy line and every row of "Where the code branches" names a file, a
   section or a symbol. Open each and confirm it exists and does what the line says. Every
   blockquote is meant to be Greg's words verbatim from the source its attribution links to;
   compare them, including the dates and report ids. Fix what is wrong in place; a wrong signpost
   in a map is a P1, because the next agent will believe it.
4. Say whether the doc restates anything that already has a home (it should cite, not restate:
   `docs/reusable/documentation-policy.md`).

The browser evidence I hold and you cannot reproduce (no network in your sandbox), from Chrome at
320, 390, 430, 768, 1440 and WebKit at 390: bar 68px on the three narrow widths with the table
head and the spine starting at 68; 44px and pixel-identical to before at 768 and 1440; with
`--safe-top` forced to 47px the bar, table head and spine all at 115; press rows 28px and 39px
with no dead strip by `elementFromPoint`; three and four injected crumbs hold line one. The
screenshots are `docs/plans/261003n-shot-after-*.png`. Not verified by anyone: a real iPhone.

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence. Refuse only on an **established** P0 or P1. Continue the IDs from the plan
review: new findings start at `F7`. For each: severity, established or reasoned, the path, and
either "fixed" with what you changed, or "reported" with the smallest change that would answer it.
Say what became of F1 to F6. End with `VERDICT: proceed` or `VERDICT: refuse (F…)`, and a list of
every file you edited.

## My own suspicions — worth less than your pass; spend most of the run elsewhere

1. `.crumbs li:last-child { position: absolute }` also matches the only crumb; `li:only-child`
   then moves it to the top. And `li:nth-last-child(2)` grows: is anything odd with exactly two?
2. The chevron is now `button:not([aria-current])::after` on a narrow window. Outside the query
   the old `li + li::before` still draws it. Is there any width or state where both or neither
   draw?
3. The wiring test overhears `layoutKey` through a mock of `useReadingPosition`. Is it testing the
   component or the mock?
4. `tests/crumbs-narrow.test.ts` pins the query's number rather than carrying the
   `spine-width-check` marker. Is that a second home for the number that can drift?
5. In `phone-and-touch.md`, "He has said this five times" and the list after it; and whether
   `skim.md`, `quotes.md` and `links.md` say what their lines claim.
