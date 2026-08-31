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
  parseEnv,
  serialiseValue,
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
    const { text, pushed, skipped } = buildEnvPayload(FIXTURE);
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
    const { pushed, skipped, text } = buildEnvPayload(FIXTURE);
    expect(pushed.has("SOME_FUTURE_SECRET")).toBe(false);
    expect(skipped).toContain("SOME_FUTURE_SECRET");
    expect(text).not.toContain("whatever-greg-adds-next");
  });

  it("sends the allowlisted keys, and reports the ones it could not find", () => {
    const { pushed, missing } = buildEnvPayload(FIXTURE);
    expect([...pushed.keys()]).toEqual(["OPENROUTER_API_KEY", "DATABASE_URL"]);
    expect(pushed.get("DATABASE_URL")).toContain("54362");
    expect(missing).toContain("SUPABASE_URL");
    expect(missing).not.toContain("DATABASE_URL");
  });

  it("refuses to write a file with nothing in it", () => {
    // Guards the shape where a mis-parsed file would quietly replace a good
    // remote .env.local with a banner and no keys.
    const { pushed } = buildEnvPayload("HETZNER_CLOUD_API_TOKEN=x\n");
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
