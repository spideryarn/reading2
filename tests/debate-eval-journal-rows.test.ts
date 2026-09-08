/**
 * **Reading a captured journal, and the one rule that file exists to keep: a
 * list quietly shorter than what the file contained must say so.**
 *
 * Stage B′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *The bug's own rows were on disk all along*. `evals/debate/journal-rows.ts`
 * is the only part of the free instrument that touches the disk; everything it
 * hands back is raw — the rows exactly as the fence produced them and the
 * extracts exactly as the provider sent them — because `score.ts` computes the
 * raw answer vocabulary *before* any coercion and cannot be handed values that
 * have already been through `RELATIONS.has(...) ? ... : "unclear"`.
 *
 * Every case below is a way the count can come out short without anything
 * throwing: an unparseable fence, an attempt that never heard back, a refusal,
 * a 2xx whose bytes are gone, a truncated last line, an annotation with no
 * extract. [silent-success.md](../docs/reusable/silent-success.md).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  journalPath,
  journalRowsLines,
  journalRowsOf,
  readJournalRows,
} from "../evals/debate/journal-rows.js";
import { vocabularyReport } from "../evals/debate/score.js";
import type { DebateJournalEvent, DebatePassKind } from "../src/debate-journal.js";

const temps: string[] = [];
afterAll(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function writeJournal(lines: readonly string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-journal-rows-"));
  temps.push(dir);
  const file = path.join(dir, "journal.jsonl");
  await writeFile(file, lines.map((l) => `${l}\n`).join(""), "utf-8");
  return file;
}

function started(attemptId: string, pass: DebatePassKind): DebateJournalEvent {
  return {
    event: "attempt-started",
    attemptId,
    at: "2026-09-06T09:24:39.913Z",
    pass,
    model: "anthropic/claude-sonnet-5",
    search: { engine: "exa", maxTotalResults: 12, maxResults: 5 },
    prompt: { systemSha256: "a".repeat(64), systemChars: 1, userSha256: "b".repeat(64), userChars: 1 },
    article: {
      slug: "cargocult",
      url: "https://example.com/cargo",
      title: "Cargo Cult Science",
      byline: "Richard Feynman",
      inputFingerprint: "fp",
    },
  };
}

/* Named, so the fence markers do not have to be escaped into a template. */
const FENCE_OPEN = "```debate";
const FENCE_CLOSE = "```";

function fence(rows: unknown): string {
  return `Here you go.\n\n${FENCE_OPEN}\n${JSON.stringify(rows)}\n${FENCE_CLOSE}\n`;
}

function annotation(url: string, content: string | null, title: string | null = "A page") {
  return {
    type: "url_citation",
    url_citation: {
      url,
      ...(title === null ? {} : { title }),
      ...(content === null ? {} : { content }),
      start_index: 0,
      end_index: 0,
    },
  };
}

function answered(
  attemptId: string,
  opts: { content: string; annotations?: unknown },
): DebateJournalEvent {
  return {
    event: "provider-response",
    attemptId,
    at: "2026-09-06T09:24:52.000Z",
    response: {
      kind: "body",
      answeredBy: "anthropic/claude-sonnet-5",
      generationId: "gen-1",
      json: {
        choices: [
          {
            finish_reason: "stop",
            message: { content: opts.content, annotations: opts.annotations ?? [] },
          },
        ],
        usage: {},
      },
    },
  };
}

/* ============================================================================
   The happy path, and what "raw" means
   ========================================================================== */

describe("reading a captured pass", () => {
  it("hands back the rows and the frozen packets, both raw", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      answered("a1", {
        content: fence([{ relation: "disputes", valence: "negative", url: "https://x.example/1" }]),
        annotations: [annotation("https://x.example/1", "the extract the model was shown")],
      }),
      {
        event: "attempt-finished",
        attemptId: "a1",
        at: "2026-09-06T09:24:53.000Z",
        elapsedMs: 13_000,
        outcome: "ok",
        failure: null,
      },
    ]);
    expect(report.problems).toEqual([]);
    expect(report.passes).toHaveLength(1);
    const pass = report.passes[0];
    expect(pass?.pass).toBe("direct");
    expect(pass?.article?.slug).toBe("cargocult");
    expect(pass?.rows).toEqual([
      { relation: "disputes", valence: "negative", url: "https://x.example/1" },
    ]);
    expect(pass?.packets).toEqual([
      {
        url: "https://x.example/1",
        title: "A page",
        content: "the extract the model was shown",
        startIndex: 0,
        endIndex: 0,
      },
    ]);
    expect(report.reportedRows).toBe(1);
    expect(report.packetCount).toBe(1);
  });

  /**
   * The F62 requirement, at the seam rather than in `score.ts`: the reader must
   * not coerce, or the raw vocabulary report downstream has nothing to look at.
   */
  it("does not coerce an out-of-vocabulary answer on the way through", () => {
    const report = journalRowsOf([
      started("a1", "claims"),
      answered("a1", {
        content: fence([
          { relation: "contradicts", valence: "supportive" },
          { relation: "agrees-with", valence: "critical" },
        ]),
        annotations: [annotation("https://x.example/1", "extract")],
      }),
    ]);
    const pass = report.passes[0];
    expect(pass?.rows).toEqual([
      { relation: "contradicts", valence: "supportive" },
      { relation: "agrees-with", valence: "critical" },
    ]);
    const vocabulary = vocabularyReport(pass?.rows ?? []);
    expect(vocabulary.offVocabularyRows).toBe(2);
    expect(vocabulary.valences.map((v) => v.label).sort()).toEqual(["critical", "supportive"]);
  });

  it("reads the pass off attempt-started, never off its position in the file", () => {
    /* The claims pass answering first is not a shape any run on disk has, and
       it is exactly the shape an ordinal rule would get wrong. */
    const report = journalRowsOf([
      started("a1", "direct"),
      started("a2", "claims"),
      answered("a2", { content: fence([]), annotations: [annotation("https://x/1", "e")] }),
    ]);
    expect(report.passes.map((p) => p.pass)).toEqual(["claims"]);
    expect(report.problems.join(" ")).toContain("started and never heard back");
  });

  it("tells an honest zero-row answer from an unreadable one", () => {
    const honest = journalRowsOf([
      started("a1", "direct"),
      answered("a1", { content: fence([]), annotations: [annotation("https://x/1", "e")] }),
    ]);
    expect(honest.passes[0]?.rows).toEqual([]);
    expect(honest.passes[0]?.unreadable).toBeNull();
    expect(honest.problems).toEqual([]);

    const truncated = journalRowsOf([
      started("a1", "direct"),
      answered("a1", {
        content: "```debate\n[{\"relation\": \"disputes\"",
        annotations: [annotation("https://x/1", "e")],
      }),
    ]);
    expect(truncated.passes[0]?.rows).toEqual([]);
    expect(truncated.passes[0]?.unreadable).toBe("answer-not-parseable");
    expect(truncated.reportedRows).toBe(0);
    expect(truncated.problems.join(" ")).toContain("would not parse");
  });
});

/* ============================================================================
   Every way the count comes out short
   ========================================================================== */

describe("a count that is short says so", () => {
  it("reports an attempt that started and never heard back", () => {
    const report = journalRowsOf([started("a1", "direct"), started("a2", "claims")]);
    expect(report.passes).toEqual([]);
    expect(report.problems).toHaveLength(2);
    expect(report.problems.every((p) => p.includes("never heard back"))).toBe(true);
  });

  it("reports a refusal rather than an empty answer", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      {
        event: "provider-response",
        attemptId: "a1",
        at: "2026-09-06T09:24:52.000Z",
        response: {
          kind: "refused",
          status: 429,
          refusalKind: null,
          retryAfterMs: null,
          bodyUnavailable: "the body is never carried out of ai-call.ts",
        },
      },
    ]);
    expect(report.passes).toEqual([]);
    expect(report.reportedRows).toBe(0);
    expect(report.problems.join(" ")).toContain("refused with 429");
  });

  it("reports the documented gap — a 2xx whose bytes are not in the journal", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      {
        event: "provider-response",
        attemptId: "a1",
        at: "2026-09-06T09:24:52.000Z",
        response: { kind: "body", json: null, answeredBy: null, generationId: null },
      },
    ]);
    expect(report.passes).toEqual([]);
    expect(report.problems.join(" ")).toContain("bytes are not in the journal");
  });

  it("reports an answer with no choices", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      {
        event: "provider-response",
        attemptId: "a1",
        at: "2026-09-06T09:24:52.000Z",
        response: { kind: "body", json: { choices: [] }, answeredBy: null, generationId: null },
      },
    ]);
    expect(report.passes[0]?.unreadable).toBe("no-choices");
    expect(report.problems.join(" ")).toContain("no choices");
  });

  it("reports an annotation with no extract, which cannot be a frozen packet", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      answered("a1", {
        content: fence([]),
        annotations: [
          annotation("https://x/1", "an extract"),
          annotation("https://x/2", null),
          { type: "file_citation", file: {} },
          annotation("", "an extract for a page with no address"),
        ],
      }),
    ]);
    const pass = report.passes[0];
    expect(pass?.packets).toHaveLength(1);
    expect(pass?.annotationsSeen).toBe(4);
    expect(pass?.unusable).toEqual([
      { index: 1, why: "no content" },
      { index: 2, why: "not a url_citation" },
      { index: 3, why: "no url" },
    ]);
    expect(report.problems.join(" ")).toContain("carried no extract");
  });

  it("reports an answer with no usable annotation at all", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      answered("a1", { content: fence([]), annotations: [] }),
    ]);
    expect(report.problems.join(" ")).toContain("nothing to freeze");
  });

  it("reports an answered attempt whose start is missing", () => {
    const report = journalRowsOf([
      answered("ghost", { content: fence([]), annotations: [annotation("https://x/1", "e")] }),
    ]);
    expect(report.passes[0]?.pass).toBeNull();
    expect(report.passes[0]?.article).toBeNull();
    expect(report.problems.join(" ")).toContain("has no attempt-started");
  });

  it("says 'no problems' out loud when nothing is short", () => {
    const report = journalRowsOf([
      started("a1", "direct"),
      answered("a1", {
        content: fence([{ relation: "disputes", valence: "negative" }]),
        annotations: [annotation("https://x/1", "e")],
      }),
    ]);
    const text = journalRowsLines(report).join("\n");
    expect(text).toContain("no problems");
    expect(text).toContain("1 row(s), 1 packet(s)");
  });

  it("puts every problem in the printed lines under a heading that says the account is incomplete", () => {
    const text = journalRowsLines(journalRowsOf([started("a1", "direct")])).join("\n");
    expect(text).toContain("PROBLEM(S)");
    expect(text).toContain("not a complete account of the file");
  });
});

/* ============================================================================
   The file on disk
   ========================================================================== */

describe("the file itself", () => {
  it("reads a journal off disk and reports a truncated last line", async () => {
    const file = await writeJournal([
      JSON.stringify(started("a1", "direct")),
      JSON.stringify(
        answered("a1", {
          content: fence([{ relation: "disputes", valence: "negative" }]),
          annotations: [annotation("https://x/1", "an extract")],
        }),
      ),
      '{"event":"attempt-fin',
    ]);
    const report = await readJournalRows(file);
    expect(report.reportedRows).toBe(1);
    expect(report.packetCount).toBe(1);
    expect(report.malformedLines).toEqual([3]);
    expect(report.problems.join(" ")).toContain("could not be read");
    expect(report.problems.join(" ")).toContain("not fully accounted for");
  });

  it("builds the path a run's journal lives at", () => {
    expect(journalPath("2026-09-06T09-24-37-cargocult", "output/debate-runs")).toBe(
      "output/debate-runs/2026-09-06T09-24-37-cargocult/journal.jsonl",
    );
  });

  it("refuses to treat a missing journal as an empty one", async () => {
    await expect(readJournalRows(path.join(tmpdir(), "spideryarn-no-such-journal.jsonl"))).rejects.toThrow();
  });
});
