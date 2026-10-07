/**
 * **Simple, as the owner's band sees it** — Summary's plain-words sub-mode: the
 * stored paragraphs, whether they still describe the article, and the verbs
 * that write them. docs/plans/260930i-simple-summaries-eli15-sub-mode.md.
 *
 * `useFaq`'s shape, because the artefact's contract is the same: model work over
 * the article, stored once, replaced on a re-run, and two staleness facts
 * — `stale` (the article moved: the panel says so) and `outdated` (an older
 * prompt: silent). The read half is `GET /api/simple/:slug`; the write half is
 * a job (`steps: ["simple"]`). Ordering is src/web/useOrderedRead.ts's, the job
 * src/web/useStepJob.ts's, and a press on a plain-words control with nothing
 * stored starts it through src/web/useAutoRun.ts — so this file is only the
 * parse, the 404 branch and the verbs.
 *
 * **Mounted only while Summary is on screen, and only for an owner**
 * (modes/summary/SummaryMode.tsx § `OwnerSimple`): `useAutoRun`'s owner must
 * die with the view so a press cannot be spent after the reader has left it,
 * and a visitor reads the paragraphs off the public payload with no hook at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSimpleParagraphs,
  NONE_YET_AS_NULL_HEADER,
  type Job,
  type SimpleParagraph,
  type SimpleSummary,
  type SimpleSummaryResponse,
} from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { type ArtefactStatus, useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { useFreshReads, useRewriteHold } from "./rewrite-hold.js";

export interface UseSimple {
  status: ArtefactStatus;
  simple: SimpleSummary | null;
  /** The article moved under these paragraphs. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  /** Written for a profile — derived from the artefact's `profileHash`, as `useIdeas` does. */
  profiled: boolean;
  /** The reader has changed their profile since. Never stale; it offers a rewrite. */
  profileChanged: boolean;
  slug: string;
  error: string | null;
  /** The job writing this article's Simple, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /**
   * A forced run was pressed on the paragraphs still on screen, and has neither
   * replaced them nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /**
   * **Brief, shown before anything is stored**: the paragraphs the running job
   * announced on its step (`JobStep.preview`, src/types.ts), or null. Null
   * whenever a summary is stored, so a rewrite never draws over the one on
   * screen. See `keptPreview` for how long it is held.
   */
  preview: SimpleParagraph[] | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /**
   * Read again because something it depends on has changed — the profile
   * panel's save, so `profileChanged` is the server's verdict on the new
   * profile. `OrderedRead.refresh`. Never spends. ProfilePanel.tsx § Regenerate.
   */
  refresh(): Promise<void>;
  /** **Write it if nobody has** — unforced, the automatic run's verb and the empty state's. */
  ensure(): Promise<void>;
  /** The forced run — the stale notice's button. It replaces the paragraphs. */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

/** A preview this hook has seen, and the job and article it came from. */
interface KeptPreview {
  slug: string;
  jobId: string;
  requeues: number;
  paragraphs: SimpleParagraph[];
}

/** Brief's paragraphs on a job's `simple` step, if the job is showing any that can be drawn. */
function briefPreviewOf(job: Job | null): SimpleParagraph[] | null {
  const step = job?.steps.find((step) => step.name === "simple");
  if (job?.status !== "running" || step?.status !== "running") return null;
  const preview = step.preview;
  if (preview?.kind !== "simple-brief") return null;
  /* The stored summary's own guard: off the wire, so checked before it is drawn. */
  return isSimpleParagraphs(preview.paragraphs, "brief") ? preview.paragraphs : null;
}

/**
 * **What the hook remembers of a preview, after this render's news.**
 *
 * The server keeps a preview on the job row only while the step runs, and the
 * job leaves `useStepJob` a render before the stored summary's read lands, or
 * for good when it fails. So the band cannot draw "the running job's preview":
 * it would blank between the job and the read, and a failed write would lose
 * the Brief the reader was already reading (GPT Sol's review of plan 261004f
 * stage 2, S3). The last one seen is held instead, with the id of its job:
 *
 * - **dropped once the stored summary has loaded**, which is the same Brief;
 * - **dropped when a different job or simple attempt becomes current** for
 *   this article, since a retry writes both levels again and its Brief may
 *   differ. A pause after simple finished keeps its words: only a later step
 *   will run in the new claim, and the summary still awaits publication;
 * - **dropped when the hook moves to another article**;
 * - kept otherwise, so it survives the job finishing or failing.
 *
 * In the page's memory only: after a reload a failed write shows its failure
 * without Brief. Returns `kept` itself when nothing changed, so the caller can
 * compare by identity.
 */
function keptPreview(
  kept: KeptPreview | null,
  slug: string,
  job: Job | null,
  stored: boolean,
): KeptPreview | null {
  if (stored) return null;
  const live = briefPreviewOf(job);
  if (job && live) {
    const requeues = job.requeues ?? 0;
    const same = kept?.slug === slug && kept.jobId === job.id && kept.requeues === requeues && kept.paragraphs === live;
    return same ? kept : { slug, jobId: job.id, requeues, paragraphs: live };
  }
  if (!kept || kept.slug !== slug) return null;
  if (job) {
    if (job.id !== kept.jobId) return null;
    const simpleFinished = job.steps.some((step) => step.name === "simple" && step.status === "done");
    if ((job.requeues ?? 0) !== kept.requeues && !simpleFinished) return null;
  }
  return kept;
}

export function useSimple(slug: string): UseSimple {
  const [status, setStatus] = useState<ArtefactStatus>("loading");
  const [simple, setSimple] = useState<SimpleSummary | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
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

  /* `current()` after every `await`, before any state is set: false means this
     reply is about an article the hook has since moved on from. */
  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        /* The header asks for "none yet" as `200 null` rather than a 404, which
           a browser prints in red (`NONE_YET_AS_NULL_HEADER`, src/types.ts). A 404
           is still read the same way, for a server that has not heard of the
           header — the minutes of a deploy. */
        const res = await apiFetch(`/api/simple/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<SimpleSummaryResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case: nobody has asked for one yet. */
          setSimple(null);
          setStale(false);
          setOutdated(false);
          setProfileChanged(false);
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
        if (typeof loaded?.simpleSummary !== "object" || loaded.simpleSummary === null) {
          throw new MalformedReply("the plain-words reply has no summary");
        }
        setSimple(loaded.simpleSummary);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setProfileChanged(loaded.profileChanged);
        landed(started, res, loaded.simpleSummary.generatedAt);
        setError(null);
        saidNoneFor.current = null;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
        /* A failed revalidation must not take the paragraphs away — only the
           opening read has nothing to fall back on. useFaq.ts, useDebate.ts. */
        setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
      }
    },
    [slug, begin, landed],
  );

  const { reload, refresh } = useOrderedRead(load);

  const retryRead = useCallback(async () => {
    setError(null);
    if (simple === null) setStatus("loading");
    await reload();
  }, [simple, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* `refresh`, not `reload`: a finished job has just written new paragraphs,
     and a request already in flight read the old ones. */
  const queue = useStepJob(slug, "simple", refresh, "watches-queue");

  /* Two verbs, split on `force` — useIdeas.ts § `ensure` has why they must not
     share one. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  /* The paragraphs' clock is their identity: a forced run re-stamps it. */
  const hold = useRewriteHold({
    slug,
    step: "simple",
    identity: simple?.generatedAt ?? null,
    queue,
    fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* A press — Summary on the bar, its command-bar rows, the slider or either
     end button — spends; arrival never does. */
  useAutoRun(slug, "simple", status, ensure, reload);

  /* Adjusted while rendering, not in an effect, so there is no render in which
     the job has gone and the preview has not yet been remembered. React runs
     the render again at once when the state moves; `keptPreview` hands back
     the same object when nothing has, which is what ends that. */
  const [kept, setKept] = useState<KeptPreview | null>(null);
  const preview = keptPreview(kept, slug, queue.job, status === "ready" && simple !== null);
  if (preview !== kept) setKept(preview);

  return {
    status,
    simple,
    stale,
    outdated,
    profiled: simple?.profileHash != null,
    profileChanged,
    slug,
    error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    rewriting: hold.rewriting,
    preview: preview?.paragraphs ?? null,
    retryRead,
    refresh,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
