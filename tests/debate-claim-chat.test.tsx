// @vitest-environment jsdom
/**
 * **A claim in Debate › Claims can start a chat about itself, and shows the
 * way back to one already started** — the owner's panel only.
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D2, D4 and D6.
 *
 * - The button hands over the claim by its identity, `(blockId, claimQuote)`,
 *   and nothing else. It spends nothing: what happens next is Chat's.
 * - The mark is derived from the reading view's thread summaries
 *   (`threadForOrigin`), so nothing is stored on the claim. It shows how many
 *   exchanges there were and the opening of the latest answer.
 * - Both sit inside the claim's `<summary>`, and a press on either must not
 *   fold the claim.
 * - A visitor's panel has no handler to be given, and draws neither.
 *
 * Fixtures are tests/debate-panel.test.tsx's, cut down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockId, ClaimDebateRow, Debate, DebateCounts, ThreadOrigin, ThreadSummary } from "../src/types.js";
import type { PublicDebate } from "../src/public-types.js";
import type { UseDebate } from "../src/web/useDebate.js";

const { DebatePanel, DEBATE_CHECK_CLAIM, DEBATE_OPEN_CLAIM_CHAT } = await import("../src/web/DebatePanel.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const OTHER_BLOCK = "spya-p7w2xz" as BlockId;
const FIRST = "a starter needs cool water";
const SECOND = "rye ferments faster than wheat";

const COUNTS: DebateCounts = {
  returnedSources: 2,
  reportedRows: 2,
  keptRows: 2,
  omittedOverCap: 0,
  webSearches: 3,
  lost: {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  },
};

function claim(over: Partial<ClaimDebateRow> = {}): ClaimDebateRow {
  return {
    id: "spya-c7w2dn",
    url: "https://another.example.net/on-starters",
    title: "On starters",
    sourceQuote: "warmer water is what a day-three starter wants",
    relation: "qualifies",
    lean: "neither",
    applies: "It agrees with the claim but only above 22°C.",
    claimQuote: FIRST,
    blockId: BLOCK,
    ...over,
  };
}

const ROWS = [
  claim(),
  claim({ id: "spya-c7w2dp", url: "https://example.org/rye", title: "On rye", claimQuote: SECOND, blockId: OTHER_BLOCK }),
];

const DEBATE: Debate = {
  version: "debate/1",
  generator: "a-model",
  slug: "a-piece",
  sourceHash: "hash",
  searchedAt: "2026-09-05T10:00:00.000Z",
  direct: { rows: [], counts: COUNTS },
  claims: { rows: ROWS, counts: COUNTS },
  elapsedMs: 1,
};

const OWNER: UseDebate = {
  status: "ready",
  debate: DEBATE,
  stale: false,
  outdated: false,
  slug: "a-piece",
  error: null,
  retryRead: async () => {},
  job: null,
  failed: null,
  stalled: false,
  starting: false,
  automatic: false,
  ensure: async () => {},
  regenerate: async () => {},
  cancel: () => {},
};

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

let host: HTMLDivElement;
let root: Root;
const checked: ThreadOrigin[] = [];
const opened: string[] = [];

const shared = {
  onJump: () => {},
  view: "claims" as const,
  onView: () => {},
  order: "prioritised" as const,
  onOrder: () => {},
  blockOrder: new Map<BlockId, number>([
    [BLOCK, 0],
    [OTHER_BLOCK, 1],
  ]),
  relevance: null,
  onRelevance: () => {},
  articleYear: null,
  thread: null,
  onThread: () => {},
  articleTitle: "Notes on my sourdough starter",
};

function paintOwner(summaries: ThreadSummary[] = []): void {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        ...shared,
        access: {
          kind: "owner",
          owner: OWNER,
          citers: { result: { kind: "no-doi" }, retry: () => {} },
          claimChats: {
            summaries,
            onCheck: (origin: ThreadOrigin) => checked.push(origin),
            /* The angle box is tests/debate-lens.test.tsx's. */
            onLens: () => {},
            onOpen: (id: string) => opened.push(id),
          },
        },
      }),
    );
  });
}

function paintVisitor(): void {
  const debate = {
    searchedAt: DEBATE.searchedAt,
    direct: { rows: [], sourceNotPublishable: 0 },
    claims: { rows: ROWS, sourceNotPublishable: 0 },
  } as unknown as PublicDebate;
  act(() => {
    root.render(createElement(DebatePanel, { ...shared, access: { kind: "visitor", debate } }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  checked.length = 0;
  opened.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const groups = () => [...host.querySelectorAll<HTMLDetailsElement>("details.dbt-claim-group")];
const checkButtons = () =>
  [...host.querySelectorAll<HTMLButtonElement>(`summary button[aria-label="${DEBATE_CHECK_CLAIM}"]`)];
const marks = () => [...host.querySelectorAll<HTMLButtonElement>("summary button.dbt-claim-chat")];

/** A real click, and whether anything stopped the `<summary>` from acting on it. */
function press(button: HTMLButtonElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(event);
  });
  return event;
}

describe("the owner's claims", () => {
  it("each have a button, named for what it does", () => {
    paintOwner();
    expect(groups()).toHaveLength(2);
    expect(DEBATE_CHECK_CLAIM).toBe("Check this claim in chat");
    expect(checkButtons()).toHaveLength(2);
    for (const b of checkButtons()) expect(b.type).toBe("button");
  });

  it("hand over that claim's block and words, and do not fold the claim", () => {
    paintOwner();
    const event = press(checkButtons()[1] as HTMLButtonElement);
    expect(checked).toEqual([{ mode: "debate", blockId: OTHER_BLOCK, quote: SECOND }]);
    expect(event.defaultPrevented, "the summary's own toggle is cancelled").toBe(true);
    expect(groups().every((g) => g.open)).toBe(true);
    expect(opened).toEqual([]);
  });

  it("draw no mark before any chat was started from them", () => {
    paintOwner([summary({ id: "spya-aaa222" })]);
    expect(marks()).toHaveLength(0);
  });

  it("draw a mark on the claim a chat was started from: its exchanges and the latest answer's opening", () => {
    paintOwner([
      summary({
        id: "spya-aaa222",
        origin: { mode: "debate", blockId: BLOCK, quote: FIRST },
        turns: 2,
        lastLine: "The strongest reply is that it depends on the flour.",
      }),
    ]);
    expect(marks()).toHaveLength(1);
    const mark = marks()[0] as HTMLButtonElement;
    expect(groups()[0]?.contains(mark), "on the first claim, not the second").toBe(true);
    expect(mark.getAttribute("aria-label")).toBe(DEBATE_OPEN_CLAIM_CHAT);
    expect(mark.querySelector(".dbt-claim-chat-count")?.textContent).toBe("2");
    const line = mark.querySelector(".dbt-claim-chat-line");
    expect(line?.textContent).toBe("The strongest reply is that it depends on the flour.");
    expect(line?.classList.contains("voice-ai"), "a model's words, in the model's face").toBe(true);
    /* The button to start another stays. */
    expect(checkButtons()).toHaveLength(2);
  });

  it("say so when the chat has no finished answer yet", () => {
    paintOwner([summary({ id: "spya-aaa222", origin: { mode: "debate", blockId: BLOCK, quote: FIRST } })]);
    const mark = marks()[0] as HTMLButtonElement;
    expect(mark.querySelector(".dbt-claim-chat-count")?.textContent).toBe("1");
    expect(mark.querySelector(".dbt-claim-chat-line")).toBeNull();
  });

  it("open that conversation from the mark, without folding the claim", () => {
    paintOwner([
      summary({ id: "spya-aaa222", origin: { mode: "debate", blockId: BLOCK, quote: FIRST }, lastLine: "No." }),
    ]);
    const event = press(marks()[0] as HTMLButtonElement);
    expect(opened).toEqual(["spya-aaa222"]);
    expect(checked).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("lose the mark when the claim is worded differently, or sits in another block", () => {
    paintOwner([
      summary({ id: "spya-aaa222", origin: { mode: "debate", blockId: BLOCK, quote: "a starter wants cool water" } }),
      summary({ id: "spya-aaa333", origin: { mode: "debate", blockId: OTHER_BLOCK, quote: FIRST } }),
    ]);
    expect(marks()).toHaveLength(0);
  });

  it("open the newest of two conversations started from the same claim", () => {
    const origin: ThreadOrigin = { mode: "debate", blockId: BLOCK, quote: FIRST };
    paintOwner([
      summary({ id: "spya-aaa222", origin, updatedAt: "2026-10-05T11:00:00.000Z" }),
      summary({ id: "spya-aaa333", origin, updatedAt: "2026-10-05T12:00:00.000Z" }),
    ]);
    expect(marks()).toHaveLength(1);
    press(marks()[0] as HTMLButtonElement);
    expect(opened).toEqual(["spya-aaa333"]);
  });
});

describe("a visitor's claims", () => {
  it("have the claims and neither the button nor a mark", () => {
    paintVisitor();
    expect(groups()).toHaveLength(2);
    expect(host.textContent).toContain(FIRST);
    expect(checkButtons()).toHaveLength(0);
    expect(marks()).toHaveLength(0);
    /* Only the door to the passage is pressable in a claim's heading. */
    expect(host.querySelectorAll("summary button")).toHaveLength(0);
  });
});
