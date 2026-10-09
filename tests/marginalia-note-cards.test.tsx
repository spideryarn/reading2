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
import type { CitedWork, FaqQuestion, TimelineEvent } from "../src/types.js";
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
  [{ kind: "comment", items: [{ as: "comment", comment }] }, "comment-own"],
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
    paint([{ kind: "comment", items: [{ as: "comment", comment }] }], "visitor");
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

  it("opens from keyboard focus and describes the shut button only while its card is open", async () => {
    paint([{ kind: "faq", items: [{ question, quote: "q", morePassages: 0 }] }]);
    const button = trigger();
    act(() => button.focus());
    const openCard = card();
    expect(openCard, "keyboard focus opened no card").not.toBeNull();
    expect(openCard?.getAttribute("role")).toBe("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(openCard?.id);

    act(() => button.blur());
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(card()).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
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

  /* spya-xf6m2u: "the tooltip says to 'press it' but I don't see anything to
     press." The line is the button, so the card names it. */
  it.each(Object.entries(MARG_TIPS))("%s: a card that says to press says what to press", (_key, tip) => {
    expect(tip.what).not.toMatch(/press it\b/i);
    if (/\bpress\b/i.test(tip.what)) expect(tip.what).toMatch(/Press this line/);
  });

  it("promises of a cited work only what the open line shows", () => {
    /* The by-line and the article's reference entry, never the model's reason
       (plan 261003j) — MarginaliaColumn.tsx § CitationNote. */
    expect(`${MARG_TIPS.citation.what} ${MARG_TIPS.citation.how}`).not.toMatch(/why it is cited|reason it is cited/i);
  });

  it("explains an assumed Timeline year instead of promising dates are never guessed", () => {
    const event: TimelineEvent = {
      id: "e", label: "The launch", order: 1, modality: "happened", occurrences: [],
      dating: {
        kind: "dated",
        when: {
          earliest: "2026-05-12", latest: "2026-05-12", phrase: "12 May", yearFrom: "piece",
          extent: "instant", yearFilled: true, at: { blockId: "spya-aaaaaa", start: 18, end: 24 },
        },
      },
    };
    paint([{ kind: "timeline", items: [{ event, quote: "The launch was on 12 May." }] }]);
    expect(host.querySelector(".marg-stamp")?.textContent).toContain("year assumed");
    expect(MARG_TIPS.timeline.how).not.toContain("never guessed");
    expect(MARG_TIPS.timeline.how).toMatch(/year.*assum|assum.*year/i);
  });

  it("says when Debate's displayed headline can be AI's reading rather than the page's title", () => {
    expect(MARG_TIPS.debate.how).toMatch(/AI wrote the headline/i);
  });
});

describe("whose words a shut line is (fonts.md)", () => {
  it("an FAQ question is the AI's, and the passage it quotes the author's", () => {
    paint([{ kind: "faq", items: [{ question, quote: "the words", morePassages: 0 }] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-ai")).toBe(true);
  });

  it("a Timeline label is the AI's; a date in the article's own words is the author's, a computed one ours", () => {
    const event = (dating: TimelineEvent["dating"]) =>
      ({ id: "e", label: "The launch", dating, order: 1, modality: "happened", occurrences: [] }) as TimelineEvent;
    paint([{ kind: "timeline", items: [{ event: event({ kind: "words", phrase: "a month later" }), quote: "q" }] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-ai")).toBe(true);
    expect(host.querySelector(".marg-stamp")?.classList.contains("voice-author")).toBe(true);
    const when = { earliest: "2026-05-12", latest: "2026-05-12", phrase: "12 May" };
    paint([{ kind: "timeline", items: [{ event: event({ kind: "dated", when } as TimelineEvent["dating"]), quote: "q" }] }]);
    expect(host.querySelector(".marg-stamp")?.textContent).toBe("12 May 2026");
    expect(host.querySelector(".marg-stamp")?.classList.contains("voice-ui")).toBe(true);
  });

  it("a Timeline date with no year is the article's own phrase, quoted, in the author's face", () => {
    const dating: TimelineEvent["dating"] = { kind: "rejected", reason: "noYearFrame", phrase: "On July 7" };
    const event = { id: "e", label: "The launch", dating, order: 1, modality: "happened", occurrences: [] } as TimelineEvent;
    paint([{ kind: "timeline", items: [{ event, quote: "q" }] }]);
    expect(host.querySelector(".marg-stamp")?.textContent).toBe("“On July 7”");
    expect(host.querySelector(".marg-stamp")?.classList.contains("voice-author")).toBe(true);
  });

  it("a relation word is a button a keyboard can reach, in the AI's face, and says what it means", () => {
    paint([{ kind: "relation", relation: "contrast" }]);
    const word = host.querySelector<HTMLButtonElement>("button.marg-relation");
    expect(word?.textContent).toBe("vs");
    expect(word?.classList.contains("voice-ai")).toBe(true);
    expect(word?.getAttribute("aria-label")).toContain("sets something against what came before");
  });

  it("a comment is the reader's", () => {
    paint([{ kind: "comment", items: [{ as: "comment", comment }] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-reader")).toBe(true);
  });

  it("a count is ours", () => {
    paint([{ kind: "citation", items: [work, { ...work, id: "w2" } as CitedWork] }]);
    expect(host.querySelector(".marg-shut-line")?.classList.contains("voice-ui")).toBe(true);
  });
});

/* A relation or a provenance a newer server sends to a copy built before it.
   Each stamp and each tip sentence is a table read by that value. The slot's
   boundary catches a throw, so the failure is a block whose notes silently are
   not there. docs/plans/261005h, Stage A. */
describe("a value this copy of the app was built before", () => {
  const UNKNOWN = ["a-newer-value", "__proto__", "constructor", "toString"];
  const words = (value: string) => value.replaceAll("-", " ");
  const idea = (provenance: string) =>
    ({ kind: "idea", ideaId: "i1", name: "Locality", statement: "Causes act nearby.", provenance }) as unknown as MarginaliaNote;
  const stamps = () => [...host.querySelectorAll(".marg-stamp")].map((el) => el.textContent);
  const openIdea = () => act(async () => host.querySelector<HTMLButtonElement>("button.marg-idea")?.click());
  const cardLines = () => [...document.querySelectorAll(".tip-soon-how")].map((el) => el.textContent);

  beforeEach(() => {
    /* React logs what the slot's boundary caught; the assertions report it. */
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stamps the values it knows (the control)", async () => {
    paint([{ kind: "debate", items: [claim] }, idea("assumed")]);
    expect(stamps()).toEqual(["disputes", "assumes"]);
    await openIdea();
    expect(cardLines()).toHaveLength(2);
    expect(cardLines()[0]).toBe("The piece takes this for granted rather than arguing for it.");
  });

  it.each(UNKNOWN)("stamps a lone Debate page's relation %s as the server's own word", (relation) => {
    paint([{ kind: "debate", items: [{ ...claim, relation } as unknown as MarginClaim] }]);
    expect(stamps()).toEqual([words(relation)]);
  });

  it.each(UNKNOWN)("stamps relation %s on one of several Debate pages", (relation) => {
    const other = { ...claim, id: "d2", relation } as unknown as MarginClaim;
    paint([{ kind: "debate", items: [claim, other] }]);
    /* Each page's own stamp is inside the note, which is shut until pressed. */
    act(() => host.querySelector<HTMLButtonElement>(".marg-shut-button")?.click());
    expect(stamps()).toEqual(["Others say", "disputes", words(relation)]);
  });

  it.each(UNKNOWN)("stamps an idea's provenance %s, and its card says only what it knows", async (provenance) => {
    paint([idea(provenance)]);
    expect(stamps()).toEqual([words(provenance)]);
    await openIdea();
    expect(document.body.textContent).toContain("Causes act nearby.");
    expect(cardLines()).toHaveLength(1);
  });
});
