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
 * It carried a card, and that card was hover-only and could not be otherwise —
 * the numeral is a `<span>` inside the jump button, so it takes no focus, and a
 * `tabIndex` there would put a tab stop inside a button. Stage 2 recorded that
 * and named the fix: a visible line above the list. So the line is asserted as a
 * literal, as *not* being printed before any run has returned anything, and as
 * being visible rather than merely present — and the card that used to say the
 * same thing to whoever had a mouse is asserted gone, 2026-09-02.
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

/**
 * **The panel's text as a sighted reader gets it** — whitespace flattened, so
 * wrapping cannot matter, and every element that is on the page but not on the
 * screen skipped.
 *
 * `textContent` was what this used, and a cross-family review pointed out on
 * 2026-09-02 that it cannot tell a visible sentence from a hidden one: the whole
 * point of the rank line is that it reaches a keyboard and a touch reader, and
 * `.sr-only` or `hidden` on it would leave every assertion below green while the
 * sentence disappeared. This panel already renders an `.sr-only` copy of each
 * result's ordered facts (`valenceLabel` in CriteriaPanel.tsx), so the two kinds
 * of text really do live side by side here.
 *
 * jsdom does no layout and loads no stylesheet, so this cannot see a rule in
 * styles.css that hides something — `hidesTheRankLine` below is that half.
 */
function text(): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return;
      if (node.classList.contains("sr-only")) return;
      if (node.style.display === "none" || node.style.visibility === "hidden") return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(host);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * **The stylesheet with its comments taken out**, which is the whole of what the
 * two assertions below are allowed to read.
 *
 * A `toContain` over the raw file cannot tell a rule from a sentence about a
 * rule, and this file has both: the rule below it carries a four-line comment
 * arguing for `aria-disabled` over `:disabled`, and every selector named in that
 * argument would satisfy a search of the raw text. So the argument is stripped
 * and the rules are what is searched. A cross-family review raised this on
 * 2026-09-02; the comment as it stands does not in fact contain either literal,
 * but a test that is right by luck about the wording of a comment is not right.
 */
function rules(): string {
  return readFileSync("src/web/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
    const css = rules();
    /* The pair: `aria-disabled` in the markup and `:disabled` in the stylesheet
       is a button that looks live and does nothing, which is worse than either
       of the two states this replaced. Comments stripped — see `rules`. */
    expect(css, "the rule that greys the dead button has gone").toContain(
      '.crit-run[aria-disabled="true"]',
    );
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

  /**
   * **And the stylesheet may not take it away again**, which is the half
   * `text()` cannot see: jsdom loads no CSS, so a `display: none` on
   * `.crit-how` would leave every assertion above green and the sentence
   * invisible in every browser.
   */
  it("is not hidden by a rule in the stylesheet", () => {
    expect(rules(), "a rule in styles.css hides the line this test says is visible").not.toMatch(
      /\.crit-how[^{}]*\{[^}]*(display:\s*none|visibility:\s*hidden|font-size:\s*0(?![.\d]))/,
    );
  });

  /**
   * **The numeral's own card is gone, and this is what keeps it gone.**
   *
   * It was hover-only and could not be otherwise — a `<span>` inside a button
   * takes no focus — so once the visible line above existed the card was a
   * second copy for the one group that already had the first. A cross-family
   * review called it redundant on 2026-09-02.
   *
   * Hovering it must open nothing. The card, if it came back, would be portalled
   * to the end of `<body>` rather than into `host`, so it is looked for in the
   * document — tests/referee-tooltips.test.tsx § `cardFor`.
   */
  it("says it once, in the visible line, and not again in a hover card", async () => {
    saved = [withResult()];
    mount();
    await flush();
    const rank = host.querySelector(".crit-rank");
    expect(rank, "the rank numeral is not drawn").not.toBeNull();
    expect((rank as Element).hasAttribute("title"), "it fell back to a title").toBe(false);
    (rank as Element).dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(
      document.querySelectorAll('[role="tooltip"]'),
      "the hover-only duplicate of the visible line is back",
    ).toHaveLength(0);
  });
});
