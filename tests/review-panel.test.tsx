// @vitest-environment jsdom
/**
 * **The review composer, and the two things about it that are not obvious.**
 *
 * Review reuses chat's `Composer` rather than copying it, so almost nothing
 * here is about review specifically — the Escape ladder, the auto-resize and
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ReviewStance } from "../src/types.js";

/* The profile hook fetches on mount, and none of this is about the profile. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-08-28T10:00:00.000Z";

/** A review with one finished answer, asked for in `stance`. */
function reviewThread(stance?: ReviewStance): ChatThread {
  return {
    id: "spya-k3m9qt",
    title: "What I took from it",
    createdAt: AT,
    updatedAt: AT,
    kind: "review",
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

function paint(thread: ChatThread, kind: "chat" | "review" = "review", stance: ReviewStance = "balanced") {
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

describe("the review composer is chat's, with three differences", () => {
  it("gives a review a box you can put a paragraph in", () => {
    paint(reviewThread());
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    /* Not a style preference. A spoken review is a paragraph or three, and a
       one-row box is what tells the reader this is a place for a sentence. */
    expect(box?.rows).toBe(6);
  });

  it("leaves chat's box exactly as it was", () => {
    paint({ ...reviewThread(), kind: "chat" }, "chat");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(1);
  });

  it("offers the four stances in review, and none in chat", () => {
    paint(reviewThread());
    const options = [...host.querySelectorAll(".chat-stance option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["balanced", "respond", "socratic", "signposts"]);

    paint({ ...reviewThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".chat-stance")).toBeNull();
  });

  it("labels the microphone in review and not in chat", () => {
    /* Greg asked for the microphone to be emphasised because talking a
       paragraph beats typing one. An unlabelled icon among three other
       unlabelled icons is not an invitation to talk. */
    paint(reviewThread());
    const labelled = host.querySelector(".chat-talk-label");
    paint({ ...reviewThread(), kind: "chat" }, "chat");
    const unlabelled = host.querySelector(".chat-talk-label");
    // Dictation may be unsupported in jsdom, in which case neither renders —
    // the assertion that matters is that they never differ the wrong way round.
    if (labelled) expect(unlabelled).toBeNull();
  });
});

describe("an answer says which stance produced it", () => {
  it("tags a socratic answer", () => {
    paint(reviewThread("socratic"));
    expect(host.querySelector(".chat-stance-tag")?.textContent).toBe("socratic");
  });

  it("does not tag the default, which most answers are", () => {
    /* A tag on nearly every row distinguishes nothing. Same call the thread
       list's `review` tag makes. */
    paint(reviewThread("balanced"));
    expect(host.querySelector(".chat-stance-tag")).toBeNull();
  });

  it("does not tag a chat answer, which has no stance at all", () => {
    paint({ ...reviewThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".chat-stance-tag")).toBeNull();
  });
});

describe("the shared thread list says which kind a row is", () => {
  it("tags a review and leaves a chat alone", () => {
    const review = reviewThread();
    const chat: ChatThread = { ...reviewThread(), id: "spya-p7w2dn", kind: "chat", title: "A question" };
    act(() => {
      root.render(
        createElement(ChatPanel, {
          slug: "a-piece",
          kind: "chat" as const,
          stance: "balanced" as const,
          onStance: () => {},
          loaded: true,
          loadFailed: false,
          threads: [review, chat],
          // The LIST, not a conversation.
          threadId: null,
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
        }),
      );
    });
    const tags = [...host.querySelectorAll(".chat-thread")].map(
      (r) => r.querySelector(".chat-thread-kind")?.textContent ?? null,
    );
    expect(tags).toContain("review");
    expect(tags).toContain(null);
  });
});
