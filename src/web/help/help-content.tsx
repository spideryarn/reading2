/**
 * **What Help says, page by page, and the order it says it in.**
 *
 * **The words are Markdown**, one file per anchor under src/web/help/pages/
 * (help-pages.ts loads them, help-markdown.tsx draws them), and this file
 * gathers the four kinds into the one shape the page draws, lists and
 * searches. They were TSX until 2026-10-07; Greg asked for Markdown so that a
 * page is easy to write and easy to hand to a model.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 * What TSX gave, a cross-reference to a page that has gone not compiling, is
 * now a throw when the file is drawn (help-markdown.tsx § targetOf), which
 * tests/help-page.test.tsx reaches by drawing every page.
 *
 * ## What belongs on a page
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
 * A mode's page draws its heading from `MODE_LABEL` and its first two
 * sentences from `MODE_CATALOG` — the same words its band's (i) card shows
 * (BandAbout.tsx § AboutMode) — and then the two things only Help says: when
 * the mode is worth opening, and how to read what it shows. Its line on the
 * contents page is the catalog's too. Restating the catalog in the file would
 * be a second copy to drift. `HELP_MODE_FILES` (help-pages.ts) is a
 * `Record<Mode, …>`, so a new mode without a file is a type error. GPT Sol,
 * plan review of 261002b, R7.
 *
 * ## Search reads the title, the keywords, and then the words
 *
 * `keywords` are written for the words a reader *brings* — "heat", "thick
 * line", "phone", "price" — not for the words the page already uses in its
 * title. Below those the search reads the page's own text, so a remembered
 * phrase finds its page (page-search.ts says why Help does and Metadata does
 * not).
 */
import type { ReactNode } from "react";

import { MODE_CATALOG } from "../../mode-catalog.js";
import { MODES } from "../../modes.js";
import { MODE_LABEL } from "../../title-text.js";
import type { SynonymTable } from "../page-search.js";
import {
  FAQ_IDS,
  HELP_GUIDE_IDS,
  helpAnchorKind,
  modeAnchor,
  type HelpAnchor,
  type HelpAnchorKind,
} from "./help-anchors.js";
import { helpSectionText, renderHelpMarkdown, renderHelpModeHalves } from "./help-markdown.js";
import { HELP_FAQ_PAGES, HELP_GUIDE_PAGES, HELP_MODE_PAGES, HELP_TOPIC_PAGES, helpPage } from "./help-pages.js";
import { HelpSub } from "./help-parts.js";

export { MODE_WHEN } from "./help-mode-when.js";
export { HELP_LINK_CLASS } from "./help-parts.js";

/**
 * **One anchor as the page lists, heads and searches it**, whichever of the
 * four tables it came from. Everything here is a string read from front
 * matter or from the catalog; the words themselves are `helpBody`'s, drawn
 * only for the page that is open.
 */
export interface HelpEntry {
  anchor: HelpAnchor;
  /** Its heading, and its row in every contents list. */
  title: string;
  /**
   * Its one line on the contents page. Null for a question: the question is
   * its own line.
   */
  summary: string | null;
  /** What the search box reads besides the title: `keywords` and `aside`. */
  search: { keywords: string; aside: string };
  /** A mode behind the Experimental switch. Never true of anything else. */
  experimental: boolean;
  /** The pages its *See also* offers, in order. */
  related: readonly HelpAnchor[];
}

/** The line and the search words that differ by kind. */
function entryOf(kind: HelpAnchorKind): Pick<HelpEntry, "title" | "summary" | "search" | "experimental"> {
  switch (kind.kind) {
    case "topic":
    case "guide": {
      const page = kind.kind === "topic" ? HELP_TOPIC_PAGES[kind.id] : HELP_GUIDE_PAGES[kind.id];
      return { title: page.title, summary: page.summary, search: { keywords: page.keywords, aside: "" }, experimental: false };
    }
    case "faq": {
      const page = HELP_FAQ_PAGES[kind.id];
      return { title: page.title, summary: null, search: { keywords: page.keywords, aside: "" }, experimental: false };
    }
    case "mode": {
      const catalog = MODE_CATALOG[kind.mode];
      return {
        title: MODE_LABEL[kind.mode],
        /* The catalog's sentence has no full stop of its own; the (i) card
           and this page have always added it. */
        summary: `${catalog.description}.`,
        search: {
          /* The mode's id as well as its label: they differ for none today,
             but a renamed mode keeps its id in old links and in a reader's
             memory. */
          keywords: [HELP_MODE_PAGES[kind.mode].keywords, ...catalog.aliases, kind.mode].join(" "),
          aside: catalog.description,
        },
        experimental: catalog.experimental,
      };
    }
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** Where every mode's *See also* ends: the table that sets them side by side. */
const WHICH_MODE_WHEN: HelpAnchor = "modes";

function readEntry(anchor: HelpAnchor): HelpEntry {
  const kind = helpAnchorKind(anchor);
  const own = helpPage(anchor).related;
  /* A mode always offers *Which mode when* (the plan, § The pages), whatever
     its file lists, and once. */
  const related = kind.kind === "mode" ? [...own.filter((a) => a !== WHICH_MODE_WHEN), WHICH_MODE_WHEN] : own;
  if (related.includes(anchor)) throw new Error(`Help page ${anchor}: related names itself`);
  return { anchor, ...entryOf(kind), related };
}

const ENTRIES = new Map<HelpAnchor, HelpEntry>();

/** One anchor's entry. Read on first use and kept: the files are constants. */
export function helpEntry(anchor: HelpAnchor): HelpEntry {
  let found = ENTRIES.get(anchor);
  if (found === undefined) {
    found = readEntry(anchor);
    ENTRIES.set(anchor, found);
  }
  return found;
}

/**
 * **One anchor's words, drawn.** A topic's, a question's or a guide's are its
 * file. A mode's are the catalog's two sentences, then each half its file
 * has, under the heading the page has always put there.
 *
 * Drawn when asked for, so opening one page parses one file. A file with
 * something in it that nothing draws throws here, and tests/help-page.test.tsx
 * asks for every one.
 */
export function helpBody(anchor: HelpAnchor): ReactNode {
  const kind = helpAnchorKind(anchor);
  if (kind.kind !== "mode") return renderHelpMarkdown(helpPage(anchor).body, anchor);
  const catalog = MODE_CATALOG[kind.mode];
  const { whenToUse, reading } = renderHelpModeHalves(HELP_MODE_PAGES[kind.mode].body, anchor);
  return (
    <>
      {/* The band's own (i) card, word for word — BandAbout.tsx § AboutMode. */}
      <p className="tw:text-foreground">{catalog.description}.</p>
      <p>{catalog.how}</p>
      {whenToUse !== null && (
        <>
          <HelpSub>When to use it</HelpSub>
          {whenToUse}
        </>
      )}
      {reading !== null && (
        <>
          <HelpSub>Reading it</HelpSub>
          {reading}
        </>
      )}
    </>
  );
}

/**
 * **Everything a page says, as plain text, for the search box's last place to
 * look** (page-search.ts § `SearchableSection.body`): the file's words, and
 * with them what the page shows that is not in the file — a topic's or a
 * guide's line from the contents page, a mode's second catalog sentence. (Its
 * first is already the entry's `aside`.)
 */
export function helpSearchText(anchor: HelpAnchor): string {
  const kind = helpAnchorKind(anchor);
  const extra = kind.kind === "mode" ? MODE_CATALOG[kind.mode].how : (helpEntry(anchor).summary ?? "");
  return `${extra}\n${helpSectionText(anchor)}`;
}

/**
 * One heading on the contents page, and the pages under it in order.
 *
 * `together` is the questions' group and nobody else's: its members are
 * sections of one page (help-anchors.ts § `HELP_QUESTIONS_PAGE`) rather than
 * pages, so the group's heading is the link to it and it has no previous and
 * next.
 */
export interface HelpGroup {
  id: string;
  title: string;
  anchors: readonly HelpAnchor[];
  together: boolean;
}

/**
 * **Help's order.** Every live anchor appears in exactly one group, once —
 * tests/help-page.test.tsx holds that.
 *
 * The modes are in `MODES` order, not the Dock's: the Dock's order lives in
 * `MODES_UI` inside Dock.tsx, which is unexported and would drag the whole
 * reading-view chrome into this lazy chunk to read one list.
 */
export const HELP_GROUPS: readonly HelpGroup[] = [
  { id: "start", title: "Start here", anchors: ["what-it-is-for", "adding-articles", "the-reading-view"], together: false },
  /* Second, so that somebody who knows what they are here to do meets their
     own route before the reference pages. Greg, `spya-ucftjt`. */
  { id: "guides", title: "Ways to read", anchors: HELP_GUIDE_IDS, together: false },
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
    together: false,
  },
  { id: "modes", title: "The modes", anchors: ["modes", ...MODES.map(modeAnchor)], together: false },
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
    together: false,
  },
  { id: "questions", title: "Questions people ask", anchors: FAQ_IDS, together: true },
];

/** The questions' group: the one whose members share a page. */
export const HELP_QUESTIONS_GROUP: HelpGroup = (() => {
  const group = HELP_GROUPS.find((g) => g.together);
  if (group === undefined) throw new Error("Help has no group for the questions");
  return group;
})();

/**
 * **The group a page is in, and the pages either side of it there.** Previous
 * and next stop at the group's ends rather than running on into the next
 * group: the end of "Reading an article" is not a reason to open Chat.
 */
export function helpPlace(anchor: HelpAnchor): { group: HelpGroup; previous: HelpAnchor | null; next: HelpAnchor | null } {
  for (const group of HELP_GROUPS) {
    const at = group.anchors.indexOf(anchor);
    if (at === -1) continue;
    if (group.together) return { group, previous: null, next: null };
    return { group, previous: group.anchors[at - 1] ?? null, next: group.anchors[at + 1] ?? null };
  }
  /* Unreachable while `HELP_ANCHORS` and the groups agree, which
     tests/help-page.test.tsx holds; a throw here is louder than a blank. */
  throw new Error(`Help page ${anchor} is in no group`);
}

/**
 * **Words that mean the same thing in Help**, for its search box — a
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
