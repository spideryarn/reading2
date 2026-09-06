# The spine highlights the section, not just the part

**Status as of 2026-09-06: reviewed, not built.** Fable reviewed the product shape and GPT Sol the
technical one ([review](260906g-spine-concentric-depth-highlight-review-sol.md)); this doc has been
revised against both. Nothing in `src/` has changed.

## The problem

Greg, 2026-09-06:

> I was reading the Nagel article and it has 2 top-level sections: a short References section, and
> then 95+% of the rest of the article is in its own top-level section. The Spine only really
> highlights in orange the current top-level section, so basically the Spine is almost completely
> orange when I'm reading the main section. Can we have multiple opacities of orange in the Spine to
> highlight concentrically the current level-1 section in the Spine, then within that the current
> level-2, then the current level-3, and so on.

The rail draws exactly one you-are-here fill, and it is the **part** (`.spine-part.active` —
`--highlight-wash` behind a `--depth-1` tint at `opacity: 0.75`). When one part is most of the
document that fill is honest and says nothing: the reader is told "you are in the 95% of the article
that is the article".

**This is not a Nagel pathology.** Measured across the thirteen trees in `data/` (biggest L1 as a
fraction of the block count):

| biggest L1 | articles |
|---|---|
| ≥ 55% | 3 of 13 — `todo` 70%, `read` 70%, `noema-mythology-of-conscious-ai` 55% |
| 30–39% | 5 |
| ≤ 22% | 5 |

Nagel at 95% is the far end of a shape a quarter of the corpus already has.

## The fix, in one sentence

**Draw the current L2.** The component already knows it.

`hereHit` in [`Spine.tsx`](../../src/web/Spine.tsx) is the current L2 (or the childless part standing
in for one). It is already state, already recomputed on the scroll path, and already re-renders the
rail on every L2 crossing — pinned at *exactly one render per crossing* by
`tests/spine-scroll.test.ts`. Today it feeds only `aria-current="location"` and the hover card's
*you are here*. The whole visual fix is to paint it.

That means **a second ring costs no additional React renders and no new scroll subscription** — no
new state, no new effect, no setter on an ordinary scroll frame. That is the narrow claim, and it is
the one that makes this a CSS-and-one-div change. It is *not* free in the absolute: there is one
more painted layer, and one `O(hits)` lookup inside renders that were happening anyway. Both are
negligible at a few dozen bands; neither should be described as zero. GPT Sol, 2026-09-06.

## What Greg asked for, and where it is subtly wrong

Fable's product review, 2026-09-06, and I agree with all three:

- **It is one new ring, not a ladder.** In every tree we have, the level below L2 is the block:
  measured on `scaling-hypothesis`, depth-1 = 9 nodes (all titled), depth-2 = 75 (34 titled and
  gisted), depth-3 = **145 leaves, one per block — 0 titles, 0 gists, 136 navLabels**. The reasons
  for stopping at L2 are below, and two of the first draft's were wrong.
- **The complaint is that the part fill is too loud for what it knows.** Two ways to answer it:
  make it *relative* (don't light a part above some size), or make it quieter everywhere and let the
  section ring carry the signal. **Take the second.** A threshold gives the rail two behaviours the
  reader has to learn — *why is the part not lit on this article?* — and a magic number to argue
  about; turning it down uniformly gives one behaviour that degrades gracefully. On the Nagel shape
  the part becomes a slightly warmer field and the ring inside it is what you see; on a nine-part
  article the part still reads.
- **Opacity of one token, not the depth hue ladder.** `--depth-0…3` runs `oklch(0.82 …)` down to
  `oklch(0.44 …)` — it gets *darker* with depth, so on the near-black page a "deeper" ring painted
  from it would recede rather than advance. That is the same class of mistake
  [colour-scales.md](../project/colour-scales.md) § *The page is near-black* already names.

## The design

Three layers, each on its own visual channel so none can be mistaken for another:

| | channel | colour | now | proposed |
|---|---|---|---|---|
| **Part (L1)** | fill of the whole band | `--depth-1` tint | 0.3 idle, **0.75 active + `--highlight-wash` background** | 0.3 idle, **~0.45 active, no wash** |
| **Section (L2)** | fill, inset | `--depth-1` tint | — | **~0.8, only the current one** |
| **Viewport** | crisp edges | `--highlight` | 1px borders + 12% wash | unchanged |

So: fill says *which section*, and brand orange says *which pixels* — `--highlight` stops being a
fill anywhere on the rail except hover.

- **`left: 2px`**, matching the L2 tick's inset, so the ring reads as nested inside the part rather
  than as a second band. Cheap; drop it if a screenshot says it reads as a rendering gap.
- **Keep the L2 hairlines.** They are the ground that makes the ring read as *one of these* rather
  than as a brighter smear.

### The cases

- **Coincident edges.** The first child begins at exactly its parent's pixel — the tree invariant.
  That collides *labels*; it does not collide fills. The ring sits flush with the top of the band,
  which is what the rule and the tick already do there. Non-issue.
- **The current L2 is nearly the whole L1.** Accept it; no threshold. The rail is proportional and
  is saying something true. The viewport band still places the reader inside it.
- **A band whose geometry is already the part's.** Draw no ring — a second fill at identical
  geometry is a double-paint whose only effect is a darker band. There are **two** such cases, and
  the plan originally saw only the first:
  - *A childless L1*, where `measure` makes the part stand in for its own children.
  - *An L1 with exactly one child*, which by the partition invariant covers its parent exactly.
    `tree-invariants.ts` permits this — *"no child may cover its parent's whole range — unless it is
    a leaf"* — and `tests/spine-card.test.tsx` already has one in its fixture
    (`section("s4", "Its only section", …)`). GPT Sol, 2026-09-06.
- **Supplement: no ring at all, and not as a special case.** The first draft of this plan gave the
  apparatus a dimmed ring at ~0.4, and that styling could never have been reached.
  `buildOutline` gives a supplement `children: []` unconditionally
  ([`tree.ts`](../../src/web/tree.ts) — `node.depth < depthLimit && !supplement`), so `measure`
  always makes a supplement an L1-fallback hit, so the childless rule above already skips it. A
  supplement therefore keeps exactly what it has now: the dimmed active band, and nothing else.
  Found by GPT Sol, 2026-09-06 — the contradiction was between two paragraphs of this document.
- **Search.** Marks paint *over* the ring on matched rows, exactly as they paint over bands today,
  and that is what is wanted: *where am I relative to the hits* is the question search asks of the
  rail.

### The one implementation trap

**The ring must live in the band layer, below `.spine-matches` — not on the hit target.**

The tempting zero-DOM version is `.spine-hit[aria-current="location"] { background: … }`: the
geometry is already right, the state is already there, no new element. It is wrong. The hit targets
are rendered *after* the search marks and sit above them, so filling one would hide the search marks
inside the current section — the marks the reader most wants to see. The rail's DOM order is
deliberate and documented in `Spine.tsx` (§ *Drawn after the parts and the L2 ticks so it sits over
them, and before the viewport band*). One div in the band layer instead.

### Mechanism

One element, not a class on fifty:

```
{hereRing && (
  <div className="spine-here" style={{ top: pct(hereRing.top), height: pct(hereRing.height) }} />
)}
```

placed immediately after the `metrics.l1.map(...)` parts and **before the `.spine-tick`s** — the
hairlines must paint *above* the ring, or the ring hides its own top boundary and stops reading as
*one of these sections*, which is the whole argument for keeping the ticks. Where
`hereRing` is the `metrics.hits` band whose id is `hereHitId` — a plain `.find`, not a `useMemo`;
its dependencies could only govern recomputation inside renders that already happen.

**The skip test is `parent`, not a scan of `metrics.l1`.** `Band.parent` is set by `childBands` and
left undefined by the L1 fallback, so it already *is* the "am I a real L2" flag, derived from the
same construction in `measure` and unable to drift from it:

```ts
const drawRing = hereRing?.parent !== undefined && hereRing.parent.total > 1;
```

`total > 1` is the single-child case above. Testing membership of `metrics.l1` would have worked but
is indirect and costs a second scan. GPT Sol, 2026-09-06.

**A `min-height`, and it is a real decision.** Every other thing on the rail has one — the hit 4px,
the mark 3px, the viewport 2px — because a percentage of the document height rounds to nothing on a
short section in a long article. The ring should take **2px**, matching the viewport band: strict
proportionality would let the current section vanish exactly when the reader most needs it, and the
rail already accepts this trade four times over. The 95%-L1 fixture will not exercise it; a very
short L2 in a long article is what to screenshot.

### What the stale-measure guard does and does not buy

`hereHitId` is nulled when `hereHit.metrics !== metrics`, so **once a new `metrics` has committed**
the ring cannot be drawn from the old geometry: it disappears for the frame between the commit and
the scroll effect recomputing, then returns in the right place.

The first draft said a re-measure therefore "paints no ring for one frame", and that is too strong.
`measure` is scheduled through `requestAnimationFrame`, so between the page changing (a resize, a
`layoutKey` change, an outline replacement) and that frame running, `metrics` and `hereHit.metrics`
are still the *same* old object — the guard passes and the old geometry stays painted. **This window
already exists** for the parts, the ticks, the marks and the viewport height; the ring inherits it
and does not widen it. Versioning every metric by `layoutKey` would close it and is a different
ticket. GPT Sol, 2026-09-06.

## What comes off

- The `--highlight-wash` background on `.spine-part.active`. This is the loud thing in Greg's
  screenshot.
- Nothing else today. **Held back deliberately**, all defensible and none of them the reported
  problem: `.spine-hit:hover`'s 14% highlight fill becoming an outline; the viewport band dropping
  to edges-only; any threshold or size-relative rule.

## Why not L3 — and two reasons that were wrong

The conclusion (not in v1) survives review; the first draft's argument for it did not. Both of these
were false and are recorded so nobody rebuilds the case on them:

- ~~*The viewport band already marks the current paragraph.*~~ It marks the whole **viewport**. The
  paragraph on the reading line is somewhere inside that band along with a screenful of others, so
  a leaf marker would genuinely say something the band does not.
- ~~*It would cost ~360 renders per article.*~~ Only if routed through React state. It could be a
  third imperatively-written element in the scroll effect that already moves the viewport band —
  precomputed leaf geometry, a ref, a local current-leaf id beside `hereId` and `hitId`, and a
  binary search or a scan within the current L2. Cheap, though not free, and no new listener.

The reasons that hold:

- **L2 solves the reported problem.** Nagel's 95% part becomes a ring of a fifth of that or less.
- **A third fill in a 12px rail is more likely to be noise than orientation**, and the rail already
  carries a tint, a hairline, a search gutter, a hover wash and a viewport band.
- **"L3" is not the same thing on every article.** [granularity-zoom.md](../project/granularity-zoom.md)
  is explicit that a leaf *"sits at depth 3 on one article and depth 5 on another"* —
  `buildOutline(tree, blocks, 3)` truncates at 3, it does not mean 3 is the bottom. So an L3 ring
  would be a section on one piece and a paragraph on another. That is precisely the objection Greg
  raised on 2026-08-27 against naming the columns `L0`/`L3`, and it is why they are `Parts`,
  `Sections` and `Paragraphs` today.

Prototype it if L2 proves insufficient; do not justify skipping it on performance.

## The simpler option passed over

**Just make the L2 tick thicker for the current section** — no new element, no opacity ladder, one
CSS rule on the existing hairline. Rejected because a hairline marks a *boundary* and the question
is *which span am I in*: a thicker line at the top of a section says nothing about where the section
ends, which is exactly the information a proportional rail exists to give. The fill is the whole
point.

## Testing

**Reproduce first**, and write the assertion in its final form: *the ring is at the current L2's
geometry*. Watch that go red because `.spine-here` does not exist yet, then green. Do **not** leave
behind a paired "no ring today" assertion — a test that only ever described the old behaviour is one
more thing to delete later.

The existing equal-sized fixture in `tests/spine-scroll.test.ts` is enough for most of the
mechanism. A 95%-L1 fixture (one huge part with several L2s, plus a short second part — the Nagel
shape) is worth adding chiefly as the thing to screenshot.

What to assert:

- exactly **one** ring, at the current L2's geometry and not its L1's;
- it moves on an L2 crossing, and is the band whose button carries `aria-current="location"`;
- **no ring** for an L1 fallback (childless part) or a single-child part;
- **no ring** when the reading line is outside the article — `hereHit` has no fallback to the first
  or last band, deliberately, and the ring must inherit that rather than parking at one end;
- a supplement gets the dimmed active band and no ring;
- **DOM order**, because JSDOM cannot see paint: part → ring → tick → matches → hit → viewport. This
  is the assertion that catches the `.spine-hit` mistake if somebody re-introduces it later;
- **render counts unchanged** — `tests/spine-scroll.test.ts` already pins one render per L2 crossing
  and zero per scroll frame.

Then `npm test`, `npm run typecheck`, `npm run check`.

**What JSDOM cannot catch, so screenshot it** — both themes, and three shapes rather than two:

1. the 95%-L1 article, which is the report;
2. a nine-part article (`fowler-phrenology`), which is the regression risk — the part fill gets
   weaker there and must still read;
3. **an article mid-search, and one with a very short L2** — the first checks the marks are still
   legible over a 0.8 fill, the second checks the `min-height` actually saves a hairline section.

The thing to look for: the ring is the brightest *fill*, and the viewport edges are still the
crispest *line*. The two active opacities are the numbers most likely to need tuning per theme —
read them off a screenshot, especially in light mode, where dark advances and 0.8 of a muted orange
may become the heaviest thing on the page.

## Two decisions recorded rather than made

- **`data-nav-depth` stays `1`.** The rail's keyboard zone means L1, so ↑/↓ step part by part, while
  its click targets and now its strongest fill are L2. That mismatch exists today — clicks already
  land on L2 — and the ring makes it more conspicuous without making it wrong: the rail still
  *shows* the whole L1 structure. Keep L1 stepping for this ticket and update the comment in
  `Spine.tsx` that explains it, so the next reader finds a decision rather than an oversight.
- **No new accessibility surface.** `aria-current="location"` on the current hit already says
  exactly the fact the ring makes visible. Do not add a live region: an announcement on every L2
  crossing during a scroll is actively harmful. The ring itself is decorative — `aria-hidden="true"`
  to say so.

## Risk that was checked and did not materialise

Fable's blocking question: *if the 95% L1 has no children, or one child covering all of it, the ring
is the band and nothing improves — that would be a stage 4/5 hierarchy ticket, not a rail ticket.*

Checked against every L1 in all thirteen local trees: **the minimum child count is 2**, and the
biggest L1 in each article has 2–41. The reduction the ring buys, worst case first:

| article | biggest L1 | its L2s | mean ring |
|---|---|---|---|
| `todo` | 70% | 2 | ~35% |
| `read` | 70% | 4 | ~17% |
| `source` / `source-2` / `revistes-ub-30977` | ~31% | 3 | ~10% |
| `noema-mythology-of-conscious-ai` | 55% | 6 | ~9% |
| `scaling-hypothesis` | 22% | 41 | ~1% |

Nagel itself could not be checked: it is in the production database, and this machine has no
production credentials. Every article here says the ring lands somewhere useful, and `todo`'s 35% is
the honest worst case — a two-section part is a part the ring can only halve.

## References

- [`src/web/Spine.tsx`](../../src/web/Spine.tsx) — `hereHit`, `hereHitId`, the scroll effect, the
  render-order comment on `.spine-matches`
- [`src/web/styles.css`](../../src/web/styles.css) § spine, ~L1768–1990
- [granularity-zoom.md § The spine: a bird's-eye rail](../project/granularity-zoom.md#the-spine-a-birds-eye-rail)
- [colour-scales.md](../project/colour-scales.md) — why the depth hue ladder is the wrong channel here
- [`tests/spine-scroll.test.ts`](../../tests/spine-scroll.test.ts) — the render budget this must not move
- [260828ay-spine-rail.md](260828ay-spine-rail.md) — why the rail is 12px and has no labels
- [260828g-spine-hover-cards.md](../postmortems/260828g-spine-hover-cards.md) — the shared-state
  lifecycle around `armed`, adjacent to this
- [260906g-…-review-sol.md](260906g-spine-concentric-depth-highlight-review-sol.md) — GPT Sol's
  technical review, and [`src/tree-invariants.ts`](../../src/tree-invariants.ts) § *no child may
  cover its parent's whole range*
