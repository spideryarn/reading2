// @vitest-environment jsdom
/**
 * **An answer that mentions an earlier conversation links to it, in Chat's
 * band** — report spya-t7cq2s (Greg, 2026-10-24): *"This chat references a
 * previous conversation. It would be great if that could include a hyperlink
 * that would take me to the previous chat conversation in context."* Plan
 * docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md.
 *
 * The real band, `useChat` and `ChatPanel`, with only the network and the live
 * session faked (tests/learn-edit-asks-again.test.tsx's harness). The link is
 * pressed, and the conversation on screen, the address and Back are checked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";
import { threadParam } from "../src/web/params.js";

let stored: ChatThread[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ threads: stored }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
  };
});

vi.mock("../src/web/live/useLiveConversation.js", () => ({
  useLiveConversation: () => ({
    phase: "idle",
    error: null,
    lines: [],
    hasUnsavedLines: false,
    pointers: [],
    tools: [],
    hearing: false,
    speaking: false,
    inputLevel: { current: 0 },
    measuringInput: false,
    quietInput: false,
    deviceLabel: null,
    notice: null,
    playbackBlocked: false,
    enableAudio: () => Promise.resolve(),
    thinking: false,
    pendingTools: [],
    seen: {},
    placement: null,
    threadId: null,
    stop: () => Promise.resolve(),
    start: vi.fn(),
  }),
}));

const [{ ChatDialog }, { ConversationBand }] = await Promise.all([
  import("../src/web/ChatDialog.js"),
  import("../src/web/modes/conversation/ConversationModes.js"),
]);

const AT = "2026-10-24T17:00:00.000Z";
const EARLIER: ChatThread = {
  id: "spya-earq23",
  kind: "chat",
  title: "What is access consciousness?",
  createdAt: AT,
  updatedAt: AT,
  messages: [
    { id: "spya-q1q1q1", role: "user", text: "What is access consciousness?", createdAt: AT, status: "done" },
    { id: "spya-a1a1a1", role: "assistant", text: "The earlier answer.", createdAt: AT, status: "done" },
  ],
};
const EXPLORE: ChatThread = {
  id: "spya-expq23",
  kind: "explore",
  title: "Um, so",
  createdAt: AT,
  updatedAt: AT,
  messages: [],
};
const NOW: ChatThread = {
  id: "spya-nwwq23",
  kind: "chat",
  title: "Help me understand",
  createdAt: AT,
  updatedAt: AT,
  messages: [
    { id: "spya-q2q2q2", role: "user", text: "Help me understand.", createdAt: AT, status: "done" },
    {
      id: "spya-a2a2a2",
      role: "assistant",
      text: `Your earlier conversation on access consciousness [${EARLIER.id}] went through it. And Explore [${EXPLORE.id}]. Not this one [spya-zzzz23].`,
      createdAt: AT,
      status: "done",
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stored = [EARLIER, EXPLORE, NOW];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function mount(): Promise<void> {
  history.replaceState(null, "", `/read/a-piece?mode=chat&at=spya-bckq23&thread=${NOW.id}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(ConversationBand, {
          slug: "a-piece",
          blocks: new Map<string, string>(),
          onJump: () => {},
          onScreen: () => [],
          kind: "chat",
        }),
      ),
    );
  });
  await settle();
}

function FloatingDialog() {
  const [thread] = useQueryState("thread", threadParam);
  if (thread === null) return null;
  return createElement(ChatDialog, {
    slug: "a-piece",
    target: { kind: "thread", threadId: thread },
    at: "spya-bckq23",
    blocks: new Map<string, string>(),
    onJump: () => {},
    onClose: () => {},
    onThread: () => {},
    onOpenFull: () => {},
    onNewConversation: () => {},
    onCreated: () => {},
    onDropped: () => {},
    onRenamed: () => {},
  });
}

async function mountFloating(): Promise<void> {
  history.replaceState(null, "", `/read/a-piece?mode=summary&at=spya-bckq23&thread=${NOW.id}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(FloatingDialog)));
  });
  await settle();
}

const link = (id: string) => host.querySelector<HTMLAnchorElement>(`a[data-thread-link="${id}"]`);
const params = () => new URLSearchParams(location.search);

describe("an answer's mention of an earlier conversation", () => {
  it("is a link to each of the reader's conversations it names, and to nothing else", async () => {
    await mount();
    expect(link(EARLIER.id)?.getAttribute("href")).toBe(
      `/read/a-piece?mode=chat&at=spya-bckq23&thread=${EARLIER.id}`,
    );
    expect(link(EARLIER.id)?.textContent).toContain("What is access consciousness?");
    expect(link(EXPLORE.id)?.getAttribute("href")).toBe(
      `/read/a-piece?at=spya-bckq23&mode=learn&learn=explore&thread=${EXPLORE.id}`,
    );
    expect(host.querySelector('a[data-thread-link="spya-zzzz23"]')).toBeNull();
    expect(host.textContent).toContain("[spya-zzzz23]");
  });

  it("opens that conversation in the band on a press, and Back returns to the one it was in", async () => {
    await mount();
    const scrolled = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await act(async () => link(EARLIER.id)?.click());
    await settle();
    expect(params().get("thread")).toBe(EARLIER.id);
    expect(params().get("at"), "the article stays where it was").toBe("spya-bckq23");
    expect(scrolled, "the page is not sent to the top").not.toHaveBeenCalled();
    expect(host.textContent).toContain("The earlier answer.");
    await act(async () => {
      history.back();
      await new Promise((go) => setTimeout(go, 20));
    });
    await settle();
    expect(params().get("thread")).toBe(NOW.id);
    scrolled.mockRestore();
  });

  it("switches the floating dialog on a press, and Back returns without moving the article", async () => {
    await mountFloating();
    const scrolled = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const earlier = document.querySelector<HTMLAnchorElement>(`a[data-thread-link="${EARLIER.id}"]`);
    expect(earlier?.getAttribute("href")).toBe(
      `/read/a-piece?mode=summary&at=spya-bckq23&thread=${EARLIER.id}`,
    );
    await act(async () => earlier?.click());
    await settle();
    expect(params().get("thread")).toBe(EARLIER.id);
    expect(params().get("at"), "the article stays where it was").toBe("spya-bckq23");
    expect(scrolled, "the page is not sent to the top").not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The earlier answer.");
    await act(async () => {
      history.back();
      await new Promise((go) => setTimeout(go, 20));
    });
    await settle();
    expect(params().get("thread")).toBe(NOW.id);
    expect(document.body.textContent).toContain("Your earlier conversation on access consciousness");
    scrolled.mockRestore();
  });
});
