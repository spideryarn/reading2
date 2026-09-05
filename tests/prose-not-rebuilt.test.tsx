// @vitest-environment jsdom
/**
 * **A re-render must not rebuild the article's prose.**
 *
 * `TableView` re-renders about thirty times during one scroll — `?at=` is
 * rewritten as sections pass the reading line, which is a deliberate feature
 * (docs/project/url-state.md). What was *not* deliberate is what each of those
 * renders did: it destroyed and rebuilt the DOM of **every** paragraph in the
 * article, with byte-identical HTML.
 *
 * Measured on a 551-block article, 2026-09-03: **18,734** prose subtrees
 * rebuilt during one scroll, 34 × 551 exactly. It put layout and style
 * recalculation *above* script in a production profile, and fixing it took
 * main-thread CPU while scrolling from 77% of a core to 49%.
 *
 * ## Why it happened, and why it is so easy to reintroduce
 *
 * React decides a prop changed by identity, and for `dangerouslySetInnerHTML`
 * the value it compares is the `{ __html: … }` **wrapper**, not the string
 * inside it. A literal in the JSX is a new object every render, so the prop is
 * always "changed" — and React's `setProp` then runs `domElement.innerHTML =`
 * *unconditionally*, with no test against what is already in the element.
 *
 * So the obvious way to write this line is the slow way, exactly as it was for
 * the spine (tests/spine-scroll.test.ts). The memo that feeds it was already
 * careful; the string was never the problem. Nothing about the page *looks*
 * wrong when this regresses, and no other test would notice — which is the
 * whole argument for this file.
 *
 * ## What is asserted
 *
 * The real component, a real committed article, and a `MutationObserver` — the
 * same instrument that found the bug in the browser. A re-render provoked by a
 * prop the prose does not depend on must produce **zero** mutations inside
 * `.prose`. Then, so the test cannot pass by simply never rendering anything, a
 * change that genuinely alters one block's html must rebuild **that block and
 * no other**.
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* The probe, as in tests/spine-scroll.test.ts: mocked rather than started,
   because starting the real one patches timers, rAF and fetch globally. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, BlockId } from "../src/types.js";

/** What the directory loader returns, which is not quite `Article` — see `propsFor`. */
type LoadedArticle = Awaited<ReturnType<typeof readArticleFromDir>>;

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

/* jsdom has no `ResizeObserver`, and the gist columns' geometry hook builds one
   on mount. A stand-in that never fires is right here: this test is about what
   a *render* does to the prose, not about anything a resize provokes. */
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Everything `TableView` needs that this test does not care about.
 *
 * `readArticleFromDir` hands back the on-disk shape, which has no `assets`
 * manifest — a real third state meaning "ingested before that step existed",
 * and the reason `Article.assets` is a required key holding `| undefined`
 * (src/types.ts). Spelling it here is what makes the two types meet.
 */
function propsFor(loaded: LoadedArticle, over: Record<string, unknown> = {}) {
  /* `meta` is nullable off disk — an article with no `meta.json` is a real
     state — but the reading view is only ever handed one that has it. The
     fixture does; assert rather than paper over it, so a fixture that loses its
     meta fails here instead of somewhere confusing. */
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
  };
  const geometry = buildGeometry(article.tree, article.blocks);
  /* The gist columns are every column but the leaf, as App.tsx derives them. */
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
    /* The gist columns' live "which cell am I in" reads real geometry, which
       jsdom does not have. Empty is the honest value for a test that is about
       the prose column. */
    sections: [],
    layoutKey: "test",
    ...over,
  };
}

/** Mutations inside any `.prose`, which is what the browser census counted. */
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

it("re-rendering for an unrelated reason rebuilds no prose at all", async () => {
  const article = await readArticleFromDir(DIR);
  expect(article.blocks.length, "the fixture must have prose to rebuild").toBeGreaterThan(10);

  await act(async () => {
    root.render(createElement(TableView, propsFor(article) as never));
  });
  const drawn = host.querySelectorAll(".prose").length;
  /* The guard that makes a zero below mean something. A component that threw,
     or rendered no rows, also mutates nothing — and would read as a pass.
     docs/reusable/silent-success.md. */
  expect(drawn, "no prose rendered — a zero mutation count would be meaningless").toBe(
    article.blocks.length,
  );

  const watch = watchProse();
  /* `openChat` is the kind of thing a scroll changes: it re-renders the whole
     table and has nothing to do with any paragraph's html. */
  await act(async () => {
    root.render(createElement(TableView, propsFor(article, { openChat: "anything" }) as never));
  });
  watch.stop();

  expect(
    watch.count(),
    "a render that changes no block's html must not touch the prose DOM",
  ).toBe(0);
});

it("a block whose html really changes is rebuilt, and only that block", async () => {
  const article = await readArticleFromDir(DIR);
  /* An ordinary paragraph with enough words that a mark lands inside it. */
  const target = article.blocks.find((b) => b.gistable && b.text.length > 40);
  if (!target) throw new Error("fixture has no ordinary prose block to mark");

  await act(async () => {
    root.render(createElement(TableView, propsFor(article) as never));
  });

  /* A search hit on one block. This is the path that *should* rewrite html —
     if the memo over-cached, this assertion goes red and the feature is
     broken, which is the failure the zero above could otherwise hide. */
  const hitMarks = new Map<BlockId, { start: number; end: number; kind: string }[]>([
    [target.id, [{ start: 0, end: 4, kind: "hit" }]],
  ]);

  const watch = watchProse();
  await act(async () => {
    root.render(createElement(TableView, propsFor(article, { hitMarks }) as never));
  });
  watch.stop();

  expect(watch.count(), "the marked block should have been rewritten").toBeGreaterThan(0);
  expect(
    [...watch.touched()],
    "only the block that gained a mark should have been rewritten",
  ).toEqual([target.id]);
});
