/**
 * **The database and the bucket must be the same Supabase project.**
 *
 * Once a revision row holds a reference to a Storage object, the two halves of
 * "where this article's source document is" are chosen by different mechanisms:
 * `DATABASE_URL` picks the database, and the presence of a service key picks the
 * blob store (`src/store/blobs.ts`). Nothing checks they agree.
 *
 * So the dangling reference every version of docs/plans/raw-bytes-in-storage.md
 * has tried to make impossible arrives anyway, with nobody deleting anything:
 * put the object in project B, commit the reference in project A, and every
 * correctly-configured reader of A finds nothing. GPT Sol, 2026-08-27,
 * confidence 100%.
 *
 * Hosted Supabase writes the project ref into both strings — the pooler
 * username is `postgres.<ref>` and the API origin is `https://<ref>.supabase.co`
 * — so this is answerable at boot, before anybody's data is involved.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { projectMismatch } from "../src/store/blobs.js";

/** The pooler form: the ref is in the username. */
const REMOTE_DB = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
/** The direct form: plain `postgres`, and the ref is in the HOSTNAME. */
const DIRECT_DB = (ref: string) => `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;
const REMOTE_API = (ref: string) => `https://${ref}.supabase.co`;
/** This project's local stack, per `supabase/config.toml`. */
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54362/postgres";
const LOCAL_API = "http://127.0.0.1:54361";
/** The *other* app's local stack, on the default ports. Same laptop, same loopback. */
const OTHER_LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("pairing the database with the bucket", () => {
  it("is happy when both name the same project", () => {
    expect(projectMismatch(REMOTE_DB("abcdefghijklmnopqrst"), REMOTE_API("abcdefghijklmnopqrst"))).toBeNull();
  });

  it("refuses two different projects", () => {
    const why = projectMismatch(REMOTE_DB("aaaaaaaaaaaaaaaaaaaa"), REMOTE_API("bbbbbbbbbbbbbbbbbbbb"));
    expect(why).toBeTruthy();
    /* The message must name both, because the whole difficulty of this
       misconfiguration is that each half looks right on its own. */
    expect(why).toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(why).toContain("bbbbbbbbbbbbbbbbbbbb");
  });

  it("is happy when both are the local container", () => {
    expect(projectMismatch(LOCAL_DB, LOCAL_API)).toBeNull();
  });

  it("refuses a remote database with a local bucket", () => {
    /* The likeliest way to get here by accident: a `.env.local` pointed at
       production with the container still running underneath it. */
    expect(projectMismatch(REMOTE_DB("abcdefghijklmnopqrst"), LOCAL_API)).toBeTruthy();
  });

  it("refuses a local database with a remote bucket", () => {
    expect(projectMismatch(LOCAL_DB, REMOTE_API("abcdefghijklmnopqrst"))).toBeTruthy();
  });

  it("says nothing when there is no blob store configured", () => {
    /* Not this check's business. A missing service key means the filesystem
       adapter, which src/store/index.ts refuses separately in production. */
    expect(projectMismatch(REMOTE_DB("abcdefghijklmnopqrst"), undefined)).toBeNull();
    expect(projectMismatch(undefined, REMOTE_API("abcdefghijklmnopqrst"))).toBeNull();
  });

  it("refuses rather than shrugs when a string will not parse", () => {
    /* Fail closed, the same way `isLocalDatabaseUrl` does and for the same
       reason: "I cannot tell what this is" must never come out as "fine". */
    expect(projectMismatch("not a url", REMOTE_API("abcdefghijklmnopqrst"))).toBeTruthy();
    expect(projectMismatch(REMOTE_DB("abcdefghijklmnopqrst"), "not a url")).toBeTruthy();
  });

  it("is not fooled by a project ref sitting in the password", () => {
    /* The trap `isLocalDatabaseUrl` was written for: userinfo runs to the LAST
       `@`, so a naive match reads the wrong half of the string. */
    const sneaky = `postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:postgres.bbbbbbbbbbbbbbbbbbbb@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
    expect(projectMismatch(sneaky, REMOTE_API("aaaaaaaaaaaaaaaaaaaa"))).toBeNull();
    expect(projectMismatch(sneaky, REMOTE_API("bbbbbbbbbbbbbbbbbbbb"))).toBeTruthy();
  });
});

describe("the connection strings people actually paste", () => {
  /**
   * **A boot-time refusal that refuses a valid configuration is worse than the
   * hole it closes**, and the first version of this did exactly that.
   *
   * It read the project ref only out of the pooler username's
   * `postgres.<ref>`. But `docs/project/database.md` lists three hosts, and the
   * *direct* one — used for local admin work — is `db.<ref>.supabase.co` with
   * a plain `postgres` username. That would have come out as project "unknown"
   * and stopped the app booting against a perfectly good pair. GPT Sol,
   * reviewing the built code, 2026-08-27.
   */
  it("reads the ref from the hostname when the username has none", () => {
    expect(projectMismatch(DIRECT_DB("abcdefghijklmnopqrst"), REMOTE_API("abcdefghijklmnopqrst"))).toBeNull();
  });

  it("still catches a mismatch in the direct form", () => {
    expect(projectMismatch(DIRECT_DB("aaaaaaaaaaaaaaaaaaaa"), REMOTE_API("bbbbbbbbbbbbbbbbbbbb"))).toBeTruthy();
  });

  it("does not mind which form each side uses", () => {
    expect(projectMismatch(DIRECT_DB("abcdefghijklmnopqrst"), REMOTE_API("abcdefghijklmnopqrst"))).toBeNull();
    expect(projectMismatch(REMOTE_DB("abcdefghijklmnopqrst"), REMOTE_API("abcdefghijklmnopqrst"))).toBeNull();
  });
});

describe("two local stacks on one laptop", () => {
  /**
   * **"Both are loopback" is not "both are the same stack".** Greg runs the
   * previous app's Supabase container beside this one — that is precisely why
   * this project moved to a `5436x` port block
   * (`docs/project/supabase-local.md`). So a `.env.local` naming the old app's
   * database and this app's Storage is a real split brain on one machine, and
   * comparing hostnames alone calls it fine.
   *
   * The ports are the only identity a local stack has, so they are the check.
   */
  it("accepts this project's own pair", () => {
    expect(projectMismatch(LOCAL_DB, LOCAL_API)).toBeNull();
  });

  it("refuses the other app's database beside this app's Storage", () => {
    const why = projectMismatch(OTHER_LOCAL_DB, LOCAL_API);
    expect(why).toBeTruthy();
    expect(why).toContain("54322");
  });
});

describe("the local ports this check believes in", () => {
  /**
   * The two numbers live in `src/store/blobs.ts` as constants and in
   * `supabase/config.toml` as configuration, and a boot refusal is what happens
   * when they disagree. So they are pinned against each other here: moving the
   * port block fails this test rather than refusing somebody's boot with a
   * message about ports they have never heard of.
   */
  const config = readFileSync(
    path.join(import.meta.dirname, "..", "supabase", "config.toml"),
    "utf8",
  );
  const portUnder = (section: string): string => {
    const from = config.indexOf(`[${section}]`);
    expect(from, `no [${section}] in supabase/config.toml`).toBeGreaterThan(-1);
    return /^port = (\d+)$/m.exec(config.slice(from))?.[1] ?? "";
  };

  it("matches supabase/config.toml", () => {
    /* Driven through the function rather than by exporting the constants: what
       matters is that the pair the code accepts is the pair the config
       declares, not that two literals are equal. */
    const db = `postgresql://postgres:postgres@127.0.0.1:${portUnder("db")}/postgres`;
    const api = `http://127.0.0.1:${portUnder("api")}`;
    expect(projectMismatch(db, api)).toBeNull();
  });
});
