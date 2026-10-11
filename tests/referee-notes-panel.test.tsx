// @vitest-environment jsdom
/**
 * **Referee › Notes, the panel**: the halves that could go wrong silently.
 * src/web/RefereeNotesPanel.tsx; plan 261011f.
 *
 * - **Copy waits for a sort still on the wire** (GPT Sol, plan review F3). A
 *   sort is not optimistic, so in the round trip the note is still under its
 *   old heading; a Copy then would put it there on the clipboard and say
 *   "Copied".
 * - **A copy the browser refuses says so**, and no clipboard at all says so
 *   (F6) — `useCopy`, not a bare `writeText`.
 * - **No jump to a paragraph that has gone** (F8).
 * - **Not loaded is not empty**: "no notes yet" is never said over a list that
 *   has not arrived.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, Comment, Severity } from "../src/types.js";
import { type NotesComments, RefereeNotesView } from "../src/web/RefereeNotesPanel.js";

const B1 = "spya-aaaaaa" as BlockId;
const blocks = [{ id: B1, text: "The gains hold across all six benchmarks." }] as unknown as Block[];

function note(id: string, body: string, severity?: Severity, blockId: BlockId = B1): Comment {
  return {
    id,
    blockId,
    quote: "six benchmarks",
    start: 26,
    createdAt: "2026-10-11T00:00:00.000Z",
    status: "none",
    body,
    ...(severity ? { severity } : {}),
  } as Comment;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});

function paint(
  comments: NotesComments,
  onSort: (id: string, s: Severity | null) => Promise<void> = async () => {},
  onJump: (b: BlockId) => void = () => {},
): void {
  act(() => root.render(<RefereeNotesView comments={comments} blocks={blocks} onSort={onSort} onJump={onJump} />));
}

const copyButton = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Copy notes")) as HTMLButtonElement;
const pressSort = (label: "Major" | "Minor") =>
  [...host.querySelectorAll<HTMLButtonElement>(".gloss-sort-btn")].find((b) => b.textContent === label);

function clipboard(writeText: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("before the list has arrived", () => {
  it("says it is loading, never that there are no notes", () => {
    paint({ state: "loading" });
    expect(host.textContent).toContain("Loading your notes");
    expect(host.textContent).not.toContain("No notes");
  });

  it("says the load failed, never that there are no notes", () => {
    paint({ state: "failed" });
    expect(host.textContent).toContain("could not be loaded");
    expect(host.textContent).not.toContain("No notes");
  });
});

describe("sorting", () => {
  it("sends the press, and pressing the lit one again un-sorts", () => {
    const onSort = vi.fn(async () => {});
    paint({ state: "ready", comments: [note("a", "mine", "major")] }, onSort);
    act(() => pressSort("Major")?.click());
    expect(onSort).toHaveBeenLastCalledWith("a", null);
    act(() => pressSort("Minor")?.click());
    expect(onSort).toHaveBeenLastCalledWith("a", "minor");
  });

  it("holds Copy while a sort is being saved, and lets it go when the save lands", async () => {
    let land: () => void = () => {};
    const onSort = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
    paint({ state: "ready", comments: [note("a", "mine")] }, onSort);
    expect(copyButton().disabled).toBe(false);
    act(() => pressSort("Major")?.click());
    expect(copyButton().disabled).toBe(true);
    expect(host.textContent).toContain("Saving your sort");
    await act(async () => land());
    expect(copyButton().disabled).toBe(false);
  });
});

describe("copying", () => {
  it("puts the reviewer's words on the clipboard and says so", async () => {
    const writeText = vi.fn(async (_: string) => {});
    clipboard(writeText);
    paint({ state: "ready", comments: [note("a", "Only four are in Table 2.", "major")] });
    await act(async () => copyButton().click());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Major\n1. Only four are in Table 2.");
    expect(host.textContent).toContain("Copied");
  });

  it("says so when the browser refuses", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    paint({ state: "ready", comments: [note("a", "mine")] });
    await act(async () => copyButton().click());
    expect(host.textContent).toContain("would not allow the copy");
    expect(host.textContent).not.toContain("Copied");
  });

  it("says so when there is no clipboard at all", async () => {
    paint({ state: "ready", comments: [note("a", "mine")] });
    await act(async () => copyButton().click());
    expect(host.textContent).toContain("would not allow the copy");
  });
});

describe("the passage", () => {
  it("jumps to a passage that is there", () => {
    const onJump = vi.fn();
    paint({ state: "ready", comments: [note("a", "mine")] }, undefined, onJump);
    act(() => host.querySelector<HTMLButtonElement>(".ref-notes-jump")?.click());
    expect(onJump).toHaveBeenCalledWith(B1);
  });

  it("offers no jump to a paragraph that has gone, and says where it was", () => {
    const gone = { ...note("a", "orphan"), blockId: "spya-gone00" as BlockId } as Comment;
    Reflect.deleteProperty(gone, "quote");
    Reflect.deleteProperty(gone, "start");
    paint({ state: "ready", comments: [gone] });
    expect(host.querySelector(".ref-notes-jump")).toBeNull();
    expect(host.textContent).toContain("no longer in this version of the article");
  });

  it("counts marks with no words, and lists none of them", () => {
    const bare = { ...note("b", "x") } as Comment;
    Reflect.deleteProperty(bare, "body");
    paint({ state: "ready", comments: [note("a", "mine"), bare] });
    expect(host.querySelectorAll(".ref-notes-row")).toHaveLength(1);
    expect(host.textContent).toContain("1 mark without a note of yours is left out.");
  });
});
