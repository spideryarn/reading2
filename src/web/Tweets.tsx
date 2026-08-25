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
 * Tailwind utilities rather than a block in styles.css, exactly as Metadata.tsx
 * does it: this page is chrome, and chrome is what Tailwind is here for
 * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
 * the `tw:` prefix — unprefixed names silently do nothing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Loader2, PenLine, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Article, Job, ThreadResponse, TweetThread } from "../types.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { carriedSearch, readHref } from "./router.js";
import { useJobs } from "./useJobs.js";

/** Clear of the fixed bottom bar, stated against `--dock-h`. See Metadata.tsx. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-h)_+_2rem)]";

/** How long a copy button says it worked before going back to normal. */
const COPIED_MS = 1600;

type Loaded =
  | { status: "loading" }
  /** The article has no thread yet. A 404, and an ordinary one — most articles have none. */
  | { status: "none" }
  | { status: "ready"; thread: TweetThread; stale: boolean }
  | { status: "error"; message: string };

export function Tweets({ slug, article }: { slug: string; article: Article }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      const { thread, stale } = body as ThreadResponse;
      setLoaded({ status: "ready", thread, stale });
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

  async function write() {
    setStartedId(null);
    const started = await queue.run({ slug, steps: ["tweets"] });
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
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-10 tw:font-sans ${DOCK_CLEARANCE}`}>
        <Link
          href={backHref}
          className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          Back to the article
        </Link>

        <h1 className="tw:m-0 tw:font-serif tw:text-2xl tw:leading-snug tw:text-foreground">
          {article.meta.title}
        </h1>

        {loaded.status === "loading" && (
          <p className="tw:mt-6 tw:text-sm tw:text-muted-foreground">Looking…</p>
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
  onWrite(): void;
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
 * The button, or the running job in its place.
 *
 * The step's own `label` and `detail` come off the server, so the text here is
 * the same text the add box shows — "Step 1 of 1" would tell you neither what
 * is slow nor what is about to fail (see AddArticle.tsx).
 */
function Progress({
  job,
  failed,
  onWrite,
  onCancel,
  label,
}: {
  job: Job | null;
  failed: string | null;
  onWrite(): void;
  onCancel(id: string): void;
  label: string;
}) {
  if (job) {
    const step = job.steps.find((s) => s.name === "tweets");
    return (
      <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-foreground">
        <Loader2 size={13} className="tw:animate-spin tw:text-highlight" />
        <span>
          {job.status === "queued" ? "Waiting for the queue…" : (step?.label ?? "Writing…")}
        </span>
        {step?.detail && <span className="tw:text-ink-faint">— {step.detail}</span>}
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
      <Button type="button" variant="outline" size="sm" onClick={onWrite}>
        <PenLine size={13} />
        {label}
      </Button>
      {failed && <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive">{failed}</p>}
    </>
  );
}

/** The thread itself: the posts, and the two ways to copy them. */
function Thread({
  thread,
  stale,
  article,
  job,
  failed,
  onWrite,
  onCancel,
}: {
  thread: TweetThread;
  stale: boolean;
  article: Article;
  job: Job | null;
  failed: string | null;
  onWrite(): void;
  onCancel(id: string): void;
}) {
  const total = thread.tweets.length;
  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;

  return (
    <>
      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          A thread, {total} {total === 1 ? "post" : "posts"}
        </p>
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
          <Progress
            job={job}
            failed={failed}
            onWrite={onWrite}
            onCancel={onCancel}
            label="Write it again"
          />
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
            <p className="tw:m-0 tw:font-serif tw:text-[0.95rem] tw:leading-relaxed tw:whitespace-pre-line tw:text-foreground">
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

      <p className="tw:mt-6 tw:mb-0 tw:text-xs tw:text-ink-faint">
        Written by {thread.generator} · {thread.version} · {whenWritten(thread.generatedAt)}
      </p>
    </>
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
      {state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
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
