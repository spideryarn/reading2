// @vitest-environment jsdom
/**
 * **Rewriting a question in Recall asks it again.**
 *
 * Report spya-f3b6ab (Greg, 2026-10-01): *"I tried editing a previous message
 * in Recall mode, hoping that it would then trigger a response to that
 * modified message, but it didn't."*
 *
 * Asked end to end on the client: the real Learn band, the real `useChat`
 * and the real `ChatPanel`, with only the network and the live session faked.
 * The pencil is pressed, the question rewritten, Ask again pressed — and then
 * the request that leaves and the answer that streams back are what is checked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

const calls: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];
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
    apiFetch: (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      if (method === "POST" && url.endsWith("/stop")) {
        return Promise.resolve(
          new Response(JSON.stringify({ stopped: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
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
const LEARN: ChatThread = {
  id: "spya-jxcxj7",
  kind: "learn",
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
  stored = [LEARN];
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
  history.replaceState(null, "", `/a-piece?mode=learn&thread=${LEARN.id}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(ConversationBand, {
          slug: "a-piece",
          blocks: new Map<string, string>(),
          onJump: () => {},
          kind: "learn",
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

/** The turns asked: sends, retries and edits, not stops. */
const posted = () =>
  calls.filter((c) => c.method === "POST" && !c.url.endsWith("/stop")).map((c) => c.body ?? {});
const stops = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/stop")).map((c) => c.body ?? {});

async function rewrite(which: number, text: string): Promise<void> {
  const pencils = [...host.querySelectorAll<HTMLButtonElement>('button[data-tip="Rewrite this question"]')];
  expect(pencils.length, "a pencil on each of the reader's questions").toBe(2);
  await act(async () => pencils[which]?.click());
  const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
  expect(box, "the editor opened").not.toBeNull();
  await act(async () => type(box as HTMLTextAreaElement, text));
  const ask = host.querySelector<HTMLButtonElement>('button[data-tip="Ask again (Enter)"]');
  expect(ask, "Ask again is offered").not.toBeNull();
  await act(async () => ask?.click());
  await settle();
}

describe("rewriting a question in Recall", () => {
  it("sends the rewritten question to be answered again", async () => {
    await mount();
    await rewrite(0, "What I meant to say");
    expect(posted()).toHaveLength(1);
    expect(posted()[0]).toEqual({ threadId: LEARN.id, edit: "spya-q1q1q1", question: "What I meant to say", at: null, expectedTailId: "spya-a2a2a2" });
    expect(posted()[0]).toMatchObject({
      threadId: LEARN.id,
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
        threadId: LEARN.id,
        title: LEARN.title,
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
    expect(box, "Learn begins a conversation and offers a composer").not.toBeNull();
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

    const pencil = host.querySelector<HTMLButtonElement>('button[data-tip="Rewrite this question"]');
    expect(pencil, "a pencil on the question just asked").not.toBeNull();
    await act(async () => pencil?.click());
    const editor = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    await act(async () => type(editor as HTMLTextAreaElement, "What I meant to say"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[data-tip="Ask again (Enter)"]')?.click());
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

/* Report spya-yur0eq (Greg, 2026-10-19): *"Allow the user to edit user inputs
   in Chat while it's thinking, rather than having to stop it first and then
   click the Edit button."* Ask again while an answer is arriving stops that
   answer through the ordinary Stop, and asks the rewrite once it has settled.
   Until then an open editor held its Ask again with a sentence (spya-f3b6ab,
   docs/postmortems/261002g-a-refusal-with-no-voice.md) and the pencil was
   withdrawn. docs/plans/261020i-edit-your-question-while-chat-is-answering.md. */
describe("rewriting a question while an answer is arriving", () => {
  /** A question asked from the composer, its answer begun and still arriving. */
  async function answering(): Promise<void> {
    await mount();
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    await act(async () => type(box as HTMLTextAreaElement, "And another thing"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
    await settle();
    expect(posted(), "the composer's question went out").toHaveLength(1);
    await act(async () => {
      frame("begin", {
        threadId: LEARN.id,
        title: LEARN.title,
        messageId: "spya-a3a3a3",
        questionId: "spya-q3q3q3",
        attempt: "an-attempt",
      });
      frame("delta", { text: "Half an ans" });
    });
    await settle();
  }

  async function openAndType(which: number, text: string): Promise<HTMLTextAreaElement> {
    const pencils = [...host.querySelectorAll<HTMLButtonElement>('button[data-tip="Rewrite this question"]')];
    expect(pencils.length, "a pencil on each question, though an answer is arriving").toBe(3);
    await act(async () => pencils[which]?.click());
    const editor = host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    expect(editor, "the editor opened").not.toBeNull();
    await act(async () => type(editor as HTMLTextAreaElement, text));
    return editor as HTMLTextAreaElement;
  }

  const said = () => host.querySelector(".chat-edit-held")?.textContent ?? "";
  const editorText = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box")?.value;

  async function finishStopped(): Promise<void> {
    await act(async () => {
      frame("done", { text: "Half an ans", status: "done", stopped: true, citations: [], searches: 0, model: "m" });
      answer?.close();
    });
    await settle();
  }

  it("on Enter: stops the answer, keeps the editor open, and asks nothing yet", async () => {
    await answering();
    const editor = await openAndType(0, "What I meant to say");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(stops()).toEqual([{ messageId: "spya-a3a3a3", attempt: "an-attempt" }]);
    expect(posted(), "no edit until the answer has stopped").toHaveLength(1);
    expect(editorText()).toBe("What I meant to say");
    expect(said()).toMatch(/Stopping/);
    await act(async () => host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click());
    await settle();
    expect(stops(), "a second Ask press does not send a second Stop").toHaveLength(1);
    expect(posted(), "a second Ask press still does not send the edit early").toHaveLength(1);
  });

  it("then asks the rewrite once the stopped answer has settled, against that answer as the tail", async () => {
    await answering();
    await openAndType(0, "What I meant to say");
    await act(async () => host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click());
    await settle();
    expect(stops()).toHaveLength(1);
    await finishStopped();
    expect(posted()).toHaveLength(2);
    expect(posted()[1]).toEqual({
      threadId: LEARN.id,
      edit: "spya-q1q1q1",
      question: "What I meant to say",
      at: null,
      expectedTailId: "spya-a3a3a3",
    });
    expect(host.querySelector("textarea.chat-edit-box"), "the editor closed").toBeNull();
    expect(
      (document.activeElement as HTMLElement | null)?.getAttribute("data-tip"),
      "focus returned to its pencil",
    ).toBe("Rewrite this question");
  });

  it("does not ask an unchanged rewrite typed while the answer is stopping", async () => {
    await answering();
    const editor = await openAndType(0, "What I meant to say");
    await act(async () => host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click());
    await settle();
    await act(async () => type(editor, "  What I first said "));
    await finishStopped();
    expect(posted(), "the now-unchanged rewrite was not sent").toHaveLength(1);
    expect(host.querySelector("textarea.chat-edit-box"), "closed, as an unchanged edit always has").toBeNull();
  });

  /* GPT Sol's plan review F1: the question just asked carries an id this tab
     invented until `begin` swaps in the server's, and the editor's row is keyed
     by it. Rewriting that question while its answer has not begun is the case
     the report is most about. */
  it("rewriting the question being answered, before its answer has begun, survives the rename", async () => {
    await mount();
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    await act(async () => type(box as HTMLTextAreaElement, "And another thing"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
    await settle();
    const editor = await openAndType(2, "And another thing, properly");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(stops(), "the stop waits for the answer's name").toHaveLength(0);
    await act(async () => {
      frame("begin", {
        threadId: LEARN.id,
        title: LEARN.title,
        messageId: "spya-a3a3a3",
        questionId: "spya-q3q3q3",
        attempt: "an-attempt",
      });
    });
    await settle();
    expect(stops()).toEqual([{ messageId: "spya-a3a3a3", attempt: "an-attempt" }]);
    expect(editorText(), "the editor and its text outlived the rename").toBe("And another thing, properly");
    expect(document.activeElement, "the remounted editor kept the caret").toBe(
      host.querySelector("textarea.chat-edit-box"),
    );
    expect(said()).toMatch(/Stopping/);
    await finishStopped();
    expect(posted()).toHaveLength(2);
    expect(posted()[1]).toEqual({
      threadId: LEARN.id,
      edit: "spya-q3q3q3",
      question: "And another thing, properly",
      at: null,
      expectedTailId: "spya-a3a3a3",
    });
  });

  it("an unchanged rewrite stops nothing (Sol F2)", async () => {
    await answering();
    const editor = await openAndType(0, "  What I first said ");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(stops()).toHaveLength(0);
    expect(posted()).toHaveLength(1);
    expect(host.querySelector("textarea.chat-edit-box"), "closed, as an unchanged edit always has").toBeNull();
  });

  it("an answer that fails before it begins: the rewrite is kept, not asked against rows the server never had", async () => {
    await mount();
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    await act(async () => type(box as HTMLTextAreaElement, "And another thing"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
    await settle();
    await openAndType(0, "What I meant to say");
    await act(async () => host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click());
    await settle();
    await act(async () => {
      frame("error", { error: "The model is unavailable." });
      answer?.close();
    });
    await settle();
    expect(posted(), "no edit went").toHaveLength(1);
    expect(editorText()).toBe("What I meant to say");
    expect(said(), "no longer claims to be stopping").toBe("");
  });

  it("Cancel while it is stopping: the rewrite is never asked", async () => {
    await answering();
    await openAndType(1, "Never mind");
    await act(async () => host.querySelector<HTMLButtonElement>(".chat-turn.editing .chat-actions button")?.click());
    await settle();
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-turn.editing button[aria-label="Cancel"]')?.click());
    await finishStopped();
    expect(stops()).toHaveLength(1);
    expect(posted()).toHaveLength(1);
  });
});
