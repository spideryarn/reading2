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
   ([diagram.md](../project/diagram.md#it-is-to-scale-in-blocks-and-that-is-weaker-than-it-sounds)).
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

That is `silent-success` with a blank rectangle on it, and it is one of the
failure modes [browser-testing.md](../project/browser-testing.md) tells a browser
agent to expect — a hidden tab firing no events. The fix is not a workaround: the
first measure belongs in the layout effect *synchronously*, which is what a
layout effect is for, and it removes the one blank frame as well. Only the
resize path still needs the frame, and a resize implies a visible tab.

**`src/web/Spine.tsx` has the same shape** — `run()` called once and immediately
gated on rAF — and so may have the same problem. Not changed here: different
stage, different owner, and the spine degrades less badly because it renders
something without metrics. Worth a look by whoever owns it.



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
