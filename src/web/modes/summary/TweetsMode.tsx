/**
 * **The thread's controller.** The owner's band and the visitor's — Summary's
 * Thread view since 2026-10-03, mounted by `SummaryBand` and
 * `VisitorSummaryBand` (SummaryMode.tsx, beside this file), which hand in
 * the row of controls drawn above it
 * (docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md).
 *
 * A page of its own until 2026-09-29, then a mode with a wide left-hand column
 * until it moved under Summary (SPIDERYARN-READING2-5A;
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
 * FAQ's shape (src/web/modes/faq/FaqMode.tsx), with the same two things missing
 * on purpose: **no passages** — each post's link is a jump through `onJump`, not
 * a selection, so `selectPassages` answers `NOTHING` — and **no URL
 * parameters** of its own.
 */

import type { ReactNode } from "react";
import type { Article, BlockId } from "../../../types.js";
import type { PublicTweets } from "../../../public-types.js";
import { useRenderCount } from "../../perf.js";
import { useTweets } from "../../useTweets.js";
import { TweetsPanel } from "../../Tweets.js";

/**
 * The thread, and the fetch and job that belong to it — a component of its own
 * because `useTweets` fetches on mount and `useAutoRun`'s owner must die with
 * the band. `useRenderCount("TweetsBand")` is the throw site
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx § WITNESS uses.
 */
export function TweetsBand({
  slug,
  article,
  onJump,
  controls,
}: {
  slug: string;
  article: Article;
  onJump(id: BlockId): void;
  /** Summary's Brief | Fuller | Thread row, drawn above the thread (Tweets.tsx § `controls`). */
  controls?: ReactNode;
}) {
  useRenderCount("TweetsBand");
  const owner = useTweets(slug);
  return (
    <TweetsPanel
      access={{ kind: "owner", owner }}
      article={article}
      slug={slug}
      onJump={onJump}
      controls={controls}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.** The thread came
 * in the page's own payload: no `useTweets`, so no read of `/api/tweets/:slug`,
 * no `useAutoRun` and no job.
 */
export function VisitorTweetsBand({
  slug,
  thread,
  article,
  onJump,
  controls,
}: {
  slug: string;
  thread: PublicTweets;
  article: Article;
  onJump(id: BlockId): void;
  controls?: ReactNode;
}) {
  useRenderCount("VisitorTweetsBand");
  return (
    <TweetsPanel
      access={{ kind: "visitor", thread }}
      article={article}
      slug={slug}
      onJump={onJump}
      controls={controls}
    />
  );
}
