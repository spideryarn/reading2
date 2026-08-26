import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { throttle, useQueryState } from "nuqs";
import type { Article, BlockId } from "../types.js";
import { Library } from "./Library.js";
import { HomeLogo } from "./HomeLogo.js";
import { DesignPage } from "./DesignPage.js";
import { type ArticleView, useRoute } from "./router.js";
import { Metadata } from "./Metadata.js";
import { Tweets } from "./Tweets.js";
import { sanitizeArticle } from "./sanitize.js";
import { TableView } from "./TableView.js";
import type { TermSelection } from "./annotate.js";
import { formsOf } from "../term-match.js";
import { Spine } from "./Spine.js";
import { CommentDialog } from "./CommentDialog.js";
import { Masthead } from "./Masthead.js";
import { useSlow } from "./useSlow.js";
import { Dock } from "./Dock.js";
import { ChatPanel } from "./ChatPanel.js";
import { GlossaryPanel } from "./GlossaryPanel.js";
import { useGlossary } from "./useGlossary.js";
import { SummaryPanel } from "./SummaryPanel.js";
import { useSummaries } from "./useSummaries.js";
import { SearchPanel } from "./SearchPanel.js";
import { useSearch } from "./useSearch.js";
import {
  blockStrength,
  findLiteral,
  hitMarks as buildHitMarks,
  orderFound,
  resolveHits,
  type Found,
} from "./search-hits.js";
import { useChat } from "./useChat.js";
import { Toggle } from "@/components/ui/toggle";
import {
  buildArcColumn,
  buildGeometry,
  buildOutline,
  buildSummaryTree,
  columnLabel,
} from "./tree.js";
import {
  atParam,
  colsParam,
  deepParam,
  modeParam,
  noteParam,
  panelParam,
  rungParam,
  sortParam,
  gateParam,
  termParam,
  findParam,
  matchParam,
  orderParam,
  runParam,
  textParam,
  threadParam,
} from "./params.js";
import { isBlockOnScreen, scrollToBlock, stickyOffset } from "./scroll.js";
import { orderComments, positionOf, stepComment } from "./comment-nav.js";
import {
  activeSectionIndex,
  buildSections,
  sectionDepth,
  type Section,
} from "./position.js";
import { fitView, proseVisible } from "./layout.js";
import { navPlan, useArrowNav } from "./keynav.js";
import { useComments } from "./useComments.js";
import { PILL } from "./pill.js";



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
  // The shelf is home, so it gets no way-home logo — a link to the page you are
  // already on is a dead control, and Library.tsx names the app in its own
  // `<h1>` anyway. Everywhere else, the corner. See HomeLogo.tsx.
  if (route.kind === "library") return <Library />;
  if (route.kind === "design")
    return (
      <>
        <HomeLogo />
        <DesignPage />
      </>
    );
  return (
    <>
      <HomeLogo />
      <ArticlePage slug={route.slug} view={route.view} />
    </>
  );
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

  const slow = useSlow(!article && !error);

  if (error) return <pre className="error">{error}</pre>;
  // Silent until the wait is worth mentioning (useSlow.ts owns the threshold),
  // then a line naming what is being waited for rather than "Loading…".
  if (!article)
    return <div className="loading">{slow ? "Fetching the article and its summaries…" : ""}</div>;
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
   * Which mode owns the middle band — see params.ts § modeParam, and
   * docs/plans/chat-mode.md.
   *
   * Greg's framing, 2026-08-25: the gist columns are not a fixture with things
   * layered over them, they are *the default mode*, and chat is the second one.
   * So this is a single value the layout reads, not a flag each feature checks.
   */
  const [mode, setMode] = useQueryState("mode", modeParam);
  /* Any mode that is not the table of contents takes the band. Written as
     "not toc" rather than as `chat || glossary` on purpose: the third mode cost
     this line nothing, which is the property the slot was built for, and the
     fourth should cost it nothing either. */
  const inMode = mode !== "toc";

  /**
   * An absent `cols` means "whatever fits", not "all of them". All of them is
   * 70rem of table, so on any laptop the obvious default buries a column
   * permanently under the pinned prose. The arithmetic lives in layout.ts, where
   * it can be tested without a DOM. An explicit `cols=` still wins outright, so a
   * pasted link shows exactly what it says.
   */
  /**
   * Whether the prose is on screen — see layout.ts § proseVisible. In a mode it
   * always is, whatever `?text=` says, because outline mode is a way of reading
   * the table of contents and a mode has none. Passed to `fitView` AND to
   * TableView from one place: reading them apart is the bug this fixes.
   */
  const proseOn = proseVisible(showText, inMode);

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText: proseOn,
        chosen: cols,
        modeBand: inMode,
      }),
    [windowWidth, gistDepths, geometry.leafDepth, proseOn, cols, inMode],
  );

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

  // A string, not the array: a fresh array every render would restart the scroll
  // listener every render. `modeW` is in it because entering a mode moves every
  // row on the page sideways, and the `?at=` tracker holds row elements it
  // measured before the move.
  const layoutKey = `${fit.columns.join(",")}|${proseOn}|${windowWidth}|${fit.modeW}`;
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
   * The glossary term whose occurrences are underlined in the prose.
   *
   * **Held here rather than in the glossary band, and that is not where it
   * wants to live.** `useGlossary` fetches on mount, so it has to stay inside a
   * component that only exists in glossary mode — otherwise every reader of
   * every article pays a request for a list almost none of them open, which is
   * the same reason `ChatBand` exists. But the *marks* are drawn in the prose,
   * which is `TableView`'s, and that is here.
   *
   * So the band pushes the selection up as it changes, and clears it on the way
   * out. The state is a plain setter, which is stable, so the effect that does
   * the pushing cannot loop. It is one line more than lifting the whole hook,
   * and it is the line that keeps the fetch where it belongs.
   */
  const [term, setTerm] = useState<TermSelection | null>(null);

  /**
   * The search results whose marks are drawn in the prose, and which of them
   * the reader last pressed.
   *
   * Held here for exactly the reason `term` above is, and the comment there is
   * the full version: `useSearch` fetches on mount, so it has to live inside a
   * component that only exists in search mode, but the *marks* are drawn by
   * `TableView`, which is here. So the band pushes its results up as they
   * change and clears them on the way out.
   *
   * Note what is pushed: the **ordered, resolved** results, not the raw hits.
   * The panel and the prose must be showing the same set — see the `hitMarks`
   * prop in TableView.tsx — and the only way to guarantee that is for one of
   * them to compute it and hand it to the other.
   */
  const [found, setFound] = useState<Found[]>([]);
  const [openHit, setOpenHit] = useState<string | null>(null);

  /* Two maps, memoised separately from everything else on the page. `found`
     changes on every keystroke in words mode, and recomputing every comment's
     anchor for an article's worth of blocks at that rate is the one thing that
     would make typing feel slow. Same reasoning as the second map in
     TableView.tsx. */
  const hitMarks = useMemo(() => buildHitMarks(found, openHit), [found, openHit]);
  const hitStrength = useMemo(() => blockStrength(found), [found]);

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
   * ← / → move that aim across the columns, so the level can be chosen without
   * touching the mouse — Greg, 2026-08-26: "so that I can choose the level of
   * granularity with keyboard when jumping up/down". The rungs they step
   * between are the columns actually on screen, which is why the ladder is
   * built here, beside `fit`, rather than inside the hook.
   *
   * Suspended while the drawer is open. A reader looking at their questions is
   * not reading, and the article scrolling away underneath the dim — silently,
   * because they cannot see it move — is the kind of thing you only notice
   * afterwards, when you have lost your place.
   */
  const nav = useMemo(
    () => navPlan(geometry.cells, fit.columns, geometry.leafDepth, proseOn, !!arcCells),
    [geometry, fit.columns, proseOn, arcCells],
  );
  const navDepth = useArrowNav(
    nav,
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

  /**
   * Every block this article has, id to its plain text — for chat's citations.
   *
   * A Map rather than a scan per citation: an answer can carry a dozen ids and
   * every one is checked on every keystroke of the stream. The text rides along
   * because a citation chip shows the paragraph it points at on hover, and
   * building a separate Set of ids beside this would be a second copy of the
   * same fact.
   */
  const blockText = useMemo(
    () => new Map(article.blocks.map((b) => [b.id, b.text])),
    [article.blocks],
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

  return (
    <div
      className={`reader spine-${fit.spine}`}
      /* The wrapper must be as wide as its content for the sticky bars inside it
         to have anywhere to slide — a sticky element is clamped to its containing
         block, so one exactly its own width has a sticky range of zero and never
         moves. See docs/reusable/css-sticky-containing-block.md. Set explicitly
         rather than with `max-content`, which a table of prose answers with a
         number in the thousands. */
      style={{ minWidth: fit.minWidth, "--mode-w": `${fit.modeW}px` } as CSSProperties}
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
        {/* The granularity controls belong to the table-of-contents mode, so
            they go with it. Leaving them on screen in another mode would offer
            columns that are not there — a control that looks live, does
            nothing, and gives the reader no way to tell which. The mode's own
            name takes their place so the bar still says what the middle band
            is. */}
        {inMode ? (
          <>
            <span className="controls-label">Mode</span>
            <span className="mode on">{mode}</span>
            <button
              type="button"
              className="linky"
              onClick={() => void setMode("toc")}
              title="Back to the table of contents columns"
            >
              back to contents
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
        {/* The aim, said out loud. The arrows are useless as an experiment if
            you cannot tell what they are pointing at before you press one. */}
        <span
          className="keynav"
          title="Up and down arrows step through this level — left and right arrows, or the pointer, change which level that is"
        >
          ↑↓ {columnLabel(navDepth, geometry.leafDepth, navDepth === 0 && !!arcCells)}
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
        showText={proseOn}
        navDepth={navDepth}
        arcCells={arcCells}
        onJump={jumpTo}
        comments={comments}
        openComment={note}
        term={term}
        hitMarks={hitMarks}
        hitStrength={hitStrength}
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
      {/* The mode band. Rendered only in its mode, which is what keeps the
          fetch inside it from being charged to every reader of every article —
          see ChatBand. */}
      {mode === "chat" && (
        <ChatBand slug={slug} blocks={blockText} onJump={jumpTo} />
      )}
      {mode === "glossary" && (
        <GlossaryBand slug={slug} onJump={jumpTo} onSelected={setTerm} />
      )}
      {mode === "summary" && (
        <SummaryBand slug={slug} article={article} onJump={jumpTo} />
      )}
      {mode === "search" && (
        <SearchBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setFound}
          openHit={openHit}
          onOpenHit={setOpenHit}
        />
      )}

      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
        mode={mode}
        onMode={(next) => void setMode(next)}
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

/**
 * Chat, and the fetch that belongs to it.
 *
 * A component of its own for one reason: **`useChat` fetches on mount**, and
 * calling it up in `Reader` would charge every reader of every article a
 * request for a conversation almost none of them will open. Hooks cannot be
 * called conditionally, so the condition has to be a component boundary. Same
 * reasoning as the `drawer` prop in Dock.tsx, which exists so the metadata page
 * does not pay for comments it has no use for.
 *
 * `?thread=` lives here too, for the same reason — it is meaningless outside
 * chat mode, and reading it in `Reader` would put a parameter subscription on
 * every render of the reading view for a value only this component uses.
 */
function ChatBand({
  slug,
  blocks,
  onJump,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  const { threads, loaded, send, retry, edit, stop, begin, discard, rename, remove, error } =
    useChat(slug);
  const [thread, setThread] = useQueryState("thread", threadParam);

  /**
   * A counter that goes up whenever a *new* conversation is started, so the
   * composer knows to take focus.
   *
   * A counter and not a boolean, because "start another new chat" has to be
   * distinguishable from the last one — a boolean that is already `true` fires
   * no effect. And a counter rather than focusing from here directly, because
   * the element belongs to the composer: reaching down for it would mean a ref
   * threaded through two components that otherwise share nothing.
   *
   * Deliberately NOT raised when an existing conversation is opened. Focus in
   * the textarea means ↑/↓ stop stepping the article (keynav.ts ignores keys
   * typed into one), so taking it is only right when the reader has just asked
   * for somewhere to type.
   */
  const [focusNonce, setFocusNonce] = useState(0);
  const startNew = useCallback(() => {
    void setThread(begin());
    setFocusNonce((n) => n + 1);
  }, [begin, setThread]);

  /**
   * **An empty chat opens a conversation rather than an empty list.**
   *
   * Greg, 2026-08-26: *"By default, if no existing Chats, start a new one."*
   * The list is worth showing when there is something in it; when there is not,
   * it is a page whose only content is a button, and pressing that button is
   * the only thing anyone was ever going to do.
   *
   * `loaded` is what makes this safe. Without it, "no threads" and "the fetch
   * has not come back" are the same state, so every visit would create a thread
   * before the reader's real ones arrived — and having created one, would not
   * create one on the visit where they genuinely had none. See useChat.ts.
   *
   * It cannot loop: `begin` inserts its conversation into `threads` on the spot,
   * so the condition is false by the next render.
   *
   * **Once per visit to chat mode, and the latch is what makes closing a
   * conversation work at all.** An empty conversation the reader closes is
   * discarded (see `onDiscard` below), which puts the panel back into exactly
   * the state this effect fires on — nothing stored, nothing open — so without
   * the latch the close button would hand them a brand-new empty conversation
   * and read as broken. "By default" means on arrival; a reader who has just
   * closed the only conversation asked for the list.
   *
   * Be exact about "once", because the obvious reading is wrong: the latch is a
   * ref in a component that is unmounted whenever the reader switches to
   * another mode, so coming back to chat starts a conversation again. That is
   * the behaviour we want — arriving in chat mode is the arrival this rule is
   * about — but it does mean the latch does not survive a mode switch, and any
   * future reasoning that assumes it does will be wrong. It is reset on `slug`
   * as well, for the case the panel stays mounted across a change of article.
   *
   * `thread` is deliberately *not* in the condition. `?thread=` can name a
   * conversation that no longer exists — leave chat mode with an empty new one
   * open and the URL keeps its id while the panel takes the conversation with
   * it — and a reader coming back to that URL should get a conversation, not a
   * list they did not ask for. Starting one overwrites the stale id, which is
   * why there is no separate effect clearing it: an effect that cleared the URL
   * whenever the id was missing would also fire in the window between a first
   * question being sent and the server having written it down.
   */
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and changing article is exactly when the latch stops meaning anything
  useEffect(() => {
    started.current = false;
  }, [slug]);
  useEffect(() => {
    if (!loaded || started.current) return;
    if (threads.length === 0) {
      started.current = true;
      startNew();
    }
  }, [loaded, threads.length, startNew]);
  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. It is passed to the model so that
     "this bit" and "what he just said" resolve to where the reader actually is.
     Same read-at-render trick Dock.tsx uses for its carried query string. */
  const at = new URLSearchParams(location.search).get("at");

  return (
    <ChatPanel
      threads={threads}
      threadId={thread}
      onThread={(id) => void setThread(id)}
      onNew={startNew}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        const id = send(thread, question, at, (corrected) => void setThread(corrected));
        if (id !== thread) void setThread(id);
      }}
      onRename={rename}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `thread` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => thread && retry(thread, messageId)}
      onEdit={(messageId, question) => thread && edit(thread, messageId, question, at)}
      onStop={(messageId) => thread && stop(thread, messageId)}
      onJump={onJump}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
    />
  );
}

/**
 * The glossary, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ChatBand` above is: **`useGlossary`
 * fetches on mount** — and polls the job list while it is alive — so calling it
 * up in `Reader` would charge every reader of every article for a list almost
 * none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * `?term=` and `?sort=` live here too, for the same reason: both are
 * meaningless outside glossary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * `onSelected` is the one thing that goes back out, and it is the seam
 * described on `term` in `Reader`: the panel knows which entry is selected, the
 * prose is where its underlines are drawn, and those are two different
 * components.
 */
function GlossaryBand({
  slug,
  onJump,
  onSelected,
}: {
  slug: string;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
}) {
  const glossary = useGlossary(slug);
  const [termId, setTermId] = useQueryState("term", termParam);
  const [sort, setSort] = useQueryState("sort", sortParam);
  /* Null is "nobody has touched the threshold", which the panel resolves to
     `PRIORITY_GATE`. Kept as null rather than defaulted here so the default
     stays one number in one file — see `gateParam` in params.ts. */
  const [gate, setGate] = useQueryState("gate", gateParam);

  /* `find` returns the entry object out of `glossary.entries`, so its identity
     is stable across renders until the list itself is refetched — which is what
     keeps the effect below from firing on every render. */
  const selected = glossary.glossary?.entries.find((e) => e.id === termId) ?? null;

  useEffect(() => {
    onSelected(
      selected ? { id: selected.id, forms: formsOf(selected), blocks: selected.blocks } : null,
    );
  }, [selected, onSelected]);

  /* Leaving glossary mode must take the underlines out of the prose with it.
     Its own effect, with no dependency on `selected`, so it runs on unmount and
     only on unmount — folding it into the cleanup of the effect above would
     clear the selection on every change and set it again immediately, which is
     a visible flicker of every mark on the page. */
  useEffect(() => () => onSelected(null), [onSelected]);

  return (
    <GlossaryPanel
      {...glossary}
      termId={termId}
      onTerm={(id) => void setTermId(id)}
      sort={sort}
      onSort={(next) => void setSort(next)}
      gate={gate}
      onGate={(next) => void setGate(next)}
      onJump={onJump}
    />
  );
}

/**
 * Search, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ChatBand` and `GlossaryBand` above
 * are: **`useSearch` fetches on mount**, so calling it up in `Reader` would
 * charge every reader of every article a request for a list of saved searches
 * almost none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * All four of its URL parameters live here too, for the same reason `?term=`
 * and `?sort=` live in `GlossaryBand`: every one of them is meaningless outside
 * search mode, and reading them in `Reader` would put four parameter
 * subscriptions on every render of the reading view for values only this
 * component uses.
 *
 * ## The two matchers meet here and nowhere else
 *
 * `results` below is the whole of that design: whichever matcher is selected
 * produces a `Found[]`, and from that line onwards the panel, the marks, the
 * bar down each paragraph and the sort control are identical. Adding a third
 * way of matching would be a third arm of this one ternary.
 *
 * The literal matcher runs **in this memo**, on every keystroke, over every
 * block — which sounds alarming and is not: it is one `indexOf` loop over a few
 * hundred short strings, and it is what makes typing feel instant rather than
 * like a search you have to submit. The expensive matcher is the one that
 * already has a button.
 */
function SearchBand({
  slug,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  slug: string;
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  /* Out only. The results are computed here and pushed up to `Reader`, which
     owns the prose — the seam described on `found` there. Passing them back
     down would be a second copy of a value this component is the source of. */
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  const { runs, ask, retry, remove, error } = useSearch(slug);
  const [matcher, setMatcher] = useQueryState("match", matchParam);
  const [find, setFind] = useQueryState("find", findParam);
  const [runId, setRunId] = useQueryState("run", runParam);
  const [order, setOrder] = useQueryState("order", orderParam);

  const run = runs.find((r) => r.id === runId) ?? null;

  /* One list, two producers. Note that a `pending` or failed run resolves to
     nothing rather than to stale results: a run that has not answered yet has
     no hits, and showing the previous run's marks under this run's criterion
     would be the panel and the prose saying different things. */
  const results = useMemo(
    () =>
      orderFound(
        matcher === "words"
          ? findLiteral(blocks, find)
          : run?.status === "done"
            ? resolveHits(blocks, run.hits)
            : [],
        order,
      ),
    [matcher, blocks, find, run, order],
  );

  /* Push the results up to `Reader`, which owns the prose. `onFound` is a plain
     setter and therefore stable, so this cannot loop. */
  useEffect(() => onFound(results), [results, onFound]);

  /* Leaving search mode must take the marks out of the prose with it. Its own
     effect, with no dependency on the results, so it runs on unmount and only
     on unmount — folding it into the cleanup above would clear the marks on
     every keystroke and set them again immediately, which is a visible flicker
     of every highlight on the page. Exactly the trap `GlossaryBand` documents. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenHit(null);
    },
    [onFound, onOpenHit],
  );

  return (
    <SearchPanel
      matcher={matcher}
      onMatcher={(next) => {
        void setMatcher(next);
        // Switching matcher clears the *other* one's selection rather than
        // leaving it addressed in a URL nothing is reading. Without this,
        // flipping to words and back re-opens a saved run the reader had
        // visibly left, which looks like the toggle undoing itself.
        onOpenHit(null);
        if (next === "words") void setRunId(null);
      }}
      find={find}
      onFind={(next) => {
        void setFind(next);
        onOpenHit(null);
      }}
      runs={runs}
      runId={runId}
      onRun={(id) => {
        void setRunId(id);
        onOpenHit(null);
      }}
      onAsk={(criterion) => {
        // `ask` mints the id, so `?run=` can name the search before the model
        // has said anything — the same trick `?note=` and `?thread=` use.
        void setRunId(ask(criterion));
        onOpenHit(null);
      }}
      onRetry={retry}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a search that is not there.
        if (id === runId) void setRunId(null);
      }}
      found={results}
      order={order}
      onOrder={(next) => void setOrder(next)}
      openKey={openHit}
      onOpen={(key, blockId) => {
        onOpenHit(key);
        // Always jump, even when the block is already on screen — unlike
        // stepping between comments, which deliberately does not. A search
        // result is a place you have not been yet, and "I pressed it and
        // nothing moved" is the complaint that makes a results list feel
        // broken; two comments in one paragraph are the opposite case.
        onJump(blockId);
      }}
      error={error}
    />
  );
}

/**
 * The summaries, and the fetch that belongs to them.
 *
 * A component of its own for the reason `ChatBand` and `GlossaryBand` above
 * are: **`useSummaries` fetches on mount**, and calling it up in `Reader` would
 * charge every reader of every article a request for a panel almost none of
 * them will open. Hooks cannot be called conditionally, so the condition has to
 * be a component boundary.
 *
 * `?len=` and `?deep=` live here too, for the same reason — they are
 * meaningless outside summary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * See docs/project/summaries.md.
 */
function SummaryBand({
  slug,
  article,
  onJump,
}: {
  slug: string;
  article: Article;
  onJump(id: BlockId): void;
}) {
  const summaries = useSummaries(slug);
  const [rung, setRung] = useQueryState("len", rungParam);
  const [deep, setDeep] = useQueryState("deep", deepParam);

  /* The join: the tree, plus whatever `summary.json` has for it, matched by
     block range and never by node id — see tree.js § the summaries. Memoised on
     the artefact rather than on the hook, whose object identity changes on
     every poll of the job queue. */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, summaries.summaries),
    [article.tree, article.blocks, summaries.summaries],
  );

  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. Same read-at-render trick
     ChatBand uses, and Dock.tsx for its carried query string.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = new URLSearchParams(location.search).get("at");
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  /* Id to plain text, for the block ids the summaries cite: the panel needs it
     to tell a real id from an invented one, and to put the paragraph in a
     chip's hover card. The same map `Reader` builds for chat — built again
     here rather than threaded down, because this band is rendered only in its
     own mode and a prop would make every reader of every article pay for it. */
  const blockText = useMemo(
    () => new Map(article.blocks.map((b) => [b.id, b.text])),
    [article.blocks],
  );

  return (
    <SummaryPanel
      {...summaries}
      root={root}
      blocks={blockText}
      rung={rung}
      onRung={(next) => void setRung(next)}
      deep={deep}
      onDeep={(next) => void setDeep(next)}
      atRow={atRow}
      onJump={onJump}
    />
  );
}
