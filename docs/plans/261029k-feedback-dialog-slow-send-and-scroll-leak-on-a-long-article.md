# The Feedback dialog is slow, and leaks its scroll, on a long article

Two reports from Greg (admin), a minute apart, from an iPad, on
`/read/arxiv-2308-08708-spya-xax6v4` on 2026-10-29:

> sometimes when the feedback mode dialog is open and I try and scroll within the dialog box, it
> actually scrolls the text in the article behind, even though the dialog box is supposed to be
> modal. It's not the end of the world. If I wait and then try again, it usually works. […] are we
> making use of the right abstractions or third-party library framework stuff for dialog boxes, or
> I don't know, is there just a better way to implement it or make it more robust?
>
> — Greg, 2026-10-29 (`spya-k3g78t`)

> after I've written the text in the box and then I click the send button, often there's a delay of
> a couple of seconds where nothing happens. And then if I carry on waiting, the send button changes
> […] and then the dialogue disappears as it's supposed to. […] Are we somehow doing a lot of work
> just to click the send button?
>
> — Greg, 2026-10-29 (`spya-bewb4q`)

The third report of a slow Send on an iPad
([260905_1802](../user-feedback/260905_1802-spinner-on-the-send-button.md),
[261018_2338](../user-feedback/261018_2338-feedback-send-drawn-at-full-strength-while-it-works.md)).
Both earlier answers looked at the button. This one measured the page, and the page is the answer.

## What was found

All of it is in [the investigation](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md).
In one paragraph: the network answers in ≈200ms; the rest is the browser restyling the article,
and the article's size multiplies it. Two separate causes.

1. **`:has()` anchored at `:root` walks the document on every change.** About fifteen rules ask
   "is there a `.controls`/`.mode-band`/`.return-chip`/`.dock-drawer`/… anywhere?" from `:root`
   (shell.css, dock.css, narrow-window.css, crumbs.css). After a DOM change inside the dialog — a
   keystroke changes the textarea's own placeholder — Chrome re-checked them, and each check walked
   all 87k nodes. Observed in Chrome; consistent with how both engines invalidate `:has()`, and
   plausibly the same on the iPad's Safari, but not measured there (GPT Sol's P2). Keystroke → paint 1.0–1.4 s and press → *Sending* painted ≈1.4 s at 6×
   on a book; deleting every `:has()` rule took those to 0.4–0.6 s and 0.7–0.9 s. The single most
   expensive rule, `:root:not(:has(:where(.reader) > .controls))`, cost more selector time than all
   others in a keystroke put together.
2. **A modal `<dialog>` inerts every element.** `showModal()` makes the rest of the document inert
   and both engines compute inertness as style (Blink measured here; WebKit's source does the same), so opening and closing restyle the whole article:
   13–19 s and 13–15 s at 6× on a book. The `inert` attribute alone on the article costs the same;
   a non-modal `show()` costs 0.8 s and 0 ms. This is the *"it just takes a while"* after
   *Sending*, and the likeliest cause of the scroll leak: on iOS a swipe is scrolled off the main
   thread against the last committed layer tree, and during a multi-second restyle the dialog's
   scroller is not in it yet — *"if I wait and then try again, it usually works"*. Not reproduced
   in Chrome, where the dialog's `overscroll-behavior: contain` held in every case tried.

And a small third: **for an admin the hidden Earlier tab re-rendered on every keystroke** (108
question rows, ≈126ms a key at 6× in a dev build).

## Greg's question, answered plainly

The native `<dialog>` with `showModal()` is a sound abstraction and it is what the platform
recommends: focus trap, Escape, the top layer and an inert background for free. **Its one cost is
the one that bit us: "inert background" is implemented as a restyle of every element in the page**,
which is nothing on a short page and seconds on a book on an old iPad. A library would not have
saved us: Radix Dialog (shadcn's) avoids `inert` but sets `pointer-events: none` on `body`, which is
again a walk over every element's style, and its scroll-bar compensation fights our
`scrollbar-gutter: stable`. The sturdier option is our own small modal surface that inerts nothing
(stage 2) — which is a real trade, so it is Greg's to decide. The rest of the slowness was ours: the
`:has()` rules, which are fixed here regardless.

## Stages

### Stage 1 — the changes with no trade-off (this plan, built now)

1. **The hidden Earlier tab is not re-rendered while hidden.** `StillWhileHidden` in
   FeedbackDialog.tsx: a `memo` whose comparison skips a render only when the tab was hidden and
   still is. The render that hides it and the one that shows it go through with current props;
   state and hooks inside update as before. Tested by counting renders across 15 keystrokes, red
   without it (16 renders) and green with it. Done.
2. **Every `:root`/`html`-anchored `:has()` becomes an attribute on `<html>` set from JS.** One hook,
   `useRootFlag(flag, on)` in `src/web/root-flags.ts`, with the flags a closed union (`RootFlag`) so a
   typo is a compile error, reference-counted (two dialogs can both say `dialog-open`), applied in an
   insertion effect so descendants cannot measure the old CSS in their layout effects — as `:has()`
   was. A companion for the `:focus-within` arguments reconciles from the document's focused element
   after `focusin`, and in a microtask after `focusout` and window `blur`, rather than trusting
   `relatedTarget` (null for an iframe, the body, a removed node: GPT Sol P1). Dock More's flag comes
   from its own `open` state, not from Radix's `data-state` in the DOM; SkipToModes, which marks the
   dock imperatively, takes an imperative lease (Sol P1). Each rule keeps its exact meaning and **its specificity**, which
   shell.css's ladder (§ the four states of `--bar-bottom`) and narrow-window.css's guard depend on:
   where an attribute selector would score less than the `:has()` it replaces, it is doubled
   (`[data-x][data-x]`) and the arithmetic written beside it, as those comments already do. The
   flags, and who sets each:

   | flag | was | set by |
   |---|---|---|
   | `bar` | `:where(.reader) > .controls` | Reader.tsx, where `.controls` renders |
   | `bar-focus` | `… > .controls:focus-within` | the same element, focus-within hook |
   | `bar-crumbs` | `… > .controls > .crumbs` | Reader.tsx (`showCrumbs` with the bar) |
   | `band-covers` | `:where(.reader.band-covers) .mode-band` | Reader.tsx (`.band-covers` and a band rendered) |
   | `band-fitted` | `:where(.reader) .mode-band:is(.outln, .struct)` | Reader.tsx (Outline or Structure band rendered) |
   | `return-chip` | `.return-chip` | BandBackChip **and** ReturnChip (GPT Sol P1: the plan had missed the second) |
   | `install-hint` / `install-hint-focus` | `.install-hint` / `:focus-within` | InstallHint |
   | `dock-drawer` / `dock-focus` / `dock-more-open` / `dock-skip-arrived` | `.dock-drawer`, `.dock:focus-within`, `MORE_OPEN`, `.dock[data-skip-arrived]` | Dock, SkipToModes |
   | `side-dialog` | `.cmt-dialog, .chat-dialog, .annotate-dialog` | each of the three |

   The exact list is whatever the grep finds at build time; this table is the plan's reading of it.
   A side benefit: today several of these are scoped with `:where(.reader) >` precisely so that an
   article's own `<p class="controls">` cannot forge them. A flag set from React state cannot be
   forged by markup at all.
3. **`.reader:has(table…)` takes a `>`**, and the three `.reader.band-covers:has(.mode-band…)` rules
   in narrow-window.css become flags with the rest (Sol P1). `table.zoom` is a direct child of `.reader` (checked in the
   live DOM, and the rewritten selectors matched the same elements as the originals), so
   `.reader:has(> table.only-prose)` and `.reader:has(> table.zoom.overflowing)` mean the same and
   check one level, not the article.
4. **A check for the class**, not the instance: `tests/no-document-wide-has.test.ts` parses every
   selector in the reader CSS and fails on a `:has(` whose subject includes `:root`, `html`, `body`,
   `#root` or `.reader` unless **every arm** of its argument uses only bounded combinators (`>`, `+`,
   `~`) — "starts with `>`" was too loose, since `:has(> .x, .deep)` passes it (Sol P1). The rule in
   two lines, with the reason, in [performance.md](../project/performance.md#style-recalculation-scales-with-the-article-2026-10-29)
   rather than design-css-overview.md, which is an entry point and takes a rule only with Greg's yes.
5. **Measured again** at 6× on the same book, against the numbers in the investigation: keystroke →
   paint and press → *Sending* painted must fall to roughly the delete-every-`:has()` figures. If
   they do not, the remaining cost is named before anything else is changed.

**What stage 1 does not fix, said as plainly in both notes**: opening and closing still cost the
whole article, so the *"takes a while"* after *Sending* stays, and so does the leading explanation of
the scroll leak. That is stage 2's, and only an actual iPad can confirm it, including a swipe made
immediately after the dialog opens (Sol P1).

### Stage 2 — a modal that inerts nothing (Greg's decision; not built)

A shared modal surface: a fixed, full-screen overlay portalled to the end of `body`, `role="dialog"`
`aria-modal="true"`, a focus trap, Escape (capture phase, never mid-IME), backdrop click, a
non-passive `touchmove`/`wheel` guard that lets only the dialog's own scrollers move — and **no
`inert`, no `showModal()`**. Opening and closing then cost the dialog, not the article. It gives up
the platform's focus trap and Escape for ours, and the background is hidden from screen readers by
`aria-modal` alone, which older ones honour less well than `inert`. Feedback first, measured on the
iPad; then Lightbox, PurposePrompt, AuthorGiftDialog, CommandBar, Sketch's and Illustrated's full
views (seven `showModal()` callers), and the eleven `dialog[open]` queries that mean "a modal owns
Escape" become one shared selector. Opus's arbitration (2026-10-29) recommended this over Radix
(`pointer-events: none` on `body` is again O(n); its scroll-bar margin fights
`scrollbar-gutter: stable`) and over the Popover API (needs iPadOS 17; two code paths). Asked as
question `q-f7xm4h`. Before it is built, its acceptance covers initial and return focus,
programmatic focus escaping the trap, keyboard scrolling, nested overlays and Escape ordering,
background activation, and VoiceOver's virtual cursor, not only pointer and touch (Sol P2).

### Passed over

- **Lock the page with `html { overflow: hidden }` while a modal is open.** Lightbox.tsx rejected it
  for the reading position, and it does not address the stall that is the likelier cause.
- **Make every selector bucketable** (the 62 rules every element is tested against). Halves the
  restyle, keeps the O(n). Worth doing for its own sake, but it does not answer either report;
  a queue item.
- **`content-visibility` on the article.** Measured: no help.
- **Showing *Sending* by direct DOM before React renders.** Paint waits for the restyle either way;
  the restyle is what is slow.

## Reviews

- GPT Sol on the plan, 2026-10-29: [review](261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article-review-sol.md).
  No P0. Five P1s and four P2s, all taken; each is marked where it changed the plan above. Verdict on
  StillWhileHidden: no behaviour lost (fetching, counts and reply drafts live above it; the
  visible→hidden render still stops dictation; re-showing runs the thread scroll-reset).

## Status

- [x] Stage 1.1, StillWhileHidden, with its test.
- [x] Stage 1.2–1.4, root flags and the class test; GPT Sol code review [here](261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article-code-review-sol.md), its P1 and two P2s fixed.
- [x] Stage 1.5, measured: keystroke 1.0–1.4 s → ≈0.47 s, press → *Sending* ≈1.4 s → ≈0.7 s; open and close unchanged ([investigation § After the fix](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md#after-the-fix-stage-15-2026-10-29)).
- [x] Stage 2: asked Greg as `q-f7xm4h`; not built.
