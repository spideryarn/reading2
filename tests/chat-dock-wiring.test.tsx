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

import { chatDock, fitView } from "../src/web/layout.js";
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
  chatOpenBlock?: BlockId | null;
};
const table = () => readerReadingProbe.table.mock.lastCall?.[0] as TableProps;
type DialogProps = { dockRoom: number | null; target: { kind: string } };
function dialogProps(): DialogProps {
  const props = dialog.props.mock.lastCall?.[0] as DialogProps | undefined;
  if (!props) throw new Error("the chat panel was never rendered");
  return props;
}
const dockRoom = () => dialogProps().dockRoom;

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
