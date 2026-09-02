/**
 * The ideas, as the reading view sees them: the list, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/ideas/:slug`; the write half is a **job**, because
 * finding them is a model call over the whole article and takes tens of seconds
 * (docs/project/ingest-queue.md).
 *
 * ## Three verbs became one, and that is the feature rather than a shortcut
 *
 * `useGlossary` has `find`, `more` and `reset`, and the difference between the
 * first two is the whole of that feature: running the glossary step again
 * **appends**, so "give me more terms" and "start over" cannot be the same
 * button and `reset` needs a DELETE of its own to mean anything.
 *
 * Ideas replaces. A piece has three to ten of them, not forty, so there is
 * nothing to paginate and nothing to append — which means running the step
 * again already *is* "start again". One verb, no DELETE route, and the class of
 * bugs that comes with an append path (a FORBIDDEN list, `existingFor`, "a
 * stale list is not appended to") does not exist here to be got wrong.
 *
 * See docs/plans/260826ac-ideas-mode.md and src/ideas.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Ideas, IdeasResponse, Job } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

type IdeasStatus = "loading" | "none" | "ready" | "error";

export interface UseIdeas {
  status: IdeasStatus;
  ideas: Ideas | null;
  /** The article moved after these were written — blocks **or** sections. */
  stale: boolean;
  /** They predate the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** These were written from a reader profile at all. */
  profiled: boolean;
  /**
   * ...and that profile is no longer the reader's.
   *
   * **The fact that matters most here of all five surfaces that carry it.** In
   * a glossary a changed profile means some terms would now be chosen
   * differently; here it changes what "assumed" *means*, because what a reader
   * has to bring is defined by who they are. So this is the one place the step
   * also re-runs on its own — `profileHash` is in the freshness stamp
   * (src/pipeline.ts § ideas), which no other stage does yet.
   */
  profileChanged: boolean;
  hasProfile: boolean;
  /**
   * The article this band is about — carried alongside `hasProfile` because
   * the same question needs it. The profile panel shows the *per-article* half
   * ("why you're reading this one") and links to the page that edits it, and
   * neither is possible without knowing which article. docs/plans/260830c-profile-panel.md.
   */
  slug: string;
  error: string | null;
  /** The job writing this article's ideas, if one is. */
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
   * Write the list — the only verb. `force` is passed always, because the
   * button means "find them again" whether or not there is a current artefact,
   * and the freshness check would otherwise turn a deliberate regeneration into
   * a no-op that looks exactly like a broken button.
   */
  find(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

export function useIdeas(slug: string): UseIdeas {
  const [status, setStatus] = useState<IdeasStatus>("loading");
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/ideas/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and this is
        // what the panel's button is for.
        setIdeas(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<IdeasResponse>(res);
      setIdeas(loaded.ideas);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "written without one". */
      setProfiled(loaded.ideas.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and `IdeasPanel` renders the list only under
         `status === "ready"`, so an unconditional `error` here made a flaky
         connection blank a list that was still perfectly good. Only the opening
         read has nothing to fall back on. The message is shown either way. Same
         guard, same reason, as useGlossary.ts § `fetchNow`. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary and
     the summaries. It carries the reasoning that used to be copied here. */
  const queue = useStepJob(slug, "ideas", load);

  const find = useCallback(
    async (useProfile = true) => {
      await queue.start({
        /* **Always forced**, which is the one place this differs from
           `useGlossary.find`. There the unforced call is meaningful because the
           step's own freshness check will agree when there is nothing current;
           here the button says "find them again" and is offered *beside a list
           that is current*, so an unforced run would skip and the reader would
           watch a job start and finish having changed nothing.

           Forcing is safe in a way it is not for the glossary: this step
           replaces rather than appends, so a forced run cannot silently
           lengthen anything. `ideas` is in FORCE_ONLY_WHEN_NAMED, and
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
    ideas,
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
