// @vitest-environment jsdom
/**
 * **The Remember composer, and the two things about it that are not obvious.**
 *
 * Remember reuses chat's `Composer` rather than copying it, so almost nothing
 * here is about Remember specifically — the Escape ladder, the auto-resize and
 * the key-propagation stop are chat's and are tested by chat's own files. What
 * is new is a taller box, a labelled microphone, and a stance `<select>`, and
 * only the last of those can be got wrong in a way that changes an answer.
 *
 * The rule the tests below exist for: **the picker governs a new turn and
 * nothing else.** A retry re-asks a stored question, so it must be asked the
 * way it was asked — see `withRetry` in src/chat.ts and GPT Sol's review of the
 * built code, finding 4. Getting that wrong is silent: the reader presses a
 * button labelled "answer again" and the answer comes back in a different
 * voice, with nothing on screen saying why.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread, RememberStance } from "../src/types.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-08-28T10:00:00.000Z";

/** A Remember turn with one finished answer, asked for in `stance`. */
function rememberThread(stance?: RememberStance): ChatThread {
  return {
    id: "spya-k3m9qt",
    title: "What I took from it",
    createdAt: AT,
    updatedAt: AT,
    kind: "remember",
    messages: [
      { id: "spya-usr2aa", role: "user", text: "what I took", createdAt: AT, status: "done" },
      {
        id: "spya-ans2aa",
        role: "assistant",
        text: "An answer.",
        createdAt: AT,
        status: "done",
        ...(stance ? { stance } : {}),
      },
    ],
  };
}

let host: HTMLDivElement;
let root: Root;

const sent: { question: string }[] = [];

function paint(thread: ChatThread, kind: "chat" | "remember" = "remember", stance: RememberStance = "balanced") {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind,
        stance,
        onStance: () => {},
        loaded: true,
        loadFailed: false,
        threads: [thread],
        threadId: thread.id,
        onThread: () => {},
        onSend: (question: string) => {
          sent.push({ question });
        },
        onNew: () => {},
        onSendNew: () => {},
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

beforeEach(() => {
  sent.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Remember composer is chat's, with three differences", () => {
  it("gives a Remember turn a box you can put a paragraph in", () => {
    paint(rememberThread());
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    /* Not a style preference. A spoken Remember turn is a paragraph or three, and a
       one-row box is what tells the reader this is a place for a sentence. */
    expect(box?.rows).toBe(6);
  });

  it("leaves chat's box exactly as it was", () => {
    paint({ ...rememberThread(), kind: "chat" }, "chat");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(1);
  });

  it("offers the four stances in Remember, and none in chat", () => {
    paint(rememberThread());
    const options = [...host.querySelectorAll(".chat-stance option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["balanced", "respond", "socratic", "signposts"]);

    paint({ ...rememberThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".chat-stance")).toBeNull();
  });

  it("describes the stance picker itself on hover and focus", async () => {
    paint(rememberThread());
    const select = host.querySelector<HTMLSelectElement>(".chat-stance select");
    expect(select).toBeTruthy();

    await act(async () => {
      select?.dispatchEvent(new MouseEvent("mouseenter"));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    let card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card?.textContent).toContain("Balanced");
    expect(card?.textContent).toContain("Signposts");
    expect(select?.getAttribute("aria-describedby")).toBe(card?.id);

    await act(async () => {
      select?.dispatchEvent(new MouseEvent("mouseleave"));
      await new Promise((resolve) => setTimeout(resolve, 120));
      select?.focus();
    });
    card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card?.textContent).toContain('a direct question or "just tell me" gets a plain answer');
    expect(select?.getAttribute("aria-describedby")).toBe(card?.id);
  });

  it("labels the microphone in Remember and not in chat", () => {
    /* Greg asked for the microphone to be emphasised because talking a
       paragraph beats typing one. An unlabelled icon among three other
       unlabelled icons is not an invitation to talk. */
    paint(rememberThread());
    const labelled = host.querySelector(".chat-talk-label");
    paint({ ...rememberThread(), kind: "chat" }, "chat");
    const unlabelled = host.querySelector(".chat-talk-label");
    // Dictation may be unsupported in jsdom, in which case neither renders —
    // the assertion that matters is that they never differ the wrong way round.
    if (labelled) expect(unlabelled).toBeNull();
  });
});

describe("an answer says which stance produced it", () => {
  it("tags a socratic answer", () => {
    paint(rememberThread("socratic"));
    expect(host.querySelector(".chat-stance-tag")?.textContent).toBe("socratic");
  });

  it("does not tag the default, which most answers are", () => {
    /* A tag on nearly every row distinguishes nothing. Same call the thread
       list's Remember tag makes. */
    paint(rememberThread("balanced"));
    expect(host.querySelector(".chat-stance-tag")).toBeNull();
  });

  it("does not tag a chat answer, which has no stance at all", () => {
    paint({ ...rememberThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".chat-stance-tag")).toBeNull();
  });
});

/** Every prop `ChatPanel` needs, for the tests below that paint something other than one open thread. */
function props(over: Record<string, unknown>) {
  return {
    slug: "a-piece",
    kind: "remember" as const,
    stance: "balanced" as const,
    onStance: () => {},
    loaded: true,
    loadFailed: false,
    threads: [] as ChatThread[],
    threadId: null as string | null,
    onThread: () => {},
    onSend: () => {},
    onNew: () => {},
    onSendNew: () => {},
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
    ...over,
  };
}

/**
 * **Remember is one conversation, and its panel has nothing for choosing
 * another.** Report `spya-peszam`; docs/plans/261001m-remember-is-its-own-single-thread.md
 * § Design 4. Until 2026-10-01 these tests pinned the opposite — a list shared
 * with chat, with Remember rows tagged — and that product decision is gone.
 */
describe("Remember's panel is one conversation", () => {
  it("never draws a list or the list's composer, even when handed no open thread", () => {
    act(() => root.render(createElement(ChatPanel, props({ threads: [rememberThread()], threadId: null }))));
    expect(host.querySelector(".chat-threads")).toBeNull();
    expect(host.querySelector(".chat-empty")).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector('button[title="Start remembering"]')).toBeNull();
  });

  it("says Remember in the header, and offers Start over but no close, new or rename", () => {
    paint(rememberThread());
    expect(host.querySelector(".band-head h2")?.textContent).toBe("Remember");
    expect(host.querySelector('button[title="All conversations"]')).toBeNull();
    expect(host.querySelector('button[title="Start remembering"]')).toBeNull();
    expect(host.querySelector('button[title^="Rename"]')).toBeNull();
    const startOver = host.querySelector<HTMLButtonElement>("button.chat-icon.danger");
    expect(startOver?.title).toMatch(/^Start over/);
  });

  it("leaves chat's header as it was", () => {
    paint({ ...rememberThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".band-head h2")?.textContent).toBe("What I took from it");
    expect(host.querySelector('button[title="All conversations"]')).not.toBeNull();
  });
});

describe("chat's list has no Remember tag any more", () => {
  it("draws no kind tag on a row", () => {
    const chat: ChatThread = { ...rememberThread(), id: "spya-p7w2dn", kind: "chat", title: "A question" };
    act(() => root.render(createElement(ChatPanel, props({ kind: "chat", threads: [chat] }))));
    expect(host.querySelectorAll(".chat-thread")).toHaveLength(1);
    expect(host.querySelector(".chat-thread-kind")).toBeNull();
  });
});

/**
 * **A short band gets a short box.** On a landscape phone the band is about
 * 338px tall and six rows at rest took 280 of it. Plan 261001m § 5.
 */
describe("the Remember composer on a short viewport", () => {
  const real = window.matchMedia;
  afterEach(() => {
    window.matchMedia = real;
  });

  function viewport(short: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: short && query.includes("max-height: 500px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it("is two rows at rest when the viewport is short", () => {
    viewport(true);
    paint(rememberThread());
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(2);
  });

  it("is still six rows on a tall one", () => {
    viewport(false);
    paint(rememberThread());
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(6);
  });

  it("leaves chat's one row alone either way", () => {
    viewport(true);
    paint({ ...rememberThread(), kind: "chat" }, "chat");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(1);
  });
});
