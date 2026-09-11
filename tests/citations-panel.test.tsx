// @vitest-environment jsdom
/**
 * Citations mode's panel: the four orders, the bar, and the one thing a row
 * must never blur — whether its link is an address the article gave or a
 * search we built. docs/project/citations.md, src/web/CitationsPanel.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockId, Citations, CitedWork } from "../src/types.js";
import type { UseCitations } from "../src/web/useCitations.js";

const {
  CAPPED_NOTE,
  CITATIONS_NONE,
  CITATION_BAR_DEFAULT,
  CitationsPanel,
  INFLUENCE_NOTE,
  canPrioritise,
  effectiveOrder,
  orderWorks,
  priorityOf,
  scoresOf,
  sourceOf,
} = await import("../src/web/CitationsPanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const FIRST = "spya-k3m9qt" as BlockId;
const LATER = "spya-p7w2dn" as BlockId;

function work(over: Partial<CitedWork> & Pick<CitedWork, "id" | "title">): CitedWork {
  return {
    key: `work:${over.title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [FIRST],
    firstCited: FIRST,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
    ...over,
  };
}

/* In first-cited order, as the artefact stores them. Priorities:
   central 0.80, famous 0.50 — (2·0.3 + 0.9)/3 — passing 0.20, unscored none. */
const CENTRAL = work({ id: "spya-a2b3c4", title: "Central", relevance: 0.8, influence: 0.8 });
const FAMOUS = work({ id: "spya-d5e6f7", title: "Famous", relevance: 0.3, influence: 0.9 });
const PASSING = work({ id: "spya-g8h9j2", title: "Passing", relevance: 0.2, influence: 0.2 });
const UNSCORED = work({ id: "spya-k2m3n4", title: "Unscored", relevance: 0.6 });
const WORKS = [CENTRAL, FAMOUS, PASSING, UNSCORED];

const titles = (ws: CitedWork[]) => ws.map((w) => w.title);

describe("the prioritised score", () => {
  it("is two parts relevance to one part influence, and needs both", () => {
    expect(priorityOf(CENTRAL)).toBeCloseTo(0.8);
    expect(priorityOf(FAMOUS)).toBeCloseTo(0.5);
    expect(priorityOf(UNSCORED)).toBeUndefined();
  });

  it("hides what is under the bar, keeps first-cited order, and never hides an unscored work", () => {
    expect(titles(orderWorks(WORKS, "prioritised", 0.4))).toEqual(["Central", "Famous", "Unscored"]);
    expect(titles(orderWorks(WORKS, "prioritised", 1))).toEqual(["Unscored"]);
    expect(titles(orderWorks(WORKS, "prioritised", 0))).toEqual(titles(WORKS));
  });

  it("is inclusive at the bar", () => {
    expect(titles(orderWorks([FAMOUS], "prioritised", 0.5))).toEqual(["Famous"]);
  });

  it("falls back to first cited when no position of the bar would hide anything", () => {
    const flat = [work({ id: "spya-q2r3s4", title: "A", relevance: 0.5, influence: 0.5 })];
    expect(canPrioritise(flat)).toBe(false);
    expect(effectiveOrder(flat, "prioritised")).toBe("document");
    expect(effectiveOrder(WORKS, "prioritised")).toBe("prioritised");
    expect(effectiveOrder(WORKS, "relevance")).toBe("relevance");
  });
});

describe("the score orders", () => {
  it("sort descending, with a work missing that score last", () => {
    expect(titles(orderWorks(WORKS, "relevance"))).toEqual(["Central", "Unscored", "Famous", "Passing"]);
    expect(titles(orderWorks(WORKS, "influence"))).toEqual(["Famous", "Central", "Passing", "Unscored"]);
  });

  it("break ties in first-cited order", () => {
    const a = work({ id: "spya-t2u3v4", title: "A", relevance: 0.5, influence: 0.5 });
    const b = work({ id: "spya-w2x3y4", title: "B", relevance: 0.5, influence: 0.5 });
    expect(titles(orderWorks([a, b], "relevance"))).toEqual(["A", "B"]);
  });

  it("first cited is the artefact's own order, untouched", () => {
    expect(orderWorks(WORKS, "document")).toEqual(WORKS);
  });
});

describe("a row's numbers and its source", () => {
  it("draws the two raw scores and never the combination", () => {
    expect(scoresOf(FAMOUS).map((s) => [s.key, s.value])).toEqual([
      ["relevance", 0.3],
      ["influence", 0.9],
    ]);
    expect(scoresOf(UNSCORED).map((s) => s.key)).toEqual(["relevance"]);
    expect(scoresOf(work({ id: "spya-z2a3b4", title: "None" }))).toEqual([]);
  });

  it("tells an address the article gave from a search we built", () => {
    expect(sourceOf(CENTRAL)).toEqual({
      kind: "address",
      url: "https://doi.org/10.1000/xyz",
      host: "doi.org",
      how: "DOI in the article",
    });
    const searched = work({
      id: "spya-c2d3e4",
      title: "Searched",
      url: "https://scholar.google.com/scholar?q=Searched",
      linkFrom: "search",
    });
    expect(sourceOf(searched).kind).toBe("search");
  });
});

/* ---------------------------------------------------------------- render -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function artefact(citations: CitedWork[], capped = false): Citations {
  return {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    citations,
    capped,
    generatedAt: "2026-09-11T09:00:00.000Z",
    elapsedMs: 1,
  };
}

function owner(over: Partial<UseCitations> = {}): UseCitations {
  return {
    status: "ready",
    citations: artefact(WORKS),
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
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

async function draw(o: UseCitations, bar: number | null = null) {
  await act(async () =>
    root.render(
      createElement(CitationsPanel, {
        owner: o,
        order: "prioritised",
        onOrder: () => {},
        bar,
        onBar: () => {},
        onJump: () => {},
      }),
    ),
  );
}

function row(id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-citation-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
}

describe("CitationsPanel", () => {
  it("links the title to the article's address, in a new tab", async () => {
    await draw(owner());
    const a = row(CENTRAL.id).querySelector(".cite-title a");
    expect(a?.getAttribute("href")).toBe("https://doi.org/10.1000/xyz");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toContain("noopener");
    expect(row(CENTRAL.id).textContent).toContain("doi.org · DOI in the article");
  });

  it("draws a search as a search: the title is not a link, and the one link says so", async () => {
    const searched = work({
      id: "spya-e2f3g4",
      title: "Searched",
      relevance: 0.9,
      influence: 0.9,
      url: "https://scholar.google.com/scholar?q=Searched",
      linkFrom: "search",
    });
    await draw(owner({ citations: artefact([searched, PASSING]) }));
    const r = row(searched.id);
    expect(r.querySelector(".cite-title a")).toBeNull();
    const links = [...r.querySelectorAll("a[target=_blank]")];
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toContain("search Scholar");
    expect(links[0]?.getAttribute("href")).toBe("https://scholar.google.com/scholar?q=Searched");
  });

  it("starts the bar at the default, hides what is under it, and says how many", async () => {
    await draw(owner());
    expect(CITATION_BAR_DEFAULT).toBe(0.4);
    expect(host.querySelector(`[data-citation-id="${PASSING.id}"]`)).toBeNull();
    expect(host.textContent).toContain("1 citation is hidden by this threshold.");
    expect(row(UNSCORED.id).getAttribute("title")).toContain("Not scored");
  });

  it("draws the raw scores on a row, and not the number it was barred on", async () => {
    await draw(owner());
    /* Drawn as bars (src/web/ScoreBars.tsx), the numbers in the label a screen
       reader reads and in the tooltip — as the Glossary and Quotes rows are. */
    const bars = row(FAMOUS.id).querySelector('[role="img"].score-bars');
    const spoken = bars?.getAttribute("aria-label") ?? "";
    expect(spoken).toContain("relevance to this piece 30 out of 100");
    expect(spoken).toContain("90 out of 100");
    /* (2 × 0.3 + 0.9) / 3 = 0.50 is what the bar gates on; it is never shown. */
    expect(spoken).not.toContain("50 out of 100");
    expect(row(FAMOUS.id).textContent ?? "").not.toContain("rel·");
  });

  it("offers no re-run under a fresh list — only a stale or outdated one asks again", async () => {
    /* The costly press stays out of the ordinary foot: Greg took the same
       button out of the Glossary and Quotes. The banner still carries it. */
    await draw(owner());
    expect(host.textContent).not.toContain("Find them again");
    await draw(owner({ stale: true }));
    expect(host.textContent).toContain("Find them again");
  });

  it("says the list was capped only when the model said so", async () => {
    await draw(owner());
    expect(host.textContent).not.toContain(CAPPED_NOTE);
    expect(host.textContent).toContain(INFLUENCE_NOTE);
    await draw(owner({ citations: artefact(WORKS, true) }));
    expect(host.textContent).toContain(CAPPED_NOTE);
    expect(CAPPED_NOTE).toBe(
      "This piece cites more than 80 works; these are the 80 we judged it leans on most.",
    );
  });

  it("treats a piece that cites nothing as an answer, with no retry", async () => {
    await draw(owner({ citations: artefact([]) }));
    expect(host.textContent).toContain(CITATIONS_NONE);
    expect(host.textContent).not.toContain("Find them again");
    expect(host.textContent).not.toContain(INFLUENCE_NOTE);
  });

  it("offers to find them when nobody has", async () => {
    await draw(owner({ status: "none", citations: null }));
    expect(host.textContent).toContain("Find the citations");
    expect(host.querySelector(".gloss-sort")).toBeNull();
  });

  it("jumps to where a work is first cited, or says it is only in the references", async () => {
    const listed = work({
      id: "spya-h2j3k4",
      title: "Listed",
      relevance: 0.9,
      influence: 0.9,
      firstCited: LATER,
      citedAt: [],
      citedInBody: false,
    });
    await draw(owner({ citations: artefact([CENTRAL, listed]) }));
    expect(row(CENTRAL.id).querySelector(".cite-first")?.textContent).toContain("first cited");
    expect(row(CENTRAL.id).querySelector(".block-ref")?.textContent).toBe("k3m9qt");
    expect(row(listed.id).querySelector(".cite-first")?.textContent).toContain("only in the references");
  });
});
