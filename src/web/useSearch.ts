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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit, SearchRun } from "../types.js";
import { mintId } from "../ids.js";
import { isStale } from "../search-stale.js";
import { describeFetchFailure } from "./useComments.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { apiFetch, failure, fetchOk, readJson } from "./lib/api.js";

/**
 * A saved run, plus the one thing about it that is not on the run.
 *
 * `stale` is *derived here and never stored* — the same rule `loadGlossary` and
 * `loadTweets` follow on the server (src/api.ts): a flag written at generation
 * time is right until the moment it matters. The run carries the fingerprint of
 * the article it was answered against; the article carries its fingerprint now;
 * `isStale` compares them, and it is the same function the server uses so the
 * two cannot drift.
 *
 * It extends `SearchRun`, which is what keeps this change from reaching
 * src/web/App.tsx: everything that already takes a `SearchRun` takes one of
 * these unchanged.
 */
export interface SavedSearch extends SearchRun {
  /** The article has moved since this search was answered — or we cannot tell. */
  stale: boolean;
}

export interface SearchApi {
  runs: SavedSearch[];
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
  /**
   * Did that first fetch fail?
   *
   * The half `loaded` cannot carry. It is true either way on purpose — see
   * above — so the panel dropped out of the spinner into "Nothing searched for
   * yet" the moment a failing request gave up, which is the same claim about
   * the article that the spinner was added to stop. Found by GPT Sol reviewing
   * the equivalent fix in chat, 2026-08-27.
   *
   * Not `error !== null`: `error` also carries a failed retry or delete, long
   * after the list arrived, and is cleared when one succeeds. Only the effect
   * below ever sets this.
   */
  loadFailed: boolean;
  /** Run a new meaning-search. Returns the id it minted, so `?runs=` can name it. */
  ask(criterion: string): string;
  /** The same criterion again — for a run whose model call failed. */
  retry(id: string): void;
  remove(id: string): void;
  /** Pin a saved search to a palette slot — `null` puts it back on the hash. */
  recolour(id: string, colour: number | null): void;
  /** A failure of the *transport*, not of the model. Model failures live on the run. */
  error: string | null;
}

/**
 * One run wearing a colour choice — `null` or `undefined` meaning automatic.
 *
 * The key is **removed** rather than set to `undefined`, and that is the whole
 * reason this is a function rather than a spread at each call site: this object
 * gets spread over elsewhere, and an explicit `colour: undefined` sitting in a
 * spread overwrites a real value with nothing.
 */
function withChoice(run: SearchRun, colour: number | null | undefined): SearchRun {
  const { colour: _was, ...rest } = run;
  return colour === null || colour === undefined ? rest : { ...rest, colour };
}

export function useSearch(slug: string): SearchApi {
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The article's fingerprint, as the server last reported it.
   *
   * Three states, and the third is the one that earns the wrapper object.
   * `null` means **the server did not tell us** — either the fetch has not
   * answered yet, or it answered without the field. `{ hash: undefined }` means
   * it answered and could not work one out. `{ hash: "…" }` is an answer.
   *
   * The difference matters because "unknown counts as stale" is a rule about
   * the *article*, not about our own request. Applying it to a response that
   * simply did not carry the field would put a warning on every saved search on
   * every article at once — a claim about the piece made on the strength of a
   * missing key. That is the same distinction `loaded` above exists for, and it
   * lands the same way: say nothing until we have been told something.
   */
  const [fingerprint, setFingerprint] = useState<{ hash: string | undefined } | null>(null);

  /** Ids the reader deleted while their answer was still in the air. */
  const deleted = useRef(new Set<string>());

  /**
   * Colours this tab has chosen, by run id — the reader's word on the subject.
   *
   * It exists for one race, and the race is easy to hit because a meaning
   * search takes half a minute and the row is on screen the whole time.
   * Recolour a run that is still streaming, and the `done` frame that lands a
   * moment later is a snapshot of the row **as the server finished writing
   * it** — which may predate the PATCH. `put` would then paint the run back to
   * the colour it had before the reader pressed anything, and it would stay
   * wrong until a reload, even though the disk is correct.
   *
   * So every frame is re-stamped with what this tab last chose. A choice from
   * *another* tab arriving in a frame therefore loses here, which is the right
   * way round: the reader is looking at this one, and a reload reconciles.
   *
   * `null` is a value in this map rather than a deletion, because "put it back
   * on automatic" is itself a choice that has to beat a stale frame carrying
   * the colour it used to have.
   */
  const chosen = useRef(new Map<string, number | null>());

  /**
   * The last PATCH in flight for each run, so a second one waits for it.
   *
   * Two presses in quick succession are two independent requests, and nothing
   * makes them arrive in the order they were sent. Pick 2 then 4, let 4 land
   * first, and the store finishes on 2 while the screen — correctly following
   * `chosen` — shows 4. Nothing is visibly wrong until a reload, which is the
   * worst version of this: the reader is told their choice took, and it did
   * not. A colour has no version to conflict on, so there is nothing for the
   * server to reject; the ordering has to be kept here.
   *
   * One chain per run, not one for the panel: recolouring two different
   * searches has no ordering to preserve, and making the second wait for the
   * first would be a stall for nothing. GPT Sol's review, 2026-08-27.
   */
  const patching = useRef(new Map<string, Promise<void>>());

  // Switching article throws the tombstones away with the runs they name.
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
    setRuns([]);
    /* Reset on every slug, not just on mount: switching article puts the panel
       back to not-knowing, and leaving this true would show the *previous*
       article's emptiness as though it were this one's. */
    setLoaded(false);
    setLoadFailed(false);
    setFingerprint(null);
    apiFetch(`/api/search/${encodeURIComponent(slug)}`)
      .then((r) =>
        readJson<{ runs?: SearchRun[]; sourceHash?: string; error?: string }>(r),
      )
      .then((body) => {
        if (!live) return;
        /* A body with an `error` in it is a failed load as much as a thrown one
           is — there are no runs in it, and "nothing searched for yet" read off
           it is the same false claim. */
        if (body.error) {
          setError(body.error);
          setLoadFailed(true);
        } else {
          setRuns(body.runs ?? []);
          /* `in`, not truthiness. The server sends `sourceHash: undefined` —
             which JSON drops — for an article whose blocks it could not read,
             and that is a real answer meaning "we checked and cannot tell".
             An endpoint that does not carry the field at all is a different
             thing and must not be read as one. */
          if ("sourceHash" in body) setFingerprint({ hash: body.sourceHash });
        }
        /* Loaded means *the question has been answered*, not *it succeeded*. A
           failed fetch leaves `runs` empty for good, and holding the panel on a
           spinner forever would be a worse lie than the one this fixes — the
           error is reported separately. */
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

  /** Replace one run in place, or append it if it is new. */
  const put = useCallback((next: SearchRun) => {
    // Whatever the frame says about the colour, this tab's own choice wins —
    // see `chosen`. Nothing happens to a run the reader has not recoloured.
    const run = chosen.current.has(next.id) ? withChoice(next, chosen.current.get(next.id)) : next;
    setRuns((prev) =>
      prev.some((r) => r.id === run.id) ? prev.map((r) => (r.id === run.id ? run : r)) : [...prev, run],
    );
  }, []);

  const forget = useCallback(
    async (id: string) => {
      try {
        // A DELETE that 500s used to remove the row from the screen and say
        // nothing, so the reader saw it gone and found it back after a reload.
        // Same call, same reason, as useComments.ts § `forget` — and it is
        // `fetchOk` in both because the omission happened twice.
        await fetchOk(`/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
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
          const r = await apiFetch(`/api/search/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, criterion }),
          });
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is
             the stream simply ending, handled below. */
          if (!r.ok || !r.body) throw await failure(r);

          /* A clock on the bytes — see the note in useComments.ts. A search
             has nowhere to recover to either, so this turns a stream that
             stopped without ending into the failure it already shows for a
             stream that ended, rather than a spinner nothing can clear. */
          for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
            // Computed once per frame, before acting on it: a delete can land
            // between two frames of the same stream, and every branch below
            // has to see the same answer to "is this gone".
            const gone = deleted.current.has(liveId);
            if (event.name === "begin") {
              const begun = event.data as SearchRun;
              /* Fresher news about the article than the GET has. The server
                 fingerprints the blocks as it opens the run, so this hash *is*
                 the article's current one — and adopting it is what stops a
                 search the reader has just paid for being labelled out of date
                 because the page was loaded before the piece was re-extracted.
                 It also correctly ages every other row on the list at the same
                 moment, which is the true thing to do rather than a side
                 effect worth avoiding. */
              if (begun.sourceHash !== undefined) setFingerprint({ hash: begun.sourceHash });
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

  /**
   * Pin one saved search to a palette slot, or hand it back to the hash.
   *
   * **Optimistic, and it stays optimistic even if the request fails.** Every
   * other write in this hook rolls back or reports, and this one deliberately
   * does neither of those two things loudly: the reader pressed a swatch and
   * the row changed colour, and a colour that flicked back a second later
   * would read as the app arguing with them. The transport error is still set,
   * so the panel says something went wrong; what does not happen is the hue
   * jumping about while they read the message.
   *
   * **The response is deliberately not read**, even though the route answers
   * with the whole list. Pinning one search really can move another's hue —
   * `assignSlots` walks the list, so taking a slot pushes whoever had it along
   * — but that assignment happens *here*, in the browser, over the array this
   * hook already holds. The server stores a number and has no opinion about
   * what colour it is (src/web/hit-colours.ts § the seam), so its list says
   * nothing this one does not. Adopting it would also be actively harmful: it
   * carries no hits for a run this tab is streaming into right now, so a
   * swatch pressed mid-search would wipe the passages arriving on screen.
   */
  const recolour = useCallback(
    (id: string, colour: number | null) => {
      chosen.current.set(id, colour);
      setRuns((prev) => prev.map((r) => (r.id === id ? withChoice(r, colour) : r)));

      const send = async () => {
        try {
          // Same call, same reason, as `forget` above: a PATCH that 500s used
          // to change the colour on screen and say nothing, so the reader saw
          // their choice take and found it gone after a reload.
          await fetchOk(
            `/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ colour }),
            },
          );
        } catch (e) {
          setError(describeFetchFailure(e as Error));
        }
      };

      /* Behind whatever is already out for *this* run — see `patching`. The
         `.then(send, send)` rather than `.then(send)` is the load-bearing part:
         a failed PATCH must not stop the next one being sent, or one dropped
         connection wedges that row's colour for the rest of the session. */
      const next = (patching.current.get(id) ?? Promise.resolve()).then(send, send);
      patching.current.set(id, next);
      void next;
    },
    [slug],
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

  /**
   * The runs the panel sees, each with its verdict attached.
   *
   * Recomputed rather than stored on the row, because both halves move: a run
   * arrives from a stream, and the article's fingerprint arrives from a fetch.
   * Deriving at the point of use is what stops a row that was judged before the
   * fingerprint landed keeping that judgement for ever.
   */
  const decided: SavedSearch[] = useMemo(
    () =>
      runs.map((run) => ({
        ...run,
        /* Nothing is stale until the server has told us what to compare
           against — see `fingerprint`. A run that has just been answered on
           the POST stream carries no fingerprint of the article either way;
           it carries its own, and that one is by construction current. */
        stale: fingerprint === null ? false : isStale(run, fingerprint.hash),
      })),
    [runs, fingerprint],
  );

  return { runs: decided, loaded, loadFailed, ask, retry, remove, recolour, error };
}
