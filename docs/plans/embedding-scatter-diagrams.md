# Two pictures of what the article is *about*

> Add 2 new kinds of diagram in Diagram mode.
>
> Diagram 1:
> - Each block is a point, with the y-axis being position in the document (i.e. the first block will
>   be at the top of the y-axis and the bottom row will be at the bottom of the y-axis.
> - We're going to need a semantic embedding for each block. We should generate and store them when
>   we open this diagram if they don't exist already (just as we'll do for the newly-modified Force
>   diagram). Then do a principle components (or some other dimension reduction/clustering) on the
>   semantic embeddings (or something like that), and use the first component as the x-axis value.
>   Or perhaps actually clustering would be better than principle components (maybe add a toggle so
>   we can choose between dimension reduction algorithms), so that we can
> - Don't show the axes.
> - Hopefully this will give us a rough sense of how the article progresses, which sections are
>   similar to one another, etc.
>
> Diagram 2:
> - Similar to Diagram 1, but this time the x-axis is the first component, and the y-axis is the
>   second component, and add a line (ideally with an arrow at one end) between each successive pair
>   of block-points to show the sequencing.
>
> In both cases, add hover-tooltips for each block-point. Maybe use size to indicate length of
> block. Maybe use colour … to also indicate which L1 section each point is from.
>
> — Greg, 2026-08-27

**Status: built, 2026-08-27.** Builds on [diagram-mode.md](diagram-mode.md) (the six pictures) and
[force-diagram-links.md](force-diagram-links.md) (which put embeddings behind `POST
/api/similar/:slug`). Nothing here re-litigates the embedding model — that was measured in
[semantic-search.md](semantic-search.md) and it is `voyageai/voyage-4`.

Every picture in Diagram mode so far draws **the tree the author wrote**, or the tree plus a hint
about shared vocabulary. These two draw something none of them can: **the article's own subject
matter, laid out by what the passages mean rather than by where they sit.** That is the first
picture here in which two paragraphs can be neighbours because they are *about the same thing* and
nothing else.

---

## The two pictures

```
            DRIFT                                    TRAIL
   y = where you are in the piece            x = component 1, y = component 2
   x = what it is talking about              the line is reading order

   ┌────────────────────────────┐            ┌────────────────────────────┐
 s │   ●                        │            │        ●───●               │
 t │  ●                         │            │       ╱     ╲              │
 a │    ●●                      │            │   ●──●       ●             │
 r │       ●                    │            │  ╱            ╲            │
 t │          ●   ●             │            │ ●              ●▸          │
   │             ●●             │            │  ╲            ╱            │
   │                 ●          │            │   ●─────────●              │
   │              ●             │            │        ╲                   │
 e │      ●                     │            │         ●──▸●             │
 n │   ●●                       │            │                            │
 d └────────────────────────────┘            └────────────────────────────┘

   Down the page is still the                 Down the page means nothing
   article. Sideways is meaning.              here. The LINE is the article.
```

**Drift** keeps the one property every picture in this band keeps: down the page is later in the
article. **Trail** is the first that gives it up, and it has to — both of its axes are spent on
meaning. What replaces it is the chain: the arrow is the reader's own route through the space.

Their names are one word each, in the toggle, beside Strata / Tree / Mindmap / Arc / Force /
Cluster. Eight chips now. Greg's call, asked and answered 2026-08-27: **add both, cut nothing yet**
— the two candidates for the chop (Cluster, Mindmap) stay until these two have been looked at.

## The dot is a paragraph, and only some paragraphs get one

Points are **blocks**, as asked. They are the blocks `src/similar.ts` already calls embeddable:
`gistable`, and at least 12 words. So a heading is usually not a dot, and that is deliberate and
already argued — a three-word heading embeds fine and then sits at cosine 0.8 from every other
three-word heading, because what they have in common is being short.

The consequence to state out loud, because it is the kind of thing a picture hides: **the dots do
not tile the article.** A run of short list items is one gap. The status strip says how many blocks
were embedded and how many were skipped, for the same reason the Force strip does.

| what a dot carries | from |
|---|---|
| **position** — down the page on Drift | its row index among the article's blocks |
| **sideways** — Drift | component 1, *or* its topic lane (a toggle) |
| **both axes** — Trail | components 1 and 2 |
| **size** | its word count, area-proportional, `√` scaled |
| **colour** | its L1 section, *or* how far through the article it is, *or* its topic (a toggle) |
| **the card** | the section it is in, and the paragraph's own opening words |

### Why the vertical axis is rows and not words

`strata` is to scale in **words** and this is not, which looks like an inconsistency and is a
different question. Strata's bands are *areas* — the whole point is that a long section is a tall
band. A dot has no extent, so spacing dots by words does not make anything to scale; it just piles
every dot in a dense section on top of its neighbours and leaves white space where the article was
brisk. Rows space the dots evenly, which is what a scatter needs. Size already carries length.

## Where the numbers come from

```
   the reader presses Drift or Trail
              │
              ▼
   POST /api/projection/:slug              ← never GET: the first call spends money
              │
              ├── articleVectors(slug, blocks)         src/article-vectors.ts
              │     cached in memory by slug + hash of the blocks
              │     embeds only what similar.ts embeds — one filter, one rule
              │
              ├── pca(vectors) ────────────► two scores per block, and the
              │                              fraction of the variance each holds
              │
              └── kmeans(vectors, k) ──────► one topic per block, lanes ordered
                                             by where the topic first appears
              │
              ▼
   { model, blocks, skipped, variance: [.41, .12], k, points: [{id, x, y, c}] }
              │
              ▼
   the client scales it into the band, colours it, and draws it
```

**All of the arithmetic is on the server.** A 360-block article at 1024 dimensions is about 3MB of
JSON, and sending that to a browser so it can do a matrix multiply is the wrong side of the seam by
two orders of magnitude — the same argument `similar.ts` already makes for returning pairs rather
than vectors. What crosses the wire is two floats and an integer per block: about 18KB.

### The vectors get a cache of their own, shared with the similarity graph

New module, `src/article-vectors.ts`, holding what both features need:

- **which blocks are embeddable** — `gistable`, ≥ 12 words, capped at `MAX_BLOCKS`, with each one's
  row in the *whole* article kept beside it;
- **the vectors**, cached by `slug + hashBlocks(blocks)`, with one in-flight promise per key so two
  tabs do not buy two copies.

`similar.ts` keeps its own cache of *pairs* — that stays, it is cheap and it is the answer readers
actually get — but it should draw its vectors from here rather than embedding the article a second
time.

**And it does not yet, which is the one piece of this that shipped unfinished.** `similar.ts` was
being written by another agent in the same tree on the same afternoon; reaching into a file
mid-flight to save a fifth of a cent is how two people's work gets lost. So the seam exists, one side
uses it, and a reader who opens Force and then Drift on a cold article pays about $0.0015 and four
seconds twice. GPT Sol found the claim before the code caught up with it. The move is small —
`compute` in `similar.ts` swaps its own `embeddable` plus `embedAll` for one `articleVectors` call —
and it is the first follow-up.

**The vector cache is smaller than the pairs cache and has to be.** 360 × 1024 float64 is 3MB per
article; `similar.ts` caps at 12 articles because a few hundred pairs is nothing. Four here, and
the number is written down beside the arithmetic rather than copied.

Same honest note as `similar.ts`: **memory, not Postgres.** Persisting vectors is
[semantic-search.md](semantic-search.md)'s job — pgvector, a migration, a re-embed rule and a place
in the pipeline — and a diagram toggle wanting a cache is not a reason to settle it early. On
Vercel a cold process is the normal case, not the unlucky one.

### Principal components, in about forty lines and no dependency

1. Normalise every vector to unit length. (Cosine is the geometry these were trained for, and
   nothing promises voyage returns them normalised.)
2. Subtract the mean.
3. **Orthogonal iteration for the top two components.** `q ← Σᵢ xᵢ (xᵢ·q)`, both columns at once,
   Gram–Schmidt between steps, ~60 passes with an early exit. No covariance matrix is ever formed:
   that would be 1024×1024 and n·d² to fill. This is 2·n·d per component per pass — about 90M
   multiply–adds on the longest article in the corpus, tens of milliseconds, once, cached.
4. The score is `xᵢ·q`, and the explained fraction is that score's variance over the total.

**The sign of a component is arbitrary, and arbitrary is not the same as stable.** Left unfixed,
the same article can come back mirrored on a different process, and a reader who learnt that "the
left-hand lane is the ethics material" would find it on the right after a deploy. So each component
is flipped, if necessary, to correlate positively with the row index — the article tends to run
left to right and downhill. Documented as a convention, because it is one: it does not make the
axis mean anything.

**Why not UMAP or t-SNE**, which would separate the clusters far more prettily: three reasons, and
the third is the one that decides it. They are a dependency; they need a seeded PRNG to be
reproducible at all; and **their distances do not mean anything**. A UMAP plot's gaps are an artefact
of the algorithm's own neighbour graph, so a reader asking "are these two paragraphs nearly the
same?" would be reading a picture that cannot answer. PCA's answer is honest and boring: two dots
close together on Trail really are close in the model's space, up to whatever the two components
missed — and the picture says what fraction that is. Recorded here rather than left as an
assumption; if the PCA scatter turns out to be a shapeless cloud on real articles, that finding is
the argument for revisiting, and this paragraph is what it argues against.

### Clustering, for the lanes

Spherical k-means: k-means++ seeded from a fixed LCG, four restarts, lowest inertia wins, centroids
re-normalised each round so the distance really is cosine. Deterministic by construction, and
`tests/projection.test.ts` pins that two runs over the same input agree.

`k = clamp(3, 8, round(√(n/4)))`. The cap is **not** a fact about the data: the usual rule of thumb
would say 13 topics for a 360-block article. It is a fact about a 300px band — nine lanes are 33px
each — and about eight hues. Said plainly so nobody later reads 8 as a measured number.

Lanes are ordered left to right by the **median row** of their members, so the leftmost lane is
what the article opens with and the rightmost is what it ends on. Median rather than first
appearance: one stray early paragraph should not move a whole lane to the front.

**Within a lane, sideways means how typical.** A dot at the lane's centre is close to its topic's
centroid; a dot at the edge is a member the algorithm was less sure about. That is a real fact,
free to compute, and it stops a lane being a column of dots stacked exactly on one another.

### The cluster's name comes from the words, on the client

Each lane is labelled with its three most distinctive terms, computed in the browser with the
`terms()` function `graph.ts` already exports — tf-idf across the lanes, exactly as the vocabulary
edges do it across sections. The server never sends a label.

Two reasons. It reuses tested code rather than shipping the stopword list twice, and — the one that
matters — **it is the same rule the vocabulary edges follow**: show the words that earned it. A
lane labelled "honesty · deception · candour" can be dismissed by a reader in a second. A lane
labelled "Topic 3" cannot be argued with at all.

## What the picture must not claim

The repo's standing complaint against its own vocabulary edges applies here twice over, because
this one costs money and involves a model:

- **Two components is not the article.** PCA to 2D throws away most of the variance in a 1024-
  dimensional space. So the strip under the toggles says so, with the number:
  `312 embedded · 48 too short · axes hold 41% and 12% of the variation`. Not buried in a tooltip.
  When the two components hold very little — under about 25% between them — the strip says the
  shape is weak rather than leaving the reader to read a cloud as a finding.
- **A gap is not a boundary.** Two lanes are two lanes because we asked for k of them, not because
  the article has k topics. The lane's terms are the check.
- **Nothing here is the argument.** These are the passages' *subject matter*. An article that
  argues against something talks about it in the same words it would use to argue for it, and no
  embedding in this picture knows the difference. Same class of caveat `diagram.md` records for
  vocabulary edges, and it belongs in the doc in the same voice.

## Density, which is where Trail is at risk

A long article is 360 dots. Drift is fine: the band scrolls, and at 6px a row the picture is about
three viewports, which is the bargain `strata` and `force` already make.

**Trail is the hard one** — 360 dots and 359 connecting segments in roughly a 340 × 480 box is a
ball of wool. Four things, in order of how much they buy:

1. **The chain is hairline and mostly transparent**, and its opacity ramps with reading position:
   the beginning of the article is faint, the end is clear. So even in the tangle, the eye can find
   which way the piece was going.
2. **Arrowheads are not on every segment.** One in eight, plus the last, plus whichever segment the
   reader is on. Every segment having a head is 359 heads in a box that holds maybe forty legibly.
3. **The reader's own position is a strong mark**, and the segments either side of it are drawn at
   full strength. That turns the picture into something you can read *while* scrolling: the bright
   line is where you are and the fade is where you have been.
4. **Colour by progress is the default on Trail**, where the section hues are the default
   everywhere else. On Trail the y-axis no longer carries position, so without this the picture has
   no cheap way to say which end of the article a dot came from. Greg's call, 2026-08-27.

If that is still spaghetti on a real 360-block article, the honest fallback is to make the dots
**sections** rather than blocks on Trail alone, at which point it is 57 dots. Not built. It is
recorded here as the escape hatch rather than done up front, because 360 dots may well be exactly
the picture that shows an article circling its own subject.

## Interaction, and one place this deliberately does not do what was asked

Greg asked for hover tooltips on each dot. **The panel's fixed footer card is used instead**, and he
confirmed that choice when it was put to him with the trade-off drawn out (2026-08-27).

The reason is the one [diagram.md](../project/diagram.md#the-footer-card-rather-than-a-floating-tooltip)
already gives and it is *stronger* here than for the pictures it was written for. A floating card
over a 5px dot covers the dots around it — and in a scatter the dots around it are the entire
finding. The card says: which section the paragraph is in, its opening words, and the lane's terms
when lanes are on.

Everything else is inherited and costs nothing: click jumps the article, the picture is one tab
stop with arrow keys inside it, and each dot carries its own `aria-label`. Drift gets the
you-are-here line across the picture, because its vertical axis really is the article; Trail does
not, because its vertical axis is not — the same rule that decides which of the existing six draw
that line.

## The controls

Two more chips under the kind chips, on these two pictures only:

```
  [Strata][Tree][Mind][Arc][Force][Cluster][Drift][Trail]
  ──────────────────────────────────────────────────────
   sideways:  ( Spread | Lanes )     colour:  ( Section | Progress | Topic )
```

Both go in the URL — `?dx=` and `?dhue=` — because
[url-state.md](../project/url-state.md) says every bit of view state does, and unlike the collapse
set these are stable words rather than positional ids, so a pasted link cannot become quietly wrong
after a re-ingest.

*Sideways* applies to Drift alone; Trail spends both axes on components. It is hidden rather than
disabled on Trail — a control that is visibly there and does nothing is worse than one that is not
there.

## What could go wrong, and what catches it

- **A permuted response.** Already handled once, in `embeddings.ts`, and this is why: every vector
  is a real vector and every score is a real number, so a permutation renders a perfectly plausible
  picture of nothing. The new module never re-orders, and the test that would catch a regression
  asserts a known input's scores land on known blocks.
- **A component sign flipping between runs**, mirroring the picture. Pinned by a test over a fixture
  whose first component is known.
- **k-means picking different clusters on a second run.** Pinned by a determinism test — the same
  shape as the one `tests/diagram-graph.test.ts` already has for the force simulation, and for the
  same reason.
- **Dots drawn outside the band.** SVG neither clips nor errors, so a bad scale renders a picture
  with paragraphs missing off the right-hand edge and looks like a design choice. Tests assert
  every dot's centre and radius sit inside the viewBox — the same check that caught three live
  bugs in the first round of these pictures.
- **The scale collapsing when every score is identical** — a two-block article, or an article whose
  paragraphs are genuinely all the same. Division by a zero range. Test with a degenerate fixture;
  the answer is a single centred column, not a NaN.
- **The reader's position landing in a gap**, on a row whose block was too short to embed, so the
  you-are-here mark disappears. Each dot's range runs from its own row to just before the next
  dot's, so the marks tile even though the dots do not.
- **Money spent by pressing a toggle.** Same bound as Force: one article, about $0.002, cached,
  and only on the two pictures that use it. The vector cache means Force and these two now share
  one purchase rather than making two.
- **A failure drawing an empty picture.** The strip says the model could not be reached; the
  picture is not drawn at all rather than drawn empty, because unlike Force — which is four-fifths
  complete without embeddings — these two have no other content. That difference is worth stating:
  the same failure needs a different answer in the two places.

## What is deliberately not in this round

- **No UMAP / t-SNE toggle.** Argued above. The toggle Greg asked for is *Spread vs Lanes*, which
  is the choice that changes what the picture says; swapping one dimensionality reduction for
  another changes how pretty it is.
- **No persistence.** Memory cache, as above. When [semantic-search.md](semantic-search.md) lands,
  `article-vectors.ts` is the one file that changes.
- **No cluster count control.** `k` is derived and capped. A slider would be a fourth control in a
  band that now has three.
- **No linking Drift's lanes to the Force picture's colours.** They mean different things — a hue
  there is which L1 part, a lane here is a topic the model found — and making them share a palette
  would say they were the same fact.
- **Trail does not draw the anchor or semantic edges** that Force now has. The chain is already the
  densest thing in the band.

## What the review changed, and what it did not

**GPT-5.6 Sol reviewed this plan before it was built and returned *revise before build*** — nine
findings, four of them high. Six changed the design; two turned out to be about things the code had
already got right; one was declined, with a reason. Recorded here rather than folded in silently,
because a plan that reads as if it were right first time teaches nobody anything.

### The four that were real, and would not have been caught by a browser

1. **The plane converges; the two axes inside it do not.** Orthogonal iteration converges to the
   top-two *subspace* at a rate set by the gap between the second and third eigenvalues, and says
   nothing about how the two columns are arranged within it. Near-equal top two → the axes rotate or
   swap between runs, and **every well-separated fixture passes anyway**. Fixed with a 2×2
   Rayleigh–Ritz step at the end, and a convergence test on the *projector* rather than on each
   vector. `tests/projection.test.ts` has the near-degenerate case.
2. **The plan made a false claim about distance.** *"Two dots close together really are close in the
   model's space"* is backwards: an orthogonal projection can only ever **shorten** a distance. The
   safe half is the converse. The claim is now stated in one direction, in the strip the reader sees,
   in words — and no percentage of variance rescues the other half, because a figure for the whole
   article says nothing about any particular pair.
3. **Trail must use one scale for both axes.** Scaling x and y independently to fill the box would
   have drawn a 6%-variance second component *taller* than a 15%-variance first one. Now one
   pixels-per-unit for both, letterboxed, and the test probes it with a pair separated only in x and
   a pair separated only in y.
4. **The shared seam had already dropped the per-block spending bound.** `similar.ts` truncates a
   block to 8,000 characters so that one malformed extraction cannot become one enormous billable
   request; the first draft of `article-vectors.ts` kept the *filter* and left the truncation behind.
   The rule that came out of it: **whatever decides the bytes that go to the model belongs to the
   module that buys them.**

### The five smaller ones, all taken

- **k-means++ was weighting by the fourth power of the distance.** For unit vectors `‖a−b‖² =
  2(1−cos)`, so `1−cos` already *is* the squared distance; squaring it again is the common wrong
  implementation and makes the seeding far greedier than the algorithm it is named after.
- **The sign convention flipped on noise.** The first version compared a covariance against a
  denominator of its own invention and took any ratio above `1e-6` as decisive — which for a
  component with no relationship to reading order is a coin flip. Now a real Pearson correlation with
  a 0.2 threshold, falling back to the largest score, and an honest note that no convention is stable
  for an article that does not move through the axis at all.
- **The vectors needed a cache measured in floats, not in articles.** "Four articles" reads as 12MB
  and is 49MB at the ceiling `MAX_BLOCKS` permits.
- **The projection needed a cache of its own.** Caching only the vectors still re-ran 290ms of
  arithmetic per request on a warm process.
- **The scatter cannot inherit the tree's accessibility contract.** 276 paragraphs are not a
  hierarchy and there is nothing to open, so these two are a `listbox` of `option`s with all four
  arrows stepping one paragraph — and each dot's `aria-label` carries its position and its topic,
  because on these pictures colour is otherwise the only thing saying either.

### Two the code had already answered

- **The skipped prefix.** Sol read the plan's ranges as starting at each embedded row, which would
  leave the headings before the first dot uncovered. They tile from row 0; there is a test.
- **The footer card.** It needed no change: the node's `number`/`title` carry the containing section
  and its `gist` carries the paragraph's own opening words, which is exactly the split a dot needs.

### One declined

**"Cut paragraph-level Trail."** Sol's verdict was that 360 dots and 359 crossing segments cannot be
rescued by styling, and that Trail should be built from section centroids or a local chain from the
start. That is a fair reading and it is not the call: Greg asked for *"a line between each
successive pair of block-points"*, and this round is the one that finds out. What the review did
change is the mitigation — **the bright run around the reader**, which is the only one of the four
that reduces what the eye has to take in rather than restyling it. The section-centroid version is
designed and not built, and is the first thing to reach for if the browser pass says Sol was right.

## What the second review changed

**GPT Sol reviewed the built code and returned *revise before merge*** — ten findings. Nine were
acted on; the tenth is the unfinished seam above.

The four that mattered:

- **A false claim survived into the geometry.** Drift leaned a marginal dot out of its lane and the
  comment said it leaned *towards the topic it was nearer to*. Lanes are ordered by **where the
  article gets to them**, so the lane next door is the chronologically adjacent one and has nothing
  to do with semantic distance. A dot's place inside its lane is now its first component, scaled to
  its own lane — one quantity meaning one thing — and `typicality` has left the wire, because a field
  nothing can honestly draw should not cross it.
- **The empty-cluster repair did not converge.** It could hand the same point to two empty clusters,
  and it left `counts` and `sums` describing an arrangement that no longer existed — so a donor
  holding one point became empty itself, undetected. Donations now happen in a pass of their own,
  each point can be donated once, and a cluster's last point is never taken.
- **Half a colour change.** The ramp became viridis and the *mapping* stayed inferno's, so the
  article was drawn on steps 2–8 and the two darkest viridis stops were never used. Half a change is
  the hardest kind to see, because the picture looks fine either way.
- **Every failure was blamed on the model.** The route rewrote anything thrown inside
  `projectArticle` as "could not reach the embedding model" — so a bug in the principal components
  would have been logged, and shown, as an upstream outage, and nobody would have looked in the right
  place. `isProviderFailure` now decides, and anything else is allowed to look like the bug it is.

And four smaller ones: the `Choice` radiogroup changed its value without moving focus (so the third
option was unreachable by keyboard); `aria-selected` was true for the hovered *and* the current dot,
which is two selections in a single-select listbox; the skip counts charged non-prose blocks to the
spending cap once the cap was reached; and nothing bounded how many articles could be in flight at
once, so a reader moving quickly through a library could start an unbounded number of paid requests.

**Five of my tests would have passed against a broken implementation**, and Sol named each one. The
tiling test asked only whether *some* dot answered each row, which is also true if every dot claims
the whole article; the chain test counted links without checking either endpoint; the lane-terms test
checked that three names differed rather than that they were the right three; the near-degenerate PCA
test checked determinism and ordering, which a rotated frame also satisfies; and the empty-lane test
asserted that labels were integers. All five now assert the property they were named for.

## What the browser showed

Looked at on `constitution`, 2026-08-27, at the band's narrow width (288px):

- **Both pictures render**, 276 dots, no console errors, the eight kind chips wrap to two rows with
  nothing clipped, the roles come out `listbox`/`option`, and the strip reads as intended.
- **Sol was right about Trail's chain.** 257 hairlines in a 271 × 380 box are a grey web with no
  readable direction, and 30 arrowheads at that size are not findable. What carries the picture is
  the **progress colour**: the viridis ramp puts the end of the article hard to one side and the
  middle across the other, which answers "does this piece travel or circle?" on its own.
- So the finding is neither "keep it" nor "cut it": **Trail earns its place and Trail's chain does
  not yet.** The bright local run around the reader is the half worth keeping either way.
- **Two bugs, both fixed.** The lane legend was a wrapping row, so with eight lanes chip 6 sat under
  chip 0 and a reader had to count to tie a word to a column — a grid of `k` columns now. And Trail
  floored its height at 380px in a scroller measuring about 350, so a plane you are meant to see
  whole scrolled for nothing.

## Questions for Greg

1. **Trail's chain has not earned its place — what should happen to it?** Looked at in a browser
   (above), 257 segments are texture and the progress colour is what actually shows the article's
   route. Three ways out, and this is your call: drop the global chain and keep only the bright run
   around the reader; build Trail from ~57 section centroids, which is what Sol recommended; or keep
   it as it is because a web of connections is itself a true picture of a piece that circles. My
   recommendation is the first — it costs nothing, keeps what works, and stops the picture claiming
   a readable route it does not have.
2. **Should Drift's lanes be labelled *in* the picture** — rather than in the legend strip above it?
   The legend is built and names every lane with its most distinctive word; the fuller three-word
   name is a hover away. A label down the lane itself would cost vertical room and truncate hard at
   33px, so this is only worth doing if the legend turns out not to connect to the columns.
3. **Eight chips is a lot for a 288px band.** You said add both and cut nothing yet; when you have
   looked at these two, the standing candidates for the chop are still Cluster and Mindmap.
