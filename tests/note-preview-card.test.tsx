// @vitest-environment jsdom
/**
 * **The footnote card, mounted and driven by events** — src/web/ProseHoverCard.tsx.
 *
 * tests/note-markers.test.ts proves the decisions: which anchor is a marker,
 * which blocks a note is made of, what may be in the fragment. Every one of
 * those could be right while a reader saw nothing, which is the failure mode
 * this repo keeps meeting — so this mounts the real component over the markup
 * `TableView` renders and asks the questions a reader would: does resting on a
 * marker show the note, does the second tap go there, does a link inside the
 * preview jump instead of navigating the page away.
 *
 * What it cannot prove is that any of it is *legible* — the size of the panel,
 * whether a long note scrolls, whether the marker reads as apparatus. Those are
 * a browser's answer and are listed as unverified in the stage report.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseHoverCard } from "../src/web/ProseHoverCard.js";
import { buildNoteIndex, type NoteBlock } from "../src/web/notes-view.js";

/* Floating UI observes its reference element and jsdom has no ResizeObserver;
   without this the hook throws on the first open. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const NOTE = "spya-note-aaaaaaaaaa";

/** The four blocks: two passages that cite the note, and the note's two blocks. */
const blocks: NoteBlock[] = [
  {
    id: "spya-bdyaa2",
    tag: "p",
    html: `<p>A claim.<sup><a href="#spya-ntyaa2" id="fnref1" data-spya-note-ref="${NOTE}">1</a></sup></p>`,
  },
  {
    id: "spya-bdyaa3",
    tag: "p",
    html: `<p>And again.<sup><a href="#spya-ntyaa2" id="fnref2" data-spya-note-ref="${NOTE}">1</a></sup></p>`,
  },
  {
    id: "spya-ntyaa2",
    tag: "li",
    role: "footnote",
    treatment: "supplement",
    noteId: NOTE,
    html:
      `<li id="spya-ntyaa2" data-spya-note="${NOTE}"><p>The note's first half, which mentions ` +
      `<a href="#spya-bdyaa3" id="inbound">the second passage</a>.</p> ` +
      `<a href="#spya-bdyaa2" data-spya-note-back="${NOTE}">↩</a></li>`,
  },
  {
    id: "spya-ntyaa3",
    tag: "li",
    role: "footnote",
    treatment: "supplement",
    noteId: NOTE,
    html: `<li id="spya-ntyaa3" data-spya-note="${NOTE}">Its second half, which one block would lose.</li>`,
  },
];

const index = buildNoteIndex(blocks);
const blockText = new Map(blocks.map((b) => [b.id, b.html.replace(/<[^>]+>/g, "")]));

const jumped: string[] = [];
const followed: [string | null, string][] = [];

function Harness() {
  return (
    <>
      <table>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id} data-block={b.id}>
              <td>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: standing in for TableView */}
                <div className="prose" dangerouslySetInnerHTML={{ __html: b.html }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProseHoverCard
        entries={[]}
        sourceUrl={null}
        blockText={blockText}
        notes={index}
        lookUpLinks={false}
        onOpenTerm={() => {}}
        onJump={(id) => jumped.push(id)}
        onFollowNote={(from, to) => followed.push([from, to])}
      />
    </>
  );
}

/** A pointer/mouse event jsdom will dispatch, with the pointer fields laid on. */
function pointer(
  type: string,
  target: Element,
  { x = 10, y = 10, pointerType = "mouse", id = 1, isPrimary = true } = {},
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "isPrimary", { value: isPrimary });
  target.dispatchEvent(event);
  return event;
}

/** Rest the pointer on something for long enough to open a card. */
function hover(target: Element) {
  act(() => {
    pointer("pointerover", target);
  });
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

function tap(target: Element) {
  act(() => {
    pointer("pointerdown", target, { pointerType: "touch" });
    pointer("pointerup", target, { pointerType: "touch" });
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  jumped.length = 0;
  followed.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const card = () => document.querySelector(".prose-card");
const preview = () => document.querySelector(".note-preview");
const marker = (n: number) => host.querySelectorAll("a[data-spya-note-ref]")[n] as HTMLElement;

describe("resting on a footnote marker", () => {
  it("shows the whole note rather than a description of it", () => {
    expect(card()).toBe(null);
    hover(marker(0));
    expect(card()?.className).toContain("has-note");
    const text = preview()?.textContent ?? "";
    expect(text).toContain("The note's first half");
    // The second block of the note, which a one-block preview would drop.
    expect(text).toContain("Its second half");
    // Not the ordinary anchor card, which would say this and clip to 260 chars.
    expect(card()?.textContent).not.toContain("elsewhere in this article");
    expect(card()?.textContent).toContain("note 1");
    // And not the note's own back-link, which points where the reader is.
    expect(text).not.toContain("↩");
  });

  /* The trap named in the plan before any of this was written: injected block
     html duplicates block ids into a document where everything is addressed by
     id — `internalTarget` included. */
  it("puts no duplicate ids in the document", () => {
    hover(marker(0));
    expect(preview()?.querySelectorAll("[id]").length).toBe(0);
    // The article's own copy is untouched and still resolvable.
    expect(host.querySelectorAll("#spya-ntyaa2").length).toBe(1);
  });

  /* The preview lives in a portal, outside TableView's delegated handler. Its
     links would otherwise navigate the whole page — throwing away the article
     the reader is in the middle of — or do nothing at all. */
  it("owns the links inside it", () => {
    hover(marker(0));
    const link = preview()?.querySelector("a[href^='#']") as HTMLElement;
    expect(link).toBeTruthy();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(jumped).toEqual(["spya-bdyaa3"]);
    expect(click.defaultPrevented).toBe(true);
  });

  it("opens on keyboard focus too", () => {
    act(() => {
      marker(1).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(preview()?.textContent).toContain("The note's first half");
  });

  it("says how many passages cite it", () => {
    hover(marker(0));
    expect(card()?.textContent).toContain("cited in 2 passages");
  });
});

describe("a finger on a footnote marker", () => {
  /* A tap on a link ordinarily navigates, and for a marker that is the one
     thing it must not do: the jump recentres all three panels on the notes for
     a citation the reader has not read yet. */
  it("previews on the first tap and goes on the second", () => {
    tap(marker(0));
    expect(preview()?.textContent).toContain("The note's first half");
    expect(followed).toEqual([]);
    tap(marker(0));
    expect(followed).toEqual([["spya-bdyaa2", "spya-ntyaa2"]]);
  });

  it("remembers which passage a second marker was followed from", () => {
    tap(marker(1));
    tap(marker(1));
    expect(followed).toEqual([["spya-bdyaa3", "spya-ntyaa2"]]);
  });
});

describe("resting on a back-link, at the note", () => {
  it("says where it goes rather than 'elsewhere in this article'", () => {
    const back = host.querySelector("a[data-spya-note-back]") as HTMLElement;
    hover(back);
    expect(card()?.textContent).toContain("cited here");
    expect(card()?.textContent).toContain("A claim.");
    expect(card()?.textContent).not.toContain("elsewhere in this article");
  });
});
