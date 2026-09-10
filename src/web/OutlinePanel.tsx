/**
 * **Structure mode's list face** — the whole document as one nested list that
 * never scrolls. It was Outline mode, 2026-08-28 to 2026-09-10; it is now what
 * `StructureBand` draws when the band is too narrow for Structure's two columns
 * (src/web/modes/structure/StructureMode.tsx § `structureFace`), and the
 * names here — this file, `outline.ts`, `.outln-*` — are the ones it had.
 * docs/plans/260910g-structure-mode-subsumes-outline.md.
 *
 * The list is built by `outlineProjection` (src/web/outline.ts), which is pure
 * and decides both what is drawn and which row is current. This file does the
 * two things that need a DOM: **choosing which rung fits**, and the keyboard.
 *
 * docs/plans/260828aw-outline-mode.md has the intent, the ladder, and the reasoning.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import {
  outlineProjection,
  RUNGS,
  type OutlineRow,
  type Rung,
} from "./outline.js";
import type { ArcCell, SummaryNode } from "./tree.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import type { NodeId, TreeNode } from "../types.js";
import { onFontsChanged } from "./fonts.js";
import { ModeSurface } from "./ModeSurface.js";

interface Props {
  /** The tree, nested and numbered. Null if it is unusable. */
  root: SummaryNode | null;
  supplementOf: ReadonlyMap<NodeId, TreeNode>;
  /** The arc, keyed by the row each part starts on. Null until stage 5b has run. */
  arcByRow: Map<number, ArcCell> | null;
  /**
   * Where the reader is — `LiveContext.focusRow`, **section-granular**.
   *
   * Worth knowing before you use it for anything finer: both of the page's
   * answers to "where is the reader" stop at the section. `?at=` stores a
   * section's first block (position.ts § sectionDepth), and `focusRow` is
   * `sections[activeSectionIndex(...)].row` (useColumnContext.ts). So no
   * paragraph is ever marked current here — see `PARAGRAPHS_ARE_NEVER_CURRENT`
   * in outline.ts for why that is honesty rather than a missing feature.
   */
  focusRow: number;
  /**
   * False where the band covers the prose instead of sitting beside it — below
   * `MODE_MIN + MODE_PROSE_FLOOR` in layout.ts (700px), which since 2026-09-06 is
   * narrower than a phone in landscape rather than wider than one. Paragraph rows
   * are navigation chrome justified by the prose being visible next to them, so
   * where it is not, they are the substitution principle 1 forbids.
   */
  proseBeside: boolean;
  /**
   * **Are there paragraph labels to draw** — `paragraphLabelsReady` in
   * nav-labels.ts, off `Article.navLabelStatus`.
   *
   * False while a labels run is owed or has failed, and then rung 5 is not a
   * candidate at all. It is a second gate beside `proseBeside` rather than a
   * widening of it because the two refuse for unrelated reasons — one is about
   * the window, the other about the article — and a single boolean would make
   * the next reader guess which.
   *
   * Without it the rung draws whatever labels happen to exist and silently
   * omits the rest (`rowText` returns null and the row is not drawn), so a
   * section of eight paragraphs comes out as two: our unfinished work rendered
   * as the article's own shape. nav-labels.ts § why withhold.
   */
  paragraphLabels: boolean;
  onJump(id: BlockId): void;
  /**
   * Handed the band's `<aside>` as well as this panel's own ref, so
   * `StructureBand` can measure the band's width and choose the face. A stable
   * function (a state setter), so the merged ref below does not detach and
   * re-attach on every render.
   */
  surfaceRef?: (el: HTMLElement | null) => void;
}

export function OutlinePanel({
  root,
  supplementOf,
  arcByRow,
  focusRow,
  proseBeside,
  paragraphLabels,
  onJump,
  surfaceRef,
}: Props) {
  const panelRef = useRef<HTMLElement | null>(null);
  const bandRef = useCallback(
    (el: HTMLElement | null) => {
      panelRef.current = el;
      surfaceRef?.(el);
    },
    [surfaceRef],
  );
  const measureRef = useRef<HTMLDivElement>(null);
  /**
   * **What the fit chose: a rung, and whether its titles are cut to one line.**
   *
   * Titles wrap since 2026-09-10 (outline-mode.css § `.outln-text`), which is
   * the whole of Greg's 2Q. That broke one promise the ladder made — rung 1,
   * "every part, one line each — if this will not fit, nothing will" — because
   * a whole title can be three lines, and a band that held every part at one
   * line each may not hold them at three. The panel does not scroll, so an
   * over-tall rung 1 would silently drop the last parts off the foot. GPT Sol's
   * review of the plan, P1-2.
   *
   * So the one-line clamp stays, as the **floor**: every rung is measured both
   * whole and clamped, a whole-title rung that fits always beats a clamped one
   * (whole titles over more detail — the trade 2Q asked for), and the clamped
   * set is only reached when not even rung 1 fits whole. Then the reader gets
   * exactly what they had before 2026-09-10, which is the list that fitted.
   */
  const [fit, setFit] = useState<{ rung: Rung; clamp: boolean }>({ rung: 1, clamp: false });
  const rung = fit.rung;

  /**
   * Every candidate, always built. Cheap — a few hundred objects — and building
   * all five is what lets the fit be *measured* rather than estimated.
   */
  /**
   * Whether the band is covering the article rather than sitting beside it,
   * **measured rather than derived from a width.**
   *
   * `proseBeside` comes from `fit.modeW > 0`, and GPT Sol found on 2026-08-28
   * that it was exact only while the spine is on: the stylesheet made every
   * band full-screen with a literal `@media (max-width: 843px)`, while
   * `fitMode` compares against `windowWidth - spineWidth`. With `?spine=0`
   * those disagreed from 832px to 843px, and in that window the panel would
   * draw paragraph rows over a hidden article.
   *
   * **That disagreement was fixed at the source on 2026-09-03** — the
   * stylesheet keys off `.band-covers`, written by App.tsx from the same
   * `fit.modeW`, so the two halves cannot part again (styles.css § a band with
   * no room, tests/spine-width.test.ts). This measurement stays anyway, and not
   * out of inertia: rather than copy any breakpoint into a third place, it asks
   * the rendered band whether it spans the viewport, which is immune to the
   * constant moving, to the spine being toggled, and to whatever the next
   * full-screen rule turns out to be keyed on.
   */
  const [covers, setCovers] = useState(false);
  const beside = proseBeside && !covers;

  /**
   * **Two independent refusals, and they stay two words.** `beside` is about
   * the window — paragraph rows are navigation chrome, justified only while the
   * prose is on screen next to them. `paragraphLabels` is about the article —
   * whether there are labels to draw at all (nav-labels.ts). Folding them into
   * one name would leave the next reader unable to tell which one said no.
   */
  const allowParagraphs = beside && paragraphLabels;

  const candidates = useMemo(
    () =>
      RUNGS.map((r) =>
        outlineProjection({
          root,
          supplementOf,
          arcByRow,
          focusRow,
          rung: r,
          allowParagraphs,
        }),
      ),
    [root, supplementOf, arcByRow, focusRow, allowParagraphs],
  );

  /**
   * **Measure, do not estimate.** The precedent in column-context.md estimated
   * a line budget from character counts and recorded GPT's dissent; the trade
   * inverts here and Sol's review of this plan said so. There it was five
   * hidden renders for each of three panels and a bad guess left a column
   * slightly blank. Here it is five for one panel, and a bad guess pushes rows
   * off a panel that cannot be scrolled. An estimator's own `data-outline-rung`
   * can only ever prove what the estimator chose — the silent-success pattern
   * exactly (docs/reusable/silent-success.md).
   *
   * No measure-resize-measure loop: the hidden candidates do not depend on
   * `rung`, so choosing one never changes what is being measured.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads `candidates` only through the DOM it rendered, and a new set of candidates is exactly when the measured heights stop describing what is on screen. Same shape as useColumnContext's `layoutKey`.
  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      const box = measureRef.current;
      if (!panel || !box) return;
      /* **`clientHeight` includes the padding, and the list cannot use it.**
         The panel is padded at the top, so a candidate measured against the
         raw `clientHeight` is granted room it does not have and is clipped at
         the foot — a direct breach of the one promise this mode makes. Found
         by GPT Sol reviewing the built code, 2026-08-28. Read from the
         computed style rather than from the `--outln-pad-*` values, so the two
         cannot drift. */
      /* **The RIGHT EDGE, not the width.** The first version of this asked
         whether the band was as wide as the viewport, and it could never have
         been true: the band starts at the rail's right edge, so with the spine
         on it is always narrower than the window by the rail. Measured in a
         browser at the breakpoint, 2026-08-28 — at 843px the band's rect is
         [12, 843], width 831 against an innerWidth of 843, so a width test
         with any sane tolerance says "beside" while the band is sitting
         squarely on top of the article. It would have done nothing, quietly,
         which is the failure this check exists to prevent.

         Where the band sits beside the prose its right edge is a long way from
         the window's (at 844px: 300 against 844). Where it covers, the two
         meet. A few pixels of tolerance for a scrollbar or a safe-area inset.
         Set before the height work, so a change here re-runs the whole
         measurement through `candidates`. */
      setCovers(panel.getBoundingClientRect().right >= window.innerWidth - 8);

      const pad = getComputedStyle(panel);
      const avail =
        panel.clientHeight -
        (Number.parseFloat(pad.paddingTop) || 0) -
        (Number.parseFloat(pad.paddingBottom) || 0);
      /* Nothing to measure against yet — a band with no laid-out height would
         make every candidate "not fit" and pin the rung at 1 for ever. Leave
         it alone and wait for the observer. */
      if (avail <= 0) return;

      /* **Ties go to the LOWER rung**, and that is not a detail. When the
         section is over the paragraph cap, or paragraphs are not permitted at
         all, candidate 5 is identical to candidate 4 — so taking the highest
         fitting number would report `data-outline-rung="5"` for a list with no
         paragraphs in it. The attribute exists to be read in a browser as
         evidence of what the fit chose; a diagnostic that overstates how far
         down the ladder it got is worse than none.

         **Whole titles first, then clamped** — `fit` above says why. One pass
         per set; the clamped set is only asked when the whole set had nothing
         that fits, and if neither has, it is clamped rung 1, the old floor. */
      const bestOf = (clamp: boolean): Rung | null => {
        let best: Rung | null = null;
        let bestHeight = -1;
        for (const child of Array.from(box.children)) {
          const el = child as HTMLElement;
          if ((el.dataset.clamp === "1") !== clamp) continue;
          const r = Number(el.dataset.rung) as Rung;
          const h = el.scrollHeight;
          if (h <= avail && h > bestHeight) {
            best = r;
            bestHeight = h;
          }
        }
        return best;
      };
      const whole = bestOf(false);
      const next = whole !== null ? { rung: whole, clamp: false } : { rung: bestOf(true) ?? 1, clamp: true };
      setFit((prev) => (prev.rung === next.rung && prev.clamp === next.clamp ? prev : next));
    };
    measure();

    const ro = new ResizeObserver(measure);
    /* The panel, because the window can change height with no scroll — the
       reflow-with-no-scroll case column-context.md had to add two observers
       for. */
    if (panelRef.current) ro.observe(panelRef.current);
    /* **Each candidate list, NOT the `.outln-measure` box around them.** The
       box is `height: 0` so that it takes no space, which means its own border
       box never changes size however tall its contents grow: observing it
       would report nothing, for ever, while looking like a working observer.
       The `<ol>`s inside it do change size, so they are what is watched. Found
       by GPT Sol, 2026-08-28 — the previous comment here claimed the box
       caught font swaps and it could not have. */
    for (const child of Array.from(measureRef.current?.children ?? [])) {
      ro.observe(child);
    }
    /* Font changes as well, because a swap that changes each row's height while
       leaving a list's total identical would get past even that. The event
       rather than `fonts.ready` — see fonts.ts for what that getter cost. */
    const offFonts = onFontsChanged(measure);
    return () => {
      ro.disconnect();
      offFonts();
    };
  }, [candidates]);

  const chosen = candidates[rung - 1] ?? candidates[0];
  const rows = chosen?.rows ?? [];

  /**
   * Roving focus over one tab stop — the pattern Diagram mode already uses
   * (docs/project/diagram.md § Interaction) rather than a second invention. A
   * row per tab stop would put forty stops in front of the prose; no stops at
   * all would make the whole of a mode unreachable.
   *
   * **Held as a node id and the index derived, rather than an index kept in
   * sync by an effect.** The effect version had a bug that only appears where
   * two of this feature's decisions meet: a paragraph row is never `now`
   * (nothing on the page knows which paragraph the reader is on), so arrowing
   * onto a paragraph in a *different* section changed `focusRow`, re-ran the
   * effect, and snapped focus **backwards** onto that section's own row — the
   * reader could not arrow past a section boundary into its paragraphs. Derived
   * state has nothing to re-run and cannot yank the focus anywhere.
   *
   * A focused row that stops being drawn — its branch collapsed as the reader
   * moved on — falls back to the row they are in, which is the only sensible
   * place left to be.
   */
  const [focusedId, setFocusedId] = useState<NodeId | null>(null);
  const kept = focusedId ? rows.findIndex((r) => r.node.id === focusedId) : -1;
  const focused = kept >= 0 ? kept : Math.max(0, rows.findIndex((r) => r.now));

  /**
   * Forget a focused row that has stopped being drawn.
   *
   * The fallback above already sends focus to the row the reader is in, so
   * without this the list *looks* right — but the id is still held, and when
   * that row comes back (the window grows, or the reader returns to the
   * section) it silently steals the focus again from wherever the reader had
   * moved it. GPT Sol, 2026-08-28, with the five-step sequence.
   *
   * It only ever clears, never assigns, so it cannot reintroduce the yank the
   * derived state was written to remove.
   */
  useLayoutEffect(() => {
    if (focusedId !== null && kept < 0) setFocusedId(null);
  }, [focusedId, kept]);

  const jump = useCallback(
    (row: OutlineRow | undefined) => {
      if (row) onJump(row.blockId);
    },
    [onJump],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const step = (to: number) => {
      e.preventDefault();
      const i = Math.max(0, Math.min(rows.length - 1, to));
      setFocusedId(rows[i]?.node.id ?? null);
      jump(rows[i]);
    };
    switch (e.key) {
      case "ArrowDown":
        return step(focused + 1);
      case "ArrowUp":
        return step(focused - 1);
      case "Home":
        return step(0);
      case "End":
        return step(rows.length - 1);
      case "Enter":
      case " ":
        e.preventDefault();
        return jump(rows[focused]);
    }
  };

  const rowId = (r: OutlineRow) => `outln-${r.node.id}`;

  return (
    <ModeSurface
      feature="outln"
      /* The mode's name, which is what a screen reader should hear: since
         2026-09-10 this is Structure's narrow face, and "Outline" names a mode
         that is not on the Dock any more. */
      label="Structure"
      /* **The band Outline measures**, so the ref goes to the surface's own
         `ref` prop and lands on the same `<aside>` it always did — merged with
         `StructureBand`'s, which measures the same element's width. */
      ref={bandRef}
      /* Evidence about the decision, never about the fit — a browser session
         can read which rung was chosen. Reaches the element through the
         surface's `{...rest}` passthrough, which exists for this attribute.
         **Whether the chosen list actually fits is NOT asserted anywhere in
         the test suite**, and this comment used to say it was, contradicting
         that test file's own preamble. jsdom does no layout, so
         `scrollHeight <= clientHeight` reads `0 <= 0` there and passes on any
         code at all. It needs a browser. docs/project/browser-testing.md. */
      data-outline-rung={rung}
      /* And whether the titles had to be cut to fit — `fit` above. */
      data-outline-clamp={fit.clamp ? "1" : "0"}
    >
      <TooltipGroup delay={{ open: 150, close: 90 }} timeoutMs={400}>
        <ol
          className={listClass(fit.clamp)}
          /* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: `role="tree"` on a real <ol> is the W3C tree-view pattern — the list IS the widget, owning the single tab stop and the arrow keys. Swapping in a <div> to satisfy the rule would throw away the list semantics for any AT that ignores the role. */
          role="tree"
          aria-label="The article's structure"
          tabIndex={0}
          aria-activedescendant={rows[focused] ? rowId(rows[focused]!) : undefined}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, i) => (
            <Row
              key={row.node.id}
              row={row}
              id={rowId(row)}
              focused={i === focused}
              onJump={() => jump(row)}
            />
          ))}
        </ol>
      </TooltipGroup>

      {/* The candidates, measured and never seen. `aria-hidden` and out of the
          tab order, so a screen reader meets the list once.

          **Same element, same classes, same width as the real list** — an
          `<ol class="outln-list">` of `<li class="outln-row …">`, because a
          measurement of different markup is a measurement of something else.
          That is the whole point of measuring rather than estimating, and it
          would be quietly undone by a measuring copy that merely looked alike.

          Each rung twice — titles whole, then titles clamped — because the fit
          chooses between both sets (`fit` above), and the clamped rows are a
          different height. */}
      <div className="outln-measure" aria-hidden="true" ref={measureRef}>
        {[false, true].flatMap((clamp) =>
          candidates.map((c) => (
            <ol
              className={listClass(clamp)}
              key={`${c.rung}-${clamp ? "clamp" : "whole"}`}
              data-rung={c.rung}
              data-clamp={clamp ? "1" : "0"}
            >
              {c.rows.map((row) => (
                <li key={row.node.id} className={rowClass(row, false)}>
                  <RowBody row={row} />
                </li>
              ))}
            </ol>
          )),
        )}
      </div>
    </ModeSurface>
  );
}

/**
 * One row.
 *
 * **The tooltip is uncontrolled, and that is load-bearing.** The spine's cards
 * stopped working for a day because fifty triggers were made controlled off one
 * shared piece of state: `useDelayGroup` closes every *other* member the moment
 * one opens, and `useHover` schedules a departing trigger's close without
 * checking whether it is still the open one. Both are correct against a tooltip
 * that owns its own state. docs/postmortems/260828g-spine-hover-cards.md.
 */
function Row({
  row,
  id,
  focused,
  onJump,
}: {
  row: OutlineRow;
  id: string;
  focused: boolean;
  onJump(): void;
}) {
  return (
    <Tooltip
      placement="right"
      keepSide
      content={
        <div className="outln-card">
          <div className="outln-card-crumb">{row.number}</div>
          <div className="outln-card-title">{row.text}</div>
          {row.node.gist ? <p className="outln-card-gist">{row.node.gist}</p> : null}
        </div>
      }
    >
      {/* biome-ignore lint/a11y/useFocusableInteractive: a `treeitem` in the W3C pattern is deliberately NOT focusable — the tree owns one tab stop and moves a roving `aria-activedescendant` over its items, which is the whole point (forty tab stops in front of the prose is the alternative). DiagramPanel.tsx makes the same call. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is on the tree, not the item — Enter and Space on the <ol> activate whatever `aria-activedescendant` names, which is where the pattern puts it. */}
      <li
        id={id}
        role="treeitem"
        aria-level={row.level}
        aria-current={row.now ? "location" : undefined}
        aria-selected={focused}
        className={rowClass(row, focused)}
        onClick={onJump}
      >
        <RowBody row={row} />
      </li>
    </Tooltip>
  );
}

/**
 * The list's classes, written once for the same reason as `rowClass` below:
 * the visible list and the candidate it was measured as must be the same markup.
 */
function listClass(clamp: boolean): string {
  return clamp ? "outln-list clamp" : "outln-list";
}

/**
 * A row's classes, written once so the visible list and the measured candidates
 * cannot drift. If these two ever disagree the panel measures one thing and
 * draws another, and nothing errors.
 */
function rowClass(row: OutlineRow, focused: boolean): string {
  return [
    "outln-row",
    `lvl-${row.level}`,
    `tier-${row.tier}`,
    row.here ? "here" : "",
    row.now ? "now" : "",
    row.before ? "read" : "",
    row.supplement ? "supplement" : "",
    focused ? "focused" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The row's content, shared with the hidden candidates so both measure alike. */
function RowBody({ row }: { row: OutlineRow }) {
  return (
    <>
      <span className="outln-num">{row.number}</span>
      <span className="outln-text">{row.text}</span>
      {row.arc ? <p className="outln-arc">{row.arc}</p> : null}
      {row.sentence ? <p className="outln-gist">{row.sentence}</p> : null}
    </>
  );
}
