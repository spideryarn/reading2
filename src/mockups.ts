/**
 * **What a mockup file may look like** — the one set of rules the server, the
 * script (scripts/mockups.ts) and the tests hold `docs/mockups/` to. Pure and
 * import-light (src/ids.ts, the question rules and the fence reader), so the
 * browser can import its types and `isMockupId` without dragging `node:fs`
 * along; reading the directory is src/mockups-dir.ts.
 *
 * Greg, 2026-10-28: *"a /admin/mockups page with a table that can link out to
 * particular mockups"*, so that a decision question can point at pictures he
 * can compare. Plan 261028b, Stage 3; docs/project/admin.md § `/admin/mockups`.
 *
 * ## The format
 *
 * `docs/mockups/m-xxxxxx.md`, named for its id:
 *
 *     ---
 *     id: m-xxxxxx
 *     title: One line, at most 120 characters
 *     made: 2026-10-28
 *     question: q-xxxxxx        (or none)
 *     report: spya-xxxxxx       (or none)
 *     ---
 *     Plain text. Lines between two lines that are exactly ``` are monospaced.
 *     image: m-xxxxxx-before.png
 *
 * A line exactly `image: <file>`, outside a fence, shows that image there. The
 * file sits beside the mockup, its name starts with the mockup's id and `-`,
 * and it is a PNG, JPEG or WebP (by extension, checked against its first bytes
 * by the script). Inside a fence an `image:` line is just text, for the reason
 * plain-text-blocks.ts gives about `Details`: one line-by-line reading.
 */
import { isCalendarDay, isFeedbackQuestionId } from "./feedback-question-values.js";
import { ID_PREFIX, isSpideryarnId, mintId } from "./ids.js";
import { fencedLines, normaliseNewlines, parsePlainTextBlocks } from "./plain-text-blocks.js";

const MOCKUP_ID_PREFIX = "m-";

/** `m-k3m9qt`: the prefix, then the six characters a report id ends in (src/ids.ts). */
export function isMockupId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(MOCKUP_ID_PREFIX) &&
    isSpideryarnId(ID_PREFIX + value.slice(MOCKUP_ID_PREFIX.length))
  );
}

/** A fresh mockup id. Uniqueness is the directory's: one file per id. */
export function mintMockupId(random?: () => number): string {
  return MOCKUP_ID_PREFIX + mintId(random).slice(ID_PREFIX.length);
}

/** The line in the table, and the page's heading. A question's title has the same cap. */
export const MAX_MOCKUP_TITLE_CHARS = 120;
/** The body, after the header. A question's body is capped near this too. */
export const MAX_MOCKUP_BODY_CHARS = 20_000;
/**
 * **Per image, 1.5 MB; all files together, 40 MB.** Every file in
 * `docs/mockups/` is copied into the API function by vercel.json's
 * `includeFiles`, and included files count toward the function's bundle limit
 * (250 MB unzipped, shared with all the code), so the directory is capped well
 * below it. The per-image cap keeps one screenshot from eating the budget and
 * keeps the page quick on a phone. Plan 261028b, GPT Sol's review F1.
 */
export const MAX_MOCKUP_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const MAX_MOCKUP_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024;

/**
 * **The content types an image may be served as, by extension, and only
 * these.** No SVG: it can carry script, and these are served from our own
 * origin. Lower case only, so one file has one spelling.
 */
const MOCKUP_IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;
export type MockupImageType = (typeof MOCKUP_IMAGE_TYPES)[keyof typeof MOCKUP_IMAGE_TYPES];

export function mockupImageType(file: string): MockupImageType | null {
  const ext = /\.([a-z]+)$/.exec(file)?.[1];
  if (ext === undefined || !Object.hasOwn(MOCKUP_IMAGE_TYPES, ext)) return null;
  return MOCKUP_IMAGE_TYPES[ext as keyof typeof MOCKUP_IMAGE_TYPES];
}

/** Whether the first bytes say what the extension says. The script and the image route ask. */
export function imageBytesAre(bytes: Uint8Array, type: MockupImageType): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (type) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}

/** A piece of a mockup's body: text to draw with PlainTextBlocks, or the image at this index. */
export type MockupPart = { kind: "text"; text: string } | { kind: "image"; index: number };

export interface MockupHeader {
  id: string;
  title: string;
  /** yyyy-mm-dd. */
  made: string;
  /** The question it was made for, a `q-` id. */
  question: string | null;
  /** The feedback report it belongs to, a `spya-` id. */
  report: string | null;
}

/** A mockup file that passed. `images` are file names, in the order the body shows them. */
export interface MockupFile extends MockupHeader {
  body: MockupPart[];
  images: string[];
}

/** One row of `GET /api/admin/mockups`. */
export interface MockupSummary extends MockupHeader {
  images: number;
}

/** `GET /api/admin/mockups/:id`. An image is named by its index; the file name stays on the server. */
export interface MockupDetail extends MockupHeader {
  body: MockupPart[];
  images: { index: number; contentType: MockupImageType }[];
}

const FIELDS = ["id", "title", "made", "question", "report"] as const;
type Field = (typeof FIELDS)[number];
const IMAGE_LINE = /^image: (\S+)$/;

/**
 * The header block. A small copy of scripts/feedback-endings.ts §
 * `readHeaderFields` rather than an import of it: that is a script, and the
 * server may not import scripts/.
 */
function readHeader(text: string): { fields: Map<Field, string>; rest: string } | string {
  if (!text.startsWith("---\n")) return "a mockup file starts with a `---` header";
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match?.[1]) return "the header's `---` block is never closed";
  const fields = new Map<Field, string>();
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (!pair?.[1]) return `unreadable header line: ${JSON.stringify(line)}`;
    const key = FIELDS.find((known) => known === pair[1]);
    if (key === undefined) return `unknown header field: ${pair[1]}`;
    if (fields.has(key)) return `duplicate header field: ${key}`;
    fields.set(key, (pair[2] ?? "").trim());
  }
  const missing = FIELDS.filter((field) => (fields.get(field) ?? "") === "");
  if (missing.length > 0) return `missing header field(s): ${missing.join(", ")}`;
  return { fields, rest: text.slice(match[0].length) };
}

/** Is `file` a name this mockup's image may have? A bare name, never a path. */
function imageNameProblem(id: string, file: string): string | null {
  if (!file.startsWith(`${id}-`)) return `an image's file name must start with ${id}-, not ${JSON.stringify(file)}`;
  if (!/^[a-z0-9-]+-[A-Za-z0-9._-]+$/.test(file) || file.includes("..")) {
    return `an image is a file name beside the mockup (letters, digits, . _ -), not ${JSON.stringify(file)}`;
  }
  if (mockupImageType(file) === null) return `an image must end .png, .jpg, .jpeg or .webp, not ${JSON.stringify(file)}`;
  return null;
}

/**
 * **One file, checked.** The mockup, or a sentence saying what is wrong with
 * it — a string rather than a throw, so the script and the test can list
 * every bad file at once and the server can leave one out of the list.
 * Whether the images exist is src/mockups-dir.ts's question.
 */
export function parseMockupFile(name: string, raw: string): MockupFile | string {
  const read = readHeader(normaliseNewlines(raw));
  if (typeof read === "string") return read;
  const field = (key: Field) => read.fields.get(key) ?? "";

  const id = field("id");
  if (!isMockupId(id)) return `id must be m- and six characters of a report id's alphabet, not ${JSON.stringify(id)}`;
  if (name !== `${id}.md`) return `the file must be named for its id: ${id}.md`;
  const title = field("title");
  if (title.length > MAX_MOCKUP_TITLE_CHARS) {
    return `title must be at most ${MAX_MOCKUP_TITLE_CHARS} characters, not ${title.length}`;
  }
  const made = field("made");
  if (!isCalendarDay(made)) return `made must be a date written yyyy-mm-dd, not ${JSON.stringify(made)}`;
  const question = field("question");
  if (question !== "none" && !isFeedbackQuestionId(question)) {
    return `question must be one question id (q-xxxxxx) or \`none\`, not ${JSON.stringify(question)}`;
  }
  const report = field("report");
  if (report !== "none" && !isSpideryarnId(report)) {
    return `report must be one report id (spya-xxxxxx) or \`none\`, not ${JSON.stringify(report)}`;
  }

  const text = read.rest.trim();
  if (text === "") return "the body says nothing";
  if (text.length > MAX_MOCKUP_BODY_CHARS) {
    return `the body must be at most ${MAX_MOCKUP_BODY_CHARS} characters, not ${text.length}`;
  }
  const { lines, inside, unclosed } = fencedLines(text);
  if (unclosed) return "a ``` fence is opened and never closed";

  const body: MockupPart[] = [];
  const images: string[] = [];
  let run: string[] = [];
  const flush = () => {
    /* Kept whole, fences and all: PlainTextBlocks draws it, so the fence rule
       lives in one place. A run with nothing drawable in it is dropped. */
    const chunk = run.join("\n");
    run = [];
    if (parsePlainTextBlocks(chunk).blocks.length === 0) return;
    /* Blank lines at either end go; a line's own indent stays, for ASCII. */
    body.push({ kind: "text", text: chunk.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "") });
  };
  for (const [i, line] of lines.entries()) {
    if (!inside[i] && line.startsWith("image:")) {
      const file = IMAGE_LINE.exec(line)?.[1];
      if (file === undefined) return `an image line is exactly \`image: <file>\`, not ${JSON.stringify(line)}`;
      const problem = imageNameProblem(id, file);
      if (problem !== null) return problem;
      flush();
      body.push({ kind: "image", index: images.length });
      images.push(file);
    } else {
      run.push(line);
    }
  }
  flush();

  return {
    id,
    title,
    made,
    question: question === "none" ? null : question,
    report: report === "none" ? null : report,
    body,
    images,
  };
}

/** Newest first, then by id, so two from one day keep one order. */
export function newestFirst(a: MockupHeader, b: MockupHeader): number {
  return a.made === b.made ? a.id.localeCompare(b.id) : a.made < b.made ? 1 : -1;
}

/**
 * **`--new`: where a new mockup goes, and what it starts as.** Creates
 * nothing, like scripts/feedback-questions.ts --new; the skeleton parses as it
 * stands.
 */
export function newMockup(
  title: string,
  taken: ReadonlySet<string>,
  when: Date = new Date(),
  random?: () => number,
): { path: string; text: string } {
  const line = title.trim();
  if (line === "" || line.length > MAX_MOCKUP_TITLE_CHARS || /[\r\n]/.test(line)) {
    throw new Error(`a title is one line of at most ${MAX_MOCKUP_TITLE_CHARS} characters`);
  }
  let id = mintMockupId(random);
  for (let attempt = 0; taken.has(id); attempt++) {
    if (attempt >= 1000) throw new Error("could not mint a mockup id that is not taken");
    id = mintMockupId(random);
  }
  return {
    path: `docs/mockups/${id}.md`,
    text: [
      "---",
      `id: ${id}`,
      `title: ${line}`,
      `made: ${when.toISOString().slice(0, 10)}`,
      "question: none",
      "report: none",
      "---",
      "What this shows, in a sentence or two. Then an ASCII block between two ``` lines,",
      `or a line \`image: ${id}-<name>.png\` naming an image saved beside this file.`,
      "",
    ].join("\n"),
  };
}
