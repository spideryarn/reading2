# Reopen lands on the paragraph you were reading

Report **spya-qspg5a** (#606, Sentry `1cd428b0e76f4ccdab785f39db5779cb`), filed 2026-10-18 from
production build 956a2380, on `rovelli-order-of-time-…-spya-r26sug`:

> When I reopen an article that I've already been reading, it should ideally reopen at roughly the
> position where I was on last, where I was, yeah, the paragraph that I was reading most recently.
>
> — Greg, 2026-10-18

The per-device restore has existed since 2026-09-05
([260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md),
[url-state.md § Reopening an article where you left it](../project/url-state.md#reopening-an-article-where-you-left-it)).
So this started as a regression hunt, and it found two things.

## What is wrong, measured

**1. A bug: a cold arrival at `?at=` lands short, and the spy writes the short landing down.**
Reproduced on local dev (Playwright, fresh context, 3,051-block article, scripts in the session
scratchpad). Opening the bare address restores `?at=spya-muy70h` (stored), the restore effect
(`useReadingPosition.ts`) scrolls there instantly at 13.4s, and at 18.1s **Source Serif 4** — the prose
face, `font-display: swap` — finishes loading. 113 rows above the target rewrap one or two lines each,
and the target moves down 3,181px. Nothing holds an arrival at the top (`holdAnchor` is for centred
arrivals only), and Chrome's own scroll anchoring does not compensate because the prose is a
`<table>`. The spy's next measure names the previous section and writes it to `?at=` **and to
`localStorage`**, so the next reopen starts one section further back. Four reopens walked 367 → 311
→ 262 → 190. A shared link carrying `?at=` drifts the same way; a reload "worked" only because the
font was cached. Control: the same run with the font requests aborted lands exactly.

Introduced by 9b4b7a933 (2026-10-02, *the three faces for everyone*), which put the prose in a
swap-loaded serif; before, the prose face (Geist) was loaded before the article rendered. The class
is already written up — [postmortem 261002b](../postmortems/261002b-a-scroll-aimed-before-the-fonts-arrive-lands-where-the-text-was.md),
*a position computed before layout has settled* — and its fix (`flash.ts § keepAligned`) was never
applied to the reader's own restore. Here it is made worse by a feedback loop: a spy that writes the
unsettled measurement back as the truth. Postmortem:
[261019a](../postmortems/261019a-a-reopen-drifted-back-a-section-each-time.md).

**2. A limit by design: `?at=` is a section, not a paragraph.** `position.ts` says so: *"reopening a
link puts you at the top of the section you were in, not at the paragraph you were on. Within a
section that is a few paragraphs of backtracking."* On Greg's Rovelli article (production, read-only
count) the median body section is 29 blocks, about **1,650 words — seven minutes of reading**; the
section his report was filed from is 33 blocks. "A few paragraphs" is not true of a book.

## What we will do

### Stage 1 — an arrival at `?at=` holds until the reader moves (the bug)

- **Share `keepAligned`.** Move it (and `READER_INPUT`) out of `flash.ts` into a small module of its
  own, unchanged except for an option: the help page keeps its two-second cap; the reader's restore
  takes none (the swap came 4.7s after the scroll on dev, so a 2s cap would not have caught it).
- **The restore effect holds its arrival.** URL → page in `useReadingPosition` (first load,
  Back/Forward, a pasted link, a restore) runs `scrollToBlock(at, "auto")` as now, then keeps that
  block at the top on every `loadingdone` and every resize of the body/table, until: the reader's own
  input (`wheel`, `touchstart`, `keydown`, `pointerdown`), a scroll event that finds the block no
  longer at the reading line (a scrollbar drag, which sends no input event we can rely on — Chrome's
  anchoring of a block inserted above the table keeps the block at the line and so does not end it),
  a newer arrival or jump, or unmount.
- **The spy writes nothing while the arrival holds** — the same rule as a jump in flight
  (`positionToWrite`'s `jumpInFlight`), so the unsettled measurement can never be written down.
- The `layoutKey` re-anchor needs no change: while the hold lasts, it re-anchors to the same `at`.

Simpler option passed over: preloading the font, or a metric-matched fallback. It removes this mover
but not the class (images, folds, late content), and the loop that makes it permanent would remain.
Worth doing later as a nicety; not this plan.

### Stage 2 — the memory keeps the paragraph (the request)

`?at=` in the address stays a section, which was Greg's call on 2026-08-25 (*"store the section rather
than the exact position?"*) and keeps the update rate down: the whole reader re-renders on a change of
`at`. Only **the copy kept in `localStorage`** gets finer.

- **The spy notes the paragraph at the reading line** on each measure it makes while settled (no jump
  in flight, no arrival held): the last visible row whose top is at or above the line — a binary search
  over the article's rows, about a dozen rect reads — canonicalised by `visibleNear` like everything
  else it names. It hands `last-view` the pair `{ at, block }`, where `at` is the value it holds for
  `?at=`.
- **`last-view` stores that block in place of `at`** when the address's `at` is the same `at` the note
  was made against; otherwise it stores the address as now. It saves on each new note as well as on
  each address change, so leaving the tab, the app or the article needs no unload hook.
- **A restore therefore puts a paragraph in `?at=`** — a state the app already supports: a jump can put
  one there, and the spy leaves it standing while the reader stays in that paragraph's section
  (`positionToWrite`, *a finer value stands*). Stage 1's hold keeps it at the top through the font swap.

Simpler option passed over: write the paragraph into the address itself. One writer, no note — but it
reverses Greg's 2026-08-25 decision, and puts a whole-reader re-render on every paragraph crossing,
on articles where one has cost seconds (`useReadingPosition.ts`, Sentry SPIDERYARN-READING2-1M).

### After GPT Sol's plan review (BUILD AFTER FIXES — all seven taken)

[Review](261019a-reopen-lands-on-the-paragraph-you-were-reading-review-sol.md). What changed:

- **Stage 1 extends the arrival anchor rather than adding a second hold (F1, F6).** `scroll.ts`'s
  anchor gains `align` (`top` | `centre`) and `keep`. Ownership is free: every movement runs
  `cancel()`, which already ends the anchor, so a note link, a Skim stop or a jump ends the restore's
  hold without being told. `keepAligned` stays in `flash.ts`. While a `keep` anchor is held,
  `onFontsChanged` (not `fonts.ready`, fonts.ts says why) and a `ResizeObserver` on the body re-align
  it through the same path the reflow re-anchor uses (`recentreArrival`, renamed `realignArrival`).
  The watchers are torn down with the anchor, so no cap is needed and nothing outlives it.
- **The reader's input ends it, corrective frame and all (F2):** `wheel`, `touchstart`, `keydown` and
  `pointerdown` run `abandonScroll()`, not just a release of the hold.
- **A scroll the browser made to keep the block in place does not end it**: for a `top` anchor, a
  scroll at a new pixel that finds the block still at the reading line moves `anchorY` instead. That
  is Chrome anchoring the controls bar, a block above the table; the reader's own scroll moves the block.
- **Stage 2's note saves at once, authoritatively (F3):** a new measurement writes the remembered
  search with `at` set to the measured block — or removed, at the top — whatever the address says
  yet. An address-change save substitutes the block only while the address's `at` is the `at` the
  note was made against.
- **The note is owned by the current `useLastView` (F4):** it registers the saver for its slug, view
  and reader and unregisters on cleanup, so a note can never be saved under another reader, article
  or view.
- **Hidden rows (F5):** the sample is the last row at or above the reading line that is not
  `isRowHidden` (walking back over a hidden run), none when nothing has crossed it, then `visibleNear`.
- **The URL contract, said properly (F7):** ordinary scrolling keeps the address section-granular;
  jumps, and now a restore, may put a paragraph there, and a reload or a copied link keeps it.

### Not in this plan: the other device

Cross-device stays deferred, as in 260905d. It needs a per-reader, per-article row on the server (a
schema change) — and the report does not say another device was involved; the drift alone explains
it. Offered to Greg in the feedback note, not built.

### Stage 3 — docs and bookkeeping

- `position.ts` header and url-state.md § Reopening: the stored copy is a paragraph; the arrival holds.
- Postmortem for the drift (the class, 9b4b7a933, the fix, what would catch it: a browser check from a
  fresh context, cache off — the root-cause script is the shape).
- `docs/user-feedback/` note for spya-qspg5a.

## Tests

- **Red first:** a unit test that the spy writes nothing while an arrival holds, and one that a
  resize/`loadingdone` after the restore re-aligns (fake `ResizeObserver` / `document.fonts`, as the
  `keepAligned` tests do if any exist — otherwise new); `last-view` substitution (matching and
  non-matching `at`); a spy note naming the row at the line.
- **Browser:** the root-cause script re-run, fresh context, cache off: bare reopen and `?at=` link land
  on the block, `?at=` unchanged after 10s; then a deep scroll mid-section, bare reopen lands on that
  paragraph, desktop and phone.

## What happened when it was built

- **Phone width failed the first browser check** while desktop passed, and two things were wrong.
  (1) `Reader`'s layout effect on a change of mode cleared every arrival, the kept one included; it
  now ends only a centred one (`endCentredArrival`). (2) The font reflow moved `scrollY` by a pixel
  and fired a scroll event in the frame that moved the block, before any font or resize callback,
  so the hold ended on it. The rule is now: if the block is still in place, the hold stays; if the
  page's height has changed, it re-aligns; anything else is the reader moving. Both are pinned in
  `tests/reading-position-holds-across-a-reflow.test.tsx`, and the second test was seen to fail
  with its rule switched off.
- **A reopen erased the paragraph it was about to restore.** The spy's first measurement still
  held the bare address's `null`, so it noted "the top". A note is now sent only when the spy's
  value is the address's, or is a write the spy itself queued.
- **GPT Sol's code review**
  ([`…-code-review-sol.md`](261019a-reopen-lands-on-the-paragraph-you-were-reading-code-review-sol.md),
  LAND AFTER FIXES, made):
  - A fresh note now survives an unrelated address write that still carries the older section,
    while Back/Forward wins. `onAddressChange` passes its event through so the two can be told
    apart.
  - Kept arrivals carry an owner token, so the hook's unmount or a change of `?at=` releases only
    its own hold, and StrictMode's replay takes it again.
