# Fourth pass: the final shape

Same change — a composer under the chat thread list. You have found three real defects across three
passes and each was fixed. The design has changed since the third pass, so this is the last check.

## What changed since you last saw it

You said the safe minimal guard was `threadId === null && loaded && threads.length > 0`, and that
`loaded` was not being passed into `ChatPanel`.

Adding `loaded` meant touching `src/web/App.tsx` after all — which removed the only reason
`onSendNew` had been left out. So both went in:

- `ChatBand` now passes `loaded={loaded}` and `onSendNew`, which always calls `send(null, …)` and
  raises the focus nonce.
- The list's box is wired to `onSendNew`, not `onSend`.
- The guard is now `loaded && threads.length > 0` — the `threadId === null` half was **dropped on
  purpose**, because with `onSendNew` the URL no longer decides where the question goes, and keeping
  it would have left a reader with a stale `?thread=` (from a conversation closed and discarded)
  looking at a list with no box until they opened and closed something else.

## What I want from you

1. Is dropping `threadId === null` right, given `onSendNew`? Any state where the box now appears and
   should not, or where it sends somewhere it should not?
2. Is `loaded && threads.length > 0` still sufficient against the wipe-on-arrival race?
3. The focus nonce is now raised by `onSendNew`. The list's composer has its own `focused` ref and is
   passed `focusNonce={0}`; the conversation's composer shares the panel-level `focused` ref and gets
   the real nonce. Can the raise land on the wrong composer, or be swallowed?
4. Anything wrong in the tests as they stand.

Short answer is fine. Say plainly whether it is shippable.

## ChatBand's side (src/web/App.tsx)

```tsx
    <ChatPanel
      slug={slug}
      /* Not for display — the panel offers its "start a new one" box only once
         this is true, because a conversation minted before the first fetch
         lands is wiped by it. See the composer under `ThreadList`. */
      loaded={loaded}
      threads={threads}
      threadId={thread}
      onThread={(id) => void setThread(id)}
      onNew={startNew}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question, useProfile) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        const id = send(thread, question, at, useProfile, (corrected) => void setThread(corrected));
        if (id !== thread) void setThread(id);
      }}
      /* The box under the list. `null` rather than `thread` is the whole
         difference: it mints whatever `?thread=` still says, which on the list
         is either nothing, a conversation the fetch has not brought yet, or one
         that was closed and discarded. The nonce goes up for the same reason
         `startNew` raises it — this *is* a new conversation being started, and
         the reader who typed to start it should still have a caret when it
         opens, in the composer that has just replaced the one they typed into. */
      onSendNew={(question, useProfile) => {
        const id = send(null, question, at, useProfile, (corrected) => void setThread(corrected));
        void setThread(id);
        setFocusNonce((n) => n + 1);
      }}
      onRename={rename}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `thread` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => thread && retry(thread, messageId)}
      onEdit={(messageId, question) => thread && edit(thread, messageId, question, at)}
      onStop={(messageId) => thread && stop(thread, messageId)}
      onJump={onJump}
      recovering={recovering}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
    />
```

## The panel's list branch

```tsx
      ) : (
        <>
          <ThreadList
            threads={threads}
            onOpen={onThread}
            onNew={onNew}
            onRename={onRename}
            onDelete={onDelete}
          />
          {/* The list's own composer. Typing here and pressing Enter starts a
              conversation and sends the question into it in one go, which is
              what the reader was going to do with the + button and then the box
              anyway. Greg, 2026-08-27: *"add a text input box at the bottom
              that (when a message is input) automatically starts a new chat, to
              save the user a click."*

              **`onSendNew`, not `onSend`, and the guard is about the fetch
              rather than about the URL.** Two reviews on 2026-08-27 went at
              this, and both findings were the same shape: *the list being on
              screen does not mean what it looks like it means.* The panel
              decides between list and conversation with `threads.find`, so the
              list is also what a reader sees while the first fetch is in
              flight, and `?thread=` can still name a conversation — one from a
              bookmark that has not arrived, or one that was closed and
              discarded. `onSend` resolves against exactly that id, so the box
              wired to it would have appended the question to a stored
              conversation under a placeholder promising a new one.
              `onSendNew` mints whatever the URL says, which is the only thing
              this box ever means.

              That leaves the other half, which is not about the URL at all:
              **nothing may be minted before the first fetch lands.** `refresh`
              on arrival replaces the whole list with the server's snapshot
              (useChat.ts § refresh, `only === undefined`), taking a
              just-minted conversation with it — and every later frame of the
              answer then patches a row that is not there, so the reader's
              question disappears off the screen while its request carries on.
              Hence `loaded`, and hence *both* of `loaded` and `threads.length`:
              a non-empty list is not proof the fetch landed, because pressing
              `+` before it does and closing the conversation with a draft in it
              leaves a thread behind (see `leave` above) — GPT-5.6 again, on the
              third pass, against its own suggested guard. `threads.length`
              stays because an empty list is the state the `+` and the empty
              panel's own button are for.

              `focusNonce={0}` on purpose: this box must never take the caret.
              The nonce is for a reader who has just *asked* for somewhere to
              type, and arriving at a list is not that — a focused textarea
              turns the article's ↑/↓ into caret movement, and nothing on screen
              would say why. See `focusNonce` in Props. */}
          {loaded && threads.length > 0 && (
            <Composer
              slug={slug}
              onSend={onSendNew}
              busy={false}
              focusNonce={0}
              focused={listFocused}
              draft={listDraft.current}
              onDraft={(text) => {
                listDraft.current = text;
              }}
              placeholder="Ask something new…"
            />
          )}
        </>
      )}

```

## The `loaded` and `onSendNew` props as documented

```tsx
  /**
   * Whether the conversations have been asked for and answered.
   *
   * It means "we have asked", not "it worked" — see `useChat`. One thing here
   * needs it, and it is not display: **nothing may be minted before the first
   * fetch lands.** That request replaces the whole list when it arrives
   * (useChat.ts § refresh), so a conversation started before it is taken with
   * it, and the answer streaming into that conversation then patches a row that
   * is not there. The list looks the same either way, which is the point: this
   * is the panel's only way to tell "no conversations" from "not asked yet".
   */
  loaded: boolean;
  /**
   * The first question of a conversation that does not exist yet — the box
   * under the list.
   *
   * A separate call from `onSend`, and the separation is the safety. `onSend`
   * means *send to the open conversation*, and ChatBand resolves that against
   * `?thread=` — which is not always null while the list is on screen, because
   * the panel decides between list and conversation with `threads.find`, and a
   * `?thread=` can name a conversation that has been discarded, or one the
   * fetch has not brought yet. Wiring the list's box to `onSend` appended the
   * reader's question to a stored conversation under a placeholder promising a
   * new one; GPT-5.6 found it, 2026-08-27. This one always mints.
   */
  onSendNew(question: string, useProfile: boolean): void;
```

## The tests

```tsx
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
 * means *send to the open conversation*, and ChatBand resolves that against
 * `?thread=` — which is not always null while the list is on screen, because
 * the panel picks between list and conversation with `threads.find`. A
 * `?thread=` naming a stored conversation the fetch has not brought yet leaves
 * the list showing, and a box wired to `onSend` there appended the reader's
 * question to that conversation, under a placeholder promising a new one.
 *
 * **And it is offered only once the fetch has landed on a list with something
 * in it.** Minting before the fetch lands is no better than joining: the
 * arriving snapshot replaces the whole list (`refresh` in useChat.ts) and takes
 * the new conversation with it, so the question goes off the screen while its
 * request carries on. Both `loaded` and `threads.length` are needed, because a
 * non-empty list is not proof the fetch landed — pressing `+` before it does
 * and closing the conversation with a draft in it leaves a thread behind.
 *
 * It also pins the focus rule. The composer takes the caret when `focusNonce`
 * rises, and a focused textarea turns the article's ↑/↓ into caret movement —
 * so a box that grabbed focus merely because the reader opened chat mode would
 * take the reading keys away with nothing on screen saying why. The list's box
 * is passed nonce 0, its own counter, and must never focus itself.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

/* The profile hook fetches on mount, and this test is about a textarea. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const sent: { open: string[]; fresh: string[] } = { open: [], fresh: [] };

/* Real ids, because `?thread=` is parsed as a block id — `t1` would be rejected
   before it ever reached the panel, which would make the URL claim these tests
   make untrue. src/ids.ts. */
const THREAD: ChatThread = {
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
): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        loaded,
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

  /* Minting before the fetch lands is wiped by it — the arriving snapshot
     replaces the whole list — and an empty list is also the loading state. */
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

  /* An empty list that really is empty. The + in the header and the empty
     panel's own button are what that state is for. */
  it("is absent over a list the fetch brought back empty", () => {
    paint([], null, true);
    expect(composer()).toBeNull();
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
});
```
