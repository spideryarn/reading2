/**
 * **The article as a numbered thread, in the band beside it.**
 *
 * A page of its own at `/read/<slug>/tweets` from 2026-08-25 until 2026-09-29,
 * when Greg asked for it as an ordinary mode:
 *
 * > instead of it having its own page, it's just going to be a normal mode with
 * > a left-hand column. It could be quite a wide left-hand column if that will
 * > help to make it be readable. And let's also add block links for each tweet
 * > item to relevant place in the text for that tweet item, so that if I'm
 * > reading the tweet item, I can see where in the text it came from.
 * >
 * > — Greg, 2026-09-29 (SPIDERYARN-READING2-5A)
 *
 * So the thread sits in a wide band (`BandShape` `"wide"`, src/web/layout.ts)
 * beside the prose, and each post links to the passages it was drawn from —
 * the one block link, `BlockRef`, which jumps and flashes the paragraph. The
 * old address redirects to `?mode=tweets` (router.ts § `liftLegacyTweets`).
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md.
 *
 * The write half is src/tweets.ts, the read half `GET /api/tweets/:slug`, and
 * the argument for the feature existing at all — including the two vision.md
 * anti-goals it sits next to — is docs/plans/260825g-tweet-thread-page.md.
 * Read that before changing what is on screen here; several things this does
 * *not* do were decided rather than skipped.
 *
 * ## What this refuses to look like
 *
 * No avatars, no handles, no timestamps, no like counts, no gradient header, no
 * emoji pills, no threading line between posts. A mocked-up timeline invites
 * you to read a thread as something a person posted. This is a numbered list
 * of short paragraphs and it should look like one — since 2026-09-29 without a
 * box round each post either, a hairline between them instead, so fifteen
 * posts read as one list rather than fifteen cards.
 *
 * ## The three things that are load-bearing
 *
 *  - **The number is `index + 1`, at the point of display.** Nothing stores a
 *    post number, on purpose (src/types.ts § Tweet).
 *  - **The count is against `thread.limit`, not against 280**, and only an
 *    actual violation is flagged: a page that cries wolf at 190 teaches you to
 *    ignore the flag at 281.
 *  - **`stale` is said out loud.** The thread describes the blocks it was
 *    written from, and those can move underneath it.
 *
 * ## Borrowed back from the original, 2026-08-25
 *
 * The thread's own numbers in a line of prose rather than pills, and a copy
 * button a screen reader can follow. Deliberately left there: the thread
 * summary, the green→amber→red character bar, the threading line, the hover
 * transforms, and "Post to Bluesky", which was a styled button wired to
 * `alert()`.
 *
 * Tailwind utilities, prefixed `tw:` — unprefixed names silently do nothing.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, PenLine, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Article, BlockId, Job, TweetThread } from "../types.js";
import type { PublicTweets } from "../public-types.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import type { UseTweets } from "./useTweets.js";
import { WrittenForYou } from "./WrittenForYou.js";
import { howLong } from "./relative-time.js";

/** How long a copy button says it worked before going back to normal. */
const COPIED_MS = 1600;

/**
 * **Who is reading, and the thread they get — one prop, so the two cannot
 * disagree.** The owner's arm is the whole `useTweets` read and job; the
 * visitor's is the stored thread off the public payload and nothing else, so a
 * visitor's panel has nothing to press that could ask the model.
 * src/web/reader-capability.ts; `FaqAccess` is the sibling.
 */
export type TweetsAccess =
  | { kind: "owner"; owner: UseTweets }
  | { kind: "visitor"; thread: PublicTweets; owner?: never };

export function TweetsPanel({
  access,
  article,
  slug,
  onJump,
}: {
  access: TweetsAccess;
  article: Article;
  slug: string;
  onJump(id: BlockId): void;
}) {
  useRenderCount("TweetsPanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const thread: PublicTweets | null = owner ? owner.thread : access.kind === "visitor" ? access.thread : null;
  const ready = thread !== null && (owner === null || owner.status === "ready");

  return (
    <ModeSurface
      label="Tweets"
      feature="gloss tweets"
      /* **A head only when there is a thread**: the counts and *Copy the
         thread*, which is not the mode's name (new-mode.md § the band's
         chrome). No thread, no row. */
      head={
        ready && thread ? (
          <ThreadCounts thread={thread} article={article}>
            {owner?.thread && (
              <WrittenForYou
                written={owner.thread.profileHash != null}
                changed={owner.profileChanged}
                slug={slug}
                compact
              />
            )}
          </ThreadCounts>
        ) : null
      }
      foot={owner?.thread && ready ? <Provenance thread={owner.thread} owner={owner} /> : null}
    >
      {owner?.error && (
        <div className="tw:px-4 tw:pt-3">
          <p className="gloss-error tw:m-0" role="alert">
            {owner.error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="tw:mt-2"
            onClick={() => void owner.retryRead()}
          >
            <RotateCw size={13} />
            Try again
          </Button>
        </div>
      )}

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for a thread…</p>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has written a thread for this one yet.</p>
          <p className="gloss-hint">
            One model pass over the whole article, and it takes tens of seconds. Written once and kept
            — you will not be asked again unless the article changes.
          </p>
          <Run owner={owner} label="Write the thread" />
        </div>
      )}

      {ready && thread && (
        <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-4">
          {/* The article has moved and the thread has not. Everything below is
              now a claim about a version of the piece that no longer exists, and
              a passage link may land somewhere else. */}
          {owner?.stale && (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This thread describes an older version of the article.
              </p>
              <Run owner={owner} label="Write it again" force />
            </div>
          )}
          {owner && <UnlinkedNote thread={thread} slug={slug} />}
          <ThreadPosts thread={thread} onJump={onJump} />
        </div>
      )}
    </ModeSurface>
  );
}

/** The band's run button: the empty state's, and the stale banner's. */
function Run({ owner, label, force = false }: { owner: UseTweets; label: string; force?: boolean }) {
  return (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      /* The empty state's must be `ensure` — the identical, unforced request
         the automatic run makes — or it buys a second model call. */
      onRun={() => (force ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="tweets"
      icon={<PenLine size={13} />}
      runningLabel="Writing…"
    />
  );
}

/**
 * **A thread written before posts named their passages**, said once and quietly.
 *
 * Every thread stored before `tweets/5` has no `blocks` on any post, so the
 * links this band exists to draw are simply absent — and without a sentence the
 * reader cannot tell "no links" from "broken". Not a banner and not a button:
 * re-running lives in Metadata (260929b), and an older prompt is otherwise not
 * announced (260929c); this is about a feature missing from what is on screen.
 * The owner's alone: a visitor cannot re-run anything.
 */
function UnlinkedNote({ thread, slug }: { thread: PublicTweets; slug: string }) {
  if (thread.tweets.some((t) => t.blocks !== undefined)) return null;
  return (
    <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-muted-foreground">
      Written before posts linked back to the text. Re-run <em>Thread</em> in{" "}
      <a href={readHref(slug, carriedSearch(location.search), "metadata")}>Metadata</a> to get the
      links.
    </p>
  );
}

/**
 * **The thread's three numbers**, said as a sentence, and *Copy the thread*.
 *
 * The document's word count is the one that earns its place: on its own
 * "1,842 characters" is a fact about nothing, and beside 8,275 words it is the
 * compression the reader is being asked to trust. Takes a `PublicTweets`
 * because the counts are arithmetic over the posts, which a visitor has too;
 * `children` is where the owner puts their own provenance label.
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
  /* Summed here rather than stored — the same reason nothing stores a post number. */
  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
  const words = useMemo(() => articleStats(article).words, [article]);

  return (
    <div className="tw:flex tw:w-full tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
      <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
        {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters from{" "}
        {words.toLocaleString()} words
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
 * **The posts themselves**, and the over-limit line above them.
 *
 * One component for the owner and for a visitor: two lists for one thread is
 * how the two drift into two designs for one thing. Each post leads with its
 * number, so a reader part-way down the column can say which post they are on,
 * and ends with the passages it came from — `BlockRef`, the one block link, so
 * a click jumps to the paragraph and flashes it.
 */
export function ThreadPosts({
  thread,
  onJump,
}: {
  thread: PublicTweets;
  onJump(id: BlockId): void;
}) {
  const total = thread.tweets.length;
  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;

  return (
    <>
      {over > 0 && (
        <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-destructive">
          {over === 1 ? "One post is" : `${over} posts are`} over {thread.limit} characters. Nothing
          has been cut — what the model wrote is what is below.
        </p>
      )}

      <ol className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:p-0">
        {thread.tweets.map((tweet, i) => (
          <li
            // Position is the identity: no stored id, no stored number, and two
            // posts can legitimately carry the same text.
            // biome-ignore lint/suspicious/noArrayIndexKey: no id, rebuilt whole
            key={i}
            className="tw:border-b tw:border-border tw:py-4 tw:last:border-b-0"
          >
            {/* `whitespace-pre-line`, because the prompt allows a line break
                inside a post and a paragraph that eats them changes what it says. */}
            <p className="tw:m-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:whitespace-pre-line tw:text-foreground">
              <span className="tw:mr-2 tw:font-mono tw:text-xs tw:text-ink-faint">
                {i + 1}/{total}
              </span>
              {tweet.text}
            </p>
            <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-xs tw:text-ink-faint">
              {tweet.blocks && tweet.blocks.length > 0 && (
                <span className="tweets-from tw:flex tw:flex-wrap tw:items-center tw:gap-x-1.5">
                  <span>From</span>
                  {tweet.blocks.map((id) => (
                    <BlockRef key={id} id={id} onJump={onJump} />
                  ))}
                </span>
              )}
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
 * **The foot: who wrote the thread and when, and a run that is under way.**
 *
 * No standing *Write it again* — Greg, 2026-09-29 (SPIDERYARN-READING2-53):
 * *"let's just rely on the Metadata mode for that."* What stays is the part that
 * was never a button: a job started from Metadata or from the stale banner shows
 * its progress and its Stop here, and a failed one says why.
 */
function Provenance({ thread, owner }: { thread: TweetThread; owner: UseTweets }) {
  const running = !owner.stale && (owner.job || owner.starting);
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:px-4 tw:py-2">
      <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
        Written by {thread.generator} · {thread.version} · {whenWritten(thread.generatedAt)} ·{" "}
        {howLong(thread.elapsedMs)}
      </p>
      {running && <RunFoot job={owner.job} owner={owner} />}
      {!running && !owner.stale && owner.failed && (
        <span className="tw:ml-auto tw:text-xs tw:text-destructive">{owner.failed.message}</span>
      )}
    </div>
  );
}

/** A run under way on a current thread: its progress and its Stop. Failure is `Provenance`'s. */
function RunFoot({ job, owner }: { job: Job | null; owner: UseTweets }) {
  return (
    <span className="tw:w-full">
      <JobProgress
        job={job}
        starting={owner.starting}
        failed={null}
        stalled={owner.stalled}
        onRun={() => owner.regenerate()}
        onCancel={owner.cancel}
        label="Write it again"
        step="tweets"
        icon={<PenLine size={13} />}
        runningLabel="Writing…"
      />
    </span>
  );
}

/**
 * Copy something, and say whether it worked.
 *
 * `navigator.clipboard` needs a secure context, and an iframe or an http origin
 * that is not localhost will reject the write. Saying so is the point: a copy
 * button that silently does nothing is docs/reusable/silent-success.md.
 *
 * One state this cannot report: `writeText` can return a promise that never
 * settles, when the permission prompt has nowhere to appear. A timeout would
 * turn that into a "Couldn't copy" that might be a lie, so it is left alone.
 *
 * `text` is a function so the whole-thread markdown is built on the click.
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
      /* Without it the accessible name comes from `title` and stays on "Copy"
         through every state, so "Couldn't copy" is announced as nothing. */
      aria-label={state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
      onClick={() => {
        // No `?.`: on an origin with no clipboard it would silently do nothing.
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
 * anti-goals by name, and carrying the URL is the cheapest answer to it.
 *
 * The `n/total` prefix belongs here and not on the per-post copy: this is the
 * form you post. A single post copies as its own text, which is what its
 * character count describes.
 */
export function threadMarkdown(thread: PublicTweets, article: Article): string {
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
