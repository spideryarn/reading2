/**
 * The client half of saved meaning-searches — see docs/project/search.md.
 *
 * Shaped on useComments.ts, and now shaped on its *streaming* half too — the
 * server side of the change is `search` in src/routes.ts § search, which has
 * the full account of why a search result, despite being a list rather than
 * prose, is worth streaming: a hit is a complete object the instant its
 * closing brace arrives, the model returns them best-match-first, and
 * nothing about the ranking changes to make that safe to show.
 *
 * Two rules carry this file, both borrowed whole from useComments.ts because
 * both were learned there the hard way:
 *
 * **The id is minted here, not on the server.** `?runs=` has to name something
 * from the first frame, and a server-minted id would mean the panel spent the
 * whole model call attached to a placeholder that then had to be swapped under
 * the URL. Ids are random anyway (docs/project/block-ids.md), so minting
 * client-side costs nothing. (`beginRun` can still reset an *existing* id —
 * see src/searches.ts's `withRun` — which is why the `begin` frame is read
 * for the real id rather than assumed to match what was sent, the same
 * discipline useComments.ts keeps for `commentStore.create`.)
 *
 * **A delete during a search wins.** A search takes fifteen to forty seconds
 * and the reader is free to do anything at all while it is out, including
 * deleting the run. Without the tombstone below, the answer landing would put
 * it back — the response is the whole run, and storing it re-adds a row the
 * reader had already removed. That exact bug was found and fixed in
 * useComments.ts; this is the same fix, not a new one. Streaming adds one more
 * place it has to be checked: a `hit` frame for a run the reader has already
 * deleted must be dropped too, not just the final one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchHit, SearchRun } from "../types.js";
import { mintId } from "../ids.js";
import { describeFetchFailure } from "./useComments.js";
import { readEvents } from "./lib/sse.js";
import { failure, readJson } from "./lib/api.js";

export interface SearchApi {
  runs: SearchRun[];
  /**
   * False until the first fetch has answered, either way.
   *
   * Without it an empty `runs` means two different things and the panel picks
   * the wrong one out loud: for the length of one request it says "Nothing
   * searched for yet", which is a claim about the article rather than about our
   * own request, and it is the *only* thing a reader following a shared link
   * sees. Worse for a legacy `?run=` link, where the URL names an active search
   * and the list underneath says there are none.
   *
   * A flag rather than a nullable `runs`, so nothing downstream has to learn a
   * new shape — the panel asks this question in exactly one place. Raised by a
   * GPT Sol review, 2026-08-26.
   */
  loaded: boolean;
  /** Run a new meaning-search. Returns the id it minted, so `?runs=` can name it. */
  ask(criterion: string): string;
  /** The same criterion again — for a run whose model call failed. */
  retry(id: string): void;
  remove(id: string): void;
  /** A failure of the *transport*, not of the model. Model failures live on the run. */
  error: string | null;
}

export function useSearch(slug: string): SearchApi {
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    /* Reset on every slug, not just on mount: switching article puts the panel
       back to not-knowing, and leaving this true would show the *previous*
       article's emptiness as though it were this one's. */
    setLoaded(false);
    fetch(`/api/search/${encodeURIComponent(slug)}`)
      .then((r) => readJson<{ runs?: SearchRun[]; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setRuns(body.runs ?? []);
        /* Loaded means *the question has been answered*, not *it succeeded*. A
           failed fetch leaves `runs` empty for good, and holding the panel on a
           spinner forever would be a worse lie than the one this fixes — the
           error is reported separately. */
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(describeFetchFailure(e));
        setLoaded(true);
      });
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

  /**
   * Ask the server, and read the run as it is built.
   *
   * Frames: one `begin`, then any number of `hit`, then exactly one `done` —
   * **except when the run was deleted mid-search**, which ends the stream
   * with no `done` at all (src/routes.ts § search explains why a stream
   * cannot answer that case with a 404). The `!settled` check below is how
   * that expected silence is told apart from an actual broken connection: a
   * run this tab has tombstoned is allowed to end quietly, anything else that
   * ends without `done` is reported as a failure.
   */
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

      /* The id the *server* is using. Normally the one we minted; see the
         module docstring on why `beginRun` can reset it instead. Everything
         after the `begin` frame addresses the row by this, not by `id`. */
      let liveId = id;
      let settled = false;

      void (async () => {
        try {
          const r = await fetch(`/api/search/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, criterion }),
          });
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is
             the stream simply ending, handled below. */
          if (!r.ok || !r.body) throw await failure(r);

          for await (const event of readEvents(r.body)) {
            // Computed once per frame, before acting on it: a delete can land
            // between two frames of the same stream, and every branch below
            // has to see the same answer to "is this gone".
            const gone = deleted.current.has(liveId);
            if (event.name === "begin") {
              const begun = event.data as SearchRun;
              if (begun.id !== liveId) {
                // `beginRun` reset a different existing id than the one we
                // sent — drop the row we rendered optimistically under our
                // own, or the reader ends up with two of the same search.
                const stale = liveId;
                setRuns((prev) => prev.filter((r) => r.id !== stale));
                liveId = begun.id;
              }
              if (!gone) put(begun);
              continue;
            }
            if (event.name === "hit") {
              if (!gone) {
                const { hit } = event.data as { hit: SearchHit };
                setRuns((prev) =>
                  prev.map((r) => (r.id === liveId ? { ...r, hits: [...r.hits, hit] } : r)),
                );
              }
              continue;
            }
            if (event.name === "done") {
              settled = true;
              const done = event.data as SearchRun;
              if (deleted.current.has(done.id)) {
                /* Deleted while the answer was in the air. The DELETE we sent
                   may have run *before* the server finished writing, so the
                   row can be back on disk; send it again now that nothing
                   else will write it. */
                void forget(done.id);
                return;
              }
              // The final pass is authoritative and may legitimately differ
              // from what streamed — it *replaces* the accumulated hits
              // rather than merging with them.
              put(done);
              return;
            }
          }

          /* The stream ended without a `done`. A run this tab deleted is
             expected to end exactly this way — see the docstring above and
             src/routes.ts § search. Anything else ending silently is a
             dropped connection, the same failure useComments.ts guards. */
          if (!settled && !deleted.current.has(liveId)) {
            throw new Error("The search stopped arriving. Try again.");
          }
        } catch (e) {
          if (deleted.current.has(liveId)) return;
          const message = describeFetchFailure(e as Error);
          setError(message);
          put({ id: liveId, criterion, createdAt, status: "error", hits: [], error: message });
        }
      })();
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

  return { runs, loaded, ask, retry, remove, error };
}
