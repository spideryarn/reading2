// @vitest-environment jsdom
/**
 * **Sources › Where it sits** (WhereItSitsPanel.tsx) — the owner's default
 * since plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md.
 *
 * - The head line and the order of *Papers that cite it* and *What it builds on*, from the
 *   piece's year (`whereHeadLine`, `whereOrder`).
 * - *Papers that cite it* is Reception's *Cited by* answer, with the same sentences.
 * - *What it builds on* is Bibliography's most relied-on works, each opening its row.
 * - The tools row moves to a tool and arms nothing; a tool's *← Where it
 *   sits* comes back.
 * - The literature search's button is there with nothing stored.
 *
 * The band mounted in a reader, with the switch off and the network watched,
 * is tests/reception-lens-in-chat.test.tsx § Where it sits.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourcesHead } from "./helpers/sources-head.js";
import { CITERS_NO_MATCH } from "../src/messages.js";
import { relatedWorkYearOf } from "../src/related-work.js";
import type { CitedWork, CitersResult } from "../src/types.js";
import { pendingActivation, resetActivations } from "../src/web/activation.js";
import { pieceYear } from "../src/web/modes/sources/SourcesMode.js";
import type { SourcesView } from "../src/web/params.js";
import { SITUATE_RUN } from "../src/web/situate-dossier.js";
import { whereToolCounts } from "../src/web/sources-counts.js";
import type { UseSituate } from "../src/web/useSituate.js";
import {
  SOURCES_TOOL_LABEL,
  SOURCES_TOOLS,
  titleIsOnlyByline,
  ToolBack,
  WHERE_AFTER_HEAD,
  WHERE_BEFORE_HEAD,
  WHERE_BEFORE_NONE,
  WHERE_BEFORE_UNRATED,
  whereHeadLine,
  WhereItSitsPanel,
  whereOrder,
  type WhereBefore,
} from "../src/web/WhereItSitsPanel.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const moved: SourcesView[] = [];
const openedWorks: string[] = [];
/** Each press of *About "keyword"* that asked for the keyword view (`askTopic`). */
let topicAsks = 0;

beforeEach(() => {
  moved.length = 0;
  openedWorks.length = 0;
  topicAsks = 0;
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetActivations();
});

function noDossier(): UseSituate {
  return {
    status: "none",
    situate: null,
    stale: false,
    outdated: false,
    profileChanged: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    refresh: async () => {},
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

function work(id: string, title: string, relevance?: number): CitedWork {
  return { id, title, authors: "Smith, J.", year: "2001", ...(relevance !== undefined ? { relevance } : {}) } as CitedWork;
}

const FOUND: CitersResult = {
  kind: "found",
  via: "doi",
  target: { openalexId: "W123", title: "The piece" },
  count: 7,
  returned: 7,
  dropped: 0,
  capped: false,
  citers: Array.from({ length: 7 }, (_, i) => ({
    openalexId: `W${i + 1}0`,
    title: `Citing paper ${i + 1}`,
    authors: ["A. Author"],
    authorCount: 1,
    citedByCount: 100 - i,
  })),
  fetchedAt: "2026-10-25T10:00:00.000Z",
};

function draw({
  year = null,
  citers = FOUND,
  topic = undefined,
  experiments = false,
  before = { status: "ready", works: [work("w1", "Leaned on", 0.9), work("w2", "Less so", 0.2), work("w3", "Unrated")], listing: false },
}: {
  year?: number | null;
  citers?: CitersResult | null;
  /** The keyword view's answer as `useCiters` holds it: `undefined` until asked, `null` while asking. */
  topic?: CitersResult | null | undefined;
  experiments?: boolean;
  before?: WhereBefore;
} = {}): void {
  act(() =>
    root.render(
      createElement(WhereItSitsPanel, {
        head: sourcesHead({ view: "where", onView: (v) => moved.push(v), ownerSlug: "a-piece" }),
        situate: noDossier(),
        citers: {
          result: citers,
          retry: () => {},
          topic,
          askTopic: () => {
            topicAsks += 1;
          },
          retryTopic: () => {},
        },
        experiments,
        before,
        articleYear: year,
        chats: { summaries: [], onFinding: () => {}, onOpen: () => {} },
        onJump: () => {},
        onOpenWork: (id) => openedWorks.push(id),
        onView: (v) => moved.push(v),
        toolCounts: { reception: 3, claims: 0 },
        now: () => 2026,
      }),
    ),
  );
}
const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
const button = (words: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim().startsWith(words));

describe("the head line and the order, from the piece's year", () => {
  it("says what has been said since for an older piece, where it sits now for a recent one, and neither with no year", () => {
    expect(whereHeadLine(1998, 2026)).toBe("A piece from 1998: what has been said since");
    expect(whereHeadLine(2025, 2026)).toBe("A piece from 2025: where it sits now");
    expect(whereHeadLine(null, 2026)).not.toMatch(/\d/);
    expect([whereOrder(1998, 2026), whereOrder(2025, 2026), whereOrder(null, 2026)]).toEqual([
      "after-first",
      "before-first",
      "side-by-side",
    ]);
  });

  it("puts Papers that cite it first for an older piece and What it builds on first for a recent one", () => {
    const order = () => [...host.querySelectorAll(".where-lists > section")].map((s) => s.className);
    draw({ year: 1998 });
    expect(text()).toContain("A piece from 1998: what has been said since");
    expect(order()[0]).toContain("where-after");
    draw({ year: 2025 });
    expect(order()[0]).toContain("where-before");
    draw({ year: null });
    expect(host.querySelector(".where-lists")?.getAttribute("data-where-order")).toBe("side-by-side");
  });
});

describe("Papers that cite it", () => {
  it("is the citers, most cited first, five and then Show all", () => {
    draw();
    const rows = [...host.querySelectorAll(".where-after .rcp-citer")];
    expect(rows).toHaveLength(5);
    expect(rows[0]?.textContent).toContain("Citing paper 1");
    act(() => button("Show all 7")?.click());
    expect(host.querySelectorAll(".where-after .rcp-citer")).toHaveLength(7);
  });

  /* A persona review, 2026-10-26: "After it" and "Before it" left a
     first-time reader asking what "it" was; and "Papers that cite it, most
     cited first" said again what the Most cited chip says. */
  it("heads the two lists in plain words, and says the citers' order once", () => {
    draw();
    const heads = [...host.querySelectorAll(".where-lists h3")].map((h) => h.textContent);
    expect(heads.sort()).toEqual(["Papers that cite it", "What it builds on"]);
    expect([WHERE_AFTER_HEAD, WHERE_BEFORE_HEAD].sort()).toEqual(heads);
    const order = () => (host.querySelector(".where-after")?.textContent ?? "").match(/most cited/gi) ?? [];
    expect(order(), "the answer's own sentence says the order, once").toHaveLength(1);
    const found = FOUND as Extract<CitersResult, { kind: "found" }>;
    draw({ citers: { ...found, topic: { keyword: "extended mind" } } });
    /* The chip, and the answer's sentence; no line under the heading as well. */
    expect(order()).toHaveLength(2);
    expect(host.querySelector(".where-after .where-what")).toBeNull();
  });

  it("says the same honest sentence Reception's Cited by says when there is no list", () => {
    draw({ citers: { kind: "no-match" } });
    expect(host.querySelector(".where-after")?.textContent).toContain(CITERS_NO_MATCH);
  });
});

/* Plan 261025h, decision 10 (GPT Sol's F15): a labelled second view beside
   Most cited, the reader's choice; the keyword list is asked on that press
   only (S1-F5). */
describe("Papers that cite it's keyword view, About “keyword”", () => {
  const found = FOUND as Extract<CitersResult, { kind: "found" }>;
  const LANDMARK: CitersResult = { ...found, count: 5849, topic: { keyword: "extended mind" } };
  const ABOUT: CitersResult = {
    ...found,
    count: 1234,
    returned: 1,
    capped: true,
    citers: [{ openalexId: "W990", title: "About the extended mind", authors: ["B. Author"], authorCount: 1, citedByCount: 50 }],
    topic: { keyword: "extended mind", count: 1234 },
    filteredBy: "extended mind",
  };
  const about = () => button("About “extended mind”");
  const most = () => button("Most cited");

  it("is not there for a list with no keyword", () => {
    draw();
    expect(about()).toBeUndefined();
    expect(most()).toBeUndefined();
  });

  it("starts on Most cited, labelled by the keyword with no count, and asks nothing on open", () => {
    draw({ citers: LANDMARK });
    expect(most()?.getAttribute("aria-pressed")).toBe("true");
    expect(about()?.getAttribute("aria-pressed")).toBe("false");
    expect(about()?.textContent).toBe("About “extended mind”");
    expect(about()?.querySelector(".rcp-view-count")).toBeNull();
    expect(topicAsks).toBe(0);
    expect(host.querySelectorAll(".where-after .rcp-citer")).toHaveLength(5);
  });

  it("carries the count once OpenAlex's keyword list has been fetched", () => {
    draw({ citers: { ...found, count: 5849, topic: { keyword: "extended mind", count: 1234 } } });
    expect(about()?.querySelector(".rcp-view-count")?.textContent).toBe("1,234");
    expect(about()?.getAttribute("aria-label")).toBe("About “extended mind”, 1234 papers");
    expect(topicAsks).toBe(0);
  });

  it("asks for the keyword view on the press, and draws it with a sentence that says what it is", () => {
    draw({ citers: LANDMARK });
    act(() => about()?.click());
    expect(topicAsks).toBe(1);
    expect(about()?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".where-after")?.textContent).toContain("Asking OpenAlex");
    draw({ citers: LANDMARK, topic: ABOUT });
    const after = host.querySelector(".where-after")?.textContent ?? "";
    expect(after).toContain("About the extended mind");
    expect(after).toContain("1234 papers that cite this piece mention “extended mind” in their title or abstract");
    expect(about()?.querySelector(".rcp-view-count")?.textContent).toBe("1,234");
    /* Back to every citer, without asking again. */
    act(() => most()?.click());
    expect(host.querySelectorAll(".where-after .rcp-citer")).toHaveLength(5);
    expect(topicAsks).toBe(1);
  });

  it("says so when the server fell back to the plain list", () => {
    draw({ citers: LANDMARK, topic: LANDMARK });
    act(() => about()?.click());
    expect(host.querySelector(".where-after")?.textContent).toContain("could not be listed just now");
    expect(host.querySelectorAll(".where-after .rcp-citer")).toHaveLength(5);
  });
});

describe("What it builds on", () => {
  it("lists the works rated as leaned on, most first, leaves an unrated one out, and opens a row in Bibliography", () => {
    draw();
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".where-before .where-work")];
    expect(rows.map((r) => r.querySelector(".where-work-title")?.textContent)).toEqual(["Leaned on", "Less so"]);
    expect(rows[0]?.querySelector(".where-work-title")?.classList.contains("voice-author")).toBe(true);
    act(() => rows[0]?.click());
    expect(openedWorks).toEqual(["w1"]);
    act(() => host.querySelector<HTMLButtonElement>(".where-before-all")?.click());
    expect(moved).toEqual(["bibliography"]);
  });

  /* A persona review, 2026-10-26: "Putnam (1975) Putnam 1975". */
  it("says a work's authors and year once when Bibliography's title is only those", () => {
    const putnam = { id: "w9", title: "Putnam (1975)", authors: "Putnam", year: "1975", relevance: 0.8 } as CitedWork;
    const kirsh = {
      id: "w8",
      title: "Epistemic actions in Tetris",
      authors: "Kirsh, D. and Maglio, P.",
      year: "1994",
      relevance: 0.9,
    } as CitedWork;
    draw({ before: { status: "ready", works: [putnam, kirsh], listing: false } });
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".where-before .where-work")];
    expect(rows.map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim())).toEqual([
      expect.stringMatching(/^Epistemic actions in Tetris\s*Kirsh.*1994$/),
      "Putnam 1975",
    ]);
    expect(rows[1]?.querySelector(".where-work-title")?.textContent).toBe("Putnam 1975");
    expect(rows[1]?.querySelector(".where-work-by")).toBeNull();
    expect(titleIsOnlyByline("Zacks et al. (2007)", "Zacks, J. and Speer, N.", "2007")).toBe(true);
    expect(titleIsOnlyByline("Deep learning in 2016", "LeCun", "2016")).toBe(false);
  });

  it("says why there are no rows", () => {
    draw({ before: { status: "none", works: null, listing: false } });
    expect(host.querySelector(".where-before")?.textContent).toContain(WHERE_BEFORE_NONE);
    draw({ before: { status: "ready", works: [work("w3", "Unrated")], listing: false } });
    expect(host.querySelector(".where-before")?.textContent).toContain(WHERE_BEFORE_UNRATED);
  });
});

describe("the literature search", () => {
  it("offers Search the literature when nothing is stored, with no Experimental badge", () => {
    draw();
    expect(button(SITUATE_RUN)).toBeDefined();
    expect(text()).not.toMatch(/experimental/i);
  });
});

describe("the tools row", () => {
  it("names the four tools, each moving to its address and arming nothing", () => {
    draw();
    const tools = [...host.querySelectorAll<HTMLButtonElement>(".where-tool")];
    expect(tools.map((t) => t.getAttribute("data-tool"))).toEqual([...SOURCES_TOOLS]);
    expect(tools.map((t) => t.firstChild?.textContent)).toEqual(SOURCES_TOOLS.map((t) => SOURCES_TOOL_LABEL[t]));
    /* A count wherever a stored result was read, 0 included; none where nothing is stored. */
    expect(tools[0]?.querySelector(".rcp-view-count")?.textContent).toBe("3");
    expect(tools[1]?.querySelector(".rcp-view-count")?.textContent).toBe("0");
    expect(tools[2]?.querySelector(".rcp-view-count")).toBeNull();
    expect(tools[3]?.querySelector(".rcp-view-count")).toBeNull();
    for (const tool of tools) act(() => tool.click());
    expect(moved).toEqual([...SOURCES_TOOLS]);
    for (const target of ["reception", "sources-claims", "bibliography"] as const) {
      expect(pendingActivation("a-piece", target), target).toBeNull();
    }
  });

  /* A persona review, 2026-10-26: at the foot of a tall band, in small grey
     links, three of four readers never found the tools. */
  it("comes first, under the head line and above the literature search, each tool drawn as the chips are", () => {
    draw({ experiments: true });
    const nav = host.querySelector("nav.where-tools");
    const dossier = host.querySelector(".where-situate");
    const headline = host.querySelector(".where-headline");
    expect(nav?.compareDocumentPosition(dossier as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(headline?.compareDocumentPosition(nav as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const tool of host.querySelectorAll(".where-tool")) {
      expect(tool.classList.contains("summ-view-btn"), tool.textContent ?? "").toBe(true);
      expect(tool.parentElement?.classList.contains("summ-views")).toBe(true);
    }
  });

  /* Plan 261025h, Stage 4: the two experiments, behind the switch, after the tools. */
  it("adds the two experiments only with the switch on, each a plain move to its own address", () => {
    draw();
    expect(host.querySelector('[data-tool="guess-first"]')).toBeNull();
    expect(host.querySelector('[data-tool="evidence-first"]')).toBeNull();
    expect(text()).not.toContain("Experiments");
    draw({ experiments: true });
    const experiments = [...host.querySelectorAll<HTMLButtonElement>(".where-experiments .where-tool")];
    expect(experiments.map((b) => b.textContent)).toEqual(["Guess first", "Evidence first"]);
    for (const b of experiments) act(() => b.click());
    expect(moved).toEqual(["guess-first", "evidence-first"]);
    for (const target of ["reception", "sources-claims", "bibliography"] as const) {
      expect(pendingActivation("a-piece", target), target).toBeNull();
    }
  });

  it("gives each tool a way back to Where it sits, which arms nothing", () => {
    const back: string[] = [];
    act(() => root.render(createElement(ToolBack, { tool: "claims", onBack: () => back.push("where") })));
    expect(text()).toContain(SOURCES_TOOL_LABEL.claims);
    act(() => button("Where it sits")?.click());
    expect(back).toEqual(["where"]);
    expect(pendingActivation("a-piece", "bibliography")).toBeNull();
  });
});

/* Item 10 of a persona review, 2026-10-26: Where it sits read the year from
   `publishedAt` alone, Not cited from `publishedYear` too. One rule now, and
   never the planner model's year. */
describe("the piece's year", () => {
  it("is the metadata's, publishedAt or publishedYear, as Not cited's search reads it", () => {
    expect(pieceYear("2024-05-31", undefined)).toBe(2024);
    expect(pieceYear(undefined, 2026)).toBe(2026);
    expect(pieceYear(undefined, undefined)).toBeNull();
    for (const [at, year] of [["2024-05-31", undefined], [undefined, 2026], [undefined, undefined]] as const) {
      expect(pieceYear(at, year), `${at} ${year}`).toBe(relatedWorkYearOf({ ...(at ? { publishedAt: at } : {}), ...(year ? { publishedYear: year } : {}) }));
    }
  });
});

describe("the tools row's numbers", () => {
  const counts = { bibliography: 17, notCited: null, links: 0, reception: 0, claims: { n: 8, unit: "claim" as const } };
  it("has one for every stored result, 0 included, and none where nothing is stored", () => {
    expect(whereToolCounts(counts, { reception: true, claims: true })).toEqual({ reception: 0, claims: 8 });
    expect(whereToolCounts(counts, { reception: false, claims: false })).toEqual({});
    expect(whereToolCounts({ ...counts, notCited: 0 }, { reception: false, claims: false })).toEqual({ "not-cited": 0 });
  });
});
