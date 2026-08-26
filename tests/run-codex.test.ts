/**
 * The Codex wrapper — scripts/run-codex.ts.
 *
 * Every claim in that file's header is about what does *not* reach the caller, and none of them
 * fail loudly. A wrapper that streamed codex's activity log straight back would look perfect from
 * the outside: the answer still arrives, the exit code is still 0, and the only symptom is that the
 * calling agent's context filled up — which nothing in a test suite notices. That is exactly the
 * family in docs/reusable/silent-success.md, so these tests measure *bytes on stdout* rather than
 * flags in the config.
 *
 * The child is a stand-in `codex` script rather than the real CLI, deliberately. The real one costs
 * money, needs auth, and cannot be made to ignore SIGTERM on demand — and none of the three things
 * being tested here are claims about OpenAI's model. They are claims about our process handling.
 *
 * See docs/reusable/codex-cli-as-subagent.md.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexArgs, formatAnswer, parseArgs, readAnswerForConsole, runCodex } from "../scripts/run-codex.js";

/**
 * Build the noise line once, outside the loop. Doing it per line — `$(printf 'x%.0s' {1..200})` —
 * spawns a subshell 2000 times, which takes ~2s idle and blew vitest's 5s default under a full
 * parallel suite. The test was measuring bash, not the wrapper.
 */
const NOISE_LINES = 2_000;
const noiseGenerator = (marker: string) =>
  `pad=$(printf 'x%.0s' {1..200})\nfor i in $(seq 1 ${NOISE_LINES}); do printf '${marker}-%s %s\\n' "$i" "$pad"; printf '${marker}ERR-%s %s\\n' "$i" "$pad" >&2; done`;

/** Write an executable stand-in for `codex` and return its path. */
function fakeCodex(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-codex-"));
  const path = join(dir, "codex");
  // Every stand-in needs the -o path, since the wrapper fails closed without that file.
  writeFileSync(
    path,
    `#!/usr/bin/env bash\nout=""; prev=""\nfor a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done\n${body}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("parseArgs", () => {
  it("rejects a cap that would print the whole answer under a truncation banner", () => {
    // 1 and 2 are the values you reach for when checking by hand that the cap works, and they were
    // the two that returned the entire string via slice(-0).
    for (const bad of ["0", "1.5", "-4", "nonsense"]) {
      expect(() => parseArgs(["--prompt", "x", "--max-print-chars", bad])).toThrow(/positive integer/);
    }
    expect(parseArgs(["--prompt", "x", "--max-print-chars", "1"]).maxPrintChars).toBe(1);
  });

  it("rejects flag combinations where the cap would silently not apply", () => {
    // --stream inherits both streams, so nothing downstream can honour --quiet or a cap.
    expect(() => parseArgs(["--prompt", "x", "--stream", "--quiet"])).toThrow(/cannot be combined/);
    expect(() => parseArgs(["--prompt", "x", "--stream", "--print"])).toThrow(/cannot be combined/);
  });

  it("rejects an effort codex would silently accept as a literal string", () => {
    // `-c model_reasoning_effort=hgih` parses fine as TOML and runs at the model default, so this
    // is the one validation that has to happen on our side of the boundary.
    expect(() => parseArgs(["--prompt", "x", "--effort", "hgih"])).toThrow(/--effort must be one of/);
    expect(parseArgs(["--prompt", "x", "--effort", "xhigh"]).effort).toBe("xhigh");
  });

  it("requires a prompt and a known sandbox", () => {
    expect(() => parseArgs([])).toThrow(/--prompt or --prompt-file/);
    expect(() => parseArgs(["--prompt", "x", "--sandbox", "yolo"])).toThrow(/--sandbox must be one of/);
  });
});

describe("buildCodexArgs", () => {
  const argv = buildCodexArgs({
    model: "m", effort: "high", sandbox: "read-only", repoDir: ".", outFile: "/tmp/o", prompt: "-p",
  });

  it("pins approval_policy=never, without which read-only is not a boundary", () => {
    // A user config naming an approvals_reviewer turns `on-request` into an automated yes, so the
    // sandbox stops being authoritative. Verified on codex 0.146.0; see the doc.
    expect(argv.join(" ")).toContain("-c approval_policy=never");
  });

  it("puts the prompt last, after `--`, so a leading dash stays a prompt", () => {
    expect(argv.at(-1)).toBe("-p");
    expect(argv.at(-2)).toBe("--");
  });
});

describe("formatAnswer", () => {
  it("passes a short answer through untouched", () => {
    expect(formatAnswer("verdict: fine", 100, "/tmp/a")).toBe("verdict: fine");
  });

  it("caps a long answer and says where the rest is", () => {
    const shown = formatAnswer("x".repeat(50_000), 1_000, "/tmp/a");
    expect(shown.length).toBeLessThan(1_400);
    expect(shown).toContain("/tmp/a");
    expect(shown).toMatch(/49\d\d\d characters omitted/);
  });

  it("caps at every small limit, rather than emitting the whole answer", () => {
    // The bug: half = floor(maxChars / 2) is 0 at 1 and 2, and `slice(-0)` is the whole string.
    // A cap that fails open at its smallest settings is worse than no cap, because it reports
    // success — the banner still says characters were omitted.
    for (const cap of [1, 2, 3, 10]) {
      const shown = formatAnswer("y".repeat(100_000), cap, "/tmp/a");
      expect(shown.length).toBeLessThan(200);
      // At a cap of 1 or 2 each half rounds down to nothing, so the entire answer is omitted —
      // which is the honest outcome, and the one the old `slice(-0)` inverted.
      const kept = Math.floor(cap / 2) * 2;
      expect(shown).toContain(`${100_000 - kept} characters omitted`);
    }
  });

  it("never splits a surrogate pair, and counts characters rather than code units", () => {
    // Every emoji here is two UTF-16 code units, so a code-unit slice lands mid-pair and leaves a
    // lone surrogate — which renders as a replacement char and which JSON.stringify refuses.
    const shown = formatAnswer("😀".repeat(1_000), 10, "/tmp/a");
    // A lone surrogate is not representable in UTF-8, so Node substitutes U+FFFD encoding it — a
    // well-formed string round-trips byte-identically and a broken one does not. (`isWellFormed`
    // says the same thing in one call, but needs an es2024 lib this repo doesn't set.)
    expect(Buffer.from(shown, "utf8").toString("utf8")).toBe(shown);
    // 1000 characters, not the 2000 code units `String.length` would report. Getting this wrong is
    // invisible in ASCII, which is what the other tests are made of.
    expect(shown).toContain("990 characters omitted");
    expect(Array.from(shown).filter((c) => c === "😀")).toHaveLength(10);
  });

  it("keeps the tail, where a reviewer puts the verdict", () => {
    const shown = formatAnswer(`${"x".repeat(50_000)}VERDICT-HERE`, 1_000, "/tmp/a");
    expect(shown).toContain("VERDICT-HERE");
  });
});

describe("readAnswerForConsole", () => {
  /**
   * A 600 MB **sparse** file: 20 KB on disk, instant to make, and past the ~512 MB ceiling on a JS
   * string. That last part is the point. Asserting only that the returned excerpt is short would
   * be silent success — an implementation that slurped the whole file and then trimmed would pass
   * it. Here `readFileSync` cannot physically succeed, so a passing test is proof the read was
   * bounded rather than evidence consistent with it.
   */
  function sparseAnswer(head: string, tail: string): string {
    const dir = mkdtempSync(join(tmpdir(), "huge-answer-"));
    const path = join(dir, "answer.txt");
    const size = 600 * 1024 * 1024;
    const fd = openSync(path, "w");
    try {
      writeSync(fd, Buffer.from(head, "utf8"), 0, Buffer.byteLength(head), 0);
      ftruncateSync(fd, size);
      const tailBuf = Buffer.from(tail, "utf8");
      writeSync(fd, tailBuf, 0, tailBuf.length, size - tailBuf.length);
    } finally {
      closeSync(fd);
    }
    return path;
  }

  it("reads a file too large to hold as a string at all", () => {
    const path = sparseAnswer("HEAD-MARKER", "TAIL-MARKER");
    try {
      // The premise, asserted rather than assumed: slurping this is not merely wasteful, it throws.
      expect(() => readFileSync(path, "utf8")).toThrow(/longer than/);
      const shown = readAnswerForConsole(path, 2_000);
      expect(shown).toContain("HEAD-MARKER");
      expect(shown).toContain("TAIL-MARKER");
      expect(shown).toContain(path);
      expect(shown.length).toBeLessThan(4_000);
    } finally {
      rmSync(path, { force: true });
    }
  }, 30_000);

  it("honours the exact cap it was given, rather than twice it", () => {
    // The excerpt used to go through a second formatAnswer pass with `maxChars * 2`, because two
    // 4-bytes-per-character spans overshoot the cap on ASCII. That silently doubled every cap and
    // put the 1-and-2 edge case back: at a cap of 2 it kept 4 characters instead of none.
    const path = sparseAnswer("HEADXX", "XXTAIL");
    try {
      for (const cap of [1, 2, 40]) {
        const shown = readAnswerForConsole(path, cap);
        const kept = shown.split("[… answer file is");
        expect(kept[0]?.trim().length).toBeLessThanOrEqual(Math.floor(cap / 2));
      }
    } finally {
      rmSync(path, { force: true });
    }
  }, 30_000);

  it("does not leave a replacement character where it cut a multi-byte codepoint", () => {
    // The seam lands mid-codepoint roughly three times in four, and the decoder turns the fragment
    // into U+FFFD. Every other fixture here is ASCII, where that can never happen — so this is the
    // only test that would notice.
    //
    // These characters are 3 bytes each and the span is a multiple of 4, so the cut is clean only
    // when the span happens to divide by 3: checked directly, caps 8/9/10/11 (spans 16 and 20) all
    // break a character and 6/7 (span 12) do not. Four of the six carry the test; the other two are
    // the control. Widen this list and you dilute it — a cap whose span is a multiple of 12 proves
    // nothing here.
    const path = sparseAnswer("日本語テキストの見出し", "結論の日本語テキスト");
    try {
      for (const cap of [6, 7, 8, 9, 10, 11]) {
        const shown = readAnswerForConsole(path, cap);
        expect(Buffer.from(shown, "utf8").toString("utf8")).toBe(shown);
        expect(shown).not.toContain("\uFFFD");
      }
    } finally {
      rmSync(path, { force: true });
    }
  }, 30_000);
});

describe("runCodex", () => {
  it("captures the activity log instead of streaming it", async () => {
    // 2000 fat lines stands in for a high-effort review dumping file contents and grep hits.
    const bin = fakeCodex(`${noiseGenerator("[")}\nprintf 'ANSWER\\n' > "$out"`);
    const r = await runCodex({ argv: buildCodexArgs({
      model: "m", effort: "low", sandbox: "read-only", repoDir: ".", outFile: "/tmp/unused", prompt: "p",
    }), timeoutMs: 30_000, stream: false, bin });
    expect(r.status).toBe(0);
    // The point: it is large, and it is in our hands rather than on the caller's stdout. Asserting
    // only this would be silent success — a wrapper that captured *and* echoed would pass it — so
    // the claim about what reaches a caller is measured at the CLI, below.
    expect(r.stdout.length).toBeGreaterThan(400_000);
    expect(r.stderr.length).toBeGreaterThan(400_000);
  }, 30_000);

  it("closes fd 0, so codex gets an immediate EOF rather than hanging forever", async () => {
    // An inherited open pipe on stdin is what a bare `codex exec` wedges on, with no --no-stdin
    // flag to save you. If this regresses the test does not fail — it never returns.
    const bin = fakeCodex(`timeout 5 cat < /dev/stdin > /dev/null && echo EOF-IMMEDIATELY || echo BLOCKED\nprintf 'a\\n' > "$out"`);
    const r = await runCodex({ argv: ["-o", "/tmp/unused-stdin"], timeoutMs: 20_000, stream: false, bin });
    expect(r.stdout).toContain("EOF-IMMEDIATELY");
  }, 25_000);

  it("resolves rather than throwing when codex is not on PATH", async () => {
    const r = await runCodex({ argv: [], timeoutMs: 5_000, stream: false, bin: "definitely-not-codex" });
    expect(r.spawnError).toBeDefined();
    expect(r.status).toBe(null);
  });

  it("kills a child that ignores SIGTERM, and the grandchildren it left behind", async () => {
    // spawnSync's `timeout` cannot do this: it signals, then blocks waiting for an exit that never
    // comes. The grandchild stands in for the MCP stdio servers codex starts, which otherwise
    // outlive the kill and reparent to init.
    const bin = fakeCodex(`trap '' TERM\n( while true; do sleep 1; done ) &\necho "grandchild=$!" > "$out"\nwait`);
    const started = Date.now();
    const r = await runCodex({ argv: ["-o", "/tmp/run-codex-gc.txt"], timeoutMs: 500, stream: false, bin });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
    const pid = Number(readFileSync("/tmp/run-codex-gc.txt", "utf8").split("=")[1]);
    await new Promise((r2) => setTimeout(r2, 500));
    // signal 0 probes for existence; ESRCH means it is gone.
    expect(() => process.kill(pid, 0)).toThrow();
  }, 25_000);
});

describe("the CLI, end to end", () => {
  /** Run the wrapper itself, with a stand-in codex on PATH. */
  function runCli(body: string, extraArgs: string[] = []) {
    const bin = fakeCodex(body);
    const dir = mkdtempSync(join(tmpdir(), "run-codex-cli-"));
    const answerPath = join(dir, "answer.md");
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/run-codex.ts", "--prompt", "p", "--output", answerPath, ...extraArgs],
      { encoding: "utf8", env: { ...process.env, PATH: `${join(bin, "..")}:${process.env.PATH}` } },
    );
    return { ...r, answerPath };
  }

  it("prints the answer and the paths, and neither channel of the activity log", () => {
    const r = runCli(`${noiseGenerator("NOISE")}\nprintf 'THE-ANSWER\\n' > "$out"`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("THE-ANSWER");
    // Both of codex's channels carry the log, and only checking stdout would miss half of it.
    expect(r.stdout).not.toContain("NOISE-");
    expect(r.stdout).not.toContain("NOISEERR-");
    expect(r.stderr).not.toContain("NOISE");
    // The whole justification for the wrapper, as a number: ~800KB of activity across the two
    // channels, a few hundred bytes to the caller.
    expect(r.stdout.length + r.stderr.length).toBeLessThan(2_000);
    expect(readFileSync(`${r.answerPath}.activity.log`, "utf8").length).toBeGreaterThan(800_000);
  }, 60_000);

  it("caps an enormous answer too — the log is not the only thing that can flood a caller", () => {
    // A 5 MiB answer, past the slurp threshold, with the noise still running. Without the cap
    // wired into the CLI (rather than merely existing as a helper) this arrives in full.
    const r = runCli(
      `${noiseGenerator("NOISE")}\nprintf 'ANSWER-HEAD' > "$out"\nfor i in $(seq 1 5000); do printf 'q%.0s' {1..1024} >> "$out"; done\nprintf 'ANSWER-TAIL' >> "$out"`,
      ["--max-print-chars", "2000"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ANSWER-HEAD");
    expect(r.stdout).toContain("ANSWER-TAIL");
    expect(r.stdout).not.toContain("NOISE");
    expect(r.stdout.length).toBeLessThan(10_000);
  }, 120_000);

  it("--quiet prints paths, and still no activity log on either channel", () => {
    // With no noise in the stand-in, a --quiet run that leaked the log would look identical to one
    // that didn't — so the noise has to be here too.
    const r = runCli(`${noiseGenerator("NOISE")}\nprintf 'SECRET-ANSWER\\n' > "$out"`, ["--quiet"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Output:");
    expect(r.stdout).not.toContain("SECRET-ANSWER");
    expect(r.stdout).not.toContain("NOISE");
    expect(r.stderr).not.toContain("NOISE");
    expect(r.stdout.length + r.stderr.length).toBeLessThan(1_000);
  }, 60_000);

  it("--dry-run caps the prompt, which with --prompt-file is unbounded caller-supplied text", () => {
    const dir = mkdtempSync(join(tmpdir(), "dry-run-"));
    const promptPath = join(dir, "prompt.md");
    writeFileSync(promptPath, `PROMPT-HEAD${"w".repeat(2 * 1024 * 1024)}PROMPT-TAIL`);
    const r = spawnSync("npx", ["tsx", "scripts/run-codex.ts", "--prompt-file", promptPath, "--dry-run"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PROMPT-HEAD");
    expect(r.stdout).toContain("approval_policy=never");
    expect(r.stdout.length).toBeLessThan(25_000);
  }, 60_000);
});
