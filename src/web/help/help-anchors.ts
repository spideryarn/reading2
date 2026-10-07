/**
 * **Every place in Help a link can land**, the one way to build a link to
 * one, and what an address under `/help` means.
 *
 * Greg, SPIDERYARN-READING2-85, 2026-10-01: *"lots of anchor links (so we can
 * link directly to places)"*. An anchor is a promise to everybody who copied
 * one — into an email, a reply, a doc, another page of ours — so the rules here
 * are about keeping that promise. docs/plans/261002b-help-page.md.
 *
 * **An anchor was a fragment of one long page until 2026-10-07, and is a page
 * now**: `/help/spine`, where it was `/help#spine`. The questions are the
 * exception, kept together on `/help/questions` with each one a fragment of
 * it. The vocabulary did not change, only what `helpHref` returns, and the old
 * addresses are carried over by the page (HelpPage.tsx § Arriving).
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § One file per anchor, and an anchor is still the unit.
 *
 * ## Typed, so a link to nowhere does not compile
 *
 * `HelpAnchor` is the union of every live id, and `helpHref` takes one. Code
 * that links into Help goes through it, so a page renamed or removed turns
 * every link to it red at `npm run typecheck` rather than into a page that
 * says it is not there. The mode anchors are `mode-${Mode}`, built from
 * `MODES` (src/modes.ts) — a new mode has an anchor the moment it exists, and
 * help-pages.ts's `Record<Mode, …>` makes sure it also has a file.
 *
 * ## Append-only: an anchor is never deleted, only redirected
 *
 * Ids are kebab-case, short, and **never renamed once shipped**. When a page
 * has to go or change its name anyway — a mode retired, two topics merged —
 * the old id goes into `HELP_ANCHOR_ALIASES` pointing at its successor, and
 * arriving at the old one lands on the new (`resolveHelpPage` below). Modes
 * are the likeliest to move: `hierarchy`, `outline` and `trajectory` already
 * have. tests/help-page.test.tsx § `PINNED_ANCHORS` holds every anchor ever
 * shipped and fails if one stops resolving. GPT Sol, plan review, R2.
 *
 * Plain data and no React, so the code that links here (the Dock, the command
 * bar) can import it without pulling the page's words into its own chunk.
 */
import { MODES, RETIRED_MODES, type Mode } from "../../modes.js";
import { HELP_HREF } from "../router.js";

/**
 * **The general pages.** Their order on the contents page is help-content.tsx's
 * `HELP_GROUPS`; this list is the vocabulary, and a test holds the two to the
 * same members.
 */
export const HELP_TOPIC_IDS = [
  "what-it-is-for",
  "adding-articles",
  "the-reading-view",
  "spine",
  "jumping-around",
  "gutter",
  "linking-to-a-passage",
  "keyboard",
  "touch",
  "ai-words",
  "waiting-and-cost",
  "modes",
  "shelf",
  "sharing",
  "comments",
  "reader-profile",
  "experimental-features",
  "plans",
  "your-data",
  "feedback",
  "whats-new",
] as const;
export type HelpTopic = (typeof HELP_TOPIC_IDS)[number];

/**
 * **The questions people ask**, each `faq-…`, in page order — drawn from
 * docs/user-feedback/, the things readers have actually been confused by.
 * Typed as a tuple of `faq-` strings so an entry without the prefix does not
 * compile, and so `HELP_FAQ_FILES` in help-pages.ts stays total.
 */
export const FAQ_IDS = [
  "faq-is-the-ai-reading-for-me",
  "faq-why-slow-first-time",
  "faq-does-a-mode-use-my-allowance",
  "faq-missing-parts",
  "faq-beyond-the-article",
  "faq-older-profile",
  "faq-find-archived",
  "faq-shared-personalised",
] as const satisfies readonly `faq-${string}`[];
export type FaqId = (typeof FAQ_IDS)[number];

/**
 * **The guides: a route through the other pages for one kind of reader.**
 * Greg, `spya-ucftjt`, 2026-10-06: *"if you're a reviewer, or if you're a
 * beginner, or, you know, trying to learn a new topic, you know, a student,
 * something like that. Or if you're an expert"*. A guide states no product
 * fact another page does not (the plan, § The four guides).
 */
export const HELP_GUIDE_IDS = ["first-article", "for-students", "for-reviewers", "for-experts"] as const;
export type HelpGuide = (typeof HELP_GUIDE_IDS)[number];

/** A mode's own page. */
export type ModeAnchor = `mode-${Mode}`;

/** Every place a link into Help may land. */
export type HelpAnchor = HelpTopic | FaqId | ModeAnchor | HelpGuide;

/** An anchor with a page of its own: every one but a question. */
export type HelpPageAnchor = Exclude<HelpAnchor, FaqId>;

export function modeAnchor(mode: Mode): ModeAnchor {
  return `mode-${mode}`;
}

/** Every live anchor: topics, modes, questions, guides. */
export const HELP_ANCHORS: readonly HelpAnchor[] = [
  ...HELP_TOPIC_IDS,
  ...MODES.map(modeAnchor),
  ...FAQ_IDS,
  ...HELP_GUIDE_IDS,
];

/**
 * **Which of the four kinds an anchor is**, with the id its table is keyed
 * by (help-pages.ts). The one place an anchor is taken apart, so a fifth kind
 * added to `HelpAnchor` fails to compile at the last line here rather than
 * being taken for a mode by somebody's `else`.
 */
export type HelpAnchorKind =
  | { kind: "topic"; id: HelpTopic }
  | { kind: "mode"; mode: Mode }
  | { kind: "faq"; id: FaqId }
  | { kind: "guide"; id: HelpGuide };

const TOPICS: ReadonlySet<string> = new Set(HELP_TOPIC_IDS);
const FAQS: ReadonlySet<string> = new Set(FAQ_IDS);
const GUIDES: ReadonlySet<string> = new Set(HELP_GUIDE_IDS);

const isTopic = (anchor: HelpAnchor): anchor is HelpTopic => TOPICS.has(anchor);
const isGuide = (anchor: HelpAnchor): anchor is HelpGuide => GUIDES.has(anchor);

export function isFaqId(anchor: HelpAnchor): anchor is FaqId {
  return FAQS.has(anchor);
}

export function helpAnchorKind(anchor: HelpAnchor): HelpAnchorKind {
  if (isTopic(anchor)) return { kind: "topic", id: anchor };
  if (isFaqId(anchor)) return { kind: "faq", id: anchor };
  if (isGuide(anchor)) return { kind: "guide", id: anchor };
  /* What is left is `mode-<id>`, and the compiler agrees: `rest` would not
     take anything else. tests/help-page.test.tsx holds that no other id
     starts with `mode-`, which is what makes the three guards above sound. */
  const rest: ModeAnchor = anchor;
  return { kind: "mode", mode: rest.slice("mode-".length) as Mode };
}

/**
 * **The page the questions share**: `/help/questions`, each question a section
 * of it under its own `faq-…` id. A page per question would be eight pages of
 * one paragraph each (the plan, § What was passed over). Not an anchor: nothing
 * links to the page as a whole but Help's own contents.
 */
export const HELP_QUESTIONS_PAGE = "questions";
export const HELP_QUESTIONS_HREF = `${HELP_HREF}/${HELP_QUESTIONS_PAGE}`;

/**
 * **The address of one anchor — the only way code should build one.** A page
 * of its own, except a question, which is a place on the questions' page.
 */
export function helpHref(anchor: HelpAnchor): string {
  return isFaqId(anchor) ? `${HELP_QUESTIONS_HREF}#${anchor}` : `${HELP_HREF}/${anchor}`;
}

/**
 * **Anchors that were shipped and have since moved**, old id → where it went.
 *
 * Every retired mode is here without anybody remembering to add it: a mode
 * leaving `MODES` goes into `RETIRED_MODES` (src/modes.ts) so that its old
 * `?mode=` links keep working, and the same entry keeps its old `/help#mode-…`
 * and `/help/mode-…` links working here. Three of them were never a Help
 * anchor — they retired before the page existed — but a reader who guesses
 * `/help/mode-trajectory` from an old address should land on Skim. Two did
 * ship: `mode-tweets`, and `mode-remember`, which was Learn's anchor until
 * its id followed its name on 2026-10-06.
 *
 * Hand-written entries go after the spread, each with the date and the
 * reason. Never remove one.
 */
export const HELP_ANCHOR_ALIASES: Readonly<Record<string, HelpAnchor>> = {
  ...Object.fromEntries(
    Object.entries(RETIRED_MODES).map(([old, successor]) => [`mode-${old}`, modeAnchor(successor)]),
  ),
};

const LIVE: ReadonlySet<string> = new Set(HELP_ANCHORS);

function isLive(id: string): id is HelpAnchor {
  return LIVE.has(id);
}

/**
 * **What an id means**: the live anchor it names, its successor if it names a
 * retired one, or null for anything else. Takes `location.hash` as it comes —
 * with or without the `#`, percent-encoded or not — and so also a path
 * segment, which is the same id without the `#`.
 */
export function resolveHelpAnchor(hash: string): HelpAnchor | null {
  let id = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  if (isLive(id)) return id;
  return Object.hasOwn(HELP_ANCHOR_ALIASES, id) ? (HELP_ANCHOR_ALIASES[id] ?? null) : null;
}

/**
 * **What the address `/help/<page>` shows**, `page` being the route's segment
 * (router.ts § `help`), absent for `/help` itself. The router hands the
 * segment over unjudged, so that it imports none of this; here is where it is
 * judged, and the page draws whichever of these comes back.
 *
 * - `moved` is an address that was right once, or nearly: a retired mode's
 *   (`/help/mode-trajectory`), or a question asked for as a page of its own
 *   (`/help/faq-older-profile`). The page replaces the address with
 *   `helpHref(to)`.
 * - `missing` is anything else. Help answers it itself rather than leaving it
 *   to the app's *not found*: the reader was looking for help, and the
 *   contents are the useful thing to put in front of them.
 */
export type HelpView =
  | { kind: "contents" }
  | { kind: "page"; anchor: HelpPageAnchor }
  | { kind: "questions" }
  | { kind: "moved"; to: HelpAnchor }
  | { kind: "missing" };

export function resolveHelpPage(page: string | undefined): HelpView {
  if (page === undefined) return { kind: "contents" };
  if (page === HELP_QUESTIONS_PAGE) return { kind: "questions" };
  const anchor = resolveHelpAnchor(page);
  if (anchor === null) return { kind: "missing" };
  if (anchor !== page || isFaqId(anchor)) return { kind: "moved", to: anchor };
  return { kind: "page", anchor };
}
