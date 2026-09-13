// @vitest-environment jsdom
/**
 * **The box under the list of conversations starts a new one.**
 *
 * Greg, 2026-08-27: *"add a text input box at the bottom that (when a message
 * is input) automatically starts a new chat, to save the user a click."*
 *
 * The thing worth a test is not that a textarea renders. It is the two rules
 * that make the box mean "a new one", and both were written by a review finding
 * the state they had missed.
 *
 * **It sends down `onSendNew`, which always mints.** The ordinary `onSend`
 * means *send to the open conversation*, and ConversationBand resolves that against
 * `?thread=` — which is not always null while the list is on screen, because
 * the panel picks between list and conversation with `threads.find`. A
 * `?thread=` naming a stored conversation the fetch has not brought yet leaves
 * the list showing, and a box wired to `onSend` there appended the reader's
 * question to that conversation, under a placeholder promising a new one.
 *
 * **And it is offered only once the fetch has landed on a list with something
 * in it.** This went in as a safety rule: minting before the fetch landed was
 * no better than joining, because the arriving snapshot replaced the whole list
 * and took the new conversation with it, so the question went off the screen
 * while its request carried on. Both `loaded` and `threads.length` were needed
 * for that, because a non-empty list is not proof the fetch landed — pressing
 * `+` before it does and closing the conversation with a draft in it leaves a
 * thread behind.
 *
 * That is now fixed where it belonged, in `mergedArrival` (useChat.ts, and
 * tests/chat-arrival-race.test.ts), so the guard is presentational and the
 * tests below say only what is still true: **when the box is offered.** A box
 * offering to start a second conversation under a list the reader cannot see
 * yet is not a thing to offer, and that is the whole of it now.
 *
 * It also pins the focus rule. The composer takes the caret when `focusNonce`
 * rises, and a focused textarea turns the article's ↑/↓ into caret movement —
 * so a box that grabbed focus merely because the reader opened chat mode would
 * take the reading keys away with nothing on screen saying why. The list's box
 * is passed nonce 0, its own counter, and must never focus itself.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread } from "../src/types.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const sent: { open: string[]; fresh: string[] } = { open: [], fresh: [] };

/* Real ids, because `?thread=` is parsed as a block id — `t1` would be rejected
   before it ever reached the panel, which would make the URL claim these tests
   make untrue. src/ids.ts. */
const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-k3m9qt",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [],
};

/** A conversation the URL names and this panel has not got. */
const STORED_ELSEWHERE = "spya-w7n2xd";

let host: HTMLDivElement;
let root: Root;

/** The panel, on the list unless `threadId` says otherwise. */
function paint(
  threads: ChatThread[] = [THREAD],
  threadId: string | null = null,
  loaded = true,
  seed?: { threadId: string; text: string },
): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        /* Chat, not review. The two modes share this panel and this list — the
           box under it is the same box either way — and everything below is
           about the box, so the mode is a fixture rather than a subject. */
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
        loaded,
        loadFailed: false,
        threads,
        threadId,
        onThread: () => {},
        onSend: (q: string) => {
          sent.open.push(q);
        },
        onNew: () => {},
        onSendNew: (q: string) => {
          sent.fresh.push(q);
        },
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
        seed,
      }),
    );
  });
}

/** The box under the list, or null when the panel is not offering one. */
function composer(): HTMLTextAreaElement | null {
  return host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
}

/** The same, insisting there is one. */
function render(threads: ChatThread[] = [THREAD]): HTMLTextAreaElement {
  paint(threads);
  const box = composer();
  if (!box) throw new Error("no composer under the list");
  return box;
}

/** Type, then press Enter — the only way to send that costs no extra click. */
function ask(box: HTMLTextAreaElement, question: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, question);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

beforeEach(() => {
  sent.open = [];
  sent.fresh = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the composer under the conversation list", () => {
  it("is there while the list is showing", () => {
    expect(render().placeholder).toBe("Ask something new…");
  });

  /* The one that matters: down the call that always mints, never the one that
     resolves against whatever the URL still says. */
  it("sends the question down the call that mints a conversation", () => {
    ask(render(), "Does it ever answer the objection?");
    expect(sent.fresh).toEqual(["Does it ever answer the objection?"]);
    expect(sent.open).toEqual([]);
  });

  it("empties itself, so the next question does not arrive with the last one", () => {
    const box = render();
    ask(box, "First question");
    expect(box.value).toBe("");
    ask(box, "Second question");
    expect(sent.fresh).toEqual(["First question", "Second question"]);
  });

  /* Whitespace is not a question, and sending one would put an untitled
     conversation in the list for nothing. */
  it("does nothing with an empty box", () => {
    ask(render(), "   ");
    expect(sent.fresh).toEqual([]);
  });

  /* A reader arriving at the list has not asked for somewhere to type. */
  it("does not take the caret", () => {
    const box = render();
    expect(document.activeElement).not.toBe(box);
  });

  /* An empty list is also the loading state, and the composer belongs to a
     list rather than to a spinner. (This used to carry a second reason —
     minting before the fetch landed was wiped by it — which stopped being true
     when the arrival started merging; see useChat.ts § `mergedArrival`.) */
  it("is absent when there is no list yet, which is also the loading state", () => {
    paint([], null, false);
    expect(composer()).toBeNull();
  });

  /* A non-empty list is not proof the fetch landed, which is the state the
     third review found: press + before it does, type a draft, close the
     conversation, and `leave` keeps that thread precisely because there is a
     draft in it. Everything the panel can see says "a list", and the snapshot
     is still on its way. */
  it("is absent over a list that is only there because the reader made it", () => {
    const local: ChatThread = { ...THREAD, id: STORED_ELSEWHERE, title: "New chat", messages: [] };
    paint([local], null, false);
    expect(composer()).toBeNull();
  });

  /* After closing an unused first thread, typing and Live must remain reachable. */
  it("is available over a list the fetch brought back empty", () => {
    paint([], null, true);
    expect(composer()).not.toBeNull();
  });

  /* The `?thread=` states are where the first version went wrong, and they are
     exactly where the box has to keep working: a stale id left by a discarded
     conversation would otherwise leave the reader with a list and no box until
     they opened and closed something. `onSendNew` is what makes it safe — the
     question goes to a conversation of its own, not to the one the URL names. */
  it("is there under a ?thread= that names nothing this panel has", () => {
    paint([THREAD], STORED_ELSEWHERE);
    const box = composer();
    expect(box).not.toBeNull();
    if (box) ask(box, "Something else entirely");
    expect(sent.fresh).toEqual(["Something else entirely"]);
    expect(sent.open).toEqual([]);
  });

  /* The draft belongs to no conversation, so it is kept in a ref of its own
     rather than in the panel's map, which is keyed by thread id. Opening a row
     and coming back must not eat the reader's half-typed question. Asked for by
     GPT-5.6's review of the first version. */
  it("keeps a half-typed question across a look at one of the conversations", () => {
    const box = render();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Half a question");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    /* Into the conversation and back out. The conversation has a composer of
       its own — same component, different placeholder — so the check on the way
       through is that we really left the list, not that no box exists. */
    paint([THREAD], THREAD.id);
    expect(composer()?.placeholder).toBe("Ask about this article…");
    paint([THREAD], null);
    expect(composer()?.value).toBe("Half a question");
  });

  /* And across the *other* way of losing the box: the guard itself. The list is
     what the panel shows while the fetch is in flight, with no composer under
     it, and coming back from that must not have eaten the words either. Asked
     for by GPT-5.6's second pass. */
  it("keeps it across the loading state, which hides the box entirely", () => {
    const box = render();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Still half a question");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    paint([THREAD], null, false);
    expect(composer()).toBeNull();
    paint([THREAD], null, true);
    expect(composer()?.value).toBe("Still half a question");
  });

  /* A handed-over question (`seed`, from the glossary's Ask in chat) is the
     box's *initial* value and nothing more: once the reader has edited it — or
     cleared it with Escape — a later render still carrying the same seed must
     not put the handed-over words back. `draftFor` in ChatPanel asks `has`. */
  it("keeps the reader's edit over a seed the panel is still being handed", () => {
    const handed = "The handed-over question";
    paint([THREAD], THREAD.id, true, { threadId: THREAD.id, text: handed });
    const box = composer();
    expect(box?.value).toBe(handed);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "The reader's edited question");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    /* Away to the list and back remounts the keyed composer, which reads its
       draft afresh — the moment a seed could win over the edit. */
    paint([THREAD], null, true, { threadId: THREAD.id, text: handed });
    paint([THREAD], THREAD.id, true, { threadId: THREAD.id, text: handed });
    expect(composer()?.value).toBe("The reader's edited question");
  });
});
