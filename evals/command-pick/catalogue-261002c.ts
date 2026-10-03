/**
 * **RETIRED 2026-10-03 — nothing imports this.** Kept so the first run's saved
 * answers (`results/jev.json`, `results/chat.json`, `results/summary.md`) can
 * still be read against the ids they were measured with. The list the eval
 * uses now is ./catalogue.ts, read from the bar's own rows.
 *
 * **A hand-copied snapshot of the command bar's rows, 2026-10-02** — the
 * fixture for plan 261002c Stage D. NOT the registry.
 *
 * Copied by reading src/web/CommandBar.tsx, src/mode-catalog.ts (descriptions,
 * aliases), src/title-text.ts § `MODE_LABEL`, src/web/sub-modes.ts and
 * src/rerun-steps.ts (with Metadata.tsx § `RERUN_LABEL`), plus the rows plan
 * 261002c Stages A–B add that are not built yet (`planned` below). Descriptions
 * are shortened in places, and only eight of the sixteen sub-modes are here.
 * It will drift from the app the day anything is renamed, and nothing checks it.
 *
 * **A production interface model must serialise the real registry** (the
 * "serialisable command descriptor" of the vision doc, Sol's F10), never a copy
 * like this one. This file exists only so the eval can be rerun as it was.
 */

export type CommandKind = "mode" | "sub-mode" | "page" | "action" | "rerun" | "section";

export interface CatalogueCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly kind: CommandKind;
  /** Only `find` takes one: the words to look for. */
  readonly takesArgument: boolean;
  /** A row plan 261002c adds that the bar does not have yet. */
  readonly planned?: true;
}

const mode = (id: string, label: string, description: string, aliases: string[]): CatalogueCommand => ({
  id,
  label,
  description,
  aliases,
  kind: "mode",
  takesArgument: false,
});

const sub = (id: string, label: string, description: string): CatalogueCommand => ({
  id,
  label,
  description,
  aliases: [],
  kind: "sub-mode",
  takesArgument: false,
});

/* Metadata.tsx § RERUN_LABEL, in METADATA_RERUN_STEPS order. */
const RERUN: readonly (readonly [string, string])[] = [
  ["arc", "Arc"],
  ["tweets", "Thread"],
  ["glossary", "Glossary"],
  ["quotes", "Quotes"],
  ["ideas", "Ideas"],
  ["timeline", "Timeline"],
  ["quiz", "Quiz"],
  ["faq", "FAQ"],
  ["sketch", "Sketch"],
  ["skim", "Skim"],
  ["debate", "Debate"],
  ["citations", "Citations"],
  ["crossrefs", "Cross-references"],
  ["simple", "Simple summary"],
];

export const CATALOGUE: readonly CatalogueCommand[] = [
  mode("mode:plain", "Plain", "Just the article — no columns, no panel", ["article", "text", "reading"]),
  mode("mode:chat", "Chat", "Ask about this article — answers point back at the paragraphs they came from", ["ask", "question"]),
  mode("mode:glossary", "Glossary", "The terms this piece uses in a non-obvious way, defined from the piece itself", ["define", "terms", "definitions"]),
  mode("mode:search", "Search", "Find a passage by the words it uses, or by what it says", ["find", "highlight"]),
  mode("mode:referee", "Referee", "Reviewing this for somebody? Your criteria, its claims, and a second look at your own notes", ["review", "reviewer", "peer review"]),
  mode("mode:summary", "Summary", "The piece in plain words, at the length you choose — brief, simple or fuller", ["summarise", "summarize"]),
  mode("mode:diagram", "Diagram", "The article's shape as a picture: a model reads the argument and draws it", ["sketch", "picture", "visual"]),
  mode("mode:ideas", "Ideas", "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds", ["premises", "propositions", "assumptions"]),
  mode("mode:remember", "Remember", "Say what you took from this and find out where it holds up — not saved notes or flashcards", ["recall"]),
  mode("mode:quotes", "Quotes", "The lines worth keeping — the piece's own sentences, chosen and checked against it", ["quotations", "excerpts"]),
  mode("mode:timeline", "Timeline", "When the piece says these things happened, in order — and how sure it actually is", ["chronology", "dates", "events"]),
  mode("mode:debate", "Debate", "What the rest of the web says about this piece — often nobody has written anything, and it says so", ["critiques", "reception", "responses"]),
  mode("mode:citations", "Citations", "The works this piece cites, each with a link — ranked by how much the piece leans on them", ["references", "bibliography", "sources", "works cited"]),
  mode("mode:structure", "Structure", "The document's shape — every part, and its sections", ["columns", "outline", "tree", "map", "hierarchy", "toc", "contents"]),
  mode("mode:faq", "FAQ", "The questions a careful reader would ask this piece, and where it responds", ["faqs", "frequently asked questions"]),
  mode("mode:skim", "Skim", "A route through the piece's quotes, a little deeper each time round", ["spiral", "route", "trajectory"]),
  mode("mode:tweets", "Tweets", "The article as a numbered thread of short posts", ["thread", "twitter", "x", "social"]),
  mode("mode:marginalia", "Marginalia", "Notes in a column right of the text, each level with the passage it is about", ["annotations", "margin notes", "margin", "sidenotes"]),

  sub("sub:remember-quiz", "Remember › Quiz", "The piece asks you questions, and your answers are marked against it"),
  sub("sub:summary-brief", "Summary › Brief", "The piece in plain words, short and very simple"),
  sub("sub:summary-simple", "Summary › Simple", "The piece in plain words, a few short paragraphs"),
  sub("sub:summary-fuller", "Summary › Fuller", "The piece in plain words, a little longer and keeping more of its terms"),
  sub("sub:diagram-sketch", "Diagram › Sketch", "A model reads the argument and draws its shape"),
  sub("sub:diagram-illustrated", "Diagram › Illustrated", "The Sketch, painted — an interpretation of the argument's shape"),
  sub("sub:referee-claims", "Referee › Claims", "What the piece promises, against the passages meant to deliver it"),
  sub("sub:referee-criteria", "Referee › Criteria", "Your own reviewing criteria, run over the piece"),

  {
    id: "page:library",
    label: "Library",
    description: "Your shelf, and the box you paste a new article into.",
    aliases: ["home", "homepage", "shelf", "my articles", "add", "add an article"],
    kind: "page",
    takesArgument: false,
  },
  {
    id: "page:profile",
    label: "Profile",
    description: "Your account, your plan, and the settings that follow you around.",
    aliases: ["settings", "account", "plan", "billing", "preferences"],
    kind: "page",
    takesArgument: false,
  },
  {
    id: "page:public-shelf",
    label: "Shared by readers",
    description: "Articles anybody has shared publicly.",
    aliases: ["public shelf"],
    kind: "page",
    takesArgument: false,
  },
  {
    id: "page:metadata",
    label: "Metadata",
    description: "Where this came from, how long it is, and every step that built it.",
    aliases: ["about", "details", "source", "reading time", "stats"],
    kind: "page",
    takesArgument: false,
  },
  {
    id: "action:comments",
    label: "Comments",
    description: "Your bookmarks and notes on this piece, in the drawer.",
    aliases: ["notes", "bookmarks", "annotations", "questions"],
    kind: "action",
    takesArgument: false,
  },
  {
    id: "action:feedback",
    label: "Feedback",
    description: "Tell us what is wrong, or what you wish it did.",
    aliases: ["bug", "report", "problem", "contact", "help", "suggestion"],
    kind: "action",
    takesArgument: false,
  },

  ...RERUN.map(
    ([step, label]): CatalogueCommand => ({
      id: `rerun:${step}`,
      label: `${label} › Run again`,
      description: `Generate the ${label} for this article again, replacing the current one.`,
      aliases: [`rerun ${label.toLowerCase()}`, `redo ${label.toLowerCase()}`, `regenerate ${label.toLowerCase()}`],
      kind: "rerun",
      takesArgument: false,
      planned: true,
    }),
  ),

  {
    id: "section:high-powered-ai",
    label: "High-powered AI",
    description:
      "Switch this article's AI to the stronger model (uses one article from your allowance), in Metadata › AI processing.",
    aliases: ["opus", "better model", "more powerful AI"],
    kind: "section",
    takesArgument: false,
    planned: true,
  },
  {
    id: "section:access-sharing",
    label: "Access & sharing",
    description: "Who can read this article: make it public or private.",
    aliases: ["share", "public", "publish", "private"],
    kind: "section",
    takesArgument: false,
    planned: true,
  },
  {
    id: "action:archive",
    label: "Archive this article",
    description: "Move this article off your shelf into the archive.",
    aliases: ["archive", "hide"],
    kind: "action",
    takesArgument: false,
    planned: true,
  },
  {
    id: "action:export",
    label: "Export this article",
    description: "Download everything about this article as a ZIP.",
    aliases: ["download", "zip", "backup"],
    kind: "action",
    takesArgument: false,
    planned: true,
  },
  {
    id: "action:find",
    label: "Find <words> in this article",
    description: "Highlight every passage that uses these words (Search, words mode). Takes the words to find.",
    aliases: ["find", "search for", "does it mention", "do they talk about"],
    kind: "action",
    takesArgument: true,
    planned: true,
  },
];

/** The answer for "no command fits". Never a catalogue id. */
export const NONE = "none";
