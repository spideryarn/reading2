/**
 * **What the Help page says**, section by section, and the order it says it in.
 *
 * The words are TSX rather than Markdown because there is no Markdown renderer
 * in the client, and adding one for a page we write ourselves is a dependency
 * for nothing; and because TSX lets a section link to another by a typed
 * anchor (`HelpRef`), so a cross-reference to a section that has gone does not
 * compile. docs/plans/261002b-help-page.md § One static page.
 *
 * ## What belongs in a section
 *
 * The test of every paragraph is the plan's: *would a reader work this out
 * alone in their first week?* If yes, it goes. Greg asked for the rest —
 * *"emphasise the kinds of things that users might not be able to figure out
 * for themselves, help them build intuitions, focus on what's valuable, e.g.
 * how should I interpret the visuals in the Spine?"* (SPIDERYARN-READING2-85).
 * Every product fact is checked against the code, not the feature doc alone,
 * and a fact nobody could confirm is left out rather than guessed.
 *
 * ## The modes say only what the catalog does not
 *
 * A mode's section draws its label from `MODE_LABEL` and its two sentences
 * from `MODE_CATALOG` — the same words its band's (i) card shows (BandAbout.tsx
 * § AboutMode) — and then the two things only Help says: when the mode is worth
 * opening, and how to read what it shows. Restating the catalog here would be
 * a second copy to drift. `HELP_MODES` is a `Record<Mode, …>`, so a new mode
 * without an entry here is a type error. GPT Sol, plan review, R7.
 *
 * ## Search reads `title` and `keywords`, not `body`
 *
 * As on the Metadata page (page-search.ts says why). So `keywords` are written
 * for the words a reader *brings* — "heat", "thick line", "phone", "price" —
 * not for the words the section already uses in its title.
 */
import type { ReactNode } from "react";

import { MODES, type Mode } from "../../modes.js";
import type { SynonymTable } from "../page-search.js";
import { Link } from "../Link.js";
import { CHANGELOG_HREF, CHANGELOG_LABEL, PRICING_HREF, PRIVACY_HREF, PROFILE_HREF } from "../router.js";
import { FAQ_IDS, modeAnchor, type FaqId, type HelpAnchor, type HelpTopic } from "./help-anchors.js";

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
 * `null` until written, and the page draws nothing for a field that is null.
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
export const HELP_LINK_CLASS = "tw:text-highlight tw:no-underline tw:hover:underline";

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

/** A link to another page of the site, in the same style. */
function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={HELP_LINK_CLASS}>
      {children}
    </Link>
  );
}

/**
 * **The general sections.** Total over `HelpTopic`, so a topic id with no
 * section does not compile. One plain sentence each until the full text is
 * written — every one of them true today, because a page that ships with
 * "coming soon" under twenty headings is worse than a short page.
 */
export const HELP_TOPICS: Record<HelpTopic, HelpSection> = {
  "what-it-is-for": {
    title: "What Spideryarn is for",
    keywords: "about purpose why summary deep reading",
    body: (
      <p>
        Spideryarn helps you read an article more deeply. It works alongside the piece rather than
        replacing it with a summary.
      </p>
    ),
  },
  "adding-articles": {
    title: "Adding an article",
    keywords: "add import paste url link pdf upload new save",
    body: <p>You add an article by pasting its address or uploading a PDF, and it joins your shelf.</p>,
  },
  "the-reading-view": {
    title: "The reading view",
    keywords: "layout screen interface overview parts",
    body: (
      <p>
        The reading view is the article itself, with <HelpRef to="spine">the spine</HelpRef> beside
        it and, when you open one of <HelpRef to="modes">the modes</HelpRef>, its panel alongside the
        text.
      </p>
    ),
  },
  spine: {
    title: "Reading the spine",
    keywords: "rail sidebar map marks lines colours heat thick time spent where am i position",
    body: (
      <p>
        The spine is the narrow rail beside the article: a map of the whole piece, part by part, with
        the place you are reading marked on it.
      </p>
    ),
  },
  "jumping-around": {
    title: "Jumping around and getting back",
    keywords: "jump back return previous history where was i",
    body: (
      <p>
        When a link takes you somewhere else in the article, Spideryarn remembers where you were, so
        you can go back.
      </p>
    ),
  },
  gutter: {
    title: "Beside each paragraph",
    keywords: "gutter margin buttons paragraph actions ask bookmark comment",
    body: <p>The gutter beside each paragraph holds what you can do with that paragraph.</p>,
  },
  "linking-to-a-passage": {
    title: "Linking to a passage",
    keywords: "permalink link paragraph send copy address share",
    body: (
      <p>
        Every paragraph has an address of its own, so you can send somebody a link that opens the
        article at that paragraph.
      </p>
    ),
  },
  keyboard: {
    title: "Keyboard shortcuts",
    keywords: "keys hotkeys shortcuts arrows",
    body: <p>Much of the reading view can be used from the keyboard.</p>,
  },
  touch: {
    title: "Phones and tablets",
    keywords: "phone mobile tablet ipad touch swipe small screen",
    body: <p>Spideryarn works on phones and tablets as well as on a computer.</p>,
  },
  "ai-words": {
    title: "The AI’s words and the author’s",
    keywords: "ai model generated trust accurate wrong hallucination author",
    body: (
      <p>
        Some of what you see is written by an AI model rather than by the author of the piece, and
        the article’s own text is never changed.
      </p>
    ),
  },
  "waiting-and-cost": {
    title: "Waiting for a mode",
    keywords: "slow loading wait spinner stuck cost run again",
    body: (
      <p>
        Many modes are written by a model the first time you open them, which can take a little
        while; after that they are stored and open straight away.
      </p>
    ),
  },
  modes: {
    title: "Which mode when",
    keywords: "modes panel band choose which",
    body: <p>Each mode below is a different way into the same article.</p>,
  },
  shelf: {
    title: "Your shelf",
    keywords: "library home list articles topics archive",
    body: <p>Your shelf is the list of every article you have added.</p>,
  },
  sharing: {
    title: "Sharing an article",
    keywords: "share public link send readable anyone",
    body: <p>You can make an article you added readable by anybody who has its link.</p>,
  },
  comments: {
    title: "Comments, notes and bookmarks",
    keywords: "comment note annotate bookmark highlight",
    body: <p>You can bookmark a paragraph, or write a note on it.</p>,
  },
  "reader-profile": {
    title: "Your reader profile",
    keywords: "profile background about me personalise",
    body: (
      <p>
        Your <PageLink href={PROFILE_HREF}>reader profile</PageLink> tells the AI who is reading, so
        what it writes can suit you.
      </p>
    ),
  },
  "experimental-features": {
    title: "Experimental features",
    keywords: "experimental beta labs switch hidden modes",
    body: (
      <p>
        Some modes are still being built, and appear only once you turn on experimental features on
        your <PageLink href={PROFILE_HREF}>profile</PageLink>.
      </p>
    ),
  },
  plans: {
    title: "Plans and the free allowance",
    keywords: "price pay cost money allowance subscription free limit",
    body: (
      <p>
        A free account can add a few articles, and a{" "}
        <PageLink href={PRICING_HREF}>paid plan</PageLink> lets you add more each month.
      </p>
    ),
  },
  "your-data": {
    title: "Your data",
    keywords: "privacy export download delete data",
    body: (
      <p>
        The <PageLink href={PRIVACY_HREF}>privacy page</PageLink> says what we do with your articles,
        notes and profile.
      </p>
    ),
  },
  feedback: {
    title: "Telling us something",
    keywords: "feedback bug report problem contact suggestion",
    body: <p>The Feedback button sends a note straight to the people who build Spideryarn.</p>,
  },
  "whats-new": {
    title: "What’s new",
    keywords: "changelog updates release latest new",
    body: (
      <p>
        Every update to Spideryarn is listed on the{" "}
        <PageLink href={CHANGELOG_HREF}>{CHANGELOG_LABEL}</PageLink> page.
      </p>
    ),
  },
};

/** The questions people ask. Total over `FaqId`, which is empty today. */
export const HELP_FAQ: Record<FaqId, HelpSection> = {};

/**
 * **What Help adds to each mode.** Total over `Mode`: this is the check that
 * keeps the page current for the commonest change there is, a new mode.
 */
export const HELP_MODES: Record<Mode, HelpModeExtra> = {
  plain: { keywords: "", whenToUse: null, reading: null },
  chat: { keywords: "", whenToUse: null, reading: null },
  glossary: { keywords: "", whenToUse: null, reading: null },
  search: { keywords: "", whenToUse: null, reading: null },
  referee: { keywords: "", whenToUse: null, reading: null },
  summary: { keywords: "", whenToUse: null, reading: null },
  diagram: { keywords: "", whenToUse: null, reading: null },
  ideas: { keywords: "", whenToUse: null, reading: null },
  remember: { keywords: "", whenToUse: null, reading: null },
  quotes: { keywords: "", whenToUse: null, reading: null },
  timeline: { keywords: "", whenToUse: null, reading: null },
  debate: { keywords: "", whenToUse: null, reading: null },
  structure: { keywords: "", whenToUse: null, reading: null },
  citations: { keywords: "", whenToUse: null, reading: null },
  faq: { keywords: "", whenToUse: null, reading: null },
  skim: { keywords: "", whenToUse: null, reading: null },
  tweets: { keywords: "", whenToUse: null, reading: null },
  marginalia: { keywords: "", whenToUse: null, reading: null },
};

/** One heading in the contents list, and the sections under it in page order. */
export interface HelpGroup {
  id: string;
  title: string;
  anchors: readonly HelpAnchor[];
}

/**
 * **The page's order.** Every live anchor appears in exactly one group, once —
 * tests/help-page.test.tsx holds that. A group with no anchors (the questions,
 * until they are written) is not drawn.
 *
 * The modes are in `MODES` order, not the Dock's: the Dock's order lives in
 * `MODES_UI` inside Dock.tsx, which is unexported and would drag the whole
 * reading-view chrome into this lazy chunk to read one list.
 */
export const HELP_GROUPS: readonly HelpGroup[] = [
  { id: "start", title: "Start here", anchors: ["what-it-is-for", "adding-articles", "the-reading-view"] },
  {
    id: "reading",
    title: "Reading an article",
    anchors: [
      "spine",
      "jumping-around",
      "gutter",
      "linking-to-a-passage",
      "keyboard",
      "touch",
      "ai-words",
      "waiting-and-cost",
    ],
  },
  { id: "modes", title: "The modes", anchors: ["modes", ...MODES.map(modeAnchor)] },
  {
    id: "account",
    title: "Your shelf and your account",
    anchors: [
      "shelf",
      "sharing",
      "comments",
      "reader-profile",
      "experimental-features",
      "plans",
      "your-data",
      "feedback",
      "whats-new",
    ],
  },
  { id: "questions", title: "Questions people ask", anchors: FAQ_IDS },
];

/**
 * **Words that mean the same thing on this page**, for its search box — a
 * table of its own rather than Metadata's (page-search.ts § SynonymTable).
 * The vocabulary a reader brings to a help page: what they call the spine
 * before they know its name, how they say "price", which device they are on.
 * A word may sit in only one group.
 */
export const HELP_SYNONYMS: SynonymTable = [
  ["spine", "rail", "sidebar", "scrollbar", "minimap", "map"],
  ["heat", "heatmap", "thick", "thickness", "darker", "spent"],
  ["cost", "price", "pay", "money", "allowance", "plan", "subscription", "billing", "charge", "expensive"],
  ["phone", "mobile", "tablet", "touch", "ipad", "iphone", "android", "swipe", "tap"],
  ["shortcut", "keyboard", "key", "hotkey", "keystroke"],
  ["share", "public", "send", "publish"],
  ["ai", "model", "claude", "generated", "llm", "gpt", "machine"],
  ["wait", "slow", "loading", "spinner", "stuck", "progress"],
  ["export", "download", "backup", "json"],
  ["delete", "remove", "erase"],
  ["bug", "problem", "broken", "error", "report", "feedback", "complaint"],
  ["comment", "note", "annotate", "annotation", "highlight", "bookmark"],
  ["add", "import", "paste", "upload", "url"],
  ["changelog", "update", "release", "latest"],
  ["jump", "back", "return", "previous", "history"],
  ["experimental", "beta", "labs", "preview"],
  ["profile", "preference", "setting", "account", "personalise", "personalize"],
];
