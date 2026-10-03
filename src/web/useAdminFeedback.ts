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
  /**
   * **A write is in flight** — the Ignore button's. Kept apart from `loading`
   * so Refresh does not say *Loading…* about something that is not a load,
   * but the page disables the same controls for either.
   */
  saving: boolean;
  /**
   * **Mark one report ignored, or take the mark back**, and put the server's
   * answer in place of the copy held here. Rejects when the write failed, so
   * the card can say so; the list is left as it was.
   *
   * **It shares the list's in-flight slot, and that is the point.** A Refresh
   * that read the old row and landed after this write would redraw *Ignore* on
   * a report the database is already ignoring (GPT Sol, 2026-10-03). So the
   * list and the write take turns: neither starts while the other is out.
   */
  setIgnored: (report: AdminFeedbackReport, ignored: boolean) => Promise<void>;
}

/**
 * `from` is fixed for the life of one hook. **A caller that lets the reader
 * change it remounts the component that holds this hook** (`key={from}`,
 * AdminPage.tsx § `AdminFeedbackPage`) rather than passing a new value in:
 * the in-flight guard would drop the reload a switch asked for while a *Load
 * older* was in flight, and that older page would then land under the new
 * filter. A fresh hook has its own guard, cursor and reports, and cleanup aborts
 * the old request rather than leaving its response to a component that is gone.
 * GPT Sol, plan review, docs/plans/261001l-….
 */
export function useAdminFeedback(from: FeedbackFrom = "everyone"): UseAdminFeedback {
  const [reports, setReports] = useState<AdminFeedbackReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cursor, setCursor] = useState<FeedbackCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  /**
   * **A ref, not the `loading` state**, and it is load-bearing rather than an
   * optimisation. `loadMore` is called from a click; if it read `loading` off
   * state, two quick clicks would both see `false` — React has not re-rendered
   * between them — and both would fetch the same cursor, appending one page
   * twice. A ref is written synchronously.
   */
  /* The controller is also the synchronous in-flight guard. Keeping the request
     itself here matters when `key={from}` unmounts this hook: the fresh inbox
     has already made the old answer irrelevant, so cleanup frees its connection
     and response body rather than merely relying on React to ignore setState on
     an unmounted component.

     Identity is load-bearing under StrictMode. Its synthetic cleanup aborts and
     clears the first controller before the effect starts again; when that first
     promise reaches `finally`, it must not clear the second request's guard or
     loading state. */
  const inFlight = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (before: FeedbackCursor | null) => {
    if (inFlight.current) return;
    const stop = new AbortController();
    inFlight.current = stop;
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
      const body = await readJson<AdminFeedbackPage>(
        await apiFetch(`/api/admin/feedback${query}`, { signal: stop.signal }),
      );
      /* A test double can resolve after an abort even though browser `fetch`
         rejects. The signal, not the transport's manners, decides whether this
         hook still owns the answer. */
      if (stop.signal.aborted) return;
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
      /* A keyed remount or unmount is this hook leaving, not a failed inbox. */
      if (stop.signal.aborted) return;
      /* Through the one rule the shelf uses — see `describeFetchFailure`. */
      setError(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
      /* What is already held is left alone rather than blanked, the same call
         useAdminUsers makes: a failed refresh means the page is stale, which it
         says, and replacing it with nothing throws away the only reports we
         have. */
    } finally {
      /* An aborted predecessor may settle after StrictMode has started a fresh
         request. Only the request still holding the slot may release it. */
      if (inFlight.current === stop) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [from]);

  const reload = useCallback(() => fetchPage(null), [fetchPage]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    await fetchPage(cursor);
  }, [cursor, fetchPage]);

  useEffect(() => {
    void reload();
    return () => {
      const stop = inFlight.current;
      /* Clear synchronously before aborting, so StrictMode's repeated setup can
         start the replacement instead of seeing the abandoned request as busy. */
      inFlight.current = null;
      stop?.abort();
    };
  }, [reload]);

  const setIgnored = useCallback(async (report: AdminFeedbackReport, ignored: boolean) => {
    /* The buttons are disabled while anything is in flight, so this is the
       second line of defence rather than the first. */
    if (inFlight.current) return;
    /* A slot of its own in the same guard, and deliberately no `signal` on the
       request: a write is not abandoned half-sent. If this inbox goes while it
       is in flight, the cleanup below clears the slot and the answer is
       dropped by the identity check. AdminFeedbackPage prevents filter
       remounts until the write settles, so a replacement inbox cannot read
       the pre-write row. */
    const slot = new AbortController();
    inFlight.current = slot;
    setSaving(true);
    try {
      const body = await readJson<{ report: AdminFeedbackReport }>(
        await apiFetch(
          `/api/admin/feedback/${encodeURIComponent(report.ownerId)}/${encodeURIComponent(report.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ignored }),
          },
        ),
      );
      if (inFlight.current !== slot) return;
      /* Matched on the pair, since an id alone can be two readers' reports. */
      const next = body.report;
      setReports(
        (held) =>
          held?.map((r) => (r.ownerId === next.ownerId && r.id === next.id ? next : r)) ?? held,
      );
    } finally {
      if (inFlight.current === slot) {
        inFlight.current = null;
        setSaving(false);
      }
    }
  }, []);

  return { reports, error, loading, saving, hasMore, reload, loadMore, setIgnored };
}
