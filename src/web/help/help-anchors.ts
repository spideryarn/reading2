/**
 * **Every place on the Help page a link can land**, and the one way to build
 * a link to one.
 *
 * Greg, SPIDERYARN-READING2-85, 2026-10-01: *"lots of anchor links (so we can
 * link directly to places)"*. An anchor is a promise to everybody who copied
 * one — into an email, a reply, a doc, another page of ours — so the rules here
 * are about keeping that promise. docs/plans/261002b-help-page.md.
 *
 * ## Typed, so a link to nowhere does not compile
 *
 * `HelpAnchor` is the union of every live section id, and `helpHref` takes
 * one. Code that links into Help goes through it, so a section renamed or
 * removed turns every link to it red at `npm run typecheck` rather than into a
 * page that opens at the top. The mode anchors are `mode-${Mode}`, built from
 * `MODES` (src/modes.ts) — a new mode has an anchor the moment it exists, and
 * help-content.tsx's `Record<Mode, …>` makes sure it also has a section.
 *
 * ## Append-only: an anchor is never deleted, only redirected
 *
 * Ids are kebab-case, short, and **never renamed once shipped**. When a section
 * has to go or change its name anyway — a mode retired, two topics merged —
 * the old id goes into `HELP_ANCHOR_ALIASES` pointing at its successor, and
 * arriving at the old one lands on the new (HelpPage.tsx § arrive). Modes are
 * the likeliest to move: `hierarchy`, `outline` and `trajectory` already have.
 * tests/help-page.test.tsx § `PINNED_ANCHORS` holds every anchor ever shipped
 * and fails if one stops resolving. GPT Sol, plan review, R2.
 *
 * Plain data and no React, so the code that links here (the Dock, the command
 * bar) can import it without pulling the page's words into its own chunk.
 */
import { MODES, RETIRED_MODES, type Mode } from "../../modes.js";
import { HELP_HREF } from "../router.js";

/**
 * **The general sections, in page order.** Page order is really
 * help-content.tsx's `HELP_GROUPS`; this list is the vocabulary, and a test
 * holds the two to the same members.
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
 * compile, and so `HELP_FAQ` in help-faq.tsx stays total.
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

/** A mode's own section. */
export type ModeAnchor = `mode-${Mode}`;

/** Every place a link into Help may land. */
export type HelpAnchor = HelpTopic | FaqId | ModeAnchor;

export function modeAnchor(mode: Mode): ModeAnchor {
  return `mode-${mode}`;
}

/** Every live anchor, topics then modes then questions. */
export const HELP_ANCHORS: readonly HelpAnchor[] = [
  ...HELP_TOPIC_IDS,
  ...MODES.map(modeAnchor),
  ...FAQ_IDS,
];

/** The address of one section — the only way code should build one. */
export function helpHref(anchor: HelpAnchor): string {
  return `${HELP_HREF}#${anchor}`;
}

/**
 * **Anchors that were shipped and have since moved**, old id → where it went.
 *
 * Every retired mode is here without anybody remembering to add it: a mode
 * leaving `MODES` goes into `RETIRED_MODES` (src/modes.ts) so that its old
 * `?mode=` links keep working, and the same entry keeps its old `#mode-…`
 * link working here. Three of them were never a Help anchor —
 * they retired before the page existed — but a reader who guesses
 * `/help#mode-trajectory` from an old address should land on Skim. Two did
 * ship: `#mode-tweets`, and `#mode-remember`, which was Learn's anchor until
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
 * **What a fragment means**: the live anchor it names, its successor if it
 * names a retired one, or null for anything else. Takes `location.hash` as it
 * comes — with or without the `#`, percent-encoded or not.
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
