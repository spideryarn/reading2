// @vitest-environment jsdom
/**
 * **G, from the paragraph you are on, to its term in the glossary.**
 *
 * Cluster M of docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:
 * a keyboard reader could not reach a term's entry without tabbing through the
 * whole article, because a `mark.term` takes no focus and giving several hundred
 * of them `tabIndex` would be worse than the gap. Greg chose the jump
 * (2026-09-11): from the selected block, to the glossary row that already exists.
 * docs/project/keyboard.md § G, the one letter.
 *
 * Mounted through the real `ProseHoverCard` — which is what Reader mounts, so a
 * `TermJump` that exists but is not rendered fails here rather than in a
 * browser — and the real visitor glossary band, so the row that receives focus
 * is the row the panel actually draws. The article is static rows carrying the
 * markup `annotate.ts` produces: `tr[data-block]`, `.prose`, `mark.term[data-term]`.
 *
 * jsdom dispatches the keys, so these are synthetic events; the same cases were
 * driven with real key presses in Chrome — see the plan's cluster M status.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicGlossary, PublicGlossaryEntry } from "../src/public-types.js";
import type { BlockId, GlossaryEntry } from "../src/types.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { modeParam, termParam } from "../src/web/params.js";

const { useQueryState } = await import("nuqs");
const { ProseHoverCard } = await import("../src/web/ProseHoverCard.js");
const { VisitorGlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;
const C = "spya-cccccc" as BlockId;
const D = "spya-dddddd" as BlockId;

function entry(id: string, name: string, blocks: BlockId[]): PublicGlossaryEntry & GlossaryEntry {
  return {
    id,
    name,
    kind: "concept",
    aliases: [],
    senseHere: `What ${name} means here.`,
    difficulty: 0.9,
    centrality: 0.9,
    blocks,
  };
}

/** In A twice and in C once — the repeated word, across blocks and within one. */
const NONRED = entry("spya-nnnnnn", "nonreductive", [A, C]);
/** In A, inside a link, *after* the first occurrence of the term above. */
const QUALIA = entry("spya-qqqqqq", "qualia", [A]);
QUALIA.background = "What the wider literature means by qualia.";
/** Names a block this article does not have: a list written for another extraction. */
const STALE = entry("spya-sssss2", "stale term", ["spya-gone22" as BlockId]);
const ENTRIES = [NONRED, QUALIA, STALE];
const GLOSSARY: PublicGlossary = { entries: ENTRIES, ideas: [] } as unknown as PublicGlossary;

const mark = (id: string, words: string) => `<mark class="term" data-term="${id}">${words}</mark>`;
const row = (id: BlockId, prose: string) =>
  `<tr data-block="${id}"><td class="text">` +
  `<div class="blk-gutter"><a class="blk-permalink" id="p-${id}" href="#${id}">¶</a></div>` +
  `<div class="prose"><p>${prose}</p></div></td></tr>`;

const ARTICLE =
  "<table><tbody>" +
  row(A, `The ${mark(NONRED.id, "nonreductive")} view, then <a id="link-a" href="https://example.org/q">${mark(QUALIA.id, "qualia")}</a>, and ${mark(NONRED.id, "nonreductive")} again. <span id="row-menu" role="menu" tabindex="0">A type-ahead menu</span> <span id="row-editor" contenteditable="true"><span id="row-editor-child" tabindex="0">draft</span></span>`) +
  row(B, "A paragraph with no term in it at all.") +
  row(C, `Later, ${mark(NONRED.id, "nonreductive")} comes back.`) +
  /* A mark whose id no entry has: what a glossary rewritten under an open page
     would leave behind. It is not a term the reader can be sent to. */
  row(D, `A ${mark("spya-zzzzzz", "ghost")} that no entry owns.`) +
  "</tbody></table>";

const onJump = vi.fn();

function Harness() {
  const [, setTerm] = useQueryState("term", termParam);
  const [, setMode] = useQueryState("mode", modeParam);
  return createElement(
    "div",
    null,
    createElement("input", { id: "typing", "aria-label": "somewhere to type" }),
    createElement("button", { id: "elsewhere", type: "button" }, "a control"),
    // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed fixture, standing in for the rows TableView injects the same way.
    createElement("div", { dangerouslySetInnerHTML: { __html: ARTICLE } }),
    createElement(ProseHoverCard, {
      entries: ENTRIES,
      slug: null,
      sourceUrl: null,
      blockText: new Map(),
      notes: buildNoteIndex([]),
      /* What Reader's `openTermInGlossary` does, less the gate it lowers. */
      onOpenTerm: (id: string) => {
        void setTerm(id as BlockId);
        void setMode("glossary");
      },
      onJump,
      onFollowNote: () => {},
      lookUpLinks: false,
      canAddToShelf: false,
    }),
    createElement(VisitorGlossaryBand, { glossary: GLOSSARY, onJump, onSelected: () => {} }),
  );
}

let host: HTMLDivElement;
let root: Root;
let reachedWindow: string[] = [];
const onWindowKey = (e: KeyboardEvent) => reachedWindow.push(e.key);

enableHistorySync();

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  onJump.mockClear();
  reachedWindow = [];
  window.addEventListener("keydown", onWindowKey);
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(NuqsAdapter, null, createElement(Harness))));
  await settle();
});

afterEach(async () => {
  window.removeEventListener("keydown", onWindowKey);
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  /* Let nuqs's queued URL writes land before jsdom goes — see
     docs/postmortems/260906c-a-url-write-outlived-the-page-that-asked-for-it.md. */
  await new Promise((go) => setTimeout(go, 120));
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
}

function focus(id: string): void {
  const el = document.getElementById(id);
  expect(el, `#${id} is in the harness`).not.toBeNull();
  el!.focus();
  expect(document.activeElement).toBe(el);
}

/** Which glossary row holds the focus, by the term's id. */
function focusedRow(): string | null {
  const el = document.activeElement;
  if (!el?.classList.contains("gloss-term-btn")) return null;
  return el.closest("li")?.getAttribute("data-term-id") ?? null;
}

function said(): string {
  return document.querySelector(".term-jump-status")?.textContent ?? "";
}

async function arrivesAt(termId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(param("term")).toBe(termId);
    expect(param("mode")).toBe("glossary");
    expect(focusedRow()).toBe(termId);
  });
}

describe("G from a paragraph opens its term in the glossary", () => {
  it("one press: the paragraph's first term, its row focused, the article left where it was", async () => {
    focus(`p-${C}`);
    const event = await press("g");
    await arrivesAt(NONRED.id);
    expect(event.defaultPrevented).toBe(true);
    /* The row is open, which is the definition on screen. */
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
    /* No jump: the passage and the place are the reader's. */
    expect(onJump).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(said()).toBe("nonreductive, 1 of 1 in this paragraph."));
  });

  it("several terms: G again walks them in reading order and wraps, counting a repeat once", async () => {
    focus(`p-${A}`);
    await press("g");
    await arrivesAt(NONRED.id);
    await vi.waitFor(() => expect(said()).toBe("nonreductive, 1 of 2 in this paragraph."));
    /* Focus is in the band now, and the paragraph it came from is remembered. */
    await press("g");
    await arrivesAt(QUALIA.id);
    await vi.waitFor(() => expect(said()).toBe("qualia, 2 of 2 in this paragraph."));
    await press("g");
    await arrivesAt(NONRED.id);
    await vi.waitFor(() => expect(said()).toBe("nonreductive, 1 of 2 in this paragraph."));
  });

  it("a term inside a focused link comes first, ahead of the paragraph's earlier term", async () => {
    focus("link-a");
    await press("g");
    await arrivesAt(QUALIA.id);
    await vi.waitFor(() => expect(said()).toBe("qualia, 1 of 2 in this paragraph."));
  });

  it("Escape finds the link again after the prose under it was re-rendered", async () => {
    focus("link-a");
    await press("g");
    await arrivesAt(QUALIA.id);
    /* What opening a term does to the real prose: TableView re-injects the
       row's HTML so the open term can carry its wash, and the `<a>` that had
       the focus is replaced by an identical one. Seen in Chrome first. */
    const prose = document.querySelector(`tr[data-block="${A}"] .prose`)!;
    const old = document.getElementById("link-a");
    const sameHtml = prose.innerHTML;
    prose.innerHTML = sameHtml;
    expect(document.getElementById("link-a")).not.toBe(old);
    await press("g");
    await arrivesAt(NONRED.id);
    await vi.waitFor(() => expect(said()).toBe("nonreductive, 2 of 2 in this paragraph."));
    await press("Escape");
    expect(document.activeElement).toBe(document.getElementById("link-a"));
  });

  it("no term: says so, and changes nothing", async () => {
    focus(`p-${B}`);
    await press("g");
    await vi.waitFor(() => expect(said()).toBe("No glossary terms in this paragraph."));
    expect(param("term")).toBeNull();
    expect(param("mode")).toBeNull();
    expect(document.activeElement?.id).toBe(`p-${B}`);
  });

  it("a mark no entry owns is not a term to send anybody to", async () => {
    focus(`p-${D}`);
    await press("g");
    await vi.waitFor(() => expect(said()).toBe("No glossary terms in this paragraph."));
    expect(param("term")).toBeNull();
  });

  it("the repeated word: from its later paragraph, the same entry, and Escape goes back there", async () => {
    focus(`p-${C}`);
    await press("g");
    await arrivesAt(NONRED.id);
    const esc = await press("Escape");
    expect(document.activeElement?.id).toBe(`p-${C}`);
    /* One press, one effect: nothing behind the band also closes on it. */
    expect(reachedWindow).not.toContain("Escape");
    expect(esc.defaultPrevented).toBe(false);
  });

  it("with nothing focused, the paragraph at the reading line is the one, and Escape lands on it", async () => {
    /* jsdom has no layout, so say where the rows are: A and B above the line,
       C on it, D below. */
    const tops = new Map<string, number>([[A, -400], [B, -100], [C, 0], [D, 600]]);
    for (const tr of document.querySelectorAll<HTMLElement>("tr[data-block]")) {
      const top = tops.get(tr.getAttribute("data-block") ?? "") ?? 0;
      tr.getBoundingClientRect = () => ({ top, bottom: top + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: top, toJSON() {} });
    }
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await press("g");
    await arrivesAt(NONRED.id);
    await press("Escape");
    expect(document.activeElement?.id).toBe(`p-${C}`);
  });

  it("a stale origin: the paragraph went away, so Escape says so and moves nothing", async () => {
    focus(`p-${C}`);
    await press("g");
    await arrivesAt(NONRED.id);
    const btn = document.activeElement;
    document.querySelector(`tr[data-block="${C}"]`)?.remove();
    await press("Escape");
    expect(document.activeElement).toBe(btn);
    await vi.waitFor(() => expect(said()).toBe("That paragraph is no longer on the page."));
  });

  it("where the band covers the article, Escape does not send the focus behind it", async () => {
    /* A narrow window: Reader writes `band-covers` on `.reader` when the band
       has the whole width (narrow-windows.md), and the paragraph is under it.
       Found in Chrome at 420px, where the first cut focused a permalink the
       reader could not see. */
    host.classList.add("reader", "band-covers");
    focus(`p-${C}`);
    await press("g");
    await arrivesAt(NONRED.id);
    await press("Escape");
    expect(focusedRow()).toBe(NONRED.id);
    expect(reachedWindow).toContain("Escape");
    host.classList.remove("reader", "band-covers");
  });

  it("Escape with no jump behind it is not ours", async () => {
    await press("Escape");
    expect(reachedWindow).toContain("Escape");
  });

  it("an open tooltip in the glossary gets the first Escape", async () => {
    focus("link-a");
    await press("g");
    await arrivesAt(QUALIA.id);
    const hint = document.querySelector<HTMLElement>(".gloss-part-hint");
    expect(hint).not.toBeNull();
    await act(async () => hint!.focus());
    await vi.waitFor(() => expect(document.querySelector(".tooltip-anchor")).not.toBeNull());

    await press("Escape");
    expect(document.activeElement).toBe(hint);
    await vi.waitFor(() => expect(document.querySelector(".tooltip-anchor")).toBeNull(), {
      timeout: 500,
    });

    await press("Escape");
    expect(document.activeElement).toBe(document.getElementById("link-a"));
  });

  it("an open gutter disclosure gets the first Escape", async () => {
    focus(`p-${C}`);
    await press("g");
    await arrivesAt(NONRED.id);
    const gutter = document.querySelector<HTMLElement>(`tr[data-block="${A}"] .blk-gutter`)!;
    gutter.dataset.open = "";
    const closeGutter = (event: KeyboardEvent) => {
      if (event.key === "Escape") delete gutter.dataset.open;
    };
    document.addEventListener("keydown", closeGutter);
    try {
      await press("Escape");
      expect(gutter.hasAttribute("data-open")).toBe(false);
      expect(focusedRow()).toBe(NONRED.id);
      await press("Escape");
      expect(document.activeElement?.id).toBe(`p-${C}`);
    } finally {
      document.removeEventListener("keydown", closeGutter);
    }
  });

  it("forgets the return journey once focus leaves the glossary", async () => {
    focus(`p-${C}`);
    await press("g");
    await arrivesAt(NONRED.id);
    const termButton = document.activeElement as HTMLElement;
    focus("elsewhere");
    termButton.focus();
    await press("Escape");
    expect(document.activeElement).toBe(termButton);
    expect(reachedWindow).toContain("Escape");
  });

  it("a later no-term press cancels an earlier pending focus", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    focus(`p-${C}`);
    await press("g");
    expect(frames.length).toBeGreaterThan(0);

    focus(`p-${B}`);
    await press("g");
    await vi.waitFor(() => expect(said()).toBe("No glossary terms in this paragraph."));
    await act(async () => {
      for (const callback of frames.splice(0)) callback(performance.now());
    });
    expect(document.activeElement?.id).toBe(`p-${B}`);
  });
});

describe("G is left alone where it is not the reader's request", () => {
  it("typing a g in a text field types it", async () => {
    focus("typing");
    const event = await press("g");
    expect(event.defaultPrevented).toBe(false);
    expect(param("term")).toBeNull();
  });

  it("modified or held keys, and a focused control outside the article", async () => {
    focus(`p-${A}`);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) {
      const event = await press("g", init);
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    /* Shift+G is "G", which is not the key. */
    expect((await press("G", { shiftKey: true })).defaultPrevented).toBe(false);
    focus("elsewhere");
    expect((await press("g")).defaultPrevented).toBe(false);
    expect(param("term")).toBeNull();
  });

  it("composition and a row's own composite or editor keep the letter", async () => {
    focus(`p-${A}`);
    expect((await press("g", { isComposing: true })).defaultPrevented).toBe(false);

    focus("row-menu");
    expect((await press("g")).defaultPrevented).toBe(false);

    focus("row-editor-child");
    expect((await press("g")).defaultPrevented).toBe(false);
    expect(param("term")).toBeNull();
  });

  it("does not infer a hidden reading-line paragraph through a covering band", async () => {
    host.classList.add("reader", "band-covers");
    const band = document.createElement("div");
    band.className = "mode-band";
    host.append(band);
    (document.activeElement as HTMLElement | null)?.blur();
    expect((await press("g")).defaultPrevented).toBe(false);
    expect(param("term")).toBeNull();
    band.remove();
    host.classList.remove("reader", "band-covers");
  });

  it("does not infer a paragraph behind an open modeless dialog", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    host.append(dialog);
    (document.activeElement as HTMLElement | null)?.blur();
    expect((await press("g")).defaultPrevented).toBe(false);
    expect(param("term")).toBeNull();
    dialog.remove();
  });

  it("the arrow keys pass straight through", async () => {
    focus(`p-${A}`);
    const event = await press("ArrowDown");
    expect(event.defaultPrevented).toBe(false);
    expect(reachedWindow).toContain("ArrowDown");
  });
});
