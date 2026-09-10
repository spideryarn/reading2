/**
 * The Claude wrapper — scripts/run-claude.ts.
 *
 * Same reasoning as tests/run-codex.test.ts, and the same shape: the claims worth testing are the
 * ones that fail *silently*. A wrapper that piped `claude -p --output-format stream-json` straight
 * back would look perfect from outside — the answer still arrives, the exit code is still 0 — and
 * the only symptom would be the calling agent's context filling with every file the subagent read.
 * So these measure bytes on stdout, and the classification of a run that produced nothing.
 *
 * The child is a stand-in `claude` script rather than the real CLI: the real one costs money, needs
 * auth, and nothing here is a claim about Anthropic's model. The process handling itself lives in
 * scripts/subagent-cli.ts and is exercised through the codex wrapper's tests.
 *
 * See docs/reusable/claude-cli-as-subagent.md.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authConflict, authHint, buildClaudeArgs, claudeEnv, credentialLine, credentialsPassed, parseArgs,
  parseAuthStatus, parseResultEvent, resolveRunClaudeAccount, routedAccountConflict, stderrTail,
} from "../scripts/run-claude.js";
import type { RegistryReading } from "../tools/overseer/accounts.js";
import { sameWriteTarget } from "../scripts/subagent-cli.js";
import { EXIT_FILE, START_FILE, readArtefacts, shellQuote } from "../tools/overseer/launch-artefacts.js";
import { accountNeutralEnv } from "./helpers/account-neutral-env.js";
import { makeLaunchDir, type LaunchFixture } from "./helpers/launch-fixture.js";

/** One line of the NDJSON transcript, as the CLI writes it. */
const resultEvent = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "THE-ANSWER",
    session_id: "abc", total_cost_usd: 0.5, num_turns: 3, permission_denials: [], ...fields,
  });

describe("parseArgs", () => {
  it("will not let --pass-env hand over the credential --auth owns", () => {
    /* The same trap as the codex wrapper's: --pass-env is applied after the denylist sweep, so a
       run that asked for the subscription would spend the key, and every observable thing about it
       — the status line included — would name the wrong account. */
    // An explicit, unrouted environment: parseArgs reads CLAUDE_CONFIG_DIR, and under a pool
    // account the routed refusal would answer instead (plan 260910d, repo-wide A/B).
    expect(() => parseArgs(["--prompt", "x", "--pass-env", "ANTHROPIC_API_KEY"], {}))
      .toThrow(/--auth env/);
  });

  it("rejects an --allow rule the profile cannot honour", () => {
    /* `--access read-only --allow 'Bash(npx vitest run:*)'` is accepted by the CLI and does
       nothing: the rule permits a tool the run does not have. The only symptom is an answer that
       reasons where it should have reproduced — which is what the review profile exists to fix. */
    expect(() => parseArgs(["--prompt", "x", "--access", "read-only", "--allow", "Bash(npx vitest run:*)"]))
      .toThrow(/silently inert/);
    expect(() => parseArgs(["--prompt", "x", "--access", "review", "--allow", "Bash(npx vitest run:*)"]))
      .not.toThrow();
  });

  it("catches a misspelt effort here rather than letting the CLI exit 1 mid-run", () => {
    expect(() => parseArgs(["--prompt", "x", "--effort", "hgih"])).toThrow(/--effort must be one of/);
    expect(() => parseArgs(["--prompt", "x", "--access", "sandbox"])).toThrow(/--access must be one of/);
  });

  it("needs a prompt", () => {
    expect(() => parseArgs([])).toThrow(/--prompt/);
  });

  it("accepts an explicit account name", () => {
    expect(parseArgs(["--prompt", "x", "--account", "pool-a"]).account).toBe("pool-a");
  });

  it("explains that --auth env cannot replace an inherited routed account", () => {
    expect(() => parseArgs(
      ["--prompt", "x", "--auth", "env"],
      { CLAUDE_CONFIG_DIR: "/configs/pool-a" },
    )).toThrow(/routed run.*state directory/i);
  });

  it.each([
    [["--prompt", "x", "--pass-env", "ANTHROPIC_API_KEY"], { CLAUDE_CONFIG_DIR: "/configs/pool-a" }],
    [["--prompt", "x", "--account", "pool-a", "--pass-env", "ANTHROPIC_API_KEY"], {}],
  ] as const)("does not recommend --auth env for a credential on a routed run", (argv, env) => {
    expect(() => parseArgs([...argv], env)).toThrow(/routed run.*state directory/i);
  });
});

describe("account routing", () => {
  const registry: RegistryReading = {
    kind: "value",
    schema: 1,
    accounts: [{
      name: "pool-a",
      family: "claude",
      role: "pool",
      stateDir: "/configs/pool-a",
      providerAccountId: "account-a",
      providerTenantId: "tenant-a",
      displayEmail: "a@example.test",
      addedAt: "2026-09-09T20:00:00.000Z",
      familyData: {},
    }],
  };

  it("routes an explicit child through the registered state directory", () => {
    expect(resolveRunClaudeAccount(registry, "pool-a", undefined)).toMatchObject({
      kind: "value",
      account: { stateDir: "/configs/pool-a" },
    });
  });

  it("carries a routed parent's account into an unrouted child", () => {
    expect(resolveRunClaudeAccount(registry, undefined, "/configs/pool-a")).toMatchObject({
      kind: "value",
      account: { name: "pool-a" },
    });
  });

  it("refuses when a routed parent cannot be resolved", () => {
    expect(resolveRunClaudeAccount({ kind: "ambient", accounts: [] }, undefined, "/configs/pool-a"))
      .toMatchObject({ kind: "refused" });
    expect(resolveRunClaudeAccount(registry, undefined, "/configs/missing"))
      .toMatchObject({ kind: "refused" });
  });

  it("never hands a routed child a credential, however it is asked", () => {
    /* A routed child's account is its config directory and nothing else. Measured 2026-09-10:
       `--auth env` or `--pass-env CLAUDE_CODE_OAUTH_TOKEN` handed a child routed to pool-a the
       parent's token as well — a second account riding in beside the first, because --pass-env was
       re-added after the drop list. Plan 260910d. */
    const parent = {
      PATH: "/bin",
      CLAUDE_CONFIG_DIR: "/configs/parent",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-of-another-account",
      ANTHROPIC_AUTH_TOKEN: "auth-of-another-account",
      ANTHROPIC_API_KEY: "key-of-another-account",
    };
    const credentials = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];
    const asks: Array<[Parameters<typeof claudeEnv>[1], string[]]> = [
      ["env", []],
      ["machine", credentials],
      ["env", credentials],
    ];
    for (const [auth, passEnv] of asks) {
      const env = claudeEnv(parent, auth, passEnv, "/configs/pool-a", () => {});
      expect(env.CLAUDE_CONFIG_DIR).toBe("/configs/pool-a");
      for (const name of credentials) expect(env[name], `${auth} ${passEnv.join(",")}: ${name}`).toBeUndefined();
    }
  });

  it("says which names a routed child was refused", () => {
    const told: string[][] = [];
    claudeEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: "t" }, "machine", ["CLAUDE_CODE_OAUTH_TOKEN"], "/configs/pool-a",
      (names) => told.push(names),
    );
    expect(told).toEqual([["CLAUDE_CODE_OAUTH_TOKEN"]]);
  });

  it("treats routed CLAUDE_* and CLAUDECODE as absolute even when --pass-env asks", () => {
    for (const name of ["CLAUDE_FUTURE_PROVIDER", "CLAUDECODE"]) {
      const env = claudeEnv(
        { [name]: "another-account" },
        "machine",
        [name],
        "/configs/pool-a",
        () => {},
      );
      expect(env[name], name).toBeUndefined();
    }
  });

  it("still lets --pass-env restore a routed non-credential ANTHROPIC_* name", () => {
    const env = claudeEnv(
      { ANTHROPIC_BASE_URL: "https://deliberate.example" },
      "machine",
      ["ANTHROPIC_BASE_URL"],
      "/configs/pool-a",
      () => {},
    );
    expect(env.ANTHROPIC_BASE_URL).toBe("https://deliberate.example");
  });

  it("sets only the selected state directory after sanitising the child environment", () => {
    const env = claudeEnv({
      PATH: "/bin",
      CLAUDE_CONFIG_DIR: "/configs/parent",
      ANTHROPIC_AUTH_TOKEN: "secret-a",
      ANTHROPIC_API_KEY: "secret-b",
      ANTHROPIC_BASE_URL: "https://wrong.invalid",
      CLAUDE_CODE_OAUTH_TOKEN: "secret-c",
      CLAUDE_FUTURE_PROVIDER: "some-new-precedence-rung",
    }, "machine", [], "/configs/pool-a");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/configs/pool-a");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_FUTURE_PROVIDER).toBeUndefined();
  });

  it("refuses a routed child when the live profile no longer matches the registry pin", () => {
    const account = registry.kind === "value" ? registry.accounts[0]! : null;
    if (!account) throw new Error("fixture account missing");
    expect(routedAccountConflict(
      account,
      {
        kind: "value",
        configDir: account.stateDir,
        takenAt: "2026-09-10T00:00:00.000Z",
        accountUuid: "somebody-else",
        orgId: account.providerTenantId!,
        email: account.displayEmail!,
      },
      { loggedIn: true, method: "claude.ai", provider: "firstParty" },
    )).toMatch(/registry pin|identity/i);
  });

  it("refuses routed paid work when the exact child environment has no effective-auth answer", () => {
    const account = registry.kind === "value" ? registry.accounts[0]! : null;
    if (!account) throw new Error("fixture account missing");
    expect(routedAccountConflict(
      account,
      {
        kind: "value",
        configDir: account.stateDir,
        takenAt: "2026-09-10T00:00:00.000Z",
        accountUuid: account.providerAccountId,
        orgId: account.providerTenantId!,
        email: account.displayEmail!,
      },
      undefined,
    )).toMatch(/no answer|cannot.*bill|effective auth/i);
  });
});

describe("buildClaudeArgs", () => {
  const base = { model: "opus", effort: "high", repoDir: ".", prompt: "review this" };

  it("closes every one of the four doors, in every profile", () => {
    for (const access of ["read-only", "review", "write"] as const) {
      const args = buildClaudeArgs({ ...base, access });
      // Nobody is there to answer a prompt, so anything that would ask must be denied rather than
      // left to whatever host launched us.
      expect(args.join(" ")).toContain("--permission-prompts none");
      // --tools covers only the built-in tools; MCP servers arrive from the settings files and
      // would hand a "read-only" reviewer mcp__supabase__apply_migration.
      expect(args).toContain("--strict-mcp-config");
      // The transcript is the thing that must never reach the caller's context.
      expect(args.join(" ")).toContain("--output-format stream-json");
      // Several flags here are variadic, so a positional prompt anywhere but last, after `--`,
      // is eaten by the flag before it.
      expect(args[args.length - 1]).toBe("review this");
      expect(args[args.length - 2]).toBe("--");
    }
  });

  it("gives read-only no way to run a command at all", () => {
    const args = buildClaudeArgs({ ...base, access: "read-only" });
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(args).toContain("--restricted");
    expect(args).not.toContain("--allowed-tools");
  });

  it("gives review Bash without granting it, and write both", () => {
    const review = buildClaudeArgs({ ...base, access: "review" });
    expect(review[review.indexOf("--tools") + 1]).toContain("Bash");
    // No blanket grant: Claude Code's own permission layer then decides each command, and anything
    // it will not run unasked lands in permission_denials instead.
    expect(review).not.toContain("--allowed-tools");

    const write = buildClaudeArgs({ ...base, access: "write" });
    expect(write.join(" ")).toContain("--permission-mode acceptEdits");
    expect(write[write.indexOf("--allowed-tools") + 1]).toBe("Bash");
    // The project's own hooks are a safety net on a run that edits the tree, so this profile does
    // not ignore the settings files.
    expect(write).not.toContain("--restricted");
  });

  it("passes an allow rule through verbatim, and the budget cap when asked", () => {
    const args = buildClaudeArgs({
      ...base, access: "review", allow: ["Bash(npx vitest run:*)"], maxUsd: 2,
    });
    expect(args[args.indexOf("--allowed-tools") + 1]).toBe("Bash(npx vitest run:*)");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
  });
});

describe("parseResultEvent", () => {
  it("finds the verdict at the end of a transcript, whatever came before it", () => {
    const stream = [
      JSON.stringify({ type: "system", subtype: "init", tools: ["Read"] }),
      JSON.stringify({ type: "assistant", message: { content: "thinking out loud" } }),
      resultEvent(),
    ].join("\n");
    expect(parseResultEvent(stream)?.result).toBe("THE-ANSWER");
  });

  it("survives the half-written last line a killed run leaves", () => {
    expect(parseResultEvent(`${resultEvent()}\n{"type":"assis`)?.result).toBe("THE-ANSWER");
  });

  it("says nothing rather than something when there is no result event", () => {
    /* The distinction the caller's error message rests on: a run that was killed mid-stream has no
       verdict, and reporting that as an empty answer would tell somebody their reviewer had no
       opinion when in fact it never finished. */
    const stream = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: "half way" } }),
    ].join("\n");
    expect(parseResultEvent(stream)).toBeUndefined();
  });

  it("treats a missing is_error as an error, not as a blessing", () => {
    /* `event.is_error === true` mapped every absent, malformed or wrongly-typed field to "no
       error", and `{"type":"result","subtype":"success","result":"APPROVE"}` was then accepted as
       a verdict — exit 0, `Done —`, the lot. The field is the signal, so its absence is the
       absence of the signal. GPT Sol's F12, 2026-09-06. */
    expect(parseResultEvent('{"type":"result","subtype":"success","result":"APPROVE"}')?.isError)
      .toBe(true);
    expect(parseResultEvent(resultEvent({ is_error: "false" }))?.isError).toBe(true);
    expect(parseResultEvent(resultEvent({ is_error: null }))?.isError).toBe(true);
    expect(parseResultEvent(resultEvent())?.isError).toBe(false);
  });

  it("reads is_error and terminal_reason, and not subtype", () => {
    /* Measured 2026-09-06 on 2.1.263: a model id the account cannot reach comes back as
       `subtype: "success"` with `is_error: true` and `terminal_reason: "api_error"`. A wrapper
       that trusted subtype would have called that run a success. */
    const parsed = parseResultEvent(resultEvent({
      is_error: true, subtype: "success", terminal_reason: "api_error", api_error_status: 404,
    }));
    expect(parsed?.isError).toBe(true);
    expect(parsed?.subtype).toBe("success");
    expect(parsed?.terminalReason).toBe("api_error");
  });

  it("carries the denials, which are invisible in the answer", () => {
    const parsed = parseResultEvent(resultEvent({
      permission_denials: [{ tool_name: "Bash", tool_input: { command: "npx vitest run x" } }],
    }));
    expect(parsed?.denials).toEqual([{ tool: "Bash", input: '{"command":"npx vitest run x"}' }]);
  });
});

describe("claudeEnv", () => {
  const parent = {
    PATH: "/usr/bin", HOME: "/Users/x", LANG: "en_GB.UTF-8",
    ANTHROPIC_API_KEY: "sk-ant-real", DATABASE_URL: "postgres://u:p@h/db",
    STRIPE_SECRET_KEY: "sk_live", CLAUDE_CODE_MESSAGING_TOKEN: "tok",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock", CLAUDE_CODE_SESSION_ID: "parent",
    CLAUDE_EFFORT: "xhigh", CLAUDE_CODE_SCROLL_SPEED: "3", CLAUDE_CODE_USE_BEDROCK: "1",
  };

  it("passes no credential variable unless --auth env asks", () => {
    expect(claudeEnv(parent, "machine").ANTHROPIC_API_KEY).toBeUndefined();
    expect(claudeEnv(parent, "env").ANTHROPIC_API_KEY).toBe("sk-ant-real");
  });

  it("takes out the secrets that have nothing to do with this run", () => {
    const out = claudeEnv(parent, "env");
    expect(out.DATABASE_URL).toBeUndefined();
    expect(out.STRIPE_SECRET_KEY).toBeUndefined();
    expect(out.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    // And keeps what any CLI needs to run at all — the reason this is a denylist.
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/Users/x");
  });

  it("drops the calling session's own plumbing, and only that", () => {
    /* Not secrets — the socket the parent listens on, the id of a conversation the child is not
       part of, the effort the parent was started with, which would argue with --effort. An
       ordinary preference stays. */
    const out = claudeEnv(parent, "machine");
    expect(out.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined();
    expect(out.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(out.CLAUDE_EFFORT).toBeUndefined();
    expect(out.CLAUDE_CODE_SCROLL_SPEED).toBe("3");
  });

  it("drops an inherited provider selector, which would change the bill in silence", () => {
    /* Measured 2026-09-06: `CLAUDE_CODE_USE_BEDROCK=1 claude auth status` reports
       `apiProvider: "bedrock"`. Inherited from the calling shell it would re-point the run at
       another account entirely, and nothing in the command line would say so. --pass-env is the
       way back in for a machine that really is on Bedrock, and then it is visible. */
    expect(claudeEnv(parent, "machine").CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(claudeEnv(parent, "machine", ["CLAUDE_CODE_USE_BEDROCK"]).CLAUDE_CODE_USE_BEDROCK).toBe("1");
  });

  it("drops the whole ANTHROPIC_ namespace, because three names was a list and not a rule", () => {
    /* The first version dropped `CLAUDE_CODE_USE_*` and nothing else, so `ANTHROPIC_BASE_URL` and
       `ANTHROPIC_CUSTOM_HEADERS` crossed — enough to send the request to another host with an
       Authorization header of somebody's choosing. `strings` on the 2.1.263 binary lists a dozen
       more of them. GPT Sol's F14, 2026-09-06. */
    const rerouted = {
      ...parent,
      ANTHROPIC_BASE_URL: "https://elsewhere.invalid",
      ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer x",
      ANTHROPIC_MODEL: "some-other-model",
      CLAUDE_CONFIG_DIR: "/tmp/somebody-elses-config",
    };
    const out = claudeEnv(rerouted, "machine");
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(out.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    // The model overrides go too: they would quietly disagree with --model.
    expect(out.ANTHROPIC_MODEL).toBeUndefined();
    expect(out.CLAUDE_CONFIG_DIR).toBeUndefined();
    // Still restorable, and then it is in the command line where somebody can see it.
    expect(claudeEnv(rerouted, "machine", ["ANTHROPIC_BASE_URL"]).ANTHROPIC_BASE_URL)
      .toBe("https://elsewhere.invalid");
    // And --auth env still gets exactly the three credentials, prefix rule notwithstanding.
    expect(claudeEnv(rerouted, "env").ANTHROPIC_API_KEY).toBe("sk-ant-real");
  });

  it("says what was passed, by name, and never a value", () => {
    expect(credentialsPassed("machine", parent)).toBe("no credential variable");
    expect(credentialsPassed("env", parent)).toBe("ANTHROPIC_API_KEY");
    expect(credentialsPassed("env", parent)).not.toContain("sk-ant-real");
    expect(credentialsPassed("env", { PATH: "/usr/bin" })).toBe("no credential variable");
  });
});

describe("the auth probe", () => {
  /* The wrapper used to name the credential from the variables it had passed. That was wrong three
     ways at once — an inherited provider selector, a settings-file entry, a key this machine has
     never approved — and all three are visible to `claude auth status` and to nothing else. */
  it("reads the CLI's own answer, and treats anything else as no answer", () => {
    const real = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}';
    expect(parseAuthStatus(real)).toEqual({
      loggedIn: true, method: "claude.ai", provider: "firstParty",
    });
    // A warning line before the JSON is a CLI's prerogative.
    expect(parseAuthStatus(`Warning: something\n${real}`)?.method).toBe("claude.ai");
    expect(parseAuthStatus("Not logged in")).toBeUndefined();
    expect(parseAuthStatus('{"broken":')).toBeUndefined();
    // No `loggedIn` is not a status: inventing a default here is inventing a credential.
    expect(parseAuthStatus('{"authMethod":"claude.ai"}')).toBeUndefined();
  });

  it("names a third-party provider rather than hiding it behind a method", () => {
    const bedrock = { loggedIn: true, method: "third_party", provider: "bedrock" };
    expect(credentialLine(bedrock)).toBe("third_party via bedrock");
    expect(credentialLine({ loggedIn: true, method: "claude.ai", provider: "firstParty" }))
      .toBe("claude.ai");
    expect(credentialLine(undefined)).toBe("no answer");
    expect(credentialLine({ loggedIn: false, method: undefined, provider: undefined }))
      .toBe("not logged in");
  });

  it("fails closed when the probe cannot answer, or names a provider nobody asked for", () => {
    /* --auth env exists to name the account. A probe that returns nothing is not evidence that the
       variables won, so permitting the run there turns a broken probe into a paid run on an
       unknown account — GPT Sol's F16. And a third-party provider the command line never mentioned
       is somebody else's bill. */
    expect(authConflict("env", undefined)).toMatch(/gave no answer/);
    const bedrock = { loggedIn: true, method: "third_party", provider: "bedrock" };
    expect(authConflict("env", bedrock)).toMatch(/bedrock/);
    // …unless the caller asked for it, in which case it is deliberate and visible.
    expect(authConflict("env", bedrock, ["CLAUDE_CODE_USE_BEDROCK"])).toBe("");
    // --auth machine claims nothing about the account, so it refuses nothing.
    expect(authConflict("machine", undefined)).toBe("");
    expect(authConflict("machine", bedrock)).toBe("");
  });

  it("refuses the one conflict that bills the wrong account", () => {
    /* --auth env asked for metered billing, the variables were handed over, and the CLI says it
       will use the machine's login anyway — which is what an unapproved ANTHROPIC_API_KEY does on
       2.1.263, measured. Nothing about that run would look wrong afterwards. */
    const login = { loggedIn: true, method: "claude.ai", provider: "firstParty" };
    expect(authConflict("env", login)).toMatch(/approved/);
    // The other direction is a legitimate machine, not a conflict: --auth machine on a box whose
    // only credential is an apiKeyHelper, or one that really is on Bedrock.
    expect(authConflict("machine", login)).toBe("");
    expect(authConflict("machine", { loggedIn: true, method: "third_party", provider: "bedrock" }))
      .toBe("");
    expect(authConflict("env", { loggedIn: true, method: "oauth_token", provider: "firstParty" }))
      .toBe("");
  });
});

describe("sameWriteTarget", () => {
  it("catches the same file under two names, including two that do not exist yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-claude-same-"));
    const real = join(dir, "a"), link = join(dir, "b");
    writeFileSync(real, "x");
    symlinkSync(real, link);
    expect(sameWriteTarget(real, `${dir}/./a`)).toBe(true);
    // A string comparison cannot see this one, and it is the one that ate a transcript.
    expect(sameWriteTarget(real, link)).toBe(true);
    expect(sameWriteTarget(real, join(dir, "c"))).toBe(false);

    /* And the case that survived the first fix: two names that do not exist yet, reached through
       a symlinked parent directory. There is nothing to stat, so identity has to come from the
       open itself. GPT Sol's F13, 2026-09-06. */
    const realDir = join(dir, "real"), linkDir = join(dir, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, linkDir);
    expect(sameWriteTarget(join(realDir, "new.md"), join(linkDir, "new.md"))).toBe(true);
    expect(sameWriteTarget(join(realDir, "one.md"), join(linkDir, "two.md"))).toBe(false);
  });
});

describe("authHint", () => {
  it("reads the end of the CLI's own stderr", () => {
    expect(authHint("Error: Not logged in\n")).toMatch(/claude auth status/);
    expect(authHint("usage limit reached, resets at 3pm")).toMatch(/usage limit/);
    expect(authHint("some ordinary warning")).toBe("");
  });

  it("cannot be manufactured by something the run merely read", () => {
    /* The codex wrapper's lesson, applied before it could bite: this repo's own docs contain the
       phrase "not logged in", so a hint matched against the whole log tells a run that failed for
       an unrelated reason to go and log in. Two guards — stderr only, and its last lines only. */
    const noise = `${"a line of an unrelated warning\n".repeat(20)}Not logged in — quoted from a doc\n`
      + "the actual failure was something else\n".repeat(5);
    expect(authHint(noise)).toBe("");
  });

  it("shows the CLI's own diagnosis, bounded", () => {
    expect(stderrTail("x\n[claude-code:unrecognized_model] {\"model\":\"nope\"}"))
      .toContain("unrecognized_model");
    expect(stderrTail("a\n".repeat(2000)).length).toBeLessThan(600);
  });
});

/**
 * Write an executable stand-in for `claude` and return its path.
 *
 * It has to answer `auth status` as well as the run itself: the wrapper asks the CLI which
 * credential it resolves *before* the paid invocation, so a stand-in that only knew how to print a
 * transcript would make every end-to-end test exercise the probe's failure path.
 */
function fakeClaude(body: string, authStatus = '{"loggedIn":true,"authMethod":"claude.ai"}'): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const path = join(dir, "claude");
  writeFileSync(
    path,
    `#!/usr/bin/env bash\nif [ "$1" = "auth" ]; then printf '%s\\n' '${authStatus}'; exit 0; fi\n${body}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("the CLI, end to end", () => {
  function runCli(body: string, extraArgs: string[] = []) {
    const bin = fakeClaude(body);
    const dir = mkdtempSync(join(tmpdir(), "run-claude-cli-"));
    const answerPath = join(dir, "answer.md");
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--output", answerPath, ...extraArgs],
      { encoding: "utf8", env: accountNeutralEnv({ PATH: `${join(bin, "..")}:${process.env.PATH}` }) },
    );
    return { ...r, answerPath };
  }

  it("prints the answer and the paths, and not the transcript", () => {
    /* The whole justification for the wrapper, as a number. Every tool result the subagent saw is
       in that stream; a caller that piped it back would swallow all of it, and nothing about the
       run would look wrong. */
    const noise = `for i in $(seq 1 3000); do printf '{"type":"assistant","message":{"content":"NOISE-%s %s"}}\\n' "$i" "$(printf 'x%.0s' {1..200})"; done`;
    const r = runCli(`${noise}\nprintf '%s\\n' '${resultEvent()}'`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("THE-ANSWER");
    expect(r.stdout).not.toContain("NOISE-");
    expect(r.stderr).not.toContain("NOISE-");
    expect(r.stdout.length + r.stderr.length).toBeLessThan(2_000);
    expect(readFileSync(`${r.answerPath}.activity.log`, "utf8").length).toBeGreaterThan(600_000);
    expect(readFileSync(r.answerPath, "utf8")).toContain("THE-ANSWER");
  }, 60_000);

  it("caps a runaway answer, keeping the head and the verdict at the tail", () => {
    const huge = "q".repeat(200_000);
    const r = runCli(
      `printf '%s\\n' '${resultEvent({ result: `ANSWER-HEAD${huge}ANSWER-TAIL` })}'`,
      ["--max-print-chars", "2000"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ANSWER-HEAD");
    expect(r.stdout).toContain("ANSWER-TAIL");
    expect(r.stdout.length).toBeLessThan(10_000);
  }, 60_000);

  it("fails on a non-zero exit, and shows the CLI's own line", () => {
    const r = runCli(`echo '[claude-code:unrecognized_model] {"model":"nope"}' >&2\nexit 1`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unrecognized_model");
    expect(r.stderr).toContain("transcript at");
  }, 60_000);

  it("fails when the stream stops before a verdict", () => {
    /* Exit 0 and no result event: the shape of a run that was killed, or a CLI too old to emit
       one. Reporting it as an empty answer would record silence as agreement. */
    const r = runCli(`printf '%s\\n' '{"type":"assistant","message":{"content":"half"}}'\nexit 0`);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Done —");
  }, 60_000);

  it("fails when the result event says it is an error, however cheerful its subtype", () => {
    const r = runCli(
      `printf '%s\\n' '${resultEvent({ is_error: true, subtype: "error_max_budget_usd", result: undefined })}'\nexit 1`,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error_max_budget_usd");
  }, 60_000);

  it("fails when the answer is empty, rather than reporting an opinion nobody gave", () => {
    const r = runCli(`printf '%s\\n' '${resultEvent({ result: "   \n  " })}'`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("empty");
  }, 60_000);

  it("returns when the timeout says so, even with a leaked helper holding the pipe", () => {
    /* The bug this was written for, 2026-09-06: `--timeout-minutes 5` returned after fifteen
       minutes. 'close' waits for every holder of the child's stdio, and a helper detached into its
       own process group outlives the group kill — so the timeout bounded the child and not the
       wrapper. The error message said "timed out after 5m and was killed" throughout, because it
       names the flag rather than the clock, which is why nothing looked wrong.

       Measured before the fix: 121s for a 6s timeout, i.e. exactly the leaked helper's lifetime.
       The mechanism is in scripts/subagent-cli.ts and is shared with the codex wrapper, which had
       the same hole. */
    const started = Date.now();
    const r = runCli(
      'node -e \'require("child_process").spawn("sleep",["120"],{detached:true,stdio:["ignore","inherit","inherit"]}).unref()\'\nsleep 300',
      ["--timeout-minutes", "0.1"],
    );
    const elapsed = (Date.now() - started) / 1000;
    expect(r.status).toBe(1);
    // The message quotes the measured duration, not the flag — the second half of the same
    // postmortem, because `timed out after 5m` was printed by a call that took fifteen.
    expect(r.stderr).toMatch(/was killed after [\d.]+s \(--timeout-minutes 0\.1\)/);
    // 6s timeout + 5s grace + node's start-up. The number that matters is that it is nowhere near
    // the helper's 120s.
    expect(elapsed).toBeLessThan(45);
  }, 200_000);

  it("exits when a successful run leaves a helper holding the pipe", () => {
    /* Settling the promise is not exiting the process: the read streams are ours, and a leaked
       helper holds them open as handles the event loop still waits on. The timeout path hid this
       because `fail()` calls `process.exit`; a *successful* run printed `Done —` and then sat
       there for the helper's lifetime. GPT Sol's F8, 2026-09-06 — so this measures spawnSync's
       return, which is the process, not the promise. */
    const started = Date.now();
    const r = runCli(
      'node -e \'require("child_process").spawn("sleep",["30"],{detached:true,stdio:["ignore","inherit","inherit"]}).unref()\'\n'
      + `printf '%s\\n' '${resultEvent()}'`,
    );
    const elapsed = (Date.now() - started) / 1000;
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("THE-ANSWER");
    expect(elapsed).toBeLessThan(25);
  }, 90_000);

  it("refuses to write the answer over the transcript", () => {
    /* `--output /tmp/x --activity-log /tmp/x` exited 0, printed both paths, and left a file
       holding only the answer: the transcript written and then destroyed, with nothing saying so.
       GPT Sol demonstrated it, 2026-09-06. Refused before the paid run, not after. */
    const dir = mkdtempSync(join(tmpdir(), "run-claude-alias-"));
    const both = join(dir, "same");
    const bin = fakeClaude(`printf '%s\\n' '${resultEvent()}'`);
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--output", both, "--activity-log", both],
      { encoding: "utf8", env: accountNeutralEnv({ PATH: `${join(bin, "..")}:${process.env.PATH}` }) },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--activity-log");
    expect(existsSync(both)).toBe(false);
  }, 60_000);

  it("--quiet keeps the status and the paths, and drops the answer", () => {
    const r = runCli(`printf '%s\\n' '${resultEvent({ result: "SECRET-ANSWER" })}'`, ["--quiet"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Output:");
    expect(r.stdout).not.toContain("SECRET-ANSWER");
    expect(readFileSync(r.answerPath, "utf8")).toContain("SECRET-ANSWER");
  }, 60_000);

  it("refuses a result event whose subtype is not success, even when is_error is false", () => {
    /* Defensive, and deliberately so: `is_error` is one boolean between a caller and a wrong
       answer, and the SDK's discriminant for a finished turn is `subtype`. An unknown subtype
       fails rather than passing. */
    const r = runCli(
      `printf '%s\\n' '${resultEvent({ subtype: "error_during_execution", is_error: false, result: "APPROVE" })}'`,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error_during_execution");
    // …and the answer is still on disk, so a partial verdict is not lost with the run.
    expect(readFileSync(r.answerPath, "utf8")).toContain("APPROVE");
  }, 60_000);

  it("says out loud what the subagent was not allowed to do", () => {
    /* A denied tool is invisible in the answer — the model works around it and says nothing — so a
       review can come back as reasoning where it was asked for a reproduction. */
    const r = runCli(`printf '%s\\n' '${resultEvent({
      permission_denials: [{ tool_name: "Bash", tool_input: { command: "npx vitest run x" } }],
    })}'`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Denied 1 tool call");
    expect(r.stdout).toContain("--allow");
  }, 60_000);

  it("hands claude an environment with the other secrets taken out of it", () => {
    /* The stand-in dumps its own environment as the answer, so this asserts against what the child
       actually received rather than against what the wrapper meant to send. */
    const r = runCli(
      `env | sed 's/"/_/g' | tr '\\n' ' ' > /tmp/run-claude-env-probe.txt\n`
      + `printf '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"%s"}\\n' "$(cat /tmp/run-claude-env-probe.txt)"`,
    );
    expect(r.status).toBe(0);
    const everything = readFileSync(r.answerPath, "utf8");
    expect(everything).toContain("PATH=");
    // Whatever this machine's .env.local holds, none of these names may cross.
    for (const name of ["DATABASE_URL=", "STRIPE_SECRET_KEY=", "SUPABASE_SERVICE_ROLE_KEY=",
      "OPENROUTER_API_KEY=", "CODEX_API_KEY=", "ANTHROPIC_API_KEY="]) {
      expect(everything).not.toContain(name);
    }
    // And the calling session's plumbing, which is not a secret but is not the child's either.
    expect(everything).not.toContain("CLAUDE_CODE_SESSION_ID=");
  }, 60_000);
});

/**
 * `--launch-dir` — plan 260910f Stage 2, the headless half of D6.
 *
 * The stand-in records, for EVERY call the wrapper makes (the auth probe as well as the run),
 * whether `start.json` was already on disk, which launch id it was handed, and its parent pid — so
 * "written before spawning anything" and "the child sees the id" are measured at the child, not
 * read off the wrapper. `exit.json` is read back through Stage 1's reader.
 */
function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return process.platform === "linux";
  } catch {
    return false;
  }
}

describe("--launch-dir", () => {
  function launchedClaude(f: LaunchFixture, body: string): { dir: string; calls: string } {
    const dir = mkdtempSync(join(tmpdir(), "fake-claude-launch-"));
    const start = shellQuote(join(f.dir, START_FILE));
    writeFileSync(
      join(dir, "claude"),
      `#!/usr/bin/env bash\nhere="$(cd "$(dirname "$0")" && pwd)"\n`
        + `if [ -f ${start} ]; then s=start-present; else s=start-absent; fi\n`
        + `printf '%s %s %s %s\\n' "$1" "$s" "\${SPIDERYARN_LAUNCH_ID-unset}" "$PPID" >> "$here/calls"\n`
        + `if [ "$1" = "auth" ]; then printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi\n`
        + `printf '%s\\0' "$@" > "$here/argv"\n${body}\n`,
    );
    chmodSync(join(dir, "claude"), 0o755);
    return { dir, calls: join(dir, "calls") };
  }

  function run(f: LaunchFixture | null, body: string, extraArgs: string[] = []) {
    const fixture = f ?? makeLaunchDir();
    const bin = launchedClaude(fixture, body);
    const out = mkdtempSync(join(tmpdir(), "run-claude-launch-"));
    const answerPath = join(out, "answer.md");
    const env = accountNeutralEnv({ PATH: `${bin.dir}:${process.env.PATH}` });
    delete env.SPIDERYARN_LAUNCH_ID;
    const launchArgs = f === null ? [] : ["--launch-dir", fixture.dir];
    const r = spawnSync("npx", ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--output", answerPath, ...launchArgs, ...extraArgs], { encoding: "utf8", env });
    const calls = existsSync(bin.calls)
      ? readFileSync(bin.calls, "utf8").trim().split("\n").map((line) => line.split(" "))
      : [];
    const argv = existsSync(join(bin.dir, "argv")) ? readFileSync(join(bin.dir, "argv"), "utf8").split("\0").slice(0, -1) : [];
    return { ...r, answerPath, calls, argv, f: fixture, read: () => readArtefacts(fixture.dir, fixture.correlationId) };
  }

  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

  it("writes start.json before spawning anything, hands every child the id, and exit.json on success", () => {
    const r = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent()}'`);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c[0])).toEqual(["auth", "--print"]);
    for (const call of r.calls) {
      expect(call[1]).toBe("start-present");
      expect(call[2]).toBe(r.f.correlationId);
    }
    const read = r.read();
    // The supervisor the reconciler will ask about is the wrapper: the stand-in's parent.
    expect(read.start.kind === "present" && read.start.record.pid).toBe(Number(r.calls[1]![3]));
    expect(read.exit).toMatchObject({
      kind: "present",
      record: {
        ending: { kind: "exited", code: 0 },
        verdict: { kind: "ok" },
        usageLimit: false,
        permissionDenials: 0,
        answer: { path: r.answerPath, bytes: readFileSync(r.answerPath).byteLength, sha256: sha(r.answerPath), usable: true },
        // --output was given and --activity-log was not, so the transcript takes the launch default.
        transcript: join(r.f.dir, "transcript.ndjson"),
      },
    });
    // And the console is what it always was: nothing about the launch is printed.
    expect(r.stdout).toContain("THE-ANSWER");
    expect(r.stdout).not.toMatch(/start\.json|exit\.json|intent\.json|SPIDERYARN_LAUNCH|--launch-dir/);
  }, 60_000);

  it("writes exit.json on a non-zero exit with a verdict", () => {
    const r = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent()}'\nexit 3`);
    expect(r.status).toBe(1);
    expect(r.read().exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 3 }, verdict: { kind: "failed", cause: "nonzero" } } });
  }, 60_000);

  it("writes exit.json when the stream stops before a verdict", () => {
    const r = run(makeLaunchDir(), "exit 3");
    expect(r.status).toBe(1);
    expect(r.read().exit).toMatchObject({
      kind: "present",
      record: { ending: { kind: "exited", code: 3 }, verdict: { kind: "failed", cause: "no-result" }, permissionDenials: null, answer: { usable: false } },
    });
  }, 60_000);

  it("writes exit.json on a timeout", () => {
    const r = run(makeLaunchDir(), "sleep 30", ["--timeout-minutes", "0.05"]);
    expect(r.status).toBe(1);
    expect(r.read().exit).toMatchObject({ kind: "present", record: { verdict: { kind: "failed", cause: "timeout", why: expect.stringMatching(/killed after/) } } });
  }, 60_000);

  it("writes exit.json on an empty answer", () => {
    const r = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent({ result: "   " })}'`);
    expect(r.status).toBe(1);
    expect(r.read().exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 0 }, verdict: { kind: "failed", cause: "empty-answer" }, answer: { usable: false } } });
  }, 60_000);

  it("writes exit.json when the child is killed by a signal", () => {
    const r = run(makeLaunchDir(), "kill -KILL $$");
    expect(r.status).toBe(1);
    expect(r.read().exit).toMatchObject({ kind: "present", record: { ending: { kind: "signalled", signal: "SIGKILL" }, verdict: { kind: "failed", cause: "no-result" } } });
  }, 60_000);

  it("keeps the file's own verdict and the wrapper's apart: a CLI error with an answer in the file", () => {
    const r = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent({ is_error: true, result: "APPROVE" })}'`);
    expect(r.status).toBe(1);
    const exit = r.read().exit;
    expect(exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 0 }, verdict: { kind: "failed", cause: "cli-error" }, answer: { usable: true } } });
    expect(exit.kind === "present" && exit.record.answer?.bytes).toBeGreaterThan(0);
  }, 60_000);

  it("says when the CLI hit a usage limit, and how many tool calls it was denied", () => {
    const limited = run(makeLaunchDir(), "echo 'You have hit your usage limit, resets at 3pm' >&2\nexit 1");
    expect(limited.read().exit).toMatchObject({ kind: "present", record: { usageLimit: true, verdict: { kind: "failed" } } });
    const denied = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent({
      permission_denials: [{ tool_name: "Bash", tool_input: {} }, { tool_name: "Edit", tool_input: {} }],
    })}'`);
    expect(denied.read().exit).toMatchObject({ kind: "present", record: { usageLimit: false, permissionDenials: 2, verdict: { kind: "ok" } } });
  }, 60_000);

  it("defaults the answer and the transcript into the launch directory, and an explicit flag still wins", () => {
    const f = makeLaunchDir();
    const bin = launchedClaude(f, `printf '%s\\n' '${resultEvent()}'`);
    const env = accountNeutralEnv({ PATH: `${bin.dir}:${process.env.PATH}` });
    const r = spawnSync("npx", ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--launch-dir", f.dir], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(readFileSync(join(f.dir, "answer.md"), "utf8")).toBe("THE-ANSWER");
    expect(readFileSync(join(f.dir, "transcript.ndjson"), "utf8")).toContain('"type":"result"');
    expect(readArtefacts(f.dir, f.correlationId).exit).toMatchObject({
      kind: "present",
      record: { answer: { path: join(f.dir, "answer.md") }, transcript: join(f.dir, "transcript.ndjson") },
    });

    const g = makeLaunchDir();
    const log = join(mkdtempSync(join(tmpdir(), "run-claude-launch-log-")), "mine.log");
    const bin2 = launchedClaude(g, `printf '%s\\n' '${resultEvent()}'`);
    const env2 = accountNeutralEnv({ PATH: `${bin2.dir}:${process.env.PATH}` });
    expect(spawnSync("npx", ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--launch-dir", g.dir, "--activity-log", log], { encoding: "utf8", env: env2 }).status).toBe(0);
    expect(readArtefacts(g.dir, g.correlationId).exit).toMatchObject({ kind: "present", record: { answer: { path: join(g.dir, "answer.md") }, transcript: log } });
  }, 90_000);

  it("refuses a prompt that is not the one the launch pinned, and runs nothing", () => {
    const r = run(makeLaunchDir({ material: "the pinned prompt" }), `printf '%s\\n' '${resultEvent()}'`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/pinned|material/);
    expect(r.calls).toEqual([]);
    expect(r.read().exit).toMatchObject({ kind: "present", record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "prompt-unverified" } } });
  }, 60_000);

  it("re-hashes the prompt file against intent.json: a tampered prompt.md is refused and the CLI never runs; an untouched one runs", () => {
    const runFile = (f: LaunchFixture, promptFile: string) => {
      const bin = launchedClaude(f, `printf '%s\\n' '${resultEvent()}'`);
      const env = accountNeutralEnv({ PATH: `${bin.dir}:${process.env.PATH}` });
      const r = spawnSync("npx", ["tsx", "scripts/run-claude.ts", "--prompt-file", promptFile, "--launch-dir", f.dir], { encoding: "utf8", env });
      return { ...r, ran: existsSync(bin.calls) };
    };
    const good = makeLaunchDir({ material: "exactly the pinned bytes ✓\n" });
    writeFileSync(join(good.dir, "prompt.md"), "exactly the pinned bytes ✓\n");
    const untouched = runFile(good, join(good.dir, "prompt.md"));
    expect(untouched.status).toBe(0);
    expect(untouched.ran).toBe(true);

    const bad = makeLaunchDir({ material: "exactly the pinned bytes ✓\n" });
    writeFileSync(join(bad.dir, "prompt.md"), "exactly the pinned bytes ✓ — and then some\n");
    const tampered = runFile(bad, join(bad.dir, "prompt.md"));
    expect(tampered.status).toBe(1);
    expect(tampered.ran).toBe(false);
    expect(readArtefacts(bad.dir, bad.correlationId).exit).toMatchObject({ kind: "present", record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "prompt-unverified" } } });

    const gone = makeLaunchDir();
    const unreadable = runFile(gone, join(gone.dir, "prompt.md"));
    expect(unreadable.status).toBe(1);
    expect(unreadable.ran).toBe(false);
    expect(readArtefacts(gone.dir, gone.correlationId).exit).toMatchObject({ kind: "present", record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "prompt-unverified" } } });
  }, 120_000);

  it("writes exit.json when claude cannot be spawned at all", () => {
    const f = makeLaunchDir();
    const empty = mkdtempSync(join(tmpdir(), "run-claude-no-claude-"));
    // node and tsx by absolute path, so PATH can be one that holds no claude anywhere.
    const env = accountNeutralEnv({ PATH: `${empty}:/usr/bin:/bin` });
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/run-claude.ts", "--prompt", "p", "--launch-dir", f.dir], { encoding: "utf8", env });
    expect(r.status).toBe(1);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit).toMatchObject({ kind: "present", record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "spawn" }, usageLimit: null } });
  }, 60_000);

  it("a failure of the wrapper's own, after start.json, ends supervisor-failed — and nothing was spawned", () => {
    const f = makeLaunchDir();
    const bin = launchedClaude(f, "exit 0");
    const both = join(mkdtempSync(join(tmpdir(), "run-claude-launch-same-")), "same");
    const env = accountNeutralEnv({ PATH: `${bin.dir}:${process.env.PATH}` });
    const r = spawnSync("npx", ["tsx", "scripts/run-claude.ts", "--prompt", "p", "--output", both, "--activity-log", both, "--launch-dir", f.dir], { encoding: "utf8", env });
    expect(r.status).toBe(1);
    expect(existsSync(bin.calls)).toBe(false);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit).toMatchObject({
      kind: "present",
      record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "wrapper", why: expect.stringMatching(/same file/) }, usageLimit: null, permissionDenials: null, answer: null },
    });
  }, 60_000);

  it("refuses a missing, a 0755 or an intent-less directory before spawning anything, and writes nothing", () => {
    const missing = makeLaunchDir();
    rmSync(missing.dir, { recursive: true });
    const open = makeLaunchDir();
    chmodSync(open.dir, 0o755);
    const blank = makeLaunchDir();
    rmSync(join(blank.dir, "intent.json"));
    for (const [f, why] of [[missing, /does not exist/], [open, /0700/], [blank, /intent/]] as const) {
      const r = run(f, `printf '%s\\n' '${resultEvent()}'`);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(why);
      expect(r.calls).toEqual([]);
      expect(existsSync(join(f.dir, START_FILE))).toBe(false);
      expect(existsSync(join(f.dir, EXIT_FILE))).toBe(false);
    }
  }, 120_000);

  it("will not dry-run under a launch directory", () => {
    expect(() => parseArgs(["--prompt", "x", "--launch-dir", "/x", "--dry-run"], {})).toThrow(/--launch-dir/);
  });

  it.runIf(tmuxAvailable())("closing the wrapper's tmux pane does not orphan its child: the hangup is forwarded, waited for, and recorded", async () => {
    /* The child runs detached, in its own process group and session, so a closed pane (tmux
       kill-session, a closed terminal) SIGHUPs only the wrapper. Before the fix the wrapper died of
       it at once and left `claude` running with no exit.json — the orphan this test was written to
       show. A real tmux on a socket nothing else can reach; never the default server. */
    const base = mkdtempSync(join(tmpdir(), "run-claude-hup-"));
    const sock = join(base, "s");
    const f = makeLaunchDir();
    const bin = mkdtempSync(join(tmpdir(), "fake-claude-hup-"));
    const pidFile = join(bin, "child.pid");
    writeFileSync(
      join(bin, "claude"),
      `#!/usr/bin/env bash\nif [ "$1" = "auth" ]; then printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi\n`
        + `printf '%s' "$$" > ${shellQuote(pidFile)}\nexec sleep 120\n`,
    );
    chmodSync(join(bin, "claude"), 0o755);
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const until = async (done: () => boolean, ms: number): Promise<boolean> => {
      const deadline = Date.now() + ms;
      while (!done()) {
        if (Date.now() > deadline) return false;
        await new Promise((settle) => setTimeout(settle, 100));
      }
      return true;
    };
    const command = `cd ${shellQuote(process.cwd())} && exec ${shellQuote(process.execPath)} ${shellQuote(join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"))} scripts/run-claude.ts --prompt p --launch-dir ${shellQuote(f.dir)}`;
    let child = 0;
    try {
      execFileSync("tmux", ["-S", sock, "-f", "/dev/null", "new-session", "-d", "-s", "wrapper", command], { env: accountNeutralEnv({ PATH: `${bin}:${process.env.PATH}` }) });
      expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", 60_000)).toBe(true);
      child = Number(readFileSync(pidFile, "utf8"));
      expect(alive(child)).toBe(true);
      execFileSync("tmux", ["-S", sock, "kill-session", "-t", "=wrapper"]);
      // Within the kill grace (5s) and some slack: the child is gone, not orphaned.
      expect(await until(() => !alive(child), 20_000)).toBe(true);
      expect(await until(() => existsSync(join(f.dir, EXIT_FILE)), 10_000)).toBe(true);
      expect(readArtefacts(f.dir, f.correlationId).exit).toMatchObject({
        kind: "present",
        record: { ending: { kind: "signalled", signal: expect.stringMatching(/^SIG(HUP|KILL)$/) }, verdict: { kind: "failed", cause: "hangup" } },
      });
    } finally {
      if (child > 0 && alive(child)) process.kill(child, "SIGKILL");
      try {
        execFileSync("tmux", ["-S", sock, "kill-server"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
      rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);

  it("without --launch-dir, the argv is the same, and no child sees a launch id", () => {
    const plain = run(null, `printf '%s\\n' '${resultEvent()}'`);
    expect(plain.status).toBe(0);
    expect(plain.calls.map((c) => c[2])).toEqual(["unset", "unset"]);
    const launched = run(makeLaunchDir(), `printf '%s\\n' '${resultEvent()}'`);
    expect(launched.argv).toEqual(plain.argv);
    expect(plain.argv.at(-1)).toBe("p");
  }, 60_000);
});
