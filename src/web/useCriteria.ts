/**
 * The client half of a referee's criteria — Stage 3 of
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md.
 *
 * **`useSearch.ts` with three frames renamed**, and it is deliberately that
 * rather than something better: every rule in that file was learned the hard
 * way, three of them from postmortems, and a second hook that "improved" one of
 * them is how the two panels come to behave differently under the same failure.
 * Read it for the full account; what is repeated here is only the list, so
 * nobody has to guess which rules survived the copy.
 *
 * - **The id is minted here, not on the server.** `?crits=` has to be able to
 *   name a real row from the first frame. The `begin` frame is still read for
 *   the id the server actually used, because `withCriterion` may reset an
 *   existing row instead of minting one.
 * - **A delete during a run wins.** A criterion takes tens of seconds — a
 *   `literature` one can take two minutes — and the referee is free to delete
 *   it meanwhile. Without the tombstone the answer landing would put the row
 *   back, because the response is the whole row.
 * - **A `result` frame for a deleted row is dropped too**, not just the final
 *   one.
 * - **This tab's colour choice beats a frame carrying an older one**, and two
 *   PATCHes for one row are chained so they cannot land out of order.
 * - **`retry` reads from the closure, not from a `setState` updater.** An
 *   updater must be pure and StrictMode calls it twice; firing a POST from
 *   inside one spends two model calls. That bug is recorded in useComments.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mintId } from "../ids.js";
import type { RefereeCriterionConfig, RefereeResult } from "../referee-criteria.js";
import type { SavedCriterion } from "../saved-criteria.js";
import { isStale } from "../search-stale.js";
import { apiFetch, failure, fetchOk, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { describeFetchFailure } from "./useComments.js";

/** A saved criterion, plus the one thing about it that is not on the row. */
export interface SavedCriterionState extends SavedCriterion {
  /** The paper has moved since this criterion was answered — or we cannot tell. */
  stale: boolean;
}

export interface CriteriaApi {
  criteria: SavedCriterionState[];
  /** False until the first fetch has answered, either way — `SearchApi.loaded`. */
  loaded: boolean;
  /** Did that first fetch fail? The half `loaded` cannot carry. */
  loadFailed: boolean;
  /** Run a new criterion. Returns the id it minted, so `?crits=` can name it. */
  ask(criterion: string, config: RefereeCriterionConfig): string;
  /** The same criterion again — for one whose model call failed. */
  retry(id: string): void;
  remove(id: string): void;
  /** Pin a criterion to a palette slot — `null` puts it back on the hash. */
  recolour(id: string, colour: number | null): void;
  /** A failure of the *transport*. Model failures live on the row. */
  error: string | null;
}

/** One row wearing a colour choice — the key removed rather than set undefined. */
function withChoice(row: SavedCriterion, colour: number | null | undefined): SavedCriterion {
  const { colour: _was, ...rest } = row;
  return colour === null || colour === undefined ? rest : { ...rest, colour };
}

const url = (slug: string) => `/api/referee/criteria/${encodeURIComponent(slug)}`;
const one = (slug: string, id: string) => `${url(slug)}/${encodeURIComponent(id)}`;

export function useCriteria(slug: string): CriteriaApi {
  const [rows, setRows] = useState<SavedCriterion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The paper's fingerprint, as the server last reported it. Three states, and
   * the third earns the wrapper: `null` is *we have not been told*, and
   * `{ hash: undefined }` is *the server checked and cannot tell*. Applying
   * "unknown counts as stale" to a response that simply did not carry the field
   * would put a warning on every criterion at once.
   */
  const [fingerprint, setFingerprint] = useState<{ hash: string | undefined } | null>(null);

  /** Ids the referee deleted while their answer was still in the air. */
  const deleted = useRef(new Set<string>());
  /** Colours this tab has chosen, by id. `null` is a value, not a deletion. */
  const chosen = useRef(new Map<string, number | null>());
  /** The last PATCH in flight for each row, so a second one waits for it. */
  const patching = useRef(new Map<string, Promise<void>>());

  // Switching article throws the tombstones away with the rows they name.
  useEffect(() => {
    const gone = deleted.current;
    const picks = chosen.current;
    const chains = patching.current;
    return () => {
      gone.clear();
      picks.clear();
      chains.clear();
    };
  }, [slug]);

  useEffect(() => {
    let live = true;
    setRows([]);
    setLoaded(false);
    setLoadFailed(false);
    setFingerprint(null);
    apiFetch(url(slug))
      .then((r) =>
        readJson<{ criteria?: SavedCriterion[]; sourceHash?: string; error?: string }>(r),
      )
      .then((body) => {
        if (!live) return;
        if (body.error) {
          setError(body.error);
          setLoadFailed(true);
        } else {
          setRows(body.criteria ?? []);
          /* `in`, not truthiness: the server sends `sourceHash: undefined` —
             which JSON drops — for a paper whose blocks it could not read, and
             that is a real answer meaning "we checked and cannot tell". */
          if ("sourceHash" in body) setFingerprint({ hash: body.sourceHash });
        }
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(describeFetchFailure(e));
        setLoadFailed(true);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  /** Replace one row in place, or append it if it is new. */
  const put = useCallback((next: SavedCriterion) => {
    const row = chosen.current.has(next.id) ? withChoice(next, chosen.current.get(next.id)) : next;
    setRows((prev) =>
      prev.some((c) => c.id === row.id)
        ? prev.map((c) => (c.id === row.id ? row : c))
        : [...prev, row],
    );
  }, []);

  const forget = useCallback(
    async (id: string) => {
      try {
        // `fetchOk`, not `apiFetch`: a DELETE that 500s used to remove the row
        // from the screen and say nothing, so the referee saw it gone and found
        // it back after a reload. The omission has happened twice already.
        await fetchOk(one(slug, id), { method: "DELETE" });
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  /**
   * Ask the server, and read the row as it is built.
   *
   * Frames: one `begin`, then any number of `result`, then exactly one `done` —
   * **except when the row was deleted mid-run**, which ends the stream with no
   * `done` at all (src/routes.ts § referee criteria). The `!settled` check is
   * how that expected silence is told apart from a broken connection.
   */
  const send = useCallback(
    (id: string, criterion: string, config: RefereeCriterionConfig, createdAt: string) => {
      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it.
      put({ id, criterion, config, createdAt, status: "pending", results: [] });
      setError(null);
      // Running it again un-deletes: the referee is plainly no longer finished
      // with it, whatever they clicked a moment ago.
      deleted.current.delete(id);

      let liveId = id;
      let settled = false;

      void (async () => {
        try {
          const r = await apiFetch(url(slug), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              criterion,
              kind: config.kind,
              ...(config.kind === "diverging"
                ? { poles: config.poles, scale: config.scale }
                : {}),
            }),
          });
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is
             the stream simply ending, handled below. */
          if (!r.ok || !r.body) throw await failure(r);

          for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
            // Computed once per frame, before acting on it: a delete can land
            // between two frames of the same stream.
            const gone = deleted.current.has(liveId);
            if (event.name === "begin") {
              const begun = event.data as SavedCriterion;
              /* Fresher news about the paper than the GET has: the server
                 fingerprints the blocks as it opens the row, so this hash *is*
                 the article's current one. */
              if (begun.sourceHash !== undefined) setFingerprint({ hash: begun.sourceHash });
              if (begun.id !== liveId) {
                // The server reset a different existing id than the one we
                // sent — drop the row we rendered under our own, or the referee
                // ends up with two of the same criterion.
                const stale = liveId;
                setRows((prev) => prev.filter((c) => c.id !== stale));
                liveId = begun.id;
              }
              if (!gone) put(begun);
              continue;
            }
            if (event.name === "result") {
              if (!gone) {
                const { result } = event.data as { result: RefereeResult };
                setRows((prev) =>
                  prev.map((c) =>
                    c.id === liveId ? { ...c, results: [...c.results, result] } : c,
                  ),
                );
              }
              continue;
            }
            if (event.name === "done") {
              settled = true;
              const done = event.data as SavedCriterion;
              if (deleted.current.has(done.id)) {
                /* Deleted while the answer was in the air. The DELETE we sent
                   may have run *before* the server finished writing, so send it
                   again now that nothing else will write it. */
                void forget(done.id);
                return;
              }
              /* The final pass is authoritative and may legitimately differ
                 from what streamed — it *replaces* the accumulated results
                 rather than merging with them. */
              put(done);
              return;
            }
          }

          if (!settled && !deleted.current.has(liveId)) {
            throw new Error("The criterion stopped arriving. Try again.");
          }
        } catch (e) {
          if (deleted.current.has(liveId)) return;
          const message = describeFetchFailure(e as Error);
          setError(message);
          put({
            id: liveId,
            criterion,
            config,
            createdAt,
            status: "error",
            results: [],
            error: message,
          });
        }
      })();
    },
    [slug, put, forget],
  );

  const ask = useCallback(
    (criterion: string, config: RefereeCriterionConfig) => {
      const id = mintId();
      send(id, criterion.trim(), config, new Date().toISOString());
      return id;
    },
    [send],
  );

  const retry = useCallback(
    (id: string) => {
      const existing = rows.find((c) => c.id === id);
      if (existing) send(existing.id, existing.criterion, existing.config, existing.createdAt);
    },
    [rows, send],
  );

  /**
   * Pin one criterion to a palette slot, or hand it back to the hash.
   *
   * **Optimistic, and it stays optimistic even if the request fails** — a hue
   * that flicked back a second later would read as the app arguing with the
   * referee. The transport error is still set. The response is deliberately not
   * read: `assignSlots` runs here, over the array this hook already holds, and
   * adopting the server's list would wipe the results of a row this tab is
   * streaming into.
   */
  const recolour = useCallback(
    (id: string, colour: number | null) => {
      chosen.current.set(id, colour);
      setRows((prev) => prev.map((c) => (c.id === id ? withChoice(c, colour) : c)));

      const patch = async () => {
        try {
          await fetchOk(one(slug, id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ colour }),
          });
        } catch (e) {
          setError(describeFetchFailure(e as Error));
        }
      };

      /* Behind whatever is already out for *this* row. `.then(patch, patch)`
         rather than `.then(patch)` is the load-bearing part: a failed PATCH
         must not stop the next one being sent, or one dropped connection wedges
         that row's colour for the rest of the session. */
      const next = (patching.current.get(id) ?? Promise.resolve()).then(patch, patch);
      patching.current.set(id, next);
      void next;
    },
    [slug],
  );

  const remove = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setRows((prev) => prev.filter((c) => c.id !== id));
      // If a POST is still out, its `.then` re-sends the DELETE once the write
      // it is racing has definitely landed.
      void forget(id);
    },
    [forget],
  );

  /**
   * The rows the panel sees, each with its verdict attached. Recomputed rather
   * than stored, because both halves move — the row arrives from a stream and
   * the paper's fingerprint from a fetch.
   */
  const decided: SavedCriterionState[] = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        stale: fingerprint === null ? false : isStale(row, fingerprint.hash),
      })),
    [rows, fingerprint],
  );

  return { criteria: decided, loaded, loadFailed, ask, retry, remove, recolour, error };
}
