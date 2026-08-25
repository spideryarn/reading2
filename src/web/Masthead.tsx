/**
 * The article-level chrome: what the piece is, before you start reading it.
 *
 * Greg, 2026-08-25:
 *
 * > Let's add the title etc (along with any other metadata we have and useful
 * > related UI) to the top masthead row, perhaps with a down-arrow to expand
 * > that to show more information.
 *
 * This is where the *constant* facts about the article live, and that word is
 * doing the work. The reading view's horizontal axis means granularity and its
 * vertical axis means position, so anything that varies along neither belongs
 * in chrome rather than in a column — which is exactly what the old L0 column
 * got wrong (tree.js § the arc). Title, byline, source, counts: all constant,
 * all here.
 *
 * Two levels, because most of it is worth knowing once and then never again:
 *
 *  - **Always visible** — title, who wrote it and where, and the one-sentence
 *    gist of the whole piece. The facts you want before deciding to read.
 *  - **Behind the ▾** — provenance and shape: the source link, the counts, and
 *    which model built the tree and the arc. The facts you want when something
 *    looks wrong, which is rarely, and never while reading.
 *
 * The disclosure is URL state like everything else (`?about=1`), so a link to
 * an article can arrive with its provenance already open — see params.ts.
 *
 * Note the masthead scrolls away by design (it is `position: sticky` only on
 * the horizontal axis, so it stays put when the table scrolls sideways). What
 * stays with you as you read is the spine and the arc column, not this.
 */
import { useMemo } from "react";
import type { Article } from "../types.js";

/** Words per minute. The middling end of the usual 200–250 range for prose. */
const WPM = 230;

interface Props {
  article: Article;
  expanded: boolean;
  onToggle(): void;
}

/** Everything countable about the article, derived rather than stored. */
function useStats(article: Article) {
  return useMemo(() => {
    const words = article.blocks.reduce((n, b) => n + b.words, 0);
    const byDepth = new Map<number, number>();
    for (const node of Object.values(article.tree.nodes)) {
      byDepth.set(node.depth, (byDepth.get(node.depth) ?? 0) + 1);
    }
    return {
      words,
      minutes: Math.max(1, Math.round(words / WPM)),
      blocks: article.blocks.length,
      parts: byDepth.get(1) ?? 0,
      sections: byDepth.get(2) ?? 0,
    };
  }, [article]);
}

export function Masthead({ article, expanded, onToggle }: Props) {
  const { meta, tree, arc } = article;
  const stats = useStats(article);
  const root = tree.nodes[tree.rootId];

  // Only the parts of the facts line this article actually has. Joining a
  // filtered list beats a chain of `&&`s that can leave a stranded separator.
  const facts = [
    meta.byline,
    meta.siteName,
    `${stats.words.toLocaleString()} words`,
    `~${stats.minutes} min`,
    `${stats.parts} parts`,
    `${stats.sections} sections`,
  ].filter(Boolean) as string[];

  return (
    <div className="masthead">
      <div className="masthead-inner">
        <div className="masthead-head">
          <h1>
            {meta.url ? (
              <a href={meta.url} target="_blank" rel="noreferrer noopener">
                {meta.title}
              </a>
            ) : (
              meta.title
            )}
          </h1>
          <button
            className="disclose"
            aria-expanded={expanded}
            onClick={onToggle}
            title={expanded ? "Hide article details" : "Show article details"}
          >
            <span className={`chevron${expanded ? " up" : ""}`} aria-hidden="true">
              ▾
            </span>
          </button>
        </div>

        <p className="facts">
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </p>

        {/* The whole piece in one sentence — the coarsest thing there is, and
            constant, so it belongs here rather than in a column. */}
        {root?.gist && <p className="root-gist">{root.gist}</p>}

        {expanded && (
          <dl className="about">
            {meta.url && (
              <>
                <dt>Source</dt>
                <dd>
                  <a href={meta.url} target="_blank" rel="noreferrer noopener">
                    {meta.url}
                  </a>
                </dd>
              </>
            )}
            <dt>Slug</dt>
            <dd className="mono">{meta.slug}</dd>
            {meta.lang && (
              <>
                <dt>Language</dt>
                <dd>{meta.lang}</dd>
              </>
            )}
            <dt>Shape</dt>
            <dd>
              {stats.parts} parts · {stats.sections} sections · {stats.blocks} blocks ·{" "}
              {stats.words.toLocaleString()} words
            </dd>
            <dt>Tree</dt>
            <dd className="mono">
              {tree.generator} · {tree.version}
            </dd>
            {/* Absent until `npm run arc` has run, and saying so is the quickest
                answer to "why is the left column empty?". */}
            <dt>Arc</dt>
            <dd className="mono">
              {arc ? `${arc.generator} · ${arc.version}` : "not generated"}
            </dd>
            {root?.summary && (
              <>
                <dt>Summary</dt>
                <dd>{root.summary}</dd>
              </>
            )}
            {meta.note && (
              <>
                <dt>Note</dt>
                <dd>{meta.note}</dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
