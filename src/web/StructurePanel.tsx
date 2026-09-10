/**
 * **Structure mode's panel: the document's shape in two linked columns.**
 *
 * Column A is every part of the piece. Column B is the sections of the part the
 * reader is standing in, with the current one expanded. The second is always the
 * inside of the row marked in the first, which is the whole of what makes the
 * pair readable left to right — Miller columns, with the difference that neither
 * column ever scrolls.
 *
 * The projection is `src/web/structure.ts`; this file draws it and decides
 * nothing about what is current.
 *
 * ## What is here and what is stage 2
 *
 * Both columns, from the real projection, at a **fixed rung**. The measured
 * ladders that let each column spend its leftover height, the reserved-height
 * wells, and the row window on a short viewport are stage 2 of
 * docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md.
 * The mode is registered at stage 1 with two real columns rather than one,
 * because its Dock card describes two — a card that is false of the panel it
 * opens is read before pressing, and `?mode=structure` is deliberately reachable
 * by anyone. GPT Sol's review of the plan, finding 4.
 *
 * ## What it is not
 *
 * **Not a second tree.** It reads `buildSummaryTree`, which is what Outline
 * reads; Hierarchy goes through `buildGeometry`. Two projections, and **one
 * stored `article.tree`** underneath both — that is the contract AGENTS.md and
 * docs/project/granularity-zoom.md state, and a third view of one artefact is
 * not a divergence.
 *
 * **Only one of Structure's two faces.** Structure was added as a third mode on
 * 2026-09-06 so that Greg could flip between three views of one tree; on
 * 2026-09-10 it kept these columns where the band has room for them and took
 * Outline's nested list (`OutlinePanel`) where it does not, and Outline stopped
 * being a mode. So this panel is only mounted on a band wide enough for two
 * columns (StructureMode.tsx § `structureFace`), and always draws two tracks —
 * the stacked layout it used to fall back to is what Greg called "very
 * confusing".
 * src/web/modes/structure/StructureMode.tsx;
 * docs/plans/260910g-structure-mode-subsumes-outline.md.
 *
 * **No `.band-head`.** The documented default since 2026-09-05: the Dock at the
 * foot of the page is already saying which mode this is
 * (docs/project/new-mode.md § The band's chrome). Column B's header names the
 * *part*, which is a different fact and belongs to the column rather than to the
 * band.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import { ModeSurface } from "./ModeSurface.js";
import {
  type StructureColumn,
  type StructureProjection,
  type StructureRow,
  structureProjection,
  windowed,
} from "./structure.js";
import type { SummaryNode } from "./tree.js";

/**
 * The rungs stage 1 draws at.
 *
 * Fixed rather than measured, and named here so that stage 2 replaces one
 * constant with a measurement rather than restructuring the panel. `2` on both
 * sides is the pair that is useful without any height information at all: every
 * part, every section of the one you are in, and a sentence on each of the two
 * rows you are actually standing in. Climbing higher without measuring would
 * spend height the band may not have and overflow a panel that must not scroll.
 */
const STAGE_ONE_RUNG_A = 2 as const;
const STAGE_ONE_RUNG_B = 2 as const;

/**
 * How many rows each column has room for, or `null` while nothing has been
 * measured yet.
 *
 * `null` means *draw everything*, and that is the right answer for the state it
 * names: on the first paint, in a test with no layout, or in any environment
 * where the band reports no height, showing the whole level is honest and
 * showing none of it is not. The panel clips rather than scrolls, so an
 * unmeasured first frame can overflow for one frame — which it already did for
 * every frame before this existed.
 */
interface Capacity {
  a: number | null;
  b: number | null;
}

const UNMEASURED: Capacity = { a: null, b: null };

/**
 * Room for the two `Elided` counters a windowed column may draw.
 *
 * Reserved rather than measured because they are only drawn once the column is
 * *already* windowed: measuring them would need the answer they depend on. Two
 * rows of the column's own row height is the conservative reservation — the
 * counters are smaller than a row, so this errs toward showing one row fewer,
 * which clips nothing.
 */
const COUNTER_ROWS = 2;

/**
 * The measuring copies are never pressed, so they are handed a jump that does
 * nothing rather than the real one.
 *
 * A module constant, not a fresh arrow per render: the hidden rows are the
 * largest thing this panel builds, and a new function identity on every render
 * is a new prop on every one of them.
 */
const NO_JUMP = () => {};

/**
 * How many of these rows fit in `available` pixels, expanding outward from the
 * one the reader is in.
 *
 * Outward from the current row rather than from the top, because that is where
 * `windowed` centres: counting from the top would answer a question about a
 * different list. With no current row it counts from the head, which is what
 * `windowed` keeps in that case too — the two have to agree or the count and the
 * window describe different windows.
 *
 * Returns `null` when everything fits, which is `windowed`'s no-limit sentinel
 * and keeps a column that fits free of any counter.
 */
function capacityFrom(
  heights: readonly number[],
  rows: readonly StructureRow[],
  available: number,
  /**
   * The list's own `row-gap`, in px, measured off the rendered `<ol>`.
   *
   * **A row costs its height *plus* the gap above it, and leaving the gap out
   * was a real bug.** `offsetHeight` on an `<li>` excludes the flex gap between
   * it and its neighbour, so summing heights alone under-counts by `(n − 1) ×
   * gap` — 2px a row here, which is nothing on one row and 16px on nine. In
   * Chrome that clipped a section row by 17px on a 616px band, and clipped the
   * trailing "N later" counter at six of sixteen scroll positions on a 900px
   * one. The second is the worse half: the counter is the *honesty device*, so a
   * panel that clips it silently claims the list ended where the screen did.
   * Measured 2026-09-07.
   */
  gap: number,
  /**
   * The height of one `.struct-elided` counter, measured rather than guessed —
   * a real one is rendered in the measuring copy for exactly this.
   */
  counterH: number,
): number | null {
  if (heights.length === 0 || heights.length !== rows.length) return null;
  const total = heights.reduce((a, b) => a + b, 0) + Math.max(0, heights.length - 1) * gap;
  if (total <= available) return null;

  const centre = Math.max(
    0,
    rows.findIndex((r) => r.here),
  );
  const centreH = heights[centre] ?? 0;

  /**
   * **The counters are reserved at their own measured height, and the
   * reservation is never abandoned.**
   *
   * Two drafts got this wrong in opposite directions and a browser caught both.
   * Reserving two of the *tallest* row — the gisted current one, several lines —
   * ate the whole budget on a short band and drew four grey counters and no rows
   * at all. Reserving two of the *smallest row* fixed that everywhere except the
   * one part of the corpus with 1,119 sections, where **every** row is tall: the
   * smallest row was still ~340px, the reservation could not be afforded, and
   * the code then fell back to spending the whole of `available` on rows —
   * leaving the counters exactly nothing and clipping them, and eventually a
   * content row, mid-sentence. Column B over-drew its own budget by 52–64px in
   * Chrome while column A obeyed it to the pixel; that asymmetry is what
   * identified the fallback, since only column B ever had rows tall enough to
   * trigger it. Measured 2026-09-07.
   *
   * So the stand-in is gone: `counterH` is a real `.struct-elided` rendered in
   * the measuring copy, about one short italic line, and it is charged whether
   * or not it is comfortable. What gives instead is the number of rows, down to
   * one — the reader's own — which is the row that must survive. Only a band too
   * short for one row plus two counters can fail now, and that band cannot draw
   * anything meaningful anyway.
   */
  const budget = Math.max(centreH, available - COUNTER_ROWS * (counterH + gap));
  if (centreH > budget) return 0;

  let used = centreH;
  let lo = centre;
  let hi = centre;
  let kept = 1;
  /**
   * Growing outward from the reader, alternating while both sides still fit.
   *
   * **It does not stop at the first row that will not fit**, which the first
   * draft did — one tall row on one side ended the whole walk, and the panel
   * left 183px to 409px of band empty with sixteen parts behind a counter. Rows
   * differ in height by several lines, so "this one does not fit" says nothing
   * about the other direction.
   */
  for (;;) {
    const down = hi < rows.length - 1 ? (heights[hi + 1] ?? 0) : null;
    const up = lo > 0 ? (heights[lo - 1] ?? 0) : null;
    const canDown = down !== null && used + down + gap <= budget;
    const canUp = up !== null && used + up + gap <= budget;
    if (!canDown && !canUp) break;
    const takeDown = canDown && (!canUp || kept % 2 === 1);
    used += ((takeDown ? down : up) ?? 0) + gap;
    kept++;
    if (takeDown) hi++;
    else lo--;
  }
  return kept;
}

function Row({
  row,
  onJump,
}: {
  row: StructureRow;
  onJump(id: BlockId): void;
}) {
  const classes = ["struct-row", `struct-${row.kind}`];
  if (row.supplement) classes.push("struct-supp");
  if (row.before) classes.push("struct-read");

  return (
    <li>
      <button
        type="button"
        className={classes.join(" ")}
        /* `aria-current="true"` and not `"location"`: the mark says the reader is
           inside this row, which is a position in a document rather than a place
           in a set of navigation links. The same call `OutlinePanel` makes on its
           `now` row. Never set on a paragraph — structure.ts
           § `PARAGRAPH_IS_NEVER_CURRENT`. */
        {...(row.here ? { "aria-current": "true" as const } : {})}
        onClick={() => onJump(row.blockId)}
      >
        <span className="struct-line">
          {/* **Always rendered, empty on the apparatus**, which is what makes the
              gutter a gutter. It was omitted when the number was empty until
              2026-09-07, and the CSS beside it claimed the opposite: a supplement
              wears no number by design (structure.ts § `makeRow`), so its title
              hung a step to the left of the parts it sits after instead of
              lining up with them. Outline renders its empty span for the same
              reason. GPT Sol's code review, finding 5. */}
          <span className="struct-num">{row.number}</span>
          <span className="struct-text">{row.text}</span>
        </span>
        {row.gist ? <span className="struct-gist">{row.gist}</span> : null}
      </button>
    </li>
  );
}

/**
 * The rows a window left off, as a count.
 *
 * A `<li>` in the same list rather than a caption outside it, so that the shape
 * of the level stays whole: "12 earlier" is one of the level's rows, standing for
 * twelve of them, and lifting it out of the list would make the list claim to be
 * the level.
 *
 * Not a button. Pressing it would have to mean *scroll the column*, and this
 * panel does not scroll — the answer to a column that will not fit is a lower
 * rung, never a scrollbar.
 *
 * **Read aloud, not `aria-hidden`.** It was hidden in first draft, on the
 * grounds that it is a fact about the drawing rather than about the document.
 * That was true while nothing was ever windowed and false the moment something
 * was: a reader hearing four parts and no counter is being told this article has
 * four parts. The counter is the only thing that says the level is bigger than
 * what is on screen, so it is exactly the row a screen reader must not lose.
 */
function Elided({ n, where }: { n: number; where: "earlier" | "later" }) {
  if (n === 0) return null;
  return (
    <li className="struct-elided">
      {n} {where}
    </li>
  );
}

/**
 * One counter, rendered in the measuring copy so its height can be **measured
 * rather than stood in for**.
 *
 * It is the last child of each measuring list, which is why `heights()` drops
 * the last child. A real element and not a guess, because both guesses that came
 * before it were wrong in the browser and neither was visible to a test:
 * the tallest row over-reserved and drew nothing, the smallest row
 * under-reserved on a part whose rows are all tall. `capacityFrom` has both
 * stories.
 *
 * The digits are arbitrary — what varies with the number is not the height.
 */
function MeasuredCounter() {
  return <li className="struct-elided">0 later</li>;
}

function Column({
  column,
  label,
  onJump,
}: {
  column: StructureColumn;
  label: string;
  onJump(id: BlockId): void;
}) {
  return (
    <ol className="struct-col" aria-label={label}>
      <Elided n={column.earlier} where="earlier" />
      {column.rows.map((row) => (
        <Row key={row.id} row={row} onJump={onJump} />
      ))}
      <Elided n={column.later} where="later" />
    </ol>
  );
}

export function StructurePanel({
  root,
  focusRow,
  allowParagraphs,
  onJump,
  surfaceRef,
}: {
  root: SummaryNode | null;
  /**
   * Which row the reader is at — `LiveContext.focusRow`, the same sampler the
   * gist columns' context panels and Outline read, so the three views can never
   * disagree about which section is under the focus line. That agreement is not
   * a nicety: this mode exists to be flipped between the other two, and a second
   * answer to "where am I" would make the flip land somewhere else.
   *
   * **Section-granular**, always. See structure.ts
   * § `PARAGRAPH_IS_NEVER_CURRENT` for what that forbids.
   */
  focusRow: number;
  allowParagraphs: boolean;
  onJump(id: BlockId): void;
  /**
   * Handed the band's `<aside>`, so `StructureBand` can measure the band's width
   * and choose the face. A stable function (a state setter).
   */
  surfaceRef?: (el: HTMLElement | null) => void;
}) {
  /**
   * **Projected once, unwindowed.** The measuring copies below and the visible
   * columns are then built from these *same row objects*, so the list that was
   * measured and the list that is drawn cannot be different lists — which is
   * what re-running the projection with a limit would risk.
   */
  const proj: StructureProjection = structureProjection({
    root,
    focusRow,
    rungA: STAGE_ONE_RUNG_A,
    rungB: STAGE_ONE_RUNG_B,
    allowParagraphs,
  });

  const [cap, setCap] = useState<Capacity>(UNMEASURED);
  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const ofRef = useRef<HTMLParagraphElement>(null);

  /**
   * **Measure the full lists, hidden, and count how many rows fit.**
   *
   * The discipline is `OutlinePanel`'s and the reason is the same: the thing
   * being measured must not depend on the answer, or the measurement moves every
   * time the answer does and the panel oscillates. Here the hidden copies are
   * always the **whole** of each column, so a change of capacity cannot change
   * what was measured. `capacityFrom` then walks outward from the current row —
   * the row the window is centred on — adding real measured heights until the
   * budget runs out.
   *
   * Heights, never a row-count estimate. A row is one line or two depending on
   * its title and the column's width, and the gisted current row is several; a
   * constant "rows per band" would be wrong on the row that matters most.
   *
   * `clientHeight` on the grid, which excludes the band's padding but includes
   * nothing of its border — the trap `OutlinePanel` documents, where measuring
   * the padded box grants a candidate room it does not have.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads the rows only through the DOM it just rendered, and a new set of rows is exactly when the measured heights stop describing what is on screen. Same shape as OutlinePanel's `candidates` and useColumnContext's `layoutKey`.
  useLayoutEffect(() => {
    const measure = () => {
      const grid = gridRef.current;
      const box = measureRef.current;
      if (!grid || !box) return;
      const available = grid.clientHeight;
      /* Nothing laid out yet, or a jsdom-shaped environment where every height
         is 0. Leaving the capacity unmeasured draws the whole level, which is
         the honest answer to "we do not know how much fits". */
      if (available <= 0) return;

      const lists = box.querySelectorAll<HTMLElement>("[data-struct-measure]");
      const listFor = (which: string) =>
        [...lists].find((el) => el.dataset["structMeasure"] === which) ?? null;
      /* The measuring list's last child is a real counter, not a row — see the
         markup below and `capacityFrom`'s `counterH`. */
      const heights = (which: string): number[] => {
        const list = listFor(which);
        return list
          ? [...list.children].slice(0, -1).map((el) => (el as HTMLElement).offsetHeight)
          : [];
      };
      const counterHeight = (which: string): number => {
        const last = listFor(which)?.lastElementChild;
        return last ? (last as HTMLElement).offsetHeight : 0;
      };
      /* Read off the rendered list rather than restated from the stylesheet: the
         gap is a CSS value that a `@container` rule is free to change, and a
         constant here would be a second copy of it that nothing keeps in step. */
      const gapFor = (which: string): number => {
        const list = listFor(which);
        return list ? Number.parseFloat(getComputedStyle(list).rowGap) || 0 : 0;
      };

      /* Column B gives up the height its header takes; column A has none. */
      const headH = ofRef.current?.offsetHeight ?? 0;
      const hA = heights("a");
      const hB = heights("b");

      /**
       * **Always side by side, so each column gets the whole height.** Until
       * 2026-09-10 a narrow band stacked the two columns and this measured a
       * shared height for them; a narrow band now gets the list face instead
       * (StructureMode.tsx § `structureFace`), so this panel is only
       * mounted where there is room for two tracks, and the stacked branch —
       * with its own story of a 208–379px overflow, in this file's history —
       * went with the layout.
       *
       * **Ask each list where it actually starts.**
       *
       * `available − headH` was arithmetic, and arithmetic left things out: the
       * header's own bottom margin, and any sub-pixel rounding on a 181.5px
       * track. On the one part of the corpus with 1,119 sections — where the
       * header wraps to three lines and every row carries a full gist — that
       * over-committed by up to 56px and clipped the trailing "N later" counter,
       * which is the row that must never be the one to go: without it the panel
       * silently claims the sections stop where the screen does. Measured in
       * Chrome, 2026-09-07.
       *
       * A list's top is not circular even though its contents are windowed:
       * column A starts at the top of its column, and column B starts under a
       * header whose height depends on the part's title, not on how many rows
       * were kept.
       *
       * `:scope > .struct-side` deliberately excludes the measuring copies,
       * which are a direct child of the grid but are not a `.struct-side`.
       */
      const bottom = grid.getBoundingClientRect().bottom;
      const visible = grid.querySelectorAll<HTMLElement>(":scope > .struct-side .struct-col");
      const roomBelow = (el: HTMLElement | undefined): number | null =>
        el ? Math.max(0, Math.floor(bottom - el.getBoundingClientRect().top)) : null;

      const availA = roomBelow(visible[0]) ?? available;
      const availB = roomBelow(visible[1]) ?? Math.max(0, available - headH);

      const next: Capacity = {
        a: capacityFrom(hA, proj.columnA.rows, availA, gapFor("a"), counterHeight("a")),
        b: capacityFrom(hB, proj.columnB.rows, availB, gapFor("b"), counterHeight("b")),
      };
      setCap((prev) => (prev.a === next.a && prev.b === next.b ? prev : next));
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (gridRef.current) ro.observe(gridRef.current);
    /* Each measured list, not the box around them: a box that is `position:
       absolute` and out of flow reports a size of its own that has nothing to do
       with the rows inside it. */
    for (const child of Array.from(measureRef.current?.children ?? [])) ro.observe(child);
    return () => ro.disconnect();
  }, [proj.columnA.rows, proj.columnB.rows]);

  const columnA = windowed(proj.columnA.rows, cap.a);
  const columnB = windowed(proj.columnB.rows, cap.b);

  const nothing = proj.columnA.rows.length === 0;

  return (
    <ModeSurface label="Structure" feature="struct" {...(surfaceRef ? { ref: surfaceRef } : {})}>
      {nothing ? (
        /* **A sentence, not an error.** A piece with no parts is a real article
           — a short one the hierarchy stage put under a single root — so this
           says what is true of it rather than reporting a failure. */
        <p className="struct-empty">This piece has no parts to lay out — it is one run of prose.</p>
      ) : (
        <div className="struct-grid" ref={gridRef}>
          {/* **The measuring copies: the whole of each column, laid out and never
              seen.** `aria-hidden` and out of flow, so they cost the reader
              nothing and the accessibility tree nothing — but they are laid out
              at the real column width, because a measurement of different markup
              is a measurement of something else. Kept inside `.struct-side`
              wrappers for exactly that reason. */}
          <div className="struct-measure" ref={measureRef} aria-hidden="true">
            <div className="struct-side">
              <ol className="struct-col" data-struct-measure="a">
                {proj.columnA.rows.map((row) => (
                  <Row key={row.id} row={row} onJump={NO_JUMP} />
                ))}
                <MeasuredCounter />
              </ol>
            </div>
            <div className="struct-side struct-inner">
              <ol className="struct-col" data-struct-measure="b">
                {proj.columnB.rows.map((row) => (
                  <Row key={row.id} row={row} onJump={NO_JUMP} />
                ))}
                <MeasuredCounter />
              </ol>
            </div>
          </div>
          <div className="struct-side">
            <Column column={columnA} label="Parts" onJump={onJump} />
          </div>
          <div className="struct-side struct-inner">
            {/* **The bracket, and the whole of the connector in v1.** It names
                the row on the left that these rows are the inside of, and the
                marked row in column A carries the matching edge marker. A drawn
                taper between two independently measured columns needs geometry
                redrawn on every resize and every boundary crossing; this answers
                the same question — *these belong to that* — in CSS. */}
            {proj.ofPart ? (
              <p className="struct-of" ref={ofRef}>
                <span className="struct-num">{proj.ofPart.number}</span>
                <span className="struct-text">{proj.ofPart.text}</span>
              </p>
            ) : null}
            {columnB.rows.length > 0 || columnB.later > 0 ? (
              <Column column={columnB} label="Sections of this part" onJump={onJump} />
            ) : (
              /* **Two different nothings, and they must not read alike.** No
                 current part at all — the reader is above the first or past the
                 last — is a place they are, not a fault. A current part with no
                 sections is an article whose parts were not subdivided. Both are
                 ordinary; neither is an empty box. */
              <p className="struct-empty">
                {proj.ofPart
                  ? "This part is not divided into sections."
                  : "You are between parts."}
              </p>
            )}
            {/* The honest half of what a centred paragraph window would have
                claimed — structure.ts § `PARAGRAPH_IS_NEVER_CURRENT`. */}
            {proj.paragraphTotal !== null ? (
              <p className="struct-total">{proj.paragraphTotal} paragraphs</p>
            ) : null}
          </div>
        </div>
      )}
    </ModeSurface>
  );
}
