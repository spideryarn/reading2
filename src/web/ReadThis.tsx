/**
 * ***Read this*, for a paper not read through yet.** Drawn on the shelf card
 * (handed to `ShelfCard` by Library.tsx) and on the paper's own page
 * (UnreadPaperPage.tsx), so the two say the same words and press the same
 * function (`readThis`, read-this.ts). Plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md.
 *
 * > Each paper should be shown on the shelf as normal, but indicate in the UI
 * > that it hasn't been AI-processed yet.
 * >
 * > — Greg, 2026-10-01
 *
 * **One click, and never by itself.** Opening a paper does not start the
 * import: that would spend 0.99 of an article on a click that did not say so,
 * and a reader skimming twenty titles would spend twenty (the plan's answer 6).
 * So the button states its cost beside it, in the words billing.md uses.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Job } from "../types.js";
import { jobEngine } from "./jobEngine.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { READ_THIS_COST, readThis, readThisJobFor } from "./read-this.js";

/* The marker is `NotProcessedBadge` in ShelfEntry.tsx, beside `ArchivedMark`. */

/** What the running import is doing, in the step's own words. */
function runningLine(job: Job): string {
  const step = job.steps.find((s) => s.status === "running");
  return step ? `Reading it through: ${step.label}` : "Reading it through";
}

/**
 * The button, its cost, and what it is doing once pressed.
 *
 * It reads the job engine rather than remembering the click, for
 * JobProgress.tsx's reason: a *Read this* pressed in another tab, or on the
 * card before the reader opened the page, is the same job. `subscribeQuietly`,
 * because a card on the shelf must not buy the idle poll (jobEngine.ts § When
 * it polls); a running job is polled every second anyway.
 *
 * `onStarted` tells the caller the job it started — the paper's page follows
 * that job and loads the article when it is done.
 */
export function ReadThisButton({
  slug,
  onStarted,
  size = "sm",
}: {
  slug: string;
  onStarted?: (job: Job) => void;
  size?: "sm" | "default";
}) {
  const snapshot = useSyncExternalStore(jobEngine.subscribeQuietly, jobEngine.getSnapshot);
  const [pressing, setPressing] = useState(false);
  /** Held from the POST's answer until the engine's list shows the job. */
  const [started, setStarted] = useState<Job | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /* The `/advance` answer can be the only place a terminal state is observed
     while the tab is hidden. Follow the job directly so a trimmed list cannot
     leave the button spinning on its original queued response for ever. */
  useEffect(() => {
    if (!started) return;
    return jobEngine.watchTerminal(started.id, (outcome) => {
      setStarted(null);
      if (outcome.kind === "error") {
        setFailure(
          outcome.job.error ??
            "Reading it through stopped before it finished. Pressing Read this again usually works.",
        );
      } else if (outcome.kind === "cancelled") {
        setFailure("Reading it through was stopped. Press Read this when you want to try again.");
      } else if (outcome.kind === "vanished") {
        setFailure("We lost sight of this import. Look on your shelf before trying again.");
      }
    });
  }, [started]);

  const seen = started ? snapshot.jobs.find((j) => j.id === started.id) : undefined;
  const running =
    readThisJobFor(snapshot.jobs, slug) ?? (started && !seen ? started : undefined);
  /* The job this button started, if it ended badly: its own sentence, and the
     button again, which is the retry — the reservation went back when it failed. */
  const ended =
    seen?.status === "error"
      ? (seen.error ?? "Reading it through stopped before it finished. Pressing Read this again usually works.")
      : null;

  async function press(): Promise<void> {
    if (pressing || running) return;
    setPressing(true);
    setFailure(null);
    const outcome = await readThis(slug);
    setPressing(false);
    if (outcome.ok) {
      setStarted(outcome.job);
      onStarted?.(outcome.job);
    } else {
      setFailure(outcome.message);
    }
  }

  return (
    /* `relative`, so on the shelf card it sits above the card's stretched link. */
    <div className="tw:relative tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
      {running ? (
        <span
          role="status"
          className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground"
        >
          <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" />
          {runningLine(running)}
        </span>
      ) : (
        <>
          <Button type="button" size={size} disabled={pressing} onClick={() => void press()}>
            Read this
          </Button>
          <span className="tw:text-xs tw:text-muted-foreground">{READ_THIS_COST}</span>
        </>
      )}
      <div aria-live="polite" className="tw:basis-full">
        <QuotaNotice message={failure ?? ended} className="tw:m-0 tw:text-xs tw:text-danger" />
      </div>
    </div>
  );
}
