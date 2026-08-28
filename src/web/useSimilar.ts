/**
 * **The embedding model's view of the article**, fetched when — and only when —
 * a picture is drawn that uses it.
 *
 * Greg, 2026-08-27: *"when we generate the Force diagram, let's generate an
 * embedding for each block, and add dotted links between the most similar
 * handful of blocks, to see what that does to the shape of the Force diagram."*
 *
 * `POST /api/similar/:slug` (src/similar.ts), which embeds the blocks the first
 * time it is asked and serves the answer out of memory afterwards.
 *
 * ## Three rules, all of them about not lying to the reader
 *
 * **`enabled` is the whole gate.** This is the only fetch in the reading view
 * that spends money without a button labelled with what it costs. Pressing a
 * diagram toggle is not a purchase decision, so the request happens on exactly
 * one of the six pictures and never on the other five — and the moment `force`
 * is no longer the picture, nothing further is requested. Cheap, bounded and
 * cached, but the bound has to be somewhere and this is it.
 *
 * **It never blocks the picture.** Force draws immediately from the tree and
 * the words; the dotted lines are folded in on a later render. There is no
 * spinner over the diagram, because a spinner over something already four
 * fifths drawn tells the reader the wrong thing about what is missing. The
 * panel says "looking for related passages…" in the header strip instead —
 * beside the picture rather than over it.
 *
 * **A failure is not a blank.** If the request fails the picture keeps its other
 * four kinds of line and the strip says so. Silently drawing three kinds where
 * four were promised is the [silent-success](../../docs/reusable/silent-success.md)
 * shape: everything looks fine and one claim has quietly gone missing.
 */
import { useEffect, useState } from "react";
import type { SimilarPair, SimilarResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

type SimilarStatus = "idle" | "loading" | "ready" | "error";

export interface UseSimilar {
  status: SimilarStatus;
  pairs: SimilarPair[];
  /** Which embedding model answered, for the footer strip. */
  model: string | null;
  /** How many blocks were embedded — fewer than the article has; short ones are skipped. */
  blocks: number;
  error: string | null;
}

/** Nothing, shared — a new `[]` each render would rebuild the graph every time. */
const NONE: SimilarPair[] = [];

export function useSimilar(slug: string, enabled: boolean): UseSimilar {
  const [state, setState] = useState<UseSimilar & { slug: string }>({
    slug,
    status: "idle",
    pairs: NONE,
    model: null,
    blocks: 0,
    error: null,
  });

  /* **Whose answer this is.** The answer is about one article's passages, so
     showing the previous one's dotted lines over the new article would be a
     picture confidently about the wrong text. Returning `idle` for a slug we
     have not answered for yet is the honest report.

     **As the app is wired today this can never be false**, and the comment
     used to claim the opposite — that the reader can move to another article
     without this component unmounting. They cannot: `App.tsx` keys both
     `OwnedArticle` and `VisitorArticle` on the slug ("Keyed on the slug so
     switching article remounts"), and `DiagramPanel` is inside that subtree,
     so a slug change destroys this hook rather than handing it a new slug.
     No test exercises the transition either.

     Kept anyway. It costs one string comparison, it is the invariant written
     down where the invariant is used, and it is the half that survives if
     someone ever drops that key — which is exactly the kind of change nobody
     would think to look here for. */
  const mine = state.slug === slug;

  useEffect(() => {
    if (!enabled) return;
    /* **Not reset to `idle` when `enabled` goes false**, and not cleared
       between kinds either: toggling away from Force and back must not throw
       away an answer already paid for. The server caches too, so a second
       request would be cheap — but it would still be a round trip, and the
       dotted lines would visibly disappear and come back for no reason the
       reader could see. */
    const stop = new AbortController();
    setState((s) =>
      s.slug === slug && s.status === "ready"
        ? s
        : { slug, status: "loading", pairs: NONE, model: null, blocks: 0, error: null },
    );
    void (async () => {
      try {
        /* **POST, because the first call spends money.** GET is meant to be
           safe, and a browser, a proxy or a prefetcher is entitled to repeat a
           GET without asking anybody — which for this route would be paying to
           embed the article again. src/routes.ts says the same thing from the
           other end. */
        const res = await apiFetch(`/api/similar/${encodeURIComponent(slug)}`, {
          method: "POST",
          signal: stop.signal,
        });
        const body = await readJson<SimilarResponse>(res);
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "ready",
          pairs: body.pairs,
          model: body.model,
          blocks: body.blocks,
          error: null,
        });
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "error",
          pairs: NONE,
          model: null,
          blocks: 0,
          error: (err as Error).message,
        });
      }
    })();
    return () => stop.abort();
  }, [slug, enabled]);

  /* `NONE` rather than `state.pairs` while an answer belongs to another
     article: a stable empty array, so the graph memo downstream does not
     rebuild on every render. */
  return mine ? state : { ...state, status: "idle", pairs: NONE, model: null, blocks: 0, error: null };
}
