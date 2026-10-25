/**
 * **Structure mode's controller.** The tree it draws, where the reader is
 * standing in it, and **which of its two faces fits the band**.
 *
 * The shape `IdeasMode.tsx` established and the other ten follow: the mode's
 * controller lives in `src/web/modes/<feature>/`, the panel it renders stays at
 * `src/web/`, and `Reader` stops knowing what is inside either.
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **Two faces since 2026-09-10.** Where the band has room, Structure's own two
 * linked columns (`StructurePanel`); where it does not, the nested list that was
 * Outline mode (`OutlinePanel`), which stopped being a mode of its own the same
 * day. Greg, 2026-09-08:
 *
 * > if the page is wide, show the current Structure 2-column mode. If it's
 * > narrower, show the current Outline mode. And get rid of Outline mode
 * > altogether (because it will have been subsumed by Structure mode).
 *
 * docs/plans/260910g-structure-mode-subsumes-outline.md.
 *
 * **Owner and visitor get the same component, because there is nothing to
 * own** — the same position Summary is in. Nothing here is fetched: the tree
 * arrives in the page's own payload, so a visitor gets the whole of the mode
 * (src/web/visitor.ts § `POLICY`).
 *
 * **One exception since 2026-10-05, and it is why the band is told `owner`.**
 * On a tree built from the author's headings because the model's could not be
 * made, the head row says so, and the owner is offered another go
 * (StructureNotice.tsx). The visitor gets the sentence and no press.
 */

import { useQueryState } from "nuqs";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { figuresOf } from "../../../figures.js";
import type { Article, BlockId, NodeId, TreeNode } from "../../../types.js";
import { paragraphLabelsReady } from "../../nav-labels.js";
import { OutlinePanel } from "../../OutlinePanel.js";
import { STRUCTURE_VIEWS, type StructureView, structureParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { StructureNotice } from "../../StructureNotice.js";
import { StructurePanel } from "../../StructurePanel.js";
import { StructureArriving, type StructureArrival } from "./StructureArriving.js";
import { STRUCTURE_SUB_MODES } from "../../sub-modes.js";
import { shownBehindTheSwitch } from "../../experimental-visibility.js";
import { scrollToBlock } from "../../scroll.js";
import { ControlTip, Tooltip, TooltipGroup } from "../../Tooltip.js";
import { structureColumnsBand } from "../../layout.js";
import { type ArcCell, buildSummaryTree } from "../../tree.js";
import { useColumnContext } from "../../useColumnContext.js";
import { mastheadEcho } from "../../masthead-echo.js";
import { matterStretches } from "../../matter-view.js";
import { useRevealChosen } from "../../useRevealChosen.js";
import type { Section } from "../../position.js";

/**
 * **Which face a band gets**, from its border-box width. Pure, for the test.
 *
 * The threshold is `structureColumnsBand` in layout.ts — the same number
 * `fitMode` sizes Structure's band from, so a band handed out for the columns
 * is always drawn as the columns and a band too narrow for them is the ordinary
 * one with the list in it. Since 2026-09-28 that is two columns of 17rem of
 * content each, a 609px band at a 16px root (a 1165px window beside the prose);
 * it was two 176px tracks, a 389px band, until then — Greg found the columns
 * "really narrow". docs/plans/260928a-structure-two-columns-readable.md.
 *
 * **A band that covers the article always gets the list**, however wide it is
 * painted. Below `bandCoversProse`'s crossover the band is the whole window less
 * the rail, so measuring it would draw the columns in a 620–699px window and the
 * list in a 288px band at 700 — a wider window, a narrower face. GPT Sol's plan
 * review, finding 1. It is also what keeps the columns off a phone.
 *
 * It is answered from the **border box**, whichever face is on screen. The two
 * faces pad the band differently (Structure 12px + 12px, Outline 12px + 8px), so
 * reading the mounted face's content box would give one band two answers
 * depending on which face measured it, and flip between them for ever. The
 * border box is set by the layout — it is `--mode-w`, exactly the number
 * `fitMode` chose — never by the face.
 *
 * `rootFontPx` is measured rather than assumed: the columns are in rem, so a
 * 20px root needs a wider band (layout.ts § the root size is not locked).
 */
export function structureFace(
  bandWidth: number,
  rootFontPx: number,
  proseBeside: boolean,
): "columns" | "list" {
  if (!proseBeside) return "list";
  return bandWidth >= structureColumnsBand(rootFontPx).min ? "columns" : "list";
}

/**
 * How often, at most, Structure follows a scroll: Greg's *"maybe every second
 * might be fine"* (spya-m5gxk9). A jump is never held. Plan 261025e.
 */
export const STRUCTURE_HOLD_MS = 1000;

/** The second paragraph of each chip's card: what it does that its name does not say. */
const VIEW_HOW: Readonly<Record<StructureView, string>> = {
  fisheye: "It opens up as you read. With room it is two columns, otherwise one list.",
  expanded:
    "The list scrolls on its own, and follows you each time you move into another section.",
  hover:
    "Where there is room for two columns. A click still goes there too, and Back undoes only clicks.",
};

/**
 * **Fisheye / Expanded** — Greg, 2026-10-01 (spya-gxyhcc). Referee's chips are
 * the pattern (RefereeMode.tsx § `RefereeViews`): a radiogroup of buttons, each
 * its own tab stop, a card on each. Neither arms anything — there is nothing
 * to generate — so the click is only the URL write. Drawn as the part-switcher
 * every mode shares (mode-band.css § the part-switcher, plan 261007h § F2).
 */
export function StructureViewToggle({
  view,
  onView,
  experimental,
}: {
  view: StructureView;
  onView(next: StructureView): void;
  /** The reader's experimental-features switch — Hover is behind it (experimental-visibility.ts). */
  experimental: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  useRevealChosen(group, view);
  const shown = STRUCTURE_VIEWS.filter((v) =>
    shownBehindTheSwitch({ experimental: STRUCTURE_SUB_MODES[v].experimental, on: experimental, current: v === view }),
  );
  return (
    <div ref={group} className="struct-views summ-views" role="radiogroup" aria-label="How Structure is drawn">
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {shown.map((v) => (
          <Tooltip
            key={v}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={
              <ControlTip
                head={STRUCTURE_SUB_MODES[v].label}
                what={STRUCTURE_SUB_MODES[v].description}
                how={VIEW_HOW[v]}
              />
            }
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s, the call RefereeMode.tsx, DiagramPanel.tsx and Dock.tsx already make */}
            <button
              type="button"
              role="radio"
              aria-checked={v === view}
              tabIndex={0}
              className={`struct-view-btn summ-view-btn${v === view ? " on" : ""}`}
              onClick={() => {
                /* Writing the value already open would push a history entry
                   that goes nowhere. */
                if (v !== view) onView(v);
              }}
            >
              {STRUCTURE_SUB_MODES[v].label}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}

export function StructureBand({
  slug,
  owner,
  article,
  leafDepth,
  sections,
  layoutKey,
  supplementOf,
  arcByRow,
  proseBeside,
  rootFontPx,
  arrival = null,
  experimental = false,
  onJump,
}: {
  /** The article's slug and whether it is the reader's own — for `StructureNotice` only. */
  slug: string;
  owner: boolean;
  article: Article;
  /** `Geometry.leafDepth` — how far down `buildSummaryTree` should walk. */
  leafDepth: number;
  /** The article's sections, for the focus-line sampler. `buildSections`. */
  sections: Section[];
  /** Re-measure when the columns change — the same key the `?at=` tracker uses. */
  layoutKey: string;
  /** `Geometry.supplementOf` — the list face draws the apparatus unnumbered. */
  supplementOf: ReadonlyMap<NodeId, TreeNode>;
  /** The arc, keyed by the row each part starts on — the list face's rung 4. */
  arcByRow: Map<number, ArcCell> | null;
  /**
   * Whether the band sits beside the prose rather than covering it —
   * `fit.modeW > 0` (layout.ts).
   *
   * It gates paragraph rows in both faces, and the reason is the substitution
   * principle rather than fit: a paragraph row may fall back to its
   * `navLabel`, and a `navLabel` is a pointer to prose that must never stand
   * *in place of* prose that could be shown. On a window where the band covers
   * the article, it would.
   */
  proseBeside: boolean;
  /**
   * The same measured root size `fitView` used to choose the band's width.
   * Sharing the value is what makes the fit and the face one decision even when
   * the root size changes without changing the band's border-box width.
   */
  rootFontPx: number;
  /**
   * **The real structure is still on its way**, and what to say about it above
   * the rows — or null / absent when the tree is not a stand-in waiting to be
   * replaced, which is nearly every article. StructureArriving.tsx.
   *
   * Handed in rather than worked out here because the two footings get it from
   * different places: an owner's comes from the job list and carries **Build
   * it**; a visitor's is read off the payload and carries nothing to press.
   * This band stays the one component for both and learns nothing about jobs.
   */
  arrival?: StructureArrival | null;
  /** The reader's experimental-features switch, for the chips (Hover is behind it). */
  experimental?: boolean;
  onJump(id: BlockId): void;
}) {
  useRenderCount("StructureBand");

  /**
   * The tree, full depth — the same one for both faces.
   *
   * `buildSummaryTree` with no summaries, because this mode reads nothing that
   * stage 6 writes: a title, a gist and a navLabel are all on `tree.json`
   * already. Full depth rather than the default 2, because both faces can
   * expand the current section into its paragraphs and those are leaves.
   *
   * **No `mode === "structure"` guard on the `useMemo`**: this component is only
   * mounted by the `modeBand()` arm for this mode, so the guard a hook in `Reader`
   * would need — it runs on every render of the reading view in every mode — is
   * exactly the cost that keeping the controller out here removed.
   */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, leafDepth),
    [article.tree, article.blocks, leafDepth],
  );

  /**
   * **The article's figures, tables and media**, once for both faces — the
   * mark after each row's title (FigureMark.tsx; Greg, spya-sb0c7e).
   */
  const figures = useMemo(() => figuresOf(article.blocks), [article.blocks]);

  /**
   * **The stretches the prose folds to a stub** — the abstract, the
   * references — so a row wholly inside one is drawn faint with an ⓘ, and
   * keeps its place (Greg, spya-vskdap: *"visible in Structure so that the
   * reader can see that there is an Abstract and easily get to it"*). The same
   * function and the same echo the prose table asks (TableView.tsx), so the two
   * cannot disagree. Plan 261018a § Stage 3.
   */
  const { blocks, matter: stored, titleOverridden } = article;
  /* Read through `?.`: this band is mounted in a dozen tests with an article
     that is only a tree and blocks, and a faint row is not worth a crash. */
  const authors = article.meta?.authors;
  const byline = article.meta?.byline;
  const title = article.meta?.title;
  const matter = useMemo(() => {
    const echo = mastheadEcho({ blocks, meta: { title }, titleOverridden });
    return matterStretches({ blocks, matter: stored, meta: { authors, byline } }, echo);
  }, [blocks, stored, title, titleOverridden, authors, byline]);

  /**
   * Where the reader is — one sampler for both faces, so they can never
   * disagree about which section is under the focus line. A face change at a
   * resize must not also move "here".
   *
   * `enabled: true` because mounting is the condition — see the `useMemo`
   * above. **Section-granular**: `focusRow` is a
   * section's first row, never the exact block, which is why no paragraph in
   * either face is ever marked current.
   *
   * **Held to once a second while the reader scrolls** (useColumnContext.ts §
   * `holdMs`): each change redraws and re-measures a fitted tree, and on an
   * iPad a band redrawn under a moving finger flickered (Greg, spya-m5gxk9).
   */
  const live = useColumnContext({ sections, enabled: true, layoutKey, holdMs: STRUCTURE_HOLD_MS });

  /**
   * **Both halves of "may we draw paragraph rows", answered here rather than in
   * a panel**, because they are facts about the page and the article rather
   * than about the drawing.
   *
   * `paragraphLabelsReady` is the one GPT Sol's review of Structure added
   * (260907c, finding 3): stage 5 writes the leaves' navLabels, and until it
   * has, a paragraph layer draws blanks that read as *missing article
   * structure* rather than as work in progress. Both faces withhold the whole
   * layer for it and say nothing — nobody asked for the layer, so a sentence in
   * place of it would answer a question the reader never put.
   */
  const labelsReady = paragraphLabelsReady(article.navLabelStatus);

  /**
   * **The band's own width, measured — and the face chosen from it.**
   *
   * Measured rather than derived from `fit.modeW`, because `fitMode` reports
   * `modeW: 0` exactly when the band *covers* the prose, while the CSS expands
   * it to the whole viewport (narrow-window.css) — so a width read off the
   * layout would call the widest band on a phone the narrowest. Asking the
   * element is the only question with a true answer; it is the reason
   * Structure's columns were switched by a container query before this, and
   * the reason `OutlinePanel` measures whether it covers.
   *
   * `offsetWidth` rather than `getBoundingClientRect`, so a transform on the
   * band (a slide-in) cannot report a width the layout does not have. A width of
   * 0 — nothing laid out yet, or jsdom — keeps the face it has: the columns on
   * first mount, which is what a test with no layout has always seen.
   *
   * **The first frame is the columns, and it is never painted on a narrow
   * band**: the callback ref lands the element in the commit, and this layout
   * effect measures it *synchronously*, before the browser paints — a narrow
   * answer re-renders before anything is shown. The observer is only for later
   * changes; its callbacks do not run in the layout phase, so the synchronous
   * `measure()` ahead of it is the part that keeps the first frame right. The
   * element changes when the face does (each face renders its own `<aside>`
   * through `ModeSurface`), so the state holding it is what re-arms both.
   *
   * `rootFontPx` is the value the parent handed to `fitView`, rather than a
   * second read from the DOM. A ResizeObserver cannot see a root-size change
   * when the band's fixed-pixel border box stays the same; putting the shared
   * value in this effect's dependencies keeps the face and the fit together in
   * that case too.
   */
  const [band, setBand] = useState<HTMLElement | null>(null);
  const [face, setFace] = useState<"columns" | "list">("columns");
  useLayoutEffect(() => {
    if (!band) return;
    const measure = () => {
      const width = band.offsetWidth;
      if (width <= 0) return;
      setFace(structureFace(width, rootFontPx, proseBeside));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(band);
    return () => ro.disconnect();
  }, [band, proseBeside, rootFontPx]);

  /**
   * **Fisheye or Expanded** — `?structure=` (params.ts § `structureParam`).
   * Expanded is the list in every band width: one scrolling list of every part
   * and section, so it has no columns face. The face is still measured while
   * it is open, so going back to Fisheye lands on the right one.
   *
   * **Hover** is Fisheye with `onGlance` handed to the columns (§ `glance`
   * below). The list face ignores it and behaves as Fisheye: the list scrolls
   * itself to follow the reader, so a glance there would move the list under the
   * mouse. Plan 261024k.
   */
  const [view, setView] = useQueryState("structure", structureParam);
  /* **The stand-in line rides in the head row**, under the chips, so one place
     puts it in all three presentations. Both faces measure their room from
     where their rows actually start (OutlinePanel.tsx § `measure`,
     StructurePanel.tsx § `roomBelow`), so the columns, which never scroll,
     give up rows to it rather than overflowing.

     **Two lines, never both.** A tree that is waiting for the real one says so
     through `arrival` (StructureArriving.tsx: still being built, or it stalled
     and the owner may build it); a headings tree that is final says so through
     `StructureNotice`. `arrival` wins, and is null once the real tree is in. */
  const provisional = article.tree.provisional;
  const head = (
    <>
      <StructureViewToggle view={view} onView={(v) => void setView(v)} experimental={experimental} />
      {arrival ? (
        <StructureArriving arrival={arrival} />
      ) : provisional === "headings" ? (
        <StructureNotice provisional={provisional} slug={slug} owner={owner} />
      ) : null}
    </>
  );

  if (view === "expanded" || face === "list") {
    return (
      <OutlinePanel
        surfaceRef={setBand}
        root={root}
        figures={figures}
        supplementOf={supplementOf}
        arcByRow={arcByRow}
        focusRow={live.focusRow}
        proseBeside={proseBeside}
        paragraphLabels={labelsReady}
        onJump={onJump}
        expanded={view === "expanded"}
        head={head}
        matter={matter}
      />
    );
  }
  return (
    <StructurePanel
      surfaceRef={setBand}
      root={root}
      figures={figures}
      focusRow={live.focusRow}
      allowParagraphs={proseBeside && labelsReady}
      onJump={onJump}
      head={head}
      matter={matter}
      onGlance={view === "hover" ? glance : undefined}
    />
  );
}

/**
 * **Where a resting mouse goes in the Hover view: a quiet scroll, not a jump.**
 * A click is `onJump`, which pushes a Back entry, arms the return chip and
 * flashes the landing; a mouse swept down a column would leave a dozen of each.
 * This is what ← / → stepping does instead (keynav.ts): the scroll alone, so the
 * reader's place moves as it would under the wheel. Instant, because a glide
 * across several parts walks the focus line through each, and column B — what
 * the reader is looking at — would flicker through all of them. **Centred**, as
 * a jump is: the focus sampler reads 40% down the viewport, so a short section
 * scrolled to the top would read as the one after it, and column B would
 * redraw for the wrong section (GPT Sol, plan review, finding 1).
 * docs/plans/261024k-structure-hover-submode.md.
 */
function glance(id: BlockId): void {
  scrollToBlock(id, "auto", undefined, { align: "centre" });
}
