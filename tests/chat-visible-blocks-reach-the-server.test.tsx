// @vitest-environment jsdom
/**
 * **What was on screen reaches the server, read at the moment of sending.**
 *
 * Report spya-ybnas5: chat should know which blocks the reader can see, hedged
 * so the model does not lean on it. Reader hands `ConversationBand` a getter
 * (`onScreen`), and the band calls it when the reader presses Send — in an open
 * conversation, in the box that starts a new one, and on Save after an edit.
 *
 * Read at the press rather than at render, and that is the property most worth
 * pinning: a value captured when the band last rendered is wherever the reader
 * was before they scrolled, which is the thing "this paragraph" must not
 * resolve to. So the getter's answer changes after mount and the body must
 * carry the new one.
 *
 * Harness from tests/conversation-band-send-new.test.tsx; `ChatPanel` is
 * stubbed and the props it is handed are what get pressed.
 * docs/plans/261001q-chat-knows-the-blocks-on-screen.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, ChatThread } from "../src/types.js";

let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

const calls: { method: string; body: Record<string, unknown> | undefined }[] = [];

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
        return Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ threads: [STORED] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
});

const { ConversationBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);

const STORED: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    { id: "spya-q1q1q1", role: "user", text: "An earlier question", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    { id: "spya-a1a1a1", role: "assistant", text: "An earlier answer", createdAt: "2026-08-27T10:00:01.000Z", status: "done" },
  ],
};

let host: HTMLDivElement;
let root: Root;
/** What the getter answers now. Changed after mount, on purpose. */
let screen: BlockId[] = [];

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  panel = undefined;
  screen = ["spya-before"];
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

async function mount(kind: "chat" | "remember"): Promise<void> {
  history.replaceState(null, "", `/a-piece?mode=${kind}&thread=${STORED.id}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(ConversationBand, {
          slug: "a-piece",
          blocks: new Map<string, string>(),
          onJump: () => {},
          ...(kind === "chat" ? { kind, onScreen: () => screen } : { kind }),
        }),
      ),
    );
  });
  await settle();
}

const posted = () => calls.filter((c) => c.method === "POST").map((c) => c.body ?? {});

/** Press one of the panel's callbacks, then let the request and any URL write land. */
async function press(name: string, ...args: unknown[]): Promise<void> {
  const fn = panel?.[name] as ((...a: unknown[]) => void) | undefined;
  expect(typeof fn, `the band handed the panel no ${name}`).toBe("function");
  await act(async () => {
    fn?.(...args);
  });
  await settle();
  /* nuqs writes `?thread=` on a throttle of its own; wait for it so no timer
     outlives the page (docs/postmortems/260906c-a-url-write-outlived-the-page-that-asked-for-it.md). */
  const to = posted().at(-1)?.threadId;
  if (typeof to === "string") {
    await vi.waitFor(() => expect(new URLSearchParams(location.search).get("thread")).toBe(to));
  }
}

describe("the blocks on screen, sent with a chat question", () => {
  it("are read when Send is pressed in an open conversation, not when the band rendered", async () => {
    await mount("chat");
    screen = ["spya-aaaaaa", "spya-bbbbbb"];
    await press("onSend", "What does this paragraph mean?");
    expect(posted()).toHaveLength(1);
    expect(posted()[0]?.visible).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
  });

  it("go with the box that starts a new conversation too", async () => {
    await mount("chat");
    screen = ["spya-cccccc"];
    await press("onSendNew", "Something else", false);
    expect(posted()[0]?.visible).toEqual(["spya-cccccc"]);
  });

  it("go with an edited question, read at Save", async () => {
    await mount("chat");
    screen = ["spya-dddddd"];
    await press("onEdit", "spya-q1q1q1", "A better question");
    expect(posted()).toHaveLength(1);
    expect(posted()[0]?.edit).toBe("spya-q1q1q1");
    expect(posted()[0]?.visible).toEqual(["spya-dddddd"]);
  });

  it("are left out when nothing is on screen, rather than sent as an empty list", async () => {
    await mount("chat");
    screen = [];
    await press("onSend", "Why?");
    expect(posted()[0]).not.toHaveProperty("visible");
  });

  it("are not sent by Remember, whose prop type forbids a getter", async () => {
    await mount("remember");
    await press("onSend", "Why?");
    expect(posted()).toHaveLength(1);
    expect(posted()[0]).not.toHaveProperty("visible");
  });
});
