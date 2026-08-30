/**
 * The summaries, as the reading view sees them: the artefact, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/summary/:slug`; the write half is a **job**,
 * because writing them is several model calls over the whole article and takes
 * a minute or two (docs/project/ingest-queue.md). So this is the same shape as
 * `useGlossary` beside it, and deliberately so — the two answer the same
 * question about different artefacts, and the day they stop agreeing is the day
 * one of them is wrong.
 *
 * **One verb, where the glossary has three.** The glossary needs `find`, `more`
 * and `reset` because running its step *appends* to the list. This step
 * replaces its artefact wholesale, so "write them" and "write them again" are
 * one button whose only difference is whether the step's own freshness check
 * agrees — which is exactly what `force` is for, and why there is no DELETE
 * endpoint on the other side of it (src/api.ts § `loadSummaries`).
 *
 * **The panel works without any of this.** Every internal tree node already
 * carries a one-sentence gist from stage 4, so summary mode has a usable
 * shortest rung before a single model call is made. That is why this hook's
 * `status: "none"` is not an empty state but an offer: the ladder is there, and
 * the two longer rungs are what the button buys.
 *
 * See docs/project/summaries.md.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, Summaries, SummariesResponse } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

type SummariesStatus = "loading" | "none" | "ready" | "error";

export interface UseSummaries {
  status: SummariesStatus;
  summaries: Summaries | null;
  /** The article moved after they were written. Said out loud, never worked around. */
  stale: boolean;
  /** Written from a reader profile, and whether that profile has changed since. */
  profiled: boolean;
  profileChanged: boolean;
  /**
   * The reader has a profile that applies to **this article** — either half.
   *
   * Resolved here rather than in the panel because the slug is here, and the
   * question needs it: a reader who has written only "why you're reading this
   * one" has a profile as far as every prompt is concerned. src/web/useProfile.ts.
   */
  hasProfile: boolean;
  /**
   * The article this band is about — carried alongside `hasProfile` because
   * the same question needs it. The profile panel shows the *per-article* half
   * ("why you're reading this one") and links to the page that edits it, and
   * neither is possible without knowing which article. docs/plans/profile-panel.md.
   */
  slug: string;
  /** A read failure, or the reason the last request could not be started. */
  error: string | null;
  /** The job writing this article's summaries, if one is. Null otherwise. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
  /**
   * Write them. `force` is for the case where the step thinks it is current,
   * and `useProfile` defaults to true — pass false for a plain set.
   *
   * On the action rather than in panel state, because the artefact records what
   * it was run with (`profileHash`) — so the next visit reads the reader's
   * choice off the file rather than having to remember it.
   */
  write(force?: boolean, useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

export function useSummaries(slug: string): UseSummaries {
  const [status, setStatus] = useState<SummariesStatus>("loading");
  const [summaries, setSummaries] = useState<Summaries | null>(null);
  const [stale, setStale] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/summary/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and the
        // panel still works — it falls back to the gists on the tree.
        setSummaries(null);
        setStale(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<SummariesResponse>(res);
      setSummaries(loaded.summaries);
      setStale(loaded.stale);
      /* `!= null`, not truthiness: `null` and absent both mean "written without
         a profile" and a hash means written with one. */
      setProfiled(loaded.summaries.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the artefact away.** `load` is
         not only the opening read — `onFinished` below calls it again whenever
         a job finishes — so an unconditional `error` here throws away an
         artefact that is still on screen. Only the opening read has nothing to
         fall back on. Same guard, same reason, as useGlossary.ts § `fetchNow`.

         `SummaryPanel` happens to key its visibility on `summaries !== null`
         rather than on this, deliberately and with a comment, so today the
         reader would not have seen the panel empty. That is one edit away from
         being untrue, and the hook's contract should not depend on which of its
         two facts the panel chose to read. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary and
     the ideas. It carries the reasoning that used to be copied here. */
  const queue = useStepJob(slug, "summary", load);

  const write = useCallback(
    async (force = false, useProfile = true) => {
      await queue.start({ force, useProfile });
    },
    [queue],
  );

  return {
    status,
    summaries,
    stale,
    profiled,
    profileChanged,
    hasProfile,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    write,
    cancel: queue.cancel,
  };
}
