# A picture inside a drawing is not the figure

Report spya-m40r6t (#718), Greg, 2026-10-27, admin, on LeCun's *A Path Towards Autonomous Machine
Intelligence*, imported as a PDF (slug `10356-a-path-towards-autonomous-mach-spya-jwqnrf`), at
Figure 12:

> Can we try and figure out why we weren't able to recover this figure? And ideally improve things
> going forwards

Prior work: [261019e](261019e-uncaptioned-pdf-figures-are-kept.md) and
[261019j](261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md) (report spya-x9gn3d,
uncaptioned figures in a book). They are a different failure on the same routes; this one is about
captioned figures. Routes: [article-images.md § Decisions](../project/article-images.md#decisions-worth-knowing-before-changing-anything).
Postmortem: [261027b](../postmortems/261027b-a-part-of-a-figure-was-taken-for-the-whole-figure.md).

## What happened

Read from production on 2026-10-27, read-only: the current revision, its blocks, its assets
manifest, its `ai_calls`, and the source PDF from the `sources` bucket. Then the real
`collectPdfFigures` was replayed locally on that PDF and those blocks, with a stand-in locator and an
in-memory bucket. The replay gives exactly the production manifest: 14 stored, 6 locator calls.

Most of this paper's figures are **vector diagrams that contain one or two small embedded
bitmaps**: a photo of the Earth (266×266 px, painted about 60 pt across) standing for "the world",
and two small icons, a blue "S" and a "Z" parallelogram. The same bitmap is reused across figures:

| bitmap | in figures (page) |
|---|---|
| Earth `f2a2…` | 3 (9), 4 (11), 5 (12), 16 (32), 17 (33) |
| "Z" `ceed…`, "S" `ae1c…` | 10 (21), 12 (25) |
| a 42 px icon `5af8…` | 16 (32), 17 (33) |

Seven of the twenty figures went wrong, in two ways:

1. **Figures 3, 4 and 5 show the wrong picture: the Earth icon, the same in all three.** On each
   of those pages the bitmap route saw one caption, one picture, and the caption printed on the
   page, so it paired them (`pairPageFigures`, `src/pdf-figures.ts`). Nothing checks whether the
   picture *is* the figure or only a small part of a drawing. This is worse than a missing figure,
   because the reader cannot tell it is wrong.
2. **Figures 10, 12, 16 and 17 have no picture.** Each page has two bitmaps, so the bitmap route
   refused it `ambiguous`; the drawn route only runs on pages with no image at all. The locator was
   asked, and its answer went to the composite route (`judgeLocatedRegion`), which **accepts** a
   correct box for each one (checked with hand-drawn boxes). The region was then thrown away by the
   rules that stop one picture being shown under two captions (`src/collect-pdf-figures.ts`,
   `locatedRoute` and `compositeRegion`):
   - 10 and 12 both contain the "Z" and "S" icons, so they "share a picture" and both are dropped;
   - 16 and 17 contain the Earth, which figure 3 had already taken (wrongly), so both are refused,
     and they share the 42 px icon with each other.

   With a locator that always answers the right box (the replay's oracle), the same four are still
   lost. **The model was not the problem: our rules threw away right answers.**

Both come from one assumption: **an embedded picture is a whole figure.** The bitmap route pairs
"the one picture on the page" with the caption, and the duplicate rules treat "these two regions
contain the same picture" as "these two regions are the same figure". In a diagram built around
reused icons, both are false.

## How common

Measured with a draft of the rule below (`measure.ts` in the session scratchpad, not committed): for
every page with exactly one usable picture, how large is the drawing that touches the picture,
compared with the picture itself?

- All 13 PDF articles in production (51 MB, downloaded read-only), plus the 14 eval PDFs: every
  real picture figure scores **1.00 to 1.29** (1.29 is a raster chart with a few vector marks
  around it). The only pages above 3 are LeCun's 9, 11 and 12, at **17, 28 and 31**.
- So in our corpus, this paper is the only one hit today. But diagrams with icons in them (a globe, a
  robot, a person) are a common style in ML papers, and ML papers are a large part of what Greg
  reads.

## The fix

Three changes. Each one is small, and each matters on its own.

**1. The bitmap route refuses a picture that is only part of a drawing:** new failure word
`in-a-drawing`. After `pairPageFigures`, for each paired figure: read the page's layout (vector ink,
the same reader the drawn route uses), start from the picture's visible box, and chain in every
drawn path that touches it (within `TOUCH_GAP_PT`, as `inkComponents` does), page furniture and
white artboards excluded. If the box of that drawing is at least `IN_A_DRAWING_RATIO` = 3 times the
picture's area, the picture is a part and not the figure. The outcome becomes a refusal, and that
refusal is `LOCATABLE`, so the locator and the composite route get a chance at the whole drawing.
The geometry is a pure function in `src/pdf-figure-region.ts`, next to `inkComponents`.

- Why 3: the measured gap is 1.29 to 17. A framed photo, or a raster chart with drawn axes, stays
  well under 2.
- **The layout read fails open:** if a page's layout cannot be read, the pairing stands as it does
  today. This is the drawn route's rule ("anything else leaves the bitmap route's answer
  standing"). Failing closed would lose every photo figure in a document whose layout pdf.js cannot
  read. This is the one place in the plan where I chose recall over safety. Sol, say if that is
  wrong.
- The pictures the bitmap route has "taken" are computed **after** this refusal. A picture refused
  `in-a-drawing` is not taken.

**2. A picture counts as a region's identity only when it is a large part of the region.**
`compositeRegion` collects `pictureIdentities` (the pictures a rendered region holds) for two
checks: the region may not contain a picture another figure already has (`taken`), and two regions
may not share a picture. A picture now counts only when its visible area is at least
`REGION_PICTURE_SHARE` = 0.25 of the crop. The render-identity check (two identical renders) and the
same-page overlap check are unchanged.

- Measured shares in this paper: Earth 4–6 % of its figure, the "Z" 2 %, the "S" 3 %. A
  six-photo grid's photos are about 17 % each, so this **does** drop the cross-page check for one
  photo inside a grid of four or more.
- What still stands behind such a region: its caption is found printed once, at a line start, on
  the answered page, right beside the region (`judgeLocatedRegion`, rules 2 to 5). The cross-page
  identity check was a second line of defence Sol added in code review (261001q, P1), against a
  repeat of one picture under two captions. It was never seen in a document. I think the
  caption-beside-region proof is the real defence, and that 0.25 keeps the check where it means
  something ("this region *is* that picture"). Sol, push back if you see a case.
- `keptPictures` uses the same `sharesPicture`, so it follows automatically.

**3. `MAX_LOCATE_CALLS` goes from 8 to 16.** After change 1, this paper has nine captioned figures
for the locator (1, 2, 3, 4, 5, 10, 12, 16, 17). With a cap of 8, Figure 17 would never be asked.
A call costs about $0.002 and two seconds (production's six took 22 s in all), so 16 calls is at most
about 3 cents and 40 s against the 180 s budget. The comment's premise ("eight covers every essay
and paper seen so far") is now false. I count this as obviously right rather than a product
choice, because of the cost, and because Greg asked on 2026-10-19 for *"all of the figures and
diagrams and tables if we can."* I will say so in the report.

### Not done, and why

- **Refusing a picture that is stored under several captions.** That would also catch the Earth
  three times. But it would also refuse a paper that really does repeat a figure, and change 1
  removes the cause. Instead, it is named in the postmortem as a detector we could add.
- **Letting the drawn route take a page with an icon in it.** That would avoid the model call for
  Figures 3, 4 and 5. But the drawn route's whole proof is "no image of any kind", and loosening it
  is a far larger review than this report needs.
- **`ASSETS_VERSION` is not bumped.** Forward only, as in 261019e/j: an existing article changes
  when it is re-extracted. Re-importing Greg's article is a production write, so it is left to him.

## After GPT Sol's plan review

[The review](261027e-plan-review-sol.md) agreed with the diagnosis, the 3× rule and the cap, and
found real holes. All were taken except where noted:

1. **(P0) The locator could put the icon back.** Its one-picture verdict (`judgeLocatedBox`) would
   accept a box drawn round the Earth. Now a figure refused `in-a-drawing` is recovered only as a
   rendered region, and not one that is mostly a single picture (`WHOLE_DRAWING_ONLY`). Test: one
   figure, a locator that boxes only the icon, still refused. It was seen red with the guard
   removed. With two figures, the older two-markers-one-picture rule hid the guard, so the test
   uses one.
2. **(P0) `PDF_FIGURE_RECOVERY_POLICY` is bumped to `pdf-figures/8`.** I had missed it. Without
   the bump, a re-extraction could read as current and keep the wrong Earths.
3. **(P1) The duplicate rule now sums the shares of shared pictures instead of judging each
   picture alone,** so a repeated six-photo grid (about 17 % each) still conflicts. Test: a
   six-photo grid on two pages, with boxes different enough that the renders differ. It was seen
   red with sum replaced by max.
4. **(P1) An unmeasurable page fails closed** (`unmeasured-picture`), not open. On every
   single-picture page in production's PDFs and the eval PDFs, the layout and paint box were both
   readable (0 of 151 skipped), so this costs no figure we have seen. Test seen red against fail-open.
5. **(P1) Detection reaches only connected drawing.** True. A bitmap panel beside disconnected
   vector panels is still taken as the whole figure. That is written down in article-images.md as
   a known gap and not built: no page in the corpus has it, and Sol's suggestion (vector ink
   anywhere in the caption's band) needs the band machinery of the drawn route, which is a larger
   change than this report needs. The thin-rule and caption-rule cases are covered by the corpus
   measurement (no false positive in 151 pages). The unit tests cover a frame, axis ticks,
   untouching ink and a page frame.
6. **(P1) The check is incremental.** Each paired page is measured and stored before the next is
   read, so a slow page cannot turn earlier ones `out-of-time`. Test: two paired pages, where the
   second page's read hits the clock and the first stays stored. The existing deadline test's stub
   now stalls only the drawn route's page, since the bitmap's own page read is part of deciding it.
7. **(P2) Docs.** ai-gateway.md's "eight" is updated, and article-images.md has the rule. The
   "40 s" estimate above was too definite: the 180 s clock is the bound, and uncaptioned calls add
   their own forty on top.

The corpus measurement was rerun with the shipping helper (`drawingAround`, chained per path, 75 %
page cut-off). It flags LeCun's pages 9, 11 and 12 and nothing else in 151 single-picture pages.
The highest unflagged score is 2.60, a 269 pt² logo on a title page, which is not a figure. Every
real figure scores 1.29 or less.

The LeCun replay on the final code, with the oracle locator: **18 stored (was 14)**, all seven
recovered as whole diagrams (checked by eye), the other eleven byte-identical, and 9 locator calls.

## After GPT Sol's code review

[The review](261027e-code-review-sol.md) fixed three things in the change, and I read its diff.
(P1) A figure refused `unmeasured-picture` could still be recovered as a tight region round a
picture whose paint had no measurable box. The region route now fails closed when the answered
page holds such a picture, and the one-picture guard sums repeats of one picture. It added a
regression test, which it saw go red first. (P2) The 16-call cap is now pinned by an exact
assertion. (P2) A stale count in `PdfFigureFailure`'s comment was corrected. It also checked that
the incremental-deadline test fails against the batch version, and it re-ran the replay: 18
stored, 7 located, 9 calls.

## Tests (red first)

- `tests/pdf-figure-region.test.ts` (or a new file beside it): the pure rule. A small picture with
  drawn boxes and arrows chained to it is part of a drawing. A picture alone, a picture with a thin
  frame, and a picture with axis ticks along two edges are not. Ink that does not touch the picture
  is not chained.
- `tests/collect-pdf-figures.test.ts` (or `collect-pdf-composite-figures.test.ts`): a synthetic PDF
  made with pdf-lib. On page 1, a caption under a vector diagram that contains a small embedded
  bitmap; on page 2, a second captioned diagram containing the same bitmap.
  - **Before the fix:** page 1 stores the bitmap, page 2 is refused.
  - **After the fix, with a scripted locator that answers each diagram's box:** both figures are
    stored as rendered regions, and neither is the bitmap.
  - Plus: with `locate: null`, page 1 is refused `in-a-drawing` rather than storing the icon.
- The LeCun replay, run again with the oracle locator: expect Figures 3, 4, 5, 10, 12, 16 and 17
  stored as regions, and the other thirteen unchanged. This is evidence, not a test. The PDF's
  licence is unclear, so it is not committed.

## What waits for 1 November

The box's OpenRouter key is over its monthly limit, so the real locator (`google/gemini-3-flash`
via OpenRouter) cannot be called until then. The oracle replay proves that our rules now **keep**
right answers. It cannot prove that the model **gives** them for these seven. In production it gave
right boxes for Figures 1 and 2 of this paper, but that is all the evidence there is. After the
reset, rerun the replay with the real locator (a few cents). Separately, Greg can re-import the
article once this is deployed.
