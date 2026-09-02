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
 * again already *is* "start again". No DELETE route, and the class of bugs that
 * comes with an append path (a FORBIDDEN list, `existingFor`, "a stale list is
 * not appended to") does not exist here to be got wrong.
 *
 * **Two verbs since 2026-09-02, and the split is `force`, not append.**
 * `ensure` for *there is nothing here* and `regenerate` for *do it again*. It
 * was one verb that forced always, which was right while a person pressing a
 * button was the only caller; a mode that starts itself is a second caller, and
 * two callers with different `force` are two `work_key`s and two paid jobs. See
 * `ensure` on the interface.
 *
 * See docs/plans/260826ac-ideas-mode.md and src/ideas.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Ideas, IdeasResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
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
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /**
   * **The run in flight was started automatically**, so the panel says which
   * profile it is using rather than offering a tick it has already decided.
   *
   * Narrowed to *and something is running* here rather than in the panel, so
   * five panels cannot each get the narrowing slightly different: once the job
   * lands or fails, the tickbox is the honest control again.
   */
  automatic: boolean;
  /**
   * **Write the list if there is not one** — unforced, for the automatic run
   * and for the button beside the empty state.
   *
   * The two must be the same request. `work_key` is computed from the request,
   * `force` included, so an unforced automatic run and a forced press inside
   * the same second are two different keys, `enqueueOrGet` does not collapse
   * them, and the reader pays for two model calls. There used to be one verb
   * here and it forced always, which is exactly that bug waiting for a second
   * caller.
   */
  ensure(useProfile?: boolean): Promise<void>;
  /**
   * **Write the list again** — forced, for the button offered *beside a list
   * that is current*, where an unforced run would skip and the reader would
   * watch a job start and finish having changed nothing.
   *
   * Forcing is safe in a way it is not for the glossary: this step replaces
   * rather than appends, so a forced run cannot silently lengthen anything.
   * `ideas` is in FORCE_ONLY_WHEN_NAMED, and `useStepJob` names the step it is
   * forcing — which is what makes that true rather than a hope.
   */
  regenerate(useProfile?: boolean): Promise<void>;
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

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/ideas/${encodeURIComponent(slug)}`);
      if (!current()) return;
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
      if (!current()) return;
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
      if (!current()) return;
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
     says to the reader — is src/web/useStepJob.ts, shared with the glossary and
     the summaries. It carries the reasoning that used to be copied here. */
  const queue = useStepJob(slug, "ideas", refresh);

  /* Two verbs where there was one. See `ensure` and `regenerate` on the
     interface above for why the difference is the identity of the request
     rather than a convenience. */
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

  /* `reload`, not `ensure`, for the last argument: a read that failed is
     answered by reading again, not by spending. useAutoRun.ts § A failed read
     is not an answer. And `reload` rather than the raw `load`, which takes the
     ordering predicate from useOrderedRead and is not a standalone read — the
     merge of the two on 2026-09-02 was a typecheck error at this line. */
  const auto = useAutoRun(slug, "ideas", status, ensure, reload);

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
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
