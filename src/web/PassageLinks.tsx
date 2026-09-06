/** Spoken passage references use the same links while arriving and after saving. */
import type { BlockId } from "../types.js";
import { BlockRef } from "./BlockRef.js";

export function PassageLinks({ passages, onJump, blocks }: {
  passages: readonly { blockIds: string[]; why: string }[];
  onJump(id: BlockId): void;
  /** Live model output is checked against this article before it becomes a link. */
  blocks?: ReadonlyMap<string, string> | undefined;
}) {
  return <ul className="chat-pointed">
    {passages.map((passage, i) => {
      const ids = [...new Set(passage.blockIds)].filter((id) => !blocks || blocks.has(id));
      if (ids.length === 0) return null;
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: an immutable stored list, or the single latest live pointer
        <li key={i}>
          {passage.why && <span className="chat-pointed-why">{passage.why}</span>}
          {ids.map((id) => <BlockRef key={id} id={id} onJump={onJump} />)}
        </li>
      );
    })}
  </ul>;
}
