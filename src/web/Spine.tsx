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
 * rail is always the 1.5rem strip of bands, ticks and marks. What a band is
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
  laneOrder,
  spineMarks,
  type Row,
} from "./spine-marks.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";

interface Band {
  entry: OutlineEntry;
  /** Offsets in document pixels, relative to the top of the first row. */
  top: number;
  height: number;
  /** For an L2, the title of the L1 it belongs to. */
  // `| undefined` explicitly: bandFor passes the argument through whether or
  // not the caller supplied one, and a top-level band genuinely has no parent.
  parentTitle?: string | undefined;
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
 */
function measure(outline: OutlineEntry[]): Metrics | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("tbody tr[data-block]"),
  );
  if (rows.length === 0) return null;

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

  const bandFor = (e: OutlineEntry, parentTitle?: string): Band => ({
    entry: e,
    top: edge(e.startRow) - docTop,
    height: Math.max(0, edge(e.endRow + 1) - edge(e.startRow)),
    parentTitle,
  });

  // L2s are rendered as siblings in the same track rather than nested inside
  // their parent's element, so every band shares one coordinate system and
  // there is no relative-offset arithmetic to get wrong.
  return {
    docTop,
    docHeight,
    l1: outline.map((e) => bandFor(e)),
    l2: outline.flatMap((e) => e.children.map((c) => bandFor(c, e.node.title))),
    // Hit targets must tile the whole rail, or a stretch of the article has no
    // tooltip and nothing to click. L2s partition their parent, so they cover
    // it exactly — *unless* a part has no children at all, and then the part
    // itself stands in for them.
    hits: outline.flatMap((e) =>
      e.children.length > 0
        ? e.children.map((c) => bandFor(c, e.node.title))
        : [bandFor(e)],
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

export function Spine({ outline, layoutKey, matches = NO_MATCHES, onJump }: Props) {
  useRenderCount("Spine");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  /* The you-are-here band. State, because it changes what is *drawn* — but set
     only when the band actually changes, which is a handful of times per
     article rather than once per frame. See the scroll effect below. */
  const [here, setHere] = useState<Band | null>(null);
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
    document.fonts?.ready.then(run).catch(() => {});

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", run);
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
   * React does not clobber the imperative `top`: the element's `style` prop
   * never contains it, so the diff has nothing to say about it.
   *
   * Depends on `metrics` and `viewportH` rather than reading them from refs.
   * Both change rarely (a resize, a font swap), so re-subscribing then is
   * cheaper than the indirection — and it keeps the closure's values honest.
   */
  useEffect(() => {
    if (!metrics) return;
    const { docTop, docHeight, l1 } = metrics;
    let raf = 0;
    /* A local mirror of `here`'s identity. Comparing against the state value
       would need it in the dependency list, which would re-subscribe the
       listener every time the reader crossed a boundary. */
    let hereId: string | null = null;

    const apply = () => {
      raf = 0;
      const sy = window.scrollY;

      const band = viewportBand.current;
      if (band) band.style.top = `${((sy - docTop) / docHeight) * 100}%`;

      const pos = sy + viewportH * READING_LINE - docTop;
      const inBand = (b: Band) => pos >= b.top && pos < b.top + b.height;
      const last = l1[l1.length - 1] ?? null;
      const next = l1.find(inBand) ?? (pos >= 0 ? last : (l1[0] ?? null));
      const id = next?.entry.node.id ?? null;
      if (id !== hereId) {
        hereId = id;
        setHere(next);
      }
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
         parts as bands and marks the current one, so ↑ / ↓ over it step part by
         part. Its click targets are L2 — finer than its
         bands, because a 1px tick is unhittable — but that is a pointing
         concession, not what the rail is *about*. See keynav.ts. */
      data-nav-depth={1}
    >
      <div className="spine-track">
        {metrics.l1.map((b) => {
          const active = b.entry.node.id === here?.entry.node.id;
          return (
            <div
              key={b.entry.node.id}
              className={`spine-part${active ? " active" : ""}`}
              style={{ top: pct(b.top), height: pct(b.height) }}
            />
          );
        })}

        {/* Subdivision is always drawn, so the shape of the article is visible
            even where there is no room for a word of it. */}
        {metrics.l2.map((b) => (
          <div
            key={`tick-${b.entry.node.id}`}
            className="spine-tick"
            style={{ top: pct(b.top) }}
          />
        ))}

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
                style={
                  {
                    top: pct(m.top),
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
              content={
                <BandCard
                  band={b}
                  position={Math.round((b.top / docHeight) * 100)}
                  matches={bandCounts.get(b.entry.node.id) ?? 0}
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
                onClick={() => onJump(b.entry.node.range[0])}
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

/** The band's name for a screen reader, with the matches in it if there are any. */
function ariaFor(band: Band, matches: number): string {
  const name = band.parentTitle
    ? `${band.parentTitle} › ${band.entry.node.title}`
    : band.entry.node.title;
  if (matches === 0) return name;
  return `${name} — ${matches} search ${matches === 1 ? "match" : "matches"}`;
}

function BandCard({
  band,
  position,
  matches,
}: { band: Band; position: number; matches: number }) {
  const { node, words, children } = band.entry;
  return (
    <>
      {band.parentTitle && <div className="tip-crumb">{band.parentTitle}</div>}
      <div className="tip-title">
        {node.title}
        {node.sourceHeading && <span className="tip-own">§</span>}
      </div>
      {node.gist ? (
        <p className="tip-gist">{node.gist}</p>
      ) : node.navLabel ? (
        <p className="tip-gist tip-navlabel">{node.navLabel}</p>
      ) : null}
      {children.length > 0 && (
        <ul className="tip-kids">
          {children.slice(0, MAX_CHILDREN).map((c) => (
            <li key={c.node.id}>{c.node.title}</li>
          ))}
          {children.length > MAX_CHILDREN && (
            <li className="tip-more">
              + {children.length - MAX_CHILDREN} more
            </li>
          )}
        </ul>
      )}
      <div className="tip-foot">
        <span>{words.toLocaleString()} words</span>
        {/* Only when there are some. A "0 matches" on every band during a search
            would turn the whole rail into a wall of zeroes, and the absence of
            a mark already says it. */}
        {matches > 0 && (
          <span className="tip-matches">
            {matches} {matches === 1 ? "match" : "matches"}
          </span>
        )}
        <span>{position}% in</span>
      </div>
    </>
  );
}
