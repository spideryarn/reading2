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
import type { Job, StepName } from "../types.js";

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
  if (job) {
    const current = job.steps.find((s) => s.name === step);
    return (
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-foreground">
        <LoaderCircle size={13} className="cmt-spinner" />
        <span>
          {job.status === "queued" ? "Waiting for the queue…" : (current?.label ?? runningLabel)}
        </span>
        {/* `w-full` is what makes the wrap happen rather than merely allowing
            it: a flex item at full width cannot share a line, so the detail
            always lands below and Stop always follows it. */}
        {current?.detail && (
          <span className="tw:w-full tw:font-mono tw:text-[0.7rem] tw:text-ink-faint">
            {current.detail}
          </span>
        )}
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
