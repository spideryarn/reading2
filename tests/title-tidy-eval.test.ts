/** The benchmark must compare what import would store, and keep contexts distinct. */
import { describe, expect, it } from "vitest";
import { rowFor, summarizeArm, type Input, type Row } from "../evals/title-tidy/stats.js";
const input = (id: number, site: string | null): Input => ({ id, set: `set-${id}`, title: "BOOK | Site", site_name: site });
const row = (id: number, run: number, out: string | null): Row => ({
  inputId: id, arm: "deepseek", run, set: `set-${id}`, title: "BOOK | Site", out,
  error: out === null ? "TitleTidyAnswerInvalid" : null, nanos: 0, ms: 1, upstream: null, inTok: 0, outTok: 0, reasonTok: 0, retries: 0,
});
describe("title eval statistics", () => {
  it("counts refusal states separately from actual stored-title changes", () => {
    const inputs = [input(0, "Site")];
    const rows = [row(0, 1, null), row(0, 2, "Book | Site")];
    const stats = summarizeArm(inputs, rows, new Map([[0, "Book | Site"]]), "deepseek", 2);
    expect(stats).toMatchObject({ modelChanged: 0, storedChanged: 1, differsFromRule: 0, rawDisagree: 1, storedDisagree: 0 });
    expect(stats.errors).toHaveLength(1);
  });
  it("keeps equal title text with different page context separate, regardless of completion order", () => {
    const inputs = [input(0, "Site"), input(1, null)];
    const rows = [row(1, 2, null), row(1, 1, "BOOK | Site"), row(0, 2, "Book"), row(0, 1, "Book")];
    const rule = new Map([[0, "BOOK | Site"], [1, "BOOK | Site"]]);
    expect(rowFor(rows, "deepseek", 1, 0)?.out).toBe("Book");
    expect(rowFor(rows, "deepseek", 1, 1)?.out).toBe("BOOK | Site");
    expect(summarizeArm(inputs, rows, rule, "deepseek", 2)).toMatchObject({
      modelChanged: 1, storedChanged: 1, differsFromRule: 1, rawDisagree: 1, storedDisagree: 0,
    });
  });
  it("counts real stored-title disagreement while excluding other arms", () => {
    const rows = [row(0, 1, "Book"), row(0, 2, null), { ...row(0, 1, "Wrong"), arm: "luna" }];
    expect(summarizeArm([input(0, "Site")], rows, new Map([[0, "BOOK | Site"]]), "deepseek", 2))
      .toMatchObject({ storedDisagree: 1, rawDisagree: 1, differsFromRule: 1 });
  });
});
