# Diagram mode — the article's structure as a picture

**Status:** built, 2026-08-26. Three pictures, one toggle, no new dependencies.
Reference doc: [diagram.md](../project/diagram.md). Code:
[`src/web/diagram.ts`](../../src/web/diagram.ts) (the geometry),
[`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) (the shell and the paint).

Greg, 2026-08-26:

> Let's try adding a new "Diagram" mode that generates diagrams/maps of the
> structure of the doc. Use Luna to search the web to see if there are libraries
> we should use (as per docs/reusable/third-party-library-selection.md), and/or
> try a different version that we do ourselves (e.g. with SVG or similar).
> Perhaps even something graph-based if we can make it attractive. Perhaps even
> consider using GPT Images 2.0 with careful instructions (e.g. in Mermaid as
> part of the prompt).
>
> Add toggles to switch between different modes. Try coming up with multiple
> ideas, e.g. mindmap, something that preserves the structure of the doc.
>
> It would be amazing if it was interactive.
>
> This will be a mode (in place of Contents, Summary, etc), so it will take up a
> few columns in the middle, so it should probably be vertically narrow, and
> think of the article's ordering as top to bottom.
>
> Don't ask questions, just try it a few quick-and-dirty different ways.

## The constraint that decides everything

The mode band is **288–400px wide** and as tall as the viewport
([`fitMode` in layout.ts](../../src/web/layout.ts) — `MODE_MIN` 288, `MODE_IDEAL`
400, and the prose wins whenever they compete). Down the page is later in the
article.

Nearly every published diagram grammar spends width to show depth. In this band
width is the axis we have not got. That single fact killed more candidates than
maintenance status, bundle size and React-19 support put together.

## The library survey

Run per [third-party-library-selection.md](../reusable/third-party-library-selection.md).
GPT-5.6 Luna, through OpenRouter's `openrouter:web_search` server tool, ten
searches, asked for latest version, last publish, weekly downloads and declared
React 19 peer support for each of twenty-odd candidates. Full answer kept out of
git (it is 38KB of npm metadata with a shelf life of weeks); what survives is
this section.

### What it said, in one line each

| Candidate | Verdict |
|---|---|
| **d3-hierarchy** 3.1.2, ~17.7M/wk, no React peer | The only real contender. But see below. |
| **d3-shape** 3.2.0, ~61.5M/wk | Path helpers. We need four `M/V/Q/C` strings; not worth an import. |
| **@visx/hierarchy** 4.0.0, React `^18 \|\| ^19` | React-19-safe, and *"you will still write much of the important code"*. |
| **@xyflow/react** 12.11.3, ~10.7M/wk, React-19-safe | Excellent — as a node editor. Spatially free-form; wrong tool. |
| **markmap-lib / markmap-view** 0.18.12 | Best turnkey mindmap. Expands sideways. |
| **mermaid** 11.17.1, ~14.5M/wk | See below — this is the one Greg asked about specifically. |
| **cytoscape** 3.34.1, **@antv/g6** 5.1.1, **sigma** 3.0.3, **vis-network** 10.1.2 | Graph frameworks. *"mostly traps for your main mode."* |
| **elkjs** 0.12.0, **@dagrejs/dagre** | Layout engines for DAGs with ports and edge routing. We have a tree. |
| **dagre** 0.8.5 (~7 years) | Legacy. |
| **react-d3-tree** 3.6.6 | *"usable but not a strategic choice"* — React 19 not clearly declared, org-chart model. |
| **@nivo/treemap** 0.99.0 | Fine as a future density mode; [open React-19 issue](https://github.com/plouc/nivo/issues/2618) in the ecosystem. |
| **@react-sigma/core** 4.0.3 | Declares React 18 only. Not React-19-safe on paper. |
| **recharts** 3.10.1 | React-19-safe and irrelevant — it does not do tree layout. |

Its ranked recommendation for our exact constraint was
*"hand-rolled React SVG/HTML + `d3-hierarchy`"*, then hand-rolled bands +
`partition()`, then `@visx/hierarchy`.

### Why we then installed nothing at all

We took the recommendation and one step further, and the step is worth writing
down because it looks like laziness and is not:

**The two d3-hierarchy functions we would want are the two Luna talks us out
of.** On `tree()`: *"that tends to distribute leaves according to tree geometry,
not according to the physical height of your labels"*, and it prescribes a
preorder walk advancing `y` by each node's own height instead — which is
`layoutTree` here, and is about fifteen lines. On `partition()`, the warning is
sharper:

> A classic icicle often has depth along one axis and descendants spread along
> the other. Rotating it to make the overall diagram tall can turn depth into
> horizontal width, which is exactly the wrong behavior in a 300–700px band.

What is left of d3-hierarchy after removing both is `hierarchy()`, which builds a
nested structure from a flat one — and we are already handed a nested structure
with block ranges, numbering and gists joined on, by
[`buildSummaryTree`](../../src/web/tree.ts). So the dependency would buy a
function we do not call.

That is the whole argument. It is not "hand-rolling is more fun"; it is that the
survey found the useful library, read its manual, and the manual said don't use
these two functions for this.

### Mermaid, and GPT Images 2.0

Greg raised both explicitly, so both get an answer rather than a silence.

**Mermaid** can be made to look good — `base` theme, `themeVariables`, dark mode,
top-to-bottom flowcharts, `click` directives. Luna's realistic ceiling is
*"polished documentation diagrams"*, and its list of what Mermaid cannot reach
without substantial post-processing is exactly our feature list: rich node cards
with paragraph counts and gists, content-aware vertical spacing, controlled React
interaction, per-node accessibility, precise narrow-column layout. Two harder
problems on top:

- **Clicks need `securityLevel: 'loose'` or `antiscript`.** Strict disables them.
  The node labels here are article headings — text from a stranger's web page —
  and [security.md](../project/security.md) is about exactly that. Loosening a
  security level so a diagram can be clickable is the wrong trade at any price.
- **The whole bundle carries every diagram parser.** ~14.5M weekly downloads of
  a library we would use one grammar of.

**GPT Images 2.0** rendering a Mermaid-described diagram: this was thought
through and rejected on three grounds, in increasing order of seriousness.

1. It is not interactive. A raster image cannot be hovered by node, cannot jump
   the article, and cannot mark where the reader is — and "it would be amazing if
   it was interactive" is in the same message.
2. It costs a model call per article per picture, on a mode whose whole present
   virtue is that it works on every article for free.
3. **A generated image of a structure is not checkable against the structure.**
   Every other model output in this app is either constrained (`toc.json` is
   validated against the block ids — [`src/validate-tree.ts`](../../src/validate-tree.ts))
   or shown as prose the reader can judge. An image that puts section 4 inside
   section 3, or invents a section, is wrong in a way that looks exactly like
   being right. That is the [silent-success](../reusable/silent-success.md)
   pattern with a picture on it.

There is a real use for it, and it is not this mode: a shareable, static,
handsome image of an article's shape — a thumbnail, an OG image, something to put
in a tweet. Left as a note in [diagram.md](../project/diagram.md#not-doing).

## The three pictures

Built as three, not one, because they trade against each other and the trade is
a real reader choice rather than a skin:

| | Vertical axis | Honest about | Dishonest about |
|---|---|---|---|
| **Strata** (default) | linear in the article | how *much* of the piece a section is | names — a 6px band holds none |
| **Tree** | one row per node, sized to its text | every name, and the nesting | size — a 3¶ row equals a 40¶ row |
| **Mindmap** | parts down a centre trunk | shape, at a glance | size, and it only goes two deep |

The one thing all three keep is **document order down the page**. That is the
property the graph libraries would have taken, and it is not negotiable in a
reading app.

`strata` is the default because it is the only thing in this app that answers a
question nothing else answers — *"how much of this article is that section?"*
The gist columns cannot: a section holding forty paragraphs and one holding three
render as identical L2 cells, which is the complaint
[structure-panel.md](../project/original-version/structure-panel.md) records
against the previous version, and which their `+N hidden` badge only half fixed.

## What the tests caught

Three of these were live bugs, found by
[`tests/diagram.test.ts`](../../tests/diagram.test.ts) before the panel was ever
opened in a browser. All three render without erroring, which is the point:

1. **The mindmap trunk ran past its last branch**, down to the bottom of the last
   part's twigs. It read as a deliberate tail, and it claimed there was more
   article below.
2. **`titleLineCount` guessed.** It returned "the first two lines are the title",
   which is right except when the title took one line and the gist took three —
   the common case at depth 0. The first gist line was then styled and *sized* as
   a title, and pushed out of the band. Replaced with a stored count.
3. **Twigs beside the pill had 7px of label room.** A pill fills its half of the
   band, so "beside it" is arithmetic that comes out at nearly zero. Moved
   underneath, indented from the outer edge, ~120px.

And the one that was written before it could happen: **siblings must exactly
partition their parent.** `endRow` is inclusive, so a band ending at
`rowToY(endRow)` is one row short and every boundary gains a hairline gap. At
600px for 100 rows that is 6px and visible; at 6000px it is 0.6px and is not,
which is how it would have shipped.

## The GPT Sol review

Cross-family review of the built code, `gpt-5.6-sol` at high effort, 2026-08-26.
No high-severity findings; five medium and four low. Eight were real and are
fixed. Its own summary of the product: *"The idea is right. Strata supplies
genuinely new information; Tree supplies the legible explanation of it."*

**Fixed:**

1. **The picture was ~8px too wide and clipped on the right, always.** The
   scroller was measured with `clientWidth`, which is the *padding* box — and
   `.diag-scroll` has `0.5rem` of horizontal padding. Every picture was laid out
   16px wider than its room, and `overflow-x: hidden` ate the difference in
   silence; the tree's paragraph count, drawn at `w - 6`, was the first casualty.
   Now measured as `clientWidth` minus the *computed* padding, so changing the
   stylesheet cannot bring it back.
2. **The mindmap's you-are-here ring and focus ring were invisible on twigs.**
   `.diag-mindmap .diag-node.diag-d2 .diag-box` turns the fill and stroke off,
   and it is a longer selector than `.diag-node.here .diag-box` — so the one node
   the reader is actually standing in was the one node with no mark. Now guarded
   with `:not(.here):not(.on)`.
3. **`role="tree"` and `role="radiogroup"` promised more than the code did.**
   Every node was a tab stop, which on a forty-section article is forty presses
   of Tab to get past the panel, and there was no ↑/↓, no Home/End, no
   parent/child movement, and no `aria-level`. Rewritten as a proper roving
   tabstop over the drawn order — which is cheap, because preorder is exactly
   what a flattened tree widget wants. The kind toggle got the same treatment and
   now matches `Dock.tsx`.
4. **Hover and keyboard focus shared one variable**, so leaving the picture with
   the pointer cleared a card that was still describing a genuinely focused node,
   and tabbing away never cleared it at all. Two variables now, plus an `onBlur`.
5. **A hard-cut long word lost its ellipsis.** Truncation was inferred by
   comparing word counts, and a word cut into three fragments is three words out
   against one in — so the one case the hard cut exists for was the one case that
   never said it had been cut. A flag now.
6. **The footer card did not show things "in full", as its own doc claimed** —
   the title was ellipsized to one line and the gist clamped to two, which at
   288px is most titles. The title wraps to two lines now, the card is taller,
   and both carry `title` attributes.
7. **Strata is proportional to blocks, not to paragraphs or words**, and three
   claims across the code and docs said otherwise — including that it "shares the
   spine's axis exactly", when the spine measures rendered pixels. All three
   corrected, and the gap written up as the next change worth making
   ([diagram.md](../project/diagram.md#it-is-to-scale-in-words-since-2026-08-27)).
8. **Two documentation claims contradicted the files**: a comment said the Luna
   answer was quoted in this plan when the plan says it was kept out of git, and
   this section promised reviews "below" when there was nothing below.
9. **A zero-block node divided to `Infinity`** in strata's height formula, giving
   an empty picture with nothing in the console. Guarded. (`buildSummaryTree`
   cannot currently produce one, but these functions are exported.)

**Judged and not acted on:**

- A pathological 10,000-block article with a one-block section produces a
  60,000px SVG. That is correct behaviour — the alternative is bands too small to
  click — and a few hundred `<rect>`s at that height is not a performance
  problem.
- `endRow < startRow` renders a 1px phantom band. `buildSummaryTree` returns
  `null` for that case, so it cannot arrive.
- Sol would drop **Mindmap** if this were a shipped control rather than a
  prototype: *"it sacrifices both scale and label width without revealing much
  Tree does not."* Noted, left in — Greg asked for a mindmap explicitly, and
  three is what "try a few different ways" asked for. Worth revisiting once the
  cross-reference arcs below exist, since those would earn the third slot better.
- Sol also spotted, in passing, that `.srch-saved-row`'s
  `rgb(var(--cat-rgb, var(--rule)) / 0.3)` has the same invalid-fallback shape
  this change fixed in `.diag-card` — `--rule` is an `oklch()` colour, not a
  triplet. Left alone: not this change's file to fix, and it should go to
  whoever owns search.

## The browser pass

**It could not be done through the app, and that is worth recording.** A
whole-app sign-in gate (`useSession` in `src/web/App.tsx`) landed while this was
being built, so every browser agent sent at `/read/<slug>?mode=diagram` reached
"Sign in with Google" instead. Signing in needs Greg
(docs/project/auth.md), so a browser agent cannot get past it unaided.

The way round: a throwaway `diagram-preview.html` + `.tsx` at the repo root,
mounting the **real** `DiagramPanel` with the **real** stylesheet against the
committed `example/` article, five times at the widths the band actually takes.
Vite serves any `.html` in the root, so it needs no route and no config. Both
files are deleted afterwards — note that `scripts/typecheck.ts` fails while they
exist, because it checks that every file belongs to a tsconfig project and a
throwaway at the root belongs to none.

Two environment traps, each of which looks exactly like the feature being broken:

- **Several agents run `npm run dev` at once**, so the port moves and a server
  you started may be gone minutes later. Any peer's server serves the same
  working tree.
- **A browser subagent's Bash sandbox has no network**, so `curl localhost`
  returns exit 7 while Chrome loads the page perfectly. Two agents reported the
  server as down on that evidence.

### What it found: the picture never drew at all

Every one of the five panels sat on its `diag-measuring` placeholder forever —
correctly-sized elements, correct toggles, correct footer, clean console, and no
picture. **The first measure was gated on `requestAnimationFrame`, and rAF does
not run in a background tab.** So a panel first rendered in a tab that was never
focused never measured, never laid out, and never said anything was wrong.

The measurements that settled it, read out of the page:

```
clientWidth 319 · clientHeight 460 · padding 8px each side
ResizeObserver "function" · svgs 0 · measuring 5 · quiet 0
```

Every input the measure needed was present and correct. And the probe sent to ask
whether `ResizeObserver` was firing — which resolved its Promise from inside a
`requestAnimationFrame` — **never resolved, and timed out CDP after 45 seconds
with "the renderer may be frozen or unresponsive"**. The diagnostic had inherited
the bug it was sent to find, and that timeout is the positive result: it is rAF
saying it is asleep.

That is `silent-success` with a blank rectangle on it. Worse, it is a failure
mode [browser-testing.md](../project/browser-testing.md) had **already written
down** — its hidden-tab section names "the spine's re-measure" as rAF-coalesced
and therefore dead in a background tab. The doc predicted this bug and nobody
read it first; what has been added there now is the part it did not say, which is
that the same cause can stop a component reaching first paint at all, rather than
merely leaving a value stale.

The fix is not a workaround: the first measure belongs in the layout effect
*synchronously*, which is when a layout effect runs and exactly when it is safe
to read `clientWidth`. It removes the one blank frame as well. Only the resize
path still needs the frame, and a resize implies a visible tab.

**`src/web/Spine.tsx` has the same shape** — `run()` called once and immediately
gated on rAF — and so may have the same problem. Not changed here: different
stage, different owner, and the spine degrades less badly because it renders
something without metrics. Worth a look by whoever owns it.

### And then what it actually showed

After the fix, the same probe:

```
svgs 5 · measuring 0 · quiet 0 · nodes 55 · links 20 · labels 55
```

All five panels drew, at 288, 320 and 400px. No text crossed into a neighbouring
column on either side of either mindmap. No console errors and no React
warnings. Looked at directly, the things that matter are all there: strata's
rotated part labels down its coloured rails, the tree's elbow connectors and its
grey gist lines with the block count at the right edge, the orange you-are-here
ring on the section the reader is in, and the dashed orange position line across
strata.

**The aesthetic verdict, and it is unanimous with Sol's.** Strata is the most
polished — the coloured bands give the hierarchy for free and the whole shape of
the piece reads at a glance. Tree is plainest and entirely legible. **Mindmap is
the weakest of the three**: legible, but busier, lopsided when an article has few
parts, and the one whose labels truncate first at 288px. Both reviewers picked it
as the one to cut if one had to go.

It is staying. Greg asked for a mindmap by name and for several ideas rather than
one, and this is the round where we find out which of them earn their place. The
argument for cutting it is recorded here so that the next person does not have to
rediscover it — and the honest replacement is the cross-reference arcs below,
which would put a genuine *graph* in the third slot rather than a third tree.



## Open, and deliberately not done

- **No cross-reference arcs.** The article's own internal links
  ([`internal-links.ts`](../../src/web/internal-links.ts)) would make a genuine
  *graph* rather than a tree, drawn as arcs down one side. It is the most
  interesting thing left here and it is a second feature, not a fourth toggle.
- **No search hits on the picture.** The spine paints them
  ([search.md](../project/search.md)); `strata` shares the spine's axis exactly,
  so this is nearly free and was left out only to keep the change one thing.
- **Collapse state is not in the URL**, and that is a decision rather than an
  omission — node ids are positional, so a pasted link would open the wrong
  sections on a re-ingested article. See
  [`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx).

---

# Round two: the D3 graph pictures

**Status:** built, 2026-08-27. Three more pictures, three new dependencies, and a
data structure that did not exist in round one.

Greg:

> Ok, let's also try some D3 ones. Try a bunch, e.g. force-weighted graphs,
> creating a richer data structure to lay things out, with review from GPT Sol.
> Then commit these changes.

## What actually changed, and why round one's argument still stands

Round one installed nothing and the reasoning is above. It is worth being precise
that this round does **not** overturn it: that argument was about the **data**,
not the algorithms. With only the tree to draw, `d3-hierarchy`'s `tree()` and
`partition()` were the only functions worth having, and both are wrong for a
288px band — Luna talked us out of them, and it was right.

What changed is [`graph.ts`](../../src/web/graph.ts), which produces something a
tree layout could not have used:

- **Words, not blocks** — a `Block` was carrying its own word count all along, so
  a section can be measured by how much there is to read. That is GPT Sol's
  round-one finding fixed, and it makes `strata` mean what it always claimed.
- **Sequence** — a relation the tree records only in the order of an array.
- **Vocabulary** — sections that talk about the same things, whether or not they
  are siblings. **This is the one a tree cannot hold**, and the only reason a
  graph layout is worth running.

And for a graph there is no hand-rolled alternative worth writing: velocity
Verlet with Barnes–Hut is a real algorithm and `d3-force` is a good
implementation. That is the whole case for the dependency.

## Making the vocabulary graph mean something

The first attempt scored a pair by how many of their top-ten tf-idf terms
matched. Run against real articles it was **bad**, in three ways at once, and
none of them would have shown up in a unit test:

- **Too few edges, by construction.** tf-idf selects terms *for being unique to a
  section*; the next step then looked for terms two sections had in common.
  Anthropic's constitution — 50 sections, 22,000 words — produced **nine** edges.
  The Noema essay produced **one**.
- **Every shared term counted the same.** So the strongest links in the
  constitution joined passages whose common vocabulary was *"section, collapsed,
  readers, default"* — the words an article uses to talk about itself. Confident,
  precise, and about nothing.
- **Short sections won.** Dividing by the smaller vocabulary makes two terms out
  of two a perfect score, so the strongest links in a scanned Victorian pamphlet
  were between its title page and its half-title.

Replaced with **cosine over the whole tf-idf vector**, plus a six-term floor on
what may form an edge at all. The edges are now checkable by eye: *Being honest ←→
Honesty in practice* via **honesty, deceptive, false**; *Ethics as practical
wisdom ←→ Having broadly good values*, 124 rows apart, via **ethical, moral,
ideals**; *Brains Are Not Computers ←→ Other Games In Town* via **turing,
computation, substrate**.

Both the similarity threshold and the force row height were then **swept against
four real articles** rather than picked, and both tables are in the source beside
the constant they justify.

## The GPT Sol review

`gpt-5.6-sol`, high effort. Verdict: **NO-SHIP for that snapshot** — six medium
findings, three low, no high. All nine acted on.

**The three that were real correctness bugs, all invisible on screen:**

1. **The you-are-here line was pointing at the wrong place.** `axis.rows` had
   started counting *words* while the panel was still dividing a *block* index by
   it. The line still drew and still moved as you read; it was simply wrong on
   any article whose paragraphs are not all the same length. Fixed by moving the
   conversion into the one function that knows what unit the axis is in, and
   handing the panel a `y` instead of a ratio.
2. **A section with no words made a 30,000-pixel diagram.** `strata` floors a
   zero extent at one word, then asks how tall the picture must be for the
   smallest band to be six pixels — which answers *six pixels per word of the
   whole article*. Zero-extent nodes are now excluded from the scale, and the
   height is capped at six viewports besides.
3. **Two sections could never be related to each other.** Plain `log(N/df)` is
   zero when `df === N`, so on a two-section article every shared term scored
   nothing — and adding an unrelated third section made an edge appear at 0.52.
   Smoothed to `log((N+1)/(df+0.5))`, which still sends a ubiquitous term to
   ~0.01 while leaving N=2 usable.

**And the one the browser and Sol found together:** the force layout was drawing
sections out of order. `forceY` at 0.85 is a strong *preference*, and
`forceCollide` beats a preference wherever the rows get thin — measured on the
real constitution, **16 of 57 sections were drawn above a section that comes
before them**. That is the exact property every graph library was rejected for in
round one, reintroduced by the one we accepted. Fixed with `fy`, which pins the
axis outright so the simulation solves for x alone; measured afterwards at zero
inversions on all four articles. Sol also found that link endpoints were reading
the *unclamped* simulation coordinates, so on a crowded picture 129 connectors
ran off the side of the band while their bubbles sat at the edge.

**The honesty one, which is the one that matters most.** `graph.ts` computed the
shared terms behind every edge, the comment said they were "for the hover card",
and nothing ever showed them. A curve between two sections with no way to ask
*why* looks exactly as authoritative as one a model had reasoned about — and
these are lexical heuristics. The footer card now lists the words that earned
each link.

**Also fixed:** the graph rebuilt its whole term index when stepping between Arc,
Force and Cluster (100ms on a long article, for a byte-identical result); a
comment claimed the simulation cost "under a millisecond" when Sol measured 39ms
at 60 sections and 113ms at 150; Cluster could be closed by keyboard and never
reopened; a test fixture cast its way past the typechecker; and three file-header
comments still said nothing had been installed.

**Sol's verdict on the pictures**, recorded rather than acted on:

> Keep Arc. It is the strongest new picture: narrow, deterministic, exact reading
> order, and it directly exposes recurrence.
>
> Keep `d3-force`, conditionally. It earns its dependency; twenty lines of
> relaxation would be a worse and less testable substitute.
>
> Cut Cluster and `d3-hierarchy`. It adds no richer relationship and is less
> content-legible than the existing Tree. "Comparison" is not enough reason for a
> permanent sixth toggle.

That is probably right, and Cluster also had the label-collision bug below. It is
staying for now because Greg asked to try a bunch and the trying is the point of
this round — but **if the six get cut to four, Cluster and Mindmap are the two**,
and `d3-hierarchy` and `d3-shape` go with Cluster.

## What the browser found

Same throwaway-preview trick as round one (`diagram-preview.html`, deleted
after — it fails `scripts/typecheck.ts`'s every-file-belongs-to-a-project guard
while it exists), because the app's sign-in gate still stops a browser agent
reaching `/read/`.

- **Cluster drew labels through each other.** `cluster()` places a parent at the
  mean of its children, so a parent of three lands on *exactly* the middle
  child's row — and in the transposed view that is two labels at the same `y`,
  one indented and one not. Not a bug in `cluster()`: a dendrogram labels its
  leaves, and labelling every node is our requirement. Internal labels now sit
  12px above their dot.
- **Force used 47px of a 323px column.** Charge and centring were both too timid,
  so the one axis the physics is allowed to decide was not being used. Retuned;
  measured afterwards at 0.96 of the width on the constitution.
- **Arc was empty on the example article** — which is correct: a 1,943-word
  excerpt of eight short sections genuinely has nothing to relate. It is recorded
  because it reads as broken, and because it is why the test on that fixture
  asserts a *zero* rather than being satisfied by lowering the floor until noise
  appeared.

## Four tests that were passing for no reason

Every one of these was written, watched to go green, and only then checked
against the broken state — which is where they were found to be worthless:

- "gives every section its own distinctive terms" passed with tf-idf replaced by
  raw frequency, because the fixture used every term exactly once.
- "does not link weather and cricket" passed with the edge floor set to zero,
  because those two share no terms at all and never became a candidate.
- Two tests passed with cosine swapped back for the set overlap it replaced,
  because the two measures agree on any fixture not built to separate them.

Replaced with fixtures that discriminate — the last one needed an article where
counting shared terms and weighting them by distinctiveness give *opposite*
answers, which is a pair of falconry sections sharing one rare word against a
pair of geology sections sharing two common ones. All four now go red on the
change they are supposed to catch.
