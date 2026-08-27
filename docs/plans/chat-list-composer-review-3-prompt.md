# Third pass: the fix for what the second pass found

Same change as before — a composer under the chat thread list in a React reading app. Your second
pass said "do not ship this exact version" and found:

1. **High** — sending before the initial fetch completes can erase the new conversation, because
   `refresh` on arrival replaces the whole list with the server snapshot.
2. **Medium** — the box appears and disappears for a new reader (loading → auto-start unmounts it),
   and a test blessed that transient state.
3. **Low** — the fixture used `t1`, which `threadParam` would reject; real ids are `spya-…`.

You recommended: *"offer the composer only when `threadId === null && threads.length > 0"*.

That is exactly what was done. The Low is fixed (real `spya-` ids). The Medium's test now asserts
the opposite — the box is absent when the list is empty. A draft-survival test across the
guard-driven unmount was added, as you suggested. The plan doc records that `onSendNew` plus a
`refresh` that cannot overwrite local work is the real fix, that the wipe race is reachable today by
pressing `+` fast enough, and that it wants its own piece of work.

`src/web/App.tsx` and `src/web/useChat.ts` are still off limits in this shared working tree today.

## What I want from you

1. Is the guard `threadId === null && threads.length > 0` now correct — any reachable state where
   the box is shown and `onSend` does not mint, or where the reader loses work?
2. Is `threads.length > 0` really implied by "the fetch has landed"? I claim the only way to have a
   non-empty list before it lands is a local mint, which always sets `?thread=` and so fails the
   first half anyway. Check that.
3. Anything wrong in the tests as they now stand.

Short answer is fine. If it is shippable, say so plainly.

## The guard, in context

```tsx
          {/* The list's own composer. Typing here and pressing Enter starts a
              conversation and sends the question into it in one go, which is
              what the reader was going to do with the + button and then the box
              anyway. Greg, 2026-08-27: *"add a text input box at the bottom
              that (when a message is input) automatically starts a new chat, to
              save the user a click."*

              **The condition is the whole safety of it, and neither half is a
              tidiness check.** Both came out of GPT-5.6 reviews on 2026-08-27,
              and both are about the same thing: *the list being on screen does
              not mean what it looks like it means.*

              `threadId === null`, because the question goes down the ordinary
              `onSend`, which ChatBand resolves against `?thread=` — so this box
              mints a conversation only while `?thread=` names nothing, and
              joins one otherwise. The panel decides between list and
              conversation with `threads.find`, and `threads` is empty until the
              fetch lands, so a reader opening a stored `?thread=` from a
              bookmark or from the floating dialog's "open in full chat" sees
              this list for as long as that request takes. A question typed into
              the box in that window would have been appended to the stored
              conversation — under a placeholder promising a new one, past the
              `busy` guard, and possibly on top of an answer still arriving.

              `threads.length > 0`, because minting during that same window is
              no better. `refresh` on arrival replaces the whole list with the
              server's snapshot (useChat.ts § refresh, `only === undefined`),
              which takes the just-minted conversation with it — and every later
              frame of the answer then patches a row that is not there, so the
              reader's question disappears off the screen while its request
              carries on. A list with something in it is a list whose fetch has
              landed, which is why this half is the one that closes the race.

              What it costs: no box in three states — the fetch in flight, a
              `?thread=` left over from a conversation that was closed and
              discarded, and an article nobody has asked anything about yet. All
              three still offer the `+` in the header, which mints
              unconditionally, and the last one has its own button as well. The
              proper fix is a call that means "new" whatever the URL says, plus
              a `refresh` that cannot overwrite local work; both live in files
              this change cannot touch today — see docs/plans/chat-mode.md.

              `focusNonce={0}` on purpose: this box must never take the caret.
              The nonce is for a reader who has just *asked* for somewhere to
              type, and arriving at a list is not that — a focused textarea
              turns the article's ↑/↓ into caret movement, and nothing on screen
              would say why. See `focusNonce` in Props. */}
          {threadId === null && threads.length > 0 && (
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
 * The thing worth a test is not that a textarea renders. It is the pair of
 * rules that make the box mean "a new one".
 *
 * **It sends on Enter with nothing open.** The question goes down the ordinary
 * `onSend`, which ChatBand resolves against `?thread=`; with nothing named,
 * `send(null, …)` mints a conversation and opens it (useChat.ts).
 *
 * **And it is offered only while `?thread=` names nothing and the list has
 * something in it** — which is a different statement from "the list is
 * showing", and the difference is two bugs GPT-5.6 found, one in each of the
 * first two versions. The panel chooses between list and conversation with
 * `threads.find`, and `threads` is empty until the fetch lands, so a reader
 * arriving on a stored `?thread=` sees the list for as long as that request
 * takes. A box wired to `onSend` in that window appends to the stored
 * conversation, under a placeholder promising a new one; and a box that minted
 * there would lose the conversation it minted, because the arriving snapshot
 * replaces the whole list (`refresh` in useChat.ts). Both windows have a test
 * below, and they are the ones that would have caught them.
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

  /* The first bug GPT-5.6 found. The list is what the panel shows while the
     fetch is in flight — `threads` is empty, so `threads.find` comes back empty
     even for a `?thread=` that names a real stored conversation — and `onSend`
     resolves against that same id. A box here would have appended to it. */
  it("is absent while the URL names a conversation the fetch has not brought yet", () => {
    paint([], STORED_ELSEWHERE);
    expect(composer()).toBeNull();
  });

  /* The second, which the fix for the first did not cover: an empty list is
     also what the panel shows while the fetch is in flight with no `?thread=`
     at all, and a conversation minted there is wiped by the snapshot when it
     lands — taking the reader's question off the screen while its request
     carries on. An empty list is not a list. */
  it("is absent when there is no list yet, which is also the loading state", () => {
    paint([], null);
    expect(composer()).toBeNull();
  });

  /* The same rule from the other side, so the test cannot be satisfied by a
     panel that simply never shows the box. */
  it("comes back once the fetch has landed and the URL names nothing", () => {
    paint([], STORED_ELSEWHERE);
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

  /* And across the *other* way of losing the box: the guard itself. A stale
     `?thread=` leaves the list showing with no composer at all, and coming back
     from that must not have eaten the words either. Asked for by GPT-5.6's
     second pass. */
  it("keeps it across a stale ?thread= that hides the box entirely", () => {
    const box = render();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Still half a question");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    paint([THREAD], STORED_ELSEWHERE);
    expect(composer()).toBeNull();
    paint([THREAD], null);
    expect(composer()?.value).toBe("Still half a question");
  });
});
```
