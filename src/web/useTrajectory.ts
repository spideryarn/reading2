/**
 * The Trajectory, as the reading view sees it: the route through the Quotes,
 * whether it still fits them and the reader, and the things you can ask for.
 *
 * `useFaq`'s shape, with two differences that are this mode's own:
 *
 * - **Three staleness facts, not two**, and the third is stricter than every
 *   other artefact's: a route written with no profile is outdated the moment
 *   the reader writes one (`routeProfileIsStale`, src/trajectory.ts; Sol F7).
 *   `notOnRoute` says how many quotes arrived since — *Find more*, say.
 * - **A prerequisite in the same job.** The step refuses without Quotes, so
 *   when there are none, or they are stale, the request is `precededBy: ["quotes"]`, one
 *   job that writes both (the mechanism `useIllustrated` uses for the Sketch).
 *   The job's progress names whichever step is running (JobProgress).
 *
 * Mounted by `TrajectoryBand` alone, never hoisted, for `useFaq`'s reason:
 * `useAutoRun`'s owner must die with the band so a press cannot be spent after
 * the reader has left it.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md,
 * docs/project/trajectory.md.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, Trajectory, TrajectoryResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import type { QuotesRead } from "./useQuotes.js";

type TrajectoryStatus = "loading" | "none" | "ready" | "error";

export interface UseTrajectory {
  status: TrajectoryStatus;
  trajectory: Trajectory | null;
  /** The Quotes changed under the route — more were found, or they were chosen again. */
  stale: boolean;
  /** The Quotes are the same, and the current prompt would order them differently. */
  outdated: boolean;
  /** The route was written for another profile — including none, when you now have one. */
  profileChanged: boolean;
  /** How many of the current Quotes are on no pass of this route. */
  notOnRoute: number;
  slug: string;
  error: string | null;
  job: Job | null;
  failed: StepFailure | null;
  stalled: boolean;
  starting: boolean;
  /** The run in flight was started automatically. `UseFaq.automatic`. */
  automatic: boolean;
  /**
   * A run from here would choose the Quotes first — there are none, or they
   * are stale — so the band can say it will take longer.
   */
  quotesFirst: boolean;
  /** Repeat only the GET after a failed read. Never starts a model job. */
  retryRead(): Promise<void>;
  /**
   * **Write it if nobody has** — unforced, for the automatic run and the empty
   * state's button, which must be the same request (useIdeas.ts § `ensure`).
   * With no Quotes, or stale ones, it asks for them first, in the same job.
   */
  ensure(): Promise<void>;
  /**
   * The forced run — *Plan it again*, under the route and on the outdated
   * banner. It replaces the route, choosing the Quotes first when `ensure` would.
   * `trajectory` is in FORCE_ONLY_WHEN_NAMED, so forcing it never sweeps the
   * Quotes in (src/pipeline.ts).
   */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

export function useTrajectory(slug: string, quotes: QuotesRead): UseTrajectory {
  const [status, setStatus] = useState<TrajectoryStatus>("loading");
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [notOnRoute, setNotOnRoute] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /* The read. `current()` after every `await`: src/web/useOrderedRead.ts. */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/trajectory/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          /* The ordinary case: nobody has asked for a route yet. */
          setTrajectory(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          setNotOnRoute(0);
          setError(null);
          setStatus("none");
          return;
        }
        const loaded = await readJson<TrajectoryResponse>(res);
        if (!current()) return;
        setTrajectory(loaded.trajectory);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setProfileChanged(loaded.profileChanged);
        setNotOnRoute(loaded.notOnRoute);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError((err as Error).message);
        /* A failed revalidation must not take the route away — useFaq.ts. */
        setStatus((was) => (was === "loading" ? "error" : was));
      }
    },
    [slug],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (trajectory === null) setStatus("loading");
    await reload();
  }, [trajectory, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* The Quotes are read once in `OwnedReader`, and every later revalidation
     belongs to a band (useQuotes.ts § An always-mounted read is not an
     always-fresh read). This is a band that stands on them, so it revalidates
     them on mount the way `QuotesBand` does — `reload` joins a request already
     in flight. */
  const reloadQuotes = quotes.reload;
  useEffect(() => {
    void reloadQuotes();
  }, [reloadQuotes]);

  /* **A finished job may have written the Quotes as well as the route**, so
     both reads trail it. `refresh`, not `reload`: a request already in flight
     read the pre-job list. */
  const refreshQuotes = quotes.refresh;
  const onFinished = useCallback(() => {
    void refresh();
    void refreshQuotes();
  }, [refresh, refreshQuotes]);
  const queue = useStepJob(slug, "trajectory", onFinished, "watches-queue");

  /* **The Quotes go first when there are none, or when they are stale** — the
     article changed under them, so a route planned on them could stop at a
     passage that has gone (Sol F30 on the plan's stage 5). An unreadable list
     is treated as none. The preceding step is unforced either way, so Quotes
     that turn out to exist and be current are skipped by `stepIsDone` and
     nothing extra is bought (useStepJob.ts § `precededBy`). */
  const quotesFirst =
    quotes.status === "none" || quotes.status === "error" || (quotes.status === "ready" && quotes.stale);
  const ensure = useCallback(async () => {
    await queue.start(quotesFirst ? { precededBy: ["quotes"] } : {});
  }, [queue, quotesFirst]);
  /* Forced on `trajectory` alone — `force` names the step, and `trajectory` is
     in FORCE_ONLY_WHEN_NAMED — so the Quotes, when they go first, go unforced. */
  const regenerate = useCallback(async () => {
    await queue.start(quotesFirst ? { force: true, precededBy: ["quotes"] } : { force: true });
  }, [queue, quotesFirst]);

  /**
   * **The automatic run waits for the Quotes' read**, because the request it
   * makes depends on the answer: with Quotes it is the route alone, without
   * them it is the Quotes first. Spending while the Quotes are still loading
   * would guess — and a guess of "none" buys nothing extra (the step is
   * unforced, and `stepIsDone` skips Quotes that are current), while a guess of
   * "some" is refused by the server and costs the reader their one automatic
   * try. So a `none` here waits until the Quotes have answered.
   */
  const gate: TrajectoryStatus =
    status === "none" && quotes.status === "loading" ? "loading" : status;
  const auto = useAutoRun(slug, "trajectory", gate, ensure, reload);

  return {
    status,
    trajectory,
    stale,
    outdated,
    profileChanged,
    notOnRoute,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    quotesFirst,
    retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
