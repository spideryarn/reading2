/**
 * The client half of chat — see docs/plans/chat-mode.md.
 *
 * The sibling of useComments.ts, with one difference that shapes the whole
 * file: **the POST is a stream, not an answer.** A comment's POST returns the
 * finished comment and there is nothing to poll; here the response body arrives
 * a few words at a time and the reply is assembled on this side as it comes.
 *
 * Which means `fetch` and a `ReadableStream` reader rather than `EventSource`.
 * `EventSource` is the obvious tool for server-sent events and cannot be used:
 * it only issues GETs, and the question does not belong in a URL — it is
 * arbitrary length and it is the reader's private text, which would then be in
 * every access log between here and the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatThread, Citation } from "../types.js";
import { mintId } from "../ids.js";
import { describeFetchFailure } from "./useComments.js";

export interface ChatApi {
  threads: ChatThread[];
  /* No `streaming` flag here, and its absence is deliberate.
     One was exported and nothing used it — the composer takes its `busy` state
     from the *message* it is waiting on, which is the honest source: sends can
     overlap across threads, and a single boolean would have been set false by
     whichever finished first while another was still arriving. A wrong answer
     nobody was asking for. Removed after a GPT-5.6 review, 2026-08-26. */
  /**
   * Send a question. Returns the thread id it went to — minted here when the
   * reader is starting a new conversation, so `?thread=` can point at something
   * from the first frame rather than after the round trip.
   */
  send(
    threadId: string | null,
    question: string,
    at: string | null,
    /**
     * Called if the server gave the thread a different id than the one sent.
     * See the `begin` frame below — it lets the caller correct `?thread=`
     * rather than leaving the URL pointing at a conversation that is not there.
     */
    onThreadId?: (id: string) => void,
  ): string;
  /** Start an empty conversation locally. Nothing is stored until you send. */
  begin(): string;
  rename(threadId: string, title: string): void;
  remove(threadId: string): void;
  /** A failure of the *transport*. Model failures live on the message. */
  error: string | null;
}

export function useChat(slug: string): ChatApi {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Threads the reader deleted while an answer was still arriving.
   *
   * The same tombstone useComments.ts keeps, and needed for a longer window: an
   * answer streams for tens of seconds and the reader can delete the thread it
   * is landing in at any point during that. Without this, the next frame of the
   * stream puts the thread back — and it comes back one message shorter than it
   * was, which looks like corruption rather than a race.
   *
   * A ref, not state: nothing renders from it, and a stale closure would defeat
   * the point of it.
   */
  const gone = useRef(new Set<string>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — switching article is exactly when the tombstones stop meaning anything, and the effect deliberately reads nothing
  useEffect(() => {
    const forgotten = gone.current;
    return () => forgotten.clear();
  }, [slug]);

  useEffect(() => {
    let live = true;
    setThreads([]);
    fetch(`/api/chat/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((body: { threads?: ChatThread[]; error?: string }) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setThreads(body.threads ?? []);
      })
      .catch((e: Error) => live && setError(describeFetchFailure(e)));
    return () => {
      live = false;
    };
  }, [slug]);

  /** Rewrite one thread in place, or append it if it is new. Deletions win. */
  const put = useCallback((id: string, edit: (t: ChatThread) => ChatThread) => {
    setThreads((prev) => {
      if (gone.current.has(id)) return prev;
      const found = prev.find((t) => t.id === id);
      if (!found) return prev;
      return prev.map((t) => (t.id === id ? edit(t) : t));
    });
  }, []);

  /**
   * A new, empty conversation — local only.
   *
   * Nothing is written to disk until the reader actually sends something, so
   * pressing "New chat" and changing your mind leaves no empty thread behind to
   * clean up. The server's `beginTurn` accepts this id when the first message
   * arrives, which is what makes the optimistic id safe.
   */
  const begin = useCallback(() => {
    const id = mintId();
    const at = new Date().toISOString();
    setThreads((prev) => [...prev, { id, title: "New chat", createdAt: at, updatedAt: at, messages: [] }]);
    return id;
  }, []);

  const send = useCallback(
    (
      threadId: string | null,
      question: string,
      at: string | null,
      onThreadId?: (id: string) => void,
    ): string => {
      const id = threadId ?? mintId();
      /* The id this send is writing into, which is NOT necessarily `id`.
         `beginTurn` on the server may overrule a thread id it cannot accept, and
         every patch after that has to follow it. A `let` closed over by
         `patchReply` rather than a second argument threaded through five call
         sites — and it must not be `id` itself, because the optimistic rows
         above were inserted under that one. */
      let current = id;
      const now = new Date().toISOString();
      const userId = mintId();
      const pendingId = mintId();

      /* Both rows go in optimistically, before the request leaves. The reader's
         own words appearing the instant they press Enter is the difference
         between a composer that feels attached to anything and one that does
         not — and the empty assistant row beneath is what the arriving text
         streams into.

         Their ids are provisional: the server mints its own and says so in the
         `begin` frame, and the ids are swapped there. Nothing renders from an
         id except React's `key`, so the swap costs one re-render of two rows. */
      setThreads((prev) => {
        const user: ChatMessage = { id: userId, role: "user", text: question, createdAt: now, status: "done" };
        const reply: ChatMessage = { id: pendingId, role: "assistant", text: "", createdAt: now, status: "pending" };
        const existing = prev.find((t) => t.id === id);
        const thread: ChatThread = existing
          ? { ...existing, updatedAt: now, messages: [...existing.messages, user, reply] }
          : { id, title: question.slice(0, 60), createdAt: now, updatedAt: now, messages: [user, reply] };
        return existing ? prev.map((t) => (t.id === id ? thread : t)) : [...prev, thread];
      });

      /** Rewrite the assistant row this send is responsible for. */
      const patchReply = (patch: Partial<ChatMessage>) =>
        put(current, (t) => ({
          ...t,
          messages: t.messages.map((m) => (m.id === pendingId ? { ...m, ...patch } : m)),
        }));

      void (async () => {
        try {
          const response = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: id, question, at }),
          });
          if (!response.ok || !response.body) {
            // A failure *before* the stream starts is ordinary JSON — a bad
            // slug, a question over the size cap. After it starts, failures
            // arrive as an `error` frame inside a 200, and are handled below.
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? response.statusText);
          }

          let text = "";
          let finished = false;
          for await (const event of readEvents(response.body)) {
            if (event.name === "begin") {
              const begun = event.data as { threadId: string; title: string; messageId: string };
              // The server's ids replace the provisional ones. `title` too: it
              // is cut on a word boundary there, and the optimistic one above
              // is a blunt 60-character slice that would otherwise stay on
              // screen until the next reload.
              setThreads((prev) =>
                prev.map((t) =>
                  t.id !== current
                    ? t
                    : {
                        ...t,
                        id: begun.threadId,
                        title: t.messages.length <= 2 ? begun.title : t.title,
                      },
                ),
              );
              if (begun.threadId !== current) {
                current = begun.threadId;
                // The URL is pointing at an id the server did not accept. Tell
                // the caller so `?thread=` can follow, or a reload lands on a
                // conversation that does not exist.
                onThreadId?.(begun.threadId);
              }
              continue;
            }
            if (event.name === "delta") {
              text += (event.data as { text: string }).text;
              patchReply({ text });
              continue;
            }
            if (event.name === "done") {
              const done = event.data as { text: string; citations: Citation[]; searches: number; model: string };
              patchReply({ ...done, status: "done" });
              finished = true;
              continue;
            }
            if (event.name === "error") {
              const failed = event.data as { error: string; text: string };
              // The partial answer is kept — the reader watched it appear, and
              // taking it away on failure is more confusing than leaving it
              // there with the failure attached. The server stores it too.
              patchReply({ text: failed.text || text, status: "error", error: failed.error });
              finished = true;
            }
          }
          /* The stream ended without saying how.

             The server always sends `done` or `error` before it ends the
             response, so reaching here means the connection died rather than
             the answer finishing — the dev server restarted mid-answer, the
             laptop slept, a proxy gave up. Without this the row stays `pending`
             and spins for as long as the tab is open, which is exactly the
             failure the server's own sweep exists to catch, one reload later.
             This is the same fix, immediately. */
          if (!finished) {
            patchReply({
              status: "error",
              error: "The connection closed before the answer finished.",
            });
          }
        } catch (e) {
          patchReply({ status: "error", error: describeFetchFailure(e as Error) });
        }
      })();

      return id;
    },
    [slug, put],
  );

  /**
   * A write whose only job is to stick — checked, not assumed.
   *
   * `fetch` resolves for a 404 or a 500; only a transport failure rejects. So a
   * bare `.catch()` on these calls reported success for every error the server
   * could return: the rename or the delete happened on screen, the server said
   * no, and the next reload put the old state back. This app has been bitten by
   * exactly that before — see the note on `forget` in useComments.ts, where a
   * DELETE that 500'd removed a comment from the screen and said nothing.
   * Found again here by a GPT-5.6 review, 2026-08-26.
   */
  const write = useCallback(
    async (threadId: string, init: RequestInit, what: string) => {
      try {
        const r = await fetch(
          `/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}`,
          init,
        );
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? r.statusText);
        }
      } catch (e) {
        // The optimistic change stays on screen. Reverting it would be a second
        // surprise on top of the first, and the message says what happened —
        // the reader can reload to see the truth.
        setError(`Couldn't ${what}: ${describeFetchFailure(e as Error)}`);
      }
    },
    [slug],
  );

  const rename = useCallback(
    (threadId: string, title: string) => {
      put(threadId, (t) => ({ ...t, title }));
      void write(
        threadId,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
        "rename that conversation",
      );
    },
    [put, write],
  );

  const remove = useCallback(
    (threadId: string) => {
      gone.current.add(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      void write(threadId, { method: "DELETE" }, "delete that conversation");
    },
    [write],
  );

  return { threads, send, begin, rename, remove, error };
}

interface ServerEvent {
  name: string;
  data: unknown;
}

/**
 * Server-sent events off a `fetch` body.
 *
 * The mirror of `sseChunks` in src/converse.ts, and it has the same three
 * traps — a frame split across two reads, blank lines between frames, and the
 * fact that a `data:` line is not necessarily JSON. The difference is that
 * frames here are separated by a **blank line** and carry an `event:` name, so
 * the split is on `\n\n` rather than on `\n`.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; anything after the last one is a
      // partial frame and waits for the next read.
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        cut = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): ServerEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  try {
    return { name, data: JSON.parse(data.join("\n")) };
  } catch {
    // A frame we cannot read loses a few words rather than the answer. Same
    // judgement as the server side, and for the same reason.
    return null;
  }
}
