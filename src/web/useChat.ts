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
import { readEvents } from "./lib/sse.js";
import { describeFetchFailure } from "./useComments.js";

export interface ChatApi {
  threads: ChatThread[];
  /**
   * Has the first fetch come back?
   *
   * The caller opens a new conversation when there are none, and "none" is
   * indistinguishable from "not asked yet" without this — so every visit to
   * chat mode would create a thread before the reader's real ones had arrived,
   * and then not create one when they legitimately had none.
   */
  loaded: boolean;
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
  /**
   * Answer the same question again, replacing the answer in place.
   *
   * Only the last answer in a thread — the server refuses anything else with a
   * 409, and the panel only offers the button there. See `retryTurn` in
   * src/chat.ts for why a conversation with a rewritten middle is worse than
   * one you cannot rewrite.
   */
  retry(threadId: string, messageId: string): void;
  /**
   * Rewrite one of the reader's questions and ask it again.
   *
   * **Discards every turn after it.** `discardedAfter` below is how the panel
   * says so before the reader commits.
   */
  edit(threadId: string, messageId: string, question: string, at: string | null): void;
  /**
   * Stop an answer that is still arriving. What has already appeared is kept.
   *
   * Needs the *server's* id for the message, which arrives in the `begin`
   * frame — so a stop pressed in the moment before that is remembered and sent
   * as soon as there is an id to send it with, rather than posting an id the
   * server has never heard of and quietly doing nothing.
   */
  stop(threadId: string, messageId: string): void;
  /** Start an empty conversation locally. Nothing is stored until you send. */
  begin(): string;
  /**
   * Forget an empty conversation. Local only, and a no-op on anything that has
   * a message in it — see `withoutEmpty`.
   */
  discard(threadId: string): void;
  rename(threadId: string, title: string): void;
  remove(threadId: string): void;
  /** A failure of the *transport*. Model failures live on the message. */
  error: string | null;
}

/**
 * What the `begin` frame carries: the ids the server actually minted.
 *
 * The client guesses all of them — a thread id so `?thread=` can be in the URL
 * before anything is sent, and two message ids so the reader's words and the
 * empty answer beneath them can be on screen the instant Enter is pressed. Then
 * the server writes the turn to disk under ids of its own, and every guess that
 * is still on screen is a name for a row that does not exist anywhere else.
 */
export interface Begun {
  threadId: string;
  title: string;
  /** The assistant row the answer streams into. */
  messageId: string;
  /** The question above it. Absent from older servers; see `withServerIds`. */
  questionId?: string;
}

/**
 * Replace this turn's provisional ids with the server's.
 *
 * Pure, and exported, for the reason `withRetry` and `withEdit` are in
 * src/chat.ts: it is a rule about ids that nothing renders, so a mistake in it
 * is invisible until something else needs one of those ids for real. That is
 * exactly how the question id came to be missed — the assistant row was swapped
 * from the first version and the user row was not, nothing on screen changed,
 * and it surfaced weeks later as "That message is not in this conversation."
 * the first time a reader edited a question without reloading first.
 *
 * The question is found by position rather than by id, because its id is the
 * one thing here that is not trustworthy: it is the row immediately above the
 * pending answer, which is what a turn *is*.
 */
export function withServerIds(
  threads: ChatThread[],
  current: string,
  pendingId: string,
  begun: Begun,
): ChatThread[] {
  return threads.map((t) =>
    t.id !== current
      ? t
      : {
          ...t,
          id: begun.threadId,
          // The title is cut on a word boundary on the server; the optimistic
          // one is a blunt 60-character slice that would otherwise stay on
          // screen until the next reload. Only the first turn names a thread,
          // so only the first turn takes it.
          title: t.messages.length <= 2 ? begun.title : t.title,
          messages: t.messages.map((m, i) => {
            if (m.id === pendingId) return { ...m, id: begun.messageId };
            if (begun.questionId && m.role === "user" && t.messages[i + 1]?.id === pendingId) {
              return { ...m, id: begun.questionId };
            }
            return m;
          }),
        },
  );
}

/**
 * Drop a conversation that never had anything said in it.
 *
 * The guard is the whole function, and it leans on an invariant that has to
 * hold on the other side of the wire: **an empty thread exists only in the tab
 * that started it.** Given that, dropping it costs nothing and touches no
 * server. A thread with a message in it is on disk, and removing it here would
 * take it off the screen while leaving it in the file — a deletion that did not
 * delete, undone by the next reload. That is why the id alone is not enough to
 * authorise this, and why `remove` (which does talk to the server) stays a
 * separate call.
 *
 * The invariant is not free: src/chat.ts had an unused `createThread` that
 * wrote an empty thread straight to disk, and one caller of it would have made
 * this function exactly the deletion-that-does-not-delete above. It was deleted
 * rather than left lying there, and the note in its place says why. Found by a
 * GPT-5.6 review, 2026-08-26.
 */
export function withoutEmpty(threads: ChatThread[], id: string): ChatThread[] {
  return threads.filter((t) => !(t.id === id && t.messages.length === 0));
}

export function useChat(slug: string): ChatApi {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(false);
    fetch(`/api/chat/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((body: { threads?: ChatThread[]; error?: string }) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setThreads(body.threads ?? []);
      })
      .catch((e: Error) => live && setError(describeFetchFailure(e)))
      // `loaded` even when the fetch failed. It means "we have asked", not "it
      // worked" — a reader whose server is down should still be able to open a
      // conversation and see the send fail with a reason, rather than face a
      // panel that never resolves into anything.
      .finally(() => {
        if (live) setLoaded(true);
      });
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

  /**
   * Forget an empty conversation the reader changed their mind about.
   *
   * No tombstone in `gone`, unlike `remove`: nothing is in flight for a thread
   * with no messages — a send inserts its two rows before the request leaves —
   * so there is no late frame that could put this one back.
   */
  const discard = useCallback((threadId: string) => {
    setThreads((prev) => withoutEmpty(prev, threadId));
  }, []);

  /**
   * Ids of assistant rows the reader pressed stop on before the server had
   * named them.
   *
   * The `begin` frame is what tells the client the real message id, and it is
   * the only id `/stop` will accept. It arrives fast — it is written before the
   * model is called — but "fast" is not "first", and a stop that lands in that
   * window used to post a provisional id, get `{stopped: false}`, and stop
   * nothing while the button reported that it had. So the wish is written down
   * here and honoured the moment there is an id for it.
   */
  const stopWanted = useRef(new Set<string>());

  /**
   * Ask the server to stop one answer.
   *
   * The reply is `{ stopped }`, and `false` is not a failure — it means the
   * answer had already finished, or another tab got there first. Only a
   * transport failure or a non-2xx is worth telling the reader about, and it is
   * told rather than swallowed: a stop button that silently does nothing is the
   * exact shape docs/reusable/silent-success.md is about.
   */
  const askToStop = useCallback(
    async (threadId: string, messageId: string) => {
      try {
        const r = await fetch(
          `/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/stop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId }),
          },
        );
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? r.statusText);
        }
      } catch (e) {
        setError(`Couldn't stop that answer: ${describeFetchFailure(e as Error)}`);
      }
    },
    [slug],
  );

  /**
   * The reader pressed stop.
   *
   * The wish is recorded *before* the request goes out, so that a stop landing
   * in the window before the `begin` frame is not lost — see `stopWanted`. The
   * row is not touched here: the server answers the still-open stream with a
   * `done` frame carrying whatever had arrived, and letting that frame be the
   * one thing that ends a turn is what keeps the screen and the file agreeing.
   */
  const stop = useCallback(
    (threadId: string, messageId: string) => {
      stopWanted.current.add(messageId);
      void askToStop(threadId, messageId);
    },
    [askToStop],
  );

  /**
   * Open the stream, and keep one assistant row in step with it.
   *
   * All three of `send`, `retry` and `edit` end up here, because from the
   * moment the POST leaves they are the same thing: a body, one row to write
   * the arriving words into, and the four ways it can end. What differs is only
   * what the caller put on screen first and what it puts in `payload`.
   */
  const run = useCallback(
    (
      threadId: string,
      payload: Record<string, unknown>,
      /** The row the words land in. Provisional until the `begin` frame. */
      replyId: string,
      onThreadId?: (id: string) => void,
    ): void => {
      const id = threadId;
      /* Cleared on the way in as well as on the way out.

         A stop that fires *after* a run's `finally` — the reader clicks in the
         frame between the last token and the row repainting as `done` — leaves
         its wish in the set with nothing left to consume it. Harmless on its
         own, and not harmless at all once `retryTurn` started reusing the
         message id: the retry's `begin` frame would find the stale wish, stop
         the new answer before its first token, and leave a retry button that
         looks broken. Found in review, 2026-08-26. */
      stopWanted.current.delete(replyId);
      /* The id this send is writing into, which is NOT necessarily `id`.
         `beginTurn` on the server may overrule a thread id it cannot accept, and
         every patch after that has to follow it. A `let` closed over by
         `patchReply` rather than a second argument threaded through five call
         sites — and it must not be `id` itself, because the optimistic rows
         above were inserted under that one. */
      let current = id;
      /* And the same for the *message* id, which used not to be followed at all:
         the `begin` frame carried one and the client kept its own, so the two
         disagreed until the next reload. Nothing rendered from it, so nothing
         showed — until `stop` needed to name the row it wanted stopped, and
         found the only name it had was one the server had never heard of. */
      let pendingId = replyId;

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
            body: JSON.stringify({ threadId: id, ...payload }),
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
              const begun = event.data as Begun;
              setThreads((prev) => withServerIds(prev, current, pendingId, begun));
              const wanted =
                stopWanted.current.delete(pendingId) || stopWanted.current.delete(begun.messageId);
              pendingId = begun.messageId;
              if (begun.threadId !== current) {
                current = begun.threadId;
                // The URL is pointing at an id the server did not accept. Tell
                // the caller so `?thread=` can follow, or a reload lands on a
                // conversation that does not exist.
                onThreadId?.(begun.threadId);
              }
              // A stop pressed before this frame arrived. Now there is an id
              // for it, so it happens rather than being dropped on the floor.
              if (wanted) void askToStop(current, pendingId);
              continue;
            }
            if (event.name === "delta") {
              text += (event.data as { text: string }).text;
              patchReply({ text });
              continue;
            }
            if (event.name === "done") {
              const done = event.data as {
                text: string;
                citations: Citation[];
                searches: number;
                model: string;
                stopped?: boolean;
              };
              /* `stopped: false` explicitly, not left off. This row may be a
                 retry of one that *was* stopped, and a patch that omits the
                 field leaves the old `true` sitting under new text — a complete
                 answer wearing "Stopped" underneath it. */
              patchReply({ stopped: false, ...done, status: "done" });
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
        } finally {
          // Whatever happened, nobody is waiting to stop this any more.
          stopWanted.current.delete(replyId);
          stopWanted.current.delete(pendingId);
        }
      })();
    },
    [slug, put, askToStop],
  );

  const send = useCallback(
    (
      threadId: string | null,
      question: string,
      at: string | null,
      onThreadId?: (id: string) => void,
    ): string => {
      const id = threadId ?? mintId();
      const now = new Date().toISOString();
      const pendingId = mintId();

      /* Both rows go in optimistically, before the request leaves. The reader's
         own words appearing the instant they press Enter is the difference
         between a composer that feels attached to anything and one that does
         not — and the empty assistant row beneath is what the arriving text
         streams into.

         Their ids are provisional: the server mints its own and says so in the
         `begin` frame, and the ids are swapped there. */
      setThreads((prev) => {
        const user: ChatMessage = {
          id: mintId(),
          role: "user",
          text: question,
          createdAt: now,
          status: "done",
        };
        const reply: ChatMessage = {
          id: pendingId,
          role: "assistant",
          text: "",
          createdAt: now,
          status: "pending",
        };
        const existing = prev.find((t) => t.id === id);
        const thread: ChatThread = existing
          ? { ...existing, updatedAt: now, messages: [...existing.messages, user, reply] }
          : { id, title: question.slice(0, 60), createdAt: now, updatedAt: now, messages: [user, reply] };
        return existing ? prev.map((t) => (t.id === id ? thread : t)) : [...prev, thread];
      });

      run(id, { question, at }, pendingId, onThreadId);
      return id;
    },
    [run],
  );

  const retry = useCallback(
    (threadId: string, messageId: string) => {
      /* Blanked field by field, for the same reason `retryTurn` rebuilds the
         stored row rather than spreading it: `citations`, `searches` and the
         old `error` all belong to the answer being replaced, and any one of
         them left behind sits under text that never mentioned it. */
      put(threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.id === messageId
            ? {
                id: m.id,
                role: m.role,
                text: "",
                createdAt: new Date().toISOString(),
                status: "pending" as const,
              }
            : m,
        ),
      }));
      // No `at`: a retry re-asks the stored question, and where the reader has
      // scrolled to since is not part of it.
      run(threadId, { retry: messageId }, messageId);
    },
    [put, run],
  );

  const edit = useCallback(
    (threadId: string, messageId: string, question: string, at: string | null) => {
      const now = new Date().toISOString();
      const pendingId = mintId();
      put(threadId, (t) => {
        const index = t.messages.findIndex((m) => m.id === messageId);
        if (index < 0) return t;
        const target = t.messages[index];
        if (!target) return t;
        return {
          ...t,
          // The same rule the server applies in `editTurn`: the first question
          // names the thread, so rewriting it renames the thread.
          title: index === 0 ? question.slice(0, 60) : t.title,
          updatedAt: now,
          messages: [
            ...t.messages.slice(0, index),
            { ...target, text: question, editedAt: now },
            { id: pendingId, role: "assistant" as const, text: "", createdAt: now, status: "pending" as const },
          ],
        };
      });
      run(threadId, { edit: messageId, question, at }, pendingId);
    },
    [put, run],
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

  return { threads, loaded, send, retry, edit, stop, begin, discard, rename, remove, error };
}
