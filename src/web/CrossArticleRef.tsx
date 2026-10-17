/**
 * **A citation of a passage in another of the reader's articles** — one that
 * was brought into this conversation with an @-mention. Plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 4.
 *
 * **Not `BlockRef`, on purpose.** `BlockRef` answers for the open article: an
 * id that article lacks is drawn as missing, its address is this page's with
 * `?at=`, and a press calls the open article's `onJump`. All three are wrong
 * here. This takes an address already built from the **server's** slug
 * (`CrossSource.href`, citations.ts § `crossArticles`) and goes there by an
 * ordinary navigation, so the other article opens at that passage. The model's
 * bracket only ever selected the id, among ids the server listed.
 *
 * The chip says the article's short title, because the id alone would not
 * tell the reader they are leaving this article. A second id of the same
 * article in one bracket says only its id, beside the first.
 */
import { ArrowUpRight } from "lucide-react";
import type { MouseEvent } from "react";
import { shortBlockId } from "./BlockRef.js";
import type { CrossSource } from "./citations.js";
import { Link } from "./Link.js";
import { shortTitle } from "./mentions.js";
import { addressAt } from "./router.js";

export function CrossArticleRef({
  id,
  source,
  titled = true,
}: {
  id: string;
  source: CrossSource;
  /** Draw the title (the first id of a run) or only the short id (the rest). */
  titled?: boolean;
}) {
  const short = shortTitle(source.title);
  return (
    <Link
      href={addressAt(source.href, id)}
      className="cross-ref"
      data-cross-article={source.slug}
      aria-label={`${source.title}, passage ${shortBlockId(id)}`}
      data-tip={`Open “${source.title}” at this passage`}
      /* An ancestor's jump handler must never see this click — BlockRef's
         reason. `Link` itself leaves ⌘-click and the rest to the browser. */
      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
    >
      {titled ? short : shortBlockId(id)}
      {titled && <ArrowUpRight size={10} aria-hidden="true" />}
    </Link>
  );
}
