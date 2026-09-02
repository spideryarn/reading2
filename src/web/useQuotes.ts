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
 * "choose them again". One verb, no DELETE route, and the class of bugs that
 * comes with an append path does not exist here to be got wrong.
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
  /**
   * Choose the quotes — the only verb. `force` is passed always, because the
   * button means "choose them again" whether or not there is a current artefact,
   * and the freshness check would otherwise turn a deliberate regeneration into
   * a no-op that looks exactly like a broken button.
   */
  find(useProfile?: boolean): Promise<void>;
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

  const find = useCallback(
    async (useProfile = true) => {
      await queue.start({
        /* **Always forced**, the same call `useIdeas.find` makes. The button
           says "choose them again" and is offered beside a list that is
           current, so an unforced run would skip and the reader would watch a
           job start and finish having changed nothing.

           Forcing is safe in a way it is not for the glossary: this step
           replaces rather than appends, so a forced run cannot silently
           lengthen anything. `quotes` is in FORCE_ONLY_WHEN_NAMED, and
           `useStepJob` names the step it is forcing — which is what makes that
           true rather than a hope. */
        force: true,
        useProfile,
      });
    },
    [queue],
  );

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
    find,
    cancel: queue.cancel,
  };
}
