/**
 * **The sources digest, as the reading view sees it** — the read half
 * (`GET /api/sources-digest/:slug`) and the press (the `sources-digest` job).
 * Plan docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § Stages, 2; the step is src/sources-digest.ts.
 *
 * `useSituate`'s shape, because the contract is the same: one paid run,
 * stored once, **replaced** on a re-run, two verbs split on `force`, and the
 * three staleness facts of an artefact written with the reader's profile
 * (`stale`, `outdated`, `profileChanged`).
 *
 * **Owner only.** Mounted by `DigestBand` (SourcesMode.tsx) and nowhere else;
 * a visitor's band never draws the digest and never asks (params.ts §
 * `visitorSourcesView`).
 *
 * **Opening it is the request, and only a press opens it.** The press on the
 * Digest chip or its command-bar row arms `sources-digest`
 * (activation.ts § `activationForSources`); `useAutoRun` spends that token
 * once, where nothing is stored. A pasted link, a reload, Back and Forward
 * arm nothing, so arriving starts nothing (docs/project/sources.md § Opening
 * it is the request). A stored digest, stale or outdated included, consumes
 * the press without a run: *Write it again* is the panel's own button
 * (`regenerate`). The press is judged against a job list newer than itself,
 * as *Where it sits*' is (useWhereAutoRun.ts § `useFreshQueueForActivation`),
 * so a digest another tab is already writing is waited on, not asked for
 * twice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Job, SourcesDigest, SourcesDigestResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { useFreshQueueForActivation } from "./useWhereAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type SourcesDigestStatus = "loading" | "none" | "ready" | "error";

/** The read half alone: the GET, its ordering, and nothing that could start a run. */
export interface SourcesDigestRead {
  status: SourcesDigestStatus;
  digest: SourcesDigest | null;
  /** The article moved after this was written. */
  stale: boolean;
  /** The article is the same and a run today would write this differently. */
  outdated: boolean;
  /** Written for a profile other than the reader's current one (or for none, when they now have one). */
  profileChanged: boolean;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  reload(): Promise<void>;
  /** Read again because the digest has just changed. Never spends. */
  refresh(): Promise<void>;
  fresh: FreshReads;
}

export interface UseSourcesDigest extends Omit<SourcesDigestRead, "reload" | "fresh"> {
  slug: string;
  /** The job writing this article's digest, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  stalled: boolean;
  /** The POST is not in the queue yet, or a finished job's fresh read has not landed. */
  starting: boolean;
  /** This mount started the run on a press (useAutoRun.ts), and it is still going. */
  automatic: boolean;
  /** **Write the digest if nobody has** — unforced; the automatic run's verb too. */
  ensure(): Promise<void>;
  /** **Write it again** — forced. Safe because the step replaces rather than appends. */
  regenerate(): Promise<void>;
  /** The forced run has neither replaced the digest nor failed. rewrite-hold.ts. */
  rewriting: boolean;
  cancel(id: string): void;
}

export function useSourcesDigestRead(slug: string): SourcesDigestRead {
  const [status, setStatus] = useState<SourcesDigestStatus>("loading");
  const [digest, setDigest] = useState<SourcesDigest | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /** The article the server has said "none yet" for — useReception.ts § `saidNoneFor`. */
  const saidNoneFor = useRef<string | null>(null);

  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* "None yet" as `200 null` rather than a red 404 — useReception.ts. */
        const res = await apiFetch(`/api/sources-digest/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<SourcesDigestResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          setDigest(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        if (typeof loaded?.sourcesDigest !== "object" || loaded.sourcesDigest === null) {
          throw new MalformedReply("the sources digest reply has no digest");
        }
        setDigest(loaded.sourcesDigest);
        landed(started, res, loaded.sourcesDigest.generatedAt);
        setStale(loaded.stale === true);
        setOutdated(loaded.outdated === true);
        setProfileChanged(loaded.profileChanged === true);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take a paid digest away —
           useReception.ts § the same guard. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (digest === null) setStatus("loading");
    await reload();
  }, [digest, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, digest, stale, outdated, profileChanged, error, retryRead, reload, refresh, fresh };
}

export function useSourcesDigest(slug: string): UseSourcesDigest {
  const read = useSourcesDigestRead(slug);
  const { refresh, reload } = read;

  /* `refresh`, not `reload`: a finished job has just written a new digest.
     Between the job leaving the queue and that read landing, the panel is
     still working — useSituate.ts § `landing`, for the same beat. */
  const [landing, setLanding] = useState<{ read: SourcesDigestRead["refresh"] } | null>(null);
  /* State holds the progress row across renders; this ref closes the smaller
     interval inside one passive-effect pass, where the queue announces a
     completion and `useAutoRun` still has the preceding render's `none`. */
  const landingNow = useRef<{ read: SourcesDigestRead["refresh"] } | null>(null);
  const finished = useCallback(() => {
    const mine = { read: refresh };
    landingNow.current = mine;
    setLanding(mine);
    void refresh().finally(() => {
      if (landingNow.current === mine) landingNow.current = null;
      setLanding((current) => (current === mine ? null : current));
    });
  }, [refresh]);
  const queue = useStepJob(slug, "sources-digest", finished, "watches-queue");

  /* The automatic run and the panel's own button make the identical unforced
     request, so `work_key` dedupes them — useReception.ts § Two verbs. */
  const ensure = useCallback(async () => {
    /* The completion effect can start `refresh` earlier in the same effect
       pass, before React rerenders `useAutoRun` away from its old `none`.
       Refuse at the action boundary too; state-only gating is one commit late. */
    if (landingNow.current?.read === refresh) return;
    await queue.start({});
  }, [queue, refresh]);
  /* The forced verb holds the digest it was pressed on (rewrite-hold.ts); its
     clock, `generatedAt`, is its identity. */
  const hold = useRewriteHold({
    slug,
    step: "sources-digest",
    identity: read.digest?.generatedAt ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* **Arrival never POSTs**: `useAutoRun` spends a press and only a press.
     A run already under way, from this tab or another, is not an answer yet:
     held at `loading` until it lands (useWhereAutoRun.ts § `searching`). */
  const freshQueue = useFreshQueueForActivation(slug, "sources-digest");
  /* A completion removes the job before its refresh can replace an earlier
     `none`. Keep a waiting press behind that read too, or another tab's
     completed run can be followed by a second paid request in the gap. */
  const working = queue.job !== null || queue.starting || landing?.read === refresh;
  const auto = useAutoRun(
    slug,
    "sources-digest",
    !freshQueue || working ? "loading" : read.status,
    ensure,
    reload,
  );

  return {
    status: read.status,
    digest: read.digest,
    stale: read.stale,
    outdated: read.outdated,
    profileChanged: read.profileChanged,
    slug,
    error: read.error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting || landing?.read === refresh,
    automatic: auto && working,
    rewriting: hold.rewriting,
    refresh,
    retryRead: read.retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
