/**
 * **The explanations, as the reading view sees them**: the places the model
 * expected this reader to get stuck, each with the missing piece; whether they
 * still describe the article and the reader; and the things you can ask for.
 *
 * `useIdeas`' shape, with Quotes' and Glossary's second verb: one model pass
 * over the article, stored once, and three staleness facts — the reader's
 * profile is in this stage's stamp, so there is a `profileChanged` as well as
 * `stale` and `outdated`. A forced run **appends** (*Find more*) when the list
 * is current and for the same profile, and **rewrites** otherwise; the server
 * says which, as `panelRun` (src/explanations.ts § `existingFor`, plan
 * 261029e).
 *
 * The read half is `GET /api/explanations/:slug` (owner only — there is no
 * public projection); the write half is a **job**, `steps: ["explanations"]`.
 * The ordering of reads is src/web/useOrderedRead.ts's, the job is
 * src/web/useStepJob.ts's, and pressing the mode with nothing there starts it
 * through src/web/useAutoRun.ts — never arriving, never import. So this file is
 * only the parse, the "none yet" branch and the verbs.
 *
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Explanations, ExplanationsResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

type ExplanationsStatus = "loading" | "none" | "ready" | "error";

/**
 * **The read alone** — the GET and what it said, and no job machinery: no
 * `useStepJob`, no `useAutoRun`, no verb that spends. Marginalia reads the
 * explanations through this (MarginaliaColumn.tsx § `OwnerMarginFeed`), so
 * mounting the margin can never be the reason one is written. `useIdeasRead`
 * is the model.
 */
export interface ExplanationsRead {
  status: ExplanationsStatus;
  explanations: Explanations | null;
  /** The article moved under these — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and the current prompt would write these differently. */
  outdated: boolean;
  /** These were written from a reader profile at all. */
  profiled: boolean;
  /** ...and that profile is no longer the reader's. Who is reading decides what is confusing. */
  profileChanged: boolean;
  /**
   * What the band's run button will do — the server's `panelRun`, from the
   * same `existingFor` the step asks. Null before a list, or from a server
   * that did not say (the panel then reads it conservatively).
   */
  panelRun: "append" | "rewrite" | null;
  /** Which reads the server itself answered — rewrite-hold.ts § `FreshReads`. */
  fresh: FreshReads;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /** Join a read in flight, or start one. `OrderedRead.reload`. */
  reload(): Promise<void>;
  /** Read again because the list has just changed. `OrderedRead.refresh`. */
  refresh(): Promise<void>;
}

export interface UseExplanations extends Omit<ExplanationsRead, "fresh" | "reload"> {
  /** The article this band is about — the profile badge links to its half of the profile. */
  slug: string;
  /** The job writing this article's explanations, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /** `StepJob.loaded`: false until the first job poll, while whether a run exists is unknown. */
  loaded: boolean;
  /**
   * A forced run was pressed on the list still on screen, and has neither
   * replaced it nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /**
   * **Write them if nobody has** — unforced, for the automatic run and for the
   * button beside the empty state. They must be the same request or their
   * `work_key`s differ and the reader pays twice: useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /**
   * **The forced run** — the band's one run button, *Find more* or *Write a
   * new list*, and the profile panel's Regenerate. It **appends** when the
   * server's `existingFor` accepts the list and **rewrites** otherwise.
   * `explanations` is in FORCE_ONLY_WHEN_NAMED (src/pipeline.ts), so forcing
   * it does not sweep in the steps before it.
   *
   * @param useProfile defaults to true. **Find more passes the list's own
   *   `profiled`** (useGlossary.ts § `more`), so a plain list is extended
   *   plainly rather than rewritten for the profile — `existingFor` refuses to
   *   merge across a profile difference.
   */
  more(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

/**
 * **Everything that arrives with the list, as one value**, so the facts about
 * it cannot outlive it — useIdeas.ts § `IdeasAnswer`.
 */
interface ExplanationsAnswer {
  explanations: Explanations;
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
  panelRun: "append" | "rewrite" | null;
}

export function useExplanationsRead(slug: string): ExplanationsRead {
  const [status, setStatus] = useState<ExplanationsStatus>("loading");
  const [answer, setAnswer] = useState<ExplanationsAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /**
   * The article the server has said "none yet" for. A failed read after that
   * answer — a failed *Try again* included — ends at `none`, not `error`, so
   * the empty state's button stays (Greg, 2026-10-07; docs/project/mode.md §
   * The artefact, if the mode shows one). Keyed by slug.
   */
  const saidNoneFor = useRef<string | null>(null);

  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* "None yet" as `200 null` rather than a 404 (`NONE_YET_AS_NULL_HEADER`,
           src/types.ts); a 404 is still read the same way for a server that has
           not heard of the header. */
        const res = await apiFetch(`/api/explanations/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<ExplanationsResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case, not a fault: nobody has asked for them yet. */
          setAnswer(null);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        /* Only an explicit `null` means none yet; a reply without its
           artefact is a `MalformedReply` (tests/read-error-matrix.test.tsx). */
        if (
          typeof loaded?.explanations !== "object" ||
          loaded.explanations === null ||
          !Array.isArray(loaded.explanations.explanations)
        ) {
          throw new MalformedReply("the explanations reply has no explanations");
        }
        setAnswer({
          explanations: loaded.explanations,
          stale: loaded.stale,
          outdated: loaded.outdated,
          /* `!= null`: only `null` and absent mean "written without one". */
          profiled: loaded.explanations.profileHash != null,
          profileChanged: loaded.profileChanged,
          panelRun: loaded.panelRun ?? null,
        });
        landed(started, res, loaded.explanations.generatedAt);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* **A failed revalidation must not take the list away** — useIdeas.ts. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  /* The way out of a failed read, and never a generation verb — useFaq.ts §
     `retryRead`. */
  const retryRead = useCallback(async () => {
    setError(null);
    if (answer === null) setStatus("loading");
    await reload();
  }, [answer, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    status,
    explanations: answer?.explanations ?? null,
    stale: answer?.stale ?? false,
    outdated: answer?.outdated ?? false,
    profiled: answer?.profiled ?? false,
    profileChanged: answer?.profileChanged ?? false,
    panelRun: answer?.panelRun ?? null,
    fresh,
    error,
    retryRead,
    reload,
    refresh,
  };
}

export function useExplanations(slug: string): UseExplanations {
  const read = useExplanationsRead(slug);
  const { status, reload, refresh } = read;

  /* `refresh`, not `reload`: a finished job has just written a new list. */
  const queue = useStepJob(slug, "explanations", refresh, "watches-queue");

  /* Two verbs, split on `force` — useIdeas.ts has why. */
  const ensure = useCallback(async () => {
    await queue.start();
  }, [queue]);
  /* The list's clock is its identity: a forced run re-stamps it, whether it
     rewrote or appended — even a *Find more* that found nothing
     (src/explanations.ts § `buildExplanations`). */
  const hold = useRewriteHold({
    slug,
    step: "explanations",
    identity: read.explanations?.generatedAt ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });
  const held = hold.run;
  const more = useCallback(
    async (useProfile = true) => {
      await held(() => queue.start({ force: true, useProfile }));
    },
    [queue, held],
  );

  /* A press, never arrival, spends. `reload` is the way out of a failed read —
     useAutoRun.ts § A failed read is not an answer. */
  useAutoRun(slug, "explanations", status, ensure, reload);

  return {
    status,
    explanations: read.explanations,
    stale: read.stale,
    outdated: read.outdated,
    profiled: read.profiled,
    profileChanged: read.profileChanged,
    panelRun: read.panelRun,
    slug,
    error: read.error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    loaded: queue.loaded,
    rewriting: hold.rewriting,
    ensure,
    more,
    refresh,
    retryRead: read.retryRead,
    cancel: queue.cancel,
  };
}
