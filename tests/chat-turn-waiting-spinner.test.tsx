// @vitest-environment jsdom
/**
 * **A model turn that is still waiting always has exactly one thing spinning.**
 *
 * The turn used to say "thinking…" only while it had no text and no tool row at
 * all, and a running tool row has a spinner of its own. Between the two was a
 * state with neither: every tool row finished, no word yet — the model has its
 * results and is writing its first sentence. On a question that reaches for the
 * web that is seconds long, and nothing on screen said the answer was coming.
 *
 * The five states below are the whole of a pending turn's life, and the rule is
 * the same in each: one spinner, never none, never two.
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md
 * § Stage 1.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Turn } from "../src/web/ChatPanel.js";
import type { ChatMessage, ToolRun } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(over: Partial<ChatMessage>, recovering = false): void {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    text: "",
    createdAt: "2026-10-03T12:00:00.000Z",
    status: "pending",
    ...over,
  };
  act(() => {
    root.render(
      createElement(Turn, {
        message,
        onJump: () => {},
        recovering,
        blocks: new Map<string, string>(),
        onEdit: () => {},
        canEdit: false,
        editing: false,
        onEditing: () => {},
        discards: 0,
      }),
    );
  });
}

const running: ToolRun = { name: "read_web_page", label: "reading aeon.co", status: "running" };
const done: ToolRun = { name: "read_web_page", label: "read aeon.co", status: "done", ms: 900 };

/** The waiting line that is about the model — not the reconnecting one. */
const waitingLine = (): Element | null => host.querySelector(".chat-thinking:not(.reconnecting)");
const spinners = (): number => host.querySelectorAll(".cmt-spinner").length;

describe("a model turn that has not produced a word yet", () => {
  it("says 'thinking…' beside a spinner when nothing has happened at all", () => {
    paint({});
    expect(waitingLine()?.textContent?.trim()).toBe("thinking…");
    expect(waitingLine()?.querySelector(".cmt-spinner")).not.toBeNull();
    expect(spinners()).toBe(1);
  });

  it("leaves the spinning to the tool row while a tool is running", () => {
    paint({ tools: [done, running] });
    expect(waitingLine()).toBeNull();
    expect(host.querySelector(".chat-tool.running .cmt-spinner")).not.toBeNull();
    expect(spinners()).toBe(1);
  });

  it("keeps a spinner and 'thinking…' once every tool has finished", () => {
    paint({ tools: [done, { ...done, status: "error" }] });
    expect(waitingLine()?.textContent?.trim()).toBe("thinking…");
    expect(waitingLine()?.querySelector(".cmt-spinner")).not.toBeNull();
    expect(spinners()).toBe(1);
  });

  it("keeps the spinner when only a web-search count has arrived", () => {
    paint({ searches: 2 });
    expect(waitingLine()?.textContent?.trim()).toBe("thinking…");
    expect(spinners()).toBe(1);
  });

  it("keeps waiting through leading whitespace chunks until a word arrives", () => {
    paint({ text: " \n", tools: [done] });
    expect(waitingLine()?.textContent?.trim()).toBe("thinking…");
    expect(spinners()).toBe(1);
    expect(host.querySelector(".chat-cursor")).toBeNull();

    paint({ text: " \nThe piece argues", tools: [done] });
    expect(waitingLine()).toBeNull();
    expect(spinners()).toBe(0);
    expect(host.querySelector(".chat-cursor")).not.toBeNull();
  });

  it("drops the waiting line the moment words arrive", () => {
    paint({ text: "The piece argues", tools: [done] });
    expect(waitingLine()).toBeNull();
    expect(spinners()).toBe(0);
    expect(host.querySelector(".chat-cursor")).not.toBeNull();
  });

  it("shows only the reconnecting line while the stream is lost", () => {
    paint({ tools: [done] }, true);
    expect(waitingLine()).toBeNull();
    expect(host.querySelector(".chat-thinking.reconnecting")?.textContent).toContain("connection lost");
    expect(spinners()).toBe(1);
  });

  it("has nothing spinning once the turn is finished", () => {
    paint({ status: "done", text: "", tools: [done] });
    expect(host.querySelector(".chat-thinking")).toBeNull();
    expect(spinners()).toBe(0);
  });
});
