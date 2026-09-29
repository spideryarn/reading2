/**
 * **Tweets mode's controller.** The owner's band and the visitor's.
 *
 * A page of its own until 2026-09-29, when Greg asked for it as a normal mode
 * with a wide left-hand column (SPIDERYARN-READING2-5A;
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
 * FAQ's shape (src/web/modes/faq/FaqMode.tsx), with the same two things missing
 * on purpose: **no passages** — each post's link is a jump through `onJump`, not
 * a selection, so `selectPassages` answers `NOTHING` — and **no URL
 * parameters**.
 */

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
}: {
  slug: string;
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("TweetsBand");
  const owner = useTweets(slug);
  return <TweetsPanel access={{ kind: "owner", owner }} article={article} slug={slug} onJump={onJump} />;
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
}: {
  slug: string;
  thread: PublicTweets;
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("VisitorTweetsBand");
  return (
    <TweetsPanel access={{ kind: "visitor", thread }} article={article} slug={slug} onJump={onJump} />
  );
}
