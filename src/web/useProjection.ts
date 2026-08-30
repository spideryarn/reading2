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
 * the two pictures that draw it and never on the third.
 *
 * **And it is a whole purchase, not a share.** This said that a reader who had
 * already opened Force paid only for the arithmetic here, which is what
 * `src/article-vectors.ts` was built for and is not what happens: `similar.ts`
 * still calls `embedAll` itself, so a cold Force → Drift embeds the article
 * twice. That is recorded as debt in article-vectors.ts § *today only
 * projection.ts uses it*; what was wrong was a client comment stating the
 * intention as a fact. ⟨Sol⟩, 2026-08-30.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Ask again.
   *
   * The fetch runs once from an effect, so before this existed a reader whose
   * request failed — a quota, a dropped connection, a deploy mid-flight — had
   * the reason on screen and no verb anywhere: the only way back was to leave
   * the mode and come in again, which nothing said. Greg, 2026-08-30:
   * *"And/or a button to trigger generation if needed."*
   *
   * Stable, so a panel can hand it to a button without rerendering the picture.
   */
  retry(): void;
}

/** Nothing, shared — a new `[]` each render would relayout the picture every time. */
const NONE: ProjectionPoint[] = [];
const NO_SKIPS: SkipCounts = { nonProse: 0, tooShort: 0, capped: 0 };
const ZERO: [number, number] = [0, 0];

const NO_RETRY = () => {};

const IDLE: UseProjection = {
  status: "idle",
  points: NONE,
  k: 0,
  variance: ZERO,
  blocks: 0,
  skipped: NO_SKIPS,
  model: null,
  error: null,
  retry: NO_RETRY,
};

export function useProjection(slug: string, enabled: boolean): UseProjection {
  /* **The state holds the data, never the verb.** `retry` is added on the way
     out, so no `setState` here has to remember to carry it. */
  const [state, setState] = useState<Omit<UseProjection, "retry"> & { slug: string }>({
    ...IDLE,
    slug,
  });
  /* **A counter, not a boolean.** Two failures in a row are two presses, and a
     flag that was already true on the second one would set state to the value
     it already held and re-run nothing. */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /**
   * **What this hook has already spent an attempt on**, so a chip press cannot
   * spend another.
   *
   * The effect used to re-run its POST every time this picture came back on
   * screen, on the reasoning that the server caches. It does — *in process*,
   * and `similar.ts` records that a cold process is the normal case on Vercel
   * and re-embeds the article for about $0.002. So a reader stepping between
   * the chips was paying to be told what this hook was already holding, and
   * nothing about a chip press says the article changed. ⟨Sol⟩, 2026-08-30.
   *
   * **One request per attempt per article**, and `retry` is what buys another —
   * which is the whole reason `attempt` is a counter. Recorded when the request
   * *settles*, success or failure, so a picture that failed does not re-buy
   * itself on every toggle either; not recorded on an abort, because that
   * request never happened and the reader is owed it when they come back.
   *
   * A ref rather than state: writing it must not itself cause a render, and it
   * is read at the top of the effect that writes it.
   */
  const bought = useRef<string | null>(null);

  /* **Whose answer this is.** These coordinates are about one article's
     paragraphs, so drawing the previous one's would be a picture confidently
     about the wrong text.

     **As the app is wired today this can never be false** — `App.tsx` keys the
     article components on the slug, so a slug change remounts this hook rather
     than handing it a new slug. The comment here used to claim the opposite.
     `useSimilar` carries the same guard and the same correction; read the
     longer version there for why both are kept. */
  const mine = state.slug === slug;

  /* `attempt` is a token whose only job is to be different, so that pressing
     Try again re-runs an effect whose real inputs have not changed. It needed a
     lint suppression while nothing read it; `bought` reads it now, which is the
     better answer to the same objection — the dependency is a value the body
     uses rather than a nudge the body ignores. */
  useEffect(() => {
    if (!enabled) return;
    const token = `${slug}#${attempt}`;
    if (bought.current === token) return;
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
        /* **A failed revalidation must not take the picture away**, and the
           guard above was only half of that. It suppressed the *spinner* when
           an answer was already held, and this line then replaced the answer
           itself with nothing — so one flaky repeat, on a toggle back to a
           picture that was complete, emptied the band and reported a failure
           about a picture the reader already had. It is the rule `useSketch`
           and `useIdeas` write down, applied to the hook that had not got it.
           ⟨Sol⟩, 2026-08-30.

           There is nothing to say to the reader here: what is on screen is
           still the answer, and a sentence about a request they did not make
           would be reporting our own bookkeeping. `retry` is offered only from
           `error`, which is now reachable only when there is nothing to lose. */
        setState((was) =>
          was.slug === slug && was.status === "ready"
            ? was
            : { ...IDLE, slug, status: "error", error: (err as Error).message },
        );
      } finally {
        /* **On settle, not on success**, so a picture that failed does not
           re-buy itself on every toggle back — the reader has `retry` for that,
           and it bumps `attempt`. Not on an abort: that request never happened,
           so they are still owed it. */
        if (!stop.signal.aborted) bought.current = token;
      }
    })();
    return () => stop.abort();
  }, [slug, enabled, attempt]);

  /* `IDLE` rather than the stale state while an answer belongs to another
     article: stable empty values, so the layout memo downstream does not rerun
     on every render.

     Memoised so the spread is not a new object on every render. It buys less
     than the first version of this comment claimed — `Waiting`, the one thing
     downstream that takes the whole object, is not memoised, so it rerenders
     with its parent regardless (⟨Sol⟩, 2026-08-30). What it does buy is that
     the identity is a fact about the answer rather than about the render, which
     is what any future `memo` here would need. The fields inside are the same
     references either way, which is what keeps the layout memos from rerunning. */
  return useMemo(() => ({ ...(mine ? state : IDLE), retry }), [mine, state, retry]);
}
