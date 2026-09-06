/**
 * The article as a numbered thread, at `/read/<slug>/tweets`.
 *
 * > The Tweet Thread view (which also needs its own `/read/[slug]/tweets/` url)
 * >
 * > — Greg, 2026-08-25
 *
 * The write half is src/tweets.ts, the read half is `GET /api/tweets/:slug`,
 * and the whole argument for the feature existing at all — including the two
 * vision.md anti-goals it sits next to, and what this page has to do about them
 * — is docs/plans/260825g-tweet-thread-page.md. Read that before changing what is on
 * screen here; several of the things this page does *not* do were decided
 * rather than skipped.
 *
 * ## What this page refuses to look like
 *
 * No avatars, no handles, no timestamps, no like counts, no gradient header, no
 * emoji pills, no threading line between cards. The version this was borrowed
 * from had all of them, and a mocked-up timeline invites you to read a thread
 * as something a person posted. This is a numbered list of short paragraphs and
 * it should look like one — dark, quiet, typographic
 * (docs/project/design-css-overview.md).
 *
 * ## The three things that are load-bearing
 *
 *  - **The number is `index + 1`, at the point of display.** Nothing stores a
 *    post number, on purpose (src/types.ts § Tweet), because two copies of one
 *    fact can only ever disagree.
 *  - **The count is against `thread.limit`, not against 280.** The artefact
 *    carries the limit it was counted against, so a thread written under an
 *    older limit still reports itself honestly. Only an actual violation is
 *    flagged: a 190-character post is not a warning about anything, and a page
 *    that cries wolf at 190 teaches you to ignore the flag at 281.
 *  - **`stale` is said out loud.** The thread describes the blocks it was
 *    written from, and those can move underneath it. Their version could not
 *    answer this question at all.
 *
 * ## What was borrowed back from theirs, 2026-08-25
 *
 * A second pass over `components/tweet-thread-view.tsx` in the original repo,
 * looking for what this page had left behind. Three things came across, none of
 * them the gradients:
 *
 *  - **A thread that can be rewritten when it is fine.** Theirs had a "Reset"
 *    button at all times; ours had one only when the thread had gone stale, and
 *    docs/plans/260825g-tweet-thread-page.md#what-is-still-open left the rest open on
 *    the grounds that a model call should not be one click away. It is now two
 *    clicks away instead — see `Rewrite` — which answers the objection rather
 *    than living with the gap.
 *  - **The thread's own numbers.** Theirs put the post count, the characters in
 *    the thread and the characters in the document in a row of pills. The three
 *    facts were the good part; the pills were not. Ours says them in a line of
 *    prose, and adds the elapsed time, which the artefact has stored since the
 *    first run and nothing has ever shown.
 *  - **A copy button a screen reader can follow.** Theirs changed its
 *    `aria-label` with its state. Ours changed only its visible text, inside a
 *    button whose accessible name came from `title` — so the announcement never
 *    moved off "Copy".
 *
 * Deliberately left there: the thread summary (cut on purpose, see the plan's
 * as-built §6), the green→amber→red character bar (it cries wolf at 190), the
 * threading line between cards, the hover scale transforms, and "Post to
 * Bluesky", which was a fully styled button wired to `alert()`.
 *
 * Tailwind utilities rather than a block in styles.css, exactly as Metadata.tsx
 * does it: this page is chrome, and chrome is what Tailwind is here for
 * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
 * the `tw:` prefix — unprefixed names silently do nothing.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, PenLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THREAD_RECHECK_FAILED } from "../messages.js";
import type { Article, Job, ThreadResponse, TweetThread } from "../types.js";
import type { PublicTweets } from "../public-types.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { recordLog } from "./log-buffer.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { useSlow } from "./useSlow.js";
import { apiFetch, readJson } from "./lib/api.js";
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import { useHasProfile } from "./useProfile.js";
import { useExperimental } from "./useExperimental.js";

/** Clear of the fixed bottom bar, stated against `--dock-h`. See Metadata.tsx. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-space)_+_2rem)]";

/** How long a copy button says it worked before going back to normal. */
const COPIED_MS = 1600;

type Loaded =
  | { status: "loading" }
  /** The article has no thread yet. A 404, and an ordinary one — most articles have none. */
  | { status: "none" }
  | { status: "ready"; thread: TweetThread; stale: boolean; profileChanged: boolean }
  | { status: "error"; message: string };

export function Tweets({ slug, article }: { slug: string; article: Article }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  /**
   * A read that failed **while something was already on screen**.
   *
   * Separate from `loaded`, because the union cannot hold both a thread and a
   * failure and the reader needs both: what is on the page is still the best
   * this app has, and the fact that we could not check for a newer version is
   * worth a line rather than a silence. See the catch in `load`.
   *
   * **It holds a sentence from src/messages.ts, never the error.** It used to
   * hold `(err as Error).message` and interpolate it into a line written here,
   * which put *"Failed to fetch"* in front of somebody who came to read an
   * article — docs/project/copy.md's first rule, and its rule about where these
   * sentences live, both broken by one line. The raw message goes to the
   * console instead. See `THREAD_RECHECK_FAILED`.
   */
  const [reloadError, setReloadError] = useState<string | null>(null);
  const slow = useSlow(loaded.status === "loading");

  /* **The bar is told which modes this reader sees; it does not go and get it.**
     One shared store behind the hook, so this page and the reading view cannot
     disagree for the length of a toggle. Dock.tsx § experimental. */
  const experimental = useExperimental();

  /* The tab: the article first, then which of its pages this is — and `Tweets`
     rather than `Thread`, because that is what the button in the Dock says.
     See src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "tweets" }));

  /**
   * Fetch the thread. Its own endpoint rather than a field on the article — see
   * docs/plans/260825g-tweet-thread-page.md#as-built-where-this-plan-met-the-code: most
   * articles have no thread, so carrying one on the article payload would make
   * every reader of every article download a `null`.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/tweets/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        setLoaded({ status: "none" });
        setReloadError(null);
        return;
      }
      const { thread, stale, profileChanged } = await readJson<ThreadResponse>(res);
      if (!current()) return;
      setLoaded({ status: "ready", thread, stale, profileChanged });
      setReloadError(null);
    } catch (err) {
      /* Nothing is said about a read this page has moved on from — not the
         console line, not the log record, not the sentence. */
      if (!current()) return;
      const message = (err as Error).message;
      /* **The raw message stops here.** lib/api.ts logs every failure it
         *builds*, and the sentence it builds is safe to show — but the
         commonest failure on this path is a `TypeError` out of `fetch` that it
         never sees, and that one is the browser's own words. So it is written
         to the console, once, and the reader is told something they can act on
         instead. docs/project/logging.md describes the same split for the
         server. */
      console.error(`[tweets] could not read the thread for ${slug}`, err);
      /* **This one reaches neither the global handler nor `AppBoundary`.** It is
         caught here and turned into a sentence, which is right for the reader
         and means nothing anywhere else knows it happened — so without this line
         a thread that will not load is a bug report with an empty timeline
         behind it. The name only; the message is what the console line above is
         for. See src/web/log-buffer.ts. */
      recordLog({
        kind: "client-error",
        source: "tweets",
        name: err instanceof Error ? err.name : "Error",
      });
      /* **A failed reload must not take the thread away.** `load` is not only
         the opening read — `onFinished` below calls it again when a job
         finishes — and the posts render only in the `ready` branch, so
         replacing the whole union with `{status:"error"}` left a reader who was
         mid-thread with a message where the thread had been. Only the opening
         read has nothing to fall back on; the rest keep what they have and say
         so in `reloadError`. Same guard, same reason, as useGlossary.ts §
         `fetchNow`.
         `error` is in the condition as well as `loading`, so a page that is
         already showing a failure shows the *current* one: a second read can
         fail for a different reason than the first, and the recheck line below
         is deliberately hidden in this branch rather than said twice. */
      setLoaded((was) =>
        was.status === "loading" || was.status === "error" ? { status: "error", message } : was,
      );
      setReloadError(THREAD_RECHECK_FAILED.message);
    }
  }, [slug]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     seven other artefact readers — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * The queue, because writing a thread is half a minute of model time and this
   * repo has one for exactly that (docs/project/ingest-queue.md).
   *
   * **All of it is in the hook now** — src/web/useStepJob.ts. The job memo, the
   * two-clause `writesThread` filter, `postFailed`/`startedId`/`stopped` and
   * the `failed` expression were written out here longhand and were the fourth
   * copy of the same ninety lines; the hook's own docstring says which of the
   * four each paragraph came from. Two things this page knew and the other
   * three did not — that forcing a step forces every step after it, and that
   * `tweets` must be named rather than forced positionally — went into
   * `StepRun.force` there, which is where they are true of all four.
   *
   * The one that mattered was `failed`. This page read `queue.error` at render,
   * which is right for a frame: `error` is shared with the poller and a failed
   * POST's own `finally` starts the poll that clears it, so the server's reason
   * for refusing a job was replaced by "Couldn't start the job." before anyone
   * could read it. The hook snapshots it out of `queue.lastFailure()` instead.
   * `tests/refused-job-reason-survives.test.tsx` mounts this page whole and
   * drives that sequence with the polls held.
   */
  const queue = useStepJob(slug, "tweets", refresh);
  /* Destructured because the four surfaces below took `job` and `failed` as
     props long before the hook existed, and threading `queue` through them
     would be a rename of this file's whole render for no gain. `cancel` stays
     on `queue`, where the two call sites read it. */
  const { job, failed, stalled } = queue;

  /**
   * Ask for a thread.
   *
   * `force` is the difference between "write one" and "write this one again".
   * Without it the step's own freshness check — the `tweets` step's `stamp` in
   * src/pipeline.ts — is the arbiter, which is right for an absent thread and
   * right for a stale one — it agrees the artefact is out of date, so an
   * ordinary run really does rewrite it. It is *wrong* for a thread that is
   * perfectly current: the step would report "already done" and the page would
   * sit there having apparently done nothing. The footer's rewrite is how a
   * reader says "I know, do it anyway", and `StepRun.force` in useStepJob.ts is
   * what that turns into.
   */
  async function write(force = false, useProfile = true) {
    await queue.start({ force, useProfile });
  }

  /**
   * **The reader pressed Tweets in the bar and there is no thread — write one.**
   *
   * The rule every mode band follows (src/web/useAutoRun.ts), applied to the one
   * page in the app that is not a mode. Greg, 2026-09-06: *"by opening the mode,
   * the user is implicitly indicating that they want what's already generated,
   * or to generate it if needed."* The press itself is minted in the bar, on
   * `Link.onNavigate` rather than `onClick` so a ⌘-click cannot arm a tab that
   * is staying put — Dock.tsx, beside the Tweets link.
   *
   * **The unforced verb, written out.** `useAutoRun` requires it: `work_key` is
   * computed from the request *including* `force`, so an automatic run and a
   * press on the footer's Rewrite during the same second are two requests that
   * `enqueueOrGet` will not collapse, and the reader pays twice. Spelling the
   * arguments here rather than passing `write` means a later reader cannot make
   * it forced by changing a default two lines up.
   *
   * **An inline arrow is fine and is not a re-render hazard** — `useAutoRun`
   * holds this in a ref it rewrites every render, precisely so that a caller
   * which rebuilds the function cannot re-fire the effect. The press is what
   * fires it.
   *
   * `reload`, not `write`, for the last argument: a read that *failed* is not an
   * answer to *is there a thread*, so it is answered by reading again rather
   * than by spending. useAutoRun.ts § A failed read is not an answer — and this
   * page needs that way out, because its `error` branch draws a sentence and no
   * run button at all, so the bar is the only control left.
   *
   * **The return value is dropped**, alone among the callers, and that is right:
   * `automatic` exists so a panel can say *Using your profile* instead of
   * drawing a tickbox it has already decided, and this page's empty state has no
   * tickbox to replace — it never offered one. What the thread was written with
   * is stated afterwards by `<WrittenForYou>`, out of the artefact itself, which
   * is a stronger claim than a note about the run.
   */
  useAutoRun(slug, "tweets", loaded.status, () => write(false, true), reload);

  const backHref = readHref(slug, carriedSearch(location.search), "article");

  return (
    <>
      {/* 2.5rem since 2026-09-06: the rem above it was room for the corner
          wordmark, which is in this page's `Dock` now and no longer above this
          element. `--safe-top` stays, for the clock rather than for the
          wordmark. See Metadata.tsx, which carries the whole note. */}
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(2.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}>
        <Link
          href={backHref}
          className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          Back to the article
        </Link>

        <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {article.meta.title}
        </h1>

        {/* See useSlow.ts: silent until the wait is worth mentioning, then the
            step by name. */}
        {loaded.status === "loading" && slow && (
          <p className="tw:mt-6 tw:text-sm tw:text-muted-foreground">
            Looking for a thread for this article…
          </p>
        )}

        {loaded.status === "error" && (
          <p className="tw:mt-6 tw:text-sm tw:text-destructive">{loaded.message}</p>
        )}

        {/* A reload failed behind something that is still on screen. Muted
            rather than destructive, and below the title rather than over the
            thread: nothing the reader is looking at has been lost, we just
            could not check whether there is a newer one. Not shown in the
            `error` branch above, which is the same failure said once already.
            The sentence is `THREAD_RECHECK_FAILED` and comes from
            src/messages.ts — see the note on `reloadError`. */}
        {loaded.status !== "error" && reloadError && (
          <p className="tw:mt-6 tw:mb-0 tw:text-xs tw:text-muted-foreground">{reloadError}</p>
        )}

        {loaded.status === "none" && (
          <Empty
            job={job}
            failed={failed}
            stalled={stalled}
            onWrite={write}
            onCancel={queue.cancel}
          />
        )}

        {loaded.status === "ready" && (
          <Thread
            thread={loaded.thread}
            stale={loaded.stale}
            profileChanged={loaded.profileChanged}
            article={article}
            job={job}
            failed={failed}
            stalled={stalled}
            onWrite={write}
            onCancel={queue.cancel}
          />
        )}
      </main>

      {/* No `drawer` prop, so Questions is a link back to the article — the
          same arrangement as the metadata page, and for the same reason. See
          Dock.tsx. */}
      <Dock slug={slug} view="tweets" experimental={experimental} />
    </>
  );
}

/**
 * No thread yet, and the button that writes one.
 *
 * **A button, and since 2026-09-06 not only a button.** Both halves of that
 * sentence have a history worth keeping.
 *
 * Theirs generated automatically when the page became visible, and the effect
 * that did it re-fired on every failure — generating, failing, generating again,
 * for as long as you left the tab open. Greg asked for a button, which removed
 * that bug structurally rather than by remembering to set a flag on every error
 * path.
 *
 * What has changed is that the button is no longer the *only* structural fix.
 * `jobEngine.beginAutoAttempt` is one automatic attempt per `(slug, target)` per
 * session and `claimActivation` ties the spend to a real press — both written
 * after this comment was, for the modes, and both closing exactly that loop. So
 * arriving here by pressing Tweets in the bar writes the thread on its own
 * (§ `useAutoRun` at the top of this file), and this button stays for the two
 * cases the automatic run does not cover: a reader who arrived without pressing
 * — a pasted link, a Back step — and a reader whose automatic attempt failed.
 *
 * A failed attempt does not re-arm anything. The one try is spent, the button is
 * here, and pressing it is a person rather than a loop.
 */
function Empty({
  job,
  failed,
  stalled,
  onWrite,
  onCancel,
}: {
  job: Job | null;
  failed: StepFailure | null;
  stalled: boolean;
  onWrite(): Promise<void>;
  onCancel(id: string): void;
}) {
  return (
    <div className="tw:mt-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-5">
      <p className="tw:m-0 tw:text-sm tw:text-foreground">
        Nobody has written a thread for this one yet.
      </p>
      <p className="tw:mt-2 tw:mb-4 tw:text-xs tw:text-muted-foreground">
        It is one model call over the whole article, and it takes tens of seconds. Written once and
        kept — you will not be asked again unless the article changes.
      </p>
      <Progress
        job={job}
        failed={failed}
        stalled={stalled}
        onWrite={onWrite}
        onCancel={onCancel}
        label="Write the thread"
      />
    </div>
  );
}

/**
 * The thread page's run button. `onWrite` rather than `onRun` because that is
 * what this page's callers already call it; the shared component underneath
 * does not care.
 */
function Progress({
  onWrite,
  ...props
}: {
  job: Job | null;
  failed: StepFailure | null;
  stalled: boolean;
  onWrite(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  return (
    <JobProgress
      {...props}
      onRun={onWrite}
      step="tweets"
      icon={<PenLine size={13} />}
      runningLabel="Writing…"
    />
  );
}

/** The thread itself: the posts, and the two ways to copy them. */
function Thread({
  thread,
  stale,
  profileChanged,
  article,
  job,
  failed,
  stalled,
  onWrite,
  onCancel,
}: {
  thread: TweetThread;
  stale: boolean;
  profileChanged: boolean;
  article: Article;
  job: Job | null;
  failed: StepFailure | null;
  stalled: boolean;
  onWrite(force?: boolean, useProfile?: boolean): Promise<void>;
  onCancel(id: string): void;
}) {
  const hasProfile = useHasProfile(thread.slug);
  // Seeded from what the thread on screen was written with; the artefact is
  // the memory, so nothing here has to be.
  const [withProfile, setWithProfile] = useState(thread.profileHash != null);
  return (
    <>
      <ThreadCounts thread={thread} article={article}>
        {/* Provenance, beside the counts rather than in a banner: it describes
            what is on screen. src/web/WrittenForYou.tsx. Owner-only, because
            `profileHash` never leaves the server. src/public-types.ts. */}
        <WrittenForYou
          written={thread.profileHash != null}
          changed={profileChanged}
          slug={thread.slug}
        />
      </ThreadCounts>

      {/* The article has moved and the thread has not. Said plainly, at the
          top, because everything below it is now a claim about a version of
          the piece that no longer exists. The button offers the fix, and needs
          no `force`: the step's own freshness check already knows this thread
          is out of date, so asking for it again really does rewrite it. */}
      {stale && (
        <div className="tw:mt-4 tw:rounded-md tw:border tw:border-border tw:bg-card tw:p-4">
          <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-foreground">
            <TriangleAlert size={14} className="tw:shrink-0 tw:text-destructive" />
            This thread describes an older version of the article.
          </p>
          <p className="tw:mt-1 tw:mb-3 tw:text-xs tw:text-muted-foreground">
            The text was re-fetched or re-extracted after the thread was written, so the posts below
            may quote something that is no longer there.
          </p>
          <div className="gloss-run">
            <UseProfile
              checked={withProfile}
              onChange={setWithProfile}
              hasProfile={hasProfile}
              slug={thread.slug}
              disabled={job !== null}
            />
            <Progress
              job={job}
              failed={failed}
                stalled={stalled}
              onWrite={() => onWrite(false, withProfile)}
              onCancel={onCancel}
              label="Write it again"
            />
          </div>
        </div>
      )}

      <ThreadPosts thread={thread} />

      {/* A hairline and then the provenance: the end of the thread, said with a
          rule rather than with their "🏁 End of thread" pill. In a list of
          fifteen cards the reader does want to know they have reached the
          bottom; it just does not need an emoji to say so. */}
      <div className="tw:mt-8 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:border-t tw:border-border tw:pt-4">
        <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
          Written by {thread.generator} · {thread.version} · {whenWritten(thread.generatedAt)} ·{" "}
          {howLong(thread.elapsedMs)}
        </p>
        {/* Only when the thread is fine. A stale one already has a button, at
            the top, inside the paragraph explaining why it needs pressing —
            two of them would be one too many, and the wrong one is the one
            further from the reason. */}
        {!stale && (
          <>
            {/* Beside the deliberate rewrite, which is where the spend already
                has a confirmation of its own. src/web/WrittenForYou.tsx. */}
            <UseProfile
              checked={withProfile}
              onChange={setWithProfile}
              hasProfile={hasProfile}
              slug={thread.slug}
              disabled={job !== null}
            />
            <Rewrite
              job={job}
              failed={failed}
              onWrite={(force) => onWrite(force, withProfile)}
              onCancel={onCancel}
            />
          </>
        )}
      </div>
    </>
  );
}

/**
 * **The thread's three numbers**, said as a sentence.
 *
 * Borrowed back from the original version's pill row, 2026-08-25: the three
 * facts were the good part and the pills were not. The document's word count is
 * the one that earns its place — on its own "1,842 characters" is a fact about
 * nothing, and beside 8,275 words it is the compression the reader is being
 * asked to trust.
 *
 * **Shared with the visitor's page**, which is why it takes a `PublicTweets`
 * rather than the whole artefact: the counts are arithmetic over the posts, and
 * a visitor is looking at the same posts. `children` is where the owner puts
 * their own provenance label, which a visitor has none of.
 */
export function ThreadCounts({
  thread,
  article,
  children,
}: {
  thread: PublicTweets;
  article: Article;
  children?: ReactNode;
}) {
  const total = thread.tweets.length;
  /* Summed here rather than stored. It is the array's own arithmetic, and a
     `chars` total in the artefact would be a second copy of a fact the posts
     already carry — the same reason nothing stores a post number. */
  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
  const words = useMemo(() => articleStats(article).words, [article]);

  return (
    <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
        A thread, {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters
        from {words.toLocaleString()} words
      </p>
      {children}
      <CopyButton
        text={() => threadMarkdown(thread, article)}
        label="Copy the thread"
        className="tw:ml-auto"
      />
    </div>
  );
}

/**
 * **The posts themselves** — one numbered card each, and the over-limit line
 * above them.
 *
 * One component for the owner and for a visitor, which is the rule the whole of
 * slice 1b follows: the hooks need two components, the thing on screen does not.
 * Two lists for one thread is how the two drift into two designs for one thing.
 * src/web/reader-capability.ts.
 *
 * It takes a `PublicTweets` — `limit` and the posts — because that is every
 * field it reads. The provenance footer is the owner's and lives in `Thread`.
 */
export function ThreadPosts({ thread }: { thread: PublicTweets }) {
  const total = thread.tweets.length;
  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;

  return (
    <>
      {/* Only a real violation. `thread.limit` and not 280: the artefact says
          what it was counted against, and a thread written under a different
          limit should not be re-judged under this one. */}
      {over > 0 && (
        <p className="tw:mt-4 tw:mb-0 tw:text-xs tw:text-destructive">
          {over === 1 ? "One post is" : `${over} posts are`} over {thread.limit} characters. Nothing
          has been cut — what the model wrote is what is below.
        </p>
      )}

      <ol className="tw:mt-6 tw:mb-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
        {thread.tweets.map((tweet, i) => (
          <li
            // Position is the identity here — there is no stored id and no
            // stored number, and two posts can legitimately carry the same
            // text. The list is rebuilt whole on every load.
            // biome-ignore lint/suspicious/noArrayIndexKey: no id, rebuilt whole
            key={i}
            className="tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
          >
            {/* `whitespace-pre-line`, because the prompt allows a line break
                inside a post and a paragraph that eats them changes what the
                post says. */}
            <p className="tw:m-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:whitespace-pre-line tw:text-foreground">
              {tweet.text}
            </p>
            <div className="tw:mt-3 tw:flex tw:items-center tw:gap-3 tw:text-xs tw:text-ink-faint">
              <span className="tw:font-mono">
                {i + 1}/{total}
              </span>
              <span
                className={`tw:font-mono ${tweet.chars > thread.limit ? "tw:text-destructive" : ""}`}
                title={
                  tweet.chars > thread.limit
                    ? `Over the ${thread.limit}-character limit by ${tweet.chars - thread.limit}`
                    : undefined
                }
              >
                {tweet.chars}/{thread.limit}
              </span>
              <CopyButton text={() => tweet.text} label="Copy" className="tw:ml-auto" />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Write the thread again when there is nothing wrong with it.
 *
 * Theirs had this as a "Reset" button beside the title, one click, always
 * there. The plan left it out for a stated reason —
 * docs/plans/260825g-tweet-thread-page.md#what-is-still-open: *"it is a model call one
 * click away, and nothing else in the app spends money that easily"* — and then
 * the gap became its own problem, because the only way to replace a thread you
 * did not like was to change the article underneath it.
 *
 * So: two clicks, not one, and at the foot of the page rather than beside the
 * title. The confirm step is the whole answer to the objection — it is not a
 * dialog, it does not block anything, and it says what the click costs before
 * you have spent it. The foot of the page is also simply where the thought
 * occurs: you have just read the last post.
 *
 * `busy` covers the gap between the click and the job appearing in the polled
 * list, which is a round trip during which `job` is still null. Without it the
 * confirm row vanishes and the plain button comes back — a press that appears
 * to have been ignored, which is the failure this whole page keeps guarding
 * against (docs/reusable/silent-success.md).
 *
 * It used to say here that it does not show the job that refused it, unlike
 * every other run button in the app. Nothing refuses a run any more — a second
 * job on one article queues
 * (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
 * § 1g) — so there is no gap left to state.
 */
function Rewrite({
  job,
  failed,
  onWrite,
  onCancel,
}: {
  job: Job | null;
  failed: StepFailure | null;
  onWrite(force?: boolean): Promise<void>;
  onCancel(id: string): void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (job) {
    return (
      <span className="tw:ml-auto tw:w-full">
        <Progress
          job={job}
          failed={null}
          /* Unreachable here: this branch only renders with a job of our own,
             and one article cannot have two active ones. See the header for why
             this strip does not show a blocker at all. */
          stalled={false}
          onWrite={() => onWrite(true)}
          onCancel={onCancel}
          label="Write it again"
        />
      </span>
    );
  }

  if (asking) {
    return (
      <span className="tw:ml-auto tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground">
        <span>Another model call, and this one is not out of date.</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // `true`: the step's freshness check would otherwise skip a thread
            // that is, by construction, perfectly current.
            await onWrite(true);
            setBusy(false);
            setAsking(false);
          }}
        >
          {busy ? "Starting…" : "Rewrite"}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="tw:ml-auto tw:flex tw:items-center tw:gap-3">
      {failed && <span className="tw:text-xs tw:text-destructive">{failed.message}</span>}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        title="Throw this thread away and write another one"
        onClick={() => setAsking(true)}
      >
        <PenLine size={12} />
        Write it again
      </Button>
    </span>
  );
}

/**
 * Copy something, and say whether it worked.
 *
 * `navigator.clipboard` needs a secure context, and an iframe or an http origin
 * that is not localhost will reject the write. Saying so is the point: a copy
 * button that silently does nothing is textbook
 * docs/reusable/silent-success.md, and the reader would find out by pasting the
 * wrong thing somewhere else.
 *
 * One state this cannot report, found while checking the page under browser
 * automation: `writeText` can return a promise that never settles at all, when
 * the clipboard permission prompt has nowhere to appear. Neither handler runs
 * and the button sits on "Copy". A timeout would turn that into a "Couldn't
 * copy" that might be a lie — the write may yet land — so it is left alone and
 * written down here instead.
 *
 * `text` is a function rather than a string so the whole-thread markdown is
 * built on the click rather than on every render.
 */
function CopyButton({
  text,
  label,
  className,
}: {
  text(): string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={className}
      title={label}
      /* Borrowed from theirs, which was the one accessibility detail this page
         had left behind. Without it the button's accessible name comes from
         `title` and stays on "Copy" through every state, so the outcome — and
         especially "Couldn't copy", the state this component exists to report —
         is announced to a screen reader as nothing at all. */
      aria-label={state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
      onClick={() => {
        // The `?.` was doing real damage: on an origin with no clipboard at
        // all the expression is `undefined`, nothing is thrown, and the button
        // stays on "Copy" for ever — the failure this component exists to
        // report, reported as nothing happening.
        if (!navigator.clipboard) {
          setState("failed");
          return;
        }
        navigator.clipboard
          .writeText(text())
          .then(() => setState("done"))
          .catch(() => setState("failed"));
      }}
    >
      {state === "done" ? <Check size={12} className="tw:text-highlight" /> : <Copy size={12} />}
      {/* `aria-live` as well as the label, because the label changing is not an
          announcement unless something is watching the region. `polite`, so it
          waits its turn rather than interrupting whatever is being read. */}
      <span aria-live="polite">
        {state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
      </span>
    </Button>
  );
}

/**
 * The whole thread, as Markdown, with the article's title and URL at the top.
 *
 * **The source line is not decoration.** A generated summary loose on the
 * internet with no path back to what it summarises is one of vision.md's
 * anti-goals by name, and carrying the URL is the cheapest possible answer to
 * it. The original version did this too, and it is the one part of their copy
 * format worth keeping exactly.
 *
 * The `n/total` prefix belongs here and not on the per-post copy: this is the
 * form you post, so the numbering is part of it. A single post copies as its
 * own text alone, which is what its character count describes — the count and
 * the clipboard should not disagree.
 *
 * Exported for tests: this is the only pure thing on the page, and it is the
 * part that has a right answer.
 */
export function threadMarkdown(thread: PublicTweets, article: Article): string {
  const head = [article.meta.title, article.meta.url].filter(Boolean).join("\n");
  const posts = thread.tweets.map((t, i) => `${i + 1}/${thread.tweets.length} ${t.text}`);
  return [head, ...posts].join("\n\n");
}

/**
 * `6.1s`, or `1m 12s` once it gets long enough for seconds to stop being
 * readable.
 *
 * `elapsedMs` has been in the artefact since the first run and nothing has ever
 * shown it. It is worth showing for the reason the borrow list gives for timing
 * every model call from the outside: the original asked the SDK for its own
 * timings, got empty values back, and rendered them as `0ms` — a duration that
 * reads as "instant" rather than as "we don't know". A number nobody looks at
 * is a number nobody notices going wrong.
 */
export function howLong(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** `25 Aug 2026`, or nothing readable if the artefact's timestamp is not one. */
function whenWritten(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "at an unknown time";
  return new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
