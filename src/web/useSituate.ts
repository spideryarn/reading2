/**
 * **Where the piece sits in the literature, as the reading view sees it** —
 * the read half (`GET /api/situate/:slug`) and the press (the `situate` job).
 * Plan docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § Stages, 2; the step is src/situate.ts.
 *
 * `useReception`'s shape, because the contract is the same: one paid run,
 * stored once, **replaced** on a re-run, two verbs split on `force`. Three
 * staleness facts rather than Reception's two, because the read is written
 * with the reader's profile (ranking and the questions): `stale`, `outdated`
 * and `profileChanged`.
 *
 * **Owner only.** `SourcesBand` mounts it in *Where it sits* for every owner
 * (and in Investigate for the dossier's suggested questions); a visitor never
 * asks. The dossier left the experimental switch in plan 261025h.
 *
 * **Nothing here spends on arrival.** There is no `useAutoRun` in this hook,
 * which Investigate mounts too. Since plan 261026g a press that lands on
 * *Where it sits* is the request (useWhereAutoRun.ts, the composite
 * `sources-where` target, owned by that band alone), and since plan 261029h
 * so is the press that turns the margin on (`useMarginLiteratureAutoRun`, the
 * `margin-literature` target, owned by the margin's feed alone); otherwise the
 * way in is the section's own button, *Search the literature*, which calls
 * `ensure`.
 *
 * The read half is exported alone (`useSituateRead`) for the surfaces that
 * must read and never start — Sources' experiments: the same split as
 * `useReceptionRead`. The margin's notes used it until plan 261029h.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCompletionLanding } from "./useCompletionLanding.js";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Job, Situate, SituateResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import type { QueueCadence } from "./useJobs.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type SituateStatus = "loading" | "none" | "ready" | "error";

/** The read half alone: the GET, its ordering, and nothing that could start a run. */
export interface SituateRead {
  status: SituateStatus;
  situate: Situate | null;
  /** The article moved after this was searched. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  /** Written for a profile other than the reader's current one (or for none, when they now have one). */
  profileChanged: boolean;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /** Join a read in flight, or start one. `OrderedRead.reload`. */
  reload(): Promise<void>;
  /** Read again because the dossier has just changed. `OrderedRead.refresh`. Never spends. */
  refresh(): Promise<void>;
  /** This read's bookkeeping for the forced verb's hold — rewrite-hold.ts § `FreshReads`. */
  fresh: FreshReads;
}

export interface UseSituate extends Omit<SituateRead, "reload" | "fresh"> {
  /** The article this is about. */
  slug: string;
  /** The job searching the literature for this article, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** The POST is not in the queue yet, or a finished job's fresh read has not landed. */
  starting: boolean;
  /**
   * **Search the literature if nobody has** — unforced, for *Search the
   * literature*. A dossier already current makes the server skip the run.
   * `withBibliography` lists the works the piece cites first, in the same job
   * (`precededBy`), for *Where it sits*' press when both are missing
   * (useWhereAutoRun.ts): one press, one request.
   */
  ensure(options?: { withBibliography?: boolean }): Promise<void>;
  /**
   * **Search again** — forced (`force: ["situate"]`), for the button at the
   * dossier's foot and in the stale banner. Safe to force because the step
   * replaces rather than appends.
   */
  regenerate(): Promise<void>;
  /** The forced run has neither replaced the dossier nor failed. rewrite-hold.ts. */
  rewriting: boolean;
  cancel(id: string): void;
}

/**
 * **One unforced Situate POST at a time per article in this tab.** Sources and
 * Marginalia own separate activation tokens and separate `useSituate` mounts.
 * `StepJob.starting` belongs to one mount, so the other cannot see the interval
 * after its POST left and before the job list contains the returned row. Keep
 * that interval here, at the operation both mounts share.
 *
 * The promise carries success so a second press waiting behind a failed POST
 * still gets its own try. Calls arriving together after that failure contend
 * here again; one retries and the rest join it. A successful first POST is the
 * whole operation, regardless of which prelude its caller chose.
 */
const situateStarts = new Map<string, Promise<boolean>>();
const situateStartListeners = new Set<() => void>();

function announceSituateStarts(): void {
  for (const listener of situateStartListeners) listener();
}

function subscribeSituateStarts(listener: () => void): () => void {
  situateStartListeners.add(listener);
  return () => situateStartListeners.delete(listener);
}

async function startSituateOnce(slug: string, start: () => Promise<string | null>): Promise<void> {
  const existing = situateStarts.get(slug);
  if (existing) {
    if (await existing) return;
    /* The first POST failed. This caller's press still deserves its own try,
       through the same atomic map in case more than one caller was waiting. */
    return startSituateOnce(slug, start);
  }

  const mine = start().then((id) => id !== null);
  situateStarts.set(slug, mine);
  announceSituateStarts();
  try {
    await mine;
  } finally {
    if (situateStarts.get(slug) === mine) {
      situateStarts.delete(slug);
      announceSituateStarts();
    }
  }
}

export function useSituateRead(slug: string): SituateRead {
  const [status, setStatus] = useState<SituateStatus>("loading");
  const [situate, setSituate] = useState<Situate | null>(null);
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
        const res = await apiFetch(`/api/situate/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<SituateResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case: nobody has pressed Search the literature. */
          setSituate(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        if (typeof loaded?.situate !== "object" || loaded.situate === null) {
          throw new MalformedReply("the Situate reply has no dossier");
        }
        setSituate(loaded.situate);
        landed(started, res, loaded.situate.generatedAt);
        setStale(loaded.stale === true);
        setOutdated(loaded.outdated === true);
        setProfileChanged(loaded.profileChanged === true);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take a paid dossier away —
           useReception.ts § the same guard. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (situate === null) setStatus("loading");
    await reload();
  }, [situate, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, situate, stale, outdated, profileChanged, error, retryRead, reload, refresh, fresh };
}

/**
 * `cadence` is `useStepJob`'s: the band's default watches the queue; the
 * margin's feed passes `"quiet"`, so a margin left open does not poll every
 * eight seconds (GPT Sol's MARGIN-3 on plan 261029h). A job it starts still
 * wakes the engine, so its progress and completion are heard either way.
 */
export function useSituate(slug: string, cadence: QueueCadence = "watches-queue"): UseSituate {
  const read = useSituateRead(slug);
  const { refresh } = read;

  /* `refresh`, not `reload`: a finished job has just written a new dossier.
     Between the job leaving the queue and that read landing, the section is
     still working: without `landing` it drew the before-run press for a beat
     (stage 4's browser run), and an automatic press could buy a second search
     (GPT Sol's SD2-02 on plan 261030b). useCompletionLanding.ts, shared with
     useSourcesDigest.ts. */
  const { finished, landing, isLanding } = useCompletionLanding(refresh);
  const queue = useStepJob(slug, "situate", finished, cadence);

  const readSharedStart = useCallback(() => situateStarts.has(slug), [slug]);
  const sharedStarting = useSyncExternalStore(subscribeSituateStarts, readSharedStart, readSharedStart);

  const ensure = useCallback(
    async (options: { withBibliography?: boolean } = {}) => {
      /* A completion announced earlier in this effect pass: *Where it sits*'
         and the margin's auto-run still hold the render's old `none`. */
      if (isLanding()) return;
      await startSituateOnce(slug, () =>
        queue.start(options.withBibliography ? { precededBy: ["bibliography"] } : {}),
      );
    },
    [queue, slug, isLanding],
  );
  /* The forced verb holds the dossier it was pressed on (rewrite-hold.ts); its
     clock, `generatedAt`, is its identity. */
  const hold = useRewriteHold({
    slug,
    step: "situate",
    identity: read.situate?.generatedAt ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  return {
    status: read.status,
    situate: read.situate,
    stale: read.stale,
    outdated: read.outdated,
    profileChanged: read.profileChanged,
    slug,
    error: read.error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting || sharedStarting || landing,
    rewriting: hold.rewriting,
    refresh,
    retryRead: read.retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
