/**
 * **The two small pieces Help's words are drawn with**: its link and its
 * subheading. A file of its own so the renderer (help-markdown.tsx), the
 * *Which mode when* table (help-mode-when.tsx) and the page (HelpPage.tsx) all
 * import them from one place that imports none of those.
 */
import type { ReactNode } from "react";

import { Link } from "../Link.js";

/** The link style the plain-prose pages use for a cross-reference. */
export const HELP_LINK_CLASS = "tw:text-highlight-text tw:no-underline tw:hover:underline";

/**
 * **A link in Help's words**, to another page of Help or of the site. The
 * router's `Link`, so it moves without a page load and a ⌘-click still opens
 * a tab. Pass `helpHref(anchor)` or a router `*_HREF`.
 *
 * A link to a place on the page already open (a question from the questions'
 * page) is this too: HelpPage.tsx § `onClickCapture` takes that click before
 * `Link` sees it, so that the page does not jump to the top on its way there.
 */
export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={HELP_LINK_CLASS}>
      {children}
    </Link>
  );
}

/**
 * A subheading inside a page: a mode's "When to use it", a guide's steps. An
 * `h2`, because the page's own title is the `h1` above it.
 */
export function HelpSub({ children }: { children: ReactNode }) {
  return (
    <h2 className="tw:m-0 tw:mt-1 tw:font-sans tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
      {children}
    </h2>
  );
}
