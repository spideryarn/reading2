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
- pressing it never blurs the box (`preventDefault` on the mousedown). In Search mode a blurred bar
  box turns into the ⚡, so without this the cross would vanish between the press and the click;
- 20px to look at, 40px to a finger (`any-pointer: coarse`), reaching left over the input so it
  takes no taps from the button next to the field;
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
Search panel's own box (`pointer: coarse`, 261002h). That box has no cross, and no Escape key
either on a touch screen. Raised with Greg as a question rather than built here.

## Review

No plan review: the Overseer scoped this as a small job with one code review. The code review and
the browser check are recorded below when they are back.
