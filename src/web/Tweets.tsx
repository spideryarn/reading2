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
 * — is docs/plans/tweet-thread-page.md. Read that before changing what is on
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
 *    docs/plans/tweet-thread-page.md#what-is-still-open left the rest open on
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, PenLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Article, Job, ThreadResponse, TweetThread } from "../types.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import { useJobs } from "./useJobs.js";
import { useSlow } from "./useSlow.js";
import { readJson } from "./lib/api.js";
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import { useHasProfile } from "./useProfile.js";

/** Clear of the fixed bottom bar, stated against `--dock-h`. See Metadata.tsx. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-h)_+_2rem)]";

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
  const slow = useSlow(loaded.status === "loading");

  /**
   * Fetch the thread. Its own endpoint rather than a field on the article — see
   * docs/plans/tweet-thread-page.md#as-built-where-this-plan-met-the-code: most
   * articles have no thread, so carrying one on the article payload would make
   * every reader of every article download a `null`.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tweets/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        setLoaded({ status: "none" });
        return;
      }
      const { thread, stale, profileChanged } = await readJson<ThreadResponse>(res);
      setLoaded({ status: "ready", thread, stale, profileChanged });
    } catch (err) {
      setLoaded({ status: "error", message: (err as Error).message });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The queue, because writing a thread is half a minute of model time and this
   * repo has one for exactly that (docs/project/ingest-queue.md).
   *
   * `onFinished` rather than watching for a status change: the hook already
   * knows which jobs it has announced and which were merely on the shelf when
   * the page opened, so a reload does not refetch once per historical job.
   *
   * **The cost, said out loud:** `useJobs` polls the whole job list and never
   * stops, so sitting on a finished thread page is one small request every
   * eight seconds for something this page has no use for. That was the price of
   * not writing a second poller, and it buys the paragraph below — a run
   * started in another tab or from the CLI shows up here as progress rather
   * than as a button that appears to do nothing. If it ever matters, the fix is
   * an idle switch in `useJobs`, not a private hook here.
   */
  const onFinished = useCallback(
    (job: Job) => {
      if (job.slug === slug && writesThread(job)) void load();
    },
    [slug, load],
  );
  const queue = useJobs(onFinished);

  /**
   * The job writing this article's thread, if one is.
   *
   * Found in the polled list rather than remembered from the click, which is
   * what makes a run started somewhere else — another tab, `npm run tweets` —
   * show up here as progress rather than as a button that appears to do
   * nothing. `enqueue` hands back the job already in flight for an identical
   * request, so pressing the button twice cannot start a second one.
   */
  const job = useMemo(
    () =>
      queue.jobs
        .filter((j) => j.slug === slug && writesThread(j))
        .find((j) => j.status === "queued" || j.status === "running") ?? null,
    [queue.jobs, slug],
  );

  /**
   * What went wrong, in the two quite different ways it can.
   *
   * `postFailed` is the request never landing: no job exists, so nothing will
   * ever arrive in the list to explain the silence.
   *
   * `startedId` is the other one, and it is the reason this is not just a
   * boolean. A job that fails leaves the running set, so without it the button
   * would simply reappear as though nothing had happened — the model call
   * failed and the page shrugged. Scoped to the job **this page started**, so
   * an old failure from another day is not dug up and presented as news.
   */
  const [postFailed, setPostFailed] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const stopped = useMemo(() => {
    const mine = startedId ? queue.jobs.find((j) => j.id === startedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, startedId]);

  /**
   * Ask for a thread.
   *
   * `force` is the difference between "write one" and "write this one again".
   * Without it the step's own freshness check (`threadIsCurrent` in
   * src/tweets.ts) is the arbiter, which is right for an absent thread and
   * right for a stale one — it agrees the artefact is out of date, so an
   * ordinary run really does rewrite it. It is *wrong* for a thread that is
   * perfectly current: the step would report "already done" and the page would
   * sit there having apparently done nothing. `force: ["tweets"]` is how the
   * footer's rewrite says "I know, do it anyway".
   *
   * Forcing a step forces every step after it (`cascadeForce`, src/jobs.ts).
   * That is harmless here only because `tweets` is last in `STEP_ORDER` and is
   * the sole step in this job — worth knowing before adding a second name to
   * the array.
   */
  async function write(force = false, useProfile = true) {
    setStartedId(null);
    const started = await queue.run({
      slug,
      steps: ["tweets"],
      ...(force ? { force: ["tweets" as const] } : {}),
      // Only when false, so absent goes on meaning yes — src/routes.ts.
      ...(useProfile ? {} : { useProfile: false }),
    });
    setPostFailed(started === null);
    if (started) setStartedId(started.id);
  }

  /* `queue.error` is read here at render and not inside `write`, where it would
     be the value from the render that created the closure — the hook sets it
     during the same `await`, so reading it there gives you the *previous*
     error, or null, which is how a failed request ends up reported as nothing
     at all. */
  const failed = postFailed ? (queue.error ?? "Couldn't start the job.") : stopped;

  const backHref = readHref(slug, carriedSearch(location.search), "article");

  return (
    <>
      {/* `pt-14` rather than `pt-10`: the corner wordmark is fixed
          (HomeLogo.tsx), so on a window narrow enough that this centred column
          reaches the left edge it would otherwise sit on the back-link. */}
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-14 tw:font-sans ${DOCK_CLEARANCE}`}>
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

        {loaded.status === "none" && (
          <Empty job={job} failed={failed} onWrite={write} onCancel={queue.cancel} />
        )}

        {loaded.status === "ready" && (
          <Thread
            thread={loaded.thread}
            stale={loaded.stale}
            profileChanged={loaded.profileChanged}
            article={article}
            job={job}
            failed={failed}
            onWrite={write}
            onCancel={queue.cancel}
          />
        )}
      </main>

      {/* No `drawer` prop, so Questions is a link back to the article — the
          same arrangement as the metadata page, and for the same reason. See
          Dock.tsx. */}
      <Dock slug={slug} view="tweets" />
    </>
  );
}

/** Is this job one that would write a thread? */
function writesThread(job: Job): boolean {
  return job.steps.some((s) => s.name === "tweets");
}

/**
 * No thread yet, and the button that writes one.
 *
 * **A button, not an effect.** Theirs generated automatically when the page
 * became visible, and the effect that did it re-fired on every failure —
 * generating, failing, generating again, for as long as you left the tab open.
 * Greg asked for a button, which removes that bug structurally rather than by
 * remembering to set a flag on every error path.
 */
function Empty({
  job,
  failed,
  onWrite,
  onCancel,
}: {
  job: Job | null;
  failed: string | null;
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
  failed: string | null;
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
  onWrite,
  onCancel,
}: {
  thread: TweetThread;
  stale: boolean;
  profileChanged: boolean;
  article: Article;
  job: Job | null;
  failed: string | null;
  onWrite(force?: boolean, useProfile?: boolean): Promise<void>;
  onCancel(id: string): void;
}) {
  const hasProfile = useHasProfile();
  // Seeded from what the thread on screen was written with; the artefact is
  // the memory, so nothing here has to be.
  const [withProfile, setWithProfile] = useState(thread.profileHash != null);
  const total = thread.tweets.length;
  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;
  /* Summed here rather than stored. It is the array's own arithmetic, and a
     `chars` total in the artefact would be a second copy of a fact the posts
     already carry — the same reason nothing stores a post number. */
  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
  const words = useMemo(() => articleStats(article).words, [article]);

  return (
    <>
      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
        {/* Three numbers, borrowed from their pill row and said as a sentence.
            The document's word count is the one that earns its place: on its
            own "1,842 characters" is a fact about nothing, and beside 8,275
            words it is the compression the reader is being asked to trust. */}
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          A thread, {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters
          from {words.toLocaleString()} words
        </p>
        {/* Provenance, beside the counts rather than in a banner: it describes
            what is on screen. src/web/WrittenForYou.tsx. */}
        <WrittenForYou written={thread.profileHash != null} changed={profileChanged} />
        <CopyButton
          text={() => threadMarkdown(thread, article)}
          label="Copy the thread"
          className="tw:ml-auto"
        />
      </div>

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
              disabled={job !== null}
            />
            <Progress
              job={job}
              failed={failed}
              onWrite={() => onWrite(false, withProfile)}
              onCancel={onCancel}
              label="Write it again"
            />
          </div>
        </div>
      )}

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
 * Write the thread again when there is nothing wrong with it.
 *
 * Theirs had this as a "Reset" button beside the title, one click, always
 * there. The plan left it out for a stated reason —
 * docs/plans/tweet-thread-page.md#what-is-still-open: *"it is a model call one
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
 */
function Rewrite({
  job,
  failed,
  onWrite,
  onCancel,
}: {
  job: Job | null;
  failed: string | null;
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
      {failed && <span className="tw:text-xs tw:text-destructive">{failed}</span>}
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
export function threadMarkdown(thread: TweetThread, article: Article): string {
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
