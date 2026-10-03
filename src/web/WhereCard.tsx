/**
 * **Where am I in the article**, drawn — the rows `whereRows` (src/web/where.ts)
 * builds, as a compact indented outline for a tooltip. One component so every
 * place that asks "where is this" answers the same way: Skim's position marks,
 * and the spine's band cards (plan 261003d), whose gist and sub-sections open
 * under the band's own row — Structure's fisheye, the focus expanded and its
 * context one line each.
 *
 * Text only, and it takes no pointer: a card to read, not a menu.
 *
 * **No `aria-current` on the marked row.** It marks the place this card is
 * *about* — a Skim row, a hovered band — which is not where the reader is:
 * Skim draws a card for every row, and the spine's card follows the pointer.
 * The spine's button says the reader's location itself. GPT Sol, 261003d F4.
 */
import type { ReactNode } from "react";
import { withVoice } from "./voice.js";
import type { WhereRow } from "./where.js";

const indent = (depth: number) => ({ paddingLeft: `${depth * 0.8}rem` });

export function WhereCard({
  rows,
  detail,
}: {
  rows: readonly WhereRow[];
  /** Drawn straight under the marked row, and allowed to wrap. */
  detail?: ReactNode;
}) {
  return (
    <ul className="where-card">
      {rows.flatMap((row) =>
        row.kind === "more"
          ? [
              <li key={row.key} className="where-more" style={indent(row.depth)}>
                … {row.count} more
              </li>,
            ]
          : [
              <li
                key={row.key}
                className={`where-node${row.onPath ? " on-path" : ""}${row.here ? " here" : ""}${row.of ? " with-of" : ""}`}
                style={indent(row.depth)}
              >
                {/* Keep the app-owned disclosure marker on the li in the UI face;
                    only the node title takes the voice of its source. */}
                <span className={withVoice("where-title", row.voice)}>{row.title}</span>
                {row.of && (
                  <span className="where-of">
                    {row.of.index + 1} of {row.of.total}
                  </span>
                )}
              </li>,
              ...(row.here && detail
                ? [
                    <li key={`${row.key}-detail`} className="where-detail" style={indent(row.depth + 1)}>
                      {detail}
                    </li>,
                  ]
                : []),
            ],
      )}
    </ul>
  );
}
