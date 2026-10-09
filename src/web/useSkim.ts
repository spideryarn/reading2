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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER, type Job, type Skim, type SkimProfileNoticeDismissalRequest, type SkimResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
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
  /**
   * The reader sent the profile-changed notice away, for this route under the
   * profile they have now — `SkimResponse.profileNoticeDismissed`, or `true`
   * from the moment they press its × until a read after the write says
   * otherwise.
   */
  profileNoticeDismissed: boolean;
  /**
   * Why the last × did not stick. Shown in the banner, which is back by then.
   */
  dismissFailed: string | null;
  /**
   * The banner's ×: hide the notice now and record it — plan 261009i. **A
   * failed write reads the route before it puts the banner back**, because the
   * write may have landed before the answer was lost; that read decides. If
   * the read cannot answer either, the banner comes back with the reason: an
   * unconfirmed dismissal is not shown as a done one.
   */
  dismissProfileNotice(): Promise<void>;
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
  /**
   * The forced run was pressed on the route still on screen, and has neither
   * replaced it nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /** Read the route again, trailing a read in flight — `OrderedRead.refresh`. Never spends. */
  refresh(): Promise<void>;
  cancel(id: string): void;
}

export function useSkim(slug: string, quotes: QuotesRead, ideas: IdeasRead): UseSkim {
  const [status, setStatus] = useState<SkimStatus>("loading");
  const [skim, setSkim] = useState<Skim | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [profileNoticeDismissed, setProfileNoticeDismissed] = useState(false);
  /* Keyed by slug: the ×'s failure belongs to the article it was pressed on. */
  const [dismissFailed, setDismissFailed] = useState<{ slug: string; why: string } | null>(null);
  /**
   * **The ×'s write, from the press until its own trailing read has landed.**
   * A read already out when the × was pressed saw the database before the
   * write, so while this is set a read does not put the notice back on the
   * route it names — unless the write failed, when the server's answer is the
   * only one there is. A ref, because the read checks it after its `await`s.
   */
  const dismissal = useRef<{ slug: string; generatedAt: string; failed: string | null } | null>(null);
  /** Every read that answered, counted, and its answer — so the × can tell whether one landed after its write. */
  const answered = useRef<{ n: number; slug: string; generatedAt: string | null; dismissed: boolean }>({
    n: 0,
    slug,
    generatedAt: null,
    dismissed: false,
  });
  /* For a write that finishes after the reader has moved to another article:
     its render's `refresh` reads the old one (GPT Sol's code review). */
  const slugNow = useRef(slug);
  slugNow.current = slug;
  const [notOnRoute, setNotOnRoute] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /* A manual press made while a prerequisite read is unresolved. Keep the
     intent, not a guessed request: once both reads answer, the request below
     can name exactly the missing or stale prerequisites. */
  const [waitingRun, setWaitingRun] = useState<"ensure" | "regenerate" | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /**
   * The article the server has said "none yet" for. A failed read after that
   * answer — a failed *Try again* included — ends at `none`, not `error`,
   * so the empty state's button stays (Greg, 2026-10-07; docs/project/mode.md
   * § The artefact, if the mode shows one). Keyed by slug, so one article's
   * answer cannot stand in for another's.
   */
  const saidNoneFor = useRef<string | null>(null);

  /* The read. `current()` after every `await`: src/web/useOrderedRead.ts. */
  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* The header asks for "none yet" as `200 null` rather than a 404, which
           a browser prints in red (`NONE_YET_AS_NULL_HEADER`, src/types.ts). */
        const res = await apiFetch(`/api/skim/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        /* **Checked and derived before anything is published** (plan 261007e,
           WCO4): `readJson` checks no shape, and an empty 200 is `{}`.
           "None yet" is exactly `null` — never a falsy body — or a 404, from a
           server that has not heard of the header (the minutes of a deploy). */
        const loaded = res.status === 404 ? null : await readJson<SkimResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case: nobody has asked for a route yet. */
          setSkim(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          setProfileNoticeDismissed(false);
          answered.current = { n: answered.current.n + 1, slug, generatedAt: null, dismissed: false };
          setNotOnRoute(0);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        /* A reply without a route is published nowhere: a `MalformedReply`,
           so the reader gets `PAGE_FAULT` and what is on screen stays
           (tests/read-error-matrix.test.tsx). The list of stops is what the
           server itself requires of a stored route before it answers 200
           (`loadSkim`, src/store/pg.ts), so no route it sends fails this. */
        const route = (loaded as Partial<SkimResponse> | undefined)?.skim;
        if (typeof route !== "object" || route === null || !Array.isArray(route.stops)) {
          throw new MalformedReply("the skim reply has no route");
        }
        setSkim(route);
        landed(started, res, route.generatedAt);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setProfileChanged(loaded.profileChanged);
        /* `=== true`: a server from before the field (the minutes of a deploy)
           says nothing, which is "not dismissed". */
        const dismissed = loaded.profileNoticeDismissed === true;
        const writing = dismissal.current;
        const held =
          writing !== null && writing.slug === slug && writing.generatedAt === route.generatedAt && writing.failed === null;
        setProfileNoticeDismissed(dismissed || held);
        answered.current = { n: answered.current.n + 1, slug, generatedAt: route.generatedAt, dismissed };
        setNotOnRoute(loaded.notOnRoute);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take the route away — useFaq.ts. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  const dismissProfileNotice = useCallback(async () => {
    if (skim === null) return;
    /* Two presses in one tick: the button is gone on the next render, not this one. */
    if (dismissal.current?.slug === slug && dismissal.current.generatedAt === skim.generatedAt) return;
    const mine = { slug, generatedAt: skim.generatedAt, failed: null as string | null };
    dismissal.current = mine;
    setProfileNoticeDismissed(true);
    setDismissFailed(null);
    try {
      const body: SkimProfileNoticeDismissalRequest = { generatedAt: skim.generatedAt };
      const res = await apiFetch(`/api/skim/${encodeURIComponent(slug)}/profile-notice-dismissal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      /* A 204 has no body; anything else is a JSON sentence `readJson` throws. */
      if (!res.ok) await readJson(res);
    } catch (err) {
      mine.failed = describeFetchFailure(err as Error);
    }
    if (slugNow.current !== slug) {
      if (dismissal.current === mine) dismissal.current = null;
      return;
    }
    /* Either way, trail any read already out — it saw the route before the
       press — so the last word is a read made after the write. */
    const before = answered.current.n;
    await refresh();
    if (dismissal.current === mine) dismissal.current = null;
    if (mine.failed === null || slugNow.current !== slug) return;
    const after = answered.current;
    if (after.n === before) {
      /* No read answered: nothing confirms the write, so the banner is back. */
      setProfileNoticeDismissed(false);
      setDismissFailed({ slug, why: mine.failed });
    } else if (after.slug === slug && after.generatedAt === mine.generatedAt && !after.dismissed) {
      /* The read put the banner back; say why. Not for a replacement route
         (the 409), whose notice, if any, this press never saw. */
      setDismissFailed({ slug, why: mine.failed });
    }
  }, [skim, slug, refresh]);

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
    ideas.status === "none" || ideas.status === "error" || (ideas.status === "ready" && ideas.stale);
  const precededBy = useMemo<StepBefore<"skim">[]>(
    () => [...(quotesFirst ? (["quotes"] as const) : []), ...(ideasFirst ? (["ideas"] as const) : [])],
    [quotesFirst, ideasFirst],
  );
  const prerequisitesLoading = quotes.status === "loading" || ideas.status === "loading";
  /* **The forced run holds the route it was pressed on** (rewrite-hold.ts), as
     useFaq.ts § `regenerate` does. The route's clock is its identity: every run
     of the stage re-stamps it (src/skim.ts).

     **The hold is about this step's forced run and nothing before it.** It is
     keyed by `(slug, "skim")`, and it follows the one job the press made,
     prerequisites and all: a run that chose the Quotes first is held for the
     whole job. Failure or cancellation in a prerequisite ends it too. It
     holds neither the Quotes' nor the Ideas' own forced controls, which have
     holds of their own under their own steps, and neither of those holds this. `ensure` is
     never held: unforced, it is the request the server de-duplicates. */
  const hold = useRewriteHold({
    slug,
    step: "skim",
    identity: skim?.generatedAt ?? null,
    queue,
    fresh,
    refresh,
  });
  const held = hold.run;
  const startReady = useCallback(
    async (kind: "ensure" | "regenerate") => {
      const prerequisites = precededBy.length > 0 ? { precededBy } : {};
      if (kind === "ensure") await queue.start(prerequisites);
      /* Taken here and not in `regenerate`, so a press that waited for the
         prerequisite reads is held from the moment it is actually made. */
      else await held(() => queue.start({ force: true, ...prerequisites }));
    },
    [queue, precededBy, held],
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
    status === "none" && (quotes.status === "loading" || ideas.status === "loading")
      ? "loading"
      : status;
  const auto = useAutoRun(slug, "skim", gate, ensure, reload);

  return {
    status,
    skim,
    stale,
    outdated,
    profileChanged,
    profileNoticeDismissed,
    dismissFailed: dismissFailed?.slug === slug ? dismissFailed.why : null,
    dismissProfileNotice,
    notOnRoute,
    slug,
    error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting || waitingRun !== null,
    automatic: auto && (queue.job !== null || queue.starting || waitingRun !== null),
    quotesFirst,
    ideasFirst,
    retryRead,
    ensure,
    regenerate,
    rewriting: hold.rewriting,
    refresh,
    cancel: queue.cancel,
  };
}
