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
 * **The list is this sitting's, not the whole history.** A success leaves after
 * eight seconds and a failure never left at all, so on any shelf more than a
 * few weeks old this box became a column of every import that had ever gone
 * wrong, sitting above the shelf. Anything that finished before the tab was
 * opened is now folded behind one chevron — `TAB_OPENED_AT` and `earlier`
 * below, and docs/project/ingest-queue.md § The box only shows this sitting.
 *
 * See docs/project/ingest-queue.md.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronRight, Circle, LoaderCircle, Plus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { slugFromUrl } from "../ingest.js";
import {
  DRIVER_STALLED,
  displayJob,
  driverStalled,
  elapsedLabel,
  KEEP_A_TAB_OPEN,
} from "../job-state.js";
import { ADDING_SENDS_TEXT_AWAY } from "../messages.js";
import { addHref, navigate } from "./router.js";
import { UploadPicker } from "./UploadPicker.js";
import { useNow } from "./useNow.js";
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

/**
 * When this tab loaded, and the line between *what you just did* and *history*.
 *
 * > The "Add an article" shows this long history of imports. Perhaps just show
 * > the most recent, or the ones since the page was opened, with the rest
 * > hidden by default, and a button to expand them.
 * >
 * > — Greg, 2026-08-27
 *
 * A successful job leaves after eight seconds (`KEEP_DONE_MS` above) because
 * the article it made is on the shelf directly below. **A failed one has never
 * left at all** — deliberately, since the card is the only account of what went
 * wrong — and the server keeps fifty of those per reader, preferring failures
 * when it prunes (`KEEP_FINISHED` in src/jobs.ts). So the box that is meant to
 * say "here is what is happening now" was showing every import that had ever
 * gone wrong, oldest at the bottom, above a shelf that was the actual point of
 * the page.
 *
 * **Module scope, not a mount, and that is the load-bearing part.** Adding an
 * article navigates to `/add/<url>`, and coming home remounts this component —
 * so a per-mount clock would fold the failure you caused thirty seconds ago
 * into "earlier" before you had read it. This is client-side navigation inside
 * one tab, so a module constant is exactly "since the page was opened", which
 * is what Greg asked for and what a reader means by it. A real reload resets
 * it, and should: that is a new sitting.
 */
const TAB_OPENED_AT = Date.now();

/**
 * A job that ended before `before` — history rather than news.
 *
 * The test is positive: a job is only earlier when we can *establish* that it
 * finished first. Anything still running, and anything whose `finishedAt` we
 * cannot read, stays on screen. Every terminal state in src/jobs.ts stamps
 * `finishedAt`, so the fallback should never fire — but it errs towards showing
 * a job rather than hiding one, and that is the direction to err in when the
 * thing being hidden may be a failure.
 *
 * `Date.parse` of a malformed string is `NaN`, and `NaN < anything` is false —
 * so that case would fall out right anyway. It is written out because falling
 * out right by accident is how the next edit breaks it: the shelf's own sort
 * has a test about exactly this (tests/library-sorting.test.ts § unparseable).
 *
 * The cutoff is a parameter rather than `TAB_OPENED_AT` read from scope, so
 * this is a function of its arguments and a test does not have to arrange for a
 * module to be imported at a particular moment.
 */
export function earlier(job: Job, before: number): boolean {
  if (job.status === "queued" || job.status === "running") return false;
  if (job.finishedAt === undefined) return false;
  const at = Date.parse(job.finishedAt);
  return Number.isFinite(at) && at < before;
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

  /* Two lists out of one, split on when the job ended rather than on what it
     is. Sorting is the server's — newest first, `listJobs` in src/jobs.ts — and
     partitioning preserves it, so neither list needs its own opinion. */
  const current = showing.filter((j) => !earlier(j, TAB_OPENED_AT));
  const history = showing.filter((j) => earlier(j, TAB_OPENED_AT));
  /* Cancelled is not failed: you stopped it, and you know you did. */
  const failedEarlier = history.filter((j) => j.status === "error").length;
  const [openHistory, setOpenHistory] = useState(false);

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

  /* Hidden here *and* forgotten on the server, which `JobCard` already does —
     this is only the local half, so the card goes the moment it is clicked
     rather than on the next poll. */
  const hide = (id: string) => setDismissed((prev) => new Set(prev).add(id));

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
            className="tw:min-w-0 tw:flex-1 tw:rounded-md tw:border tw:border-border tw:bg-background tw:px-3 tw:py-2 tw:font-mono tw:text-[13px] tw:text-foreground tw:transition-colors tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-highlight tw:focus:ring-2 tw:focus:ring-highlight/25"
          />
          {/* **The default variant, not `outline`.** This is the one thing the
              shelf exists to let you do, and until 2026-08-27 it was drawn as
              the quietest control on the page — a grey slab that, next to a
              grey input inside a grey card, was hard to find and (being
              disabled until the box has a URL in it) read as permanently
              switched off. Filling it orange costs nothing: the disabled state
              still says so, at 50% opacity, and now says it about something you
              can see. */}
          <Button type="submit" disabled={!slug}>
            Add
          </Button>
        </div>
      </form>

      {url.trim() !== "" && !slug && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          That doesn't look like a URL yet.
        </p>
      )}
      {/* **The trailing dash and ellipsis are not decoration.** Since
          2026-08-31 the server puts a short id on the end of every new slug
          (src/ingest.ts § `slugWithShortId`), and it is random, so the box
          cannot know it. Naming the readable half and showing that something
          follows is the true statement; printing `why-trees` on its own was a
          promise about an address that will not exist.
          docs/project/ingest-queue.md § Every slug carries a short id. */}
      {slug && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          It'll be on the shelf as{" "}
          <code className="tw:font-mono tw:text-foreground">{slug}-…</code>.
        </p>
      )}

      {/* Under the URL box rather than beside it. They are two ways to start
          the same thing, and the reader will nearly always be doing the first —
          a row of two equal halves would give a rarely-used control half the
          section. See docs/plans/260826u-pdf-upload-and-storage.md for what is behind
          it, which today is nothing. */}
      <UploadPicker />

      {/* **What happens to the text, said once, at the point of deciding.**
          One sentence, no gate and no checkbox: the reader is told, and then
          they decide. It sits under both controls because it is true of both —
          a pasted URL and an uploaded PDF go the same way — and because it is
          about what happens *after* Add, not about the box above it.

          It matters most to somebody who has been sent a manuscript to
          peer-review, and Referee mode says the past-tense half of it
          (`REFEREE_TEXT_ALREADY_SENT`, src/web/App.tsx § RefereeBand). This is
          the half that arrives while the choice is still open, which is the
          only reason that one can be honest.
          docs/plans/260831an-referee-mode-for-peer-reviewers.md § Confidentiality. */}
      <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
        {ADDING_SENDS_TEXT_AWAY}
      </p>

      {queue.error && (
        <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-destructive">{queue.error}</p>
      )}

      {current.length > 0 && <JobList jobs={current} queue={queue} onHide={hide} />}

      {history.length > 0 && (
        <div className="tw:mt-4">
          {/* The same disclosure the shelf's deleted articles wear — a chevron
              that turns, the hit area widened with `-ml-2` so the label stays
              on the section's left margin, and one height (28px) shared with
              every other small control on this page. See Library.tsx § Show
              deleted and docs/project/design-css-overview.md § Controls. */}
          <button
            type="button"
            onClick={() => setOpenHistory((v) => !v)}
            aria-expanded={openHistory}
            className="tw:-ml-2 tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
          >
            <ChevronRight
              size={13}
              className={`tw:transition-transform ${openHistory ? "tw:rotate-90" : ""}`}
            />
            {history.length === 1 ? "1 earlier import" : `${history.length} earlier imports`}
            {/* **Said out loud, and in the destructive colour, whether or not
                the group is open.** Everything folded away here is finished, so
                the only reason to look is that one of them went wrong — and a
                collapsed disclosure that hides a failure without mentioning it
                is exactly the shape of bug docs/reusable/silent-success.md is
                about, with the reader as the thing that fails silently. The
                count is the whole of the case for opening it. */}
            {failedEarlier > 0 && (
              <>
                {/* A separator, because the two halves are both counts and a
                    flex gap alone leaves "3 earlier imports 2 failed" reading
                    as one run of numbers. The same middot the cards use. */}
                <span aria-hidden="true" className="tw:opacity-50">
                  ·
                </span>
                <span className="tw:text-destructive">
                  {failedEarlier === 1 ? "1 failed" : `${failedEarlier} failed`}
                </span>
              </>
            )}
          </button>

          {openHistory && <JobList jobs={history} queue={queue} onHide={hide} />}
        </div>
      )}
    </section>
  );
}

/**
 * The list itself, so the two groups cannot drift apart.
 *
 * They are the same cards in the same order with the same buttons; the only
 * difference between them is whether a chevron had to be clicked first, and
 * that difference belongs to the caller.
 */
function JobList({
  jobs,
  queue,
  onHide,
}: {
  jobs: Job[];
  queue: UseJobs;
  onHide: (id: string) => void;
}) {
  /* One fact about the browser, so one sentence — three imports at once do not
     make it three times as true. On the list rather than on the card for
     exactly that reason. */
  const importing = jobs.some((j) => j.status === "queued" || j.status === "running");
  return (
    <>
      <ul className="tw:mt-3 tw:mb-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} queue={queue} onHide={() => onHide(job.id)} />
          </li>
        ))}
      </ul>
      {/* **Only while something is importing**, because it is advice about
          right now and not a standing disclaimer. Under the list, where a
          reader who has just watched a step sit still for a minute is looking.
          See `KEEP_A_TAB_OPEN` in src/job-state.ts for why this has to be said
          at all: the tab is the worker. */}
      {importing && (
        <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-muted-foreground">{KEEP_A_TAB_OPEN}</p>
      )}
    </>
  );
}

/**
 * One job, its steps, and the two things you can do to it.
 *
 * Exported because the add page (AddPage.tsx) shows the same card for the one
 * job it started. Same card on purpose rather than a second one that looks like
 * it: the words in these rows come off the server, and two renderers of the
 * same job would be two chances to disagree about what "skipped" looks like.
 *
 * **What state the job is in is not worked out here.** `displayJob`
 * (src/job-state.ts) answers that once for every surface, so this card and the
 * band in JobProgress.tsx cannot drift into two accounts of the same job — the
 * same argument src/job-failure.ts makes about the Retry button, which is now
 * one of its answers. What is still this file's own is **where** each of those
 * answers goes: this card renders `step.error` and never `job.error`, and the
 * band is the mirror image. tests/interrupted-job-card.test.tsx is what
 * happened the last time somebody had that the wrong way round.
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
  /**
   * **The clock has to tick by itself, and that is not obvious.**
   *
   * `ctx.report` writes a step's `detail` in memory and never persists it
   * ("Persisting at this rate would be two writes a second per running job",
   * src/jobs.ts), so a job in the middle of a six-minute `hierarchy` sends
   * back a byte-identical record on every poll — and `sameJobs` in
   * jobEngine.ts deliberately suppresses an identical snapshot. Without a tick
   * of its own the elapsed time would freeze at whatever it read when the step
   * began and sit there for six minutes, which is a worse lie than showing
   * nothing.
   *
   * A second while something is running, and **off** otherwise: a finished card
   * has no running step, so nothing on it changes with time and a minute would
   * be a re-render an hour to paint the same pixels. `useNow` stops dead while
   * the tab is hidden and catches up on return, which is exactly right here —
   * nobody is watching a timer they cannot see.
   *
   * This said `86_400_000` and called it "one timer that never fires" until
   * 2026-09-01. It fired — once a day, per card, for the life of the tab.
   * Harmless and untrue, which is the worse half; `useNow` takes `null` now.
   */
  const now = useNow(busy ? 1000 : null);
  const shown = displayJob(job, now);
  /* Only while it is going. A count that outlived its job would be a warning
     about something that has already stopped — and the engine drops the count
     at the same moment, so this is belt and braces about a race of one poll. */
  const stalled = busy && driverStalled(queue.driverFailures, job.id);
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
                on it. `jobWorthRetrying` is still the one place that decides;
                since 2026-09-01 it is asked through `displayJob`, which calls
                it rather than absorbing it — the server's own spend gate in
                `retryJob` imports the same function. See src/job-failure.ts,
                src/job-state.ts and docs/postmortems/260826a-toc-max-tokens.md.

                Nothing takes its place when it is hidden. The failed step's own
                message is already on the card and already says why. */}
            {(job.status === "error" || job.status === "cancelled") && shown.retryable && (
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
          <StepRow
            key={step.name}
            step={step}
            /* By identity, not by re-testing the status: `displayJob` has
               already decided which step the reader is waiting on, and a
               second opinion here is a second place to disagree with it. */
            elapsedMs={step === shown.step ? shown.elapsedMs : null}
            usually={step === shown.step ? shown.usually : null}
          />
        ))}
      </ol>

      {/* Under the steps rather than beside the title, because it is about the
          run as a whole and it is read after them. Five of the eight display
          states say nothing at all here — see `SENTENCES` in src/job-state.ts
          for why silence is the right answer for a failure, whose own step row
          is already carrying the explanation. */}
      {shown.sentence && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">{shown.sentence}</p>
      )}

      {/* **The one thing on this card that the job does not know.** Everything
          above comes off the server; this is the tab admitting that it can see
          the import and cannot move it. Not `text-destructive`: nothing has
          failed, it is still trying, and colouring a thing that resolves
          itself as an error teaches the reader to distrust the colour. */}
      {stalled && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">{DRIVER_STALLED}</p>
      )}
    </div>
  );
}

/**
 * One line per stage. The icon carries the status; the text never repeats it.
 *
 * The running row reads `Building the hierarchy · 2m 14s · 18k characters of
 * tree so far` — **what**, then **how long**, then whatever the step is saying
 * about itself. That last part is the older signal and this is built beside it
 * rather than over it: a step that streams its progress was already the best
 * thing on this card, and the duration is what a step that streams *nothing*
 * needed. A middot rather than the em dash the finished rows use, because
 * three things separated by one em dash read as a sentence with an aside.
 *
 * **No progress bar, and no percentage.** Neither response size nor provider
 * latency is knowable before the fact, so a bar would be a number we invented,
 * shown in the one shape a reader is entitled to trust.
 */
function StepRow({
  step,
  elapsedMs,
  usually,
}: {
  step: JobStep;
  /** How long this step has been running, or null when it is not, or unknowable. */
  elapsedMs: number | null;
  /** What this step usually takes, where that was measured. See src/job-state.ts. */
  usually: string | null;
}) {
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
        {elapsedMs !== null && (
          <span className="tw:whitespace-nowrap tw:tabular-nums tw:text-ink-faint">
            · {elapsedLabel(elapsedMs)}
          </span>
        )}
        {step.detail && step.status !== "error" && (
          <span className="tw:min-w-0 tw:truncate tw:text-ink-faint">
            {elapsedMs === null ? "—" : "·"} {step.detail}
          </span>
        )}
      </span>
      {/* Under the row, in the same indent the error message uses, because it
          is a whole sentence and the row above it is a list of fragments. Only
          for the two steps `data/_ai-calls.jsonl` has actually timed — a
          reassurance nobody measured is docs/reusable/silent-success.md with a
          number on it. */}
      {usually !== null && (
        <span className="tw:mt-0.5 tw:block tw:pl-[21px] tw:leading-snug tw:text-ink-faint">
          {usually}
        </span>
      )}
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
