/**
 * **Skim's fourth chip, *Figures*: a walk through every figure, table and
 * medium in the article, in reading order.** Greg, 2026-10-10 (spya-sb0c7e):
 *
 * > I would quite like to be able to jump to all the tables and figures and
 * > media easily. … Use your judgment about how to add it to skim. Maybe it's a
 * > separate fourth submode.
 *
 * docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md § Half 1.
 *
 * **A second walk beside the route's, not a second kind of stop inside it.**
 * The route's controller (`useSkimMode`) is keyed on quotes throughout, so the
 * band chooses between two components on `?depth=` (SkimMode.tsx §
 * `useSkimParts`), and this one publishes the same `SkimControl` upward, so
 * `Reader`'s ← / → and the door in the prose work unchanged — the door only
 * says *figure* (`DoorView`'s `noun`). What the two must not disagree about is
 * in walk.ts.
 *
 * **It needs no route.** The figures are read off the article's own blocks
 * (src/figures.ts § `figuresOf`), so this draws its own band: an article whose
 * route is still being planned, or failed, or was never asked for, can still
 * walk its figures, and `useSkim` stays mounted above the choice so the route
 * goes on being planned underneath (Sol F3).
 *
 * **It publishes no passage.** A figure has no quote to ring; arriving
 * scrolls its block to the centre and flashes the whole of it
 * (`arriveAtBlock`). The route walk's layout cleanup has already cleared its
 * quote ring by the time this mounts (Sol F5).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryStates } from "nuqs";
import type { Block, BlockId, Tree } from "../../../types.js";
import { type Figure, figureName, FIGURE_NOUN } from "../../../figures.js";
import { blockIndex, sectionNodesOf } from "../../../section-path.js";
import { titleVoice } from "../../tree.js";
import { depthParam, type SkimPart, stopParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { positionsOf, type DepthChoice } from "../../skim-route.js";
import { FOLLOW_ATTR, useFollow } from "../../follow.js";
import { ModeSurface } from "../../ModeSurface.js";
import { TooltipGroup } from "../../Tooltip.js";
import { FIGURE_ICON } from "../../FigureMark.js";
import { type PlaceStep, PlacePath, partChoices, placeText, SkimHead, SkimParts, StopPosition } from "../../SkimPanel.js";
import { type Voice, voiceClass } from "../../voice.js";
import type { DoorView, SkimArrival, SkimControl } from "./SkimMode.js";
import { arriveAtBlock, takeArrival, useClaimedArrival, usePublishedControl } from "./walk.js";

/** What the band's (i) says while walking the figures. */
export const FIGURES_ABOUT =
  "Every figure, table and media item in the article, in the order it comes. Read off the article itself: no model chose them, and the captions are the author's.";

/** A figure's words on its row and under the door: its caption, else its name. */
function labelOf(figure: Figure): { text: string; voice: Voice } {
  return figure.caption ? { text: figure.caption, voice: "author" } : { text: figureName(figure), voice: "ui" };
}

/** One row of the figures' list. */
interface FigureRow {
  figure: Figure;
  n: number;
  place: readonly PlaceStep[] | null;
  position: number | null;
  current: boolean;
}

interface FiguresView {
  rows: FigureRow[];
  /** 1-based. */
  position: number;
  onStep(dir: -1 | 1): void;
  onRow(block: BlockId): void;
}

export function FiguresWalk({
  figures,
  depths,
  onPart,
  blocks,
  tree,
  covers,
  away,
  onAway,
  onJump,
  onControl,
  arrival,
}: {
  /** `figuresOf(blocks)`, never empty — the band draws this walk only when there are some. */
  figures: readonly Figure[];
  /** The route's passes, for their chips — `[]` while there is no route. */
  depths: readonly DepthChoice[];
  /** Switch to a pass: the band's `useSkimParts`. */
  onPart(part: SkimPart): void;
  blocks: Block[];
  tree: Tree;
  covers: boolean;
  away: boolean;
  onAway(): void;
  onJump(id: BlockId, passage?: string): void;
  onControl(control: SkimControl | null): void;
  arrival: SkimArrival;
}) {
  useRenderCount("FiguresWalk");
  const view = useFiguresWalk({ figures, blocks, tree, covers, onAway, onJump, onControl, arrival });
  const scroller = useRef<HTMLDivElement>(null);
  const currentId = view.rows.find((row) => row.current)?.figure.blockId ?? null;
  useFollow(scroller, currentId, [away]);
  return (
    <ModeSurface
      label="Skim"
      feature="gloss skim"
      mode="skim"
      about={<p>{FIGURES_ABOUT}</p>}
      head={
        <SkimHead
          noun="figure"
          position={view.position}
          positions={view.rows.map((r) => r.position)}
          onStep={view.onStep}
          /* `alone`: with no route yet, the one chip still says which walk this is. */
          parts={<SkimParts parts={partChoices(depths, figures.length)} chosen="figures" onPart={onPart} alone />}
        />
      }
    >
      <div className="tl-scroll" ref={scroller}>
        <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
          <ol className="skim-list">
            {view.rows.map((row, index) => {
              const place = row.place === null ? null : placeText(row.place);
              const above = view.rows[index - 1]?.place;
              const repeatedPlace = place !== null && above != null && place === placeText(above);
              const label = labelOf(row.figure);
              const Icon = FIGURE_ICON[row.figure.kind];
              return (
                <li
                  key={row.figure.blockId}
                  className={`skim-row skim-fig-row${row.current ? " current" : ""}`}
                  data-stop={row.figure.blockId}
                  {...{ [FOLLOW_ATTR]: row.figure.blockId }}
                >
                  <div className="skim-line">
                    <button
                      type="button"
                      className="skim-go"
                      aria-current={row.current ? "step" : undefined}
                      onClick={() => view.onRow(row.figure.blockId)}
                    >
                      <span className="skim-n">
                        {row.n}
                        {row.position !== null && <StopPosition at={row.position} current={row.current} />}
                      </span>
                      <span className="skim-what">
                        {repeatedPlace ? <span className="sr-only">{place}</span> : <PlacePath place={row.place} />}
                        <span className="skim-fig-label">
                          <Icon size={14} aria-hidden="true" className="skim-fig-icon" />
                          {/* The icon says the kind for the eye; a caption may not. */}
                          {row.figure.caption && (
                            <span className="sr-only">{FIGURE_NOUN[row.figure.kind]}: </span>
                          )}
                          <span className={`skim-fig-text ${voiceClass(label.voice)}`}>{label.text}</span>
                        </span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </TooltipGroup>
      </div>
    </ModeSurface>
  );
}

const NOOP = () => {};

function useFiguresWalk({
  figures,
  blocks,
  tree,
  covers,
  onAway,
  onJump,
  onControl,
  arrival,
}: {
  figures: readonly Figure[];
  blocks: Block[];
  tree: Tree;
  covers: boolean;
  onAway(): void;
  onJump(id: BlockId, passage?: string): void;
  onControl(control: SkimControl | null): void;
  arrival: SkimArrival;
}): FiguresView {
  const [asked, setAt] = useQueryStates({
    depth: depthParam,
    stop: stopParam,
  });

  /* **A `?stop=` naming no figure falls back to the first** — a quote's id
     left over from a pass, or a figure the article no longer has. */
  const found = figures.findIndex((f) => f.blockId === asked.stop);
  const at = found >= 0 ? found : 0;
  const current = figures[at] ?? null;

  /** A step: replaces `?stop=`, and arrives at the figure — the route's `goStep`. */
  const goTo = useCallback(
    (i: number): boolean => {
      const figure = figures[i];
      if (!figure) return false;
      void setAt({ depth: "figures", stop: figure.blockId }, { history: "replace" });
      arriveAtBlock(figure.blockId);
      return true;
    },
    [figures, setAt],
  );

  /* ← on the first figure goes to it again, as ← on stop 1 does
     (SPIDERYARN-READING2-4K); → at the last stays a no-op and hands the key back. */
  const step = useCallback(
    (dir: -1 | 1): boolean => (dir === -1 && at === 0 ? goTo(0) : goTo(at + dir)),
    [at, goTo],
  );
  const advance = useCallback(() => void step(1), [step]);

  /* The door's view, changing only when its words do (`SkimControl`). */
  const doorView = useMemo<DoorView>(() => {
    const next = figures[at + 1];
    if (!next) return { kind: "end", noun: "figure", pass: "the figures", count: figures.length, deeper: null };
    const label = labelOf(next);
    return { kind: "next", noun: "figure", cue: label.text, voice: label.voice };
  }, [figures, at]);

  /* ------------------------------------------------ published upward --
     The verbs through a ref, so the object is stable — SkimControl's rule. */
  const latest = useRef({ step, advance });
  latest.current = { step, advance };
  const stableStep = useCallback((dir: -1 | 1) => latest.current.step(dir), []);
  const stableAdvance = useCallback(() => latest.current.advance(), []);
  const block = current?.blockId ?? null;
  const control = useMemo<SkimControl | null>(
    () =>
      block === null
        ? null
        : {
            blockId: block,
            door: doorView,
            hasPrevious: at > 0,
            step: stableStep,
            advance: stableAdvance,
            /* Nothing is deeper than the figures. */
            deeper: NOOP,
          },
    [block, doorView, at, stableStep, stableAdvance],
  );
  usePublishedControl(control, onControl);

  /* **Arriving in the walk** — the route's rule (SkimMode.tsx § Arriving in
     the mode), for a block rather than a quote: a deep link, or a switch from
     a pass, is arrived at without a push; opening the mode is a jump. */
  const claimed = useClaimedArrival(arrival);
  useEffect(() => {
    if (block === null) return;
    const how = takeArrival(claimed.current);
    if (how === "link") arriveAtBlock(block);
    else if (how === "opening") onJump(block);
  }, [block, onJump, claimed]);

  /* ------------------------------------------------ the rows -- */
  const index = useMemo(() => blockIndex(blocks), [blocks]);
  const positions = useMemo(() => positionsOf(blocks), [blocks]);
  const rows = useMemo<FigureRow[]>(
    () =>
      figures.map((figure, i) => {
        const path = sectionNodesOf(figure.blockId, index, tree);
        return {
          figure,
          n: i + 1,
          place: path.length > 0 ? path.map((node) => ({ title: node.title, voice: titleVoice(node) })) : null,
          position: positions.get(figure.blockId) ?? null,
          current: i === at,
        };
      }),
    [figures, index, tree, positions, at],
  );

  /** A row press is a jump, as the route's is: one pushed entry, and on a narrow window the band steps aside. */
  const onRow = useCallback(
    (id: BlockId) => {
      void setAt({ depth: "figures", stop: id }, { history: "replace" });
      onJump(id);
      if (covers) onAway();
    },
    [setAt, onJump, covers, onAway],
  );
  const onStep = useCallback((dir: -1 | 1) => void step(dir), [step]);

  return { rows, position: at + 1, onStep, onRow };
}
