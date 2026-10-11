// @vitest-environment jsdom
/**
 * **Skim's fourth chip, *Figures*** — a walk through the article's figures,
 * tables and media, beside the route's passes. Greg, 2026-10-10 (spya-sb0c7e):
 * *"I would quite like to be able to jump to all the tables and figures and
 * media easily."* docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md
 * § Half 1.
 *
 * The band for real, over a stubbed network inside a `NuqsAdapter`, as
 * skim-panel.test.tsx does: the chip is offered only when there are figures,
 * `?depth=figures` walks them, a step replaces `?stop=`, the door says
 * *figure*, a switch between Figures and a pass is one pushed entry that
 * arrives, and none of it waits for the route.
 */
import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, NodeId, Quote, Quotes, Skim, SkimStop, Tree, TreeNode } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import type { Found } from "../src/web/search-hits.js";
import type { SkimArrival, SkimControl } from "../src/web/modes/skim/SkimMode.js";

globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* ------------------------------------------------------------ the network -- */

let skimBody: unknown = null;
/** A held route read, so the owner's route is `loading` for as long as a test wants. */
let skimReply: Promise<Response> | null = null;
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string) => {
    if (url.startsWith("/api/skim/")) {
      if (skimReply) return skimReply;
      return skimBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(skimBody), { status: 200 });
    }
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    if (url.startsWith("/api/stale-notices/")) return new Response(JSON.stringify({ dismissed: {} }), { status: 200 });
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string) => apiFetch(url) };
});

const { scrolled, flashed, passages, jumps } = vi.hoisted(() => ({
  scrolled: [] as string[],
  flashed: [] as string[],
  passages: [] as (string | null)[],
  jumps: [] as { id: string; passage: string | null }[],
}));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...actual,
    scrollToBlock: (id: string, _b?: ScrollBehavior, done?: (o: "settled") => void) => {
      scrolled.push(id);
      done?.("settled");
    },
  };
});
vi.mock("../src/web/flash.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/flash.js")>();
  return {
    ...actual,
    flashBlock: (id: string, target?: { passage?: string | null }) => {
      flashed.push(id);
      passages.push(target?.passage ?? null);
    },
    dropPendingFlash: () => {},
  };
});

const { SkimBand, VisitorSkimBand } = await import("../src/web/modes/skim/SkimMode.js");
const { SkimDoor } = await import("../src/web/SkimPanel.js");
const { depthParam } = await import("../src/web/params.js");
const { resolveQuotes } = await import("../src/web/search-hits.js");
const { quoteStroke } = await import("../src/web/QuotesPanel.js");

/* ------------------------------------------------------------ the article -- */

/* Real ids: the alphabet has no `1`, `i`, `l` or `o`. docs/project/block-ids.md. */
const P = ["spya-fp2abc", "spya-fp3def", "spya-fp4ghj"] as BlockId[];
const FIG = "spya-ff2abc" as BlockId;
const TAB = "spya-ff3def" as BlockId;
const Q = ["spya-fq2abc", "spya-fq3def", "spya-fq4ghj"];
const WORDS = ["The effect held in all four cohorts.", "We measured it with a rig.", "The limits are the sample."];

const para = (id: BlockId, i: number): Block => ({
  id,
  tag: "p",
  kind: "text",
  text: WORDS[i]!,
  words: 7,
  html: `<p>${WORDS[i]}</p>`,
  gistable: true,
});
/** p0, a captioned figure, p1, an uncaptioned table, p2. */
const BLOCKS: Block[] = [
  para(P[0]!, 0),
  {
    id: FIG,
    tag: "figure",
    kind: "media",
    text: "The landscape, by category",
    words: 4,
    html: '<figure><img src="a.png"><figcaption>The landscape, by category</figcaption></figure>',
    gistable: false,
  },
  para(P[1]!, 1),
  { id: TAB, tag: "table", kind: "other", text: "a b", words: 2, html: "<table><tr><td>a</td><td>b</td></tr></table>", gistable: false },
  para(P[2]!, 2),
];
/** The same article with no figures in it. */
const PLAIN: Block[] = [para(P[0]!, 0), para(P[1]!, 1), para(P[2]!, 2)];

function node(id: string, depth: number, parent: string | null, children: string[], range: [BlockId, BlockId], title: string): TreeNode {
  return { id: id as NodeId, depth, parent: parent as NodeId | null, children: children as NodeId[], range, title };
}
const TREE: Tree = {
  version: "t",
  generator: "t",
  slug: "figs",
  rootId: "root" as NodeId,
  nodes: {
    root: node("root", 0, null, ["res", "met"], [P[0]!, P[2]!], "Whole"),
    res: node("res", 1, "root", [], [P[0]!, P[1]!], "Results"),
    met: node("met", 1, "root", [], [TAB, P[2]!], "Methods"),
  } as Record<NodeId, TreeNode>,
};

const QUOTE_LIST: Quote[] = P.map((blockId, i) => ({
  id: Q[i]!,
  blockId,
  text: WORDS[i]!,
  start: 0,
  importance: 80,
  striking: 60,
}));
const QUOTES: Quotes = {
  version: "test",
  generator: "test",
  slug: "figs",
  sourceHash: "hash",
  quotes: QUOTE_LIST,
  discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
  generatedAt: "2026-10-11T09:00:00.000Z",
  elapsedMs: 1,
};
/** Gist walks q2 then q0; More walks q1. */
const STOPS: SkimStop[] = [
  { quoteId: Q[2]!, depth: 1, role: null, cue: "Where does it stop?" },
  { quoteId: Q[0]!, depth: 1, role: null, cue: "The headline." },
  { quoteId: Q[1]!, depth: 2, role: null, cue: "How?" },
];
const ROUTE: Skim = {
  version: "test",
  generator: "test",
  slug: "figs",
  sourceHash: "hash",
  profileHash: null,
  stops: STOPS,
  visible: [2, 3, 3],
  offered: 3,
  dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
  generatedAt: "2026-10-11T09:00:00.000Z",
  elapsedMs: 1,
};
const SKIM_BODY = { skim: ROUTE, stale: false, outdated: false, profileChanged: false, notOnRoute: 0 };

const QUOTES_READ: QuotesRead = {
  status: "ready",
  quotes: QUOTES,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};
const GLOSSARY_READ = {
  status: "none",
  glossary: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
  patchEntry: () => {},
  look: async () => false,
  looking: null,
  lookFailed: null,
  lookDraft: null,
  lookKept: null,
  setHidden: async () => {},
  hiding: new Set<string>(),
} as unknown as GlossaryRead;

const MARKS: Found[] = resolveQuotes(
  BLOCKS,
  QUOTE_LIST.map((q) => ({ ...q, stroke: quoteStroke(q) })),
);

/* ------------------------------------------------------------- the harness -- */

let host: HTMLDivElement;
let root: Root;
let control: SkimControl | null = null;
let published: Found[] = [];
let openKeyNow: string | null = null;

beforeEach(() => {
  scrolled.length = 0;
  flashed.length = 0;
  passages.length = 0;
  jumps.length = 0;
  skimBody = SKIM_BODY;
  skimReply = null;
  control = null;
  published = [];
  openKeyNow = null;
  history.replaceState(null, "", "/read/figs?mode=skim");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness({ blocks, visitor }: { blocks: Block[]; visitor: boolean }) {
  /* As `Reader` arms it on first load: a `?stop=` is a deep link. */
  const arrival = useRef<SkimArrival>({ stop: new URLSearchParams(location.search).get("stop"), open: false });
  const [openKey, setOpenKey] = useState<string | null>(null);
  openKeyNow = openKey;
  const onFound = useCallback((f: Found[]) => {
    published = f;
  }, []);
  const onControl = useCallback((c: SkimControl | null) => {
    control = c;
  }, []);
  const walk = {
    blocks,
    tree: TREE,
    quoteMarks: MARKS,
    covers: false,
    away: false,
    onAway: () => {},
    onJump: (id: BlockId, passage?: string) => void jumps.push({ id, passage: passage ?? null }),
    onFound,
    openKey,
    onOpenKey: setOpenKey,
    onControl,
    onOpen: () => {},
    canOpen: () => true,
    arrival: arrival.current,
  };
  return createElement(
    NuqsAdapter,
    null,
    visitor
      ? createElement(VisitorSkimBand, {
          ...walk,
          route: { ...ROUTE } as never,
          quotes: QUOTE_LIST,
          glossary: undefined,
          ideas: undefined,
          timeline: undefined,
        })
      : createElement(SkimBand, {
          ...walk,
          slug: "figs",
          quotes: QUOTES_READ,
          glossary: GLOSSARY_READ,
          onAskTerm: () => {},
        }),
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

async function mount(blocks: Block[] = BLOCKS, visitor = false) {
  await act(async () => root.render(createElement(Harness, { blocks, visitor })));
  await settled();
}

const param = (key: string) => new URLSearchParams(location.search).get(key);
const chips = () => [...host.querySelectorAll<HTMLButtonElement>(".skim-depth")];
const chipText = () => chips().map((b) => b.textContent);
const chip = (label: string) => chips().find((b) => b.textContent?.startsWith(label))!;
const rowTexts = () => [...host.querySelectorAll(".skim-row")].map((r) => r.textContent ?? "");

/* ================================================================= tests == */

describe("?depth=figures", () => {
  it("is a value the depth parser reads and writes back", () => {
    expect(depthParam.parse("figures")).toBe("figures");
    expect(depthParam.serialize("figures")).toBe("figures");
    expect(depthParam.parse("2")).toBe(2);
    expect(depthParam.parse("pictures")).toBeNull();
  });
});

describe("the Figures chip", () => {
  it("is offered beside the passes when the article has figures, with how many", async () => {
    await mount();
    expect(chipText()).toEqual(["Gist2", "More1", "Figures2"]);
  });

  it("is not offered when the article has none", async () => {
    await mount(PLAIN);
    expect(chipText()).toEqual(["Gist2", "More1"]);
  });

  it("is offered to a visitor too", async () => {
    await mount(BLOCKS, true);
    expect(chipText()).toEqual(["Gist2", "More1", "Figures2"]);
  });
});

describe("the Figures walk", () => {
  it("lists every figure with its caption, or its name when it has none", async () => {
    history.replaceState(null, "", "/read/figs?mode=skim&depth=figures");
    await mount();
    const rows = rowTexts();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("The landscape, by category");
    expect(rows[0]).toContain("Results");
    expect(rows[1]).toContain("Table 1");
    expect(rows[1]).toContain("Methods");
    expect(host.querySelector(".skim-row.current")?.getAttribute("data-stop")).toBe(FIG);
    expect(chip("Figures").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Figure 1 of 2");
    expect(control?.blockId).toBe(FIG);
    expect(control?.door).toEqual({ kind: "next", noun: "figure", cue: "Table 1", voice: "ui" });
    expect(control?.hasPrevious).toBe(false);
    /* No passage of its own: there is no quote to ring. */
    expect(published).toEqual([]);
  });

  it("a step replaces ?stop=, lands on the whole block and flashes it, and the door says figure", async () => {
    history.replaceState(null, "", `/read/figs?mode=skim&depth=figures&stop=${FIG}`);
    await mount();
    scrolled.length = 0;
    flashed.length = 0;
    passages.length = 0;
    const before = history.length;
    await act(async () => {
      expect(control!.step(1)).toBe(true);
    });
    await settled();
    expect(param("stop")).toBe(TAB);
    expect(param("depth")).toBe("figures");
    expect(history.length, "a step must not push").toBe(before);
    expect(scrolled).toEqual([TAB]);
    expect(flashed).toEqual([TAB]);
    expect(passages).toEqual([null]);
    expect(control?.hasPrevious).toBe(true);
    expect(control?.door).toEqual({ kind: "end", pass: "the figures", count: 2, deeper: null, noun: "figure" });
    let took = true;
    await act(async () => {
      took = control!.step(1);
    });
    expect(took, "no wrap past the last figure").toBe(false);
  });

  it("a ?stop= naming no figure falls back to the first, and arrives there", async () => {
    history.replaceState(null, "", `/read/figs?mode=skim&depth=figures&stop=${Q[0]}`);
    await mount();
    expect(control?.blockId).toBe(FIG);
    expect(scrolled).toEqual([FIG]);
    expect(flashed).toEqual([FIG]);
  });

  it("a row press is a jump to that figure's block", async () => {
    history.replaceState(null, "", "/read/figs?mode=skim&depth=figures");
    await mount();
    jumps.length = 0;
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-go")[1]!.click());
    await settled();
    expect(jumps).toEqual([{ id: TAB, passage: null }]);
    expect(param("stop")).toBe(TAB);
  });
});

describe("switching between Figures and a pass", () => {
  it("Gist → Figures is one pushed entry, and arrives at the first figure", async () => {
    await mount();
    expect(published).toHaveLength(1);
    scrolled.length = 0;
    flashed.length = 0;
    passages.length = 0;
    const before = history.length;
    await act(async () => chip("Figures").click());
    await settled();
    expect(history.length, "one entry for the part and the stop").toBe(before + 1);
    expect([param("depth"), param("stop")]).toEqual(["figures", FIG]);
    expect(scrolled).toEqual([FIG]);
    expect(flashed).toEqual([FIG]);
    expect(passages).toEqual([null]);
    /* The route's quote ring went with it. */
    expect(published).toEqual([]);
    expect(openKeyNow).toBeNull();
    expect(control?.blockId).toBe(FIG);
  });

  it("Figures → Gist is one pushed entry, and arrives at Gist's first stop", async () => {
    history.replaceState(null, "", `/read/figs?mode=skim&depth=figures&stop=${TAB}`);
    await mount();
    scrolled.length = 0;
    flashed.length = 0;
    const before = history.length;
    await act(async () => chip("Gist").click());
    await settled();
    expect(history.length).toBe(before + 1);
    expect([param("depth"), param("stop")]).toEqual(["1", Q[2]]);
    expect(scrolled).toEqual([P[2]]);
    expect(flashed).toEqual([P[2]]);
    expect(control?.blockId).toBe(P[2]);
    expect(control?.door?.noun).toBe("stop");
    expect(published).toHaveLength(1);
  });
});

describe("Figures needs no route", () => {
  it("walks the figures while nobody has planned a route", async () => {
    skimBody = null;
    history.replaceState(null, "", "/read/figs?mode=skim&depth=figures");
    await mount();
    expect(rowTexts()).toHaveLength(2);
    expect(chipText()).toEqual(["Figures2"]);
    expect(control?.blockId).toBe(FIG);
  });

  it("offers the Figures chip above the empty state, and it works", async () => {
    skimBody = null;
    await mount();
    expect(host.textContent).toContain("Nobody has planned a route through this one yet.");
    expect(chipText()).toEqual(["Figures2"]);
    await act(async () => chip("Figures").click());
    await settled();
    expect(param("depth")).toBe("figures");
    expect(rowTexts()).toHaveLength(2);
    expect(scrolled).toEqual([FIG]);
  });

  it("walks the figures while the route is still loading", async () => {
    skimReply = new Promise<Response>(() => {});
    history.replaceState(null, "", "/read/figs?mode=skim&depth=figures");
    await mount();
    expect(rowTexts()).toHaveLength(2);
    await act(async () => void control!.step(1));
    await settled();
    expect(param("stop")).toBe(TAB);
  });
});

describe("the door, walking figures", () => {
  const door = (props: Partial<Parameters<typeof SkimDoor>[0]>) =>
    createElement(SkimDoor, { door: null, onPrevious: null, onNext: () => {}, onDeeper: () => {}, onRoute: null, ...props });
  const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);

  it("says figure in every literal, with the next caption under it", async () => {
    await act(async () =>
      root.render(
        door({ door: { kind: "next", noun: "figure", cue: "Table 1. Theories", voice: "author" }, onPrevious: () => {}, onRoute: () => {} }),
      ),
    );
    expect(buttons()).toEqual(["‹ Previous figure", "All figures", "Next figure ›"]);
    expect(host.querySelector(".skim-door-cue")?.textContent).toBe("Table 1. Theories");
  });

  it("ends with the count and nothing deeper", async () => {
    await act(async () =>
      root.render(door({ door: { kind: "end", pass: "the figures", count: 7, deeper: null, noun: "figure" } })),
    );
    expect(buttons()).toEqual([]);
    expect(host.querySelector(".skim-door-cue")?.textContent).toBe("End of the figures — 7.");
  });
});
