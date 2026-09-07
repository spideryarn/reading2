/**
 * The spine — a bird's-eye rail down the far left.
 *
 * It read "always visible" here until 2026-08-26, and that was already only
 * nearly true (outline mode drops it); it is now a `Spine` pill in the controls
 * bar and a `?spine=` parameter, so the reader can put it away in any mode.
 * Whether it is on screen at all is decided in layout.ts § fitView — never here.
 *
 * **There is one rail, and it is the collapsed one.** Until 2026-08-26 a wide
 * enough window got a 13rem version carrying part labels in the bands and a
 * header strip naming the current L1 and L2; Greg took that form out, so the
 * rail is always the 12px strip of bands, ticks and marks — halved from 24px
 * on 2026-08-28 (docs/plans/260828ay-spine-rail.md). What a band is
 * lives in its hover card, which is where a proportional rail always had to put
 * it — most bands were too thin for a label even at 13rem.
 *
 * Greg, 2026-08-25:
 *
 * > I want the left-hand most column to show a bird's eye view. So perhaps the
 * > first and maybe second levels of the table of contents in a fairly
 * > information dense way … but I need a way to see where I am in the whole
 * > article.
 *
 * It is a *proportional* rail, not a list: each L1 gets vertical space in
 * proportion to how much of the document it actually occupies, so the rail is a
 * squashed picture of the article rather than an index of it, and the
 * you-are-here band is a genuine position indicator rather than a decoration.
 * The cost, accepted deliberately: a short part gets a sliver too thin to hold
 * its own label. See granularity-zoom.md#the-spine-a-birds-eye-rail.
 *
 * Why it is not a table column: an overview has to be visible all at once, and
 * consecutive rows of the table are hundreds or thousands of pixels apart, so a
 * column can only ever show you the entry you are standing in. Hence a separate
 * `position: fixed` rail, sized to the viewport.
 *
 * Segments are sized from MEASURED PIXEL HEIGHTS, not from word counts. That
 * matters: in outline mode every row collapses to one line, so a 900-word part
 * and a 100-word part become nearly the same height on screen, and a word-count
 * rail would then point at the wrong place. Measuring means the rail is correct
 * in both modes for free.
 *
 * The detail a sliver cannot hold lives in a hover tooltip on each hit target —
 * the part it belongs to, its gist, what is inside it, how far into the piece it
 * sits. That is the payoff of a proportional rail rather than an apology for it.
 * See BandCard at the bottom of this file, and docs/project/tooltips.md.
 *
 * L2 lives in the rail as tick marks and invisible click targets, never as
 * labels in the band. That was true of L1 labels too, in the end: children
 * exactly partition their parent, so the first child's label always starts at
 * exactly the same pixel as its parent's and the two collide. Names live in the
 * hover card, where they are legible however thin the band is.
 *
 * ## Search results down the rail
 *
 * Greg, 2026-08-26:
 *
 * > add dots/thin vertical lines of the relevant search-colour in all the
 * > places where there's a match in the Spine so it's easy to see at a glance
 * > where the results are in the doc (and how common)
 *
 * The rail is already a squashed picture of the whole article, so it is the one
 * place a search's *shape* can be seen — clustered in one section, spread
 * evenly, absent from the second half. The results list cannot say that: it is
 * a list, and a list of thirty passages all looks the same whether they are
 * three paragraphs apart or thirty.
 *
 * Two things about how they are drawn, both of which are the design rather than
 * a detail:
 *
 * **One lane per search.** With several searches switched on at once
 * (SearchPanel.tsx § Saved), a single column of stacked colours would answer
 * "something matched here" and nothing else. Parallel lanes down the right of
 * the rail answer the question the colours were introduced for — *whose* match,
 * and where each search is dense. Lanes are packed rather than fixed to slot
 * numbers: two searches get two lanes whichever slots they happen to wear, so
 * the rail never leaves six empty tracks to look at. The cost is that switching
 * a third search on can move the other two sideways by a lane. The arithmetic —
 * and the rest of that argument — is in spine-marks.ts § laneOrder, which is a
 * module of its own precisely because none of it is visible in a screenshot.
 *
 * **A mark is as tall as the paragraph it names**, floored at a few pixels.
 * That is the same proportional promise the bands make, and it is what makes
 * "how common" readable at a glance: a search that matched six long paragraphs
 * paints far more of the rail than one that matched six list items, which is
 * true and is what you want to know.
 *
 * The count *within* one paragraph is deliberately not a visual channel. Three
 * matches in one paragraph and one match in it are the same mark, because the
 * rail has no room to say otherwise without inventing a width or an opacity the
 * reader would have to learn. The number is in the band's hover card instead,
 * where there is room for the word "matches" beside it.
 */
import {
  memo,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OutlineEntry } from "./tree.js";
import type { BlockMatch } from "./search-hits.js";
import type { BlockId } from "../types.js";
import {
  bandMatchCounts,
  jumpOriginMark,
  laneOrder,
  spineMarks,
  type Row,
} from "./spine-marks.js";
import { useJumpOrigin } from "./router.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";
import { NO_GEOMETRY_CLOCK, noteGeometry, parentGeometryClock } from "./geometry-cost.js";
import { onFontsChanged } from "./fonts.js";

/**
 * Where a band sits inside the part it belongs to.
 *
 * **Three fields rather than the parent `OutlineEntry` itself**, which is what
 * the plan proposed. The entry would hand `BandCard` the whole subtree — every
 * sibling, every grandchild, the parent's own gist — to render one line, and
 * the card is deliberately not allowed to show most of that (§ the card, on why
 * two gists is a wall). A narrow value says what the card may use. GPT Sol,
 * 2026-08-28.
 *
 * `index` is 0-based; the card renders `index + 1`.
 */
interface BandParent {
  title: string;
  index: number;
  total: number;
}

interface Band {
  entry: OutlineEntry;
  /** Offsets in document pixels, relative to the top of the first row. */
  top: number;
  height: number;
  /** For an L2, which L1 it belongs to and whereabouts in it. */
  // `| undefined` explicitly: bandFor passes the argument through whether or
  // not the caller supplied one, and a top-level band genuinely has no parent.
  parent?: BandParent | undefined;
}

interface Metrics {
  docTop: number;
  docHeight: number;
  l1: Band[];
  l2: Band[];
  /** The clickable/hoverable bands — see `measure`. */
  hits: Band[];
  /**
   * Every block on the page, by id.
   *
   * Measured here rather than derived from the search results, because a search
   * mark has to be drawn **in the rail's coordinate system** and the rail's
   * coordinate system is pixels on this screen. `Found.at` already carries a
   * position in the article, but it is measured in *characters* — the right
   * ruler for the result row's "42% in", and the wrong one here, because a
   * paragraph of prose and a one-line list item hold wildly different numbers of
   * characters per pixel. A mark placed by the character ruler would sit in the
   * wrong band, which is the one thing a bird's-eye rail must not do.
   */
  rows: Map<string, Row>;
}

/**
 * Read the table's real geometry out of the DOM.
 *
 * Rows are found by query rather than through a ref, because the spine sits
 * outside the table and deliberately knows nothing about it beyond the one
 * contract that already holds everywhere else in this app: every block is
 * addressed by its stable id (docs/project/block-ids.md), and the row carrying
 * a block is `tr[data-block="<id>"]`.
 *
 * **A geometry parent, and the control the others are read against**
 * (geometry-cost.ts). This is the `O(all rows)` scan that already works the way
 * Stage 3 of
 * docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md
 * would have the two per-frame samplers work — measured once per invalidation,
 * cached in document space, and then never read again during a scroll. So its
 * numbers are the shape of the answer: one call per layout change, `rows + 1`
 * reads, against `apply`'s one read per frame. `rows + 1` because `window.scrollY`
 * is read once and each row costs one rect; `top`, `bottom` and `height` all
 * come off that same DOMRect, which is a snapshot and free to read again.
 */
function measure(outline: OutlineEntry[]): Metrics | null {
  const t0 = parentGeometryClock();
  const metrics = measureRows(outline);
  /* Charged even when it returns null: an unmounted table is a call that read
     nothing, and hiding it would make "the spine never measured" look like
     "the spine is free". */
  if (t0 !== NO_GEOMETRY_CLOCK) noteGeometry("spineMeasure", t0, metrics.reads);
  return metrics.value;
}

/** The scan itself, split out so the measurement above cannot be escaped by a
 *  `return` added later — annotation-cost.ts makes the same move. */
function measureRows(outline: OutlineEntry[]): { value: Metrics | null; reads: number } {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("tbody tr[data-block]"),
  );
  if (rows.length === 0) return { value: null, reads: 0 };

  const sy = window.scrollY;
  /* One `getBoundingClientRect` per row, kept. Reading it again for the height
     would double the number of forced layouts on a page with several hundred
     rows, and this runs on every resize. */
  const rects = rows.map((r) => r.getBoundingClientRect());
  const tops = rects.map((r) => r.top + sy);
  const docTop = tops[0]!;
  const docBottom = rects[rects.length - 1]!.bottom + sy;
  const docHeight = Math.max(1, docBottom - docTop);

  // The top edge of row `i`, or the very bottom of the table for the row just
  // past the end. Row indices come from the tree, so a tree that disagrees with
  // the blocks array clamps here rather than reading past the end.
  const edge = (row: number) => (row < tops.length ? tops[row]! : docBottom);

  const bandFor = (e: OutlineEntry, parent?: BandParent): Band => ({
    entry: e,
    top: edge(e.startRow) - docTop,
    height: Math.max(0, edge(e.endRow + 1) - edge(e.startRow)),
    parent,
  });

  /** The children of `e` as bands, each knowing where in `e` it sits. */
  const childBands = (e: OutlineEntry): Band[] =>
    e.children.map((c, i) =>
      bandFor(c, { title: e.node.title, index: i, total: e.children.length }),
    );

  // L2s are rendered as siblings in the same track rather than nested inside
  // their parent's element, so every band shares one coordinate system and
  // there is no relative-offset arithmetic to get wrong.
  const value: Metrics = {
    docTop,
    docHeight,
    l1: outline.map((e) => bandFor(e)),
    l2: outline.flatMap(childBands),
    // Hit targets must tile the whole rail, or a stretch of the article has no
    // tooltip and nothing to click. L2s partition their parent, so they cover
    // it exactly — *unless* a part has no children at all, and then the part
    // itself stands in for them.
    hits: outline.flatMap((e) =>
      e.children.length > 0 ? childBands(e) : [bandFor(e)],
    ),
    rows: new Map(
      rows.flatMap((r, i) => {
        const id = r.dataset.block;
        // A row with no id cannot be addressed by anything upstream, so it is
        // dropped rather than given an index nothing will ever look up.
        return id ? [[id, { index: i, top: tops[i]! - docTop, height: rects[i]!.height }] as const] : [];
      }),
    ),
  };
  // One `window.scrollY` plus one rect per row. Everything after that is
  // arithmetic over DOMRects already taken.
  return { value, reads: rows.length + 1 };
}

interface Props {
  outline: OutlineEntry[];
  /** Changes whenever the table's layout could have changed, forcing a re-measure. */
  layoutKey: string;
  /**
   * Which searches matched in which blocks — `blockMatches` in search-hits.ts.
   *
   * Empty whenever search mode is not open, which is the ordinary case: the
   * rail acquires marks when the reader asks for them and at no other time,
   * exactly as the prose does. Optional so that nothing else rendering a spine
   * has to know this feature exists.
   */
  matches?: Map<BlockId, BlockMatch> | undefined;
  onJump(blockId: string): void;
}

/** Where in the viewport we consider the reader to be reading. */
const READING_LINE = 0.35;

/** Nothing to draw, and a stable identity so the memos below do not rerun. */
const NO_MATCHES: Map<BlockId, BlockMatch> = new Map();

/**
 * What pressing a band should do: show what it is, or go there.
 *
 * **A three-line function with its own name and its own test, for the reason
 * `stepBar` in scroll.ts has one** — it cannot be checked where it lives. The
 * branch that matters only runs under a finger, and the browser harness is a
 * desktop Chrome, so a broken one would look exactly like a working one.
 *
 * The rule: a mouse click or a keypress jumps, exactly as it always did. A
 * **tap** on a band whose card is not already open *opens the card*, and only a
 * second tap on that same band jumps. Reveal, then commit — because these bands
 * are proportional and most of them are a few pixels tall, so tapping one blind
 * is a coin flip and the card is the only thing that can say what you are about
 * to press.
 *
 * **`touch` is a fact about this press, not about the device**, and that is the
 * second version of this function. The first asked `(hover: none)`, which the
 * Media Queries spec defines as a property of the UA's *primary* pointing
 * device: a touchscreen laptop whose primary pointer is a mouse reports
 * `hover: hover`, so a finger there would have jumped on the first tap, and a
 * tablet with a mouse plugged in reports `hover: none`, so the mouse there
 * would have needed two clicks. Both are hybrids, both are common, and
 * `PointerEvent.pointerType` simply answers the question that was being asked.
 * GPT Sol, 2026-08-27.
 *
 * Note it is `armed !== id` rather than `armed === null`: a finger moving from
 * one band to another re-reveals rather than jumping, so the rail can be read
 * by walking down it instead of firing at whatever it lands on.
 */
/**
 * Which card is open, and what opened it.
 *
 * `outline` is carried so that the id can be checked against the article it was
 * minted in — ids are positional within an outline, so the same id in a new one
 * is a different band. See `armedId`.
 */
interface Armed {
  id: string;
  byTouch: boolean;
  outline: OutlineEntry[];
}

export function bandPress(
  touch: boolean,
  armed: string | null,
  id: string,
): "reveal" | "jump" {
  return touch && armed !== id ? "reveal" : "jump";
}

/**
 * **Memoised, for the reason `TableView` is** — and it is the larger of the
 * two counts. performance.md's own example line reads `Spine=114 TableView=104`.
 *
 * `useReadingPosition` writes `?at=` as the reader scrolls, which re-renders
 * `Reader`, which re-rendered this. None of its four props depends on `at`:
 * `outline` and `matches` are memos over the article and the search
 * (App.tsx:1505, 2104), `layoutKey` is a string, and `onJump` is `jumpTo`, a
 * `useCallback` over a nuqs setter.
 *
 * The rail's own scroll listener is unaffected — it lives inside, writes to a
 * `data-` attribute and to local state, and a memo does not touch either. That
 * is the point: the rail should re-render when the *reader moves*, not when
 * their parent does.
 *
 * docs/plans/260904a-more-scroll-cpu-wins.md.
 */
export const Spine = memo(SpineInner);

function SpineInner({ outline, layoutKey, matches = NO_MATCHES, onJump }: Props) {
  useRenderCount("Spine");
  /**
   * Which band's card is open, and what opened it.
   *
   * **It said "a finger" here, and `null` on a device with a pointer, and that
   * has not been true since `bf398f3` made the tooltips controlled.** Every
   * input feeds this one value now — a mouse through hover, a keyboard through
   * focus, a finger through the click handler — which is exactly why one shared
   * piece of state serving fifty triggers was able to take the hover cards away
   * for a day (docs/postmortems/260828g-spine-hover-cards.md). `byTouch` is the part
   * that is still about fingers.
   *
   * **State on this component is not free** — performance.md is largely about
   * how often this file re-renders during a scroll — so it is worth saying what
   * this one costs: it changes when a card opens or closes, which is a
   * happening at most a few times a minute, and never on scroll, hover or
   * resize. It is also dead weight on a mouse, where `coarse` is false and
   * `armed` never leaves `null`.
   */
  const [armed, setArmed] = useState<Armed | null>(null);
  /**
   * **`armed`, but only if it is about the outline on screen right now.**
   *
   * Every read of "which card is open" goes through this rather than through
   * `armed`, and that is the whole of the outline-replacement guard — there is
   * no effect, because an effect was the wrong shape for it. `useEffect` runs
   * *after* paint, so a `setArmed(null)` there lets the stale card render once
   * on the new article before it is taken away, and a test that waits 300ms
   * cannot tell that from never opening at all. GPT Sol, 2026-08-28.
   *
   * Comparing the array by reference is exactly right here: `outline` is
   * memoised per article in App.tsx, so a new reference *is* a new outline, and
   * two different articles cannot share one.
   */
  const armedId = armed && armed.outline === outline ? armed.id : null;
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  /* The you-are-here band. State, because it changes what is *drawn* — but set
     only when the band actually changes, which is a handful of times per
     article rather than once per frame. See the scroll effect below. */
  const [here, setHere] = useState<Band | null>(null);
  /**
   * The same question one level finer: which **hit** the reading line is in.
   *
   * Separate from `here` because the two are read by different things. `here`
   * is an L1 and draws `.spine-part.active`, which must stay a part — the rail
   * highlights the part you are in. This is the L2 (or the childless part
   * standing in for one), and it is what a card means by *you are here*.
   *
   * **Comparing `here` would have been wrong rather than approximate.** The
   * cards hang off `hits`, which are L2s, so a card that asked "is my parent
   * the current part" would say *you are here* on every sibling section of the
   * one you are actually in — five wrong answers and one right one, with
   * nothing distinguishing them. GPT Sol, 2026-08-28.
   *
   * The cost is honest and small: this transitions when the reader crosses a
   * *section* boundary rather than a part boundary, so a Spine re-render goes
   * from about seven times an article to about fifty. That is still nothing
   * beside the sixty-a-second the scroll effect below exists to avoid, and it
   * is not on the scroll path — `apply` compares and only calls the setter on a
   * real transition, exactly as it does for `here`.
   */
  const [hereHit, setHereHit] = useState<{ id: string; metrics: Metrics } | null>(
    null,
  );
  /** The moving viewport band, written to directly rather than re-rendered. */
  const viewportBand = useRef<HTMLDivElement>(null);

  // ---- measurement -------------------------------------------------------
  // `layoutKey` is a re-run trigger, not a value this effect reads — that is
  // the whole point of the prop (see its doc comment above). Biome sees it
  // unused in the body and its autofix DELETES it from the deps, which stops
  // the spine re-measuring when the table's layout changes. Don't apply it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useLayoutEffect(() => {
    let raf = 0;
    const run = () => {
      // Debounced through rAF: ResizeObserver fires during layout, and setting
      // state synchronously from it is how you get the "loop completed with
      // undelivered notifications" warning.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setMetrics(measure(outline));
        setViewportH(window.innerHeight);
      });
    };
    run();

    const ro = new ResizeObserver(run);
    ro.observe(document.body);
    window.addEventListener("resize", run);
    // Webfonts land after first paint and change every row height with them.
    // The event rather than `fonts.ready`: reading that getter was 21.5% of all
    // script time on a 2,046-block article, and this effect re-runs on every
    // mode switch. See rows.ts's sibling, fonts.ts.
    const offFonts = onFontsChanged(run);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", run);
      offFonts();
      cancelAnimationFrame(raf);
    };
  }, [outline, layoutKey]);

  // ---- scroll position ---------------------------------------------------
  /**
   * **Scrolling does not re-render this component.**
   *
   * It used to: a rAF-debounced `setScrollY(window.scrollY)`, which is the
   * ordinary way to do this and costs a full re-render of the whole rail —
   * every band, every tick, every tooltip — sixty times a second, to move one
   * div a few pixels. On a 360-row article that was the largest single thing
   * happening during a scroll.
   *
   * So the two things scroll actually drives are split by how often they
   * change:
   *
   * - **The viewport band's position** changes every frame and is pure
   *   presentation, so it is written straight to the node. Same trick as
   *   `--level` in MicLevel.tsx.
   * - **Which band is active** changes when you cross a part boundary — a
   *   handful of times in an article. That still goes through state, because it
   *   changes what is drawn, but the setter is called only on a real
   *   transition. Same local-mirror trick as useAudioLevel.ts.
   *
   * **Since 2026-08-28 there is a second one of those, and it is finer.** The
   * card's *you are here* needs the current **section**, not the current part
   * (`hereHit`), so the rail now re-renders on L2 boundaries — roughly fifty
   * times across an article rather than seven. That is the cost of the feature,
   * it is bounded by the outline rather than by the frame rate, and it is
   * pinned at exactly one render per crossing in `tests/spine-scroll.test.ts`.
   * Until that file was given a fixture with sections in it, on the same day, it
   * could not have seen this at all: both its parts had `children: []`, which
   * makes `hits` and `l1` the same array.
   *
   * React does not clobber the imperative `top`: the element's `style` prop
   * never contains it, so the diff has nothing to say about it.
   *
   * Depends on `metrics` and `viewportH` rather than reading them from refs.
   * Both change rarely (a resize, a font swap), so re-subscribing then is
   * cheaper than the indirection — and it keeps the closure's values honest.
   */
  useEffect(() => {
    if (!metrics) return;
    const { docTop, docHeight, l1, hits } = metrics;
    let raf = 0;
    /* Local mirrors of the two current-position identities. Comparing against
       the state values would need them in the dependency list, which would
       re-subscribe the listener every time the reader crossed a boundary. */
    let hereId: string | null = null;
    let hitId: string | null = null;

    /**
     * **The geometry parent that should report one read and no more**
     * (geometry-cost.ts). Everything it needs about the article's shape is in
     * `metrics`, cached in document space by `measure` above, so the only thing
     * it asks the browser is where the page is scrolled to. If this ever
     * reports more than one read, the cache has sprung a leak and that is a
     * finding rather than a number — it is the evidence the whole
     * shared-snapshot design in
     * docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md
     * rests on.
     *
     * Its one `writes` is the band's `style.top`, which is a write into the
     * middle of a frame that other consumers are reading rects in.
     */
    const apply = () => {
      raf = 0;
      const t0 = parentGeometryClock();
      const sy = window.scrollY;

      let writes = 0;
      const band = viewportBand.current;
      if (band) {
        band.style.top = `${((sy - docTop) / docHeight) * 100}%`;
        writes = 1;
      }

      const pos = sy + viewportH * READING_LINE - docTop;
      const inBand = (b: Band) => pos >= b.top && pos < b.top + b.height;
      const last = l1[l1.length - 1] ?? null;
      const next = l1.find(inBand) ?? (pos >= 0 ? last : (l1[0] ?? null));
      const id = next?.entry.node.id ?? null;
      if (id !== hereId) {
        hereId = id;
        setHere(next);
      }

      /* The finer one. No fallback to the first or last: a reading line above
         the article or below its end is genuinely in no section, and a card
         claiming *you are here* about the last section while the reader is in
         the masthead would be worse than saying nothing. */
      const hit = hits.find(inBand)?.entry.node.id ?? null;
      if (hit !== hitId) {
        hitId = hit;
        setHereHit(hit === null ? null : { id: hit, metrics });
      }
      if (t0 !== NO_GEOMETRY_CLOCK) noteGeometry("spineApply", t0, 1, writes);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    apply();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [metrics, viewportH]);

  /**
   * **An armed band that is no longer on the rail has to be let go of.**
   *
   * `armed` is cleared by `onOpenChange`, and `onOpenChange` comes from a
   * mounted tooltip — so if the band under it *disappears* (a re-measure after
   * a re-extraction, a layout change that replaces `hits`, a failed measure
   * that returns `null`) the tooltip unmounts without any close arriving and
   * `armed` stays pointing at a band that is gone. Nothing is drawn, so it
   * looks harmless; what it costs is that ids are positional within an outline,
   * so a *different* article's band can inherit the same id and open a card
   * nobody asked for. Found by GPT Sol reviewing the plan, 2026-08-28 — the
   * identity guard that fixed the regression is about stale *closes*, and this
   * is the opposite end of the same lifecycle.
   *
   * Not a `useEffect` over `metrics.hits.map(id)` with a join: the array is
   * rebuilt on every measure, so the cheap check is the membership test itself.
   */
  useEffect(() => {
    if (!armedId) return;
    const stillThere = metrics?.hits.some((b) => b.entry.node.id === armedId);
    if (!stillThere) setArmed(null);
  }, [metrics, armedId]);

  /**
   * **A card a finger opened does not survive a scroll.**
   *
   * Floating UI's `useDismiss` is not configured for ancestor scroll here, so
   * without this a touch-opened card rides up the screen while the article
   * moves underneath it, and everything it says about position — `38% in`, and
   * now *you are here* — quietly stops being true of where the reader is. A
   * card that is wrong is worse than one that has gone.
   *
   * Touch only, and deliberately: on a mouse the card is held open by the
   * pointer being on the band, so closing it on scroll would fight the reader
   * rather than help them. `byTouch` is exactly the distinction already drawn
   * for the tap hint. GPT Sol, 2026-08-28.
   *
   * Subscribed only while such a card is open, so a mouse reader and a
   * finger reader who has not opened anything both pay nothing.
   */
  useEffect(() => {
    if (!(armedId && armed?.byTouch)) return;
    const close = () => setArmed(null);
    window.addEventListener("scroll", close, { passive: true, once: true });
    return () => window.removeEventListener("scroll", close);
    /* `armedId` as well as `armed`: it is the one that goes null when the
       outline is replaced under a card that is still open, and subscribing on
       the strength of a stale `armed` would arm a listener for a card nobody
       can see. */
  }, [armed, armedId]);

  /**
   * **The current section, but only if it was measured against the geometry on
   * screen now.** Same shape as `armedId` above, and for the same reason: a
   * re-measure (a resize, a font swap, a re-extraction) replaces every band, and
   * the id this state holds was found in the *previous* set of them. The scroll
   * effect recomputes it, but not before the next paint — so without this
   * comparison there is one frame in which a card says *you are here* about a
   * band the reader is not in. `null` for that frame is a claim about what we
   * know; a stale id is a claim about the article. GPT Sol, 2026-08-28.
   *
   * **Correct by construction rather than by test, and that is worth saying out
   * loud.** Every other guard in this file has a case that was watched going red
   * without it; this one does not, because the window it closes is a single
   * paint *between* a commit and the effect that follows it, and `act` flushes
   * both before anything can look. A mutation removing the `=== metrics`
   * comparison leaves the whole suite green. It is kept because a reference
   * comparison cannot be subtly wrong, not because anything here proves it
   * works — do not read the passing suite as evidence about this line.
   */
  const hereHitId = hereHit && hereHit.metrics === metrics ? hereHit.id : null;

  /**
   * **The band to fill as *you are here* — the current section, when there is
   * one worth drawing.**
   *
   * Greg, 2026-09-06, on an article whose single part holds 95% of the rows:
   *
   * > The Spine only really highlights in orange the current top-level section,
   * > so basically the Spine is almost completely orange when I'm reading the
   * > main section.
   *
   * `.spine-part.active` is not wrong on that shape, it is uninformative — it
   * says *you are in the 95% of the article that is the article*. Three of the
   * thirteen trees in `data/` have a part over half the document, so this is a
   * shape rather than a pathology. The answer is to draw the level below, which
   * this component has computed since 2026-08-28 and until now showed only to a
   * screen reader. docs/plans/260906g-spine-concentric-depth-highlight.md.
   *
   * **It costs no extra render**, which is what makes it a `find` here rather
   * than a project: `hereHit` is already state and already transitions on
   * exactly these boundaries, so this runs inside renders that were happening
   * anyway. Not a `useMemo` — memoising would only skip an `O(hits)` scan of a
   * few dozen entries during a render that has already been paid for.
   *
   * **`parent` is the test, and it is the one that cannot drift.** A band gets
   * a `parent` from `childBands` and none from the L1 fallback `measure` uses
   * for a childless part, so the field already *is* "am I a real section". The
   * plan originally proposed asking whether the id also appears in `metrics.l1`;
   * that works, but it is a second scan inferring what `measure` already
   * recorded. GPT Sol, 2026-09-06.
   *
   * **`total > 1`, and that is not defensive.** Children partition their
   * parent, so a part with exactly one child is covered by it exactly —
   * permitted by `tree-invariants.ts` for a leaf ("no child may cover its
   * parent's whole range — unless it is a leaf") and already present in
   * `tests/spine-card.test.tsx`'s fixture. Ringing it would paint a second fill
   * at the part's own geometry, which nobody would report as a bug: it just
   * looks like a slightly darker band.
   *
   * A **supplement** falls out of the same test rather than needing its own.
   * `buildOutline` gives one `children: []` unconditionally, so `measure`
   * always makes it an L1 fallback, so it has no `parent` and gets no ring. The
   * first draft of the plan specified a dimmed supplement ring; it could never
   * have rendered.
   *
   * Null outside the article, because `hereHitId` is — the scroll effect gives
   * it no fallback to the first or last band on purpose.
   */
  const hereBand =
    metrics && hereHitId !== null
      ? metrics.hits.find((b) => b.entry.node.id === hereHitId)
      : undefined;
  const hereRing = hereBand?.parent && hereBand.parent.total > 1 ? hereBand : null;

  const docHeight = metrics?.docHeight ?? 1;
  const pct = useCallback(
    (v: number) => `${(v / docHeight) * 100}%`,
    [docHeight],
  );



  /**
   * The search marks, in the rail's own coordinate system.
   *
   * One element per (block, search) pair, so a paragraph two searches both
   * found is two marks side by side rather than one mark of a compromise
   * colour. A block whose row is not on the page is skipped rather than drawn
   * at the top — that happens when the results outlive a re-extraction, and a
   * mark pointing at nothing is worse than a missing one.
   */
  const lanes = useMemo(() => laneOrder(matches), [matches]);
  const marks = useMemo(
    () => (metrics ? spineMarks(metrics.rows, matches, lanes) : []),
    [metrics, matches, lanes],
  );

  /**
   * **Where the reader jumped from**, while there is a way back to it.
   *
   * Subscribed here rather than threaded down as a prop, which is the same call
   * `ReturnChip` makes and for the same two reasons. The stamp is a store over
   * `history.state` (router.ts § `useJumpOrigin`), so reading it where it is
   * drawn keeps `App` out of a re-render it has no use for; and the mark and
   * the chip are then **one fact with two views** rather than two things kept
   * in step — the × that strips the stamp takes both away without either
   * knowing the other exists.
   *
   * `matches` is a prop because it is derived from search state that lives up
   * there. This is not.
   *
   * **It does not put the rail back on the scroll path**, which is the thing
   * this component is careful about: `jumpOriginSnapshot` caches the object it
   * returns, so the `?at=` replace the scroll spy makes about once a second
   * fires the store's listener and changes nothing. What re-renders the rail is
   * a change in the *effective stamp* — typically a jump, a Back or Forward, a
   * push that strips it, or a dismissal — which is a few times a minute at most.
   *
   * **Only while the chip is up, and never the other way round** — the same
   * `readStamp` is behind both. Two cases draw no mark, and they are not the
   * same case: an origin of `{ kind: "top" }`, where the **chip remains** and
   * says "back to the beginning" in words because there is no block to mark
   * (GPT Sol F8); and a stamp this page cannot resolve, where **both** go.
   * spine-marks.ts § `jumpOriginMark` owns all three rules.
   */
  const jumpOrigin = useJumpOrigin();
  const from = useMemo(
    () => (metrics ? jumpOriginMark(metrics.rows, jumpOrigin) : null),
    [metrics, jumpOrigin],
  );

  /**
   * How many matches fall inside each hoverable band, by its node id.
   *
   * This is where "how common" gets a number rather than a shape. The rail
   * shows the distribution; the band's hover card says *four matches in this
   * section*, which is the thing a two-pixel mark cannot.
   *
   * Compared by **row index** rather than by pixel, because that is what a band
   * is actually defined by (`startRow`/`endRow` from the outline) — comparing
   * tops would give a different answer for a block sitting exactly on a band
   * boundary, and which answer would depend on sub-pixel rounding.
   */
  const bandCounts = useMemo(
    () =>
      metrics
        ? bandMatchCounts(
            metrics.rows,
            matches,
            metrics.hits.map((b) => ({
              id: b.entry.node.id,
              startRow: b.entry.startRow,
              endRow: b.entry.endRow,
            })),
          )
        : new Map<string, number>(),
    [metrics, matches],
  );

  if (!metrics || metrics.l1.length === 0) {
    // Tagged for the keyboard even while it is empty: the rail occupies its
    // width from the first paint but only measures on the next frame, and a
    // rail that quietly meant "sections" for that frame would be a level that
    // changed under the pointer without the pointer moving.
    return <aside className="spine" aria-hidden="true" data-nav-depth={1} />;
  }

  return (
    <aside
      className="spine"
      aria-label="Article outline"
      /* The whole rail is one keyboard-navigation zone, meaning L1: it draws
         parts as bands, so ↑ / ↓ over it step part by part. See keynav.ts.

         **This is now a decision rather than the obvious reading, and it was
         re-taken on 2026-09-06.** It used to say the L2 click targets were "a
         pointing concession, not what the rail is *about*", on the grounds
         that a 1px tick is unhittable. That argument is spent: since the rail
         started filling the current section (`hereRing` below), L2 is not just
         where a click lands, it is the strongest fill on the rail.

         It stays L1 anyway. The rail still *shows* the whole part structure and
         a reader stepping through it is navigating the article's parts; making
         ↑ / ↓ step section by section would turn a seven-press traverse into a
         fifty-press one, which is the opposite of what a bird's-eye rail is
         for. Revisit it as its own change if anybody asks for it — do not
         change it as a side-effect of a visual one. GPT Sol, 2026-09-06. */
      data-nav-depth={1}
    >
      <div className="spine-track">
        {metrics.l1.map((b) => {
          const active = b.entry.node.id === here?.entry.node.id;
          return (
            <div
              key={b.entry.node.id}
              /* The apparatus keeps its true proportional height and is
                 dimmed. That is the fix for the complaint the rail exists to
                 answer: on a heavily noted piece you are "60% through" and the
                 piece ends there, because the rest is endnotes. Shrinking the
                 band would make the rail lie about pixels; dimming it says
                 where the argument ends and leaves the notes hittable.
                 src/supplement.ts. */
              className={`spine-part${active ? " active" : ""}${
                b.entry.supplement ? " supplement" : ""
              }`}
              style={{ top: pct(b.top), height: pct(b.height) }}
            />
          );
        })}

        {/* **The section you are in**, filled — see `hereRing` above for why
            the part alone was not enough and when this is deliberately absent.

            **Its position in this list is the whole of its correctness**, and
            nothing about getting it wrong looks wrong. The rail is one stacking
            context of absolutely-positioned siblings with no `z-index` between
            them, so tree order is paint order, and this element has to sit:

            - *after* the parts, or the band it marks paints over it;
            - *before* the L2 ticks, or it hides the hairline that marks its own
              top edge — and the hairlines are what make it read as *one of
              these sections* rather than as a brighter smear;
            - *before* the search marks, which is the one that would have cost
              somebody an afternoon. The tempting version of this feature is
              `.spine-hit[aria-current="location"] { background: … }` — the
              geometry and the state are both already there and it needs no new
              element. It is wrong: the hit targets render below, *over* the
              marks, so a fill on one would hide the search hits inside the
              section the reader is actually reading. The 14% hover wash gets
              away with it by being faint and momentary; a permanent fill would
              not. `tests/spine-here.test.ts` asserts this order, because jsdom
              cannot see paint and a screenshot only shows it during a search.

            `aria-hidden`, and deliberately: the button underneath already
            carries `aria-current="location"`, which is the standard way to say
            *this one, of these, is where you are*. This element is the same
            fact made visible, and saying it twice is worse than saying it
            once. Nothing here should announce on a section crossing — that
            fires throughout an ordinary scroll. */}
        {hereRing && (
          <div
            className="spine-here"
            aria-hidden="true"
            /* **`--here-top` rather than `top`.** The 2px floor in the
               stylesheet grows the box *downward* from a fixed `top`, and the
               final L2 of an article starts at very nearly 100% — so the floor
               grows straight out of `.spine { overflow: hidden }` and is
               clipped away, dropping the *you are here* exactly at the end of
               the piece. Not hypothetical: two of the thirteen trees in
               `data/` (`scaling-hypothesis`, `fowler-phrenology`) end in a
               section worth 0.12% of the article, against the ~0.22% that two
               pixels of a rail cost. GPT Sol found it, 2026-09-06.

               So the top is clamped inward, and the clamp has to live in CSS:
               written here as `calc(min(<top>, 100% - 2px))` it would be
               parsed by jsdom's CSSOM into `calc(min(3000% * , - 2px))`, and
               every assertion in `tests/spine-here.test.ts` would read that
               mangled string and agree with itself while the browser did
               something else. A custom property is stored verbatim, so the
               number stays checkable in jsdom and the clamp sits in the
               stylesheet beside the floor it corrects. */
            style={
              {
                "--here-top": pct(hereRing.top),
                height: pct(hereRing.height),
              } as CSSProperties
            }
          />
        )}

        {/* Subdivision is always drawn, so the shape of the article is visible
            even where there is no room for a word of it. */}
        {metrics.l2.map((b) => (
          <div
            key={`tick-${b.entry.node.id}`}
            className="spine-tick"
            style={{ top: pct(b.top) }}
          />
        ))}

        {/* **Where the reader jumped from**, while the chip offering the way
            back is up — Stage C of
            docs/plans/260906g-back-to-where-you-jumped-from.md. The chip names
            the place in words; this answers *how far did I come?*, which is the
            question a label cannot.

            **One mark, and not a trail.** Greg asked for previous locations
            fading over time; the rail's own rule is that it acquires marks when
            the reader asks for them and at no other time, and a decaying trail
            is ambient information with no action attached and a legend to
            learn. This is tied to a button the reader can press, and it goes
            when that button goes.

            **Its position in this list is as load-bearing as `.spine-here`'s**,
            and for the same reason: no z-index between these siblings, so tree
            order is paint order. After the hairlines, or a 3px mark reads as
            one of them; before the search marks, or it hides the hit in the
            very paragraph the reader jumped from — invisible until somebody is
            searching, which is the case tests/spine-jump-origin.test.ts pins.

            **It is not in `.spine-matches`, and that is the whole of "takes no
            lane".** Lanes are packed by `laneOrder`, so a mark that joined that
            container would have to be given a track out of the same 10px
            gutter and every search would shift sideways to make room.

            `aria-hidden`: the chip is a button carrying this sentence in words
            and in the tab order, so a second announcement — on an element the
            reader cannot press — would only be in the way.

            `--from-top` rather than `top`, exactly as `.spine-here` does it:
            the stylesheet clamps the number so the 3px floor cannot grow out of
            `.spine { overflow: hidden }` for a jump made from the last rows of
            the article, and a `calc(min(…))` written here would be mangled by
            jsdom's CSSOM into a string every test would agree with. */}
        {from && (
          <div
            className="spine-from"
            aria-hidden="true"
            style={
              {
                "--from-top": pct(from.top),
                height: pct(from.height),
              } as CSSProperties
            }
          />
        )}

        {/* Where the searches matched — Greg, 2026-08-26. One lane per search
            down the right-hand edge, each mark as tall as the paragraph it
            names. The module docstring at the top of this file has why lanes
            rather than a stack, and why a paragraph's match *count* is not a
            visual channel.

            `aria-hidden`, and that is not an omission: every one of these marks
            is a row in the results panel already, with its passage, its
            confidence and the question that found it — a screen reader that
            read the rail too would be reading the same list twice, in an order
            that means nothing without the picture. The band buttons below carry
            the count in their accessible name, which is the part of this that
            is genuinely extra information.

            Drawn *after* the parts and the L2 ticks so it sits over them, and
            *before* the viewport band so "where am I" is never underneath a
            search result. */}
        {marks.length > 0 && (
          <div
            className="spine-matches"
            aria-hidden="true"
            style={{ "--lanes": lanes.size } as CSSProperties}
          >
            {marks.map((m) => (
              <div
                key={m.key}
                className="spine-match"
                /* `--match-top` rather than `top`, for the reason `.spine-here`
                   and `.spine-from` do it: the stylesheet clamps the number so
                   the 3px floor cannot grow out of `.spine { overflow: hidden }`
                   for a hit in the article's last block. Found in a browser on
                   an article whose final block is a short citation — the mark
                   was drawn at `top: 798.9, bottom: 801.9` against a rail ending
                   at 800, so two thirds of it was outside. GPT Sol F31 has the
                   precise statement: what the overflow removes is the *floor*,
                   cutting the box back to the row's own proportional height, so
                   a short enough final block loses its mark entirely and a
                   slightly taller one is left as a sliver. 2026-09-06. */
                style={
                  {
                    "--match-top": pct(m.top),
                    height: pct(m.height),
                    "--lane": m.lane,
                    "--h": m.rgb,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        {/* Transparent hit targets, one per L2, laid over the parts. Clicking
            the rail therefore lands on the finest level the rail knows about,
            which is more precise than the part it sits in, and a 1px tick is
            not something anyone can hit.

            They are also where the detail lives. The rail is proportional, so
            most bands are too thin for a label and the thinnest are too thin
            for anything — the tooltip is the only place a two-pixel section can
            say what it is. Grouped, so that once one is open, running the
            pointer down the rail reads the article's sections one after another
            with no re-wait: the rail becomes scrubbable. */}
        <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
          {metrics.hits.map((b) => (
            <Tooltip
              key={`hit-${b.entry.node.id}`}
              placement="right"
              className="tip-band"
              /* **Controlled at every width and on every device**, which is
                 simpler than it first sounds: one owner of "which card is
                 open", fed by whichever input is present. A mouse feeds it
                 through hover, a keyboard through focus (`useFocus` is
                 `visibleOnly`, so a tap does not count as focus and cannot
                 open a card behind the reader's back), and a finger through the
                 click handler below. Being controlled is also what turns off
                 hover's synthesised touch events — see `mouseOnly` in
                 Tooltip.tsx, without which the second tap could never land. */
              open={armedId === b.entry.node.id}
              /* **A close only counts from the band that is open.** The
                 obvious `setArmed(v ? {…} : null)` is what took the rail's
                 hover cards away between 2026-08-27 and 2026-08-28, and it is
                 the cost of one shared state serving fifty triggers:
                 `useDelayGroup` enforces one-open-at-a-time by calling *every
                 other member's* `onOpenChange(false)` the moment one opens, and
                 `useHover` schedules a departing band's close 90ms behind the
                 pointer without checking whether that band is still the open
                 one. Both are correct against an uncontrolled tooltip, which
                 clears only its own `useState`; against one shared `armed` they
                 clear the card that just opened.
                 docs/postmortems/260828g-spine-hover-cards.md. */
              onOpenChange={(v: boolean) =>
                setArmed((prev) =>
                  v
                    ? { id: b.entry.node.id, byTouch: false, outline }
                    : prev?.id === b.entry.node.id
                      ? null
                      : prev,
                )
              }
              content={
                <BandCard
                  band={b}
                  position={Math.round((b.top / docHeight) * 100)}
                  matches={bandCounts.get(b.entry.node.id) ?? 0}
                  here={hereHitId === b.entry.node.id}
                  /* Only when a finger opened it. A mouse reader hovering the
                     rail is one click from anywhere and does not need telling;
                     saying "tap again" to somebody holding a mouse is noise. */
                  showTapHint={
                    armedId === b.entry.node.id && (armed?.byTouch ?? false)
                  }
                />
              }
            >
              <button
                type="button"
                className="spine-hit"
                style={{ top: pct(b.top), height: pct(b.height) }}
                /* The tooltip is the button's *description*, not its name —
                   useRole wires it up as aria-describedby — so the name still
                   has to be said here, or a screen reader reads fifty
                   identically anonymous buttons. */
                /* The match count is in the name rather than only in the card
                   because the card is the button's *description*, and a
                   description is what a screen reader can be configured not to
                   read. "Four matches here" is the whole reason somebody using
                   the rail during a search would press this one. */
                aria-label={ariaFor(b, bandCounts.get(b.entry.node.id) ?? 0)}
                /* **The same fact the card puts in words, in the one place a
                   screen reader will find it.** `you are here` in the card is
                   the tooltip's *description*, which a screen reader can be
                   configured not to read, and the card is opened by hover —
                   which is not a thing a keyboard has. `aria-current="location"`
                   is the standard way to say "this one, of these, is where you
                   are", and it costs nothing because `hereHit` is already
                   state. Do not make it visual-only. GPT Sol, 2026-08-28. */
                {...(hereHitId === b.entry.node.id && { "aria-current": "location" as const })}
                /* **On a touch device the first tap reads the band and the
                   second one goes there.**

                   Greg, 2026-08-27, on reading this on a phone — *"let's make
                   the spine tappable (esp on mobile)"*. The rail is the only
                   whole-article overview left once the gist columns go
                   (layout.ts § gistsThatFit), and it was useless on a phone:
                   everything it knows — which part a section belongs to, its
                   gist, how far in it is, how many search matches are in it —
                   lives in a hover card, and a finger cannot hover. So the rail
                   was a decorative stripe that occasionally threw you somewhere.

                   That is also why a tap could not simply keep jumping. These
                   bands are proportional, so most of them are a few pixels
                   tall; tapping one blind is a coin flip, and the card is the
                   only thing that can tell you what you are about to press.
                   Reveal, then commit.

                   A mouse is untouched: `coarse` is false, the tooltip owns its
                   own open state, and one click still jumps. */
                onClick={(e) => {
                  /* `pointerType` is "touch" for a finger, "mouse" for a
                     click, and "" for a keypress — React's click carries the
                     native PointerEvent. Optional-chained because a synthetic
                     click (a test, an extension) may carry no pointer at all,
                     and the safe reading of "no pointer" is "not a finger",
                     which jumps. */
                  const touch =
                    (e.nativeEvent as PointerEvent).pointerType === "touch";
                  if (bandPress(touch, armedId, b.entry.node.id) === "reveal") {
                    setArmed({ id: b.entry.node.id, byTouch: true, outline });
                    return;
                  }
                  setArmed(null);
                  onJump(b.entry.node.range[0]);
                }}
              />
            </Tooltip>
          ))}
        </TooltipGroup>

        {/* The viewport band: how much of the article is on screen right now,
            and where. This is the "where am I" the whole rail exists for. */}
        <div
          ref={viewportBand}
          className="spine-viewport"
          /* `top` is deliberately absent — the scroll effect above owns it. */
          style={{ height: pct(viewportH) }}
        />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- the card ----
   What a band says when you hover it.

   The rail is proportional by design, which means most bands cannot hold their
   own label and the shortest sections are a couple of pixels tall. Everything
   the rail has to leave out is here: which part this section belongs to, what
   it says, what it subdivides into, and where it sits in the whole piece.

   navLabel appears here and only because this is navigation chrome — the spine
   is one of the two places the node shape sanctions it (granularity-zoom.md
   #node-shape). It is never a fallback for a missing gist in the reading view. */

/** Beyond this many sub-sections the list stops being scannable at a glance. */
const MAX_CHILDREN = 5;

/**
 * What a child row says — its nav label, or its title if it somehow has one.
 *
 * **This way round, and it is the fix for a bug that had been on screen since
 * the spine was written.** The list rendered `c.node.title`, and the children of
 * a hit are *depth-3 leaves*: `App.tsx` builds the outline three deep, `measure`
 * makes the hits the L2s, so a card's children are one node per paragraph. The
 * tree contract puts a heading title on a section and a `navLabel` on a leaf
 * (granularity-zoom.md § Node shape) — measured across all eight articles in
 * `data/`, that is **888 depth-3 nodes, 0 with a title, 0 with a gist, 853 with
 * a navLabel**. So every child row in every card was an empty bullet, and `+ 3
 * more` counted rows that said nothing. Nobody noticed because a bullet with no
 * text looks like a design, and no test rendered one — the fixtures give their
 * entries `children: []`. GPT Sol found the premise false while reviewing the
 * plan that was about to build a second blank line under each of them;
 * docs/plans/260828ay-spine-rail.md § 3.
 *
 * `navLabel` is allowed here for the reason it is allowed anywhere: this is
 * navigation chrome, and the spine is one of the two places the node shape
 * sanctions it. It is never standing in for prose the reader could be shown.
 */
function childLabel(e: OutlineEntry): string {
  return e.node.navLabel?.trim() || e.node.title?.trim() || "";
}

/**
 * What the band itself is called.
 *
 * **A section can have no title, and two of them do.** `revistes-ub-30977` has
 * two childless depth-2 nodes under its References — one with a `navLabel` and
 * one with neither — so the card rendered an empty `.tip-title` and `ariaFor`
 * gave both buttons the same accessible name as their parent. Two anonymous
 * bands next to each other, on a rail where the card is the only thing that can
 * say what you are about to press. GPT Sol found them in the corpus while
 * reviewing the built code, 2026-08-28.
 *
 * Same order as a child row — a real title, then navigation chrome — and then a
 * positional fallback, because *something* has to distinguish one untitled band
 * from the next. The fallback is deliberately built from the crumb the reader is
 * already being shown rather than from an id: `Section 2 of 4` under
 * `REFERENCES` reads as a place in the article, and `spya-k3m9qt` does not.
 */
function bandLabel(band: Band): string {
  const own = band.entry.node.title?.trim() || band.entry.node.navLabel?.trim();
  if (own) return own;
  return band.parent
    ? `Section ${band.parent.index + 1} of ${band.parent.total}`
    : "Untitled section";
}

/** The band's name for a screen reader, with the matches in it if there are any. */
function ariaFor(band: Band, matches: number): string {
  const name = band.parent
    ? `${band.parent.title} › ${bandLabel(band)}`
    : bandLabel(band);
  if (matches === 0) return name;
  return `${name} — ${matches} search ${matches === 1 ? "match" : "matches"}`;
}

function BandCard({
  band,
  position,
  matches,
  here = false,
  showTapHint = false,
}: {
  band: Band;
  position: number;
  matches: number;
  /** The reading line is inside this band — see `hereHit` in `Spine`. */
  here?: boolean;
  showTapHint?: boolean;
}) {
  const { node, words, children } = band.entry;
  const { parent } = band;
  /* Filtered before it is counted, so `+ n more` is a promise about rows the
     reader would actually get. Counting first and filtering second is how a
     card ends up saying "+ 3 more" and then showing three blank bullets. */
  const kids = children
    .map((c) => ({ id: c.node.id, label: childLabel(c) }))
    .filter((c) => c.label !== "");
  return (
    <>
      {parent && (
        <div className="tip-crumb">
          <span className="tip-crumb-name">{parent.title}</span>
          {/* **Where in the part, which is the one thing a proportional rail
              cannot show.** The rail says how far through the *article* you
              are; nothing on it says this is the third section of seven. One
              number pair, on a line that already exists, and it is skipped when
              the part has a single child because "1 of 1" is noise rather than
              orientation. */}
          {parent.total > 1 && (
            <span className="tip-crumb-pos">
              {parent.index + 1} of {parent.total}
            </span>
          )}
        </div>
      )}
      <div className="tip-title">
        {bandLabel(band)}
        {node.sourceHeading && <span className="tip-own">§</span>}
      </div>
      {/* The gist, or the nav label standing in for one — but never the nav
          label *twice*, which is what an untitled band would otherwise show:
          `bandLabel` has already used it as the title, and repeating it under
          itself in italics reads as a rendering fault. */}
      {node.gist ? (
        <p className="tip-gist">{node.gist}</p>
      ) : node.navLabel && node.title?.trim() ? (
        <p className="tip-gist tip-navlabel">{node.navLabel}</p>
      ) : null}
      {kids.length > 0 && (
        <ul className="tip-kids">
          {kids.slice(0, MAX_CHILDREN).map((c) => (
            <li key={c.id}>{c.label}</li>
          ))}
          {kids.length > MAX_CHILDREN && (
            <li className="tip-more">+ {kids.length - MAX_CHILDREN} more</li>
          )}
        </ul>
      )}
      <div className="tip-foot">
        {/* `words` is 0 for a band whose blocks carry no count, and a "0 words"
            is a fact about the pipeline rather than about the article. */}
        {words > 0 && <span>{words.toLocaleString()} words</span>}
        {/* Only when there are some. A "0 matches" on every band during a search
            would turn the whole rail into a wall of zeroes, and the absence of
            a mark already says it. */}
        {matches > 0 && (
          <span className="tip-matches">
            {matches} {matches === 1 ? "match" : "matches"}
          </span>
        )}
        <span>{position}% in</span>
        {/* **The difference between reading the card as *what is over there*
            and as *what I am in*.** On a 12px rail nothing else says it: the
            viewport band shows where the screen is, but the card is opened by a
            pointer that has gone somewhere else entirely, and at this width the
            two are a few pixels apart. */}
        {here && <span className="tip-here">you are here</span>}
      </div>
      {/* **Said out loud, because a tap that does nothing visible reads as a
          broken control.** On a touch device the first tap opens this card and
          does not move the article — which is the right behaviour on a rail of
          two-pixel bands, and is indistinguishable from a dead button unless
          the card says what the next tap will do. Never shown on a mouse, where
          one click has always jumped and always will. */}
      {showTapHint && <div className="tip-tap">Tap again to go here</div>}
    </>
  );
}
