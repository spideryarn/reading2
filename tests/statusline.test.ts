/**
 * The status line the remote box shows under the prompt.
 *
 * The script is a heredoc inside `infra/hetzner/provision.sh` — one copy, so
 * that re-running provisioning on a live box cannot install a stale one. That
 * makes it invisible to every other check in this repo: `check-cloud-init.ts`
 * runs `bash -n` on provision.sh, and a quoted heredoc is just a string to bash,
 * so a status line that never runs would parse perfectly.
 *
 * So these tests carve the heredoc back out and EXECUTE it, on the JSON Claude
 * Code actually sends. That matters more here than in most places, because the
 * failure mode is silence: a status line that errors prints nothing, and nothing
 * is exactly what a working status line prints when it has nothing to say. Every
 * assertion below therefore names a string that must be PRESENT.
 *
 * docs/project/remote-box.md § The status line.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVISION = path.join(REPO, "infra/hetzner/provision.sh");

/**
 * The heredoc, byte for byte. A regex that matched nothing would make every
 * test below pass against an empty script, so extraction failing is a test
 * failure of its own — see the `describe("extraction")` block.
 */
function extractHeredoc(delim: string): string {
  const src = readFileSync(PROVISION, "utf8");
  const m = new RegExp(`^cat > "\\$CLAUDE_[A-Z]+_SH" <<'${delim}'\\n([\\s\\S]*?)\\n${delim}$`, "m").exec(src);
  return m?.[1] ?? "";
}

const SCRIPT = extractHeredoc("STATUSLINE");
/** The other half: installs the script and merges settings.json. */
const SETTINGS = extractHeredoc("SETTINGS");

/**
 * provision.sh with comment lines removed. `toContain` against the raw file
 * would be satisfied by a line someone commented out, which is the shape a
 * disabled step usually takes.
 */
const provisionCode = readFileSync(PROVISION, "utf8")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

/** What Claude Code sends, minus whatever the caller wants to change. */
function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: { display_name: "Opus 5" },
    workspace: { current_dir: "/tmp/outer/inner" },
    ...over,
  });
}

/** Run the extracted script the way Claude Code does: JSON on stdin. */
function render(input: string): { out: string; status: number } {
  const r = spawnSync("bash", ["-c", SCRIPT], { input, encoding: "utf8" });
  return { out: r.stdout ?? "", status: r.status ?? -1 };
}

/** ESC, built rather than written: a literal one in a regex is a lint error. */
const ESC = String.fromCharCode(27);
/** The visible text, with the ANSI colour sequences taken out. */
const plain = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

describe("extraction", () => {
  it("finds the heredoc in provision.sh", () => {
    // A count, because the interesting failure is silent: a renamed delimiter
    // or a reformatted `cat >` line yields "" and every other test still
    // passes, having run nothing.
    expect(SCRIPT.length).toBeGreaterThan(1000);
    expect(SCRIPT.startsWith("#!/bin/bash")).toBe(true);
  });

  it("is valid bash", () => {
    expect(spawnSync("bash", ["-n"], { input: SCRIPT }).status).toBe(0);
  });

  it("is the file provision.sh installs and settings.json names", () => {
    // The heredoc, the install, the settings key and the verification check
    // must all mean the same path. They are four separate strings, and three
    // of them agreeing is a status line pointing at a file nobody wrote.
    expect(provisionCode).toContain('sl="$HOME/.claude/statusline-script.sh"');
    expect(provisionCode).toContain('install -m 0755 "$1" "$sl"');
    expect(provisionCode).toContain(".statusLine = ((.statusLine // {}) + { type: \"command\", command: $sl })");
    expect(provisionCode).toContain('check "claude statusline shows context %"');
  });

  it("has jq to test against", () => {
    // The script degrades to "Claude" and no context segment without jq, so on
    // a machine that lacks it every case below would fail confusingly. One
    // clear failure instead.
    expect(spawnSync("jq", ["--version"]).status).toBe(0);
  });
});

describe("context window segment", () => {
  it("shows the percentage, truncated to a whole number", () => {
    const { out, status } = render(payload({ context_window: { used_percentage: 42.7 } }));
    expect(status).toBe(0);
    expect(plain(out)).toContain("42%");
  });

  it("draws one bar cell per ten percent", () => {
    const { out } = render(payload({ context_window: { used_percentage: 42.7 } }));
    expect(plain(out)).toContain("████░░░░░░ 42%");
  });

  it("is green below 70, yellow from 70, red from 90", () => {
    // The whole point of the segment: auto-compaction lands around 80%, so the
    // colour has to change BEFORE it does, not when it already has.
    const colour = (pct: number) => {
      const { out } = render(payload({ context_window: { used_percentage: pct } }));
      return new RegExp(`(${ESC}\\[1;3[123]m)[█░]`).exec(out)?.[1] ?? "none";
    };
    expect(colour(69)).toBe(`${ESC}[1;32m`); // green
    expect(colour(70)).toBe(`${ESC}[1;33m`); // yellow
    expect(colour(89)).toBe(`${ESC}[1;33m`);
    expect(colour(90)).toBe(`${ESC}[1;31m`); // red
  });

  it("clamps a percentage above 100 rather than overrunning the bar", () => {
    const { out } = render(payload({ context_window: { used_percentage: 140 } }));
    expect(plain(out)).toContain("██████████ 100%");
  });

  it("says nothing at all when the field is absent", () => {
    // Absent for a whole class of real sessions: before the first API call, and
    // on any CLI older than 2.1.6. A wrong 0% there would be worse than silence.
    const { out, status } = render(payload());
    expect(status).toBe(0);
    expect(plain(out)).not.toContain("%");
    expect(plain(out)).toContain("[Opus 5]");
  });

  it("says nothing when the field is null", () => {
    // Documented: used_percentage may be null early in a session and again just
    // after /compact. What handles it is jq's `// empty`, for which null is
    // falsy — so the script's own `!= "null"` guard is belt and braces that no
    // input can redden. It is kept only to stay byte-identical to the copy on
    // Greg's laptop; this case pins the behaviour, not that clause.
    const { out } = render(payload({ context_window: { used_percentage: null } }));
    expect(plain(out)).not.toContain("%");
  });

  it("survives a non-numeric percentage", () => {
    const { out, status } = render(payload({ context_window: { used_percentage: "lots" } }));
    expect(status).toBe(0);
    expect(plain(out)).toContain("░░░░░░░░░░ 0%");
  });

  it("survives input that is not JSON at all", () => {
    const { status } = render("not json");
    expect(status).toBe(0);
  });
});

describe("the rest of the line", () => {
  it("names the model and the last two directory segments", () => {
    const { out } = render(payload());
    expect(plain(out)).toContain("[Opus 5]");
    expect(plain(out)).toContain("outer/inner");
  });

  it("falls back to the model id when there is no display name", () => {
    const { out } = render(JSON.stringify({ model: { id: "claude-opus-5" }, workspace: { current_dir: "/tmp" } }));
    expect(plain(out)).toContain("[claude-opus-5]");
  });

  it("names the git branch it is standing in", () => {
    // The script reads git from its OWN cwd, not from workspace.current_dir —
    // which is right, because that is where Claude Code runs it. Asserted
    // against this checkout's real branch rather than a fixture repo.
    const branch = (spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout ?? "").trim();
    expect(branch).not.toBe("");
    const r = spawnSync("bash", ["-c", SCRIPT], { input: payload(), cwd: REPO, encoding: "utf8" });
    // The `*` is the dirty marker and depends on the tree, so match the prefix.
    expect(plain(r.stdout ?? "")).toContain(`(${branch}`);
  });
});

/**
 * The other heredoc: the one that installs the script and edits settings.json.
 * It runs as the user, once per provisioning run, against a file that lives on
 * the persistent volume and already holds preferences nobody wants to lose. So
 * what matters is what it LEAVES BEHIND, and every case here is about a file
 * that was already there.
 */
describe("the settings merge", () => {
  /**
   * $1 is what provision.sh hands it: the status line script, written to a temp
   * file by root. So it gets the REAL extracted one — which makes these cases
   * an end-to-end test of the two heredocs together rather than of either alone.
   */
  const srcScript = path.join(mkdtempSync(path.join(tmpdir(), "gjd-src-")), "statusline.sh");
  writeFileSync(srcScript, `${SCRIPT}
`);
  const run = (home: string) =>
    spawnSync("bash", ["-c", SETTINGS, "settings", srcScript], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
  const fresh = () => mkdtempSync(path.join(tmpdir(), "gjd-settings-"));
  const settingsOf = (home: string) => JSON.parse(readFileSync(path.join(home, ".claude/settings.json"), "utf8"));

  it("finds the settings heredoc", () => {
    expect(SETTINGS).toContain('f="$HOME/.claude/settings.json"');
    expect(SETTINGS.length).toBeGreaterThan(300);
  });

  it("creates the file and the .claude directory on a box that has neither", () => {
    const home = fresh();
    expect(run(home).status).toBe(0);
    const j = settingsOf(home);
    expect(j.statusLine).toEqual({ type: "command", command: path.join(home, ".claude/statusline-script.sh") });
    expect(j.env.CLAUDE_CODE_SCROLL_SPEED).toBe("1");
  });

  it("installs the script executable", () => {
    const home = fresh();
    run(home);
    const sl = path.join(home, ".claude/statusline-script.sh");
    // Runs it, rather than reading the mode: an execute bit on a file whose
    // shebang is wrong looks identical to a working one. And asserts what came
    // out, because exit 0 from the wrong file is still exit 0.
    const r = spawnSync(sl, { input: payload({ context_window: { used_percentage: 55 } }), encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(plain(r.stdout ?? "")).toContain("55%");
  });

  it("keeps every other preference on a rebuild", () => {
    // ~/.claude is on the volume, so this file survives the machine. Writing it
    // whole instead of merging would eat the theme, the tui mode and the
    // notification settings, and nothing would say so.
    const home = fresh();
    mkdirSync(path.join(home, ".claude"));
    writeFileSync(
      path.join(home, ".claude/settings.json"),
      JSON.stringify({ theme: "dark", tui: "fullscreen", env: { OTHER: "keep" } }),
    );
    expect(run(home).status).toBe(0);
    const j = settingsOf(home);
    expect(j.theme).toBe("dark");
    expect(j.tui).toBe("fullscreen");
    expect(j.env.OTHER).toBe("keep");
    expect(j.env.CLAUDE_CODE_SCROLL_SPEED).toBe("1");
  });

  it("keeps the status line settings it does not own", () => {
    const home = fresh();
    mkdirSync(path.join(home, ".claude"));
    writeFileSync(
      path.join(home, ".claude/settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "/old", padding: 2, hideVimModeIndicator: true } }),
    );
    expect(run(home).status).toBe(0);
    const j = settingsOf(home);
    expect(j.statusLine.command).toBe(path.join(home, ".claude/statusline-script.sh"));
    expect(j.statusLine.padding).toBe(2);
    expect(j.statusLine.hideVimModeIndicator).toBe(true);
  });

  it("fails, and changes nothing, on a settings.json that will not parse", () => {
    // jq exits non-zero and the `mv` never happens, so a broken file is a failed
    // step rather than a replaced file — and the trap takes the half-written
    // temp file with it, instead of leaving one more thing that looks like a
    // settings file beside the real one.
    const home = fresh();
    mkdirSync(path.join(home, ".claude"));
    writeFileSync(path.join(home, ".claude/settings.json"), "{ not json");
    expect(run(home).status).not.toBe(0);
    expect(readFileSync(path.join(home, ".claude/settings.json"), "utf8")).toBe("{ not json");
    expect(readdirSync(path.join(home, ".claude")).filter((n) => n.includes(".provision."))).toEqual([]);
  });
});
