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
 * the one block link, `BlockRef`, which jumps and flashes the paragraph.
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md.
 *
 * **One of Summary's three views since 2026-10-03**, not a mode: Greg, *"keep
 * all of the tweet thread. Functionality and UI, just put it within as a
 * submode within summary"* (spya-thpsnd). So this panel is unchanged but for
 * the row of controls Summary hands it to draw on top, and its band's (i) now
 * opens with Summary's words. Both old addresses land on
 * `?mode=summary&summary=thread` (router.ts § `liftLegacyTweets`).
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
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
 * button a screen reader can follow (an icon since 2026-09-30). Deliberately left there: the thread
 * summary, the green→amber→red character bar, the threading line, the hover
 * transforms, and "Post to Bluesky", which was a styled button wired to
 * `alert()`.
 *
 * Tailwind utilities, prefixed `tw:` — unprefixed names silently do nothing.
 */
import { type ReactNode, useMemo } from "react";
import { Check, Copy, PenLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Article, BlockId, Job, TweetThread } from "../types.js";
import type { PublicTweets } from "../public-types.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { AboutMade } from "./BandAbout.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import { useCopy } from "./useCopy.js";
import type { UseTweets } from "./useTweets.js";
import { WrittenForYou } from "./WrittenForYou.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { TipNote, Tooltip } from "./Tooltip.js";
import { BandWaiting } from "./BandWaiting.js";

/** How long a copy button says how it went, a tick or a refusal, before going back to normal. */
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
  controls,
}: {
  access: TweetsAccess;
  article: Article;
  slug: string;
  onJump(id: BlockId): void;
  /**
   * **Summary's Brief | Fuller | Thread row**, drawn as the band's first row —
   * above *Copy the thread* — in the class Summary's own surface uses
   * (`.summ-controls`, summary.css), so the control sits in one place whichever
   * view is showing. The thread is one of Summary's views since 2026-10-03;
   * SummaryMode.tsx hands this in.
   */
  controls?: ReactNode;
}) {
  useRenderCount("TweetsPanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const thread: PublicTweets | null = owner ? owner.thread : access.kind === "visitor" ? access.thread : null;
  const ready = thread !== null && (owner === null || owner.status === "ready");
  /* **A head only when there is a thread**: *Copy the thread*, which is not
     the mode's name (mode.md § the band's chrome). No thread, no row. The
     counts that were here are in the (i), with who wrote it — spya-ucu35y —
     and the owner's profile badge is in the corner beside it since 2026-10-02
     (plan 261002e). */
  const head = ready && thread ? <ThreadHead thread={thread} article={article} /> : null;
  const hasControls = controls !== undefined && controls !== null;

  return (
    <ModeSurface
      /* The band is Summary's: `tweets` left `MODES` on 2026-10-03, so the (i)
         opens with Summary's own words and then this view's `about`. */
      label="Summary"
      mode="summary"
      /* `summ` because the band is Summary's, as its paragraphs' band is
         (SummaryMode.tsx § `SummarySurface`); `gloss tweets` are this panel's
         own styles (glossary.css § tweets). */
      feature="summ gloss tweets"
      /* `ModeSurface` draws its `head` first, and the controls have to come
         before it; so under a control row the head is drawn below, in the
         same `.band-head`. */
      head={hasControls ? null : head}
      profile={
        ready && owner?.thread ? (
          <WrittenForYou
            written={owner.thread.profileHash != null}
            changed={owner.profileChanged}
            slug={slug}
            /* The forced run replaces the thread (plan 261002b). */
            regenerate={{
              run: () => void owner.regenerate(),
              busy: owner.job !== null || owner.starting || owner.rewriting,
              refresh: () => owner.refresh(),
            }}
          />
        ) : null
      }
      about={
        <TweetsAbout thread={ready ? thread : null} article={article} made={ready ? (owner?.thread ?? null) : null} />
      }
      foot={owner?.thread && ready ? <RunRow owner={owner} /> : null}
    >
      {hasControls && <div className="summ-controls">{controls}</div>}
      {hasControls && head && <div className="band-head">{head}</div>}
      {owner?.error && (
        <ReadError
          error={owner.error}
          onRetry={owner.retryRead}
          className="tw:m-0 tw:pl-4 tw:pr-[calc(1rem_+_var(--band-about-room))] tw:pt-3"
        />
      )}

      {owner?.status === "loading" && <BandWaiting className="gloss-quiet">Looking for a thread…</BandWaiting>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has written a thread for this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Written once and kept
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

/**
 * **A rewrite has finished and its thread is not here yet.** Every forced
 * control gives way to a read, never to a second paid run — rewrite-hold.ts.
 */
const waitingForRewrite = (owner: UseTweets) =>
  owner.rewriting && !owner.job && !owner.starting && !owner.failed;

function NewThreadWaiting({ owner }: { owner: UseTweets }) {
  return <RewriteWaiting line="The new thread hasn't loaded yet." onRead={owner.refresh} className="tw:m-0" />;
}

/** The band's run button: the empty state's, and the stale banner's. */
function Run({ owner, label, force = false }: { owner: UseTweets; label: string; force?: boolean }) {
  if (force && waitingForRewrite(owner) && !owner.error) return <NewThreadWaiting owner={owner} />;
  return (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      /* The empty state's must be `ensure` — the identical, unforced request
         the automatic run makes — or it buys a second model call. */
      onRun={() => (force ? owner.regenerate() : owner.ensure())}
      /* With `error` set the retry is `ReadError`'s; the button stays held. */
      runDisabled={force && owner.rewriting}
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
 * **The head row: *Copy the thread*.** The thread's numbers were here until
 * 2026-10-01; they are in `TweetsAbout` now (spya-ucu35y). The owner's profile
 * badge was here too, and is in the band's corner since 2026-10-02 (plan
 * 261002e).
 */
export function ThreadHead({ thread, article }: { thread: PublicTweets; article: Article }) {
  return (
    <div className="tw:flex tw:w-full tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
      <CopyButton
        text={() => threadMarkdown(thread, article)}
        label="Copy the thread"
        what="thread"
        tip="Copy the whole thread, each post numbered, with the article's title and link at the top"
        className="tw:ml-auto"
      />
    </div>
  );
}

/**
 * **What the band's (i) says after the mode's own words** (`ModeSurface`'s
 * `mode`): the thread's three numbers, the over-limit caveat, and who wrote it
 * and when.
 *
 * The document's word count is the one that earns its place: on its own
 * "1,842 characters" is a fact about nothing, and beside 8,275 words it is the
 * compression the reader is being asked to trust. The numbers are arithmetic
 * over the posts, which a visitor has too; `made` — who wrote it — is the
 * owner's alone (a visitor's thread carries none of it). All of it was on the
 * band until Greg, 2026-10-01 (spya-ucu35y): *"Move this into a tooltip for a
 * (i) icon in the top-right"*.
 */
export function TweetsAbout({
  thread,
  article,
  made,
}: {
  thread: PublicTweets | null;
  article: Article;
  made: TweetThread | null;
}) {
  const words = useMemo(() => articleStats(article).words, [article]);
  if (!thread) return null;
  const total = thread.tweets.length;
  /* Summed here rather than stored — the same reason nothing stores a post number. */
  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;
  return (
    <>
      <p>
        {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters from{" "}
        {words.toLocaleString()} words.
      </p>
      {over > 0 && (
        <p>
          {over === 1 ? "One post is" : `${over} posts are`} over the {thread.limit}-character limit. Nothing
          has been cut — what the model wrote is what is shown.
        </p>
      )}
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  );
}

/**
 * **The posts themselves.** The over-limit sentence that stood above them is
 * in the (i) since 2026-10-01; each overlong post's own count still turns red.
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

  return (
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
            {/* The post is the model's; a span because `tw:font-prose` on the
                <p> would beat voices.css on the same element. */}
            <span className="tweets-text">{tweet.text}</span>
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
            <CopyButton
              text={() => tweet.text}
              label="Copy this post"
              what="post"
              tip="Copy this post's text"
              className="tw:ml-auto"
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * **The foot: a run that is under way, or one that failed** — and nothing when
 * neither, so a settled thread has no foot at all.
 *
 * No standing *Write it again* — Greg, 2026-09-29 (SPIDERYARN-READING2-53):
 * *"let's just rely on the Metadata mode for that."* A job started from Metadata
 * or from the stale banner shows its progress and its Stop here, and a failed
 * one says why. Who wrote the thread and when was the first line of this foot
 * until 2026-10-01; it is in the (i) now (`TweetsAbout`, spya-ucu35y).
 */
function RunRow({ owner }: { owner: UseTweets }) {
  const running = !owner.stale && (owner.job || owner.starting);
  const failed = !running && !owner.stale && owner.failed;
  /* On a stale thread the banner's own control says it — `Run`. */
  const waiting = !owner.stale && waitingForRewrite(owner) && !owner.error;
  if (!running && !failed && !waiting) return null;
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:px-4 tw:py-2">
      {waiting && <NewThreadWaiting owner={owner} />}
      {running && <RunFoot job={owner.job} owner={owner} />}
      {failed && (
        <span className="tw:ml-auto tw:text-xs tw:text-destructive">{failed.message}</span>
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
 * **An icon, since 2026-09-30**, its words in a tooltip and its name in
 * `aria-label`. Greg (SPIDERYARN-READING2-6H): *"Let's just have the icon. I
 * don't think we need the text copy. Maybe there's a tooltip. Perhaps the same
 * for copy the thread."* — docs/project/icons.md, every icon has a tooltip.
 *
 * Clipboard access can be unavailable, or the browser can refuse a write.
 * Saying so is the point: a copy button that silently does nothing is
 * docs/reusable/silent-success.md. So
 * **a refused copy keeps its words**, visibly, for as long as the state lasts;
 * a tick is enough for one that worked. The status is a sibling of the button,
 * not inside it, so the button stays square, and it is always mounted so a
 * screen reader hears the change.
 *
 * One state this cannot report: `writeText` can return a promise that never
 * settles, when the permission prompt has nowhere to appear. A timeout would
 * turn that into a "Couldn't copy" that might be a lie, so it is left alone.
 *
 * On a touch screen a tap copies at once, and a card a browser shows from the
 * tap's compatibility mouse events closes as it does. Copying is harmless, so
 * there is no reveal-then-commit (docs/project/touch.md).
 *
 * `text` is a function so the whole-thread markdown is built on the click.
 *
 * The write itself is `useCopy`'s: the guard for a browser with no clipboard,
 * the newest-press-wins token and the timer that takes the tick away again are
 * explained once, in useCopy.ts.
 */
function CopyButton({
  text,
  label,
  what,
  tip,
  className,
}: {
  text(): string;
  /** The button's name: stable, whatever the state. */
  label: string;
  /** What is copied, for the status line: "Post copied". */
  what: "post" | "thread";
  /** The tooltip — what the icon cannot say. */
  tip: string;
  className?: string;
}) {
  const { state, copy } = useCopy({ copiedMs: COPIED_MS, failedMs: COPIED_MS });

  const status =
    state === "copied" ? `${what === "post" ? "Post" : "Thread"} copied` : state === "failed" ? `Couldn't copy the ${what}` : "";

  return (
    <span className={`tw:inline-flex tw:items-center tw:gap-1.5 ${className ?? ""}`}>
      <span
        aria-live="polite"
        aria-atomic="true"
        className={state === "failed" ? "tw:text-xs tw:text-destructive" : "tw:sr-only"}
      >
        {status}
      </span>
      {/* Off while the tick or the failure is showing, which closes a card a
          tap opened: on a touch screen nothing else would until the next tap
          elsewhere, and it sat over the post above (WebKit, 2026-09-30).
          `enabled` rather than a conditional wrapper, which would remount the
          button and drop keyboard focus (Tooltip.tsx § `enabled`). */}
      <Tooltip placement="top" enabled={state === "idle"} content={<TipNote>{tip}</TipNote>}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="tw:pointer-coarse:size-10"
          aria-label={label}
          onClick={() => copy(text())}
        >
          {state === "copied" ? (
            <Check size={12} aria-hidden="true" className="tw:text-highlight-text" />
          ) : state === "failed" ? (
            <TriangleAlert size={12} aria-hidden="true" className="tw:text-destructive" />
          ) : (
            <Copy size={12} aria-hidden="true" />
          )}
        </Button>
      </Tooltip>
    </span>
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
