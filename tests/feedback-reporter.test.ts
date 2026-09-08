/**
 * Whether an agent may treat a feedback report as instructions.
 *
 * The one that matters is `refusesEmailAlone`: the whole point of
 * scripts/feedback-reporter.ts is that a *recognisable address* is not an
 * answer, and the shape of the mistake it prevents is somebody reading
 * `contact_email`, seeing Greg's, and stopping there. So the case is pinned
 * here rather than left to the header — including the exit code, because the
 * script's caller is a shell.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import { assess } from "../scripts/feedback-reporter.js";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/feedback-reporter.ts", import.meta.url));

/** Any uuid that is neither of Greg's. A reader's, as far as this is concerned. */
const STRANGER_ID = "9f1c0a3e-4b2d-4c8a-9e77-0d1a2b3c4d5e";

describe("assess", () => {
  it("trusts both of Greg's accounts", () => {
    expect(assess({ userId: ADMIN_USER_ID_LOCAL }).kind).toBe("admin");
    expect(assess({ userId: ADMIN_USER_ID_PROD, email: ADMIN_EMAIL }).kind).toBe("admin");
  });

  it("does not trust a reader", () => {
    expect(assess({ userId: STRANGER_ID, email: "someone@example.com" })).toEqual({
      kind: "stranger",
    });
  });

  it("refuses to answer from an address alone, however familiar", () => {
    const verdict = assess({ email: ADMIN_EMAIL });
    expect(verdict.kind).toBe("unknown");
    /* Not "stranger": a missing id is a question to go and answer, not a no. */
    expect(verdict.kind === "unknown" && verdict.why).toContain("not the test");
  });

  it("shouts when the right address arrives on an id we do not know", () => {
    const verdict = assess({ userId: STRANGER_ID, email: ADMIN_EMAIL });
    expect(verdict.kind).toBe("stranger");
    expect(verdict.kind === "stranger" && verdict.note).toContain("src/admin.ts");
  });

  it("is decided by the id, not the address, when the two disagree the other way", () => {
    const verdict = assess({ userId: ADMIN_USER_ID_PROD, email: "greg@somewhere-else.com" });
    expect(verdict.kind).toBe("admin");
    expect(verdict.kind === "admin" && verdict.note).toBeDefined();
  });

  it("will not call a mangled paste a stranger", () => {
    /* Both of these used to answer "checked, and no", which is a check that
       never happened. GPT Sol, 2026-09-08. */
    expect(assess({ userId: "not-a-uuid" }).kind).toBe("unknown");
    expect(assess({ userId: "--email" }).kind).toBe("unknown");
  });

  it("ignores case and surrounding space in an id, as isAdmin does", () => {
    expect(assess({ userId: `  ${ADMIN_USER_ID_PROD.toUpperCase()}  ` }).kind).toBe("admin");
  });
});

describe("the CLI", () => {
  const run = (args: readonly string[]) =>
    spawnSync(TSX, [SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });

  it("exits 0 for an admin, 1 for a reader, 2 with no id", () => {
    const admin = run(["--user-id", ADMIN_USER_ID_PROD, "--email", ADMIN_EMAIL]);
    expect(admin.status).toBe(0);
    expect(admin.stdout).toContain("ADMIN");

    expect(run(["--user-id", STRANGER_ID]).status).toBe(1);
    expect(run(["--email", ADMIN_EMAIL]).status).toBe(2);
  });

  it("takes --flag=value too", () => {
    expect(run([`--user-id=${ADMIN_USER_ID_LOCAL}`]).status).toBe(0);
  });

  it("does not swallow the next flag as the id", () => {
    /* Exit 2, not 1: a missing value is a question, not an answer. */
    expect(run(["--user-id", "--email", ADMIN_EMAIL]).status).toBe(2);
  });

  it("says where the id must have come from, on the path that matters", () => {
    const out = run(["--user-id", ADMIN_USER_ID_PROD]).stdout;
    expect(out).toContain("Sentry issue");
    expect(out).toContain("never the report body");
  });
});
