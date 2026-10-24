/**
 * **A mention of another of the reader's conversations, as a link to it** —
 * plan docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md.
 *
 * `CrossArticleRef`'s chip, because it does the same job — takes the reader
 * somewhere else of theirs — and controls that do the same job look the same
 * (controls.md). A speech bubble rather than an arrow says where.
 *
 * **A real link**: ⌘-click opens a tab, the status bar shows where it goes,
 * and a plain click is an in-app navigation, pushed, so Back returns to the
 * conversation the link was in. The address is `threadHref`'s, built from the
 * server's row (`ThreadLink`), never from the answer.
 */
import { MessagesSquare } from "lucide-react";
import type { MouseEvent } from "react";
import type { ThreadLink } from "./citations.js";
import { Link } from "./Link.js";
import { shortTitle } from "./mentions.js";
import { useAddress } from "./router.js";
import { threadHref } from "./thread-links.js";

export function ThreadRef({ link }: { link: ThreadLink }) {
  /* Read here, not by the answer: the address moves as the reader scrolls
     (`?at=`), and only these few chips need to follow it. */
  const address = useAddress();
  return (
    <Link
      href={threadHref(address, link)}
      /* The article stays where it is: only the conversation changes, and the
         target carries the same `?at=`, so nothing would scroll it back. */
      scroll={false}
      className="cross-ref"
      data-thread-link={link.id}
      aria-label={`Your conversation: ${link.title}`}
      data-tip={`Open your conversation “${link.title}”`}
      /* An ancestor's jump handler must never see this click — BlockRef's
         reason. `Link` itself leaves ⌘-click and the rest to the browser. */
      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
    >
      <MessagesSquare size={10} aria-hidden="true" />
      {shortTitle(link.title)}
    </Link>
  );
}
