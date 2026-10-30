// @vitest-environment jsdom
/**
 * Explanations' band: each row is the article's own words, then the AI's
 * explanation, then the labels that apply and only those, and an *Ask in
 * chat* that hands the row to the anchored passage chat. An empty list is a
 * real answer, said plainly.
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 *
 * Since plan 261029e, Glossary's controls: one run button at the top that says
 * what its run will do (*Find more* or *Write a new list*), the orders, the
 * threshold in the prioritised order, and the margin's *Open in Explanations*
 * still landing on a row the bar was hiding.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Explanation, Explanations } from "../src/types.js";
import type { UseExplanations } from "../src/web/useExplanations.js";
import type { ExplanationOrder } from "../src/web/explanations-order.js";
import type { ItemFocus } from "../src/web/item-focus.js";
import { NOT_SURE_LABEL, OUTSIDE_LABEL, explanationLabels } from "../src/web/explanation-labels.js";

const { EXPLANATIONS_NONE, EXPLANATIONS_NO_MORE, ExplanationsPanel } = await import(
  "../src/web/ExplanationsPanel.js"
);

const BLOCK = "spya-f4q7tw" as BlockId;

const PLAIN: Explanation = {
  id: "e-plain",
  blockId: BLOCK,
  quote: "minimised over the latent variable",
  text: "The model is not given z; it tries every value and keeps the one that fits best.",
  sure: true,
  outside: false,
};
const UNSURE: Explanation = { ...PLAIN, id: "e-unsure", text: "Probably the earlier lemma, though I am unsure which.", sure: false };
const OUTSIDE: Explanation = { ...PLAIN, id: "e-outside", text: "This is the trick from variational inference.", outside: true };

/* Scored, in reading order: products 0.72, 0.04 and 0.30. */
const HARD: Explanation = { ...PLAIN, id: "e-hard", text: "Hard and central.", difficulty: 0.9, centrality: 0.8 };
const EASY: Explanation = { ...PLAIN, id: "e-easy", text: "Easy and peripheral.", difficulty: 0.2, centrality: 0.2 };
const MID: Explanation = { ...PLAIN, id: "e-mid", text: "In between.", difficulty: 0.5, centrality: 0.6 };

function artefact(explanations: Explanation[], over: Partial<Explanations> = {}): Explanations {
  return {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    profileHash: null,
    explanations,
    dropped: { malformed: 0, unknownIds: 0, unquoted: 0, tooLong: 0, ambiguous: 0, badText: 0, repeated: 0, overCap: 0 },
    generatedAt: "2026-10-28T09:00:00.000Z",
    elapsedMs: 1,
    ...over,
  };
}

function owner(over: Partial<UseExplanations> = {}): UseExplanations {
  return {
    status: "ready",
    explanations: artefact([PLAIN, UNSURE, OUTSIDE]),
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    panelRun: "append",
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    loaded: true,
    rewriting: false,
    retryRead: async () => {},
    refresh: async () => {},
    ensure: async () => {},
    more: async () => {},
    cancel: () => {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const asked: Explanation[] = [];

beforeEach(() => {
  asked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

interface Controls {
  order?: ExplanationOrder;
  bar?: number | null;
  onOrder?: (order: ExplanationOrder) => void;
  onBar?: (bar: number | null) => void;
  focus?: ItemFocus | null;
  onFocusTaken?: (focus: ItemFocus) => void;
}

async function draw(o: UseExplanations, c: Controls = {}) {
  await act(async () =>
    root.render(
      createElement(ExplanationsPanel, {
        owner: o,
        order: c.order ?? "prioritised",
        onOrder: c.onOrder ?? (() => {}),
        bar: c.bar ?? null,
        onBar: c.onBar ?? (() => {}),
        onJump: () => {},
        onAsk: (e: Explanation) => void asked.push(e),
        focus: c.focus ?? null,
        onFocusTaken: c.onFocusTaken,
      }),
    ),
  );
}

const row = (id: string) => {
  const el = host.querySelector<HTMLElement>(`[data-explanation-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
};
const rowIds = () => [...host.querySelectorAll<HTMLElement>("[data-explanation-id]")].map((r) => r.dataset.explanationId);
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
const orderButtons = () => [...host.querySelectorAll(".gloss-sort-btn")].map((b) => b.textContent?.trim() ?? "");
const button = (label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}" in ${JSON.stringify(buttons())}`);
  return b;
};

describe("the labels", () => {
  it("are only the ones that apply", () => {
    expect(explanationLabels(PLAIN)).toEqual([]);
    expect(explanationLabels(UNSURE)).toEqual([NOT_SURE_LABEL]);
    expect(explanationLabels(OUTSIDE)).toEqual([OUTSIDE_LABEL]);
    expect(explanationLabels({ sure: false, outside: true })).toEqual([NOT_SURE_LABEL, OUTSIDE_LABEL]);
  });
});

describe("ExplanationsPanel", () => {
  it("draws each row as the passage, then the explanation, then only the labels that apply", async () => {
    await draw(owner());
    expect(row("e-plain").querySelector(".expl-quote")?.textContent).toContain(PLAIN.quote);
    expect(row("e-plain").querySelector(".expl-text")?.textContent).toBe(PLAIN.text);
    expect(row("e-plain").querySelector(".expl-labels")).toBeNull();
    expect(row("e-unsure").querySelector(".expl-labels")?.textContent).toBe(NOT_SURE_LABEL);
    expect(row("e-outside").querySelector(".expl-labels")?.textContent).toBe(OUTSIDE_LABEL);
  });

  it("hands a row's Ask in chat its own explanation", async () => {
    await draw(owner());
    const ask = row("e-unsure").querySelector<HTMLButtonElement>(".expl-ask-chat");
    expect(ask).not.toBeNull();
    await act(async () => ask?.click());
    expect(asked).toEqual([UNSURE]);
  });

  it("says plainly that nothing needed explaining, with no button to run it again", async () => {
    await draw(owner({ explanations: artefact([]) }));
    expect(host.textContent).toContain(EXPLANATIONS_NONE);
    expect(buttons()).not.toContain("Find more");
    expect(buttons()).not.toContain("Write a new list");
  });

  it("offers Find them on an article nobody has asked about", async () => {
    await draw(owner({ status: "none", explanations: null }));
    expect(buttons()).toContain("Find them");
  });
});

describe("the run row (plan 261029e § 2c)", () => {
  it("is Find more on a list the run will append to, in the list's own profile setting", async () => {
    const more = vi.fn(async () => {});
    await draw(owner({ more, profiled: false }));
    expect(host.querySelector(".gloss-more")).not.toBeNull();
    await act(async () => button("Find more").click());
    expect(more).toHaveBeenCalledWith(false);

    more.mockClear();
    await draw(owner({ more, profiled: true }));
    await act(async () => button("Find more").click());
    expect(more).toHaveBeenCalledWith(true);
  });

  it("is Write a new list when the server says the run rewrites — the only run button in the band", async () => {
    await draw(owner({ panelRun: "rewrite", stale: true }));
    expect(buttons().filter((b) => b === "Write a new list")).toHaveLength(1);
    expect(buttons()).not.toContain("Find more");
    /* The stale notice explains and does not repeat the button (Sol F10). */
    expect(host.querySelector(".gloss-stale")?.querySelector(".gloss-more-go")).toBeFalsy();
    expect(buttons()).not.toContain("Write it again");
  });

  it("trusts the server over the client's flags: a cleared profile rewrites though profileChanged is false", async () => {
    await draw(owner({ panelRun: "rewrite", profiled: true, profileChanged: false }));
    expect(buttons()).toContain("Write a new list");
  });

  it("reads an absent verdict conservatively", async () => {
    await draw(owner({ panelRun: null, outdated: true }));
    expect(buttons()).toContain("Write a new list");
    await draw(owner({ panelRun: null }));
    expect(buttons()).toContain("Find more");
  });

  it("offers Write a new list on an empty list that no longer fits, but never Find more on one", async () => {
    await draw(owner({ explanations: artefact([]), panelRun: "rewrite", stale: true }));
    expect(buttons()).toContain("Write a new list");
  });

  it("says so after a Find more that found nothing", async () => {
    await draw(owner({ explanations: artefact([PLAIN, UNSURE], { passes: 2, lastAdded: 0 }) }));
    expect(host.textContent).toContain(EXPLANATIONS_NO_MORE);
    await draw(owner({ explanations: artefact([PLAIN, UNSURE], { passes: 2, lastAdded: 1 }) }));
    expect(host.textContent).not.toContain(EXPLANATIONS_NO_MORE);
    await draw(owner({ explanations: artefact([PLAIN, UNSURE], { passes: 1, lastAdded: 0 }) }));
    expect(host.textContent).not.toContain(EXPLANATIONS_NO_MORE);
  });

  it("holds the button until the first job poll, rather than offering a run that may already exist", async () => {
    await draw(owner({ loaded: false }));
    expect(button("Find more").disabled).toBe(true);
  });
});

describe("the orders and the threshold (plan 261029e § 2b)", () => {
  const scored = () => owner({ explanations: artefact([HARD, EASY, MID]) });

  it("shows no order row and no slider on a list with no scores, as before", async () => {
    await draw(owner());
    expect(host.querySelector(".gloss-sort")).toBeNull();
    expect(host.querySelector("#expl-bar")).toBeNull();
    expect(rowIds()).toEqual(["e-plain", "e-unsure", "e-outside"]);
  });

  it("offers Glossary's four orders on a scored list, prioritised pressed by default", async () => {
    await draw(scored());
    expect(orderButtons()).toEqual(["prioritised", "reading order", "hardest", "most central"]);
    expect(host.querySelector(".gloss-sort-btn.on")?.textContent).toBe("prioritised");
  });

  it("gates on the product at 0.10 and keeps reading order, saying how many it hides", async () => {
    await draw(scored());
    expect(rowIds()).toEqual(["e-hard", "e-mid"]);
    expect(host.querySelector("#expl-bar")).not.toBeNull();
    expect(host.textContent).toContain("1 explanation hidden");
  });

  it("orders by one score under hardest and most central, with no slider", async () => {
    await draw(scored(), { order: "centrality" });
    expect(rowIds()).toEqual(["e-hard", "e-mid", "e-easy"]);
    expect(host.querySelector("#expl-bar")).toBeNull();
    await draw(scored(), { order: "document" });
    expect(rowIds()).toEqual(["e-hard", "e-easy", "e-mid"]);
  });

  it("draws the scores a row was placed by: both when prioritised, one for a score order, none in reading order", async () => {
    await draw(scored());
    expect(row("e-hard").querySelectorAll(".score-bar")).toHaveLength(2);
    await draw(scored(), { order: "difficulty" });
    expect(row("e-hard").querySelectorAll(".score-bar")).toHaveLength(1);
    await draw(scored(), { order: "document" });
    expect(row("e-hard").querySelector(".score-bars")).toBeNull();
  });

  it("hands a press on an order, and a moved bar, to the URL's setters", async () => {
    const onOrder = vi.fn();
    const onBar = vi.fn();
    await draw(scored(), { onOrder, onBar });
    await act(async () => button("hardest").click());
    expect(onOrder).toHaveBeenCalledWith("difficulty");

    const slider = host.querySelector<HTMLInputElement>("#expl-bar");
    if (!slider) throw new Error("the prioritised explanations bar was not drawn");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("the native range value setter is unavailable");
    await act(async () => {
      slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      setter.call(slider, "0.3");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(onBar).toHaveBeenCalledWith(0.3);
  });
});

describe("Open in Explanations from the margin (Sol F4)", () => {
  it("lowers the bar just enough to draw a row it was hiding, then lands on it", async () => {
    const bars: (number | null)[] = [];
    const taken: ItemFocus[] = [];
    let bar: number | null = null;
    const list = owner({ explanations: artefact([HARD, EASY, MID]) });
    const focus = { id: "e-easy", n: 1 };
    const render = () =>
      draw(list, {
        bar,
        focus,
        onBar: (b) => {
          bars.push(b);
          bar = b;
        },
        onFocusTaken: (f) => void taken.push(f),
      });
    await render();
    expect(rowIds()).not.toContain("e-easy");
    expect(bars).toEqual([0.04]);
    await render();
    expect(rowIds()).toContain("e-easy");
    expect(rowIds()).toEqual(["e-hard", "e-easy", "e-mid"]);
    expect(taken).toEqual([focus]);
  });

  it("leaves the bar alone when the row is already drawn", async () => {
    const onBar = vi.fn();
    await draw(owner({ explanations: artefact([HARD, EASY, MID]) }), { focus: { id: "e-hard", n: 1 }, onBar });
    expect(onBar).not.toHaveBeenCalled();
  });
});
