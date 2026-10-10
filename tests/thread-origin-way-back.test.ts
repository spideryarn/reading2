/**
 * **The way back from an item to the chat started from it is derived**, from
 * the thread summaries the reading view already holds, and never stored on
 * the item's side (plan 261005i, D2). And where a row in Chat's list came
 * from is one pure function (D5).
 *
 * Also held here: a conversation started from a claim is **not** the chat of
 * the block the claim sits in. It has no anchor, so the prose marks, the
 * gutter chip's count and both "reopen" lookups pass it by; this keeps it so.
 */
import { describe, expect, it } from "vitest";

import { originColumns, originFromColumns } from "../src/thread-origin.js";
import {
  isClaimOrigin,
  isLensOrigin,
  MAX_ORIGIN_NAME_CHARS,
  originName,
  sameOrigin,
  type ThreadOrigin,
  type ThreadSummary,
} from "../src/types.js";
import { threadSource } from "../src/web/thread-source.js";
import {
  anchored,
  countByBlock,
  helpThreadFor,
  lensThreads,
  threadFor,
  threadForOrigin,
} from "../src/web/useChatAnchors.js";

const BLOCK = "spya-bbbbbb";
const CLAIM_WORDS = "RNA can transfer a memory";
const CLAIM: ThreadOrigin = { mode: "debate", blockId: BLOCK, quote: CLAIM_WORDS };
const LENS: ThreadOrigin = { mode: "debate", lens: "how it relates to Smith 2019" };

function summary(over: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: "Check this claim",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    kind: "chat",
    turns: 1,
    ...over,
  };
}

describe("threadForOrigin", () => {
  it("finds the conversation started from this claim", () => {
    const list = [summary({ id: "spya-aaa222" }), summary({ id: "spya-aaa333", origin: CLAIM })];
    expect(threadForOrigin(list, CLAIM)?.id).toBe("spya-aaa333");
  });

  it("finds nothing once the claim's words have changed, or for the same words in another block", () => {
    const list = [summary({ id: "spya-aaa333", origin: CLAIM })];
    expect(threadForOrigin(list, { ...CLAIM, quote: "RNA can transfer memories" })).toBeUndefined();
    expect(threadForOrigin(list, { ...CLAIM, blockId: "spya-cccccc" })).toBeUndefined();
  });

  it("takes the newest of two, by when each was last touched", () => {
    const list = [
      summary({ id: "spya-aaa333", origin: CLAIM, updatedAt: "2026-10-05T12:00:00.000Z" }),
      summary({ id: "spya-aaa444", origin: CLAIM, updatedAt: "2026-10-05T11:00:00.000Z" }),
    ];
    expect(threadForOrigin(list, CLAIM)?.id).toBe("spya-aaa333");
    expect(threadForOrigin([...list].reverse(), CLAIM)?.id).toBe("spya-aaa333");
  });

  it("finds nothing in an empty list, and ignores a thread that is not a chat", () => {
    expect(threadForOrigin([], CLAIM)).toBeUndefined();
    /* The database refuses this row; the positive test is `threadFor`'s too. */
    expect(threadForOrigin([summary({ id: "spya-aaa333", origin: CLAIM, kind: "explore" })], CLAIM)).toBeUndefined();
  });
});

describe("a conversation started from a claim is not its block's chat", () => {
  const list = [summary({ id: "spya-aaa333", origin: CLAIM })];

  it("is not what the gutter chip or the ? reopens", () => {
    expect(threadFor(list, BLOCK)).toBeUndefined();
    expect(helpThreadFor(list, BLOCK)).toBeUndefined();
  });

  it("draws no mark in the prose and adds nothing to the block's count", () => {
    expect(anchored(list)).toEqual([]);
    expect(countByBlock(list).get(BLOCK)).toBeUndefined();
  });
});

describe("threadSource", () => {
  it("says a conversation with a stored origin was started from a claim in Sources' Claims, with the claim's words", () => {
    expect(threadSource({ kind: "chat", origin: CLAIM })).toEqual({
      from: "sources",
      mode: "sources",
      label: "Started from a claim in Sources › Claims",
      quote: "RNA can transfer a memory",
    });
  });

  it("says nothing for a plain chat (the other rules are tests/thread-source.test.ts)", () => {
    expect(threadSource({ kind: "chat" })).toBeNull();
  });

  it("says a lens conversation was started from an angle in Sources' Reception, with the reader's words", () => {
    expect(threadSource({ kind: "chat", origin: LENS })).toEqual({
      from: "sources",
      mode: "sources",
      label: "Started from an angle in Sources › Reception",
      quote: "how it relates to Smith 2019",
      voice: "reader",
    });
    expect(threadSource({ kind: "chat", origin: CLAIM })?.voice, "a claim is the article's words").toBeUndefined();
  });
});

/**
 * **The second shape, a lens** (plan 261005k, A). Both shapes say
 * `mode: "debate"`, so nothing may tell them apart by the mode.
 */
describe("a lens and a claim", () => {
  it("are told apart by what they carry", () => {
    expect(isLensOrigin(LENS)).toBe(true);
    expect(isLensOrigin(CLAIM)).toBe(false);
  });

  it("are the same origin only as the same shape with the same words", () => {
    expect(sameOrigin(LENS, { ...LENS })).toBe(true);
    expect(sameOrigin(CLAIM, { ...CLAIM })).toBe(true);
    expect(sameOrigin(LENS, { mode: "debate", lens: "replication attempts" })).toBe(false);
    expect(sameOrigin(CLAIM, LENS)).toBe(false);
    expect(sameOrigin(LENS, CLAIM)).toBe(false);
    /* The lens's words are the claim's: still two different things. */
    expect(sameOrigin(CLAIM, { mode: "debate", lens: CLAIM_WORDS })).toBe(false);
    expect(sameOrigin({ mode: "debate", lens: CLAIM_WORDS }, CLAIM)).toBe(false);
  });

  it("do not find each other's conversations", () => {
    const list = [
      summary({ id: "spya-aaa333", origin: CLAIM }),
      summary({ id: "spya-aaa444", origin: LENS }),
    ];
    expect(threadForOrigin(list, CLAIM)?.id).toBe("spya-aaa333");
    expect(threadForOrigin(list, LENS)?.id).toBe("spya-aaa444");
    expect(threadForOrigin(list, { mode: "debate", lens: CLAIM_WORDS })).toBeUndefined();
  });

  it("a lens conversation is nobody's block chat either", () => {
    const list = [summary({ id: "spya-aaa444", origin: LENS })];
    expect(threadFor(list, BLOCK)).toBeUndefined();
    expect(anchored(list)).toEqual([]);
  });
});

/**
 * **A glossary entry and a cited work** (plan 261006d, D1). Each has a durable
 * id, so the id is its identity and the name stored beside it is a snapshot
 * for titles and tooltips. A regeneration that rewords the entry keeps the
 * mark; that is the difference from a claim. An idea joined them in plan 261009k.
 */
describe.each(["glossary", "bibliography", "ideas"] as const)("a %s entry's origin", (mode) => {
  const item = (over: { itemId?: string; quote?: string } = {}): ThreadOrigin => ({
    mode,
    itemId: "spya-ttm222",
    quote: "qualia",
    ...over,
  });
  const ITEM = item();
  const OTHER_MODE: ThreadOrigin = {
    mode: mode === "glossary" ? "bibliography" : "glossary",
    itemId: "spya-ttm222",
    quote: "qualia",
  };

  it("is the same origin by mode and id alone, whatever the name says", () => {
    expect(sameOrigin(ITEM, item())).toBe(true);
    expect(sameOrigin(ITEM, item({ quote: "Qualia (the felt quality)" }))).toBe(true);
    expect(sameOrigin(ITEM, item({ itemId: "spya-ttm333" }))).toBe(false);
    expect(sameOrigin(ITEM, OTHER_MODE), "the same id in the other mode is another thing").toBe(false);
    expect(sameOrigin(ITEM, CLAIM)).toBe(false);
    expect(sameOrigin(CLAIM, ITEM)).toBe(false);
    expect(sameOrigin(ITEM, LENS)).toBe(false);
    expect(sameOrigin(LENS, ITEM)).toBe(false);
  });

  it("is neither a claim nor a lens", () => {
    expect(isLensOrigin(ITEM)).toBe(false);
    expect(isClaimOrigin(ITEM)).toBe(false);
    expect(isClaimOrigin(CLAIM)).toBe(true);
    expect(isClaimOrigin(LENS)).toBe(false);
  });

  it("still finds its conversation after the entry has been renamed", () => {
    const list = [summary({ id: "spya-aaa333", origin: ITEM }), summary({ id: "spya-aaa444", origin: OTHER_MODE })];
    expect(threadForOrigin(list, item({ quote: "a new name" }))?.id).toBe("spya-aaa333");
    expect(threadForOrigin(list, item({ itemId: "spya-ttm999" }))).toBeUndefined();
  });

  it("is nobody's block chat", () => {
    const list = [summary({ id: "spya-aaa333", origin: ITEM })];
    expect(threadFor(list, BLOCK)).toBeUndefined();
    expect(anchored(list)).toEqual([]);
  });

  it("goes to its own columns and back", () => {
    const NONE = { originMode: null, originItemId: null, originBlockId: null, originQuote: null, originLens: null };
    expect(originColumns(ITEM)).toEqual({ ...NONE, originMode: mode, originItemId: "spya-ttm222", originQuote: "qualia" });
    expect(originFromColumns(originColumns(ITEM))).toEqual({ origin: ITEM });
    /* Rows the new CHECK refuses: half of one is never read as the whole. */
    expect(originFromColumns({ ...NONE, originMode: mode, originItemId: "spya-ttm222" })).toEqual({});
    expect(originFromColumns({ ...NONE, originMode: mode, originQuote: "qualia" })).toEqual({});
    expect(
      originFromColumns({ ...NONE, originMode: mode, originItemId: "spya-ttm222", originQuote: "q", originBlockId: BLOCK }),
    ).toEqual({});
  });
});

describe("originName", () => {
  it("leaves a short name alone but for its outer spaces", () => {
    expect(originName("  qualia \n")).toBe("qualia");
  });

  it("cuts a long one to the cap, without half a surrogate pair at the end", () => {
    expect(MAX_ORIGIN_NAME_CHARS).toBe(300);
    expect(originName("x".repeat(301))).toHaveLength(300);
    expect(originName("x".repeat(300))).toHaveLength(300);
    const cut = originName(`${"x".repeat(299)}😀 tail`);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut).toBe("x".repeat(299));
  });
});

describe("lensThreads", () => {
  it("lists the chats started from an angle, newest first, and nothing else", () => {
    const list = [
      summary({ id: "spya-aaa222" }),
      summary({ id: "spya-aaa333", origin: CLAIM }),
      summary({ id: "spya-aaa444", origin: LENS, updatedAt: "2026-10-05T11:00:00.000Z" }),
      summary({
        id: "spya-aaa555",
        origin: { mode: "debate", lens: "replication attempts" },
        updatedAt: "2026-10-05T12:00:00.000Z",
      }),
      /* The database refuses this row; the list is the floating chat's way in. */
      summary({ id: "spya-aaa666", origin: LENS, kind: "explore" }),
    ];
    expect(lensThreads(list).map((t) => [t.id, t.origin.lens])).toEqual([
      ["spya-aaa555", "replication attempts"],
      ["spya-aaa444", "how it relates to Smith 2019"],
    ]);
  });

  it("keeps two chats started from the same angle as two lines", () => {
    const list = [summary({ id: "spya-aaa444", origin: LENS }), summary({ id: "spya-aaa555", origin: LENS })];
    expect(lensThreads(list)).toHaveLength(2);
  });
});

/**
 * **The mapping between the union and its columns, both ways**
 * (src/thread-origin.ts). The store, the export and the seeder all call it, so
 * a shape lost here is lost in all three.
 */
describe("the origin's columns, both ways", () => {
  const NONE = { originMode: null, originItemId: null, originBlockId: null, originQuote: null, originLens: null };

  it("writes a claim as a block and a quote, with no lens", () => {
    expect(originColumns(CLAIM)).toEqual({
      ...NONE,
      originMode: "debate",
      originBlockId: BLOCK,
      originQuote: CLAIM_WORDS,
    });
  });

  it("writes a lens as the lens, with no block and no quote", () => {
    expect(originColumns(LENS)).toEqual({ ...NONE, originMode: "debate", originLens: "how it relates to Smith 2019" });
  });

  it("writes nothing for no origin", () => {
    expect(originColumns(undefined)).toEqual(NONE);
  });

  it("reads each back as it was written", () => {
    expect(originFromColumns(originColumns(CLAIM))).toEqual({ origin: CLAIM });
    expect(originFromColumns(originColumns(LENS))).toEqual({ origin: LENS });
    expect(originFromColumns(NONE)).toEqual({});
  });

  it("reads a row the database would refuse as no origin, never as half of one", () => {
    const mixed = { ...NONE, originMode: "debate", originBlockId: BLOCK, originQuote: "words", originLens: "an angle" };
    expect(originFromColumns(mixed)).toEqual({});
    expect(originFromColumns({ ...NONE, originMode: "debate" })).toEqual({});
    expect(originFromColumns({ ...NONE, originMode: "summary", originLens: "an angle" })).toEqual({});
  });
});
