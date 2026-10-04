import { describe, expect, it } from "vitest";
import { admitExclusions, type ArmFile, pairUp } from "../evals/paperwork/run.js";

const arm = (name: string, slug: string, over: Partial<ArmFile> = {}): ArmFile => ({
  arm: name,
  slug,
  at: "2026-10-04T00:00:00.000Z",
  sourceSha256: {},
  versions: { toc: "toc/12", tweets: "tweets/1", simple: "simple-prompt/1" },
  gists: [{ depth: 0, range: "spya-aaa001..spya-aaa002", title: `${name} ${slug}`, gist: "A claim." }],
  simple: { brief: ["b"], simple: ["s"], fuller: ["f"] },
  tweets: ["one"],
  ...over,
});

describe("the paperwork comparison's pairs", () => {
  it("pairs every field of an article both arms answered, and excludes nothing", () => {
    const { pairs, exclusions } = pairUp("before", "after", [arm("before", "x")], [arm("after", "x")]);
    expect(pairs.map((p) => p.label)).toEqual([
      "Structure", "Brief summary", "Simple summary", "Fuller summary", "Thread",
    ]);
    expect(exclusions).toEqual([]);
  });

  it("names an article missing from B, one only in B, and each failed field", () => {
    const { pairs, exclusions } = pairUp(
      "before",
      "after",
      [arm("before", "both", { tweets: { error: "boom" } }), arm("before", "only-a")],
      [arm("after", "both", { gists: { error: "cut off" } }), arm("after", "only-b")],
    );
    // What is left: the three summary levels of the one shared article.
    expect(pairs.map((p) => `${p.slug}/${p.label}`)).toEqual([
      "both/Brief summary", "both/Simple summary", "both/Fuller summary",
    ]);
    expect(exclusions).toEqual([
      { slug: "both", field: "Structure", reason: "failed in after: cut off" },
      { slug: "both", field: "Thread", reason: "failed in before: boom" },
      { slug: "only-a", reason: "no file in after" },
      { slug: "only-b", reason: "no file in before" },
    ]);
  });

  it("says so when a field failed in both arms", () => {
    const bad = { simple: { error: "refused" } };
    const { exclusions } = pairUp("before", "after", [arm("before", "x", bad)], [arm("after", "x", bad)]);
    expect(exclusions.map((e) => `${e.field}: ${e.reason}`)).toEqual([
      "Brief summary: failed in before: refused; failed in after: refused",
      "Simple summary: failed in before: refused; failed in after: refused",
      "Fuller summary: failed in before: refused; failed in after: refused",
    ]);
  });
});

describe("a short comparison", () => {
  const out = [{ slug: "only-a", reason: "no file in after" }];

  it("is refused, with the list, unless --partial asked for it", () => {
    expect(() => admitExclusions(out, false)).toThrow(/leaves 1 out[\s\S]*only-a: no file in after[\s\S]*--partial/);
  });

  it("goes ahead under --partial, and a full one always does", () => {
    expect(admitExclusions(out, true)).toContain("only-a: no file in after");
    expect(admitExclusions([], false)).toBe("");
  });
});
