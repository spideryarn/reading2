// @vitest-environment jsdom
/**
 * **What Chat's panel draws for the guide** — plan
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md,
 * stage 2:
 *
 * - **the pinned row**, above the list and outside its source filter, there
 *   under every `?chatfrom=` and with no conversation at all, and a press on
 *   it opens the guide (GPT Sol's F2);
 * - **the greeting**, ours and free, asking in the conversation since plan
 *   261009i (no box): why you are reading when no reason is stored, About you
 *   quoted back when it is there, *Ask the guide where to start* only when a
 *   reason is stored, nothing asked or offered when the reason could not be
 *   read; and *Keep this as why you're reading* under the reader's first
 *   answer, which never overwrites a reason stored meanwhile.
 *
 * The real `ChatPanel`, handed props directly, as
 * tests/chat-list-sources.test.tsx does. What the band hands it is
 * tests/guide-in-chat-band.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";
import type { ChatFrom } from "../src/web/params.js";

/** What `GET /api/reader?slug=` answers. */
let reader: { profile: string | null; purpose: string | null; purposeFailed: boolean } = {
  profile: null,
  purpose: null,
  purposeFailed: false,
};
const patches: unknown[] = [];
/** When set, the next PATCH writes and then answers 500, as a reply lost after the write. */
let patchLosesReply = false;
/** Something to run before the reader read answers: another tab saving. */
let beforeRead: (() => void) | null = null;
/** A deliberately slow opening read, for the race between the greeting and a first send. */
let delayedRead: Promise<Response> | null = null;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { purpose: string | null };
        patches.push(body);
        reader = { ...reader, purpose: body.purpose };
        if (patchLosesReply) return Promise.resolve(new Response("{}", { status: 500 }));
        return Promise.resolve(json({ purpose: body.purpose }));
      }
      if (String(url).startsWith("/api/reader")) {
        beforeRead?.();
        if (delayedRead !== null) return delayedRead;
        return Promise.resolve(json(reader));
      }
      return Promise.resolve(json({}));
    },
  };
});

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { GUIDE_FIRST_QUESTION, GUIDE_START_LABEL, KEEP_REASON_LABEL, KEPT_REASON_LABEL } = await import(
  "../src/web/GuideGreeting.js"
);

const AT = "2026-10-07T09:00:00.000Z";

function thread(id: string, kind: ThreadKind, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind,
    title: `A question in ${id}`,
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
    ...over,
  };
}

const CHAT = thread("spya-chtaab", "chat");
const CLAIM = thread("spya-clmaab", "chat", {
  origin: { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" },
});
const LEARN = thread("spya-remaab", "learn");
const EMPTY_GUIDE = thread("spya-gdeaab", "guide", { messages: [] });

let host: HTMLDivElement;
let root: Root;
const sent: string[] = [];
let guideOpened = 0;

function paint(
  listed: ChatThread[],
  over: { from?: ChatFrom | null; threadId?: string | null; guide?: ChatThread | null; live?: LiveApi } = {},
) {
  const guide = over.guide ?? null;
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        articleTitle: "Attention Is All You Need",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        listed,
        threads: [...listed.filter((t) => t.kind === "chat"), ...(guide ? [guide] : [])],
        guide: {
          thread: guide,
          onOpen: () => {
            guideOpened += 1;
          },
        },
        threadId: over.threadId ?? null,
        from: over.from ?? null,
        onFrom: () => {},
        onOpenLearn: () => {},
        onThread: () => {},
        onSend: (q: string) => {
          sent.push(q);
        },
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: false,
        onRetry: () => {},
        onEdit: () => {},
        onDeleteFrom: undefined,
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        live: over.live,
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reader = { profile: null, purpose: null, purposeFailed: false };
  patches.length = 0;
  patchLosesReply = false;
  beforeRead = null;
  delayedRead = null;
  sent.length = 0;
  guideOpened = 0;
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const guideRow = (): HTMLElement | null => host.querySelector<HTMLElement>(".chat-guide");

describe("the guide's pinned row", () => {
  it.each([null, "chats", "peer-review", "learn"] as const)("is above the list whatever the filter says (%s)", (from) => {
    paint([CHAT, CLAIM, LEARN], { from });
    const row = guideRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Guide");
    /* First in the list, ahead of the filter and every row. */
    const list = host.querySelector(".chat-threads");
    expect(row && list && row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is there with no conversation at all, and before the guide exists", () => {
    paint([]);
    expect(guideRow()?.textContent).toContain("How to read this piece");
  });

  it("does not say nothing was asked when the guide holds a conversation (browser pass)", () => {
    paint([], { guide: thread("spya-gdeabb", "guide") });
    expect(host.textContent).not.toContain("Nothing asked yet.");
    act(() => root.render(createElement("div")));
    paint([]);
    expect(host.textContent).toContain("Nothing asked yet.");
  });

  it("opens the guide when pressed", () => {
    paint([CHAT]);
    act(() => guideRow()?.querySelector<HTMLButtonElement>("button")?.click());
    expect(guideOpened).toBe(1);
  });
});

describe("the guide's greeting", () => {
  const greeting = async () => {
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id });
    await settle();
  };
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
  const startButton = () => button(GUIDE_START_LABEL);
  const keepButton = () => button(KEEP_REASON_LABEL);
  /** The reader answers: the same mount, now with their first message in it. */
  const answer = async (text: string) => {
    const said = thread(EMPTY_GUIDE.id, "guide", {
      messages: [{ id: "spya-gdeq01", role: "user", text, createdAt: AT, status: "done" }],
    });
    paint([CHAT], { guide: said, threadId: said.id });
    await settle();
  };
  const press = async (b: HTMLButtonElement | undefined) => {
    await act(async () => b?.click());
    await settle();
  };

  it("welcomes them to the piece by name, asks why, and draws no box; the panel is headed Guide", async () => {
    await greeting();
    expect(host.textContent).toContain("Hi, I'm your guide to Attention Is All You Need.");
    expect(host.textContent).toContain("Why are you reading it?");
    expect(host.querySelector("textarea#guide-purpose")).toBeNull();
    expect(startButton()).toBeUndefined();
    expect(host.querySelector("h2")?.textContent).toBe("Guide");
  });

  it("quotes About you back and asks if it is still right, when there is one", async () => {
    reader = { ...reader, profile: "A cognitive neuroscientist   who studies memory" };
    await greeting();
    expect(host.textContent).toContain("In About you, you wrote “A cognitive neuroscientist who studies memory”. Is that still right?");
    expect(host.textContent).toContain("why are you reading this one?");
  });

  it("offers the start button, and asks nothing, when a reason is stored; the press sends the fixed question", async () => {
    reader = { ...reader, purpose: "I review for a journal" };
    await greeting();
    expect(host.textContent).toContain("You said you're reading it because “I review for a journal”.");
    expect(host.textContent).not.toContain("Why are you reading it?");
    const start = startButton();
    expect(start).toBeDefined();
    act(() => start?.click());
    expect(sent).toEqual([GUIDE_FIRST_QUESTION]);
  });

  it("points at the profile only when a reason is stored and About you is empty", async () => {
    reader = { ...reader, purpose: "For a journal club" };
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    reader = { ...reader, profile: "A historian of science" };
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).toBeNull();
  });

  it("asks nothing and offers nothing when the reason could not be read", async () => {
    reader = { ...reader, purposeFailed: true };
    await greeting();
    expect(host.textContent).not.toContain("Why are you reading");
    expect(startButton()).toBeUndefined();
    await answer("For my journal club");
    expect(keepButton()).toBeUndefined();
  });

  it("stays above the reader's answer, and keeps their own words as the reason only on a press", async () => {
    await greeting();
    await answer("For my journal club\r\n next week  ");
    expect(host.textContent).toContain("Why are you reading it?");
    expect(patches, "nothing is saved before the press").toEqual([]);
    await press(keepButton());
    expect(patches).toEqual([{ purpose: "For my journal club\n next week" }]);
    expect(host.textContent).toContain(KEPT_REASON_LABEL);
    expect(sent, "keeping it sends nothing").toEqual([]);
  });

  it("does not turn a message sent before the purpose read into an answer to a greeting shown later", async () => {
    let answerRead: ((response: Response) => void) | undefined;
    delayedRead = new Promise<Response>((resolve) => {
      answerRead = resolve;
    });
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id });
    await answer("Where should I start?");
    expect(host.textContent).not.toContain("Why are you reading it?");

    delayedRead = null;
    await act(async () =>
      answerRead?.(
        new Response(JSON.stringify(reader), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(host.textContent).not.toContain("Why are you reading it?");
    expect(keepButton()).toBeUndefined();
  });

  it("does not put a late greeting above the first spoken words", async () => {
    let answerRead: ((response: Response) => void) | undefined;
    delayedRead = new Promise<Response>((resolve) => {
      answerRead = resolve;
    });
    const live = {
      lines: [
        {
          id: "spoken-1",
          role: "reader",
          text: "Where should I start?",
          done: false,
          exchange: "spoken-1",
          session: 0,
          order: 0,
        },
      ],
    } as unknown as LiveApi;
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id, live });
    await settle();

    delayedRead = null;
    await act(async () =>
      answerRead?.(
        new Response(JSON.stringify(reader), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(host.textContent).not.toContain("Why are you reading it?");
  });

  it("never overwrites a reason saved elsewhere since the greeting read", async () => {
    await greeting();
    await answer("For my journal club");
    beforeRead = () => {
      reader = { ...reader, purpose: "Written on Metadata in another tab" };
    };
    await press(keepButton());
    expect(patches).toEqual([]);
    expect(host.textContent).toContain("You had already saved a reason for this one");
  });

  it("writes once for a double press", async () => {
    await greeting();
    await answer("For my journal club");
    const keep = keepButton();
    await act(async () => {
      keep?.click();
      keep?.click();
    });
    await settle();
    expect(patches).toHaveLength(1);
  });

  it("calls a save whose reply was lost kept, when the server has it", async () => {
    await greeting();
    await answer("For my journal club");
    patchLosesReply = true;
    await press(keepButton());
    expect(patches).toHaveLength(1);
    expect(host.textContent).toContain(KEPT_REASON_LABEL);
  });

  it("offers Metadata instead of cutting a message too long to keep", async () => {
    await greeting();
    await answer("x".repeat(601));
    expect(keepButton()).toBeUndefined();
    expect(host.textContent).toContain("Too long to keep");
    act(() => root.unmount());
    root = createRoot(host);
    await greeting();
    await answer("x".repeat(600));
    expect(keepButton()).toBeDefined();
  });

  it("draws no greeting and no keep button on a guide that already had turns", async () => {
    paint([CHAT], { guide: thread("spya-gdeacc", "guide"), threadId: "spya-gdeacc" });
    await settle();
    expect(host.textContent).not.toContain("I'm your guide");
    expect(keepButton()).toBeUndefined();
  });
});
