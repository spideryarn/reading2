# Review: a composer under the chat thread list

You are reviewing a small, finished change in a TypeScript + React reading app (Spideryarn).
Read it as a careful colleague from a different model family. Be concrete; say which line, and why
it breaks, not that it "could be improved". Say plainly if you find nothing.

## What was asked for

Greg (the owner), 2026-08-27:

> When I open Chat mode, it shows a list of previous chats, with a small button to start a new chat
> in the top-right of the panel. Since that's frequently what the user will want to do, let's add a
> text input box at the bottom that (when a message is input) automatically starts a new chat, to
> save the user a click.

## How chat mode works, in the parts that bear on this

- `ChatPanel` (src/web/ChatPanel.tsx) is a fixed column between the article's spine and its prose.
  It shows either ONE conversation (when `threadId` names a thread in `threads`) or the LIST of
  conversations.
- `ChatBand` (src/web/App.tsx) owns the data. It passes:
  - `threadId` — read from the `?thread=` URL parameter;
  - `onSend(question, useProfile)` → `send(thread, question, at, useProfile, onCorrected)` where
    `thread` is that same `?thread=` value. `send(null, …)` MINTS a new conversation (client-side
    id), inserts the reader's message and a pending assistant row optimistically, posts to the
    server, and returns the thread id; ChatBand then sets `?thread=` to it. So sending with nothing
    open creates the conversation and opens it.
  - `onNew()` → mints an empty conversation, opens it, and raises `focusNonce`.
  - `focusNonce` — a counter; `Composer` focuses its textarea when it rises above the highest value
    that composer has already acted on (a ref, `focused`, held above the keyed composer). Focus
    matters because a focused textarea turns the article's up/down keys from "step through the
    article" into caret movement.
- `Composer` is the exported box (textarea + send button + a "use my profile" checkbox). It is
  already reused by `ChatDialog`. Enter sends, Shift-Enter newlines. It keeps its own `value` state
  seeded from a `draft` prop and reports every keystroke through `onDraft`.
- ChatBand also has an effect: on arrival in chat mode, if `threads.length === 0`, start a
  conversation. So the empty-list state is only reachable after the reader closes their only
  conversation (an empty one closed this way is discarded — nothing was ever written to disk).
- A conversation with no messages is LOCAL ONLY. Nothing is stored server-side until the first
  question is sent, and the server accepts the client-minted thread id on that first request.

## The change

The list now ends in a `Composer`. Enter there sends via the ordinary `onSend`, which mints because
`?thread=` is null on the list. It is given `focusNonce={0}` and its own focus ref so it never takes
the caret, and its draft lives in a ref of its own (the panel's `drafts` map is keyed by thread id
and this box belongs to no thread).

Deliberately NOT done: a separate `onSendNew` prop in ChatBand that would always mint and would
raise the focus nonce. It was written, then backed out, because src/web/App.tsx currently holds
another agent's uncommitted work in this shared working tree.

## Questions I most want answered

1. Is `onSend` on the list actually safe in every reachable state? The one case I found is a stale
   `?thread=` — the id of an empty conversation that was opened, left by switching mode, and
   discarded — which leaves the LIST showing while `?thread=` still names it. `onSend` then mints
   under that stale id. I argue that is harmless (the id names nothing on the client or the server).
   Is there a state I have missed where sending from the list joins or corrupts an existing
   conversation, or where the id is NOT free?
2. Focus and the `focused` ref: the list's composer gets its own ref (`listFocused`) and nonce 0.
   Does any path let the list's composer consume a nonce the conversation's composer needs, or vice
   versa?
3. The draft ref: `listDraft.current` is passed as the `draft` prop and written through `onDraft`.
   `Composer` seeds state from `draft` on mount and owns it after. Is there a remount path where
   this loses the reader's words, or shows stale ones?
4. Anything about the CSS: `.chat-empty` gains `flex: 1` so the composer sits on the bottom edge in
   the empty state. `.chat-threads` (the list itself) already has `flex: 1`, `.chat-composer` has a
   top border and does not grow, and `.mode-band` is `display: flex; flex-direction: column`.
5. The test: is it testing the behaviour or the implementation? Would it survive a reasonable
   refactor, and does it miss an obvious case?

## The diff (only my hunks; the files also contain other agents' uncommitted work, which is not
under review)

### src/web/styles.css

```diff
-.chat-empty { padding: 1rem 0.9rem; color: var(--ink-faint); }
+/* `flex: 1` so that the composer beneath it sits on the bottom edge of the
+   band rather than halfway up it, wherever the list is short — the empty state
+   is a paragraph and a button, and the list itself already grows. */
+.chat-empty { flex: 1; padding: 1rem 0.9rem; color: var(--ink-faint); }
```

### src/web/ChatPanel.tsx

```diff
diff --git a/src/web/ChatPanel.tsx b/src/web/ChatPanel.tsx
index b6751f7..ec2715c 100644
--- a/src/web/ChatPanel.tsx
+++ b/src/web/ChatPanel.tsx
@@ -57,6 +57,8 @@ import {
 import { worthRetrying } from "../messages.js";
 import type { BlockId, ChatMessage, ChatThread, ToolRun } from "../types.js";
 import { CitedText } from "./Cited.js";
+import { DictationButton, DictationStrip } from "./DictationStrip.js";
+import { useDictationField } from "./useDictationField.js";
 import { hostOf, isWebUrl } from "../urls.js";
 import { TooltipGroup } from "./Tooltip.js";
 import { exactly, timeAgo } from "./relative-time.js";
@@ -259,6 +261,20 @@ export function ChatPanel({
    */
   const focused = useRef(0);
 
+  /**
+   * The same two things again, for the box under the thread list.
+   *
+   * Separate from `drafts` and `focused` above rather than sharing them, and
+   * each for its own reason. The draft belongs to no conversation — that is the
+   * whole point of the box — so there is no id to key it by; a question typed
+   * there and abandoned for a row in the list is still there when you come
+   * back. And the nonce counter has to be a *different* counter, because
+   * spending the panel's one here would leave the real composer unfocused the
+   * next time a new conversation was started.
+   */
+  const listDraft = useRef("");
+  const listFocused = useRef(0);
+
   /**
    * Leave the open conversation, discarding it if it never became one.
    *
@@ -330,13 +346,51 @@ export function ChatPanel({
           onDraft={(text) => drafts.current.set(open.id, text)}
         />
       ) : (
-        <ThreadList
-          threads={threads}
-          onOpen={onThread}
-          onNew={onNew}
-          onRename={onRename}
-          onDelete={onDelete}
-        />
+        <>
+          <ThreadList
+            threads={threads}
+            onOpen={onThread}
+            onNew={onNew}
+            onRename={onRename}
+            onDelete={onDelete}
+          />
+          {/* The list's own composer. Typing here and pressing Enter starts a
+              conversation and sends the question into it in one go, which is
+              what the reader was going to do with the + button and then the box
+              anyway. Greg, 2026-08-27: *"add a text input box at the bottom
+              that (when a message is input) automatically starts a new chat, to
+              save the user a click."*
+
+              **The same `onSend` the conversation uses, and it mints because
+              nothing is open.** ChatBand hands it `?thread=`, which on the list
+              is null, and `send(null, …)` makes a conversation and opens it —
+              so no second call was needed. The one case where that is not
+              exactly true is a `?thread=` naming a conversation that has been
+              closed and discarded, which leaves the list showing under a stale
+              id (see `started` in ChatBand, App.tsx); the question then starts
+              its conversation under that id instead of a fresh one. Harmless,
+              because a discarded conversation was never written down — the id
+              names nothing, on this client or the server — and the reader gets
+              the new conversation either way.
+
+              `focusNonce={0}` on purpose: this box must never take the caret.
+              The nonce is for a reader who has just *asked* for somewhere to
+              type, and arriving at a list is not that — a focused textarea
+              turns the article's ↑/↓ into caret movement, and nothing on screen
+              would say why. See `focusNonce` in Props. */}
+          <Composer
+            slug={slug}
+            onSend={onSend}
+            busy={false}
+            focusNonce={0}
+            focused={listFocused}
+            draft={listDraft.current}
+            onDraft={(text) => {
+              listDraft.current = text;
+            }}
+            placeholder="Ask something new…"
+          />
+        </>
       )}
     </aside>
   );
@@ -1358,6 +1412,7 @@ export function Composer({
   focused,
   draft,
   onDraft,
+  placeholder,
 }: {
   slug: string;
   onSend(question: string, useProfile: boolean): void;
@@ -1368,6 +1423,12 @@ export function Composer({
   focused: { current: number };
   draft: string;
   onDraft(text: string): void;
+  /**
+   * What the empty box says, when "Ask about this article…" would be a lie
+   * about where the question is going — the box under the thread list starts a
+   * conversation rather than continuing one.
+   */
+  placeholder?: string;
 }) {
   /* Seeded from the draft and owned here from then on. The panel keeps the map
      because it outlives this component; this keeps the value because typing
@@ -1410,7 +1471,33 @@ export function Composer({
     el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
   }, [value]);
 
+  /**
+   * **Dictation, in the box where it is worth most.**
+   *
+   * `{ kind: "article", slug }` is what tells the server to prime the
+   * transcriber with this article's glossary — which is exactly the vocabulary
+   * a reader asking about this article is about to use. Measured on 2026-08-27:
+   * with the terms in the prompt the model got this app's own jargon right
+   * every run; without them it made the same mistakes as every dedicated
+   * speech-to-text model. docs/plans/dictation-two-pass.md.
+   */
+  const dictate = useDictationField({
+    value,
+    onChange: (next) => {
+      setValue(next);
+      onDraft(next);
+    },
+    box,
+    context: { kind: "article", slug },
+  });
+
   const submit = () => {
+    /* **Not while a transcript is on its way.** `readOnly` stops typing and
+       nothing else — Enter still fires, and sending here would post the
+       recogniser's rough guess a moment before the good words arrived, which is
+       the one outcome the two-pass design must not produce. GPT Sol's plan
+       review, item 3. */
+    if (dictate.readOnly) return;
     const question = value.trim();
     if (question === "" || busy) return;
     onSend(question, withProfile);
@@ -1431,7 +1518,8 @@ export function Composer({
         className="chat-input"
         rows={1}
         value={value}
-        placeholder={busy ? "Waiting for the answer…" : "Ask about this article…"}
+        readOnly={dictate.readOnly}
+        placeholder={busy ? "Waiting for the answer…" : (placeholder ?? "Ask about this article…")}
         onChange={(e) => {
           setValue(e.target.value);
           // The panel keeps the draft so it survives this component; see
@@ -1488,10 +1576,18 @@ export function Composer({
           <Square size={12} fill="currentColor" />
         </button>
       ) : (
-        <button type="submit" className="chat-send" disabled={busy || value.trim() === ""} title="Send (Enter)">
+        <button
+          type="submit"
+          className="chat-send"
+          disabled={busy || dictate.readOnly || value.trim() === ""}
+          title="Send (Enter)"
+        >
           {busy ? <LoaderCircle className="cmt-spinner" size={14} /> : <SendHorizontal size={14} />}
         </button>
       )}
+      {dictate.dictation.supported && (
+        <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} disabled={busy} />
+      )}
       {/* Composer-only, and absent for a reader with no profile. Chat has no
           rewrite, so there is nothing here for a label to describe and nothing
           to flip back to — the checkbox governs the next answer and that is
@@ -1502,6 +1598,7 @@ export function Composer({
         hasProfile={hasProfile}
         disabled={busy}
       />
+      <DictationStrip dictation={dictate.dictation} />
     </form>
   );
 }
```

### tests/chat-list-composer.test.tsx (new file, in full)

```tsx
// @vitest-environment jsdom
/**
 * **The box under the list of conversations starts a new one.**
 *
 * Greg, 2026-08-27: *"add a text input box at the bottom that (when a message
 * is input) automatically starts a new chat, to save the user a click."*
 *
 * The thing worth a test is not that a textarea renders. It is that the box
 * **sends**, on Enter, with nothing open — which is the whole feature. The
 * question goes down the ordinary `onSend`, and it mints a conversation rather
 * than joining one because ChatBand passes it the open thread, which on the
 * list is null (`send(null, …)` in useChat.ts). Nothing on screen says that,
 * and the two halves live in different files, so this is the test that holds
 * them together.
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

/** The panel with `threadId` null — which is the list. */
function render(threads: ChatThread[] = [THREAD]): HTMLTextAreaElement {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        threads,
        threadId: null,
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
  const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
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
});
```

## For context

The reviewer was also given the whole of `src/web/ChatPanel.tsx` as it stood, which is not repeated
here — read the file. It carried another agent's in-flight dictation work at the time, which was not
under review.
