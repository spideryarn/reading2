// @vitest-environment jsdom
/**
 * **The card on a quote in the prose** — ProseHoverCard.tsx § `QuoteCard`,
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 2.
 *
 * Greg, 2026-09-11 (spya-mtyquy): *"tooltip to show our quantitative scores and
 * perhaps Previous/Next icon-buttons to jump to the next Quote, and a button to
 * open Quotes mode"*. What is pinned here is everything a screenshot cannot
 * show: which quote the card is about when a search shares its run, that a
 * quote waits longer than a word before its card opens, that ‹ › go where they
 * say and stop at the ends, and that a finger's tap is still the paragraph's.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseHoverCard, QUOTE_OPEN_MS, type QuoteCardSource } from "../src/web/ProseHoverCard.js";
import { annotateHtml } from "../src/web/annotate.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { quoteStroke } from "../src/web/QuotesPanel.js";
import { hitMarks, quoteMarkKey, resolveQuotes } from "../src/web/search-hits.js";
import { HOVER_DELAY } from "../src/web/useHoverCard.js";
import { exactly } from "../src/web/relative-time.js";
import { helpHref, modeAnchor } from "../src/web/help/help-anchors.js";
import type { Block, BlockId, Quote } from "../src/types.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;
const THREE = "spya-h4v8zr" as BlockId;

const block = (id: BlockId, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block(ONE, "<p>Memory is the reinstatement of a context, not a store.</p>"),
  block(TWO, "<p>Nothing in this paragraph is worth keeping at all.</p>"),
  block(THREE, "<p>Forgetting is a failure of access rather than of storage.</p>"),
];

const QUOTES: Quote[] = [
  {
    id: "spya-qa0001",
    blockId: ONE,
    text: "Memory is the reinstatement of a context",
    importance: 0.9,
    striking: 0.4,
    reason: "The thesis the rest of the piece argues for.",
    addedAt: "2026-09-28T09:10:00.000Z",
  } as Quote,
  { id: "spya-qa0002", blockId: THREE, text: "Forgetting is a failure of access" } as Quote,
];

/** The list's own time: an upper bound on the second quote, which has none of its own. */
const LIST_WRITTEN = "2026-09-29T14:02:00.000Z";

const went: string[] = [];
const opened: string[] = [];

function source(): QuoteCardSource {
  return {
    listed: QUOTES,
    byKey: new Map(QUOTES.map((q) => [quoteMarkKey(q.id, q.blockId), q])),
    generatedAt: LIST_WRITTEN,
    onGo: (q) => went.push(q.id),
    onOpenInQuotes: (q) => opened.push(q.id),
  };
}

function Harness({ quotes }: { quotes: QuoteCardSource | null }) {
  const found = resolveQuotes(
    BLOCKS,
    QUOTES.map((q) => ({ ...q, stroke: quoteStroke(q) })),
  );
  /* The first quote shares its exact run with a search hit. `data-hit` is then
     a mixed list, which is the case the card's by-key filtering must survive. */
  const shared = found[0]
    ? [{ ...found[0], key: "search:shared:0", runId: "search", slot: 1, quoteStroke: null }]
    : [];
  const marks = hitMarks([...found, ...shared], null, "rg");
  return (
    <>
      <table>
        <tbody>
          {BLOCKS.map((b) => (
            <tr key={b.id} data-block={b.id}>
              <td>
                <div
                  className="prose"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: standing in for TableView
                  dangerouslySetInnerHTML={{ __html: annotateHtml(b.html, [...(marks.get(b.id) ?? [])]) }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProseHoverCard
        entries={[]}
        works={[]}
        slug={null}
        sourceUrl={null}
        blockText={new Map(BLOCKS.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        showInSpideryarn={false}
        termActions={null}
        quotes={quotes}
        onOpenTerm={() => {}}
        onJump={() => {}}
        onFollowNote={() => {}}
      />
    </>
  );
}

function pointer(type: string, target: Element, pointerType = "mouse"): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, detail: 1 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

function rest(target: Element, ms: number): void {
  act(() => pointer("pointerover", target));
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

let host: HTMLDivElement;
let root: Root;

function paint(quotes: QuoteCardSource | null = source()): void {
  act(() => root.render(<Harness quotes={quotes} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  went.length = 0;
  opened.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const card = () => document.querySelector(".prose-card");
const quoteMark = (n: number) => host.querySelectorAll("mark.hit[data-quote]")[n] as HTMLElement;
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`.prose-card button[aria-label="${label}"]`);
const openInQuotes = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".prose-card button")].find((b) =>
    (b.textContent ?? "").includes("Open in Quotes"),
  );

describe("resting on a quote", () => {
  it("finds the quote in a mixed data-hit and draws its scores, reason, and position", () => {
    paint();
    expect(quoteMark(0).getAttribute("data-hit")?.split(" ")).toEqual(
      expect.arrayContaining([quoteMarkKey(QUOTES[0]!.id, QUOTES[0]!.blockId), "search:shared:0"]),
    );
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    const text = card()?.textContent ?? "";
    expect(text).toContain("1 of 2");
    expect(text).toContain("Importance");
    expect(text).toContain("0.90");
    expect(text).toContain("Striking");
    expect(text).toContain("0.40");
    expect(text).toContain("The thesis the rest of the piece argues for.");
  });

  it("says a quote with no scores is not scored, rather than drawing empty bars", () => {
    paint();
    rest(quoteMark(1), QUOTE_OPEN_MS + 10);
    expect(card()?.textContent ?? "").toContain("Not scored.");
  });

  /* Greg, 2026-10-03 (spya-ma5h9b): *"quotes should as well, maybe saying when
     it was applied and whether it's AI generated or human highlights."* The
     same line the band's ⓘ ends with; a visitor's card draws it too, from the
     public list's `generatedAt`. Plan 261003h. */
  it("ends with who chose it and when", () => {
    paint();
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    expect(card()?.querySelector(".prose-card-quote-prov")?.textContent).toBe(
      `Chosen by the AI · ${exactly(QUOTES[0]!.addedAt)}`,
    );
  });

  it("says on or before the list's time for a quote stored without its own", () => {
    paint();
    rest(quoteMark(1), QUOTE_OPEN_MS + 10);
    expect(card()?.querySelector(".prose-card-quote-prov")?.textContent).toBe(
      `Chosen by the AI · on or before ${exactly(LIST_WRITTEN)}`,
    );
  });

  /* Greg, 2026-10-06 (spya-tpmde9): *"Add a tooltip for Quotes, so readers
     know what they are (and any further information about them)"*. The fills
     are in the prose in every mode, so this card is where a reader who has
     never opened Quotes meets one. Plan 261006j. Both fixtures, because the
     unscored branch is a different arm of the card. */
  it.each([
    ["a scored quote", 0],
    ["an unscored quote", 1],
  ])("says what a quote is, first, on %s, and links to Help's section on Quotes", (_name, n) => {
    paint();
    rest(quoteMark(n), QUOTE_OPEN_MS + 10);
    const what = card()?.querySelector(".prose-card-quote-card .prose-card-quote-what");
    expect(what, "no sentence saying what a quote is").not.toBeNull();
    /* The claims, not the whole sentence: who chose it, that it is a passage
       (src/quotes.ts § SYSTEM: "a passage, not a line"), whose words they are,
       and what the strength of the purple means. */
    const text = what?.textContent ?? "";
    expect(text).toMatch(/passage the AI picked out/);
    expect(text).toMatch(/article’s own words/);
    /* What the purple means is said only where there is a score to mean it:
       beside *Not scored.* it would be a sentence about some other quote
       (GPT Sol's F8, and the shorter of the two ways to close it). */
    if (n === 0) expect(text).toMatch(/Stronger purple means a higher Importance or Striking score\./);
    else expect(text).not.toMatch(/purple|scor/i);
    expect(text).not.toMatch(/\byou\b/i);
    expect(what?.previousElementSibling?.classList.contains("prose-card-label"), "not first under the label").toBe(
      true,
    );
    const help = card()?.querySelector<HTMLAnchorElement>(".prose-card-quote-card a.prose-card-quote-help");
    expect(help?.getAttribute("href")).toBe(helpHref(modeAnchor("quotes")));
  });

  it("stays open while the pointer is inside it, and closes when Help is followed", () => {
    paint();
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    const help = card()?.querySelector<HTMLAnchorElement>("a.prose-card-quote-help");
    expect(help).not.toBeNull();
    act(() => pointer("pointerover", help!));
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY.close + 500);
    });
    expect(card(), "the card closed under the pointer").not.toBe(null);
    act(() => help!.click());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(), "the card stayed open over the Help page").toBe(null);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "leaves a %s Help click to the browser without closing the article's card",
    (modifier) => {
      paint();
      rest(quoteMark(0), QUOTE_OPEN_MS + 10);
      const help = card()?.querySelector<HTMLAnchorElement>("a.prose-card-quote-help");
      expect(help).not.toBeNull();
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      act(() => help!.dispatchEvent(click));
      expect(click.defaultPrevented, "the app took over a modified click").toBe(false);
      expect(card(), "opening Help in another tab closed the card in this one").not.toBe(null);
    },
  );

  it("waits longer than a word does before opening, because a reader rests in a passage", () => {
    paint();
    rest(quoteMark(0), HOVER_DELAY.open + 10);
    expect(card(), "opened at a word's delay").toBe(null);
    act(() => {
      vi.advanceTimersByTime(QUOTE_OPEN_MS - HOVER_DELAY.open);
    });
    expect(card()).not.toBe(null);
  });

  /* 600ms, not the 900ms it had from 2026-10-02: a reader asked for a tooltip
     on quotes that already had one, which suggests the card was not being
     found (qi-78gf6x87). A literal, so the constant cannot drift back. */
  it("is open 600ms after the pointer rests on a quote", () => {
    paint();
    rest(quoteMark(0), 610);
    expect(card(), "still waiting at 600ms").not.toBe(null);
  });

  it("keeps the short warm swap once another card is already open", () => {
    paint();
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    expect(card()?.textContent ?? "").toContain("1 of 2");

    act(() => pointer("pointerover", quoteMark(1)));
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY.open);
    });
    expect(card()?.textContent ?? "").toContain("2 of 2");
  });

  it("draws nothing for a quote the list no longer holds", () => {
    /* The prose can outlive the list it was marked from (a Find more, a moved
       bar): a key the source does not know is the stale case, and a card with
       nothing in it is worse than no card. */
    paint({ ...source(), byKey: new Map() });
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    expect(card()).toBe(null);
  });
});

describe("the card's buttons", () => {
  it("› goes to the next quote and closes; ‹ is disabled on the first", () => {
    paint();
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    expect(button("Previous quote")?.disabled).toBe(true);
    act(() => button("Next quote")?.click());
    expect(went).toEqual(["spya-qa0002"]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card(), "the card stayed open after stepping").toBe(null);
  });

  it("› is disabled on the last — no wrap", () => {
    paint();
    rest(quoteMark(1), QUOTE_OPEN_MS + 10);
    expect(button("Next quote")?.disabled).toBe(true);
    act(() => button("Previous quote")?.click());
    expect(went).toEqual(["spya-qa0001"]);
  });

  /* Until plan 261010d the button was hidden while Quotes was the mode. It is
     drawn in every mode now, as every card's *Open in <Mode>* is: the press
     also selects the quote, and Quotes brings a selected row into view. */
  it("opens Quotes on this quote, closing the card", () => {
    paint();
    rest(quoteMark(0), QUOTE_OPEN_MS + 10);
    expect(openInQuotes()?.classList.contains("prose-card-open")).toBe(true);
    act(() => openInQuotes()?.click());
    expect(opened).toEqual(["spya-qa0001"]);
    expect(card()).toBe(null);
  });
});

describe("a finger", () => {
  it("does not open the card on a bare quote — the tap is the paragraph's", () => {
    /* A quote is the one mark a tap selects its paragraph through
       (TableView.tsx § NOT_A_BLOCK_SELECTION), which is how a finger reaches
       the gutter to annotate. So it is not in `tapSelector`. */
    paint();
    act(() => {
      pointer("pointerover", quoteMark(0), "touch");
      pointer("pointerdown", quoteMark(0), "touch");
      pointer("pointerup", quoteMark(0), "touch");
      pointer("click", quoteMark(0), "touch");
    });
    act(() => {
      vi.advanceTimersByTime(QUOTE_OPEN_MS + 10);
    });
    expect(card()).toBe(null);
  });
});
