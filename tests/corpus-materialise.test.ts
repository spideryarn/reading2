import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORPUS_ROOT, describeMaterialise, materialiseCorpus } from "../scripts/corpus-materialise.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "spya-corpus-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const seed = (half: string, file = "a.json") => {
  const dir = path.join(root, CORPUS_ROOT, half, "slug");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), `{"half":"${half}"}`);
};

describe("materialiseCorpus", () => {
  it("copies both halves into place", () => {
    seed("data"); seed("output");
    const r = materialiseCorpus(root);
    expect(r.copied).toEqual(["data/", "output/"]);
    expect(r.missing).toEqual([]);
    expect(readFileSync(path.join(root, "data/slug/a.json"), "utf8")).toContain("data");
    expect(existsSync(path.join(root, "output/slug/a.json"))).toBe(true);
  });

  it("names a missing half rather than pretending it copied it", () => {
    // Copying only `data/` once made the deploy gate structurally incapable of
    // passing, and the line reporting it named both directories regardless.
    seed("data");
    const r = materialiseCorpus(root);
    expect(r.copied).toEqual(["data/"]);
    expect(r.missing).toEqual(["output/"]);
    expect(describeMaterialise(r)).toContain("has no output/");
  });

  it("says nothing was copied when the corpus is absent entirely", () => {
    const r = materialiseCorpus(root);
    expect(r.copied).toEqual([]);
    expect(describeMaterialise(r)).toContain("neither half");
    expect(describeMaterialise(r)).toContain("empty store");
  });

  it("overwrites an existing store rather than failing on it", () => {
    seed("data"); seed("output");
    mkdirSync(path.join(root, "data/slug"), { recursive: true });
    writeFileSync(path.join(root, "data/slug/a.json"), "stale");
    materialiseCorpus(root);
    expect(readFileSync(path.join(root, "data/slug/a.json"), "utf8")).toContain("half");
  });
});
