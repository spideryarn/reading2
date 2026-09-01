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
 * started **in another tab, or from the CLI**, so this shows whatever the queue
 * is actually doing rather than what this session remembers pressing. Which is
 * why the only thing it takes about a running job is the `Job` itself.
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
 * `failed` is a message, not a boolean, and it can arrive from two different
 * places: the POST that should have started a job never landed, or the job it
 * did start came back failed. They read the same to a reader and are diagnosed
 * differently, which is why the hooks work them out rather than this component
 * (see `stopped` and `postFailed` in useGlossary.ts, useSummaries.ts, and the
 * hook inside Tweets.tsx).
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
import { LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { displayJob, elapsedLabel, WAITING_TO_CONTINUE } from "../job-state.js";
import type { Job, StepName } from "../types.js";
import { useNow } from "./useNow.js";

export function JobProgress({
  job,
  failed,
  onRun,
  onCancel,
  label,
  step,
  icon,
  runningLabel,
}: {
  /** The job the queue says is running for this step, or null. */
  job: Job | null;
  /** A message to show under the button, or null. Never a boolean — see above. */
  failed: string | null;
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
   * **A day when there is no job**, rather than the hook's own minute: with
   * nothing running the value is not read by anything, and a minute would be
   * this panel re-rendering once a minute for ever behind an idle button —
   * the exact cost `useNow`'s own header describes paying by accident. A day
   * is comfortably inside the 32-bit timer range, so it is one timer that
   * never fires rather than a clever nothing.
   */
  const now = useNow(job ? 1000 : 86_400_000);

  if (job) {
    const shown = displayJob(job, now);
    /* The step that is actually running, and the panel's own step as the
       fallback for the moment between two of them. Naming the step the reader
       is really waiting on is the same rule the add card follows — "each step
       is named, not counted". */
    const current = shown.step ?? job.steps.find((s) => s.name === step);
    const waiting = shown.state === "waiting";
    /* Not repeated underneath when it is already the heading. */
    const note = waiting ? null : shown.sentence;
    return (
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-foreground">
        <LoaderCircle size={13} className="cmt-spinner" />
        <span>
          {waiting ? WAITING_TO_CONTINUE : (current?.label ?? runningLabel)}
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
      </div>
    );
  }

  return (
    <>
      {/* `() => void onRun()` and not `onRun`: React hands a click handler a
          MouseEvent, and a run function whose first parameter is optional would
          take that event as its argument — an object, so truthy, quietly
          forcing every press. The thread page was bitten by exactly this, and
          `write(force?)` has exactly that shape. The default parameter is what
          makes the shorthand dangerous. */}
      <Button type="button" variant="outline" size="sm" onClick={() => void onRun()}>
        {icon}
        {label}
      </Button>
      {failed && <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive">{failed}</p>}
    </>
  );
}
