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
 * docs/project/hetzner-remote-server-box.md § The status line.
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

  /**
   * The git segment, asserted against throwaway repositories rather than
   * against this checkout.
   *
   * Until 2026-09-02 there was one case here, and it derived its expectation by
   * running `git rev-parse --abbrev-ref HEAD` in whatever checkout the test
   * happened to be standing in. That command answers the literal string `HEAD`
   * when HEAD is detached, and `scripts/deploy.ts` always builds the gate's
   * worktree with `git worktree add --detach` — so the case demanded `(HEAD`
   * from a script that correctly prints the short sha, and the deploy gate's
   * `test` step failed on every run at every commit.
   *
   * That did not *start* the habit of deploying with `--force-gate=test`: the
   * gate's first day materialised `data/` but not `output/` and could not go
   * green either (docs/project/deployment.md § The gate needs both halves), and
   * this case landed later, in `28abfdf`. What it did was keep the gate red
   * after the corpus work had fixed the original cause, so the habit outlived
   * its reason — and three real reds could then sit unread behind a summary
   * line people had already learned to override
   * (docs/plans/260902g-corpus-evidence-for-artefact-coverage.md).
   *
   * The script was right and the test was wrong, so what is pinned now is the
   * script's actual contract — `git symbolic-ref --short HEAD` falling back to
   * `git rev-parse --short HEAD` — in both of the states a checkout can be in.
   */
  describe("the git segment", () => {
    /**
     * An environment with the machine's git taken out of it.
     *
     * Naming the branch with `-b` only removes `init.defaultBranch`, and the
     * first version of this block stopped there — which left the same defect
     * wearing a new hat. A developer's global config can turn on
     * `commit.gpgSign` and make the setup commit demand a signature, point
     * `core.hooksPath` or `init.templateDir` at scripts that run inside our
     * temp repo, or set `core.abbrev` below the seven characters the sha case
     * expects. Worse, an inherited `GIT_DIR`, `GIT_WORK_TREE` or
     * `GIT_INDEX_FILE` redirects git somewhere else entirely, and in a tree
     * several agents share, "somewhere else" is one of their checkouts.
     *
     * So: every `GIT_*` variable dropped rather than filtered, both config
     * files pointed at /dev/null, and the template directory pointed at an
     * empty one of ours. `BASH_ENV` and `ENV` go too, since the script under
     * test is run through `bash -c` and either would inject a file into it.
     * Locale is deliberately left alone — branch names and shas are ASCII, and
     * `⑂` passes through bash as bytes.
     */
    const EMPTY_TEMPLATE = mkdtempSync(path.join(tmpdir(), "gjd-statusline-template-"));
    function hermeticEnv(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k.startsWith("GIT_") || k === "BASH_ENV" || k === "ENV") continue;
        env[k] = v;
      }
      // Set after the copy, so an inherited value of the same name is gone
      // first. GIT_CONFIG_SYSTEM/GLOBAL need git 2.32; this repo's floor is far
      // above that, and a git too old would fail the setup loudly rather than
      // quietly read the developer's config, because `git` throws below.
      env.GIT_CONFIG_SYSTEM = "/dev/null";
      env.GIT_CONFIG_GLOBAL = "/dev/null";
      env.GIT_TEMPLATE_DIR = EMPTY_TEMPLATE;
      return env;
    }

    /**
     * Throws on a non-zero exit. Swallowing it would let a repo that never got
     * its commit produce a status line with no git segment at all — and every
     * assertion below is a `toContain`, so the failure would be reported as
     * whichever string happened to be missing rather than as the setup that
     * did not run.
     */
    function git(cwd: string, args: string[]): string {
      const r = spawnSync("git", args, { cwd, env: hermeticEnv(), encoding: "utf8" });
      if (r.status !== 0) {
        throw new Error(`git ${args.join(" ")} in ${cwd} exited ${r.status}: ${(r.stderr ?? "").trim()}`);
      }
      return (r.stdout ?? "").trim();
    }

    /** A repository with one commit, on a branch we chose. */
    function tempRepo(branch: string): string {
      const repo = path.join(mkdtempSync(path.join(tmpdir(), "gjd-statusline-git-")), "repo");
      mkdirSync(repo);
      git(repo, ["init", "--quiet", "-b", branch]);
      git(repo, ["config", "user.email", "test@example.com"]);
      git(repo, ["config", "user.name", "Test"]);
      git(repo, ["commit", "--quiet", "--allow-empty", "-m", "first"]);
      return repo;
    }

    /**
     * The script reads git from its OWN cwd, not from `workspace.current_dir` —
     * which is right, because that is where Claude Code runs it. So the cwd is
     * the whole of the setup, and the payload stays the ordinary one.
     *
     * It gets the same sanitised environment as the setup commands, because the
     * git calls that matter most are the ones *inside* the heredoc.
     */
    const renderIn = (cwd: string) =>
      plain(
        spawnSync("bash", ["-c", SCRIPT], { input: payload(), cwd, env: hermeticEnv(), encoding: "utf8" }).stdout ?? "",
      );

    it("names the branch when HEAD is attached to one", () => {
      // The `*` is the dirty marker and depends on the tree, so match the prefix.
      expect(renderIn(tempRepo("slate"))).toContain("(slate");
    });

    it("falls back to the short sha when HEAD is detached", () => {
      const repo = tempRepo("slate");
      git(repo, ["checkout", "--quiet", "--detach"]);
      const sha = git(repo, ["rev-parse", "--short", "HEAD"]);
      // A guard on the fixture, not on the script: no change to the heredoc can
      // redden this line. It is here so that a sanitised environment which had
      // quietly stopped working — `core.abbrev` leaking back in and shortening
      // the sha, say — is reported as such rather than as a mystifying
      // `toContain` failure on the line below.
      expect(sha).toMatch(/^[0-9a-f]{7,}$/);
      const out = renderIn(repo);
      expect(out).toContain(`(${sha}`);
      // Named explicitly because this is the string the old case demanded, and
      // printing it would be worse than useless: every detached checkout would
      // look identical to every other one.
      expect(out).not.toContain("(HEAD");
    });

    it("names the worktree it is in, and only when it is in one", () => {
      const repo = tempRepo("slate");
      const linked = path.join(path.dirname(repo), "sidecar");
      git(repo, ["worktree", "add", "--detach", "--quiet", linked]);
      expect(renderIn(linked)).toContain("⑂ sidecar");
      // The suffix earns its place by being absent in the main checkout; a
      // marker every prompt carries tells you nothing about where you are.
      expect(renderIn(repo)).not.toContain("⑂");
    });
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
