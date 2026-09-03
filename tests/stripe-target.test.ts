/**
 * Where `stripe:setup` and `stripe:check` actually point — scripts/stripe-target.ts.
 *
 * ## Why this test exists
 *
 * On 2026-09-03, going live, the recipe for pointing these two at production was
 *
 *     DATABASE_URL=<production> STRIPE_SECRET_KEY=sk_live_… npm run stripe:setup --apply
 *
 * and it does not work, because both scripts call `loadEnvLocal()` and
 * `.env.local` beats the shell by design. The Stripe half fails loudly. The
 * database half would have created live prices and written their ids to the
 * laptop, printing success — docs/reusable/silent-success.md, and the third time
 * this exact shape has cost a day here.
 *
 * **Every assertion below is of a refusal**, which is the thing that cannot be
 * spot-checked by running it: a guard that fails to fire looks exactly like a
 * clean run, and you find out when a customer cannot pay.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { productionValues, refuseUnknownArgs, targetLine } from "../scripts/stripe-target.js";

const GOOD = {
  file: "/repo/.env.prod",
  values: {
    DATABASE_URL: "postgresql://spideryarn_app.abc:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    STRIPE_SECRET_KEY: "sk_live_pretend",
  },
};

describe("what --prod refuses", () => {
  it("refuses when there is no .env.prod at all", () => {
    /* The dangerous fallback: carry on with whatever `.env.local` left in
       place, which is the sandbox key and the laptop's Postgres. */
    expect(() => productionValues(null)).toThrow(/needs a \.env\.prod/);
  });

  const withUrl = (url: string) => ({ file: "/repo/.env.prod", values: { ...GOOD.values, DATABASE_URL: url } });

  it("refuses a .env.prod that points at the local stack", () => {
    expect(() => productionValues(withUrl("postgresql://postgres:pw@127.0.0.1:54362/postgres"))).toThrow(
      /not a production database/,
    );
  });

  /**
   * **The fail-open case, and the reason this guard was rewritten.**
   *
   * The first version asked `isLocalDatabaseUrl()` and refused when it said
   * yes. That helper fails *closed for its own question* — it answers `false`
   * for anything it cannot classify, which is the safe answer for its own
   * callers and the **dangerous** one here. Every row below was accepted as
   * production by that version. GPT Sol, 2026-09-03.
   */
  it.each([
    // `pg` honours host/hostaddr as query parameters and connects to loopback.
    ["a host override to loopback", "postgres://u:p@remote.example.com:6543/db?host=127.0.0.1"],
    ["a hostaddr override", "postgres://u:p@remote.example.com:6543/db?hostaddr=127.0.0.1"],
    ["something that will not parse at all", "not a url"],
    ["IPv6 loopback", "postgresql://u:p@[::1]:5432/postgres"],
    ["the all-interfaces address", "postgresql://u:p@0.0.0.0:5432/postgres"],
    ["a 127.x address that is not 127.0.0.1", "postgresql://u:p@127.1.2.3:5432/postgres"],
    ["localhost", "postgresql://u:p@localhost:54362/postgres"],
    ["any ordinary remote host that is not Supabase", "postgresql://u:p@db.someoneelse.com:5432/x"],
  ])("refuses %s", (_label, url) => {
    expect(() => productionValues(withUrl(url))).toThrow(/not a production database/);
  });

  /**
   * **The second round of bypasses, every one of them measured.**
   *
   * The version after the one above refused a *list* of local spellings read
   * off `new URL(url).hostname`. `pg` does not use that hostname — it parses
   * with `pg-connection-string`, which percent-decodes and resolves overrides —
   * so each row here connected somewhere local while the guard said production.
   * GPT Sol, 2026-09-03, second review. The fix was to stop listing what is
   * local and require what is production, using the same parser `pg` uses.
   */
  it.each([
    ["a percent-encoded localhost", "postgresql://postgres.abc:p@local%68ost:5432/postgres"],
    ["no authority at all, which pg reads as a local socket", "postgresql:///postgres"],
    ["an uppercase LOCALHOST", "postgresql://u:p@LOCALHOST:5432/db"],
    ["a trailing-dot LOCALHOST", "postgresql://u:p@LOCALHOST.:5432/db"],
    ["a percent-encoded IPv4 loopback", "postgresql://u:p@127%2e0%2e0%2e1:5432/db"],
    ["decimal-form 127.0.0.1", "postgresql://u:p@2130706433:5432/db"],
    ["hex-form 127.0.0.1", "postgresql://u:p@0x7f000001:5432/db"],
    ["a unix socket", "socket:/tmp/.s.PGSQL.5432"],
    ["a host that merely ends with the Supabase one", "postgres://u:p@aws-0-eu-west-2.pooler.supabase.com.attacker.net:6543/db"],
  ])("refuses %s", (_label, url) => {
    expect(() => productionValues(withUrl(url))).toThrow(/not a production database/);
  });

  it("refuses a real Supabase host that turns TLS off", () => {
    /* `sslmode=disable` in the string overrides the `ssl` object src/db/ssl.ts
       builds, so this would talk to the pooler in clear text. */
    const url = "postgresql://spideryarn_app.abc:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=disable";
    expect(() => productionValues(withUrl(url))).toThrow(/disables TLS/);
  });

  it("accepts a project's direct host as well as a pooler", () => {
    /* Both are real production spellings; refusing one would send somebody
       back to naming the target on the command line. */
    const direct = "postgresql://postgres:p@db.alschkahzfagtppxspfq.supabase.co:5432/postgres";
    expect(() => productionValues(withUrl(direct))).not.toThrow();
  });

  it("refuses a database that disagrees with SUPABASE_URL in the same file", () => {
    /* Both halves look right on their own; the pair is what is wrong. Reuses
       the check src/store/blobs.ts already makes at boot. */
    const mixed = {
      file: "/repo/.env.prod",
      values: { ...GOOD.values, SUPABASE_URL: "https://someotherproject.supabase.co" },
    };
    expect(() => productionValues(mixed)).toThrow(/disagrees with itself/);
  });

  it("accepts a matched database and SUPABASE_URL pair", () => {
    const matched = {
      file: "/repo/.env.prod",
      values: { ...GOOD.values, SUPABASE_URL: "https://abc.supabase.co" },
    };
    expect(productionValues(matched)).toMatchObject(GOOD.values);
  });

  it("does not require SUPABASE_URL, which these scripts have no use for", () => {
    /* Corroboration when it is there, not a new way for --prod to fail. */
    expect(productionValues(GOOD)).toMatchObject(GOOD.values);
  });

  it("names the file it read, because in a worktree there are two candidates", () => {
    expect(() => productionValues({ file: "/primary/.env.prod", values: {} })).toThrow(
      /\/primary\/\.env\.prod/,
    );
  });

  it.each(["DATABASE_URL", "STRIPE_SECRET_KEY"])("refuses when %s is missing", (name) => {
    const values = { ...GOOD.values } as Record<string, string>;
    delete values[name];
    expect(() => productionValues({ ...GOOD, values })).toThrow(new RegExp(`no ${name}`));
  });

  it("refuses an empty value, not just an absent key", () => {
    /* `.env.prod` is hand-edited, and `STRIPE_SECRET_KEY=` is what a
       half-finished paste leaves behind. An empty string is present-but-useless
       and a `in` check would wave it through. */
    const values = { ...GOOD.values, STRIPE_SECRET_KEY: "" };
    expect(() => productionValues({ ...GOOD, values })).toThrow(/no STRIPE_SECRET_KEY/);
  });

  it("accepts a real production pair and hands back both values", () => {
    /* The other half: a guard that refuses everything passes every test above
       and is just as broken. */
    expect(productionValues(GOOD)).toMatchObject(GOOD.values);
  });
});

describe("the line you are meant to read before it does anything", () => {
  /* `targetLine` reads the real `process.env`, because that is what the scripts
     hand it. Put back whatever this worker started with, so a peer test file
     sharing the process does not inherit `db.example.com`. */
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  });

  it("shows the host, the port and the user, and never the password", () => {
    process.env.DATABASE_URL = "postgresql://spideryarn_app.abc:hunter2@db.example.com:6543/postgres";
    const line = targetLine();
    expect(line).toContain("db.example.com:6543");
    expect(line).toContain("spideryarn_app.abc");
    expect(line).not.toContain("hunter2");
  });

  it("hides a password carrying an @, which is what a regex redactor leaks", () => {
    /* Userinfo runs to the LAST `@`, so `p@ss` splits a naive redactor in the
       wrong place and prints the tail of the password. src/db/ssl.ts. */
    process.env.DATABASE_URL = "postgresql://user:p@ss@db.example.com:6543/postgres";
    expect(targetLine()).not.toContain("ss@db.example.com");
  });

  it("says so rather than printing the string when the URL will not parse", () => {
    process.env.DATABASE_URL = "not a url at all";
    expect(targetLine()).toContain("not a parsable URL");
    expect(targetLine()).not.toContain("not a url at all");
  });

  it("says so when there is no DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(targetLine()).toContain("no DATABASE_URL");
  });

  it("hides a password given in the query string, which `pg` also accepts", () => {
    process.env.DATABASE_URL = "postgresql://user@db.example.com:6543/postgres?password=hunter2";
    expect(targetLine()).not.toContain("hunter2");
  });
});

describe("the refusal messages themselves", () => {
  it("never carry the password out of the URL they are complaining about", () => {
    /* The guard fires on a bad URL and prints it. A refusal is exactly when
       somebody copies the line into a chat window, so the redaction has to hold
       on the failure path too — the earlier tests would all pass if the raw
       string were interpolated here. docs/reusable/silent-success.md, sideways. */
    const leaky = {
      file: "/repo/.env.prod",
      values: {
        DATABASE_URL: "postgresql://postgres:hunter2@127.0.0.1:54362/postgres",
        STRIPE_SECRET_KEY: "sk_live_pretend",
      },
    };
    expect(() => productionValues(leaky)).toThrow(/not a production database/);
    try {
      productionValues(leaky);
    } catch (err) {
      expect((err as Error).message).not.toContain("hunter2");
    }
  });

  it("never carry the Stripe key", () => {
    const noDb = { file: "/repo/.env.prod", values: { STRIPE_SECRET_KEY: "sk_live_secret_tail" } };
    try {
      productionValues(noDb);
    } catch (err) {
      expect((err as Error).message).not.toContain("sk_live_secret_tail");
    }
  });
});

describe("a flag that was not understood", () => {
  /* `argv.includes("--prod")` cannot tell a typo from an absence, and the
     absence is the sandbox — so a mistyped flag applies to the wrong target
     while looking like it worked. GPT Sol, 2026-09-03. */
  it("refuses --prodd rather than quietly meaning the sandbox", () => {
    expect(() => refuseUnknownArgs(["node", "s.ts", "--apply", "--prodd"], ["--apply", "--prod"])).toThrow(
      /--prodd/,
    );
  });

  it("accepts the flags the script declares, in any order", () => {
    expect(() => refuseUnknownArgs(["node", "s.ts", "--prod", "--apply"], ["--apply", "--prod"])).not.toThrow();
  });

  it("accepts no flags at all", () => {
    expect(() => refuseUnknownArgs(["node", "s.ts"], ["--apply", "--prod"])).not.toThrow();
  });

  it("refuses a flag one script has and the other does not", () => {
    /* stripe-check takes no --apply; accepting it silently would suggest it
       writes. */
    expect(() => refuseUnknownArgs(["node", "s.ts", "--apply"], ["--prod"])).toThrow(/--apply/);
  });
});
