// @vitest-environment jsdom
/**
 * FAQ mode's panel: a row is a question and the article's own passages — no
 * written answer — and the (i) in the order row keeps both halves of the
 * promise (in the foot until SPIDERYARN-READING2-62).
 * docs/project/faq.md, src/web/FaqPanel.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Faq, FaqDropped, FaqQuestion, Job } from "../src/types.js";
import type { UseFaq } from "../src/web/useFaq.js";
import type { FaqAccess } from "../src/web/FaqPanel.js";
import { FAQ_BAR_DEFAULT, type FaqOrder } from "../src/web/faq-order.js";

const { FAQ_NONE, FAQ_PROMISE, FaqPanel, droppedCount, droppedNote } = await import(
  "../src/web/FaqPanel.js"
);

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const EARLY = "spya-f4q7tw" as BlockId;
const LATER = "spya-r8z3nh" as BlockId;

const NOTHING_DROPPED: FaqDropped = {
  unknownIds: 0,
  unquoted: 0,
  tooLong: 0,
  duplicate: 0,
  unanchored: 0,
  overCap: 0,
  malformed: 0,
};

const FRIDGE: FaqQuestion = {
  id: "faq-fridge",
  question: "If entropy only increases, how can a fridge get colder?",
  passages: [
    { blockId: EARLY, quote: "a closed system can lower its local entropy", start: 12 },
    { blockId: LATER, quote: "only by exporting more to its surroundings", start: 0 },
  ],
};
const ISOLATED: FaqQuestion = {
  id: "faq-isolated",
  question: "Does the argument depend on the system being isolated?",
  passages: [{ blockId: LATER, quote: "we will assume the box is sealed", start: 40 }],
};

const RUNNING: Job = {
  id: "job-faq",
  ownerId: "owner" as Job["ownerId"],
  slug: "a-piece",
  status: "running",
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: "2026-09-29T00:00:01.000Z",
  steps: [{ name: "faq", label: "Writing the FAQ", status: "running" }],
};

function artefact(questions: FaqQuestion[], dropped: FaqDropped = NOTHING_DROPPED): Faq {
  return {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    questions,
    dropped,
    generatedAt: "2026-09-16T09:00:00.000Z",
    elapsedMs: 1,
  };
}

function owner(over: Partial<UseFaq> = {}): UseFaq {
  return {
    status: "ready",
    faq: artefact([FRIDGE, ISOLATED]),
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

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

const jumps: BlockId[] = [];
/* The band's (i), in its corner since 2026-10-01 (spya-ucu35y, plan 261001m);
   it was at the order row's end. Its card opens with the mode's catalog words. */
const ABOUT = '.mode-band > .band-about[aria-label="About this mode"]';
const about = () => host.querySelector<HTMLButtonElement>(ABOUT)!;
const tip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
const orders: FaqOrder[] = [];
const bars: (number | null)[] = [];

/** `?faqby=` and `?faqbar=` as the panel is handed them — the default is "untouched". */
interface Controls {
  order?: FaqOrder;
  bar?: number | null;
}

async function draw(o: UseFaq, controls: Controls = {}) {
  await drawAccess({ kind: "owner", owner: o }, controls);
}

async function drawAccess(access: FaqAccess, { order = "prioritised", bar = null }: Controls = {}) {
  jumps.length = 0;
  orders.length = 0;
  bars.length = 0;
  await act(async () =>
    root.render(
      createElement(FaqPanel, {
        access,
        order,
        onOrder: (next: FaqOrder) => void orders.push(next),
        bar,
        onBar: (next: number | null) => void bars.push(next),
        onJump: (id: BlockId) => void jumps.push(id),
      }),
    ),
  );
}

function row(id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-faq-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
}

describe("the dropped count", () => {
  it("adds every kind, and says nothing when nothing was left out", () => {
    expect(droppedCount(NOTHING_DROPPED)).toBe(0);
    expect(droppedNote(NOTHING_DROPPED)).toBeNull();
    const some = { ...NOTHING_DROPPED, unquoted: 2, unanchored: 1 };
    expect(droppedCount(some)).toBe(3);
    expect(droppedNote(some)).toBe("3 more questions or passages the model gave were left out in checking.");
    expect(droppedNote({ ...NOTHING_DROPPED, malformed: 1 })).toBe(
      "1 more question or passage the model gave was left out in checking.",
    );
  });
});

describe("FaqPanel", () => {
  it("is a labelled band with no head row naming the mode", async () => {
    await draw(owner());
    const band = host.querySelector("aside.mode-band.faq");
    expect(band?.getAttribute("aria-label")).toBe("FAQ");
    expect(host.querySelector(".band-head")).toBeNull();
  });

  it("draws each question as a heading, then its passages in the stored order, each with a jump", async () => {
    await draw(owner());
    const r = row(FRIDGE.id);
    expect(r.querySelector("h2")?.textContent).toBe(FRIDGE.question);
    expect(r.querySelector("h3")).toBeNull();
    const passages = [...r.querySelectorAll(".faq-passage")];
    expect(passages.map((p) => p.querySelector(".faq-quote")?.textContent)).toEqual([
      "a closed system can lower its local entropy",
      "only by exporting more to its surroundings",
    ]);
    /* The article-provenance rule, not the model's dotted one. */
    for (const p of passages) {
      expect(p.classList.contains("gloss-part-senseHere")).toBe(true);
      expect(p.classList.contains("gloss-part-background")).toBe(false);
    }
    const refs = [...r.querySelectorAll<HTMLAnchorElement>(".block-ref")];
    expect(refs.map((a) => a.textContent)).toEqual(["f4q7tw", "r8z3nh"]);
    await act(async () => refs[1]?.click());
    expect(jumps).toEqual([LATER]);
  });

  it("keeps the questions in the artefact's order", async () => {
    await draw(owner({ faq: artefact([ISOLATED, FRIDGE]) }));
    expect([...host.querySelectorAll(".faq-question")].map((h) => h.textContent)).toEqual([
      ISOLATED.question,
      FRIDGE.question,
    ]);
  });

  /* SPIDERYARN-READING2-62: the promise left the foot for an (i) at the end of
     the order row, as Skim's did for 52 (plan 260930d); the (i) moved to
     the band's corner on 2026-10-01 (plan 261001m). */
  it("says the words are checked and the pairing is the model's reading, behind an (i) rather than on the page", async () => {
    await draw(owner());
    expect(FAQ_PROMISE).toContain("checked against it");
    expect(FAQ_PROMISE).toContain("the model's reading");
    expect(host.textContent).not.toContain(FAQ_PROMISE);
    expect(host.querySelector(".faq-foot")).toBeNull();
    expect(host.textContent).not.toContain("Find them again");
    const info = about();
    expect(info.hasAttribute("title"), "a tooltip, not a title").toBe(false);
    expect(info.closest(".gloss-sort-group"), "beside the order group, not announced as an order").toBeNull();
    expect(tip()).toBeNull();
    /* A tap — a click with no hover first — opens it: touch has no hover. */
    await act(async () => info.click());
    expect(tip()).toContain(FAQ_PROMISE);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    await act(async () => info.click());
    expect(info.getAttribute("aria-expanded"), "a second tap closes it").toBe("false");
    /* The keyboard reaches it too: focus opens it, Escape closes it. */
    await act(async () => info.focus());
    expect(info.getAttribute("aria-expanded"), "focus opens it").toBe("true");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(info.getAttribute("aria-expanded"), "Escape closes it").toBe("false");
    await act(async () => info.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(info.getAttribute("aria-expanded"), "a press elsewhere closes it").toBe("false");
    await act(async () => info.blur());
  });

  it("gives a visitor the promise behind the same (i), and never the owner's dropped count", async () => {
    await drawAccess({ kind: "visitor", faq: { questions: [FRIDGE, ISOLATED] } });
    expect(host.textContent).not.toContain(FAQ_PROMISE);
    await act(async () => about().click());
    expect(tip()).toContain(FAQ_PROMISE);
    await act(async () => about().click());
  });

  it("draws no order row for a single question, and keeps the (i) in the corner", async () => {
    await draw(owner({ faq: artefact([{ ...FRIDGE, difficulty: 0.5, centrality: 0.8 }]) }), { order: "difficulty" });
    expect(host.querySelector(".gloss-sort-group")).toBeNull();
    expect(host.querySelector("#faq-bar")).toBeNull();
    expect(host.querySelector(".score-bars")).toBeNull();
    expect(host.querySelector(ABOUT)).not.toBeNull();
  });

  it("adds a quiet dropped count to the (i) only when something was dropped", async () => {
    await draw(owner({ faq: artefact([FRIDGE], { ...NOTHING_DROPPED, unquoted: 2 }) }));
    expect(host.textContent).not.toContain("left out in checking");
    await act(async () => about().click());
    expect(tip()).toContain(FAQ_PROMISE);
    expect(tip()).toContain("2 more questions or passages the model gave were left out in checking.");
    await act(async () => about().click());
  });

  it("treats no questions as an answer, with no retry and no promise", async () => {
    await draw(owner({ faq: artefact([]) }));
    expect(FAQ_NONE).toBe("The model found no questions worth asking this piece.");
    expect(host.textContent).toContain(FAQ_NONE);
    expect(host.textContent).not.toContain("Find them again");
    expect(host.textContent).not.toContain(FAQ_PROMISE);
    /* The band still has its (i) — every mode does — but no promise about
       passages there are none of. */
    await act(async () => about().click());
    expect(tip()).not.toContain(FAQ_PROMISE);
    expect(tip()).toContain("No questions.");
    await act(async () => about().click());
  });

  it("offers to find them when nobody has", async () => {
    await draw(owner({ status: "none", faq: null }));
    expect(host.textContent).toContain("Nobody has asked this piece its questions yet.");
    expect(host.textContent).toContain("Find the questions");
    expect(host.querySelector(".faq-item")).toBeNull();
  });

  it("says it is looking while the read is out", async () => {
    await draw(owner({ status: "loading", faq: null }));
    expect(host.textContent).toContain("Looking for the questions…");
  });

  it("draws a failed read's message", async () => {
    const retryRead = vi.fn(async () => {});
    await draw(
      owner({ status: "error", faq: null, error: "The server could not be reached.", retryRead }),
    );
    expect(host.querySelector(".gloss-error")?.textContent).toBe("The server could not be reached.");
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(retryRead).toHaveBeenCalledOnce();
  });

  it("draws a failed job's sentence under the button", async () => {
    await draw(
      owner({
        status: "none",
        faq: null,
        failed: { message: "The model stopped before it finished.", retryable: false, retry: null },
      }),
    );
    expect(host.textContent).toContain("The model stopped before it finished.");
  });

  /* An outdated list — same article, older prompt — is not announced: Greg,
     2026-09-29 (SPIDERYARN-READING2-55), plan 260929c. Re-running is in Metadata. */
  it("offers to ask again only under a stale list, and says nothing of an older prompt", async () => {
    await draw(owner({ stale: true, outdated: true }));
    expect(host.textContent).toContain("These describe an older version of the article.");
    expect(host.textContent).not.toContain("older version of the prompt");
    expect(host.textContent).toContain("Find them again");
    await draw(owner({ outdated: true }));
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(host.textContent).not.toContain("older version of the prompt");
    expect(host.textContent).not.toContain("Find them again");
  });

  it("shows a Metadata-started job and failure on an outdated list without adding a second foot", async () => {
    await draw(owner({ outdated: true, job: RUNNING }));
    expect(host.querySelectorAll(":scope > aside > .faq-foot")).toHaveLength(1);
    expect(host.querySelector(".faq-foot")?.textContent).toContain("Stop");

    await draw(
      owner({
        outdated: true,
        failed: { message: "The FAQ could not be written.", retryable: false, retry: null },
      }),
    );
    expect(host.querySelectorAll(":scope > aside > .faq-foot")).toHaveLength(1);
    expect(host.querySelector(".faq-foot")?.textContent).toContain("The FAQ could not be written.");
  });

  it("uses the unforced verb when empty and the forced verb when the list needs replacing", async () => {
    const ensure = vi.fn(async () => {});
    const regenerate = vi.fn(async () => {});
    await draw(owner({ status: "none", faq: null, ensure, regenerate }));
    const find = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Find the questions",
    );
    await act(async () => find?.click());
    expect(ensure).toHaveBeenCalledOnce();
    expect(regenerate).not.toHaveBeenCalled();

    await draw(owner({ stale: true, ensure, regenerate }));
    const again = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Find them again",
    );
    await act(async () => again?.click());
    expect(regenerate).toHaveBeenCalledOnce();
    expect(ensure).toHaveBeenCalledOnce();
  });

  it("writes no answer of its own: a row holds the question, the quotes and the ids, and nothing else", async () => {
    await draw(owner());
    const r = row(ISOLATED.id);
    expect(r.textContent).toBe(`${ISOLATED.question}we will assume the box is sealedr8z3nh`);
  });
});

/* ---------------------------------------------- the prioritised order, faq/4 --
   docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md. The compound
   is centrality × (1 − difficulty); the numbers below are chosen so the
   priorities are well apart: BROAD 0.72, FRIDGE 0.40, NARROW 0.05. */

const BROAD: FaqQuestion = {
  id: "faq-broad",
  question: "Does the whole argument need the system to be closed?",
  passages: [{ blockId: LATER, quote: "we will assume the box is sealed", start: 40 }],
  difficulty: 0.1,
  centrality: 0.8,
};
const FRIDGE_SCORED: FaqQuestion = { ...FRIDGE, difficulty: 0.5, centrality: 0.8 };
const NARROW: FaqQuestion = {
  id: "faq-narrow",
  question: "Why is the exported heat counted twice in the second table?",
  passages: [{ blockId: LATER, quote: "only by exporting more to its surroundings", start: 0 }],
  difficulty: 0.9,
  centrality: 0.5,
};
/* Stored in reading order, as src/faq.ts writes them. */
const SCORED = [FRIDGE_SCORED, NARROW, BROAD];
const questionsShown = () => [...host.querySelectorAll(".faq-question")].map((h) => h.textContent);

describe("the prioritised order", () => {
  it("opens on the broadest, most central question, and draws the two raw scores on each row", async () => {
    await draw(owner({ faq: artefact(SCORED) }));
    expect(questionsShown()).toEqual([BROAD.question, FRIDGE.question]);
    const bars = row(BROAD.id).querySelector(".score-bars");
    expect(bars?.getAttribute("aria-label")).toMatch(/centrality .* 80 out of 100, difficulty .* 10 out of 100/);
    /* The compound is ours, never drawn: 0.72 appears nowhere on the row. */
    expect(row(BROAD.id).innerHTML).not.toContain("0.72");
  });

  it("hides what is under the default bar, and says so under the slider", async () => {
    expect(FAQ_BAR_DEFAULT).toBeGreaterThan(0.05);
    await draw(owner({ faq: artefact(SCORED) }));
    const slider = host.querySelector<HTMLInputElement>("#faq-bar");
    expect(slider).not.toBeNull();
    expect(host.querySelector(".gloss-gate-value")?.textContent).toContain("2 of 3");
    expect(host.querySelector(".gloss-gate-note")?.textContent).toBe(
      "1 question is hidden by this threshold. Drag the slider left to show it.",
    );
  });

  it("trims from the bottom as the bar rises", async () => {
    await draw(owner({ faq: artefact(SCORED) }), { bar: 0.5 });
    expect(questionsShown()).toEqual([BROAD.question]);
    await draw(owner({ faq: artefact(SCORED) }), { bar: 0 });
    expect(questionsShown()).toEqual([BROAD.question, FRIDGE.question, NARROW.question]);
  });

  it("offers reading order one tap away, and in it draws every question, stored order, no bar, no scores", async () => {
    await draw(owner({ faq: artefact(SCORED) }));
    const reading = [...host.querySelectorAll<HTMLButtonElement>(".gloss-sort-btn")].find(
      (b) => b.textContent === "reading order",
    );
    await act(async () => reading?.click());
    expect(orders).toEqual(["document"]);
    await draw(owner({ faq: artefact(SCORED) }), { order: "document" });
    expect(questionsShown()).toEqual([FRIDGE.question, NARROW.question, BROAD.question]);
    expect(host.querySelector("#faq-bar")).toBeNull();
    expect(host.querySelector(".score-bars")).toBeNull();
  });

  it("puts an unscored question after the scored ones, and never hides it", async () => {
    await draw(owner({ faq: artefact([ISOLATED, ...SCORED]) }), { bar: 0.5 });
    expect(questionsShown()).toEqual([BROAD.question, ISOLATED.question]);
    expect(row(ISOLATED.id).title).toMatch(/Not scored/);
  });

  it("draws a list from before faq/4 exactly as before for both owner and visitor", async () => {
    const old = [ISOLATED, FRIDGE];
    for (const access of [
      { kind: "owner" as const, owner: owner({ faq: artefact(old) }) },
      { kind: "visitor" as const, faq: { questions: old } },
    ]) {
      await drawAccess(access);
      expect(questionsShown()).toEqual([ISOLATED.question, FRIDGE.question]);
      /* No order to offer, so no row; the (i) is the band's, in its corner. */
      expect(host.querySelector(".gloss-sort")).toBeNull();
      expect(host.querySelector(ABOUT)).not.toBeNull();
      expect(host.querySelector("#faq-bar")).toBeNull();
      expect(host.querySelector(".score-bars")).toBeNull();
    }
  });

  it("gives a visitor the same order and the same bar", async () => {
    await drawAccess({ kind: "visitor", faq: { questions: SCORED } });
    expect(questionsShown()).toEqual([BROAD.question, FRIDGE.question]);
    expect(host.querySelector("#faq-bar")).not.toBeNull();
  });

  it("keeps the list, count, foot line and pressed order together above the data's top", async () => {
    await draw(owner({ faq: artefact([ISOLATED, ...SCORED]) }), { bar: 0.9 });
    expect(questionsShown()).toEqual([ISOLATED.question]);
    expect(host.querySelector(".gloss-gate-value")?.textContent).toContain("1 of 4");
    expect(host.querySelector(".gloss-gate-note")?.textContent).toBe(
      "3 questions are hidden by this threshold. Drag the slider left to show them.",
    );
    expect(host.querySelector<HTMLInputElement>("#faq-bar")?.max).toBe("0.9");
    const pressed = host.querySelector<HTMLButtonElement>('.gloss-sort-btn[aria-pressed="true"]');
    expect(pressed?.textContent).toBe("prioritised");
  });
});

/* -------------------------------------- the single-score orders, 260930d --
   SPIDERYARN-READING2-67: sort by either score the prioritised order is built
   from, as the Glossary sorts by `hardest` and `most central`. */
describe("the single-score orders", () => {
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".gloss-sort-btn")].map((b) => b.textContent);

  it("offers most central and hardest beside prioritised and reading order, and pushes each", async () => {
    await draw(owner({ faq: artefact(SCORED) }));
    expect(buttons()).toEqual(["prioritised", "reading order", "most central", "hardest"]);
    for (const label of ["most central", "hardest"]) {
      await act(async () =>
        [...host.querySelectorAll<HTMLButtonElement>(".gloss-sort-btn")].find((b) => b.textContent === label)?.click(),
      );
    }
    expect(orders).toEqual(["centrality", "difficulty"]);
  });

  it("under most central draws every question, most central first, with no bar and only the centrality score", async () => {
    await draw(owner({ faq: artefact(SCORED) }), { order: "centrality", bar: 0.9 });
    /* FRIDGE and BROAD tie on 0.8, so reading order breaks it. */
    expect(questionsShown()).toEqual([FRIDGE.question, BROAD.question, NARROW.question]);
    expect(host.querySelector("#faq-bar")).toBeNull();
    const label = row(BROAD.id).querySelector(".score-bars")?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/centrality/);
    expect(label).not.toMatch(/difficulty/);
    expect(host.querySelector<HTMLButtonElement>('.gloss-sort-btn[aria-pressed="true"]')?.textContent).toBe(
      "most central",
    );
  });

  it("under hardest draws every question, hardest first, with only the difficulty score", async () => {
    await draw(owner({ faq: artefact(SCORED) }), { order: "difficulty" });
    expect(questionsShown()).toEqual([NARROW.question, FRIDGE.question, BROAD.question]);
    expect(host.querySelector("#faq-bar")).toBeNull();
    const label = row(NARROW.id).querySelector(".score-bars")?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/difficulty/);
    expect(label).not.toMatch(/centrality/);
  });

  it("falls back to reading order when a URL asks for a score the list does not have", async () => {
    await draw(owner({ faq: artefact([ISOLATED, FRIDGE]) }), { order: "difficulty" });
    expect(questionsShown()).toEqual([ISOLATED.question, FRIDGE.question]);
    expect(host.querySelector(".score-bars")).toBeNull();
  });
});
