# 261004f — The shelf search's clear cross, made visible

Report `spya-wzmvva` (SPIDERYARN-READING2-C7), from Greg (admin, proved by
`feedback-reporter.ts` exit 0), filed 2026-10-04 10:38 UTC from `/?archived=1`, production build
`6cf20e98`:

> Little cross button to clear the search on the logged in homepage shelf.

## What is there today

**The button he asks for already exists**, and has since 2026-08-26 (`f862af5e8`): `SearchBox` in
`src/web/Library.tsx` draws `<button aria-label="Clear the search">` at the right end of the box
whenever there is a query. So this is not a missing feature; the question is why its owner could
not see it.

Measured in Chromium on the box (a Sonnet browser subagent, signed in, 1280×800, 1024×768 touch,
390×844 touch, on `/`, `/?archived=1` and `/?q=the&archived=1`):

- Our cross is in the DOM, uncovered (`elementFromPoint` at its centre is its own svg), and clicking
  it empties the box and removes `?q=` while keeping `?archived=1`.
- It is a **14px, thin-stroke glyph in `muted-foreground`** (`oklch(0.63 0 0)`) on the card
  (`oklch(0.205 0 0)`), in a 28px box. [Unfocused](261004f-shot-before-unfocused.png), it is all
  there is, and it is faint.
- **While the box has the focus, Chromium also draws its own cross** (`::-webkit-search-cancel-button`,
  `display: inline-block`), bold and white, about 25px left of ours:
  [two crosses](261004f-shot-before-focused.png). The Search panel and the Dock's quick search hide
  theirs (`search.css`, `dock-quick-search.css`); the shelf never did.

**What is a guess:** which of these Greg met. Safari on a Mac draws the native cross too; iPadOS
Safari was not tested and this box cannot test it. Either way the best-supported reading is the
same: the cross that is ours is plausibly too faint to find, and where a second one appears it is
the browser's.

## What we will do

One cross, which can be seen and hit.

1. **Hide the browser's cross on this box**, with a rule in a stylesheet rather than a Tailwind
   arbitrary variant (`changelog.css` says why a vendor pseudo-element in a `tw:[…]` is a trap).
2. **Make ours the house cross.** Give the button `.close-x` (`styles/close.css`): a 32px box, an
   18px glyph, and an invisible 40px target for a finger. Its colour goes from `muted-foreground` to
   `foreground`. The input is 38px tall (42 on a phone), so a 32px box fits inside it; the input's
   right padding grows from `pr-9` to a fixed 44px so text does not run under it. The cross's 6px
   right inset is fixed too: unlike the cross and its target, Tailwind's named spacing shrinks with
   the browser's root size, and the app supports a 12px root.
3. **After the cross is pressed, the cursor is back in the box** — unless it was pressed with a
   finger or a pen, where that would throw the on-screen keyboard up over the shelf. What pressed it
   is read at the `pointerdown`, not from `(pointer: coarse)` and not off the click (touch.md § The
   spine: an iPad with a keyboard says its pointer is fine, and since iOS 18.2 a finger's click can
   say `mouse`). A keyboard press sends no pointerdown and gets the cursor back.
4. **Escape clears the box when there is something in it**, as it does in the Search panel, the
   Dock's quick search and the Metadata contents box. An Escape in an empty box is left alone, so it
   still reaches anything else listening.

### The simpler option passed over

Only step 1 and a colour change: two lines. Passed over because a 14px glyph in a 28px box is small for
a finger, and `.close-x` is the house answer to a cross Greg kept missing on an iPad (`261002i` —
that was the comment card's, about 20×15px, so it is precedent and not evidence about this one);
using it is one class, not new machinery.

### The other option passed over

Keep the browser's cross and delete ours. Firefox draws none, and on a dark field the native one is
not ours to colour (`search.css` hid it for that reason).

### A choice worth naming

`.close-x` was written for "every modal and panel" close. A clear-the-box cross is not a close, so
this widens what that class means to "a cross you press": its header comment gets a line saying so.
`tests/close-cross.test.ts` lists the modal closes by name and is not widened, because its second
guard (no component rule re-sets the size) is about component stylesheets and this button has none.

## Tests, red first

In `tests/shelf-search-focus.test.tsx`'s harness (a new file beside it, same mocks):

- the cross is absent with no query, present with one, and carries `close-x`;
- pressing it empties the box and the URL's `q`, keeps `archived=1`, and puts the focus in the box;
- pressed by `touch` or `pen` it empties the box and does **not** focus it; by keyboard it does;
- the button carries no `tw:size-*`, which would beat `.close-x` on layer order;
- Escape with a query clears it; Escape in an empty box is not `preventDefault`ed;
- the stylesheet hides `::-webkit-search-cancel-button` for the class the input carries (a string
  check on `readerCss()`; jsdom cannot compute it — the browser check below is the real one).

Then a browser check at the same three viewports: one cross focused and unfocused, the computed
`display` of the native one is `none`, the measured box is 32px, and a long query does not run
under it.

## Not doing

- The other search boxes. The Metadata/Profile contents box keeps the platform's cross on purpose
  (`PageContents.tsx`); the Search panel and Dock clear on Escape only. Nobody has asked.
- A light-appearance check beyond tokens: `foreground` on `card` is the page's own text contrast.

## Docs

`library.md` § the search box gets two sentences; `close.css`'s header gets one.

## Plan review (GPT Sol, 2026-10-04)

[261004f-shelf-search-clear-plan-review-sol.md](261004f-shelf-search-clear-plan-review-sol.md):
*build with changes*. All four findings checked and taken, and the text above now says what was
built:

1. **P2** `tw:size-7` would have beaten `.close-x`'s 32px on layer order — removed, and a test
   refuses any Tailwind size on the button.
2. **P2** the finger test was `(pointer: coarse)`; it is now the press's own `pointerdown`.
3. **P2** the tests waited 50ms for a URL that is debounced by 200ms — they wait 350ms.
4. **P3** two sentences claimed more about what Greg met than the evidence holds — reworded.

The code review fixed the stale press it left: a click made without a pointer overrides any abandoned
finger press, and `pointercancel` clears the note too. It also found that `pr-11` shrinks below the
fixed-pixel target at the supported 12px root, which is why step 2 now uses fixed pixels.

## Code review (GPT Sol, 2026-10-04) and the browser check

[261004f-shelf-search-clear-code-review-sol.md](261004f-shelf-search-clear-code-review-sol.md):
*ship after the fixes I made*. It fixed, and I read and kept:

1. **P1** my edit had run two classes together (`tw:pr-11tw:text-sm`), so the input had neither its
   padding nor its text size. The jsdom tests could not see it; a browser run saw it as 2px of
   padding. Fixed, and the padding and the cross's inset are now in px (`pr-[44px]`, `right-[6px]`),
   because the app supports a 12px root where `pr-11` would be 33px and let text under the 40px
   target. The test now pins the exact classes.
2. **P2** the finger note could go stale, and treated every non-mouse pointer as a finger. Now only
   `touch` and `pen` hold the cursor back; a click that no pointer made (keyboard, voice, assistive
   technology) always gets it back, and `pointercancel` clears the note. This closes the case the
   plan review section above had left open.
3. **P3** test blind spots and one overclaiming sentence, fixed.

**Browser check** (Sonnet subagent, Chromium on the box, after the P1 fix; 1280 mouse, 1024 touch,
390 touch, on `/?archived=1`): one cross focused and unfocused at all three; the button 32×32, the
glyph 18×18, in `foreground`; the 40px finger target wholly inside the input; a 100-character query
stops 2px short of the target; a mouse click, Enter and Space on the cross clear the box and return
the cursor; a tap clears it and does not; Escape clears it and removes `q`, keeping `archived=1`;
Enter still only blurs; no console errors. **Not checked:** a real iPad or phone keyboard, Safari,
and the light appearance. `getComputedStyle` on the pseudo-element reports `inline-block` even on a
control input, so "the browser's cross is hidden" rests on the before and after crops, not on that
number.
