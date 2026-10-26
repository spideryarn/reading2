// @vitest-environment jsdom
/**
 * **Sources › Investigate, the panel** — the owner's questions for Chat. Plan
 * docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md
 * § Stage 2. Until that plan this file tested Reception's angle box (plan
 * 261005k, A), which became Investigate's box; its name is kept because the lens is
 * still the origin a typed or suggested question stores.
 *
 * - A box at the top. Enter, or its button, hands the reader's words to the
 *   Reader and does nothing else: no search runs here. What happens next is
 *   Chat's.
 * - *Suggested*: fixed questions, each one press that hands itself over.
 * - *About its claims*: from Claims' stored list only, up to four in article
 *   order, each through Claims' own sender; a claim with a chat shows its mark.
 * - *About the works it cites*: Bibliography's three most leaned on, each
 *   through Bibliography's own sender; a work with a chat shows its mark.
 * - *Your questions*: one line per lens chat, newest first, which opens it.
 * - Reception has no box any more.
 *
 * The whole trip into Chat and back is tests/reception-lens-in-chat.test.tsx.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checksOwner, claimListOwner } from "./helpers/sources-claims-owner.js";
import { sourcesHead } from "./helpers/sources-head.js";
import type {
  BlockId,
  CitedWork,
  ClaimOrigin,
  ClaimReceptionRow,
  ListedClaim,
  Reception,
  ReceptionCounts,
  ThreadSummary,
} from "../src/types.js";
import type { UseReception } from "../src/web/useReception.js";
import {
  INVESTIGATE_CLAIMS_SHOWN,
  INVESTIGATE_WORKS_SHOWN,
  INVESTIGATE_YOURS_SHOWN,
  InvestigatePanel,
  investigateWorks,
  SOURCES_INVESTIGATE_CLAIMS_HEAD,
  SOURCES_INVESTIGATE_LABEL,
  SOURCES_INVESTIGATE_OPEN_CHAT,
  SOURCES_INVESTIGATE_SEND,
  SOURCES_INVESTIGATE_SUGGESTED,
  SOURCES_INVESTIGATE_WORKS_HEAD,
  SOURCES_INVESTIGATE_SUGGESTED_HEAD,
  SOURCES_INVESTIGATE_YOURS_HEAD,
  type SourcesInvestigateChats,
} from "../src/web/InvestigatePanel.js";

const { ReceptionAndClaimsPanel } = await import("../src/web/ReceptionAndClaimsPanel.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const CLAIM = "a starter needs cool water";

function claim(i: number): ListedClaim {
  return { id: `c${i}`, blockId: BLOCK, quote: `claim number ${i}`, statement: `The piece says ${i}.` };
}

function work(id: string, relevance: number | undefined, over: Partial<CitedWork> = {}): CitedWork {
  return {
    id,
    key: `work:${id}`,
    title: `The work called ${id}`,
    authors: `Author ${id}`,
    year: "2019",
    why: "It is used.",
    ...(relevance === undefined ? {} : { relevance }),
    mentions: [],
    ...over,
  } as unknown as CitedWork;
}

function summary(over: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: "A chat",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    kind: "chat",
    turns: 1,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const asked: string[] = [];
const checked: ClaimOrigin[] = [];
const worked: string[] = [];
const opened: string[] = [];

function chats(summaries: ThreadSummary[]): SourcesInvestigateChats {
  return {
    summaries,
    /* Not loaded, so the arrival (`useReopenNewest`) stays out of these
       tests' `opened`; it is tests/reception-lens-in-chat.test.tsx's. */
    loaded: false,
    occupied: false,
    onQuestion: (q) => asked.push(q),
    onCheck: (origin) => checked.push(origin),
    onAskWork: (w) => worked.push(w.id),
    onFinding: () => {},
    onOverview: () => {},
    onOpen: (id) => opened.push(id),
  };
}

function paint(
  args: { summaries?: ThreadSummary[]; claims?: ListedClaim[] | null; works?: CitedWork[] | null } = {},
): void {
  act(() => {
    root.render(
      createElement(InvestigatePanel, {
        head: sourcesHead({ view: "investigate", onView: () => {}, ownerSlug: "a-piece" }),
        chats: chats(args.summaries ?? []),
        claims: args.claims ?? null,
        works: args.works ?? null,
      }),
    );
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked.length = 0;
  checked.length = 0;
  worked.length = 0;
  opened.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const box = () => host.querySelector<HTMLInputElement>("form.investigate-box-row input");
const send = () => host.querySelector<HTMLButtonElement>('form.investigate-box-row button[type="submit"]');
const section = (cls: string) => host.querySelector<HTMLElement>(`.investigate-section.${cls}`);
const rowsIn = (el: Element | null) => [...(el?.querySelectorAll<HTMLButtonElement>("button.investigate-q") ?? [])];
const yours = () => [...host.querySelectorAll<HTMLButtonElement>(".investigate-yours button.investigate-yours-line")];

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

describe("the box", () => {
  it("is a labelled text box with a button, under the chip row", () => {
    paint();
    const input = box();
    expect(input?.getAttribute("aria-label")).toBe(SOURCES_INVESTIGATE_LABEL);
    expect(input?.maxLength, "the cap the origin is refused over").toBe(600);
    expect(send()?.textContent).toContain(SOURCES_INVESTIGATE_SEND);
    const chips = host.querySelector(".band-head .rcp-views") as Element;
    /* A tool since plan 261025h: its chip row lights Where it sits (`chipOf`). */
    expect(chips.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Where it sits");
    expect(input && input.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("hands over the words on Enter, trimmed, and nothing else", () => {
    paint();
    type("  how it relates to Smith 2019 ");
    const event = pressEnter();
    expect(asked).toEqual(["how it relates to Smith 2019"]);
    expect(event.defaultPrevented, "the form does not navigate").toBe(true);
    expect(checked).toEqual([]);
    expect(worked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("hands over the words from its button too, then is empty", () => {
    paint();
    type("replication attempts");
    expect(send()?.disabled).toBe(false);
    act(() => send()?.click());
    expect(asked).toEqual(["replication attempts"]);
    expect(box()?.value).toBe("");
    pressEnter();
    expect(asked, "a second press after a handoff hands over nothing").toHaveLength(1);
  });

  it.each([
    ["the composition flag", { isComposing: true }],
    ["the legacy composition key code", { keyCode: 229 }],
  ])("does not hand off the Enter that accepts an IME word (%s)", (_name, ime) => {
    paint();
    type("記憶");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...ime });
    act(() => {
      box()?.dispatchEvent(event);
      if (!event.defaultPrevented) box()?.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(asked).toEqual([]);
    expect(box()?.value).toBe("記憶");
    pressEnter();
    expect(asked).toEqual(["記憶"]);
  });

  it("hands over nothing while it is empty or only spaces", () => {
    paint();
    expect(send()?.disabled).toBe(true);
    pressEnter();
    type("   ");
    pressEnter();
    expect(asked).toEqual([]);
  });

  it("is in the reader's face", () => {
    paint();
    expect(box()?.classList.contains("gloss-ask-input")).toBe(true);
  });
});

describe("the suggested questions", () => {
  it("are all there, with no list stored, and each hands itself over once", () => {
    paint();
    const rows = rowsIn(section("investigate-section"));
    expect(rows.map((r) => r.textContent)).toEqual([...SOURCES_INVESTIGATE_SUGGESTED]);
    expect(SOURCES_INVESTIGATE_SUGGESTED).toHaveLength(5);
    act(() => rows[1]?.click());
    expect(asked).toEqual([SOURCES_INVESTIGATE_SUGGESTED[1]]);
    expect(checked).toEqual([]);
    expect(worked).toEqual([]);
  });

  it("sends nothing on arrival", () => {
    paint({ claims: [claim(1)], works: [work("w1", 0.9)] });
    expect(asked).toEqual([]);
    expect(checked).toEqual([]);
    expect(worked).toEqual([]);
    expect(opened).toEqual([]);
  });
});

describe("about its claims", () => {
  it("is not drawn without Claims' list, nor for an empty one", () => {
    paint();
    expect(section("investigate-claims")).toBeNull();
    expect(host.textContent).not.toContain(SOURCES_INVESTIGATE_CLAIMS_HEAD);
    paint({ claims: [] });
    expect(section("investigate-claims")).toBeNull();
  });

  it("offers the first few in article order, in the author's words, through Claims' sender", () => {
    const claims = Array.from({ length: INVESTIGATE_CLAIMS_SHOWN + 2 }, (_, i) => claim(i));
    paint({ claims });
    const rows = rowsIn(section("investigate-claims"));
    expect(rows).toHaveLength(INVESTIGATE_CLAIMS_SHOWN);
    expect(rows[0]?.textContent).toBe("Is “claim number 0” borne out?");
    expect(rows[0]?.querySelector(".investigate-quoted")?.classList.contains("voice-author")).toBe(true);
    act(() => rows[2]?.click());
    expect(checked).toEqual([{ mode: "sources-claims", blockId: BLOCK, quote: "claim number 2" }]);
    expect(asked, "a claim is not a lens").toEqual([]);
  });

  it("shows a claim's chat as its mark, in the button's place", () => {
    paint({
      claims: [claim(0), claim(1)],
      summaries: [
        summary({ id: "spya-aaa222", origin: { mode: "sources-claims", blockId: BLOCK, quote: "claim number 1" }, gist: "It holds." }),
      ],
    });
    const items = [...(section("investigate-claims")?.querySelectorAll("li") ?? [])];
    expect(items[0]?.querySelector("button.investigate-q")).not.toBeNull();
    expect(items[1]?.querySelector("button.investigate-q")).toBeNull();
    const mark = items[1]?.querySelector<HTMLButtonElement>("button.origin-chat");
    expect(mark?.textContent).toContain("It holds.");
    act(() => mark?.click());
    expect(opened).toEqual(["spya-aaa222"]);
    expect(checked).toEqual([]);
  });
});

describe("about the works it cites", () => {
  it("is not drawn without Bibliography", () => {
    paint();
    expect(section("investigate-works")).toBeNull();
    expect(host.textContent).not.toContain(SOURCES_INVESTIGATE_WORKS_HEAD);
  });

  it("orders by how much the piece leans on each, ties in the list's order, unscored left out", () => {
    const works = [work("a", 0.5), work("b", undefined), work("c", 0.9), work("d", 0.5), work("e", 0.2)];
    expect(investigateWorks(works).map((w) => w.id)).toEqual(["c", "a", "d"]);
    expect(INVESTIGATE_WORKS_SHOWN).toBe(3);
    expect(investigateWorks([work("b", undefined)])).toEqual([]);
  });

  it("offers each through Bibliography's sender, and a work's chat as its mark", () => {
    paint({
      works: [work("a", 0.9), work("b", 0.8)],
      summaries: [summary({ id: "spya-bbb222", origin: { mode: "bibliography", itemId: "b", quote: "The work called b" } })],
    });
    const items = [...(section("investigate-works")?.querySelectorAll("li") ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("How has “The work called a” (Author a 2019) held up?");
    /* The title leads, so two works by one author in one year never read alike. */
    expect(items[1]?.textContent?.startsWith("How has “The work called b” (Author b 2019) held up?")).toBe(true);
    act(() => items[0]?.querySelector<HTMLButtonElement>("button.investigate-q")?.click());
    expect(worked).toEqual(["a"]);
    expect(items[1]?.querySelector("button.investigate-q")).toBeNull();
    act(() => items[1]?.querySelector<HTMLButtonElement>("button.origin-chat")?.click());
    expect(opened).toEqual(["spya-bbb222"]);
  });
});

describe("your questions", () => {
  const LENS = { mode: "reception", lens: "how it relates to Smith 2019" } as const;

  it("is not drawn until a chat was started from a question", () => {
    paint({
      summaries: [
        summary({ id: "spya-aaa222" }),
        summary({ id: "spya-aaa333", origin: { mode: "sources-claims", blockId: BLOCK, quote: CLAIM } }),
      ],
    });
    expect(section("investigate-yours")).toBeNull();
    expect(host.textContent).not.toContain(SOURCES_INVESTIGATE_YOURS_HEAD);
  });

  /* The reader's own conversations before ours (plan 261021b). */
  it("comes before the suggested questions", () => {
    paint({ summaries: [summary({ id: "spya-aaa222", origin: LENS })] });
    const sections = [...host.querySelectorAll(".investigate-section")];
    expect(sections[0]?.classList.contains("investigate-yours")).toBe(true);
    expect(sections[1]?.textContent).toContain(SOURCES_INVESTIGATE_SUGGESTED_HEAD);
  });

  it("has one line per lens chat, newest first, in the reader's face, with its gist", () => {
    const gist = "Two replications failed; the third used a different measure.";
    paint({
      summaries: [
        summary({ id: "spya-aaa222", origin: LENS, updatedAt: "2026-10-05T11:00:00.000Z", turns: 2, gist }),
        summary({ id: "spya-aaa333", origin: { mode: "reception", lens: "replication attempts" }, updatedAt: "2026-10-05T12:00:00.000Z" }),
        summary({ id: "spya-aaa444", origin: { mode: "sources-claims", blockId: BLOCK, quote: CLAIM } }),
      ],
    });
    expect(section("investigate-yours")?.textContent).toContain(SOURCES_INVESTIGATE_YOURS_HEAD);
    expect(yours().map((a) => a.querySelector(".investigate-yours-words")?.textContent)).toEqual([
      "replication attempts",
      LENS.lens,
    ]);
    for (const a of yours()) expect(a.querySelector(".investigate-yours-words")?.classList.contains("voice-reader")).toBe(true);
    const [fresh, gisted] = yours();
    expect(fresh?.querySelector(".investigate-yours-gist")).toBeNull();
    const line = gisted?.querySelector(".investigate-yours-gist");
    expect(line?.textContent).toBe(gist);
    expect(line?.classList.contains("voice-ai")).toBe(true);
    expect(gisted?.querySelector(".investigate-yours-count")?.textContent).toBe("2");
    expect(gisted?.getAttribute("aria-label")).toBe(`${SOURCES_INVESTIGATE_OPEN_CHAT}: ${LENS.lens}`);
    expect(gisted?.getAttribute("aria-describedby")).toBe(line?.id);
    const css = readFileSync("src/web/styles/origin-chat.css", "utf8");
    expect(css).toMatch(/\.origin-chat-gist\s*\{[^}]*overflow:\s*hidden;/s);
  });

  it("opens that chat on a press, and hands nothing over", () => {
    paint({ summaries: [summary({ id: "spya-aaa222", origin: LENS })] });
    act(() => yours()[0]?.click());
    expect(opened).toEqual(["spya-aaa222"]);
    expect(asked).toEqual([]);
  });

  it("shows the newest few, and the rest on a press", () => {
    const many = Array.from({ length: INVESTIGATE_YOURS_SHOWN + 2 }, (_, i) =>
      summary({
        id: `spya-bbb${"23456789"[i]}22`,
        origin: { mode: "reception", lens: `question ${i}` },
        updatedAt: `2026-10-05T1${i}:00:00.000Z`,
      }),
    );
    paint({ summaries: many });
    expect(yours()).toHaveLength(INVESTIGATE_YOURS_SHOWN);
    const more = host.querySelector<HTMLButtonElement>(".investigate-yours button.investigate-yours-more");
    expect(more?.textContent).toContain(String(many.length));
    act(() => more?.click());
    expect(yours()).toHaveLength(many.length);
  });
});

/* ------------------------------------------------------------ Reception -- */

const COUNTS: ReceptionCounts = {
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

const ROW: ClaimReceptionRow = {
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

const RECEPTION: Reception = {
  version: "debate/1",
  generator: "a-model",
  slug: "a-piece",
  sourceHash: "hash",
  searchedAt: "2026-09-05T10:00:00.000Z",
  direct: { rows: [], counts: COUNTS },
  claims: { rows: [ROW], counts: COUNTS },
  elapsedMs: 1,
};

function owner(over: Partial<UseReception> = {}): UseReception {
  return {
    status: "ready",
    reception: RECEPTION,
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
    rewriting: false,
    refresh: async () => {},
    ...over,
  };
}

describe("Reception and Claims", () => {
  it.each(["reception", "claims"] as const)("%s has no question box and no list of questions any more", (view) => {
    act(() => {
      root.render(
        createElement(ReceptionAndClaimsPanel, {
          head: sourcesHead({ view, onView: () => {}, ownerSlug: "a-piece" }),
          onJump: () => {},
          view,
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
          access: {
            kind: "owner",
            owner: owner(),
            claimList: claimListOwner(),
            checks: checksOwner(),
            citers: { result: { kind: "no-doi" }, retry: () => {} },
            claimChats: {
              summaries: [summary({ id: "spya-aaa222", origin: { mode: "reception", lens: "replication attempts" } })],
              onCheck: () => {},
              onOpen: () => {},
            },
          },
        }),
      );
    });
    expect(host.querySelector(".mode-band")).not.toBeNull();
    expect(host.querySelector(".investigate-box, .rcp-lens, .investigate-yours, .rcp-angles")).toBeNull();
    expect(host.textContent).not.toContain("replication attempts");
    expect(host.textContent).not.toContain("Look at the debate from an angle");
  });
});
