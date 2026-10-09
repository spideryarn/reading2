/**
 * A test run's temp files go to one directory that is removed when the run ends — plan 261009a,
 * queue item qi-4b5598e2. The first tests are checked from inside a worker, so they go red if
 * vitest.config.ts stops calling makeRunTempRoot().
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUN_TEMP_PREFIX, RUN_TEMP_ROOT_ENV } from "./setup/run-temp-root.js";

describe("the temp dir a test inherits", () => {
  it("is the root vitest's own process made for this run, not the system temp dir", () => {
    expect(path.basename(tmpdir())).toMatch(new RegExp(`^${RUN_TEMP_PREFIX}\\d+-[A-Za-z0-9]{6}$`));
    expect(process.env[RUN_TEMP_ROOT_ENV]).toBe(tmpdir());
    // Owner identity, not just the shape of a name: a forked worker's parent is the vitest process.
    expect(path.basename(tmpdir()).startsWith(`${RUN_TEMP_PREFIX}${process.ppid}-`)).toBe(true);
  });

  it("reaches a child spawned with the inherited environment", () => {
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(require('os').tmpdir())"], {
      encoding: "utf8",
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe(tmpdir());
  });
});

describe("makeRunTempRoot", () => {
  let parent: string;
  afterEach(() => rmSync(parent, { recursive: true, force: true }));

  /** Run `body` in a fresh node with no run root inherited, so it behaves as vitest's main process. */
  function inFreshProcess(body: string): { stdout: string; stderr: string; pid: number; status: number | null } {
    const script = [
      `const { makeRunTempRoot } = await import(${JSON.stringify(path.resolve("tests/setup/run-temp-root.ts"))});`,
      `const fs = await import("node:fs"); const os = await import("node:os");`,
      body,
    ].join("\n");
    const env = { ...process.env };
    delete env[RUN_TEMP_ROOT_ENV];
    env.TMPDIR = parent;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      encoding: "utf8", env,
    });
    expect(child.error).toBeUndefined();
    return { stdout: child.stdout, stderr: child.stderr, pid: child.pid ?? -1, status: child.status };
  }

  it("removes the root, and everything a test left in it, when the process exits", () => {
    parent = mkdtempSync(path.join(tmpdir(), "rtr-"));
    const r = inFreshProcess([
      `const root = makeRunTempRoot();`,
      `fs.mkdirSync(os.tmpdir() + "/leak/deeper", { recursive: true });`,
      `fs.writeFileSync(os.tmpdir() + "/leak/deeper/file", "x");`,
      `if (!fs.existsSync(root + "/leak/deeper/file")) throw new Error("tmpdir() is not the root");`,
      `process.stdout.write(root);`,
    ].join("\n"));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(path.dirname(r.stdout)).toBe(parent);
    expect(path.basename(r.stdout).startsWith(`${RUN_TEMP_PREFIX}${r.pid}-`)).toBe(true);
    expect(readdirSync(parent).filter((name) => name.startsWith(RUN_TEMP_PREFIX))).toEqual([]);
  }, 30_000);

  it("removes it when the process exits on a failure, too", () => {
    parent = mkdtempSync(path.join(tmpdir(), "rtr-"));
    const r = inFreshProcess(`makeRunTempRoot(); fs.writeFileSync(os.tmpdir() + "/f", "x"); process.exitCode = 1; throw new Error("boom");`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("boom");
    expect(readdirSync(parent).filter((name) => name.startsWith(RUN_TEMP_PREFIX))).toEqual([]);
  }, 30_000);

  it("evaluated twice in one run — a config reload — reuses the root instead of nesting a second", () => {
    parent = mkdtempSync(path.join(tmpdir(), "rtr-"));
    const r = inFreshProcess([
      `const before = process.listenerCount("exit");`,
      `const a = makeRunTempRoot(); const b = makeRunTempRoot();`,
      `process.stdout.write(JSON.stringify([a, b, os.tmpdir(), process.listenerCount("exit") - before]));`,
    ].join("\n"));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    const [a, b, current, listeners] = JSON.parse(r.stdout) as [string, string, string, number];
    expect(b).toBe(a);
    expect(current).toBe(a);
    expect(listeners).toBe(1);
  }, 30_000);

  it("a child reuses its owner's root without registering cleanup or deleting it on exit", () => {
    parent = mkdtempSync(path.join(tmpdir(), "rtr-"));
    const nestedScript = [
      `const { makeRunTempRoot } = await import(${JSON.stringify(path.resolve("tests/setup/run-temp-root.ts"))});`,
      `const before = process.listenerCount("exit");`,
      `const root = makeRunTempRoot(); const again = makeRunTempRoot();`,
      `process.stdout.write(JSON.stringify([root, again, process.listenerCount("exit") - before]));`,
    ].join("\n");
    const r = inFreshProcess([
      `const root = makeRunTempRoot();`,
      `fs.writeFileSync(root + "/still-owned", "x");`,
      `const { spawnSync } = await import("node:child_process");`,
      `const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", ${JSON.stringify(nestedScript)}], { encoding: "utf8" });`,
      `if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stderr);`,
      `const [inherited, again, listeners] = JSON.parse(child.stdout);`,
      `if (inherited !== root || again !== root || listeners !== 0) throw new Error("child did not reuse root without cleanup");`,
      `if (!fs.existsSync(root + "/still-owned")) throw new Error("child deleted owner's files");`,
      `process.stdout.write(root);`,
    ].join("\n"));
    expect(r.status, r.stderr).toBe(0);
    expect(path.dirname(r.stdout)).toBe(parent);
    expect(readdirSync(parent).filter((name) => name.startsWith(RUN_TEMP_PREFIX))).toEqual([]);
  }, 30_000);
});
