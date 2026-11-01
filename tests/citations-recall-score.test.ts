import { describe, expect, it } from "vitest";
import { fromEntry, match, type Row, type TruthWork } from "../evals/citations-recall/score.js";

const row = (overrides: Partial<Row>): Row => ({
  title: "A work",
  mentions: [],
  ...overrides,
});

const work = (overrides: Partial<TruthWork>): TruthWork => ({
  key: "Smith:2020",
  surname: "Smith",
  year: "2020",
  citedIn: [],
  ...overrides,
});

describe("the citations-recall matcher", () => {
  it("uses an exact letter suffix in a verified quote when the row's year is bare", () => {
    const works = [
      work({ key: "Chen:2020a", surname: "Chen", year: "2020a", ambiguous: true }),
      work({ key: "Chen:2020b", surname: "Chen", year: "2020b", ambiguous: true }),
    ];
    const result = match(
      [
        row({
          authors: "Chen et al.",
          year: "2020",
          mentions: [{ blockId: "spya-body01", quote: "SimCLR (Chen et al., 2020a)" }],
        }),
      ],
      works,
    );

    expect([...result.covered]).toEqual(["Chen:2020a"]);
    expect(result.matched.get("Chen:2020a")).toBeDefined();
  });

  it("matches a non-numeric date phrase from the anchored evidence", () => {
    const result = match(
      [row({ title: "Chalmers (forthcoming)", mentions: [{ blockId: "spya-body02", quote: "Chalmers (forthcoming)" }] })],
      [work({ key: "Chalmers:forthcoming", surname: "Chalmers", year: "forthcoming" })],
    );

    expect([...result.covered]).toEqual(["Chalmers:forthcoming"]);
  });

  it("counts a primary block repeated in aliases as one owner", () => {
    const result = match(
      [row({ reference: { blockId: "spya-ref001", quote: "An entry" } })],
      [
        work({
          key: "#24",
          surname: null,
          year: null,
          number: 24,
          refBlock: "spya-ref001",
          aliases: [
            { number: 24, refBlock: "spya-ref001" },
            { number: 66, refBlock: "spya-ref002" },
          ],
        }),
      ],
    );

    expect([...result.covered]).toEqual(["#24"]);
  });

  it("accepts the numbered-entry punctuation production accepts", () => {
    const result = match(
      [row({ entry: "8) Smith, J. A work (2020)." })],
      [work({ key: "#8", surname: null, year: null, number: 8 })],
    );

    expect([...result.covered]).toEqual(["#8"]);
    expect(fromEntry("8) Smith, J. A work (2020).")).toEqual({ surname: "Smith", year: "2020" });
    expect(fromEntry("[9] Hume, D. A work (1748).")).toEqual({ surname: "Hume", year: "1748" });
  });

  it("does not treat a block shared by two truth works as an exact identity", () => {
    const result = match(
      [row({ reference: { blockId: "spya-note01", quote: "A compound note" } })],
      [
        work({ key: "#1", surname: null, year: null, refBlock: "spya-note01" }),
        work({ key: "#2", surname: null, year: null, refBlock: "spya-note01" }),
      ],
    );

    expect(result.covered.size).toBe(0);
  });
});
