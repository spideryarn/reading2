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
import type { PublicCitations } from "../src/public-types.js";
import type { BlockId, Citations, CitedWork, Job } from "../src/types.js";
import type { UseCitations } from "../src/web/useCitations.js";

const {
  CAPPED_NOTE,
  CITATIONS_NONE,
  CITE_NOT_READ,
  CITE_DOES_LABEL,
  CITE_PAGE_FOUND,
  CITE_QUOTE_LABEL,
  CITE_VERDICT_LABEL,
  CITE_WHY_LABEL,
  CITATION_BAR_DEFAULT,
  CitationsPanel,
  INFLUENCE_NOTE,
  canPrioritise,
  citeReadAssessed,
  citeReadNoExtract,
  citeReadNotIdentified,
  citeReadUnreadable,
  effectiveOrder,
  orderWorks,
  priorityOf,
  readNoteOf,
  scoresOf,
  sourceOf,
  verdictText,
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

const RUNNING: Job = {
  id: "job-citations",
  ownerId: "owner" as Job["ownerId"],
  slug: "a-piece",
  status: "running",
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: "2026-09-29T00:00:01.000Z",
  steps: [{ name: "citations", label: "Finding the citations", status: "running" }],
};

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
    findNote: null,
    investigating: null,
    investigateStage: null,
    investigateDraft: null,
    investigateFailed: null,
    investigate: async () => {},
    ...over,
  };
}

async function draw(o: UseCitations, bar: number | null = null) {
  await act(async () =>
    root.render(
      createElement(CitationsPanel, {
        access: { kind: "owner", owner: o },
        order: "prioritised",
        onOrder: () => {},
        bar,
        onBar: () => {},
        onJump: () => {},
      }),
    ),
  );
}

async function drawVisitor(citations: PublicCitations) {
  await act(async () =>
    root.render(
      createElement(CitationsPanel, {
        access: { kind: "visitor", citations },
        order: "prioritised",
        onOrder: () => {},
        bar: null,
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

/**
 * The one paid button on a row — *Investigate*, which since plan 260930d is
 * *Look it up* (was *Find it*) too. A real element, so a miss is a thrown error.
 */
function investigateButton(id: string): HTMLButtonElement {
  const el = row(id).querySelector<HTMLButtonElement>(".cite-investigate");
  if (!el) throw new Error(`no Investigate button on row ${id}`);
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
    const button = investigateButton(searched.id);
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
    const button = investigateButton(searched.id);
    expect(button.hasAttribute("title"), "the button fell back to a title attribute").toBe(false);

    const card = await cardFor(button);
    expect(earnsItsHover(card), "the Investigate card does not earn its hover").toBeNull();
    /* The effect of running it, which is the half the `title` left out: what a
       press costs, and what it leaves on the row. (*Find it*'s "finding
       nothing keeps nothing" went with plan 260930d: a press that finds no page
       still writes and keeps a reading, unconfirmed.) */
    expect(card.how.toLowerCase(), "the card no longer says what a press costs").toMatch(
      /cost|spend|pay|paid|price/,
    );
    expect(card.how.toLowerCase(), "the card no longer says what is kept").toMatch(/kept on this row/);
    expect(card.how.toLowerCase(), "the card no longer says a searched row gains a link").toMatch(
      /scholar search, the page it finds becomes the link/,
    );
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

  it("offers no re-run under a fresh or outdated list — only a stale one asks again", async () => {
    /* The costly press stays out of the ordinary foot: Greg took the same
       button out of the Glossary and Quotes. The stale banner still carries it;
       an outdated list (older prompt, same article) is not announced — Greg,
       2026-09-29 (SPIDERYARN-READING2-55), plan 260929c. */
    await draw(owner());
    expect(host.textContent).not.toContain("Find them again");
    await draw(owner({ outdated: true }));
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(host.textContent).not.toContain("older version of the prompt");
    expect(host.textContent).not.toContain("Find them again");
    await draw(owner({ stale: true }));
    expect(host.textContent).toContain("Find them again");
  });

  it("shows a Metadata-started job and failure on an outdated list without adding a second foot", async () => {
    await draw(owner({ outdated: true, job: RUNNING }));
    expect(host.querySelectorAll(":scope > aside > .cite-foot")).toHaveLength(1);
    expect(host.querySelector(".cite-foot")?.textContent).toContain("Stop");

    await draw(
      owner({
        outdated: true,
        failed: { message: "The citations could not be found.", retryable: false, retry: null },
      }),
    );
    expect(host.querySelectorAll(":scope > aside > .cite-foot")).toHaveLength(1);
    expect(host.querySelector(".cite-foot")?.textContent).toContain(
      "The citations could not be found.",
    );
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

/* ------------------------------------------ what we have and have not read --
   Plan 260929g stage 1. Greg, 2026-09-29: *"be really careful to be clear
   about whether you could get the actual paper, so that we can be sure you're
   not hallucinating"*. `why` is the article's use of the work, never a summary
   of the work, and every row says we have not read the work — including a row
   whose Find it matched a page, since a page whose title matches is not a
   page we checked is the paper (the plan's R-1). Asserted on the element, not
   on the row's whole text, which a tooltip's words could satisfy. */

/** A row *Find it* upgraded: a result whose title matched, attached at read time. */
const FOUND = work({
  id: "spya-f2g3h4",
  title: "Found",
  relevance: 0.9,
  influence: 0.9,
  url: "https://arxiv.org/abs/2001.08361",
  linkFrom: "web",
  found: {
    title: "Found — a page",
    host: "arxiv.org",
    searches: 1,
    model: "test",
    at: "2026-09-29T09:00:00.000Z",
  },
});

describe("what a row says we have read", () => {
  it("says, on a row nobody looked up, that we have not read the work", async () => {
    await draw(owner());
    const r = row(CENTRAL.id);
    expect(r.querySelector(".cite-read")?.textContent).toBe(CITE_NOT_READ);
    expect(CITE_NOT_READ).toMatch(/not read/i);
    /* And `why` is labelled as the article's, not the work's. */
    expect(r.querySelector(".cite-why-label")?.textContent).toContain(CITE_WHY_LABEL);
    expect(CITE_WHY_LABEL).toMatch(/article/);
  });

  it("says only that a page matching the title was found, never that it is the paper", async () => {
    await draw(owner({ citations: artefact([FOUND, CENTRAL]) }));
    const said = row(FOUND.id).querySelector(".cite-read")?.textContent ?? "";
    expect(said).toBe(CITE_PAGE_FOUND);
    expect(said).toMatch(/not read/i);
    expect(said).toMatch(/title/i);
    expect(said).not.toMatch(/verif|confirm|from the (paper|work)|is the (paper|work)/i);
    /* The other rows keep the plain line. */
    expect(row(CENTRAL.id).querySelector(".cite-read")?.textContent).toBe(CITE_NOT_READ);
  });

  it("is one function over linkFrom, so the band and the hover card say the same", () => {
    expect(readNoteOf(FOUND)).toBe(CITE_PAGE_FOUND);
    for (const linkFrom of ["doi", "arxiv", "article", "search"] as const) {
      expect(readNoteOf({ linkFrom })).toBe(CITE_NOT_READ);
    }
  });

  it("says it to a visitor too, whose list never carries a Find it result", async () => {
    await act(async () =>
      root.render(
        createElement(CitationsPanel, {
          access: {
            kind: "visitor",
            citations: {
              capped: false,
              citations: [
                {
                  id: "spya-v2w3x4",
                  title: "Public",
                  why: "What the piece uses it for.",
                  mentions: [],
                  citedAt: [FIRST],
                  firstCited: FIRST,
                  citedInBody: true,
                  url: "https://doi.org/10.1000/xyz",
                  linkFrom: "doi",
                },
              ],
            },
          },
          order: "document",
          onOrder: () => {},
          bar: null,
          onBar: () => {},
          onJump: () => {},
        }),
      ),
    );
    expect(row("spya-v2w3x4").querySelector(".cite-read")?.textContent).toBe(CITE_NOT_READ);
    expect(row("spya-v2w3x4").querySelector(".cite-find")).toBeNull();
  });

  /* Stage 1 pinned "does not read the work" here. Since stage 2 the press reads
     a search extract, so the card says that instead — and still never that it
     read the full work, or checked the page is the work. Since plan 260930d the
     card is Investigate's, whose first step is that lookup. */
  it("the Investigate card, on a searched row, claims no check that the page is the work", async () => {
    const searched = work({
      id: "spya-e2f3g4",
      title: "Searched",
      relevance: 0.9,
      influence: 0.9,
      url: "https://scholar.google.com/scholar?q=Searched",
      linkFrom: "search",
    });
    await draw(owner({ citations: artefact([searched, PASSING]) }));
    const card = await cardFor(investigateButton(searched.id));
    const copy = `${card.head} ${card.body}`;
    expect(copy).not.toMatch(/verif|confirm|real link/i);
    expect(copy, "the card no longer says a searched row gains a link").toMatch(/scholar search/i);
    expect(copy, "the card no longer says it does not read the full work").toMatch(
      /never fetches the paper itself/i,
    );
  });
});

/* ---------------------------------------------------- after Look it up --
   Plan 260929g stage 2. A lookup reads one search result's extract — never the
   work — so every state's line says what was read and from where, the verdict
   is labelled as the AI's reading of that extract, each quote is labelled as
   the extract's, and no wording ever says the work does not support the
   claim. Asserted on the elements, not the row's text, which the sr-only
   tooltip spans also feed. */

const LOOKUP_BASE = {
  host: "arxiv.org",
  searches: 1,
  model: "test",
  at: "2026-09-29T09:00:00.000Z",
  contextHash: "ctx",
  evidenceHash: "ev",
};

const SUPPORT_QUOTE = "we find that loss scales as a power law with model size";
const DOES_QUOTE = "we study empirical scaling laws for language model performance";

const ASSESSED: NonNullable<CitedWork["lookup"]> = {
  ...LOOKUP_BASE,
  state: "assessed",
  excerptWords: 310,
  verdict: { support: "supports", quote: SUPPORT_QUOTE },
  paperDoes: { says: "It measures how loss falls as models grow.", quote: DOES_QUOTE },
};

const NOT_IN_EXTRACT: NonNullable<CitedWork["lookup"]> = {
  ...LOOKUP_BASE,
  state: "assessed",
  excerptWords: 120,
  verdict: { support: "not-in-extract" },
};

/** A row the article linked by DOI, looked up anyway. */
const LOOKED = work({ id: "spya-r2s3t4", title: "Looked", relevance: 0.9, influence: 0.9, lookup: ASSESSED });

describe("what a row says after Look it up", () => {
  it("says one line for each state, naming the host, and never that it read the work", () => {
    const cases: [NonNullable<CitedWork["lookup"]>, string][] = [
      [ASSESSED, citeReadAssessed(310, "arxiv.org")],
      [{ ...LOOKUP_BASE, state: "no-extract" }, citeReadNoExtract("arxiv.org")],
      [{ ...LOOKUP_BASE, state: "not-identified" }, citeReadNotIdentified("arxiv.org")],
      [{ ...LOOKUP_BASE, state: "unreadable" }, citeReadUnreadable("arxiv.org")],
    ];
    for (const [lookup, line] of cases) {
      const said = readNoteOf({ linkFrom: "doi", lookup });
      expect(said).toBe(line);
      expect(said).toContain("arxiv.org");
      expect(said).not.toMatch(/verif|confirmed|from the paper|does not support/i);
    }
    expect(citeReadAssessed(310, "arxiv.org")).toMatch(/not read the work itself/);
    expect(citeReadAssessed(310, "arxiv.org")).toContain("310 words");
    expect(citeReadUnreadable("arxiv.org")).toMatch(/not read the work itself/);
    expect(citeReadUnreadable("arxiv.org")).toMatch(/show nothing from that extract/);
    for (const [, line] of cases.slice(1)) expect(line).toMatch(/nothing/);
    /* No lookup: stage 1's two lines, unchanged. */
    expect(readNoteOf({ linkFrom: "doi" })).toBe(CITE_NOT_READ);
    expect(readNoteOf({ linkFrom: "web" })).toBe(CITE_PAGE_FOUND);
  });

  it("draws an assessed row's verdict and quotes, each labelled as the extract's and the AI's", async () => {
    await draw(owner({ citations: artefact([LOOKED, CENTRAL]) }));
    const r = row(LOOKED.id);
    expect(r.querySelector(".cite-read")?.textContent).toBe(citeReadAssessed(310, "arxiv.org"));

    const verdict = r.querySelector(".cite-verdict");
    expect(verdict?.querySelector(".cite-lookup-label")?.textContent).toContain(CITE_VERDICT_LABEL);
    expect(verdict?.querySelector(".cite-verdict-text")?.textContent).toBe(verdictText("supports"));
    expect(CITE_VERDICT_LABEL).toMatch(/AI's reading/);

    const quotes = [...r.querySelectorAll(".cite-quote")];
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.querySelector("blockquote")?.textContent).toContain(SUPPORT_QUOTE);
    expect(quotes[1]?.querySelector("blockquote")?.textContent).toContain(DOES_QUOTE);
    for (const q of quotes) expect(q.querySelector("figcaption")?.textContent).toBe(CITE_QUOTE_LABEL);

    const does = r.querySelector(".cite-does");
    expect(does?.querySelector(".cite-lookup-label")?.textContent).toContain(CITE_DOES_LABEL);
    expect(does?.textContent).toContain("It measures how loss falls as models grow.");

    /* A row with no lookup draws none of it. */
    expect(row(CENTRAL.id).querySelector(".cite-lookup")).toBeNull();
    /* No wording anywhere in the reading claims more than the extract. */
    const reading = r.querySelector(".cite-lookup")?.textContent ?? "";
    expect(reading).not.toMatch(/verified|confirmed|from the paper/i);
  });

  it("never reads not-in-extract as the work not supporting it", async () => {
    const quiet = work({ id: "spya-u2v3w4", title: "Quiet", relevance: 0.9, influence: 0.9, lookup: NOT_IN_EXTRACT });
    await draw(owner({ citations: artefact([quiet]) }));
    const r = row(quiet.id);
    const said = r.querySelector(".cite-verdict-text")?.textContent ?? "";
    expect(said).toBe(verdictText("not-in-extract"));
    expect(said).toMatch(/extract/);
    expect(said).toMatch(/though the full work might$/);
    for (const s of ["supports", "partly", "not-in-extract"] as const) {
      expect(verdictText(s)).not.toMatch(/does not support|doesn't support|unsupported|contradict/i);
    }
    /* No quote to show, and none is invented. */
    expect(r.querySelector(".cite-quote")).toBeNull();
  });

  it("shows nothing under the line for a state that read nothing", async () => {
    const none = work({
      id: "spya-x2y3z4",
      title: "None read",
      relevance: 0.9,
      influence: 0.9,
      lookup: { ...LOOKUP_BASE, state: "no-extract" },
    });
    await draw(owner({ citations: artefact([none]) }));
    const r = row(none.id);
    expect(r.querySelector(".cite-read")?.textContent).toBe(citeReadNoExtract("arxiv.org"));
    expect(r.querySelector(".cite-lookup")).toBeNull();
  });

  /* Plan 260930d: Look it up is Investigate's first step, so no row — linked,
     looked up already, or neither — has a Look it up button of its own. */
  it("offers no Look it up button on any row: one Investigate, which presses for its own row", async () => {
    const pressed: string[] = [];
    await draw(
      owner({
        citations: artefact([CENTRAL, LOOKED]),
        investigate: async (id) => {
          pressed.push(id);
        },
      }),
    );
    for (const id of [CENTRAL.id, LOOKED.id]) {
      expect(row(id).querySelector(".cite-find"), "a Look it up button came back").toBeNull();
      expect(row(id).querySelectorAll(".cite-meta .gloss-btn")).toHaveLength(1);
    }
    expect(row(CENTRAL.id).textContent).not.toMatch(/Look it up/);
    await act(async () => investigateButton(CENTRAL.id).click());
    expect(pressed).toEqual([CENTRAL.id]);
  });

  it("the Investigate card says it reads an extract, not the work, and that a given link stays", async () => {
    await draw(owner({ citations: artefact([CENTRAL]) }));
    const card = await cardFor(investigateButton(CENTRAL.id));
    expect(card.head).toBe("Investigate");
    const copy = `${card.head} ${card.body}`;
    expect(copy).toMatch(/extract/i);
    expect(copy).toMatch(/quoting only passages code found/i);
    expect(copy).toMatch(/link the article gave never changes/i);
    expect(copy).not.toMatch(/verif|confirm|real link|from the paper/i);
  });

  it("says the first step's no-match quietly on the row it was pressed on", async () => {
    await draw(
      owner({
        citations: artefact([CENTRAL, LOOKED]),
        findNote: { id: CENTRAL.id, kind: "no-match", message: "No page the search found was clearly this work's own." },
      }),
    );
    expect(row(CENTRAL.id).querySelector(".cite-find-note")?.textContent).toBe(
      "No page the search found was clearly this work's own.",
    );
    expect(row(LOOKED.id).querySelector(".cite-find-note")).toBeNull();
  });
});

/* ------------------------------------------------------------ Investigate --
   Plan 260930a stage 2. The button on every owner row, the answer streaming
   into its row, a failure that replaces the whole streamed text, the kept
   answer folded to its first part, and what was read said by code. */

const {
  INVESTIGATE_FINDING,
  INVESTIGATE_LOOKUP_KEPT,
  INVESTIGATE_PREVIOUS_KEPT,
  INVESTIGATE_WAIT,
  investigationProvenance,
} = await import("../src/web/CitationInvestigation.js");

const INVESTIGATION: NonNullable<CitedWork["investigation"]> = {
  answer:
    "Does it back the claim?\nThe abstract on arxiv.org says the model does this.\n\nHow else it bears on this article\nIt also extends the method in a second direction.",
  sources: [
    { url: "https://arxiv.org/abs/1234", title: "The paper's page" },
    { url: "https://www.nature.com/articles/x" },
  ],
  extractsRead: 2,
  longestExtractWords: 310,
  matchedHost: null,
  searches: 1,
  searchesFrom: "usage.server_tool_use.web_search_requests",
  model: "test",
  at: "2026-09-30T09:00:00.000Z",
  contextHash: "ctx",
  promptVersion: "1",
};

describe("Investigate", () => {
  it("is on every owner row, alone, and presses for its own row", async () => {
    const pressed: string[] = [];
    await draw(
      owner({
        citations: artefact([CENTRAL, FAMOUS]),
        investigate: async (id) => {
          pressed.push(id);
        },
      }),
    );
    for (const id of [CENTRAL.id, FAMOUS.id]) {
      const b = investigateButton(id);
      expect(b.textContent).toBe("Investigate");
      expect(b.closest(".cite-meta")?.querySelector(".cite-find")).toBeNull();
      expect(b.hasAttribute("title"), "the button fell back to a title attribute").toBe(false);
    }
    await act(async () => investigateButton(FAMOUS.id).click());
    expect(pressed).toEqual([FAMOUS.id]);
  });

  it("is on no visitor row", async () => {
    await act(async () =>
      root.render(
        createElement(CitationsPanel, {
          access: {
            kind: "visitor",
            citations: {
              capped: false,
              citations: [
                {
                  id: "spya-v2w3x4",
                  title: "Public",
                  why: "What the piece uses it for.",
                  mentions: [],
                  citedAt: [FIRST],
                  firstCited: FIRST,
                  citedInBody: true,
                  url: "https://doi.org/10.1000/xyz",
                  linkFrom: "doi",
                },
              ],
            },
          },
          order: "document",
          onOrder: () => {},
          bar: null,
          onBar: () => {},
          onJump: () => {},
        }),
      ),
    );
    expect(row("spya-v2w3x4").querySelector(".cite-investigate")).toBeNull();
    expect(row("spya-v2w3x4").querySelector(".cite-inv")).toBeNull();
  });

  it("its card says what it does, costs and keeps, and distinguishes extracts from pages it fetched", async () => {
    await draw(owner({ citations: artefact([CENTRAL]) }));
    const card = await cardFor(investigateButton(CENTRAL.id));
    expect(card.head).toBe("Investigate");
    expect(earnsItsHover(card), "the Investigate card does not earn its hover").toBeNull();
    const copy = `${card.head} ${card.body}`;
    expect(copy).toMatch(/searches the web/i);
    expect(copy).toMatch(/profile/i);
    /* Plan 260930d: both steps, in order. */
    expect(card.what).toMatch(/^First it searches the web for this work's own page/);
    expect(card.what).toMatch(/Then it writes a longer reading/);
    expect(card.what).toMatch(/unless it already has a current checked reading/);
    expect(card.what).not.toMatch(/unless it has already/);
    expect(card.how).toMatch(/costs money/i);
    expect(card.how).toMatch(/extracts/i);
    expect(card.how).toMatch(/may be an abstract or part of a paper/i);
    expect(card.how).toMatch(/never fetches the paper itself/i);
    expect(card.how).toMatch(/When the quick check finds a matching page, its result is kept on this row/);
    expect(card.how).toMatch(/The longer reading is kept on this row when it finishes/);
    expect(card.how).not.toMatch(/Both results are kept/);
    expect(copy).not.toMatch(/verif|confirm|model call|not the paper|reads the paper/i);
  });

  it("says it is finding the work while the first step runs, then what the wait is", async () => {
    await draw(
      owner({ citations: artefact([CENTRAL, FAMOUS]), investigating: CENTRAL.id, investigateStage: "finding" }),
    );
    expect(row(CENTRAL.id).querySelector(".cite-inv-wait")?.textContent).toBe(INVESTIGATE_FINDING);
    expect(INVESTIGATE_FINDING).toBe("Finding the work…");
    expect(row(FAMOUS.id).querySelector(".cite-inv-wait")).toBeNull();
    await draw(
      owner({ citations: artefact([CENTRAL, FAMOUS]), investigating: CENTRAL.id, investigateStage: "reading" }),
    );
    expect(row(CENTRAL.id).querySelector(".cite-inv-wait")?.textContent).toBe(INVESTIGATE_WAIT);
  });

  it("streams into the pressed row only, says what the wait is first, and holds every other row", async () => {
    await draw(owner({ citations: artefact([CENTRAL, FAMOUS]), investigating: CENTRAL.id }));
    expect(row(CENTRAL.id).querySelector(".cite-inv-wait")?.textContent).toBe(INVESTIGATE_WAIT);
    expect(investigateButton(CENTRAL.id).textContent).toBe("Investigating…");
    expect(investigateButton(FAMOUS.id).getAttribute("aria-disabled")).toBe("true");

    let pressed = 0;
    await draw(
      owner({
        citations: artefact([CENTRAL, FAMOUS]),
        investigating: CENTRAL.id,
        investigateDraft: { id: CENTRAL.id, text: "Does it back the claim?\nThe abs" },
        investigate: async () => {
          pressed++;
        },
      }),
    );
    expect(row(CENTRAL.id).querySelector(".cite-inv-wait")).toBeNull();
    expect(row(CENTRAL.id).querySelector(".cite-inv-draft")?.textContent).toBe("Does it back the claim?\nThe abs");
    expect(row(FAMOUS.id).querySelector(".cite-inv")).toBeNull();
    await act(async () => investigateButton(FAMOUS.id).click());
    expect(pressed, "a second Investigate started while one was out").toBe(0);
  });

  it("on a failure, shows the sentence in place of everything that streamed, and offers it again", async () => {
    let pressed = 0;
    await draw(
      owner({
        citations: artefact([CENTRAL]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "This answer tried to quote a source directly.",
          previousAt: null,
          previousLookupAt: null,
          lookupKept: false,
        },
        investigate: async () => {
          pressed++;
        },
      }),
    );
    const r = row(CENTRAL.id);
    expect(r.querySelector(".cite-inv-draft")).toBeNull();
    expect(r.querySelector(".cite-inv-error")?.textContent).toContain("This answer tried to quote a source directly.");
    expect(r.querySelector(".cite-inv-previous")).toBeNull();
    const again = r.querySelector<HTMLButtonElement>(".cite-inv-again");
    expect(again?.textContent).toBe("Investigate again");
    await act(async () => again?.click());
    expect(pressed).toBe(1);
  });

  it("on a failed Investigate again, restores the previous answer and says the new one was not kept", async () => {
    const had = { ...CENTRAL, investigation: INVESTIGATION };
    await draw(
      owner({
        citations: artefact([had]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: INVESTIGATION.at,
          previousLookupAt: null,
          lookupKept: false,
        },
      }),
    );
    const r = row(CENTRAL.id);
    expect(r.querySelector(".cite-inv-error")?.textContent).toContain("It stopped.");
    expect(r.querySelector(".cite-inv-previous")?.textContent).toBe(INVESTIGATE_PREVIOUS_KEPT);
    expect(r.querySelector(".cite-inv-text")?.textContent).toBe("The abstract on arxiv.org says the model does this.");
  });

  /* Plan 260930d P-4: the first step stored a page, then the reading failed. */
  it("after a lookup that landed and a reading that failed, says the quick check was kept, and shows it", async () => {
    await draw(
      owner({
        citations: artefact([{ ...CENTRAL, lookup: ASSESSED }]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: null,
          previousLookupAt: null,
          lookupKept: true,
        },
      }),
    );
    const r = row(CENTRAL.id);
    expect(r.querySelector(".cite-inv-error")?.textContent).toContain("It stopped.");
    const said = [...r.querySelectorAll(".cite-inv-previous")].map((n) => n.textContent);
    expect(said).toEqual([INVESTIGATE_LOOKUP_KEPT]);
    expect(INVESTIGATE_LOOKUP_KEPT).toBe("The longer investigation failed; the quick check was kept.");
    /* The lookup itself is the row's, from the re-read. */
    expect(r.querySelectorAll(".cite-verdict")).toHaveLength(1);
  });

  it("says the quick check was kept when its frame was lost but the failure re-read attached it", async () => {
    await draw(
      owner({
        citations: artefact([{ ...CENTRAL, lookup: ASSESSED }]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: null,
          previousLookupAt: null,
          lookupKept: false,
        },
      }),
    );
    expect([...row(CENTRAL.id).querySelectorAll(".cite-inv-previous")].map((n) => n.textContent)).toEqual([
      INVESTIGATE_LOOKUP_KEPT,
    ]);
  });

  it("claims the earlier investigation is still shown only when one still attaches after the re-read", async () => {
    /* The new match detached the earlier answer: nothing stored on the row. */
    await draw(
      owner({
        citations: artefact([{ ...CENTRAL, lookup: ASSESSED }]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: INVESTIGATION.at,
          previousLookupAt: null,
          lookupKept: true,
        },
      }),
    );
    let said = [...row(CENTRAL.id).querySelectorAll(".cite-inv-previous")].map((n) => n.textContent);
    expect(said).toEqual([INVESTIGATE_LOOKUP_KEPT]);

    /* It still attaches: both sentences, and the answer. */
    await draw(
      owner({
        citations: artefact([{ ...CENTRAL, lookup: ASSESSED, investigation: INVESTIGATION }]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: INVESTIGATION.at,
          previousLookupAt: null,
          lookupKept: true,
        },
      }),
    );
    said = [...row(CENTRAL.id).querySelectorAll(".cite-inv-previous")].map((n) => n.textContent);
    expect(said).toEqual([INVESTIGATE_LOOKUP_KEPT, INVESTIGATE_PREVIOUS_KEPT]);
    expect(row(CENTRAL.id).querySelector(".cite-inv-text")).not.toBeNull();
  });

  it("draws a newer stored answer rather than the failure, since an error does not prove nothing was kept", async () => {
    const kept = { ...CENTRAL, investigation: INVESTIGATION };
    await draw(
      owner({
        citations: artefact([kept]),
        investigateFailed: {
          id: CENTRAL.id,
          message: "It stopped.",
          previousAt: null,
          previousLookupAt: null,
          lookupKept: false,
        },
      }),
    );
    const r = row(CENTRAL.id);
    expect(r.querySelector(".cite-inv-error")).toBeNull();
    expect(r.querySelector(".cite-inv-text")).not.toBeNull();
  });

  it("folds a kept answer to its first part, and opens to every part, what was read, the sources and the date", async () => {
    await draw(owner({ citations: artefact([{ ...CENTRAL, investigation: INVESTIGATION }]) }));
    const r = row(CENTRAL.id);
    expect(investigateButton(CENTRAL.id).textContent).toBe("Investigate again");
    expect([...r.querySelectorAll(".cite-inv-lead")].map((n) => n.textContent)).toEqual(["Does it back the claim?"]);
    expect(r.querySelector(".cite-inv-prov")).toBeNull();
    const toggle = r.querySelector<HTMLButtonElement>(".cite-inv-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect([...r.querySelectorAll(".cite-inv-lead")].map((n) => n.textContent)).toEqual([
      "Does it back the claim?",
      "How else it bears on this article",
    ]);
    expect(r.querySelector(".cite-inv-prov")?.textContent).toBe(investigationProvenance(INVESTIGATION));
    const links = [...r.querySelectorAll<HTMLAnchorElement>(".cite-inv-sources a")];
    expect(links.map((a) => a.textContent)).toEqual(["arxiv.org", "nature.com"]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
    expect(r.querySelector(".cite-inv-sources")?.textContent).toContain("The paper's page");
    expect(r.querySelector(".cite-inv-foot")?.textContent).toMatch(/^Investigated .+ · Investigate again$/);
    /* Plan 260930d: the offer of Look it up went with its button. */
    expect(r.querySelector(".cite-inv-offer")).toBeNull();
    expect(r.querySelectorAll(".cite-find")).toHaveLength(0);
    expect(r.querySelector(".cite-inv-prov")?.textContent).toMatch(/We could not confirm that any result is this work itself\.$/);
  });

  it("on a looked-up row with no matching extract, says so rather than 'could not confirm'", async () => {
    await draw(owner({ citations: artefact([{ ...LOOKED, investigation: INVESTIGATION }]) }));
    const r = row(LOOKED.id);
    await act(async () => r.querySelector<HTMLButtonElement>(".cite-inv-toggle")?.click());
    const prov = r.querySelector(".cite-inv-prov")?.textContent ?? "";
    expect(prov).toBe(investigationProvenance(INVESTIGATION, ASSESSED));
    expect(prov).toMatch(
      /An earlier quick check matched a page on arxiv\.org; this search did not return an extract from it\.$/,
    );
    expect(prov).not.toMatch(/could not confirm/);
    /* The lookup's own reading is still drawn once, by the row. */
    expect(r.querySelectorAll(".cite-verdict")).toHaveLength(1);
  });

  it("renders answer and source titles as text, and links only to http(s) sources", async () => {
    const unsafe = {
      ...INVESTIGATION,
      answer: "Does it back the claim?\n<img src=x onerror=alert(1)> is model text.",
      sources: [
        { url: "javascript:alert(1)", title: "<img src=x onerror=alert(2)>" },
        { url: "https://safe.example/paper", title: "<b>Source title</b>" },
      ],
    };
    await draw(owner({ citations: artefact([{ ...CENTRAL, investigation: unsafe }]) }));
    const r = row(CENTRAL.id);
    expect(r.querySelector("img, b")).toBeNull();
    expect(r.querySelector(".cite-inv-text")?.textContent).toContain("<img src=x onerror=alert(1)>");

    await act(async () => r.querySelector<HTMLButtonElement>(".cite-inv-toggle")?.click());
    const links = [...r.querySelectorAll<HTMLAnchorElement>(".cite-inv-sources a")];
    expect(links.map((link) => link.href)).toEqual(["https://safe.example/paper"]);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toContain("noopener");
    expect(r.querySelector(".cite-inv-source-title")?.textContent).toContain("<b>Source title</b>");
  });
});

/* ------------------------------------------------------- a finger's press --
   Both of a row's paid buttons carry a card saying what a press costs, and on
   a touch screen the tap that opened the card was also the tap that spent the
   money (plan 260930a § Review log, Browser check). Reveal, then commit: a
   finger's first tap opens the card and says "Tap again to do it.", the second
   presses; a mouse presses at once. docs/project/touch.md.

   The pointer is read off the press's `pointerdown`, never off the click: on
   iOS 18.2 and later a finger's click says `mouse` (WebKit bug 282988), so the
   iPad case below sends exactly that. jsdom has no PointerEvent, so these are
   MouseEvents carrying `pointerType`, as tests/spine-hover.test.tsx sends. */

function fire(el: Element, type: string, pointerType: string) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
}

/** One press: down, up, click. `click` is what the click itself reports. */
async function press(el: Element, down: "touch" | "mouse", click: string = down) {
  await act(async () => {
    fire(el, "pointerdown", down);
    fire(el, "pointerup", down);
    fire(el, "click", click);
  });
}

const TAP_AGAIN = "Tap again to do it.";
const tapHint = () => document.querySelector('[role="tooltip"] .tip-soon-tap')?.textContent ?? null;

describe("a finger's first press on a paid button reveals its card; the second presses", () => {
  /* One paid button since plan 260930d; *Look it up* was the second. */
  const buttons = [["Investigate", "investigate", investigateButton]] as const;

  for (const [name, hook, button] of buttons) {
    it(`${name}: the first tap opens the card and spends nothing, the second presses`, async () => {
      const pressed: string[] = [];
      await draw(owner({ citations: artefact([CENTRAL]), [hook]: async (id: string) => void pressed.push(id) }));
      await press(button(CENTRAL.id), "touch");
      expect(pressed, "one tap spent the money").toEqual([]);
      expect(tapHint()).toBe(TAP_AGAIN);
      await press(button(CENTRAL.id), "touch");
      expect(pressed).toEqual([CENTRAL.id]);
    });

    it(`${name}: an iPad's tap, whose click says mouse, still only reveals`, async () => {
      const pressed: string[] = [];
      await draw(owner({ citations: artefact([CENTRAL]), [hook]: async (id: string) => void pressed.push(id) }));
      await press(button(CENTRAL.id), "touch", "mouse");
      expect(pressed, "the click's pointerType decided it, not the press's").toEqual([]);
      expect(tapHint()).toBe(TAP_AGAIN);
      await press(button(CENTRAL.id), "touch", "mouse");
      expect(pressed).toEqual([CENTRAL.id]);
    });

    it(`${name}: a mouse click presses at once and says nothing about tapping`, async () => {
      const pressed: string[] = [];
      await draw(owner({ citations: artefact([CENTRAL]), [hook]: async (id: string) => void pressed.push(id) }));
      await press(button(CENTRAL.id), "mouse");
      expect(pressed).toEqual([CENTRAL.id]);
      expect(tapHint()).toBeNull();
    });
  }
});

/* ------------------------------------ already an article here, plan 260930b -- */

describe("a row whose work is already an article here", () => {
  it("links to the reader's own copy in this tab, and says how it matched in the tooltip", async () => {
    const owned = work({
      ...CENTRAL,
      inSpideryarn: { slug: "my-copy-spya-a2b3c4", whose: "yours", matchedBy: "doi", title: "My copy" },
    });
    await draw(owner({ citations: artefact([owned, FAMOUS]) }));
    const a = row(owned.id).querySelector<HTMLAnchorElement>(".cite-here a");
    expect(a?.textContent).toBe("In your library");
    expect(a?.getAttribute("href")).toBe("/read/my-copy-spya-a2b3c4");
    expect(a?.getAttribute("target")).toBeNull();
    expect(a?.title).toContain("My copy");
    expect(a?.title).toContain("the same DOI");
    /* A DOI match is identity, so the row does not repeat the title. */
    expect(row(owned.id).querySelector(".cite-here-how")).toBeNull();
    /* A matched article does not mean we read the cited work: 5G's line stands. */
    expect(row(owned.id).querySelector(".cite-read")?.textContent).toBe(CITE_NOT_READ);
    expect(row(FAMOUS.id).querySelector(".cite-here")).toBeNull();
  });

  it("names the article a title match found, on the row, so the reader can check it", async () => {
    const shared = work({
      ...CENTRAL,
      inSpideryarn: { slug: "theirs-spya-d5e6f7", whose: "public", matchedBy: "title", title: "Central, as shared" },
    });
    await draw(owner({ citations: artefact([shared]) }));
    const line = row(shared.id).querySelector(".cite-here");
    expect(line?.querySelector("a")?.textContent).toBe("On the public shelf");
    expect(line?.querySelector(".cite-here-how")?.textContent).toContain("matched by title");
    expect(line?.querySelector(".cite-here-how")?.textContent).toContain("Central, as shared");
  });

  it("never renders an owner attachment on a visitor's row, even from a malformed payload", async () => {
    const leaked = work({
      ...CENTRAL,
      inSpideryarn: { slug: "private-spya-g8h9j2", whose: "yours", matchedBy: "doi", title: "Private copy" },
    });
    /* PublicCitedWork cannot name this field. The cast models a wire payload
       that violated that type, so the panel's visitor arm is independently
       pinned rather than trusting a compile-time promise about JSON. */
    const citations = { citations: [leaked], capped: false } as unknown as PublicCitations;
    await drawVisitor(citations);
    expect(row(leaked.id).querySelector(".cite-here")).toBeNull();
    expect(host.textContent).not.toContain("Private copy");
  });
});
