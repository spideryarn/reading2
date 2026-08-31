/**
 * The timeline, as the reading view sees it: the events, whether they still
 * describe the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/timeline/:slug`; the write half is a **job**,
 * because reading the chronology out of a piece is a model call over the whole
 * article and takes tens of seconds (docs/project/ingest-queue.md).
 *
 * ## One verb, like the ideas next door
 *
 * `useGlossary` has three — `find`, `more` and `reset` — and the difference
 * between the first two is the whole of that feature: running the glossary step
 * again **appends**. Timeline replaces, exactly as ideas do, so running the step
 * again already *is* "start again". One verb, no DELETE route, and the class of
 * bugs an append path brings (a FORBIDDEN list, "a stale list is not appended
 * to") does not exist here to be got wrong.
 *
 * ## Two staleness facts, not three
 *
 * `stale` and `outdated`, and deliberately no `profileChanged`. Who is reading
 * changes what an *idea* is — what you need to bring is defined by who you are —
 * but it does not change when something happened, so the reader profile is not
 * in this stage's stamp at all. That is a decision rather than an omission, and
 * it means one fewer reason to spend a model call again.
 * docs/plans/260831i-timeline-mode.md § Freshness.
 *
 * **What `stale` covers here is wider than anywhere else**: blocks, sections
 * *and the publication date*. Nineteen of the test article's twenty-four
 * temporal expressions are year-less, so a publisher re-dating a post changes
 * almost every row and not one word in any other artefact — which is why
 * Timeline has a fingerprint of its own rather than widening the shared one.
 *
 * See docs/plans/260831i-timeline-mode.md and src/timeline.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, Timeline, TimelineResponse } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";

type TimelineStatus = "loading" | "none" | "ready" | "error";

export interface UseTimeline {
  status: TimelineStatus;
  timeline: Timeline | null;
  /** The article moved after this was written — blocks, sections **or** its date. */
  stale: boolean;
  /** It predates the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** The article this band is about. */
  slug: string;
  error: string | null;
  /** The job writing this article's timeline, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
  /**
   * Read the chronology — the only verb. `force` is passed always, because the
   * button means "read it again" whether or not there is a current artefact,
   * and the freshness check would otherwise turn a deliberate regeneration into
   * a no-op that looks exactly like a broken button.
   */
  find(): Promise<void>;
  cancel(id: string): void;
}

export function useTimeline(slug: string): UseTimeline {
  const [status, setStatus] = useState<TimelineStatus>("loading");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/timeline/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        /* The ordinary case, not a fault, and here it is the *commonest* case
           by some distance: most articles have no timeline because nobody has
           asked for one. This is what the panel's button is for. */
        setTimeline(null);
        setStale(false);
        setOutdated(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<TimelineResponse>(res);
      setTimeline(loaded.timeline);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and the panel renders the events only under
         `status === "ready"`, so an unconditional `error` here would let a
         flaky connection blank a list that was still perfectly good. Only the
         opening read has nothing to fall back on, and the message is shown
         either way. Same guard, same reason, as useIdeas.ts and useGlossary.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary,
     the summaries and the ideas. */
  const queue = useStepJob(slug, "timeline", load);

  const find = useCallback(async () => {
    await queue.start({
      /* **Always forced**, for the reason `useIdeas.find` gives: the button is
         offered *beside a list that is current*, so an unforced run would skip
         and the reader would watch a job start and finish having changed
         nothing. Forcing is safe because this step replaces rather than
         appends, so a forced run cannot silently lengthen anything. */
      force: true,
    });
  }, [queue]);

  return {
    status,
    timeline,
    stale,
    outdated,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    find,
    cancel: queue.cancel,
  };
}
