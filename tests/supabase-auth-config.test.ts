/**
 * The one guard in scripts/supabase-auth-config.ts that can lose a whole
 * afternoon: is this URL the *remote* project?
 *
 * That script writes production auth settings — which providers are on, where
 * Supabase may send a reader after Google answers. Pointed at the local stack
 * it would appear to work perfectly: the container answers, GoTrue restarts,
 * the settings really change, and production stays exactly as broken as it was.
 * Nothing in the output would say so. docs/reusable/silent-success.md.
 *
 * And the two URLs are one variable name apart. `.env.local` has
 * `SUPABASE_URL=http://127.0.0.1:54361`, `.env.prod` has the `supabase.co` one,
 * and `loadEnvLocal()` deliberately makes the local file beat the shell
 * (src/env.ts explains why, and it is a good reason).
 *
 * So the cases below are the local stack and its neighbours, not a survey of
 * malformed strings. See docs/plans/260827i-google-sign-in-production.md.
 */

import { describe, expect, it } from "vitest";

import { refFromUrl } from "../scripts/supabase-auth-config.js";

describe("refFromUrl", () => {
  it("reads the ref out of a remote project URL", () => {
    expect(refFromUrl("https://alschkahzfagtppxspfq.supabase.co")).toBe("alschkahzfagtppxspfq");
    expect(refFromUrl("https://alschkahzfagtppxspfq.supabase.co/auth/v1/settings")).toBe(
      "alschkahzfagtppxspfq",
    );
  });

  it("refuses the local stack, which is the whole point", () => {
    expect(() => refFromUrl("http://127.0.0.1:54361")).toThrow(/not a remote Supabase project/);
    expect(() => refFromUrl("http://localhost:54361")).toThrow(/not a remote Supabase project/);
  });

  it("refuses a missing or unparseable value rather than guessing", () => {
    expect(() => refFromUrl(undefined)).toThrow(/No SUPABASE_URL/);
    expect(() => refFromUrl("")).toThrow(/No SUPABASE_URL/);
    expect(() => refFromUrl("alschkahzfagtppxspfq.supabase.co")).toThrow(/not a URL/);
  });

  it("refuses a lookalike host", () => {
    /* `db.<ref>.supabase.co` is the *database* host and is a real thing in
       .env.prod — it is what DATABASE_URL points at. Its first label is `db`,
       which is not a project ref, and the Management API would answer 404 for
       it several steps later. Caught here instead. */
    expect(() => refFromUrl("https://db.alschkahzfagtppxspfq.supabase.co")).toThrow(
      /not a remote Supabase project/,
    );
    expect(() => refFromUrl("https://supabase.co")).toThrow(/not a remote Supabase project/);
    expect(() => refFromUrl("https://alschkahzfagtppxspfq.supabase.co.evil.example")).toThrow(
      /not a remote Supabase project/,
    );
  });
});
