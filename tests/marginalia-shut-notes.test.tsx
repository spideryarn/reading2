// @vitest-environment jsdom
/* Other modes' items in Marginalia are shut by default. Greg, 2026-10-01
   (SPIDERYARN-READING2-82): "Rather than showing the full item, maybe show them
   default-collapsed." One line per kind per block; a press opens the rest in
   place; the open half may hold a link, which must not sit inside the button.
   docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md. */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CitedWork, FaqQuestion } from "../src/types.js";
import { MarginNotesSlot, useMarginLayout } from "../src/web/marginalia/MarginaliaColumn.js";
import type { MarginClaim, MarginComment, MarginaliaNote } from "../src/web/marginalia/notes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function draw(notes: MarginaliaNote[]): HTMLDivElement {
  const el = document.createElement("div");
  host = el;
  document.body.append(el);
  const nextRoot = createRoot(el);
  root = nextRoot;
  act(() => nextRoot.render(<MarginNotesSlot notes={notes} />));
  return el;
}

const question = { id: "q1", question: "Why does the bound hold?", passages: [] } as unknown as FaqQuestion;
const row = {
  id: "first",
  url: "https://elsewhere.example/a",
  title: "A reply",
  blockId: "spya-aaaaa1",
  claimQuote: "c",
  relation: "disputes",
  sourceQuote: "s",
  applies: "It says the bound is loose.",
} as unknown as MarginClaim;

describe("a shut line", () => {
  it("is shut until pressed, then opens in place, and shuts again", () => {
    const el = draw([{ kind: "faq", items: [{ question, quote: "because it does", morePassages: 0 }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("Why does the bound hold?");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button?.getAttribute("aria-controls") ?? "");
    expect(panel?.hidden).toBe(true);
    expect(el.textContent).not.toContain("because it does");

    act(() => button?.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(el.textContent).toContain("because it does");

    act(() => button?.click());
    expect(panel?.hidden).toBe(true);
  });

  it("says how many other surviving passages answer an FAQ question", () => {
    const el = draw([{ kind: "faq", items: [{ question, quote: "because it does", morePassages: 2 }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    act(() => button?.click());
    expect(el.textContent).toContain("+2 more passages");
  });

  it("explains itself on hover", () => {
    const el = draw([{ kind: "debate", items: [row] }]);
    expect(el.querySelector(".marg-shut-button")?.getAttribute("title")).toMatch(/From Debate mode/);
  });

  it("puts a Debate row's link beside the button, never inside it", () => {
    const el = draw([{ kind: "debate", items: [row] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("disputes");
    act(() => button?.click());
    const link = el.querySelector<HTMLAnchorElement>(".marg-open a");
    expect(link?.href).toBe("https://elsewhere.example/a");
    expect(link?.rel).toContain("noopener");
    expect(button?.contains(link ?? null)).toBe(false);
    expect(el.textContent).toContain("“s”");
  });

  it("gives two Debate rows from the same page distinct React keys", () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = draw([{ kind: "debate", items: [row, { ...row, id: "second" }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    act(() => button?.click());
    expect(el.querySelectorAll(".marg-open-item")).toHaveLength(2);
    expect(complaints.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
  });

  it("counts several of a kind on its shut line", () => {
    const works = ["a", "b", "c"].map((id) => ({ id, title: `Work ${id}`, why: "w" })) as unknown as CitedWork[];
    const el = draw([{ kind: "citation", items: works }]);
    expect(el.querySelector(".marg-shut-button")?.textContent).toContain("3 works");
  });

  it("opens a reader's comment to the whole of it, its line cut at one", () => {
    const body = "Not sure I buy this claim, and here is a long reason why that will not fit on one line.";
    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", body, status: "none" } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [comment] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("Note");
    act(() => button?.click());
    expect(el.querySelector(".marg-open")?.textContent).toContain(body);
  });

  it("shows the first lines of an AI answer under the reader's comment", () => {
    const comment = {
      id: "c",
      blockId: "spya-aaaaa1",
      createdAt: "t",
      status: "done",
      body: "Check this claim.",
      answer: "The article answers it in the next paragraph.",
    } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [comment] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    act(() => button?.click());
    expect(el.querySelector(".marg-open-answer")?.textContent).toContain("The article answers it");
  });

  it("lets the chevron hang outside the button while the label owns the ellipsis", () => {
    const css = readFileSync("src/web/styles/marginalia.css", "utf8");
    const button = css.match(/\.marg-shut-button\s*\{([^}]*)\}/)?.[1] ?? "";
    const label = css.match(/\.marg-shut-label\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(button).not.toContain("overflow: hidden");
    expect(label).toContain("overflow: hidden");
    expect(label).toContain("text-overflow: ellipsis");
  });
});

class RecordingResizeObserver {
  static latest: RecordingResizeObserver | null = null;
  readonly observed: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    RecordingResizeObserver.latest = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function LayoutHarness() {
  useMarginLayout(true, "fixed");
  return (
    <table className="zoom">
      <tbody>
        <tr><td><MarginNotesSlot notes={[{ kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] }]} /></td></tr>
        <tr><td><MarginNotesSlot notes={[{ kind: "question", depth: 1, text: "Below" }]} /></td></tr>
      </tbody>
    </table>
  );
}

describe("opening a line reflows the notes below", () => {
  it("observes the outer note whose height changes", () => {
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    let pendingFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const el = document.createElement("div");
    host = el;
    document.body.append(el);
    const nextRoot = createRoot(el);
    root = nextRoot;
    act(() => nextRoot.render(<LayoutHarness />));

    const rows = [...el.querySelectorAll("tr")];
    const notes = [...el.querySelectorAll<HTMLElement>("[data-marg-note]")];
    const panel = el.querySelector<HTMLElement>(".marg-open");
    if (!rows[0] || !rows[1] || !notes[0] || !notes[1] || !panel) throw new Error("layout fixture did not render");
    rows[0].getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    rows[1].getBoundingClientRect = () => ({ top: 20 }) as DOMRect;
    Object.defineProperty(notes[0], "offsetHeight", { configurable: true, get: () => (panel.hidden ? 20 : 80) });
    Object.defineProperty(notes[1], "offsetHeight", { configurable: true, get: () => 20 });

    const observer = RecordingResizeObserver.latest;
    expect(observer?.observed).toContain(notes[0]);
    act(() => observer?.fire());
    act(() => pendingFrame?.(0));
    expect(notes[1].style.translate).toBe("0 8px");

    act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    act(() => observer?.fire());
    act(() => pendingFrame?.(0));
    expect(notes[1].style.translate).toBe("0 68px");
  });
});
