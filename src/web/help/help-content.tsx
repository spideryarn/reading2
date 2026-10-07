/**
 * **What the Help page says**, section by section, and the order it says it in.
 *
 * **The words are Markdown**, one file per section under src/web/help/pages/
 * (help-pages.ts loads them, help-markdown.tsx draws them), and this file
 * turns them into the shapes the page has always drawn. They were TSX until
 * 2026-10-07; Greg asked for Markdown so that a page is easy to write and easy
 * to hand to a model.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 * What TSX gave, a cross-reference to a section that has gone not compiling,
 * is now a throw when the file is drawn (help-markdown.tsx § targetOf), which
 * tests/help-page.test.tsx reaches by rendering the page.
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
 * a second copy to drift. `HELP_MODE_FILES` (help-pages.ts) is a
 * `Record<Mode, …>`, so a new mode without a file is a type error. GPT Sol,
 * plan review, R7.
 *
 * ## Search reads `title` and `keywords`, not `body`
 *
 * As on the Metadata page (page-search.ts says why). So `keywords` are written
 * for the words a reader *brings* — "heat", "thick line", "phone", "price" —
 * not for the words the section already uses in its title.
 */
import { MODES, type Mode } from "../../modes.js";
import type { SynonymTable } from "../page-search.js";
import { FAQ_IDS, HELP_TOPIC_IDS, modeAnchor, type FaqId, type HelpAnchor, type HelpTopic } from "./help-anchors.js";
import { renderHelpMarkdown, renderHelpModeHalves } from "./help-markdown.js";
import { byId, HELP_FAQ_PAGES, HELP_MODE_PAGES, HELP_TOPIC_PAGES } from "./help-pages.js";
import { onePageHref, type HelpHrefFor, type HelpModeExtra, type HelpSection } from "./help-parts.js";

export { MODE_WHEN } from "./help-mode-when.js";
export { HELP_LINK_CLASS, HelpRef, type HelpModeExtra, type HelpSection } from "./help-parts.js";

/**
 * **One section from its file**, with its links pointing wherever `hrefFor`
 * says. Functions as well as the three tables below, because where a link
 * points is the page's decision (help-parts.tsx § HelpHrefFor) and the words
 * should not have to be loaded twice to change it.
 */
export function helpTopicSection(id: HelpTopic, hrefFor: HelpHrefFor): HelpSection {
  const page = HELP_TOPIC_PAGES[id];
  return { title: page.title, keywords: page.keywords, body: renderHelpMarkdown(page.body, hrefFor, id) };
}

export function helpFaqSection(id: FaqId, hrefFor: HelpHrefFor): HelpSection {
  const page = HELP_FAQ_PAGES[id];
  return { title: page.title, keywords: page.keywords, body: renderHelpMarkdown(page.body, hrefFor, id) };
}

export function helpModeExtra(mode: Mode, hrefFor: HelpHrefFor): HelpModeExtra {
  const page = HELP_MODE_PAGES[mode];
  return { keywords: page.keywords, ...renderHelpModeHalves(page.body, hrefFor, modeAnchor(mode)) };
}

/* **Help as one page**, which is what it still is: every link to another
   section is a fragment. Drawn once, when the Help chunk loads; the words are
   constants. A file with something in it that nothing draws throws here, so it
   fails every test that imports the page rather than one section of it. */

/** The general sections. Total over `HelpTopic`. */
export const HELP_TOPICS: Record<HelpTopic, HelpSection> = byId(HELP_TOPIC_IDS, (id) => helpTopicSection(id, onePageHref));
/** What Help adds to each mode. Total over `Mode`. */
export const HELP_MODES: Record<Mode, HelpModeExtra> = byId(MODES, (m) => helpModeExtra(m, onePageHref));
/** The questions people ask. Total over `FaqId`. */
export const HELP_FAQ: Record<FaqId, HelpSection> = byId(FAQ_IDS, (id) => helpFaqSection(id, onePageHref));

/** One heading in the contents list, and the sections under it in page order. */
export interface HelpGroup {
  id: string;
  title: string;
  anchors: readonly HelpAnchor[];
}

/**
 * **The page's order.** Every live anchor appears in exactly one group, once —
 * tests/help-page.test.tsx holds that. A group with no anchors is not drawn.
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
  ["wait", "slow", "loading", "spinner", "stuck", "progress", "long"],
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
