import { useEffect, useMemo, useState } from "react";
import type { Article } from "../types.js";
import { TableView } from "./TableView.js";
import { buildGeometry } from "./tree.js";

const SLUG = new URLSearchParams(location.search).get("slug") ?? "example";

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
  const allDepths = geometry.columnDepths;
  const [visibleDepths, setVisible] = useState(() => new Set(allDepths));
  const [showText, setShowText] = useState(true);

  const toggle = (d: number) =>
    setVisible((prev) => {
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
          {allDepths.map((d) => (
            <button
              key={d}
              className={visibleDepths.has(d) ? "on" : ""}
              onClick={() => toggle(d)}
            >
              L{d}
            </button>
          ))}
          <button
            className={showText ? "on" : ""}
            onClick={() => setShowText((v) => !v)}
          >
            Text
          </button>
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
