/**
 * **An address nobody can read yet, opened by somebody signed in** — and, when
 * it is their own import that has not published, the import instead of *Not
 * shared*. docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § 2. Greg, 2026-10-05 (spya-h7skj5):
 *
 * > While I'm importing a paper, I don't know what the permalink will be, so I
 * > have to wait for it to be finished to be able to bookmark or send it to
 * > someone.
 *
 * The job card now hands that address out early (`JobCard`,
 * src/web/AddArticle.tsx). Before publication the owned read is a 404 and so
 * is the public one, so without this the owner's own bookmark said *"This
 * document isn't shared. If somebody sent you the link, ask them to turn
 * sharing on for it."*
 *
 * ## What decides
 *
 * A queued or running **import** job for this slug in the reader's own job
 * list (`isImportJob`, src/job-state.ts). The list is the reader's alone, so
 * finding one says nothing to anybody about an article that is not theirs.
 *
 * - **Not any live job**: a mode job on some other article of theirs can never
 *   match the slug, but a mode job on *this* slug with the article unreadable
 *   is not an import on its way to making it. GPT Sol's plan review, P2-3.
 * - **A list asked for after the 404**, before saying there is none
 *   (`jobEngine.afterFreshList`, with a poke, as useLateStructure.ts does and
 *   for its reason): a tab holding an old empty list would otherwise say *Not
 *   shared* over an import started in another tab. A job already in the list
 *   is believed at once; only its absence needs the fresh one. P2-4.
 * - **A list that cannot be read is *Not shared*, as before**, not a blank
 *   page: the engine's `error`, or nothing at all after `LIST_WAIT_MS`.
 *
 * ## No way to the add page from here
 *
 * It stays on `/read/<slug>` and draws the job's own card. Arriving at the add
 * page posts a new import, which is the wrong thing to do on behalf of a 404.
 *
 * A signed-out visitor never reaches this file: `ArticlePage` draws them the
 * landing page, and this mounts a job subscription only an owner has.
 */
import { type ReactNode, useEffect, useState } from "react";

import { isImportJob } from "../../job-state.js";
import { STILL_BEING_ADDED, STILL_BEING_ADDED_HEADING } from "../../messages.js";
import { APP_NAME, SEP } from "../../title-text.js";
import type { Job } from "../../types.js";
import { JobCard } from "../AddArticle.js";
import { FeedbackTrigger } from "../FeedbackButton.js";
import { HomeLogo } from "../HomeLogo.js";
import { jobEngine } from "../jobEngine.js";
import { useDocumentTitle } from "../page-title.js";
import { NotSharedPage } from "../PublicChrome.js";
import { LIBRARY_HREF, navigate, readHref } from "../router.js";
import { type UseJobs, useJobs } from "../useJobs.js";

/**
 * How long to wait for the fresh list before saying *Not shared* anyway. The
 * barrier is never called for a failed list or by an engine that is paused, so
 * the wait needs an end of its own. The engine's idle cadence, once over.
 */
export const LIST_WAIT_MS = 8000;

export function OwnerNotShared({
  slug,
  onPublished,
  retryCompleted,
  otherwise,
}: {
  slug: string;
  /** The import is done: read the article again. */
  onPublished: () => void;
  /** One reread may close a race between the access 404 and the job list. */
  retryCompleted: boolean;
  /**
   * **What to draw when it is not this reader's import**: no such job in a
   * fresh list, or a list that could not be read. `NotSharedPage` when left
   * out, as it always was. `ArticlePage` passes the visitor's waiting page
   * when the public read said *still being added*: a shared import is its
   * owner's to see as a card, and anybody else's to wait on (plan 261005l
   * § 2c; GPT Sol's stage 2 plan review, F3).
   */
  otherwise?: ReactNode;
}) {
  /** A list asked for after this page arrived has landed, or the wait for one is over. */
  const [settled, setSettled] = useState(false);
  /* Before `useJobs`, so the subscription's own poll finds this one in flight
     (useLateStructure.ts has the same order, and says why it is one request). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new slug is a new question, and needs a list asked after it.
  useEffect(() => {
    const stop = jobEngine.afterFreshList(() => setSettled(true));
    const giveUp = setTimeout(() => setSettled(true), LIST_WAIT_MS);
    jobEngine.poke();
    return () => {
      stop();
      clearTimeout(giveUp);
      setSettled(false);
    };
  }, [slug]);

  /* A paying subscriber: that is what keeps the engine asking after a failed
     list, and the card below needs the queue's actions anyway. */
  const queue = useJobs("watches-queue");

  /**
   * The job this page is following, once it has found one. By id from then
   * on, so a job that fails stays on screen with its reason and its Retry
   * rather than turning into *Not shared* the moment it stops being live.
   */
  const [followed, setFollowed] = useState<{ slug: string; id: string } | null>(null);
  const live = queue.jobs.find(
    (j) => j.slug === slug && (j.status === "queued" || j.status === "running") && isImportJob(j),
  );
  const liveId = live?.id ?? null;
  useEffect(() => {
    if (liveId !== null) setFollowed({ slug, id: liveId });
  }, [slug, liveId]);
  const followedId = followed?.slug === slug ? followed.id : null;
  const completed = settled && retryCompleted
    ? queue.jobs.find((j) => j.slug === slug && j.status === "done" && isImportJob(j))
    : null;
  const job = live ?? queue.jobs.find((j) => j.id === followedId) ?? completed ?? null;
  const jobId = job?.id ?? null;

  /* `watchTerminal` hears `done` from the list and from `/advance` alike. Any
     other ending leaves the card up, which says why. */
  useEffect(() => {
    if (jobId === null) return;
    return jobEngine.watchTerminal(jobId, (ended) => {
      if (ended.kind === "done") onPublished();
    });
  }, [jobId, onPublished]);

  if (job !== null) {
    return (
      <StillBeingAdded
        job={job}
        queue={queue}
        onRetried={(replacement) => {
          /* A Retry can come back under another slug (`slugForRetry`,
             src/jobs.ts). This address will then never be an article; that
             one's will. */
          if (replacement.slug !== slug) navigate(readHref(replacement.slug), { replace: true });
          else setFollowed({ slug, id: replacement.id });
        }}
      />
    );
  }
  if (settled || queue.error !== null) return otherwise ?? <NotSharedPage />;
  /* Not known yet. The corner pair and nothing else, as `ArticlePage` draws a
     load that is not slow yet: a second of *Not shared* before the import
     appears is the sentence this file exists to stop. */
  return (
    <>
      <HomeLogo />
      <FeedbackTrigger variant="corner" />
    </>
  );
}

function StillBeingAdded({
  job,
  queue,
  onRetried,
}: {
  job: Job;
  queue: UseJobs;
  onRetried: (replacement: Job) => void;
}) {
  useDocumentTitle([STILL_BEING_ADDED_HEADING, APP_NAME].join(SEP));
  return (
    <>
      <HomeLogo />
      <FeedbackTrigger variant="corner" />
      <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
        <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
          {STILL_BEING_ADDED_HEADING}
        </h1>
        {/* Only while it is true. A failed or stopped import says why on its
            card, and "it opens here" would be a promise over it. */}
        {(job.status === "queued" || job.status === "running") && (
          <p className="tw:m-0 tw:mb-4 tw:text-sm tw:text-ink-faint">{STILL_BEING_ADDED}</p>
        )}
        {/* Dismiss leaves for the shelf, as it does on the add page: with the
            card gone there is nothing on this page. */}
        <JobCard
          job={job}
          queue={queue}
          onHide={() => navigate(LIBRARY_HREF)}
          onRetried={onRetried}
        />
      </main>
    </>
  );
}
