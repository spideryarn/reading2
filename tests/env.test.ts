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
import { applyEnvFile, chooseTargetUrl, parseEnvFile } from "../src/env.js";

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

/**
 * **Which database a `db:*` script is about to touch** — src/env.ts §
 * `resolveTargetUrl`.
 *
 * Six scripts read `DATABASE_URL` and, until 2026-09-03, split into two camps
 * that had never been written down as a choice: four captured the shell's value
 * before `loadEnvLocal()` could bury it, and two did not. The rule is now one
 * required argument, so the seventh script has to decide rather than inherit
 * whichever sibling it was copied from.
 *
 * Driven through `chooseTargetUrl` rather than `resolveTargetUrl` for the same
 * reason `applyEnvFile` is above it: the wrapper reads the real snapshot taken
 * at module load and the real `process.env`, so a test through it would be a
 * test of this machine.
 */
describe("which database a script targets", () => {
  const shell = { DATABASE_URL: "postgres://named-on-the-command-line" };
  const afterLoad = { DATABASE_URL: "postgres://from-env-local" };

  it("lets the shell win where the target is an argument", () => {
    /* db:migrate, db:check, db:corpus-readiness, db:repair-migration-ledger.
       The accident this rule exists for: on 2026-08-27 `.env.local` buried a
       `DATABASE_URL=…` meant for the remote, the remote check saw 127.0.0.1,
       and the migrator applied the migrations to the laptop while printing
       `✓ migrations applied`. */
    expect(chooseTargetUrl(true, shell, afterLoad)).toBe("postgres://named-on-the-command-line");
  });

  it("lets the file win where there is no remote mode to name", () => {
    /* db:seed-dev and db:reown. Neither has an --allow-remote, and both settle
       identity against `supabase status` rather than the connection string, so
       the shell winning would change nothing but the failure message — at the
       cost of reopening the ~/.zshrc case the precedence rule above exists to
       close. */
    expect(chooseTargetUrl(false, shell, afterLoad)).toBe("postgres://from-env-local");
  });

  it("falls through to the file when the shell exported nothing", () => {
    /* `??` and not `||`, and not a bare read: resolving to undefined here would
       make a script print "DATABASE_URL is not set" beside a perfectly good
       one, which is the ordinary case on every laptop. */
    expect(chooseTargetUrl(true, {}, afterLoad)).toBe("postgres://from-env-local");
  });

  it("is undefined when nothing anywhere sets it, under either rule", () => {
    /* The scripts each print their own message for this; what matters is that
       neither rule invents a value. */
    expect(chooseTargetUrl(true, {}, {})).toBeUndefined();
    expect(chooseTargetUrl(false, {}, {})).toBeUndefined();
  });

  it("does not read the shell's value out of the post-load environment", () => {
    /* **The ordering trap, gone rather than documented.** The four copies this
       replaced each depended on running their capture above `loadEnvLocal()`;
       an import reordered above them turned shell-wins into file-wins with
       nothing to show for it. Here the shell's value comes from the snapshot
       taken before any of our code ran, so a caller that has *already* loaded
       `.env.local` gets the same answer as one that has not. */
    const alreadyLoaded = { DATABASE_URL: "postgres://from-env-local" };
    expect(chooseTargetUrl(true, shell, alreadyLoaded)).toBe(
      "postgres://named-on-the-command-line",
    );
  });
});

/**
 * `parseEnvFile` — one parser for `.env.local` and `.env.prod`.
 *
 * Extracted out of `applyEnvFile` on 2026-09-03, when `.env.prod` acquired a
 * second reader. Until then `scripts/check-owner-identity.ts` matched
 * `^NAME=(.*)$` per name against the same file: a second parser, and a weaker
 * one. Both files are hand-edited, so the spellings the weak one missed are
 * spellings that can appear tomorrow — and two readers disagreeing about what
 * production is would be found out by pointing something at the wrong one.
 */
describe("reading an env file", () => {
  it("takes the value off a line, quotes and all", () => {
    expect(parseEnvFile('A=plain\nB="double"\nC=\'single\'\n')).toEqual({
      A: "plain",
      B: "double",
      C: "single",
    });
  });

  it("handles the two spellings the old per-name regex missed", () => {
    /* `export FOO=…`, which is what a file also meant to be `source`d looks
       like, and a single-quoted value. The old reader returned `undefined` for
       the first and kept the quotes on the second — which as a Stripe key is a
       key with literal apostrophes round it. */
    expect(parseEnvFile("export STRIPE_SECRET_KEY='sk_live_x'\n")).toEqual({
      STRIPE_SECRET_KEY: "sk_live_x",
    });
  });

  it("ignores comments, including one that names a variable", () => {
    expect(parseEnvFile("# DATABASE_URL=commented-out\nDATABASE_URL=real\n")).toEqual({
      DATABASE_URL: "real",
    });
  });

  it("lets a later line win, as `source` would", () => {
    expect(parseEnvFile("A=first\nA=second\n")).toEqual({ A: "second" });
  });

  it("lets a later line win **through `applyEnvFile`**, which is where it changed", () => {
    /* The seam that matters, and the one a `parseEnvFile`-only test would miss.
       The old loop made the FIRST line win, and not on purpose: having assigned
       it, the next iteration saw `current !== inherited[name]`, read that as
       "this process set it itself", and skipped — the shell-precedence rule
       silently deciding precedence *inside* the file. Measured both ways before
       the change was kept. GPT Sol caught that the extraction was described as
       a pure refactor and was not. */
    const env: Record<string, string | undefined> = {};
    applyEnvFile("A=first\nA=second\n", env, {});
    expect(env.A).toBe("second");
  });

  it("still lets the file's last line win over an inherited value", () => {
    /* The two rules compose in the order you would hope: the file beats the
       shell, and within the file the last line beats the earlier one. */
    const inherited = { A: "from-the-shell" };
    const env: Record<string, string | undefined> = { ...inherited };
    expect(applyEnvFile("A=first\nA=second\n", env, inherited)).toEqual(["A"]);
    expect(env.A).toBe("second");
  });

  it("keeps an empty value rather than dropping the name", () => {
    /* `STRIPE_SECRET_KEY=` is what a half-finished paste leaves behind, and the
       caller's guard is what decides it is useless — scripts/stripe-target.ts.
       Dropping it here would have that guard say "absent" about a line
       somebody can see in the file. */
    expect(parseEnvFile("A=\n")).toEqual({ A: "" });
  });
});
