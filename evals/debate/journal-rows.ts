/**
 * **The rows a captured run reported, and the packets it was reading them
 * from** — the one place Stage B′ touches the disk.
 *
 * Stage B′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *The bug's own rows were on disk all along*. The plan's premise was that
 * *"the $0.6252 bought no replayable evidence"*; that turned out to be true of
 * the **validation** question and false of the **valence** question, because
 * every journalled `provider-response` holds the raw OpenRouter body verbatim,
 * and that carries two things Layer 2 was going to be sent out to buy:
 *
 * - `choices[0].message.content` — the fenced ` ```debate ` block, so the rows
 *   the model *reported*, not the rows production *kept*;
 * - `choices[0].message.annotations[]` — one `url_citation` per page, each with
 *   the `content` **extract the model was shown**. That extract is the frozen
 *   packet's haystack, and it is why Layer 2 costs no search.
 *
 * ## Why this is a separate file from `score.ts`
 *
 * `score.ts` is pure: no IO, no clock, no network, so every figure in it is
 * pinned by a test that builds its own input. All the reading lives here, and
 * this file computes nothing. The seam is deliberate and is the same one
 * `replay.ts` sits on.
 *
 * ## The one rule this file exists to keep
 *
 * **A list quietly shorter than what the file contained must say so.** A
 * journal is read to answer questions like *"how many rows did that run
 * report?"*, and an unparseable fence, an attempt that never heard back, a
 * truncated last line or an annotation with no extract in it all shorten the
 * answer without erroring. Every one of them is counted and named, and
 * `problems` is non-empty whenever the report is not a complete account of the
 * file ([silent-success.md](../../docs/reusable/silent-success.md)).
 *
 * **And the pass is read off the `attempt-started` line, never off ordinal
 * position.** *"The first response is direct, the second is claims"* is true of
 * the three runs on disk and is a property of those runs, not of the format: a
 * journal whose first attempt aborted before answering has one response and it
 * is the claims pass. An attempt whose start is missing gets `pass: null` and a
 * problem, which is exactly what `replay.ts` does with the same case.
 */
import path from "node:path";

import { parsePass } from "../../src/debate.js";
import type {
  DebateAttemptStarted,
  DebateFailureClass,
  DebateJournalEvent,
  DebatePassKind,
  DebateProviderResponse,
} from "../../src/debate-journal.js";
import { readJournal } from "./journal-file.js";

/** **Gitignored**, and the same root `run.ts` writes to. */
export const RUN_ROOT = "output/debate-runs";

/** Where a named run's journal lives. Relative, resolved against the caller's cwd. */
export function journalPath(run: string, root = RUN_ROOT): string {
  return path.join(root, run, "journal.jsonl");
}

/**
 * **One search result, exactly as the model was handed it.**
 *
 * The `content` is the provider's extract — the 236–4,945 character slice that
 * is the *only* haystack production verifies a quotation against, and therefore
 * the only haystack a replay may use if it is to reproduce the run's own
 * losses.
 */
export interface FrozenPacket {
  url: string;
  /** The search result's own title. `null` where the wire carried none. */
  title: string | null;
  /** The extract. May be empty — an empty extract is a fact about the run, not a missing packet. */
  content: string;
  /** The provider's offsets into the assistant text. `null` where absent. */
  startIndex: number | null;
  endIndex: number | null;
}

/** An annotation that could not be turned into a packet, and why. */
export interface UnusableAnnotation {
  /** Position in `annotations[]`, so it can be found in the file. */
  index: number;
  /** A fixed phrase from a closed set — never provider prose. */
  why: "not a url_citation" | "no url_citation object" | "no url" | "no content";
}

/** What one captured pass reported. */
export interface ReportedPass {
  attemptId: string;
  /** From the matching `attempt-started`. `null` means there wasn't one — see the header. */
  pass: DebatePassKind | null;
  /** The article the attempt was about, from `attempt-started`. `null` alongside `pass: null`. */
  article: DebateAttemptStarted["article"] | null;
  /**
   * **The rows the model reported**, straight out of the fence and validated by
   * nothing. Empty when `unreadable` is set — and the two cases are told apart
   * by `unreadable`, never by the length, because a pass may honestly report
   * zero rows.
   */
  rows: unknown[];
  /**
   * Why the fenced block could not be read, as one of `parsePass`'s own failure
   * classes. `null` when it read.
   *
   * The class rather than the message: `parsePass`'s messages are authored and
   * safe, but the classification is what a report wants and it cannot ever
   * carry a stranger's page by accident.
   */
  unreadable: DebateFailureClass | null;
  /** Every usable annotation, in wire order. Duplicated URLs are kept as they came. */
  packets: FrozenPacket[];
  /** How many entries `annotations[]` held. `packets.length + unusable.length`. */
  annotationsSeen: number;
  /** The ones that did not become packets. Non-empty is a fact about the run. */
  unusable: UnusableAnnotation[];
}

/** Everything one journal file turned out to say. */
export interface JournalRowsReport {
  file: string;
  /** One per `provider-response` that carried a body, in file order. */
  passes: ReportedPass[];
  /** Rows summed across the passes that were readable. */
  reportedRows: number;
  /** Packets summed across every pass. */
  packetCount: number;
  /** Annotations summed across every pass, usable or not. */
  annotationsSeen: number;
  /** Lines `readJournal` could not read — a truncated last line is the usual one. */
  malformedLines: number[];
  /**
   * **Non-empty means this report is not a complete account of the file.**
   *
   * Every way the answer can come out short has a sentence here: a malformed
   * line, an attempt that never heard back, a refusal, a 2xx whose bytes are
   * gone, an answer with no choices, a fence that would not parse, and an
   * annotation with no extract. A caller that prints `reportedRows` without
   * printing these has told somebody the file was complete.
   */
  problems: string[];
}

/** Read a journal file and say what it holds. */
export async function readJournalRows(file: string): Promise<JournalRowsReport> {
  const { events, malformedLines } = await readJournal(file);
  return journalRowsOf(events, { file, malformedLines });
}

/** The same, for a run directory name under `output/debate-runs/`. */
export function readRunRows(run: string, root = RUN_ROOT): Promise<JournalRowsReport> {
  return readJournalRows(journalPath(run, root));
}

/**
 * The pure half, so a test can hand it events without writing a file.
 *
 * **What it refuses to do:** it does not validate a row, does not resolve a
 * quotation, does not dedupe a URL, and does not decide which pass is which
 * from its position in the file.
 */
export function journalRowsOf(
  events: readonly DebateJournalEvent[],
  opts: { file?: string; malformedLines?: readonly number[] } = {},
): JournalRowsReport {
  const starts = new Map<string, DebateAttemptStarted>();
  const startOrder: string[] = [];
  const responses: DebateProviderResponse[] = [];
  for (const event of events) {
    if (event.event === "attempt-started") {
      if (!starts.has(event.attemptId)) {
        starts.set(event.attemptId, event);
        startOrder.push(event.attemptId);
      }
    } else if (event.event === "provider-response") {
      responses.push(event);
    }
  }

  const problems: string[] = [];
  const malformedLines = [...(opts.malformedLines ?? [])];
  if (malformedLines.length > 0) {
    problems.push(
      `${String(malformedLines.length)} line(s) could not be read (line ${malformedLines.join(", ")}) — the file is not fully accounted for`,
    );
  }

  const answered = new Set<string>();
  const passes: ReportedPass[] = [];
  for (const response of responses) {
    answered.add(response.attemptId);
    const start = starts.get(response.attemptId);
    const short = response.attemptId.slice(0, 8);
    if (!start) {
      problems.push(
        `attempt ${short} answered but has no attempt-started — its pass and article are unknown`,
      );
    }
    if (response.response.kind === "refused") {
      problems.push(
        `attempt ${short} was refused with ${String(response.response.status)} — there is no answer to read`,
      );
      continue;
    }
    if (response.response.json === null) {
      problems.push(
        `attempt ${short} returned a 2xx whose body was not JSON, and the bytes are not in the journal`,
      );
      continue;
    }
    passes.push(readOne(response.attemptId, start, response.response.json, problems));
  }

  for (const attemptId of startOrder) {
    if (!answered.has(attemptId)) {
      problems.push(
        `attempt ${attemptId.slice(0, 8)} started and never heard back — the process died, or the outcome is unknown`,
      );
    }
  }

  let reportedRows = 0;
  let packetCount = 0;
  let annotationsSeen = 0;
  for (const pass of passes) {
    reportedRows += pass.rows.length;
    packetCount += pass.packets.length;
    annotationsSeen += pass.annotationsSeen;
  }

  return {
    file: opts.file ?? "(events)",
    passes,
    reportedRows,
    packetCount,
    annotationsSeen,
    malformedLines,
    problems,
  };
}

/** The half of a chat completion this file reads. Structural, so an older journal still parses. */
interface JournalledAnswer {
  choices?: {
    message?: { content?: string; annotations?: unknown };
  }[];
}

function readOne(
  attemptId: string,
  start: DebateAttemptStarted | undefined,
  json: unknown,
  problems: string[],
): ReportedPass {
  const short = attemptId.slice(0, 8);
  const base = {
    attemptId,
    pass: start?.pass ?? null,
    article: start?.article ?? null,
  };
  const choice = (json as JournalledAnswer).choices?.[0];
  if (!choice) {
    problems.push(`attempt ${short} answered with no choices — there are no rows and no packets in it`);
    return { ...base, rows: [], unreadable: "no-choices", packets: [], annotationsSeen: 0, unusable: [] };
  }

  /* A holder rather than a `let`, because `parsePass`'s refusal is a callback
     and TypeScript's control-flow analysis does not see through one. */
  const failure: { kind: DebateFailureClass | null } = { kind: null };
  let rows: unknown[] = [];
  try {
    rows = parsePass(choice.message?.content ?? "", (kind, err) => {
      failure.kind = kind;
      throw err;
    });
  } catch {
    /* The thrown message is never carried out: `parsePass`'s own sentences are
       authored and safe, but the *class* is what a report wants and it cannot
       ever pick up a stranger's page by accident. `replay.ts` makes the same
       call for the same reason. */
    if (failure.kind === null) failure.kind = "other";
    rows = [];
  }
  if (failure.kind !== null) {
    problems.push(
      `attempt ${short}: the fenced answer would not parse (${failure.kind}) — its rows are not in this count`,
    );
  }

  const { packets, unusable } = readPackets(choice.message?.annotations);
  const noExtract = unusable.filter((u) => u.why === "no content").length;
  if (noExtract > 0) {
    problems.push(
      `attempt ${short}: ${String(noExtract)} annotation(s) carried no extract — those pages cannot be a frozen packet`,
    );
  }
  if (packets.length === 0) {
    problems.push(`attempt ${short}: no usable annotation at all — there is nothing to freeze`);
  }

  return {
    ...base,
    rows,
    unreadable: failure.kind,
    packets,
    annotationsSeen: packets.length + unusable.length,
    unusable,
  };
}

/** Every annotation, sorted into packets and named failures. Nothing is dropped in silence. */
function readPackets(annotations: unknown): {
  packets: FrozenPacket[];
  unusable: UnusableAnnotation[];
} {
  const packets: FrozenPacket[] = [];
  const unusable: UnusableAnnotation[] = [];
  if (!Array.isArray(annotations)) return { packets, unusable };
  for (const [index, entry] of annotations.entries()) {
    const record = entry as { type?: unknown; url_citation?: unknown } | null;
    if (!record || typeof record !== "object") {
      unusable.push({ index, why: "not a url_citation" });
      continue;
    }
    if (record.type !== "url_citation") {
      unusable.push({ index, why: "not a url_citation" });
      continue;
    }
    const citation = record.url_citation as
      | { url?: unknown; title?: unknown; content?: unknown; start_index?: unknown; end_index?: unknown }
      | undefined;
    if (!citation || typeof citation !== "object") {
      unusable.push({ index, why: "no url_citation object" });
      continue;
    }
    if (typeof citation.url !== "string" || citation.url === "") {
      unusable.push({ index, why: "no url" });
      continue;
    }
    if (typeof citation.content !== "string") {
      unusable.push({ index, why: "no content" });
      continue;
    }
    packets.push({
      url: citation.url,
      title: typeof citation.title === "string" ? citation.title : null,
      content: citation.content,
      startIndex: typeof citation.start_index === "number" ? citation.start_index : null,
      endIndex: typeof citation.end_index === "number" ? citation.end_index : null,
    });
  }
  return { packets, unusable };
}

/** One line per pass, plus every problem, for a report. */
export function journalRowsLines(report: JournalRowsReport): string[] {
  const lines = report.passes.map((pass) => {
    const name = `${pass.pass ?? "(unknown)"} ${pass.attemptId.slice(0, 8)}`;
    const rows = pass.unreadable
      ? `rows UNREADABLE (${pass.unreadable})`
      : `${String(pass.rows.length).padStart(2)} row(s) reported`;
    const unusable = pass.unusable.length === 0 ? "" : `, ${String(pass.unusable.length)} unusable`;
    return `  ${name.padEnd(24)} ${rows}, ${String(pass.packets.length).padStart(2)} packet(s) of ${String(pass.annotationsSeen)} annotation(s)${unusable}`;
  });
  lines.push(
    `  ${"(totals)".padEnd(24)} ${String(report.reportedRows)} row(s), ${String(report.packetCount)} packet(s) of ${String(report.annotationsSeen)} annotation(s)`,
  );
  if (report.problems.length === 0) {
    lines.push("  no problems — every attempt in the file is accounted for");
  } else {
    lines.push(`  ${String(report.problems.length)} PROBLEM(S) — this is not a complete account of the file:`);
    for (const problem of report.problems) lines.push(`    - ${problem}`);
  }
  return lines;
}
