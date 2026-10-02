// @vitest-environment jsdom
/**
 * **Every note in Marginalia says what it is and where it came from**, in the
 * house card rather than a native `title`.
 *
 * Greg, 2026-10-01 (spya-atv4nx): *"I can't tell what that Annotation is from
 * or why or whether AI-generated … Make sure all annotations have rich
 * tooltips (see tooltips.md) explaining their origin."* Before him, on the
 * question notes (SPIDERYARN-READING2-84): *"They should ideally have tooltips
 * to explain themselves."*
 *
 * The shut lines and questions carry a key (`data-marg-tip`); the reading
 * view's one delegated card (BlockLinkCard.tsx) draws `MARG_TIPS[key]`.
 * docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitedWork, FaqQuestion } from "../src/types.js";
import { BlockLinkProvider } from "../src/web/BlockLinkCard.js";
import { MarginNotesSlot } from "../src/web/marginalia/MarginaliaColumn.js";
import type { MarginClaim, MarginComment, MarginaliaNote } from "../src/web/marginalia/notes.js";
import { MARG_TIPS, type MargTipKey } from "../src/web/marginalia/tips.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_DELAY = 500;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
});

const question = { id: "q1", question: "Why does it matter?" } as unknown as FaqQuestion;
const claim = {
  id: "d1",
  relation: "disputes",
  url: "https://example.org/a",
  title: "A reply",
  sourceQuote: "The page's words.",
  applies: "It bears on the claim.",
} as unknown as MarginClaim;
const work = { id: "w1", title: "A cited work", why: "Because." } as unknown as CitedWork;
const comment = { id: "c1", body: "My thought", answer: null } as unknown as MarginComment;

/** One note of each kind, with the key its card should be drawn from. */
const EACH: readonly [MarginaliaNote, MargTipKey][] = [
  [{ kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] }, "faq"],
  [{ kind: "debate", items: [claim] }, "debate"],
  [{ kind: "citation", items: [work] }, "citation"],
  [{ kind: "comment", items: [comment] }, "comment-own"],
];

function paint(notes: MarginaliaNote[], viewer: "owner" | "visitor" = "owner"): void {
  act(() =>
    root.render(
      <BlockLinkProvider index={new Map()}>
        <MarginNotesSlot notes={notes} viewer={viewer} />
      </BlockLinkProvider>,
    ),
  );
}

const card = () => document.querySelector<HTMLElement>(".tooltip-anchor");
const trigger = () => host.querySelector<HTMLElement>(".marg-note [data-marg-tip]")!;

async function hover(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

describe("a note in the margin", () => {
  it.each(EACH)("%o carries no native title, and draws its own card on hover", async (note, key) => {
    paint([note]);
    const el = trigger();
    expect(el.getAttribute("data-marg-tip")).toBe(key);
    expect(host.querySelector(".marg-note [title]"), "a native title is left").toBeNull();
    await hover(el);
    const text = card()?.textContent ?? "";
    expect(text).toContain(MARG_TIPS[key].head);
    expect(text).toContain(MARG_TIPS[key].how);
  });

  it("tells a visitor whose comment it is", async () => {
    paint([{ kind: "comment", items: [comment] }], "visitor");
    expect(trigger().getAttribute("data-marg-tip")).toBe("comment-owner");
  });

  it("does not open for a finger, which opens the note instead", async () => {
    paint([{ kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] }]);
    trigger().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
  });
});

describe("a question note", () => {
  /* A question has nothing to press, so its card is a Tooltip of its own on a
     button: a tap or a keyboard reaches it, which the delegated card does not.
     GPT Sol, plan review of 261002g. */
  it.each([
    [0, "question-article"],
    [1, "question-part"],
  ] as const)("at depth %i opens its card on a press, with no native title", async (depth, key) => {
    paint([{ kind: "question", depth, text: "Why?" }]);
    const button = host.querySelector<HTMLButtonElement>("button.marg-question");
    expect(button, "the question is not a button").not.toBeNull();
    expect(button?.hasAttribute("title")).toBe(false);
    await act(async () => button?.click());
    const text = document.body.textContent ?? "";
    expect(text).toContain(MARG_TIPS[key].head);
    expect(text).toContain(MARG_TIPS[key].how);
  });
});

describe("the cards' words", () => {
  /* tooltips.md § ControlTip: the second paragraph is what a reader could not
     guess from the first; a card that restates itself is the failure. */
  it.each(Object.entries(MARG_TIPS))("%s: says where it came from, and does not repeat itself", (_key, tip) => {
    expect(tip.how).not.toBe(tip.what);
    expect(tip.what).not.toContain(tip.head);
    expect(tip.how).toMatch(/AI|you|person who shared/);
  });
});

describe("whose words a shut line is (fonts.md)", () => {
  it("an FAQ question is the AI's, and the passage it quotes the author's", () => {
    paint([{ kind: "faq", items: [{ question, quote: "the words", morePassages: 0 }] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-ai")).toBe(true);
  });

  it("a comment is the reader's", () => {
    paint([{ kind: "comment", items: [comment] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-reader")).toBe(true);
  });

  it("a count is ours", () => {
    paint([{ kind: "citation", items: [work, { ...work, id: "w2" } as CitedWork] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-ui")).toBe(true);
  });
});
