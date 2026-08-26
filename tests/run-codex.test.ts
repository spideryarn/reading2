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
import {
  authHint, authPlan, buildCodexArgs, childEnv, combinedLog, formatAnswer, isCredentialFailure,
  parseArgs, readAnswerForConsole, runCodex, shouldFallBack,
} from "../scripts/run-codex.js";

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
  it("will not let --pass-env hand over the one variable --auth controls", () => {
    /* --pass-env is applied after the denylist sweep, so `--pass-env CODEX_API_KEY` reached the
       child on an attempt that had asked for the subscription: it would spend the key, report the
       subscription, and then "fall back" to the credential it was already using. Every observable
       thing about that run is wrong and none of it looks wrong. GPT Sol's finding, 2026-08-26. */
    expect(() => parseArgs(["--prompt", "x", "--pass-env", "CODEX_API_KEY"]))
      .toThrow(/--auth key-first/);
    expect(parseArgs(["--prompt", "x", "--pass-env", "GITHUB_TOKEN"]).passEnv).toEqual(["GITHUB_TOKEN"]);
  });

  it("rejects an auth mode it does not have", () => {
    expect(() => parseArgs(["--prompt", "x", "--auth", "chatgpt"])).toThrow(/--auth must be one of/);
    expect(parseArgs(["--prompt", "x"]).auth).toBe("subscription-first");
  });

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

describe("childEnv", () => {
  const parent = {
    PATH: "/usr/bin", HOME: "/Users/x", LANG: "en_GB.UTF-8", TMPDIR: "/tmp",
    CODEX_API_KEY: "sk-codex", OPENROUTER_API_KEY: "sk-or", ANTHROPIC_API_KEY: "sk-ant",
    SUPABASE_SERVICE_ROLE_KEY: "sk-svc", DATABASE_URL: "postgres://u:pw@h/db",
    GITHUB_TOKEN: "ghp_x", MY_SECRET: "s", SESSION_COOKIE: "c", SSH_AUTH_SOCK: "/tmp/sock",
    EDITOR: "vim", AUTHOR: "greg", KEYBOARD_LAYOUT: "gb",
    // Credentials whose names carry no underscore boundary — the cost of segment matching, and
    // the reason there are two rules rather than one.
    PGPASSWORD: "pw", MYSQL_PWD: "pw", CI_JOB_JWT: "ey.x", KUBECONFIG: "/x/kube", NETRC: "/x/netrc",
    REDIS_URL: "redis://u:pw@h", HTTPS_PROXY: "http://u:pw@proxy",
    // Ordinary Linux desktop plumbing that reads like a credential and isn't.
    XDG_SESSION_TYPE: "wayland", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus",
    DESKTOP_SESSION: "gnome", SESSION_MANAGER: "local/x",
    PWD: "/repo", OLDPWD: "/",
  };

  it("keeps the ordinary environment codex needs to run at all", () => {
    // The reason this is a denylist. An allowlist has to enumerate PATH, HOME, TMPDIR, LANG, the
    // npm and XDG variables and whatever a plugin wants, and breaks unpredictably when it misses.
    const out = childEnv(parent);
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/Users/x");
    expect(out.LANG).toBe("en_GB.UTF-8");
    expect(out.EDITOR).toBe("vim");
    // Segment matching, not substring: these two contain AUTH and KEY and are not credentials.
    // A substring denylist silently eats them, and nothing downstream says why.
    expect(out.AUTHOR).toBe("greg");
    expect(out.KEYBOARD_LAYOUT).toBe("gb");
    // SESSION is in neither rule on purpose: these are desktop plumbing, and a session variable
    // that really is a credential is named for what it holds and caught by the word rule.
    for (const name of [
      "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS", "DESKTOP_SESSION", "SESSION_MANAGER",
    ]) {
      expect(out[name]).toBeDefined();
    }
    // PWD is the working directory, not a password; only a `_PWD` suffix is.
    expect(out.PWD).toBe("/repo");
    expect(out.OLDPWD).toBe("/");
  });

  it("withholds every credential except the one codex is entitled to", () => {
    const out = childEnv(parent);
    for (const name of [
      "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
      "GITHUB_TOKEN", "MY_SECRET", "SESSION_COOKIE", "SSH_AUTH_SOCK",
      // Names with no underscore boundary around the giveaway word. Segment matching alone let
      // every one of these through, which is the sort of gap a denylist fails quietly at.
      "PGPASSWORD", "MYSQL_PWD", "CI_JOB_JWT", "KUBECONFIG", "NETRC",
      // Credentials hiding inside an ordinary-looking value.
      "REDIS_URL", "HTTPS_PROXY",
    ]) {
      expect(out[name]).toBeUndefined();
    }
    // And the inverse, which is the half a leak test cannot see: withholding *everything* would
    // satisfy every assertion above while quietly breaking auth.
    expect(out.CODEX_API_KEY).toBe("sk-codex");
  });

  it("withholds even the codex key when the run is asking for the subscription", () => {
    // This is the whole mechanism behind --auth subscription-first: codex prefers CODEX_API_KEY
    // over ~/.codex/auth.json whenever the variable is set, so the only way to ask for the
    // subscription is not to hand the key over. A version that passed the key anyway would still
    // return an answer, still exit 0, and quietly bill the wrong account — nothing observable.
    const out = childEnv(parent, [], false);
    expect(out.CODEX_API_KEY).toBeUndefined();
    // And nothing else changed: withholding *everything* would satisfy the line above too.
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/Users/x");
  });

  it("lets a named variable through, for an MCP server with a token of its own", () => {
    const out = childEnv(parent, ["GITHUB_TOKEN"]);
    expect(out.GITHUB_TOKEN).toBe("ghp_x");
    expect(out.OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe("authHint", () => {
  it("lifts the two account-level failures out of a log the caller was told not to read", () => {
    // Both arrive as a bare `exit 1`. Without this the caller sees a generic non-zero exit and a
    // path, and the natural next move — blame the prompt or the wrapper — is the wrong one.
    expect(authHint("ERROR: Your workspace is out of credits. Ask your workspace owner to refill."))
      .toMatch(/CODEX_API_KEY/);
    expect(authHint("ERROR: status 401 Unauthorized")).toMatch(/codex login/);
    expect(authHint("ERROR: missing API key")).toMatch(/codex login/);
  });

  it("catches the API-key spelling of out-of-credits, not just the subscription one", () => {
    /* The two auth paths word the same failure differently, and the matcher only
       knew one of them. A ChatGPT subscription says "Your workspace is out of
       credits"; API-key billing says "You have no credits remaining", which
       matched neither branch — so the run reported a bare `exit 1` and a path,
       which is precisely the outcome authHint exists to prevent. Cost two
       review runs on 2026-08-26 before anybody opened the log.

       Note the shape of the miss: the phrase this matched on was chosen by
       reading one failure rather than both, which is the same
       written-from-a-list mistake docs/reusable/silent-success.md is about. */
    const hint = authHint("ERROR: stream disconnected before completion: You have no credits " +
      "remaining. Add credits to continue using the API at https://platform.openai.com/");
    expect(hint).toMatch(/credit/i);
    // And it must not tell somebody whose CODEX_API_KEY is the thing that ran
    // dry to go and set CODEX_API_KEY.
    expect(hint).toMatch(/billing|top|add credit/i);
  });

  it("blames the account the run was actually spending", () => {
    /* The hint used to hedge — "if CODEX_API_KEY is set, that key is the one that has run dry" —
       which was true only while the key always won. Under --auth subscription-only the key is
       deliberately withheld, and that sentence sent somebody to top up a full key while the
       subscription was the empty one. A confident wrong hint is worse than no hint, and this is
       the shape it takes when a fact ("the key always wins") quietly stops being true. */
    const spent = "ERROR: Your workspace is out of credits.";
    expect(authHint(spent, false)).toMatch(/subscription is out of credits/i);
    expect(authHint(spent, false)).toMatch(/setting CODEX_API_KEY/i);
    expect(authHint(spent, true)).toMatch(/CODEX_API_KEY is out of credits/i);
  });

  it("reads codex's own ERROR lines, not the files codex printed", () => {
    // The activity log is mostly the *contents of files codex read*. This repo's own documentation
    // contains the string "out of credits", so an unanchored search would tell someone whose run
    // failed for an unrelated reason — having merely opened that doc — to go and buy credits they
    // already have. A confident wrong hint is worse than no hint.
    const log = [
      "exec bash -lc 'cat docs/reusable/codex-cli-as-subagent.md'",
      "  - **Running out of credit...** the reason (`out of credits`) is in the activity log",
      "  see also HTTP 401 handling and `invalid api key` in the fixtures",
      "turn.failed: model returned no content",
    ].join("\n");
    expect(authHint(log)).toBe("");
  });

  it("says nothing about a failure that isn't about the account", () => {
    expect(authHint("thread.started\nturn.failed: model returned no content")).toBe("");
  });

  it("quotes none of the log it matched on", () => {
    // The log is the thing being kept out of the caller's context; a hint that echoed its
    // surroundings would be a hole in exactly the guarantee this file exists to defend.
    const log = `SECRET-FILE-CONTENTS ${"x".repeat(50_000)}\nERROR: out of credits`;
    const hint = authHint(log);
    expect(hint).not.toContain("SECRET-FILE-CONTENTS");
    expect(hint.length).toBeLessThan(300);
  });
});

describe("authPlan", () => {
  it("spends the subscription first and keeps the key in reserve", () => {
    expect(authPlan("subscription-first", true)).toEqual([false, true]);
  });

  it("does not run the same credential twice when there is nothing to fall back to", () => {
    // With no key set, a second attempt would re-run the identical failure against the identical
    // account — twice the wall-clock for the same error, and a log that looks like a flake.
    expect(authPlan("subscription-first", false)).toEqual([false]);
  });

  it("keeps the old behaviour reachable, and one attempt means one attempt", () => {
    expect(authPlan("key-first", true)).toEqual([true]);
    expect(authPlan("subscription-only", true)).toEqual([false]);
  });

  it("does not claim key-first spent a key that does not exist", () => {
    /* With no key set, codex falls through to the subscription and the run works — but the status
       line and the error hint both name whatever this array says, so `[true]` sent somebody to top
       up a key they had never had. The run succeeding is exactly why nothing else would catch it.
       GPT Sol's finding, 2026-08-26. */
    expect(authPlan("key-first", false)).toEqual([false]);
  });
});

describe("combinedLog", () => {
  it("keeps a channel boundary that would otherwise fuse two lines into one", () => {
    // Plain concatenation makes this "…still working.ERROR: Your workspace is out of credits",
    // which fails the ^ERROR anchor — so the fallback would not fire on a real spent credential.
    const run = { stdout: "…still working.", stderr: "ERROR: Your workspace is out of credits." };
    expect(isCredentialFailure(combinedLog(run))).toBe(true);
    expect(isCredentialFailure(run.stdout + run.stderr)).toBe(false);
  });
});

describe("isCredentialFailure", () => {
  it("knows both spellings of out-of-credits and the rate-limit wording", () => {
    // The two auth paths word the same failure differently, which has already cost this repo two
    // review runs once — see the authHint tests below.
    expect(isCredentialFailure("ERROR: Your workspace is out of credits.")).toBe(true);
    expect(isCredentialFailure("ERROR: You have no credits remaining.")).toBe(true);
    expect(isCredentialFailure("ERROR: 429 rate limit exceeded")).toBe(true);
    expect(isCredentialFailure("ERROR: You've hit your usage limit. Try again later.")).toBe(true);
    expect(isCredentialFailure("ERROR: status 401 Unauthorized")).toBe(true);
  });

  it("reads codex's ERROR lines, not the files codex printed", () => {
    // Same trap as authHint's, and worse here: an unanchored match doesn't produce a wrong hint,
    // it spends the second credential on a run that failed for an unrelated reason. This page is
    // in this repo and contains every phrase above.
    const log = [
      "exec bash -lc 'cat docs/reusable/codex-cli-as-subagent.md'",
      "  - **Running out of credit...** the reason (`out of credits`) is in the activity log",
      "  see also 429 rate limit handling and `invalid api key` in the fixtures",
      "turn.failed: model returned no content",
    ].join("\n");
    expect(isCredentialFailure(log)).toBe(false);
  });

  it("says no to a failure that is about the work", () => {
    expect(isCredentialFailure("ERROR: turn.failed: model returned no content")).toBe(false);
  });
});

describe("shouldFallBack", () => {
  const clean = { status: 1, timedOut: false, overflowed: false };
  const readOnly = { streamed: false, sandbox: "read-only" };
  const spent = "ERROR: Your workspace is out of credits.";

  it("spends the second credential when the log says the first one is spent", () => {
    expect(shouldFallBack(clean, spent, readOnly)).toBe(true);
  });

  it("does not spend it on a failure the credential did not cause", () => {
    // A 45-minute review that times out would otherwise run for another 45 and time out again.
    expect(shouldFallBack({ ...clean, timedOut: true }, spent, readOnly)).toBe(false);
    expect(shouldFallBack({ ...clean, overflowed: true }, spent, readOnly)).toBe(false);
    expect(shouldFallBack({ ...clean, spawnError: new Error("ENOENT") }, "", readOnly)).toBe(false);
    expect(shouldFallBack(clean, "ERROR: turn.failed: model returned no content", readOnly)).toBe(false);
  });

  it("wants evidence even when the exit code is 0 and there is no answer", () => {
    /* This used to fall back unconditionally, reasoning that an exit code of 0 tells you nothing.
       It doesn't — but the log does. The one time this was observed (0.149.1, a review that read
       ~279,000 tokens and wrote no -o file) the credit error was right there in the log, so the
       evidence rule catches the real case and the unconditional branch only added false retries.
       GPT Sol's finding, 2026-08-26. */
    expect(shouldFallBack({ ...clean, status: 0 }, "", readOnly)).toBe(false);
    expect(shouldFallBack({ ...clean, status: 0 }, spent, readOnly)).toBe(true);
  });

  it("never falls back on a streamed run, which threw its evidence away", () => {
    // The old rule was "no log, so fall back on any failure", which is backwards: no evidence is a
    // reason not to spend the second credential. --stream is for a human, who can re-run it.
    expect(shouldFallBack(clean, spent, { streamed: true, sandbox: "read-only" })).toBe(false);
  });

  it("never repeats a write-capable run, whatever the log says", () => {
    // Attempt 2 starts fresh and runs the whole prompt again over attempt 1's half-finished edits.
    // Whether that is recoverable is a judgement about the diff, so it belongs to whoever reads it.
    for (const sandbox of ["workspace-write", "danger-full-access"]) {
      expect(shouldFallBack(clean, spent, { streamed: false, sandbox })).toBe(false);
    }
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
    expect(Number.isInteger(pid)).toBe(true);   // else process.kill throws for the wrong reason
    // Poll rather than sleeping a fixed 500ms. The child ignores SIGTERM, so it only dies at the
    // SIGKILL after the 5s grace, and under a loaded parallel suite the group teardown lands a
    // little later than that — a fixed wait makes this test fail for reasons that are about the
    // machine rather than about the wrapper.
    const gone = async (): Promise<boolean> => {
      for (let i = 0; i < 100; i++) {
        // signal 0 probes for existence; ESRCH means it is gone.
        try { process.kill(pid, 0); } catch { return true; }
        await new Promise((r2) => setTimeout(r2, 100));
      }
      return false;
    };
    expect(await gone()).toBe(true);
  }, 30_000);
});

describe("the CLI, end to end", () => {
  /** Run the wrapper itself, with a stand-in codex on PATH. */
  /**
   * What `.env.local` says a variable is, or `undefined` when it says nothing.
   *
   * Read here rather than imported so this test asserts against the FILE, not
   * against `src/env.ts`'s idea of the file — a parser bug that made both agree
   * would otherwise be invisible to the one test that could catch it.
   */
  function envFileValue(name: string): string | undefined {
    let text: string;
    try {
      text = readFileSync(join(import.meta.dirname, "..", ".env.local"), "utf8");
    } catch {
      return undefined; // a fresh clone has no file, and the sentinel then wins
    }
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
      if (m) return (m[1] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    return undefined;
  }

  function runCli(body: string, extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
    const bin = fakeCodex(body);
    const dir = mkdtempSync(join(tmpdir(), "run-codex-cli-"));
    const answerPath = join(dir, "answer.md");
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/run-codex.ts", "--prompt", "p", "--output", answerPath, ...extraArgs],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${join(bin, "..")}:${process.env.PATH}`, ...extraEnv },
      },
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

  it("hands codex an environment with the other secrets taken out of it", () => {
    // The child is the leak, not the wrapper. Codex runs shell commands on the model's say-so and
    // their stdout becomes the activity log — and can be quoted back in the answer, which we print.
    // So the stand-in does what a debugging tool call would do: dumps its environment into every
    // channel it has. A fake child that never reads the environment proves only that our own
    // status line doesn't enumerate it, which was never the risk.
    /* --auth key-first because the default no longer hands the key to the first attempt, and the
       last assertion here is that it arrives. The withheld case is childEnv's own test above. */
    const r = runCli(`env\nenv >&2\nenv > "$out"`, ["--auth", "key-first"], {
      CODEX_API_KEY: "sk-CODEX-SENTINEL",
      OPENROUTER_API_KEY: "sk-OPENROUTER-SENTINEL",
      SUPABASE_SERVICE_ROLE_KEY: "sk-SUPABASE-SENTINEL",
      DATABASE_URL: "postgres://u:DBPASS-SENTINEL@h/db",
    });
    const answer = readFileSync(r.answerPath, "utf8");
    const everything = r.stdout + r.stderr
      + readFileSync(`${r.answerPath}.activity.log`, "utf8") + answer;
    expect(everything).not.toContain("OPENROUTER-SENTINEL");
    expect(everything).not.toContain("SUPABASE-SENTINEL");
    expect(everything).not.toContain("DBPASS-SENTINEL");
    // The child really did dump its environment — without this the assertions above are vacuous.
    expect(everything).toContain("PATH=");
    /* And codex still got the one key it needs — but **not necessarily the
       sentinel**, and that is a real property rather than a test compromise.
       Since 2026-08-26 `.env.local` beats an inherited value (src/env.ts), and
       an environment handed to a spawned process IS inherited from that
       process's point of view — indistinguishable from a `~/.zshrc` export,
       which is exactly the shadowing that rule exists to stop. So on a machine
       with a `CODEX_API_KEY` in `.env.local`, the file's value is the one that
       reaches codex, and asserting the sentinel would be asserting the old
       precedence. Resolve the same way the loader does. */
    expect(answer).toContain(envFileValue("CODEX_API_KEY") ?? "sk-CODEX-SENTINEL");
  }, 60_000);

  it("never prints the API key on its own status output", () => {
    const r = runCli(`printf 'ANSWER\\n' > "$out"`, [], { CODEX_API_KEY: "sk-SENTINEL-DO-NOT-PRINT" });
    expect(r.stdout).not.toContain("SENTINEL");
    expect(r.stderr).not.toContain("SENTINEL");
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

  /**
   * Which credential a run spent is invisible from outside: the answer arrives, the exit code is 0,
   * and the only difference is which account got billed. So the stand-in *records* what it was
   * handed, one line per attempt, and the tests read that file. Asserting on the wrapper's own
   * status line instead would pass just as happily if the plan were never followed.
   */
  function attemptsCodex(body: string, extraArgs: string[] = []) {
    const attempts = join(mkdtempSync(join(tmpdir(), "attempts-")), "attempts");
    const record = 'if [ -n "$CODEX_API_KEY" ]; then echo key >> "$ATTEMPTS"; else echo sub >> "$ATTEMPTS"; fi';
    // CODEX_API_KEY is passed explicitly so the test doesn't depend on a .env.local existing —
    // without a key set anywhere, subscription-first is one attempt and every assertion below
    // would be about a plan that was never made.
    const r = runCli(`${record}\n${body}`, extraArgs, { ATTEMPTS: attempts, CODEX_API_KEY: "sk-TEST" });
    return { ...r, attempts: readFileSync(attempts, "utf8").trim().split("\n") };
  }

  const outOfCredits = 'echo "ERROR: Your workspace is out of credits." >&2; exit 1';

  it("falls back to the key when the subscription is spent, and says so", () => {
    const r = attemptsCodex(
      `if [ -z "$CODEX_API_KEY" ]; then ${outOfCredits}; fi\nprintf 'THE-ANSWER\\n' > "$out"`,
    );
    expect(r.attempts).toEqual(["sub", "key"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("THE-ANSWER");
    // A run that quietly cost twice what the caller expected is the risk of doing this
    // automatically, so the retry is announced — by credential name, never its value.
    expect(r.stdout).toContain("retrying with CODEX_API_KEY");
    expect(r.stdout).not.toContain("sk-TEST");
    // Both attempts' logs are kept: diagnosing why the first credential failed is the whole reason
    // anyone opens this file, and it is the attempt the error message no longer talks about.
    const log = readFileSync(`${r.answerPath}.activity.log`, "utf8");
    expect(log).toContain("attempt 1");
    expect(log).toContain("attempt 2");
  }, 60_000);

  it("stops at the subscription when the subscription works", () => {
    // The half that a fallback test cannot see: always retrying would satisfy the test above.
    const r = attemptsCodex(`printf 'THE-ANSWER\\n' > "$out"`);
    expect(r.attempts).toEqual(["sub"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("THE-ANSWER");
    expect(r.stdout).not.toContain("retrying");
  }, 60_000);

  it("does not spend the key on a failure the subscription did not cause", () => {
    // Retrying this pays for the same wrong answer twice, and on a 45-minute review it costs
    // 45 minutes to learn nothing.
    const r = attemptsCodex('echo "ERROR: turn.failed: model returned no content" >&2; exit 1');
    expect(r.attempts).toEqual(["sub"]);
    expect(r.status).toBe(1);
  }, 60_000);

  it("falls back when the first attempt exits zero having written nothing", () => {
    // Observed on 0.149.1: out of credit mid-run, exit 0, -o file never created. The status code
    // says the run succeeded, so the answer is what has to catch it — and the log is what says
    // whose fault it was, which is why the stand-in prints the error it really printed.
    const r = attemptsCodex(
      `if [ -z "$CODEX_API_KEY" ]; then echo "ERROR: Your workspace is out of credits." >&2; exit 0; fi\nprintf 'LATE\\n' > "$out"`,
    );
    expect(r.attempts).toEqual(["sub", "key"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LATE");
  }, 60_000);

  it("treats a large whitespace-only answer as no answer too", () => {
    /* The first version scanned only the first 64 KiB and called anything bigger usable, which
       said a 200 KiB file of spaces was an answer — the exact claim the check exists to deny, and
       one that only shows up above a threshold nobody tests by hand. GPT Sol's finding. */
    const blank = `printf ' %.0s' $(seq 1 200000) > "$out"`;
    const r = attemptsCodex(
      `if [ -z "$CODEX_API_KEY" ]; then echo "ERROR: Your workspace is out of credits." >&2; ${blank}; exit 0; fi\nprintf 'REAL\\n' > "$out"`,
    );
    expect(r.attempts).toEqual(["sub", "key"]);
    expect(r.stdout).toContain("REAL");
  }, 60_000);

  it("points a write run at --auth key-first even when it exits zero", () => {
    // The non-zero branch had the note and this one didn't — and this is the path that most needs
    // it, being the one where the run reported success and the caller has nothing else to go on.
    const r = attemptsCodex(
      'echo "ERROR: Your workspace is out of credits." >&2; exit 0',
      ["--sandbox", "workspace-write"],
    );
    expect(r.attempts).toEqual(["sub"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("wrote no answer");
    expect(r.stderr).toContain("--auth key-first");
  }, 60_000);

  it("treats a whitespace-only answer as no answer", () => {
    // Exit 0 and a lone newline in the -o file. `existsSync`, and then a size check, both call
    // this a success; a caller that pastes it into a doc records silence as agreement.
    const r = attemptsCodex(
      `if [ -z "$CODEX_API_KEY" ]; then echo "ERROR: Your workspace is out of credits." >&2; printf '\\n  \\n' > "$out"; exit 0; fi\nprintf 'REAL\\n' > "$out"`,
    );
    expect(r.attempts).toEqual(["sub", "key"]);
    expect(r.stdout).toContain("REAL");
  }, 60_000);

  it("does not repeat a workspace-write run, and says why not", () => {
    // The second attempt would run the whole prompt again over the first one's edits. Failing
    // with a bare exit 1 instead would look exactly like a run --auth was never going to help.
    const r = attemptsCodex(`${outOfCredits}`, ["--sandbox", "workspace-write"]);
    expect(r.attempts).toEqual(["sub"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--auth key-first");
  }, 60_000);

  it("does not offer a fallback to a write run whose failure it could not have fixed", () => {
    // The note is only useful when the other credential would actually have helped. On a bad
    // prompt it is noise, in the one place somebody is reading carefully.
    const r = attemptsCodex('echo "ERROR: turn.failed: model returned no content" >&2; exit 1',
      ["--sandbox", "workspace-write"]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("--auth key-first");
  }, 60_000);

  it("--auth subscription-only never reaches for the key, even when the run fails", () => {
    const r = attemptsCodex(`${outOfCredits}`, ["--auth", "subscription-only"]);
    expect(r.attempts).toEqual(["sub"]);
    expect(r.status).toBe(1);
    // And it blames the account it was actually spending, not the full key sitting beside it.
    expect(r.stderr).toContain("ChatGPT subscription is out of credits");
  }, 60_000);

  it("--auth key-first keeps the old single-attempt behaviour", () => {
    const r = attemptsCodex(`printf 'THE-ANSWER\\n' > "$out"`, ["--auth", "key-first"]);
    expect(r.attempts).toEqual(["key"]);
    expect(r.status).toBe(0);
  }, 60_000);
});
