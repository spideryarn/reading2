// @vitest-environment jsdom
/**
 * **The Glossary's and Citations' threshold rows, as the reader gets them.**
 *
 * Both panels drew this row for themselves (`GateSlider`, `BarSlider`) until
 * 2026-10-04, when they moved onto the shared `ThresholdSlider`
 * (src/web/ThresholdSlider.tsx) the FAQ already used. This file was written
 * against the two private copies **first**, and passed; then the swap was made
 * and it passed unchanged. So it is a characterisation: every attribute and
 * every word the two rows had is listed here, and a consolidation that kept one
 * copy's omissions would have gone red
 * (docs/postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md).
 *
 * Each panel is mounted whole, so what is pinned is the panel's own numbers
 * reaching the row — its `max`, its count, its foot line, its default — not the
 * shared component's markup alone. Plan
 * docs/plans/261004d-sweep-clusters-13-and-18-lint-gates-census-test-and-client-tidy.md, B1.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Citations, CitedWork, Glossary, GlossaryEntry } from "../src/types.js";
import type { GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { UseCitations } from "../src/web/useCitations.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");
const { CitationsPanel } = await import("../src/web/CitationsPanel.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const noop = () => {};

/* Priorities (difficulty × centrality): 0.72, 0.20, 0.02. At the default 0.10
   the last is hidden, so the row reads "2 of 3" and the track ends at 0.72. */
function term(id: string, name: string, difficulty: number, centrality: number): GlossaryEntry {
  return { id, name, kind: "concept", aliases: [], senseHere: `${name}, here.`, blocks: [BLOCK], difficulty, centrality };
}
const TERMS = [
  term("spya-term23", "Hard and central", 0.9, 0.8),
  term("spya-term45", "Middling", 0.5, 0.4),
  term("spya-term67", "Easy and passing", 0.2, 0.1),
];

function glossaryOwner(): GlossaryOwner {
  const glossary: Glossary = {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    profileHash: null,
    entries: TERMS,
    passes: 1,
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
  };
  return {
    status: "ready",
    glossary,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    slug: "a-piece",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    find: async () => {},
    more: async () => {},
    refresh: async () => {},
    cancel: noop,
    look: async () => false,
    setHidden: async () => {},
    hiding: new Set<string>(),
    looking: null,
    lookFailed: null,
    lookDraft: null,
    lookKept: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    askTerm: null,
    clearAsked: noop,
  };
}

/* Priorities ((2r + i) / 3): 0.80, 0.50, 0.20. At the default 0.25 the last is
   hidden: "2 of 3", and the track ends at 0.80. */
function work(id: string, title: string, relevance: number, influence: number): CitedWork {
  return {
    id,
    title,
    key: `work:${title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [BLOCK],
    firstCited: BLOCK,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
    relevance,
    influence,
  };
}
const WORKS = [
  work("spya-a2b3c4", "Central", 0.8, 0.8),
  work("spya-d5e6f7", "Famous", 0.3, 0.9),
  work("spya-g8h9j2", "Passing", 0.2, 0.2),
];

function citationsOwner(): UseCitations {
  const citations: Citations = {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    citations: WORKS,
    capped: false,
    generatedAt: "2026-09-11T09:00:00.000Z",
    elapsedMs: 1,
  };
  return {
    status: "ready",
    citations,
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
    cancel: noop,
    findNote: null,
    investigating: null,
    investigateStage: null,
    investigateDraft: null,
    investigateFailed: null,
    investigate: async () => {},
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

async function drawGlossary(gate: number | null, onGate: (gate: number | null) => void = noop): Promise<void> {
  const owner = glossaryOwner();
  await act(async () =>
    root.render(
      createElement(GlossaryPanel, {
        access: { kind: "owner", owner, glossary: owner.glossary },
        termId: null,
        onTerm: noop,
        sort: "prioritised",
        onSort: noop,
        gate,
        onGate,
        onJump: noop,
        onAskChat: noop,
      }),
    ),
  );
}

async function drawCitations(bar: number | null, onBar: (bar: number | null) => void = noop): Promise<void> {
  await act(async () =>
    root.render(
      createElement(CitationsPanel, {
        access: { kind: "owner", owner: citationsOwner() },
        order: "prioritised",
        onOrder: noop,
        bar,
        onBar,
        onJump: noop,
      }),
    ),
  );
}

/** Everything the row says and carries, read off the DOM. */
function rowAsDrawn() {
  const rows = host.querySelectorAll(".gloss-gate");
  expect(rows.length, "exactly one threshold row").toBe(1);
  const row = rows[0]!;
  const input = row.querySelector<HTMLInputElement>("input")!;
  const label = row.querySelector<HTMLLabelElement>("label")!;
  const reset = row.querySelector<HTMLButtonElement>("button");
  return {
    /* The shape: a head row of label, value and (once moved) reset; the range; the foot line. */
    shape: [...row.children].map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    head: [...row.children[0]!.children].map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    label: label.textContent,
    labelFor: label.htmlFor,
    id: input.id,
    type: input.type,
    min: input.min,
    max: input.max,
    step: input.step,
    value: input.value,
    title: input.title,
    valueText: input.getAttribute("aria-valuetext"),
    shown: row.querySelector(".gloss-gate-value")?.textContent,
    note: row.querySelector(".gloss-gate-note")?.textContent,
    reset: reset
      ? { type: reset.type, title: reset.title, label: reset.getAttribute("aria-label"), icon: reset.querySelector("svg") !== null }
      : null,
  };
}

/** The native setter then an `input` event — React swallows a plain assignment. */
async function dragTo(id: string, value: number): Promise<void> {
  const slider = host.querySelector<HTMLInputElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const HEAD = ["label.gloss-gate-label", "span.gloss-gate-value"];
const SHAPE = ["div.gloss-gate-row", "input.gloss-gate-range", "p.gloss-gate-note"];

describe("the Glossary's threshold row", () => {
  const TITLE =
    "How high a term has to score to stay on screen: the model's difficulty × its centrality. Left shows more terms, right fewer.";

  it("at its default: every attribute, the count, the foot line, and no reset", async () => {
    await drawGlossary(null);
    expect(rowAsDrawn()).toEqual({
      shape: SHAPE,
      head: HEAD,
      label: "threshold",
      labelFor: "gloss-gate",
      id: "gloss-gate",
      type: "range",
      min: "0",
      max: "0.72",
      step: "0.01",
      value: "0.1",
      title: TITLE,
      valueText: "0.10, showing 2 of 3 terms",
      shown: "0.10 · 2 of 3",
      note: "1 term is hidden by this threshold. Drag the slider left to show it.",
      reset: null,
    });
  });

  it("once moved: the reader's value, the panel's own count and note for it, and a reset to the default", async () => {
    await drawGlossary(0.5);
    const row = rowAsDrawn();
    expect(row).toMatchObject({
      head: [...HEAD, "button.gloss-gate-reset"],
      max: "0.72",
      value: "0.5",
      valueText: "0.50, showing 1 of 3 terms",
      shown: "0.50 · 1 of 3",
      note: "2 terms are hidden by this threshold. Drag the slider left to show them.",
      reset: { type: "button", title: "Back to 0.10", label: "Reset the threshold to 0.10", icon: true },
    });
  });

  it("a value past the data's top stretches the track to hold it, and says everything is hidden", async () => {
    await drawGlossary(0.9);
    expect(rowAsDrawn()).toMatchObject({ max: "0.9", value: "0.9", shown: "0.90 · 0 of 3" });
    expect(rowAsDrawn().note).toBe("All 3 terms are hidden by this threshold. Drag the slider left to show them.");
  });

  it("nothing hidden still has a foot line", async () => {
    await drawGlossary(0);
    expect(rowAsDrawn()).toMatchObject({ shown: "0.00 · 3 of 3", note: "Nothing is hidden by this threshold." });
  });

  it("a drag calls back with the number, and the reset with null", async () => {
    const onGate = vi.fn();
    await drawGlossary(0.5, onGate);
    await dragTo("gloss-gate", 0.33);
    expect(onGate.mock.calls).toEqual([[0.33]]);
    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-gate-reset")!.click());
    expect(onGate.mock.calls).toEqual([[0.33], [null]]);
  });
});

describe("Citations' threshold row", () => {
  const TITLE =
    "How high a work has to score to stay on screen: two parts relevance to one part influence, or relevance alone where the influence is unknown. Left shows more works, right fewer.";

  it("at its default: every attribute, the count, the foot line, and no reset", async () => {
    await drawCitations(null);
    expect(rowAsDrawn()).toEqual({
      shape: SHAPE,
      head: HEAD,
      label: "threshold",
      labelFor: "cite-bar",
      id: "cite-bar",
      type: "range",
      min: "0",
      max: "0.8",
      step: "0.01",
      value: "0.25",
      title: TITLE,
      valueText: "0.25, showing 2 of 3 citations",
      shown: "0.25 · 2 of 3",
      note: "1 citation is hidden by this threshold. Drag the slider left to show it.",
      reset: null,
    });
  });

  it("once moved: the reader's value, the panel's own count and note for it, and a reset to the default", async () => {
    await drawCitations(0.6);
    expect(rowAsDrawn()).toMatchObject({
      head: [...HEAD, "button.gloss-gate-reset"],
      max: "0.8",
      value: "0.6",
      valueText: "0.60, showing 1 of 3 citations",
      shown: "0.60 · 1 of 3",
      note: "2 citations are hidden by this threshold. Drag the slider left to show them.",
      reset: { type: "button", title: "Back to 0.25", label: "Reset the threshold to 0.25", icon: true },
    });
  });

  it("a value past the data's top stretches the track to hold it, and says everything is hidden", async () => {
    await drawCitations(0.95);
    expect(rowAsDrawn()).toMatchObject({ max: "0.95", value: "0.95", shown: "0.95 · 0 of 3" });
    expect(rowAsDrawn().note).toBe("All 3 citations are hidden by this threshold. Drag the slider left to show them.");
  });

  it("nothing hidden still has a foot line", async () => {
    await drawCitations(0);
    expect(rowAsDrawn()).toMatchObject({ shown: "0.00 · 3 of 3", note: "Nothing is hidden by this threshold." });
  });

  it("a drag calls back with the number, and the reset with null", async () => {
    const onBar = vi.fn();
    await drawCitations(0.6, onBar);
    await dragTo("cite-bar", 0.4);
    expect(onBar.mock.calls).toEqual([[0.4]]);
    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-gate-reset")!.click());
    expect(onBar.mock.calls).toEqual([[0.4], [null]]);
  });
});
