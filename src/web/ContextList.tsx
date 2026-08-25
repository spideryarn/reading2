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
 * The row-hover wash works both ways: pointing at an entry lights the same
 * ancestor path across the other columns that pointing at its rows does.
 *
 * **The current entry is the cell.** Everything the column's sticky cell used
 * to show — title, the author's-own-heading mark, gist, block range, the arc's
 * step marker — is shown here and nowhere else now, so nothing that was on
 * screen before the panel existed has been lost to it. The row-hover wash
 * comes along too: entries on the hovered row's ancestor path light up, which
 * is what the cells did.
 *
 * Every other entry carries a tooltip with the same content, so a landmark
 * can be read without jumping to it — the group headings too, where the card
 * is the part's own gist and is the only place it can be read from a column
 * that isn't showing parts. The group's delay is short — see ContextPanel.tsx
 * — so sweeping the list neither strobes nor waits.
 *
 * The entries are clickable `<li>`s and not buttons, deliberately. Making them
 * focusable would put every item of every level in the tab order — three
 * columns of forty sections is a hundred and twenty tab stops in front of the
 * prose — and ↑ / ↓ already step this article by level (keyboard.md). It is
 * the same trade the clickable `<td>`s in TableView.tsx make, and Biome flags
 * it there too.
 */
import type { BlockId, NodeId } from "../types.js";
import type { ContextEntry, ContextItem } from "./context.js";
import { Tooltip } from "./Tooltip.js";
import { BlockRange } from "./BlockRef.js";

interface Props {
  entries: ContextEntry[];
  onJump(blockId: BlockId): void;
  /**
   * Pointing at an entry lights its ancestors in the coarser columns, the way
   * pointing at a row does. Without it the wash *ended* the moment you moved
   * onto a panel — that is, the moment you pointed at the thing you wanted to
   * place — because the wash follows the hovered table row and the panels are
   * not in the table.
   */
  onHoverNode(id: NodeId | null): void;
  /** Node ids on the hovered row's root-to-leaf path — see TableView. */
  activeChain: Set<NodeId>;
  /** Title of the level's parent for a crumb, e.g. the part a section is in. */
  crumbFor(item: ContextItem): string | null;
}

/**
 * The arc's position marker, set as the cell set it: the number in the level's
 * tint, the `/ total` after it faded and unbolded so the pair reads as one
 * position rather than as two numbers.
 */
function Step({ index, total }: { index: number; total: number }) {
  return (
    <>
      {index}
      <span className="of"> / {total}</span>
    </>
  );
}

/** What a landmark says when hovered: the same things the open entry shows. */
function EntryCard({ item, crumb }: { item: ContextItem; crumb: string | null }) {
  const { node } = item;
  const body = item.text ?? node.gist;
  return (
    <div className="tip-entry">
      {crumb && <div className="tip-crumb">{crumb}</div>}
      <div className={item.step ? "tip-title tip-step" : "tip-title"}>
        {item.step ? <Step {...item.step} /> : node.title}
        {node.sourceHeading && <span className="own"> §</span>}
      </div>
      {body && <p className="tip-gist">{body}</p>}
    </div>
  );
}

export function ContextList({ entries, onJump, onHoverNode, activeChain, crumbFor }: Props) {
  return (
    // The list, not the panel, ends a hover: the panel is mostly padding — the
    // room the first and last items need to reach the focus line — and a
    // pointer resting in it would otherwise leave the last entry's chain lit
    // across every column with nothing under the pointer to explain why.
    <ul className="ctx-list" onMouseLeave={() => onHoverNode(null)}>
      {entries.map((e) => {
        const { node } = e.item;
        const jump = (ev: React.MouseEvent) => {
          ev.stopPropagation();
          onJump(e.item.blockId);
        };
        const enter = () => onHoverNode(node.id);
        if (e.kind === "group") {
          // The parent a run of items belongs to: where one part's sections
          // stop and the next part's begin. Clickable, like everything here,
          // and it sticks to the top of the panel while its own run scrolls
          // under it, so the part you are in is named even when its heading
          // is a long way above the current section (styles.css § .ctx-group).
          return (
            <Tooltip
              key={`g:${node.id}:${e.index}`}
              placement="right"
              className="tip-entry-panel"
              content={<EntryCard item={e.item} crumb={crumbFor(e.item)} />}
            >
              <li
                className={[
                  "ctx-group",
                  e.before ? "before" : "",
                  e.holdsCurrent ? "holds-current" : "",
                  activeChain.has(node.id) ? "active" : "",
                ].filter(Boolean).join(" ")}
                onClick={jump}
                onMouseEnter={enter}
              >
                <span className="ctx-group-title">{node.title}</span>
              </li>
            </Tooltip>
          );
        }
        const cur = e.tier === "cur";
        const heading = e.item.step ? <Step {...e.item.step} /> : node.title;
        const body = e.item.text ?? node.gist;
        const className = [
          "ctx-item",
          `tier-${e.tier}`,
          e.before ? "before" : "",
          activeChain.has(node.id) ? "active" : "",
        ].filter(Boolean).join(" ");
        // The arc's step marker is not a title and must not read as one — it
        // kept its own mono, tinted treatment in the cell and keeps it here.
        const titleClass = e.item.step ? "ctx-title ctx-step" : "ctx-title";
        if (cur) {
          return (
            <li key={node.id} className={className} onClick={jump} onMouseEnter={enter}>
              <div className={titleClass}>
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
            <li className={className} onClick={jump} onMouseEnter={enter}>
              <div className={titleClass}>
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
