/**
 * **A `CitationWebNote` as `citation_web_notes` columns, and back** — the
 * write half is src/store/pg-citation-web-notes.ts, the read halves are that
 * file's `read` and `loadBibliography` in src/store/pg.ts. Its own file,
 * importing nothing from either, so src/store/pg.ts can use it without an
 * import cycle (src/store/citation-investigation-row.ts's reason).
 *
 * **Every column is named on every write**, the note's as null on a `none` and
 * `why` as null on a note, so a later press that turns a negative into a note
 * (or the reverse) leaves nothing of the first behind. The CHECKs in
 * src/db/schema.ts hold the same shape; a row that breaks them anyway throws
 * here rather than reading back as a note we cannot vouch for. The sentences
 * come back as stored: `shownWebNote` (src/citation-web-note-shown.ts) re-reads
 * every field before anything is shown.
 */
import type { citationWebNotes } from "../db/schema.js";
import type { CitationWebNote, CitationWebNoteWhy, WebNotePageKind } from "../types.js";

/**
 * **Without `created_at`, on purpose** — the first press's time, written only
 * by the database default; leaving it out of `Columns` is what stops the
 * upsert naming it and moving it.
 */
type Row = Omit<typeof citationWebNotes.$inferSelect, "createdAt">;
type Columns = Omit<Row, "articleId" | "entryId" | "ownerId">;

/** The columns a press writes, every one of them, for the upsert's insert and its `set` alike. */
export function webNoteColumns(note: CitationWebNote): Columns {
  const common = {
    identity: note.identity,
    state: note.state,
    model: note.model,
    promptVersion: note.promptVersion,
    validationVersion: note.validationVersion,
    searches: note.searches,
    checkedAt: new Date(note.checkedAt),
  };
  if (note.state === "note") {
    return {
      ...common,
      why: null,
      sentences: note.sentences,
      url: note.url,
      host: note.host,
      title: note.title,
      readAt: new Date(note.readAt),
      pageKind: note.pageKind,
    };
  }
  return { ...common, why: note.why, sentences: null, url: null, host: null, title: null, readAt: null, pageKind: null };
}

/** The CHECK holds `page_kind` to these two; anything else is a row we cannot vouch for. */
function pageKindOf(value: string): WebNotePageKind {
  if (value === "own" || value === "looks-like") return value;
  throw new Error(`citation_web_notes: unknown page_kind ${JSON.stringify(value)}`);
}

function present<T>(value: T | null, column: string): T {
  if (value === null) throw new Error(`citation_web_notes: ${column} is null where its state needs it`);
  return value;
}

/** A stored row as the type, timestamps as ISO. Throws on a state the CHECK should have refused. */
export function webNoteFromRow(row: Row): CitationWebNote {
  const common = {
    identity: row.identity,
    validationVersion: row.validationVersion,
    promptVersion: row.promptVersion,
    model: row.model,
    searches: row.searches,
    checkedAt: row.checkedAt.toISOString(),
  };
  switch (row.state) {
    case "note":
      return {
        ...common,
        state: "note",
        sentences: present(row.sentences, "sentences"),
        url: present(row.url, "url"),
        host: present(row.host, "host"),
        title: row.title,
        readAt: present(row.readAt, "read_at").toISOString(),
        /* Null is a note from before the column, every one of which passed
           the strict rule: `own` (src/db/schema.ts § pageKind). */
        pageKind: row.pageKind === null ? "own" : pageKindOf(row.pageKind),
      };
    case "none":
      /* The CHECK holds `why` to `CitationWebNoteWhy`'s closed list. */
      return { ...common, state: "none", why: present(row.why, "why") as CitationWebNoteWhy };
    default:
      throw new Error(`citation_web_notes: unknown state ${JSON.stringify(row.state)}`);
  }
}
