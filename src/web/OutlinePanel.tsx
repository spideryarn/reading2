/**
 * **Structure mode's list face** — the whole document as one nested list,
 * whose fisheye scrolls when its floor does not fit, and whose Expanded view
 * always scrolls. It was Outline mode, 2026-08-28 to 2026-09-10; it is now what
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
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useTapReveal } from "./useTapReveal.js";
import { withVoice } from "./voice.js";

/**
 * The least the fisheye list draws: every part, the current part's sections,
 * and the current section's summary (outline.ts § `Rung`). `fit` below.
 */
const FLOOR: Rung = 3;

/** Reveal a keyboard target using only the list's own scroll position. */
function revealRow(list: HTMLOListElement, row: HTMLElement) {
  if (list.clientHeight <= 0) return;
  const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  const bottom = top + row.offsetHeight;
  if (top < list.scrollTop || row.offsetHeight > list.clientHeight) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

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
  /**
   * **Structure's Expanded view** (`?structure=expanded`): every part and
   * section with its gist, and the panel scrolls instead of fitting a rung.
   * The same tree, rows and keys as the fisheye list — an Expanded that was a
   * component of its own would have had to copy the tree's keyboard contract
   * (GPT Sol's plan review, 261001q, finding 8).
   * docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md.
   */
  expanded?: boolean;
  /** The Fisheye / Expanded toggle, drawn in the band's head row. */
  head?: ReactNode;
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
  expanded = false,
  head,
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
  /** The visible list, whose top is where the fit's room starts. */
  const listRef = useRef<HTMLOListElement>(null);
  /**
   * **What the fit chose: a rung, and whether the list has to scroll to show it.**
   *
   * Rung 3 is the floor — every part, the sections of the part the reader is
   * in, and the summary of the section they are in. Until 2026-10-03 the floor
   * was rung 1 and the panel never scrolled, so a band too short for rung 3
   * showed the parts and nothing about where the reader was inside one. Greg,
   * spya-s46j8f:
   *
   * > at the very least I want all the headings for this subsection and its
   * > siblings to be visible. I mean, I think I'd also like to see the summary
   * > for this lowest level subsection, even if that does mean that it can't
   * > show the whole top-level structure visibly, that I'd have to scroll in
   * > structure mode
   *
   * So when rung 3 does not fit it is drawn anyway and the list scrolls, as
   * Expanded's does. Titles are always whole: the one-line clamp that was the
   * old floor (2026-09-10, Greg's 2Q) went with the rule it was protecting.
   * docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md
   */
  const [fit, setFit] = useState<{ rung: Rung; scroll: boolean }>({ rung: FLOOR, scroll: false });
  const rung = fit.rung;

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
   * stylesheet keys off `.band-covers`, now written by Reader.tsx from the same
   * `fit.modeW`, so the two halves cannot part again (narrow-window.css § a band with
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

  /* Every candidate, always built. Cheap — a few hundred objects — and building
     all five is what lets the fit be *measured* rather than estimated. None in
     Expanded, which draws everything and scrolls, so there is no fit to
     measure — and no hidden copies for it to lay out. */
  const candidates = useMemo(
    () =>
      expanded
        ? []
        : RUNGS.map((r) =>
            outlineProjection({
              root,
              supplementOf,
              arcByRow,
              focusRow,
              rung: r,
              allowParagraphs,
            }),
          ),
    [root, supplementOf, arcByRow, focusRow, allowParagraphs, expanded],
  );
  const everything = useMemo(
    () =>
      expanded
        ? outlineProjection({
            root,
            supplementOf,
            arcByRow,
            focusRow,
            rung: 1,
            allowParagraphs: false,
            expanded: true,
          })
        : null,
    [root, supplementOf, arcByRow, focusRow, expanded],
  );

  /**
   * **Measure, do not estimate.** The precedent in column-context.md estimated
   * a line budget from character counts and recorded GPT's dissent; the trade
   * inverts here and Sol's review of this plan said so. There it was five
   * hidden renders for each of three panels and a bad guess left a column
   * slightly blank. Here it is five for one panel, and a bad guess either
   * scrolls a list that would have fitted or clips one that does not. An estimator's own `data-outline-rung`
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

      /* **From the visible list's own top**, not the panel's padding edge,
         since the band grew a head row (the Fisheye / Expanded toggle,
         2026-10-01): whatever sits above the list is room the list cannot use,
         and this subtracts it whatever it is. GPT Sol's plan review, 261001q,
         finding 5. The padding-edge sum stays as the fallback for a list not
         yet in the DOM. */
      const pad = getComputedStyle(panel);
      const padBottom = Number.parseFloat(pad.paddingBottom) || 0;
      const list = listRef.current;
      const avail = list
        ? panel.getBoundingClientRect().top +
          panel.clientTop +
          panel.clientHeight -
          padBottom -
          list.getBoundingClientRect().top
        : panel.clientHeight - (Number.parseFloat(pad.paddingTop) || 0) - padBottom;
      /* Nothing to measure against yet — a band with no laid-out height would
         make every candidate "not fit" and report scrolling while hidden. Leave
         it alone and wait for the observer. */
      if (avail <= 0) return;

      /* **Ties go to the LOWER rung**, and that is not a detail. When the
         section is over the paragraph cap, or paragraphs are not permitted at
         all, candidate 5 is identical to candidate 4 — so taking the highest
         fitting number would report `data-outline-rung="5"` for a list with no
         paragraphs in it. The attribute exists to be read in a browser as
         evidence of what the fit chose; a diagnostic that overstates how far
         down the ladder it got is worse than none.

         **From the floor up, never below it** — `fit` above says why. If the
         floor itself does not fit, it is drawn and the list scrolls. */
      let best: Rung | null = null;
      let bestHeight = -1;
      for (const child of Array.from(box.children)) {
        const el = child as HTMLElement;
        const r = Number(el.dataset.rung) as Rung;
        if (r < FLOOR) continue;
        const h = el.scrollHeight;
        if (h <= avail && h > bestHeight) {
          best = r;
          bestHeight = h;
        }
      }
      const next = best !== null ? { rung: best, scroll: false } : { rung: FLOOR, scroll: true };
      setFit((prev) => (prev.rung === next.rung && prev.scroll === next.scroll ? prev : next));
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
  const drawn = everything ?? chosen ?? null;
  const rows = drawn?.rows ?? [];
  /** The list is its own scroller: always in Expanded, and in the fisheye only
   * when the floor does not fit. */
  const scrolls = expanded || fit.scroll;

  /**
   * **A list that scrolls follows the reader, and only when they cross a
   * boundary** — Expanded always, and the fisheye when its floor does not fit
   * (`fit` above).
   * Greg, spya-gxyhcc: "Ideally it would [scroll along with the text]. I
   * suppose that could interfere with the fact that ideally the user would be
   * able to scroll independently within the column … Let's try and avoid too
   * much complexity for the v1."
   *
   * Normally the list follows when the row marked `now` *changes* — the reader
   * has moved into another section. It also aligns when scrolling starts or
   * the hidden list returns. A reader who
   * scrolls the column by hand keeps their place until the next boundary in
   * the text. No pause timer and no "detached" state; add one only if the
   * snap-back turns out to annoy. A row already fully in view is left where it
   * is; one that is not goes a third of the way down, so what comes next is in
   * view below it.
   *
   * **The list's own `scrollTop`, never `scrollIntoView`**, which scrolls
   * every scrollable ancestor too — the page included. The list is the
   * scroller rather than the band so the toggle above it stays put
   * (outline-mode.css § Expanded). And a ResizeObserver re-runs it when the
   * list comes back from nothing, because on a phone a band that has stepped
   * aside is `display: none` (narrow-window.css § `band-away`) and returns at
   * its old scroll with the reader somewhere else. GPT Sol's plan review,
   * 261001q, finding 7.
   */
  const nowId = drawn?.currentId ?? null;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!scrolls || !list) return;
    const follow = () => {
      if (nowId === null || list.clientHeight <= 0) return;
      const row = list.querySelector<HTMLElement>(`#${CSS.escape(`outln-${nowId}`)}`);
      if (!row) return;
      const listTop = list.getBoundingClientRect().top;
      const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - listTop + list.scrollTop;
      const top = topOf(row);
      const bottom = top + row.offsetHeight;
      /* **The fisheye wants the whole of the current part's block in view** —
         the part's row down to its last section — because "all the headings
         for this subsection and its siblings" is the half of Greg's request
         that a scroll could otherwise hide (spya-s46j8f). The block is the
         nearest part row at or above the current row, to the row before the
         next part. If it is taller than the list, the current row is placed
         as Expanded places it. */
      if (!expanded) {
        const all = Array.from(list.querySelectorAll<HTMLElement>(":scope > .outln-row"));
        const at = all.indexOf(row);
        let first = at;
        while (first > 0 && !all[first]?.classList.contains("lvl-1")) first--;
        let last = at;
        while (last + 1 < all.length && !all[last + 1]?.classList.contains("lvl-1")) last++;
        const head = all[first];
        const tail = all[last];
        if (head && tail) {
          const blockTop = topOf(head);
          const blockBottom = topOf(tail) + tail.offsetHeight;
          if (blockBottom - blockTop <= list.clientHeight) {
            if (blockTop < list.scrollTop) list.scrollTop = blockTop;
            else if (blockBottom > list.scrollTop + list.clientHeight) {
              list.scrollTop = blockBottom - list.clientHeight;
            }
            return;
          }
        }
      }
      if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;
      /* A third of the way down, **but never so far that a row which fits is
         cut at the foot**: the row carries its summary, and a 250px row put
         100px down a 300px list loses its last 50px. So the third-down place
         is held between "the row's foot at the list's foot" and "the row's top
         at the list's top"; a row taller than the list starts at its top. GPT
         Sol's plan review, 261003k, F2. */
      const third = top - list.clientHeight / 3;
      list.scrollTop = Math.max(0, Math.min(top, Math.max(third, bottom - list.clientHeight)));
    };
    follow();
    let shown = list.clientHeight > 0;
    const ro = new ResizeObserver(() => {
      const now = list.clientHeight > 0;
      if (now && !shown) follow();
      shown = now;
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [expanded, scrolls, nowId]);

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

  /**
   * **And forget it when the tree is a new one**, whether or not a row with
   * that id is still drawn.
   *
   * Node ids are positional, so an id that survives a replacement can name a
   * different passage — the check above would keep it, and the mark would sit
   * on a row the reader never chose. An article opened before its structure is
   * built has its stand-in tree replaced live
   * (docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md,
   * GPT Sol's F1). The stored `root.node` is the trigger. The derived `root`
   * also rebuilds when images arrive, while its stored node stays the same;
   * a row the reader held should survive that redraw.
   *
   * Clears only, like the effect above, and so cannot yank focus either.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored root node is the reset trigger.
  useLayoutEffect(() => {
    setFocusedId(null);
  }, [root?.node]);

  const jump = useCallback(
    (row: OutlineRow | undefined) => {
      if (row) onJump(row.blockId);
    },
    [onJump],
  );

  const rowId = (r: OutlineRow) => `outln-${r.node.id}`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const step = (to: number) => {
      e.preventDefault();
      const i = Math.max(0, Math.min(rows.length - 1, to));
      const target = rows[i];
      setFocusedId(target?.node.id ?? null);
      /* **Show the row the key chose**, in a list that scrolls. Follow-along
         only runs when the reader's section changes, so Home pressed while
         already in the first section would mark a row that is off screen. The
         least scroll that brings it in, on the list's own `scrollTop` (never
         `scrollIntoView`, which moves the page too). GPT Sol's plan review,
         261003k, F3.

         **Known and left**: when the jump lands in another part, follow-along
         then places that part's current section, and in a part taller than
         the list that can push the chosen part's own row just off the top.
         Sol's code review built a held reveal for it; it was taken out as
         more machinery than a Home/End edge earns (the plan says so). */
      const list = listRef.current;
      /* By id on the document: only the visible rows carry one. */
      const el = scrolls && target ? list?.ownerDocument.getElementById(rowId(target)) : null;
      if (list && el) revealRow(list, el);
      jump(target);
    };
    switch (e.key) {
      /* **↑ / ↓ are not this list's any more**, since 2026-10-01: they stepped
         its rows, and each row is a part or a section, so with focus here ↓
         jumped a section while with focus on the prose it stepped a block.
         Greg, spya-b2wzjf: "up and down should always do the same thing".
         So the key is left to `useArrowNav` (keynav.ts), which steps the
         article one block, and the marked row follows because it is derived
         from where the reader is. Letting go of a held row is the one thing
         done here, or a row picked with Home would keep the mark while the
         article moved on underneath it. ← / → step sections in this mode —
         Reader.tsx. docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md. */
      case "ArrowDown":
      case "ArrowUp":
      case "ArrowLeft":
      case "ArrowRight":
        setFocusedId(null);
        return;
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

  return (
    <ModeSurface
      /* What scrolls is keyed on `data-outline-scroll` below, not on this
         class (outline-mode.css § a list that scrolls). */
      feature={expanded ? "outln outln-expanded" : "outln"}
      head={head}
      /* Structure's narrow face, so Structure's (i) (ModeSurface.tsx § `mode`). */
      mode="structure"
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
      data-outline-rung={expanded ? "expanded" : rung}
      /* And whether the list scrolls: Expanded always, the fisheye when its
         floor did not fit — `fit` above. The stylesheet keys the scroll on
         this (outline-mode.css § a list that scrolls). */
      data-outline-scroll={scrolls ? "1" : "0"}
    >
      <TooltipGroup delay={{ open: 150, close: 90 }} timeoutMs={400}>
        <ol
          ref={listRef}
          className="outln-list"
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

          **Same element, same classes, same width as the non-scrolling list** — an
          `<ol class="outln-list">` of `<li class="outln-row …">`, because a
          measurement of different markup is a measurement of something else.
          That is the whole point of measuring rather than estimating, and it
          would be quietly undone by a measuring copy that merely looked alike. */}
      {expanded ? null : (
        <div className="outln-measure" aria-hidden="true" ref={measureRef}>
          {candidates.map((c) => (
            <ol className="outln-list" key={c.rung} data-rung={c.rung}>
              {c.rows.map((row) => (
                <li key={row.node.id} className={rowClass(row, false)}>
                  <RowBody row={row} />
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
    </ModeSurface>
  );
}

/**
 * One row.
 *
 * **The tooltip owns its own state, and that is load-bearing.** The spine's
 * cards stopped working for a day because fifty triggers were made controlled
 * off one shared piece of state: `useDelayGroup` closes every *other* member
 * the moment one opens, and `useHover` schedules a departing trigger's close
 * without checking whether it is still the open one. Both are correct against
 * a tooltip that owns its own state. docs/postmortems/260828g-spine-hover-cards.md.
 *
 * It was uncontrolled until 2026-10-03, and is now controlled by state that is
 * still this row's alone (`useTapReveal`), so that a finger's first tap can
 * open the card and its second go there — docs/project/touch.md; Greg,
 * spya-a868zs; plan 261003c. The keyboard path is the tree's Enter, which
 * calls `onJump` directly and never meets this.
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
  const reveal = useTapReveal(true);
  return (
    /* `right`, and without `keepSide`, for the reason StructurePanel.tsx §
       `CardRow` gives at length: on a phone neither side has room, `keepSide`
       forbids the drop below the row, and the card opened off the screen and
       widened the page under the reader's finger (qi-fkyrdns3, plan 261004g). */
    <Tooltip
      placement="right"
      open={reveal.open}
      onOpenChange={reveal.onOpenChange}
      content={
        <div className="outln-card">
          <div className="outln-card-crumb">{row.number}</div>
          <div className={withVoice("outln-card-title", row.voice)}>{row.text}</div>
          {row.node.gist ? <p className="outln-card-gist">{row.node.gist}</p> : null}
          {/* The spine's words, and only for a finger (StructurePanel.tsx § RowCard). */}
          {reveal.tap !== undefined && <div className="tip-tap">Tap again to go here</div>}
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
        onPointerDown={reveal.onPointerDown}
        onPointerCancel={reveal.onPointerCancel}
        onClick={(e) => {
          if (reveal.commit(e)) onJump();
        }}
      >
        <RowBody row={row} />
      </li>
    </Tooltip>
  );
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
      <span className={withVoice("outln-text", row.voice)}>{row.text}</span>
      {row.arc ? <p className="outln-arc">{row.arc}</p> : null}
      {row.sentence ? <p className="outln-gist">{row.sentence}</p> : null}
    </>
  );
}
