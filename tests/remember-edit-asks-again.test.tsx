// @vitest-environment jsdom
/**
 * **Rewriting a question in Recall asks it again.**
 *
 * Report spya-f3b6ab (Greg, 2026-10-01): *"I tried editing a previous message
 * in Recall mode, hoping that it would then trigger a response to that
 * modified message, but it didn't."*
 *
 * Asked end to end on the client: the real Remember band, the real `useChat`
 * and the real `ChatPanel`, with only the network and the live session faked.
 * The pencil is pressed, the question rewritten, Ask again pressed — and then
 * the request that leaves and the answer that streams back are what is checked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

const calls: { method: string; body: Record<string, unknown> | undefined }[] = [];
let stored: ChatThread[] = [];
let answer: ReadableStreamDefaultController<Uint8Array> | null = null;
function frame(event: string, data: unknown): void {
  answer?.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      if (method === "POST") {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            answer = controller;
          },
        });
        return Promise.resolve(
          new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ threads: stored }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
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

const { ConversationBand } = await import("../src/web/modes/conversation/ConversationModes.js");

const AT = "2026-10-01T18:00:00.000Z";
const REMEMBER: ChatThread = {
  id: "spya-jxcxj7",
  kind: "remember",
  title: "What I took from it",
  createdAt: AT,
  updatedAt: AT,
  messages: [
    { id: "spya-q1q1q1", role: "user", text: "What I first said", createdAt: AT, status: "done" },
    {
      id: "spya-a1a1a1",
      role: "assistant",
      text: "A first answer",
      createdAt: AT,
      status: "done",
      stance: "balanced",
    },
    { id: "spya-q2q2q2", role: "user", text: "What I said next", createdAt: AT, status: "done" },
    {
      id: "spya-a2a2a2",
      role: "assistant",
      text: "A second answer",
      createdAt: AT,
      status: "done",
      stance: "balanced",
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  stored = [REMEMBER];
  answer = null;
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
  history.replaceState(null, "", `/a-piece?mode=remember&thread=${REMEMBER.id}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(ConversationBand, {
          slug: "a-piece",
          blocks: new Map<string, string>(),
          onJump: () => {},
          kind: "remember",
        }),
      ),
    );
  });
  await settle();
}

/** Set a controlled textarea's value the way React notices. */
function type(box: HTMLTextAreaElement, text: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

const posted = () => calls.filter((c) => c.method === "POST").map((c) => c.body ?? {});

async function rewrite(which: number, text: string): Promise<void> {
  const pencils = [...host.querySelectorAll<HTMLButtonElement>('button[title="Rewrite this question"]')];
  expect(pencils.length, "a pencil on each of the reader's questions").toBe(2);
  await act(async () => pencils[which]?.click());
  const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
  expect(box, "the editor opened").not.toBeNull();
  await act(async () => type(box as HTMLTextAreaElement, text));
  const ask = host.querySelector<HTMLButtonElement>('button[title="Ask again (Enter)"]');
  expect(ask, "Ask again is offered").not.toBeNull();
  await act(async () => ask?.click());
  await settle();
}

describe("rewriting a question in Recall", () => {
  it("sends the rewritten question to be answered again", async () => {
    await mount();
    await rewrite(0, "What I meant to say");
    expect(posted()).toHaveLength(1);
    expect(posted()[0]).toEqual({ threadId: REMEMBER.id, edit: "spya-q1q1q1", question: "What I meant to say", at: null, expectedTailId: "spya-a2a2a2" });
    expect(posted()[0]).toMatchObject({
      threadId: REMEMBER.id,
      edit: "spya-q1q1q1",
      question: "What I meant to say",
    });
  });

  it("draws the answer to the rewritten question as it streams in", async () => {
    await mount();
    await rewrite(1, "What I meant next");
    expect(posted()).toHaveLength(1);
    await act(async () => {
      frame("begin", {
        threadId: REMEMBER.id,
        title: REMEMBER.title,
        messageId: "spya-a3a3a3",
        questionId: "spya-q2q2q2",
        attempt: "an-attempt",
      });
      frame("delta", { text: "A fresh answer" });
    });
    await settle();
    expect(host.textContent).toContain("What I meant next");
    expect(host.textContent).toContain("A fresh answer");
    expect(host.textContent).not.toContain("A second answer");
  });

  it("works on a question asked in this tab, under the ids the server gave it", async () => {
    stored = [];
    await mount();
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    expect(box, "Remember begins a conversation and offers a composer").not.toBeNull();
    await act(async () => type(box as HTMLTextAreaElement, "What I first said"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
    await settle();
    expect(posted()).toHaveLength(1);
    const threadId = posted()[0]?.threadId as string;
    await act(async () => {
      frame("begin", {
        threadId,
        title: "What I first said",
        messageId: "spya-srvans",
        questionId: "spya-srvqst",
        attempt: "an-attempt",
      });
      frame("delta", { text: "A first answer" });
      frame("done", { text: "A first answer", status: "done", citations: [], searches: 0, model: "m" });
      answer?.close();
    });
    await settle();
    expect(host.textContent).toContain("A first answer");

    const pencil = host.querySelector<HTMLButtonElement>('button[title="Rewrite this question"]');
    expect(pencil, "a pencil on the question just asked").not.toBeNull();
    await act(async () => pencil?.click());
    const editor = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    await act(async () => type(editor as HTMLTextAreaElement, "What I meant to say"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Ask again (Enter)"]')?.click());
    await settle();
    expect(posted()).toHaveLength(2);
    expect(posted()[1]).toEqual({
      threadId,
      edit: "spya-srvqst",
      question: "What I meant to say",
      at: null,
      expectedTailId: "spya-srvans",
    });
  });
});

/* The one weakness the investigation of spya-f3b6ab found: an editor already
   open when an answer starts arriving cannot ask again until it finishes, and
   used to decline without a word — Enter did nothing, the tick was greyed out.
   docs/postmortems/261002g-a-refusal-with-no-voice.md names the class. */
describe("an editor that cannot ask again yet says why", () => {
  async function editorOpenWhileAnswering(): Promise<HTMLTextAreaElement> {
    await mount();
    const pencils = host.querySelectorAll<HTMLButtonElement>('button[title="Rewrite this question"]');
    await act(async () => pencils[0]?.click());
    const editor = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    expect(editor, "the editor opened").not.toBeNull();
    await act(async () => type(editor as HTMLTextAreaElement, "What I meant to say"));
    // Something else asked from the composer, so an answer is now arriving.
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    await act(async () => type(box as HTMLTextAreaElement, "And another thing"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
    await settle();
    expect(posted(), "the composer's question went out").toHaveLength(1);
    return host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box") as HTMLTextAreaElement;
  }

  const said = () => host.querySelector(".chat-edit-held")?.textContent ?? "";

  it("on Enter: says so beside the editor, sends nothing, keeps the text", async () => {
    const editor = await editorOpenWhileAnswering();
    expect(said()).toBe("");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(posted()).toHaveLength(1);
    expect(said()).toMatch(/still arriving/);
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box")?.value).toBe(
      "What I meant to say",
    );
  });

  it("on the tick: the same", async () => {
    await editorOpenWhileAnswering();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click(),
    );
    await settle();
    expect(posted()).toHaveLength(1);
    expect(said()).toMatch(/still arriving/);
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box")?.value).toBe(
      "What I meant to say",
    );
  });

  it("and stops saying it once the answer has finished, when the tick asks again", async () => {
    await editorOpenWhileAnswering();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click(),
    );
    await act(async () => {
      frame("begin", {
        threadId: REMEMBER.id,
        title: REMEMBER.title,
        messageId: "spya-a3a3a3",
        questionId: "spya-q3q3q3",
        attempt: "an-attempt",
      });
      frame("done", { text: "Done", status: "done", citations: [], searches: 0, model: "m" });
      answer?.close();
    });
    await settle();
    expect(said()).toBe("");
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Ask again (Enter)"]')?.click());
    await settle();
    expect(posted()).toHaveLength(2);
    expect(posted()[1]).toMatchObject({ edit: "spya-q1q1q1", question: "What I meant to say" });
  });
});
