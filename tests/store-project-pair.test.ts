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

import { projectMismatch } from "../src/store/blobs.js";

const REMOTE_DB = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
const REMOTE_API = (ref: string) => `https://${ref}.supabase.co`;
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_API = "http://127.0.0.1:54321";

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
