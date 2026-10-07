/**
 * The Skim, as the reading view sees it: the route through the Quotes,
 * whether it still fits them and the reader, and the things you can ask for.
 *
 * `useFaq`'s shape, with two differences that are this mode's own:
 *
 * - **Three staleness facts, not two**, and the third is stricter than every
 *   other artefact's: a route written with no profile is outdated the moment
 *   the reader writes one (`routeProfileIsStale`, src/skim.ts; Sol F7).
 *   `notOnRoute` says how many current quotes are absent from every pass. It
 *   does not prove they arrived after this route was planned.
 * - **Prerequisites in the same job.** The step refuses without Quotes, and
 *   since stage 6 plans around the Ideas, so when either is missing or stale
 *   the request names it in `precededBy` — `["quotes", "ideas"]` at most — one
 *   job that writes them all (the mechanism `useIllustrated` uses for the
 *   Sketch). The job's progress names whichever step is running (JobProgress).
 *   The band passes in both reads, and the job's end refreshes both, so Ideas
 *   the route's job found reach the stop card without a reload (Sol F61).
 *
 * Mounted by `SkimBand` alone, never hoisted, for `useFaq`'s reason:
 * `useAutoRun`'s owner must die with the band so a press cannot be spent after
 * the reader has left it.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md,
 * docs/project/skim.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, Skim, SkimResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import type { QuotesRead } from "./useQuotes.js";
import type { IdeasRead } from "./useIdeas.js";
import type { StepBefore } from "../step-order.js";

type SkimStatus = "loading" | "none" | "ready" | "error";

export interface UseSkim {
  status: SkimStatus;
  skim: Skim | null;
  /** The Quotes, Ideas, or outline changed under the route. */
  stale: boolean;
  /** The route was written by an older prompt or model. */
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
  /**
   * A run from here would find the Ideas first — there are none, they could
   * not be read, or they are stale. The long part of a first run (F64).
   */
  ideasFirst: boolean;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /**
   * **Write it if nobody has** — unforced, for the automatic run and the empty
   * state's button, which must be the same request (useIdeas.ts § `ensure`).
   * With no Quotes or Ideas, or stale ones, it asks for them first, in the
   * same job.
   */
  ensure(): Promise<void>;
  /**
   * The forced run — *Plan it again* in the stale/profile-changed banner, or
   * the Skim row in Metadata. It replaces the route, choosing the Quotes
   * and finding the Ideas first (unforced) when `ensure` would — never merely
   * because their prompt is older.
   */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

export function useSkim(slug: string, quotes: QuotesRead, ideas: IdeasRead): UseSkim {
  const [status, setStatus] = useState<SkimStatus>("loading");
  const [skim, setSkim] = useState<Skim | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [notOnRoute, setNotOnRoute] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /* A manual press made while a prerequisite read is unresolved. Keep the
     intent, not a guessed request: once both reads answer, the request below
     can name exactly the missing or stale prerequisites. */
  const [waitingRun, setWaitingRun] = useState<"ensure" | "regenerate" | null>(null);

  /* The read. `current()` after every `await`: src/web/useOrderedRead.ts. */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/skim/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          /* The ordinary case: nobody has asked for a route yet. */
          setSkim(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          setNotOnRoute(0);
          setError(null);
          setStatus("none");
          return;
        }
        const loaded = await readJson<SkimResponse>(res);
        if (!current()) return;
        setSkim(loaded.skim);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setProfileChanged(loaded.profileChanged);
        setNotOnRoute(loaded.notOnRoute);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take the route away — useFaq.ts. */
        setStatus((was) => (was === "loading" ? "error" : was));
      }
    },
    [slug],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (skim === null) setStatus("loading");
    await reload();
  }, [skim, reload]);

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

  /* **A finished job may have written the Quotes and the Ideas as well as the
     route**, so all three reads trail it. `refresh`, not `reload`: a request
     already in flight read the pre-job list. The Ideas read is the band's own,
     the one the stop card draws from — refreshing it here is what puts Ideas
     the route's job found on the card without a reload (Sol F61). */
  const refreshQuotes = quotes.refresh;
  const refreshIdeas = ideas.refresh;
  const onFinished = useCallback(() => {
    void refresh();
    void refreshQuotes();
    void refreshIdeas();
  }, [refresh, refreshQuotes, refreshIdeas]);
  const queue = useStepJob(slug, "skim", onFinished, "watches-queue");

  /* **The Quotes go first when there are none, or when they are stale** — the
     article changed under them, so a route planned on them could stop at a
     passage that has gone (Sol F30 on the plan's stage 5). An unreadable list
     is treated as none.

     **Not on every request.** The server's `stepIsDone` re-runs Quotes whose
     stamp differs in any way, an older prompt version included, so naming
     Quotes on every press re-bought and *replaced* a reader's Quotes when all
     they asked for was a new route — seen in the browser check on
     2026-09-28, ~$0.08 on a ~$0.02 press (the plan's F38, reverted). The
     narrow race it guarded — a Quotes read still revalidating — is left: the
     automatic run already waits for the read, and a route planned on Quotes
     that turn out stale says so in its stale banner. */
  const quotesFirst =
    quotes.status === "none" || quotes.status === "error" || (quotes.status === "ready" && quotes.stale);
  /* **The Ideas go first by the same rule** — none, unreadable, or stale — and
     for the same reason not when they are merely outdated or written for
     another profile: `stepIsDone` would re-run them, a whole-article call, on
     a press that asked for a route. Stage 6 of plan 260928a. */
  const ideasFirst =
    ideas.read.kind === "failed" ||
    (ideas.read.kind === "known" && (ideas.read.answer === null || ideas.read.answer.stale));
  /* Only a read with nothing known is waited for: a refresh over a known
     answer does not hold a press. */
  const ideasAsking = ideas.read.kind === "asking";
  const precededBy = useMemo<StepBefore<"skim">[]>(
    () => [...(quotesFirst ? (["quotes"] as const) : []), ...(ideasFirst ? (["ideas"] as const) : [])],
    [quotesFirst, ideasFirst],
  );
  const prerequisitesLoading = quotes.status === "loading" || ideasAsking;
  const startReady = useCallback(
    async (kind: "ensure" | "regenerate") => {
      await queue.start({
        ...(kind === "regenerate" ? { force: true } : {}),
        ...(precededBy.length > 0 ? { precededBy } : {}),
      });
    },
    [queue, precededBy],
  );
  const ensure = useCallback(async () => {
    if (prerequisitesLoading) {
      setWaitingRun("ensure");
      return;
    }
    await startReady("ensure");
  }, [prerequisitesLoading, startReady]);
  /* `useStepJob` names only this hook's own step in `force`, so Quotes and
     Ideas stay unforced. `FORCE_ONLY_WHEN_NAMED` protects the other direction:
     forcing either elsewhere must not sweep Skim into that job. */
  const regenerate = useCallback(async () => {
    if (prerequisitesLoading) {
      setWaitingRun("regenerate");
      return;
    }
    await startReady("regenerate");
  }, [prerequisitesLoading, startReady]);

  /* A visible button can be pressed after the route read settles but before
     Quotes or Ideas does. Start exactly once when the last prerequisite read
     answers, using that render's stale/none decision. If the band goes away,
     the state and the press go with it. */
  useEffect(() => {
    if (waitingRun === null || prerequisitesLoading) return;
    const kind = waitingRun;
    setWaitingRun(null);
    void startReady(kind);
  }, [waitingRun, prerequisitesLoading, startReady]);

  /**
   * **The automatic run waits for the Quotes' and the Ideas' reads**, because
   * the request it makes depends on the answers: with both current it is the
   * route alone, otherwise whichever is missing goes first. So a `none` here
   * waits until both have answered.
   */
  const gate: SkimStatus =
    status === "none" && (quotes.status === "loading" || ideasAsking)
      ? "loading"
      : status;
  const auto = useAutoRun(slug, "skim", gate, ensure, reload);

  return {
    status,
    skim,
    stale,
    outdated,
    profileChanged,
    notOnRoute,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting || waitingRun !== null,
    automatic: auto && (queue.job !== null || queue.starting || waitingRun !== null),
    quotesFirst,
    ideasFirst,
    retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
