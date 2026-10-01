/**
 * **Where am I in the article**, drawn — the rows `whereRows` (src/web/where.ts)
 * builds, as a compact indented outline for a tooltip. One component so every
 * place that asks "where is this" answers the same way: Skim's position
 * marks now, and the spine's band cards once they have a bounded, node-based
 * version (plan 260929f § Deferred, Sol F1–F2).
 *
 * Text only, and it takes no pointer: a card to read, not a menu.
 */
import type { WhereRow } from "./where.js";

export function WhereCard({ rows }: { rows: readonly WhereRow[] }) {
  return (
    <ul className="where-card">
      {rows.map((row) =>
        row.kind === "more" ? (
          <li key={row.key} className="where-more" style={{ paddingLeft: `${row.depth * 0.8}rem` }}>
            … {row.count} more
          </li>
        ) : (
          <li
            key={row.key}
            className={`where-node${row.onPath ? " on-path" : ""}${row.here ? " here" : ""}`}
            style={{ paddingLeft: `${row.depth * 0.8}rem` }}
            aria-current={row.here ? "location" : undefined}
          >
            {row.title}
          </li>
        ),
      )}
    </ul>
  );
}
