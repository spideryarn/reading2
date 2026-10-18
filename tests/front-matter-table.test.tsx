// @vitest-environment jsdom
/**
 * **Front and back matter fold on arrival, each stretch to a one-line stub in
 * the prose that opens it** — the real `TableView` and the real `Masthead`,
 * side by side as the reader has them.
 *
 * Greg, spya-duh4w3, 2026-10-06: *"default collapse them so that you kind of
 * jump straight into the article itself when you first open it."* Then
 * spya-ftsqsn, 2026-10-17, for the abstract, the contents and the back too.
 * Until plan 261018a this file tested the masthead's *Show authors and
 * details*; that control is gone, because the byline's stretch has a stub of
 * its own now, and the cases here are the same cases asked of the stub.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md
 * § Stage 3.
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
const { FOLD_STYLE_ATTR, isContentHidden, isRowHidden } = await import("../src/web/fold.js");

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
const stubRule = (b: Block) => `tr[data-block="${b.id}"]>td>:not(.matter-stub){display:none}`;
const sheet = () => document.head.querySelector(`style[${FOLD_STYLE_ATTR}]`)?.textContent ?? "";
const stubOn = (b: Block) => host.querySelector<HTMLElement>(`tr[data-block="${b.id}"] .matter-stub`);
const opener = (b: Block) => stubOn(b)?.querySelector<HTMLButtonElement>("button.matter-stub-open") ?? null;
const foldAway = (b: Block) =>
  host.querySelector<HTMLButtonElement>(`tr[data-block="${b.id}"] button.matter-fold-away`);
const press = (b: Block) => act(() => (opener(b) ?? foldAway(b))!.click());

describe("the byline in the reading view, on the fallback rule", () => {
  it("is shut on arrival: its first row is a stub, and the rest of its cells are hidden", async () => {
    await draw(PAPER);
    expect(host.querySelector(`tr[data-block="${names.id}"]`)).not.toBeNull();
    expect(sheet()).toContain(stubRule(names));
    expect(sheet()).not.toContain(rule(names));
    expect(isRowHidden(names.id)).toBe(false);
    expect(isContentHidden(names.id)).toBe(true);
    expect(sheet()).toContain(rule(places));
    expect(isRowHidden(places.id)).toBe(true);
    expect(sheet()).not.toContain(rule(abstractHead));
    expect(sheet()).not.toContain(rule(abstract));
  });

  it("has a stub that says what it is and how much, and is a button that says it is shut", async () => {
    await draw(PAPER);
    expect(stubOn(names)?.querySelector(".matter-stub-label")?.textContent).toBe("Authors and affiliations");
    expect(stubOn(names)?.querySelector(".matter-stub-count")?.textContent).toBe("2 lines");
    expect(opener(names)?.getAttribute("aria-expanded")).toBe("false");
    expect(stubOn(names)?.querySelector("button.matter-stub-info")?.getAttribute("aria-label")).toBe(
      "About Authors and affiliations",
    );
  });

  it("says in its ⓘ what is folded", async () => {
    await draw(PAPER);
    const tip = stubOn(names)?.querySelector("[data-tip]")?.textContent;
    expect(tip).toBe("Authors and affiliations | Who wrote it, where they work, and how to reach them.");
  });

  it("has no masthead control any more: the stub is the way in", async () => {
    await draw(PAPER);
    expect(host.querySelector("button.front-matter-toggle")).toBeNull();
    expect(host.querySelector("p.facts")?.textContent).not.toMatch(/authors and details/i);
  });

  it("opens on a press of the stub, and folds away again from its first row's chevron", async () => {
    await draw(PAPER);
    press(names);
    expect(sheet()).not.toContain(stubRule(names));
    expect(sheet()).not.toContain(rule(places));
    expect(sheet()).toContain(rule(title)); // the echo is not part of it
    expect(stubOn(names)).toBeNull();
    expect(foldAway(names)?.getAttribute("aria-expanded")).toBe("true");
    expect(foldAway(names)?.classList.contains("fold-toggle")).toBe(true); // the heading's chevron, reused
    press(names);
    expect(sheet()).toContain(stubRule(names));
    expect(sheet()).toContain(rule(places));
    expect(foldAway(names)).toBeNull();
  });

  it("says one line for one line", async () => {
    await draw(article([title, places, abstractHead, abstract]));
    expect(stubOn(places)?.querySelector(".matter-stub-count")?.textContent).toBe("1 line");
  });

  it("has no stub when the article has nothing to fold", async () => {
    await draw(ESSAY);
    expect(host.querySelector(".matter-stub")).toBeNull();
    expect(sheet()).toBe(`${rule(title)}\n`);
  });

  it("is there for a visitor as for the owner", async () => {
    await draw(PAPER, false);
    expect(sheet()).toContain(stubRule(names));
    press(names);
    expect(sheet()).not.toContain(rule(places));
  });

  it("stays shut under a renamed article, whose first heading shows", async () => {
    await draw(article(PAPER.blocks, { titleOverridden: true, meta: { ...PAPER.meta, title: "My name for it" } }));
    expect(sheet()).not.toContain(rule(title));
    expect(sheet()).toContain(stubRule(names));
  });

  it("starts after the old wrapper's reading-time line, which the echo hides", async () => {
    /* Stage 3 stored the wrapper's line as a `p` with the template's line breaks (masthead-echo.ts). */
    const ours: Block = {
      ...block("oursaa", "p", "Jane Roe · Example · ~5 min read"),
      html: `<p id="${id("oursaa")}">\n  Jane Roe · Example\n  · ~5 min read\n</p>`,
    };
    await draw(article([title, ours, names, places, abstractHead, abstract]));
    expect(sheet()).toBe(`${[title, ours, places].map(rule).join("\n")}\n${stubRule(names)}\n`);
    press(names);
    expect(sheet()).toBe(`${[title, ours].map(rule).join("\n")}\n`);
  });

  it("knows the names from the article's author list when it has no byline", async () => {
    const meta = { slug: "x", title: TITLE, authors: [{ name: "Jane Roe", affiliations: [] }] };
    await draw(article([title, names, abstractHead, abstract], { meta }));
    expect(sheet()).toContain(stubRule(names));
  });

  it("folds from the first row of a web article that has no title heading", async () => {
    /* Imported since 649dc7828: the title is only in the masthead, and block 0
       is the page's author list (front-matter.ts § Where it starts). */
    await draw(article([names, places, abstractHead, abstract]));
    expect(sheet()).toBe(`${rule(places)}\n${stubRule(names)}\n`);
    press(names);
    expect(sheet()).toBe("");
    expect(host.querySelector(`tr[data-block="${names.id}"]`)).not.toBeNull();
  });

  it("gives a heading inside the stretch no fold chevron of its own; the stub is its control", async () => {
    const label = block("labela", "h2", "Authors");
    await draw(article([title, label, names, places, abstractHead, abstract]));
    expect(stubOn(label)).not.toBeNull();
    press(label);
    expect(host.querySelectorAll(`tr[data-block="${label.id}"] .fold-toggle`)).toHaveLength(1);
    expect(foldAway(label)).not.toBeNull();
    expect(host.querySelector(`tr[data-block="${abstractHead.id}"] .fold-toggle`)).not.toBeNull();
  });
});

/** The stored stretches (`Article.matter`), which win over the fallback rule. */
describe("the stored front and back matter", () => {
  const refsHead = block("refsha", "h2", "References");
  const ref1 = block("refone", "p", "Roe, J. (2020). A paper. Journal 1, 2.");
  const ref2 = block("reftwo", "p", "Doe, J. (2021). Another paper. Journal 3, 4.");
  const body = block("bodyaa", "p", "The argument of the article itself, which is never folded.");
  const LONG = [title, names, places, abstractHead, abstract, body, refsHead, ref1, ref2];
  const STORED = [
    { from: abstractHead.id, to: abstract.id, kinds: ["abstract" as const] },
    { from: refsHead.id, to: ref2.id, kinds: ["references" as const] },
  ];

  it("folds each stored stretch to its own stub, and the fallback rule is not asked", async () => {
    await draw(article(LONG, { matter: STORED }));
    expect(sheet()).not.toContain(names.id); // the byline rule would have folded these
    expect(stubOn(abstractHead)?.querySelector(".matter-stub-label")?.textContent).toBe("Abstract");
    expect(stubOn(abstractHead)?.querySelector(".matter-stub-count")?.textContent).toBe(`${abstract.words} words`);
    expect(stubOn(refsHead)?.querySelector(".matter-stub-label")?.textContent).toBe("References");
    expect(stubOn(refsHead)?.querySelector(".matter-stub-count")?.textContent).toBe("2 entries");
    expect(sheet()).toContain(rule(abstract));
    expect(sheet()).toContain(rule(ref1));
    expect(sheet()).not.toContain(body.id);
  });

  it("opens one stretch at a time", async () => {
    await draw(article(LONG, { matter: STORED }));
    press(refsHead);
    expect(sheet()).not.toContain(rule(ref1));
    expect(sheet()).toContain(rule(abstract));
    expect(stubOn(abstractHead)).not.toBeNull();
  });

  it("folds nothing when the stored answer is that there is nothing to fold", async () => {
    await draw(article(LONG, { matter: [] }));
    expect(host.querySelector(".matter-stub")).toBeNull();
    expect(sheet()).toBe(`${rule(title)}\n`);
  });

  it("leaves the masthead's echo out of a stretch, and puts the stub on the first row after it", async () => {
    await draw(article(LONG, { matter: [{ from: title.id, to: places.id, kinds: ["title", "authors"] }] }));
    expect(stubOn(title)).toBeNull();
    expect(stubOn(names)?.querySelector(".matter-stub-label")?.textContent).toBe("Authors and affiliations");
    expect(sheet()).toContain(rule(title));
  });

  it("drops a stretch that is only the echo", async () => {
    await draw(article(LONG, { matter: [{ from: title.id, to: title.id, kinds: ["title"] }] }));
    expect(host.querySelector(".matter-stub")).toBeNull();
    expect(sheet()).toBe(`${rule(title)}\n`);
  });
});
