// @vitest-environment jsdom
/**
 * **A cross-reference in the prose jumps, shows its target, and wins the words
 * it is on — and a forged one does nothing.**
 *
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
 * § 2, Stage 2's tests. The real `TableView`, `BlockLinkProvider` and
 * `ProseHoverCard`, mounted together as `Reader` mounts them, over a real
 * fixture article whose first few paragraphs are rewritten to carry the cases:
 *
 *  - a click and Enter call `onJump` with `to` from the artefact; a click that
 *    ends a selection does not (Sol F6);
 *  - a `<mark class="xref" data-xref="x-0">` written by the article itself does
 *    nothing on click, Enter or hover (Sol F2, the nonce);
 *  - over a term, a citation, a comment and a search's wash the xref wins, on a
 *    mouse and on a finger (Sol F5), with a control for each so a pass cannot be
 *    the other handler simply never running;
 *  - a stale artefact draws nothing, and a GET that lands after the first render
 *    makes the marks appear (Sol F7, F8) — through the real `useCrossrefs`.
 *
 * The harnesses are tests/prose-not-rebuilt.test.tsx's (the table) and
 * tests/citation-hover-card.test.tsx's (the events).
 */
import { act, useCallback, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return { ...real, apiFetch: vi.fn() };
});

import { TableView } from "../src/web/TableView.js";
import { ProseHoverCard } from "../src/web/ProseHoverCard.js";
import { BlockLinkProvider, buildBlockLinkIndex } from "../src/web/BlockLinkCard.js";
import { useCrossrefs } from "../src/web/useCrossrefs.js";
import { xrefTarget } from "../src/web/xref.js";
import { apiFetch } from "../src/web/lib/api.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type {
  Article,
  Block,
  BlockId,
  CitedWork,
  Comment,
  Crossref,
  CrossrefsResponse,
  GlossaryEntry,
} from "../src/types.js";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

/* ------------------------------------------------------------ the article -- */

const HTML = {
  a: "<p>Sleep loss reduced recall by 38% in older adults.</p>",
  b: "<p>As the <em>second experiment</em> showed, it held.</p>",
  c: `<p><mark class="xref" data-xref="x-0">forged words here</mark> and plain prose.</p>`,
  d: "<p>The hippocampus consolidates memory; the hippocampus is small.</p>",
};

let article: Article;
let A: BlockId;
let B: BlockId;
let C: BlockId;
let D: BlockId;
let LINKS: Crossref[];

async function load(): Promise<void> {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json`);
  const prose = loaded.blocks.filter((b) => b.gistable);
  if (prose.length < 4) throw new Error("fixture needs four prose blocks");
  const rewrite = new Map<BlockId, string>([
    [prose[0]!.id, HTML.a],
    [prose[1]!.id, HTML.b],
    [prose[2]!.id, HTML.c],
    [prose[3]!.id, HTML.d],
  ]);
  const blocks: Block[] = loaded.blocks.map((b) => {
    const html = rewrite.get(b.id);
    return html ? { ...b, html, text: html.replace(/<[^>]+>/g, "") } : b;
  });
  [A, B, C, D] = [prose[0]!.id, prose[1]!.id, prose[2]!.id, prose[3]!.id];
  article = {
    meta: loaded.meta,
    blocks,
    tree: loaded.tree,
    assets: undefined,
    highPowerSince: null,
    navLabelStatus: "ready",
    sourceGuess: undefined,
  };
  LINKS = [
    { from: A, phrase: "reduced recall by 38%", to: C },
    { from: B, phrase: "the second experiment showed", to: A },
    { from: D, phrase: "The hippocampus consolidates", to: B },
  ];
}

const TERM: GlossaryEntry = {
  id: "spya-g8h9j2",
  name: "hippocampus",
  kind: "concept",
  aliases: [],
  blocks: [],
  senseHere: "The seahorse-shaped structure the piece keeps returning to.",
} as unknown as GlossaryEntry;

function work(blockId: BlockId): CitedWork {
  return {
    id: "spya-a2b3c4",
    key: "work:x",
    title: "The Second Experiment Paper",
    authors: "Somebody",
    year: "2001",
    why: "What the piece uses it for.",
    mentions: [{ blockId, quote: "second experiment", start: 7 }],
    citedAt: [blockId],
    firstCited: blockId,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
  } as CitedWork;
}

/* ---------------------------------------------------------------- harness -- */

const jumped: BlockId[] = [];
const openedComments: string[] = [];

interface Extras {
  comments?: Comment[];
  hitMarks?: Map<BlockId, unknown[]>;
  withTerm?: boolean;
  withCite?: boolean;
}

function Page({ xrefs, extras }: { xrefs: readonly Crossref[] | null; extras: Extras }) {
  const geometry = useMemo(() => buildGeometry(article.tree, article.blocks), []);
  const layout = useMemo(() => fitView({ windowWidth: 1400 }), []);
  const index = useMemo(() => buildBlockLinkIndex(article.blocks, []), []);
  const resolveXref = useCallback((el: Element) => xrefTarget(el, xrefs), [xrefs]);
  const entries = useMemo(
    () => (extras.withTerm ? [{ ...TERM, blocks: [D] }] : []),
    [extras.withTerm],
  );
  const terms = useMemo(
    () => entries.map((e) => ({ id: e.id, forms: [e.name], blocks: e.blocks })),
    [entries],
  );
  const works = useMemo(() => (extras.withCite ? [work(B)] : []), [extras.withCite]);
  const cites = useMemo(
    () => works.map((w) => ({ id: w.id, places: w.mentions.map((m) => ({ blockId: m.blockId, quote: m.quote })) })),
    [works],
  );
  return (
    <BlockLinkProvider index={index} resolveXref={resolveXref}>
      <TableView
        article={article}
        slug="the-slug"
        linkBase="/read/the-slug"
        geometry={geometry}
        layout={layout}
        comments={extras.comments ?? []}
        openComment={null}
        chats={[]}
        chatCounts={new Map()}
        openChat={null}
        onOpenChat={() => {}}
        onSelect={() => {}}
        onOpenComment={(id: string) => openedComments.push(id)}
        onJump={(id: BlockId) => jumped.push(id)}
        terms={terms}
        cites={cites}
        xrefs={xrefs}
        hitMarks={extras.hitMarks as never}
      />
      <ProseHoverCard
        entries={entries}
        works={works}
        slug={null}
        sourceUrl={null}
        blockText={new Map(article.blocks.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        showInSpideryarn={false}
        onOpenTerm={() => {}}
        onJump={(id) => jumped.push(id as BlockId)}
        onFollowNote={() => {}}
      />
    </BlockLinkProvider>
  );
}

let host: HTMLDivElement;
let root: Root;

function paint(xrefs: readonly Crossref[] | null = LINKS, extras: Extras = {}): void {
  act(() => root.render(<Page xrefs={xrefs} extras={extras} />));
}

const row = (id: BlockId) => host.querySelector(`tr[data-block="${id}"] .prose`) as HTMLElement;
const xrefIn = (id: BlockId, n = 0) => row(id).querySelectorAll("mark.xref")[n] as HTMLElement;

function mouse(type: string, target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, detail: 1, ...init });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
  return event;
}

function click(target: Element, init: MouseEventInit = {}): void {
  act(() => {
    mouse("mousedown", target, init);
    mouse("mouseup", target, init);
    mouse("click", target, init);
  });
}

function enter(target: Element): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

function hover(target: Element): void {
  act(() => {
    mouse("pointerover", target);
  });
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

/** A complete touch tap, including the compatibility mouseup and click. */
function tap(target: Element): void {
  const fire = (type: string, at: Element | Document, bubbles = true) => {
    const event = new MouseEvent(type, { bubbles, cancelable: true, clientX: 10, clientY: 10, detail: 1 });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "isPrimary", { value: true });
    at.dispatchEvent(event);
  };
  act(() => {
    fire("pointerover", target);
    fire("pointerdown", target);
    fire("pointerup", target);
    fire("pointerout", target);
    fire("pointerleave", document, false);
    fire("mouseup", target);
    fire("click", target);
  });
}

/** BlockLinkCard's card, and its preview text. */
const blockCard = () => document.querySelector("[role='tooltip'] .tip-cite");
/** ProseHoverCard's card — a term's or a citation's. */
const proseCard = () => document.querySelector(".prose-card");

beforeEach(async () => {
  await load();
  vi.stubGlobal("ResizeObserver", NoResize);
  vi.useFakeTimers();
  jumped.length = 0;
  openedComments.length = 0;
  window.getSelection()?.removeAllRanges();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ tests -- */

describe("following a cross-reference", () => {
  it("a click jumps to `to`, from the artefact", () => {
    paint();
    click(xrefIn(A));
    expect(jumped).toEqual([C]);
  });

  it("a click on any piece of a split phrase jumps", () => {
    paint();
    const pieces = row(B).querySelectorAll("mark.xref");
    expect(pieces.length).toBeGreaterThan(1);
    click(pieces[pieces.length - 1]!);
    expect(jumped).toEqual([A]);
  });

  it("Enter on the focused mark jumps, and there is one Tab stop per phrase", () => {
    paint();
    const stops = row(B).querySelectorAll("mark.xref[tabindex='0']");
    expect(stops).toHaveLength(1);
    enter(stops[0]!);
    expect(jumped).toEqual([A]);
  });

  it("a click that ends a selection does not jump", () => {
    paint();
    const mark = xrefIn(A);
    const range = document.createRange();
    range.selectNodeContents(mark);
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.isCollapsed).toBe(false);
    act(() => {
      mouse("click", mark);
    });
    expect(jumped).toEqual([]);
  });

  it("a modified click does not jump — there is no new tab to open", () => {
    paint();
    click(xrefIn(A), { metaKey: true });
    expect(jumped).toEqual([]);
  });

  it("hover shows the target's section card, with its words", () => {
    paint();
    hover(xrefIn(A));
    expect(blockCard()?.textContent).toContain("forged words here");
  });
});

describe("a mark the article wrote itself", () => {
  it("does nothing on click, Enter or hover", () => {
    paint();
    const forged = row(C).querySelector("mark.xref") as HTMLElement;
    expect(forged.getAttribute("data-xref")).toBe("x-0");
    click(forged);
    enter(forged);
    expect(jumped).toEqual([]);
    hover(forged);
    expect(blockCard()).toBeNull();
  });
});

describe("the xref wins the words it is on", () => {
  it("over a glossary term, on a mouse: the block card, not the term's", () => {
    paint(LINKS, { withTerm: true });
    const both = row(D).querySelector("mark.term.xref") as HTMLElement;
    expect(both, "the term and the xref should share one <mark>").not.toBeNull();
    hover(both);
    expect(proseCard()?.textContent ?? "").not.toContain(TERM.senseHere);
    expect(blockCard()?.textContent).toContain("second experiment");
    /* Control: the term where there is no xref still opens its card. */
    act(() => mouse("pointerout", both));
    act(() => vi.advanceTimersByTime(600));
    const alone = row(D).querySelector("mark.term:not(.xref)") as HTMLElement;
    hover(alone);
    expect(proseCard()?.textContent).toContain(TERM.senseHere);
  });

  it("over a glossary term, on a finger: the tap jumps rather than revealing the term", () => {
    paint(LINKS, { withTerm: true });
    tap(row(D).querySelector("mark.term.xref")!);
    expect(jumped).toEqual([B]);
    expect(proseCard()).toBeNull();
    /* Control: a tap on the term alone reveals it and jumps nowhere. */
    tap(row(D).querySelector("mark.term:not(.xref)")!);
    expect(proseCard()?.textContent).toContain(TERM.senseHere);
    expect(jumped).toEqual([B]);
  });

  it("over a citation, on a mouse and on a finger", () => {
    paint(LINKS, { withCite: true });
    const both = row(B).querySelector("mark.cite.xref") as HTMLElement;
    expect(both, "the citation and the xref should share one <mark>").not.toBeNull();
    hover(both);
    expect(proseCard()?.textContent ?? "").not.toContain("The Second Experiment Paper");
    expect(blockCard()?.textContent).toContain("reduced recall");
    tap(both);
    expect(jumped).toEqual([A]);
  });

  it("over a comment, on a mouse and on a finger: it jumps and the comment does not open", () => {
    const comment = { id: "c1", blockId: A, quote: "Sleep loss reduced recall", start: 0 } as unknown as Comment;
    paint(LINKS, { comments: [comment] });
    const both = row(A).querySelector("mark.cmt.xref") as HTMLElement;
    expect(both, "the comment and the xref should share one <mark>").not.toBeNull();
    click(both);
    expect(openedComments).toEqual([]);
    expect(jumped).toEqual([C]);
    tap(both);
    expect(openedComments).toEqual([]);
    expect(jumped).toEqual([C, C]);
    /* Control: the comment's own words still open it. */
    click(row(A).querySelector("mark.cmt:not(.xref)")!);
    expect(openedComments).toEqual(["c1"]);
  });

  it("over a search's wash, on a mouse and on a finger", () => {
    const text = "Sleep loss reduced recall by 38% in older adults.";
    const start = text.indexOf("38% in older");
    const hitMarks = new Map<BlockId, unknown[]>([
      [A, [{ id: "h1", kind: "hit", start, end: start + "38% in older".length, strength: 1, slot: 0 }]],
    ]);
    paint(LINKS, { hitMarks });
    const both = row(A).querySelector("mark.hit.xref") as HTMLElement;
    expect(both, "the hit and the xref should share one <mark>").not.toBeNull();
    click(both);
    tap(both);
    expect(jumped).toEqual([C, C]);
  });
});

describe("where the links come from", () => {
  const response = (stale: boolean, artefactSlug = "the-slug"): CrossrefsResponse => ({
    crossrefs: {
      version: "crossrefs/2",
      generator: "test",
      slug: artefactSlug,
      sourceHash: "h",
      links: LINKS,
      dropped: {
        unknownIds: 0, nearby: 0, length: 0, unquoted: 0, ambiguous: 0, overlap: 0, truncated: 0, malformed: 0,
      },
      generatedAt: "2026-09-30T00:00:00Z",
      elapsedMs: 1,
    },
    stale,
    outdated: false,
  });

  function Owned() {
    const xrefs = useCrossrefs("the-slug");
    return <Page xrefs={xrefs} extras={{}} />;
  }

  it("a GET that lands after the first render makes the marks appear", async () => {
    vi.useRealTimers();
    let answer!: (r: Response) => void;
    vi.mocked(apiFetch).mockImplementation(
      () => new Promise<Response>((resolve) => { answer = resolve; }),
    );
    act(() => root.render(<Owned />));
    expect(host.querySelectorAll("tr[data-block]").length).toBe(article.blocks.length);
    expect(host.querySelectorAll("mark.xref[data-xref]:not([data-xref='x-0'])")).toHaveLength(0);
    await act(async () => {
      answer(new Response(JSON.stringify(response(false)), { status: 200 }));
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith("/api/crossrefs/the-slug");
    expect(row(A).querySelectorAll("mark.xref").length).toBeGreaterThan(0);
    expect(row(B).querySelectorAll("mark.xref").length).toBeGreaterThan(0);
  });

  it("a stale artefact draws nothing", async () => {
    vi.useRealTimers();
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify(response(true)), { status: 200 }));
    await act(async () => {
      root.render(<Owned />);
    });
    await act(async () => {});
    expect(vi.mocked(apiFetch)).toHaveBeenCalled();
    expect(row(A).querySelectorAll("mark.xref")).toHaveLength(0);
    expect(row(B).querySelectorAll("mark.xref")).toHaveLength(0);
  });

  it("an artefact naming another article draws nothing", async () => {
    vi.useRealTimers();
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(response(false, "another-slug")), { status: 200 }),
    );
    await act(async () => {
      root.render(<Owned />);
    });
    await act(async () => {});
    expect(row(A).querySelectorAll("mark.xref")).toHaveLength(0);
    expect(row(B).querySelectorAll("mark.xref")).toHaveLength(0);
  });

  it("none generated (the 404) draws nothing and is not an error", async () => {
    vi.useRealTimers();
    vi.mocked(apiFetch).mockResolvedValue(new Response("{}", { status: 404 }));
    await act(async () => {
      root.render(<Owned />);
    });
    await act(async () => {});
    expect(row(A).querySelectorAll("mark.xref")).toHaveLength(0);
  });
});
