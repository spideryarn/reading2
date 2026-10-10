/**
 * **A band whose button says "Find the …" says "Finding…" while it runs**:
 * plan 261007a § K3.
 *
 * Citations and FAQ said "Find the citations" / "Find the questions" and then
 * "Reading…", where Ideas and Glossary say "Finding…". `runningLabel` is what
 * `JobProgress` shows for the moment between two named steps, so a mounted
 * test would need a job caught mid-step; this reads the source instead, which
 * is enough for one string beside another in one file.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(`../src/web/${name}`, import.meta.url), "utf8");

describe.each(["BibliographyPanel.tsx", "FaqPanel.tsx", "IdeasPanel.tsx"])("%s", (name) => {
  const text = source(name);
  it("has a run button that says Find", () => {
    expect(text).toMatch(/run\("Find (the|them) /);
  });
  it("says Finding… while it runs, and nothing else", () => {
    const labels = [...text.matchAll(/runningLabel="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels)).toEqual(new Set(["Finding…"]));
  });
});
