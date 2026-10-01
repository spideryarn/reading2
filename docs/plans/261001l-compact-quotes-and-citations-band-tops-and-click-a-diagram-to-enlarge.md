# Compact Quotes and Citations band tops, and click a diagram to enlarge it

Four of Greg's own reports from the Feedback dialog, batched because they are all small changes to
the top of a mode band or to Diagram's two pictures. None of them had a note, so his Earlier tab
showed them as not shipped. Admin reports: build them, the simplest version first
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

> In citations mode, we use up quite a lot of vertical space with stuff that we might not need. So,
> for example, it says at the top how many works there are. I feel like that's maybe there's a more
> space-efficient way to say that. And at the bottom, there's an explanation of what citations mode
> is, and that could be inside an information icon tooltip, etc.
>
> — Greg, 2026-09-30, `spya-nca765`

> I can't use the Quotes or Glossary modes very well on landscape iPhone because all the stuff at
> the top of their columns takes up the vertical real estate, and I can't see the actual result.
>
> So remove anything redundant, move explanations behind tooltips, and take screenshots to try and
> find ways to make things vertically more compact but still usable and attractive.
>
> Also investigate other modes to look for similar problem.
>
> — Greg, 2026-09-10, `spya-gcdwps`

> If I click on the Sketch or Illustrated images in Diagram, that should be equivalent to clicking
> on Enlarge button for them.
>
> — Greg, 2026-09-05, `spya-dfghb4`

> When I click or double-click on a diagram (e.g. Illustrated, or perhaps on the background of a
> Sketch), it should Enlarge it.
>
> — Greg, 2026-09-11, `spya-mghbv7`

Glossary's half of `spya-gcdwps` already shipped as
[260929a](260929a-compact-glossary-header-and-kind-icons.md) (from a later report, `spya-dmuaqw`).
This plan does Quotes and Citations the same way, and then looks at the rest.

## Stage 1 — Quotes and Citations: the head row folds into the order row

The move Glossary made, made twice more, so the three list bands look alike.

```
QUOTES TODAY (owner, prioritised)          AFTER
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│ 14 quotes  👤 written for you   │ head   │ prioritised first … striking 👤 │
│ order prioritised first … strik │ order  │ bar 0.30 · 5 of 14 ↺            │
│ bar 0.30 · 5 of 14 ↺            │        │ ──────●────────                 │
│ ──────●────────                 │        │ 9 hidden below the bar          │
│ 9 hidden below the bar          │        │ "The first quote …"             │
│ "The first quote …"             │        └─────────────────────────────────┘
```

**Quotes** (`QuotesPanel.tsx`):

1. The "order" word in front of the rank buttons goes; the group keeps its `aria-label`.
2. Whenever the rank row is drawn there is no head row. Its two things move to the right-hand end
   of the rank row, beside the group and not in it (GlossaryPanel § SortBar says why): the profile
   badge, now `WrittenForYou compact` (the icon, as Glossary's is), and the count — but only
   outside *prioritised*, where the bar row already says *5 of 14*.
3. With fewer than two quotes, or fewer than two orders on offer, there is no rank row, so the head
   row stays as it is, count and badge.

**Citations** (`CitationsPanel.tsx`):

1. The same fold: no head row while the order row is drawn; the count goes to the order row's end,
   outside *prioritised* only. Citations has no profile badge.
2. **The foot's two sentences go behind an (i)** at the end of the order row: the capped note (only
   when the model said it left works out) and the influence note. The foot keeps only what it is
   for now, a running or failed job's progress. With no order row, the (i) goes in the head row
   beside the count.
3. The (i) is FAQ's *About these passages* (`FaqPanel.tsx § AboutPassages`, SPIDERYARN-READING2-62)
   — a controlled tooltip, so a tap opens it on a phone with no hover. **It moves to one shared
   component, `BandAbout`**, that FAQ and Citations both use, with the CSS renamed from `.faq-about`
   to `.band-about`. A second copy would be the thing
   [CLAUDE.md § Prefer simple over easy](../../CLAUDE.md) says not to write.

`fb8h-mode-info-icon` (SPIDERYARN-READING2-8H, queued to start later today) is going to give every
band an (i) for its metadata. `BandAbout` is the obvious thing for it to start from, and nothing
here gets in its way: it is one component in one place. The Overseer is told.

## Stage 2 — Diagram: a press on the picture enlarges it

**Illustrated** (`IllustratedView.tsx`): a press on the plate image, in the band, does what Enlarge
does. In the overlay it does nothing (it is already enlarged, and Greg did not ask for a press to
close it — the backdrop and Close do that).

**Sketch** (`SketchView.tsx`): a press on the picture's background, in the band, does the same. "The
background" is any press whose target is not inside a node (`.sk-node`, which selects) or a region
name (`.sk-region-open`, which opens a scene). Both keep their meaning; so does everything in the
overlay.

Both get `cursor: zoom-in` where the press enlarges, so the gesture can be found. The keyboard way
in is unchanged: the Enlarge button. The image and the SVG background get no key handler of their own
(the SVG's keys are the listbox's).

**A double-click must not open and then shut it.** Greg's second report says "click or
double-click". The first click opens the modal; the second lands in the top layer, and both
overlays light-dismiss on a press whose target is the `<dialog>` itself, so if the pointer is over
the backdrop the picture opens and closes in one gesture. Both backdrop handlers ignore a press with
`event.detail > 1` — the second click of a double-click. A deliberate single press on the backdrop
still closes it.

## Stage 3 — the other modes, at landscape iPhone

A screenshot pass at 844×390 over every mode, measuring how many pixels each band spends before its
first row of content. Trim only what is clearly redundant; anything that is a judgement goes in the
note as a suggestion rather than being built.

**What it measured** (2026-10-01, before this plan; the band is 338px tall in every mode there):

| mode | px before content | what is above it |
|---|---|---|
| Structure | 12 | nothing |
| Summary, Ideas, Timeline, Chat | 40–53 | one row |
| Search | 85 | the search box |
| Diagram | 87 | **an empty 19px head row**, then the kind picker (wraps to 69px) |
| Tweets | 103 | head 59, a note 32; a 48px provenance foot |
| Quotes | 137 | head 40 ("9 quotes"), order row 98 (wraps to two touch-height lines) |
| Debate | 163 | head 43, order row 54, a 66px "Searched on …" paragraph |
| Citations | 216 | head 40, order row 98, threshold block 79; **a 62px foot note** |
| Glossary | 233 | Look up 52, order row 98, threshold block 79 |
| Trajectory | 257 | head 105, the purpose form 137 above an existing route |
| Remember | 45 | but its composer takes 280 of 338px |

**Trimmed here**, being clearly redundant: Quotes' and Citations' head rows and Citations' foot
(stages 1 and 2), and **Diagram's empty head row** — drawn only when the scatter's caveat is in it.
It had been a fragment so that the `ModeSurface` refactor changed no DOM (Sol F28, 2026-09-07), a
reason that has expired.

**Not trimmed, and why:**

- **The order rows wrap onto two 40px lines on a phone** — the biggest single cost in Quotes,
  Citations and Glossary. The 40px floor is the touch fix for SPIDERYARN-READING2-2J
  (narrow-window.css § a coarse pointer). One line that scrolls sideways would halve it, but hides
  orders off the edge, which is a product call — sent to the Overseer as a recommendation.
- **Tweets' provenance foot, Debate's "Searched on …" line** — exactly what `fb8h-mode-info-icon`
  (SPIDERYARN-READING2-8H) is moving behind a per-mode (i), queued today.
- **Trajectory's purpose form, Remember's composer** — each is the mode's main control, not
  redundant chrome; whether it should fold away is a design call. Sent with the recommendation.
- **The threshold's "Nothing is hidden" line** — kept on purpose (threshold.ts § hiddenNote).

## Changed by GPT Sol's plan review

- **A press on the Sketch counts only if it is a real pointer press** — not keyboard or assistive
  activation (`detail 0`), not the end of a selection drag, not one already handled.
  `pointerType ""` is deliberately accepted because the Pointer Events standard also permits it
  for a real pointer whose device type the browser cannot detect. `src/web/enlargePress.ts`, shared
  by both views with the double-click guard.
- **The handler and the zoom cursor are on the in-band copy only** (`.enlarges`), and a plain
  Sketch node does not inherit the zoom cursor.
- Each panel computes its order options once and derives both the head and the order row from them,
  so a legacy list with several unscored items keeps its head row. Tests cover loading, visitor,
  legacy, and the job status in the foot for current and outdated lists and in the banner for stale.
- The double-click is checked with a real `page.mouse.dblclick` in the browser pass, since a
  synthetic `detail: 2` proves only the `if`.

## Not doing, and the simpler option passed over

- **A general mode-info (i) for every band** — that is `fb8h`'s, already queued.
- **Hiding the bar's "N hidden below" line.** It is what keeps the slider honest (threshold.ts §
  hiddenNote: present wherever the slider is), and Glossary kept it too.
- The simpler option for Citations was to delete the two footer sentences outright. They say the
  one thing a reader cannot know from the list — that *influence* is a model's memory, not a
  citation count — so they move rather than go.

## Testing

- Red first: Quotes and Citations panel tests asserting no `.band-head` while the order row is
  drawn, the count present outside *prioritised* and absent in it, and the (i) carrying the
  influence note; Illustrated and Sketch tests that a press on the image / the SVG background opens
  the overlay, a press on a node does not, and a `detail: 2` press on the backdrop does not close it.
- Browser: Playwright at 1280×800, 390×844 and 844×390, Quotes, Citations and both Diagram views.
- Gates: `npm test`, `npm run typecheck`, lint on the touched files.
