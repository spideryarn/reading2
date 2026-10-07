// @vitest-environment jsdom
/**
 * **The byline under the title is folded away on arrival, and the masthead
 * has the one control that shows it** — the real `TableView` and the real
 * `Masthead`, side by side as the reader has them.
 *
 * Greg, spya-duh4w3, 2026-10-06: *"default collapse them so that you kind of
 * jump straight into the article itself when you first open it."*
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § The control.
 *
 * As in tests/masthead-echo-table.test.tsx, "hidden" here is the rule in the
 * fold store's stylesheet: jsdom lays nothing out, and that the rule draws
 * nothing is the browser pass's to see.
 */
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId } from "../src/types.js";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
/* The tip is drawn beside its control as plain words, so a test can read it. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) =>
    createElement(Fragment, null, children, createElement("span", { "data-tip": "" }, content)),
  TooltipGroup: ({ children }: { children: ReactNode }) => children,
  ControlTip: ({ head, what }: { head: string; what: string }) => `${head} | ${what}`,
}));
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));

const { TableView } = await import("../src/web/TableView.js");
const { Masthead } = await import("../src/web/Masthead.js");
const { buildGeometry } = await import("../src/web/tree.js");
const { fitView } = await import("../src/web/layout.js");
const { FOLD_STYLE_ATTR, isFolded } = await import("../src/web/fold.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const id = (s: string) => `spya-${s}` as BlockId;
const block = (key: string, tag: string, text: string): Block => ({
  id: id(key),
  tag,
  kind: tag.startsWith("h") ? "heading" : "text",
  ...(tag.startsWith("h") ? { level: Number(tag.slice(1)) } : {}),
  text,
  words: text.split(/\s+/).length,
  html: `<${tag} id="${id(key)}">${text}</${tag}>`,
  gistable: true,
});

const TITLE = "A Matched Filter Hypothesis";
const title = block("titlea", "h1", TITLE);
const names = block("namesa", "p", "Jane Roe1 and John Doe2");
const places = block("placea", "p", "1Department of Psychology, University of Kansas 2jdoe@example.edu");
const abstractHead = block("abshda", "h2", "Abstract");
const abstract = block("abstra", "p", "The prefrontal cortex exerts top-down influences on several aspects of cognition.");

function article(blocks: Block[], more: Partial<Article> = {}): Article {
  const first = blocks[0]!.id;
  const last = blocks[blocks.length - 1]!.id;
  return {
    highPowerSince: null,
    titleOverridden: false,
    meta: { slug: "x", title: TITLE, byline: "Jane Roe; John Doe" },
    blocks,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: "x",
      rootId: "n0",
      nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], range: [first, last], title: TITLE } },
    },
    ...more,
  } as Article;
}

const PAPER = article([title, names, places, abstractHead, abstract]);
const ESSAY = article([title, abstractHead, abstract]);

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

/** The masthead above the prose table, as Reader.tsx has them. `owner` decides whose masthead. */
async function draw(shown: Article, owner = true): Promise<void> {
  const geometry = buildGeometry(shown.tree, shown.blocks);
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Masthead, {
          article: shown,
          slug: "x",
          ...(owner ? { onRenamed: () => {} } : {}),
        } as never),
        createElement(TableView, {
          article: shown,
          geometry,
          layout: fitView({ windowWidth: 1400 }),
          onJump: () => {},
          comments: [],
          openComment: null,
          chats: [],
          chatCounts: new Map<string, number>(),
          notesBy: "you" as const,
          openChat: null,
          linkBase: "/read/x",
          slug: "x",
          onSelect: () => {},
          onOpenComment: () => {},
          onOpenChat: () => {},
        } as never),
      ),
    );
  });
}

const rule = (b: Block) => `tr[data-block="${b.id}"]>td{display:none}`;
const sheet = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";
const button = () => host.querySelector<HTMLButtonElement>("button.front-matter-toggle");
const press = () => act(() => button()!.click());

describe("the front matter in the reading view", () => {
  it("is shut on arrival: its rows are in the table and their cells are hidden", async () => {
    await draw(PAPER);
    for (const b of [names, places]) {
      expect(host.querySelector(`tr[data-block="${b.id}"]`)).not.toBeNull();
      expect(sheet()).toContain(rule(b));
      expect(isFolded(b.id)).toBe(true);
    }
    expect(sheet()).not.toContain(rule(abstractHead));
    expect(sheet()).not.toContain(rule(abstract));
  });

  it("has a control in the masthead's facts line that says what it will do", async () => {
    await draw(PAPER);
    expect(button()?.closest("p.facts")).not.toBeNull();
    expect(button()?.textContent).toBe("Show authors and details");
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the rows on a press and puts them away on the next", async () => {
    await draw(PAPER);
    press();
    expect(sheet()).not.toContain(rule(names));
    expect(sheet()).not.toContain(rule(places));
    expect(sheet()).toContain(rule(title)); // the echo is not part of it
    expect(button()?.textContent).toBe("Hide authors and details");
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    press();
    expect(sheet()).toContain(rule(names));
    expect(button()?.textContent).toBe("Show authors and details");
  });

  it("says in its tip how many lines are behind it", async () => {
    await draw(PAPER);
    const tip = () => button()?.nextElementSibling?.textContent;
    expect(tip()).toBe(
      "Show authors and details | The 2 lines under the title: authors, affiliations, contact details.",
    );
    press();
    expect(tip()).toMatch(/^Hide authors and details \| /);
  });

  it("says one line for one line", async () => {
    await draw(article([title, places, abstractHead, abstract]));
    expect(button()?.nextElementSibling?.textContent).toContain("The line under the title:");
  });

  it("has no control when the article has no front matter", async () => {
    await draw(ESSAY);
    expect(button()).toBeNull();
    expect(sheet()).toBe(`${rule(title)}\n`);
  });

  it("is there for a visitor as for the owner", async () => {
    await draw(PAPER, false);
    expect(button()?.textContent).toBe("Show authors and details");
    expect(sheet()).toContain(rule(names));
    press();
    expect(sheet()).not.toContain(rule(names));
  });

  it("stays shut under a renamed article, whose first heading shows", async () => {
    await draw(article(PAPER.blocks, { titleOverridden: true, meta: { ...PAPER.meta, title: "My name for it" } }));
    expect(sheet()).not.toContain(rule(title));
    expect(sheet()).toContain(rule(names));
    expect(button()).not.toBeNull();
  });

  it("starts after the old wrapper's reading-time line, which the echo hides", async () => {
    /* Stage 3 stored the wrapper's line as a `p` with the template's line breaks (masthead-echo.ts). */
    const ours: Block = {
      ...block("oursaa", "p", "Jane Roe · Example · ~5 min read"),
      html: `<p id="${id("oursaa")}">\n  Jane Roe · Example\n  · ~5 min read\n</p>`,
    };
    await draw(article([title, ours, names, places, abstractHead, abstract]));
    expect(sheet()).toBe(`${[title, ours, names, places].map(rule).join("\n")}\n`);
    press();
    expect(sheet()).toBe(`${[title, ours].map(rule).join("\n")}\n`);
  });

  it("knows the names from the article's author list when it has no byline", async () => {
    const meta = { slug: "x", title: TITLE, authors: [{ name: "Jane Roe", affiliations: [] }] };
    await draw(article([title, names, abstractHead, abstract], { meta }));
    expect(sheet()).toContain(rule(names));
  });

  it("folds from the first row of a web article that has no title heading", async () => {
    /* Imported since 649dc7828: the title is only in the masthead, and block 0
       is the page's author list (front-matter.ts § Where it starts). */
    await draw(article([names, places, abstractHead, abstract]));
    expect(sheet()).toBe(`${[names, places].map(rule).join("\n")}\n`);
    expect(button()?.textContent).toBe("Show authors and details");
    press();
    expect(sheet()).toBe("");
    expect(host.querySelector(`tr[data-block="${names.id}"]`)).not.toBeNull();
  });

  it("gives a heading inside the run no chevron", async () => {
    const label = block("labela", "h2", "Authors");
    await draw(article([title, label, names, places, abstractHead, abstract]));
    press();
    expect(host.querySelector(`tr[data-block="${label.id}"] .fold-toggle`)).toBeNull();
    expect(host.querySelector(`tr[data-block="${abstractHead.id}"] .fold-toggle`)).not.toBeNull();
  });
});
