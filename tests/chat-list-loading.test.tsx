// @vitest-environment jsdom
/**
 * **An empty list is not an answer until the fetch says so.**
 *
 * Greg, 2026-08-27, opening chat mode on a slow connection:
 *
 * > I tried loading Chat mode on a slow internet connection, and it initially
 * > told me there were no chats (even though I knew there were)! Then
 * > eventually the existing chats loaded and replaced that message. Better to
 * > show a loading spinner when loading, rather than default to the
 * > empty/initial state (which is wrong and worrying).
 *
 * The panel had one branch for "no conversations", and `threads` is `[]` both
 * before the request lands and after it comes back empty. So the first thing a
 * reader with a shelf full of conversations saw was a confident sentence
 * saying they had none.
 *
 * The four tests below are the four states, and the last two matter as much as
 * the first: a fix that simply never showed the empty state would pass a test
 * for the loading one.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

/* A real id, because `?thread=` is parsed as a block id — src/ids.ts. */
const THREAD: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [],
};

/** A conversation the URL names and this panel has not got yet. */
const STORED_ELSEWHERE = "spya-w7n2xd";

let host: HTMLDivElement;
let root: Root;

function paint(
  threads: ChatThread[],
  loaded: boolean,
  threadId: string | null = null,
  loadFailed = false,
): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        loaded,
        loadFailed,
        /* Chat rather than review — the panel gained a second kind while this
           was being written, and the loading state is the same for both. */
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
        threads,
        threadId,
        onThread: () => {},
        onSend: () => {},
        onSendNew: () => {},
        onNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
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

/** Past the threshold at which a wait is worth mentioning. useSlow.ts. */
function waitOutTheFlickerWindow(): void {
  act(() => {
    vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the conversation list while the first fetch is out", () => {
  /* The bug, in one line. */
  it("does not claim the reader has asked nothing", () => {
    paint([], false);
    waitOutTheFlickerWindow();
    expect(host.textContent).not.toContain("Nothing asked yet");
    expect(host.querySelector(".chat-empty")).toBeNull();
  });

  it("says what it is waiting for, once the wait is worth mentioning", () => {
    paint([], false);
    expect(host.querySelector(".cmt-spinner")).toBeNull();
    waitOutTheFlickerWindow();
    expect(host.querySelector(".cmt-spinner")).not.toBeNull();
    expect(host.textContent).toContain("Fetching your conversations");
  });

  /* The same window, arrived at from a bookmark: `?thread=` names a stored
     conversation the fetch has not brought, so the panel falls back to the
     list. That reader is even more sure they have conversations. */
  it("holds the same line when the URL names a conversation not here yet", () => {
    paint([], false, STORED_ELSEWHERE);
    waitOutTheFlickerWindow();
    expect(host.textContent).not.toContain("Nothing asked yet");
    expect(host.textContent).toContain("Fetching your conversations");
  });

  /* And the two states the spinner must not eat. Without these, a panel that
     never showed the empty state at all would pass everything above. */
  it("says it plainly once the fetch has landed on nothing", () => {
    paint([], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("Nothing asked yet");
    expect(host.querySelector(".cmt-spinner")).toBeNull();
  });

  /* The state one beat later, and the one the first version of this fix walked
     straight into. `loaded` means "we have asked", not "it worked" — on purpose,
     so a reader whose server is down can still open a conversation — which left
     a failing request dropping out of the spinner and into the same denial.
     GPT Sol, reviewing that fix, 2026-08-27. */
  it("does not turn a failed fetch into an empty list", () => {
    paint([], true, null, true);
    waitOutTheFlickerWindow();
    expect(host.textContent).not.toContain("Nothing asked yet");
    expect(host.textContent).toContain("Couldn't load your conversations");
  });

  /* A list can have something in it before the fetch lands — press `+`, type a
     draft, close it, and the panel keeps that conversation. A spinner drawn
     over the reader's own work is its own wrong answer. */
  it("shows a conversation the reader made, rather than a spinner over it", () => {
    paint([THREAD], false);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("An earlier conversation");
    expect(host.querySelector(".cmt-spinner")).toBeNull();
  });
});
