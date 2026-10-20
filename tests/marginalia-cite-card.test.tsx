// @vitest-environment jsdom
/**
 * **A *Cites* line in the margin shows the prose's own citation card**, and a
 * cut-off shut line's card says the item's own words.
 *
 * Greg, 2026-10-19 (spya-gdbsq2): *"The Marginalia mode tooltip for a citation
 * is pretty unhelpful. It's just a kind of generic message. I feel like we have
 * more information than that for a citation if I hover over it in the text. So
 * let's try and reuse that same tooltip."*
 * docs/plans/261020g-marginalia-tooltips-reuse-the-prose-citation-card-and-say-the-item.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, CitedWork, FaqQuestion } from "../src/types.js";
import { type BlockLinkIndex, BlockLinkProvider } from "../src/web/BlockLinkCard.js";
import { MarginCiteActions, MarginNotesSlot, type MarginCiteSenders } from "../src/web/marginalia/MarginaliaColumn.js";
import type { MarginaliaNote } from "../src/web/marginalia/notes.js";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  target: Element | null = null;
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) { this.target = target; }
  unobserve() {}
  disconnect() {}
  notify() { this.callback([], this as unknown as ResizeObserver); }
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = "spya-aaaaaa" as BlockId;
const THERE = "spya-bbbbbb" as BlockId;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TULVING: CitedWork = {
  id: "spya-a2b3c4",
  key: "work:Elements",
  title: "Elements of Episodic Memory",
  authors: "Tulving",
  year: "1983",
  why: "The piece takes its account of retrieval cues from it.",
  mentions: [{ blockId: HERE, quote: "(Tulving 1983)", start: 4 }],
  citedAt: [HERE, THERE],
  firstCited: HERE,
  citedInBody: true,
  url: "https://doi.org/10.1000/xyz",
  linkFrom: "doi",
  entry: "Tulving, E. (1983). Elements of Episodic Memory. Oxford.",
} as CitedWork;

const INDEX = new Map(
  [HERE, THERE].map((id) => [id, { text: "A paragraph (Tulving 1983).", section: undefined, block: { id, html: "<p>A paragraph.</p>", text: "A paragraph." } as unknown as Block }]),
) as BlockLinkIndex;

function senders(): MarginCiteSenders & { [k: string]: ReturnType<typeof vi.fn> } {
  return { onAsk: vi.fn(), onCheck: vi.fn(), onOpen: vi.fn(), onJump: vi.fn() };
}

function paint(notes: MarginaliaNote[], acts: MarginCiteSenders | null = senders()): void {
  act(() =>
    root.render(
      <BlockLinkProvider index={INDEX}>
        <MarginCiteActions.Provider value={acts}>
          <MarginNotesSlot blockId={HERE} notes={notes} viewer="owner" />
        </MarginCiteActions.Provider>
      </BlockLinkProvider>,
    ),
  );
}

const citesLine = () => host.querySelector<HTMLButtonElement>('.marg-shut[data-kind="citation"] .marg-shut-button')!;
const dialog = () => document.querySelector<HTMLElement>('.tooltip-anchor[role="dialog"]');
const button = (name: string) =>
  [...(dialog()?.querySelectorAll("button, a") ?? [])].find((b) => b.textContent?.includes(name)) as
    | HTMLElement
    | undefined;

async function settle(): Promise<void> {
  for (const _ of [0, 1, 2]) await act(async () => { vi.advanceTimersByTime(500); });
}

describe("a Cites line in the margin", () => {
  it("has no house card, but the prose's citation card on hover", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    expect(citesLine().hasAttribute("data-marg-tip"), "the delegated house card would open too").toBe(false);
    await act(async () => {
      citesLine().dispatchEvent(new MouseEvent("mouseenter"));
    });
    await settle();
    const card = dialog();
    expect(card, "hover opened no card").not.toBeNull();
    expect(card?.querySelector(".tooltip.prose-card")).not.toBeNull();
    expect(card?.querySelector(".marg-cite-card")).not.toBeNull();
    const text = card?.textContent ?? "";
    expect(text).toContain("Elements of Episodic Memory");
    expect(text).toContain("Tulving");
    expect(text).toContain("Oxford");
    expect(text).toContain("cited in 2 paragraphs");
    expect(text).not.toContain("A work the article cites, at the first place it does");
  });

  it("opens from keyboard focus, and its buttons are the reader's own senders", async () => {
    const acts = senders();
    paint([{ kind: "citation", items: [TULVING] }], acts);
    await act(async () => citesLine().focus());
    await settle();
    expect(dialog(), "focus opened no card").not.toBeNull();

    await act(async () => button("Open in Sources")?.click());
    expect(acts.onOpen).toHaveBeenCalledWith(TULVING.id);
    await settle();
    expect(dialog(), "a press on the card closes it").toBeNull();

    await act(async () => citesLine().blur());
    await act(async () => citesLine().focus());
    await settle();
    await act(async () => dialog()?.querySelector<HTMLElement>(`[aria-label="Ask about this work in chat"]`)?.click());
    expect(acts.onAsk).toHaveBeenCalledWith(TULVING);

    await act(async () => citesLine().blur());
    await act(async () => citesLine().focus());
    await settle();
    await act(async () => button("Does it say that?")?.click());
    expect(acts.onCheck).toHaveBeenCalledWith(TULVING, HERE);

    await act(async () => citesLine().blur());
    await act(async () => citesLine().focus());
    await settle();
    const jump = dialog()?.querySelector<HTMLElement>(`[data-block-link="${THERE}"]`);
    expect(jump, "no jump to the other citing paragraph").toBeTruthy();
    await act(async () => jump?.click());
    expect(acts.onJump).toHaveBeenCalledWith(THERE, `cite:${TULVING.id}`);
    await settle();
    expect(dialog(), "a jump leaves no card over the passage it left").toBeNull();
  });

  it("keeps the disclosure and dialog relationships on the same button", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    const line = citesLine();
    const panel = line.getAttribute("aria-controls");
    expect(panel).toBeTruthy();
    await act(async () => line.focus());
    await settle();
    const card = dialog();
    expect(card).not.toBeNull();
    expect(line.getAttribute("aria-haspopup")).toBe("dialog");
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(line.getAttribute("aria-controls")?.split(/\s+/)).toEqual(
      expect.arrayContaining([panel!, card!.id]),
    );
  });

  it.each(["Enter", " "])("%s opens the line and closes its focused card", async (key) => {
    paint([{ kind: "citation", items: [TULVING] }]);
    const line = citesLine();
    const panel = line.getAttribute("aria-controls");
    await act(async () => line.focus());
    await settle();
    expect(dialog()).not.toBeNull();
    await act(async () => {
      line.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      line.click();
      line.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
    });
    await settle();
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(line.hasAttribute("aria-haspopup")).toBe(false);
    expect(line.getAttribute("aria-controls")).toBe(panel);
    expect(dialog()).toBeNull();
  });

  it("Escape closes the focused card without opening the line", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    const line = citesLine();
    await act(async () => line.focus());
    await settle();
    expect(dialog()).not.toBeNull();
    await act(async () => line.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    await settle();
    expect(dialog()).toBeNull();
    expect(line.getAttribute("aria-expanded")).toBe("false");
  });

  it("shuts its card when the line is pressed open, and keeps it shut while the line is open", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    await act(async () => citesLine().focus());
    await settle();
    expect(dialog()).not.toBeNull();
    await act(async () => {
      citesLine().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      citesLine().click();
    });
    await settle();
    expect(citesLine().getAttribute("aria-expanded")).toBe("true");
    expect(dialog(), "the card sits over the opened line").toBeNull();
    await act(async () => {
      citesLine().dispatchEvent(new MouseEvent("mouseenter"));
    });
    await settle();
    expect(dialog()).toBeNull();
  });

  it("does not open for a finger, which opens the line instead", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    await act(async () => {
      citesLine().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      citesLine().focus();
      citesLine().dispatchEvent(new MouseEvent("mouseenter"));
      citesLine().click();
    });
    await settle();
    expect(citesLine().getAttribute("aria-expanded")).toBe("true");
    expect(dialog()).toBeNull();
  });

  /* Sol F1: `mouseOnly` stops a tap's hover, not its focus, which can come
     before the click — or with no click at all, if the press goes nowhere. */
  it("does not open from the focus a finger's press gives, click or no click", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    await act(async () => {
      citesLine().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      citesLine().focus();
    });
    await settle();
    expect(dialog()).toBeNull();
  });

  it("allows a mouse hover after a finger focused without clicking", async () => {
    paint([{ kind: "citation", items: [TULVING] }]);
    const line = citesLine();
    await act(async () => {
      line.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      line.focus();
    });
    await settle();
    expect(dialog()).toBeNull();
    await act(async () => {
      line.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      line.dispatchEvent(new MouseEvent("mouseenter"));
    });
    await settle();
    expect(dialog(), "the old touch press still refuses a real mouse").not.toBeNull();
  });

  it("draws one card section per work beside the block", async () => {
    const { entry: _entry, ...rest } = TULVING;
    const other: CitedWork = { ...rest, id: "spya-c3d4e5", title: "Another Work" };
    paint([{ kind: "citation", items: [TULVING, other] }]);
    await act(async () => citesLine().focus());
    await settle();
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("Elements of Episodic Memory");
    expect(text).toContain("Another Work");
  });
});

describe("a cut-off shut line's card", () => {
  const question = { id: "q1", question: "Why does the ethologist ask four questions rather than one?" } as FaqQuestion;
  const faq: MarginaliaNote = { kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] };
  const trigger = () => host.querySelector<HTMLElement>(".marg-note [data-marg-tip]")!;
  const card = () => document.querySelector<HTMLElement>(".tooltip-anchor");
  const cut = (by: number) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("marg-shut-label") ? 200 + by : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("marg-shut-label") ? 200 : 0;
    });
  };
  async function hover(): Promise<void> {
    trigger().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await act(async () => { vi.advanceTimersByTime(500); });
  }

  it("says the item's words, in the item's face, when the line is cut", async () => {
    cut(40);
    paint([faq]);
    await hover();
    const words = card()?.querySelector(".tip-soon-drawn");
    expect(words?.textContent).toBe(question.question);
    expect(words?.classList.contains("voice-ai")).toBe(true);
  });

  /* GPT Sol F4 on the plan: the card's content is read when it opens, so a
     line opened under an open card must re-read it, or the card repeats the
     words the line now shows wrapped. */
  it("drops the words when the line opens under the card and wraps", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      const wraps = this.closest(".marg-shut")?.hasAttribute("data-open") ?? false;
      return this.classList.contains("marg-shut-label") && !wraps ? 240 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("marg-shut-label") ? 200 : 0;
    });
    paint([faq]);
    await hover();
    expect(card()?.querySelector(".tip-soon-drawn")?.textContent).toBe(question.question);
    await act(async () => trigger().click());
    expect(trigger().hasAttribute("data-open")).toBe(true);
    expect(document.querySelector(".tip-soon-drawn"), "the card still repeats the wrapped line").toBeNull();
  });

  it("re-reads whether the line is cut when its width changes", async () => {
    let by = 40;
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("marg-shut-label") ? 200 + by : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("marg-shut-label") ? 200 : 0;
    });
    paint([faq]);
    await hover();
    expect(card()?.querySelector(".tip-soon-drawn")?.textContent).toBe(question.question);
    const resize = FakeResizeObserver.instances.find((watch) => watch.target?.classList.contains("marg-shut-label"));
    expect(resize, "nothing watches the line whose clipping the card reports").toBeTruthy();
    by = 0;
    await act(async () => resize?.notify());
    expect(card()?.querySelector(".tip-soon-drawn"), "the card kept words that now fit").toBeNull();
  });

  it("does not repeat words the line already shows in full (the control)", async () => {
    cut(0);
    paint([faq]);
    await hover();
    expect(card()?.textContent).toContain("FAQ");
    expect(card()?.querySelector(".tip-soon-drawn")).toBeNull();
  });
});
