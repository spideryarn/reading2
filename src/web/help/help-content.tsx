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
import { MODES } from "../../modes.js";
import type { SynonymTable } from "../page-search.js";
import { FAQ_IDS, modeAnchor, type HelpAnchor } from "./help-anchors.js";

/* **The words live in three files**, one per kind of section, and this file
   gathers them so the page imports from one place. The shared shapes and the
   link components are in help-parts.tsx, which imports none of the words. */
export { HELP_FAQ } from "./help-faq.js";
export { HELP_MODES, MODE_WHEN } from "./help-modes.js";
export { HELP_TOPICS } from "./help-topics.js";
export { HELP_LINK_CLASS, HelpRef, type HelpModeExtra, type HelpSection } from "./help-parts.js";

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
