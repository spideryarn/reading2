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
import type { SearchHit, SearchKind, SearchRun } from "../types.js";
import { mintId } from "../ids.js";
import { isStale } from "../search-stale.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { apiFetch, failure, fetchOk } from "./lib/api.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { openingRead } from "./lib/opening-read.js";

/**
 * A saved run, plus the one thing about it that is not on the run.
 *
 * `stale` is *derived here and never stored* — the same rule `loadGlossary` and
 * `loadTweets` follow on the server (src/store/pg.ts): a flag written at generation
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
   *
   * **Find waits for it, too** (2026-09-11). The GET's answer *replaces* the
   * list, so a search run while it was out was wiped from the tab when it
   * landed — docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md.
   * "Either way" is what makes that safe to wait on: a failed read has no later
   * snapshot to erase anything with, and a read that never answers is given up
   * on at a deadline (src/web/lib/opening-read.ts). `Box` in SearchPanel.tsx is
   * where the wait is enforced; `ask` itself does not refuse, because its
   * caller switches on the id it returns.
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
   * Not `error !== null`: `error` is the writes' — a failed search, retry or
   * delete, long after the list arrived — and is cleared when one starts. This
   * is `loadError !== null`, and only the effect below ever sets that.
   */
  loadFailed: boolean;
  /**
   * Why that first fetch failed — **kept until a new load**, which today means
   * a reload or another article. It used to share `error`, so the reader's next
   * search cleared it and they saw that search alone with nothing to say their
   * saved ones had not loaded. Plan 260908f § A.
   */
  loadError: string | null;
  /**
   * Run a new search of this kind — `quick` or `meaning`. Returns the id it
   * minted, so `?runs=` can name it.
   */
  ask(criterion: string, kind: SearchKind): string;
  /** The same criterion again, and the same kind — for a run whose model call failed. */
  retry(id: string): void;
  /**
   * **Re-ask a quick row with new words, in place** — search-as-you-type
   * (plan 261002h). Same id, same colour, same place in the list; the server
   * resets it under a new attempt (`revises: true`, src/searches.ts § withRun).
   *
   * One request at a time per row: while the previous request has not said
   * `begin`, this only records the words (the latest wins); once it has, the
   * previous fetch is aborted and the revision sent. A row the reader deleted
   * is never revised back into existence.
   */
  revise(id: string, criterion: string): void;
  /**
   * The requests this tab has out, by the id the **server** is using — which
   * `begin` can change, see `send`. A `pending` row loaded by the opening GET
   * is not here: it may belong to another process, or to one that died, and
   * this tab gets no later news of it.
   */
  running: ReadonlySet<string>;
  /**
   * Is this (trimmed) question already out from this tab, **as this kind**?
   * Read from a ref, so two presses inside one React batch both see the first.
   *
   * Keyed on kind as well as words, because a quick search and a meaning
   * search for the same words are two different questions. The box can ask
   * meaning while quick is still out; *flesh out* appears once quick finishes
   * (plan 261002e, review F5).
   */
  isRunning(criterion: string, kind: SearchKind): boolean;
  remove(id: string): void;
  /** Pin a saved search to a palette slot — `null` puts it back on the hash. */
  recolour(id: string, colour: number | null): void;
  /**
   * A failure of the *transport* on a write, not of the model. Model failures
   * live on the run; the opening load's is `loadError`.
   */
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

export function useSearch(
  slug: string,
  {
    onRenamed,
  }: {
    /**
     * `begin` answered under a different id from the one sent — the caller's
     * `?runs=` still names the old one. Called once, before any hit arrives.
     */
    onRenamed?: (from: string, to: string) => void;
  } = {},
): SearchApi {
  const renamed = useRef(onRenamed);
  renamed.current = onRenamed;
  const [runs, setRuns] = useState<SearchRun[]>([]);

  /**
   * What this tab has in flight: the server's id → the trimmed question, and
   * the `send` that owns the entry, so a late `finally` from an earlier
   * attempt cannot clear a later one's.
   *
   * It lives here rather than in the panel because only `send` knows the id
   * the server is actually using. The panel used to record the id it asked
   * under; when `begin` answered with another, that id fell out of `runs` and
   * the guard let the same question be paid for again while it ran.
   * docs/plans/261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md
   */
  const inFlight = useRef(
    new Map<string, { criterion: string; kind: SearchKind; owner: symbol }>(),
  );
  const [flights, setFlights] = useState(0);
  const flown = useCallback(() => setFlights((n) => n + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `flights` is the trigger and not an input — it is bumped whenever the ref changes, and the ref supplies what to read.
  const running = useMemo(() => new Set(inFlight.current.keys()), [flights]);
  const isRunning = useCallback(
    (criterion: string, kind: SearchKind) =>
      [...inFlight.current.values()].some(
        (f) => f.criterion === criterion.trim() && f.kind === kind,
      ),
    [],
  );
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
   * **The request each row has out, by the server's id** — the lane a revision
   * waits in (plan 261002h, Sol F3/F4).
   *
   * The server's attempt fence orders *finishes*, not *begins*: two revisions
   * sent back to back can begin in either order, and the one that begins last
   * becomes the row's answer. So a row has one request at a time. A revision
   * asked before the current request's `begin` is parked in `queued` (the
   * latest words win) and sent from that `begin`; a revision asked after it
   * marks the current request `superseded` and aborts its fetch.
   *
   * `superseded` is the client's own fence: every frame, rename, failure and
   * clean-up of a send checks it first, so an old stream can say what it likes
   * and none of it reaches the row, `?runs=` or the error line. An abort is
   * therefore never an error row.
   */
  const lanes = useRef(
    new Map<
      string,
      {
        superseded: boolean;
        abort: AbortController;
        begun: boolean;
        /** Failed before begin: only an explicit retry can replace this lane. */
        failed: boolean;
        queued: string | null;
      }
    >(),
  );
  /** `revise`, for `send` to call from a `begin` without a dependency cycle. */
  const reviseRef = useRef<(id: string, criterion: string) => void>(() => {});

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
  const articleToken = useMemo(() => Symbol(slug), [slug]);
  const currentArticle = useRef<symbol | null>(articleToken);

  // Switching article throws the tombstones away with the runs they name —
  // and the in-flight list, so a question still out on the last article does
  // not refuse the same words on this one.
  useEffect(() => {
    currentArticle.current = articleToken;
    const gone = deleted.current;
    const picks = chosen.current;
    const chains = patching.current;
    const flying = inFlight.current;
    const queues = lanes.current;
    return () => {
      if (currentArticle.current === articleToken) currentArticle.current = null;
      gone.clear();
      queues.clear();
      picks.clear();
      chains.clear();
      if (flying.size > 0) {
        flying.clear();
        // `running` is a rendered snapshot of this ref. Clearing the ref alone
        // leaves its memo on the previous article until some later request
        // happens to bump the version.
        flown();
      }
    };
  }, [articleToken, flown]);

  useEffect(() => {
    let live = true;
    setRuns([]);
    /* Reset on every slug, not just on mount: switching article puts the panel
       back to not-knowing, and leaving this true would show the *previous*
       article's emptiness as though it were this one's. */
    setLoaded(false);
    setLoadError(null);
    setFingerprint(null);
    /* With a deadline, because `loaded` is what lets the reader press Find —
       see `loaded` above and src/web/lib/opening-read.ts. */
    const read = openingRead<{ runs?: SearchRun[]; sourceHash?: string; error?: string }>(
      `/api/search/${encodeURIComponent(slug)}`,
    );
    read.body
      .then((body) => {
        if (!live) return;
        /* A body with an `error` in it is a failed load as much as a thrown one
           is — there are no runs in it, and "nothing searched for yet" read off
           it is the same false claim. */
        if (body.error) {
          setLoadError(body.error);
        } else {
          setRuns(body.runs ?? []);
          /* **Guarded, and here that guard is load-bearing** — unlike in
             useCriteria.ts and useClaims.ts, whose GETs do send a fingerprint
             and where the same guard made "we checked and cannot tell"
             unreachable, because a `sourceHash` of `undefined` does not survive
             `JSON.stringify` and so is absent rather than present-and-undefined
             after `JSON.parse`.

             This endpoint sends **no fingerprint at all**: the searches GET
             answers `{ runs }` and nothing else (src/routes.ts §
             `sweepSearches`; the referee routes beside it are the ones that
             send a fingerprint alongside the list). So setting the
             fingerprint unconditionally here would put "answered about an
             earlier version" on every saved search on every article, on the
             strength of a key nobody sends. The consequence of leaving it is
             the other way round and known: a saved run is judged only once a
             `begin` frame in this session has carried a hash — until then the
             panel says nothing, which is what docs/project/search.md § "No
             re-run of a stale search" still records as open. Fixing that is a
             route change, not a change here. */
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
        setLoadError(describeFetchFailure(e));
        setLoaded(true);
      });
    return () => {
      live = false;
      read.abandon();
    };
  }, [slug]);

  /** Replace one run in place, or append it if it is new. */
  const put = useCallback((next: SearchRun, keepCreatedAt = false) => {
    // Whatever the frame says about the colour, this tab's own choice wins —
    // see `chosen`. Nothing happens to a run the reader has not recoloured.
    const run = chosen.current.has(next.id) ? withChoice(next, chosen.current.get(next.id)) : next;
    setRuns((prev) =>
      prev.some((r) => r.id === run.id)
        ? prev.map((r) => {
            if (r.id !== run.id) return r;
            return keepCreatedAt ? { ...run, createdAt: r.createdAt } : run;
          })
        : [...prev, run],
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

      /* Behind whatever is already out for *this* run — see `patching` — so two
         choices cannot land out of order.

         **The thing that keeps the chain alive is `send`'s own `try/catch`**:
         it swallows the failure, so the promise it returns never rejects and
         the next choice is always sent. The second handler in
         `.then(send, send)` is a backstop for the day someone takes that
         `catch` out — it costs nothing and it would then be the only thing
         standing between one dropped connection and that row's colour being
         wedged for the rest of the session. It is *not* what is doing the work
         today, and this comment used to claim it was; tests/use-search.test.ts
         § "does not wedge the row" pins the outcome and says out loud that it
         pins neither strand. */
      const next = (patching.current.get(id) ?? Promise.resolve()).then(send, send);
      patching.current.set(id, next);
      void next;
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
    (
      id: string,
      criterion: string,
      kind: SearchKind,
      createdAt: string,
      { revises = false }: { revises?: boolean } = {},
    ) => {
      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it. `kind` on
      // every row this function builds — this one, and the error row below —
      // because the panel labels a pending quick run before the server has
      // said anything about it.
      const pending: SearchRun = { id, criterion, kind, createdAt, status: "pending", hits: [] };
      if (revises) {
        /* **A revision keeps the previous answer's hits on screen** (Opus, plan
           261002h) until its own first hit arrives — otherwise every pause
           would wipe every mark in the article and paint them back a second
           later. The answer's other fields go: it is a new question now. */
        setRuns((prev) =>
          prev.some((r) => r.id === id)
            ? prev.map((r) => {
                if (r.id !== id) return r;
                const { model: _m, error: _e, ...rest } = r;
                return { ...rest, criterion, status: "pending" as const };
              })
            : [...prev, pending],
        );
      } else {
        put(pending);
        // Searching again un-deletes: the reader is plainly no longer finished
        // with it, whatever they clicked a moment ago. A revision does not —
        // a typing session never brings back a row the reader deleted.
        deleted.current.delete(id);
      }
      setError(null);

      /* This row's lane — see `lanes`. Any request it already had out is
         superseded; `revise` only gets here once that request has begun. */
      const me = {
        superseded: false,
        abort: new AbortController(),
        begun: false,
        failed: false,
        queued: null as string | null,
      };
      const before = lanes.current.get(id);
      if (before) {
        before.superseded = true;
        before.abort.abort();
      }
      lanes.current.set(id, me);
      /* Has this send's first hit arrived? Until it has, a revision's row
         still shows the previous answer's hits; the first one replaces them. */
      let fresh = !revises;

      /* The id the *server* is using. Normally the one we minted; see the
         module docstring on why `beginRun` can reset it instead. Everything
         after the `begin` frame addresses the row by this, not by `id`. */
      let liveId = id;
      let settled = false;
      const owner = Symbol(id);
      const belongsHere = () => currentArticle.current === articleToken;
      inFlight.current.set(id, { criterion: criterion.trim(), kind, owner });
      flown();
      /** Off the in-flight list — only if this `send` still owns the entry. */
      const land = () => {
        if (inFlight.current.get(liveId)?.owner !== owner) return;
        inFlight.current.delete(liveId);
        flown();
      };
      /**
       * `begin` answered under another id. `withRun` minted one because the id
       * we sent was taken by a row it would not reset — most often a retry of
       * a run whose stream dropped here while the server was still answering
       * it. Drop the row we rendered under our own id, or the reader sees two
       * of the same search; then move everything this tab keeps by id.
       *
       * **Every** per-id thing, not only the two the bug was about (GPT Sol's
       * plan review). The in-flight entry and `?runs=`, or the guard and the
       * marks lose the search the reader is watching. The tombstone, or a row
       * deleted in the gap before `begin` comes back on `done` — and the
       * server's row is deleted now, since our DELETE named an id it never
       * had. And a colour chosen in that gap, or it is lost on screen and
       * on reload.
       */
      const follow = (to: string) => {
        const stale = liveId;
        setRuns((prev) => prev.filter((r) => r.id !== stale));
        liveId = to;
        if (lanes.current.get(stale) === me) {
          lanes.current.delete(stale);
          lanes.current.set(to, me);
        }
        const flight = inFlight.current.get(stale);
        if (flight?.owner === owner) {
          inFlight.current.delete(stale);
          inFlight.current.set(to, flight);
          flown();
        }
        if (deleted.current.has(stale)) {
          deleted.current.add(to);
          void forget(to);
          return;
        }
        if (chosen.current.has(stale)) recolour(to, chosen.current.get(stale) ?? null);
        renamed.current?.(stale, to);
      };

      void (async () => {
        try {
          const r = await apiFetch(`/api/search/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              revises ? { id, criterion, kind, revises: true } : { id, criterion, kind },
            ),
            signal: me.abort.signal,
          });
          if (!belongsHere() || me.superseded) return;
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is
             the stream simply ending, handled below. */
          if (!r.ok || !r.body) throw await failure(r);

          /* A clock on the bytes — see the note in useComments.ts. A search
             has nowhere to recover to either, so this turns a stream that
             stopped without ending into the failure it already shows for a
             stream that ended, rather than a spinner nothing can clear. */
          for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
            if (!belongsHere() || me.superseded) return;
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
              if (begun.id !== liveId) follow(begun.id);
              me.begun = true;
              if (!gone) {
                if (fresh) put(begun);
                else {
                  // The revision's begin: everything but the hits, which stay
                  // until this send's first one arrives.
                  const kept = chosen.current.has(begun.id)
                    ? withChoice(begun, chosen.current.get(begun.id))
                    : begun;
                  setRuns((prev) =>
                    prev.some((r) => r.id === kept.id)
                      ? prev.map((r) => (r.id === kept.id ? { ...kept, hits: r.hits } : r))
                      : [...prev, kept],
                  );
                }
              }
              /* A revision asked while this request was on its way: send it now,
                 which supersedes this one (Sol F3). The latest words only. */
              if (me.queued !== null) {
                const words = me.queued;
                me.queued = null;
                if (!deleted.current.has(liveId)) {
                  reviseRef.current(liveId, words);
                  return;
                }
                /* Deleted meanwhile: no revision, and this stream is read to
                   its end so `done` can re-send the DELETE, as below. */
              }
              continue;
            }
            if (event.name === "hit") {
              if (!gone) {
                const { hit } = event.data as { hit: SearchHit };
                const first = !fresh;
                fresh = true;
                setRuns((prev) =>
                  prev.map((r) =>
                    r.id === liveId ? { ...r, hits: first ? [hit] : [...r.hits, hit] } : r,
                  ),
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
            throw new ReaderFacingError("The search stopped arriving. Try again.");
          }
        } catch (e) {
          if (!belongsHere() || me.superseded) return;
          if (deleted.current.has(liveId)) return;
          const message = describeFetchFailure(e as Error);
          setError(message);
          me.failed = !me.begun;
          put(
            { id: liveId, criterion: me.queued ?? criterion, kind, createdAt, status: "error", hits: [], error: message },
            revises,
          );
        } finally {
          if (!me.superseded) {
            land();
            // A transport failure before begin does not acknowledge the server's
            // write. Keep its lane as a barrier until an explicit retry replaces
            // it; automatic successors could begin first and then be overwritten.
            if (!me.failed && lanes.current.get(liveId) === me) lanes.current.delete(liveId);
          }
        }
      })();
    },
    [slug, put, forget, flown, recolour, articleToken],
  );

  const revise = useCallback(
    (id: string, criterion: string) => {
      const words = criterion.trim();
      if (words === "" || deleted.current.has(id)) return;
      const lane = lanes.current.get(id);
      if (lane && !lane.begun) {
        /* One request at a time: park the words, latest wins, and show them on
           the row now so the list follows the box. */
        lane.queued = words;
        const flight = inFlight.current.get(id);
        if (flight && flight.criterion !== words) {
          flight.criterion = words;
          flown();
        }
        setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, criterion: words } : r)));
        return;
      }
      send(id, words, "quick", new Date().toISOString(), { revises: true });
    },
    [send, flown],
  );
  reviseRef.current = revise;

  const ask = useCallback(
    (criterion: string, kind: SearchKind) => {
      const id = mintId();
      send(id, criterion.trim(), kind, new Date().toISOString());
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
      // Its own kind, never the matcher the box happens to be on: a failed
      // quick run retried from meaning mode is still a quick run.
      if (existing) send(existing.id, existing.criterion, existing.kind, existing.createdAt);
    },
    [runs, send],
  );

  const remove = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      // Deleting it frees the question at once, as it always has: asking it
      // again is a new search the reader chose, not an impatient press.
      if (inFlight.current.delete(id)) flown();
      // If a POST is still out, its `.then` re-sends the DELETE once the write
      // it is racing has definitely landed. Doing it only here would let the
      // POST write the row back after we deleted it.
      void forget(id);
    },
    [forget, flown],
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

  return {
    runs: decided,
    loaded,
    loadFailed: loadError !== null,
    loadError,
    ask,
    retry,
    revise,
    running,
    isRunning,
    remove,
    recolour,
    error,
  };
}
