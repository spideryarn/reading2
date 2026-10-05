/**
 * **The line Structure draws when the tree in front of the reader is a
 * stand-in**, and the owner's press that asks for the real one.
 *
 * A long document's structure is asked for in slices, and when they fail the
 * step falls back to a tree built from the author's own headings with no model
 * (docs/project/structure-step.md § The fallback): no gist on any section, and
 * some sections named by their opening words. Until 2026-10-05 nothing said so.
 * Greg's words, and what this is and costs, are in
 * docs/project/structure.md § When it is only the headings.
 *
 * ## One arm per kind of stand-in
 *
 * `noticeFor` is a `switch` over `Tree.provisional` (src/types.ts) with a
 * `never` check, so a second value there is a compile error here until
 * somebody writes its words. **Keyed on that field and never on absent
 * gists** — src/types.ts says why: read off absence, a pipeline bug that drops
 * a gist would announce itself as a deliberate fallback.
 *
 * ## A visitor mounts none of the queue
 *
 * The press and everything that watches it live in `Again`, which is rendered
 * for the owner only. Starting a job is a POST and watching one is a poll, and
 * a signed-out browser issues neither (tests/visitor-gaps.test.ts). A boolean
 * passed into one component with the hooks at the top would have subscribed a
 * visitor to the queue to draw nothing.
 */
import { RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tree } from "../types.js";
import { JobProgress } from "./JobProgress.js";
import { useStepJob } from "./useStepJob.js";

/** The ways a tree can be a stand-in — `Tree.provisional`, minus "it is not one". */
export type ProvisionalTree = NonNullable<Tree["provisional"]>;

/** What one kind of stand-in says, and what its press is called. */
interface Notice {
  /** The line every reader gets. Ours, so the app's own face (docs/project/fonts.md). */
  says: string;
  /**
   * Added for the owner while the press is on offer. **"may"**, because the
   * same run can fall back again, and then this line is simply still here.
   */
  offer: string;
  /** The button. */
  press: string;
}

/**
 * The words for each kind. `null` for a value this build has never heard of —
 * a newer server behind an older page — where saying nothing is right and
 * throwing would take the whole band down for a sentence.
 */
function noticeFor(provisional: ProvisionalTree): Notice | null {
  switch (provisional) {
    case "headings":
      return {
        says:
          /* "and opening words": a stretch with no heading of its own is named
             by its first words (src/heading-tree.ts), so "headings" alone
             would misstate where a title came from (GPT Sol's review, F2). */
          "These section names are the document's own headings and opening words. The fuller " +
          "version, with a line on what each section says, could not be made.",
        offer: "Trying again may make it.",
        press: "Try again",
      };
    default:
      provisional satisfies never;
      return null;
  }
}

export function StructureNotice({
  provisional,
  slug,
  owner,
}: {
  /** `article.tree.provisional`. The caller draws nothing when it is absent. */
  provisional: ProvisionalTree;
  slug: string;
  /** Whether this article is the reader's own: the press is theirs alone. */
  owner: boolean;
}) {
  const notice = noticeFor(provisional);
  if (!notice) return null;
  return (
    /* `role="note"`, not `status`: it is true from the first paint, so there is
       no change for a live region to announce. */
    <div className="struct-notice" role="note">
      <p className="struct-notice-says">
        {notice.says}
        {owner ? ` ${notice.offer}` : null}
      </p>
      {owner ? <Again slug={slug} press={notice.press} /> : null}
    </div>
  );
}

const NOTHING = () => {};

/**
 * **The owner's press: one `structure` job, forced by name.**
 *
 * Forced, because the step has no freshness check (src/pipeline.ts §
 * `STEPS.structure`): unforced it sees a tree and skips, and the reader would
 * watch a job run and change nothing. The slices that did answer are
 * checkpointed, so the run buys only what failed
 * (docs/project/structure-step.md § When one answer will not fit).
 *
 * **What else one press buys**, said here because nothing on screen will: the
 * new tree is published without paragraph labels, which queues the free
 * `labels` job after it (src/store/pg-revisions.ts § `publishRevisionIn`) —
 * the reason `structure` is not on Metadata (src/rerun-steps.ts), and no cost
 * here, because the labels of a headings tree were written against sections
 * the new tree replaces. And the arc, below.
 *
 * **Nothing refetches the article** (article/ArticlePage.tsx reads it once),
 * so a finished run says so and offers the reload, as Metadata's reset does
 * (ResetArticle.tsx).
 */
function Again({ slug, press }: { slug: string; press: string }) {
  const [finished, setFinished] = useState(false);

  /**
   * **The arc is asked for again, unforced, once the tree has landed.**
   *
   * Its sentences are joined to the tree's parts by block range, and one whose
   * range matches no part is dropped from the page without a word
   * (src/web/tree.ts § `buildArcColumn`). A job of `["structure"]` never
   * reaches `arc` (`cascadeForce`, src/jobs.ts), and the payload's arc carries
   * no staleness, so `useArc` would go on showing what was left of the old one
   * for good. Unforced, so the step's own stamp decides: a run that fell back
   * to the same headings finds the arc current and buys nothing.
   *
   * `quiet`: it only ever starts one, and `useArc` is what shows it arriving.
   * Through a ref, so `onFinished` below stays one function — `useStepJob`
   * re-subscribes when it changes, and `start` is new on every render.
   */
  const arc = useStepJob(slug, "arc", NOTHING, "quiet");
  const startArc = useRef(arc.start);
  startArc.current = arc.start;
  /**
   * **Whether a run asked for from this tab is still owed its arc.**
   * `useStepJob` announces every `structure` job that finishes for this
   * article, another tab's included. The reload below is true advice whoever
   * started it; the arc is asked for by the tab that pressed, once, or two
   * tabs make two jobs (GPT Sol's code review, F1). Set by a press and by a
   * Retry, cleared by the first finish heard.
   */
  const owed = useRef(false);
  const onFinished = useCallback(() => {
    setFinished(true);
    if (!owed.current) return;
    owed.current = false;
    void startArc.current();
  }, []);

  const { job, failed, stalled, starting, start, cancel } = useStepJob(
    slug,
    "structure",
    onFinished,
    "watches-queue",
  );

  /* One press, one run — `RerunRow`'s latch in Metadata.tsx, for its reason:
     two clicks can reach this before `starting` takes the button away. */
  const pressing = useRef(false);
  const run = async () => {
    if (pressing.current) return;
    pressing.current = true;
    setFinished(false);
    owed.current = true;
    try {
      /* A refused start owes nothing: no job, so no finish to hear. */
      if ((await start({ force: true })) === null) owed.current = false;
    } finally {
      pressing.current = false;
    }
  };
  /* A Retry is this tab's press too, and a new job with a new id. */
  const failedHere =
    failed?.retry != null
      ? {
          ...failed,
          retry: () => {
            setFinished(false);
            owed.current = true;
            failed.retry?.();
          },
        }
      : failed;

  /* Never over a failure: a run that finished earlier must not hide one that
     failed after it. */
  if (finished && job === null && !failed) {
    return (
      <p role="status" className="struct-notice-done">
        {/* Not "the fuller version is ready": the run may have fallen back
            again, and the reload is how the reader finds out which. */}
        <span>Finished. Reload the page to see what it made.</span>
        <Button type="button" variant="outline" size="xs" onClick={() => location.reload()}>
          Reload
        </Button>
      </p>
    );
  }
  return (
    <div className="struct-notice-again">
      <JobProgress
        job={job}
        starting={starting}
        failed={failedHere}
        stalled={stalled}
        onRun={run}
        onCancel={cancel}
        label={press}
        step="structure"
        icon={<RefreshCw size={13} />}
        runningLabel="Building the structure"
      />
    </div>
  );
}
