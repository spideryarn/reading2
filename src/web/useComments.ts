/**
 * The client half of comments — see docs/project/comments.md.
 *
 * One rule shapes this file: **the id is minted here, not on the server.** The
 * dialog opens the instant the reader lets go of the mouse, and `?note=` has to
 * name something; if the server minted the id, the dialog would spend the whole
 * model call attached to a placeholder that then had to be swapped out under
 * the URL. Minting client-side costs nothing (ids are random anyway —
 * docs/project/block-ids.md) and the id is real from the first frame.
 *
 * The POST is therefore also the answer: it returns the finished comment, so
 * there is nothing to poll.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "../types.js";
import { mintId } from "../ids.js";
import { readEvents, StreamStalled, STREAM_STALL_MS } from "./lib/sse.js";
import { wentQuiet } from "../messages.js";
import type { SelectionAnchor } from "./selection.js";
import { failure, readJson } from "./lib/api.js";

/**
 * What to say when the request never reached the server.
 *
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for every
 * transport-level failure — server down, connection reset, request cut off
 * mid-flight — and that message tells a reader nothing they can act on. It is
 * also the failure they are most likely to hit: an explain call takes 15-25
 * seconds, and `npm run dev` restarts whenever vite.config.ts changes, so the
 * window for a request to be orphaned is wide. Greg hit exactly this on
 * 2026-08-25, with the dev server simply not running.
 *
 * The original text is kept in parentheses so the message is still searchable.
 */
export function describeFetchFailure(error: Error): string {
  /* A stream that stopped delivering bytes. `StreamStalled`'s own message is
     written for whoever is reading a stack trace — "the stream sent nothing for
     60s" — and `wentQuiet` is the same fact said to a reader, with the bracketed
     code every other failure here carries. Handled in the one function all three
     hooks describe their failures through, rather than at each of the three
     `catch` blocks, because a raw class message reaching a reader is exactly the
     kind of thing that only shows up when the failure does. */
  if (error instanceof StreamStalled) return wentQuiet(error.seconds).message;
  // A TypeError from fetch means the request never got a response at all; an
  // Error we threw ourselves already carries a real message from the server.
  return error instanceof TypeError
    ? `Couldn't reach the dev server — is \`npm run dev\` still running? (${error.message})`
    : error.message;
}

/**
 * A stored comment, plus what only this tab knows about it.
 *
 * `replacing` marks the one state the stored shape cannot express: a `pending`
 * row whose `answer` is the *previous* answer, kept on screen while a deeper
 * search is running. Without it the panel cannot tell that from an answer
 * arriving a few words at a time — both are `pending` with text — and would put
 * a typing cursor on the end of an answer that finished five minutes ago.
 *
 * It is never sent and never stored. `createComment` builds its row from named
 * fields (src/comments.ts), so there is nowhere for it to leak to even if it
 * were sent.
 */
export interface ClientComment extends Comment {
  replacing?: true;
}

export interface CommentsApi {
  comments: ClientComment[];
  /** Ask about a selection. Returns the id it minted, so the caller can open it. */
  ask(anchor: SelectionAnchor): string;
  /** Ask the same question again — for a comment whose model call failed. */
  retry(id: string): void;
  /**
   * Ask again, and search properly this time — for an answer the reader has
   * read and judged thin. Replaces the answer in place.
   */
  deepen(id: string): void;
  remove(id: string): void;
  /** A failure of the *transport*, not of the model. Model failures live on the comment. */
  error: string | null;
}

export function useComments(slug: string): CommentsApi {
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ids the reader has deleted while their answer was still in the air.
   *
   * A POST takes 15-25 seconds and the reader is free to do anything at all
   * while it is out. Deleting during that window used to bring the comment
   * *back* when the answer landed: the response is the whole comment, and
   * storing it re-added a row the reader had already removed, mark and all.
   * This tombstone is what makes the delete win.
   *
   * A ref, not state: nothing renders from it, and a stale closure here would
   * defeat the entire point.
   */
  const deleted = useRef(new Set<string>());

  // Switching article throws the tombstones away with the comments they name.
  useEffect(() => {
    const gone = deleted.current;
    return () => gone.clear();
  }, [slug]);

  useEffect(() => {
    let live = true;
    setComments([]);
    fetch(`/api/comments/${encodeURIComponent(slug)}`)
      .then((r) => readJson<{ comments?: Comment[]; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setComments(body.comments ?? []);
      })
      .catch((e: Error) => live && setError(describeFetchFailure(e)));
    return () => {
      live = false;
    };
  }, [slug]);

  /** Replace one comment in place, or append it if it is new. */
  const put = useCallback((next: ClientComment) => {
    setComments((prev) =>
      prev.some((c) => c.id === next.id)
        ? prev.map((c) => (c.id === next.id ? next : c))
        : [...prev, next],
    );
  }, []);

  /** The DELETE itself, checked. Also used to re-delete after a late answer. */
  const forget = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(
          `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        // A DELETE that 500s used to remove the comment from the screen and say
        // nothing, so the reader saw it gone and found it back after a reload.
        if (!r.ok) throw await failure(r);
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  /**
   * Ask the server, and read the answer as it is written.
   *
   * `deep` is the reader saying the answer they have is not good enough — see
   * src/explain.ts. It is passed straight through; nothing about the request
   * shape changes, deliberately, because the tool definition is part of the
   * cached prefix.
   */
  const send = useCallback(
    (input: Comment, deep = false) => {
      /* What is on screen right now, kept so a failed re-ask can put it back.
         Without this, pressing "Search the web properly" on a good answer and
         having the second call fail leaves the reader with an error where their
         answer used to be, and no way back to it. The server has already
         overwritten the stored one by then, so this copy is the only one left. */
      const previous = deep ? input.answer : undefined;

      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it. A deep
      // re-ask keeps the old answer on screen instead: the reader is replacing
      // something they can still read, not waiting on nothing.
      const pending: ClientComment = {
        id: input.id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: input.createdAt,
        status: "pending",
        ...(previous ? { answer: previous, replacing: true as const } : {}),
      };
      put(pending);
      setError(null);
      // Asking again un-deletes: the reader is plainly no longer finished with
      // it, whatever they clicked a moment ago.
      deleted.current.delete(pending.id);

      /* The id the *server* is using. It is normally the one we minted, but
         `commentStore.create` re-mints a malformed or colliding one, and the
         `begin` frame is how we find out. Everything after that point addresses
         the row by this, not by `pending.id`. */
      let id = pending.id;
      let text = "";
      let settled = false;

      void (async () => {
        try {
          const r = await fetch(`/api/comments/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: pending.id,
              blockId: pending.blockId,
              quote: pending.quote,
              start: pending.start,
              ...(deep ? { deep: true } : {}),
            }),
          });
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is a
             `done` frame carrying `status: "error"`. Two shapes, because they
             are two different things, and only the first can be an HTTP code. */
          if (!r.ok || !r.body) throw await failure(r);

          /* A clock on the bytes. Nothing here can *recover* the way chat does —
             there is no `pending` comment row for a watcher to adopt, and the
             answer the server finished writing simply appears on the next
             reload — so all this buys is a failure the reader can see instead
             of a spinner that never stops. That is most of the value: the bug
             this was built for was a panel that said "thinking…" for ever.
             `sse(res)` beats every 15 seconds on this route too, so the same
             60-second silence means the same thing here. */
          for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
            /* **Read to the end even when the reader has deleted it.** Breaking
               out here was the obvious thing and it loses the row: the server
               writes the answer on its own `done`, *after* our DELETE has run,
               so the comment comes back on the next reload. The `done` branch
               below is what re-sends the DELETE once the write it is racing has
               definitely landed — so the loop has to reach it. Until then the
               deleted row is simply not drawn. */
            const gone = deleted.current.has(id);
            if (event.name === "begin") {
              const begun = event.data as Comment;
              if (begun.id !== id) {
                /* The server re-minted. Drop the row we invented before the
                   real one lands, or the reader ends up with two of the same
                   comment — `put` appends anything it does not recognise, so
                   the optimistic one would simply stay. */
                const stale = id;
                setComments((prev) => prev.filter((c) => c.id !== stale));
                id = begun.id;
              }
              if (!gone) {
                put({ ...begun, ...(previous ? { answer: previous, replacing: true as const } : {}) });
              }
              continue;
            }
            if (event.name === "delta") {
              // The first delta is where the old answer goes: from here on the
              // reader is watching the new one, and showing both would read as
              // a rendering fault.
              text += (event.data as { text: string }).text;
              // `replacing` deliberately dropped: from the first word on, what
              // is on screen is the new answer, not the old one being held.
              if (!gone) {
                put({
                  id,
                  blockId: pending.blockId,
                  quote: pending.quote,
                  start: pending.start,
                  createdAt: pending.createdAt,
                  status: "pending",
                  answer: text,
                });
              }
              continue;
            }
            if (event.name === "done") {
              settled = true;
              const done = event.data as Comment;
              if (deleted.current.has(done.id)) {
                /* Deleted while the answer was in the air. The DELETE we sent
                   may have run *before* the server finished writing, so the row
                   can be back on disk; send it again now that nothing else will
                   write it. */
                void forget(done.id);
                return;
              }
              put(done);
              return;
            }
          }

          /* The stream ended without a `done`. The connection dropped, or a
             proxy cut it — either way nobody is coming, and leaving the row
             `pending` is a spinner that never stops. Chat learned this the same
             way; see the `!finished` guard in useChat.ts. */
          if (!settled && !deleted.current.has(id)) {
            throw new Error("The answer stopped arriving. Try again.");
          }
        } catch (e) {
          if (deleted.current.has(id)) return;
          const message = describeFetchFailure(e as Error);
          setError(message);
          put({
            ...pending,
            id,
            status: "error",
            error: message,
            /* Whichever we have: what arrived before it broke, or — if nothing
               did and this was a re-ask — the answer the reader already had.
               Losing a good answer to a failed attempt at a better one is the
               one outcome this button must not produce. */
            ...(text.trim()
              ? { answer: text.trim() }
              : previous
                ? { answer: previous, replacing: true as const }
                : {}),
          });
        }
      })();
    },
    [slug, put, forget],
  );

  const ask = useCallback(
    (anchor: SelectionAnchor) => {
      const id = mintId();
      send({
        id,
        blockId: anchor.blockId,
        quote: anchor.quote,
        start: anchor.start,
        createdAt: new Date().toISOString(),
        status: "pending",
      });
      return id;
    },
    [send],
  );

  /**
   * Re-ask a question whose model call failed.
   *
   * Reads `comments` from the closure rather than from a `setComments` updater.
   * An updater must be pure — React StrictMode invokes it twice — and the first
   * version of this fired the POST from inside one, which sent two requests,
   * spent two model calls, and left the dialog watching an id neither of them
   * came back with. The server is idempotent on the id as well (src/comments.ts),
   * so a duplicate would now be harmless; this is the belt.
   */
  const retry = useCallback(
    (id: string) => {
      const existing = comments.find((c) => c.id === id);
      if (existing) send({ ...existing, status: "pending" });
    },
    [comments, send],
  );

  /**
   * Ask again, and this time go and look.
   *
   * The same call as `retry`, with `deep` set — the reader has read an answer
   * and said it was not enough, which is a different statement from "that
   * failed" and gets a different sentence in the prompt (src/explain.ts).
   *
   * It **replaces** the answer rather than adding one. A comment is one
   * question and one answer; a second would need a schema that can hold two and
   * a panel that can show them. The old answer stays on screen until the new
   * text starts arriving, and comes back if the re-ask fails — see `send`.
   */
  const deepen = useCallback(
    (id: string) => {
      const existing = comments.find((c) => c.id === id);
      if (existing) send(existing, true);
    },
    [comments, send],
  );

  const remove = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
      // If a POST is still out, its `.then` re-sends the DELETE once the write
      // it is racing has definitely landed. Doing it only here would let the
      // POST write the row back after we deleted it.
      void forget(id);
    },
    [forget],
  );

  return { comments, ask, retry, deepen, remove, error };
}
