// @vitest-environment jsdom
/**
 * **`Reader` really does tell the chat panel to dock, and the prose which block
 * it is about** — the wiring a `ChatDialog` test handed `dockRoom` by hand
 * cannot see (GPT Sol's F4 on
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md).
 *
 * The real `Reader`, in tests/helpers/reader-reading-harness.tsx's composition:
 * a 1600px window at a 16px root, `TableView` replaced by a probe that records
 * its props. `ChatDialog` is a probe here too, so nothing fetches. The chat is
 * opened the way a reader opens it — through the `onChatAbout` Reader hands the
 * prose.
 *
 * Not here: where the panel lands on screen. That is the browser check's.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ props: vi.fn(), mounts: 0 }));

vi.mock("../src/web/ChatDialog.js", async () => {
  const { useEffect } = await import("react");
  return {
    ChatDialog: (props: Record<string, unknown>) => {
      dialog.props(props);
      useEffect(() => {
        dialog.mounts += 1;
      }, []);
      return null;
    },
  };
});

import type { ReactElement } from "react";
import { clearFoldArticle, isFolded, setFoldArticle, toggleFold } from "../src/web/fold.js";
import { chatCard, chatDock, fitView } from "../src/web/layout.js";
import type { BlockId, ThreadSummary } from "../src/types.js";
import {
  readerReadingProbe,
  readingHarnessArticle,
  readingHarnessOwner,
  readingHarnessView,
} from "./helpers/reader-reading-harness.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const BLOCK = readingHarnessArticle.blocks[0]?.id as BlockId;
/** The harness's window: `useWindowWidth` is mocked to this. */
const WINDOW = 1600;

type TableProps = {
  onChatAbout?: (id: BlockId) => void;
  onHelp?: (id: BlockId) => void;
  onOpenChat?: (threadId: string) => void;
  chatOpenBlock?: BlockId | null;
  margin?: ReadonlyMap<BlockId, ReactElement> | null;
};
const table = () => readerReadingProbe.table.mock.lastCall?.[0] as TableProps;
type DialogProps = { dockRoom: number | null; target: { kind: string }; onClose: () => void };
function dialogProps(): DialogProps {
  const props = dialog.props.mock.lastCall?.[0] as DialogProps | undefined;
  if (!props) throw new Error("the chat panel was never rendered");
  return props;
}
const dockRoom = () => dialogProps().dockRoom;
type CardProps = { card: { host: HTMLElement; width: number } | null; reopen: number };
const cardProps = () => dialogProps() as unknown as CardProps;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  dialog.props.mockClear();
  dialog.mounts = 0;
  readerReadingProbe.table.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function open(margin: boolean, owner = readingHarnessOwner()) {
  await act(async () => root.render(readingHarnessView(owner, margin)));
  expect(dialog.props).not.toHaveBeenCalled();
  expect(table().chatOpenBlock ?? null).toBeNull();
  const chatAbout = table().onChatAbout;
  if (!chatAbout) throw new Error("Reader handed the prose no onChatAbout");
  await act(async () => chatAbout(BLOCK));
  expect(dialog.props).toHaveBeenCalled();
}

describe("Reader docks the block chat when the column is showing", () => {
  it("passes the room `chatDock` computes from the live fit, with Marginalia on", async () => {
    await open(true);
    const expected = chatDock(fitView({ windowWidth: WINDOW, margin: true }), WINDOW);
    /* The control: this layout is one that docks, so the equality below is not
       `null === null`. */
    expect(expected).not.toBeNull();
    expect(dockRoom()).toBe(expected);
  });

  it("passes no room with Marginalia off: the panel floats as before", async () => {
    await open(false);
    expect(dockRoom()).toBeNull();
  });

  it("marks the draft's block in the prose, with or without the column", async () => {
    await open(true);
    expect(table().chatOpenBlock).toBe(BLOCK);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    expect(table().chatOpenBlock).toBe(BLOCK);
  });

  it("does not remount the panel when the column goes and the dock with it", async () => {
    const owner = readingHarnessOwner();
    await open(true, owner);
    expect(dockRoom()).not.toBeNull();
    expect(dialog.mounts).toBe(1);
    /* Marginalia off under an open draft: the same flip a resize across the
       threshold makes, since both arrive as a new `fit`. */
    await act(async () => root.render(readingHarnessView(owner, false)));
    expect(dockRoom()).toBeNull();
    expect(dialog.mounts).toBe(1);
  });
});

describe("an open thread's block comes from its summary's anchor", () => {
  const summary = (anchor?: ThreadSummary["anchor"]): ThreadSummary =>
    ({
      id: "spya-thread",
      title: "A conversation",
      createdAt: "2026-10-03T09:00:00.000Z",
      updatedAt: "2026-10-03T09:00:00.000Z",
      kind: "chat",
      turns: 1,
      ...(anchor ? { anchor } : {}),
    }) as ThreadSummary;

  /** Mount with one conversation in the list, and hand back the chip's press. */
  async function withThread(anchor?: ThreadSummary["anchor"]) {
    const base = readingHarnessOwner();
    const owner = {
      ...base,
      chatAnchors: { ...base.chatAnchors, summaries: [summary(anchor)], loaded: true },
    } as typeof base;
    await act(async () => root.render(readingHarnessView(owner, true)));
    const chatAbout = table().onChatAbout;
    if (!chatAbout) throw new Error("Reader handed the prose no onChatAbout");
    return chatAbout;
  }

  it("marks the block an anchored thread is about", async () => {
    /* With a conversation already on the block, the chip reopens it rather
       than starting a draft — so this is the `thread` arm. */
    const chatAbout = await withThread({ blockId: BLOCK });
    await act(async () => chatAbout(BLOCK));
    expect(dialogProps().target.kind).toBe("thread");
    expect(table().chatOpenBlock).toBe(BLOCK);
  });
});

/**
 * **`Reader`'s half of the card in the column** —
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md. A
 * `ChatDialog` test handed a host by hand cannot see whether `Reader` ever
 * makes one (GPT Sol on that plan, as F4 was on the dock's).
 *
 * `TableView` is a probe here, so nothing draws the `margin` map it is handed.
 * `cell()` does what the table does with it — renders this block's entry into
 * the block's cell — which is what lets the host's ref land.
 */
describe("Reader draws the block chat as a card in the column", () => {
  let cellRoot: Root;
  let cellTable: HTMLTableElement;
  let td: HTMLTableCellElement;

  beforeEach(() => {
    cellTable = document.createElement("table");
    cellTable.innerHTML = `<tbody><tr data-block="${BLOCK}"><td class="text"></td></tr></tbody>`;
    document.body.append(cellTable);
    td = cellTable.querySelector("td") as HTMLTableCellElement;
    cellRoot = createRoot(td);
  });
  afterEach(() => {
    act(() => cellRoot.unmount());
    cellTable.remove();
    act(() => clearFoldArticle());
  });

  /** Draw `margin`'s entry for the block, as `TableView` would, and return the cell. */
  async function cell(): Promise<HTMLTableCellElement> {
    await act(async () => cellRoot.render(table().margin?.get(BLOCK) ?? null));
    return td;
  }
  const hostIn = (el: Element) => el.querySelector<HTMLElement>("[data-chat-card-host]");
  const card = () => cardProps().card;

  const summary = (id: string, updatedAt: string): ThreadSummary =>
    ({
      id,
      title: "A conversation",
      createdAt: updatedAt,
      updatedAt,
      kind: "chat",
      turns: 1,
      anchor: { blockId: BLOCK },
    }) as ThreadSummary;
  const NEWER = summary("spya-crdnew", "2026-10-04T10:00:00.000Z");
  const OLDER = summary("spya-crdold", "2026-10-04T09:00:00.000Z");

  async function withThreads(margin = true) {
    const base = readingHarnessOwner();
    const owner = {
      ...base,
      chatAnchors: { ...base.chatAnchors, summaries: [NEWER, OLDER], loaded: true },
    } as typeof base;
    await act(async () => root.render(readingHarnessView(owner, margin)));
    return owner;
  }

  it("falls back to the dock until the host is in hand, then hands the panel that host", async () => {
    await open(true);
    /* Never nothing: the card is wanted, nothing has drawn its host yet, and
       the panel is docked exactly as before. */
    expect(card()).toBeNull();
    expect(dockRoom()).not.toBeNull();

    const drawn = hostIn(await cell());
    expect(drawn).not.toBeNull();
    /* What `useMarginLayout` collects, so later notes are pushed below it. */
    expect(drawn?.hasAttribute("data-marg-note")).toBe(true);
    expect(card()?.host).toBe(drawn);
    const expected = chatCard(fitView({ windowWidth: WINDOW, margin: true }), WINDOW, 16);
    expect(expected).not.toBeNull();
    expect(card()?.width).toBe(expected);
    /* And the room stays on offer, for the moment the host goes. */
    expect(dockRoom()).not.toBeNull();
  });

  it("makes no host with Marginalia off: there is no column to draw in", async () => {
    await open(false);
    expect(table().margin ?? null).toBeNull();
    expect(card()).toBeNull();
  });

  it("goes back to the dock when the host leaves, without remounting the panel", async () => {
    const owner = readingHarnessOwner();
    await open(true, owner);
    await cell();
    expect(card()).not.toBeNull();
    expect(dialog.mounts).toBe(1);
    await act(async () => cellRoot.render(null));
    expect(card()).toBeNull();
    expect(dockRoom()).not.toBeNull();
    expect(dialog.mounts).toBe(1);
  });

  /* Sol F3: after the block's own notes, an opened note would push the chat
     away from its paragraph. */
  it("puts the card first in the cell, above the block's own notes", async () => {
    await withThreads();
    const chatAbout = table().onChatAbout;
    await act(async () => chatAbout?.(BLOCK));
    const el = await cell();
    expect(el.firstElementChild).toBe(hostIn(el));
    /* The other question on this block is an ordinary note, under the card. */
    expect(el.querySelector(".marg-note")?.previousElementSibling).toBe(hostIn(el));
  });

  it("drops the margin's line for the conversation the card is showing, and only that one", async () => {
    await withThreads();
    const before = await cell();
    expect(hostIn(before)).toBeNull();
    expect(before.textContent).toContain("2 questions");

    /* The chip opens the newest whole-block conversation. */
    await act(async () => table().onChatAbout?.(BLOCK));
    expect(dialogProps().target).toEqual({ kind: "thread", threadId: NEWER.id });
    const during = await cell();
    expect(hostIn(during)).not.toBeNull();
    expect(during.textContent).not.toContain("2 questions");
    expect(during.querySelector(".marg-stamp")?.textContent).toBe("Question");
  });

  it("keeps the block's opened note open when a chat card arrives and leaves", async () => {
    await withThreads();
    const before = await cell();
    const note = before.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(note).not.toBeNull();
    act(() => note?.click());
    expect(note?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => table().onChatAbout?.(BLOCK));
    const during = await cell();
    expect(hostIn(during)).not.toBeNull();
    expect(during.querySelector(".marg-shut-button")).toBe(note);
    expect(note?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => dialogProps().onClose());
    const after = await cell();
    expect(hostIn(after)).toBeNull();
    expect(after.querySelector(".marg-shut-button")).toBe(note);
    expect(note?.getAttribute("aria-expanded")).toBe("true");
  });

  /* Sol F1. The chip, the "?" and a mark all only write `?thread=`, so a press
     that names the conversation already open is invisible to the panel unless
     `Reader` counts it. */
  it("counts every press that asks for a conversation, including the one already open", async () => {
    await withThreads();
    await act(async () => table().onChatAbout?.(BLOCK));
    const first = cardProps().reopen;
    await act(async () => table().onChatAbout?.(BLOCK));
    expect(dialogProps().target).toEqual({ kind: "thread", threadId: NEWER.id });
    expect(cardProps().reopen).toBe(first + 1);
    await act(async () => table().onHelp?.(BLOCK));
    expect(cardProps().reopen).toBe(first + 2);
    await act(async () => table().onOpenChat?.(NEWER.id));
    expect(cardProps().reopen).toBe(first + 3);
    expect(dialog.mounts).toBe(1);
  });

  /* Sol F4: a fold hides the cell with `display: none`. A card in a hidden
     cell is a chat that has vanished, so a folded anchor is the dock's. */
  it("falls back to the dock while the block's section is folded, and returns when it opens", async () => {
    await open(true);
    await cell();
    expect(card()).not.toBeNull();

    const heading = { id: "spya-crdhd1", tag: "h2", kind: "heading" };
    const blocks = [heading, ...readingHarnessArticle.blocks] as typeof readingHarnessArticle.blocks;
    act(() => setFoldArticle("reading-harness", blocks));
    await act(async () => toggleFold(heading.id as BlockId));
    expect(isFolded(BLOCK)).toBe(true);
    expect(card()).toBeNull();
    expect(dockRoom()).not.toBeNull();
    expect(hostIn(await cell())).toBeNull();

    await act(async () => toggleFold(heading.id as BlockId));
    expect(isFolded(BLOCK)).toBe(false);
    expect(hostIn(await cell())).not.toBeNull();
    expect(card()).not.toBeNull();
    expect(dialog.mounts).toBe(1);
  });
});
