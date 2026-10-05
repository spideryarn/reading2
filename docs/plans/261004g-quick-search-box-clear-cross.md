# A cross that empties the quick-search box in the bottom bar

Owned by [plans.md](../project/plans.md). The box itself is
[261002h](261002h-quick-search-bar-in-the-dock.md) stage 3; what it does is in
[search.md § Search as you type, and the box in the bottom bar](../project/search.md#search-as-you-type-and-the-box-in-the-bottom-bar).

> I just saw that you've added a little text input box for the quick search in the bottom-bar.
> That's actually pretty cool. I think I'd said before maybe to remove it. Maybe let's leave it for
> a while after all and see how it feels.
>
> Can you add a little X to it so that after I've searched with it, I can easily wipe it? Or maybe
> even automatically wipe it after I've searched with it.
>
> — Greg, 2026-10-04

## What is built

One stage. A small cross inside the box (`src/web/DockQuickSearch.tsx`,
`src/web/styles/dock-quick-search.css`):

- shown only while the box has words in it;
- pressing it does exactly what Escape did already — the two now call one function, `clear` — and
  then leaves the cursor in the box, where Escape lets go of it;
- a mouse press keeps the input focused (`preventDefault` on the mousedown). Focus anywhere in
  the field, including on the cross via Tab, keeps the box visible in Search mode; leaving the
  whole field turns it into the ⚡;
- 20px to look at, with a declared 40px finger target (`any-pointer: coarse`), reaching left over
  the input so it takes no taps from the button next to the field. The bar clips the target
  vertically: at a 12px root it is at most 29px tall, and at a 16px root at most 39px;
- out of the flow, so the bar is the same width with and without it and the fit ladder
  (`dock-fit.ts`) has nothing new to measure.

Done is: the tests in `tests/dock-quick-search.test.tsx § the clear cross` red then green, the
suite and typecheck green, a GPT Sol code review, and a browser check at desktop, iPad and phone.

## What was passed over

- **Wiping the box automatically after a search** — Greg's other suggestion. Not built: the words
  staying is what lets the next keystroke refine the same search (the session revises one row
  rather than starting another), and the cross makes wiping one press. It is his to overturn; the
  simplest version of it would be to clear on Enter.
- **The house cross, `.close-x`** (styles/close.css), which the shelf's search box took the same
  day ([261004f](261004f-shelf-search-clear-cross-that-can-be-seen.md)). It is a 32px box and this
  field is about 24px tall in a bar that must not grow. The 40px finger target is the same.
- **Not refocusing after a finger**, as the shelf's cross does to keep the on-screen keyboard down.
  Here the box only exists while a keyboard-and-pointer device is in use, and a bar box that loses
  the focus in Search mode stops being a box.

## Where it does not appear

A phone, and an iPad without a trackpad, never draw this box: they get the ⚡, which opens the
Search panel's own box (`pointer: coarse`, 261002h). That box had no cross yet, and no Escape key
either on a touch screen. Greg answered `Q-panel-box-cross yes` on 2026-10-04, and it was built in
[261005i](261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md).

## Review

No plan review: the Overseer scoped this as a small job with one code review. The code review and
the browser check are recorded below when they are back.

### Code review of `cdb7642e8`, 2026-10-04

- **F1 — P1, established, fixed.** Moving keyboard focus from the input to the cross collapsed
  the field in Search mode and started ending its typing session. Focus now belongs to the whole
  field; leaving through the cross still releases it.
- **F2 — P1, established, fixed.** The responsive handoff ignored focus on the cross. It now
  checks any focused descendant of the field. Both defects were reproduced with red DOM tests
  before fixing them. [Root cause and countermeasures](../postmortems/261004i-a-focus-boundary-must-grow-when-a-control-gains-a-second-focusable-child.md).
- **F3 — P3, reasoned, fixed in prose.** The declared 40px finger target is clipped vertically
  by the bar. The sizing claim above and the CSS comment now say so; no geometry was changed.
- **F4 — P3, established, wider.** `styles/close.css` still said the dock input has no cross of
  its own. The reviewer reported it; fixed afterwards by the author, in the same commit as the
  review's fixes.

Validation: the original 34 component tests passed. Temporarily removing the draft and band
clearing made three clear-cross tests fail; the mutation was restored. All 37 component tests
then passed, and `npm test -- --project unit` with the component, search-as-you-type, search-draft,
quick-session, dock-fit, help-page and doc-links files passed 138 tests across seven suites.
Lint on the three changed code/test files and `git diff --check` passed. The full typecheck passed
via `node --import tsx scripts/typecheck.ts`; `npm run typecheck` itself was blocked by the tsx
launcher's IPC socket. The database suites were not run in this worktree-only review.

Static CSS review found no added row width or height and no horizontal overlap with a neighbouring
button: the input already uses the global border-box reset, and the absolute target stays within
the field. Browser geometry and touch/pen event ordering remain unverified. The sandbox blocked
system Chrome's crashpad socket (`EPERM`, then `SIGTRAP`) and a local Vite listener (`EPERM`).

Verdict: **ship after these fixes**, with the browser check still outstanding. No commit, push or
deploy was made by the reviewer.

### Browser check, 2026-10-04

A Sonnet subagent, Playwright against system Chrome on the box, on an owner's article; once on
`cdb7642e8` and again on the tree with the review's fixes.

- **Desktop, 1440×900 (rung 3) and 1900×1000 (rung 2), mouse.** No cross in an empty box. Typing
  changed nothing about the bar: field 147×29.4, bar 40px high, no overflow, same rung. The cross
  is 20×20, 4px inside the field's right edge, centred. A real click empties the bar's box and the
  panel's, leaves the cursor in the bar's box, and the box does not turn into the ⚡; a new query
  then searches. Tab reaches the cross with a visible ring and the box stays; Enter and Space clear;
  a second Tab leaves the field and it becomes the ⚡. Escape clears and lets go as before. The
  Comments button 4.8px to the right still takes its own click. No console errors.
- **Phone (iPhone 14) and iPad without a trackpad (iPad Pro 11).** The ⚡ and no box, so no cross,
  as designed. The panel's box has no cross of its own.
- **Not observed: an iPad with a trackpad.** Chrome would not report `any-pointer: coarse`, so the
  finger target was measured with its rule injected without the media query: 40×40, taking a tap
  15px left of the cross, and not taking one 5px right of the field. Not tested on real iOS.
