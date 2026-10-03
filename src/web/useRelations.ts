/**
 * **The relation words, as Marginalia sees them**: how each paragraph bears on
 * the one before it (*so*, *but*, *vs*), read from `GET /api/relations/:slug`,
 * and the one job that writes them.
 *
 * Marginalia otherwise generates nothing (docs/project/marginalia.md). This is
 * its one artefact of its own, so unlike the FAQ or the Timeline it reads there
 * is no band to make it in: **the press that turns the column on asks for it**,
 * through the same activation every self-starting mode uses
 * (src/web/useAutoRun.ts; Marginalia's row in activation.ts § `MODE_TARGET`).
 * A mount is not a press, so a pasted `?margin=1` link, a Back step and a
 * reload all spend nothing.
 *
 * Owner only, and not because of a check here: the one caller is
 * `OwnerMarginFeed`, mounted under the owner's arm. A visitor's payload does
 * not carry the words at all in v1 — it has no staleness verdict, and a
 * relation word has no quote to check against its block.
 * docs/plans/261003f-marginalia-relation-words-and-timeline-events.md.
 */
import { useCallback, useEffect, useState } from "react";
import type { BlockId, Relation, RelationsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useAutoRun } from "./useAutoRun.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";

type RelationsStatus = "loading" | "none" | "ready" | "error";

/**
 * The words to draw, or null for none: nothing stored, still loading, or a
 * list written against an article that has since moved (its blocks may not be
 * these, and unlike a quote a word cannot be checked against its paragraph).
 */
export type RelationsByBlock = Readonly<Record<BlockId, Relation>> | null;

export function useRelations(slug: string): RelationsByBlock {
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

  /* **Stale or outdated counts as nothing there**, so the next press rewrites
     it. Unforced: the step's own stamp check decides whether to run, and it
     will agree, because a stale artefact is exactly what an unforced run
     regenerates (as useArc.ts). */
  const unusable = loaded !== null && (loaded.stale || loaded.outdated);
  useAutoRun(slug, "relations", status === "ready" && unusable ? "none" : status, ensure, reload);

  /* `?.` because a reply that is JSON but not this shape must cost the reader
     the words, not the column: this runs inside Marginalia's boundary. */
  return status === "ready" && loaded !== null && !loaded.stale ? (loaded.relations?.relations ?? null) : null;
}
