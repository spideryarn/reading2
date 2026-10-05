/**
 * **No file under `docs/` is implausibly large.**
 *
 * On 2026-10-03 a plan went from 17 KB to 22 MB in one commit: a scripted edit
 * called `s.replace(old, new)` with an `old` that had come out empty, which puts
 * `new` at every position in the file. Nothing raised, every test passed, and
 * the file sat on `dev` for two days. The postmortem is
 * docs/postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md.
 *
 * A cap is the cheapest check that fails on that, and it is not aimed at that
 * alone: a pasted log, an inlined image and a model's runaway output all end as
 * a text file nobody could have typed. It reads the working tree rather than
 * `git ls-files`, so it goes red before the commit, not after.
 *
 * The caps are about twice today's largest (an 805 KB test log, a 1.06 MB
 * screenshot). If a real file needs more, raise the number here and say why;
 * the point is that somebody looked.
 */
import { globSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEXT_CAP_BYTES = 1024 * 1024;
const BINARY_CAP_BYTES = 4 * 1024 * 1024;

/** Everything else is held to the text cap, so a new extension fails safe. */
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".mp4", ".webm", ".zip"]);

const capFor = (file: string): number =>
  BINARY.has(path.extname(file).toLowerCase()) ? BINARY_CAP_BYTES : TEXT_CAP_BYTES;

interface Sized {
  file: string;
  bytes: number;
}

/** The files over their cap, each as a line a person can act on. */
function overTheCap(files: Sized[]): string[] {
  return files
    .filter(({ file, bytes }) => bytes > capFor(file))
    .map(({ file, bytes }) => `${file}: ${bytes} bytes, cap ${capFor(file)}`);
}

describe("no file under docs/ is implausibly large", () => {
  const onDisk: Sized[] = globSync("docs/**/*", { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return { file, bytes: statSync(file).size };
    });

  it("finds the docs at all", () => {
    // A glob that matched nothing would pass the next test forever.
    expect(onDisk.length).toBeGreaterThan(1000);
    expect(onDisk.some(({ file }) => file.endsWith(".png"))).toBe(true);
  });

  it("holds every file to its cap", () => {
    expect(overTheCap(onDisk)).toEqual([]);
  });

  it("refuses the incident as it happened", () => {
    /* The two lines from the session that did it, in JavaScript, where an empty
       pattern means the same thing. The second marker also appears earlier, in
       the sentence that says the question is below, so the slice is empty. */
    const filler = "A line of the plan, as long as a line of the plan usually is, give or take.\n";
    const plan =
      filler.repeat(50) +
      "so it is **[Q-bar-on-relevance]** below rather than built.\n" +
      filler.repeat(100) +
      "**[Q-crossref-count]** Should a row with a DOI get that count?\n" +
      "**[Q-bar-on-relevance]** Should the bar read relevance alone?\n" +
      filler.repeat(70);
    const old = plan.slice(
      plan.indexOf("**[Q-crossref-count]** Should a row with a DOI"),
      plan.indexOf("**[Q-bar-on-relevance]**"),
    );
    expect(old).toBe("");
    const written = plan.replaceAll(old, "x".repeat(1276));
    expect(plan.length).toBeLessThan(20_000);
    expect(overTheCap([{ file: "docs/plans/a-plan.md", bytes: written.length }])).toHaveLength(1);
  });

  it("holds an extension it has never seen to the stricter cap", () => {
    expect(overTheCap([{ file: "docs/plans/a.weird", bytes: TEXT_CAP_BYTES + 1 }])).toHaveLength(1);
    expect(overTheCap([{ file: "docs/plans/a.PNG", bytes: TEXT_CAP_BYTES + 1 }])).toEqual([]);
  });
});
