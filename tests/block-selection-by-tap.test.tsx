// @vitest-environment jsdom
/**
 * **Which tap on a paragraph means "this is the row I am on".**
 *
 * On a touch device the gutter's affordances — the permalink, the chat button,
 * the "?" and the "…" — are drawn only on `tr.row-active` (styles/gutter.css §
 * the touch reveal), so a finger has to be able to say which row that is. The
 * prose cell's `onClick` is that gesture, and `isBlockSelectionTap`
 * (TableView.tsx) is the policy it asks: a tap selects the block unless it
 * landed on something a tap already means something else by.
 *
 * ## Why this mounts the real `TableView` rather than calling the predicate
 *
 * The cheaper file is six calls to `isBlockSelectionTap({ target, detail })`
 * with hand-made objects, and it would pass with the `onClick` deleted, on the
 * wrong element, or wired to a handler that never reaches `setHoveredRow`.
 * GPT Sol's review of the plan (2026-09-07) is specifically about that: the
 * `<tr>`-level version of this feature had *no* policy — which nested taps
 * selected depended on which handler cancelled first and who called
 * `stopPropagation` — and the answer was to write the rule down where it could
 * be tested end to end. A test that stops at the predicate re-introduces the
 * gap it was written to close, so every case below clicks a **real rendered
 * element** with a **real `MouseEvent`** and then reads `row-active` off the
 * `<tr>`, which is the class the stylesheet actually keys on.
 *
 * Five of the six target types are the article's own markup and come out of the
 * fixture as they would in the browser: a link the author wrote, a
 * `button.zoom-btn` that `zoomable.ts` put on a figure, the gutter, its
 * controls, and plain prose. The `<mark>` is drawn by the real annotator from a
 * real `hitMarks` entry rather than injected, so the element under the click is
 * the one a search would have produced.
 *
 * docs/plans/260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Both mocks as in tests/paragraph-labels-withheld.test.tsx, and for the same
   reasons: the render probe patches timers and fetch globally, and Floating UI
   does real geometry that jsdom has not got. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import type { Mark } from "../src/web/annotate.js";
import { fitView } from "../src/web/layout.js";
import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import type { Article, BlockId } from "../src/types.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";

const DIR = "tests/fixtures/data-root/data/noema-mythology-of-conscious-ai";

/** Anything in the prose that is a plausible place for a finger to land on text. */
const PROSE_TEXT = "p, h1, h2, h3, li, blockquote";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

/* jsdom has `<dialog>` but not `showModal`, and the enlarge button below is a
   *real* one: the delegated handler on `tbody` opens `Lightbox`, whose mount
   effect calls it. Stubbed rather than avoided, because the point of that case
   is a click on the element the reader actually presses. Both halves, so the
   unmount in `afterEach` has a `close` to call. */
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.open = false;
};

let host: HTMLDivElement;
let root: Root;

/**
 * jsdom implements an anchor's activation behaviour and has no navigation to
 * run it with, so a real click on the article's own `https://` link logs a
 * "Not implemented" error from deep inside the runner. Cancelling it *at
 * document level* keeps that noise out without changing anything under test:
 * React dispatches every handler in this tree from the root container, which is
 * inside `<body>`, so this listener runs strictly after all of them.
 */
const cancelNavigation = (e: Event) => e.preventDefault();

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  document.addEventListener("click", cancelNavigation);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.removeEventListener("click", cancelNavigation);
  host.remove();
  vi.unstubAllGlobals();
});

type Loaded = Awaited<ReturnType<typeof readArticleFromDir>>;

/** The fixture as an `Article` — see tests/paragraph-labels-withheld.test.tsx for `assets`. */
function articleFrom(loaded: Loaded): Article {
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  return {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
  };
}

/**
 * `TableView` in reading mode with the prose column on, which is the layout
 * every reader is in and the only one with a `td.text` to tap.
 *
 * `onChatAbout` and `onHelp` are passed because the gutter draws those buttons
 * only for a reader who has them, and the gutter case below wants a control
 * inside it to click.
 */
function propsFor(article: Article, hitMarks?: ReadonlyMap<BlockId, readonly Mark[]>) {
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: null,
  });
  return {
    article,
    geometry,
    columns: fit.columns,
    layout: fit,
    showText: true,
    onJump: vi.fn(),
    comments: [],
    openComment: null,
    onSelect: vi.fn(),
    onOpenComment: vi.fn(),
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    onOpenChat: vi.fn(),
    onChatAbout: vi.fn(),
    onHelp: vi.fn(),
    hitMarks,
    sections: [],
    layoutKey: "test",
    linkBase: "",
    slug: "noema-mythology-of-conscious-ai",
  };
}

/**
 * Blocks whose markup has nothing in it a tap already means something else by —
 * read off the source html rather than off the DOM, so the ids are fixed before
 * anything renders and a `hitMarks` entry can be aimed at one of them.
 */
function plainBlocks(loaded: Loaded) {
  return loaded.blocks.filter(
    (b) => !/<(a |img|figure|table|pre|svg|button)/.test(b.html) && (b.text ?? "").length > 12,
  );
}

async function draw(props: ReturnType<typeof propsFor>): Promise<void> {
  await act(async () => {
    root.render(createElement(TableView, props));
  });
}

/** The row for a block, by the id the `<tr>` carries. */
function rowOf(id: string): Element {
  const tr = host.querySelector(`tbody tr[data-block="${id}"]`);
  if (!tr) throw new Error(`no row rendered for ${id}`);
  return tr;
}

/** Every selected row, in document order — the class the touch reveal keys on. */
const selectedRows = (): string[] =>
  Array.from(host.querySelectorAll("tbody tr.row-active")).map(
    (tr) => tr.getAttribute("data-block") ?? "?",
  );

/** A real click, dispatched on a real node — `detail: 1` unless a case says otherwise. */
async function tap(el: Element, detail = 1): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  });
}

/**
 * The compatibility `mouseenter` a touch tap fires **before** its click.
 *
 * `mouseenter` does not bubble, and React attaches it to the root container and
 * synthesises the enter/leave pair from `mouseover`, so this dispatches the
 * bubbling event React actually listens for.
 */
async function compatibilityHover(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
  });
}

/** Answer `(hover: hover)` with `matches`, and every other query with `false`. */
function pretendHover(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("hover: hover") ? matches : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

/** The first element inside a row's prose matching `selector`, or a loud failure. */
function inProse(id: string, selector: string): Element {
  const el = rowOf(id).querySelector(`td.text .prose ${selector}`);
  if (!el) throw new Error(`the fixture drew no ${selector} in ${id} — the case would be vacuous`);
  return el;
}

describe("tapping a paragraph selects the block", () => {
  it("selects the row when the tap lands on plain prose", async () => {
    /* The feature itself. Without it the gutter is unreachable on a touch
       device altogether: nothing else sets `hoveredRow`, because a finger fires
       no `mouseenter`. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const first = plainBlocks(loaded)[0];
    if (!first) throw new Error("the fixture has no plain-prose block");

    expect(selectedRows(), "a row was selected before any tap").toEqual([]);
    await tap(inProse(first.id, PROSE_TEXT));
    expect(selectedRows()).toEqual([first.id]);
  });

  it("moves the selection when a second paragraph is tapped", async () => {
    /* One row at a time. If the handler only ever *added* the class, a reader
       working down the page would end with a column of gutters beside the whole
       article — which is the noise the touch reveal exists to remove. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const [first, second] = plainBlocks(loaded);
    if (!first || !second) throw new Error("the fixture has fewer than two plain-prose blocks");

    await tap(inProse(first.id, PROSE_TEXT));
    expect(selectedRows(), "the first tap did not select").toEqual([first.id]);
    await tap(inProse(second.id, PROSE_TEXT));
    expect(selectedRows()).toEqual([second.id]);
  });
});

describe("a tap that already means something else does not select the block", () => {
  it("leaves the selection alone when the tap follows a link", async () => {
    /* Following it is the point of tapping it. Selecting on the way out would
       paint the wash and shift `activeChain` onto the paragraph the reader is
       leaving, and on a touch device would reveal a gutter beside an article
       they have already navigated away from. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const linked = loaded.blocks.find((b) => /<a [^>]*href=/.test(b.html));
    if (!linked) throw new Error("the fixture has no block containing a link");

    await tap(inProse(linked.id, "a[href]"));
    expect(selectedRows()).toEqual([]);
  });

  it("leaves the selection alone when the tap lands on a mark", async () => {
    /* One rule for every `<mark>` the annotator draws — a comment, a chat
       anchor, a search hit, a glossary term. `mouseup` has already acted on
       these, and a glossary term's click never arrives at all because
       useHoverCard cancels it at document capture, so without the entry the
       answer would differ by mark type and by which handler got there first.
       This is the case the `<tr>`-level version could not express. */
    const loaded = await readArticleFromDir(DIR);
    const marked = plainBlocks(loaded)[2];
    if (!marked) throw new Error("the fixture has too few plain-prose blocks");
    /* A real search hit, drawn by the real annotator: the element under the
       click is the markup a search would have produced, not a stand-in. */
    const hit: Mark = { id: "search-1", start: 0, end: 8 };
    await draw(propsFor(articleFrom(loaded), new Map([[marked.id, [hit]]])));

    await tap(inProse(marked.id, "mark"));
    expect(selectedRows()).toEqual([]);
  });

  it("leaves the selection alone when the tap is a figure's enlarge button", async () => {
    /* `button.zoom-btn`, put there by zoomable.ts, is the only `<button>` that
       can be inside the prose — the sanitiser forbids the article its own. The
       cell's handler runs *before* the delegated one on `tbody` that opens the
       lightbox, so without the `button` entry a tap on ⤢ would select the row
       on the way past and the overlay would open over a freshly-painted wash. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    /* Found in the rendered table rather than guessed from the source html:
       `addZoomHandles` decides which figures get a handle (`outermost`), and a
       block that merely contains `<figure>` need not have one. */
    const zoom = host.querySelector("tbody td.text .prose button.zoom-btn");
    if (!zoom) throw new Error("the fixture drew no zoom-btn — the case would be vacuous");

    await tap(zoom);
    expect(selectedRows()).toEqual([]);
  });

  it("leaves the selection alone when the tap lands on the open panel", async () => {
    /* **Which half of this can fail, and why the other half cannot, is the
       whole point of the case.**

       A *closed* gutter is `pointer-events: none` (gutter.css § the gutter, and
       the comment there records the Playwright failure that bought it), so a tap
       on its blank strip never has `.blk-gutter` as its target at all: it falls
       through to the `<td>` and selects the row, exactly as hovering blank
       gutter reveals the icons on a pointer. That is deliberate and is not
       asserted here, because jsdom does not implement `pointer-events` and a
       test of it would be a test of nothing.

       The **open** panel is the reachable case: it takes `pointer-events: auto`
       back on purpose, because it is opaque and you should not be able to press
       the paragraph behind it. So its padding, border and shadow are a real
       hit-test surface with no handler of its own, and only the selector list
       stops a tap there from selecting.

       The controls are asserted alongside, and they are defended twice — every
       gutter button and the permalink call `stopPropagation`, so that half stays
       green with the `.blk-gutter` entry removed. That is not a hole; it is the
       propagation dependence the list exists not to rely on, and the panel is
       what pins the rule if a future control forgets to stop the event. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const block = plainBlocks(loaded)[0];
    if (!block) throw new Error("the fixture has no plain-prose block");

    const gutter = rowOf(block.id).querySelector("td.text .blk-gutter");
    if (!gutter) throw new Error("no gutter drawn — the case would be vacuous");

    /* Opening it is also the first assertion: `.blk-more` is a `<button>`, so
       the list catches it even before `stopPropagation` does. */
    const more = gutter.querySelector(".blk-more");
    if (!more) throw new Error("the gutter drew no `…` — the case would be vacuous");
    await tap(more);
    expect(gutter.hasAttribute("data-open"), "the `…` did not open the panel").toBe(true);
    expect(selectedRows(), "the `…` selected its row").toEqual([]);

    await tap(gutter);
    expect(selectedRows(), "the open panel selected the row behind it").toEqual([]);

    const control = gutter.querySelector(".blk-help, .block-chat, .blk-permalink");
    if (!control) throw new Error("the gutter drew no control");
    await tap(control);
    expect(selectedRows(), "a gutter control selected its row").toEqual([]);
  });

  it("leaves the selection alone when the tap is the picture itself", async () => {
    /* **The other zoom surface.** The delegated handler on `<tbody>` says "a
       picture is its own button" and opens the lightbox for a bare `<img>` or
       `<svg>` inside a `.zoomable` wrapper — no ⤢ involved. Excluding only the
       button would select the row on the way past and open the overlay over a
       freshly-painted wash. The predicate uses that handler's own selector
       verbatim so the two cannot drift. GPT Sol, 2026-09-08. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const picture = host.querySelector("tbody td.text .prose .zoomable :is(img, svg)");
    if (!picture) throw new Error("the fixture drew no zoomable picture — the case would be vacuous");

    await tap(picture);
    expect(selectedRows()).toEqual([]);
  });

  it("ignores the compatibility mouse events a tap fires, where there is no hover", async () => {
    /* **The finding that made the whole exclusion list ornamental.** A touch tap
       fires the compatibility mouse events, `mouseenter` among them, and the
       row's own `onMouseEnter` sets `hoveredRow` without consulting any of this.
       It is measured rather than feared: on the commit before this feature
       existed, a real Chromium tap set and held `row-active`, and that handler
       was the only writer there was.

       So both hover writers now ask `(hover: hover)`, and this is the assertion
       that they do. Without it the list below is decoration: tapping a link, a
       mark or a picture would still select the row through the other door.
       GPT Sol, 2026-09-08. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const [first, second] = plainBlocks(loaded);
    if (!first || !second) throw new Error("the fixture has fewer than two plain-prose blocks");

    pretendHover(false);
    await compatibilityHover(inProse(second.id, PROSE_TEXT));
    expect(selectedRows(), "a compatibility mouse event selected a row on a touch device").toEqual([]);

    /* And the pointer half is untouched, which is the other thing that must
       stay true: on a device that really hovers, moving over a row still
       selects it and nothing about this change is visible. */
    pretendHover(true);
    await compatibilityHover(inProse(second.id, PROSE_TEXT));
    expect(selectedRows(), "hovering a row on a pointer device stopped selecting it").toEqual([
      second.id,
    ]);
  });

  it("ignores a click no pointer produced", async () => {
    /* `detail === 0` is a keyboard or assistive-technology activation, which
       fires `click` with no preceding `mouseenter`. Without the guard, tabbing
       to a link in the prose and pressing Enter would move the selected row,
       paint the wash and shift `activeChain` on input that never touched the
       row — and a keyboard reader has `:focus-visible` on the gutter and never
       needed this. GPT Sol, 2026-09-07. */
    const loaded = await readArticleFromDir(DIR);
    await draw(propsFor(articleFrom(loaded)));
    const first = plainBlocks(loaded)[0];
    if (!first) throw new Error("the fixture has no plain-prose block");

    await tap(inProse(first.id, PROSE_TEXT), 0);
    expect(selectedRows()).toEqual([]);
  });
});
