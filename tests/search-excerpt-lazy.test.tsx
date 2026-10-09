// @vitest-environment jsdom
/**
 * **A Search list formats only the rows a reader can see** (plan 261009r).
 *
 * 261009k drew every excerpt from its block's markup. Measured in Chrome, a
 * search for "the" in BERT (588 hits) froze the page about 0.8 s longer in
 * the first, non-isolated comparison and about 1.0 s longer in the isolated
 * one. So a row draws its words as the plain string until it comes near the
 * screen, and is formatted then.
 *
 * jsdom has no `IntersectionObserver`; this hands it one that reports nothing
 * until a test says a given row has come into view.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { BlockLinkContext, type BlockLinkIndex } from "../src/web/block-link-index.js";
import { SearchPanel } from "../src/web/SearchPanel.js";
import type { Found } from "../src/web/search-hits.js";

/*
 * The DOM says what the reader sees; the spy says what the page paid for. A
 * row that formatted its words and then threw them away would pass the first
 * and keep the freeze (GPT Sol, plan review F3).
 */
const cut = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../src/web/excerpt-html.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/excerpt-html.js")>();
  return {
    ...real,
    excerptHtml: (...args: Parameters<typeof real.excerptHtml>) => {
      cut.calls.push(args[0].id);
      return real.excerptHtml(...args);
    },
  };
});

const ROWS = 30;

let container: HTMLDivElement;
let root: Root;

/**
 * Every observer the page made, and what each is watching. Not cleared between
 * tests: when-seen.ts makes one for the page and keeps it.
 */
const observers: FakeObserver[] = [];

class FakeObserver {
  watched = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  takeRecords() {
    return [];
  }
}

const realObserver = globalThis.IntersectionObserver;

/** Tell every observer watching something inside `row` that it is on screen. */
async function scrollTo(row: Element): Promise<void> {
  await act(async () => {
    for (const observer of observers) {
      const entries = [...observer.watched]
        .filter((el) => row.contains(el))
        .map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 }) as unknown as IntersectionObserverEntry);
      if (entries.length > 0) observer.callback(entries, observer as unknown as IntersectionObserver);
    }
  });
}

function blockAt(i: number): Block {
  return {
    id: `spya-lazy${String(i).padStart(2, "0")}` as BlockId,
    tag: "p",
    kind: "paragraph",
    text: `Row ${i}: the model is trained to attend.`,
    words: 8,
    html: `Row ${i}: the <em>model</em> is trained to attend.`,
    gistable: true,
  } as unknown as Block;
}

const BLOCKS = Array.from({ length: ROWS }, (_, i) => blockAt(i));
const INDEX: BlockLinkIndex = new Map(BLOCKS.map((b) => [b.id, { text: b.text, section: undefined, block: b }]));

const HITS: Found[] = BLOCKS.map((b, i) => ({
  key: `${b.id}:0`,
  blockId: b.id,
  runId: null,
  slot: null,
  index: i,
  start: 8,
  end: 17,
  confidence: null,
  valence: null,
  reasoning: null,
  short: "the model is trained",
  shortStart: 8,
  long: b.text,
  longStart: 0,
  at: i / ROWS,
  whole: false,
  quoteStroke: null,
})) as unknown as Found[];

async function draw(index: BlockLinkIndex = INDEX, strict = false): Promise<void> {
  await act(async () => {
    const panel = (
      <BlockLinkContext.Provider value={index}>
        <SearchPanel
          access={{
            kind: "owner",
            loaded: true,
            loadError: null,
            error: null,
            running: new Set(),
            onAsk: () => {},
            onRetry: () => {},
            onRecolour: () => {},
            onDelete: () => {},
          }}
          matcher="words"
          onMatcher={() => {}}
          find="the model"
          onFind={() => {}}
          runs={[]}
          active={[]}
          slots={new Map()}
          onToggle={() => {}}
          onSolo={() => {}}
          onToggleAll={() => {}}
          found={HITS}
          all={HITS}
          order="document"
          onOrder={() => {}}
          gate={0}
          gateMoved={false}
          onGate={() => {}}
          openKey={null}
          onOpen={() => {}}
        />
      </BlockLinkContext.Provider>
    );
    root.render(strict ? <StrictMode>{panel}</StrictMode> : panel);
  });
}

async function mount(index: BlockLinkIndex = INDEX, strict = false): Promise<void> {
  root = createRoot(container);
  await draw(index, strict);
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  cut.calls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  await mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.IntersectionObserver = realObserver;
});

function rows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".srch-hit")];
}

describe("a Search list's excerpts", () => {
  it("draws every row's words, but formats none until it is seen", () => {
    expect(rows()).toHaveLength(ROWS);
    for (const row of rows()) {
      expect(row.querySelector(".srch-hit-quote")?.textContent).toBe("the model is trained");
    }
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(0);
    expect(cut.calls).toEqual([]);
  });

  it("formats a row once it comes into view, and only that row", async () => {
    const third = rows()[2]!;
    await scrollTo(third);
    expect(third.querySelector(".srch-hit-quote em")?.textContent).toBe("model");
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(1);
    expect(cut.calls).toEqual([BLOCKS[2]!.id]);
  });

  it("forgets a row it was watching once the list is gone", async () => {
    const watched = () => observers.reduce((n, o) => n + o.watched.size, 0);
    expect(watched()).toBe(ROWS);
    await act(async () => root.unmount());
    expect(watched()).toBe(0);
    await mount();
  });

  it("keeps the eager answer when watching is disabled and re-enabled", async () => {
    /* A temporarily incomplete block index disables lazy formatting. That is
       the eager fallback, and `seen once` may not take it back when the same
       keyed row gets its block again. */
    await draw(new Map());
    await draw(INDEX);
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(ROWS);
  });

  it("watches each row once after StrictMode's setup-cleanup-setup", async () => {
    await act(async () => root.unmount());
    await mount(INDEX, true);
    expect(observers.reduce((n, observer) => n + observer.watched.size, 0)).toBe(ROWS);
  });

  it("formats every row where the browser has no IntersectionObserver", async () => {
    await act(async () => root.unmount());
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    await mount();
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(ROWS);
  });

  it("formats every row where the observer constructor throws", async () => {
    await act(async () => root.unmount());
    globalThis.IntersectionObserver = class {
      constructor() {
        throw new Error("not here");
      }
    } as unknown as typeof IntersectionObserver;
    await mount();
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(ROWS);
  });

  it("formats every row where observing a target throws", async () => {
    await act(async () => root.unmount());
    globalThis.IntersectionObserver = class extends FakeObserver {
      override observe() {
        throw new Error("cannot watch this target");
      }
    } as unknown as typeof IntersectionObserver;
    await mount();
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(ROWS);
  });

  it("does not lose an immediate report from an observer polyfill", async () => {
    await act(async () => root.unmount());
    globalThis.IntersectionObserver = class extends FakeObserver {
      override observe(el: Element) {
        super.observe(el);
        this.callback(
          [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    } as unknown as typeof IntersectionObserver;
    await mount();
    expect(container.querySelectorAll(".srch-hit-quote em")).toHaveLength(ROWS);
  });
});
