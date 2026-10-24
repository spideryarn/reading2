// @vitest-environment jsdom
/**
 * **Switching mode leaves the chat** — Greg, 2026-10-24 (spya-mj4b56): *"If I
 * switch modes, I've switched away from it."* Until then `?thread=` survived
 * every mode switch, and every mode but Chat and Learn drew it as the floating
 * chat, so a conversation in Sources › Investigate or in Chat followed the
 * reader into Summary as a panel. Plan
 * docs/plans/261024r-switching-mode-leaves-the-chat.md.
 *
 * The real `Reader`, in tests/helpers/reader-reading-harness.tsx's
 * composition, pressed through the `onMode` it hands the Dock — the function
 * the bar's buttons, the command bar's rows and a chat chip all reach.
 * `ChatDialog` is a probe that says whether it is mounted.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ open: 0, target: null as unknown }));

vi.mock("../src/web/ChatDialog.js", async () => {
  const { useEffect } = await import("react");
  return {
    ChatDialog: (props: { target: unknown }) => {
      dialog.target = props.target;
      useEffect(() => {
        dialog.open += 1;
        return () => {
          dialog.open -= 1;
        };
      }, []);
      return null;
    },
  };
});

import type { BlockId, ThreadSummary } from "../src/types.js";
import type { Mode } from "../src/web/params.js";
import type { SubMode } from "../src/web/sub-modes.js";
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
const THREAD = "spya-mswtch";
const SUMMARY = {
  id: THREAD,
  title: "A conversation",
  createdAt: "2026-10-24T09:00:00.000Z",
  updatedAt: "2026-10-24T09:00:00.000Z",
  kind: "chat",
  turns: 1,
} as ThreadSummary;

type UrlUpdate = { searchParams: URLSearchParams; options: { history?: string } };
let updates: UrlUpdate[];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  updates = [];
  dialog.open = 0;
  dialog.target = null;
  readerReadingProbe.width = 1600;
  readerReadingProbe.dock.mockClear();
  readerReadingProbe.table.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type DockProps = { onMode: (next: Mode, sub?: SubMode, toggle?: boolean) => void };
function press(next: Mode, sub?: SubMode, toggle = false) {
  const props = readerReadingProbe.dock.mock.lastCall?.[0] as DockProps | undefined;
  if (!props) throw new Error("Reader drew no Dock");
  return act(async () => props.onMode(next, sub, toggle));
}
/** The address after the last write, and how that write was made. */
const last = () => updates.at(-1);

/** An owner with one chat, open beside `mode` by `?thread=`. */
async function openBeside(mode: string, margin = true) {
  const base = readingHarnessOwner();
  const owner = {
    ...base,
    chatAnchors: { ...base.chatAnchors, summaries: [SUMMARY], loaded: true },
  } as typeof base;
  await act(async () =>
    root.render(
      readingHarnessView(owner, margin, {
        search: `mode=${mode}&thread=${THREAD}`,
        onUrlUpdate: (u) => updates.push(u as unknown as UrlUpdate),
      }),
    ),
  );
  /* The control: the chat really is floating beside the mode before the press. */
  expect(dialog.open).toBe(1);
  expect(dialog.target).toEqual({ kind: "thread", threadId: THREAD });
}

describe("a mode switch closes the chat beside the mode", () => {
  it("to another mode: the chat goes, and `thread` goes in the same pushed entry", async () => {
    await openBeside("summary");
    await press("glossary");
    expect(dialog.open).toBe(0);
    expect(updates).toHaveLength(1);
    expect(last()?.searchParams.get("mode")).toBe("glossary");
    expect(last()?.searchParams.has("thread")).toBe(false);
    expect(last()?.options.history).toBe("push");
  });

  it("from Sources › Investigate, where the conversation is the chat beside the mode (Greg's case)", async () => {
    await openBeside("sources&sources=investigate");
    await press("summary");
    expect(dialog.open).toBe(0);
    expect(last()?.searchParams.get("mode")).toBe("summary");
    expect(last()?.searchParams.has("thread")).toBe(false);
  });

  it("to a sub-mode row of another mode", async () => {
    await openBeside("summary");
    await press("sources", { mode: "sources", view: "claims" });
    expect(dialog.open).toBe(0);
    expect(updates).toHaveLength(1);
    expect(last()?.searchParams.get("sources")).toBe("claims");
    expect(last()?.searchParams.has("thread")).toBe(false);
    expect(last()?.options.history).toBe("push");
  });

  it("to Plain", async () => {
    await openBeside("summary");
    await press("plain");
    expect(dialog.open).toBe(0);
    expect(updates).toHaveLength(1);
    expect(last()?.searchParams.has("thread")).toBe(false);
    expect(last()?.options.history).toBe("push");
  });

  it("by a second press on the mode, which closes it", async () => {
    await openBeside("summary");
    await press("summary", undefined, true);
    expect(dialog.open).toBe(0);
    expect(last()?.searchParams.has("thread")).toBe(false);
  });

  it("when Marginalia swaps a band out on a narrow window", async () => {
    readerReadingProbe.width = 700;
    await openBeside("summary", false);
    await press("marginalia", undefined, true);
    expect(dialog.open).toBe(0);
    expect(last()?.searchParams.has("mode")).toBe(false);
    expect(last()?.searchParams.get("margin")).toBe("1");
    expect(last()?.searchParams.has("thread")).toBe(false);
    expect(last()?.options.history).toBe("push");
  });

  it("an unsent block chat goes too", async () => {
    await act(async () =>
      root.render(readingHarnessView(readingHarnessOwner(), true, { search: "mode=summary" })),
    );
    const props = readerReadingProbe.table.mock.lastCall?.[0] as
      | { onChatAbout?: (b: BlockId) => void }
      | undefined;
    if (!props?.onChatAbout) throw new Error("Reader handed TableView no passage-chat opener");
    await act(async () => props.onChatAbout?.(BLOCK));
    expect(dialog.open).toBe(1);
    await press("glossary");
    expect(dialog.open).toBe(0);
    /* And it does not come back with the mode. */
    await press("summary");
    expect(dialog.open).toBe(0);
  });
});

describe("what does not close it", () => {
  it("going to Chat, which draws that very conversation in its band", async () => {
    await openBeside("summary");
    await press("chat");
    /* The press's own write. Chat's real band mounts after it, and in this
       harness its list never loads, so its arrival rule may write again. */
    expect(updates[0]?.searchParams.get("mode")).toBe("chat");
    expect(updates[0]?.searchParams.get("thread")).toBe(THREAD);
  });

  it("a press on the mode already open", async () => {
    await openBeside("summary");
    await press("summary");
    expect(dialog.open).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it("a sub-mode row inside the mode already open", async () => {
    await openBeside("summary&summary=brief");
    await press("summary", { mode: "summary", view: "fuller" });
    expect(dialog.open).toBe(1);
    expect(last()?.searchParams.get("summary")).toBe("fuller");
    expect(last()?.searchParams.get("thread")).toBe(THREAD);
  });

  it("Marginalia, which is a switch beside the band and not a mode", async () => {
    await openBeside("summary", false);
    await press("marginalia", undefined, true);
    expect(dialog.open).toBe(1);
    expect(last()?.searchParams.get("thread")).toBe(THREAD);
  });
});
