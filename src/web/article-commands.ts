/**
 * **The command bar's rows for what the Metadata page does** — three of its
 * sections, Archive and Export — as words, with what Enter does left to the
 * caller. Stage B of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D):
 *
 * > Add a lot more Metadata functionality to Commands … And in general, look
 * > for ways to make Commands more powerful and universal and an easy-to-use
 * > way to do most things.
 *
 * A leaf for rerun-commands.ts's reason, and importing as little: no React, no
 * router, nothing of Metadata's, the Dock's or the bar's (Metadata imports the
 * Dock and the Dock imports the bar, so a word table living in any of them is
 * one the others cannot borrow — GPT Sol's F8). So the ranking can be tested on
 * exactly the rows production builds (tests/command-match-metadata-rows.test.ts),
 * and the day an interface model needs a serialisable catalogue of commands,
 * this half already is one (docs/project/chat-llm-help-commands-vision.md).
 * The closures are CommandBar.tsx's — `metadataRows` there.
 *
 * ## Every row here waits for a query (`typedOnly`)
 *
 * The list the bar opens on is the bar's catalogue — what there is to ask for
 * — and it already has a row for all of these: **Metadata**, the page they are
 * on. Listed always, these five would push the app's own pages down past the
 * fold of a phone for things a reader reaches for a few times an article.
 * That is the reasoning `typedOnly` was added for (the fourteen *Run again*
 * rows, command-match.ts § `CommandWords`), and it holds for five as well as
 * fourteen: a reader who wants one names it. The cost is discoverability on
 * the empty list, which is what the Metadata row's description and its own
 * aliases are for.
 *
 * ## None of them spends (`generates: false`)
 *
 * A section row goes to a section and arms nothing; High-powered AI goes to
 * its switch rather than throwing it, because the switch charges an article
 * and its own copy is where that price is stated (plan § Deliberately not).
 * Archive is one PATCH, Export one GET. Saying so is required, not noise
 * (command-match.ts § `generates`).
 */
import type { ActionOutcome, Command } from "./command-match.js";
import type { MetadataSection } from "./params.js";

type Run = () => ActionOutcome | Promise<ActionOutcome>;

/** A Metadata section the bar can take the reader to, and its words. */
export interface SectionRow {
  /** Unique among the rows; the action's `id` is `section-<this>`. */
  readonly id: string;
  /** Which section opens — a `?section=` value (params.ts § `METADATA_SECTIONS`). */
  readonly section: MetadataSection;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

/**
 * **The sections the bar names, and only these three.**
 *
 * **Not Export**: the direct action below owns that word, and two rows for one
 * word is the wrong one ranked first half the time (GPT Sol's F4). **Not What
 * it cost**: that section is an administrator's, and the bar has no admin
 * check — a row everyone sees for a section only one person has would be a
 * press that lands nowhere. The rest of the page's sections are things to
 * read rather than to do, and the Metadata row reaches them.
 *
 * **The words avoid two collisions, on purpose.** The bare verbs —
 * `regenerate`, `rerun`, `reprocess`, `redo` — stay the Metadata row's, which
 * comes before these in the list and so keeps them on a tie (Greg's
 * `spya-nkjpte`: *"I tried searching for "regenerate" … and nothing
 * matched"*, and tests/command-bar.test.tsx holds that answer); AI processing
 * is second for each. And `<verb> <name>` is every *Run again* row's
 * (rerun-commands.ts), so nothing here is a verb and a mode's name. `public` on
 * its own stays the shared shelf's, the app-wide page that carries it as a
 * name; *Share this article* answers `make public` and is listed under it.
 */
export const SECTION_ROWS: readonly SectionRow[] = [
  {
    id: "high-powered",
    /* Its switch is the first thing in AI processing (high-powered-ai.md);
       there is no section of its own to name. */
    section: "ai-processing",
    label: "High-powered AI",
    /* No price: the switch's own copy states what it costs, and
       tests/no-ai-cost-for-readers.test.ts reads this sentence too. */
    description: "The switch for a stronger model on this article, first in AI processing.",
    /* `opus` because it is the model the switch chooses and the name a reader
       who has heard of it types; the rest are how the request is phrased
       without knowing the name. Greg's own words were *"more powerful AI"*. */
    aliases: [
      "high power",
      "high powered",
      "opus",
      "more powerful ai",
      "more powerful model",
      "stronger model",
      "better model",
      "smarter model",
    ],
  },
  {
    id: "ai-processing",
    section: "ai-processing",
    label: "AI processing",
    description: "What was done to this article, and every step you can run again.",
    aliases: [
      "regenerate everything",
      "rerun everything",
      "reprocess everything",
      "pipeline",
      "stages",
      "processing",
      "what we did to it",
    ],
  },
  {
    id: "access-sharing",
    section: "access-sharing",
    /* **Named for the verb, not the section heading**, since the browser check
       of 2026-10-02: as *Access & sharing* it matched `share` only by alias,
       and the shared shelf's *Shared articles* — a label prefix — took the top
       row and the Enter, on an article page, where `share` means this article.
       As a label prefix too it ties, and the article's rows come first in the
       list, so they win the tie (command-match.ts § `rankCommands`). The
       section's own name stays an alias. Metadata's *Share…* button goes to
       the same card for the same reason. */
    label: "Share this article",
    /* The card asks before anything goes public, which is why this is a place
       and not an action: there is no share dialog, on purpose (plan § What
       exists), and a keyboard Enter is not where that question gets skipped. */
    description: "Access & sharing: who can read it, and making it public or private again.",
    aliases: [
      "access & sharing",
      "access and sharing",
      "access",
      "sharing",
      "publish",
      "unpublish",
      "private",
      "make public",
      "make private",
      "who can read",
      "visibility",
    ],
  },
];

/** A section row, with the caller's way of getting there. */
export function sectionCommand(row: SectionRow, run: Run): Command {
  return {
    kind: "action",
    id: `section-${row.id}`,
    label: row.label,
    description: row.description,
    aliases: row.aliases,
    generates: false,
    typedOnly: true,
    run,
  };
}

/**
 * **Archive, or Put back — whichever pressing it would do.**
 *
 * The label moves with the state, unlike Comments' (CommandBar.tsx § the
 * Comments row), because here a fixed name would be a lie half the time:
 * *Archive* over an archived article does the opposite of what it says. The
 * caller reads `archived` from the controller and offers no row at all while
 * that is unknown (GPT Sol's F6 — useArchive.ts § Three states).
 *
 * **One id for both**, so the selection does not hop to another row when a
 * press elsewhere flips the state under an open bar.
 *
 * **The words never cross over.** Each row answers only to its own direction:
 * `put back` over a live article and `hide` over an archived one reach nothing
 * of these, rather than a row whose Enter does the other thing. Typing
 * `archive` over an archived article finds Metadata first and this second, on
 * a substring of its label — the honest order for a word that means the
 * opposite of the press.
 *
 * Reversible, so no confirmation: the article stays readable where it is, and
 * the same row puts it back.
 */
export function archiveCommand(archived: boolean, run: Run): Command {
  return archived
    ? {
        kind: "action",
        id: "archive",
        /* The app calls this act *Put back* on the shelf card, Metadata and the
           Undo copy. Keep that one reader-facing name here too; `unarchive`
           remains a search alias for somebody who describes the operation. */
        label: "Put this article back",
        description: "Back on your shelf, where the library and its search show it again.",
        aliases: ["put back", "put back on shelf", "unarchive", "restore", "return to shelf"],
        generates: false,
        typedOnly: true,
        run,
      }
    : {
        kind: "action",
        id: "archive",
        label: "Archive this article",
        description: "Off your shelf and out of its search; still readable here, and reversible.",
        aliases: ["hide", "put away", "remove from shelf", "done with it", "tidy"],
        generates: false,
        typedOnly: true,
        run,
      };
}

/**
 * **Export this article** — the ZIP Metadata's *Export* section downloads
 * (export-download.ts; F9: it is a ZIP, so the description says so).
 */
export function exportCommand(run: Run): Command {
  return {
    kind: "action",
    id: "export",
    label: "Export this article",
    description: "Download a zip of everything we hold for it, as plain files.",
    aliases: ["download", "zip", "backup", "save a copy", "take out"],
    generates: false,
    typedOnly: true,
    run,
  };
}
