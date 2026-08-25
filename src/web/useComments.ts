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
import { useCallback, useEffect, useState } from "react";
import type { Comment } from "../types.js";
import { mintId } from "../ids.js";
import type { SelectionAnchor } from "./selection.js";

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
      .catch((e: Error) => live && setError(e.message));
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
        .then(put)
        .catch((e: Error) => {
          setError(e.message);
          put({ ...pending, status: "error", error: e.message });
        });
    },
    [slug, put],
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
      setComments((prev) => prev.filter((c) => c.id !== id));
      fetch(`/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch((e: Error) => setError(e.message));
    },
    [slug],
  );

  return { comments, ask, retry, remove, error };
}
