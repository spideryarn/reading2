// @vitest-environment jsdom
/**
 * **The chat card is inside its block's `td.text` in the DOM, and is not
 * prose**: a click in it does not select the row, and a selection that ends in
 * it does not become a highlight, a comment or a question.
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md § Things
 * the builder must get right.
 *
 * What keeps it out is the portal. `ChatDialog` draws its panel through one
 * into a host in the cell, and React bubbles events through the React tree, so
 * the cell's and the table's handlers never hear a press in the card although
 * the card is their DOM descendant. The design that was passed over — the
 * panel rendered as an ordinary child in `TableView`'s `margin` map — has no
 * such shield, and **the control in each case below is exactly that**: an
 * ordinary child of the same cell, in the same render, which does select the
 * row and does report the selection. So each assertion about the card is
 * beside one that shows the test could have gone the other way.
 *
 * The real `TableView` and the real `ChatDialog`. Link provenance, the other
 * way the row can leak into the card, is tests/no-block-no-summary.test.tsx.
 */
import { act, createElement, type ReactElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article, BlockId } from "../src/types.js";
import { fitView } from "../src/web/layout.js";
import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The stand-ins tests/chat-dialog-gives-focus-back.test.tsx uses, for its
   reason: a mounted dialog reads a profile and a thread list over a network
   jsdom has not got. */
vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads: [],
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: () => "spya-nprthr",
    speak: () => "",
    cancelAndDiscard: () => {},
    retry: () => {},
    edit: () => {},
    stop: () => {},
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: () => {},
    deleteFrom: () => {},
    settled: () => true,
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let article: Article;
/** A paragraph with enough plain text to select some of. */
let BLOCK: BlockId;

beforeAll(async () => {
  const loaded = await readArticleFromDir(DIR);
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json`);
  article = {
    highPowerSince: null,
    titleOverridden: false,
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
  };
  const plain = loaded.blocks.find(
    (b) => b.tag === "p" && !/<(a |img|figure|table|pre|svg|button)/.test(b.html) && (b.text ?? "").length > 40,
  );
  if (!plain) throw new Error("the fixture has no plain paragraph");
  BLOCK = plain.id;
});

const onSelect = vi.fn();
const onOpenComment = vi.fn();
const onOpenChat = vi.fn();

/** The reader's shape: the table, and the panel beside it in the tree, given the host the table drew. */
function Page() {
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null);
  const margin = useMemo(
    () =>
      new Map<BlockId, ReactElement>([
        [
          BLOCK,
          <>
            <div ref={setCardHost} className="chat-card-host" data-chat-card-host="" data-marg-note="" />
            {/* The control: what the card would be without its portal. */}
            <p className="ordinary-child">an ordinary child of the cell</p>
          </>,
        ],
      ]),
    [],
  );
  const geometry = useMemo(() => buildGeometry(article.tree, article.blocks), []);
  const layout = useMemo(() => fitView({ windowWidth: 1600, margin: true }), []);
  const chatCounts = useMemo(() => new Map<string, number>(), []);
  return (
    <>
      {createElement(TableView, {
        article,
        geometry,
        layout,
        onJump: () => {},
        comments: [],
        openComment: null,
        chats: [],
        chatCounts,
        notesBy: "you",
        openChat: null,
        chatOpenBlock: BLOCK,
        linkBase: "/read/x",
        onSelect,
        onOpenComment,
        onOpenChat,
        margin,
      } as never)}
      <ChatDialog
        slug="a-piece"
        at={null}
        blocks={new Map([[BLOCK, "the paragraph"]])}
        target={{ kind: "draft", anchor: { blockId: BLOCK }, opening: "the opening words of the paragraph" }}
        card={cardHost ? { host: cardHost, width: 320 } : null}
        onJump={() => {}}
        onClose={() => {}}
        onThread={() => {}}
        onOpenFull={() => {}}
        onCreated={() => {}}
        onDropped={() => {}}
        onRenamed={() => {}}
      />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  onSelect.mockClear();
  onOpenComment.mockClear();
  onOpenChat.mockClear();
  /* A device with no hover: the row is selected by a tap, which is the path
     `isBlockSelectionTap` guards. */
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Page />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

function row(): HTMLTableRowElement {
  const tr = host.querySelector<HTMLTableRowElement>(`tbody tr[data-block="${BLOCK}"]`);
  if (!tr) throw new Error("the block's row was not drawn");
  return tr;
}
/** Something in the card a reader would click or select: the paragraph's opening, above the composer. */
function inCard(): HTMLElement {
  const el = row().querySelector<HTMLElement>("[data-chat-card-host] aside.chat-dialog .chat-dialog-opening");
  if (!el) throw new Error("the card is not in its block's cell — the test would prove nothing");
  return el;
}
function ordinaryChild(): HTMLElement {
  const el = row().querySelector<HTMLElement>("td.text > .ordinary-child");
  if (!el) throw new Error("the control was not drawn");
  return el;
}
const selectedRows = () =>
  [...host.querySelectorAll("tbody tr.row-active")].map((tr) => tr.getAttribute("data-block"));

async function tap(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** Drag from inside the paragraph's prose to `end`, and let go there. */
async function dragFromProseTo(end: HTMLElement): Promise<void> {
  const prose = row().querySelector("td.text .prose");
  const walker = document.createTreeWalker(prose as Node, NodeFilter.SHOW_TEXT);
  const start = walker.nextNode();
  const endText = end.firstChild;
  if (!start || !endText) throw new Error("nothing to select");
  const range = document.createRange();
  range.setStart(start, 2);
  range.setEnd(endText, 3);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await act(async () => {
    end.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  });
}

describe("the chat card, inside its block's cell", () => {
  it("really is a DOM descendant of the cell, which is why any of this needs saying", () => {
    expect(inCard().closest("td.text")).toBe(row().querySelector("td.text"));
    expect(inCard().closest(".prose")).toBeNull();
  });

  it("does not select the row when it is clicked — and an ordinary child of the cell does", async () => {
    await tap(inCard());
    expect(selectedRows()).toEqual([]);
    await tap(ordinaryChild());
    expect(selectedRows()).toEqual([BLOCK]);
  });

  it("does not report a selection that ends in it — and one ending on an ordinary child is reported", async () => {
    await dragFromProseTo(inCard());
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenComment).not.toHaveBeenCalled();
    expect(onOpenChat).not.toHaveBeenCalled();

    await dragFromProseTo(ordinaryChild());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ blockId: BLOCK });
  });

  /* Whether it *can* be selected is CSS (`user-select`), which jsdom does not
     apply: the browser check's. */
  it("treats a selection wholly inside it as nobody's passage", async () => {
    const text = inCard().firstChild;
    if (!text) throw new Error("nothing to select");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 10);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await act(async () => {
      inCard().dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    });
    expect(window.getSelection()?.isCollapsed).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
