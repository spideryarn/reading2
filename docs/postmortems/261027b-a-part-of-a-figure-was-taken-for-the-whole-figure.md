# A part of a figure was taken for the whole figure

Report spya-m40r6t (#718), Greg, 2026-10-27, on LeCun's *A Path Towards Autonomous Machine
Intelligence*, imported as a PDF:

> Can we try and figure out why we weren't able to recover this figure? And ideally improve things
> going forwards

The production reads, the replay and the measurements are in
[261027e](../plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md).

## What happened

Figure 12 is a vector diagram that contains two small embedded bitmaps, a "Z" and an "S" icon.
Figure 10 contains the same two icons. Figures 3, 4, 5, 16 and 17 each contain the same small
photo of the Earth. Seven of the paper's twenty figures went wrong:

- **Figures 3, 4 and 5 showed the Earth icon as the figure**, the same picture under three
  different captions. On each page the bitmap route found one caption, one picture, and the
  caption printed there, so it paired them.
- **Figures 10, 12, 16 and 17 showed nothing.** Two pictures on the page meant `ambiguous`, so the
  locator was asked. Then the rules against one picture under two captions threw away the answers:
  10 and 12 "shared" the "Z" and "S", and 16 and 17 held the Earth, which Figure 3 had "taken".
  In a replay that gave the locator the right box every time, all four were still lost. The model
  was not at fault.

Greg saw the missing Figure 12. The three wrong Earths were not reported, and they are the worse
half: a missing figure says so on the page, and a wrong one does not.

## The root cause

**Every rule in the PDF figure routes counted embedded pictures as if each one were a whole
figure.** "One picture on the page" meant "the figure". "Two regions hold the same picture" meant
"two regions are the same figure". Both are true for papers whose figures are photos or exported
charts, which is every corpus these routes were built and measured on: the bitmap route (260906a),
the caption check (260924e), and the composite route and its duplicate rule (261001q, where the
cross-page rule came from a GPT Sol code review against a case that was reasoned about, not seen).
None of them had a diagram in which a picture is a component, so the assumption was never
tested. The commit that turned the second half into a loss was `9a984e75d` (2026-10-01, the
composite route's cross-page picture identities). The first half dates from the bitmap route
itself.

## The class

**A part mistaken for the whole: a unit of storage taken as a unit of meaning.** The PDF stores
pictures as objects, and our rules took "an image object" to mean "a figure" because that is what
the file format offers to count. A figure is something the author made, and it can be one image
object, a drawing with several image objects in it, or a drawing with none. Any rule that counts
or compares the storage units ("exactly one", "the same one") inherits the mismatch. The same
shape elsewhere in this repo would be: treating a `<p>` as a paragraph, an `<img>` as a picture
the reader sees, or a PDF text run as a word.

It is a cousin of [261019b](261019b-a-figure-without-the-usual-evidence-was-treated-as-no-figure.md),
on the same routes eight days earlier. There, a figure was dropped for lacking the evidence later
steps expected (a caption). Here, a figure was misidentified because its evidence (a picture) was
only a fragment.

## The fix

Built in [261027e](../plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md):

- **A picture wired into a larger drawing is refused as the figure** (`in-a-drawing`). The drawing
  is followed through touching ink, and the threshold is 3× the picture's area. Real picture
  figures in our corpus score 1.00–1.29, and the Earth scores 17–31. An unmeasurable page fails
  closed (`unmeasured-picture`).
- **Such a figure can come back only as a rendered region**, and not one that is mostly a single
  picture, so a model that boxes the icon cannot restore it.
- **Located regions compare pictures by the share of the region they cover, summed**, so a reused
  icon does not make two diagrams one figure, and a repeated photo grid still does.
- The locator's call cap went from 8 to 16, since this paper needs nine calls.
- `PDF_FIGURE_RECOVERY_POLICY` is bumped to `pdf-figures/8`, so a re-import re-decides the
  figures instead of reusing the wrong Earths.

What remains of the class: a bitmap panel beside *disconnected* vector panels (nothing touches the
picture) is still taken as the whole figure. No such page is in our corpus. It is written down in
[article-images.md](../project/article-images.md) as a known gap.

## What would have caught it, ranked by ease against value

1. **Look at what was stored, figure by figure, against the page, on a few real documents from the
   kind of source Greg reads.** Rendering every stored figure beside its page took one script in
   this investigation, and the three identical Earths were visible at a glance. Not built here; it
   is what the replay harness in the plan does, by hand.
2. **Log a picture stored under more than one caption.** One identical image under two captions in
   one article is either a deliberate repeat or a mistake, and it is cheap to count. It would have
   flagged this paper on import. Not built: it is a detector, and rule 1 of the fix removes the
   cause. Worth doing if the class recurs.
3. **Put a diagram-heavy paper in the PDF eval set.** Every eval PDF is photos, charts or text. The
   cost is a fixture with a clear licence. LeCun's paper is not that, so it is not committed.
4. **When a review adds a rule against a case nobody has seen, ask what real layout the rule
   could refuse.** The 261001q cross-page rule was right about its threat and silent about its cost.
   [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) is the general form.
