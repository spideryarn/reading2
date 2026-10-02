# 261002a — the horizontal scrollbar, a wider band on wide windows, Archive on the masthead

Three of Greg's Feedback reports from 2026-10-01, dispatched together by the Overseer on 2026-10-02.

## 1. The horizontal scrollbar (spya-y3747g, a bug)

> For some reason, there's a horizontal scroll bar permanently visible at the bottom of the page on
> my Mac, even for quite a wide window. I'm fairly sure this is new, and I'd rather it wasn't there.
>
> I wonder if it has anything to do with moving the feedback button to the right-hand side of the
> bottom-bar? Dunno.
>
> — Greg, 2026-10-01

**Reproduced, and not the Feedback button.** A Sonnet browser agent on the box, Playwright with
classic scrollbars forced on (`ignoreDefaultArgs: ["--hide-scrollbars"]`, 15px), at 1280, 1440 and
1920, plain and with Structure and Glossary open: `documentElement.scrollWidth` was the *window*
width and `clientWidth` 15px less at every one. With overlay scrollbars — the box's default, and a
trackpad Mac's — nothing overflowed, which is why nobody saw it. Hiding the bottom bar, or taking
the Feedback button's auto margin away, changed nothing.

Two boxes were sized for the width *under* the scrollbar:

- **`.reader`'s `min-width`, with a band open.** `useWindowWidth` measures `layoutViewportWidth()`,
  which is `max(innerWidth, root clientWidth)` — `innerWidth` on a desktop, scrollbar included, on
  purpose since 260912b so `layout.ts` agreed with `@media (max-width)`. `fitMode` hands every pixel
  of it to band and prose, and `.reader` asks for all of it.
- **`.masthead` and `.controls`**, sticky bars sized `calc(100vw − …)`; `100vw` counts the
  scrollbar. These overflow in plain mode too.

And two `fixed` boxes ran under the scrollbar without scrolling the page: **`.dock`**, `width:
100vw`, whose right end is where the Feedback button has sat since 2026-10-01 — so Greg's hunch
points at the right corner even though it is not the cause — and the covering band's `100vw`.

**The fix: one width, the page's.**

- `useWindowWidth` measures the root's `clientWidth` (`pageWidth` in `reader/measure.ts`), and also
  listens with a `ResizeObserver` on the root, because a scrollbar arriving after the article loads
  fires no `resize`. (It could loop — see Sol's P1 below — so `scrollbar-gutter: stable` now keeps the width fixed.)
  The iOS-zoom case 260912b fixed is unchanged — there the root's `clientWidth` *is* what
  `layoutViewportWidth` picked.
- `.reader` writes that same number as `--page-w`, and the two sticky bars use it instead of
  `100vw`.
- `.dock` and the covering band span the viewport with `left`/`right` instead of `width: 100vw`.

**What it gives up:** agreement with `@media (max-width)` beside a classic scrollbar, which is
260912b's reason for `innerWidth`. The reading view has one width query left, the 731px one that
takes the words off the wordmark and the Feedback button, so a 732–746px window with a classic
scrollbar keeps its words while being laid out for 717–731. Cosmetic, and the alternative is a page
that scrolls sideways at every width.

**The simpler option passed over:** `html { overflow-x: clip }`. One line, and it hides the symptom,
but the 15px of prose cell and masthead would still be under the scrollbar, and it would also hide
every future real overflow from the one-line check narrow-windows.md tells people to run.

**Tests, red first.** `tests/layout-viewport-width.test.tsx` had a case asserting the bug —
*"keeps innerWidth where it is the wider one — a desktop's classic scrollbar"* — now inverted, plus
a case for the scrollbar arriving with no `resize`; both were red before the change.
`tests/page-wide-bars-beside-the-scrollbar.test.ts` pins the four boxes off `100vw` and `--page-w`
being written; checked to fail on origin/dev's files. Postmortem:
`docs/postmortems/261002a-the-reading-view-laid-out-for-the-width-under-the-scrollbar.md`.

## 2. A wider band when the window has room (spya-xebdgz)

> I often find that the left-hand column could be just a touch wider. For example, with a chat. I
> think we've done research somewhere about the optimal column width for reading, and indeed that's
> what we've used for the text. And so I think if the window is really wide and there's space, the
> left-hand column should expand up to that sort of width.
>
> So stuff like chat or summary or basically anything that involves reading text would benefit from
> being up to that wide.
>
> Of course, we don't want to... I think the way it works right now for slightly narrow windows is
> pretty good, so we don't want to screw that up. So you might need multiple gradations.
>
> More importantly though, let's not introduce too much complexity.
>
> — Greg, 2026-10-01

**Today.** `bandWidth` in [`layout.ts`](../../src/web/layout.ts) gives a standard band
`clamp(avail − PROSE_MIN, MODE_MIN, MODE_IDEAL)` — 288 to 400px — and Summary's roomy band the same
up to 28rem (448px). Past about 944px of room the band stops and *all* the extra goes to the prose
cell. But the prose stops reading any wider at its measure: `.prose` is capped at
`--reading-measure` (65ch) and centred in its cell, so on a 1600px window the cell is ~1190px wide
holding a ~740px text run, with ~450px of blank page split either side of it — while the chat
beside it wraps at 400.

**The change: one more term, no new constant.** A standard or roomy band also takes whatever the
prose cell has *beyond* the width the prose can use — `proseAloneMaxPx`, the cap the prose already
gets when it is alone (the measure, its pad and the gutter) — up to `wideIdeal`, 34rem, which is
already this file's name for *a prose column's measure* and is the cap Tweets' wide band uses.

```
band = max(today's band, min(avail − proseAloneMaxPx(root), wideIdeal(root)))
```

At a 16px root, rail on:

| window | standard band today → after | roomy (Summary) today → after | prose cell after |
|---|---|---|---|
| ≤ 1220 | unchanged | unchanged (≤ 1268) | unchanged |
| 1280 | 400 → 460 | 448 → 460 | 808 |
| 1440 | 400 → 544 | 448 → 544 | 884 |
| 1920 | 400 → 544 | 448 → 544 | 1364 |

**Why this shape satisfies "don't screw up narrow windows" with no gradations to tune:** the new
term is only positive once the prose cell is already wider than the prose can use, so every width
at which the prose was still growing is byte-identical, and the prose never loses a character of
its measure. The gradations Greg anticipated come for free — the band grows continuously from 1220
to 1364 and stops. Every mode with a standard or roomy band gets it (chat, summary, glossary,
quotes, FAQ…); Structure keeps its own two-column sizing and Tweets already had this cap.

**`fitBoth` too** (band plus the marginalia column): it calls the same `bandWidth` on the room left
after the marginalia, and caps its prose at the same `proseAloneMaxPx`, so the same term means the
same thing there.

**The simpler option passed over:** raising `MODE_IDEAL` from 400 to 544. That is one number, but
it takes room from the prose at 944–1088px — exactly the slightly-narrow laptop widths Greg said
work well now.

**Tests.** `tests/layout.test.ts` pins `standard(1440).modeW === 400` and `roomy(1440) === 448`;
those become 544, and a sweep asserts (a) at every width up to the old crossover the band is what
the old formula gave, (b) the prose cell is never below `min(avail − band, proseAloneMaxPx)`'s
old value, (c) the band never exceeds `max(old ideal, wideIdeal)`. Browser check at 1280/1440/1920
in chat and summary.

## 3. Archive on the masthead (spya-br27ef)

> Add a button at the top of the reading view to archive the article, next to the button to share
> it publicly.
>
> — Greg, 2026-10-01

**The button next to it** is `SharingMark` in [`Masthead.tsx`](../../src/web/Masthead.tsx), the
globe or lock beside the title, owner-only. The Metadata page already has this exact act twice
(`TopActions` and the section at its foot, plan 260930h), both off one hook, `useArchive`, which
gets the rules right that are easy to get wrong: no button while we do not know which way round
the article is, the server's answer rather than the boolean we sent, and a fresh read after a
failure because a failed request is not proof nothing was written.

**So:**

- **Lift `useArchive`** (and `archiveAt`, `archiveAtFromPatch`, `ArchiveControl`) out of
  `Metadata.tsx` into `src/web/useArchive.ts`, unchanged, and import it in both places. A second
  copy is the thing not to do.
- **The masthead needs to know the state on arrival**, or it could only ever draw *Archive* — a
  claim about the reader's library out of nothing. `Article` gains `archivedAt?: string | null`,
  set in the Postgres projection off the `articles` row `currentRevision` already selects whole
  (the same free read `visibility` and `highPowerSince` use). Optional, like `visibility`:
  absent means *nobody could say* and draws no button; the visitor's payload is built from
  `PublicArticle`, an allowlist, so it never carries it.
- **`ArchiveMark`** beside `SharingMark`: the same 28px icon box, `Archive` when on the shelf and
  `ArchiveRestore` when archived, a `ControlTip` tooltip (*On your shelf* / *Archived*, what a
  press does, and that the article stays readable here either way). Nothing navigates — the
  Metadata version's rule, from Greg (*"it doesn't need to kick you out of the article itself"*).
  The press flips the icon; after a failure the icon turns red and the tooltip's head says
  *Couldn't confirm that* over the error, showing the state `useArchive`'s fresh read found.
- **Owner-only**, on the same `onRenamed !== undefined` stand-in `SharingMark` uses, plus the
  absent field.

**The simpler option passed over:** a button that archives and sends you back to the shelf, where
the Undo strip already lives. No new field on the payload — but it kicks you out of the article,
which Greg said Archive should not do, and it cannot show *Put back* on an article you open that is
already archived.

## GPT Sol's plan review, and what was done with it

[261002a-plan-review-sol.md](261002a-plan-review-sol.md) — *changes requested*; the band formula
and the visitor boundary passed.

1. **P1, taken: the root observer could flip.** "A narrower page is a taller one" is false:
   Structure's band drops from its columns (~619px) to 400 near a 1175px window, handing the prose
   200px, and a shorter page can lose its scrollbar and so its width back. `html {
   scrollbar-gutter: stable }` in shell.css keeps the scrollbar's room whether or not the page
   scrolls (nothing on overlay scrollbars), so the width cannot depend on the layout; the observer
   stays as the fallback where the property is unsupported, coalesced to one read a frame.
2. **P1, taken: Archive went stale between the reading view and Metadata.** `OwnedArticle` keeps
   one fetched payload across both views, so archiving on one and stepping to the other showed the
   old state. `useArchive` now reports every known answer (`onAnswer`), and `ArticlePage` layers it
   over the payload as it already does the sharing switch (`archivedTo`, beside `sharedTo`). The
   `key={slug}` on `ArchiveMark` went: `OwnedArticle key={slug}` already does that job.
3. **P2, declined: the offline cache of `/api/article/:slug` keeps the old `archivedAt`.** Online,
   `apiFetch` never answers from the cache, so only an offline reopen sees it, and there the press
   cannot succeed anyway. Invalidating would throw away the offline copy of an article the reader
   has just archived *and is still reading*. The title after a rename has the same property today.
4. **P2, taken: `.sk-full` and `.ill-full` were `100vw` too**, so the full-screen Sketch and
   Illustrated hung their right edge under a classic scrollbar. Now `left`/`right`, as
   lightbox.css does it; pinned in the same test.
5. **P2, declined: "the 731px query disagrees with the layout".** Nothing in `layout.ts` changes
   at 731/732 any more — gist columns are gone, and `fitView` has no threshold there — and the CSS
   was always comparing the window with the scrollbar against a page 15px narrower; this change
   did not alter that relationship, only the JS one, which now matches the page.

## GPT Sol's code review

[261002a-code-review-sol.md](261002a-code-review-sol.md) — *approve after the fixed P1*. Reporting
answers up from each button lost them when a press settled after its button had unmounted (a red
test showed it), so Sol did what it had recommended in the plan review: **one `useArchive` in
`OwnedArticle`**, above the view switch, handed to the masthead and to Metadata. No identity change
to `Article` on a press, so no Reader rebuild.

**What that gives up, accepted:** in the app the Metadata page's Archive buttons now start from
the payload's `archivedAt` (read when the article was opened) rather than the metadata endpoint's
own fresh read. They disagree only if the article was archived elsewhere — another tab, the shelf
— since it was opened, and then the press still asks the server and shows its answer.

## Order

1. The scrollbar: red test, fix, postmortem.
2. The band: tests, `bandWidth`, docs (narrow-windows.md § band shapes).
3. Archive: lift the hook, payload field, `ArchiveMark`, test.
4. Sol code review, browser check, feedback notes, land.
