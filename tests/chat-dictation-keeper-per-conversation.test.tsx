// @vitest-environment jsdom
/**
 * **Chat's box keeps a dictation under the conversation it is about, not only
 * the article.** Its keeper was `chat:<slug>`, so a recording left behind in
 * one conversation was offered back in another on the same article (the
 * Overseer's addendum to spya-vzj8fc, 2026-10-09). The name comes from the
 * caller now (`keepAs`), which is required, so the three places a composer is
 * drawn each have to say what it is about: ChatPanel's conversation and
 * new-conversation boxes, and ChatDialog's passage draft.
 *
 * docs/plans/261009g-dictation-stays-with-its-article-and-the-button-says-its-tricks.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BlockId, ChatThread } from "../src/types.js";

const kept: string[] = [];

vi.mock("../src/web/dictation-keep.js", () => ({
  keepDictation: (box: string) => {
    kept.push(box);
    return { box, begin: () => null, recover: async () => null };
  },
}));
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (opts: { keep?: { box: string } }) => {
    void opts.keep;
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
vi.mock("../src/web/router.js", () => ({
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  parseRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  HELP_HREF: "/help",
}));
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response("{}", { status: 200 }),
  fetchOk: async () => new Response(null, { status: 200 }),
  readJson: async () => ({}),
  failure: async (res: Response) => new Error(await res.text()),
}));
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

const { ChatPanel, Composer } = await import("../src/web/ChatPanel.js");
const { ChatDialog } = await import("../src/web/ChatDialog.js");

const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-k3m9qt",
  title: "One conversation",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  messages: [],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  kept.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(keepAs: string) {
  act(() => {
    root.render(
      createElement(Composer, {
        slug: "a-piece",
        keepAs,
        onSend: () => {},
        busy: false,
        focusNonce: 0,
        focused: { current: 0 },
        draft: "",
        onDraft: () => {},
      }),
    );
  });
}

it("keeps under the name it is given, so two conversations on one article do not share", () => {
  draw("chat:a-piece:thread-one");
  expect(kept.at(-1)).toBe("chat:a-piece:thread-one");
  draw("chat:a-piece:thread-two");
  expect(kept.at(-1)).toBe("chat:a-piece:thread-two");
});

function panel(threadId: string | null) {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat",
        loaded: true,
        loadFailed: false,
        threads: [THREAD],
        threadId,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
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

it("the real ChatPanel callers name the open thread and the new-conversation kind", () => {
  panel(null);
  expect(kept.at(-1)).toBe("chat:a-piece:new:chat");
  panel(THREAD.id);
  expect(kept.at(-1)).toBe(`chat:a-piece:${THREAD.id}`);
});

it("the real ChatDialog caller names the passage draft's block", () => {
  const block = "spya-b7ck01" as BlockId;
  act(() => {
    root.render(
      createElement(ChatDialog, {
        slug: "a-piece",
        at: null,
        blocks: new Map([[block, "A passage"]]),
        target: { kind: "draft", anchor: { blockId: block }, opening: "A passage" },
        onJump: () => {},
        onClose: () => {},
        onThread: () => {},
        onOpenFull: () => {},
        onCreated: () => {},
        onDropped: () => {},
        onRenamed: () => {},
      }),
    );
  });
  expect(kept.at(-1)).toBe(`chat:a-piece:draft:${block}`);
});
