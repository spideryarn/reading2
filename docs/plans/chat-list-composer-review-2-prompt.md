# Second pass: the fix for what you found

You reviewed a change that put a composer under the chat thread list in a TypeScript + React
reading app, and you found this (High):

> **the list composer can append to an existing conversation.** ChatPanel uses the ordinary
> `onSend`, while App.tsx passes the raw `?thread=` value to `send`. During initial loading,
> `useChat` starts with `threads = []`, so the panel decides there is no open conversation and shows
> the list composer — even when `?thread=` names a real stored conversation. […] A list action must
> explicitly mean "new": the backed-out `onSendNew`, or an equivalent callback that always calls
> `send(null, …)`, is required.

You are right, and the recommended fix — `onSendNew` in ChatBand — is not available: `src/web/App.tsx`
in this shared working tree holds another agent's uncommitted admin pages and imports a file git does
not have yet, so committing it would break `main` for everyone. (This constraint is real and not
negotiable today; the plan records `onSendNew` as the right thing to do once that file is free.)

So the hole was closed from inside `ChatPanel` instead: **the box is rendered only when
`threadId === null`.** The claim is that this makes "the box is on screen" imply "`?thread=` names
nothing" implies "`onSend` mints", and that the two states where the box now disappears (the fetch in
flight, and a stale `?thread=` from a discarded conversation) are acceptable because the header's `+`
button still mints unconditionally.

## What I want from you

1. **Does the guard actually close the finding?** Is there any reachable state where `threadId` is
   null and yet `onSend` does not mint — or where it is non-null, the list is showing, and the reader
   loses something they should have had?
2. **Does the guard introduce anything new?** In particular: flicker or a box that appears and
   disappears during ordinary use; a reader stuck with no box; anything about the draft ref surviving
   a state where the box is unmounted by the guard rather than by opening a conversation.
3. **Are the new tests the right ones**, and did I miss the case that would embarrass me?

Be blunt. If the guard is not good enough and the change should wait for `App.tsx`, say so.

## The panel's render, as it now stands

```tsx
  return (
    /* `mode-band` is the slot — fixed between the spine and the prose, and
       shared with the glossary. `chat` is a hook for anything only this panel
       wants; see § mode band in styles.css. */
    <aside className="mode-band chat" aria-label="Chat about this article">
      <div className="chat-head">
        <h2>{open ? open.title : "Chat"}</h2>
        {open ? (
          <>
            {/* The same delete the list offers, where the reader actually is.
                Greg, 2026-08-26: *"Also add a Delete button within a chat."*
                Asking twice rather than once, unlike the list — see ArmedDelete
                — because in here the whole conversation is on the screen and
                there is nothing to put it back. */}
            <ArmedDelete key={open.id} onDelete={() => onDelete(open.id)} />
            <button type="button" className="chat-icon" title="All conversations" onClick={leave}>
              <X size={14} />
            </button>
          </>
        ) : (
          <button type="button" className="chat-icon" title="Start a new conversation" onClick={onNew}>
            <MessageSquarePlus size={14} />
          </button>
        )}
      </div>

      {error && <p className="chat-error">{error}</p>}

      {open ? (
        <Conversation
          /* Keyed, so that switching conversation gets a fresh transcript and a
             fresh composer rather than the previous one's scroll position, open
             editor and half-typed question. */
          key={open.id}
          slug={slug}
          thread={open}
          onJump={onJump}
          recovering={recovering}
          blocks={blocks}
          onSend={onSend}
          onRetry={onRetry}
          onEdit={onEdit}
          onStop={onStop}
          focusNonce={focusNonce}
          focused={focused}
          draft={drafts.current.get(open.id) ?? ""}
          onDraft={(text) => drafts.current.set(open.id, text)}
        />
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

              **`threadId === null` is the whole safety of it, and it is not a
              tidiness check.** The question goes down the ordinary `onSend`,
              which ChatBand resolves against `?thread=` — so this box mints a
              conversation only while `?thread=` names nothing, and joins one
              otherwise. The list showing is *not* the same statement: the panel
              decides between list and conversation with `threads.find`, and
              `threads` is empty until the fetch lands. So a reader opening
              `?thread=t1` from a bookmark or from the floating dialog's "open
              in full chat" sees this list for as long as that request takes,
              and a question typed into the box in that window would have been
              appended to the stored conversation `t1` — under a placeholder
              promising a new one, past the `busy` guard, and possibly on top of
              an answer still arriving. Found by GPT-5.6, 2026-08-27, who was
              asked whether `onSend` was safe here and found the state I had
              missed.

              So the box is offered only when the URL names nothing, which is
              every ordinary visit to the list. The two states it hides in — the
              fetch still in flight, and a `?thread=` left over from a
              conversation that was closed and discarded — both still have the +
              in the header, which mints unconditionally.

              `focusNonce={0}` on purpose: this box must never take the caret.
              The nonce is for a reader who has just *asked* for somewhere to
              type, and arriving at a list is not that — a focused textarea
              turns the article's ↑/↓ into caret movement, and nothing on screen
              would say why. See `focusNonce` in Props. */}
          {threadId === null && (
            <Composer
              slug={slug}
              onSend={onSend}
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
    </aside>
  );
}
  return (
    <button
      type="button"
      className={`chat-icon danger${armed ? " armed" : ""}`}
      title={armed ? "Press again to delete this conversation" : "Delete this conversation"}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      <Trash2 size={14} />
    </button>
  );
}
  return (
    <ol className="chat-threads">
      {sorted.map((t) => {
        const last = lastSaid(t);
        return (
          <li key={t.id}>
            {renaming === t.id ? (
              <RenameRow
                initial={t.title}
                onDone={(title) => {
                  if (title.trim() !== "") onRename(t.id, title.trim());
                  setRenaming(null);
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <div className="chat-thread">
                <button
                  type="button"
```

## The refs it uses

```tsx
  const drafts = useRef(new Map<string, string>());

  /**
   * The highest `focusNonce` the composer has already acted on.
   *
   * Lives here, above the keyed composer, precisely because it has to survive
   * the composer being remounted. Keying the conversation by thread id is what
   * gives each one its own draft — and it also means a plain "open the
   * conversation I was in yesterday" mounts a fresh composer, which would take
   * the caret on the strength of a nonce raised minutes ago for a different
   * conversation. Focus in the textarea turns the article's ↑/↓ into caret
   * movement, so taking it uninvited is not cosmetic.
   *
   * It defeats a remount caused by the reader changing conversation, which is
   * the one that happens. It does not defeat a remount caused by the *same*
   * conversation being renamed underneath it — see `drafts` above — where the
   * nonce is already spent and the caret is lost.
   */
  const focused = useRef(0);

  /**
   * The same two things again, for the box under the thread list.
   *
   * Separate from `drafts` and `focused` above rather than sharing them, and
   * each for its own reason. The draft belongs to no conversation — that is the
   * whole point of the box — so there is no id to key it by; a question typed
   * there and abandoned for a row in the list is still there when you come
   * back. And the nonce counter has to be a *different* counter, because
   * spending the panel's one here would leave the real composer unfocused the
   * next time a new conversation was started.
   */
  const listDraft = useRef("");
  const listFocused = useRef(0);
```

## ChatBand's side, unchanged (src/web/App.tsx)

```tsx
      onSend={(question, useProfile) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        const id = send(thread, question, at, useProfile, (corrected) => void setThread(corrected));
        if (id !== thread) void setThread(id);
      }}
```

`thread` is `useQueryState("thread", threadParam)`. ChatBand also starts a conversation on arrival
when `loaded && threads.length === 0`, once per mount, which sets `?thread=`.

## The tests

```tsx
// @vitest-environment jsdom
/**
 * **The box under the list of conversations starts a new one.**
 *
 * Greg, 2026-08-27: *"add a text input box at the bottom that (when a message
 * is input) automatically starts a new chat, to save the user a click."*
 *
 * The thing worth a test is not that a textarea renders. It is the pair of
 * rules that make the box mean "a new one".
 *
 * **It sends on Enter with nothing open.** The question goes down the ordinary
 * `onSend`, which ChatBand resolves against `?thread=`; with nothing named,
 * `send(null, …)` mints a conversation and opens it (useChat.ts).
 *
 * **And it is offered only while `?thread=` names nothing** — which is a
 * different statement from "the list is showing", and the difference is a bug
 * GPT-5.6 found in the first version of this. The panel chooses between list
 * and conversation with `threads.find`, and `threads` is empty until the fetch
 * lands, so a reader arriving on `?thread=t1` sees the list for as long as that
 * request takes. A box wired to `onSend` in that window appends to the stored
 * conversation `t1` — under a placeholder promising a new one. So the loading
 * window has a test of its own below, and it is the one that would have caught
 * it.
 *
 * It also pins the focus rule. The composer takes the caret when `focusNonce`
 * rises, and a focused textarea turns the article's ↑/↓ into caret movement —
 * so a box that grabbed focus merely because the reader opened chat mode would
 * take the reading keys away with nothing on screen saying why. The list's box
 * is passed nonce 0 and must never focus itself.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

/* The profile hook fetches on mount, and this test is about a textarea. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const sent: string[] = [];

const THREAD: ChatThread = {
  id: "t1",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [],
};

let host: HTMLDivElement;
let root: Root;

/** The panel, on the list unless `threadId` says otherwise. */
function paint(threads: ChatThread[] = [THREAD], threadId: string | null = null): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        threads,
        threadId,
        onThread: () => {},
        onSend: (q: string) => {
          sent.push(q);
        },
        onNew: () => {},
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
  sent.length = 0;
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

  /* The one that matters: Enter sends, from a panel with nothing open. */
  it("sends the question straight off, with no conversation open", () => {
    ask(render(), "Does it ever answer the objection?");
    expect(sent).toEqual(["Does it ever answer the objection?"]);
  });

  it("empties itself, so the next question does not arrive with the last one", () => {
    const box = render();
    ask(box, "First question");
    expect(box.value).toBe("");
    ask(box, "Second question");
    expect(sent).toEqual(["First question", "Second question"]);
  });

  /* Whitespace is not a question, and sending one would put an untitled
     conversation in the list for nothing. */
  it("does nothing with an empty box", () => {
    ask(render(), "   ");
    expect(sent).toEqual([]);
  });

  /* A reader arriving at the list has not asked for somewhere to type. */
  it("does not take the caret", () => {
    const box = render();
    expect(document.activeElement).not.toBe(box);
  });

  /* The state where it is the only thing to do: nothing has been asked yet. */
  it("is there when there are no conversations at all", () => {
    ask(render([]), "The very first question");
    expect(sent).toEqual(["The very first question"]);
  });

  /* The bug GPT-5.6 found. The list is what the panel shows while the fetch is
     in flight — `threads` is empty, so `threads.find` comes back empty even for
     a `?thread=` that names a real stored conversation — and `onSend` resolves
     against that same id. A box here would have appended to `t1`. */
  it("is absent while the URL names a conversation the fetch has not brought yet", () => {
    paint([], "t1");
    expect(composer()).toBeNull();
  });

  /* The same rule from the other side, so the test cannot be satisfied by a
     panel that simply never shows the box. */
  it("comes back once the URL names nothing", () => {
    paint([], "t1");
    expect(composer()).toBeNull();
    paint([THREAD], null);
    expect(composer()).not.toBeNull();
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
});
```
