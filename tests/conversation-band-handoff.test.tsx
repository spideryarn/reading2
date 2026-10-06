// @vitest-environment jsdom
/**
 * **A handed-over question opens exactly one fresh conversation, and only in
 * its own article.**
 *
 * tests/glossary-ask-in-chat.test.tsx drives the whole app and reads what the
 * reader sees; what it cannot count is how many conversations the band minted
 * along the way, because an open conversation hides the list. That is the
 * StrictMode question — src/web/chat-handoff.ts records the module-level cell
 * this replaced firing twice under StrictMode — so it is asked here, against
 * the real band and the real `useChat`, with `ChatPanel` stubbed to expose the
 * props it is handed. The harness is tests/conversation-band-send-new.test.tsx's.
 *
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § C.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";
import type { ChatHandoff } from "../src/web/modes/conversation/ConversationModes.js";

/** The props the band last handed down. */
let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

const calls: { url: string; method: string; body?: unknown }[] = [];
/** What the list GET answers with. */
let stored: ChatThread[] = [];
/** Whether the list GET waits to be released, so "before the list arrives" is a state. */
let holdList = false;
let release: (() => void) | null = null;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
      });
      const answer = () =>
        new Response(JSON.stringify({ threads: stored }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      /* Only the list waits. A POST made meanwhile is answered at once, so
         releasing lets go of the list and of nothing else. */
      if (!holdList || (init?.method ?? "GET") !== "GET") return Promise.resolve(answer());
      return new Promise<Response>((go) => {
        const earlier = release;
        release = () => {
          earlier?.();
          go(answer());
        };
      });
    },
  };
});

const { ConversationBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);

const SLUG = "a-piece";
const QUESTION = 'What does "axiom" mean, and does it have anything to do with what this article is saying?';

let host: HTMLDivElement;
let root: Root;
let taken = 0;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgetChatDrafts();
  calls.length = 0;
  stored = [];
  holdList = false;
  release = null;
  panel = undefined;
  taken = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

function band(handoff: ChatHandoff | null) {
  return createElement(
    StrictMode,
    null,
    createElement(
      NuqsAdapter,
      null,
      createElement(ConversationBand, {
        slug: SLUG,
        blocks: new Map<string, string>(),
        onJump: () => {},
        kind: "chat" as const,
        onScreen: () => [],
        handoff,
        onHandoffTaken: () => {
          taken += 1;
        },
      }),
    ),
  );
}

async function mount(handoff: ChatHandoff | null): Promise<void> {
  history.replaceState(null, "", "/a-piece?mode=chat");
  await act(async () => root.render(band(handoff)));
  await settle();
  /* The address follows behind nuqs' throttle; wait for it rather than leave a
     queued write to outlive the page (docs/postmortems/260906c-…). */
  await vi.waitFor(() => {
    expect(new URLSearchParams(location.search).get("thread")).toBe(panel?.threadId ?? null);
  });
}

const threads = (): ChatThread[] => (panel?.threads as ChatThread[] | undefined) ?? [];

/** One of the props the band handed the panel, or a failure saying it handed none. */
function prop<T>(name: string): T {
  const value = panel?.[name];
  if (value === undefined) throw new Error(`the band handed the panel no ${name}`);
  return value as T;
}

const posts = () => calls.filter((c) => c.method === "POST");

/**
 * **A hand-off that sends: the press on *Ask in chat* was the Send.** Greg,
 * 2026-10-06 (spya-x896vu): *"When I click "ask in Chat" anywhere,
 * automatically submit the input (rather than just prefilling the input box
 * and waiting for me to hit send)"*.
 * docs/plans/261006j-ask-in-chat-sends-the-question.md.
 */
describe("ConversationBand's handoff that sends", () => {
  it("sends the question once under StrictMode, to the one conversation it began", async () => {
    await mount({ slug: SLUG, question: QUESTION, send: true });

    expect(threads()).toHaveLength(1);
    const fresh = threads()[0] as ChatThread;
    expect(panel?.threadId).toBe(fresh.id);
    expect(posts(), "one press, one model call").toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({ question: QUESTION, threadId: fresh.id });
    /* Sent, so not also waiting in the box to be sent again. */
    expect(chatDraftsFor(SLUG).thread(fresh.id) ?? "").toBe("");
    expect(chatDraftsFor(SLUG).isFresh(fresh.id), "something has been submitted to it").toBe(false);
    /* The answer is arriving and there is nothing to edit: no caret, so no
       soft keyboard over the answer and ↑/↓ still step the article. */
    expect(panel?.focusNonce).toBe(0);
    expect(taken).toBeGreaterThan(0);
  });

  it("sends the origin with it", async () => {
    const origin = { mode: "glossary", itemId: "spya-aaaaaa", quote: "axiom" } as const;
    await mount({ slug: SLUG, question: QUESTION, send: true, origin });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({ question: QUESTION, origin });
  });

  it("does not send again when the band re-renders with the same handoff", async () => {
    const handoff = { slug: SLUG, question: QUESTION, send: true };
    await mount(handoff);
    await act(async () => root.render(band(handoff)));
    await settle();
    expect(threads()).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  /**
   * **Before the list has arrived**, which is when a press from another mode
   * always lands: the band is mounted by the press. `begin` puts the
   * conversation in the list on the spot, so the send has somewhere to go,
   * and the arrival rule must not begin a second one when the list lands.
   * GPT Sol's review of the plan, PR-6.
   */
  it("sends once while the list is still loading, and begins no second conversation when it lands", async () => {
    holdList = true;
    history.replaceState(null, "", "/a-piece?mode=chat");
    await act(async () => root.render(band({ slug: SLUG, question: QUESTION, send: true })));
    await settle();
    expect(posts()).toHaveLength(1);
    const sentTo = (posts()[0]?.body as { threadId: string }).threadId;
    expect(panel?.threadId).toBe(sentTo);

    await act(async () => release?.());
    await settle();
    expect(panel?.loaded).toBe(true);
    expect(posts(), "the list landing sends nothing more").toHaveLength(1);
    expect(panel?.threadId).toBe(sentTo);
    expect(threads().filter((t) => t.messages.length === 0 && t.id !== sentTo), "no second, empty conversation").toHaveLength(0);
  });

  it("sends nothing for a question asked in another article", async () => {
    await mount({ slug: "another-piece", question: QUESTION, send: true });
    expect(posts()).toHaveLength(0);
  });
});

describe("ConversationBand's handoff", () => {
  it("mints one conversation under StrictMode, seeds it, and opens it", async () => {
    await mount({ slug: SLUG, question: QUESTION, send: false });

    /* One, not two — and not a second, empty one from the arrival rule either,
       which fires on exactly this state (no conversations, list loaded). */
    expect(threads()).toHaveLength(1);
    const fresh = threads()[0] as ChatThread;
    expect(fresh.messages).toHaveLength(0);
    expect(panel?.threadId).toBe(fresh.id);
    /* The question is that conversation's unsent words — written into the
       article's drafts by the band, which is where the panel's composer reads
       from and where a mode change leaves them. */
    expect(chatDraftsFor(SLUG).thread(fresh.id)).toBe(QUESTION);
    expect(panel?.focusNonce, "the composer is told to take the caret").toBe(1);
    expect(taken, "the owner is told to forget it").toBeGreaterThan(0);
    expect(calls.filter((c) => c.method === "POST"), "nothing is sent").toHaveLength(0);
  });

  it("is fresh beside a conversation the reader already has", async () => {
    stored = [
      {
        id: "spya-k3m9qt",
        kind: "chat",
        title: "An earlier conversation",
        createdAt: "2026-08-27T10:00:00.000Z",
        updatedAt: "2026-08-27T10:00:00.000Z",
        messages: [],
      },
    ];
    await mount({ slug: SLUG, question: QUESTION, send: false });
    expect(threads().map((t) => t.id)).toContain("spya-k3m9qt");
    expect(threads()).toHaveLength(2);
    expect(panel?.threadId).not.toBe("spya-k3m9qt");
    expect(chatDraftsFor(SLUG).thread(panel?.threadId as string)).toBe(QUESTION);
    expect(chatDraftsFor(SLUG).thread("spya-k3m9qt"), "the earlier conversation's box was written to").toBeUndefined();
  });

  it("does not take the same handoff twice when the band re-renders with it", async () => {
    const handoff = { slug: SLUG, question: QUESTION, send: false };
    await mount(handoff);
    await act(async () => root.render(band(handoff)));
    await settle();
    expect(threads()).toHaveLength(1);
  });

  /**
   * **The arrival rule's latch, and the one window it is for.** The handoff is
   * taken before the list has arrived. If the reader closes that conversation
   * straight away — nothing sent, so it is discarded — and the list then comes
   * back empty, "no conversations, list loaded" is exactly what the arrival rule
   * fires on, and without the latch it hands them a new empty conversation in
   * place of the one they just closed.
   */
  it("does not reopen an empty conversation after the reader closes the handed-over one", async () => {
    holdList = true;
    history.replaceState(null, "", "/a-piece?mode=chat");
    await act(async () => root.render(band({ slug: SLUG, question: QUESTION, send: false })));
    await settle();
    expect(threads()).toHaveLength(1);
    const fresh = (threads()[0] as ChatThread).id;

    await act(async () => {
      prop<(id: string) => void>("onDiscard")(fresh);
      prop<(id: string | null) => void>("onThread")(null);
    });
    await settle();
    expect(threads()).toHaveLength(0);

    await act(async () => release?.());
    await settle();
    await vi.waitFor(() => {
      expect(new URLSearchParams(location.search).get("thread")).toBeNull();
    });
    expect(panel?.loaded).toBe(true);
    expect(threads(), "the list the reader asked for, not a new conversation").toHaveLength(0);
  });

  it("drops a question asked in another article, and starts only the ordinary empty one", async () => {
    await mount({ slug: "another-piece", question: QUESTION, send: false });
    expect(taken, "refused, but still handed back").toBeGreaterThan(0);
    for (const t of threads()) expect(chatDraftsFor(SLUG).thread(t.id)).toBeUndefined();
    for (const t of threads()) expect(chatDraftsFor("another-piece").thread(t.id)).toBeUndefined();
    /* The arrival rule's own conversation: nothing stored, so one empty one —
       the behaviour with no handoff at all. */
    expect(threads()).toHaveLength(1);
    expect(panel?.focusNonce).toBe(1);
  });
});
