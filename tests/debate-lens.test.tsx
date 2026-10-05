// @vitest-environment jsdom
/**
 * **Debate takes a lens, and the lens is a chat** — the owner's panel.
 * Plan docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A.
 *
 * - A box at the top of the panel. Enter, or its button, hands the reader's
 *   words to the Reader and does nothing else: no search runs and nothing is
 *   sent. What happens next is Chat's.
 * - Under it, *Your angles*: one line per chat that was started from an angle,
 *   found in the reading view's thread summaries (`lensThreads`), so nothing is
 *   stored on Debate's side. A press opens that chat, as a claim's mark does.
 * - Both are there **before any Debate search exists**, and while one is
 *   loading: an angle needs no stored debate.
 * - A visitor has no chat, so their panel has neither.
 *
 * The whole trip into Chat and back is tests/debate-lens-in-chat.test.tsx.
 * Fixtures are tests/debate-claim-chat.test.tsx's, cut down.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockId, ClaimDebateRow, Debate, DebateCounts, ThreadSummary } from "../src/types.js";
import type { PublicDebate } from "../src/public-types.js";
import type { UseDebate } from "../src/web/useDebate.js";

const { DebatePanel, DEBATE_LENS_LABEL, DEBATE_LENS_SEND, DEBATE_ANGLES_HEAD, DEBATE_ANGLES_SHOWN } = await import(
  "../src/web/DebatePanel.js"
);

const BLOCK = "spya-k3m9qt" as BlockId;
const CLAIM = "a starter needs cool water";

const COUNTS: DebateCounts = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  webSearches: 2,
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

const ROW: ClaimDebateRow = {
  id: "spya-c7w2dn",
  url: "https://another.example.net/on-starters",
  title: "On starters",
  sourceQuote: "warmer water is what a day-three starter wants",
  relation: "qualifies",
  lean: "neither",
  applies: "It agrees with the claim but only above 22°C.",
  claimQuote: CLAIM,
  blockId: BLOCK,
};

const DEBATE: Debate = {
  version: "debate/1",
  generator: "a-model",
  slug: "a-piece",
  sourceHash: "hash",
  searchedAt: "2026-09-05T10:00:00.000Z",
  direct: { rows: [], counts: COUNTS },
  claims: { rows: [ROW], counts: COUNTS },
  elapsedMs: 1,
};

function owner(over: Partial<UseDebate> = {}): UseDebate {
  return {
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
    ...over,
  };
}

function summary(over: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: "Look at the debate",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    kind: "chat",
    turns: 1,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const lensed: string[] = [];
const checked: unknown[] = [];
const opened: string[] = [];
let ensured = 0;

const shared = {
  onJump: () => {},
  view: "claims" as const,
  onView: () => {},
  order: "prioritised" as const,
  onOrder: () => {},
  blockOrder: new Map<BlockId, number>([[BLOCK, 0]]),
  relevance: null,
  onRelevance: () => {},
  articleYear: null,
  thread: null,
  onThread: () => {},
  articleTitle: "Notes on my sourdough starter",
};

function paintOwner(summaries: ThreadSummary[] = [], over: Partial<UseDebate> = {}): void {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        ...shared,
        access: {
          kind: "owner",
          owner: owner({
            ensure: async () => {
              ensured++;
            },
            regenerate: async () => {
              ensured++;
            },
            ...over,
          }),
          citers: { result: { kind: "no-doi" }, retry: () => {} },
          claimChats: {
            summaries,
            onCheck: (origin) => checked.push(origin),
            onLens: (lens: string) => lensed.push(lens),
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
    claims: { rows: [ROW], sourceNotPublishable: 0 },
  } as unknown as PublicDebate;
  act(() => {
    root.render(createElement(DebatePanel, { ...shared, access: { kind: "visitor", debate } }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  lensed.length = 0;
  checked.length = 0;
  opened.length = 0;
  ensured = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const box = () => host.querySelector<HTMLInputElement>("form.dbt-lens-row input");
const send = () => host.querySelector<HTMLButtonElement>('form.dbt-lens-row button[type="submit"]');
const angles = () => [...host.querySelectorAll<HTMLButtonElement>(".dbt-angles button.dbt-angle")];

function type(text: string): void {
  const input = box() as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What Enter in the box does: the browser submits the form the box is in. */
function pressEnter(): Event {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  act(() => {
    box()?.form?.dispatchEvent(event);
  });
  return event;
}

describe("the owner's box", () => {
  it("is a labelled text box with a button, at the top of the panel", () => {
    paintOwner();
    const input = box();
    expect(input).not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe(DEBATE_LENS_LABEL);
    expect(DEBATE_LENS_LABEL).toBe("Look at the debate from an angle");
    expect(input?.maxLength, "the cap the server refuses over").toBe(600);
    expect(send()?.textContent).toContain(DEBATE_LENS_SEND);
    /* Above Reception | Claims and the list, not after them. */
    const controls = host.querySelector(".dbt-controls") as Element;
    expect(input && controls && input.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hands over the words on Enter, trimmed, and starts no search", () => {
    paintOwner();
    type("  how it relates to Smith 2019 ");
    const event = pressEnter();
    expect(lensed).toEqual(["how it relates to Smith 2019"]);
    expect(event.defaultPrevented, "the form does not navigate").toBe(true);
    expect(ensured, "no Debate search was started").toBe(0);
    expect(checked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("hands over the words from its button too", () => {
    paintOwner();
    type("replication attempts");
    expect(send()?.disabled).toBe(false);
    act(() => send()?.click());
    expect(lensed).toEqual(["replication attempts"]);
  });

  it.each([
    ["the composition flag", { isComposing: true }],
    ["the legacy composition key code", { keyCode: 229 }],
  ])("does not hand off the Enter that accepts an IME word (%s)", (_name, ime) => {
    paintOwner();
    type("記憶");
    const event = new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true, ...ime,
    });
    act(() => {
      box()?.dispatchEvent(event);
      /* jsdom has no implicit form submission: perform the browser's default
         action only if the key handler did not cancel it. */
      if (!event.defaultPrevented) box()?.form?.dispatchEvent(new Event("submit", {
        bubbles: true, cancelable: true,
      }));
    });
    expect(lensed, "accepting a word must not switch to Chat").toEqual([]);
    expect(box()?.value, "the angle remains in the box").toBe("記憶");
    /* A later Enter outside composition still hands off normally. */
    pressEnter();
    expect(lensed).toEqual(["記憶"]);
  });

  it("a second press after a handoff finds an empty box", () => {
    paintOwner();
    type("replication attempts");
    pressEnter();
    pressEnter();
    expect(lensed).toEqual(["replication attempts"]);
    expect(box()?.value).toBe("");
  });

  it("hands over nothing while it is empty or only spaces", () => {
    paintOwner();
    expect(send()?.disabled).toBe(true);
    pressEnter();
    type("   ");
    expect(send()?.disabled).toBe(true);
    pressEnter();
    expect(lensed).toEqual([]);
  });

  it("is in the reader's face: what they type is theirs", () => {
    paintOwner();
    expect(box()?.classList.contains("gloss-ask-input"), "the class voices.css names as the reader's").toBe(true);
  });

  it.each([
    ["before any search exists", { status: "none", debate: null }],
    ["while the stored search is still being read", { status: "loading", debate: null }],
    ["on a stale search", { stale: true }],
  ] as const)("is there %s", (_name, over) => {
    paintOwner([summary({ id: "spya-aaa222", origin: { mode: "debate", lens: "replication attempts" } })], over);
    expect(box()).not.toBeNull();
    expect(angles(), "and so is the list").toHaveLength(1);
    type("who funded it");
    pressEnter();
    expect(lensed).toEqual(["who funded it"]);
    expect(ensured, "an angle does not start the paid search").toBe(0);
  });
});

describe("Your angles", () => {
  const LENS = { mode: "debate", lens: "how it relates to Smith 2019" } as const;

  it("is not drawn until a chat was started from an angle", () => {
    paintOwner([
      summary({ id: "spya-aaa222" }),
      summary({ id: "spya-aaa333", origin: { mode: "debate", blockId: BLOCK, quote: CLAIM } }),
    ]);
    expect(host.querySelector(".dbt-angles")).toBeNull();
    expect(host.textContent).not.toContain(DEBATE_ANGLES_HEAD);
  });

  it("has one line per chat started from an angle, newest first, in the reader's own words", () => {
    paintOwner([
      summary({ id: "spya-aaa222", origin: LENS, updatedAt: "2026-10-05T11:00:00.000Z", turns: 2 }),
      summary({
        id: "spya-aaa333",
        origin: { mode: "debate", lens: "replication attempts" },
        updatedAt: "2026-10-05T12:00:00.000Z",
      }),
      summary({ id: "spya-aaa444", origin: { mode: "debate", blockId: BLOCK, quote: CLAIM } }),
    ]);
    expect(DEBATE_ANGLES_HEAD).toBe("Your angles");
    expect(host.querySelector(".dbt-angles")?.textContent).toContain("Your angles");
    expect(angles().map((a) => a.querySelector(".dbt-angle-words")?.textContent)).toEqual([
      "replication attempts",
      "how it relates to Smith 2019",
    ]);
    for (const a of angles()) {
      expect(a.type).toBe("button");
      expect(a.querySelector(".dbt-angle-words")?.classList.contains("voice-reader")).toBe(true);
    }
    expect(angles()[1]?.querySelector(".dbt-angle-count")?.textContent).toBe("2");
  });

  it("opens that chat on a press, and hands nothing over", () => {
    paintOwner([
      summary({ id: "spya-aaa222", origin: LENS }),
      summary({ id: "spya-aaa333", origin: { mode: "debate", lens: "replication attempts" } }),
    ]);
    const line = angles().find((a) => a.textContent?.includes("Smith 2019")) as HTMLButtonElement;
    act(() => line.click());
    expect(opened).toEqual(["spya-aaa222"]);
    expect(lensed).toEqual([]);
    expect(ensured).toBe(0);
  });

  it("keeps a claim's mark and an angle's line apart", () => {
    paintOwner([
      summary({ id: "spya-aaa222", origin: LENS }),
      summary({ id: "spya-aaa333", origin: { mode: "debate", blockId: BLOCK, quote: CLAIM } }),
      /* An angle whose words are the claim's is not the claim's chat. */
      summary({ id: "spya-aaa444", origin: { mode: "debate", lens: CLAIM }, updatedAt: "2026-10-05T13:00:00.000Z" }),
    ]);
    expect(angles()).toHaveLength(2);
    const marks = [...host.querySelectorAll<HTMLButtonElement>("summary button.dbt-claim-chat")];
    expect(marks).toHaveLength(1);
    act(() => marks[0]?.click());
    expect(opened, "the claim's mark opens the claim's chat, not the newer angle").toEqual(["spya-aaa333"]);
  });

  it("shows the newest few, and the rest on a press", () => {
    const many = Array.from({ length: DEBATE_ANGLES_SHOWN + 2 }, (_, i) =>
      summary({
        id: `spya-bbb${"23456789"[i]}22`,
        origin: { mode: "debate", lens: `angle ${i}` },
        updatedAt: `2026-10-05T1${i}:00:00.000Z`,
      }),
    );
    paintOwner(many);
    expect(angles()).toHaveLength(DEBATE_ANGLES_SHOWN);
    const more = host.querySelector<HTMLButtonElement>(".dbt-angles button.dbt-angles-more");
    expect(more?.textContent).toContain(String(many.length));
    act(() => more?.click());
    expect(angles()).toHaveLength(many.length);
    expect(host.querySelector(".dbt-angles button.dbt-angles-more")).toBeNull();
  });
});

describe("a visitor", () => {
  it("has neither the box nor the list", () => {
    paintVisitor();
    expect(host.textContent).toContain(CLAIM);
    expect(box()).toBeNull();
    expect(host.querySelector(".dbt-lens")).toBeNull();
    expect(host.querySelector(".dbt-angles")).toBeNull();
  });
});
