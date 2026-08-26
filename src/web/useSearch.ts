/**
 * The client half of saved meaning-searches — see docs/project/search.md.
 *
 * The sibling of useComments.ts, and shaped on it rather than on useChat.ts,
 * because a search result is a list rather than a stream: one POST, one answer,
 * nothing to watch arrive. Two rules carry the file, and both are borrowed
 * whole from the comment hook because both were learned there the hard way.
 *
 * **The id is minted here, not on the server.** `?run=` has to name something
 * from the first frame, and a server-minted id would mean the panel spent the
 * whole model call attached to a placeholder that then had to be swapped under
 * the URL. Ids are random anyway (docs/project/block-ids.md), so minting
 * client-side costs nothing.
 *
 * **A delete during a search wins.** A search takes fifteen to forty seconds
 * and the reader is free to do anything at all while it is out, including
 * deleting the run. Without the tombstone below, the answer landing would put
 * it back — the response is the whole run, and storing it re-adds a row the
 * reader had already removed. That exact bug was found and fixed in
 * useComments.ts; this is the same fix, not a new one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchRun } from "../types.js";
import { mintId } from "../ids.js";
import { describeFetchFailure } from "./useComments.js";
import { failure, readJson } from "./lib/api.js";

export interface SearchApi {
  runs: SearchRun[];
  /** Run a new meaning-search. Returns the id it minted, so `?run=` can name it. */
  ask(criterion: string): string;
  /** The same criterion again — for a run whose model call failed. */
  retry(id: string): void;
  remove(id: string): void;
  /** A failure of the *transport*, not of the model. Model failures live on the run. */
  error: string | null;
}

export function useSearch(slug: string): SearchApi {
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Ids the reader deleted while their answer was still in the air. */
  const deleted = useRef(new Set<string>());

  // Switching article throws the tombstones away with the runs they name.
  useEffect(() => {
    const gone = deleted.current;
    return () => gone.clear();
  }, [slug]);

  useEffect(() => {
    let live = true;
    setRuns([]);
    fetch(`/api/search/${encodeURIComponent(slug)}`)
      .then((r) => readJson<{ runs?: SearchRun[]; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setRuns(body.runs ?? []);
      })
      .catch((e: Error) => live && setError(describeFetchFailure(e)));
    return () => {
      live = false;
    };
  }, [slug]);

  /** Replace one run in place, or append it if it is new. */
  const put = useCallback((next: SearchRun) => {
    setRuns((prev) =>
      prev.some((r) => r.id === next.id) ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next],
    );
  }, []);

  const forget = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(
          `/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        // A DELETE that 500s used to remove the row from the screen and say
        // nothing, so the reader saw it gone and found it back after a reload.
        // Same line, same reason, as useComments.ts.
        if (!r.ok) throw await failure(r);
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  const send = useCallback(
    (id: string, criterion: string, createdAt: string) => {
      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it.
      const pending: SearchRun = { id, criterion, createdAt, status: "pending", hits: [] };
      put(pending);
      setError(null);
      // Searching again un-deletes: the reader is plainly no longer finished
      // with it, whatever they clicked a moment ago.
      deleted.current.delete(id);
      fetch(`/api/search/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, criterion }),
      })
        .then((r) => readJson<SearchRun>(r))
        // The server always answers with the whole run, `status: "error"`
        // included, so there is one code path for "the model failed" and it is
        // the same one as for success.
        .then((answered) => {
          if (deleted.current.has(id)) {
            /* Deleted while the answer was in the air. The server's own
               `finishRun` refuses to resurrect a run that is not there, so on
               the happy path the row is already gone from disk — but the DELETE
               and the final write race, so re-sending it now that nothing else
               will write is what makes the delete certain. Cheap, and the
               alternative is a saved search the reader deleted coming back on
               the next reload. */
            void forget(id);
            return;
          }
          put(answered);
        })
        .catch((e: Error) => {
          if (deleted.current.has(id)) return;
          const message = describeFetchFailure(e);
          setError(message);
          put({ ...pending, status: "error", error: message });
        });
    },
    [slug, put, forget],
  );

  const ask = useCallback(
    (criterion: string) => {
      const id = mintId();
      send(id, criterion.trim(), new Date().toISOString());
      return id;
    },
    [send],
  );

  /**
   * Run a search whose model call failed, again.
   *
   * Reads `runs` from the closure rather than from a `setRuns` updater. An
   * updater must be pure — React StrictMode invokes it twice — and firing a
   * POST from inside one sends two requests and spends two model calls. That
   * bug is recorded in useComments.ts § retry; this is the same shape, avoided
   * the same way.
   */
  const retry = useCallback(
    (id: string) => {
      const existing = runs.find((r) => r.id === id);
      if (existing) send(existing.id, existing.criterion, existing.createdAt);
    },
    [runs, send],
  );

  const remove = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      // If a POST is still out, its `.then` re-sends the DELETE once the write
      // it is racing has definitely landed. Doing it only here would let the
      // POST write the row back after we deleted it.
      void forget(id);
    },
    [forget],
  );

  return { runs, ask, retry, remove, error };
}
