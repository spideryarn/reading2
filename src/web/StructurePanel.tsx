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
 * **Not a replacement for either of them.** Structure was added as a third mode
 * on 2026-09-06 so that Greg can flip between three views of one tree and find
 * out which is better; Hierarchy and Outline both stay, and it is behind the
 * experimental switch so that an ordinary reader's bar is unchanged while that
 * comparison runs.
 *
 * **No `.band-head`.** The documented default since 2026-09-05: the Dock at the
 * foot of the page is already saying which mode this is
 * (docs/project/new-mode.md § The band's chrome). Column B's header names the
 * *part*, which is a different fact and belongs to the column rather than to the
 * band.
 */
import type { BlockId } from "../types.js";
import { ModeSurface } from "./ModeSurface.js";
import {
  type StructureColumn,
  type StructureProjection,
  type StructureRow,
  structureProjection,
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
           § `PARAGRAPHS_HAVE_NO_CENTRE`. */
        {...(row.here ? { "aria-current": "true" as const } : {})}
        onClick={() => onJump(row.blockId)}
      >
        <span className="struct-line">
          {row.number ? <span className="struct-num">{row.number}</span> : null}
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
 */
function Elided({ n, where }: { n: number; where: "earlier" | "later" }) {
  if (n === 0) return null;
  return (
    <li className="struct-elided" aria-hidden="true">
      {n} {where}
    </li>
  );
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
   * § `PARAGRAPHS_HAVE_NO_CENTRE` for what that forbids.
   */
  focusRow: number;
  allowParagraphs: boolean;
  onJump(id: BlockId): void;
}) {
  const proj: StructureProjection = structureProjection({
    root,
    focusRow,
    rungA: STAGE_ONE_RUNG_A,
    rungB: STAGE_ONE_RUNG_B,
    allowParagraphs,
  });

  const nothing = proj.columnA.rows.length === 0;

  return (
    <ModeSurface label="Structure" feature="struct">
      {nothing ? (
        /* **A sentence, not an error.** A piece with no parts is a real article
           — a short one the hierarchy stage put under a single root — so this
           says what is true of it rather than reporting a failure. */
        <p className="struct-empty">This piece has no parts to lay out — it is one run of prose.</p>
      ) : (
        <div className="struct-grid">
          <div className="struct-side">
            <Column column={proj.columnA} label="Parts" onJump={onJump} />
          </div>
          <div className="struct-side struct-inner">
            {/* **The bracket, and the whole of the connector in v1.** It names
                the row on the left that these rows are the inside of. A drawn
                taper between two independently measured columns needs geometry
                redrawn on every resize and every boundary crossing; this answers
                the same question — *these belong to that* — in CSS. */}
            {proj.ofPart ? (
              <p className="struct-of">
                {proj.ofPart.number ? (
                  <span className="struct-num">{proj.ofPart.number}</span>
                ) : null}
                <span className="struct-text">{proj.ofPart.text}</span>
              </p>
            ) : null}
            {proj.columnB.rows.length > 0 ? (
              <Column column={proj.columnB} label="Sections of this part" onJump={onJump} />
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
                claimed — structure.ts § `PARAGRAPHS_HAVE_NO_CENTRE`. */}
            {proj.paragraphTotal !== null ? (
              <p className="struct-total">{proj.paragraphTotal} paragraphs</p>
            ) : null}
          </div>
        </div>
      )}
    </ModeSurface>
  );
}
