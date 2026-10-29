// @vitest-environment jsdom
/**
 * **An explained passage is underlined in the prose, and its card says what
 * the explanation says** — docs/plans/261029j-explained-passages-underlined-in-the-prose.md.
 *
 * The real `TableView` and `ProseHoverCard`, mounted together as `Reader`
 * mounts them, over a fixture article whose first paragraphs are rewritten to
 * carry the cases. The harness is tests/xref-prose.test.tsx's.
 *
 *  - a list that lands after the first render draws (§ 6, the memo's key);
 *  - a quote the rendered text has twice draws nothing (§ 1);
 *  - a term inside the passage is one `<mark>` carrying both, and the card
 *    draws both sections, term first (§ 3);
 *  - the card's two buttons call the senders and close it; a second tap opens
 *    Explanations; a tap on a comment inside the passage still opens the
 *    comment (Sol's P1); a keyboard focus on a link inside the passage finds
 *    the explanation (Sol's P2-5) (§ 4).
 */
import { act, StrictMode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
  ControlTip: () => null,
}));

import { TableView } from "../src/web/TableView.js";
import { ProseHoverCard } from "../src/web/ProseHoverCard.js";
import { ExplanationsFeed } from "../src/web/marginalia/MarginaliaColumn.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { NOT_SURE_LABEL } from "../src/web/explanation-labels.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, Block, BlockId, Comment, Explanation, GlossaryEntry } from "../src/types.js";
import type { AnchoredThread } from "../src/web/useChatAnchors.js";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

const HTML = {
  a: "<p>Feedforward sweeps alone do not give rise to global availability, the authors say.</p>",
  b: "<p>Recurrent loops matter. Recurrent loops matter, again.</p>",
  c: `<p>See <a href="https://example.com/paper" target="_blank">the workspace paper</a> for the claim.</p>`,
};

let article: Article;
let A: BlockId;
let B: BlockId;
let C: BlockId;

async function load(): Promise<void> {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json`);
  const prose = loaded.blocks.filter((b) => b.gistable);
  if (prose.length < 3) throw new Error("fixture needs three prose blocks");
  const rewrite = new Map<BlockId, string>([
    [prose[0]!.id, HTML.a],
    [prose[1]!.id, HTML.b],
    [prose[2]!.id, HTML.c],
  ]);
  const blocks: Block[] = loaded.blocks.map((b) => {
    const html = rewrite.get(b.id);
    return html ? { ...b, html, text: html.replace(/<[^>]+>/g, "") } : b;
  });
  [A, B, C] = [prose[0]!.id, prose[1]!.id, prose[2]!.id];
  article = {
    meta: loaded.meta,
    blocks,
    tree: loaded.tree,
    assets: undefined,
    highPowerSince: null,
    titleOverridden: false,
    navLabelStatus: "ready",
    sourceGuess: undefined,
  };
}

const explanation = (over: Partial<Explanation>): Explanation =>
  ({
    id: "spya-ex0001",
    blockId: A,
    quote: "do not give rise to global availability",
    text: "The skipped step: global availability is the workspace theory's test.",
    sure: false,
    outside: false,
    ...over,
  }) as Explanation;

const TERM: GlossaryEntry = {
  id: "spya-g8h9j2",
  name: "global availability",
  kind: "concept",
  aliases: [],
  blocks: [],
  senseHere: "Information broadcast to the whole system.",
} as unknown as GlossaryEntry;

/* ---------------------------------------------------------------- harness -- */

const asked: string[] = [];
const opened: string[] = [];
const openedComments: string[] = [];
const openedChats: string[] = [];

interface Extras {
  withTerm?: boolean;
  comments?: Comment[];
  chats?: AnchoredThread[];
}

function Page({ explained, extras }: { explained: readonly Explanation[] | null; extras: Extras }) {
  const geometry = useMemo(() => buildGeometry(article.tree, article.blocks), []);
  const layout = useMemo(() => fitView({ windowWidth: 1400 }), []);
  const entries = useMemo(() => (extras.withTerm ? [{ ...TERM, blocks: [A] }] : []), [extras.withTerm]);
  const terms = useMemo(
    () => entries.map((e) => ({ id: e.id, forms: [e.name], blocks: e.blocks })),
    [entries],
  );
  const actions = useMemo(
    () => ({
      onAsk: (e: Explanation) => asked.push(e.id),
      onOpen: (id: string) => opened.push(id),
    }),
    [],
  );
  return (
    <>
      <TableView
        article={article}
        slug="the-slug"
        linkBase="/read/the-slug"
        geometry={geometry}
        layout={layout}
        comments={extras.comments ?? []}
        openComment={null}
        chats={extras.chats ?? []}
        chatCounts={new Map()}
        notesBy="you"
        openChat={null}
        onOpenChat={(id: string) => openedChats.push(id)}
        onSelect={() => {}}
        onOpenComment={(id: string) => openedComments.push(id)}
        onJump={() => {}}
        terms={terms}
        explained={explained}
      />
      <ProseHoverCard
        entries={entries}
        works={[]}
        slug={null}
        sourceUrl={null}
        blockText={new Map(article.blocks.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        showInSpideryarn={false}
        termActions={null}
        onOpenTerm={() => {}}
        onJump={() => {}}
        onFollowNote={() => {}}
        explanations={explained}
        explanationActions={actions}
      />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

function paint(explained: readonly Explanation[] | null, extras: Extras = {}): void {
  act(() => root.render(<Page explained={explained} extras={extras} />));
}

const row = (id: BlockId) => host.querySelector(`tr[data-block="${id}"] .prose`) as HTMLElement;

function pointer(type: string, target: Element, kind: "mouse" | "touch", bubbles = true): void {
  const event = new MouseEvent(type, { bubbles, cancelable: true, clientX: 10, clientY: 10, detail: 1 });
  Object.defineProperty(event, "pointerType", { value: kind });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

function hover(target: Element): void {
  act(() => pointer("pointerover", target, "mouse"));
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

function click(target: Element): void {
  act(() => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) pointer(type, target, "mouse");
  });
}

/** A complete touch tap, including the compatibility mouseup and click. */
function tap(target: Element): void {
  act(() => {
    pointer("pointerover", target, "touch");
    pointer("pointerdown", target, "touch");
    pointer("pointerup", target, "touch");
    pointer("pointerout", target, "touch");
    pointer("pointerleave", document as unknown as Element, "touch", false);
    pointer("mouseup", target, "touch");
    pointer("click", target, "touch");
  });
}

const card = () => document.querySelector(".prose-card");

beforeEach(async () => {
  await load();
  vi.stubGlobal("ResizeObserver", NoResize);
  vi.useFakeTimers();
  asked.length = 0;
  opened.length = 0;
  openedComments.length = 0;
  openedChats.length = 0;
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

describe("the underline", () => {
  it("is drawn over the quoted words when the list lands after the first render", () => {
    paint(null);
    expect(row(A).querySelector("mark.explained")).toBeNull();
    paint([explanation({})]);
    const marks = row(A).querySelectorAll("mark.explained");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].map((m) => m.textContent).join("")).toBe("do not give rise to global availability");
    expect(marks[0]!.getAttribute("data-explained")).toBe("spya-ex0001");
  });

  it("draws nothing where the rendered text has the words twice, and nothing in another block", () => {
    paint([explanation({ id: "spya-ex0002", blockId: B, quote: "Recurrent loops matter" })]);
    expect(host.querySelector("mark.explained")).toBeNull();
  });

  it("is gone when the list goes (the switch turned off)", () => {
    paint([explanation({})]);
    expect(row(A).querySelector("mark.explained")).not.toBeNull();
    paint(null);
    expect(row(A).querySelector("mark.explained")).toBeNull();
  });
});

describe("the card", () => {
  it("says the explanation and its labels; Open in Explanations opens it and closes the card", () => {
    paint([explanation({})]);
    hover(row(A).querySelector("mark.explained")!);
    expect(card()?.textContent).toContain("global availability is the workspace theory");
    expect(card()?.textContent).toContain(NOT_SURE_LABEL);
    const open = [...card()!.querySelectorAll("button")].find((b) => b.textContent?.includes("Open in Explanations"));
    act(() => open!.click());
    expect(opened).toEqual(["spya-ex0001"]);
    expect(card()).toBeNull();
  });

  it("Ask in chat sends the explanation and closes the card", () => {
    paint([explanation({})]);
    hover(row(A).querySelector("mark.explained")!);
    click(card()!.querySelector("button[aria-label='Ask about this explanation in chat']")!);
    expect(asked).toEqual(["spya-ex0001"]);
    expect(card()).toBeNull();
  });

  it("over a glossary term, one mark carries both and the card draws the term then the explanation", () => {
    paint([explanation({})], { withTerm: true });
    const both = row(A).querySelector("mark.term.explained") as HTMLElement;
    expect(both, "the term and the passage should share one <mark>").not.toBeNull();
    expect(both.textContent).toBe("global availability");
    hover(both);
    const text = card()?.textContent ?? "";
    expect(text).toContain("Information broadcast");
    expect(text).toContain("global availability is the workspace theory");
    expect(text.indexOf("Information broadcast")).toBeLessThan(text.indexOf("workspace theory"));
  });

  it("on a finger: the first tap shows the card, the second opens Explanations", () => {
    paint([explanation({})]);
    const mark = row(A).querySelector("mark.explained")!;
    tap(mark);
    expect(card()?.textContent).toContain("workspace theory");
    expect(opened).toEqual([]);
    tap(mark);
    expect(opened).toEqual(["spya-ex0001"]);
  });

  it("a tap on a comment inside the passage still opens the comment", () => {
    const comment = { id: "c1", blockId: A, quote: "give rise", start: 0 } as unknown as Comment;
    paint([explanation({})], { comments: [comment] });
    const both = row(A).querySelector("mark.cmt.explained") as HTMLElement;
    expect(both, "the comment and the passage should share one <mark>").not.toBeNull();
    tap(both);
    expect(openedComments).toEqual(["c1"]);
    expect(opened).toEqual([]);
  });

  it("a tap on a comment where a term is also explained still opens the comment", () => {
    const comment = {
      id: "c1",
      blockId: A,
      quote: "global availability",
      start: 0,
    } as unknown as Comment;
    paint([explanation({})], { withTerm: true, comments: [comment] });
    const allThree = row(A).querySelector("mark.cmt.term.explained") as HTMLElement;
    expect(allThree, "the comment, term and explanation should share one <mark>").not.toBeNull();
    tap(allThree);
    expect(openedComments).toEqual(["c1"]);
    expect(opened).toEqual([]);
    expect(card()).toBeNull();
  });

  it("a tap on a chat where a term is also explained still opens the chat", () => {
    const chat: AnchoredThread = {
      id: "th1",
      title: "A conversation",
      anchor: { blockId: A, quote: "global availability", start: 0 },
      turns: 1,
    };
    paint([explanation({})], { withTerm: true, chats: [chat] });
    const allThree = row(A).querySelector("mark.chat.term.explained") as HTMLElement;
    expect(allThree, "the chat, term and explanation should share one <mark>").not.toBeNull();
    tap(allThree);
    expect(openedChats).toEqual(["th1"]);
    expect(opened).toEqual([]);
    expect(card()).toBeNull();
  });

  it("a keyboard focus on a link inside the passage finds the explanation", () => {
    paint([explanation({ id: "spya-ex0003", blockId: C, quote: "the workspace paper" })]);
    const link = row(C).querySelector("a[href]") as HTMLAnchorElement;
    expect(link.querySelector("mark.explained")).not.toBeNull();
    act(() => link.focus());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card()?.textContent).toContain("workspace theory");
  });
});

describe("the shared feed", () => {
  it("does not turn StrictMode's repeated mount effect into a band-open refresh", async () => {
    const fetch = vi.fn(async () =>
      new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      root.render(
        <StrictMode>
          <ExplanationsFeed slug="the-slug" bandOpen onExplanations={() => {}} />
        </StrictMode>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the band's own GET when Explanations opens", async () => {
    const fetch = vi.fn(async () =>
      new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      root.render(<ExplanationsFeed slug="the-slug" bandOpen={false} onExplanations={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(<ExplanationsFeed slug="the-slug" bandOpen onExplanations={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
