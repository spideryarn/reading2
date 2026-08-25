/**
 * The list a column context mode draws — shared by the in-cell modes in
 * TableView.tsx and the hoisted ContextPanel.tsx, so the four experiments
 * differ only in *where* the list sits and what it contains, never in how an
 * entry looks. What goes in it is decided in context.ts.
 *
 * Tiers are classes, not sizes computed here: `tier-cur`, `tier-near`,
 * `tier-mid`, `tier-far`, and `before` for entries already read. The
 * stylesheet gives each a fixed size — discrete steps, deliberately, see
 * context.ts — so an entry is either readable or a landmark, never in between.
 */
import type { BlockId } from "../types.js";
import type { ContextEntry } from "./context.js";

interface Props {
  entries: ContextEntry[];
  onJump(blockId: BlockId): void;
  /** Draw the progress hairline under the current entry. */
  progress: boolean;
  /** The depth, so the hairline can read its own `--ctx-progress-<depth>`. */
  depth: number;
}

export function ContextList({ entries, onJump, progress, depth }: Props) {
  return (
    <ul className="ctx-list">
      {entries.map((e) => {
        const { node } = e.item;
        if (e.kind === "group") {
          // A parent named at the edge of the list: where the siblings stop
          // and the next part begins. Clickable, like everything else here.
          return (
            <li
              key={`g:${node.id}:${e.index}`}
              className={`ctx-group${e.before ? " before" : ""}`}
              onClick={(ev) => {
                ev.stopPropagation();
                onJump(e.item.blockId);
              }}
            >
              {e.before ? "↑ " : "↓ "}
              {node.title}
            </li>
          );
        }
        const cur = e.tier === "cur";
        // The arc column has no titles: its step marker stands in, and the
        // sentence itself is the landmark, clamped to a line when not current.
        const heading = e.item.step ?? node.title;
        const body = e.item.text ?? node.gist;
        return (
          <li
            key={node.id}
            className={`ctx-item tier-${e.tier}${e.before ? " before" : ""}`}
            onClick={(ev) => {
              ev.stopPropagation();
              onJump(e.item.blockId);
            }}
          >
            <div className="ctx-title">
              {heading}
              {e.item.step && !cur && <span className="ctx-clamp">{body}</span>}
            </div>
            {cur && body && <p className="gist-text">{body}</p>}
            {cur && progress && (
              <div className="ctx-progress">
                <div
                  className="ctx-progress-fill"
                  style={{ width: `calc(var(--ctx-progress-${depth}, 0) * 100%)` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
