# A rule written to the width of the complaint

A reader could not press the glossary's *order* row on a touch device. The buttons were 23px tall,
and nothing in any mode band had ever been given a size for a finger — because the one time anybody
wrote such a rule, they scoped it to the control that had been complained about, and in the
fortnight that followed it travelled exactly as far as one link in a footnote.

> Also, make our button-bar at the bottom a bit easier to press, e.g. bigger buttons, slightly more
> spaced out.
>
> — Greg, 2026-08-28

That ask produced `@media (pointer: coarse)` in
[`narrow-window.css`](../../src/web/styles/narrow-window.css) (commit `4eede51e`, 2026-08-28): a 52px
bar and a 40px floor per button, with a comment explaining Apple's 44pt minimum. In the eleven days
that followed it reached exactly one further control — the footnote's *back to your place* link, in
`footnotes.css`, 2026-09-06 — and **nothing inside a mode band**. Then a report arrived about a
control in a band that had never been near it.

(This file said in its first draft that the dock's rule was the only finger-sized rule in the app.
That was wrong; GPT Sol found the footnote counter-example on review. The correction matters more
than most, because it is the same mistake the file is about: a claim made to the width of what the
author had looked at.)

- **Report:** SPIDERYARN-READING2-2J, 2026-09-07 17:46 UTC, from the administrator.
- **The work:** [260908a](../plans/260908a-glossary-order-button-not-clickable-on-touch.md).
- **The control:** `SortBar` in `GlossaryPanel.tsx`, styled in `glossary.css` since `bf5a91e3`
  (2026-08-25) — three days *before* the coarse-pointer query existed, and never revisited.

## The systemic defect the report exposed

Not the 23px. **The absence of any statement of what a control owes a finger**, so that every
control owes it nothing until somebody reports that one.

Three consequences, all of which the report walked into at once:

- the order buttons were 23px tall with 5px dead strips between the wrapped lines — 64% of the row's
  own box was not on a button;
- their only affordance beyond the flat label was a `:hover` wash, on a device that has no hover —
  and that wash paints nearly the same box as the *pressed* state, so it can make an unpressed order
  look like the one in force;
- every text field in the app was under 16px, which is the size below which iOS Safari zooms the
  whole page in on focus and does not zoom back out. Eleven in the stylesheets and four more in
  Tailwind utilities, and the glossary's is the one sitting directly above the row that could not be
  pressed.

None of these was noticed, because each was written correctly against a pointer and nothing ever
asks the second question.

## The class, which is the title

Somebody reports one instance. The fix is scoped to that instance — correctly, carefully, with a
good comment — and the general rule underneath it is never stated, so the next instance is a new
report rather than an already-solved case. The tell is a `@media` query, a helper or a constant that
is *right* and applies in exactly one place.

This codebase has the shape written down twice already under other names, and both are the same
animal: [controls.md](../project/controls.md) § *The reset covered a minority of what it named* (a
button reset scoped to `[data-slot]`, which was 23 of 59 buttons), and
[silent-success.md](../reusable/silent-success.md)'s `prefers-reduced-motion` guard that covered two
class names while fifteen animations ran. **A rule scoped to its first instance looks identical to a
rule that is complete**, and the difference is invisible from inside the file that carries it.

It is worth saying what this class is *not*. It is not "we forgot". Each of these fixes was
deliberate and well-argued at its own scope; `4eede51e`'s comment reasons carefully about
`pointer: coarse` versus `any-pointer: coarse` and about which axis had room. The failure is one
level up: nobody asked **"what else is this true of?"** and wrote the answer down where the next
person would meet it.

## What was shipped, and what is right for the long term

**Shipped**: a 40px floor for the two order rows, `:hover` behind `@media (hover: hover)` with
`:active` beside it, one rule raising every text field in the stylesheets to 16px on a touchscreen,
and `tw:any-pointer-coarse:text-base` on the four fields the utilities layer put out of its reach —
plus [`tests/touch-controls.test.ts`](../../tests/touch-controls.test.ts), and the rule itself written
down in [narrow-windows.md § What a control owes a finger](../project/narrow-windows.md#what-a-control-owes-a-finger).

**Right for the long term**: the floor should belong to *a control*, not to two named selectors. The
band still holds a 16px-tall slider and half a dozen buttons between 19 and 28px, and each will be
its own report. What that wants is what [controls.md](../project/controls.md) already began for the
shelf — one stated height for a class of control, in one place — extended with a coarse-pointer
number beside the pointer one. That is a design change and Greg's to make; it is not what an
unattended run should ship off the back of one report.

**And the incident is still not diagnosed.** This is the part worth being honest about: the fix is a
floor, not an explanation. The report could not be reproduced in Chromium under touch emulation at
five viewports, nor against the production bundle, and the engine it is about (iPadOS WebKit) cannot
be run on this box. GPT Sol found an open WebKit bug — 254861, stale hit-testing of `position: fixed`
controls in an installed iPad web app after the keyboard is dismissed — that fits every piece of
evidence, and the plan doc carries the three questions that would confirm or kill it. **A postmortem
that claimed the cause was the button height would be tidier and wrong.**

## What would have caught it, ranked by ease against value

1. **Say what a control owes a finger, once, where the next person meets it** — done:
   narrow-windows.md § What a control owes a finger, and touch.md § *And it did not reach the mode
   bands*. Costs a paragraph. Would have turned the dock's fix into a rule instead of an instance.
2. **When a `@media`, a helper or a constant is added for one reported case, name in the commit what
   else it is true of** — a habit, free, and it is the same discipline
   [rename-or-move.md](../reusable/rename-or-move.md) already asks for after a rename. Both prior
   instances of this class would have been caught by somebody asking the question out loud once.
3. **A tripwire over the sizes** — done for the two order rows and the fields
   (`tests/touch-controls.test.ts`). It is third rather than first because it is a text scanner and
   cannot say a finger lands on a button — and because, on the evidence, it is the weaker of the two
   checks that were running: see the near-miss below, which it was green through, twice.
4. **A layout-aware check that measures every interactive element against 44px** — rejected for now.
   It needs a browser in the suite, which this repo deliberately does not have
   ([browser-testing.md](../project/browser-testing.md)), and it would report a hundred true
   findings on day one with no decision behind any of them. Worth revisiting if the stated rule in
   (1) turns into a real control class.

## The near-miss inside the fix, which is its own small lesson

The font-size rule shipped once **applying to nothing**. `textarea` on its own is specificity
(0,0,1) and `.chat-input` is (0,1,0), so the chat composer stayed at 15.04px with the new rule three
lines above it in the same block. The test was green — it checked that the rule was *written*. A
browser measurement is what caught it.

Then the fix for it shipped broken too. The replacement test asked only whether each half beat *one*
class — and `.remember .chat-input` in mode-band.css is two, so Remember mode was still 15.68px with
every test green. GPT Sol's review caught that one; nothing else would have.

That is [silent-success](../reusable/silent-success.md) twice in one afternoon: **a CSS rule that
loses on specificity is indistinguishable, from every angle except a rendered page, from one that
wins** — and so is a test that checks the wrong threshold. The check that now exists computes real
specificity, finds the heaviest competing rule rather than assuming one, and names
`.remember .chat-input` so that a search which stops finding it goes red instead of quiet.
