import { useEffect, useMemo, useState } from "react";
import type { Article } from "../types.js";
import { TableView } from "./TableView.js";
import { buildGeometry, columnLabel } from "./tree.js";

const PARAMS = new URLSearchParams(location.search);
const SLUG = PARAMS.get("slug") ?? "example";
/** `?text=0` opens straight into outline mode, so a whole-article table of
 *  contents is a shareable link and not just a button you have to find. */
const START_IN_OUTLINE = PARAMS.get("text") === "0";

export function App() {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/article/${SLUG}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        return body as Article;
      })
      .then(setArticle)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <pre className="error">{error}</pre>;
  if (!article) return <div className="loading">Loading…</div>;
  return <Reader article={article} />;
}

function Reader({ article }: { article: Article }) {
  const geometry = useMemo(
    () => buildGeometry(article.tree, article.blocks),
    [article],
  );
  // Gist columns are 0 … leafDepth-1. The leaf column is not user-toggled: it
  // only makes sense in outline mode, where it is the deepest rung of the table
  // of contents, and is meaningless beside the prose it labels.
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const [chosen, setChosen] = useState(() => new Set(gistDepths));
  const [showText, setShowText] = useState(!START_IN_OUTLINE);

  const visibleDepths = useMemo(() => {
    const next = new Set(chosen);
    if (!showText) next.add(geometry.leafDepth);
    return next;
  }, [chosen, showText, geometry.leafDepth]);

  const toggle = (d: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  const root = article.tree.nodes[article.tree.rootId];

  return (
    <div className="reader">
      <div className="masthead">
        <div className="masthead-inner">
          <h1>{article.meta.title}</h1>
          {article.meta.byline && <p className="byline">{article.meta.byline}</p>}
          {root?.gist && <p className="root-gist">{root.gist}</p>}
        </div>
      </div>
      <div className="controls">
          <span className="controls-label">Granularity</span>
          {gistDepths.map((d) => (
            <button
              key={d}
              className={chosen.has(d) ? "on" : ""}
              onClick={() => toggle(d)}
              title={`Show or hide the ${columnLabel(d, geometry.leafDepth).toLowerCase()} column`}
            >
              L{d}
            </button>
          ))}
          <button
            className={showText ? "on" : ""}
            onClick={() => setShowText((v) => !v)}
            title="Hide the text to collapse the table into a whole-article outline"
          >
            Text
          </button>
          <span className="mode">{showText ? "reading" : "outline"}</span>
          <span className="provenance" title={article.tree.generator}>
          {article.tree.version}
        </span>
      </div>
      <TableView
        article={article}
        visibleDepths={visibleDepths}
        showText={showText}
      />
    </div>
  );
}
