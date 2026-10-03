// @vitest-environment jsdom
/**
 * **The in-text glossary card's *Dig deeper* and *Hide*, owner only** — plan
 * 261002c § 3, and the one visible list it shares with the band (§ 2).
 *
 * > We have a "Dig deeper" in Glossary mode. Add that to the in-text glossary
 * > tooltip.
 * >
 * > — Greg, 2026-10-02 (spya-p09u4s)
 *
 * The claims:
 *
 * 1. `shownEntries` leaves the hidden out, and hands back the same array when
 *    nothing is hidden (the memos downstream key on its identity).
 * 2. An owner's card draws both buttons; a visitor's draws neither.
 * 3. *Dig deeper* calls `look` with the entry's id, opens the band on that term
 *    and closes the card. It is disabled while any dig runs, and with the
 *    band's sentence on a term the article never quotes.
 * 4. *Hide* awaits the write and closes the card only on success; a refusal is
 *    a line inside the card, and the card stays.
 * 5. Both are ordinary buttons a finger reaches: a touch tap inside the card is
 *    left alone (useHoverCard.ts § "Inside the card").
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseHoverCard, type TermActions } from "../src/web/ProseHoverCard.js";
import { annotateHtml, termMarks } from "../src/web/annotate.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { shownEntries } from "../src/web/glossary-shown.js";
import { DIG_DEEPER_UNQUOTED } from "../src/web/GlossaryPanel.js";
import type { Block, BlockId, GlossaryEntry } from "../src/types.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ONE = "spya-hdq7vn" as BlockId;

const BLOCKS: Block[] = [
  {
    id: ONE,
    tag: "p",
    kind: "text",
    text: "The delayed win-shift task was used.",
    words: 6,
    html: "<p>The delayed win-shift task was used.</p>",
    gistable: true,
  },
];

const TERM: GlossaryEntry = {
  id: "spya-hdq8ws",
  name: "Delayed win-shift task",
  kind: "concept",
  aliases: [],
  blocks: [ONE],
  senseHere: "A maze task where the reward moves.",
};

const opened: string[] = [];

function Harness({ entries, actions }: { entries: GlossaryEntry[]; actions: TermActions | null }) {
  const terms = termMarks(
    BLOCKS,
    entries.map((e) => ({ id: e.id, forms: [e.name, ...e.aliases], blocks: e.blocks.length ? e.blocks : [ONE] })),
  );
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
                  dangerouslySetInnerHTML={{ __html: annotateHtml(b.html, terms.get(b.id) ?? []) }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProseHoverCard
        entries={entries}
        works={[]}
        slug={null}
        sourceUrl={null}
        blockText={new Map(BLOCKS.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        showInSpideryarn={false}
        termActions={actions}
        onOpenTerm={(id) => opened.push(id)}
        onJump={() => {}}
        onFollowNote={() => {}}
      />
    </>
  );
}

function actionsWith(over: Partial<TermActions> = {}): TermActions & {
  look: ReturnType<typeof vi.fn>;
  setHidden: ReturnType<typeof vi.fn>;
} {
  return {
    look: vi.fn(async () => true),
    looking: null,
    stale: false,
    setHidden: vi.fn(async () => {}),
    hiding: new Set<string>(),
    ...over,
  } as TermActions & { look: ReturnType<typeof vi.fn>; setHidden: ReturnType<typeof vi.fn> };
}

let host: HTMLDivElement;
let root: Root;

function paint(entries: GlossaryEntry[], actions: TermActions | null): void {
  act(() => root.render(<Harness entries={entries} actions={actions} />));
}

function pointerOver(target: Element): void {
  const event = new MouseEvent("pointerover", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

function hover(target: Element): void {
  act(() => pointerOver(target));
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

/** A finger's tap on something inside the card — the events a touch press fires. */
function touchPress(target: Element): void {
  const fire = (type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, detail: 1 });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    Object.defineProperty(event, "pointerId", { value: 2 });
    Object.defineProperty(event, "isPrimary", { value: true });
    target.dispatchEvent(event);
  };
  act(() => {
    fire("pointerdown");
    fire("pointerup");
    fire("click");
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
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
const mark = () => host.querySelector("mark.term") as HTMLElement;
const button = (label: string) =>
  [...(card()?.querySelectorAll<HTMLButtonElement>(".prose-card-act") ?? [])].find((b) =>
    b.textContent?.includes(label),
  );

describe("the one visible list", () => {
  it("leaves out the hidden, and is the same array when nothing is hidden", () => {
    const shown = { ...TERM };
    const gone = { ...TERM, id: "spya-hdq9xt", hidden: true as const };
    expect(shownEntries([shown, gone])).toEqual([shown]);
    const none = [shown];
    expect(shownEntries(none)).toBe(none);
  });
});

describe("the card's owner actions", () => {
  it("draws Dig deeper and Hide for an owner, and neither for a visitor", () => {
    paint([TERM], actionsWith());
    hover(mark());
    expect(button("Dig deeper")).toBeTruthy();
    expect(button("Hide")).toBeTruthy();
    /* One row, since 2026-10-03 (spya-za77hj): Greg, *"They should all be on
       the same row to minimize vertical space"*. The owner's two verbs sit in
       the foot beside the way out, which is now named for what it does. */
    const foot = card()?.querySelector(".prose-card-foot");
    const group = foot?.querySelector(".prose-card-term-acts");
    expect(button("Dig deeper")?.parentElement).toBe(group);
    expect(button("Hide")?.parentElement).toBe(group);
    expect(group?.lastElementChild?.textContent).toBe("Open glossary");
    expect(foot?.querySelector(".prose-card-open")?.textContent).toBe("Open glossary");
    expect(card()?.querySelectorAll("p.prose-card-foot, p.prose-card-acts")).toHaveLength(1);

    act(() => root.render(<Harness entries={[TERM]} actions={null} />));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    hover(mark());
    expect(card(), "the visitor's card did not open").not.toBeNull();
    expect(card()?.querySelector(".prose-card-act")).toBeNull();
    expect(card()?.querySelector(".prose-card-open")?.textContent).toBe("Open glossary");
  });

  it("Dig deeper starts the dig, opens the band on the term, and closes the card", () => {
    const actions = actionsWith();
    paint([TERM], actions);
    hover(mark());
    act(() => button("Dig deeper")?.click());
    expect(actions.look).toHaveBeenCalledWith(TERM.id);
    expect(opened).toEqual([TERM.id]);
    expect(card()).toBeNull();
  });

  it("works under a finger, as the card's other buttons do", () => {
    const actions = actionsWith();
    paint([TERM], actions);
    hover(mark());
    touchPress(button("Dig deeper") as HTMLButtonElement);
    expect(actions.look).toHaveBeenCalledWith(TERM.id);
    expect(opened).toEqual([TERM.id]);
  });

  it("waits while any dig runs, saying so on the one that is this term's", () => {
    paint([TERM], actionsWith({ looking: "spya-hdqazz" }));
    hover(mark());
    expect(button("Dig deeper")?.disabled).toBe(true);

    act(() => root.render(<Harness entries={[TERM]} actions={actionsWith({ looking: TERM.id })} />));
    expect(button("Digging deeper…")?.disabled).toBe(true);
  });

  it("is disabled, with the band's sentence, on a term the article never quotes", () => {
    const unquoted = { ...TERM, blocks: [] };
    paint([unquoted], actionsWith());
    hover(mark());
    const dig = button("Dig deeper");
    expect(dig?.disabled).toBe(true);
    expect(dig?.title).toBe(DIG_DEEPER_UNQUOTED);
  });

  it("but not on a stale list, where an empty block list says nothing", () => {
    paint([{ ...TERM, blocks: [] }], actionsWith({ stale: true }));
    hover(mark());
    expect(button("Dig deeper")?.disabled).toBe(false);
  });

  it("Hide awaits the write and closes the card on success", async () => {
    let finish: () => void = () => {};
    const actions = actionsWith({
      setHidden: vi.fn(() => new Promise<void>((go) => (finish = go))),
    });
    paint([TERM], actions);
    hover(mark());
    act(() => button("Hide")?.click());
    expect(actions.setHidden).toHaveBeenCalledWith(TERM.id, true);
    /* Pessimistic: nothing closes before the server has answered. */
    expect(card()).not.toBeNull();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(card()).toBeNull();
  });

  it("Hide says a refusal inside the card, and the card stays", async () => {
    const actions = actionsWith({
      setHidden: vi.fn(async () => {
        throw new Error("Hiding that term did not go through. The server said no.");
      }),
    });
    paint([TERM], actions);
    hover(mark());
    await act(async () => {
      button("Hide")?.click();
      await Promise.resolve();
    });
    expect(card()).not.toBeNull();
    expect(card()?.querySelector(".prose-card-failed")?.textContent).toBe(
      "Hiding that term did not go through. The server said no.",
    );
  });

  it("Hide is disabled while that entry's write is out", () => {
    paint([TERM], actionsWith({ hiding: new Set([TERM.id]) }));
    hover(mark());
    expect(button("Hide")?.disabled).toBe(true);
  });
});

describe("the card's label on a stored answer", () => {
  /* Plan 261002f's browser check: an added term's answer, which ran no
     search, was labelled "checked on the web" on the card while the band
     said "no web search". */
  const answered = (searches: number): GlossaryEntry => ({
    ...TERM,
    lookup: { answer: "What it is.", citations: [], searches, model: "m", at: "2026-10-02T00:00:00.000Z" },
  });

  it("says the web only when the model searched it", () => {
    paint([answered(0)], actionsWith());
    hover(mark());
    expect(card()?.textContent).toContain("without a web search");
    expect(card()?.textContent).not.toContain("checked on the web");
  });

  it("and says it when it did", () => {
    paint([answered(2)], actionsWith());
    hover(mark());
    expect(card()?.textContent).toContain("checked on the web");
  });
});
