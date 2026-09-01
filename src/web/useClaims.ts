/**
 * The client half of a paper's claims run — Stage 4 of
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2.
 *
 * **`useCriteria.ts` with the list taken out**, and it is deliberately that
 * rather than something better: every rule in that file was learned the hard way
 * and three of them come from postmortems. What survives the copy, and what does
 * not:
 *
 * - **No minted id, because there is nothing to name.** One run per article, so
 *   `begin` needs nothing from the client and the server's row is the whole
 *   identity. Criteria mints one because `?crits=` has to name a real row from
 *   the first frame.
 * - **No tombstone, because there is nothing to delete.** A criterion can be
 *   deleted while its answer is in the air; a claims run can only be *replaced*,
 *   and a second POST while the first is still streaming is handled by
 *   `running` refusing to start one.
 * - **The terminal contract survives, and it matters more here than there.**
 *   One `begin`, then any number of `claim`, then **exactly one `done`**. A body
 *   that ends with neither a `done` nor an error is a failure and says so —
 *   because a stream can end by simply stopping, and on this panel that looks
 *   exactly like a paper whose claims all arrived.
 * - **The final list replaces the streamed one**, never merges with it. That is
 *   not tidiness: the authoritative pass is where the document sort happens over
 *   the whole answer, and a merge would leave the panel holding claims in the
 *   order the model happened to emit them. See `ClaimsBand` for the other half
 *   of that, which is what keeps the order right *during* the stream.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Claim, ClaimsRun } from "../referee-claims.js";
import { isStale } from "../search-stale.js";
import { apiFetch, failure, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { describeFetchFailure } from "./useComments.js";

export interface ClaimsApi {
  /** The stored run, or `null` when this paper has never been asked. */
  run: ClaimsRun | null;
  /** The paper has moved since this run was answered — or we cannot tell. */
  stale: boolean;
  /** False until the first fetch has answered, either way — `SearchApi.loaded`. */
  loaded: boolean;
  /** Did that first fetch fail? The half `loaded` cannot carry. */
  loadFailed: boolean;
  /** Pull the paper's claims. A second call while one is running does nothing. */
  pull(): void;
  /** A failure of the *transport*. A model failure lives on `run.status`. */
  error: string | null;
}

const url = (slug: string) => `/api/referee/claims/${encodeURIComponent(slug)}`;

export function useClaims(slug: string): ClaimsApi {
  const [run, setRun] = useState<ClaimsRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The paper's fingerprint, as the server last reported it. Three states, and
   * the third earns the wrapper: `null` is *we have not been told* — nothing
   * has answered yet, or the fetch failed — and `{ hash: undefined }` is *the
   * server checked and cannot tell*, which `isStale` counts as stale.
   *
   * The distinction is about **whether we heard from the server at all**, not
   * about which keys the reply carried. A `sourceHash` the server computed as
   * `undefined` does not survive `JSON.stringify`, so the two are
   * indistinguishable in the parsed body and only the GET's own success branch
   * knows which it is looking at — see it below.
   */
  const [fingerprint, setFingerprint] = useState<{ hash: string | undefined } | null>(null);

  /**
   * Is a POST from this tab still in the air?
   *
   * A ref rather than state, and read inside `pull` rather than passed to it,
   * for the reason useComments.ts records: a `setState` updater must be pure and
   * StrictMode calls it twice, so firing a POST from inside one spends two model
   * calls. This is the guard, and it is checked before anything else happens.
   */
  const running = useRef(false);

  /**
   * **Which article this hook is about now**, so a stream started for the last
   * one cannot write into it.
   *
   * A claims run takes a minute or two and the reader is free to open another
   * paper in the meantime. Without this the in-flight stream keeps calling
   * `setRun`, and the new article's panel fills with the old paper's claims —
   * each of them anchored to block ids this article does not have, so the rows
   * would be doors into nothing. `useCriteria` solves the same problem with its
   * per-request `live` flag; there is one request here, so a ref holding the
   * live slug is the smaller version of it.
   */
  const current = useRef(slug);

  useEffect(() => {
    let live = true;
    current.current = slug;
    /* A stream still in the air belongs to the previous article and is no longer
       allowed to write; the guard above stops it, and this lets the reader start
       one here without waiting for it. */
    running.current = false;
    setRun(null);
    setLoaded(false);
    setLoadFailed(false);
    setFingerprint(null);
    apiFetch(url(slug))
      .then((r) => readJson<{ run?: ClaimsRun | null; sourceHash?: string; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) {
          setError(body.error);
          setLoadFailed(true);
        } else {
          setRun(body.run ?? null);
          /* **Unconditionally, including when the field is missing.** A reply
             that got here is the server's answer about this paper, so
             `undefined` is not silence — it is "we checked and cannot tell",
             which `isStale` counts as stale. That is the whole point of the
             wrapper on `fingerprint`, and it is reachable only from here: the
             server sends `sourceHash: undefined` for a paper whose blocks it
             could not read, `JSON.stringify` deletes the key outright, and
             `"sourceHash" in body` was therefore false for exactly the case the
             state exists to carry. Silence is the *error* branch below, which
             leaves the fingerprint `null`. */
          setFingerprint({ hash: body.sourceHash });
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

  const pull = useCallback(() => {
    if (running.current) return;
    running.current = true;
    /** The article this run is about. Every write below is gated on it. */
    const mine = slug;
    const stillMine = () => current.current === mine;
    setError(null);
    /* A spinner with nothing under it, immediately — and note what this throws
       away: the previous answer. That is the same call `begin` makes on the
       server (src/referee-claims-store.ts § What differs), and it is deliberate.
       Yesterday's claims under today's spinner is the one state a referee cannot
       interpret. */
    setRun({ status: "pending", createdAt: new Date().toISOString(), claims: [] });

    let settled = false;
    void (async () => {
      try {
        const r = await apiFetch(url(slug), { method: "POST" });
        /* A failure before the stream opens is ordinary JSON — the server reads
           the article and checks it has blocks before it writes a header. A
           failure after it opens is the stream simply ending, handled below. */
        if (!r.ok || !r.body) throw await failure(r);

        for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
          // Checked once per frame, not once per stream: the reader can open
          // another paper between two frames of the same run.
          if (!stillMine()) return;
          if (event.name === "begin") {
            const begun = event.data as ClaimsRun;
            /* Fresher news about the paper than the GET has: the server
               fingerprints the blocks as it opens the run, so this hash *is* the
               article's current one. */
            if (begun.sourceHash !== undefined) setFingerprint({ hash: begun.sourceHash });
            setRun(begun);
            continue;
          }
          if (event.name === "claim") {
            const { claim } = event.data as { claim: Claim };
            setRun((prev) =>
              prev === null ? prev : { ...prev, claims: [...prev.claims, claim] },
            );
            continue;
          }
          if (event.name === "done") {
            settled = true;
            /* The final pass is authoritative and legitimately differs from what
               streamed — it is where the whole answer is sorted into document
               order — so it **replaces** rather than merging. */
            setRun(event.data as ClaimsRun);
            return;
          }
        }

        if (!settled) throw new Error("The claims stopped arriving. Try again.");
      } catch (e) {
        if (!stillMine()) return;
        const message = describeFetchFailure(e as Error);
        setError(message);
        /* Stored on the row rather than only in `error`, so the panel shows the
           same Try again it shows for a model failure. A transport failure and a
           provider failure look identical from here and call for the same act. */
        setRun((prev) => ({
          status: "error",
          createdAt: prev?.createdAt ?? new Date().toISOString(),
          claims: [],
          error: message,
          ...(prev?.sourceHash === undefined ? {} : { sourceHash: prev.sourceHash }),
        }));
      } finally {
        /* Only if this is still the live article: the slug effect has already
           cleared the flag for the new one, and clearing it again here would be
           this run reaching forward into a paper it knows nothing about. */
        if (stillMine()) running.current = false;
      }
    })();
  }, [slug]);

  const stale = useMemo(
    () => (run === null || fingerprint === null ? false : isStale(run, fingerprint.hash)),
    [run, fingerprint],
  );

  return { run, stale, loaded, loadFailed, pull, error };
}
