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
 * with its own hook; `Metadata` draws the row's chip and name and the
 * experimental gate, and hands this the slug, the metadata it already read, and `refresh`.
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
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { jobWorthRetrying } from "../job-failure.js";
import { driverStalled } from "../job-state.js";
import { worthRetrying } from "../messages.js";
import { METADATA_RERUN_STEPS } from "../rerun-steps.js";
import { extraSteps, isExtra, type ExtraStep } from "../reset-role.js";
import type { ArticleMetadata, Job, StepName } from "../types.js";
import { Button } from "@/components/ui/button";
import { JobProgress } from "./JobProgress.js";
import { useJobs } from "./useJobs.js";
import { SKETCH_WAIT } from "./sketch-cost.js";
import type { StepFailure } from "./useStepJob.js";

/**
 * **What a reader calls each extra.**
 *
 * Only the names live here. *Which* steps are extras is `RESET_ROLE` in
 * src/reset-role.ts — the same leaf the server acts on — and this map is keyed
 * by the `ExtraStep` read off it, so a new extra is a compile error here until
 * somebody names it, and a step that stops being one is an excess key.
 */
export const RESET_EXTRA_NAME: Record<ExtraStep, string> = {
  arc: "Arc",
  tweets: "Thread",
  glossary: "Glossary",
  quotes: "Quotes",
  skim: "Skim",
  ideas: "Ideas",
  timeline: "Timeline",
  quiz: "Quiz",
  faq: "FAQ",
  sketch: "Sketch",
  illustrated: "Illustrated",
  debate: "Debate",
  citations: "Citations",
  crossrefs: "Cross-references",
  simple: "Simple summary",
};

/** A step's reader-facing name if it is an extra, and its step name otherwise. */
function extraName(step: StepName): string {
  return isExtra(step) ? RESET_EXTRA_NAME[step] : step;
}

/** Extras with no row of their own in Metadata's *AI processing* section. */
const METADATA_RERUN_STEP_SET = new Set<StepName>(METADATA_RERUN_STEPS);
const RESET_ONLY_PROGRESS = extraSteps().filter((step) => !METADATA_RERUN_STEP_SET.has(step));
const RESET_ONLY_PROGRESS_SET = new Set<StepName>(RESET_ONLY_PROGRESS);

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
 * The reset successor this row can be, from the facts carried on `Job`.
 *
 * Publication inserts every regeneration in the same transaction that marks
 * the reset done: successor i gets `finishedAt + (i + 1) microseconds`
 * (src/store/pg-revisions.ts). The wire preserves milliseconds, so the allowed
 * window is the plan length rounded up from microseconds to milliseconds.
 * Requiring that transaction-sized window is what distinguishes a successor
 * from an ordinary run of the same step five minutes or five days later; step
 * overlap alone cannot.
 *
 * This is not a durable parent id: the reset scope is folded into the work-key
 * hash but is not stored on or serialised with the successor. An independently
 * queued, same-step, same-profile job in this same millisecond is therefore
 * indistinguishable here. Carrying the parent id would close that last ambiguity,
 * but is a server/store contract change rather than a client recovery fix.
 */
function resetSuccessorStep(reset: Job, candidate: Job): ExtraStep | null {
  if (reset.status !== "done" || !reset.finishedAt || candidate.reset !== undefined) return null;
  if (candidate.slug !== reset.slug || candidate.steps.length !== 1) return null;
  if ((candidate.profile ?? "") !== (reset.reset?.profile ?? "")) return null;
  const step = candidate.steps[0]?.name;
  if (!step || !isExtra(step) || !reset.reset?.regenerate.includes(step)) return null;
  const finished = Date.parse(reset.finishedAt);
  const created = Date.parse(candidate.createdAt);
  if (!Number.isFinite(finished) || !Number.isFinite(created)) return null;
  const windowMs = Math.ceil(reset.reset.regenerate.length / 1000);
  return created >= finished && created <= finished + windowMs ? step : null;
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
  /** The server's plan, not the checkbox's guess. */
  const [regenerating, setRegenerating] = useState<StepName[]>([]);
  const rememberRegenerating = useCallback((steps: StepName[]) => setRegenerating(steps), []);
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
      if (job.slug !== slug) return;
      if (isResetOf(job, slug)) {
        rememberRegenerating(job.reset?.regenerate ?? []);
        finish(job.id);
        return;
      }
      /* Existing rerun rows announce their own steps. These are the extras
         with no such row, whether they came from a reset or another tab. Keeping
         the sets disjoint avoids turning one completion into a trailing second
         metadata read in useOrderedRead. */
      if (job.steps.some((step) => RESET_ONLY_PROGRESS_SET.has(step.name))) onFinished();
    },
    [slug, finish, onFinished, rememberRegenerating],
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

  /**
   * Recover only the reset that could have minted an active successor. The
   * timestamp/profile/one-step checks in `resetSuccessorStep` are the missing
   * identity: "a later job happens to run FAQ" is not enough.
   */
  const recoveredReset = useMemo<Job | null>(() => {
    if (job) return null;
    let source: Job | null = null;
    for (const candidate of queue.jobs) {
      if (!isResetOf(candidate, slug) || candidate.status !== "done") continue;
      const hasActiveSuccessor = queue.jobs.some(
        (successor) =>
          (successor.status === "queued" || successor.status === "running") &&
          resetSuccessorStep(candidate, successor) !== null,
      );
      if (!hasActiveSuccessor) continue;
      if (!source || candidate.createdAt > source.createdAt) source = candidate;
    }
    return source;
  }, [job, queue.jobs, slug]);

  useEffect(() => {
    if (!recoveredReset) return;
    rememberRegenerating(recoveredReset.reset?.regenerate ?? []);
    setWatchedId(recoveredReset.id);
  }, [recoveredReset, rememberRegenerating]);

  useEffect(() => {
    if (!job) return;
    rememberRegenerating(job.reset?.regenerate ?? []);
    setWatchedId(job.id);
    setPostFailure(undefined);
    setFinished(false);
  }, [job, rememberRegenerating]);

  const startedId = useRef<string | null>(null);
  /* A Retry's single-flight latch — `inFlight` in src/web/useStepJob.ts, for
     the same reason: two presses of *Yes, try again* can reach `retry` before
     React commits `starting`. Held until the new job is in the list, as
     `starting` is; a refusal releases it. */
  const inFlight = useRef(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const id = startedId.current;
    if (id === null) return;
    const seen = queue.jobs.find((j) => j.id === id);
    if (!seen) return;
    setStarting(false);
    inFlight.current = false;
    startedId.current = null;
    if (seen.status === "done" && !announced.current.has(id)) finish(id);
  }, [queue.jobs, finish]);

  const start = useCallback(
    async (regenerate: boolean) => {
      setWatchedId(null);
      setFinished(false);
      setStarting(true);
      const answer = await queue.reset(slug, regenerate);
      if (answer) {
        setPostFailure(undefined);
        rememberRegenerating(answer.regenerate);
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
    [queue, slug, rememberRegenerating],
  );

  /**
   * **A Retry holds *Starting…* across its round trip** — `retry` in
   * src/web/useStepJob.ts, copied. It was `void queue.retry(id)` until
   * 2026-10-01, so the confirm closed onto the old failure and its Retry until
   * a poll found the new job, and a second press sent a second retry. The
   * server collapses a duplicate reset, so this was untidy rather than costly
   * (GPT Sol's code review of 260930e, P3). The new job becomes the watched
   * one, as a started reset does; on a refusal the old failure comes back.
   */
  const retry = useCallback(
    async (id: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStarting(true);
      const next = await queue.retry(id);
      if (next) {
        setPostFailure(undefined);
        setWatchedId(next.id);
        startedId.current = next.id;
        return;
      }
      inFlight.current = false;
      setStarting(false);
    },
    [queue],
  );

  const stopped = watchedId ? queue.jobs.find((j) => j.id === watchedId) : undefined;
  const watchedReset = stopped && isResetOf(stopped, slug) ? stopped : null;
  const successorSource = job ?? watchedReset ?? recoveredReset;
  const regenerationJobs = useMemo(
    () =>
      successorSource
        ? queue.jobs.filter((candidate) => resetSuccessorStep(successorSource, candidate) !== null)
        : [],
    [queue.jobs, successorSource],
  );
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
            retry: () => void retry(stopped.id),
          }
        : stopped?.status === "cancelled"
          ? { message: "Stopped.", retryable: true, retry: () => void retry(stopped.id) }
          : null;

  return {
    job,
    failed,
    stalled: job !== null && driverStalled(queue.driverFailures, job.id),
    starting: starting && job === null,
    finished,
    regenerating,
    regenerationJobs,
    regenerationStalled: (id: string) => driverStalled(queue.driverFailures, id),
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
  extras,
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
  /** The same extras by server step name, for the exceptional costs. */
  extras: StepName[];
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
  const detailsId = useId();
  return (
    <fieldset
      className="tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3"
    >
      <legend className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
        Start this article again?
      </legend>
      <div id={detailsId}>
        <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">
          <strong className="tw:font-semibold tw:text-ink">Kept:</strong> your comments, highlights,
          bookmarks, notes, chat and reading time; the title you gave it; your shelf and sharing
          settings; your saved searches and look-ups; the previous version (kept, not shown).
        </p>
        <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">
          <strong className="tw:font-semibold tw:text-ink">Lost or changed:</strong>{" "}
          {names.length > 0 ? `${listed(names)}, until they are made again. ` : null}A paragraph
          whose text comes out different gets a new place, so a comment on it moves to the end of
          Comments as “no longer in this version”. This mostly happens to paragraphs with maths in
          older articles; a PDF can also come back slightly differently.
          {lookUps
            ? " Glossary look-ups and found papers stop showing beside entries that are made again."
            : null}
        </p>
        <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">
          <strong className="tw:font-semibold tw:text-ink">Cost:</strong> the article's structure
          and paragraph labels may be worked out again (a few model calls, and a few minutes on a
          long piece); a PDF also costs one small call to re-read. The article's arc costs another
          model call when you next open the reading view.
          {regenerate ? " Most extras cost roughly one model call each." : null}
          {regenerate && extras.includes("debate") ? " Debate uses two." : null}
          {regenerate && extras.includes("sketch") ? ` Sketch takes ${SKETCH_WAIT}.` : null}
          {regenerate && extras.includes("illustrated")
            ? " Illustrated uses a brief plus one image call per plate."
            : null}
        </p>
      </div>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button
          type="button"
          ref={yesRef}
          variant="outline"
          size="sm"
          disabled={busy}
          /* The whole panel, so a reader who reaches Yes by keyboard hears what
             it is agreeing to — `RerunRow`'s F13, Metadata.tsx. */
          aria-describedby={detailsId}
          onClick={() => void onYes()}
        >
          {busy ? "Starting…" : retry ? "Yes, try again" : "Yes, start again"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Progress for reset successors the rerun section does not render. The set is
 * derived above; keeping this to the missing rows avoids two Stop buttons and
 * two failure messages for one job.
 */
function ResetOnlyRegeneration({
  job,
  stalled,
  onCancel,
}: {
  job: Job;
  stalled: boolean;
  onCancel: (id: string) => void;
}) {
  const step = job.steps[0]?.name;
  if (!step || !isExtra(step)) return null;
  const name = extraName(step);

  if (job.status === "error" || job.status === "cancelled") {
    return (
      <p role="alert" className="tw:m-0 tw:text-xs tw:text-destructive">
        {name} did not finish: {job.status === "cancelled" ? "Stopped." : (job.error ?? "The job failed.")}
      </p>
    );
  }
  if (job.status === "done") return null;

  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <span className="tw:text-xs tw:text-ink-faint">{name}</span>
      <JobProgress
        job={job}
        failed={null}
        stalled={stalled}
        onRun={async () => {
          throw new Error("A watched regeneration without a job cannot offer a run button.");
        }}
        onCancel={onCancel}
        label={`Make ${name}`}
        step={step}
        icon={<RotateCcw size={13} />}
        about={name}
        runningLabel={`Making ${name}`}
      />
    </div>
  );
}

/**
 * The row: its name and button, what it does, the checkbox — and, after one
 * press, the confirm that says what is kept, what is lost, and what it costs.
 * The first row of *AI processing*'s re-run card since 2026-09-30, above the
 * modes, rather than a subheading and a card of its own (Greg,
 * SPIDERYARN-READING2-65: *"amalgamate the "Start the whole article again" into
 * the run-it-again section above, e.g. as a button at the top"*).
 *
 * **Two clicks, inline, no `window.confirm`** — and the only control in that
 * section that still asks. The mode rows lost their confirm the same day
 * (Greg, SPIDERYARN-READING2-64, `RerunRow` in Metadata.tsx), because all it
 * guarded there was one of our model calls. This one guards the reader's own
 * things: it removes every generated extra and can move comments to *no longer
 * in this version*, and the panel says so before it happens. The panel is
 * `AccessSharing`'s confirm, because it has three things to say and not one
 * sentence. A Retry after a failure resets again, so it asks too.
 *
 * docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md
 */
export function ResetArticle({
  slug,
  provenance,
  onFinished,
  lead,
}: {
  slug: string;
  /**
   * What the heading line starts with — the chip and the name, drawn by
   * Metadata.tsx so this row and the mode rows under it share one `Chip`.
   */
  lead: ReactNode;
  /** Null until the metadata request lands; the extras are read off its stages. */
  provenance: ArticleMetadata | null;
  /** `refresh`, never `reload` — see `RerunSection` in Metadata.tsx. */
  onFinished: () => void;
}) {
  const {
    job,
    failed,
    stalled,
    starting,
    finished,
    regenerating,
    regenerationJobs,
    regenerationStalled,
    start,
    cancel,
  } = useResetJob(slug, onFinished);
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
    /* `done` means current, not present. A stale artefact still has a completed
       run and is still a non-null column, which is what the reset route reads. */
    .filter((stage) => stage.ranAt !== null && isExtra(stage.step))
    .map((stage) => stage.step);
  const names = extras.map(extraName);
  const regenerate = again && extras.length > 0;
  const lookUps = extras.includes("glossary") || extras.includes("citations");

  const failedAsking = failed?.retry ? { ...failed, retry: () => setPending("retry") } : failed;

  /* The run button, or nothing while the confirm stands in its place. At the
     right-hand end of the heading line, where every mode row below keeps its
     own. */
  const control = asking ? null : (
    <div className="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
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
  );

  return (
    <div data-reset className="tw:flex tw:flex-col tw:gap-3 tw:text-sm">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
        {lead}
        {control}
      </div>
      <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
        Reads our stored copy of this article again with today's pipeline, as if you had just added
        it, and removes the generated extras listed below.
      </p>

      {names.length > 0 ? (
        <label className="tw:flex tw:items-start tw:gap-2 tw:text-foreground">
          <input
            type="checkbox"
            className="tw:mt-[0.2rem] tw:[accent-color:var(--highlight-text)]"
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
          extras={extras}
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
      ) : null}

      {job !== null && regenerating.length > 0 ? (
        <p role="status" className="tw:m-0 tw:text-xs tw:text-ink-faint">
          Then, one after another: {listed(regenerating.map(extraName))}.
        </p>
      ) : null}

      {regenerationJobs
        .filter((candidate) => {
          const step = candidate.steps[0]?.name;
          return step !== undefined && RESET_ONLY_PROGRESS_SET.has(step);
        })
        .map((candidate) => (
          <ResetOnlyRegeneration
            key={candidate.id}
            job={candidate}
            stalled={regenerationStalled(candidate.id)}
            onCancel={cancel}
          />
        ))}

      {/* **The article on this tab is the old one.** It is fetched once for all
          three views (article/ArticlePage.tsx) and nothing refetches it, so the
          reading view one click away still holds the text from before the
          reset. Saying so, with the one press that fixes it, beats a reader
          finding their way back to a page that has quietly not changed. */}
      {finished && job === null ? (
        <p role="status" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <span className="tw:text-foreground">
            Article reset. Reload the page to read the new version.
            {regenerating.length > 0 ? " Selected extras were queued separately." : null}
          </span>
          <Button type="button" variant="outline" size="xs" onClick={() => location.reload()}>
            Reload
          </Button>
        </p>
      ) : null}
    </div>
  );
}
