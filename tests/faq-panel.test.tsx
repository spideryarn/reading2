// @vitest-environment jsdom
/**
 * FAQ mode's panel: a row is a question and the article's own passages — no
 * written answer — and the foot keeps both halves of the promise.
 * docs/project/faq.md, src/web/FaqPanel.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Faq, FaqDropped, FaqQuestion } from "../src/types.js";
import type { UseFaq } from "../src/web/useFaq.js";

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

async function draw(o: UseFaq) {
  jumps.length = 0;
  await act(async () =>
    root.render(createElement(FaqPanel, { owner: o, onJump: (id: BlockId) => void jumps.push(id) })),
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

  it("says the words are checked and the pairing is the model's reading, in the foot", async () => {
    await draw(owner());
    expect(FAQ_PROMISE).toContain("checked against it");
    expect(FAQ_PROMISE).toContain("the model's reading");
    expect(host.textContent).toContain(FAQ_PROMISE);
    expect(host.textContent).not.toContain("left out in checking");
    expect(host.textContent).not.toContain("Find them again");
  });

  it("adds a quiet dropped count only when something was dropped", async () => {
    await draw(owner({ faq: artefact([FRIDGE], { ...NOTHING_DROPPED, unquoted: 2 }) }));
    expect(host.textContent).toContain("2 more questions or passages the model gave were left out in checking.");
  });

  it("treats no questions as an answer, with no retry and no promise", async () => {
    await draw(owner({ faq: artefact([]) }));
    expect(FAQ_NONE).toBe("The model found no questions worth asking this piece.");
    expect(host.textContent).toContain(FAQ_NONE);
    expect(host.textContent).not.toContain("Find them again");
    expect(host.textContent).not.toContain(FAQ_PROMISE);
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

  it("offers to ask again only under a stale or outdated list, stale first", async () => {
    await draw(owner({ stale: true, outdated: true }));
    expect(host.textContent).toContain("These describe an older version of the article.");
    expect(host.textContent).not.toContain("older version of the prompt");
    expect(host.textContent).toContain("Find them again");
    await draw(owner({ outdated: true }));
    expect(host.textContent).toContain("These were written by an older version of the prompt.");
    expect(host.textContent).toContain("Find them again");
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
