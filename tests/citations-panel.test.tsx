// @vitest-environment jsdom
/**
 * Citations mode's panel: the four orders, the bar, and the one thing a row
 * must never blur — whether its link is an address the article gave or a
 * search we built. docs/project/citations.md, src/web/CitationsPanel.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
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
    finding: null,
    findNote: null,
    find: async () => {},
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

/* ------------------------------------------------- the Find it hover card --
   Borrowed from tests/referee-tooltips.test.tsx, which borrowed `cardFor` from
   tests/diagram-panel-hover.test.tsx. Kept small here: this file owns one
   control's card, not thirty. */

interface Card {
  head: string;
  body: string;
  what: string;
  how: string;
}

/** The *Find it* button on one row — a real element, so a miss is a thrown error. */
function findButton(id: string): HTMLButtonElement {
  const el = row(id).querySelector<HTMLButtonElement>(".cite-find");
  if (!el) throw new Error(`no Find it button on row ${id}`);
  return el;
}

/**
 * **Open the card and read it**, then shut it again.
 *
 * Three things here are load-bearing and every one of them was found the hard
 * way next door rather than reasoned out — see the long version in
 * tests/referee-tooltips.test.tsx:
 *
 *  - **the card is portalled to the end of `<body>`**, not into `host`, so it is
 *    looked for in the document; **exactly one** must be open, or a neighbour's
 *    card left up would be read as this control's;
 *  - **opening and closing do not take the same event.** A native `mouseleave`
 *    on the trigger leaves the card up; what closes it is React's synthetic
 *    `onMouseLeave`, synthesised from a *bubbling* `mouseout`. Both are sent, so
 *    this does not depend on which route closes it;
 *  - **two waits to close, not one long one**, because closing is two timers in
 *    series with a React render between them, and inside a single `act` the
 *    queued state update is not applied until the block exits.
 */
async function cardFor(el: Element): Promise<Card> {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering this control opened no card, or more than one").toHaveLength(1);
  const card = cards[0];
  const head = card?.querySelector(".tip-soon-head")?.textContent ?? "";
  const body = (card?.textContent ?? "").slice(head.length);
  /* The two paragraphs separately, not one blob: `ControlTip`'s rule is about
     the relationship between them, and a check that reads them concatenated
     cannot see the failure the rule exists to prevent. */
  const paras = [...(card?.querySelectorAll("p") ?? [])].map((n) =>
    (n.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  for (const _ of [0, 1]) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  expect(
    document.querySelectorAll('[role="tooltip"]'),
    "the card did not close, so the next one read here would be this one",
  ).toHaveLength(0);
  return { head, body, what: paras[0] ?? "", how: paras[1] ?? "" };
}

/* The stoplist and the two thresholds are tests/referee-tooltips.test.tsx's,
   where both are calibrated against real cards this house has deleted. Copied
   rather than exported, deliberately: that file's version carries a long
   measurement table explaining why the floor is 3 and the ratio 0.4, and the
   day somebody re-tunes it there they should not silently re-tune this. */
const STOPWORDS = new Set(
  (
    "a about after all also an and any are as at back be because been before being between both but " +
    "by can could did do does doing down each few for from further had has have having he her here " +
    "him his how i if in into is it its just may more most no not of off on once one only or other " +
    "our out over same so some than that the their them then there these they this those to under " +
    "until up was what when where which while who will with would you your yours"
  ).split(" "),
);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/** Is one of these two the other one again? Catches copying, not paraphrase. */
function restates(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const uniq = new Set(shorter);
  if (uniq.size < 3) return false;
  if (longer.join(" ").includes(shorter.join(" "))) return true;
  if (longer.length === 0 || shorter.length / longer.length < 0.4) return false;
  const inLonger = new Set(longer);
  let shared = 0;
  for (const w of uniq) if (inLonger.has(w)) shared++;
  return shared / uniq.size > 0.6;
}

/** Why this card does not earn its hover, or `null` if it does. */
function earnsItsHover(card: Card): string | null {
  if (card.what === "") return "the card has no first paragraph";
  if (card.how === "") return "the card has no second paragraph, which is ControlTip's whole rule";
  if (card.body.length <= 80) return "the card is a label, not an explanation";
  if (restates(card.how, card.what)) return "the second paragraph is the first one again";
  if (restates(card.how, card.head)) return "the second paragraph is the label again";
  if (restates(card.what, card.head)) return "the first paragraph is the label again";
  return null;
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

  /* GPT Sol F17 (second code review): the copy promised "one web search", and
     nothing bounds how many searches the provider runs inside the one call
     (the plan's F1). So it promises no count — in plain words, because a reader
     should not meet "model call".

     **Re-pointed from `button.title` to the card on 2026-09-16**, when the
     button grew a `ControlTip` (SPIDERYARN-READING2-3K,
     docs/plans/260916b-…). Re-pointed rather than deleted, and that is the
     whole of why this note is here: the assertion reads whatever surface the
     copy is on, and a `ControlTip` leaves `title` empty — so leaving it alone
     would have left it asserting that the empty string says the right thing,
     which every wording passes. A copy rule that stops being checked because
     the copy moved is worse than one that was never written. */
  it("promises no search count the provider controls, in plain words", async () => {
    const searched = work({
      id: "spya-e2f3g4",
      title: "Searched",
      relevance: 0.9,
      influence: 0.9,
      url: "https://scholar.google.com/scholar?q=Searched",
      linkFrom: "search",
    });
    await draw(owner({ citations: artefact([searched, PASSING]) }));
    const button = findButton(searched.id);
    const card = await cardFor(button);
    for (const copy of [`${card.head} ${card.body}`, MODE_CATALOG.citations.how]) {
      expect(copy).toMatch(/searches the web for (this|the) work/i);
      expect(copy).not.toMatch(/one web search|model call/i);
    }
  });

  /* SPIDERYARN-READING2-3K, Greg, 2026-09-12: *"In Citation mode, there's a
     'Find it' button - make it clearer what that does (e.g. rich tooltip) and
     the effect of running it"*.

     **What the `title` could not do is the reason this is a card**, and it is
     the reason the report exists: a `title` waits about a second, cannot be
     styled, truncates at the OS's idea of a line, and does not exist at all on
     a touch device — which is the device Greg filed this from
     (docs/project/tooltips.md). So the regression this pins is the `title`
     coming back, exactly as tests/referee-tooltips.test.tsx pins it: on a
     laptop a `title` still shows *something*, so nothing else here would
     notice.

     The wording is deliberately not pinned — it is copy and it will be edited.
     What is pinned is the structure `ControlTip`'s rule is about, plus the one
     fact 3K actually asked for: that the card says what running it *changes*. */
  it("explains itself in a card rather than a title, and says what running it changes", async () => {
    const searched = work({
      id: "spya-e2f3g4",
      title: "Searched",
      relevance: 0.9,
      influence: 0.9,
      url: "https://scholar.google.com/scholar?q=Searched",
      linkFrom: "search",
    });
    await draw(owner({ citations: artefact([searched, PASSING]) }));
    const button = findButton(searched.id);
    expect(button.hasAttribute("title"), "the button fell back to a title attribute").toBe(false);

    const card = await cardFor(button);
    expect(earnsItsHover(card), "the Find it card does not earn its hover").toBeNull();
    /* The effect of running it, which is the half the `title` left out: a press
       that finds nothing stores nothing, so pressing again is not a way of
       making progress. */
    expect(card.how.toLowerCase(), "the card no longer says what a press costs").toMatch(
      /cost|spend|pay|paid|price/,
    );
    expect(
      card.how.toLowerCase(),
      "the card no longer says that finding nothing keeps nothing",
    ).toMatch(/nothing|no match|no-match/);
    /* **The false claim that shipped, guarded as a claim rather than as a
       phrase.** The first version of this copy said the row "keeps its Scholar
       fallback either way", which is wrong on the half that matters: a
       successful find REPLACES the Scholar search, which is the whole point of
       pressing the button. GPT Sol caught it.

       Only the negative is asserted. The fix that followed the catch pinned the
       positive too, with `/otherwise.*scholar/` — and that matched on the one
       word that had made the sentence ambiguous in the first place, so the test
       would have held the confusion in place and failed on the clearer rewrite.
       A copy test that pins a conjunction is pinning the wording, which is what
       the header of tests/referee-tooltips.test.tsx says not to do; what is
       checkable here is that the card does not promise the fallback survives
       regardless. */
    expect(
      card.how.toLowerCase(),
      "the card is back to promising the Scholar search survives a successful find",
    ).not.toMatch(/either way|regardless|whichever|in both cases/);
  });

  it("starts the bar at the default, hides what is under it, and says how many", async () => {
    await draw(owner());
    /* 0.25 since 2026-09-15 (docs/plans/260915d-…). PASSING's (2 × 0.2 + 0.2) / 3
       = 0.20 is still under it, which is what the next line needs. */
    expect(CITATION_BAR_DEFAULT).toBe(0.25);
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
