// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { clearFoldArticle, setFoldArticle, toggleFold } from "../src/web/fold.js";
import type { Section } from "../src/web/position.js";
import { arrivalAnchor, clearArrivalAnchor, scrollToBlock } from "../src/web/scroll.js";
import { useColumnContext } from "../src/web/useColumnContext.js";

class NoResizeObserver {
  observe() {}
  disconnect() {}
}

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const FIRST = [
  { row: 0, blockId: A, nodeId: "n0001", title: "First", titleVoice: "ai" },
  { row: 5, blockId: B, nodeId: "n0002", title: "Second", titleVoice: "ai" },
] as Section[];
const REFLOWED = [FIRST[0] as Section];

let host: HTMLDivElement;
let root: Root;
/** Where `B`'s row sits in the 200px window; a test may move it. */
let topOfB = 50;
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames(): void {
  for (const [id, cb] of [...frames]) {
    if (frames.delete(id)) cb(0);
  }
}

function Harness({ sections, layoutKey }: { sections: Section[]; layoutKey: string }): ReactNode {
  const { focusRow } = useColumnContext({ sections, enabled: true, layoutKey });
  return (
    <>
      <output data-focus-row>{focusRow}</output>
      <table className="zoom">
        <tbody>
          {sections.map((section) => (
            <tr data-block={section.blockId} key={section.blockId}>
              <td>{section.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 1000, configurable: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.block === B ? topOfB : 0;
    return { top, bottom: top + 20, height: 20 } as DOMRect;
  });
  topOfB = 50;
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  clearArrivalAnchor();
  clearFoldArticle();
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Structure's current-row measurement", () => {
  it("publishes row zero after a layout change replaces a later current section", () => {
    act(() => root.render(<Harness sections={FIRST} layoutKey="before" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    act(() => root.render(<Harness sections={REFLOWED} layoutKey="after" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  /* qi-d7pxe8z7. A jump lands its block centred, which is *below* the 40%
     line this hook reads at, so Structure marked the part before the one the
     reader had just clicked. A centred arrival is where the reader is
     (scroll.ts § `anchor`), here as for `?at=`. */
  it("names the section of a centred arrival, though its heading sits below the focus line", () => {
    topOfB = 90; // a 20px row centred in the window; the focus line is at 80
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");

    scrollToBlock(B, "auto", undefined, { align: "centre" });
    expect(arrivalAnchor()?.id).toBe(B);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    /* The reader moves, the hold ends, and the line answers again. */
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 7, writable: true, configurable: true });
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(arrivalAnchor()).toBeNull();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  it("names an already centred arrival without a scroll event", () => {
    topOfB = 90; // a 20px row centred in the 200px window
    const scroll = vi.spyOn(window, "scrollTo");
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");

    act(() => {
      scrollToBlock(B, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(arrivalAnchor()?.id).toBe(B);
    expect(scroll).not.toHaveBeenCalled();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");
  });

  it("returns to the focus line when the arrival ends without a scroll event", () => {
    topOfB = 90;
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    act(() => {
      scrollToBlock(B, "auto", undefined, { align: "centre" });
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("5");

    act(() => {
      clearArrivalAnchor();
      flushFrames();
    });
    expect(arrivalAnchor()).toBeNull();
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});

/**
 * **Structure hears where the reader is at most once a second while they
 * scroll** (Greg, spya-m5gxk9: *"It probably only needs to update every second
 * or two"*). Each publish redraws a fitted list in a fixed band, and on an iPad
 * a band redrawn under a moving finger flickers. The first change after a quiet
 * second goes at once, the rest wait for the second to be up, and a jump never
 * waits. docs/plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md.
 */
describe("Structure's current row, held while the reader scrolls", () => {
  const C = "spya-cccccc";
  const THREE = [...FIRST, { row: 9, blockId: C, nodeId: "n0003", title: "Third", titleVoice: "ai" }] as Section[];
  let tops: Record<string, number>;
  let published: number[];

  function Held({ holdMs, layoutKey = "k" }: { holdMs?: number; layoutKey?: string }): ReactNode {
    const { focusRow } = useColumnContext({ sections: THREE, enabled: true, layoutKey, ...(holdMs === undefined ? {} : { holdMs }) });
    if (published.at(-1) !== focusRow) published.push(focusRow);
    return (
      <table className="zoom">
        <tbody>
          {THREE.map((s) => (
            <tr data-block={s.blockId} key={s.blockId}>
              <td>{s.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  /** Put the reader's focus line (80px) in one section, and tell the hook. */
  function scrollInto(blockId: string): void {
    tops = { [A]: -400, [B]: blockId === A ? 150 : -200, [C]: blockId === C ? 50 : 300 };
    if (blockId === A) tops[A] = 0;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    tops = { [A]: 0, [B]: 150, [C]: 300 };
    published = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = tops[this.dataset.block ?? ""] ?? 0;
      return { top, bottom: top + 20, height: 20 } as DOMRect;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the first crossing at once, holds the rest, and ends on where the reader stopped", () => {
    act(() => root.render(<Held holdMs={1000} />));
    act(() => vi.advanceTimersByTime(2000));
    expect(published).toEqual([0]);

    scrollInto(B);
    expect(published).toEqual([0, 5]);

    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    act(() => vi.advanceTimersByTime(300));
    scrollInto(C);
    /* Inside the hold a scroll frame reads nothing (Sol, plan review F3). */
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
    act(() => vi.advanceTimersByTime(300));
    scrollInto(A);
    act(() => vi.advanceTimersByTime(100));
    scrollInto(C);
    /* Three crossings inside the second, and none of them drawn yet. */
    expect(published).toEqual([0, 5]);

    act(() => vi.advanceTimersByTime(400));
    expect(published).toEqual([0, 5, 9]);

    /* Nothing more is owed, so nothing more is drawn. */
    act(() => vi.advanceTimersByTime(3000));
    expect(published).toEqual([0, 5, 9]);
  });

  it("never holds a jump", () => {
    act(() => root.render(<Held holdMs={1000} />));
    act(() => vi.advanceTimersByTime(2000));
    scrollInto(B);
    expect(published).toEqual([0, 5]);

    /* A row pressed in the band lands its block centred, inside the held second. */
    tops = { [A]: -400, [B]: -200, [C]: 90 };
    act(() => {
      scrollToBlock(C, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(published).toEqual([0, 5, 9]);
  });

  /* Sol, plan review F2: a jump that replaces another before a frame runs
     goes from "anchored" to "anchored", so a sampled flag sees no jump. */
  it("never holds a jump that replaces another before a frame runs", () => {
    act(() => root.render(<Held holdMs={1000} />));
    act(() => vi.advanceTimersByTime(2000));
    tops = { [A]: -400, [B]: -200, [C]: 90 };
    act(() => {
      scrollToBlock(C, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(published).toEqual([0, 9]);

    tops = { [A]: 90, [B]: 300, [C]: 500 };
    act(() => {
      scrollToBlock(A, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(published).toEqual([0, 9, 0]);
  });

  it("does not leave a jump frame armed when the trailing timer publishes it", () => {
    act(() => root.render(<Held holdMs={1000} />));
    act(() => vi.advanceTimersByTime(2000));
    scrollInto(B);

    act(() => vi.advanceTimersByTime(300));
    scrollInto(C); // Arms the trailing measurement for t=3000ms.
    act(() => vi.advanceTimersByTime(699));

    /* The arrival queues its immediate frame just before the trailing timer.
       The timer wins this race and publishes the jump; its release must cancel
       that queued frame, or the same rows are scanned again on the next paint. */
    tops = { [A]: 90, [B]: 300, [C]: 500 };
    act(() => {
      scrollToBlock(A, "auto", undefined, { align: "centre" });
      vi.advanceTimersByTime(1);
    });
    expect(published).toEqual([0, 5, 0]);

    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    act(() => flushFrames());
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
  });

  it("does not leave the trailing timer armed when a same-section jump frame wins", () => {
    act(() => root.render(<Held holdMs={1000} />));
    act(() => vi.advanceTimersByTime(2000));
    scrollInto(B);

    act(() => vi.advanceTimersByTime(300));
    scrollInto(C); // Arms the trailing measurement for t=3000ms.

    /* This time the arrival frame wins, but it still names the last published
       section. That completed scan makes the old trailing timer obsolete even
       though there is no state change to publish. */
    tops = { [A]: -400, [B]: 90, [C]: 300 };
    act(() => {
      scrollToBlock(B, "auto", undefined, { align: "centre" });
      flushFrames();
    });
    expect(published).toEqual([0, 5]);

    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    act(() => vi.advanceTimersByTime(700));
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
  });

  it("starts a fresh hold and measurement when the layout effect re-runs", () => {
    act(() => root.render(<Held holdMs={1000} layoutKey="before" />));
    act(() => vi.advanceTimersByTime(2000));
    scrollInto(B);

    act(() => vi.advanceTimersByTime(300));
    scrollInto(C); // Arms the old effect's trailing timer.
    tops = { [A]: 0, [B]: 150, [C]: 300 };
    act(() => root.render(<Held holdMs={1000} layoutKey="after" />));
    expect(published).toEqual([0, 5, 0]);

    /* The old timer was cleared with the old rows and cannot publish later. */
    act(() => vi.advanceTimersByTime(1000));
    expect(published).toEqual([0, 5, 0]);
  });

  it("is not held at all without `holdMs` (the breadcrumb's use)", () => {
    act(() => root.render(<Held />));
    scrollInto(B);
    scrollInto(C);
    expect(published).toEqual([0, 5, 9]);
  });

  it("is not held with an explicit zero-length hold", () => {
    act(() => root.render(<Held holdMs={0} />));
    scrollInto(B);
    scrollInto(C);
    expect(published).toEqual([0, 5, 9]);
  });
});

/**
 * **Block 0 is the first section's start and the masthead's echo at once.**
 * It is hidden through the fold store, and its section is still on screen, so
 * it is not skipped the way a folded section's start is (fold.ts §
 * `isFoldedAway`; Greg, spya-t6cdve;
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md).
 */
describe("Structure's current row when the first section starts on the masthead's echo", () => {
  const blocks = [
    { id: A, kind: "heading", tag: "h1", level: 1 },
    { id: B, kind: "text", tag: "p" },
  ] as Block[];

  it("is the first section while the reader is in it", () => {
    topOfB = 150; // the second section has not reached the focus line at 80
    setFoldArticle("slug", blocks, new Set([A as BlockId]));
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  it("is still never a section whose start a fold hides (the control)", () => {
    /* `B` is under the folded heading `A`: no height, tying with whatever is
       next, and past the focus line. Unskipped it would be the answer. */
    topOfB = 50;
    setFoldArticle("slug", blocks);
    toggleFold(A as BlockId);
    act(() => root.render(<Harness sections={FIRST} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });
});

/**
 * **A section that starts inside the shut front matter** (front-matter.ts;
 * Greg, spya-duh4w3;
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § Sections that start inside the run). A front-matter row is hidden through
 * the fold store without being folded away, so a section that starts on one
 * and carries on past it is still the one in focus, and one wholly inside the
 * run loses the tie to the section whose row is on screen.
 *
 * Since plan 261018a the run is a stretch, and its first row a stub with a
 * height of its own in a browser. The fake below still draws it at no height,
 * which is the harder case for the tie and the one these cases were written
 * against; the stub's own row only ever adds a pixel range where its section
 * is the one in focus, which is right: the reader is looking at its stub.
 */
describe("Structure's current row when a section starts in the shut front matter", () => {
  const T = "spya-tttttt";
  const R = "spya-rrrrrr";
  const V = "spya-vvvvvv";
  const blocks = [
    { id: T, kind: "heading", tag: "h1", level: 1 },
    { id: R, kind: "text", tag: "p" },
    { id: V, kind: "text", tag: "p" },
    { id: B, kind: "text", tag: "p" },
  ] as Block[];
  const at = (row: number, blockId: string, n: number) =>
    ({ row, blockId, nodeId: `n000${n}`, title: `S${n}`, titleVoice: "ai" }) as Section;

  /** The hidden rows `T` and `R` sit, at no height, at the top of `V`. */
  function place(tops: Record<string, number>): void {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = tops[this.dataset.block ?? ""] ?? 0;
      return { top, bottom: top + 20, height: 20 } as DOMRect;
    });
  }

  beforeEach(() => setFoldArticle("slug", blocks, new Set([T as BlockId]), [[R as BlockId]]));

  it("is that section while the reader is in the part of it that shows", () => {
    /* The section is R and V. Its hidden start ties with V, above the line at 80. */
    place({ [T]: 20, [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, T, 1), at(1, R, 2), at(3, B, 3)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("1");
  });

  it("is never a section that is wholly inside the run", () => {
    /* The section is R alone. V starts the next one, on the same pixel. */
    place({ [T]: 20, [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, T, 1), at(1, R, 2), at(2, V, 3), at(3, B, 4)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("2");
  });

  /* **The run starts at block 0**: no title heading and no echo, so the first
     section of the article starts on a hidden row (front-matter.ts § Where it
     starts). */
  const noTitle = [
    { id: R, kind: "text", tag: "p" },
    { id: V, kind: "text", tag: "p" },
    { id: B, kind: "text", tag: "p" },
  ] as Block[];

  it("is the first section when the run starts at block 0 and the section carries on past it", () => {
    setFoldArticle("slug", noTitle, new Set(), [[R as BlockId]]);
    place({ [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, R, 1), at(2, B, 2)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("0");
  });

  it("is the second section when the first is the run at block 0 and nothing else", () => {
    setFoldArticle("slug", noTitle, new Set(), [[R as BlockId]]);
    place({ [R]: 20, [V]: 20, [B]: 150 });
    act(() => root.render(<Harness sections={[at(0, R, 1), at(1, V, 2), at(2, B, 3)]} layoutKey="k" />));
    expect(host.querySelector("[data-focus-row]")?.textContent).toBe("1");
  });
});
