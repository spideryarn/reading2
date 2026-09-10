/**
 * `gjd-remote new-claude --launch-id <id> --launch-dir <dir>` — plan 260910f
 * Stage 2, the tmux half of D6.
 *
 * `cmdNewClaude` needs a box, so it has no unit test; what can be tested is in
 * `scripts/gjd-remote-launch.ts`, the pure pieces the command splices in:
 *
 *  - the flags are validated before anything touches the network — proved by
 *    running the real CLI with a stand-in `ssh` that records being called;
 *  - the `-e` values survive every shell layer they cross (F13): through a
 *    `bash -c` the way `ssh` hands them over, through the setup lock's own
 *    admission script, and into a real tmux session's environment on a
 *    disposable socket — with a directory named with a space, a quote and a
 *    `$()` that must never run;
 *  - the job's pieces, assembled in gjd-remote's order and run for real, write
 *    `start.json` before Claude and `exit.json` after it;
 *  - without the flags every piece is empty, so the job text and the tmux
 *    command are byte-for-byte what they were.
 *
 * Where the pieces sit inside `cmdNewClaude` is asserted against the source,
 * because that is the only way to reach it without a box. It is the weakest
 * test here and it says so.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GJD_CLAUDE_STATUS_VAR,
  launchBoxCheck,
  launchExitLines,
  launchStartLines,
  launchTmuxFlags,
  parseLaunchFlags,
  type LaunchFlags,
} from "../scripts/gjd-remote-launch.js";
import { sessionAdmissionScript } from "../scripts/gjd-remote-flow.js";
import { readArtefacts, shellQuote } from "../tools/overseer/launch-artefacts.js";
import { GJD_REMOTE_MAX_PROMPT_BYTES } from "../tools/overseer/launchers.js";
import { hostileParent, makeLaunchDir, type LaunchFixture } from "./helpers/launch-fixture.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linux = process.platform === "linux";

const flagsOf = (f: LaunchFixture): LaunchFlags => {
  const parsed = parseLaunchFlags(f.correlationId, f.dir);
  if (!parsed.ok || parsed.launch === undefined) throw new Error(`fixture did not parse: ${JSON.stringify(parsed)}`);
  return parsed.launch;
};

describe("parseLaunchFlags", () => {
  it("is nothing at all when neither flag is given", () => {
    expect(parseLaunchFlags(undefined, undefined)).toEqual({ ok: true, launch: undefined });
  });

  it("wants both flags or neither", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    expect(parseLaunchFlags(f.correlationId, undefined)).toMatchObject({ ok: false, why: expect.stringMatching(/--launch-dir/) });
    expect(parseLaunchFlags(undefined, f.dir)).toMatchObject({ ok: false, why: expect.stringMatching(/--launch-id/) });
  });

  it("refuses an id that is not a correlation id", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    for (const bad of ["lo-xyz-a1", "LO-0123456789ABCDEF0123-a1", `${f.correlationId}\n`, `${f.correlationId}$(x)`, "lo-0123456789abcdef0123-a0", ""]) {
      expect(parseLaunchFlags(bad, f.dir), JSON.stringify(bad)).toMatchObject({ ok: false, why: expect.stringMatching(/--launch-id/) });
    }
  });

  it("refuses a relative directory and one with a newline or any other control byte", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    for (const bad of ["launches/o/x/a1", `${f.dir}\n`, `${f.dir}\r`, `${f.dir}\0`, `${f.dir}\t`]) {
      expect(parseLaunchFlags(f.correlationId, bad), JSON.stringify(bad)).toMatchObject({ ok: false, why: expect.stringMatching(/--launch-dir/) });
    }
  });

  it("accepts a directory named with a space, a quote and a $() — validation is not what makes it safe, quoting is", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    expect(parseLaunchFlags(f.correlationId, f.dir)).toEqual({ ok: true, launch: { correlationId: f.correlationId, dir: f.dir } });
  });
});

describe("a bad --launch-id is refused before any ssh", () => {
  /** The real CLI, with an `ssh` on PATH that leaves a mark if anything calls it. */
  function run(args: string[]) {
    const scratch = mkdtempSync(join(tmpdir(), "gjd-launch-cli-"));
    const bin = join(scratch, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "ssh"), `#!/usr/bin/env bash\necho called >> ${shellQuote(join(scratch, "ssh-called"))}\nexit 255\n`);
    chmodSync(join(bin, "ssh"), 0o755);
    const r = spawnSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/gjd-remote.ts", "new-claude", "probe", ...args, "-p", "hello"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, GJD_REMOTE_LOG_DIR: scratch, GJD_REMOTE_HOST: "192.0.2.1", GJD_REMOTE_TAB_COLOUR: "off" },
    });
    return { ...r, sshCalled: existsSync(join(scratch, "ssh-called")) };
  }

  it("refuses a malformed id, a relative directory, and one flag without the other, with ssh never run", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    for (const args of [
      ["--launch-id", "lo-not-an-id", "--launch-dir", f.dir],
      ["--launch-id", f.correlationId, "--launch-dir", "relative/dir"],
      ["--launch-id", f.correlationId],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toMatch(/--launch-(id|dir)/);
      expect(r.sshCalled, args.join(" ")).toBe(false);
    }
  }, 60_000);
});

describe("the tmux flags", () => {
  it("are empty without a launch, so the tmux command is unchanged", () => {
    expect(launchTmuxFlags(undefined, shellQuote)).toBe("");
  });

  it("carry both values through one shell parse exactly, beside the metadata flags", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const flags = launchTmuxFlags(flagsOf(f), shellQuote);
    // Same shape as accountTmuxPrefix: flags then one trailing space, so it sits between two others.
    expect(flags.endsWith(" ")).toBe(true);
    const words = execFileSync("bash", ["-c", `printf '%s\\n' ${flags}`], { encoding: "utf8", cwd: f.root }).split("\n").filter(Boolean);
    expect(words).toEqual(["-e", `SPIDERYARN_LAUNCH_ID=${f.correlationId}`, "-e", `SPIDERYARN_LAUNCH_DIR=${f.dir}`]);
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
  });
});

describe("the check on the box", () => {
  it("is empty without a launch, so the ssh step is unchanged", () => {
    expect(launchBoxCheck(undefined, shellQuote)).toBe("");
  });

  it("passes only when the directory exists and its intent.json names this id", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const ok = spawnSync("bash", ["-c", `true${launchBoxCheck(flagsOf(f), shellQuote)}`], { encoding: "utf8", cwd: f.root });
    expect(ok.status).toBe(0);

    const other = makeLaunchDir({ launcherKind: "tmux" });
    const wrongId = spawnSync("bash", ["-c", `true${launchBoxCheck({ correlationId: other.correlationId, dir: f.dir }, shellQuote)}`], { encoding: "utf8" });
    expect(wrongId.status).not.toBe(0);
    expect(wrongId.stderr).toMatch(/intent\.json/);

    const missing = spawnSync("bash", ["-c", `true${launchBoxCheck({ correlationId: f.correlationId, dir: join(f.root, "gone") }, shellQuote)}`], { encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
  });

  it("does not run when an earlier step of the same ssh command failed", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const r = spawnSync("bash", ["-c", `false${launchBoxCheck(flagsOf(f), shellQuote)}; echo status=$?`], { encoding: "utf8" });
    expect(r.stdout).toContain("status=1");
  });
});

describe("the job's pieces", () => {
  it("are empty without a launch, so the job text is unchanged", () => {
    expect(launchStartLines(undefined, "exit 1", shellQuote)).toEqual([]);
    expect(launchExitLines(undefined, shellQuote)).toEqual([]);
  });

  it("are two lines each with a launch — the record and the exit trap's arming or disarming — and the exit line reads gjd-remote's own status variable", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const start = launchStartLines(flagsOf(f), "exit 1", shellQuote);
    const exit = launchExitLines(flagsOf(f), shellQuote);
    expect(start).toHaveLength(2);
    expect(exit).toHaveLength(2);
    for (const line of [...start, ...exit]) expect(line).not.toContain("\n");
    // Armed only after start.json, disarmed only after the real exit.json (F23).
    expect(start[1]).toMatch(/^trap '.*' EXIT$/);
    expect(exit[1]).toBe("trap - EXIT");
    expect(GJD_CLAUDE_STATUS_VAR).toBe("_gjd_claude_status");
    expect(exit[0]).toContain(`"$${GJD_CLAUDE_STATUS_VAR}"`);
  });

  it.runIf(linux)("assembled in gjd-remote's order and run for real: start.json before Claude, exit.json after it", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const launch = flagsOf(f);
    const note = join(f.root, "fail-note");
    const failTo = (msg: string) => `{ m=${shellQuote(msg)}; printf '%s\\n' "$m" >&2; printf '%s\\n' "$m" > ${shellQuote(note)}; exit 1; }`;
    // A stand-in Claude that records whether start.json was already there when it ran.
    const claude = join(f.root, "claude");
    writeFileSync(claude, `#!/usr/bin/env bash\nif [ -f ${shellQuote(join(f.dir, "start.json"))} ]; then echo yes > ${shellQuote(join(f.root, "saw-start"))}; fi\nexit 5\n`);
    chmodSync(claude, 0o755);
    const job = [
      "#!/usr/bin/env bash",
      "export LANG=C.UTF-8",
      ...launchStartLines(launch, failTo("FATAL: could not write start.json"), shellQuote),
      `cd ${shellQuote(f.root)} || ${failTo("FATAL: cannot enter")}`,
      `${shellQuote(claude)} --session-id x`,
      "_gjd_claude_status=$?",
      ...launchExitLines(launch, shellQuote),
      "unset _gjd_claude_status",
      "echo END",
      // Ends with a status of its own, so an exit trap still armed here would overwrite code 5 with 7 (F23).
      "exit 7",
      "",
    ].join("\n");
    const jobPath = join(f.root, "job.sh");
    writeFileSync(jobPath, job);
    const r = spawnSync("bash", [jobPath], { encoding: "utf8" });
    expect(r.stdout).toContain("END");
    expect(r.status).toBe(7);
    expect(existsSync(join(f.root, "saw-start"))).toBe(true);
    expect(existsSync(note)).toBe(false);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 5 }, answer: null } });
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
  });

  it.runIf(linux)("a guard that ends the job after start.json still leaves exit.json: a vanished directory, and a PATH with no claude (F23)", () => {
    /* start.json is the job's first command, but until F23 the only exit writer came after Claude —
       so the directory guard, the missing-CLI check, the account checks and the bookkeeping could
       all `failTo` out between the two, and reconciliation held a run the shell knew had ended. */
    const bash = ["/usr/bin/bash", "/bin/bash"].find(existsSync);
    if (bash === undefined) throw new Error("no bash at /usr/bin/bash or /bin/bash");
    for (const which of ["directory", "no-claude"] as const) {
      const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
      const launch = flagsOf(f);
      // What the artefact lines need, and nothing else: no claude anywhere on this PATH.
      const tools = join(f.root, "tools");
      mkdirSync(tools);
      for (const tool of ["cat", "date", "sync", "mv"]) {
        const found = ["/usr/bin", "/bin"].map((dir) => join(dir, tool)).find(existsSync);
        if (found === undefined) throw new Error(`no ${tool} in /usr/bin or /bin`);
        symlinkSync(found, join(tools, tool));
      }
      const failTo = (msg: string) => `{ m=${shellQuote(msg)}; printf '%s\\n' "$m" >&2; exit 1; }`;
      const claude = join(f.root, "claude");
      writeFileSync(claude, `#!/usr/bin/env bash\necho ran > ${shellQuote(join(f.root, "claude-ran"))}\n`);
      chmodSync(claude, 0o755);
      const guard = which === "directory"
        ? `cd ${shellQuote(join(f.root, "gone"))} || ${failTo("FATAL: cannot enter the directory")}`
        : `command -v claude >/dev/null 2>&1 || ${failTo("FATAL: claude is not on this job's PATH")}`;
      const job = [
        "#!/usr/bin/env bash",
        "export LANG=C.UTF-8",
        ...launchStartLines(launch, failTo("FATAL: could not write start.json"), shellQuote),
        guard,
        `${shellQuote(claude)} --session-id x`,
        "_gjd_claude_status=$?",
        ...launchExitLines(launch, shellQuote),
        "echo END",
        "",
      ].join("\n");
      const jobPath = join(f.root, "job.sh");
      writeFileSync(jobPath, job);
      const r = spawnSync(bash, [jobPath], { encoding: "utf8", env: { PATH: tools } });
      expect(r.status, which).toBe(1);
      expect(r.stdout, which).not.toContain("END");
      expect(existsSync(join(f.root, "claude-ran")), which).toBe(false);
      const read = readArtefacts(f.dir, f.correlationId);
      expect(read.start.kind, which).toBe("present");
      // The shell's own status, as the job shell records every ending: it makes no judgement.
      expect(read.exit, which).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 1 }, verdict: null, answer: null } });
      expect(existsSync(join(f.root, "pwned")), which).toBe(false);
    }
  });
});

describe("where cmdNewClaude splices the pieces (against the source; it needs a box to run)", () => {
  const source = readFileSync(join(REPO, "scripts", "gjd-remote.ts"), "utf8");
  const from = source.indexOf("async function cmdNewClaude(");
  const body = source.slice(from, source.indexOf("\n}\n", from));
  /** The text between two markers, with comment lines taken out: anything left is another job element. */
  const between = (a: string, b: string): string => {
    const i = body.indexOf(a);
    const j = body.indexOf(b);
    expect(i, a).toBeGreaterThan(-1);
    expect(j, b).toBeGreaterThan(i);
    return body
      .slice(i + a.length, j)
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("")
      .trim();
  };

  it("writes start.json first: straight after the environment lines, before the directory guard", () => {
    expect(between("`export LANG=C.UTF-8`,", "...launchStartLines(opts.launch,")).toBe("");
    expect(body.indexOf("...launchStartLines(opts.launch,")).toBeLessThan(body.indexOf('cdGuard(name, dir, "Claude")'));
  });

  it("writes exit.json straight after the status is saved, before exec bash -l", () => {
    expect(between("`_gjd_claude_status=$?`,", "...launchExitLines(opts.launch, shq),")).toBe("");
    expect(body.indexOf("...launchExitLines(opts.launch, shq),")).toBeLessThan(body.indexOf("`exec bash -l`,"));
  });

  it("puts both -e values beside metaFlags on the one tmux new-session, and the box check on the existing ssh step", () => {
    expect(body).toContain("${accountTmuxPrefix(account)}${launchTmuxFlags(opts.launch, shq)}${metaFlags(target, dir, \"claude\")}");
    expect(body).toContain("rm -f ${shq(failNote(name))}${launchBoxCheck(opts.launch, shq)}`);");
    expect(body.match(/tmux new-session/g)).toHaveLength(1);
  });

  it("parses the flags in main, before cmdNewClaude is called", () => {
    const main = source.slice(source.indexOf('case "new-claude": {'));
    expect(main.indexOf("parseLaunchFlags(")).toBeGreaterThan(-1);
    expect(main.indexOf("parseLaunchFlags(")).toBeLessThan(main.indexOf("return cmdNewClaude(positionals[0]"));
  });

  it("the adapter's prompt ceiling is gjd-remote's own", () => {
    expect(source).toContain(`const MAX_PROMPT_BYTES = 96 * 1024;`);
    expect(GJD_REMOTE_MAX_PROMPT_BYTES).toBe(96 * 1024);
  });
});

/* ------------------------------------------------------------------ *
 * Through every layer, into a real tmux, on a disposable socket.
 * ------------------------------------------------------------------ */

function usable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    execFileSync("flock", ["--version"], { stdio: "ignore" });
    execFileSync("base64", ["--version"], { stdio: "ignore" });
    return linux;
  } catch {
    return false;
  }
}

describe.runIf(usable())("F13: the values reach the session exactly, through the admission script, on a disposable socket", () => {
  let base = "";
  let sock = "";
  const tmux = (...args: string[]): string => execFileSync("tmux", ["-S", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "gjd-launch-tmux-"));
    sock = join(base, "s");
  });

  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      /* already gone */
    }
    rmSync(base, { recursive: true, force: true });
  });

  it("a hostile directory arrives in the session environment byte for byte, and nothing in its name runs", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const flags = launchTmuxFlags(flagsOf(f), shellQuote);
    // gjd-remote's command, with `tmux` pointed at this socket: the same concatenation cmdNewClaude does.
    const command = `tmux -S ${shellQuote(sock)} -f /dev/null new-session -d -s probe ${flags}${shellQuote("sleep 60")}`;
    const script = sessionAdmissionScript({
      lockPath: join(base, "setup.lock"),
      locksDir: base,
      statusPath: join(base, "no-status-file"),
      expect: null,
      command,
    });
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd: f.root });
    expect(r.stdout).toContain("admit ran");
    expect(r.stdout).toContain("code 0");
    expect(tmux("show-environment", "-t", "probe", "SPIDERYARN_LAUNCH_ID").trim()).toBe(`SPIDERYARN_LAUNCH_ID=${f.correlationId}`);
    expect(tmux("show-environment", "-t", "probe", "SPIDERYARN_LAUNCH_DIR").trim()).toBe(`SPIDERYARN_LAUNCH_DIR=${f.dir}`);
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
  });
});
