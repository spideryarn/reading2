/**
 * What `gjd-remote push-env` is allowed to put on the remote box.
 *
 * The box is shared by many autonomous agents running as one user with
 * passwordless sudo, so anything that reaches it reaches all of them. Two keys
 * in Greg's real .env.local must never travel: HETZNER_CLOUD_API_TOKEN can
 * delete the box itself, and SUPABASE_ACCESS_TOKEN is a management PAT that can
 * delete the production Supabase project.
 *
 * These run against fixtures, never against the real .env.local — a test that
 * reads Greg's file would pass or fail for reasons that have nothing to do with
 * the code. See scripts/gjd-remote-env.ts and
 * docs/plans/remote-box-dev-environment.md.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  assertPushableName,
  buildEnvPayload,
  diffKeys,
  isPostgresUrl,
  localityVerdict,
  parseEnv,
  serialiseValue,
  SPIDERYARN_ALLOWANCE,
} from "../scripts/gjd-remote-env.js";

const FIXTURE = [
  "# a comment",
  "OPENROUTER_API_KEY=sk-or-fixture",
  "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54362/postgres",
  "",
  "# these two must never leave the laptop",
  "HETZNER_CLOUD_API_TOKEN=hetzner-fixture-token",
  "SUPABASE_ACCESS_TOKEN=sbp-fixture-token",
  "export SOME_FUTURE_SECRET=whatever-greg-adds-next",
].join("\n");

describe("the allowlist", () => {
  it("keeps the two production credentials off the box", () => {
    const { text, pushed, skipped } = buildEnvPayload(FIXTURE, SPIDERYARN_ALLOWANCE);
    for (const forbidden of ["HETZNER_CLOUD_API_TOKEN", "SUPABASE_ACCESS_TOKEN"]) {
      expect(ALLOWLIST).not.toContain(forbidden);
      expect(pushed.has(forbidden)).toBe(false);
      expect(skipped).toContain(forbidden);
      // The key name and its value are both absent from the bytes that travel.
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain("hetzner-fixture-token");
    expect(text).not.toContain("sbp-fixture-token");
  });

  it("skips a key nobody has thought about yet, rather than sending it", () => {
    // The point of an allowlist over a blocklist: the next secret added to
    // .env.local is withheld by default, and named so the omission is visible.
    const { pushed, skipped, text } = buildEnvPayload(FIXTURE, SPIDERYARN_ALLOWANCE);
    expect(pushed.has("SOME_FUTURE_SECRET")).toBe(false);
    expect(skipped).toContain("SOME_FUTURE_SECRET");
    expect(text).not.toContain("whatever-greg-adds-next");
  });

  it("sends the allowlisted keys, and reports the ones it could not find", () => {
    const { pushed, missing } = buildEnvPayload(FIXTURE, SPIDERYARN_ALLOWANCE);
    expect([...pushed.keys()]).toEqual(["OPENROUTER_API_KEY", "DATABASE_URL"]);
    expect(pushed.get("DATABASE_URL")).toContain("54362");
    expect(missing).toContain("SUPABASE_URL");
    expect(missing).not.toContain("DATABASE_URL");
  });

  it("refuses to write a file with nothing in it", () => {
    // Guards the shape where a mis-parsed file would quietly replace a good
    // remote .env.local with a banner and no keys.
    const { pushed } = buildEnvPayload("HETZNER_CLOUD_API_TOKEN=x\n", SPIDERYARN_ALLOWANCE);
    expect(pushed.size).toBe(0);
  });
});

describe("the filename fence", () => {
  it("accepts only .env.local", () => {
    expect(assertPushableName(".env.local")).toBeUndefined();
    for (const name of [".env.prod", ".env.production", ".env", "env.local", ".env.local.bak"]) {
      expect(assertPushableName(name)).toMatch(/refusing to push/);
    }
  });
});

describe("the round trip", () => {
  it("survives serialisation and re-parsing, which is what the push verifies", () => {
    // The push writes these bytes, reads the file back off the box and compares
    // values. An asymmetric escape here would surface there as a phantom
    // "changed" key, so this is the same seam tested without a server.
    const awkward = [
      `PLAIN=simple`,
      `SPACED="two words"`,
      `QUOTED="he said \\"hi\\""`,
      `MULTI="line one`,
      `line two"`,
      `AFTER=still-read`,
    ].join("\n");
    const parsed = parseEnv(awkward);
    expect(parsed.get("SPACED")).toBe("two words");
    expect(parsed.get("QUOTED")).toBe('he said "hi"');
    expect(parsed.get("MULTI")).toBe("line one\nline two");
    // The continuation line must not be mistaken for a key of its own.
    expect(parsed.has("line")).toBe(false);
    expect(parsed.get("AFTER")).toBe("still-read");

    for (const [key, value] of parsed) {
      const round = parseEnv(`${key}=${serialiseValue(value)}`);
      expect(round.get(key)).toBe(value);
    }
  });

  it("ignores comments and blank lines", () => {
    expect([...parseEnv("# nope\n\n  # also nope\nA=1\n").keys()]).toEqual(["A"]);
  });
});

describe("the change report", () => {
  it("names keys, and only keys", () => {
    const before = new Map([["A", "1"], ["B", "2"], ["GONE", "3"]]);
    const after = new Map([["A", "1"], ["B", "changed"], ["NEW", "4"]]);
    expect(diffKeys(before, after)).toEqual({
      added: ["NEW"],
      removed: ["GONE"],
      changed: ["B"],
      unchanged: 1,
    });
  });
});

/**
 * The banner `buildEnvPayload` writes says "production credentials are
 * deliberately absent". Until 2026-08-31 nothing made that true: the allowlist
 * matches KEY NAMES, and `DATABASE_URL`, `SUPABASE_URL` and `VITE_SUPABASE_URL`
 * are the same names whether they point at the throwaway container or at the
 * one production database. Point `.env.local` at production for an afternoon,
 * run `push-env`, and the box silently gets production — with the file it just
 * wrote claiming otherwise. Found by GPT Sol, 2026-08-31.
 */
describe("the local-only keys", () => {
  const localEnv = [
    "OPENROUTER_API_KEY=sk-test",
    "DATABASE_URL=postgres://postgres:pw@127.0.0.1:54362/postgres",
    "SUPABASE_URL=http://127.0.0.1:54361",
    "VITE_SUPABASE_URL=http://127.0.0.1:54361",
  ].join("\n");

  it("pushes when every one of them is loopback", () => {
    const got = buildEnvPayload(localEnv, SPIDERYARN_ALLOWANCE);
    expect(got.problems).toEqual([]);
    expect(got.pushed.has("DATABASE_URL")).toBe(true);
  });

  it.each(["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"])(
    "refuses when %s points somewhere else",
    (key) => {
      const remote = localEnv.replace(
        new RegExp(`^${key}=.*$`, "m"),
        `${key}=postgres://u:p@db.prod.example.com:5432/postgres`,
      );
      const got = buildEnvPayload(remote, SPIDERYARN_ALLOWANCE);
      expect(got.problems.join(" ")).toContain(key);
      // The refusal must not carry the value it is refusing.
      expect(got.problems.join(" ")).not.toContain("db.prod.example.com");
    },
  );

  // The exact shape that defeated a regex version of this check elsewhere in
  // the repo: userinfo runs to the LAST @, so the host here is the remote one.
  it("is not fooled by a loopback address sitting in the password", () => {
    const sneaky = localEnv.replace(
      /^DATABASE_URL=.*$/m,
      "DATABASE_URL=postgres://user:p@localhost:5432@remote.example.com/db",
    );
    expect(buildEnvPayload(sneaky, SPIDERYARN_ALLOWANCE).problems.join(" ")).toContain("DATABASE_URL");
  });

  // A key that is absent is a different complaint (`missing`), not this one.
  it("does not complain about a key that is not there at all", () => {
    const without = localEnv.replace(/^SUPABASE_URL=.*$/m, "");
    expect(buildEnvPayload(without, SPIDERYARN_ALLOWANCE).problems.join(" ")).not.toContain("SUPABASE_URL");
  });
});

/**
 * Loopback URLs are not the whole story: a production `SUPABASE_SERVICE_ROLE_KEY`
 * would sail past a URL check and land on a box shared by autonomous agents.
 * The local stack's keys are distinguishable without any secret changing hands —
 * they are JWTs issued by `supabase-demo` and carry no project `ref`, where a
 * hosted project's carry `iss: supabase` and its ref. Second finding by GPT Sol
 * on the same banner, 2026-08-31.
 */
describe("Supabase keys that are not the local stack's", () => {
  const jwt = (payload: Record<string, unknown>) =>
    ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

  const base = [
    "DATABASE_URL=postgres://postgres:pw@127.0.0.1:54362/postgres",
    "SUPABASE_URL=http://127.0.0.1:54361",
    "VITE_SUPABASE_URL=http://127.0.0.1:54361",
  ];
  const withKey = (v: string) => [...base, `SUPABASE_SERVICE_ROLE_KEY=${v}`].join("\n");

  it("accepts the local stack's own service-role key", () => {
    expect(buildEnvPayload(withKey(jwt({ iss: "supabase-demo", role: "service_role" })), SPIDERYARN_ALLOWANCE).problems).toEqual([]);
  });

  it("refuses a hosted project's service-role key even beside loopback URLs", () => {
    const got = buildEnvPayload(withKey(jwt({ iss: "supabase", role: "service_role", ref: "abcdefghijklm" })), SPIDERYARN_ALLOWANCE);
    expect(got.problems.join(" ")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    // Never the value, and never the project it belongs to.
    expect(got.problems.join(" ")).not.toContain("abcdefghijklm");
  });

  it("leaves values that are not Supabase JWTs alone", () => {
    const env = [...base, "OPENROUTER_API_KEY=sk-or-v1-not-a-jwt", "CODEX_API_KEY=plain"].join("\n");
    expect(buildEnvPayload(env, SPIDERYARN_ALLOWANCE).problems).toEqual([]);
  });

  // Fail closed: a JWT we cannot read is not evidence that it is the local one.
  it("refuses a Supabase-shaped key whose payload will not decode", () => {
    const got = buildEnvPayload(withKey("eyJhbGciOiJIUzI1NiJ9.@@@notbase64@@@.sig"), SPIDERYARN_ALLOWANCE);
    expect(got.problems.join(" ")).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

/**
 * Stripe keys carry their mode in the prefix — `sk_test_…` vs `sk_live_…` — so
 * the same shape-over-name rule as the Supabase check applies: the box may hold
 * the test key (Greg's call, 2026-09-02, for the payments work in
 * docs/plans/260902i-stripe-payments-and-subscription-tiers.md), and a
 * live-mode secret must never travel to a machine shared by autonomous agents,
 * whatever variable name it is sitting under.
 */
describe("Stripe keys", () => {
  const base = [
    "DATABASE_URL=postgres://postgres:pw@127.0.0.1:54362/postgres",
    "SUPABASE_URL=http://127.0.0.1:54361",
    "VITE_SUPABASE_URL=http://127.0.0.1:54361",
  ];

  it("pushes the test-mode secret key", () => {
    const env = [...base, "STRIPE_SECRET_KEY=sk_test_fixture123"].join("\n");
    const got = buildEnvPayload(env, SPIDERYARN_ALLOWANCE);
    expect(got.problems).toEqual([]);
    expect(got.pushed.get("STRIPE_SECRET_KEY")).toBe("sk_test_fixture123");
  });

  it.each(["sk_live_fixture123", "rk_live_fixture123"])(
    "refuses a live-mode secret (%s) even on the allowlisted name",
    (value) => {
      const env = [...base, `STRIPE_SECRET_KEY=${value}`].join("\n");
      const got = buildEnvPayload(env, SPIDERYARN_ALLOWANCE);
      expect(got.problems.join(" ")).toContain("STRIPE_SECRET_KEY");
      // The refusal names the key, never the value.
      expect(got.problems.join(" ")).not.toContain("fixture123");
    },
  );

  it("catches a live-mode secret hiding under a name the rule never anticipated", () => {
    // Shape over name, like the Supabase-JWT check: an allowlisted key added
    // later under any name is covered the day it is added.
    const env = [...base, "OPENROUTER_API_KEY=sk_live_fixture123"].join("\n");
    expect(buildEnvPayload(env, SPIDERYARN_ALLOWANCE).problems.join(" ")).toContain("OPENROUTER_API_KEY");
  });

  it("leaves ordinary non-Stripe values alone", () => {
    const env = [...base, "OPENROUTER_API_KEY=sk-or-v1-not-stripe"].join("\n");
    expect(buildEnvPayload(env, SPIDERYARN_ALLOWANCE).problems).toEqual([]);
  });
});

/**
 * **The allowance is a parameter now**, because `push-env` has two callers: this
 * repo's typed list, and a set of names the reader ticked off a checklist in a
 * repo that has no list at all (scripts/gjd-remote-envpolicy.ts).
 *
 * What has to stay true across that change: the list decides what travels and
 * what is skipped, the ORDER of the file follows the list rather than the
 * laptop's file, and the banner says which list it was — "only allowlisted keys
 * are here" is a false claim about a file built from a checklist.
 */
describe("an allowance other than Spideryarn's", () => {
  const other = [
    "FLASK_SECRET_KEY=fake-signing-secret",
    "OPENAI_API_KEY=sk-fake",
    "PUBLIC_SITE_URL=http://localhost:5173",
  ].join("\n");

  it("sends the names it was given and skips the rest", () => {
    const got = buildEnvPayload(other, { names: ["PUBLIC_SITE_URL", "OPENAI_API_KEY"], source: "you approved" });
    expect([...got.pushed.keys()]).toEqual(["PUBLIC_SITE_URL", "OPENAI_API_KEY"]);
    expect(got.skipped).toEqual(["FLASK_SECRET_KEY"]);
    expect(got.text).not.toContain("fake-signing-secret");
    expect(got.problems).toEqual([]);
  });

  /**
   * **The mutation this kills is `ALLOWLIST` appearing anywhere in
   * `buildEnvPayload`** — the loop reading it, the `Set` built from it, a
   * concatenation with it. `OPENROUTER_API_KEY` is on Spideryarn's list and not
   * on this allowance, so any of those sends it.
   *
   * It is NOT the `allowance.names ?? ALLOWLIST` its name used to claim, and
   * that claim was wrong in a way worth writing down: `EnvAllowance.names` is
   * `readonly string[]`, so there is no value a caller can pass that makes the
   * `??` take its right-hand branch, and no test can ever redden it. The type
   * is the guarantee there; this test is the guarantee for the rest. GPT Sol's
   * Stage 4 finding 4, which asked for a stronger test and got a truer name.
   */
  it("sends only the names it was given, never this repo's allowlist", () => {
    const env = `${other}\nOPENROUTER_API_KEY=sk-or-fake`;
    const got = buildEnvPayload(env, { names: ["OPENAI_API_KEY"], source: "you approved" });
    expect([...got.pushed.keys()]).toEqual(["OPENAI_API_KEY"]);
    expect(got.text).not.toContain("sk-or-fake");
  });

  it("says in the banner which list the file was built from", () => {
    const got = buildEnvPayload(other, { names: ["OPENAI_API_KEY"], source: "you approved for gregdetre/gjdutils" });
    expect(got.text).toContain("you approved for gregdetre/gjdutils");
    expect(got.text).not.toContain("allowlist in scripts/gjd-remote-env.ts");
    // And the typed path still says its own thing.
    expect(buildEnvPayload(other, SPIDERYARN_ALLOWANCE).text).toContain("scripts/gjd-remote-env.ts");
  });
});

/**
 * **The hard guard by VALUE**, which is the half that works for a repo whose key
 * names nothing here has ever seen.
 *
 * `MUST_BE_LOCAL` is three names Spideryarn happens to use. hellozenno calls its
 * production database `DATABASE_URL_PROD`; a reader ticking through a checklist
 * could reasonably tick it, and a name list written in this repo will never
 * match it. So a value that PARSES as a postgres URL is subject to
 * `isLocalDatabaseUrl` whatever it is called — the plan's "hard guard by value",
 * 260902h § Decisions.
 */
describe("a database URL under a name no list has heard of", () => {
  const allowance = (names: readonly string[]) => ({ names, source: "you approved" });

  it("refuses a hosted postgres URL under an unfamiliar name", () => {
    const env = "DATABASE_URL_PROD=postgresql://u:p@db.example.supabase.co:5432/postgres";
    const got = buildEnvPayload(env, allowance(["DATABASE_URL_PROD"]));
    expect(got.problems.join(" ")).toContain("DATABASE_URL_PROD");
    // Never the host, never the credentials.
    expect(got.problems.join(" ")).not.toContain("db.example.supabase.co");
    expect(got.problems.join(" ")).not.toContain("u:p");
  });

  it("allows a loopback postgres URL under an unfamiliar name", () => {
    const env = "DATABASE_URL_TEST=postgres://u:p@127.0.0.1:5432/x";
    expect(buildEnvPayload(env, allowance(["DATABASE_URL_TEST"])).problems).toEqual([]);
  });

  it("fails closed on a postgres URL it cannot read", () => {
    // `isLocalDatabaseUrl` refuses a host override in the query string, because
    // libpq honours it and the authority then says nothing about where the
    // connection actually goes.
    const env = "SOME_DB=postgres://u:p@127.0.0.1:5432/x?host=remote.example.com";
    expect(buildEnvPayload(env, allowance(["SOME_DB"])).problems.join(" ")).toContain("SOME_DB");
  });

  it("leaves values that are not database URLs alone", () => {
    // The reason `localityVerdict` has three arms rather than a boolean:
    // `isLocalDatabaseUrl` says false for an API key too, and running every
    // value through it would report a whole .env.local as production.
    const env = ["OPENAI_API_KEY=sk-fake", "PORT=5173", "FEATURE_X=true", "SITE=https://example.com"].join("\n");
    const got = buildEnvPayload(env, allowance(["OPENAI_API_KEY", "PORT", "FEATURE_X", "SITE"]));
    expect(got.problems).toEqual([]);
    expect(got.pushed.size).toBe(4);
  });

  it("is one rule, so the checklist and the payload cannot disagree", () => {
    // The checklist greys a row out on `localityVerdict`; the payload refuses on
    // it. Two spellings of "local" is how a row gets ticked and then refused
    // after the reader has answered every question.
    expect(localityVerdict("DATABASE_URL_PROD", "postgres://u:p@db.example.com:5432/x")).toBe("not-local");
    expect(localityVerdict("DATABASE_URL_PROD", "postgres://u:p@127.0.0.1:5432/x")).toBe("local");
    expect(localityVerdict("SUPABASE_URL", "https://abc.supabase.co")).toBe("not-local");
    expect(localityVerdict("ANYTHING_ELSE", "sk-fake")).toBe("not-applicable");
    expect(isPostgresUrl("postgresql://u@127.0.0.1/x")).toBe(true);
    expect(isPostgresUrl("https://example.com")).toBe(false);
    expect(isPostgresUrl("not a url at all")).toBe(false);
  });
});
