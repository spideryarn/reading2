/**
 * **Start this article again** — the Metadata page's reset, stage 2 of
 * docs/plans/260928a-reset-and-regenerate-article.md.
 *
 * > perhaps the default is just to reset as if it had just been imported for
 * > the first time, and there's an option to regenerate any extra stuff that had
 * > been generated for the article with a queue
 * >
 * > — Greg, 2026-09-28 (relayed by the Overseer)
 *
 * One press is one `POST /api/article/:slug/reset` with `{ regenerate }` and
 * nothing else: the server decides which extras there are and queues them after
 * the reset publishes (src/reset.ts, src/routes.ts § the reset route). This file
 * is the control, the confirm, and the job it makes.
 *
 * ## Its own file, not another function in Metadata.tsx
 *
 * That file is past three and a half thousand lines and its body is at the edge
 * of a complexity budget (see `SharingSection` there). This is a whole control
 * with its own hook; `Metadata` draws the section heading and the experimental
 * gate, and hands this the slug, the metadata it already read, and `refresh`.
 *
 * ## Why the job comes through `useJobs`, not a fetch here
 *
 * **The browser is the worker** (docs/project/ingest-queue.md): the route
 * answers with an id, and the job runs only once this tab's engine has found it
 * and started `/advance` on it. `useJobs.reset` goes through `act`, whose
 * success pokes the engine — the same path every `POST /api/jobs` takes. A bare
 * `apiFetch` here would queue a reset that sat there, looking started, until
 * something else happened to poll.
 */
import { RotateCcw } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { jobWorthRetrying } from "../job-failure.js";
import { driverStalled } from "../job-state.js";
import { worthRetrying } from "../messages.js";
import type { ArticleMetadata, Job, StepName } from "../types.js";
import { Button } from "@/components/ui/button";
import { JobProgress } from "./JobProgress.js";
import { useJobs } from "./useJobs.js";
import type { StepFailure } from "./useStepJob.js";

/**
 * **What a reader calls each extra, and `null` for a step that is not one.**
 *
 * Exhaustive over `StepName`, so a new step is a compile error here until
 * somebody names it or says it is not an extra. The *which* is `RESET_ROLE` in
 * src/reset.ts, which the browser cannot import (it reaches the database
 * client); tests/reset-extra-names.test.ts holds the two to the same list.
 */
export const RESET_EXTRA_NAME: Record<StepName, string | null> = {
  fetch: null,
  extract: null,
  blocks: null,
  hierarchy: null,
  labels: null,
  assets: null,
  arc: "Arc",
  tweets: "Thread",
  glossary: "Glossary",
  quotes: "Quotes",
  ideas: "Ideas",
  timeline: "Timeline",
  quiz: "Quiz",
  faq: "FAQ",
  sketch: "Sketch",
  illustrated: "Illustrated",
  debate: "Debate",
  citations: "Citations",
};

/** `a, b and c` — the names are a list the reader reads, not a CSV. */
function listed(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Is this job a reset of this article? `reset` is on a job exactly when it is one (src/types.ts § Job). */
function isResetOf(job: Job, slug: string): boolean {
  return job.slug === slug && job.reset !== undefined;
}

/**
 * **The reset job for this article, as `useStepJob` would see it** — which it
 * cannot, because that hook finds its job by the step it writes, and a reset
 * writes `extract` like any re-read does. Matched on `reset` instead.
 *
 * The same four states, in the same order of precedence, and for the same
 * reasons — each is argued at length in src/web/useStepJob.ts and not repeated
 * here: `job` off the polled list (so another tab's reset shows), `starting`
 * for the gap between the POST and the poll that sees it, a failure kept
 * whether this mount started it or watched it, and the exact id we started
 * reconciled once in case it was already done when the list first carried it.
 */
function useResetJob(slug: string, onFinished: () => void) {
  const announced = useRef<Set<string>>(new Set());
  /** A reset of this article finished while this page was open. */
  const [finished, setFinished] = useState(false);
  const finish = useCallback(
    (id: string) => {
      announced.current.add(id);
      setFinished(true);
      onFinished();
    },
    [onFinished],
  );
  const announce = useCallback(
    (job: Job) => {
      if (isResetOf(job, slug)) finish(job.id);
    },
    [slug, finish],
  );
  const queue = useJobs("watches-queue", announce);

  /* Running first, then the oldest queued — `claim`'s order. */
  const job = useMemo(() => {
    const mine = queue.jobs.filter((j) => isResetOf(j, slug));
    const running = mine.find((j) => j.status === "running");
    if (running) return running;
    const queued = mine.filter((j) => j.status === "queued");
    queued.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
    return queued[0] ?? null;
  }, [queue.jobs, slug]);

  const [postFailure, setPostFailure] = useState<string | null | undefined>(undefined);
  const [watchedId, setWatchedId] = useState<string | null>(null);
  useEffect(() => {
    if (!job) return;
    setWatchedId(job.id);
    setPostFailure(undefined);
    setFinished(false);
  }, [job]);

  const startedId = useRef<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const id = startedId.current;
    if (id === null) return;
    const seen = queue.jobs.find((j) => j.id === id);
    if (!seen) return;
    setStarting(false);
    startedId.current = null;
    if (seen.status === "done" && !announced.current.has(id)) finish(id);
  }, [queue.jobs, finish]);

  /** The extras the server said it will make again, once the reset publishes. */
  const [regenerating, setRegenerating] = useState<StepName[]>([]);

  const start = useCallback(
    async (regenerate: boolean) => {
      setWatchedId(null);
      setFinished(false);
      setStarting(true);
      const answer = await queue.reset(slug, regenerate);
      if (answer) {
        setPostFailure(undefined);
        setRegenerating(answer.regenerate);
        setWatchedId(answer.jobId);
        startedId.current = answer.jobId;
        return;
      }
      /* The server's own sentence, taken now — `lastFailure` rather than
         `error`, which the poll this action's own poke starts would clear. */
      setPostFailure(queue.lastFailure());
      startedId.current = null;
      setStarting(false);
    },
    [queue, slug],
  );

  const stopped = watchedId ? queue.jobs.find((j) => j.id === watchedId) : undefined;
  const failed: StepFailure | null =
    postFailure !== undefined
      ? {
          message: postFailure ?? "Couldn't start again.",
          retryable: worthRetrying(postFailure),
          retry: null,
        }
      : stopped?.status === "error"
        ? {
            message: stopped.error ?? "The job failed.",
            retryable: jobWorthRetrying(stopped),
            retry: () => void queue.retry(stopped.id),
          }
        : stopped?.status === "cancelled"
          ? { message: "Stopped.", retryable: true, retry: () => void queue.retry(stopped.id) }
          : null;

  return {
    job,
    failed,
    stalled: job !== null && driverStalled(queue.driverFailures, job.id),
    starting: starting && job === null,
    finished,
    regenerating,
    start,
    cancel: (id: string) => void queue.cancel(id),
  };
}

/**
 * **What the confirm says**: three short parts — kept, lost or changed, cost —
 * because each answers a different question a reader has before pressing, and
 * one paragraph mixing them is the one they skim. Written for a reader, not as
 * a spec; each claim comes from the plan's § What it keeps, and what it can
 * lose and § What it costs to press.
 *
 * Its own component so `ResetArticle` stays under the complexity limit, and so
 * the whole of what the reader is told sits in one place.
 */
function ResetConfirm({
  names,
  lookUps,
  regenerate,
  retry,
  busy,
  yesRef,
  onYes,
  onCancel,
}: {
  /** The extras this article has now, by name. */
  names: string[];
  /** It has a glossary or citations, whose look-ups and finds hang off entry ids. */
  lookUps: boolean;
  /** The box is ticked and there is something to make again. */
  regenerate: boolean;
  /** Standing in front of a Retry rather than a first press. */
  retry: boolean;
  busy: boolean;
  yesRef: RefObject<HTMLButtonElement | null>;
  onYes: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div
      id="reset-confirm"
      className="tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3"
    >
      <h3 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
        Start this article again?
      </h3>
      <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">
        <strong className="tw:font-semibold tw:text-ink">Kept:</strong> your comments, highlights,
        notes, chat and reading time; the title you gave it; your saved searches and look-ups; the
        previous version (kept, not shown).
      </p>
      <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">
        <strong className="tw:font-semibold tw:text-ink">Lost or changed:</strong>{" "}
        {names.length > 0 ? `${listed(names)}, until they are made again. ` : null}A paragraph whose
        text comes out different gets a new place, so a comment on it moves to the end of Comments
        as “no longer in this version”. This mostly happens to paragraphs with maths, in articles
        added before maths was drawn properly.
        {lookUps
          ? " Glossary look-ups and found papers stop showing beside entries that are made again."
          : null}
      </p>
      <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">
        <strong className="tw:font-semibold tw:text-ink">Cost:</strong> reading it again is usually
        free (a PDF costs one small model call); the paragraph labels and the article's arc are
        made again.
        {regenerate
          ? " Making the extras again is roughly one model call for each, like opening each one."
          : null}
      </p>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button
          type="button"
          ref={yesRef}
          variant="outline"
          size="sm"
          disabled={busy}
          /* The whole panel, so a reader who reaches Yes by keyboard hears what
             it is agreeing to — `RerunRow`'s F13, Metadata.tsx. */
          aria-describedby="reset-confirm"
          onClick={() => void onYes()}
        >
          {busy ? "Starting…" : retry ? "Yes, try again" : "Yes, start again"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The card: what it does, the checkbox, the button — and, after one press, the
 * confirm that says what is kept, what is lost, and what it costs.
 *
 * **Two clicks, inline, no `window.confirm`** — the pattern `RerunRow` in
 * Metadata.tsx uses and argues for, and the panel is `AccessSharing`'s confirm,
 * because this one has three things to say and not one sentence. A Retry after a
 * failure resets again, so it asks too, as `RerunRow`'s does.
 */
export function ResetArticle({
  slug,
  provenance,
  onFinished,
}: {
  slug: string;
  /** Null until the metadata request lands; the extras are read off its stages. */
  provenance: ArticleMetadata | null;
  /** `refresh`, never `reload` — see `RerunSection` in Metadata.tsx. */
  onFinished: () => void;
}) {
  const { job, failed, stalled, starting, finished, regenerating, start, cancel } = useResetJob(
    slug,
    onFinished,
  );
  const [again, setAgain] = useState(false);
  const [pending, setPending] = useState<null | "run" | "retry">(null);
  const [busy, setBusy] = useState(false);

  /* A confirm may not outlive the state it was opened over — `RerunRow`'s
     `obsolete`, for the same two reasons. */
  const obsolete =
    pending !== null && (job !== null || (pending === "retry" && !failed?.retry));
  useEffect(() => {
    if (obsolete) setPending(null);
  }, [obsolete]);
  const asking = obsolete ? null : pending;

  const yesRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (asking) yesRef.current?.focus();
  }, [asking]);

  /* Which extras this article has now, in pipeline order — `stages` is already
     in `STEP_ORDER`. The server makes its own list from the revision when the
     press lands; this one is for the words. */
  const extras = (provenance?.stages ?? [])
    .filter((stage) => stage.done && RESET_EXTRA_NAME[stage.step] !== null)
    .map((stage) => stage.step);
  const names = extras.map((step) => RESET_EXTRA_NAME[step] ?? step);
  const regenerate = again && extras.length > 0;
  const lookUps = extras.includes("glossary") || extras.includes("citations");

  const failedAsking = failed?.retry ? { ...failed, retry: () => setPending("retry") } : failed;

  return (
    <div data-reset className="tw:flex tw:flex-col tw:gap-3 tw:text-sm">
      <p className="tw:m-0 tw:text-muted-foreground">
        Reads our stored copy of this article again with today's pipeline, as if you had just added
        it, and removes what the modes made for it.
      </p>

      {names.length > 0 ? (
        <label className="tw:flex tw:items-start tw:gap-2 tw:text-foreground">
          <input
            type="checkbox"
            className="tw:mt-[0.2rem] tw:[accent-color:var(--highlight)]"
            checked={again}
            disabled={busy || job !== null}
            onChange={(e) => setAgain(e.target.checked)}
          />
          <span>Also make these again, one after another: {listed(names)}.</span>
        </label>
      ) : null}

      {asking ? (
        <ResetConfirm
          names={names}
          lookUps={lookUps}
          regenerate={regenerate}
          retry={asking === "retry"}
          busy={busy}
          yesRef={yesRef}
          onYes={async () => {
            setBusy(true);
            if (asking === "retry") failed?.retry?.();
            else await start(regenerate);
            setBusy(false);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      ) : (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <JobProgress
            job={job}
            starting={starting}
            failed={failedAsking}
            stalled={stalled}
            /* Opens the confirm rather than starting anything. */
            onRun={async () => setPending("run")}
            onCancel={cancel}
            label="Start again"
            step="extract"
            icon={<RotateCcw size={13} />}
            about="this article"
            runningLabel="Reading the article again"
          />
        </div>
      )}

      {job !== null && regenerating.length > 0 ? (
        <p role="status" className="tw:m-0 tw:text-xs tw:text-ink-faint">
          Then, one after another: {listed(regenerating.map((s) => RESET_EXTRA_NAME[s] ?? s))}.
        </p>
      ) : null}

      {/* **The article on this tab is the old one.** It is fetched once for all
          three views (article/ArticlePage.tsx) and nothing refetches it, so the
          reading view one click away still holds the text from before the
          reset. Saying so, with the one press that fixes it, beats a reader
          finding their way back to a page that has quietly not changed. */}
      {finished && job === null ? (
        <p role="status" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <span className="tw:text-foreground">Done. Reload the page to read the new version.</span>
          <Button type="button" variant="outline" size="xs" onClick={() => location.reload()}>
            Reload
          </Button>
        </p>
      ) : null}
    </div>
  );
}
