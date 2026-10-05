// @vitest-environment jsdom
/**
 * **A question typed and not sent is in the box when the reader comes back to
 * the mode.** Plan
 * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
 *
 * Asked of what the reader sees: the real band, the real `useChat`, the real
 * panel and its real textarea, with the address rewritten by the code that
 * rewrites it in the app. That last part is the point of half this file. Going
 * to Recall replaces `?thread=` with Recall's own conversation and going to
 * Quiz clears it, so a test that only unmounts the band and mounts it again
 * with the address untouched passes over a reader who comes back to a list
 * (GPT Sol's plan review, F3). So the modes here are the real `RememberBand`
 * and nothing at all, switched the way `Reader` switches them: by rendering a
 * different band, never by editing `thread`.
 *
 * `ChatPanel` is wrapped rather than replaced, so a test can also read what
 * the band handed it — how many conversations there are is not on screen
 * while one of them is open.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatThread } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";
import type { LiveApi, LiveOptions } from "../src/web/live/useLiveConversation.js";
import type { ChatHandoff } from "../src/web/modes/conversation/ConversationModes.js";
import type { QuizSections } from "../src/web/QuizPanel.js";
import type { QuizRead } from "../src/web/useQuiz.js";

/** The props the band last handed the panel. */
let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/ChatPanel.js")>(
    "../src/web/ChatPanel.js",
  );
  return {
    ...real,
    ChatPanel: (props: Parameters<typeof real.ChatPanel>[0]) => {
      panel = props as unknown as Record<string, unknown>;
      return createElement(real.ChatPanel, props);
    },
  };
});

/* The Quiz half fetches an artefact; what matters here is only what arriving
   in it does to `?thread=`, which is `RememberBand`'s. */
vi.mock("../src/web/QuizPanel.js", () => ({
  QuizPanel: () => null,
  RememberSubModeToggle: () => null,
}));

/** What the band told the live session it may use — `speak` is the one wanted. */
let liveOptions: LiveOptions | undefined;
let liveState: Partial<LiveApi> = {};

/* No microphone in jsdom. Normally idle; the handoff test supplies a Live
   session whose stop is deferred. Spoken writes call the band's `speak`
   directly. */
vi.mock("../src/web/live/useLive.js", () => ({
  useLive: (_slug: string, opts: LiveOptions): LiveApi => {
    liveOptions = opts;
    return {
      phase: "idle",
      error: null,
      lines: [],
      pointers: [],
      tools: [],
      hearing: false,
      speaking: false,
      seen: {},
      placement: null,
      inputLevel: { current: 0 },
      measuringInput: false,
      quietInput: false,
      deviceLabel: null,
      playbackBlocked: false,
      enableAudio: async () => {},
      thinking: false,
      pendingTools: [],
      notice: null,
      hasUnsavedLines: false,
      threadId: null,
      start: START,
      stop: STOP,
      say: () => {},
      stall: null,
      reconnect: () => {},
      step: null,
      reconnecting: false,
      talkMode: "hands-free",
      enterTapToTalk: () => {},
      talk: () => {},
      doneTalking: () => {},
      ...liveState,
    } as unknown as LiveApi;
  },
}));
const START = () => {};
const STOP = () => Promise.resolve();

const calls: { url: string; method: string }[] = [];
/** What the list GET answers with. */
let stored: ChatThread[] = [];
/** Whether the list GET fails. */
let failList = false;
/** What a DELETE answers with. */
let deleteStatus = 200;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      if (method === "DELETE") {
        return Promise.resolve(json(deleteStatus === 200 ? {} : { error: "a 500" }, deleteStatus));
      }
      /* A write that is never answered: nothing here waits for one. */
      if (method !== "GET") return new Promise<Response>(() => {});
      return Promise.resolve(failList ? json({ error: "a 500" }, 500) : json({ threads: stored }));
    },
  };
});

const { ConversationBand, RememberBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);

const SLUG = "a-piece";
const AT = "2026-10-04T09:00:00.000Z";

function thread(id: string, kind: ChatThread["kind"], title: string): ChatThread {
  return {
    id,
    kind,
    title,
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
  };
}

const A = thread("spya-mcha02", "chat", "The first conversation");
const RECALL = thread("spya-mcre02", "remember", "What I took from it");

const NO_QUIZ_SECTIONS: QuizSections = { sections: [], rowOf: new Map() };
const QUIZ_READ: QuizRead = {
  status: "none",
  quiz: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  kept: new Map(),
  keptUnread: false,
  noteMark: () => {},
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};

let host: HTMLDivElement;
let root: Root;
let handoff: ChatHandoff | null = null;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgetChatDrafts();
  calls.length = 0;
  stored = [];
  failList = false;
  deleteStatus = 200;
  panel = undefined;
  liveOptions = undefined;
  liveState = {};
  handoff = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  /* nuqs writes the address on a 50 ms throttle; let it land while jsdom still
     owns `location` (tests/remember-own-thread.test.tsx says why). */
  await new Promise((resolve) => setTimeout(resolve, 60));
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** Long enough for nuqs' throttled write to reach the address. */
async function addressSettles(): Promise<void> {
  await settle();
  await act(async () => {
    await new Promise((go) => setTimeout(go, 70));
  });
  await settle();
}

function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

/** A mode the reader can be in. `structure` stands for every mode that is not a conversation. */
type Mode = "chat" | "remember" | "structure";

/**
 * **Switch mode the way `Reader` does**: a different band in the same place,
 * keyed by mode, and only `mode` changed in the address. Whatever `?thread=`
 * says afterwards is what the bands themselves made it say.
 */
async function go(mode: Mode, also: Record<string, string> = {}): Promise<void> {
  const search = new URLSearchParams(location.search);
  search.set("mode", mode);
  for (const [key, value] of Object.entries(also)) search.set(key, value);
  history.replaceState(null, "", `/a-piece?${search.toString()}`);
  panel = undefined;
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          NuqsAdapter,
          null,
          mode === "chat"
            ? createElement(ConversationBand, {
                key: "chat",
                slug: SLUG,
                blocks: new Map<string, string>(),
                onJump: () => {},
                kind: "chat" as const,
                onScreen: () => [],
                handoff,
                onHandoffTaken: () => {
                  handoff = null;
                },
              })
            : mode === "remember"
              ? createElement(RememberBand, {
                  key: "remember",
                  slug: SLUG,
                  quizRead: QUIZ_READ,
                  blocks: new Map<string, string>(),
                  sections: NO_QUIZ_SECTIONS,
                  onJump: () => {},
                })
              : null,
        ),
      ),
    ),
  );
  await addressSettles();
}

/** Arrive on the article in a mode, with nothing else in the address. */
async function arrive(mode: Mode, search = ""): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await go(mode);
}

function box(): HTMLTextAreaElement {
  const el = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
  if (!el) throw new Error("no box to type in");
  return el;
}

async function type(text: string): Promise<void> {
  const el = box();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(title: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!button) throw new Error(`no "${title}" button`);
  await act(async () => button.click());
  await addressSettles();
}

const threads = (): ChatThread[] => (panel?.threads as ChatThread[] | undefined) ?? [];
/** The conversation on screen, or null when the panel is drawing its list. */
const open = (): ChatThread | null => threads().find((t) => t.id === panel?.threadId) ?? null;
const posts = () => calls.filter((c) => c.method === "POST");

function prop<T>(name: string): T {
  const value = panel?.[name];
  if (value === undefined) throw new Error(`the band handed the panel no ${name}`);
  return value as T;
}

describe("Chat keeps an unsent question while another mode is open", () => {
  it("in a conversation with history", async () => {
    stored = [A];
    await arrive("chat", `?thread=${A.id}`);
    await type("and what about the second claim");
    await go("structure");
    await go("chat");
    expect(open()?.id).toBe(A.id);
    expect(box().value).toBe("and what about the second claim");
  });

  it("in the box under the list", async () => {
    stored = [A];
    await arrive("chat");
    expect(open(), "arrived on the list").toBeNull();
    await type("something new entirely");
    await go("structure");
    await go("chat");
    expect(open()).toBeNull();
    expect(box().value).toBe("something new entirely");
  });

  it("in a new conversation nothing was ever sent to: one conversation, the words, nothing sent", async () => {
    await arrive("chat");
    expect(open()?.messages).toHaveLength(0);
    await type("my first question, unfinished");
    await go("structure");
    await go("chat");
    expect(threads(), "the reader's one conversation, not two").toHaveLength(1);
    expect(open()?.messages).toHaveLength(0);
    expect(box().value).toBe("my first question, unfinished");
    expect(posts()).toHaveLength(0);

    /* And again: the conversation begun on the way back is as unsent as the
       one it replaced. */
    await go("structure");
    await go("chat");
    expect(threads()).toHaveLength(1);
    expect(box().value).toBe("my first question, unfinished");
  });

  it("and nothing comes back once it has been sent", async () => {
    stored = [A];
    await arrive("chat", `?thread=${A.id}`);
    await type("a question that goes");
    await act(async () => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(posts()).toHaveLength(1);
    await go("structure");
    await go("chat");
    expect(box().value).toBe("");
  });
});

/**
 * F3. The address does not keep Chat's place across these two: the bands
 * themselves overwrite it, and a stored conversation is then on the list with
 * its words kept and no composer mounted to show them.
 */
describe("the reader is put back in the conversation the words belong to", () => {
  it("after Recall, whose non-chat id returns Chat to its list with the draft still on its row", async () => {
    stored = [A, RECALL];
    await arrive("chat", `?thread=${A.id}`);
    await type("held while I check what I remember");
    await go("remember");
    expect(param("thread"), "Recall did not take the address; this test is not testing F3").toBe(RECALL.id);
    await go("chat");
    expect(open()).toBeNull();
    expect(param("thread")).toBeNull();
    const row = host.querySelector<HTMLButtonElement>(`.chat-thread[data-thread="${A.id}"] .chat-thread-open`);
    expect(row).not.toBeNull();
    await act(async () => row?.click());
    await addressSettles();
    expect(open()?.id).toBe(A.id);
    expect(box().value).toBe("held while I check what I remember");
    expect(param("thread")).toBe(A.id);
  });

  it("keeps an unopened recovered origin draft through a second mode change", async () => {
    stored = [RECALL];
    const handoffOrigin = { mode: "debate" as const, blockId: "spya-bbbbbb", quote: "The claim" };
    handoff = {
      slug: SLUG,
      question: "Check this claim",
      origin: handoffOrigin,
    };
    await arrive("chat");
    await go("remember");
    await go("chat");
    expect(open()).toBeNull();
    expect(threads()).toHaveLength(1);
    expect(param("thread")).toBeNull();
    await go("structure");
    await go("chat");
    expect(open()?.kind).toBe("chat");
    expect(box().value).toBe("Check this claim");
    expect(chatDraftsFor(SLUG).origin(open()?.id as string)).toEqual(handoffOrigin);
    expect(posts()).toHaveLength(0);
  });

  it("after Quiz, which clears `?thread=`", async () => {
    stored = [A, RECALL];
    await arrive("chat", `?thread=${A.id}`);
    await type("held while I take the quiz");
    await go("remember", { remember: "quiz" });
    expect(param("thread"), "Quiz did not clear the address; this test is not testing F3").toBeNull();
    await go("chat");
    expect(open()?.id).toBe(A.id);
    expect(box().value).toBe("held while I take the quiz");
  });

  it("but not over a conversation the address already names", async () => {
    const B = thread("spya-mchb02", "chat", "The second conversation");
    stored = [A, B];
    await arrive("chat", `?thread=${A.id}`);
    await type("left in the first");
    await go("structure");
    /* A link, a Back press, the floating dialog's "Open in full chat". */
    await go("chat", { thread: B.id });
    expect(open()?.id, "the reader's own choice was overruled").toBe(B.id);
    expect(box().value).toBe("");
  });

  it("and with nothing unsent, Chat comes back on its list as it always has", async () => {
    stored = [A, RECALL];
    await arrive("chat", `?thread=${A.id}`);
    await go("remember");
    await go("chat");
    expect(open()).toBeNull();
  });
});

describe("Remember keeps its unsent words by kind", () => {
  it("in Recall's box", async () => {
    stored = [RECALL];
    await arrive("remember");
    expect(open()?.id).toBe(RECALL.id);
    await type("um, so what I took was");
    await go("structure");
    await go("remember");
    expect(box().value).toBe("um, so what I took was");
  });

  /* F4. The conversation the words were typed into was this tab's own, empty,
     and is gone; the band picks the stored one, and the words go to whichever
     it picks. */
  it("and hands them to a stored Recall conversation that has appeared meanwhile", async () => {
    await arrive("remember");
    expect(open()?.messages).toHaveLength(0);
    await type("typed before the other tab sent");
    await go("structure");
    stored = [RECALL];
    await go("remember");
    expect(open()?.id).toBe(RECALL.id);
    expect(threads()).toHaveLength(1);
    expect(box().value).toBe("typed before the other tab sent");
  });

  it("without Recall's words turning up in Tutorial's box", async () => {
    await arrive("remember");
    await type("Recall's words");
    await go("structure");
    await go("remember", { remember: "tutorial" });
    expect(open()?.kind).toBe("tutorial");
    expect(box().value).toBe("");
  });

  /* F8. Start over does not clear the box, so a refused delete cannot lose
     what was in it. */
  it("and a refused Start over leaves the words in the box", async () => {
    stored = [RECALL];
    deleteStatus = 500;
    await arrive("remember");
    await type("a follow-up I had not sent");
    await act(async () => prop<(id: string) => void>("onDelete")(RECALL.id));
    await addressSettles();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(open()?.id, "the refused delete did not put the conversation back").toBe(RECALL.id);
    expect(box().value).toBe("a follow-up I had not sent");
  });
});

describe("what is not recreated", () => {
  it("keeps words typed into the local conversation begun after a failed list load", async () => {
    failList = true;
    await arrive("chat");
    expect(panel?.loadFailed).toBe(true);
    expect(open()?.messages).toHaveLength(0);
    const was = open()?.id as string;
    await type("a question typed while the list was unavailable");
    await go("structure");
    failList = false;
    await go("chat");
    expect(threads()).toHaveLength(1);
    expect(open()?.id).not.toBe(was);
    expect(box().value).toBe("a question typed while the list was unavailable");
    expect(posts()).toHaveLength(0);
  });

  /* F1. A list that failed to load says nothing about which conversations
     exist, so nothing is recovered into a new one on the strength of it. */
  it("a stored conversation's words, when the list fails to load on the way back", async () => {
    stored = [A];
    await arrive("chat", `?thread=${A.id}`);
    await type("a follow-up to the first conversation");
    await go("structure");
    failList = true;
    await go("chat");
    expect(panel?.loadFailed).toBe(true);
    const drafts = chatDraftsFor(SLUG);
    for (const t of threads()) {
      expect(drafts.thread(t.id) ?? "", "the follow-up was moved into a new conversation").toBe("");
    }
    expect(drafts.thread(A.id), "and it is still kept for the conversation it was typed in").toBe(
      "a follow-up to the first conversation",
    );
  });

  it("a never-sent conversation's words either, on a failed load", async () => {
    await arrive("chat");
    const was = open()?.id as string;
    await type("my first question");
    await go("structure");
    failList = true;
    await go("chat");
    const drafts = chatDraftsFor(SLUG);
    for (const t of threads()) expect(drafts.thread(t.id) ?? "").toBe("");
    expect(drafts.thread(was)).toBe("my first question");
  });

  /* F2. Only the place the reader was in is recovered. */
  it("a closed never-sent conversation, over the conversation the reader was in", async () => {
    stored = [A];
    await arrive("chat");
    await press("Start a new conversation");
    await type("words in a conversation I then closed");
    await press("All conversations");
    expect(threads(), "closing kept the unsent conversation, as it does").toHaveLength(2);
    await act(async () => prop<(id: string | null) => void>("onThread")(A.id));
    await addressSettles();
    await type("words in the one I am in");
    await go("structure");
    await go("chat");
    expect(open()?.id).toBe(A.id);
    expect(box().value).toBe("words in the one I am in");
    expect(threads().map((t) => t.id)).toEqual([A.id]);
  });

  it("a closed never-sent conversation, over the list the reader was on", async () => {
    stored = [A];
    await arrive("chat");
    await press("Start a new conversation");
    await type("words in a conversation I then closed");
    await press("All conversations");
    await type("words in the list's box");
    await go("structure");
    await go("chat");
    expect(open(), "the reader was on the list").toBeNull();
    expect(box().value).toBe("words in the list's box");
    expect(threads().map((t) => t.id)).toEqual([A.id]);
  });

  /* F9. "Never submitted" is revoked by a spoken exchange, which changes the
     conversation without the typed draft changing at all. */
  it("a conversation that was spoken to, though its typed words never changed", async () => {
    await arrive("chat");
    const was = open()?.id as string;
    await type("typed while talking");
    expect(chatDraftsFor(SLUG).isFresh(was)).toBe(true);
    await act(async () => {
      void liveOptions
        ?.speak?.({ threadId: was, question: "said aloud", answer: "answered aloud", expectedTailId: null })
        .catch(() => {});
    });
    await settle();
    expect(chatDraftsFor(SLUG).isFresh(was), "a spoken exchange left it never-submitted").toBe(false);
    expect(chatDraftsFor(SLUG).thread(was)).toBe("typed while talking");

    /* Deleted in another tab while the reader was away. */
    await go("structure");
    stored = [];
    await go("chat");
    for (const t of threads()) {
      expect(chatDraftsFor(SLUG).thread(t.id) ?? "", "recreated a conversation that had been spoken to").toBe("");
    }
  });

  it("a conversation a typed question was sent to", async () => {
    await arrive("chat");
    const was = open()?.id as string;
    expect(chatDraftsFor(SLUG).isFresh(was)).toBe(true);
    await act(async () => prop<(q: string) => void>("onSend")("the first question"));
    await settle();
    expect(chatDraftsFor(SLUG).isFresh(was)).toBe(false);
  });

  it("a typed submission awaiting Live hang-up, even when another draft is typed during the wait", async () => {
    await arrive("chat");
    const was = open()?.id as string;
    let finishStop!: () => void;
    const stopping = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    liveState = { phase: "live", threadId: was, stop: () => stopping };
    await go("chat");
    await type("the question I press Send on");
    try {
      await act(async () => {
        box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(box().value).toBe("");
      expect(posts(), "Send must still wait for Live").toHaveLength(0);
      await type("a follow-up typed during the hang-up");
      await go("structure");
      liveState = {};
      await go("chat");
      expect(
        box().value,
        "a follow-up was restored into a conversation without its first question",
      ).toBe("");
      expect(chatDraftsFor(SLUG).thread(was)).toBe("a follow-up typed during the hang-up");
      expect(chatDraftsFor(SLUG).isFresh(was)).toBe(false);
    } finally {
      await act(async () => finishStop());
      await addressSettles();
    }
  });
});

/**
 * F7. Arriving with no stored conversations opens one; arriving with words
 * waiting in the list's box, on the list, must not — the new conversation's
 * empty composer would be drawn in place of the box the words are in.
 */
describe("words in the list's box, with no conversations stored", () => {
  it("bring the reader back to the list and the words, not to a new empty conversation", async () => {
    await arrive("chat");
    expect(open()?.messages, "arrival opened a conversation, as it does").toHaveLength(0);
    await press("All conversations");
    expect(threads(), "closing an unused conversation discards it").toHaveLength(0);
    await type("typed under an empty list");
    await go("structure");
    await go("chat");
    expect(threads(), "a new empty conversation hid the words").toHaveLength(0);
    expect(box().value).toBe("typed under an empty list");
    expect(box().placeholder).toBe("Ask something new…");
  });

  it("and with the box empty, arrival still opens a conversation", async () => {
    await arrive("chat");
    await press("All conversations");
    await go("structure");
    await go("chat");
    expect(threads()).toHaveLength(1);
    expect(open()?.messages).toHaveLength(0);
  });
});

/**
 * F10. A handed-over question the reader never touched is still theirs to
 * lose: it is in the box, so it has to be where a mode change looks.
 */
describe("a question handed over from another mode", () => {
  const QUESTION = 'What does "axiom" mean here?';

  it("survives the round trip untouched, in one conversation", async () => {
    handoff = { slug: SLUG, question: QUESTION };
    await arrive("chat");
    expect(box().value).toBe(QUESTION);
    expect(handoff, "the owner was told to forget it").toBeNull();
    await go("structure");
    await go("chat");
    expect(threads()).toHaveLength(1);
    expect(box().value).toBe(QUESTION);
    expect(posts()).toHaveLength(0);
  });

  it("survives untouched when the list load failed on handoff arrival", async () => {
    failList = true;
    handoff = { slug: SLUG, question: QUESTION };
    await arrive("chat");
    expect(panel?.loadFailed).toBe(true);
    expect(box().value).toBe(QUESTION);
    await go("structure");
    failList = false;
    await go("chat");
    expect(threads()).toHaveLength(1);
    expect(box().value).toBe(QUESTION);
    expect(posts()).toHaveLength(0);
  });

  it("and once cleared, stays cleared", async () => {
    handoff = { slug: SLUG, question: QUESTION };
    await arrive("chat");
    await act(async () => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(box().value).toBe("");
    await go("structure");
    await go("chat");
    expect(box().value).toBe("");
  });
});

describe("a conversation that goes takes its words with it", () => {
  it("when it is closed unused: discarded, forgotten, and the list is where Chat was", async () => {
    await arrive("chat");
    const was = open()?.id as string;
    await type("typed and then rubbed out");
    await type("");
    await press("All conversations");
    expect(threads()).toHaveLength(0);
    const drafts = chatDraftsFor(SLUG);
    expect(drafts.thread(was)).toBeUndefined();
    expect(drafts.isFresh(was)).toBe(false);
    expect(drafts.destination()).toBeNull();
  });

  it("when it is deleted from the panel", async () => {
    stored = [A];
    await arrive("chat", `?thread=${A.id}`);
    await type("a follow-up to a conversation about to go");
    await act(async () => prop<(id: string) => void>("onDelete")(A.id));
    await addressSettles();
    expect(chatDraftsFor(SLUG).thread(A.id)).toBeUndefined();
    await go("structure");
    await go("chat");
    expect(open()?.id).not.toBe(A.id);
    expect(box().value).toBe("");
  });
});
