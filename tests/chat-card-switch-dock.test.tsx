// @vitest-environment jsdom
/**
 * **`BLOCK_CHAT_IN_COLUMN = "dock"` is option A again, whole** — the way back
 * from the card on trial is one word in layout.ts, and this is that word
 * tried: no host in the margin, no card handed to the panel, the margin's
 * *Question* line left where it was, and the dock's room passed as before.
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md § 8.
 *
 * A file of its own because the switch is a module constant: it is mocked
 * here for every test in the file. tests/chat-dock-wiring.test.tsx is the same
 * `Reader` with the switch as shipped.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock("../src/web/layout.js", async (original) => ({
  ...(await original<typeof import("../src/web/layout.js")>()),
  BLOCK_CHAT_IN_COLUMN: "dock",
}));
vi.mock("../src/web/ChatDialog.js", () => ({
  ChatDialog: (props: Record<string, unknown>) => {
    dialog.props(props);
    return null;
  },
}));

import type { BlockId, ThreadSummary } from "../src/types.js";
import { chatCard, chatDock, fitView } from "../src/web/layout.js";
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
  margin?: ReadonlyMap<BlockId, ReactElement> | null;
};
const table = () => readerReadingProbe.table.mock.lastCall?.[0] as TableProps;
type DialogProps = { dockRoom: number | null; card: unknown; target: { kind: string } };
function dialogProps(): DialogProps {
  const props = dialog.props.mock.lastCall?.[0] as DialogProps | undefined;
  if (!props) throw new Error("the chat panel was never rendered");
  return props;
}

const ASKED = {
  id: "spya-swtthr",
  title: "A conversation",
  createdAt: "2026-10-04T11:00:00.000Z",
  updatedAt: "2026-10-04T11:00:00.000Z",
  kind: "chat",
  turns: 1,
  anchor: { blockId: BLOCK },
} as ThreadSummary;

let host: HTMLDivElement;
let root: Root;
let cellTable: HTMLTableElement;
let cellRoot: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cellTable = document.createElement("table");
  cellTable.innerHTML = `<tbody><tr data-block="${BLOCK}"><td class="text"></td></tr></tbody>`;
  document.body.append(cellTable);
  cellRoot = createRoot(cellTable.querySelector("td") as HTMLTableCellElement);
  dialog.props.mockClear();
  readerReadingProbe.table.mockClear();
});

afterEach(() => {
  act(() => cellRoot.unmount());
  act(() => root.unmount());
  cellTable.remove();
  host.remove();
});

it("is the docked panel of 261003p: no host, no card, and the margin's line kept", async () => {
  /* The control: this window is one where the card would have been drawn. */
  const fit = fitView({ windowWidth: WINDOW, margin: true });
  expect(chatCard(fit, WINDOW, 16)).not.toBeNull();

  const base = readingHarnessOwner();
  const owner = {
    ...base,
    chatAnchors: { ...base.chatAnchors, summaries: [ASKED], loaded: true },
  } as typeof base;
  await act(async () => root.render(readingHarnessView(owner, true)));
  await act(async () => table().onChatAbout?.(BLOCK));
  expect(dialogProps().target).toEqual({ kind: "thread", threadId: ASKED.id });

  /* What `TableView` does with `margin`: this block's entry, in its cell. */
  await act(async () => cellRoot.render(table().margin?.get(BLOCK) ?? null));
  expect(cellTable.querySelector("[data-chat-card-host]")).toBeNull();
  expect(cellTable.querySelector(".marg-stamp")?.textContent).toBe("Question");
  expect(dialogProps().card).toBeNull();
  expect(dialogProps().dockRoom).toBe(chatDock(fit, WINDOW));
});
