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
 * See docs/project/library.md and docs/plans/260826k-library-shelf-actions-and-search.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryEntry } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

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

export function useShelf(): Shelf {
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

  const reload = useCallback(() => {
    return apiFetch("/api/library")
      .then((r) => readJson<{ articles: LibraryEntry[] }>(r))
      .then((b) => {
        setArticles(b.articles);
        // Cleared on success, or a transient failure leaves a red box above a
        // shelf that is now perfectly fine.
        setError(null);
      })
      // A fetch that never reached the server says "Failed to fetch", which
      // tells the reader nothing. Say the likely cause — and rethrow, so a
      // caller awaiting this knows it did not happen.
      .catch((e: Error) => {
        setError(
          e.message === "Failed to fetch"
            ? "Couldn't reach the server — is `npm run dev` still running?"
            : e.message,
        );
        throw e;
      });
  }, []);

  // `void`: the effect must not return a promise, and a first-load failure is
  // already reported through `error`.
  useEffect(() => void reload().catch(() => {}), [reload]);

  // A pending timer holding a closure over an unmounted component is the
  // ordinary way this leaks; clearing on unmount is the ordinary fix.
  useEffect(() => () => void (undoTimer.current && clearTimeout(undoTimer.current)), []);

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
      archiving.current.add(slug);
      try {
        const entry = await patch(slug, { archived: true });
        setArticles((list) => list?.filter((a) => a.slug !== slug) ?? null);
        // Dropped rather than appended to: an archived list built from a
        // stale copy plus one new entry is a list that can disagree with the
        // server about what is in it. It is refetched when next opened.
        setArchived(null);
        setUndoable(entry);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoable(null), UNDO_MS);
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        archiving.current.delete(slug);
      }
    },
    [patch],
  );

  const undo = useCallback(async () => {
    const entry = undoable;
    if (!entry) return;
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
      setArchived(null);
      setUndoable(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, [patch, reload, undoable]);

  const rename = useCallback(
    async (slug: string, title: string | null) => {
      // Closed before the request rather than after it: leaving the input open
      // while the write is in flight invites a second Enter, and the editor has
      // already handed its value over.
      setRenaming(null);
      try {
        const entry = await patch(slug, { title });
        setArticles((list) => list?.map((a) => (a.slug === slug ? entry : a)) ?? null);
      } catch (e) {
        setActionError((e as Error).message);
      }
    },
    [patch],
  );

  const beginRename = useCallback((slug: string) => setRenaming(slug), []);
  const cancelRename = useCallback(() => setRenaming(null), []);

  const loadArchived = useCallback(async () => {
    try {
      const r = await apiFetch("/api/library?archived=1");
      setArchived((await readJson<{ articles: LibraryEntry[] }>(r)).articles);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  /**
   * Put one back, from the archived list rather than from the Undo strip.
   *
   * The same PATCH as Undo — deliberately, so there is one un-archive and not
   * two that could drift. What differs is only which list it is removed from.
   */
  const restore = useCallback(
    async (slug: string) => {
      try {
        await patch(slug, { archived: false });
        setArchived((list) => list?.filter((a) => a.slug !== slug) ?? null);
        await reload();
      } catch (e) {
        setActionError((e as Error).message);
      }
    },
    [patch, reload],
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
