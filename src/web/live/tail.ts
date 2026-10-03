/**
 * **The live words as the thread shows them: one group per exchange, in
 * conversation order.**
 *
 * Pure, so the ordering rule can be tested without a session. The hook keeps
 * its lines in arrival order, because that is how deltas find their line; the
 * thread must not show them that way. The reader can talk over an answer, so a
 * sequence like *U1, U2, then R1's words* is ordinary — and R1 belongs under
 * U1, which is where the store will file it (`ExchangeLedger`). Shown in
 * arrival order, the screen would say one thing and the saved conversation
 * another, and the one-copy handoff would make the answer jump.
 * docs/project/live-conversation.md § The three orderings, rule 1.
 */
import type { LiveLine } from "./useLiveConversation.js";

/** One reader turn and the reply to it, as far as either has arrived. */
export interface LiveGroup {
  /** Stable for the life of the exchange: the session and the reader item id. */
  key: string;
  reader: LiveLine[];
  companion: LiveLine[];
}

/**
 * Group by exchange, then order by session and the ledger's conversation
 * order. A line the ledger has not placed (`seq` Infinity) sorts after the
 * placed ones of its session, in arrival order — `Array.prototype.sort` is
 * stable, which is what that relies on.
 */
export function liveGroups(lines: readonly LiveLine[]): LiveGroup[] {
  const sorted = [...lines].sort((a, b) => a.session - b.session || compareSeq(a.seq, b.seq));
  const groups = new Map<string, LiveGroup>();
  for (const line of sorted) {
    const key = `${line.session}:${line.exchange}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, reader: [], companion: [] };
      groups.set(key, group);
    }
    (line.role === "reader" ? group.reader : group.companion).push(line);
  }
  return [...groups.values()];
}

/** `Infinity - Infinity` is NaN, which a comparator must never return. */
function compareSeq(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** How much live text there is, for the thread's follow-scroll to watch. */
export function liveSize(lines: readonly LiveLine[]): number {
  let n = 0;
  for (const line of lines) n += line.text.length + 1;
  return n;
}
