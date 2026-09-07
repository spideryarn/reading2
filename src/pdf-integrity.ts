import { baselineFor, type Pass0, type PdfRecord, type RecordType } from "./pdf.js";

/** A complete reading envelope, whether it came from the wire or a checkpoint. */
export interface ValidatedChunkReading {
  records: PdfRecord[];
  stripped: number;
  finish: string;
  nativeFinish?: string | undefined;
  usage: { input: number; output: number };
  ms: number;
}

const RECORD_TYPES: Record<RecordType, true> = {
  heading1: true,
  heading2: true,
  heading3: true,
  paragraph: true,
  quote: true,
  listitem: true,
  figure: true,
  table: true,
  code: true,
  footnote: true,
  reference: true,
  cover: true,
  publisher: true,
  tabledata: true,
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export type ReadingShapeVerdict =
  | { kind: "valid"; reading: ValidatedChunkReading }
  | { kind: "structural"; code: "record-shape" | "reading-shape" };

export class PdfReadingShapeError extends Error {
  override readonly name = "PdfReadingShapeError";

  constructor(
    readonly code: "record-shape" | "reading-shape",
    message: string,
    readonly usage?: { input: number; output: number },
  ) {
    super(message);
  }
}

/**
 * Runtime validation for paid answers kept beyond the TypeScript boundary.
 * Checkpoints are untyped JSON, and injected readers can violate their declared
 * interface just as a provider can violate its schema.
 */
export function validateChunkReading(value: unknown): ReadingShapeVerdict {
  if (!object(value) || !Array.isArray(value.records)) {
    return { kind: "structural", code: "reading-shape" };
  }
  if (
    !count(value.stripped) ||
    !Number.isInteger(value.stripped) ||
    typeof value.finish !== "string" ||
    value.finish.length === 0 ||
    (value.nativeFinish !== undefined && typeof value.nativeFinish !== "string") ||
    !count(value.ms) ||
    !object(value.usage) ||
    !count(value.usage.input) ||
    !count(value.usage.output)
  ) {
    return { kind: "structural", code: "reading-shape" };
  }

  for (const raw of value.records) {
    if (!object(raw)) return { kind: "structural", code: "record-shape" };
    if (
      typeof raw.page !== "number" ||
      !Number.isInteger(raw.page) ||
      typeof raw.type !== "string" ||
      !Object.hasOwn(RECORD_TYPES, raw.type) ||
      typeof raw.text !== "string" ||
      typeof raw.continues !== "boolean" ||
      typeof raw.uncertain !== "boolean"
    ) {
      return { kind: "structural", code: "record-shape" };
    }
  }

  return { kind: "valid", reading: value as unknown as ValidatedChunkReading };
}

export type StructuralIssue =
  | { code: "page-missing" | "page-empty"; pages: number[] }
  | { code: "page-impossible" | "page-outside-chunk"; pages: number[] }
  | { code: "page-order"; pages: number[] };

export type IntegrityVerdict =
  | { kind: "structural"; issues: StructuralIssue[] }
  | { kind: "content-warning"; warnings: string[] }
  | { kind: "pass" };

/**
 * A page-local floor for the narrow question "did this page emit content?"
 * Three lexical words excludes a folio, an isolated equation label and similar
 * furniture, while still protecting a genuine three-word title or note. This
 * is deliberately not a recall threshold: richer disagreements remain content
 * warnings below this structural boundary.
 */
const MIN_PRESENCE_WORDS = 3;

const lexicalWords = (text: string): string[] =>
  text.normalize("NFKC").match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];

const lexicalCount = (texts: readonly string[]): number => lexicalWords(texts.join("\n")).length;

/** The typed page-integrity properties that decide whether publication is safe. */
export function structuralIssues(
  records: PdfRecord[],
  requested: readonly number[],
  pass: Pass0,
): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const real = new Set(pass.pages.map((page) => page.page));
  const wanted = new Set(requested);
  const claimed = new Set(records.map((record) => record.page));
  const transcribedWords = new Map<number, number>();
  for (const record of records) {
    transcribedWords.set(
      record.page,
      (transcribedWords.get(record.page) ?? 0) + lexicalWords(record.text).length,
    );
  }

  const impossible = [...claimed].filter((page) => !real.has(page)).sort((a, b) => a - b);
  if (impossible.length) issues.push({ code: "page-impossible", pages: impossible });
  const outside = [...claimed]
    .filter((page) => real.has(page) && !wanted.has(page))
    .sort((a, b) => a - b);
  if (outside.length) issues.push({ code: "page-outside-chunk", pages: outside });

  const descending = new Set<number>();
  for (let at = 1; at < records.length; at++) {
    const before = records[at - 1]!.page;
    const after = records[at]!.page;
    if (after < before) {
      descending.add(before);
      descending.add(after);
    }
  }
  if (descending.size) {
    issues.push({ code: "page-order", pages: [...descending].sort((a, b) => a - b) });
  }

  /* `pass.isScan` describes the document as a whole. A mixed scan may still
     have a trustworthy text layer on one page, so presence is decided from
     each page's furniture-free baseline. Truly blank, mathematical or
     token-only pages have no prose witness and stay unverified rather than
     becoming a false refusal. */
  const mustBePresent = requested.filter(
    (page) => lexicalCount(baselineFor(pass, page)) >= MIN_PRESENCE_WORDS,
  );
  const missing = mustBePresent.filter((page) => !claimed.has(page));
  if (missing.length) issues.push({ code: "page-missing", pages: missing });
  const empty = mustBePresent.filter(
    (page) => claimed.has(page) && (transcribedWords.get(page) ?? 0) < MIN_PRESENCE_WORDS,
  );
  if (empty.length) issues.push({ code: "page-empty", pages: empty });

  return issues;
}

export function integrityVerdict(
  records: PdfRecord[],
  requested: readonly number[],
  pass: Pass0,
  contentWarnings: string[],
): IntegrityVerdict {
  const issues = structuralIssues(records, requested, pass);
  if (issues.length) return { kind: "structural", issues };
  return contentWarnings.length
    ? { kind: "content-warning", warnings: contentWarnings }
    : { kind: "pass" };
}

export function structuralFailureMessages(issues: readonly StructuralIssue[], pass: Pass0): string[] {
  return issues.flatMap((issue) => {
    switch (issue.code) {
      case "page-missing":
        return issue.pages.map((page) => `No records at all for page ${page}.`);
      case "page-empty":
        return issue.pages.map(
          (page) =>
            `Records for page ${page}, but fewer than ${MIN_PRESENCE_WORDS} lexical words in them.`,
        );
      case "page-impossible":
        return issue.pages.map(
          (page) => `Records claim page ${page}, and the document has ${pass.pages.length} pages.`,
        );
      case "page-outside-chunk":
        return issue.pages.map((page) => `Records claim page ${page}, which this chunk did not ask for.`);
      case "page-order":
        return [`Records descend in page order around page(s) ${issue.pages.join(", ")}.`];
      default: {
        const unhandled: never = issue;
        return unhandled;
      }
    }
  });
}
