// @vitest-environment jsdom
/**
 * Explanations' band: each row is the article's own words, then the AI's
 * explanation, then the labels that apply and only those, and an *Ask in
 * chat* that hands the row to the anchored passage chat. An empty list is a
 * real answer, said plainly. *Write it again* beside a list written by an
 * older prompt or for an older profile, never beside a current one.
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockId, Explanation, Explanations } from "../src/types.js";
import type { UseExplanations } from "../src/web/useExplanations.js";
import { NOT_SURE_LABEL, OUTSIDE_LABEL, explanationLabels } from "../src/web/explanation-labels.js";

const { EXPLANATIONS_NONE, ExplanationsPanel } = await import("../src/web/ExplanationsPanel.js");

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

function artefact(explanations: Explanation[]): Explanations {
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
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    retryRead: async () => {},
    refresh: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
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

async function draw(o: UseExplanations) {
  await act(async () =>
    root.render(
      createElement(ExplanationsPanel, { owner: o, onJump: () => {}, onAsk: (e: Explanation) => void asked.push(e) }),
    ),
  );
}

const row = (id: string) => {
  const el = host.querySelector<HTMLElement>(`[data-explanation-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
};
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");

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
    expect(buttons()).not.toContain("Write it again");
  });

  it("offers Write it again for an older prompt or an older profile, and not for a current list", async () => {
    await draw(owner());
    expect(buttons()).not.toContain("Write it again");
    await draw(owner({ outdated: true }));
    expect(buttons()).toContain("Write it again");
    await draw(owner({ profiled: true, profileChanged: true }));
    expect(buttons()).toContain("Write it again");
  });

  it("offers Find them on an article nobody has asked about", async () => {
    await draw(owner({ status: "none", explanations: null }));
    expect(buttons()).toContain("Find them");
  });
});
