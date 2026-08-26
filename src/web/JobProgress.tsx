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
 * ## The two failures it distinguishes
 *
 * `failed` is a message, not a boolean, and it can arrive from two different
 * places: the POST that should have started a job never landed, or the job it
 * did start came back failed. They read the same to a reader and are diagnosed
 * differently, which is why the hooks work them out rather than this component
 * (see `useJobArtefact`'s `stopped`/`postFailed` in the panels' hooks).
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
 */
import { Loader2, X } from "lucide-react";
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
      <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-foreground">
        <Loader2 size={13} className="tw:animate-spin tw:text-highlight" />
        <span>
          {job.status === "queued" ? "Waiting for the queue…" : (current?.label ?? runningLabel)}
        </span>
        {current?.detail && <span className="tw:text-ink-faint">— {current.detail}</span>}
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
