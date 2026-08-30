/**
 * **Where every paragraph sits on the plane the embeddings describe**, fetched
 * when — and only when — a picture is drawn that uses it.
 *
 * `POST /api/projection/:slug` (src/projection.ts). The sibling of
 * [useSimilar.ts](./useSimilar.ts), and deliberately the same shape: same gate,
 * same "an answer belongs to one article" rule, same refusal to blank the
 * picture on a failure. Two hooks rather than one because the two answers are
 * wanted by different pictures at different moments, and a reader who never
 * presses Drift should not buy its arithmetic.
 *
 * ## Three rules, all of them about not lying to the reader
 *
 * **`enabled` is the whole gate.** This and `useSimilar` are the only fetches
 * in the reading view that spend money without a button saying so. Pressing a
 * diagram toggle is not a purchase decision, so the request happens on exactly
 * the two pictures that draw it and never on the third. The vectors are
 * shared with `useSimilar`'s answer on the server, so a reader who has already
 * opened Force pays only for the arithmetic.
 *
 * **It blocks the picture, and the picture says so.** Unlike Force — which is
 * four fifths drawn without any of this — Drift and Trail have *nothing* to
 * draw without it. Until 2026-08-30 they borrowed the Tree while they waited,
 * on the reasoning that a picture of something real with a line of explanation
 * beats a spinner over an empty box. The Tree has been cut, and the reasoning
 * had a hole in it anyway: a mode that answers a question you did not ask,
 * under small type explaining that it is not the picture you pressed, is a
 * worse failure than an honest wait. `layoutDiagram` now returns null and the
 * panel draws the spinner (DiagramPanel.tsx § Waiting).
 *
 * **A failure is not a blank.** If the request fails, the reason — the
 * server's own words, ending in a code the reader can quote — stands where the
 * picture would have been. Failing to nothing at all is the
 * [silent-success](../../docs/reusable/silent-success.md) shape.
 */
import { useEffect, useState } from "react";
import type { ProjectionPoint, ProjectionResponse, SkipCounts } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

type ProjectionStatus = "idle" | "loading" | "ready" | "error";

export interface UseProjection {
  status: ProjectionStatus;
  points: ProjectionPoint[];
  /** How many topics the model's grouping found room for. 0 until it answers. */
  k: number;
  /** What fraction of the article's variation each axis holds, 0–1. */
  variance: [number, number];
  /** How many paragraphs were embedded — fewer than the article has. */
  blocks: number;
  /** How many were not, by reason. The dots do not tile the article. */
  skipped: SkipCounts;
  model: string | null;
  error: string | null;
}

/** Nothing, shared — a new `[]` each render would relayout the picture every time. */
const NONE: ProjectionPoint[] = [];
const NO_SKIPS: SkipCounts = { nonProse: 0, tooShort: 0, capped: 0 };
const ZERO: [number, number] = [0, 0];

const IDLE: UseProjection = {
  status: "idle",
  points: NONE,
  k: 0,
  variance: ZERO,
  blocks: 0,
  skipped: NO_SKIPS,
  model: null,
  error: null,
};

export function useProjection(slug: string, enabled: boolean): UseProjection {
  const [state, setState] = useState<UseProjection & { slug: string }>({ ...IDLE, slug });

  /* **Whose answer this is.** These coordinates are about one article's
     paragraphs, so drawing the previous one's would be a picture confidently
     about the wrong text.

     **As the app is wired today this can never be false** — `App.tsx` keys the
     article components on the slug, so a slug change remounts this hook rather
     than handing it a new slug. The comment here used to claim the opposite.
     `useSimilar` carries the same guard and the same correction; read the
     longer version there for why both are kept. */
  const mine = state.slug === slug;

  useEffect(() => {
    if (!enabled) return;
    /* Not cleared when `enabled` goes false: stepping from Drift to Trail and
       back must not throw away an answer already paid for. The server caches
       too, so a second request would be cheap — but it would still be a round
       trip, and the dots would visibly vanish and return for no reason the
       reader could see. */
    const stop = new AbortController();
    setState((s) =>
      s.slug === slug && s.status === "ready" ? s : { ...IDLE, slug, status: "loading" },
    );
    void (async () => {
      try {
        /* **POST, because the first call spends money.** GET is meant to be
           safe, and a browser, a proxy or a prefetcher is entitled to repeat a
           GET without asking anybody — which for this route would be paying to
           embed the article again. src/routes.ts says the same from the other
           end. */
        const res = await apiFetch(`/api/projection/${encodeURIComponent(slug)}`, {
          method: "POST",
          signal: stop.signal,
        });
        const body = await readJson<ProjectionResponse>(res);
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "ready",
          points: body.points,
          k: body.k,
          variance: body.variance,
          blocks: body.blocks,
          skipped: body.skipped,
          model: body.model,
          error: null,
        });
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        setState({ ...IDLE, slug, status: "error", error: (err as Error).message });
      }
    })();
    return () => stop.abort();
  }, [slug, enabled]);

  /* `IDLE` rather than the stale state while an answer belongs to another
     article: stable empty values, so the layout memo downstream does not rerun
     on every render. */
  return mine ? state : IDLE;
}
