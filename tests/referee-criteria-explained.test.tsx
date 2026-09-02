// @vitest-environment jsdom
/**
 * **Two gaps stage 2 found and could not close inside its own scope**, closed —
 * and both are cases where the honest fix looks like a regression to a test
 * written against the old spelling.
 *
 * ## The run button has to be describable while it is dead
 *
 * *Run this criterion* is a model call over the whole paper, and the card that
 * says so was unreachable in the one state where a referee wants it: standing in
 * front of the button wondering why nothing happens. A `disabled` button emits
 * **no pointer and no focus events**, so Floating UI never hears about it and no
 * hover, focus or tab can open the card.
 *
 * The fix is `aria-disabled`, which leaves the control hoverable, focusable and
 * announced as unavailable — and which, on its own, **does not stop an
 * activation**. So the two halves are tested together, because either alone is
 * the wrong answer: describable-but-live would let an incomplete criterion be
 * submitted, and inert-but-mute is where we started.
 *
 * **jsdom cannot see the half that matters most.** It dispatches events to
 * `disabled` elements quite happily, so the *old* code passes a "the card
 * opens" test in this environment and fails it in every browser — which is why
 * `tests/referee-tooltips.test.tsx` was green over the bug. What this file
 * asserts instead is the attribute pair itself, plus the stylesheet rule that
 * has to move with it, and it says out loud that the reachability is a browser
 * fact rather than pretending to have measured it here.
 *
 * ## The rank numeral needs words that are not in a card
 *
 * The big number leading each result reads like a severity score and is not one.
 * There is a card on it, and the card is hover-only — the numeral is a `<span>`
 * inside the jump button, so it takes no focus, and a `tabIndex` there would put
 * a tab stop inside a button. Stage 2 recorded that and named the fix: a visible
 * line above the list. So the line is asserted as a literal, and as *not* being
 * printed before any run has returned anything.
 *
 * Harness: `CriteriaBand` over a stubbed API, from
 * tests/referee-criteria-panel.test.tsx.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId } from "../src/types.js";

/** What the criteria GET answers, and every request made, in order. */
let saved: SavedCriterion[] = [];
let calls: { url: string; method: string }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: (init.method ?? "GET").toUpperCase() });
    return new Response(JSON.stringify({ criteria: saved }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");

/* Real ids. docs/project/block-ids.md § the alphabet. */
const BLOCK = "spya-k3m9qt" as BlockId;
const SLUG = "a-paper";

const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

/** A criterion that has run and come back with one passage. */
function withResult(): SavedCriterion {
  return {
    id: "spya-crt2aa",
    criterion: "Are the controls adequate for the comparisons being drawn?",
    config: { kind: "single" },
    createdAt: "2026-09-01T09:00:00.000Z",
    status: "done",
    results: [
      {
        kind: "single",
        blockId: BLOCK,
        quote: "no unexposed comparison group",
        confidence: 80,
        reasoning: "why it bears on the criterion",
      },
    ],
  } as SavedCriterion;
}

/** The same criterion, written down and never run. */
function unrun(): SavedCriterion {
  return { ...withResult(), status: "pending", results: [] } as SavedCriterion;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  saved = [];
  calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(): void {
  act(() => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(CriteriaBand, {
          slug: SLUG,
          blocks: BLOCKS,
          comments: [],
          onJump: () => {},
          onFound: () => {},
          openKey: null,
          onOpenKey: () => {},
        }),
      ),
    );
  });
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The panel's text, whitespace flattened, so wrapping cannot matter. */
function text(): string {
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

function run(): HTMLButtonElement {
  const el = host.querySelector(".crit-run");
  if (!el) throw new Error("the run button is not drawn");
  return el as HTMLButtonElement;
}

describe("the run button, while the criterion is incomplete", () => {
  it("is marked unavailable without being removed from the page's events", async () => {
    mount();
    await flush();
    const button = run();
    expect(button.getAttribute("aria-disabled"), "the button is not marked unavailable").toBe(
      "true",
    );
    /* **The half jsdom cannot demonstrate.** A real `disabled` emits no pointer
       or focus events in a browser, so the card on this button would be
       unreadable — jsdom dispatches to disabled elements anyway, which is
       exactly why nothing caught this before. The attribute is the assertion. */
    expect(button.hasAttribute("disabled"), "back to a card no browser can open").toBe(false);
  });

  it("cannot be activated, which aria-disabled does not do on its own", async () => {
    mount();
    await flush();
    act(() => {
      run().click();
    });
    await flush();
    /* The form's own `!ready` guard is what stops it, and it has to keep doing
       so: a click, an Enter and a Space all arrive here as one submit. If this
       goes red, a criterion with no text just went to the server. */
    expect(
      calls.filter((c) => c.method === "POST"),
      "an empty criterion was submitted",
    ).toEqual([]);
  });

  it("goes live once the form is filled in", async () => {
    mount();
    await flush();
    const box = host.querySelector(".crit-text") as HTMLTextAreaElement | HTMLInputElement | null;
    if (!box) throw new Error("the criterion box is not drawn");
    const setter = Object.getOwnPropertyDescriptor(
      box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(box, "Are the statistical claims supported?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(run().getAttribute("aria-disabled"), "the button never comes alive").toBe("false");
  });

  it("keeps the dead look on the attribute the markup now uses", () => {
    const css = readFileSync("src/web/styles.css", "utf8");
    /* The pair: `aria-disabled` in the markup and `:disabled` in the stylesheet
       is a button that looks live and does nothing, which is worse than either
       of the two states this replaced. */
    expect(css).toContain('.crit-run[aria-disabled="true"]');
    expect(css, "the old rule is still there and now matches nothing").not.toContain(
      ".crit-run:disabled",
    );
  });
});

describe("what the big number on a result is", () => {
  const LINE =
    "The number beside a passage is the model's ordering of its own answers for that criterion. It is not a score, and nothing here ranks the paper.";

  it("says so in visible words, not only in a hover card", async () => {
    saved = [withResult()];
    mount();
    await flush();
    /* The card on the numeral is hover-only — a `<span>` inside a button takes
       no focus — so this sentence is the only route a keyboard or touch reader
       has to it. Delete the line and the numeral is an unexplained "1" beside a
       passage the referee is judging. */
    expect(text(), "the rank has no visible explanation").toContain(LINE);
  });

  it("is not printed before anything has come back", async () => {
    saved = [unrun()];
    mount();
    await flush();
    expect(
      text(),
      "a referee with no results yet is told about a number they cannot see",
    ).not.toContain("The number beside a passage");
  });
});
