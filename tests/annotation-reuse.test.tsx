// @vitest-environment jsdom
/**
 * **A gesture that changes one block must not re-annotate the article.**
 *
 * The companion to tests/prose-not-rebuilt.test.tsx, one layer earlier. That
 * file proves the prose *DOM* is not rewritten; this one proves the prose is
 * not *computed* again in the first place, which the measurement in
 * docs/plans/260905i-measure-annotation-computation-before-optimising-it.md
 * found it was. On a 551-block article, in a production build, one glossary
 * press ran `addZoomHandles` **551 times** and `annotateHtml` **96 times** to
 * change the marks of one block — ~30ms of attributable annotation against an
 * 8ms budget.
 *
 * ## What is asserted, and what makes a zero mean anything
 *
 * The real `TableView`, a real committed article, and two instruments: the call
 * counters in src/web/annotation-cost.ts, and the same `MutationObserver` over
 * `.prose` the sibling file uses. Every zero-work assertion is paired, in the
 * same file, with a **changed-input control** that must move the very counters
 * being trusted — a new comment, a changed search hit, a changed glossary
 * entry, and a block whose html changed under a stable id. And every test
 * asserts the rendered row count equals the block count, because a component
 * that threw also computes nothing and mutates nothing, and would otherwise
 * read as a pass. docs/reusable/silent-success.md.
 *
 * The counters are read as **calls**, never as milliseconds: the plan is
 * emphatic that a scalar microbenchmark decides nothing, and these are
 * regression pins rather than measurements.
 *
 * ## Why the counts here are exact rather than "fewer than before"
 *
 * `annotateHtml` runs once per *marked* block that must be rebuilt and
 * `addZoomHandles` once per rebuilt block, so "the reader selected a different
 * comment" has an exact right answer: two — the block losing the ring and the
 * block gaining it. An inequality would pass on a version that rebuilt half the
 * article, which is most of the way to the bug.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* The other probe, mocked rather than started — starting it patches timers,
   rAF and fetch globally. Copied from tests/prose-not-rebuilt.test.tsx. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { renderedText, type Mark, type TermSelection } from "../src/web/annotate.js";
import {
  annotationCost,
  resetAnnotationCost,
  startAnnotationCost,
  stopAnnotationCost,
} from "../src/web/annotation-cost.js";
import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, Block, BlockId, Comment } from "../src/types.js";

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

/** What the directory loader returns, which is not quite `Article`. */
type Loaded = Awaited<ReturnType<typeof readArticleFromDir>>;

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  stopAnnotationCost();
  resetAnnotationCost();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  stopAnnotationCost();
  resetAnnotationCost();
});

/** As tests/prose-not-rebuilt.test.tsx § `propsFor`. */
function propsFor(loaded: Loaded, over: Record<string, unknown> = {}) {
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
  };
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
    comments: [],
    openComment: null,
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    sections: [],
    layoutKey: "test",
    linkBase: "/read/x",
    ...over,
  };
}

const draw = (loaded: Loaded, over: Record<string, unknown> = {}) =>
  createElement(TableView, propsFor(loaded, over) as never);

/**
 * The guard that makes every zero below mean something: a component that threw,
 * or rendered no rows, computes nothing and mutates nothing.
 */
function expectRows(loaded: Loaded): void {
  expect(
    host.querySelectorAll(".prose").length,
    "no prose rendered — every count in this test would be meaningless",
  ).toBe(loaded.blocks.length);
}

/** Mutations inside any `.prose`, as tests/prose-not-rebuilt.test.tsx counts them. */
function watchProse(): { count: () => number; stop: () => void; touched: () => Set<string> } {
  const blocks = new Set<string>();
  let n = 0;
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      const target = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
      const prose = target?.closest(".prose");
      if (!prose) continue;
      n++;
      const row = prose.closest("tr[data-block]")?.getAttribute("data-block");
      if (row) blocks.add(row);
    }
  });
  obs.observe(host, { childList: true, subtree: true, characterData: true, attributes: true });
  return { count: () => n, stop: () => obs.disconnect(), touched: () => blocks };
}

/** The four leaf counters, as calls. `ms` is deliberately never read here. */
function calls(): Record<"renderedText" | "resolveMark" | "annotateHtml" | "addZoomHandles", number> {
  const cost = annotationCost();
  return {
    renderedText: cost.renderedText.n,
    resolveMark: cost.resolveMark.n,
    annotateHtml: cost.annotateHtml.n,
    addZoomHandles: cost.addZoomHandles.n,
  };
}

/**
 * One prop transition, with both instruments running across it and nothing
 * else. The probe is started *after* the fixtures are built, so the
 * `renderedText` calls that made the anchors are never charged to the render.
 */
async function transition(render: () => void): Promise<{
  work: ReturnType<typeof calls>;
  mutations: number;
  touched: string[];
}> {
  resetAnnotationCost();
  startAnnotationCost();
  const watch = watchProse();
  await act(async () => {
    render();
  });
  watch.stop();
  /* **Read before stopping.** `stopAnnotationCost()` zeroes the counters —
     annotation-cost.ts § `setAnnotationCostMode`, so that a snapshot's numbers
     always belong to the mode it reports — and reading after it returns six
     zeroes, which is the shape of every assertion in this file passing for the
     wrong reason. */
  const work = calls();
  stopAnnotationCost();
  return { work, mutations: watch.count(), touched: [...watch.touched()].sort() };
}

/** Ordinary prose blocks with enough words for a mark to land inside them. */
function bodyBlocks(loaded: Loaded): Block[] {
  const out = loaded.blocks.filter((b) => b.gistable && renderedText(b.html).length > 120);
  if (out.length < 4) throw new Error(`${DIR} has too little prose for this test`);
  return out;
}

/** A quote that really is in this block's rendered text — the offset space marks speak. */
function anchorOn(block: Block, from: number, len = 20): { quote: string; start: number } {
  const quote = renderedText(block.html).slice(from, from + len);
  if (quote.trim().length < 8) throw new Error(`no usable quote in ${block.id}`);
  return { quote, start: from };
}

function commentOn(id: string, block: Block, from = 10): Comment {
  return {
    id,
    blockId: block.id,
    ...anchorOn(block, from),
    createdAt: "2026-09-06T00:00:00.000Z",
    status: "none",
  };
}

/** A word this block actually contains, long enough not to match everywhere. */
function wordIn(block: Block): string {
  const word = renderedText(block.html)
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .find((w) => w.length >= 6);
  if (!word) throw new Error(`no usable glossary word in ${block.id}`);
  return word;
}

/** The row's prose, for the "no stale output" assertions. */
const proseText = (id: BlockId): string =>
  host.querySelector(`tr[data-block="${id}"] .prose`)?.textContent ?? "";

/**
 * Which ids are drawn somewhere in the prose, read off `data-comment` /
 * `data-term`.
 *
 * **Ids rather than `<mark>` elements**, because the two do not correspond: a
 * quote that crosses an `<a>` or an `<em>` is cut into one `<mark>` per text
 * node, so counting elements counts the article's inline markup as much as the
 * reader's comments. annotate.ts § `annotateHtml`.
 */
function markedIds(attr: "data-comment" | "data-term"): string[] {
  const ids = new Set<string>();
  for (const el of host.querySelectorAll(`[${attr}]`)) {
    for (const id of (el.getAttribute(attr) ?? "").split(" ")) if (id) ids.add(id);
  }
  return [...ids].sort();
}

/** The blocks carrying at least one mark matching `selector`. */
function rowsWith(selector: string): string[] {
  const rows = new Set<string>();
  for (const el of host.querySelectorAll(`tr[data-block] ${selector}`)) {
    const id = el.closest("tr[data-block]")?.getAttribute("data-block");
    if (id) rows.add(id);
  }
  return [...rows].sort();
}

/** The same block with a visibly different html under the same stable id. */
function edited(block: Block, marker: string): Block {
  const html = block.html.replace(/<\/([a-zA-Z0-9]+)>\s*$/, ` ${marker}</$1>`);
  if (html === block.html) throw new Error(`could not edit ${block.id}'s html`);
  return { ...block, html, text: `${block.text} ${marker}` };
}

const withBlocks = (loaded: Loaded, blocks: Block[]): Loaded => ({ ...loaded, blocks });

/* ------------------------------------------------------- the zero cases -- */

it("a body-only streamed delta costs nothing at all", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second] = bodyBlocks(loaded);
  if (!first || !second) throw new Error("fixture too small");
  /* The shape useComments.ts § the `delta` branch produces: a new array of new
     objects on every streamed token, with `blockId`, `quote` and `start`
     untouched and only the answer growing. */
  const comments: Comment[] = [
    { ...commentOn("c1", first), status: "pending", answer: "The" },
    commentOn("c2", second),
  ];
  await act(async () => {
    root.render(draw(loaded, { comments, openComment: "c1" }));
  });
  expectRows(loaded);
  expect(
    host.querySelector("mark.cmt[data-cmt-open]"),
    "the open comment never resolved, so this test would prove nothing",
  ).not.toBeNull();

  const grown = comments.map((c) =>
    c.id === "c1" ? { ...c, answer: "The model kept trying" } : { ...c },
  );
  const seen = await transition(() => {
    root.render(draw(loaded, { comments: grown, openComment: "c1" }));
  });

  expect(seen.work, "a delta that moved no anchor did annotation work").toEqual({
    renderedText: 0,
    resolveMark: 0,
    annotateHtml: 0,
    addZoomHandles: 0,
  });
  expect(seen.mutations, "a delta that moved no anchor rewrote prose").toBe(0);
  expectRows(loaded);
});

it("selecting a different comment re-annotates two blocks, not the article", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second] = bodyBlocks(loaded);
  if (!first || !second) throw new Error("fixture too small");
  const comments = [commentOn("c1", first), commentOn("c2", second)];
  await act(async () => {
    root.render(draw(loaded, { comments, openComment: "c1" }));
  });
  expectRows(loaded);
  expect(markedIds("data-comment"), "both comments must resolve, or this proves nothing").toEqual([
    "c1",
    "c2",
  ]);

  const seen = await transition(() => {
    root.render(draw(loaded, { comments, openComment: "c2" }));
  });

  expect(seen.work.annotateHtml, "only the two comment blocks may be re-annotated").toBe(2);
  expect(seen.work.addZoomHandles, "only the two comment blocks may be rebuilt").toBe(2);
  expect(seen.work.resolveMark, "no anchor moved, so nothing may be re-resolved").toBe(0);
  expect(seen.work.renderedText, "no anchor moved, so no block may be re-parsed").toBe(0);
  expect(seen.touched, "prose outside the two comment blocks was rewritten").toEqual(
    [first.id, second.id].sort(),
  );
  /* The ring moved, which is the whole gesture. */
  expect(
    host.querySelector(`tr[data-block="${second.id}"] mark.cmt[data-cmt-open]`),
  ).not.toBeNull();
  expect(host.querySelector(`tr[data-block="${first.id}"] mark.cmt[data-cmt-open]`)).toBeNull();
  expectRows(loaded);
});

it("pressing a different glossary term re-annotates two blocks, not the article", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second] = bodyBlocks(loaded);
  if (!first || !second) throw new Error("fixture too small");
  const terms: TermSelection[] = [
    { id: "t1", forms: [wordIn(first)], blocks: [first.id] },
    { id: "t2", forms: [wordIn(second)], blocks: [second.id] },
  ];
  await act(async () => {
    root.render(draw(loaded, { terms, openTerm: "t1" }));
  });
  expectRows(loaded);
  expect(markedIds("data-term"), "both terms must underline, or this proves nothing").toEqual([
    "t1",
    "t2",
  ]);

  const seen = await transition(() => {
    root.render(draw(loaded, { terms, openTerm: "t2" }));
  });

  expect(seen.work.annotateHtml, "only the two term blocks may be re-annotated").toBe(2);
  expect(seen.work.addZoomHandles, "only the two term blocks may be rebuilt").toBe(2);
  expect(seen.touched, "prose outside the two term blocks was rewritten").toEqual(
    [first.id, second.id].sort(),
  );
  expect(
    host.querySelector(`tr[data-block="${second.id}"] mark.term[data-term-open]`),
  ).not.toBeNull();
  expect(host.querySelector(`tr[data-block="${first.id}"] mark.term[data-term-open]`)).toBeNull();
  expectRows(loaded);
});

/* ------------------------------------------------- the changed controls --
   Without these the zeroes above are satisfied by a component that stopped
   annotating anything at all. */

it("a genuinely new comment updates its block, and only its block", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second, third] = bodyBlocks(loaded);
  if (!first || !second || !third) throw new Error("fixture too small");
  const comments = [commentOn("c1", first), commentOn("c2", second)];
  await act(async () => {
    root.render(draw(loaded, { comments }));
  });
  expectRows(loaded);

  const added = [...comments, commentOn("c3", third)];
  const seen = await transition(() => {
    root.render(draw(loaded, { comments: added }));
  });

  expect(seen.work.resolveMark, "a new anchor must be resolved, with the others").toBe(3);
  expect(seen.touched, "only the block that gained a comment may be rewritten").toEqual([third.id]);
  expect(markedIds("data-comment"), "the new comment never drew a mark").toEqual([
    "c1",
    "c2",
    "c3",
  ]);
  expectRows(loaded);
});

it("a changed search hit updates its block, and only its block", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second] = bodyBlocks(loaded);
  if (!first || !second) throw new Error("fixture too small");
  const before = new Map<BlockId, Mark[]>([
    [first.id, [{ id: "h1", start: 0, end: 6, kind: "hit", hue: "", dir: "for", slot: 0 }] as Mark[]],
  ]);
  await act(async () => {
    root.render(draw(loaded, { hitMarks: before }));
  });
  expectRows(loaded);
  expect(rowsWith("mark.hit"), "the first hit never drew").toEqual([first.id]);

  const after = new Map<BlockId, Mark[]>([
    [first.id, [{ id: "h1", start: 0, end: 6, kind: "hit", hue: "", dir: "for", slot: 0 }] as Mark[]],
    [second.id, [{ id: "h2", start: 0, end: 6, kind: "hit", hue: "", dir: "for", slot: 0 }] as Mark[]],
  ]);
  const seen = await transition(() => {
    root.render(draw(loaded, { hitMarks: after }));
  });

  expect(seen.touched, "only the block that gained a hit may be rewritten").toEqual([second.id]);
  expect(rowsWith("mark.hit"), "the second hit never drew").toEqual([first.id, second.id].sort());
  expectRows(loaded);
});

it("a block whose html changed under the same id is rebuilt", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first] = bodyBlocks(loaded);
  if (!first) throw new Error("fixture too small");
  await act(async () => {
    root.render(draw(loaded));
  });
  expectRows(loaded);
  expect(proseText(first.id)).not.toContain("REEXTRACTED");

  /* Stable identity is not immutable content: a re-extraction can change a
     block's html under the same id, and a cache that keys on the id alone
     serves the old paragraph for ever. */
  const next = withBlocks(
    loaded,
    loaded.blocks.map((b) => (b.id === first.id ? edited(b, "REEXTRACTED") : b)),
  );
  const seen = await transition(() => {
    root.render(draw(next));
  });

  expect(proseText(first.id), "the re-extracted block still shows its old html").toContain(
    "REEXTRACTED",
  );
  expect(seen.touched, "only the re-extracted block may be rewritten").toEqual([first.id]);
  expectRows(next);
});

it("a changed glossary entry moves the underline and nothing else", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first, second] = bodyBlocks(loaded);
  if (!first || !second) throw new Error("fixture too small");
  /* A comment over the very words the term underlines, so the overlap rule is
     exercised by the same transition. */
  const word = wordIn(first);
  const at = renderedText(first.html).indexOf(word);
  const comments: Comment[] = [
    {
      id: "c1",
      blockId: first.id,
      quote: renderedText(first.html).slice(Math.max(0, at - 4), at + word.length + 4),
      start: Math.max(0, at - 4),
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "none",
    },
  ];
  const before: TermSelection[] = [{ id: "t1", forms: [word], blocks: [first.id] }];
  await act(async () => {
    root.render(draw(loaded, { comments, terms: before }));
  });
  expectRows(loaded);
  expect(
    host.querySelector(`tr[data-block="${first.id}"] mark.cmt.term`),
    "the comment and the term must share one mark",
  ).not.toBeNull();

  /* New forms *and* new occurrence blocks, while `article.blocks` is untouched
     — the shape a glossary edit really has. */
  const after: TermSelection[] = [{ id: "t1", forms: [wordIn(second)], blocks: [second.id] }];
  const seen = await transition(() => {
    root.render(draw(loaded, { comments, terms: after }));
  });

  expect(
    host.querySelector(`tr[data-block="${first.id}"] mark.term`),
    "the old underline is still drawn",
  ).toBeNull();
  expect(
    host.querySelector(`tr[data-block="${first.id}"] mark.cmt`),
    "the comment lost its mark when the term moved",
  ).not.toBeNull();
  expect(
    host.querySelector(`tr[data-block="${second.id}"] mark.term`),
    "the new underline was never drawn",
  ).not.toBeNull();
  expect(seen.touched, "prose outside the two term blocks was rewritten").toEqual(
    [first.id, second.id].sort(),
  );
  expectRows(loaded);
});

it("overlapping marks keep one shared <mark>, before and after a reuse", async () => {
  const loaded = await readArticleFromDir(DIR);
  const [first] = bodyBlocks(loaded);
  if (!first) throw new Error("fixture too small");
  const word = wordIn(first);
  const at = renderedText(first.html).indexOf(word);
  const comments: Comment[] = [
    {
      id: "c1",
      blockId: first.id,
      quote: renderedText(first.html).slice(Math.max(0, at - 4), at + word.length + 4),
      start: Math.max(0, at - 4),
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "none",
    },
  ];
  const terms: TermSelection[] = [{ id: "t1", forms: [word], blocks: [first.id] }];
  await act(async () => {
    root.render(draw(loaded, { comments, terms }));
  });
  expectRows(loaded);
  const shared = () => host.querySelector(`tr[data-block="${first.id}"] mark.cmt.term`);
  expect(shared(), "a comment over a term must be one mark with both classes").not.toBeNull();
  expect(
    host.querySelector(`tr[data-block="${first.id}"] mark mark`),
    "marks nested instead of sharing",
  ).toBeNull();

  /* A render the prose does not depend on: everything the block was built from
     is identical, so the reuse path is the one under test. */
  const seen = await transition(() => {
    root.render(draw(loaded, { comments, terms, openChat: "anything" }));
  });
  expect(seen.mutations, "an unrelated prop rewrote the prose").toBe(0);
  expect(seen.work.annotateHtml, "an unrelated prop re-annotated a block").toBe(0);
  expect(shared(), "the shared mark was lost across a reuse").not.toBeNull();
  expect(
    host.querySelector(`tr[data-block="${first.id}"] mark mark`),
    "marks nested after a reuse",
  ).toBeNull();
  expectRows(loaded);
});

it("a removed block goes, and an article swap serves no stale prose", async () => {
  const loaded = await readArticleFromDir(DIR);
  const last = loaded.blocks[loaded.blocks.length - 1];
  if (!last) throw new Error("fixture too small");
  await act(async () => {
    root.render(draw(loaded));
  });
  expectRows(loaded);

  const fewer = withBlocks(
    loaded,
    loaded.blocks.filter((b) => b.id !== last.id),
  );
  await act(async () => {
    root.render(draw(fewer));
  });
  expectRows(fewer);
  expect(
    host.querySelector(`tr[data-block="${last.id}"]`),
    "the removed block still has a row",
  ).toBeNull();

  /* Every block re-extracted at once, ids unchanged — the shape a re-ingest
     has, and the one a cache keyed on `BlockId` alone serves stale for ever. */
  const swapped = withBlocks(
    loaded,
    loaded.blocks.map((b) => edited(b, "SECONDEDITION")),
  );
  await act(async () => {
    root.render(draw(swapped));
  });
  expectRows(swapped);
  for (const block of swapped.blocks) {
    expect(proseText(block.id), `${block.id} served its stale prose`).toContain("SECONDEDITION");
  }
});

/* ------------------------------------------ which occurrence, and overlap --
   The two mutations the Stage 2 review (docs/plans/260905i-stage2-review-sol.md
   § F20, § F21) could make to the implementation with all nine tests above
   still green. Both are about the *key*, not about the count: a cache that is
   fast and serves the wrong block's html is worse than no cache. */

/**
 * The same block with prose we control entirely, under its stable id.
 *
 * The fixture's own paragraphs say what they say; these two cases need a
 * repeated phrase, and one word that three different sources can all cover.
 * Fabricating the html rather than hunting for a paragraph that happens to
 * suit keeps the offsets exact and the failure legible.
 */
function retext(block: Block, text: string): Block {
  return { ...block, html: `<p>${text}</p>`, text };
}

/**
 * Where a mark begins in its block's rendered text — i.e. **which occurrence
 * of a repeated quote it is drawn on.**
 *
 * The two occurrences are the same characters, so the mark's text says nothing
 * about which one it is and only the offset can. Counted over the row's text
 * nodes because that is the offset space marks speak (annotate.ts § Why the
 * offsets are DOM offsets).
 */
function markStart(id: BlockId, selector: string): number | null {
  const prose = host.querySelector(`tr[data-block="${id}"] .prose`);
  if (!prose) return null;
  const mark = prose.querySelector(selector);
  if (!mark) return null;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (mark.contains(node)) return offset;
    offset += node.nodeValue?.length ?? 0;
  }
  return null;
}

/** A phrase this fabricated paragraph says twice, and the paragraph. */
const TWICE = "the very same words";
const REPEATED =
  `An opening clause, and then ${TWICE}, said once here; a second clause, ` +
  `long enough that this reads as real prose, and then ${TWICE} again to close.`;
const FIRST_AT = REPEATED.indexOf(TWICE);
const SECOND_AT = REPEATED.indexOf(TWICE, FIRST_AT + 1);

/** The fixture with one block replaced by `text`, and that block. */
async function withProse(text: string): Promise<{ loaded: Loaded; block: Block }> {
  const loaded = await readArticleFromDir(DIR);
  const [target] = bodyBlocks(loaded);
  if (!target) throw new Error("fixture too small");
  const block = retext(target, text);
  return { loaded: withBlocks(loaded, loaded.blocks.map((b) => (b.id === block.id ? block : b))), block };
}

it("a comment moved to the other occurrence of the same quote moves its underline", async () => {
  const { loaded, block } = await withProse(REPEATED);
  expect(SECOND_AT, "the fabricated paragraph must say the phrase twice").toBeGreaterThan(FIRST_AT);
  /* Same id, same blockId, same quote, new objects and a new array — every
     input to `anchorKey` except `start` is unchanged, which is exactly the
     shape the reuse key has to notice. */
  const at = (start: number): Comment[] => [
    {
      id: "c1",
      blockId: block.id,
      quote: TWICE,
      start,
      createdAt: "2026-09-06T00:00:00.000Z",
      status: "none",
    },
  ];

  await act(async () => {
    root.render(draw(loaded, { comments: at(SECOND_AT) }));
  });
  expectRows(loaded);
  expect(markStart(block.id, "mark.cmt"), "the comment resolved to the wrong occurrence").toBe(
    SECOND_AT,
  );

  const seen = await transition(() => {
    root.render(draw(loaded, { comments: at(FIRST_AT) }));
  });

  expect(
    markStart(block.id, "mark.cmt"),
    "the underline stayed on the occurrence the comment left",
  ).toBe(FIRST_AT);
  expect(seen.touched, "only the comment's block may be rewritten").toEqual([block.id]);
  expectRows(loaded);
});

it("an anchored chat moved to the other occurrence moves its underline too", async () => {
  const { loaded, block } = await withProse(REPEATED);
  /* The `AnchoredThread` shape useChatAnchors.ts § `anchored` produces, with a
     quote-and-start anchor — the only kind that draws a mark at all. */
  const at = (start: number) => [
    { id: "th1", title: "A conversation", anchor: { blockId: block.id, quote: TWICE, start }, turns: 2 },
  ];

  await act(async () => {
    root.render(draw(loaded, { chats: at(SECOND_AT) }));
  });
  expectRows(loaded);
  expect(markStart(block.id, "mark.chat"), "the chat resolved to the wrong occurrence").toBe(
    SECOND_AT,
  );

  const seen = await transition(() => {
    root.render(draw(loaded, { chats: at(FIRST_AT) }));
  });

  expect(
    markStart(block.id, "mark.chat"),
    "the underline stayed on the occurrence the chat left",
  ).toBe(FIRST_AT);
  expect(seen.touched, "only the chat's block may be rewritten").toEqual([block.id]);
  expectRows(loaded);
});

/* One word for a comment, a glossary term and a search hit to cover at once. */
const SHARED = "thermostat";
const THREEWAY =
  `A paragraph of ordinary prose, in which the word ${SHARED} sits in the middle, ` +
  `with enough said after it that the block looks like the real thing.`;
const SHARED_AT = THREEWAY.indexOf(SHARED);

/** The comment that covers the shared word and a little either side. */
const threeWayComment = (id: BlockId): Comment[] => [
  {
    id: "c1",
    blockId: id,
    quote: THREEWAY.slice(SHARED_AT - 9, SHARED_AT + SHARED.length + 5),
    start: SHARED_AT - 9,
    createdAt: "2026-09-06T00:00:00.000Z",
    status: "none",
  },
];

/** A search hit over exactly the shared word, as `hitMarks` would hand it over. */
const threeWayHits = (id: BlockId) =>
  new Map<BlockId, Mark[]>([
    [
      id,
      [
        {
          id: "h1",
          start: SHARED_AT,
          end: SHARED_AT + SHARED.length,
          kind: "hit",
          hue: "",
          dir: "for",
          slot: 0,
        },
      ] as Mark[],
    ],
  ]);

/**
 * The one element that carries all three — the property under test.
 *
 * `annotateHtml` cuts every text node at every mark boundary in one pass, so
 * three sources over the same word produce **one** `<mark>` with three classes.
 * Applying any of them in a second pass would nest instead, "which reads as a
 * rendering bug" (annotate.ts § `annotateHtml`).
 */
const threeWayMarks = (id: BlockId): Element[] => [
  ...host.querySelectorAll(`tr[data-block="${id}"] mark.cmt.term.hit`),
];

/** Nesting, which is what a second annotation pass produces. */
const nested = (id: BlockId): Element | null =>
  host.querySelector(`tr[data-block="${id}"] mark mark`);

it("a comment, a term and a hit over one word share a single <mark>", async () => {
  const { loaded, block } = await withProse(THREEWAY);
  const terms: TermSelection[] = [{ id: "t1", forms: [SHARED], blocks: [block.id] }];
  await act(async () => {
    root.render(
      draw(loaded, {
        comments: threeWayComment(block.id),
        terms,
        hitMarks: threeWayHits(block.id),
      }),
    );
  });
  expectRows(loaded);

  const marks = threeWayMarks(block.id);
  expect(marks.length, "the three sources did not compose into one mark").toBe(1);
  const only = marks[0];
  expect(only?.textContent, "the shared mark covers the wrong words").toBe(SHARED);
  expect(only?.getAttribute("data-comment")).toBe("c1");
  expect(only?.getAttribute("data-term")).toBe("t1");
  expect(only?.getAttribute("data-hit")).toBe("h1");
  expect(nested(block.id), "marks nested instead of sharing").toBeNull();
});

it("a hit arriving last onto a reused block still joins the same <mark>", async () => {
  const { loaded, block } = await withProse(THREEWAY);
  const comments = threeWayComment(block.id);
  const terms: TermSelection[] = [{ id: "t1", forms: [SHARED], blocks: [block.id] }];
  await act(async () => {
    root.render(draw(loaded, { comments, terms }));
  });
  expectRows(loaded);
  expect(
    host.querySelector(`tr[data-block="${block.id}"] mark.cmt.term`),
    "the comment and the term must share one mark before the hit arrives",
  ).not.toBeNull();

  /* Through the reuse path first, so the hit lands on an entry that was passed
     through untouched rather than on one just built. That is the state the
     mutation in § F21 exploited: hits applied in their own pass are invisible
     to everything the first pass already decided. */
  const idle = await transition(() => {
    root.render(draw(loaded, { comments, terms, openChat: "anything" }));
  });
  expect(idle.work.annotateHtml, "the reuse path was not taken, so this proves nothing").toBe(0);

  const seen = await transition(() => {
    root.render(draw(loaded, { comments, terms, hitMarks: threeWayHits(block.id) }));
  });

  const marks = threeWayMarks(block.id);
  expect(marks.length, "the hit did not join the comment and the term in one mark").toBe(1);
  expect(marks[0]?.textContent, "the shared mark covers the wrong words").toBe(SHARED);
  expect(nested(block.id), "the hit nested inside the marks already there").toBeNull();
  expect(seen.touched, "only the block that gained a hit may be rewritten").toEqual([block.id]);
  expect(seen.work.annotateHtml, "the whole article was re-annotated to add one hit").toBe(1);
  expectRows(loaded);
});
