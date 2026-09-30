/**
 * **Compile the feedback notes' endings into a map the server can import.**
 *
 *     npx tsx scripts/feedback-endings.ts           # rewrite src/feedback-endings.generated.ts
 *     npx tsx scripts/feedback-endings.ts --check   # exit 1 if it is out of date
 *
 * Every report ends in a note under docs/user-feedback/ naming one of three
 * endings (docs/project/feedback-reports.md § Three ways a report ends). A note
 * may start with a header saying which report rows it records and how it
 * ended:
 *
 *     ---
 *     reports: spya-bfcvxg
 *     ending: shipped
 *     ---
 *
 * `reports` is the feedback row id (the Sentry issue's `report_id` tag),
 * comma-separated for a note recording several, or `none` for a report that
 * never had one. `ending` is the note's *current* ending. `parts: N` goes on
 * each note of a report split into N queue entries.
 *
 * This reads those headers and writes one line per report. The server imports
 * the result, so a report counts as shipped **in the build that carries its
 * note** — on production, only once the commit carrying the note has been
 * deployed, which is the "deployed" half of what Greg asked for.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 *
 * Run it after writing or changing a note's header. tests/feedback-endings.test.ts
 * goes red when the committed map and the headers disagree, or a header does
 * not parse. A note with no header is left out, so its report reads as not
 * shipped — the safe direction. If shipped work is later reverted, edit its
 * note's header back. On a merge conflict in the generated file, merge the
 * notes and re-run this; never pick a side.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FEEDBACK_ENDINGS, type FeedbackEnding } from "../src/feedback-ending-values.js";
import { isMain } from "../src/is-main.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NOTES_DIR = path.join(ROOT, "docs/user-feedback");
export const GENERATED_PATH = path.join(ROOT, "src/feedback-endings.generated.ts");

/** Files in docs/user-feedback/ that are not one report's note. */
const NOT_A_NOTE = new Set(["awaiting-approval.md"]);

/** The feedback row id's shape: `spya-` and six base-36 characters. */
const REPORT_ID = /^spya-[a-z0-9]{6}$/;

const HEADER_FIELDS = new Set(["reports", "ending", "parts"]);

export interface NoteHeader {
  /** Empty for `reports: none` — a report that never had a row id. */
  reports: string[];
  ending: FeedbackEnding;
  /** How many queue entries (so notes) a split report became; absent when it was not split. */
  parts?: number;
}

/**
 * The header at the very top of a note; `null` when the note has none (it is
 * then simply not in the map, so its report reads as not shipped); or a
 * sentence saying what is wrong with it — a string rather than a throw so the
 * test can list every bad note at once.
 */
export function parseNoteHeader(text: string): NoteHeader | null | string {
  if (!text.startsWith("---\n")) return null;
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) return "the header's `---` block is never closed";
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (!pair?.[1]) return `unreadable header line: ${JSON.stringify(line)}`;
    if (fields.has(pair[1])) return `duplicate header field: ${pair[1]}`;
    fields.set(pair[1], (pair[2] ?? "").trim());
  }
  const unknown = [...fields.keys()].filter((key) => !HEADER_FIELDS.has(key));
  if (unknown.length > 0) return `unknown header field(s): ${unknown.join(", ")}`;

  const ending = fields.get("ending");
  if (!FEEDBACK_ENDINGS.some((known) => known === ending)) {
    return `ending must be one of ${FEEDBACK_ENDINGS.join(" | ")}, not ${JSON.stringify(ending)}`;
  }
  const named = fields.get("reports") ?? "";
  const reports =
    named === "none"
      ? []
      : named
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== "");
  if (named !== "none" && reports.length === 0) {
    return "reports: names no report id (write `none` if the report never had one)";
  }
  const bad = reports.filter((id) => !REPORT_ID.test(id));
  if (bad.length > 0) return `not a report id: ${bad.join(", ")}`;
  const repeated = reports.filter((id, index) => reports.indexOf(id) !== index);
  if (repeated.length > 0) return `report id named more than once: ${[...new Set(repeated)].join(", ")}`;

  const header: NoteHeader = { reports, ending: ending as FeedbackEnding };
  const parts = fields.get("parts");
  if (parts !== undefined) {
    if (!/^[2-9]$/.test(parts)) {
      return `parts must be a number from 2 to 9, not ${JSON.stringify(parts)}`;
    }
    if (reports.length !== 1) {
      return "parts: only a note recording exactly one report can say it was split";
    }
    header.parts = Number(parts);
  }
  return header;
}

/**
 * **One report's status from all the notes that name it.** A report split into
 * several queue entries gets one note per entry, and a part still waiting on
 * Greg — or not started, so with no note yet, which only `parts` can reveal —
 * keeps the whole report from reading as shipped. Shipped when any part
 * shipped, since the label claims a change went out; declined only when every
 * note declined it.
 */
export function combineEndings(
  notes: readonly { ending: FeedbackEnding; parts?: number }[],
): FeedbackEnding {
  const endings = notes.map((note) => note.ending);
  const expected = Math.max(1, ...notes.map((note) => note.parts ?? 1));
  if (endings.includes("awaiting") || notes.length < expected) return "awaiting";
  if (endings.includes("shipped")) return "shipped";
  return "declined";
}

export interface NoteFile {
  name: string;
  text: string;
}

export function readNotes(dir: string = NOTES_DIR): NoteFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !NOT_A_NOTE.has(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
}

export interface CompiledEndings {
  endings: Map<string, FeedbackEnding>;
  /** `file: problem`, one per note whose header does not parse. A note with no header is not one. */
  problems: string[];
}

export function compileEndings(notes: readonly NoteFile[]): CompiledEndings {
  const byReport = new Map<string, NoteHeader[]>();
  const problems: string[] = [];
  for (const note of notes) {
    const header = parseNoteHeader(note.text);
    if (header === null) continue;
    if (typeof header === "string") {
      problems.push(`${note.name}: ${header}`);
      continue;
    }
    for (const id of header.reports) {
      byReport.set(id, [...(byReport.get(id) ?? []), header]);
    }
  }
  const endings = new Map<string, FeedbackEnding>();
  for (const id of [...byReport.keys()].sort()) {
    endings.set(id, combineEndings(byReport.get(id) ?? []));
  }
  return { endings, problems };
}

/** The generated module's text: sorted, one report per line, so merges rarely touch. */
export function renderModule(endings: ReadonlyMap<string, FeedbackEnding>): string {
  const lines = [...endings].map(([id, ending]) => `  "${id}": "${ending}",`);
  return [
    "/**",
    " * GENERATED by scripts/feedback-endings.ts from the headers of the notes in",
    " * docs/user-feedback/ — do not edit by hand; re-run the script. On a merge",
    " * conflict here, merge the notes and re-run it; never pick a side.",
    " * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.",
    " */",
    'import type { FeedbackEnding } from "./feedback-ending-values.js";',
    "",
    "export const FEEDBACK_NOTE_ENDINGS: Readonly<Record<string, FeedbackEnding>> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

/**
 * Put one rendered module at `generatedPath`. A missing file is stale, not an
 * error: this is the command that must be able to recreate it. `--check` still
 * refuses either missing or different output without writing.
 */
export function syncGenerated(
  text: string,
  generatedPath: string = GENERATED_PATH,
  check = false,
): "unchanged" | "written" | "stale" {
  const current = existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : null;
  if (current === text) return "unchanged";
  if (check) return "stale";
  writeFileSync(generatedPath, text);
  return "written";
}

function main(): void {
  const { endings, problems } = compileEndings(readNotes());
  if (problems.length > 0) {
    console.error(`${problems.length} note header(s) do not parse:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const text = renderModule(endings);
  const checking = process.argv.includes("--check");
  const outcome = syncGenerated(text, GENERATED_PATH, checking);
  if (outcome === "stale") {
    console.error(
      "src/feedback-endings.generated.ts is out of date: npx tsx scripts/feedback-endings.ts",
    );
    process.exit(1);
  }
  if (checking) {
    console.log(`✓ ${endings.size} reports, up to date`);
    return;
  }
  if (outcome === "unchanged") {
    console.log(`✓ ${endings.size} reports, unchanged`);
    return;
  }
  console.log(`✓ wrote ${endings.size} reports to src/feedback-endings.generated.ts`);
}

if (isMain(import.meta.url)) main();
