/**
 * **No file under `docs/` is implausibly large.**
 *
 * On 2026-10-03 a plan went from 17 KB to 22 MB in one commit: a scripted edit
 * called `s.replace(old, new)` with an `old` that had come out empty, which puts
 * `new` at every position in the file. No check reported the inflation, and
 * the file sat on `dev` for two days. The postmortem is
 * docs/postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md.
 *
 * A cap is the cheapest check that fails on that, and it is not aimed at that
 * alone: a pasted log, an inlined image and a model's runaway output all end as
 * a text file nobody could have typed. It reads the working tree rather than
 * `git ls-files`, so it goes red before the commit, not after.
 *
 * The caps leave room above today's largest (an 805 KB test log, a 1.06 MB
 * screenshot). If a real file needs more, raise the number here and say why;
 * the point is that somebody looked.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Drops the files `.gitignore` covers: scratch that cannot be committed is not
 * this test's business. `git check-ignore` prints the ignored ones and exits 1
 * when there are none; anything else is the check itself failing, which throws
 * rather than letting everything through.
 */
function notIgnoredByGit(files: Sized[]): Sized[] {
  if (files.length === 0) return files;
  const asked = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    input: files.map(({ file }) => file).join("\0"),
    encoding: "utf8",
  });
  if (asked.status !== 0 && asked.status !== 1) {
    throw new Error(`git check-ignore failed (${asked.status}): ${asked.stderr}`);
  }
  const ignored = new Set(asked.stdout.split("\0").filter(Boolean));
  return files.filter(({ file }) => !ignored.has(file));
}

function sizedFiles(root: string): Sized[] {
  const files: Sized[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    // There are no symlinks in docs today. Fail closed instead of silently
    // skipping linked files or trees, including broken links and cycles.
    if (entry.isSymbolicLink()) throw new Error(`${file}: docs size scan refuses a symlink`);
    if (entry.isDirectory()) files.push(...sizedFiles(file));
    else if (entry.isFile()) files.push({ file, bytes: statSync(file).size });
    else throw new Error(`${file}: docs size scan needs a regular file or directory`);
  }
  return files;
}

describe("no file under docs/ is implausibly large", () => {
  const onDisk = sizedFiles("docs");

  it.each(["a-plan.md", ".a-plan.md", ".hidden/a-plan.md"])(
    "discovers an oversized file at %s",
    (relative) => {
      const root = mkdtempSync(path.join(tmpdir(), "docs-size-cap-"));
      try {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "");
        truncateSync(file, 22_384_830);
        expect(overTheCap(sizedFiles(root))).toEqual([
          `${file}: 22384830 bytes, cap ${TEXT_CAP_BYTES}`,
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["file", "directory", "broken"])("refuses a %s symlink instead of skipping it", (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), "docs-size-cap-"));
    try {
      const docs = path.join(root, "docs");
      const target = path.join(root, "target");
      mkdirSync(docs);
      if (kind === "directory") {
        mkdirSync(target);
        writeFileSync(path.join(target, "a-plan.md"), "");
        truncateSync(path.join(target, "a-plan.md"), 22_384_830);
      } else if (kind === "file") {
        writeFileSync(target, "");
        truncateSync(target, 22_384_830);
      }
      symlinkSync(target, path.join(docs, "linked"));
      expect(() => sizedFiles(docs)).toThrow(/symlink/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds the docs at all", () => {
    // A scan that found nothing would pass the next test forever.
    expect(onDisk.length).toBeGreaterThan(1000);
    expect(onDisk.some(({ file }) => file.endsWith(".png"))).toBe(true);
  });

  it("holds every file to its cap", () => {
    expect(overTheCap(notIgnoredByGit(onDisk))).toEqual([]);
  });

  it("lets through only what git ignores", () => {
    /* A GPT review writes a `.activity.log` beside its answer, in docs/plans/,
       and one of 2 MB turned the suite red while its own review was running.
       `.gitignore` names those, so they cannot be committed. */
    const kept = notIgnoredByGit([
      { file: "docs/plans/a-review-sol.md.activity.log", bytes: 1 },
      { file: "docs/plans/a-plan.md", bytes: 1 },
      { file: "docs/plans/a-file-that-is-not-there.md", bytes: 1 },
    ]);
    expect(kept.map(({ file }) => file)).toEqual([
      "docs/plans/a-plan.md",
      "docs/plans/a-file-that-is-not-there.md",
    ]);
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
