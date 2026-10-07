/**
 * **The pieces every file of Help's words is built from**: the two shapes a
 * section takes, and the two kinds of link a section may contain.
 *
 * A file of its own so the files of words (help-topics.tsx, help-modes.tsx,
 * help-faq.tsx) and help-content.tsx, which gathers them, all import from one
 * place that imports none of them — no cycle between the words and the index.
 */
import type { ReactNode } from "react";

import { Link } from "../Link.js";
import type { HelpAnchor } from "./help-anchors.js";

/** One section of the page. */
export interface HelpSection {
  /** Its heading, and the row in the contents list. */
  title: string;
  /** The words a reader might search for that the title does not say. */
  keywords: string;
  body: ReactNode;
}

/**
 * **What Help adds to a mode's catalog entry** — the catalog says what the
 * mode is and how it works; these say when to open it and how to read it.
 * The page draws nothing for a field that is null.
 */
export interface HelpModeExtra {
  /** Words to search by, beyond the mode's label and its catalog aliases. */
  keywords: string;
  /** When the mode earns its place — the question it answers best. */
  whenToUse: ReactNode;
  /** How to read what it shows: what a mark, a colour or an order means. */
  reading: ReactNode;
}

/** The link style the plain-prose pages use for a cross-reference. */
export const HELP_LINK_CLASS = "tw:text-highlight-text tw:no-underline tw:hover:underline";

/**
 * **A link from one section to another.** A plain fragment link — never
 * `Link`, which cancels the browser's navigation and so loses Back, reload and
 * Cmd-click — and the page's own `hashchange` listener does the scroll and the
 * flash (HelpPage.tsx § arrive). Typed, so `to` must be a live anchor.
 */
export function HelpRef({ to, children }: { to: HelpAnchor; children: ReactNode }) {
  return (
    <a href={`#${to}`} className={HELP_LINK_CLASS}>
      {children}
    </a>
  );
}

/** A link to another page of the site, in the same style. Pass a router `*_HREF`. */
export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={HELP_LINK_CLASS}>
      {children}
    </Link>
  );
}

/**
 * **Where a link to a Help anchor points**, decided by whoever draws the page
 * rather than by the words. The Markdown files hold the final addresses
 * (`/help/spine`), and while Help is still one page the page maps each back
 * to `#spine`; once every anchor has a page of its own this is `helpHref`.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § One file per anchor.
 */
export type HelpHrefFor = (anchor: HelpAnchor) => string;

/** Help as one page: every anchor is a fragment of it. `HelpRef`'s address. */
export const onePageHref: HelpHrefFor = (anchor) => `#${anchor}`;

/**
 * **A link to a Help anchor, at whatever address `hrefFor` gave it.** A
 * fragment is a plain `<a>`, for `HelpRef`'s reason; a path is another page,
 * which is the router's `Link`. One component so the words drawn from Markdown
 * and the "Which mode when" table cannot disagree about which is which.
 */
export function HelpAnchorLink({ href, children }: { href: string; children: ReactNode }) {
  if (!href.startsWith("#")) return <PageLink href={href}>{children}</PageLink>;
  return (
    <a href={href} className={HELP_LINK_CLASS}>
      {children}
    </a>
  );
}

/** A small subheading inside a section: a mode's "When to use it". */
export function HelpSub({ children }: { children: ReactNode }) {
  return (
    <h4 className="tw:m-0 tw:mt-1 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
      {children}
    </h4>
  );
}
