// @vitest-environment jsdom
/**
 * **What Chat's box does with its "Bringing in" row when the words change
 * without a key, and when a send's outcome is unknown** — plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md, Sol's round-2
 * findings R2-2 and R2-3 (docs/plans/261012d-round-2-fix-check-sol.md).
 *
 * - A mentioned follow-up in a conversation that already exists, whose request
 *   ends before `begin` without a refusal (an empty stream, a lost network),
 *   leaves the box usable: the submitted chips go, and the words do not come
 *   back, since the turn may have been written.
 * - Dictation moves an inserted `@Title`'s anchor as typing does, so × on its
 *   chip still takes out exactly that title.
 * - The row is kept with the draft, so a box drawn again (a mode change, the
 *   dialog) has its chips and sends them.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, LibraryEntry } from "../src/types.js";
import type { SendHow } from "../src/web/ChatPanel.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";
import { settleChat } from "./helpers/settle-chat.js";

/** What the dictation hook was last told to call with new words. */
let dictateInto: ((next: string) => void) | undefined;

vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (opts: { onChange(next: string): void }) => {
    dictateInto = opts.onChange;
    return {
      dictation: { supported: false, armed: false, transcribing: false, toggle: () => {} },
      readOnly: false,
      busy: false,
      toggle: () => {},
      sendingAfter: false,
      doubleStop: true,
    };
  },
}));

const SLUG = "open-one";
const AT = "2026-10-12T10:00:00.000Z";

function entry(slug: string, title: string): LibraryEntry {
  return {
    slug,
    title,
    addedAt: AT,
    lastOpenedAt: AT,
    words: 100,
    minutes: 1,
    blocks: 3,
    parts: 1,
    sections: 1,
    comments: 0,
    sourceReusable: true,
    opens: 1,
    has: { arc: false, tweets: false, glossary: false },
  } as LibraryEntry;
}

const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-thrd22",
  title: "t",
  createdAt: AT,
  updatedAt: AT,
  messages: [
    { id: "spya-qstn23", role: "user", text: "q", createdAt: AT, status: "done" },
    { id: "spya-answ23", role: "assistant", text: "a", createdAt: AT, status: "done" },
  ],
};

/** What the next POST does: a 200 stream with these frames, or a lost network. */
let reply: { frames: string } | "network";
let posts: Record<string, unknown>[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "GET") {
        if (u.includes("/api/library")) {
          return Promise.resolve(json({ articles: u.includes("archived=1") ? [] : [entry("reply-to-jones", "Reply to Jones")] }));
        }
        return Promise.resolve(json({ threads: [THREAD] }));
      }
      posts.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
      if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(new Response(reply.frames, { status: 200 }));
    },
  };
});

const { Composer } = await import("../src/web/ChatPanel.js");
const { useChat } = await import("../src/web/useChat.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sent: { question: string; how: SendHow | undefined }[];
let activeLive: LiveApi | undefined;

const box = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-input") as HTMLTextAreaElement;
const chips = () => host.querySelector(".mention-chips");

async function type(text: string): Promise<void> {
  const el = box();
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  /* The list's one fetch. */
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise((go) => setTimeout(go, 0));
  });
}

function press(key: string): void {
  act(() => {
    box().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  forgetChatDrafts();
  dictateInto = undefined;
  activeLive = undefined;
  sent = [];
  posts = [];
  reply = { frames: "" };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/**
 * The box under an open conversation, sending through the real `useChat` the
 * way ChatDialog's conversation arm does: no navigation callback of its own.
 */
function InThread() {
  const chat = useChat(SLUG);
  return createElement(Composer, {
    slug: SLUG,
    keepAs: `chat:${SLUG}:${THREAD.id}`,
    onSend: (question: string, how?: SendHow) =>
      void chat.send(THREAD.id, question, null, {
        ...(how?.modality ? { modality: how.modality } : {}),
        ...(how?.mentions ? { mentions: how.mentions } : {}),
      }),
    busy: false,
    focusNonce: 0,
    focused: { current: 0 },
    draft: "",
    onDraft: () => {},
    kind: "chat",
  });
}

describe("a mentioned follow-up whose outcome is unknown", () => {
  for (const outcome of ["an empty stream", "a lost network"] as const) {
    it(`leaves an open conversation's box usable after ${outcome}, without its chips or its words`, async () => {
      reply = outcome === "an empty stream" ? { frames: "" } : "network";
      await act(async () => root.render(createElement(InThread)));
      await settleChat();
      await type("compare with @jon");
      press("Enter");
      expect(chips()?.textContent).toContain("Reply to Jones");
      await type("compare the two");
      press("Enter");
      await settleChat();
      expect(posts[0]?.mentions).toEqual(["reply-to-jones"]);
      expect(chips(), "the submitted chips are gone").toBeNull();
      expect(box().value, "the words are not offered again").toBe("");
      /* And it is not latched: another question goes. */
      reply = { frames: "" };
      await type("and again");
      press("Enter");
      await settleChat();
      expect(posts).toHaveLength(2);
      expect(posts[1]).not.toHaveProperty("mentions");
    });
  }
});

/** A box whose draft is kept in the article's store, as ChatPanel keeps a conversation's. */
function Kept() {
  const drafts = chatDraftsFor(SLUG);
  return createElement(Composer, {
    slug: SLUG,
    keepAs: `chat:${SLUG}:${THREAD.id}`,
    onSend: (question: string, how?: SendHow) => {
      sent.push({ question, how });
    },
    busy: false,
    focusNonce: 0,
    focused: { current: 0 },
    draft: drafts.thread(THREAD.id) ?? "",
    onDraft: (text: string) => drafts.setThread(THREAD.id, text),
    draftMentions: drafts.threadMentions(THREAD.id),
    onDraftMentions: (picked) => drafts.setThreadMentions(THREAD.id, picked),
    kind: "chat",
    live: activeLive,
  });
}

describe("the row and the words, kept in step", () => {
  it("restores and unlatches a mentioned question when the Live handoff fails before Chat sends it", async () => {
    const live = {
      phase: "live",
      stop: vi.fn(() => Promise.reject(new Error("the Live channel closed during handoff"))),
    } as unknown as LiveApi;
    activeLive = live;
    await act(async () => root.render(createElement(Kept)));
    await type("compare with @jon");
    press("Enter");
    expect(box().value).toBe("compare with @Reply to Jones ");
    press("Enter");
    await settleChat();
    expect(sent, "Chat was never called").toEqual([]);
    expect(box().value, "the definitely-unsent words came back").toBe("compare with @Reply to Jones ");
    expect(chips()?.textContent, "the definitely-unsent row came back").toContain("Reply to Jones");
    /* The failed Live session no longer needs a handoff. A second Enter proves
       the mention gate was released as well as the words being restored. */
    live.phase = "failed";
    press("Enter");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.how?.mentions?.slugs).toEqual(["reply-to-jones"]);
  });

  it("moves an @Title's anchor when dictation writes before it, so × takes out exactly that title", async () => {
    await act(async () => root.render(createElement(Kept)));
    await type("compare with @jon");
    press("Enter");
    expect(box().value).toBe("compare with @Reply to Jones ");
    act(() => dictateInto?.(`please ${box().value}`));
    expect(box().value).toBe("please compare with @Reply to Jones ");
    act(() => host.querySelector<HTMLButtonElement>(".mention-chip-x")?.click());
    expect(box().value).toBe("please compare with ");
    expect(chips()).toBeNull();
  });

  it("keeps the row with the draft, so a box drawn again has its chip and sends it", async () => {
    await act(async () => root.render(createElement(Kept)));
    await type("compare with @jon");
    press("Enter");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(Kept)));
    expect(box().value).toBe("compare with @Reply to Jones ");
    expect(chips()?.textContent).toContain("Reply to Jones");
    /* Its anchor came back too: × still takes the title out. */
    act(() => host.querySelector<HTMLButtonElement>(".mention-chip-x")?.click());
    expect(box().value).toBe("compare with ");
    await type("compare with @jon");
    press("Enter");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(Kept)));
    press("Enter");
    expect(sent[0]?.how?.mentions?.slugs).toEqual(["reply-to-jones"]);
  });

  it("drops a kept chip whose @Title is no longer where it was written", async () => {
    const drafts = chatDraftsFor(SLUG);
    drafts.setThread(THREAD.id, "something else now");
    drafts.setThreadMentions(THREAD.id, [{ slug: "reply-to-jones", title: "Reply to Jones", insertedAt: 13 }]);
    await act(async () => root.render(createElement(Kept)));
    expect(chips()).toBeNull();
    expect(drafts.threadMentions(THREAD.id)).toEqual([]);
  });

  it("starts with an empty row for a draft kept before rows were", async () => {
    chatDraftsFor(SLUG).setThread(THREAD.id, "just words");
    await act(async () => root.render(createElement(Kept)));
    expect(box().value).toBe("just words");
    expect(chips()).toBeNull();
  });
});
