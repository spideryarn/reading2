/**
 * The timeline, as the reading view sees it: the events, whether they still
 * describe the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/timeline/:slug`; the write half is a **job**,
 * because reading the chronology out of a piece is a model call over the whole
 * article and takes tens of seconds (docs/project/ingest-queue.md).
 *
 * ## Two verbs, like the ideas next door
 *
 * `useGlossary` has three — `find`, `more` and `reset` — and the difference
 * between the first two is the whole of that feature: running the glossary step
 * again **appends**. Timeline replaces, exactly as ideas do, so running the step
 * again already *is* "start again". No DELETE route, and the class of bugs an
 * append path brings (a FORBIDDEN list, "a stale list is not appended to") does
 * not exist here to be got wrong.
 *
 * What is left is `ensure` and `regenerate`, split on `force` since 2026-09-02
 * so that the mode which starts itself and the button beside the empty state
 * make the identical request — useIdeas.ts § `ensure`.
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
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
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
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning, and
   * src/job-state.ts § Transport health is not a job state carries why it is
   * not on the record.
   */
  stalled: boolean;
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /**
   * The run in flight was started automatically. `UseIdeas.automatic`.
   *
   * Nothing draws it on this panel — the reader profile is deliberately not in
   * this stage's stamp, so there is no tickbox here to replace — and it is on
   * the interface so that the five hooks answer the same questions. See
   * § Two staleness facts, not three above.
   */
  automatic: boolean;
  /**
   * **Read the chronology if it has not been read** — unforced, for the
   * automatic run and for the button beside the empty state. They have to be
   * the same request, or their `work_key`s differ and the reader pays twice:
   * useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /**
   * **Read it again** — forced, for the button offered beside a timeline that
   * is current, where an unforced run would skip. Safe to force because this
   * step replaces rather than appends.
   */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

export function useTimeline(slug: string): UseTimeline {
  const [status, setStatus] = useState<TimelineStatus>("loading");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/timeline/${encodeURIComponent(slug)}`);
      if (!current()) return;
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
      if (!current()) return;
      setTimeline(loaded.timeline);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
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

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     seven other artefact readers — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary,
     the summaries and the ideas. */
  const queue = useStepJob(slug, "timeline", refresh);

  /* Two verbs, split on `force`. See the interface above, and useIdeas.ts. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);

  /* `reload` is the way out of a failed read — useAutoRun.ts § A failed read is
     not an answer, and useIdeas.ts says why it is `reload` and not `load`. */
  const auto = useAutoRun(slug, "timeline", status, ensure, reload);

  return {
    status,
    timeline,
    stale,
    outdated,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
