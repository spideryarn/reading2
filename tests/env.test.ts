/**
 * Which `OPENROUTER_API_KEY` we actually use — src/env.ts.
 *
 * ## Why this test exists
 *
 * `~/.zshrc` and `~/.zprofile` both `export OPENROUTER_API_KEY`, and on this
 * machine it is a **different key on a different OpenRouter account** from the
 * one in `.env.local`. The old rule was "a variable already in the environment
 * wins", so every command in every shell quietly used the wrong account.
 *
 * It surfaced as `404 No endpoints available matching your guardrail
 * restrictions` from an eval — which reads exactly like a mistyped model id and
 * is really one account's privacy settings refusing a provider the other allows.
 * Nothing errored. The file that names the key was simply being ignored.
 *
 * So the precedence flipped, and this pins both halves of it, because both are
 * load-bearing and the failure mode of either is silence.
 *
 * `loadEnvLocal` memoises and snapshots the real environment at module load, so
 * these tests exercise the same **rule** against an injected environment rather
 * than importing it repeatedly and fighting the memo. The rule is the thing
 * that was wrong; a test that re-implemented it would prove nothing, so
 * `applyEnvFile` is exported from src/env.ts and used by both.
 */
import { describe, expect, it } from "vitest";
import { applyEnvFile } from "../src/env.js";

const FILE = `
# a comment
OPENROUTER_API_KEY=from-the-file
DATABASE_URL="quoted-value"
UNSET_ANYWHERE_ELSE=fresh
`;

describe("where a variable's value comes from", () => {
  it("prefers .env.local over what the shell exported", () => {
    /* The whole reason this file changed. A profile export and a deliberate
       `FOO=x npm run dev` are indistinguishable to a child process, so "the
       environment wins" cannot mean "the person meant it". */
    const env: Record<string, string | undefined> = { OPENROUTER_API_KEY: "from-the-shell" };
    const inherited = { ...env };

    const shadowed = applyEnvFile(FILE, env, inherited);

    expect(env.OPENROUTER_API_KEY).toBe("from-the-file");
    // And it says so, by name — never by value, because these are secrets.
    expect(shadowed).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("leaves alone a value this process set for itself", () => {
    /* tests/explain.test.ts and tests/converse-stop.test.ts both set
       `OPENROUTER_API_KEY = "test-key"` and then call code that loads env.ts.
       Without this rule the real key would be put back underneath them, and a
       test that is supposed to make no model call could make a real one. */
    const inherited = { OPENROUTER_API_KEY: "from-the-shell" };
    const env: Record<string, string | undefined> = { OPENROUTER_API_KEY: "test-key" };

    const shadowed = applyEnvFile(FILE, env, inherited);

    expect(env.OPENROUTER_API_KEY).toBe("test-key");
    expect(shadowed).toEqual([]);
  });

  it("fills in a variable the environment does not have at all", () => {
    const env: Record<string, string | undefined> = {};
    applyEnvFile(FILE, env, {});
    expect(env.UNSET_ANYWHERE_ELSE).toBe("fresh");
  });

  it("does not report a variable the shell and the file agree on", () => {
    // Nothing was shadowed, so nothing is worth a warning line.
    const inherited = { OPENROUTER_API_KEY: "from-the-file" };
    const env: Record<string, string | undefined> = { ...inherited };
    expect(applyEnvFile(FILE, env, inherited)).toEqual([]);
  });

  it("strips matching quotes and ignores comments", () => {
    const env: Record<string, string | undefined> = {};
    applyEnvFile(FILE, env, {});
    expect(env.DATABASE_URL).toBe("quoted-value");
    expect(env["# a comment"]).toBeUndefined();
  });

  it("treats an in-process value identical to the inherited one as inherited", () => {
    /* Harmless and worth pinning: we cannot tell "the process wrote the same
       string back" from "nobody touched it", so the file wins. Saying so here
       stops somebody reading it as a bug later. */
    const inherited = { OPENROUTER_API_KEY: "from-the-shell" };
    const env: Record<string, string | undefined> = { OPENROUTER_API_KEY: "from-the-shell" };
    applyEnvFile(FILE, env, inherited);
    expect(env.OPENROUTER_API_KEY).toBe("from-the-file");
  });
});
