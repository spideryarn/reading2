import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type ArmFile, report, screenModes } from "../evals/paperwork/modes.js";

const quotes = (n: number) => ({
  quotes: { quotes: Array.from({ length: n }, (_, i) => ({ text: `Quote ${i}`, reason: "kept", blockId: "spya-qqq001" })) },
});

/* Only Quotes is under test; a real arm file holds every mode, so the rest are failures. */
const skipped = { error: "not under test" };
const file = (slug: string, outputs: ArmFile["outputs"]): ArmFile => ({
  slug,
  arm: "after",
  sourceSha256: {},
  outputs: {
    sketch: skipped, illustrated: skipped, faq: skipped, quiz: skipped, ideas: skipped,
    glossary: skipped, timeline: skipped, arc: skipped,
    ...outputs,
  },
});

describe("the paperwork-modes totals", () => {
  it("count the articles a mode failed on, not only the ones it answered", () => {
    const { totals, rows } = screenModes([
      file("one", { quotes: quotes(3) }),
      file("two", { quotes: { error: "refused" } }),
      file("three", { quotes: { error: "cut off" } }),
    ]);
    expect(totals["after\tquotes"]).toEqual({ attempted: 3, failed: 2, items: 3, byId: 0, byWords: 0 });
    expect(rows.filter((r) => r.includes("\tquotes\tERROR"))).toHaveLength(2);
  });

  it("show a mode that failed on every article, with no items", () => {
    const { totals } = screenModes([file("one", { quotes: { error: "refused" } })]);
    expect(totals["after\tquotes"]).toEqual({ attempted: 1, failed: 1, items: 0, byId: 0, byWords: 0 });
  });

  it("still reports real arms after pairs has written a comparison and its exclusions", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "paperwork-modes-report-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      fs.mkdirSync(path.join(out, "after"));
      fs.writeFileSync(path.join(out, "after", "one.json"), JSON.stringify(file("one", { quotes: quotes(3) })));
      const comparison = path.join(out, "pairs-before-vs-after");
      fs.mkdirSync(comparison);
      fs.writeFileSync(path.join(comparison, "pairs.md"), "# Blind pairs\n");
      fs.writeFileSync(path.join(comparison, "key.json"), JSON.stringify([{ id: "P1", left: "before", right: "after" }]));
      fs.writeFileSync(path.join(comparison, "exclusions.json"), JSON.stringify([{ slug: "two", field: "quotes", reason: "failed" }]));
      expect(() => report(out)).not.toThrow();
      expect(log.mock.calls.flat().join("\n")).toContain("after\tquotes\t1\t1\t0\t3\t0\t0");
    } finally {
      log.mockRestore();
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
