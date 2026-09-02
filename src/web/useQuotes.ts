/**
 * The quotes, as the reading view sees them: the list, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/quotes/:slug`; the write half is a **job**, because
 * choosing them is a model call over the whole article and takes tens of seconds
 * (docs/project/ingest-queue.md).
 *
 * ## One verb, for the ideas' reason
 *
 * `useGlossary` has `find`, `more` and `reset`, and the difference between the
 * first two is the whole of that feature: running the glossary step again
 * **appends**, so "give me more terms" and "start over" cannot be the same
 * button and `reset` needs a DELETE of its own to mean anything.
 *
 * Quotes replaces. A piece has a dozen lines worth keeping, not forty, so there
 * is nothing to paginate — which means running the step again already *is*
 * "choose them again". No DELETE route, and the class of bugs that comes with
 * an append path does not exist here to be got wrong.
 *
 * **Two verbs since 2026-09-02** — `ensure` and `regenerate` — and the split is
 * `force` rather than append: see useIdeas.ts, which made the same change for
 * the same reason on the same day.
 *
 * ## What this hook carries that its siblings do not
 *
 * `discarded` — what the stage refused to store. Every other panel can report
 * only what it has; this one can say *three suggestions were discarded because
 * their wording could not be verified*, which is the difference between a list
 * that is honestly short and a list that is quietly short. It comes off the
 * artefact rather than out of a log, because a log is invisible to the person
 * the drop happened to. GPT Sol, 2026-08-31.
 *
 * See docs/project/quotes.md and src/quotes.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, Quotes, QuotesResponse } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

type QuotesStatus = "loading" | "none" | "ready" | "error";

export interface UseQuotes {
  status: QuotesStatus;
  quotes: Quotes | null;
  /**
   * The article moved after these were chosen.
   *
   * **It means more here than on any sibling panel.** A stale glossary entry is
   * a definition that still reads correctly; a stale quote carries a block id
   * that may be gone *and* words that may no longer be in the piece. This is
   * the one band whose staleness can make it false rather than merely dated,
   * which is why the panel puts the banner above the list.
   */
  stale: boolean;
  /** They predate the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** These were chosen with a reader profile at all. */
  profiled: boolean;
  /** ...and that profile is no longer the reader's. */
  profileChanged: boolean;
  hasProfile: boolean;
  /** The article this band is about — carried alongside `hasProfile`, as the ideas do. */
  slug: string;
  error: string | null;
  /** The job choosing this article's quotes, if one is. */
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
  /** The run in flight was started automatically. `UseIdeas.automatic`. */
  automatic: boolean;
  /**
   * **Choose the quotes if none have been** — unforced, for the automatic run
   * and for the button beside the empty state. They have to be the same
   * request, or their `work_key`s differ and the reader pays twice:
   * useIdeas.ts § `ensure`.
   */
  ensure(useProfile?: boolean): Promise<void>;
  /**
   * **Choose them again** — forced, for the button offered beside a list that
   * is current, where an unforced run would skip. Safe to force because this
   * step replaces rather than appends, and `quotes` is in
   * FORCE_ONLY_WHEN_NAMED with `useStepJob` naming the step.
   */
  regenerate(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

export function useQuotes(slug: string): UseQuotes {
  const [status, setStatus] = useState<QuotesStatus>("loading");
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/quotes/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and this is
        // what the panel's button is for.
        setQuotes(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<QuotesResponse>(res);
      setQuotes(loaded.quotes);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "chosen without one". */
      setProfiled(loaded.quotes.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and the panel renders the list only under
         `status === "ready"`, so an unconditional `error` here would let a flaky
         connection blank a list that was still perfectly good. Only the opening
         read has nothing to fall back on. The message is shown either way. Same
         guard, same reason, as useIdeas.ts and useGlossary.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary, the
     summaries and the ideas. */
  const queue = useStepJob(slug, "quotes", load);

  /* Two verbs, split on `force`. See the interface above, and useIdeas.ts. */
  const ensure = useCallback(
    async (useProfile = true) => {
      await queue.start({ useProfile });
    },
    [queue],
  );
  const regenerate = useCallback(
    async (useProfile = true) => {
      await queue.start({ force: true, useProfile });
    },
    [queue],
  );

  /* `load` is the way out of a failed read — useAutoRun.ts § A failed read is
     not an answer, and useIdeas.ts says the same. */
  const auto = useAutoRun(slug, "quotes", status, ensure, load);

  return {
    status,
    quotes,
    stale,
    outdated,
    profiled,
    profileChanged,
    hasProfile,
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
