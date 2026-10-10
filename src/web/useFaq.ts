/**
 * The FAQ, as the reading view sees it: the questions a careful reader would put
 * to this piece, each with the passages where it responds; whether that still
 * describes the article; and the things you can ask for.
 *
 * `useReception`'s shape, because the artefact's contract is the same: one model
 * pass over the article, stored once, **replaced** on a re-run, and two
 * staleness facts — no profile is in this stage's stamp, so there is no
 * `profileChanged`.
 *
 * Mounted by `FaqBand` alone, never hoisted: nothing outside the band reads the
 * list (no marks in the prose in v1), and `useAutoRun`'s owner must die with the
 * band so a press cannot be spent after the reader has left it.
 *
 * The read half is `GET /api/faq/:slug`; the write half is a **job**
 * (docs/project/ingest-queue.md). The ordering of reads is
 * src/web/useOrderedRead.ts's, the job is src/web/useStepJob.ts's, and pressing
 * the mode with nothing there starts it through src/web/useAutoRun.ts — so this
 * file is only the parse, the 404 branch and the verbs.
 *
 * docs/project/faq.md, docs/plans/260916d-faq-mode.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Faq, FaqResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

type FaqStatus = "loading" | "none" | "ready" | "error";

export interface UseFaq {
  status: FaqStatus;
  faq: Faq | null;
  /** The article moved under these questions — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  slug: string;
  error: string | null;
  /** The job writing this article's FAQ, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /** The run in flight was started automatically. `UseReception.automatic`. */
  automatic: boolean;
  /**
   * Repeat the GET after a failed read. **It sends only a GET**; a press still
   * in hand is then honoured exactly as it would have been had the first read
   * answered — useAutoRun.ts § A failed read is not an answer.
   */
  retryRead(): Promise<void>;
  /**
   * **Write it if nobody has** — unforced, for the automatic run and for the
   * button beside the empty state. They have to be the same request or their
   * `work_key`s differ and the reader pays twice: useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /**
   * The forced run — the stale banner's button and Metadata's row. It replaces
   * the list. `faq` is in FORCE_ONLY_WHEN_NAMED (src/pipeline.ts), so forcing
   * it does not sweep in the steps before it.
   */
  regenerate(): Promise<void>;
  /**
   * The forced run was pressed on the list still on screen, and has neither
   * replaced it nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /** Read again, trailing a read in flight — `OrderedRead.refresh`. Never spends. */
  refresh(): Promise<void>;
  cancel(id: string): void;
}

/**
 * **The read half, alone** — the GET, its ordering and nothing else: no job, no
 * poll, no automatic run, so mounting it can never spend. Marginalia reads the
 * questions through this (src/web/marginalia/MarginaliaColumn.tsx §
 * `OwnerMarginFeed`); `useFaq` layers the job on it, as `useIdeas` does on
 * `useIdeasRead`. docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md.
 */
export interface FaqRead {
  status: FaqStatus;
  faq: Faq | null;
  stale: boolean;
  outdated: boolean;
  error: string | null;
  /** Repeat only the GET after a failed read. `UseFaq.retryRead`. */
  retryRead(): Promise<void>;
  /** Join a read in flight, or start one. `OrderedRead.reload`. */
  reload(): Promise<void>;
  /** Read again because the list has just changed. `OrderedRead.refresh`. */
  refresh(): Promise<void>;
  /** This read's bookkeeping for the forced verb's hold — rewrite-hold.ts § `FreshReads`. */
  fresh: FreshReads;
}

export function useFaqRead(slug: string): FaqRead {
  const [status, setStatus] = useState<FaqStatus>("loading");
  const [faq, setFaq] = useState<Faq | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  /**
   * The read itself. `current()` after every `await`, before any state is set:
   * false means this reply is about an article the hook has since moved on
   * from. src/web/useOrderedRead.ts.
   */
  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* The header asks for "none yet" as `200 null` rather than a 404, which
           a browser prints in red (`NONE_YET_AS_NULL_HEADER`, src/types.ts). A 404
           is still read the same way, for a server that has not heard of the
           header — the minutes of a deploy. */
        const res = await apiFetch(`/api/faq/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<FaqResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case, not a fault: nobody has asked for this
             article's FAQ yet, and the panel's button is for that. */
          setFaq(null);
          setStale(false);
          setOutdated(false);
          landed(started, res, null);
          setError(null);
          saidNoneFor.current = slug;
          setStatus("none");
          return;
        }
        /* Only an explicit `null` means none yet, and a reply without its
           artefact is published nowhere: a `MalformedReply`, so the reader gets
           `PAGE_FAULT` (tests/read-error-matrix.test.tsx) and what is on screen
           stays. */
        if (typeof loaded?.faq !== "object" || loaded.faq === null) {
          throw new MalformedReply("the FAQ reply has no FAQ");
        }
        setFaq(loaded.faq);
        landed(started, res, loaded.faq.generatedAt);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* **A failed revalidation must not take the list away** — `load` runs
           again every time a job finishes, and only the opening read has
           nothing to fall back on. Same guard as useReception.ts. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  /* An ordinary `reload` joins the read in flight, a post-job `refresh` trails
     it, and only the newest reply commits. src/web/useOrderedRead.ts. */
  const { reload, refresh } = useOrderedRead(load);

  /* A recovery control for the read itself: it sends only a GET. What that GET
     answers is then treated as the first read's answer would have been, so a
     404 with the reader's press still in hand starts the run the press asked
     for (unforced, once) — useAutoRun.ts § A failed read is not an answer. Keep
     an already loaded list on screen while a failed post-job revalidation is
     tried again; only the opening-error case returns to the loading sentence. */
  const retryRead = useCallback(async () => {
    setError(null);
    if (faq === null) setStatus("loading");
    await reload();
  }, [faq, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, faq, stale, outdated, error, retryRead, reload, refresh, fresh };
}

export function useFaq(slug: string): UseFaq {
  const read = useFaqRead(slug);
  const { status, reload, refresh } = read;

  /* `refresh`, not `reload`: a finished job has just written a new list, and a
     request already in flight read the old one. */
  const queue = useStepJob(slug, "faq", refresh, "watches-queue");

  /* Two verbs, split on `force`. useIdeas.ts has why. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  /* **The forced verb holds the list it was pressed on** (rewrite-hold.ts), as
     useIdeas.ts § `regenerate` does. The list's clock is its identity: a forced
     run replaces it and re-stamps it. */
  const hold = useRewriteHold({
    slug,
    step: "faq",
    identity: read.faq?.generatedAt ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* A press, never arrival, spends. `reload` is the way out of a failed read —
     useAutoRun.ts § A failed read is not an answer. */
  const auto = useAutoRun(slug, "faq", status, ensure, reload);

  return {
    status,
    faq: read.faq,
    stale: read.stale,
    outdated: read.outdated,
    slug,
    error: read.error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    rewriting: hold.rewriting,
    refresh,
    retryRead: read.retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
