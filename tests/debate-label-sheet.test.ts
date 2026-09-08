/**
 * **The blind labelling instrument, and the guard that it really is blind.**
 *
 * Stage D′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md, whose
 * **F60** is the specification: *"label every evaluable row, show the labeller
 * only target, quote and evidence — `relation`, `lean` and `applies` hidden
 * — and label before any repaired output exists."*
 *
 * The first `describe` is the one that matters. Every row in its fixture carries
 * a distinctive sentinel in each of the four answer fields, and the assertion is
 * on the **rendered Markdown** — the surface a person actually reads — rather
 * than on the data structure, because a leak that reached only the renderer
 * would pass a structural check while sitting on the page.
 *
 * The rest are the ways a sheet can be quietly wrong without anything throwing:
 * a row dropped for having no evidence, a URL that matched twice reported as
 * one, ids that move when the seed does, and a header whose counts do not match
 * its own body. [silent-success.md](../docs/reusable/silent-success.md).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { journalRowsOf, type JournalRowsReport } from "../evals/debate/journal-rows.js";
import { writeSheetFile } from "../evals/debate/label-sheet-cli.js";
import {
  buildLabelSheet,
  DEFAULT_SEED,
  type LabelSheet,
  ORDER_STRATEGY,
  renderLabelSheet,
} from "../evals/debate/label-sheet.js";
import { LEAN_VALUES, RELATION_VALUES } from "../evals/debate/score.js";
import type { DebateJournalEvent, DebatePassKind } from "../src/debate-journal.js";

const temps: string[] = [];
afterAll(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------- fixtures ---- */

const FENCE_OPEN = "```debate";
const FENCE_CLOSE = "```";

function fence(rows: unknown): string {
  return `Here you go.\n\n${FENCE_OPEN}\n${JSON.stringify(rows)}\n${FENCE_CLOSE}\n`;
}

function started(attemptId: string, pass: DebatePassKind): DebateJournalEvent {
  return {
    event: "attempt-started",
    attemptId,
    at: "2026-09-06T09:24:39.913Z",
    pass,
    model: "anthropic/claude-sonnet-5",
    search: { engine: "exa", maxTotalResults: 12, maxResults: 5 },
    prompt: {
      systemSha256: "a".repeat(64),
      systemChars: 1,
      userSha256: "b".repeat(64),
      userChars: 1,
    },
    article: {
      slug: "cargocult",
      url: "https://example.com/cargo",
      title: "Cargo Cult Science",
      byline: "Richard Feynman",
      inputFingerprint: "fp",
    },
  };
}

function annotation(url: string, content: string, title: string | null = "A page") {
  return {
    type: "url_citation",
    url_citation: {
      url,
      ...(title === null ? {} : { title }),
      content,
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

/**
 * The four fields that must never reach a sheet, each carrying a string nothing
 * else in the fixture could produce.
 */
const SENTINELS = {
  relation: "SENTINEL-RELATION-Zqx",
  lean: "SENTINEL-LEAN-Zqx",
  applies: "SENTINEL-APPLIES-Zqx",
  limits: "SENTINEL-LIMITS-Zqx",
};

function directRow(url: string, quote: string) {
  return {
    url,
    sourceQuote: quote,
    articleReferenceQuote: "Feynman's Cargo Cult Science",
    ...SENTINELS,
  };
}

function claimRow(url: string, quote: string, blockId = "spya-k3m9qt") {
  return { url, blockId, claimQuote: "The article claims X.", sourceQuote: quote, ...SENTINELS };
}

/** A report over one direct pass and one claims pass, both fully evidenced. */
function twoPassReport(): JournalRowsReport {
  return journalRowsOf(
    [
      started("a1", "direct"),
      answered("a1", {
        content: fence([
          directRow("https://one.example/a", "the first quoted passage"),
          directRow("https://one.example/b", "the second quoted passage"),
        ]),
        annotations: [
          annotation("https://one.example/a", "extract for A", "Page A"),
          annotation("https://one.example/b", "extract for B", "Page B"),
        ],
      }),
      started("a2", "claims"),
      answered("a2", {
        content: fence([
          claimRow("https://two.example/c", "the third quoted passage"),
          claimRow("https://two.example/d", "the fourth quoted passage"),
        ]),
        annotations: [
          annotation("https://two.example/c", "extract for C", "Page C"),
          annotation("https://two.example/d", "extract for D", "Page D"),
        ],
      }),
    ],
    { file: "output/debate-runs/run-one/journal.jsonl" },
  );
}

/**
 * A report with `perPass` rows in each of the two passes, all evidenced — big
 * enough that an ordering property is a property rather than a coincidence.
 */
function wideReport(run: string, perPass: number): JournalRowsReport {
  const urls = (pass: string) =>
    Array.from({ length: perPass }, (_, i) => `https://${run}.example/${pass}/${String(i)}`);
  return journalRowsOf(
    [
      started("a1", "direct"),
      answered("a1", {
        content: fence(urls("d").map((url, i) => directRow(url, `${run} direct ${String(i)}`))),
        annotations: urls("d").map((url) => annotation(url, `extract ${url}`)),
      }),
      started("a2", "claims"),
      answered("a2", {
        content: fence(urls("c").map((url, i) => claimRow(url, `${run} claims ${String(i)}`))),
        annotations: urls("c").map((url) => annotation(url, `extract ${url}`)),
      }),
    ],
    { file: `output/debate-runs/${run}/journal.jsonl` },
  );
}

/**
 * The run-and-pass a row came from, read off the **quotation** rather than the
 * id — `wideReport` writes `"<run> <pass> <i>"` into every `sourceQuote`.
 *
 * Deliberately not the id: the id also encodes run and pass, so a mutation that
 * renumbered ids by position would make an adjacency check trivially pass while
 * the order it is checking was destroyed. The two channels have to be separate
 * for the check not to share an assumption with the code
 * ([silent-success.md](../docs/reusable/silent-success.md)).
 */
function stratumOf(row: { sourceQuote: string }): string {
  return row.sourceQuote.split(" ").slice(0, 2).join("/");
}

/** Every sheet the ordering tests use — three runs, uneven passes, like the real ones. */
function wideSheet(seed: number): LabelSheet {
  return buildLabelSheet([wideReport("run-a", 4), wideReport("run-b", 3), wideReport("run-c", 5)], {
    seed,
  });
}

/* ============================================================================
   The blinding — the whole point of the instrument
   ========================================================================== */

describe("what a labeller may see", () => {
  it("never renders relation, lean, applies or limits", () => {
    const text = renderLabelSheet(buildLabelSheet([twoPassReport()]));
    for (const [field, sentinel] of Object.entries(SENTINELS)) {
      expect(text, `${field}'s value leaked into the sheet`).not.toContain(sentinel);
    }
    /* And not the field names either: a sheet that printed "relation:" beside a
       blank would be teaching the labeller the model's vocabulary for the field
       it is about to be compared against.

       `lean` is deliberately not in this list, and cannot be: the sheet's whole
       question is *"which way does the quoted passage lean"*, and the options it
       offers are `leans-for` / `leans-against`, so the substring is on the page
       by design. Before the 2026-09-08 rename the field was called `valence`,
       a word the sheet never had to say, and this loop covered it. What still
       covers the lean field is the sentinel above — the model's *answer* is what
       must not leak, and that is asserted for all four fields. */
    for (const name of ["relation", "applies", "limits"]) {
      expect(text.toLowerCase(), `the sheet names the field "${name}"`).not.toContain(name);
    }
  });

  it("does render the target, the quotation and the evidence", () => {
    const text = renderLabelSheet(buildLabelSheet([twoPassReport()]));
    expect(text).toContain("Cargo Cult Science");
    expect(text).toContain("spya-k3m9qt");
    expect(text).toContain("The article claims X.");
    expect(text).toContain("the first quoted passage");
    expect(text).toContain("extract for A");
    expect(text).toContain("extract for D");
  });

  it("shows a group-one row the words in which the page names the article", () => {
    const sheet = buildLabelSheet([twoPassReport()]);
    const target = sheet.rows.find((r) => r.target.kind === "article")?.target;
    expect(target?.kind === "article" ? target.articleReferenceQuote : null).toBe(
      "Feynman's Cargo Cult Science",
    );
    const text = renderLabelSheet(sheet);
    expect(text).toContain("Where the outside page names this article**");
    expect(text).toContain("Feynman's Cargo Cult Science");
  });

  it("says a group-one row quoted no such words, rather than rendering a blank", () => {
    const report = journalRowsOf(
      [
        started("a1", "direct"),
        answered("a1", {
          content: fence([{ url: "https://one.example/a", sourceQuote: "unnamed", ...SENTINELS }]),
          annotations: [annotation("https://one.example/a", "extract for A")],
        }),
      ],
      { file: "output/debate-runs/run-one/journal.jsonl" },
    );
    const sheet = buildLabelSheet([report]);
    const target = sheet.rows[0]?.target;
    expect(target?.kind === "article" ? target.articleReferenceQuote : "unset").toBeNull();
    const text = renderLabelSheet(sheet);
    expect(text).toContain("the row quoted no words in which it does so");
    expect(text).not.toContain("Where the outside page names this article");
  });

  it("keeps the answer fields out of the data structure as well", () => {
    const sheet = buildLabelSheet([twoPassReport()]);
    expect(JSON.stringify(sheet)).not.toContain("SENTINEL-");
  });
});

/* ============================================================================
   The question the sheet asks, against the vocabulary that answers it
   ========================================================================== */

describe("the answers the sheet asks for", () => {
  /** The backticked options off the sheet's own instruction line. */
  function optionsIn(text: string): string[] {
    const line = text.split("\n").find((l) => l.includes("Answer with exactly one of:"));
    expect(line, "the sheet no longer states what to answer with").toBeDefined();
    return [...(line ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
  }

  /* Read off the exported constant, never a second hand-written list here: a
     list typed out in the test would share the assumption with a list typed out
     in the renderer, and agree with it while both were wrong. That is exactly
     how `unclear` — a relation, not one of these — reached the first draft of
     the sheet. */
  it("offers exactly the vocabulary the scorer joins labels on, in order", () => {
    const text = renderLabelSheet(buildLabelSheet([twoPassReport()]));
    expect(optionsIn(text)).toEqual([...LEAN_VALUES]);
  });

  it("offers nothing from the other vocabulary", () => {
    const offered = new Set(optionsIn(renderLabelSheet(buildLabelSheet([twoPassReport()]))));
    for (const relation of RELATION_VALUES) {
      if ((LEAN_VALUES as readonly string[]).includes(relation)) continue;
      expect(offered.has(relation), `the sheet offers "${relation}", which is a relation`).toBe(
        false,
      );
    }
  });
});

/* ============================================================================
   Evidence: none, and more than one
   ========================================================================== */

describe("matching a row to its frozen packet", () => {
  it("puts a row whose URL no annotation returned in the not-evaluable list, with a reason", () => {
    const report = journalRowsOf(
      [
        started("a1", "direct"),
        answered("a1", {
          content: fence([
            directRow("https://one.example/a", "kept"),
            directRow("https://nowhere.example/x", "lost"),
          ]),
          annotations: [annotation("https://one.example/a", "extract for A")],
        }),
      ],
      { file: "output/debate-runs/run-one/journal.jsonl" },
    );
    const sheet = buildLabelSheet([report]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.notEvaluable).toHaveLength(1);
    expect(sheet.notEvaluable[0]?.why).toContain("https://nowhere.example/x");
    expect(sheet.notEvaluable[0]?.why).toContain("not on disk");
    expect(sheet.rowsReported).toBe(2);
    expect(sheet.rows.length + sheet.notEvaluable.length).toBe(sheet.rowsReported);
    /* And the reader of the sheet is told, not left to count. */
    const text = renderLabelSheet(sheet);
    expect(text).toContain("Rows that cannot be labelled: **1**");
    expect(text).toContain("https://nowhere.example/x");
  });

  it("keeps every extract when several annotations share the row's URL, and says how many", () => {
    const report = journalRowsOf(
      [
        started("a1", "direct"),
        answered("a1", {
          content: fence([directRow("https://one.example/a", "shared")]),
          annotations: [
            annotation("https://one.example/a", "first extract", "Page A"),
            annotation("https://one.example/a", "second extract", "Page A again"),
          ],
        }),
      ],
      { file: "output/debate-runs/run-one/journal.jsonl" },
    );
    const sheet = buildLabelSheet([report]);
    expect(sheet.rows[0]?.evidence).toHaveLength(2);
    const text = renderLabelSheet(sheet);
    expect(text).toContain("**1** row(s) cite a URL that more than one annotation returned");
    expect(text).toContain("Extract 1 of 2");
    expect(text).toContain("Extract 2 of 2");
    expect(text).toContain("first extract");
    expect(text).toContain("second extract");
  });

  it("names the other ways a row cannot be labelled rather than dropping it", () => {
    const report = journalRowsOf(
      [
        started("a1", "claims"),
        answered("a1", {
          content: fence([
            "not an object",
            { url: "https://one.example/a" },
            { url: "https://one.example/a", sourceQuote: "q", claimQuote: "c" },
            { url: "https://one.example/a", sourceQuote: "q", blockId: "spya-k3m9qt" },
          ]),
          annotations: [annotation("https://one.example/a", "extract for A")],
        }),
      ],
      { file: "output/debate-runs/run-one/journal.jsonl" },
    );
    const sheet = buildLabelSheet([report]);
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.notEvaluable.map((r) => r.why).sort()).toEqual([
      "the reported row is not an object, so it has no quotation to label",
      "the row carried no claimQuote, so there is no target claim to label against",
      "the row carried no sourceQuote, so there is no passage to label",
      "the row names no blockId, so its target claim cannot be located",
    ]);
  });
});

/* ============================================================================
   Ids and order
   ========================================================================== */

describe("regenerating the sheet", () => {
  it("gives the same ids and the same order for the same input", () => {
    const a = buildLabelSheet([twoPassReport()]);
    const b = buildLabelSheet([twoPassReport()]);
    expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id));
    expect(renderLabelSheet(b)).toEqual(renderLabelSheet(a));
  });

  it("changes the order but not the ids when the seed changes", () => {
    const a = wideSheet(1);
    const b = wideSheet(2);
    expect(b.rows.map((r) => r.id)).not.toEqual(a.rows.map((r) => r.id));
    expect([...b.rows.map((r) => r.id)].sort()).toEqual([...a.rows.map((r) => r.id)].sort());
  });

  it("derives the id from the row's own position in the answer, not from the shuffled one", () => {
    const sheet = buildLabelSheet([twoPassReport()], { seed: 7 });
    const byId = new Map(sheet.rows.map((r) => [r.id, r]));
    /* Row 0 of the direct pass is the one quoting "the first quoted passage",
       whatever position the shuffle gave it. */
    const first = [...byId.values()].find((r) => r.sourceQuote === "the first quoted passage");
    expect(first?.id).toMatch(/^run-one\/direct\/0-[0-9a-f]{8}$/);
    const third = [...byId.values()].find((r) => r.sourceQuote === "the third quoted passage");
    expect(third?.id).toMatch(/^run-one\/claims\/0-[0-9a-f]{8}$/);
  });

  it("prints the strategy and the seed it used, not just the seed", () => {
    const text = renderLabelSheet(buildLabelSheet([twoPassReport()]));
    expect(text).toContain(`**${ORDER_STRATEGY}**, seed \`${String(DEFAULT_SEED)}\``);
    expect(text).toContain("The head of the sheet was not chosen");
    expect(renderLabelSheet(buildLabelSheet([twoPassReport()], { seed: 99 }))).toContain(
      `**${ORDER_STRATEGY}**, seed \`99\``,
    );
  });
});

/* ============================================================================
   The order is constrained, not merely random
   ========================================================================== */

describe("the stratified order", () => {
  /* Swept across seeds rather than asserted on one, because a constraint that
     holds for the seed you happened to try is a coincidence, and this whole
     change exists because a single draw looked fine and was not. */
  it("never puts two rows from the same run and pass next to each other, for any seed", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rows = wideSheet(seed).rows;
      expect(rows).toHaveLength(24);
      /* Six strata of 3–5 rows: the largest has 5, the rest 19 between them, so
         no bucket ever outlives the others and the guarantee holds throughout. */
      for (let i = 1; i < rows.length; i += 1) {
        const before = rows[i - 1];
        const here = rows[i];
        if (before === undefined || here === undefined) continue;
        expect(
          stratumOf(here),
          `seed ${String(seed)}: rows ${String(i)} and ${String(i + 1)} are both from ${stratumOf(here)}`,
        ).not.toBe(stratumOf(before));
      }
    }
  });

  it("still shuffles within a stratum, rather than keeping the model's order", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const inRunA = wideSheet(seed)
        .rows.filter((r) => stratumOf(r) === "run-a/direct")
        .map((r) => r.id)
        .join(",");
      orders.add(inRunA);
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("keeps every row — the constraint reorders, it does not filter", () => {
    const sheet = wideSheet(DEFAULT_SEED);
    expect(sheet.rows).toHaveLength(sheet.rowsReported);
    expect(new Set(sheet.rows.map((r) => r.id)).size).toBe(sheet.rows.length);
  });
});

/* ============================================================================
   The header is an account of the sheet, and of the runs
   ========================================================================== */

describe("what the header declares", () => {
  it("counts what the body actually holds", () => {
    const sheet = buildLabelSheet([twoPassReport()]);
    const text = renderLabelSheet(sheet);
    expect(text).toContain(`Rows the journals reported: **${String(sheet.rowsReported)}**`);
    expect(text).toContain(`Rows to label on this sheet: **${String(sheet.rows.length)}**`);
    expect(text).toContain(`Frozen packets seen across the runs: **${String(sheet.packetsSeen)}**`);
    /* Counted off the rendered body rather than off the same field the header
       read, so a renderer that printed four of five rows would redden here. */
    const headings = text.match(/^### \d+\. `/gm) ?? [];
    expect(headings).toHaveLength(sheet.rows.length);
    expect(sheet.rows.length + sheet.notEvaluable.length).toBe(sheet.rowsReported);
    expect(sheet.packetsSeen).toBe(4);
  });

  it("carries every problem the journals reported into the sheet", () => {
    const report = journalRowsOf(
      [
        started("a1", "direct"),
        started("a2", "claims"),
        answered("a1", {
          content: "no fence here at all",
          annotations: [annotation("https://one.example/a", "extract for A")],
        }),
      ],
      { file: "output/debate-runs/run-one/journal.jsonl" },
    );
    expect(report.problems.length).toBeGreaterThan(0);
    const sheet = buildLabelSheet([report]);
    expect(sheet.problems).toHaveLength(report.problems.length);
    const text = renderLabelSheet(sheet);
    expect(text).toContain(
      `**${String(report.problems.length)} problem(s) reported by the journals`,
    );
    for (const problem of report.problems) expect(text).toContain(problem);
  });

  it("says so plainly when there is nothing to report", () => {
    const text = renderLabelSheet(buildLabelSheet([twoPassReport()]));
    expect(text).toContain("No problems were reported by the journals");
  });

  it("flags two reports sharing a run name, because their ids would collide", () => {
    const sheet = buildLabelSheet([twoPassReport(), twoPassReport()]);
    expect(sheet.problems.some((p) => p.includes("both called"))).toBe(true);
  });
});

/* ============================================================================
   The CLI's one refusal
   ========================================================================== */

describe("writing the sheet to a file", () => {
  it("refuses to overwrite a path that already exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-label-sheet-"));
    temps.push(dir);
    const file = path.join(dir, "sheet.md");
    await writeSheetFile(file, "first\n");
    await expect(writeSheetFile(file, "second\n")).rejects.toThrow(/already exists/);
    expect(await readFile(file, "utf-8")).toBe("first\n");
  });

  it("creates the directory it is pointed at", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-label-sheet-"));
    temps.push(dir);
    const file = path.join(dir, "nested", "sheet.md");
    await writeSheetFile(file, renderLabelSheet(buildLabelSheet([twoPassReport()])));
    expect(await readFile(file, "utf-8")).toContain("# Debate-mode blind labelling sheet");
  });

  it("refuses even when the existing file was written by something else", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spideryarn-label-sheet-"));
    temps.push(dir);
    const file = path.join(dir, "sheet.md");
    await writeFile(file, "somebody's labels\n", "utf-8");
    await expect(writeSheetFile(file, "new\n")).rejects.toThrow(/will not overwrite/);
  });
});
