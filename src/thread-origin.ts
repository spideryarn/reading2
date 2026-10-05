/**
 * **A thread's origin, between `ThreadOrigin` and its four columns** on
 * `chat_threads` — both directions, in one file.
 *
 * The store, the export and the test seeder each name a thread's fields by
 * hand, and a field missed in one of them is lost without an error (`tools`
 * and `help` each went that way once). So the mapping is here and they call
 * it. Pure, with no store behind it, so src/store/export.ts can use it while
 * still reading the database directly.
 *
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D1.
 */
import type { ThreadOrigin } from "./types.js";

/** The four columns, as a row holds them. */
export interface OriginColumns {
  originMode: string | null;
  originItemId: string | null;
  originBlockId: string | null;
  originQuote: string | null;
}

/** What to write for a thread. All null for a thread with no origin. */
export function originColumns(origin: ThreadOrigin | undefined): OriginColumns {
  if (!origin) return { originMode: null, originItemId: null, originBlockId: null, originQuote: null };
  switch (origin.mode) {
    case "debate":
      return {
        originMode: "debate",
        originItemId: null,
        originBlockId: origin.blockId,
        originQuote: origin.quote,
      };
    default:
      return origin.mode satisfies never;
  }
}

/**
 * The columns back as the union, **as a fragment to spread**, so a thread with
 * no origin gets no `origin` key at all rather than `origin: undefined`.
 *
 * A mode this code does not know (the CHECK allows three that are not built
 * yet) reads as no origin: the thread is still an ordinary chat.
 */
export function originFromColumns(row: OriginColumns): { origin?: ThreadOrigin } {
  if (row.originMode === "debate" && row.originBlockId !== null && row.originQuote !== null) {
    return { origin: { mode: "debate", blockId: row.originBlockId, quote: row.originQuote } };
  }
  return {};
}
