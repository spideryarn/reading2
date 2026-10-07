/**
 * **The browser-MCP smoke check, checked against a server that shares its
 * browser.**
 *
 * `scripts/remote-smoke-mcp-browser.mjs` starts two of each MCP server at once
 * because one at a time is the case that works even when they are sharing a
 * browser. Until 2026-10-04 it did not quite do that: each client was killed
 * the moment its **own** navigation answered, and each looked only at its own
 * answer. So if the first had opened its page, answered and been killed before
 * the second got as far as opening one, there was no overlap to detect, and two
 * servers driving one browser passed (X13i,
 * docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md;
 * F10 and Opus's review of it beside that file).
 *
 * The fake in tests/fixtures/fake-mcp-server/ is that misconfiguration made
 * small: with `--shared` its one page lives in a file, so two of them are two
 * servers and one browser. The cases below ask for it late on either side.
 *
 * ## The control, kept
 *
 * `the old sequence` below is the check as it used to run — open, read the
 * navigation's own answer, hang up — built out of today's handles. It is
 * asserted to **pass** the shared fake when one side is late. That is what
 * makes the refusals beside it mean something: without it, a fake that had
 * quietly stopped sharing would turn every "refuses" into a test of nothing.
 * This file was first run against the old script, where `checkPair` *was* that
 * sequence and the late cases came back `ok: true`.
 *
 * The script is a standalone `.mjs` — `gjd-remote doctor` copies that one file
 * to a box with no checkout — so it has no types, and it is imported by path.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Verdict = { ok: boolean; detail: string };
type Handle = Verdict & { read: () => Promise<Verdict>; close: () => Promise<void> };
type Spec = { command: string; args: string[]; tool: string; arg: string; read: string };
type SmokeModule = {
  openPage: (spec: Spec, mine: string, forbidden?: string[], timeoutMs?: number) => Promise<Handle>;
  checkPair: (spec: Spec, markers: [string, string], timeoutMs?: number) => Promise<Verdict>;
  checkServer: (spec: Spec, timeoutMs?: number) => Promise<Verdict>;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "remote-smoke-mcp-browser.mjs");
const FAKE = path.join(HERE, "fixtures", "fake-mcp-server", "server.mjs");

let smoke: SmokeModule;
beforeAll(async () => {
  /* Importing it is itself the first assertion: the script used to call
     `main()` at module scope, which here would have run `claude mcp get`. */
  smoke = (await import(pathToFileURL(SCRIPT).href)) as SmokeModule;
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    /* Anything a failed case left running, so one red test is not also a
       leaked process. */
    for (const pid of startedPids(dir)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function startedPids(dir: string): number[] {
  return readdirSync(path.join(dir, "pids")).map(Number);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A fake server's command line, and the directory its state and pids go in. */
function fake(flags: string[] = [], opts: { shared?: boolean } = {}): { spec: Spec; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "spya-fake-mcp-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "pids"));
  const args = [FAKE, "--as", "playwright", "--pids", path.join(dir, "pids"), ...(opts.shared ? ["--shared", path.join(dir, "page")] : []), ...flags];
  return { spec: { command: process.execPath, args, tool: "browser_navigate", arg: "url", read: "browser_snapshot" }, dir };
}

/** Every server the case started is gone — and it started the number it should have. */
function expectAllClosed(dir: string, started: number): void {
  const pids = startedPids(dir);
  expect(pids).toHaveLength(started);
  expect(pids.filter(alive)).toEqual([]);
}

const A = "MCPSMOKE-aaaaaaaa";
const B = "MCPSMOKE-bbbbbbbb";
const LATE = ["--slow", "", "400"] as const;
const late = (marker: string) => [LATE[0], marker, LATE[2]];

/**
 * The check as it ran before: each client judged on its navigation's own
 * answer and hung up on at once. `Promise.all`, as it was.
 */
async function oldSequence(spec: Spec): Promise<Verdict[]> {
  const one = async (mine: string, other: string) => {
    const h = await smoke.openPage(spec, mine, [other], 10_000);
    await h.close();
    return { ok: h.ok, detail: h.detail };
  };
  return Promise.all([one(A, B), one(B, A)]);
}

describe("checkPair — two servers at once", () => {
  it("passes two servers that each have their own browser", async () => {
    const { spec, dir } = fake();
    expect(await smoke.checkPair(spec, [A, B], 10_000)).toEqual({ ok: true, detail: "" });
    expectAllClosed(dir, 2);
  });

  it("passes them when one is late, too — late is not the fault", async () => {
    const { spec, dir } = fake(late(B));
    expect(await smoke.checkPair(spec, [A, B], 10_000)).toEqual({ ok: true, detail: "" });
    expectAllClosed(dir, 2);
  });

  it.each([
    ["the second is late", late(B)],
    ["the first is late", late(A)],
    ["neither is late", []],
  ])("refuses two servers sharing one browser when %s", async (_name, flags) => {
    const { spec, dir } = fake(flags, { shared: true });
    const verdict = await smoke.checkPair(spec, [A, B], 10_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/sharing a browser/);
    expectAllClosed(dir, 2);
  });

  it.each([
    ["the second is late", late(B)],
    ["the first is late", late(A)],
  ])("the old sequence passed that same shared pair when %s (the control)", async (_name, flags) => {
    const { spec, dir } = fake(flags, { shared: true });
    expect(await oldSequence(spec)).toEqual([
      { ok: true, detail: "" },
      { ok: true, detail: "" },
    ]);
    expectAllClosed(dir, 2);
  });

  it("a re-read that fails is a failure, and both servers are still closed", async () => {
    const { spec, dir } = fake(["--read-fails"]);
    const verdict = await smoke.checkPair(spec, [A, B], 10_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("the browser went away");
    expectAllClosed(dir, 2);
  });

  it("a re-read that never answers is given up on, and both servers are still closed", async () => {
    const { spec, dir } = fake(["--read-hangs"]);
    const startedAt = Date.now();
    const verdict = await smoke.checkPair(spec, [A, B], 2_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("timed out after 2000ms");
    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expectAllClosed(dir, 2);
  });

  it("a navigation that fails closes the one that worked as well", async () => {
    const { spec, dir } = fake(["--blank"]);
    const verdict = await smoke.checkPair(spec, [A, B], 10_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/was not in the response/);
    expectAllClosed(dir, 2);
  });

  it("a command that cannot start is a failure, not a hang", async () => {
    const verdict = await smoke.checkPair({ command: "/nonexistent/spya-no-such-server", args: [], tool: "t", arg: "url", read: "r" }, [A, B], 5_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("could not start");
  });
});

describe("openPage — a live handle", () => {
  it("stays alive after its page has opened, reads without navigating, and closes twice without complaint", async () => {
    const { spec, dir } = fake();
    const h = await smoke.openPage(spec, A, [B], 10_000);
    expect({ ok: h.ok, detail: h.detail }).toEqual({ ok: true, detail: "" });
    const [pid] = startedPids(dir);
    expect(pid !== undefined && alive(pid)).toBe(true);

    expect(await h.read()).toEqual({ ok: true, detail: "" });
    expect(await h.read()).toEqual({ ok: true, detail: "" });

    await h.close();
    expect(pid !== undefined && alive(pid)).toBe(false);
    await h.close();
    /* And a read after closing is an answer, not a hang or a throw. */
    expect((await h.read()).ok).toBe(false);
  });

  it("the read is of the page as it is NOW: it reports a page somebody else has since opened", async () => {
    const { spec } = fake([], { shared: true });
    const a = await smoke.openPage(spec, A, [B], 10_000);
    expect((await a.read()).ok).toBe(true);
    const b = await smoke.openPage(spec, B, [A], 10_000);
    const reread = await a.read();
    expect(reread.ok).toBe(false);
    expect(reread.detail).toMatch(/sharing a browser/);
    await Promise.all([a.close(), b.close()]);
  });

  it("closes a server that ignores being asked nicely", async () => {
    const { spec, dir } = fake(["--ignore-term"]);
    const h = await smoke.openPage(spec, A, [], 10_000);
    expect(h.ok).toBe(true);
    await h.close();
    expectAllClosed(dir, 1);
  }, 20_000);
});

describe("checkServer — one alone, then two at once", () => {
  it("closes the single run before the pair starts", async () => {
    const { spec, dir } = fake();
    expect(await smoke.checkServer(spec, 10_000)).toEqual({ ok: true, detail: "" });
    expectAllClosed(dir, 3);

    /* Each fake wrote down who was already alive when it started. The first to
       start is the single run; neither of the pair may have found it there. */
    const starts = startedPids(dir)
      .map((pid) => ({ pid, ...(JSON.parse(readFileSync(path.join(dir, "pids", String(pid)), "utf8")) as { startedAt: number; aliveAtStart: number[] }) }))
      .sort((x, y) => x.startedAt - y.startedAt);
    const [single, ...pair] = starts;
    expect(single?.aliveAtStart).toEqual([]);
    expect(pair).toHaveLength(2);
    for (const p of pair) expect(p.aliveAtStart).not.toContain(single?.pid);
  });

  it("says which half failed", async () => {
    const shared = fake([], { shared: true });
    const pair = await smoke.checkServer(shared.spec, 10_000);
    expect(pair.ok).toBe(false);
    expect(pair.detail).toMatch(/^works alone but not twice at once — .*sharing a browser/);
    expectAllClosed(shared.dir, 3);

    const blank = fake(["--blank"]);
    const single = await smoke.checkServer(blank.spec, 10_000);
    expect(single.ok).toBe(false);
    expect(single.detail).not.toMatch(/works alone/);
    expectAllClosed(blank.dir, 1);
  });
});

/**
 * The script started the way doctor starts it — `node <file>` — with a pretend
 * `claude` on PATH that "registers" the fake under both server names. This is
 * the half a guard can get silently wrong: answer "not the entry file" and the
 * script prints nothing and exits 0.
 */
describe("the script, started as a command", () => {
  function runWith(extraFlags: string): SpawnSyncReturns<string> {
    const dir = mkdtempSync(path.join(tmpdir(), "spya-fake-claude-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "pids"));
    mkdirSync(path.join(dir, "bin"));
    /* The shape `claude mcp get <name>` prints, which the script scrapes. The
       fake is told which server it is standing in for, so it answers only to
       that server's two tool names. */
    writeFileSync(
      path.join(dir, "bin", "claude"),
      `#!/usr/bin/env bash
[ "$1 $2" = "mcp get" ] || exit 1
echo "$3:"
echo "  Scope: User config"
echo "  Type: stdio"
echo "  Command: ${process.execPath}"
echo "  Args: ${FAKE} --as $3 --pids ${path.join(dir, "pids")} ${extraFlags.replaceAll("@DIR@", dir)}"
`,
    );
    chmodSync(path.join(dir, "bin", "claude"), 0o755);
    return spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`, GJD_SMOKE_MCP_TIMEOUT_MS: "15000" },
    });
  }

  it("prints its `ok` line last and exits 0 when both servers are isolated", { timeout: 70_000 }, () => {
    const r = runWith("");
    expect(r.stderr).toBe("");
    expect(r.stdout.trim().split("\n").at(-1)).toBe("ok  playwright and chrome-devtools each opened a page and survived two at once");
    expect(r.status).toBe(0);
  });

  it("prints FAIL for each and exits 1 when they share a browser", { timeout: 70_000 }, () => {
    const r = runWith("--shared @DIR@/page-$3");
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/^ok\s/m);
    expect(r.stderr).toMatch(/^FAIL playwright: works alone but not twice at once — .*sharing a browser/m);
    expect(r.stderr).toMatch(/^FAIL chrome-devtools: works alone but not twice at once — .*sharing a browser/m);
  });
});
