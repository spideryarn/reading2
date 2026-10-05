/**
 * The cost cube for one window, fetched once per window — the whole data layer
 * of `/admin/costs`. One `GET /api/admin/costs?since=&until=`, no writes;
 * everything the page shows is a view of the rows through src/cost-cube.ts.
 *
 * Shaped like `useArticleCost` (ArticleCost.tsx): the state is tagged with the
 * window it answers, so a change of period never draws the last period's
 * figures under the new period's name, and a slow answer to an old question is
 * dropped rather than shown.
 */
import { useCallback, useEffect, useState } from "react";

import type { AdminCosts } from "../cost-cube.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type AdminCostsLoad =
  | { kind: "loading" }
  /** The server's own sentence, or the one for a lost connection. */
  | { kind: "failed"; message: string }
  | { kind: "ready"; costs: AdminCosts };

export interface UseAdminCosts {
  load: AdminCostsLoad;
  /** Ask again for the same window. */
  reload: () => void;
}

/** The request for a window; an absent bound is left off, which the route reads as "none". */
export function adminCostsUrl(since: string | null, until: string | null): string {
  const query = new URLSearchParams();
  if (since !== null) query.set("since", since);
  if (until !== null) query.set("until", until);
  const text = query.toString();
  return `/api/admin/costs${text ? `?${text}` : ""}`;
}

export function useAdminCosts(since: string | null, until: string | null): UseAdminCosts {
  const url = adminCostsUrl(since, until);
  const [state, setState] = useState<{ url: string; load: AdminCostsLoad }>({
    url,
    load: { kind: "loading" },
  });
  /* Bumped by `reload`, so the effect runs again for the same window. */
  const [turn, setTurn] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `turn` is the reload trigger.
  useEffect(() => {
    let live = true;
    setState({ url, load: { kind: "loading" } });
    void (async () => {
      try {
        const costs = await readJson<AdminCosts>(await apiFetch(url));
        if (live) setState({ url, load: { kind: "ready", costs } });
      } catch (e) {
        if (live) setState({ url, load: { kind: "failed", message: describeFetchFailure(e as Error) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [url, turn]);

  const reload = useCallback(() => setTurn((n) => n + 1), []);

  return { load: state.url === url ? state.load : { kind: "loading" }, reload };
}
