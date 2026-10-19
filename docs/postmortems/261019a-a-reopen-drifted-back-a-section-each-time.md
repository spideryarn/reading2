# A reopen drifted back a section each time

**What happened.** Greg reported (spya-qspg5a, 2026-10-18) that reopening an article he had been
reading did not bring him back to where he was. The per-device restore had shipped on 2026-09-05
([260905d](../plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)),
so this was checked as a regression first, and it was one. On local dev, with a fresh browser
context, opening an article at its bare address landed a whole section short of the section stored
for it. It then **stored that earlier section**, so four reopens in a row walked from block 367 to
311, 262 and 190. A link carrying `?at=` did the same. A reload "worked" only because its font was
already cached.

**The real cause, measured** (Playwright timeline, plan
[261019a](../plans/261019a-reopen-lands-on-the-paragraph-you-were-reading.md)):

- At 13.4s the restore effect in `useReadingPosition.ts` scrolled instantly to `?at=`.
- At 18.1s Source Serif 4 arrived. It is the prose face and loads with `font-display: swap`. 113 rows
  above the target rewrapped by one or two lines each, and the target moved 3,181px down with
  `scrollY` unchanged. Chrome's scroll anchoring did not compensate, because the prose is a
  `<table>` and growth inside it above the window is not anchored (probed: a row grown by 500px
  moved the target by 500px).
- Nothing held the arrival. `glide` re-aims once, on the next frame, and the anchor that holds a
  position existed only for centred arrivals.
- The spy measured the shifted page, named the section above, and wrote it into `?at=` and so into
  `localStorage`.

Control: the same run with the font requests aborted landed exactly.

**The class.** *A position computed before layout has settled*, which is exactly
[261002b](261002b-a-scroll-aimed-before-the-fonts-arrive-lands-where-the-text-was.md) — **made
permanent by a spy that writes the unsettled measurement back as the truth.** The second half is what
turned a one-off miss into a ratchet. Every reopen restores the wrong value, which then misses again.
261002b's fix (`flash.ts § keepAligned`) was shared code, but only for pages arriving by anchor. The
reader's own `?at=` restore never used it, and nobody asked whether it should when the prose face
changed.

**Introduced by** 9b4b7a933 (2026-10-02, *261002f: the three faces for everyone*), which put the
article prose in a swap-loaded serif for every reader. Before that the prose was Geist, which had
finished loading long before an article rendered, so the instant arrival (e6eb7e075, 2026-08-25) was
safe by luck of timing, not by design.

**The fix that is right for the long term.** An arrival at `?at=` holds until the reader moves
(`scroll.ts § arriveAt`). The existing arrival anchor gained a top-aligned, *kept* kind. It
re-aligns on `onFontsChanged` and on a body resize, and it ends on the reader's input (which cancels
a corrective frame still to come), on any newer movement, or on a scroll that moves its block. It
has no timer: on dev the swap came 4.7s after the scroll, beyond 261002b's two-second cap. While it
holds, `positionToWrite`'s `anchored` rule stops the spy writing anything but the arrival's own
section. Preloading the font would remove this one mover, but images and late content would still
move rows and the ratchet would remain, so it was not the fix.

**What would catch the class.** A browser check that opens a deep `?at=`, and a bare-address reopen,
**from a fresh context with the cache off**, waits past `document.fonts`' `loadingdone`, and asserts
both that the block is at the reading line and that `?at=` and the stored value did not change.
That is the 261002b advice again, applied to the address that matters most. Unit tests stand in for
the browser with a stub `document.fonts`
(`tests/reading-position-holds-across-a-reflow.test.tsx` § an arrival at ?at= while the fonts are
still arriving), but jsdom has no layout, so the stub only proves what the browser check measured.
