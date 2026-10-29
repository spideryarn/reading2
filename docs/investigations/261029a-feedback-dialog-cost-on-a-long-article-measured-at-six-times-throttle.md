# The Feedback dialog's cost on a long article, measured at 6× throttle

Evidence for [261029k](../plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md),
which answers two reports Greg filed a minute apart from an iPad on 2026-10-29, both from
`/read/arxiv-2308-08708-spya-xax6v4` (an 88-page paper): `spya-k3g78t` (scrolling inside the dialog
sometimes scrolls the article) and `spya-bewb4q` (Send shows nothing for a couple of seconds, then
*Sending*, then takes a while to close). Neither report carried diagnostics or a screenshot, so the
synchronous body-building suspected in [feedback.md § Send spins](../project/feedback.md#send-spins-and-it-already-did)
was not in play.

## How

Playwright against system Chrome on the box, local stack, a local admin with the 108 published
question files in the local `feedback_questions` (`feedback-questions.ts --publish --all --local`).
CDP `Emulation.setCPUThrottlingRate` 6, standing in for an old iPad; 1024×768, touch emulation for
the touch cases. Timings from `performance.now()` at `pointerdown`, a `MutationObserver` on the Send
label, rAF + `setTimeout(0)` for "painted", and Chrome traces (CPU profile, `SelectorStats` with
`disabled-by-default-blink.debug`, `invalidationTracking`). Scripts, raw outputs and traces were in
the session scratchpad and are not kept; the numbers below are the record. **The box was shared and
loaded; differences under ~30% are noise, and most rows are one or two runs.**

Articles: `s3-doctorow-250p-spya-jg872v` (≈87k DOM nodes, the main subject), the longest by blocks
(≈123k nodes), and a public article (9.4k nodes as admin, 4.8k as a plain reader).

## What it found

**The network is not it.** The response arrived ≈200ms after the request on every run. Everything
else is the main thread, and almost all of that is the browser's style system, not React. A
`vite preview` production build gave the same numbers as dev (press→*Sending* painted 1.39–1.46 s,
close 14.4–14.8 s on the 87k page).

**Two separate costs, with two separate causes.**

| Cost (87k-node page, 6×) | Measured | Cause |
|---|---|---|
| `showModal()` | 13–19 s | a modal makes the rest of the document inert, and inertness is computed style: every element is restyled |
| `close()` | 13–15 s | the same, undone |
| keystroke → paint | 1.0–1.4 s median | `:has()` rules anchored at `:root`/`.reader` re-run over the whole document after a change inside the dialog |
| press → *Sending* painted | 1.35–1.46 s | the same, plus re-rendering the hidden Earlier tab for an admin |

The A/B that pins the first: setting the `inert` attribute on the article's table alone, with no
dialog, cost 10.9–12.6 s on and 9.5–11.6 s off. Patching `showModal` to the non-modal `show()` cut
the call to ≈0.8 s and `close()` to 0 ms. Deleting the 62 rules that every element has to be tested
against (rightmost compound `:where(…)`, `:not(…)`, `*`, `::highlight`, `> *`) halved open and close
(≈5.4–7.1 s, ≈6.1–6.3 s) and left keystrokes alone: it shrinks the constant, not the O(n).
`content-visibility: hidden` on the article did not help.

The A/B that pins the second: deleting every `:has()` rule took keystroke→paint to 0.37–0.58 s and
press→*Sending* to 0.67–0.90 s, and left open/close where they were. Selector stats for a keystroke
put essentially all the selector time in five rules, each re-checked ~4 times a recalc at ~70–100ms
an attempt because each attempt walks the document:

- `:root:not(:has(:where(.reader) > .controls))` (shell.css)
- `:root:has(:where(.reader) > .controls):has(…focus-within…)` (shell.css)
- `:root:has(:where(.reader.band-covers) .mode-band, …) .controls` (shell.css)
- `:root:has(.return-chip)` (dock.css)
- `.reader:has(table.only-prose):not(.text-alone) .masthead-inner` (narrow-window.css)

Invalidation tracking during typing showed the root marked *"Affected by :has()"* once per recalc,
set off by mutations inside the dialog (the textarea's own shadow-DOM placeholder, text nodes in the
dialog), while only 0–10 elements were actually restyled.

**For an admin, the hidden Earlier tab was re-rendered on every keystroke**: `EarlierThreads` and
`ThreadContents` ≈126ms a key in the React track at 6× (dev build), on the Write tab, where nobody
could see them. A plain reader pays the same in kind but smaller (five rows rather than 108).

**Opening, with the same causes**: tap → dialog painted took 2.5 s (4.8k nodes) to 32 s (87k) and
52 s (123k).

**The scroll leak did not reproduce in Chrome**, by wheel or by touch, in any of the five places
tried (head, a short `.fb-scroll`, an overflowing one at a 420px-tall window, the backdrop, an
overflowing textarea): `window.scrollY` moved 0 every time, against a +400 control with no dialog.
The full-screen `.fb-dialog`'s `overscroll-behavior: contain` holds in Chrome. What Chrome cannot
show is iOS, where scrolling runs off the main thread against the last committed layer tree; the
reading that fits Greg's *"if I wait and then try again, it usually works"* is a swipe landing while
the main thread is still inside one of the multi-second restyles above, before the dialog's scroller
is in the tree it scrolls against. That is a hypothesis, untested on an iPad.

## After the fix (stage 1.5), 2026-10-29

The same harness (`has.ts` in `base` mode, the POST stubbed with a 201), the same book (86.9k nodes),
6×, against the worktree's own build with the root flags in (`data-bar-drawn` present on `<html>`).
Three runs; the box was shared, so read differences under ≈30% as noise.

| Measure | Before | Every `:has()` deleted | After |
|---|---|---|---|
| keystroke → paint, median | 1.0–1.4 s | 0.37–0.58 s | 0.46–0.48 s |
| press → *Sending* painted | ≈1.4 s | 0.67–0.90 s | 0.65–0.75 s |
| `showModal()` | 13–19 s | unchanged | 10–14 s |
| `close()` | 13–15 s | unchanged | 11–16 s |

Both `:has()` costs are gone: keystroke and press now sit at the delete-everything figures, which
is what stage 1 promised. Open and close are within their spread, as expected; they are stage 2's.
One key in each of two runs spiked to ≈1.1 s, not investigated.

## What it changes

The plan. And one thing worth carrying: on this app, **the size of the article is a multiplier on
anything that restyles the document**, so a cost that is invisible on a short page on a laptop is
seconds on a book on an old iPad. Two postmortems name the two classes:
[261029c](../postmortems/261029c-a-has-selector-anchored-above-the-article-walks-the-whole-document-on-every-change.md)
and [261029d](../postmortems/261029d-a-modal-dialog-inerts-every-element-so-opening-and-closing-cost-the-whole-article.md).
