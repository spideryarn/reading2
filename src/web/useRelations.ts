/**
 * **The relation words, as Marginalia sees them**: how each paragraph bears on
 * the one before it (*so*, *but*, *vs*), read from `GET /api/relations/:slug`,
 * and the one job that writes them.
 *
 * Marginalia otherwise generates nothing (docs/project/marginalia.md). This is
 * its one artefact of its own, and **it is made the first time the column is
 * shown**:
 *
 * > generate linking words when Marginalia mode is opened
 * >
 * > — Greg, 2026-10-05
 *
 * Shown, not pressed. The first-open default turns the column on with nobody
 * pressing anything (last-view.ts § `firstOpenSearch`), and while this hook
 * waited for a press (`useAutoRun`, until 2026-10-05) a new article arrived
 * with a margin that had no words until the column was turned off and on. So
 * it is `useAutoRunOnArrival`, the rule Summary's thread already had: one
 * unforced attempt per article per page load, whatever put the column there —
 * a press, the default, a pasted `?margin=1`, a reload, a restored view. That
 * last one is how an article from before this gets its words; there is no
 * backfill. Nor is it queued on import, as it was for part of 2026-10-05
 * (src/auto-mode-steps.ts): that paid for every article, opened or not.
 *
 * **`shown` is the column on screen, not the switch**: on a window with no
 * room for the notes the feed is still mounted for its reads, and words nobody
 * can see are not worth a call. The attempt waits until the window has room.
 *
 * Owner only, and not because of a check here: the one caller is
 * `OwnerMarginFeed`, mounted under the owner's arm. A visitor's payload does
 * not carry the words at all in v1 — it has no staleness verdict, and a
 * relation word has no quote to check against its block.
 * docs/plans/261003f-marginalia-relation-words-and-timeline-events.md;
 * docs/plans/261005d-marginalia-out-of-the-experimental-switch.md.
 */
import { useCallback, useEffect, useState } from "react";
import type { BlockId, Relation, RelationsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useAutoRunOnArrival } from "./useAutoRun.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";

type RelationsStatus = "loading" | "none" | "ready" | "error";

/**
 * The words to draw, or null for none: nothing stored, still loading, or a
 * list written against an article that has since moved (its blocks may not be
 * these, and unlike a quote a word cannot be checked against its paragraph).
 */
export type RelationsByBlock = Readonly<Record<BlockId, Relation>> | null;

export function useRelations(slug: string, shown: boolean): RelationsByBlock {
  const [status, setStatus] = useState<RelationsStatus>("loading");
  const [loaded, setLoaded] = useState<RelationsResponse | null>(null);

  /* `current()` after every `await`, before any state is set: false means this
     reply is about an article the hook has moved on from. useOrderedRead.ts. */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/relations/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          setLoaded(null);
          setStatus("none");
          return;
        }
        const body = await readJson<RelationsResponse>(res);
        if (!current()) return;
        setLoaded(body);
        setStatus("ready");
      } catch {
        if (!current()) return;
        /* A failed revalidation must not take the words away; only the opening
           read has nothing to fall back on. As useFaq.ts. */
        setStatus((was) => (was === "loading" ? "error" : was));
      }
    },
    [slug],
  );
  const { reload, refresh } = useOrderedRead(load);
  useEffect(() => {
    void reload();
  }, [reload]);

  /* Quiet: the column stays open for as long as somebody reads, and watching
     the queue would keep the engine's idle poll going all that time. The job
     this hook starts is still followed to its end. useStepJob.ts § cadence. */
  const queue = useStepJob(slug, "relations", refresh, "quiet");
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);

  /* **Stale or outdated counts as nothing there**, so the next showing
     rewrites it. Unforced: the step's own stamp check decides whether to run,
     and it will agree, because a stale artefact is exactly what an unforced
     run regenerates (as useArc.ts). */
  const unusable = loaded !== null && (loaded.stale || loaded.outdated);
  const answer = status === "ready" && unusable ? "none" : status;
  /* Not on screen is not an answer yet: `loading` is the status the arrival
     rule waits on, and it is asked again when the window has room. */
  useAutoRunOnArrival(slug, "relations", shown ? answer : "loading", ensure, reload);

  /* `?.` because a reply that is JSON but not this shape must cost the reader
     the words, not the column: this runs inside Marginalia's boundary. */
  return status === "ready" && loaded !== null && !loaded.stale ? (loaded.relations?.relations ?? null) : null;
}
