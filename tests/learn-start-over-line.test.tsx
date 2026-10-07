// @vitest-environment jsdom
/**
 * **Start over answers the press at once, and says what it is doing.**
 *
 * Start over hides Learn's conversation while Live hangs up and the DELETE is
 * out (ConversationModes.tsx § `resetting`). The panel used to fall through to
 * the delayed read wait, so the press got 600ms of nothing and then
 * "Fetching your Learn conversation…", which is not what was happening (GPT
 * Sol, plan 261007h F1 review E7; queue item qi-fahzat55, plan 261007m S1).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

let host: HTMLDivElement;
let root: Root;

function paint(startingOver: boolean) {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "learn",
        loaded: true,
        loadFailed: false,
        threads: [],
        threadId: null,
        startingOver,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: false,
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Learn's Start over", () => {
  it("says it is starting over on the first render, not that it is fetching", () => {
    paint(true);
    const line = host.querySelector('[role="status"]');
    expect(line?.textContent).toContain("Starting over…");
    expect(host.textContent).not.toContain("Fetching");
  });

  it("leaves the ordinary first read as the delayed fetch wait", () => {
    paint(false);
    expect(host.textContent).not.toContain("Starting over");
    // The delayed wait mounts its live region at once and its words 600ms later.
    expect(host.querySelector(".chat-loading")).not.toBeNull();
  });
});
