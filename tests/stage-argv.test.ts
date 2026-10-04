/**
 * **`scripts/stage.ts` reads its command line, or refuses it.**
 *
 * Until 2026-10-04 it read `--force` with `args.includes("--force")` and threw
 * away every other `--flag`, then took the first two of whatever was left. So
 * `npm run structure -- <slug> --froce` was an *unforced* run that printed a
 * row of `skipped` and exit 0 — the command did nothing and said it had worked
 * — and a third positional was dropped without a word (X13f,
 * docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md).
 *
 * `parseStageArgv` is that reading as a pure function. The refusals at the
 * bottom of this file were red against the old two lines, moved verbatim into
 * the function first so that it was the *behaviour* that failed and not a
 * missing export.
 *
 * ## Importing the script is itself a test
 *
 * `stage.ts` used to apply `.env.local`, load most of `src/` and act on
 * `process.argv` at module scope. Imported from here that would have read
 * vitest's own arguments and called `process.exit`. The first line below — a
 * static import — is the assertion that it no longer does; the last `describe`
 * is the other half, that started as a command it still runs.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseStageArgv } from "../scripts/stage.js";

describe("parseStageArgv — the forms that are valid, unchanged", () => {
  it.each([
    [["ingest", "https://example.com/a"], { kind: "ingest-url", url: "https://example.com/a", force: false }],
    [["ingest", "https://example.com/a", "--force"], { kind: "ingest-url", url: "https://example.com/a", force: true }],
    [["ingest", "--force", "HTTP://example.com/a"], { kind: "ingest-url", url: "HTTP://example.com/a", force: true }],
    [["ingest", "paper.pdf"], { kind: "ingest-file", file: "paper.pdf" }],
    [["ingest", "./some dir/page.html"], { kind: "ingest-file", file: "./some dir/page.html" }],
    [["structure", "my-slug"], { kind: "stage", step: "structure", slug: "my-slug", force: false }],
    [["structure", "my-slug", "--force"], { kind: "stage", step: "structure", slug: "my-slug", force: true }],
    [["--force", "blocks", "my-slug"], { kind: "stage", step: "blocks", slug: "my-slug", force: true }],
    /* Not a step, and not this function's to say so: `oneStage` asks
       `isStepName` once the pipeline is loaded, and refuses `fetch` there too. */
    [["nonsense", "my-slug"], { kind: "stage", step: "nonsense", slug: "my-slug", force: false }],
  ] as const)("%j", (args, command) => {
    expect(parseStageArgv(args)).toEqual({ ok: true, command });
  });
});

describe("parseStageArgv — the refusals it always made", () => {
  it("nothing at all is the bare usage text", () => {
    expect(parseStageArgv([])).toEqual({ ok: false, message: null, usage: true });
    expect(parseStageArgv(["--force"])).toEqual({ ok: false, message: null, usage: true });
  });

  it("`ingest` with no source", () => {
    expect(parseStageArgv(["ingest"])).toEqual({ ok: false, message: "`ingest` wants a URL or a path to a PDF.", usage: true });
  });

  it("a step with no slug", () => {
    expect(parseStageArgv(["structure"])).toEqual({
      ok: false,
      message: "`structure` wants the slug of an article you already have.",
      usage: true,
    });
  });

  it("a file ingest still refuses --force, wherever the flag sits", () => {
    for (const args of [
      ["ingest", "paper.pdf", "--force"],
      ["ingest", "--force", "paper.pdf"],
      ["--force", "ingest", "paper.pdf"],
    ]) {
      const parsed = parseStageArgv(args);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.message).toContain("`--force` means nothing when the source is a file");
      expect(parsed.usage).toBe(false);
    }
  });
});

describe("parseStageArgv — what it used to swallow", () => {
  it.each([
    [["structure", "my-slug", "--froce"], "--froce"],
    [["ingest", "https://example.com/a", "--froce"], "--froce"],
    [["ingest", "paper.pdf", "--verbose"], "--verbose"],
    [["structure", "my-slug", "--force=true"], "--force=true"],
    [["--Force", "structure", "my-slug"], "--Force"],
    [["structure", "my-slug", "--"], "--"],
  ])("%j is refused, naming the flag", (args, flag) => {
    const parsed = parseStageArgv(args);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain(`\`${flag}\``);
    expect(parsed.usage).toBe(true);
  });

  it("an unknown flag is refused even beside a real --force", () => {
    expect(parseStageArgv(["structure", "my-slug", "--force", "--froce"]).ok).toBe(false);
  });

  it.each([
    [["structure", "my-slug", "another-slug"], "another-slug"],
    [["ingest", "https://example.com/a", "https://example.com/b"], "https://example.com/b"],
    [["ingest", "one.pdf", "two.pdf"], "two.pdf"],
    [["structure", "my-slug", "force"], "force"],
  ])("%j is refused, naming the extra argument", (args, extra) => {
    const parsed = parseStageArgv(args);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain(`\`${extra}\``);
    expect(parsed.usage).toBe(true);
  });
});

/**
 * The other direction of a guard going wrong, and the silent one: `isMain`
 * answering `false` for the entry file makes the command exit 0 having printed
 * nothing (tests/is-main.test.ts). So the script is started the way
 * `package.json` starts it — `tsx scripts/stage.ts …` — with command lines it
 * refuses before any work exists to do. Nothing here reaches the queue.
 */
describe("scripts/stage.ts, started as a command", () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const run = (...args: string[]) =>
    spawnSync(path.join(repo, "node_modules", ".bin", "tsx"), ["scripts/stage.ts", ...args], {
      cwd: repo,
      encoding: "utf8",
      timeout: 240_000,
    });

  it("with no arguments prints the usage, steps and all, and exits 1", { timeout: 250_000 }, () => {
    const r = run();
    expect(r.stderr).toContain("Usage:");
    expect(r.stderr).toMatch(/any step: .*structure/);
    expect(r.status).toBe(1);
  });

  it("refuses a mistyped flag by name, with the usage, and exits 1", { timeout: 250_000 }, () => {
    /* `ingest --froce`: no source, so the old reading refused this one too
       (for the missing source), and at no point is there anything to run. */
    const r = run("ingest", "--froce");
    expect(r.stderr).toContain("`--froce`");
    expect(r.stderr).toContain("Usage:");
    expect(r.status).toBe(1);
  });
});
