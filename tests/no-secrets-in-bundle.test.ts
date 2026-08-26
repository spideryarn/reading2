/**
 * **No secret-shaped key may reach the browser.**
 *
 * `VITE_`-prefixed variables are compiled into the bundle by Vite, verbatim, at
 * build time. The publishable key belongs there and grants nothing on its own;
 * the secret key (`sb_secret_…`) and the legacy `service_role` key bypass row
 * level security entirely, and either one in a `VITE_` variable is a
 * one-character mistake away — the names differ by a word.
 *
 * ## Two things the obvious version of this check gets wrong
 *
 * `grep -rc "service_role" dist/` prints a count per file and **exits 1 when it
 * finds nothing**, so in a checklist read by eye the passing case looks like a
 * failure and the failing case looks like a pass.
 *
 * And a legacy service-role key does not contain the string `service_role` in
 * the clear: it is a JWT, and the role is inside the base64 payload. So this
 * decodes anything JWT-shaped rather than searching for a word. GPT Sol,
 * 2026-08-26.
 *
 * This runs against the source of truth this test *can* see — the environment
 * and `dist/` if it has been built. The deployed bundle is checked separately
 * and from outside, by `scripts/check-production-gate.sh`, because a local
 * `dist/` is not what production is serving.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/** A three-part JWT. Deliberately loose: the point is to decode candidates, not to validate. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/**
 * A secret key, **with key material after the prefix**.
 *
 * `text.includes("sb_secret_")` was the first version and it fired on the first
 * bundle it saw — on the SDK's own
 * `key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")`, which is
 * the library checking a prefix rather than carrying a key. A detector that
 * cries wolf on every build is a detector that gets deleted, so it wants the
 * twenty-odd characters that make it an actual credential.
 */
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;

/** Anything that grants more than the publishable key does. */
function secretsIn(text: string): string[] {
  const found: string[] = [];
  if (SECRET_KEY.test(text)) found.push("sb_secret_ key");
  for (const token of text.match(JWT) ?? []) {
    const payload = token.split(".")[1] ?? "";
    let decoded = "";
    try {
      decoded = Buffer.from(payload, "base64url").toString("utf8");
    } catch {
      continue;
    }
    if (decoded.includes("service_role")) found.push("legacy service_role JWT");
  }
  return found;
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : [full];
  });
}

describe("no secret reaches the browser", () => {
  it("finds none in any VITE_ environment variable", () => {
    const offenders = Object.entries(process.env)
      .filter(([name]) => name.startsWith("VITE_"))
      .flatMap(([name, value]) => secretsIn(value ?? "").map((what) => `${name}: ${what}`));
    expect(offenders).toEqual([]);
  });

  it("finds none in a built bundle, when there is one", () => {
    const dist = path.join(ROOT, "dist");
    if (!existsSync(dist)) {
      /* Skipped, and **said out loud**. A check that silently passes because it
         had nothing to look at is the thing this whole file is about. */
      console.warn("[no-secrets] dist/ not built — bundle not checked here. Run `npm run build`.");
      return;
    }
    const offenders = filesIn(dist)
      .filter((f) => /\.(js|mjs|css|html|map)$/.test(f))
      .flatMap((f) => secretsIn(readFileSync(f, "utf8")).map((what) => `${path.relative(ROOT, f)}: ${what}`));
    expect(offenders).toEqual([]);
  });

  /* The detector, proved against the thing it is looking for. Both of these are
     made up: `sb_secret_` plus filler, and a JWT payload we build here. */
  it("would catch either kind", () => {
    expect(secretsIn("sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz")).toContain("sb_secret_ key");
    /* And the SDK's own prefix check, which is what the first version of this
       detector flagged on a real build, is not a key. */
    expect(secretsIn('e.startsWith("sb_secret_")')).toEqual([]);
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const fake = `eyJhbGciOiJIUzI1NiJ9.${payload}.abcdefghij`;
    expect(secretsIn(fake)).toContain("legacy service_role JWT");
    /* And the key that is *supposed* to be there is not flagged. */
    expect(secretsIn("sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH")).toEqual([]);
  });
});
