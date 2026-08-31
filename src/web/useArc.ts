/**
 * The arc, for a reader who arrived before it was written.
 *
 * Until 2026-08-29 every ingest wrote an arc before the article could be opened
 * at all, so the reading view could take `article.arc` as a fact and this hook
 * had no reason to exist. `arc` is no longer in `DEFAULT_INGEST_STEPS` — the
 * article opens as soon as the tree is built — so a reader can now arrive at an
 * article that has none, and something has to ask for one.
 *
 * ## Seeded from the payload, so the ordinary path is unchanged
 *
 * When `/api/article/:slug` already carried an arc, that is the arc, and this
 * hook makes no request and starts no job. It is *only* the missing case that
 * costs anything. That matters more than it looks: the alternative — always
 * fetching `/api/arc/:slug` to learn the staleness the payload does not carry —
 * would put a second request on every article open for a question that is almost
 * always "it is fine".
 *
 * ## It starts the job itself, which no other `useStepJob` caller does
 *
 * `useGlossary`, `useIdeas` and `useSummaries` all wait for a reader to press
 * something. Greg asked for this one to run on arrival:
 *
 * > I think it makes sense for the article to open initially to the "Contents"
 * > view, which would immediately trigger the various LLM calls, and in the
 * > meantime the "Contents" mode would be in a "Loading" state (with a spinner
 * > etc).
 * >
 * > — Greg, 2026-08-29 (the mode is called Hierarchy now)
 *
 * **On the owner opening the article, not on entering the mode.** Hierarchy is
 * the default mode, so in practice these are the same moment for almost every
 * reader — and the mode lives below the capability seam in `App.tsx`, so keying
 * off it would mean lifting `mode` above `OwnedReader` to buy nothing.
 *
 * **The ref is not belt-and-braces.** `<StrictMode>` runs every effect twice in
 * development, so without it every article opened would POST two arc jobs. The
 * open-counter in `App.tsx` carries the same guard for the same reason, and its
 * docstring records what happened when it did not.
 *
 * ## Who must not reach this
 *
 * **Mount it in `OwnedReader`, never in `Reader`.** The acceptance test for
 * public reading is that a signed-out browser issues no POST whatever
 * (tests/visitor-gaps.test.ts), and starting a job is a POST that spends money.
 * A visitor therefore sees no arc on an article whose owner has not opened it
 * since this shipped — including every article in the library on the day it
 * shipped, because the freshness field is new and nothing on disk carries it.
 *
 * That is a deliberate trade and not an oversight: Greg was offered a second,
 * non-blocking arc job after ingest — which would have closed it — and chose the
 * smaller change (2026-08-29). The fallback is good: `TableView` shows the root
 * gist where the arc column would be, which is why this needs writing down. It
 * looks like nothing is wrong.
 *
 * See docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Arc, ArcFound } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";

/**
 * `absent` is the state this hook exists for, and it is not an error: no arc
 * has been written yet, and one has been asked for. `stale` is the one worth
 * keeping apart from `ready` — see `arc` below.
 */
export type ArcStatus = "ready" | "absent" | "loading" | "error";

export interface UseArc {
  status: ArcStatus;
  /**
   * The arc to draw, or `null`.
   *
   * **`null` while a known-stale one exists**, which is the whole reason this is
   * not just "the artefact we last read". `buildArcColumn` joins entries to tree
   * nodes by exact block range and silently omits any entry that matches none,
   * so drawing an arc written against a tree that has since been re-cut produces
   * a column that looks complete and is not. A missing column is honest; a
   * half-filled one is a lie the reader cannot see. GPT Sol, 2026-08-29.
   */
  arc: Arc | null;
  /** An arc exists but describes an article shape that has moved. Not drawn. */
  stale: boolean;
  /** Something is being written right now — the caller's cue for a spinner. */
  working: boolean;
  error: string | null;
}

export function useArc(slug: string, fromPayload: Arc | undefined): UseArc {
  /* The payload's arc is the answer whenever there is one, so the opening state
     is `ready` rather than `loading` for almost every reader. */
  const [arc, setArc] = useState<Arc | null>(fromPayload ?? null);
  const [status, setStatus] = useState<ArcStatus>(fromPayload ? "ready" : "loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/arc/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        /* Not a fault: nobody has written one. The effect below is what turns
           this into a job, and this is the state it waits in. */
        setArc(null);
        setStale(false);
        setError(null);
        setStatus("absent");
        return;
      }
      const found = await readJson<ArcFound>(res);
      setStale(found.stale);
      /* **Stale reads as no arc**, deliberately. See `arc` on `UseArc`. */
      setArc(found.stale ? null : found.arc);
      setError(null);
      setStatus(found.stale ? "absent" : "ready");
    } catch (err) {
      setError((err as Error).message);
      /* A failed revalidation must not take a good arc off the screen — `load`
         runs again every time a job finishes, not only on the first read. Only
         the opening read has nothing to fall back on. Same guard and same
         reason as useIdeas.ts § `load`. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  /* Only when the payload had none. With one, there is nothing to read: the
     payload's arc is the same artefact this route would return. */
  useEffect(() => {
    if (fromPayload) return;
    void load();
  }, [fromPayload, load]);

  const queue = useStepJob(slug, "arc", load);

  /* Ask for one, once, per article. `started` is keyed on the slug rather than
     being a boolean, so opening a second article in the same mount asks again
     while a re-render or StrictMode's second pass does not. */
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "absent") return;
    if (started.current === slug) return;
    started.current = slug;
    /* Unforced. The step's own freshness check is the thing being trusted here,
       and it will agree: we only reach `absent` when there is no arc, or when
       the one on disk is stale — and a stale artefact is exactly what an
       unforced run regenerates. Forcing would also work and would cost a model
       call on any race where another tab wrote one first. */
    void queue.start();
  }, [status, slug, queue]);

  return {
    status,
    arc,
    stale,
    working: queue.job !== null,
    error,
  };
}
