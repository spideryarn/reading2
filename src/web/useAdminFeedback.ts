/**
 * The bug reports, a page at a time. The whole data layer of `/admin/feedback`.
 *
 * Shaped like [useAdminUsers.ts](useAdminUsers.ts) — one `reload` callback, an
 * effect that calls it once, no polling — with one thing that hook does not
 * need: **the inbox is paged**, so there is a `loadMore` beside it and the
 * reports accumulate rather than being replaced.
 *
 * The error is surfaced rather than swallowed, and here that matters more than
 * on the users page. This endpoint's one convincing failure is an empty array —
 * the filesystem store's 501, a permissions problem — and an empty *inbox* is a
 * perfectly ordinary answer. "Nobody has reported a bug" and "we could not read
 * the reports" must not look the same. docs/reusable/silent-success.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AdminFeedbackPage,
  AdminFeedbackReport,
  FeedbackCursor,
  FeedbackFrom,
} from "../types.js";
import { encodeFeedbackCursor } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export interface UseAdminFeedback {
  /** `null` while the first request is in flight — not "no reports". */
  reports: AdminFeedbackReport[] | null;
  error: string | null;
  loading: boolean;
  /** Whether the server said there are older reports than the ones held here. */
  hasMore: boolean;
  /** Start again from the newest, discarding any pages already loaded. */
  reload: () => Promise<void>;
  /** Append the next page. A no-op when there is none, or while one is in flight. */
  loadMore: () => Promise<void>;
}

/**
 * `from` is fixed for the life of one hook. **A caller that lets the reader
 * change it remounts the component that holds this hook** (`key={from}`,
 * AdminPage.tsx § `AdminFeedbackPage`) rather than passing a new value in:
 * `busy` would drop the reload a switch asked for while a *Load older* was in
 * flight, and that older page would then land under the new filter. A fresh
 * hook has its own `busy`, its own cursor and no reports, and the old one's
 * late answer reaches a component that is gone. GPT Sol, plan review,
 * docs/plans/261001l-….
 */
export function useAdminFeedback(from: FeedbackFrom = "everyone"): UseAdminFeedback {
  const [reports, setReports] = useState<AdminFeedbackReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<FeedbackCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  /**
   * **A ref, not the `loading` state**, and it is load-bearing rather than an
   * optimisation. `loadMore` is called from a click; if it read `loading` off
   * state, two quick clicks would both see `false` — React has not re-rendered
   * between them — and both would fetch the same cursor, appending one page
   * twice. A ref is written synchronously.
   */
  const busy = useRef(false);

  const fetchPage = useCallback(async (before: FeedbackCursor | null) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      /* No `?limit=`. The server's default is the one number, and a client that
         named its own would be a second opinion about how big a page is. */
      /* `from` on every page, because the cursor carries no filter: a *Load
         older* without it would page on through everyone's. */
      const params = new URLSearchParams();
      if (before) params.set("before", encodeFeedbackCursor(before));
      if (from !== "everyone") params.set("from", from);
      const qs = params.toString();
      const query = qs ? `?${qs}` : "";
      const body = await readJson<AdminFeedbackPage>(await apiFetch(`/api/admin/feedback${query}`));
      /* Appended when there was a cursor, replaced when there was not — so
         `reload` and `loadMore` are one request with one difference, rather
         than two code paths that can come to disagree about the shape. */
      setReports((held) => (before && held ? [...held, ...body.reports] : body.reports));
      setHasMore(body.hasMore);
      setCursor(body.nextCursor);
      /* Cleared on success: an error on screen beside fresh data is worse than
         no error at all. */
      setError(null);
    } catch (e) {
      /* Through the one rule the shelf uses — see `describeFetchFailure`. */
      setError(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
      /* What is already held is left alone rather than blanked, the same call
         useAdminUsers makes: a failed refresh means the page is stale, which it
         says, and replacing it with nothing throws away the only reports we
         have. */
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [from]);

  const reload = useCallback(() => fetchPage(null), [fetchPage]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    await fetchPage(cursor);
  }, [cursor, fetchPage]);

  useEffect(() => void reload(), [reload]);

  return { reports, error, loading, hasMore, reload, loadMore };
}
