/**
 * **Referee › Notes: the reviewer's own notes, sorted by them, as the bones
 * of a report.** Pure, so what goes out on the clipboard can be tested without
 * a DOM — the panel is src/web/RefereeNotesPanel.tsx.
 *
 * docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md.
 *
 * ## Only the reviewer's words, and that is a rule rather than a style
 *
 * Greg ruled out a "draft my referee report" scaffold on 2026-08-31, and the
 * same night's notes allowed *"a plain comments-export"* later. This is that
 * export, and what keeps it on the right side of the line is what this module
 * can read: **`NoteSource`, which is a comment's `body`, its anchor and its
 * `severity`, and nothing else** — so `answer`, `citations`, `searches`,
 * `model` and `error` (a model's work on a comment made before 2026-08-28) are
 * not merely unread here, they are not in scope to be read. Never a chat, and
 * never a block's heading either: Structure's headings are written by a model,
 * so a passage is located by its own quoted words, which are the author's.
 * tests/referee-notes.test.ts plants a sentinel in every model-owned field and
 * checks the exact text that comes out. (GPT Sol, plan review F7.)
 *
 * Nor does anything sort for the reviewer. `severity` is written only by their
 * own press (`useComments.sort`), there is no default but *not sorted yet*, and
 * the Summary heading is printed with nothing under it — the skeleton the
 * research described (summary, major, minor), and nothing written into it.
 */
import { orderComments, passageOf } from "./comment-nav.js";
import type { BlockId, Comment, Severity } from "../types.js";

/**
 * **All of a comment this module may see.** A `Comment` is passed in
 * whole by the panel; this type is what stops a later edit here reaching a
 * model's answer on it.
 */
export type NoteSource = Pick<Comment, "id" | "blockId" | "createdAt" | "body" | "severity"> & {
  readonly quote?: string | undefined;
  readonly start?: number | undefined;
};

/** One of the reviewer's notes, as the Notes panel shows and copies it. */
export interface NoteItem {
  readonly id: string;
  readonly blockId: BlockId;
  /** The reviewer's own words — the comment's `body`, untouched. */
  readonly words: string;
  /**
   * What the note is on: the quote, a whole paragraph's opening words, or a
   * paragraph that is no longer in this version of the article — which is said,
   * never printed in quote marks as if the author had written it.
   */
  readonly passage:
    | { readonly kind: "quote" | "paragraph"; readonly text: string }
    | { readonly kind: "gone" };
  readonly severity: Severity | null;
}

export interface RefereeNotes {
  readonly major: readonly NoteItem[];
  readonly minor: readonly NoteItem[];
  readonly unsorted: readonly NoteItem[];
  /**
   * Marks with no words of the reviewer's on them — a highlight, a bookmark, a
   * placement on a criterion with nothing written. Counted and said, not
   * listed: there are none of the reviewer's words to copy out, and leaving
   * them out without a word would look like a note lost.
   */
  readonly wordless: number;
}

/**
 * The reviewer's notes in three groups, each in reading order — the drawer's
 * order (`orderComments`), so walking a group walks down the paper.
 *
 * **Every comment with words counts**, review comments (with a criterion) and
 * reading notes alike: both are the reviewer's notes, and which of them belongs
 * in the report is theirs to say by sorting.
 */
export function notesOf(
  comments: readonly NoteSource[],
  blocks: readonly { id: BlockId; text: string }[],
): RefereeNotes {
  const text = new Map(blocks.map((b) => [b.id, b.text]));
  const major: NoteItem[] = [];
  const minor: NoteItem[] = [];
  const unsorted: NoteItem[] = [];
  let wordless = 0;
  for (const c of orderComments([...comments], [...blocks])) {
    if (c.body === undefined || c.body.trim() === "") {
      wordless += 1;
      continue;
    }
    const item: NoteItem = {
      id: c.id,
      blockId: c.blockId,
      words: c.body,
      passage: passageFor(c, text.get(c.blockId)),
      severity: c.severity ?? null,
    };
    switch (item.severity) {
      case "major":
        major.push(item);
        break;
      case "minor":
        minor.push(item);
        break;
      case null:
        unsorted.push(item);
        break;
      default: {
        const unknown: never = item.severity;
        throw new Error(`unknown severity: ${String(unknown)}`);
      }
    }
  }
  return { major, minor, unsorted, wordless };
}

/** `passageOf`, with the paragraph that has gone kept apart from one that has words. */
function passageFor(c: NoteSource, paragraph: string | undefined): NoteItem["passage"] {
  if (c.quote === undefined && paragraph === undefined) return { kind: "gone" };
  const { whole, text } = passageOf(c, paragraph);
  return { kind: whole ? "paragraph" : "quote", text };
}

/** How much of a quote goes out before it is cut. A pointer, not a copy of the paper. */
const QUOTE_CHARS = 200;

/**
 * **The reviewer's notes as plain text**, for a journal's web form.
 *
 * Plain text rather than Markdown, because most review forms are a bare text
 * area that would show `**` and `>` literally. *Not sorted yet* goes out too,
 * last and under its own heading, rather than being dropped: a note the
 * reviewer wrote and forgot to sort belongs in front of them, not missing.
 * A heading with nothing under it is printed bare: no placeholder sentence,
 * because the only sentences in this text are the reviewer's.
 */
export function notesText(notes: RefereeNotes): string {
  const sections = [
    "Summary",
    section("Major", notes.major),
    section("Minor", notes.minor),
    ...(notes.unsorted.length > 0 ? [section("Not sorted yet", notes.unsorted)] : []),
  ];
  return `${sections.join("\n\n")}\n`;
}

function section(heading: string, items: readonly NoteItem[]): string {
  if (items.length === 0) return heading;
  return [heading, ...items.map((item, i) => numbered(i + 1, item))].join("\n");
}

/**
 * `1. their words`, then the passage on its own line. A note written over
 * several lines keeps its line breaks, indented under its number so the list
 * still reads as a list when pasted.
 */
function numbered(n: number, item: NoteItem): string {
  const lead = `${n}. `;
  const pad = " ".repeat(lead.length);
  const words = item.words
    .trim()
    .split(/\r?\n/)
    .map((line, i) => (i === 0 ? lead : pad) + line.trimEnd())
    .join("\n");
  return `${words}\n${pad}${onLine(item.passage)}`;
}

function onLine(passage: NoteItem["passage"]): string {
  if (passage.kind === "gone") return "On a paragraph no longer in this version of the article";
  const flat = passage.text.replace(/\s+/g, " ").trim();
  const cut = flat.length > QUOTE_CHARS ? `${flat.slice(0, QUOTE_CHARS).trimEnd()}…` : flat;
  return passage.kind === "paragraph" ? `On the paragraph beginning: “${cut}”` : `On: “${cut}”`;
}
