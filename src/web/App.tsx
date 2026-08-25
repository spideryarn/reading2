import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { throttle, useQueryState } from "nuqs";
import type { Article, BlockId } from "../types.js";
import { Library } from "./Library.js";
import { type ArticleView, useRoute } from "./router.js";
import { Metadata } from "./Metadata.js";
import { Tweets } from "./Tweets.js";
import { sanitizeArticle } from "./sanitize.js";
import { TableView } from "./TableView.js";
import { Spine } from "./Spine.js";
import { CommentDialog } from "./CommentDialog.js";
import { Masthead } from "./Masthead.js";
import { Dock } from "./Dock.js";
import { Toggle } from "@/components/ui/toggle";
import { buildArcColumn, buildGeometry, buildOutline, columnLabel } from "./tree.js";
import { atParam, colsParam, noteParam, panelParam, textParam } from "./params.js";
import { isBlockOnScreen, scrollToBlock, stickyOffset } from "./scroll.js";
import { orderComments, positionOf, stepComment } from "./comment-nav.js";
import {
  activeSectionIndex,
  buildSections,
  sectionDepth,
  type Section,
} from "./position.js";
import { fitView } from "./layout.js";
import { useArrowNav } from "./keynav.js";
import { useComments } from "./useComments.js";

/**
 * The granularity pills, restated over shadcn's Toggle.
 *
 * Individual `Toggle`s rather than a `ToggleGroup`, which is what you would
 * normally reach for and what the migration plan called for. The reason is
 * this app's keyboard design: a ToggleGroup wraps its items in Radix's roving
 * focus, which binds ArrowLeft, ArrowRight, ArrowUp AND ArrowDown. Here ↑/↓
 * step through the article and ←/→ are deliberately handed back to the browser
 * to pan a table wider than the window (see keynav.ts and
 * docs/project/keyboard.md). A group would swallow all four whenever focus sat
 * inside the bar — which is precisely where focus lands after you click a
 * pill. Separate toggles give the same `aria-pressed` and `data-state` and
 * leave the arrow keys alone.
 *
 * The class string is mostly undoing shadcn's defaults, because these are
 * pills and its Toggle is a square-ish icon button:
 *
 *  - `rounded-full`, `h-auto`, `py-*` — its default is `h-9 min-w-9 rounded-md`.
 *  - `hover:bg-transparent` — its default hover paints `bg-muted`; ours moves
 *    only the border and the text to orange.
 *  - the `data-[state=on]` trio — its default on-state is `bg-accent`, and in
 *    this palette `--accent` is a raised dark SURFACE, not the brand orange.
 *    Left alone it marks the ON state with dark grey on a near-black page:
 *    not an error, not visibly broken, just the signal quietly gone. Both
 *    tokens.css and styles.css carry warnings about this exact confusion.
 */
const PILL =
  // Shape and metrics, matched to the rule this replaced rather than to
  // Tailwind's defaults: `text-xs` would also set line-height to 1rem, where
  // these inherited the body's 1.55, and the padding is the original 0.22/0.6
  // rather than the nearest scale step. Both differences are a couple of
  // pixels of pill height, which is exactly the sort of drift nobody notices
  // individually and everybody notices in aggregate.
  "tw:rounded-full tw:h-auto tw:min-w-0 tw:px-[0.6rem] tw:py-[0.22rem] " +
  "tw:text-xs tw:leading-[1.55] tw:font-normal " +
  // font-family and cursor were coming from `.controls button`, which step 8
  // deletes. Stated here so this string stands on its own and that deletion
  // cannot quietly change the pills.
  "tw:font-sans tw:cursor-pointer " +
  "tw:border tw:border-rule-strong tw:text-ink-faint tw:bg-transparent " +
  // The base Toggle animates only `color` and `box-shadow`. Background and
  // border are the two properties that actually say "on" here, so without
  // this they snap while the text fades — the old rule animated all three.
  "tw:transition-[color,background-color,border-color] tw:duration-[120ms] " +
  "tw:hover:bg-transparent tw:hover:border-highlight tw:hover:text-highlight " +
  "tw:data-[state=on]:bg-highlight-wash tw:data-[state=on]:border-highlight " +
  "tw:data-[state=on]:text-highlight-ink tw:data-[state=on]:font-semibold";

/**
 * Which page you are on, and nothing else.
 *
 * The path says which article (`/read/<slug>`) and which of its three views
 * (`/metadata`, `/tweets`, or the reading view itself), or that you want the
 * shelf (`/`); the query string says how you are looking at it. See router.ts
 * for that division, and params.js for the parameters themselves.
 */
export function App() {
  const route = useRoute();
  if (route.kind === "library") return <Library />;
  return <ArticlePage slug={route.slug} view={route.view} />;
}

/**
 * One article, fetched **once for all three of its views**.
 *
 * The fetch lives here rather than in the reading view because the metadata and
 * tweet pages need the same payload, and because this component does not
 * remount when only the view changes: stepping out to the metadata page and
 * back is then free, rather than 150KB and a spinner each way. The remount that
 * *does* matter is keyed below, on the slug.
 *
 * Nothing here is `useState` except the article itself, which is derived from
 * the URL rather than part of it. Everything the reader can change lives in the
 * path or the query string — see params.js for why, and for which of these
 * changes push a history entry and which quietly replace one.
 */
function ArticlePage({ slug, view }: { slug: string; view: ArticleView }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The slug is in the path now, so it can change under us — via back/forward,
    // or a pasted link. Guard the response so a slow first fetch can't overwrite
    // a fast second one.
    let live = true;
    setArticle(null);
    setError(null);
    fetch(`/api/article/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        return body as Article;
      })
      // Sanitised here, at the doorway, and nowhere later. This is the pass that
      // guards the render: stage 3 cleaned this HTML under *jsdom's* parser and
      // we are about to hand it to *Chrome's*. It must happen before anything
      // reads `block.html` — both renderedText and annotateHtml parse it with
      // innerHTML ahead of React. See src/web/sanitize.ts.
      .then((a) => live && setArticle(sanitizeArticle(a)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug]);

  if (error) return <pre className="error">{error}</pre>;
  if (!article) return <div className="loading">Loading…</div>;
  // Keyed on the slug so switching article remounts rather than trying to carry
  // one article's reading position into another's blocks. NOT keyed on the
  // view: switching view is meant to keep the fetch, which is the whole reason
  // it happens up here.
  if (view === "metadata") return <Metadata key={slug} slug={slug} article={article} />;
  if (view === "tweets") return <Tweets key={slug} slug={slug} article={article} />;
  return <Reader key={slug} slug={slug} article={article} />;
}

/** The window width, as state, because the whole layout is computed from it. */
function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * Reading position, both ways: the URL scrolls the page, and the page writes the
 * URL once the reader stops moving. Returns the one function anything should use
 * to jump somewhere deliberately.
 *
 * `synced` is the whole trick. Scrolling writes the URL and the URL scrolls the
 * page, so without a record of the value both sides already agree on, every
 * scroll bounces off the restore effect and scrolls again. It is set by whichever
 * side moved first; the other then recognises the value as its own and does
 * nothing.
 *
 * The pure half — which block counts as "the section you are in", and why it is
 * a section rather than an offset — is in position.ts. Written by
 * spideryarn2-cd, 2026-08-25.
 */
function useReadingPosition(sections: Section[], layoutKey: string) {
  const [at, setAt] = useQueryState("at", atParam);
  const synced = useRef<BlockId | null>(null);

  // URL → page: first load, back/forward, pasted link.
  useEffect(() => {
    if (at === synced.current) return;
    synced.current = at;
    if (at === null) window.scrollTo({ top: 0 });
    else scrollToBlock(at, "auto");
  }, [at]);

  // Page → URL, once the reader stops moving.
  useEffect(() => {
    const rows = sections.map((s) =>
      document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(s.blockId)}"]`),
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Above the first section there is no section to name, and saying so keeps
      // ?at= out of the URL until the reader has actually moved.
      if (window.scrollY <= stickyOffset()) {
        if (synced.current === null) return;
        synced.current = null;
        void setAt(null);
        return;
      }
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      const id = sections[activeSectionIndex(tops, stickyOffset() + 1)]?.blockId ?? null;
      if (id === null || id === synced.current) return;
      synced.current = id;
      void setAt(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(); // a column toggle reflows every row without the reader scrolling
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, setAt, layoutKey]);

  // A jump is the one scroll that pushes history: Back must not undo scrolling,
  // but flinging yourself across the article is a deliberate act. The debounce is
  // cancelled too, so a click isn't sluggish.
  //
  // `throttle(0)`, not `undefined`: nuqs resolves this option with `??`, so an
  // explicit undefined here falls straight through to atParam's
  // `debounce(POSITION_SETTLE_MS)` and cancels nothing. throttle(0) aborts the
  // pending debounce and writes the URL on the spot. Caught by
  // exactOptionalPropertyTypes — see docs/project/typechecking.md.
  return useCallback(
    (blockId: BlockId) => {
      synced.current = blockId;
      void setAt(blockId, { history: "push", limitUrlUpdates: throttle(0) });
      scrollToBlock(blockId);
    },
    [setAt],
  );
}

function Reader({ slug, article }: { slug: string; article: Article }) {
  const geometry = useMemo(
    () => buildGeometry(article.tree, article.blocks),
    [article],
  );
  // Three levels, not two: the rail itself only ever draws L1 and L2, but a
  // band's hover tooltip lists the sub-sections inside it, and it can only do
  // that if they were built. See BandCard in Spine.tsx.
  const outline = useMemo(
    () => buildOutline(article.tree, article.blocks, 3),
    [article],
  );
  const sections = useMemo(
    () => buildSections(geometry, article.blocks),
    [geometry, article.blocks],
  );
  const windowWidth = useWindowWidth();

  // Gist columns are 0 … leafDepth-1. The leaf column is not user-toggled: it
  // only makes sense in outline mode, where it is the deepest rung of the table
  // of contents, and is meaningless beside the prose it labels.
  const gistDepths = useMemo(
    () => geometry.columnDepths.filter((d) => d < geometry.leafDepth),
    [geometry],
  );

  const [cols, setCols] = useQueryState("cols", colsParam);
  const [showText, setShowText] = useQueryState("text", textParam);

  /**
   * An absent `cols` means "whatever fits", not "all of them". All of them is
   * 70rem of table, so on any laptop the obvious default buries a column
   * permanently under the pinned prose. The arithmetic lives in layout.ts, where
   * it can be tested without a DOM. An explicit `cols=` still wins outright, so a
   * pasted link shows exactly what it says.
   */
  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText,
        chosen: cols,
      }),
    [windowWidth, gistDepths, geometry.leafDepth, showText, cols],
  );

  // A string, not the array: a fresh array every render would restart the scroll
  // listener every render.
  const layoutKey = `${fit.columns.join(",")}|${showText}|${windowWidth}`;
  const jumpTo = useReadingPosition(sections, layoutKey);

  /**
   * Comments: selecting prose asks a question of the model, and the answer
   * arrives in a floating dialog. See docs/project/comments.md.
   *
   * Note what is *not* here — no column, no change to `fit`, nothing threaded
   * through the layout arithmetic. That was the point of choosing a dialog.
   */
  const [note, setNote] = useQueryState("note", noteParam);
  const { comments, ask, retry, remove, error: commentError } = useComments(slug);

  /**
   * The bottom drawer — see Dock.tsx, and docs/plans/bottom-bar.md for why the
   * bottom rather than the left.
   *
   * Note what is *not* here, for the same reason the comment dialog isn't:
   * nothing threaded through `fit`, no term added to the layout arithmetic. The
   * drawer is an overlay and the bar takes height, and height is the axis where
   * this view has nothing to ration.
   */
  const [panel, setPanel] = useQueryState("panel", panelParam);
  const drawerOpen = panel !== null;

  /**
   * ↑ / ↓ step through one level of the tree, and *which* level is whichever
   * column the pointer is sitting in — see keynav.ts. It writes no state of its
   * own: it scrolls, and the listener above notices, exactly as it would for a
   * wheel. Off any tagged column the stride falls back to the section, which is
   * the unit `?at=` already stores.
   *
   * Suspended while the drawer is open. A reader looking at their questions is
   * not reading, and the article scrolling away underneath the dim — silently,
   * because they cannot see it move — is the kind of thing you only notice
   * afterwards, when you have lost your place.
   */
  const navDepth = useArrowNav(
    geometry,
    article.blocks,
    sectionDepth(geometry),
    !drawerOpen,
  );

  /**
   * Reading order, not ask order — the panel's arrows walk you *down the
   * article*, not back through your own afternoon. See comment-nav.ts, and note
   * that the order comes from the block index and never from the id string
   * (block-ids.md).
   */
  const ordered = useMemo(
    () => orderComments(comments, article.blocks),
    [comments, article.blocks],
  );
  const openComment = ordered.find((c) => c.id === note) ?? null;

  /**
   * How many *other* questions are still with the model. Several can be in
   * flight at once — that is the point of firing one and reading on — so the
   * panel has to be able to say that work is happening somewhere you can't see.
   */
  const othersPending = ordered.filter(
    (c) => c.status === "pending" && c.id !== note,
  ).length;

  /**
   * Step to another comment, bringing its passage into view *only if it isn't
   * already*. Two comments in one paragraph are the common case, and jolting the
   * page between them would lose the reader their place for no gain.
   *
   * It scrolls and writes no position state of its own — the listener in
   * useReadingPosition notices and updates `?at=`, exactly as it does for a
   * wheel. Same reasoning as keynav.ts.
   */
  const goToComment = useCallback(
    (id: string | null) => {
      if (id === null) return;
      void setNote(id);
      const target = comments.find((c) => c.id === id);
      if (target && !isBlockOnScreen(target.blockId)) scrollToBlock(target.blockId);
    },
    [comments, setNote],
  );

  /** Whether the paragraph-level nav labels are riding beside the prose. */
  const leafOn = showText && fit.columns.includes(geometry.leafDepth);

  /** The gist columns actually on screen — the leaf column isn't one of them. */
  const shownGists = useMemo(
    () => fit.columns.filter((d) => d !== geometry.leafDepth),
    [fit.columns, geometry.leafDepth],
  );

  // Toggling writes the set into the URL, which also takes the columns off
  // automatic — the window should not quietly overrule a choice the reader made.
  // The `auto` control clears it again.
  const toggle = (d: number) => {
    const next = new Set(fit.columns);
    next.has(d) ? next.delete(d) : next.add(d);
    setCols([...next].sort((a, b) => a - b));
  };

  /**
   * What the L0 column renders — one sentence per part on where the argument
   * stands there, rather than the root node repeated down the whole page.
   * Null until `npm run arc` has been run for this article, and then the column
   * falls back to the root exactly as it used to. See tree.js § the arc.
   */
  const arcCells = useMemo(
    () => buildArcColumn(geometry, article.arc),
    [geometry, article.arc],
  );

  return (
    <div
      className={`reader spine-${fit.spine}`}
      /* The wrapper must be as wide as its content for the sticky bars inside it
         to have anywhere to slide — a sticky element is clamped to its containing
         block, so one exactly its own width has a sticky range of zero and never
         moves. See docs/reusable/css-sticky-containing-block.md. Set explicitly
         rather than with `max-content`, which a table of prose answers with a
         number in the thousands. */
      style={{ minWidth: fit.minWidth }}
    >
      {fit.spine !== "off" && (
        <Spine
          outline={outline}
          layoutKey={layoutKey}
          narrow={fit.spine === "narrow"}
          onJump={jumpTo}
        />
      )}
      {/* Everything constant about the article — see Masthead.tsx for why
          constant is the word that decides it belongs here and not in a
          column. */}
      <Masthead article={article} />
      <div className="controls">
        <span className="controls-label">Granularity</span>
        {gistDepths.map((d) => (
          <Toggle
            key={d}
            className={PILL}
            pressed={shownGists.includes(d)}
            onPressedChange={() => toggle(d)}
            title={`Show or hide the ${columnLabel(d, geometry.leafDepth, d === 0 && !!arcCells).toLowerCase()} column`}
          >
            L{d}
          </Toggle>
        ))}
        {/* The paragraph outline, beside the prose rather than instead of it.
            Only offered in reading mode: in outline mode this column is the
            view, and turning it off would leave nothing. */}
        {showText && (
          <Toggle
            className={PILL}
            pressed={leafOn}
            onPressedChange={() => toggle(geometry.leafDepth)}
            title="One line per paragraph, alongside the full text"
          >
            L{geometry.leafDepth}
          </Toggle>
        )}
        <Toggle
          className={PILL}
          pressed={showText}
          onPressedChange={() => setShowText((v) => !v)}
          title="Hide the text to collapse the table into a whole-article outline"
        >
          Text
        </Toggle>
        {cols === null ? (
          <span className="mode" title="Columns are following the window width">
            fit
          </span>
        ) : (
          <button
            type="button"
            className="linky"
            onClick={() => setCols(null)}
            title="Let the columns follow the window width again"
          >
            auto
          </button>
        )}
        <span className="mode">{showText ? "reading" : "outline"}</span>
        {/* The aim, said out loud. The arrows are useless as an experiment if
            you cannot tell what they are pointing at before you press one. */}
        <span
          className="keynav"
          title="Up and down arrows step through this level — move the pointer to another column to change it"
        >
          ↑↓ {columnLabel(navDepth, geometry.leafDepth)}
        </span>
        {/* Failures of the comment transport belong here rather than in the
            dialog: if the fetch never landed there is no dialog to put them in. */}
        {commentError && (
          <span className="cmt-transport-error" title={commentError}>
            comments: {commentError}
          </span>
        )}
        <span className="provenance" title={article.tree.generator}>
          {article.tree.version}
        </span>
      </div>
      <TableView
        article={article}
        sections={sections}
        layoutKey={layoutKey}
        geometry={geometry}
        columns={fit.columns}
        layout={fit}
        showText={showText}
        navDepth={navDepth}
        arcCells={arcCells}
        onJump={jumpTo}
        comments={comments}
        openComment={note}
        onSelect={(anchor) => {
          if (!anchor) return;
          void setNote(ask(anchor));
          // Drop the browser's own selection highlight. It sits on top of the
          // mark we just drew, so leaving it makes the new artefact invisible
          // until the reader happens to click elsewhere.
          window.getSelection()?.removeAllRanges();
        }}
        onOpenComment={(id) => void setNote(id)}
      />
      {openComment && (
        <CommentDialog
          comment={openComment}
          position={positionOf(ordered, note)}
          total={ordered.length}
          pending={othersPending}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => goToComment(stepComment(ordered, note, -1))}
          onNext={() => goToComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          onRetry={() => retry(openComment.id)}
          onDelete={() => {
            // Step to the neighbour rather than closing outright: deleting one
            // of five is a tidy-up, not a reason to lose the panel.
            const next = stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1);
            remove(openComment.id);
            void setNote(next);
          }}
        />
      )}
      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
        drawer={{
          comments: ordered,
          panel,
          onPanel: (next) => void setPanel(next),
          onOpenComment: (id) => {
            // Close the drawer on the way through: the dialog it opens would
            // otherwise be underneath the dim, which looks exactly like nothing
            // happening.
            void setPanel(null);
            goToComment(id);
          },
        }}
      />
    </div>
  );
}
