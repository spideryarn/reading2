// @vitest-environment jsdom
/**
 * **The chat panel docks in the right-hand column when it is told to, and
 * flipping between docked and floating is a class and a style, not a remount.**
 *
 * Stage 2 of
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md.
 * `Reader` decides (layout.ts § `chatDock`) and passes the room down; this is
 * the panel's half. The no-remount case is the one that matters to a reader: a
 * window dragged across the threshold with a half-typed question must keep it.
 *
 * What is NOT here is geometry — jsdom lays nothing out. Where the docked
 * panel actually lands is the browser check's to say.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId } from "../src/types.js";
import { CHAT_DOCK_INSET } from "../src/web/layout.js";

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
    send: () => "spya-newthr",
    speak: () => "",
    cancelAndDiscard: () => {},
    retry: () => {},
    edit: () => {},
    stop: () => {},
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: () => {},
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const DRAFT = { kind: "draft", anchor: { blockId: BLOCK }, opening: "a science of bumps" } as const;

let host: HTMLDivElement;
let root: Root;

function draw(dockRoom: number | null) {
  act(() =>
    root.render(
      <ChatDialog
        slug="a-piece"
        at={null}
        blocks={new Map([[BLOCK, "a science of bumps"]])}
        target={DRAFT}
        dockRoom={dockRoom}
        onJump={() => {}}
        onClose={() => {}}
        onThread={() => {}}
        onOpenFull={() => {}}
        onCreated={() => {}}
        onDropped={() => {}}
        onRenamed={() => {}}
      />,
    ),
  );
}

function panel(): HTMLElement {
  const el = host.querySelector<HTMLElement>("aside.chat-dialog");
  if (!el) throw new Error("the chat panel did not render");
  return el;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the chat panel's dock", () => {
  it("wears `docked` and carries its room and its inset when it is given room", () => {
    draw(300);
    expect(panel().classList.contains("docked")).toBe(true);
    expect(panel().style.getPropertyValue("--chat-dock-room")).toBe("300px");
    expect(panel().style.getPropertyValue("--chat-dock-inset")).toBe(`${CHAT_DOCK_INSET}px`);
  });

  it("is the floating panel, with neither, when it is given none", () => {
    draw(null);
    expect(panel().classList.contains("docked")).toBe(false);
    expect(panel().style.getPropertyValue("--chat-dock-room")).toBe("");
    expect(panel().style.getPropertyValue("--chat-dock-inset")).toBe("");
  });

  it("keeps the same element, and the draft in it, across the threshold in both directions", () => {
    draw(null);
    const before = panel();
    const box = before.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("the draft has no composer — the test would prove nothing");
    /* Through the prototype's setter, so React's value tracker sees a change. */
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(box, "half a question");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.value).toBe("half a question");

    draw(300);
    expect(panel()).toBe(before);
    expect(panel().classList.contains("docked")).toBe(true);
    expect(panel().querySelector("textarea")).toBe(box);
    expect(box.value).toBe("half a question");

    draw(null);
    expect(panel()).toBe(before);
    expect(panel().classList.contains("docked")).toBe(false);
    expect(panel().querySelector("textarea")?.value).toBe("half a question");
  });
});

/* The stylesheet's half. `CHAT_DOCK_INSET` is subtracted in layout.ts and added
   in CSS, so the two must be one number: the panel writes it as a custom
   property and the rule reads it, and a literal here would be a second copy. */
describe(".chat-dialog.docked", () => {
  const css = readFileSync("src/web/styles/dialogs.css", "utf8");
  const rule = css.match(/\.chat-dialog\.docked\s*\{([^}]*)\}/)?.[1] ?? "";

  it("starts at the column's edge plus the inset the panel was given", () => {
    expect(rule).toMatch(
      /left:\s*calc\(var\(--safe-left\)\s*\+\s*var\(--marg-left\)\s*\+\s*var\(--chat-dock-inset\)\)/,
    );
    expect(rule).toMatch(/right:\s*auto/);
  });

  it("is as wide as the room, capped at the floating panel's 26rem", () => {
    expect(rule).toMatch(/width:\s*min\(26rem,\s*var\(--chat-dock-room\)\)/);
  });

  it("leaves the bottom anchor and the heights to the floating rule (the iOS keyboard contract)", () => {
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/(^|[\s;])(top|bottom|height|max-height)\s*:/);
  });
});
