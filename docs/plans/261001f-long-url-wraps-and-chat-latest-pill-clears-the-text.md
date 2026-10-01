# A long URL wraps, and chat's "Latest" pill stops covering the text

Two small display bugs, both seen in the Playwright screenshots of
[261001d-typeface-per-voice.md](261001d-typeface-per-voice.md) on 2026-10-01 and dispatched by the
Overseer as bug fixes. Neither came from a reader. Small and focused, with no redesign.

## Prior work

Checked first: `docs/plans/`, `docs/user-feedback/`, `git log --oneline -200 origin/dev`, and
`gjd-remote ls`. 261001d noticed both bugs and declared them out of its scope. Nothing else owns
either.

## Bug 1: a bare URL runs off a phone screen

**Seen.** The article `fowler-phrenology` at 390×844 has a "Persistent URL" block whose text is a
bare, unlinked `https://wellcomecollection.org/works/a5aaj99u`. Measured in Chrome:

- `scrollWidth − clientWidth` is **25px**, so the page scrolls sideways.
- The `<p>` and its `.prose` are 328px wide, with a scrollWidth of 367.
- Every ancestor computes `overflow-wrap: normal`. The reading table is `table-layout: fixed`.

Screenshots: [before](261001f-before-url-390.png), [after](261001f-after-url-390.png).

**Cause.** [`prose.css`](../../src/web/styles/prose.css) breaks long words only inside links
(`.prose a { overflow-wrap: break-word; }`). Its own comment names "unbroken identifiers" as the
problem, but only a URL inside an `<a>` was covered. Text extracted from a scan or a PDF often has
the URL as plain text.

**Fix.** Move the declaration up to `.prose`, which covers the old rule, and delete the `.prose a`
rule. Injecting it in the live page brought the overflow to 0, and the desktop measurements came out
identical. I chose `break-word` over `anywhere`:

- Both fix this case, because the table is fixed-layout.
- `break-word` leaves min-content widths alone, so a data table's cells still refuse to wrap, as
  [typography.md § Content that cannot reflow](../project/typography.md) wants.

**Test.** `tests/prose-long-words-wrap.test.ts` reads the reader CSS and requires the `.prose` rule
itself to declare `overflow-wrap: break-word` (exactly, per Sol's review). It is red before the fix: the
declaration is only on `.prose a`.

## Bug 2: the "Latest" pill covers a line

**Seen.** `.chat-to-bottom` is `position: absolute; bottom: 3.6rem` against whichever positioned
box holds it: the fixed mode band, or the fixed chat dialog. Measured in Chrome at both 1440 and 390:

- The pill straddles the boundary between the transcript and the composer: 10px over the transcript
  and 16px over the composer.
- It hides one line of text at every scroll position where it shows.
- At 390 that includes the conversation's **last** line, from just past the 60px threshold onwards.

Screenshots: [before](261001f-before-chat-390-70.png); after, [in the band](261001f-after-chatmode-390-pill.png) and [in the dialog](261001f-after-dialog-390-pill.png).

**Cause.** 3.6rem is a guess at the composer's height, and the composer has no fixed height:

- the textarea grows to 10rem
- the row wraps (`flex-wrap`)
- dictation adds a line
- Remember starts it at six rows

So the pill can land anywhere from over the transcript to deep inside the composer.

**Fix.** Take the pill out of absolute positioning. It is already rendered between the scroller and
the composer, so in normal flow it gets its own strip there, centred, and covers nothing. While the
pill shows, the scroller is about 2rem shorter.

- That shrink does not move the text. `scrollTop` is unchanged and the top of the view stays where
  it was, so the reader only sees less at the bottom.
- It cannot oscillate. Showing the pill shrinks `clientHeight`, which makes the reader further from
  the bottom, which keeps the pill shown. Hiding it does the reverse.

**Options considered.**

- **Anchor the pill to the scroller's bottom edge, still floating.** Simpler in one way: it stops
  overlapping the composer. But it still hides a line at every scroll position, including the last
  line at 61–70px, which is the bug as reported.
- **Pad the end of the transcript.** It only matters where the pill is already hidden, and near the
  threshold it brings the last line *closer* to the pill.
- **Show the pill only once the last line is off screen.** It would need measuring per frame.

The in-flow strip is the only one of these that guarantees no text is covered, and it is a
CSS-and-comment change.

**The dialog needed one more rule** — GPT Sol's plan review
([prompt](261001f-long-url-wraps-and-chat-latest-pill-clears-the-text-plan-review-prompt.md),
[answer](261001f-long-url-wraps-and-chat-latest-pill-clears-the-text-plan-review-sol.md)). The chat
dialog reuses `Conversation`, but its `.chat-dialog-body` was the scroller: it scrolled the composer
away with the turns, `.chat-scroll` never scrolled, and so the pill could never appear there. A
`.chat-dialog-body:has(> .chat-scroll)` rule makes it a flex column with `overflow: hidden`, as the
band already is. Drafts and errors in the dialog are untouched.

**Test.** `tests/chat-latest-pill-in-flow.test.ts` reads the reader CSS and requires:

- the `.chat-to-bottom` rule to have no `position` and no offsets or transform;
- `flex: none` and `align-self: center` on it;
- the dialog rule above, and `.chat-scroll` still owning the overflow.

The first part was red before the fix. The dialog assertion was seen red by renaming its selector.
None of it can see geometry, which is what the browser pass is for.

## Checked after the fix

The same two scripts as the repro, in a real browser, at 390 and at 1440. Pass conditions:

- Page overflow is 0 and the URL wraps.
- The pill's rect intersects neither a text line nor the composer at 61, 70, 100 and 200px from the
  bottom, nor mid-scroll.
- Desktop prose is unchanged.

## Progress

- [x] Reproduced both in Chrome (Sonnet subagent, Playwright).
- [x] Sol plan review: build with changes. Taken: the dialog rule, the tighter tests, and the
  browser cases for the dialog, a data table and a growing textarea.
- [x] Tests red, then fix, then green.
- [x] Browser pass after the fix (Sonnet subagent, Playwright, 390 and 1440). All passed:
  - **URL.** Page overflow is 0 and the URL paragraph is 328/328 at 390. Desktop `.prose` is
    unchanged at x 446–1019.
  - **Tables.** On the two seeded articles with tables, wide ones still scroll in their own box
    (for example 644/328).
  - **Pill in the band and in the dialog.** It never intersects the transcript or the composer at
    61, 70, 100 or 200px from the bottom, or mid-scroll. It is absent below 60px.
  - **No flicker.** Pinned at 61 the pill showed in 20 of 20 samples; at 58, in 0 of 20.
  - **Click and typing.** Clicking the pill reaches the bottom. Eight typed lines in the composer
    keep it clear, scrolled away or pinned.
  - **Dialog scrolling.** `.chat-scroll` scrolls (4967/407) and the composer stays on screen.
- **Seen and not fixed (out of scope):** `antikythera-mechanism` overflows a 390px page by 180px.
  The cause is three spans inside `.zoomable` wrappers at x 364–570. The overflow is identical with
  the old rule restored, so it predates this work.
- [ ] Sol code review, then commit and push to dev
