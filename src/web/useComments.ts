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
import type { SelectionAnchor } from "./selection.js";

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
  // A TypeError from fetch means the request never got a response at all; an
  // Error we threw ourselves already carries a real message from the server.
  return error instanceof TypeError
    ? `Couldn't reach the dev server — is \`npm run dev\` still running? (${error.message})`
    : error.message;
}

export interface CommentsApi {
  comments: Comment[];
  /** Ask about a selection. Returns the id it minted, so the caller can open it. */
  ask(anchor: SelectionAnchor): string;
  /** Ask the same question again — for a comment whose model call failed. */
  retry(id: string): void;
  remove(id: string): void;
  /** A failure of the *transport*, not of the model. Model failures live on the comment. */
  error: string | null;
}

export function useComments(slug: string): CommentsApi {
  const [comments, setComments] = useState<Comment[]>([]);
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
      .then((r) => r.json())
      .then((body: { comments?: Comment[]; error?: string }) => {
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
  const put = useCallback((next: Comment) => {
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
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? r.statusText);
        }
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  const send = useCallback(
    (input: Comment) => {
      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it.
      const pending: Comment = {
        id: input.id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: input.createdAt,
        status: "pending",
      };
      put(pending);
      setError(null);
      // Asking again un-deletes: the reader is plainly no longer finished with
      // it, whatever they clicked a moment ago.
      deleted.current.delete(pending.id);
      fetch(`/api/comments/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pending.id,
          blockId: pending.blockId,
          quote: pending.quote,
          start: pending.start,
        }),
      })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? r.statusText);
          return body as Comment;
        })
        // The server always answers with the whole comment, `status: "error"`
        // included, so there is one code path for "the model failed" and it is
        // the same one as for success.
        .then((answered) => {
          if (deleted.current.has(pending.id)) {
            // Deleted while the answer was in the air. The DELETE we sent may
            // have run *before* the POST finished writing, so the row can be
            // back on disk; send it again now that nothing else will write it.
            void forget(pending.id);
            return;
          }
          put(answered);
        })
        .catch((e: Error) => {
          if (deleted.current.has(pending.id)) return;
          const message = describeFetchFailure(e);
          setError(message);
          put({ ...pending, status: "error", error: message });
        });
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

  return { comments, ask, retry, remove, error };
}
