/**
 * The shelf, and everything the reader can do to it.
 *
 * One hook rather than four, because archive, undo and rename all end in the
 * same place — a card on screen has to change — and splitting them would mean
 * three copies of "update the entry in the list, or refetch if you cannot".
 *
 * ## The rule this file is built around
 *
 * **A write returns the new entry, and we use it.** Every mutation here replaces
 * the entry in place from the server's answer rather than patching the local
 * copy and hoping. That costs a slightly bigger response and buys the thing that
 * actually matters: the card after a rename is built by the same code as the
 * card before it (`describeArticle`, server-side), so it cannot quietly drift —
 * a locally-patched title would look right and be a second derivation.
 *
 * ## The other rule, since 2026-09-03: the saved copy paints first
 *
 * A repeat visit draws the shelf we already have in IndexedDB while the live one
 * is fetched, so the reader is not looking at a blank page — and then at
 * *"Reading the shelf…"* — for the length of a serverless cold start. The read
 * itself is [lib/cached-shelf.ts](./lib/cached-shelf.ts); what lives here is the
 * part that cannot: **which of the two answers wins.**
 *
 * `reload` is public and job-driven reloads overlap (`useJobs`), so "has the
 * live answer landed" is not one bit — hence the `issued`/`settled` pair below,
 * which the cached continuation reads immediately before it commits. The rules
 * are:
 *
 * - the copy paints only while the network has not spoken since the read began;
 * - an older live answer that lands after a newer one is dropped, not applied;
 * - a transport failure or a 5xx **keeps** whatever is on screen and adds the
 *   error, because eagerly painting means a failure now has something to spoil;
 * - a final 401 or a change of reader **clears** it — that is somebody else's
 *   shelf, or nobody's;
 * - and a request that went out for the previous reader is dropped when it
 *   lands, or it would undo that clear a frame later (`reader` below);
 * - nothing commits after unmount.
 *
 * **`useSlow` is not promised never to fire.** IndexedDB is asynchronous and a
 * blocked read can take longer than the 600ms threshold; this makes the message
 * rare on a repeat visit, not impossible.
 *
 * See docs/project/library.md § Offline, and
 * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 5.
 *
 * See docs/project/library.md and docs/plans/260826k-library-shelf-actions-and-search.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryEntry, LibraryResponse } from "../types.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";
import { readCachedShelf } from "./lib/cached-shelf.js";

/** How long the Undo strip stays up. Long enough to reach, short enough not to nag. */
const UNDO_MS = 9000;

export interface Shelf {
  articles: LibraryEntry[] | null;
  error: string | null;
  /**
   * Re-read the shelf from the server.
   *
   * Returns a promise that **rejects** if the reload failed, so a caller that
   * depends on the new list — Undo does — can tell. `useJobs` ignores it.
   */
  reload: () => Promise<void>;
  /** The last archived article, while the Undo strip is up. */
  undoable: LibraryEntry | null;
  archive: (slug: string) => Promise<void>;
  undo: () => Promise<void>;
  rename: (slug: string, title: string | null) => Promise<void>;
  /** Whatever last went wrong with a button, for the strip to say. Cleared on the next try. */
  actionError: string | null;
  /** The archived articles, once somebody has asked to see them. */
  archived: LibraryEntry[] | null;
  /** Fetch the other half of the shelf. Idempotent. */
  loadArchived: () => Promise<void>;
  /** Put an archived article back on the shelf, from the archived list. */
  restore: (slug: string) => Promise<void>;
  /**
   * Which article is being renamed in place, if any.
   *
   * Up here rather than inside the card, because since 2026-08-26 there are two
   * views of the same shelf and the *table* splits one article across two cells
   * — the title becomes an input while the row's pencil button stays where it
   * is. Two cells cannot share a `useState`, and one article renameable at a
   * time is the behaviour we wanted anyway.
   */
  renaming: string | null;
  beginRename: (slug: string) => void;
  cancelRename: () => void;
  /**
   * Say that something a button tried to do did not happen.
   *
   * Exposed so the card's own buttons — copy, re-run — report through the same
   * line as archive and rename, rather than each inventing a place to put an
   * error or, as both of those did at first, swallowing it.
   */
  report: (message: string) => void;
}

/**
 * @param readerId Whose shelf this is — **from the authenticated session**,
 * passed down from `SignedIn` in App.tsx rather than read from
 * `lastKnownUser()`. The saved copies in IndexedDB are partitioned by reader
 * (offline-store.ts), so the lookup needs an id, and the one React has just
 * authenticated is a better answer than the one the device happens to remember:
 * a direct A→B sign-in calls `rememberUser(B)` and **never** `forgetUser(A)`,
 * which only runs on a null session (see the auth listener at the bottom of
 * lib/api.ts). Nothing leaks either way — the rows stay partitioned — but a
 * hook that draws a reader's titles should be told which reader.
 */
export function useShelf(readerId: string): Shelf {
  const [articles, setArticles] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<LibraryEntry | null>(null);
  const [archived, setArchived] = useState<LibraryEntry[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Slugs with an archive already in flight.
   *
   * The card is removed only after the server answers (see `archive`), so for
   * those few milliseconds the Delete button is still on screen and still
   * clickable. Two clicks used to mean two requests, and the second one's
   * *reply* is the problem rather than the second write: archiving twice is
   * idempotent and keeps the original date, but a reader who presses Delete,
   * Delete, Undo can have the late second reply land after the undo and run
   * `setArticles(list => list.filter(...))` over a list the article has just
   * been restored to. The shelf then shows it gone while the server has it
   * back — and the Undo strip that would fix it has been re-armed for an
   * article that is no longer archived. Found by a cross-model review,
   * 2026-08-27.
   *
   * A ref rather than state: nothing renders differently, and re-rendering the
   * whole shelf to record that a request is in flight would rebuild the table's
   * column model for it (see the memo at the bottom of this file).
   */
  const archiving = useRef<Set<string>>(new Set());

  /**
   * How many live reads have been *started*, and which one we last believed.
   *
   * The pair the stale-while-revalidate paint is built on, and **numbers rather
   * than a flag on purpose**: `reload` is public, `useJobs` calls it whenever an
   * import moves, and those reloads overlap — so neither "has the live answer
   * landed" nor "is this answer still the newest" is one bit of state that a
   * boolean set inside the mount effect could observe.
   *
   * Each reload takes the next `issued` number. An answer is applied only if it
   * is not older than the newest one already applied, and applying it writes its
   * number into `settled` — so two overlapping reloads cannot end with the
   * *earlier* request's shelf on screen because it happened to come last.
   *
   * The cached copy uses the same number from the other side: it remembers what
   * `settled` was when the read began and commits only if it is unchanged, which
   * stays correct however many reloads ran in between and however late the read
   * is. `settled` moves for a live answer that paints and for a 401 that clears
   * — both are the server having spoken — and deliberately **not** for a
   * transport failure or a 5xx, which said nothing about what is on the shelf,
   * so a copy arriving afterwards is still the best thing we have and the error
   * sits above it. (A transport failure with a copy saved usually never reaches
   * that branch at all: `apiFetch` answers it from the same cache as a synthetic
   * 200 — see `attempt` in lib/api.ts.)
   *
   * Refs rather than state, for the same reason `archiving` above is one:
   * nothing renders differently, and these must be readable *synchronously* at
   * the moment of committing rather than as of the last render.
   */
  const issued = useRef(0);
  const settled = useRef(0);

  /**
   * Which reader the answers now arriving are about.
   *
   * The other half of "a change of reader clears the shelf", and it is a
   * separate number because it answers a different question: `settled` says
   * *whether the network has spoken*, this says *who it spoke about*. Clearing
   * on the switch is not enough on its own — a `GET /api/library` that went out
   * for reader A is still in flight, and when it lands it would put A's titles
   * on B's screen, one frame after we took them down. Bumped by the effect
   * below, and read by everything that writes a list.
   */
  const reader = useRef(0);

  const reload = useCallback(() => {
    const mine = ++issued.current;
    const asked = reader.current;
    return apiFetch("/api/library")
      .then((r) => readJson<LibraryResponse>(r))
      .then((b) => {
        /* Not this reader's shelf any more. Dropped rather than painted — and
           `settled` is deliberately left alone, so the new reader's own cached
           copy is still free to paint. */
        if (reader.current !== asked) return;
        /* And not the newest answer either: two reloads can be in flight and
           finish in the other order, and the earlier request's shelf landing
           last would undo the later one. */
        if (mine < settled.current) return;
        settled.current = mine;
        setArticles(b.articles);
        // Cleared on success, or a transient failure leaves a red box above a
        // shelf that is now perfectly fine.
        setError(null);
      })
      // A fetch that never reached the server says "Failed to fetch", which
      // tells the reader nothing. Say the likely cause — and rethrow, so a
      // caller awaiting this knows it did not happen.
      .catch((e: Error) => {
        /* Somebody else's request failing is not this reader's error to show.
           Still rethrown, so an awaiting caller learns its reload did not
           happen — it is the *state* writes that are dropped, not the failure. */
        if (reader.current !== asked) throw e;
        /* **A failure that a newer answer has already overtaken is not news,
           and reporting it does damage.** Two reloads overlap, the newer one
           paints, the older one then fails: putting its message in `error`
           hangs a red box over a shelf that is perfectly current. Worse for
           `undo`, which awaits `reload()` and clears the Undo strip only if it
           resolves — a rejection from the overtaken request leaves the strip up
           and an action error on screen for an article that has already been
           restored and drawn.

           So it is neither reported nor rethrown: **resolved**, because the
           caller's post-condition — the shelf is current — is exactly what the
           newer answer just made true. GPT Sol's review of the built code,
           2026-09-03. */
        if (mine < settled.current) return;
        /* **A 401 that survived the refresh is the one failure that clears the
           shelf.** Everything else — no connection, a 500, a gateway timeout —
           leaves what is on screen alone, because a shelf we cannot re-read is
           not an empty shelf (the rule tests/profile-shelf-failure.test.tsx
           exists for). But a final 401 says this session is no longer anybody,
           and titles are reader data: they come down, and the copy that would
           otherwise land a moment later is locked out by the bump. `apiFetch`
           has already retried once with a refreshed token by the time we see
           this. */
        if (statusOf(e) === 401) {
          settled.current = mine;
          setArticles(null);
        }
        setError(
          e.message === "Failed to fetch"
            ? "Couldn't reach the server — is `npm run dev` still running?"
            : e.message,
        );
        throw e;
      });
  }, []);

  /**
   * Ask for the live shelf, and paint the saved one meanwhile.
   *
   * Both halves start here rather than in two effects, because they are one
   * race and the losing side has to know the winner ran. Re-runs when the
   * reader changes, so that a hook used without a `key` still takes the previous
   * reader's titles off the screen — see the comment inside.
   */
  useEffect(() => {
    /* Everything on screen belongs to whoever was signed in a moment ago, so it
       all comes down: the shelf, the archived list, the Undo strip that names an
       article by title, the open rename box, the last error, and the set of
       archives believed to be in flight.

       **This is a passive effect, so it runs after the first commit for the new
       reader** — for one frame, React has already drawn the new `readerId` over
       the old reader's articles. An earlier version of this comment said
       "synchronously with the render", which was simply false, and GPT Sol
       caught it. The frame is closed at the other end instead: `App.tsx` gives
       `<Library>` a `key={user.id}`, so an account switch builds a new instance
       with all of this at its initial value and there is no such commit. What is
       here is the same rule stated where the hook can enforce it for itself,
       rather than depending on a caller remembering the key.

       On the first mount every one of these is already its initial value, so
       React bails out and this costs nothing. */
    reader.current += 1;
    setArticles(null);
    setError(null);
    setUndoable(null);
    setArchived(null);
    setRenaming(null);
    setActionError(null);
    archiving.current.clear();
    if (undoTimer.current) clearTimeout(undoTimer.current);

    let cancelled = false;
    const startedAt = settled.current;
    void readCachedShelf(readerId).then((saved) => {
      /* Checked here, immediately before the commit, and not a line earlier:
         everything between the read starting and this point is time the live
         answer may have used. */
      if (cancelled || saved === null || settled.current !== startedAt) return;
      setArticles(saved);
    });

    // `void`: the effect must not return a promise, and a first-load failure is
    // already reported through `error`.
    void reload().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [readerId, reload]);

  // A pending timer holding a closure over an unmounted component is the
  // ordinary way this leaks; clearing on unmount is the ordinary fix.
  useEffect(() => () => void (undoTimer.current && clearTimeout(undoTimer.current)), []);

  /**
   * Is the answer we are holding still this reader's business?
   *
   * Every verb below is a request that can land after the reader has changed,
   * and each of them writes something a person can see — a list, the Undo
   * strip's title, an error. `archive` is the one that shows it worst: its
   * answer sets `undoable`, and Library.tsx draws *"Deleted <title>"* from it,
   * so A's article title can appear on B's screen with a button that would
   * un-archive it. Cheap to prevent, so prevented.
   */
  const stillOurs = useCallback((asked: number) => reader.current === asked, []);

  const patch = useCallback(
    async (slug: string, body: Record<string, unknown>): Promise<LibraryEntry> => {
      setActionError(null);
      const r = await apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await readJson<{ entry: LibraryEntry }>(r)).entry;
    },
    [],
  );

  const archive = useCallback(
    async (slug: string) => {
      /* The card is removed from the list only AFTER the server says so. An
         optimistic removal would be smoother and would occasionally lie: a
         failed archive would leave the reader looking at a shelf the article is
         missing from, believing it gone. The request is a few milliseconds
         locally, and honesty is worth more than those. */
      // The second click of a double-click is dropped here rather than sent and
      // then reconciled: there is nothing a second archive can achieve that the
      // first has not, so the cheapest correct handling is not to make it.
      if (archiving.current.has(slug)) return;
      const asked = reader.current;
      archiving.current.add(slug);
      try {
        const entry = await patch(slug, { archived: true });
        if (!stillOurs(asked)) return;
        setArticles((list) => list?.filter((a) => a.slug !== slug) ?? null);
        // Dropped rather than appended to: an archived list built from a
        // stale copy plus one new entry is a list that can disagree with the
        // server about what is in it. It is refetched when next opened.
        setArchived(null);
        setUndoable(entry);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoable(null), UNDO_MS);
      } catch (e) {
        if (stillOurs(asked)) setActionError((e as Error).message);
      } finally {
        archiving.current.delete(slug);
      }
    },
    [patch, stillOurs],
  );

  const undo = useCallback(async () => {
    const entry = undoable;
    if (!entry) return;
    const asked = reader.current;
    try {
      await patch(entry.slug, { archived: false });
      /* Refetched rather than reinserted locally, and that is a deliberate
         second choice. The shelf is sorted — real articles above the fixture,
         then newest first — so putting the card back means knowing that rule,
         and an earlier version of this function restated it here. That is a
         second copy of a rule the server owns, which is the divergence the rest
         of this file is arranged to avoid; the card would come back in the
         wrong place the day anybody changed the sort, and look like a different
         article. One refetch over a four-article shelf costs nothing. */
      /* Awaited, and the Undo strip is cleared only after it succeeds. An
         un-awaited reload could fail, leaving the article restored on the server
         but absent from the list — with the one control that would have brought
         it back already gone. */
      await reload();
      if (!stillOurs(asked)) return;
      setArchived(null);
      setUndoable(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    } catch (e) {
      if (stillOurs(asked)) setActionError((e as Error).message);
    }
  }, [patch, reload, stillOurs, undoable]);

  const rename = useCallback(
    async (slug: string, title: string | null) => {
      // Closed before the request rather than after it: leaving the input open
      // while the write is in flight invites a second Enter, and the editor has
      // already handed its value over.
      setRenaming(null);
      const asked = reader.current;
      try {
        const entry = await patch(slug, { title });
        if (!stillOurs(asked)) return;
        setArticles((list) => list?.map((a) => (a.slug === slug ? entry : a)) ?? null);
      } catch (e) {
        if (stillOurs(asked)) setActionError((e as Error).message);
      }
    },
    [patch, stillOurs],
  );

  const beginRename = useCallback((slug: string) => setRenaming(slug), []);
  const cancelRename = useCallback(() => setRenaming(null), []);

  const loadArchived = useCallback(async () => {
    const asked = reader.current;
    try {
      const r = await apiFetch("/api/library?archived=1");
      const body = await readJson<LibraryResponse>(r);
      /* The other list, and the same rule: not this reader's, not painted.
         Checked after the body is parsed rather than before, because parsing is
         itself a turn of the loop the reader can change in. */
      if (!stillOurs(asked)) return;
      setArchived(body.articles);
    } catch (e) {
      if (stillOurs(asked)) setActionError((e as Error).message);
    }
  }, [stillOurs]);

  /**
   * Put one back, from the archived list rather than from the Undo strip.
   *
   * The same PATCH as Undo — deliberately, so there is one un-archive and not
   * two that could drift. What differs is only which list it is removed from.
   */
  const restore = useCallback(
    async (slug: string) => {
      const asked = reader.current;
      try {
        await patch(slug, { archived: false });
        if (!stillOurs(asked)) return;
        setArchived((list) => list?.filter((a) => a.slug !== slug) ?? null);
        await reload();
      } catch (e) {
        if (stillOurs(asked)) setActionError((e as Error).message);
      }
    },
    [patch, reload, stillOurs],
  );

  const report = useCallback((message: string) => setActionError(message), []);

  /* Memoised, and that became load-bearing on 2026-08-26.
     
     This used to return a fresh object literal on every render, which nothing
     minded while a card was the only consumer. Then the table arrived, and its
     column definitions close over the shelf — so a new object every render meant
     new columns every render, and TanStack rebuilding its whole column model
     for a shelf that had not changed. Every field below is either a `useState`
     value or a `useCallback`, so this identity now changes exactly when
     something about the shelf actually has. */
  return useMemo(
    () => ({
      articles,
      error,
      reload,
      undoable,
      archive,
      undo,
      rename,
      actionError,
      report,
      archived,
      loadArchived,
      restore,
      renaming,
      beginRename,
      cancelRename,
    }),
    [
      articles,
      error,
      reload,
      undoable,
      archive,
      undo,
      rename,
      actionError,
      report,
      archived,
      loadArchived,
      restore,
      renaming,
      beginRename,
      cancelRename,
    ],
  );
}
