import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../types.js";
import { TableView } from "./TableView.js";
import { Spine } from "./Spine.js";
import { CommentDialog } from "./CommentDialog.js";
import { Masthead } from "./Masthead.js";
import { buildArcColumn, buildGeometry, buildOutline, columnLabel } from "./tree.js";
import { aboutParam, atParam, colsParam, noteParam, slugParam, textParam } from "./params.js";
import { scrollToBlock, stickyOffset } from "./scroll.js";
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
 * Nothing here is `useState` any more except the fetched article itself, which
 * is derived from the URL rather than part of it. Everything the reader can
 * change lives in the query string — see params.js for why, and for which of
 * these changes push a history entry and which quietly replace one.
 */
export function App() {
  const [slug] = useQueryState("slug", slugParam);
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Slug is URL state now, so it can change under us — via back/forward, or a
    // pasted link. Guard the response so a slow first fetch can't overwrite a
    // fast second one.
    let live = true;
    setArticle(null);
    setError(null);
    fetch(`/api/article/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        return body as Article;
      })
      .then((a) => live && setArticle(a))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug]);

  if (error) return <pre className="error">{error}</pre>;
  if (!article) return <div className="loading">Loading…</div>;
  // Keyed on the slug so switching article remounts rather than trying to carry
  // one article's reading position into another's blocks.
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
  return useCallback(
    (blockId: BlockId) => {
      synced.current = blockId;
      void setAt(blockId, { history: "push", limitUrlUpdates: undefined });
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
   * ↑ / ↓ step through one level of the tree, and *which* level is whichever
   * column the pointer is sitting in — see keynav.ts. It writes no state of its
   * own: it scrolls, and the listener above notices, exactly as it would for a
   * wheel. Off any tagged column the stride falls back to the section, which is
   * the unit `?at=` already stores.
   */
  const navDepth = useArrowNav(geometry, article.blocks, sectionDepth(geometry));

  /**
   * Comments: selecting prose asks a question of the model, and the answer
   * arrives in a floating dialog. See docs/project/comments.md.
   *
   * Note what is *not* here — no column, no change to `fit`, nothing threaded
   * through the layout arithmetic. That was the point of choosing a dialog.
   */
  const [note, setNote] = useQueryState("note", noteParam);
  const { comments, ask, retry, remove, error: commentError } = useComments(slug);
  const openComment = comments.find((c) => c.id === note) ?? null;

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

  const [about, setAbout] = useQueryState("about", aboutParam);

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
      <Masthead
        article={article}
        expanded={about}
        onToggle={() => void setAbout(about ? null : true)}
      />
      <div className="controls">
        <span className="controls-label">Granularity</span>
        {gistDepths.map((d) => (
          <button
            key={d}
            className={shownGists.includes(d) ? "on" : ""}
            onClick={() => toggle(d)}
            title={`Show or hide the ${columnLabel(d, geometry.leafDepth, d === 0 && !!arcCells).toLowerCase()} column`}
          >
            L{d}
          </button>
        ))}
        {/* The paragraph outline, beside the prose rather than instead of it.
            Only offered in reading mode: in outline mode this column is the
            view, and turning it off would leave nothing. */}
        {showText && (
          <button
            className={leafOn ? "on" : ""}
            onClick={() => toggle(geometry.leafDepth)}
            title="One line per paragraph, alongside the full text"
          >
            L{geometry.leafDepth}
          </button>
        )}
        <button
          className={showText ? "on" : ""}
          onClick={() => setShowText((v) => !v)}
          title="Hide the text to collapse the table into a whole-article outline"
        >
          Text
        </button>
        {cols === null ? (
          <span className="mode" title="Columns are following the window width">
            fit
          </span>
        ) : (
          <button
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
          onClose={() => void setNote(null)}
          onRetry={() => retry(openComment.id)}
          onDelete={() => {
            remove(openComment.id);
            void setNote(null);
          }}
        />
      )}
    </div>
  );
}
