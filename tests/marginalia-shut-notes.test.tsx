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
import type { PublicComment } from "../src/public-types.js";
import type { BlockId, CitedWork, FaqQuestion } from "../src/types.js";
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
  act(() => nextRoot.render(<MarginNotesSlot blockId="spya-aaaaaa" notes={notes} viewer="owner" />));
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

  it("explains itself on hover, through the house card (marginalia-note-cards.test.tsx)", () => {
    const el = draw([{ kind: "debate", items: [row] }]);
    expect(el.querySelector(".marg-shut-button")?.getAttribute("data-marg-tip")).toBe("debate");
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

  /* Greg, spya-zmdb7y (plan 261003j): nothing about a cited work beyond what
     the article's own bibliography gives. `why` is the model's paraphrase. */
  it("opens a citation to the article's own entry, never the model's sentence about the work", () => {
    const cited = {
      id: "a",
      title: "A work",
      authors: "Tulving",
      year: "1983",
      why: "THE MODEL'S SENTENCE.",
      entry: "Tulving, E. (1983). Elements of Episodic Memory. Oxford.",
    } as unknown as CitedWork;
    const el = draw([{ kind: "citation", items: [cited] }]);
    act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    const item = el.querySelector(".marg-open-item");
    expect(item?.textContent).not.toContain("THE MODEL'S SENTENCE.");
    expect(item?.querySelector(".marg-cite-entry")?.textContent).toBe(cited.entry);
  });

  it("opens a lone citation with no by-line and no entry to its title, not to nothing", () => {
    const bare = { id: "a", title: "A bare work", why: "THE MODEL'S SENTENCE." } as unknown as CitedWork;
    const el = draw([{ kind: "citation", items: [bare] }]);
    act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    const item = el.querySelector(".marg-open-item");
    expect(item?.textContent).toBe("A bare work");
  });

  /* Report spya-a0wpv4, plan 261006i: the shut line un-truncates when it opens
     (marginalia.css), so it is already the whole comment, and the open half
     printing the body under it said the comment twice. The question's half of
     this class is spya-f6dpj5, below. */
  it("says a lone comment's words once when it is opened: the line is the whole of it", () => {
    const body = "Not sure I buy this claim, and here is a long reason why that will not fit on one line.";
    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", body, status: "none" } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [{ as: "comment", comment }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.querySelector(".marg-stamp")?.textContent).toBe("Comment");
    act(() => button?.click());
    /* The full comment is already in the accessibility tree; this press only
       changes its visual wrapping. It is not an ARIA disclosure with a
       controlled region. Code review of plan 261006i. */
    expect(button?.hasAttribute("aria-expanded")).toBe(false);
    expect(el.querySelector(".marg-shut")?.hasAttribute("data-open")).toBe(true);
    expect((el.textContent ?? "").split(body).length - 1).toBe(1);
    expect(button?.textContent).toContain(body);
    /* Nothing is left for an open half, so there is none: no empty box, and
       no `aria-controls` naming one (GPT Sol, F1 on the plan). */
    expect(el.querySelector(".marg-open")).toBeNull();
    expect(button?.hasAttribute("aria-controls")).toBe(false);
    act(() => button?.click());
    expect(button?.hasAttribute("aria-expanded")).toBe(false);
    expect(el.querySelector(".marg-shut")?.hasAttribute("data-open")).toBe(false);
  });

  /* The owner's comment as a visitor is sent it (src/public-types.ts §
     `PublicComment`): the same words, no status and no thread. */
  it("says a visitor's copy of a lone comment once too", () => {
    const comment: PublicComment = { id: "c", blockId: "spya-aaaaa1" as BlockId, createdAt: "t", body: "the owner's thought" };
    const el = document.createElement("div");
    host = el;
    document.body.append(el);
    const nextRoot = createRoot(el);
    root = nextRoot;
    act(() => nextRoot.render(<MarginNotesSlot blockId="spya-aaaaaa" viewer="visitor" notes={[{ kind: "comment", items: [{ as: "comment", comment }] }]} />));
    act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    expect((el.textContent ?? "").split("the owner's thought").length - 1).toBe(1);
    expect(el.querySelector(".marg-open")).toBeNull();
  });

  /* *Ask AI* with no words of the reader's: the line is our stand-in and
     there is nothing behind it, so it is not a button that opens to nothing. */
  it("draws a lone wordless Ask AI as plain text, with nothing to press", () => {
    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", status: "none", threadId: "t9" } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [{ as: "comment-ai", comment }] }]);
    expect(el.querySelector(".marg-shut-button")).toBeNull();
    expect(el.querySelector("p.marg-shut")?.textContent).toBe("Comment + AI Asked the AI about this passage");
  });

  it("takes a shut panel out of the layout despite the panel's grid display", () => {
    const css = readFileSync("src/web/styles/marginalia.css", "utf8");
    expect(css).toMatch(/\.marg-open\[hidden\]\s*\{[^}]*display:\s*none/);
    const style = document.createElement("style");
    style.textContent = css;
    const panel = document.createElement("div");
    panel.className = "marg-open";
    panel.hidden = true;
    document.head.append(style);
    document.body.append(panel);
    expect(getComputedStyle(panel).display).toBe("none");
    panel.hidden = false;
    expect(getComputedStyle(panel).display).toBe("grid");
    panel.remove();
    style.remove();
  });

  it("keeps a lone comment's AI answer in the open half, under words said once", () => {
    const body = "Check this claim.";
    const answer = "The article answers it in the next paragraph.";
    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", status: "done", body, answer } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [{ as: "comment-ai", comment }] }]);
    act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    expect((el.textContent ?? "").split(body).length - 1).toBe(1);
    expect(el.querySelector(".marg-open .marg-open-answer")?.textContent).toBe(answer);
  });

  it("keeps a lone answer with no reader words in a non-empty open half", () => {
    const answer = "The next paragraph supplies the missing evidence.";
    const comment = {
      id: "c",
      blockId: "spya-aaaaa1",
      createdAt: "t",
      status: "done",
      answer,
    } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [{ as: "comment-ai", comment }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("AI answer");
    expect(button?.hasAttribute("aria-controls")).toBe(true);
    act(() => button?.click());
    expect(el.querySelector(".marg-open-item")?.textContent).toBe(answer);
  });

  /* The other side of the guard: among several, the line is a count, so each
     comment's words are only in the open half and must stay there. */
  it("still shows each comment's words in the open half when a block has several", () => {
    const one = { id: "c1", blockId: "spya-aaaaa1", createdAt: "t", body: "first thought", status: "none" } as unknown as MarginComment;
    const two = { id: "c2", blockId: "spya-aaaaa1", createdAt: "t", body: "second thought", status: "none" } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [{ as: "comment", comment: one }, { as: "comment", comment: two }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("2 comments");
    act(() => button?.click());
    const bodies = [...el.querySelectorAll(".marg-open .marg-cmt-body")].map((p) => p.textContent);
    expect(bodies).toEqual(["first thought", "second thought"]);
  });

  /* SPIDERYARN-READING2-9H, plan 261002j: the stamp is the kind. */
  it("stamps a comment that asked the AI, and a question, with their kinds", () => {
    const comment = {
      id: "c",
      blockId: "spya-aaaaa1",
      createdAt: "t",
      body: "why n=12?",
      status: "none",
      threadId: "t9",
    } as unknown as MarginComment;
    const ai = draw([{ kind: "comment", items: [{ as: "comment-ai", comment }] }]);
    expect(ai.querySelector(".marg-shut-button .marg-stamp")?.textContent).toBe("Comment + AI");
  });

  it("counts comments and questions apart, labels each opened row, and opens a question's conversation", () => {
    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", body: "mine", status: "none" } as unknown as MarginComment;
    const opened: string[] = [];
    const el = document.createElement("div");
    host = el;
    document.body.append(el);
    const nextRoot = createRoot(el);
    root = nextRoot;
    act(() =>
      nextRoot.render(
        <MarginNotesSlot
          blockId="spya-aaaaaa"
          viewer="owner"
          onOpenAsked={(id) => opened.push(id)}
          notes={[
            {
              kind: "comment",
              items: [
                { as: "comment", comment },
                { as: "question", asked: { id: "t1", blockId: "spya-aaaaa1", createdAt: "t", quote: "the bound holds" } },
              ],
            },
          ]}
        />,
      ),
    );
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("1 comment · 1 question");
    act(() => button?.click());
    const stamps = [...el.querySelectorAll(".marg-open .marg-stamp")].map((s) => s.textContent);
    expect(stamps).toEqual(["Comment", "Question"]);
    expect(el.querySelector(".marg-open")?.textContent).toContain("the bound holds");
    const open = [...el.querySelectorAll<HTMLButtonElement>(".marg-open button")].find(
      (b) => b.textContent === "Open the conversation",
    );
    act(() => open?.click());
    expect(opened).toEqual(["t1"]);
  });

  /* Report spya-f6dpj5, plan 261004k § 7: the shut line un-truncates when it
     opens, so a lone question's open half repeating its stamp and its words
     said *Question · About this paragraph* twice, one above the other. */
  it("says a lone question's words once when it is opened, and still opens its conversation", () => {
    const opened: string[] = [];
    const drawLone = (asked: { id: string; blockId: string; createdAt: string; quote?: string }) => {
      const el = document.createElement("div");
      host = el;
      document.body.append(el);
      const nextRoot = createRoot(el);
      root = nextRoot;
      act(() =>
        nextRoot.render(
          <MarginNotesSlot
            blockId="spya-aaaaaa"
            viewer="owner"
            onOpenAsked={(id) => opened.push(id)}
            notes={[{ kind: "comment", items: [{ as: "question", asked }] }]}
          />,
        ),
      );
      act(() => el.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
      return el;
    };
    const count = (el: HTMLElement, words: string) => (el.textContent ?? "").split(words).length - 1;

    const bare = drawLone({ id: "t1", blockId: "spya-aaaaa1", createdAt: "t" });
    expect(bare.querySelector(".marg-shut-button")?.getAttribute("aria-expanded")).toBe("true");
    expect(count(bare, "About this paragraph")).toBe(1);
    expect(count(bare, "Question")).toBe(1);
    expect(bare.querySelector(".marg-open .marg-open-head")).toBeNull();
    const open = [...bare.querySelectorAll<HTMLButtonElement>(".marg-open button")].find(
      (b) => b.textContent === "Open the conversation",
    );
    act(() => open?.click());
    expect(opened).toEqual(["t1"]);
    act(() => root?.unmount());
    host?.remove();

    /* And the passage it was asked from, which the shut line already quotes. */
    const quoted = drawLone({ id: "t2", blockId: "spya-aaaaa1", createdAt: "t", quote: "the bound holds" });
    expect(count(quoted, "the bound holds")).toBe(1);
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
    const el = draw([{ kind: "comment", items: [{ as: "comment-ai", comment }] }]);
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

  /* Greg, spya-qcgyb0: "when I click to expand, it shows the FAQ answer, but
     the FAQ question is still truncated." With one item the line IS the
     question (or the work's title, or the headline), and the open half does not
     repeat it, so opening has to let the line wrap. Plan 261003b. */
  it("lets the line wrap once it is open, so a lone FAQ question is read whole", () => {
    const css = readFileSync("src/web/styles/marginalia.css", "utf8");
    const opened = css.match(/\.marg-shut\[data-open\] \.marg-shut-label\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(opened).toContain("white-space: normal");
    expect(opened).toContain("overflow: visible");
    const el = draw([{ kind: "faq", items: [{ question, quote: "because it does", morePassages: 0 }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    act(() => button?.click());
    expect(el.querySelector(".marg-shut")?.hasAttribute("data-open")).toBe(true);
    expect(button?.querySelector(".marg-shut-label")?.textContent).toContain("Why does the bound hold?");
  });

  /* SPIDERYARN-READING2-9A, plan 261003b: a question's passage is the
     article's words, so it is in the author's face (docs/project/fonts.md). */
  it("draws the passage a question was asked from in the author's face, shut and open", () => {
    const asked = { id: "t1", blockId: "spya-aaaaa1", createdAt: "t", quote: "the bound holds" };
    const only = draw([{ kind: "comment", items: [{ as: "question", asked }] }]);
    expect(only.querySelector(".marg-shut-line")?.classList.contains("voice-author")).toBe(true);
    act(() => root?.unmount());
    host?.remove();

    const comment = { id: "c", blockId: "spya-aaaaa1", createdAt: "t", body: "mine", status: "none" } as unknown as MarginComment;
    const two = draw([{ kind: "comment", items: [{ as: "comment", comment }, { as: "question", asked }] }]);
    act(() => two.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    const quoted = [...two.querySelectorAll(".marg-open .voice-author")].map((s) => s.textContent);
    expect(quoted).toEqual(["“the bound holds”"]);
  });

  it("leaves a question with no passage, and a count, in the app's face", () => {
    const asked = { id: "t1", blockId: "spya-aaaaa1", createdAt: "t" };
    const el = draw([{ kind: "comment", items: [{ as: "question", asked }] }]);
    expect(el.querySelector(".marg-shut-line")?.classList.contains("voice-ui")).toBe(true);
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
        <tr><td><MarginNotesSlot blockId="spya-aaaaaa" viewer="owner" notes={[{ kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] }]} /></td></tr>
        <tr><td><MarginNotesSlot blockId="spya-aaaaaa" viewer="owner" notes={[{ kind: "question", depth: 1, text: "Below" }]} /></td></tr>
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
