# Chat's suggestions read from the top, and the Sketch overlay leaves a backdrop

Two small layout bugs found by the browser pass for
[261001l](261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md), handed
on by the Overseer and fixed together. Small fixes, so no plan-stage review. GPT Sol reviewed the code.
The note is [261001_1700](../user-feedback/261001_1700-chat-suggestions-and-sketch-overlay-on-small-and-wide-windows.md).

## 1. Chat's empty-state suggestions looked clipped on a landscape phone

**Reported:** on a landscape iPhone (band about 338px tall), the empty conversation's suggestions
start above the band's top edge.

**Reproduced** in Playwright, `noema-mythology-of-conscious-ai`, new conversation:

| Viewport | `.chat-scroll` height | content height | `scrollTop` on mount |
|---|---|---|---|
| 844×390 | 207 | 345 | **138** |
| 932×430 | 247 | 324 | **77** |
| 667×375 | 226 | 324 | **98** |
| 390×844 | 661 | 661 | 0 |
| 1280×800 | 643 | 643 | 0 |

At 844×390 the hint ("Ask anything about this article…") and the first question were off the top;
the band opened on "Evidence or assertion?".

**Cause: not a centring rule and not a fixed height.** `.chat-scroll` is a plain block with
`overflow-y: auto`. Nothing was clipped: the content was *scrolled*. `Conversation`'s
follow-the-latest-turn effect (`ChatPanel.tsx`) sets `scrollTop = scrollHeight` whenever `stick` is
true, and `stick` starts true, so it scrolled an empty thread to the bottom too. That only shows
where the suggestions are taller than the scroller, which is a landscape phone. Portrait and desktop
have room, so they were unaffected.

**Fix.** An empty thread is set to `scrollTop = 0`, and `onScroll` counts an empty thread as
following:

- there is no "Latest" pill over the suggestions, which had nothing to jump to, and
- a first question sent from halfway down the suggestions is still followed by its answer.
  Without this, `stick` would have been false at that moment.

**Simpler option passed over:** `justify-content`/`margin-top: auto` tricks or a `min-height` in
CSS. They would not have touched the cause, which is a script-set scroll position.

## 2. The Sketch's Enlarge overlay was as wide as the window

**Reproduced:** at 1280 and 1600, `.sk-in-full` measured 1280 and 1600 wide (`flex: 1 1 0%`), so
there was no backdrop to click. Escape and Close still worked.

**Cause** was as suspected. The panel is `<div class="sk sk-in-full">`, and `.sk` is `flex: 1`. A
non-`auto` `flex-basis` beats `width` for the main-axis size in the dialog's flex row. So
`width: min(94vw, 1120px)` never applied. This is **exactly the trap `.ill-in-full` fell into** and
documented on 2026-09-05. The Sketch copy of the rule was never given the same line.

**Fix:** `flex: none` on `.sk-in-full`, with a comment naming the trap.

## Tests

`tests/chat-empty-reads-from-the-top.test.tsx`. It went red on the old source: scrollTop 138
against 0, the pill present, the first answer not followed, and no `flex: none`. It is green on the
fix.

- **Chat.** jsdom has no layout, so the test supplies the scroller's measured geometry. Two
  controls check that the geometry is real: a thread with turns still opens at the bottom, and
  still shows the pill when scrolled up.
- **Sketch.** A stylesheet assertion, for both `.sk-in-full` and `.ill-in-full`. It also asserts
  that the base class still has `flex: 1`, so it notices if the trap goes away.

Browser check after the fix: see § Evidence.

## Evidence

(filled in after the browser pass and the review)
