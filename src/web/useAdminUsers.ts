/**
 * The user list, fetched once. The whole data layer of the admin page.
 *
 * One `GET /api/admin/users`, no writes, no polling — this page reads and
 * nothing on it can change anything (docs/project/admin.md § Not now), so
 * there is none of the machinery `useShelf` needs.
 *
 * **`reload` exists anyway**, because a page of counts that can only be
 * refreshed by reloading the browser is a page whose numbers you stop
 * trusting. It is the same request, on a button.
 *
 * The error is surfaced rather than swallowed, and that is the load-bearing
 * part of a file this small: the one thing this endpoint can do that looks like
 * success is answer with an empty list — a permissions failure on `auth.users`,
 * or the filesystem store's 501, must reach the page as words rather than as a
 * table with no rows in it. docs/reusable/silent-success.md.
 */
import { useCallback, useEffect, useState } from "react";

import type { AdminUser } from "../admin.js";
import { apiFetch, readJson } from "./lib/api.js";

export interface UseAdminUsers {
  /** `null` while the first request is in flight — not "no users". */
  users: AdminUser[] | null;
  error: string | null;
  loading: boolean;
  /** Read it again. Never rejects — a failure lands in `error`. */
  reload: () => Promise<void>;
}

export function useAdminUsers(): UseAdminUsers {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Read the list. The same call on first render and on the Refresh button.
   *
   * Shaped like `reload` in useShelf.ts on purpose — one callback, an effect
   * that calls it once, and no cancellation token. Two hooks in one app that
   * fetch a list and disagree about how is two things to read before changing
   * either.
   */
  const reload = useCallback(() => {
    setLoading(true);
    return apiFetch("/api/admin/users")
      .then((r) => readJson<{ users: AdminUser[] }>(r))
      .then((body) => {
        setUsers(body.users);
        /* Cleared on success, so a reload that works removes the message a
           failed one left. An error on screen beside fresh data is worse than
           no error at all. */
        setError(null);
      })
      .catch((e: Error) => {
        /* "Failed to fetch" is what a request that never reached the server
           says, and it tells the reader nothing. Same substitution the shelf
           makes, for the same reason. */
        setError(
          e.message === "Failed to fetch"
            ? "Couldn't reach the server — is `npm run dev` still running?"
            : e.message,
        );
        /* The old list is left alone rather than blanked. If a refresh failed,
           what is on screen is stale — which the message says — and replacing
           it with nothing throws away the only numbers we have. */
      })
      .finally(() => setLoading(false));
  }, []);

  // `void`: an effect must not return a promise, and the rejection is already
  // in `error` by the time it gets here.
  useEffect(() => void reload(), [reload]);

  return { users, error, loading, reload };
}
