/**
 * Paste a URL, watch it become an article.
 *
 * > There should be some kind of queue that processes things … and ideally a
 * > progress indicator.
 * >
 * > — Greg, 2026-08-25
 *
 * This box used to print the four commands for you to run yourself, which was
 * honest about there being no job runner and useless for anything else. There is
 * one now (src/jobs.ts), so the box submits, and the command list it used to
 * show has become the progress list it always said it would.
 *
 * **Each step is named, not counted.** "Extracting the article" and "Building
 * the table of contents" tell you what is slow and what is about to fail;
 * "Step 3 of 5" tells you neither. That is the one lesson worth keeping from the
 * previous version of this project, which had no queue at all but did get its
 * loading text right — docs/project/original-version/extraction.md#document-lifecycle-atomic-no-processing-state.
 *
 * See docs/project/ingest-queue.md.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronRight, Circle, LoaderCircle, Plus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { slugFromUrl } from "../ingest.js";
import { jobWorthRetrying } from "../job-failure.js";
import { addHref, navigate } from "./router.js";
import { UploadPicker } from "./UploadPicker.js";
import type { Job, JobStep } from "../types.js";
import type { UseJobs } from "./useJobs.js";

/**
 * How long a finished job stays on screen after it finishes.
 *
 * It goes on its own because the article it made is now on the shelf directly
 * below, which is the better place to look at it. Failures stay until
 * dismissed: a job that went wrong is the only record of *how*, and clearing it
 * on a timer would take that away while the reader was still reading it.
 *
 * Measured from the job's own `finishedAt`, not from when this component
 * noticed. Two reasons, and the first was a bug: the obvious version sets a
 * timer in an effect over `queue.jobs`, but that array is replaced by every
 * poll, so the timer was cleared and restarted every second and a job would
 * have sat there for ever. The second is that a page reload would otherwise
 * bring every finished job back, because the timer's state was in the
 * component and the job's is on the server.
 */
const KEEP_DONE_MS = 8000;

/** A finished job that has had its moment. */
function faded(job: Job, now: number): boolean {
  return (
    job.status === "done" &&
    job.finishedAt !== undefined &&
    now - Date.parse(job.finishedAt) > KEEP_DONE_MS
  );
}

export function AddArticle({ queue }: { queue: UseJobs }) {
  const [url, setUrl] = useState("");
  const slug = useMemo(() => slugFromUrl(url), [url]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // One re-render when the next still-showing success is due to fade. The
  // polling in useJobs re-renders anyway, so this only sharpens the timing —
  // without it a finished job would linger until the next idle poll, up to
  // eight seconds late.
  const [, redraw] = useState(0);
  const now = Date.now();
  const showing = queue.jobs.filter((j) => !dismissed.has(j.id) && !faded(j, now));

  // **Strictly in the future, and over `showing` rather than every job.** A
  // faded job stays in `queue.jobs` for as long as its record lives, so taking
  // the earliest deadline of all of them means that once anything has faded the
  // deadline is permanently in the past, the effect returns without scheduling,
  // and the *next* job to finish never gets its timer — the exact bug this
  // replaced, one level along.
  const nextDeadline = showing
    .filter((j) => j.status === "done" && j.finishedAt)
    .map((j) => Date.parse(j.finishedAt as string) + KEEP_DONE_MS)
    .filter((deadline) => deadline > now)
    .sort((a, b) => a - b)[0];

  useEffect(() => {
    if (nextDeadline === undefined) return;
    const wait = nextDeadline - Date.now();
    if (wait <= 0) {
      redraw((n) => n + 1);
      return;
    }
    const t = setTimeout(() => redraw((n) => n + 1), wait);
    return () => clearTimeout(t);
    // A number, so this re-runs only when the deadline itself moves — not on
    // every poll, which is what made the first version never fire at all.
  }, [nextDeadline]);

  /**
   * Add goes to the add page rather than queueing here.
   *
   * > And then modify the Home page so that when you add a url and click add,
   * > it takes you to this page.
   * >
   * > — Greg, 2026-08-26
   *
   * So there is one place that starts an ingest, and it is the one with an
   * address — which means the thing you just did is now something you can
   * bookmark, reload, or send to somebody. The progress list below stays: it is
   * for jobs this page did not start (another tab, the CLI, a re-run from an
   * article page), which is the case it always covered.
   *
   * The box is not cleared. This navigates away, so it unmounts with the state
   * in it; pressing Back should bring you home to the URL you typed rather than
   * to an empty box, and the double-add that clearing used to guard against is
   * now a second click on a button that is no longer on screen.
   */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!slug) return;
    navigate(addHref(url));
  }

  return (
    <section className="tw:mb-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4">
      <form onSubmit={submit}>
        <label
          htmlFor="add-url"
          className="tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-medium tw:text-muted-foreground"
        >
          <Plus size={14} />
          Add an article
        </label>
        <div className="tw:flex tw:gap-2">
          {/* `type="text"`, not `type="url"`. The browser's own URL validation
              will not submit a value without a scheme, and typing
              `example.com/an-essay` is meant to work — see `normaliseUrl` in
              src/ingest.ts. `inputMode` still asks a phone keyboard for the
              URL layout, and the validation that matters is `slugFromUrl`
              below, which is the same function the server uses. */}
          <input
            id="add-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com/an-essay-worth-reading"
            spellCheck={false}
            className="tw:min-w-0 tw:flex-1 tw:rounded-md tw:border tw:border-border tw:bg-background tw:px-3 tw:py-2 tw:font-mono tw:text-[13px] tw:text-foreground tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-highlight/60"
          />
          <Button type="submit" variant="outline" disabled={!slug}>
            Add
          </Button>
        </div>
      </form>

      {url.trim() !== "" && !slug && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          That doesn't look like a URL yet.
        </p>
      )}
      {slug && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          It'll be on the shelf as{" "}
          <code className="tw:font-mono tw:text-foreground">{slug}</code>.
        </p>
      )}

      {/* Under the URL box rather than beside it. They are two ways to start
          the same thing, and the reader will nearly always be doing the first —
          a row of two equal halves would give a rarely-used control half the
          section. See docs/plans/pdf-upload-and-storage.md for what is behind
          it, which today is nothing. */}
      <UploadPicker />

      {queue.error && (
        <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-destructive">{queue.error}</p>
      )}

      {showing.length > 0 && (
        <ul className="tw:mt-4 tw:mb-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
          {showing.map((job) => (
            <li key={job.id}>
              <JobCard
                job={job}
                queue={queue}
                onHide={() => setDismissed((s) => new Set(s).add(job.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One job, its steps, and the two things you can do to it.
 *
 * Exported because the add page (AddPage.tsx) shows the same card for the one
 * job it started. Same card on purpose rather than a second one that looks like
 * it: the words in these rows come off the server, and two renderers of the
 * same job would be two chances to disagree about what "skipped" looks like.
 */
export function JobCard({
  job,
  queue,
  onHide,
}: {
  job: Job;
  queue: UseJobs;
  onHide: () => void;
}) {
  const busy = job.status === "queued" || job.status === "running";
  return (
    <div className="tw:rounded-md tw:border tw:border-border tw:bg-background tw:p-3">
      <div className="tw:mb-2 tw:flex tw:items-baseline tw:gap-2">
        <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm tw:text-foreground">
          {job.title ?? job.slug}
        </span>
        {busy ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Stop this job"
            disabled={job.cancelling === true}
            onClick={() => void queue.cancel(job.id)}
          >
            {job.cancelling ? "Stopping…" : "Stop"}
          </Button>
        ) : (
          <>
            {/* A cancelled job offers Retry too. You stopped it, which is not
                the same as not wanting it — and Retry skips whatever finished
                before you did, so restarting costs only what is left. A
                cancelled job never carries a `failureKind`, so the second test
                passes it through.

                And **a failed one does not always get the button.** Some
                failures cannot come out differently on a second attempt — an
                article that needs more output tokens than one model response
                holds, a page Readability has already refused over bytes that
                are still in the cache — and a button under one of those is
                worse than a badly worded sentence, because the reader can act
                on it. `jobWorthRetrying` is the one place that decides; see
                src/job-failure.ts and docs/postmortems/toc-max-tokens.md.

                Nothing takes its place when it is hidden. The failed step's own
                message is already on the card and already says why. */}
            {(job.status === "error" || job.status === "cancelled") && jobWorthRetrying(job) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="Run it again, skipping the stages that already worked"
                onClick={() => void queue.retry(job.id)}
              >
                <RotateCw size={13} /> Retry
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Dismiss"
              onClick={() => {
                onHide();
                void queue.forget(job.id);
              }}
            >
              <X size={13} />
            </Button>
          </>
        )}
      </div>

      <ol className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-1 tw:p-0">
        {job.steps.map((step) => (
          <StepRow key={step.name} step={step} />
        ))}
      </ol>
    </div>
  );
}

/** One line per stage. The icon carries the status; the text never repeats it. */
function StepRow({ step }: { step: JobStep }) {
  const tone =
    step.status === "error"
      ? "tw:text-destructive"
      : step.status === "running"
        ? "tw:text-foreground"
        : step.status === "pending"
          ? "tw:text-muted-foreground"
          : "tw:text-ink-faint";

  return (
    <li className={`tw:text-xs ${tone}`}>
      <span className="tw:flex tw:items-center tw:gap-2">
        <StepIcon status={step.status} />
        <span className="tw:whitespace-nowrap">{step.label}</span>
        {step.detail && step.status !== "error" && (
          <span className="tw:min-w-0 tw:truncate tw:text-ink-faint">— {step.detail}</span>
        )}
      </span>
      {/* The message on its own line, indented under the label rather than
          beside it. A fetch failure is a whole sentence — src/fetch.ts writes
          them to be acted on — and inline it either squeezed the label onto two
          lines or got cut off at the ellipsis, which loses the half that says
          what to do. */}
      {step.error && (
        <span className="tw:mt-0.5 tw:block tw:pl-[21px] tw:leading-snug">{step.error}</span>
      )}
    </li>
  );
}

function StepIcon({ status }: { status: JobStep["status"] }) {
  // `size` and `strokeWidth` match every other icon on the page; see
  // docs/project/icons.md on why one stroke weight is a rule rather than taste.
  switch (status) {
    case "running":
      return <LoaderCircle size={13} className="cmt-spinner" />;
    case "done":
      return <Check size={13} className="tw:text-highlight" />;
    case "skipped":
      return <ChevronRight size={13} />;
    case "error":
      return <AlertCircle size={13} />;
    default:
      return <Circle size={13} />;
  }
}
