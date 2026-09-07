/**
 * The button that starts a job, and what it becomes while the job runs.
 *
 * One component, used by the glossary, the summaries and the thread. It was
 * three near-identical private components until 2026-08-26, and the summary
 * panel's own docstring said so out loud: *"The same component the glossary
 * panel has, and the same reasoning."*
 *
 * ## Why it reads the queue rather than remembering the click
 *
 * That reasoning, kept because it is the whole design: a run may have been
 * started **in another tab**, so this shows whatever the queue is actually
 * doing rather than what this session remembers pressing. Which is why the only
 * thing it takes about a running job is the `Job` itself. (It said "or from the
 * CLI" until 2026-09-02; `npm run glossary` writes no job record, so nothing
 * about it ever reaches the queue — src/web/useStepJob.ts § `job`.)
 *
 * `starting` is the one exception, and it is deliberately narrow: it is what
 * *this* mount is waiting to see appear, and it is gone the moment the record
 * does.
 *
 * The step's own `label` and `detail` come off the server too, so the words a
 * reader sees here are the words the add box shows for the same step. A local
 * "Step 1 of 1" would say neither what is slow nor what is about to fail.
 *
 * ## Where the words come from
 *
 * The **state** is `displayJob` (src/job-state.ts), shared with the add card,
 * so a band and a card cannot end up with two accounts of one job. The
 * **layout** is not shared and should not be: this is a band about twenty
 * characters wide, so everything that is not the label and Stop goes on its
 * own wrapped line.
 *
 * This is the **mirror image of `JobCard`**: it shows the job's own sentence
 * and never a step's `error`. Check which you are writing for before adding
 * anything — tests/interrupted-job-card.test.tsx is what happened the last
 * time somebody had it the other way round.
 *
 * ## The two failures it distinguishes
 *
 * `failed` is a `StepFailure`, not a boolean and no longer a bare string, and
 * it can arrive from two different places: the POST that should have started a
 * job never landed, or the job it did start came back failed. They read the
 * same to a reader and are diagnosed differently, which is why `useStepJob`
 * works them out rather than this component.
 *
 * ## The Retry, and the button that used to appear instead of it
 *
 * Until 2026-09-03 this drew its ordinary run button again under **every**
 * failure and never asked whether another go could work — while the shelf card
 * next door had been asking `jobWorthRetrying` since August. One job, one
 * failure, two different answers depending on which surface the reader
 * happened to be looking at, and the band is the surface a reader in a mode
 * actually has.
 *
 * So: a failed job that is worth another go gets **Retry**, which is
 * `POST /api/jobs/:id/retry` and skips the steps that finished — the shelf's
 * own action, not a second pattern. A failure that another go cannot change
 * gets **no button at all**, which is also the shelf's answer and for the
 * reason recorded there: *nothing takes the button's place, because the
 * sentence already says why*
 * ([ingest-queue.md](../../docs/project/ingest-queue.md#the-failures-retry-is-not-offered-under)).
 * A run button under "trying again will not help" is the mistake
 * docs/project/copy.md exists to stop, and it is worse than a badly worded
 * sentence because the reader can act on it.
 *
 * The ordinary run button comes back only where there is genuinely something
 * new to ask for: no failure at all, or a POST that never landed and left no
 * job to retry.
 *
 * ## The job in the way, which there is no longer
 *
 * A `blocking` job was drawn here from 2026-09-01 to 2026-09-02: `POST
 * /api/jobs` answered 409 when the article already had an active job doing
 * different work, and that job's steps were by definition not this panel's, so
 * the reader was told to *"stop it first"* with nothing on screen to stop. The
 * band was the fix.
 *
 * The refusal is gone — a second, different job on one article is queued now
 * and shows in this panel's own band as *Waiting to continue.* — so the second
 * band went with it, along with `WORKING_ON_THIS_ARTICLE`, the label it borrowed
 * between two steps.
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1g.
 *
 * ## Styling
 *
 * shadcn's `Button`, which is a **visible change** made deliberately on
 * 2026-08-26. The glossary and summary panels each had their own hand-written
 * `gloss-btn` / `summ-btn` — the same button drawn twice, differing only in two
 * paddings, a gap and two colours, which is not a design, it is a divergence.
 * The thread already used shadcn here, and
 * [web-client.md § Tailwind and shadcn](../../docs/project/web-client.md#tailwind-and-shadcn-components)
 * records shadcn as the house style for chrome. This is chrome.
 *
 * ## The running row wraps, and the detail gets its own line
 *
 * The two rows this replaced disagreed here, so unifying them had to pick one.
 * The glossary kept its detail inline; the summary gave it a full-width second
 * line in the mono face. **The summary was right**, and it is what this does:
 * a step detail is arbitrary-length progress text ("batch 3 of 9", a model
 * name) sitting in a band about twenty characters wide, so inline means it
 * shoulders the label out or overflows.
 *
 * `flex-wrap` is load-bearing rather than defensive — both originals had it,
 * and the first version of this component dropped it, which put the label, the
 * detail and Stop on one unwrappable row.
 *
 * ## The spinner is the house one, and that is not a style preference
 *
 * `LoaderCircle` with `.cmt-spinner`, per
 * [icons.md § the loading spinner](../../docs/project/icons.md#reduced-motion).
 * Tailwind's `animate-spin` is **specifically rejected there** — it is 1s where
 * this wants 0.7s, and it has no `prefers-reduced-motion` behaviour at all. The
 * first version of this component used `animate-spin`, so consolidating three
 * spinners that each honoured reduced motion produced one that ignored it.
 */
import { LoaderCircle, RotateCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  displayJob,
  DRIVER_STALLED,
  elapsedLabel,
  STARTING,
  WAITING_TO_CONTINUE,
} from "../job-state.js";
import type { Job, JobStep, StepName } from "../types.js";
import type { StepFailure } from "./useStepJob.js";
import { useNow } from "./useNow.js";

export function JobProgress({
  job,
  starting = false,
  failed,
  stalled,
  onRun,
  onCancel,
  label,
  step,
  icon,
  runningLabel,
  about,
}: {
  /** The job the queue says is running for this step, or null. */
  job: Job | null;
  /**
   * **The request has gone and the queue has not caught up.**
   *
   * Without it this component draws its run button again in the gap between
   * the press and the first poll that sees the job — so a reader who pressed
   * once was offered the button a second time, and a reader whose mode started
   * itself was offered it before they had pressed anything at all.
   *
   * No Stop: there is no id to stop yet, and a control that cannot act is
   * worse than a wait that says what it is doing. `StepJob.starting`,
   * src/web/useStepJob.ts.
   *
   * **Optional, and the reason given for that was wrong.** This said until
   * 2026-09-03 that the thread page and the quiz *"watch a job they did not
   * start and have no such gap"*. Neither does: `write` in src/web/useQuiz.ts
   * and `write` in Tweets.tsx both start their own runs, so both had exactly
   * the gap this prop exists for and both re-armed their button between the
   * press and the first poll.
   *
   * The quiz passes it now (tests/quiz-panel.test.tsx § the gap between
   * pressing and the job appearing). **The thread still does not**, because
   * threading it there means four more component prop types in a file this
   * change was not otherwise touching — a real remaining gap rather than a
   * decision, recorded here so it is not rediscovered as a mystery. The prop
   * stays optional for that and for the showcase in DesignPage, which has no
   * hook behind it.
   */
  starting?: boolean;
  /**
   * Why the last run ended badly, or null.
   *
   * **The whole `StepFailure`**, so retryability travels with the sentence and
   * a caller cannot pass one without the other — src/web/useStepJob.ts. It was
   * a bare string until 2026-09-03, which is how this component came to draw a
   * run button under failures another go could not change.
   */
  failed: StepFailure | null;
  /**
   * Whether this tab can see the job on screen and cannot move it.
   *
   * **Stage 5 shipped this on the shelf card and not here, and that was wrong.**
   * The reasoning was that threading it would touch eight panels — which it
   * does — and the answer is GPT Sol's, 2026-09-01: *"a reader drawing a sketch
   * or generating a glossary may never look at the shelf card; their only
   * surface can therefore spin indefinitely without the warning Stage 5 exists
   * to give."* A gap that only shows up for the readers who never open the
   * shelf is not a gap you get to leave on purpose.
   *
   * It comes from `useStepJob`, which already holds the queue subscription
   * (src/web/useStepJob.ts § `stalled`), so nothing about transport health had
   * to be put on `Job` or on `displayJob`. **Required rather than optional**:
   * one compiler error per surface beats a warning quietly wired into two
   * panels out of eight.
   */
  stalled: boolean;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  /** What the button says when there is no job: "Find the terms". */
  label: string;
  /** Which of the job's steps this panel is watching. */
  step: StepName;
  /** Sits before `label`. Lucide, size 13 — see docs/project/icons.md. */
  icon: ReactNode;
  /** Shown while running, when the step has not reported a label of its own. */
  runningLabel: string;
  /**
   * **What this band is about**, when the surrounding page has more than one of
   * them — the mode's name, as a reader would say it: `"Debate"`.
   *
   * It exists for the **accessible name** of the two buttons below and for
   * nothing else. `label` and *Retry* are what the reader sees, and they are the
   * same words in every band; the mode's name sits beside the band as ordinary
   * text, which a screen reader's button list does not pick up. On a page with
   * nine of these — Metadata's *Generate it again* — that list reads as eight
   * indistinguishable *Run it again* controls. Found by a cross-family review of
   * the built code, 2026-09-07 (§ F11 of the plan).
   *
   * The composed name **begins with the visible text** — `Run it again — Debate`
   * — so a speech-input user saying the words on the button still matches it.
   *
   * **Optional, because the nine other reader-facing callers draw one band per
   * page** — a mode panel, the thread, the sketch — where a name would be a
   * distinction with nothing to draw it against, and the tenth is the showcase
   * in DesignPage. Passing nothing leaves the buttons exactly as they were: no
   * `aria-label` at all, so the accessible name is the visible text.
   */
  about?: string;
}) {
  /**
   * A second while a job is on screen, a minute otherwise.
   *
   * The band has to tick by itself for the same reason the card does: a step's
   * `detail` is written in memory and never persisted (src/jobs.ts §
   * `report`), so a job halfway through a long step sends back an identical
   * record on every poll and `sameJobs` correctly suppresses the re-render.
   * Without this the elapsed time would freeze at whatever it read when the
   * step began. `useNow` stops while the tab is hidden and catches up on
   * return.
   *
   * **Off when there is no job**, rather than the hook's own minute: with
   * nothing running the value is not read by anything, and a minute would be
   * this panel re-rendering once a minute for ever behind an idle button —
   * the exact cost `useNow`'s own header describes paying by accident. This
   * passed `86_400_000` and called it "one timer that never fires" until
   * 2026-09-01; it fired, once a day, per band. `useNow` takes `null` now.
   */
  const now = useNow(job ? 1000 : null);

  if (job) {
    return (
      <Band
        job={job}
        now={now}
        stalled={stalled}
        /* The step that is actually running, and the panel's own step as the
           fallback for the moment between two of them. Naming the step the
           reader is really waiting on is the same rule the add card follows —
           "each step is named, not counted". */
        fallbackStep={job.steps.find((s) => s.name === step)}
        fallbackLabel={runningLabel}
        onCancel={onCancel}
      />
    );
  }

  /* **After the `job` branch, not before it.** The two overlap for one poll —
     `starting` is cleared by the same list that produces the job — and the
     record is the better thing to draw the instant there is one. */
  if (starting) {
    return (
      <div
        className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-ink-faint"
        role="status"
      >
        <LoaderCircle size={13} className="cmt-spinner" />
        <span>{STARTING}</span>
      </div>
    );
  }

  /* **Retry when there is a job worth retrying; the run button otherwise; and
     neither when another go cannot help.** See § The Retry above for why the
     third case draws nothing rather than falling back to the run button. */
  const offerRetry = failed?.retryable === true && failed.retry !== null;
  const offerRun = failed === null || (failed.retryable && failed.retry === null);
  return (
    <>
      {offerRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Run it again, skipping the stages that already worked"
          /* The visible word first, then what it is about — see `about`. */
          aria-label={about ? `Retry — ${about}` : undefined}
          onClick={failed.retry ?? undefined}
        >
          <RotateCw size={13} />
          Retry
        </Button>
      )}
      {/* `() => void onRun()` and not `onRun`: React hands a click handler a
          MouseEvent, and a run function whose first parameter is optional would
          take that event as its argument — an object, so truthy, quietly
          forcing every press. The thread page was bitten by exactly this, and
          `write(force?)` has exactly that shape. The default parameter is what
          makes the shorthand dangerous. */}
      {offerRun && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={about ? `${label} — ${about}` : undefined}
          onClick={() => void onRun()}
        >
          {icon}
          {label}
        </Button>
      )}
      {failed && (
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive">{failed.message}</p>
      )}
    </>
  );
}

/**
 * One running job, drawn.
 *
 * Extracted 2026-09-01 so that the job this panel started and the job that
 * **refused** it were the same three rows in the same words. There is no
 * refusal any more and so only one caller (§ The job in the way, above), but it
 * stays a function: the states are `displayJob`'s, and inlining them here is how
 * a band and a card came to disagree once already
 * (tests/interrupted-job-card.test.tsx).
 */
function Band({
  job,
  now,
  stalled,
  fallbackStep,
  fallbackLabel,
  onCancel,
}: {
  job: Job;
  now: number;
  /** See `stalled` on `JobProgress`. The one thing here the job does not know. */
  stalled: boolean;
  /** Whose `detail` to show when no step is running. */
  fallbackStep?: JobStep | undefined;
  fallbackLabel: string;
  onCancel(id: string): void;
}) {
  const shown = displayJob(job, now);
  const current = shown.step ?? fallbackStep;
  const waiting = shown.state === "waiting";
  /* Not repeated underneath when it is already the heading. */
  const note = waiting ? null : shown.sentence;
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-foreground">
      <LoaderCircle size={13} className="cmt-spinner" />
      <span>
        {waiting ? WAITING_TO_CONTINUE : (current?.label ?? fallbackLabel)}
        {shown.elapsedMs !== null && (
          <span className="tw:tabular-nums tw:text-ink-faint"> · {elapsedLabel(shown.elapsedMs)}</span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="tw:ml-auto"
        title="Stop this job"
        disabled={job.cancelling === true}
        onClick={() => onCancel(job.id)}
      >
        <X size={12} />
        {job.cancelling ? "Stopping…" : "Stop"}
      </Button>
      {/* Last in the DOM, and that is the fix rather than an accident. `w-full`
          is what makes the wrap happen rather than merely allowing it: a flex
          item at full width cannot share a line. With the detail written
          *before* Stop — which is the reading order, and how the first version
          had it — that pushed Stop onto a third row. Two rows beats three in a
          band this narrow, and the detail is progress text rather than
          something the reader acts on, so it is the one that gives way. */}
      {current?.detail && (
        <span className="tw:w-full tw:font-mono tw:text-[0.7rem] tw:text-ink-faint">
          {current.detail}
        </span>
      )}
      {/* Full width for the same reason the detail is: this is a whole
          sentence in a band about twenty characters wide, and inline it
          would push Stop onto a third row. Two of the eight states have one
          — *taking longer than usual* and *stopping after the current step*
          — and both are the reader's cue that the wait is not a mistake they
          are making. */}
      {note && <span className="tw:w-full tw:leading-snug tw:text-ink-faint">{note}</span>}
      {/* Only where `data/_ai-calls.jsonl` gave us a number, and only while
          it is still true — see `STEP_TIMING` in src/job-state.ts. */}
      {shown.usually !== null && (
        <span className="tw:w-full tw:leading-snug tw:text-ink-faint">{shown.usually}</span>
      )}
      {/* **The one line here that does not come off the server.** Everything
          above is the record; this is the tab admitting it can see the job and
          cannot move it. Full width like the other two sentences, and the same
          muted colour rather than `text-destructive`: nothing has failed, it is
          still trying, and colouring a thing that resolves itself as an error
          teaches the reader to distrust the colour. */}
      {stalled && (
        <span className="tw:w-full tw:leading-snug tw:text-ink-faint">{DRIVER_STALLED}</span>
      )}
    </div>
  );
}
