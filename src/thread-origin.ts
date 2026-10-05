/**
 * **A thread's origin, between `ThreadOrigin` and its five columns** on
 * `chat_threads` — both directions, in one file.
 *
 * The store, the export and the test seeder each name a thread's fields by
 * hand, and a field missed in one of them is lost without an error (`tools`
 * and `help` each went that way once). So the mapping is here and they call
 * it. Pure, with no store behind it, so src/store/export.ts can use it while
 * still reading the database directly.
 *
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D1;
 * the lens is docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A.
 */
import { isLensOrigin, type ThreadOrigin } from "./types.js";

/** The five columns, as a row holds them. */
export interface OriginColumns {
  originMode: string | null;
  originItemId: string | null;
  originBlockId: string | null;
  originQuote: string | null;
  originLens: string | null;
}

const NO_ORIGIN: OriginColumns = {
  originMode: null,
  originItemId: null,
  originBlockId: null,
  originQuote: null,
  originLens: null,
};

/** What to write for a thread. All null for a thread with no origin. */
export function originColumns(origin: ThreadOrigin | undefined): OriginColumns {
  if (!origin) return { ...NO_ORIGIN };
  switch (origin.mode) {
    case "debate":
      /* Two shapes under one mode: a lens, or a claim. Never both. */
      return isLensOrigin(origin)
        ? { ...NO_ORIGIN, originMode: "debate", originLens: origin.lens }
        : { ...NO_ORIGIN, originMode: "debate", originBlockId: origin.blockId, originQuote: origin.quote };
    default:
      return origin.mode satisfies never;
  }
}

/**
 * The columns back as the union, **as a fragment to spread**, so a thread with
 * no origin gets no `origin` key at all rather than `origin: undefined`.
 *
 * A mode this code does not know (the CHECK allows three that are not built
 * yet) reads as no origin: the thread is still an ordinary chat. So does a
 * debate row that is neither shape exactly, which the CHECKs refuse
 * (`chat_threads_origin_debate`); half of one is never read as the whole.
 */
export function originFromColumns(row: OriginColumns): { origin?: ThreadOrigin } {
  if (row.originMode !== "debate") return {};
  const { originBlockId: blockId, originQuote: quote, originLens: lens } = row;
  if (blockId !== null && quote !== null && lens === null) {
    return { origin: { mode: "debate", blockId, quote } };
  }
  if (blockId === null && quote === null && lens !== null) {
    return { origin: { mode: "debate", lens } };
  }
  return {};
}
