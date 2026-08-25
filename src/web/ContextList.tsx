/**
 * The list a gist column draws: its whole level, the current item open and
 * the rest as landmarks. What goes in it is decided in context.ts; where it
 * sits is ContextPanel.tsx.
 *
 * Tiers are classes, not sizes computed here: `tier-cur`, `tier-near`,
 * `tier-mid`, `tier-far`, and `before` for entries already read. The
 * stylesheet gives each a fixed size — discrete steps, deliberately, see
 * context.ts — so an entry is either readable or a landmark, never in between.
 *
 * **The current entry is the cell.** Everything the column's sticky cell used
 * to show — title, the author's-own-heading mark, gist, block range, the arc's
 * step marker — is shown here and nowhere else now, so nothing that was on
 * screen before the panel existed has been lost to it. The row-hover wash
 * comes along too: entries on the hovered row's ancestor path light up, which
 * is what the cells did.
 *
 * Every other entry carries a tooltip with the same content, so a landmark
 * can be read without jumping to it. The group's delay is short — see
 * ContextPanel.tsx — so sweeping the list neither strobes nor waits.
 */
import type { BlockId, NodeId } from "../types.js";
import type { ContextEntry, ContextItem } from "./context.js";
import { Tooltip } from "./Tooltip.js";
import { BlockRange } from "./BlockRef.js";

interface Props {
  entries: ContextEntry[];
  onJump(blockId: BlockId): void;
  /** Node ids on the hovered row's root-to-leaf path — see TableView. */
  activeChain: Set<NodeId>;
  /** Title of the level's parent for a crumb, e.g. the part a section is in. */
  crumbFor(item: ContextItem): string | null;
}

/** What a landmark says when hovered: the same things the open entry shows. */
function EntryCard({ item, crumb }: { item: ContextItem; crumb: string | null }) {
  const { node } = item;
  const body = item.text ?? node.gist;
  return (
    <div className="tip-entry">
      {crumb && <div className="tip-crumb">{crumb}</div>}
      <div className="tip-title">
        {item.step ?? node.title}
        {node.sourceHeading && <span className="own"> §</span>}
      </div>
      {body && <p className="tip-gist">{body}</p>}
    </div>
  );
}

export function ContextList({ entries, onJump, activeChain, crumbFor }: Props) {
  return (
    <ul className="ctx-list">
      {entries.map((e) => {
        const { node } = e.item;
        const jump = (ev: React.MouseEvent) => {
          ev.stopPropagation();
          onJump(e.item.blockId);
        };
        if (e.kind === "group") {
          // The parent a run of items belongs to: where one part's sections
          // stop and the next part's begin. Clickable, like everything here.
          return (
            <li
              key={`g:${node.id}:${e.index}`}
              className={[
                "ctx-group",
                e.before ? "before" : "",
                e.holdsCurrent ? "holds-current" : "",
                activeChain.has(node.id) ? "active" : "",
              ].filter(Boolean).join(" ")}
              onClick={jump}
            >
              <span className="ctx-group-title">{node.title}</span>
            </li>
          );
        }
        const cur = e.tier === "cur";
        const heading = e.item.step ?? node.title;
        const body = e.item.text ?? node.gist;
        const className = [
          "ctx-item",
          `tier-${e.tier}`,
          e.before ? "before" : "",
          activeChain.has(node.id) ? "active" : "",
        ].filter(Boolean).join(" ");
        if (cur) {
          return (
            <li key={node.id} className={className} onClick={jump}>
              <div className="ctx-title">
                {heading}
                {node.sourceHeading && (
                  <span className="own" title="the author's own heading">§</span>
                )}
              </div>
              {/* Empty string for an arc with no sentence draws nothing —
                  never the part's gist, which would turn the arc column into
                  a copy of the parts column. See TableView § levels. */}
              {body && <p className="gist-text">{body}</p>}
              {!e.item.step && (
                <BlockRange className="range" range={node.range} onJump={onJump} />
              )}
            </li>
          );
        }
        return (
          <Tooltip
            key={node.id}
            placement="right"
            className="tip-entry-panel"
            content={<EntryCard item={e.item} crumb={crumbFor(e.item)} />}
          >
            <li className={className} onClick={jump}>
              <div className="ctx-title">
                {heading}
                {/* The arc column has no titles: its sentence, clamped to a
                    line, is the landmark. */}
                {e.item.step && <span className="ctx-clamp">{body}</span>}
              </div>
            </li>
          </Tooltip>
        );
      })}
    </ul>
  );
}
