/**
 * `sanitisedEnv` in scripts/subagent-cli.ts — which list wins when a name is on two of them.
 *
 * `drop` holds the variables that are wrong for this child whatever the caller asks, and
 * `passThrough` is the caller asking. They used to be applied in the order sweep-then-re-add, so a
 * name on both crossed: `--pass-env` quietly defeated a drop list, and nothing said so. Measured by
 * the codex-accounts session, 2026-09-10; plan
 * docs/plans/260910d-tests-pinned-to-one-account-environment-and-sanitisedenv-drop-wins.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitisedEnv } from "../scripts/subagent-cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitisedEnv", () => {
  it("drops every present name on both lists and tells the caller once, without duplicates", () => {
    const told: string[][] = [];
    const out = sanitisedEnv(
      { PATH: "/bin", ROUTE: "x", OTHER: "y" },
      ["ROUTE", "OTHER", "ABSENT", "ROUTE"],
      ["ROUTE", "OTHER", "ABSENT"],
      (names) => told.push(names),
    );
    expect(out.ROUTE).toBeUndefined();
    expect(out.OTHER).toBeUndefined();
    expect(out.PATH).toBe("/bin");
    expect(told).toEqual([["ROUTE", "OTHER"]]);
  });

  it("drops a secret on both lists, which the re-add step used to put back", () => {
    const out = sanitisedEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: "t" }, ["CLAUDE_CODE_OAUTH_TOKEN"], ["CLAUDE_CODE_OAUTH_TOKEN"], () => {},
    );
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("says nothing about a name the parent does not have", () => {
    /* Nothing was refused: the child would not have had it either way. A warning there would fire
       on every run of a caller whose drop list names variables most machines never set.
       `toString` is inherited from Object.prototype, not an environment entry. */
    const told: string[][] = [];
    sanitisedEnv(
      { PATH: "/bin" },
      ["ROUTE", "toString"],
      ["ROUTE", "toString"],
      (names) => told.push(names),
    );
    expect(told).toEqual([]);
  });

  it("tells stderr by default, so a caller who passed no callback is still told", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    sanitisedEnv(
      { ROUTE: "credential-value-one", OTHER: "credential-value-two" },
      ["ROUTE", "OTHER"],
      ["ROUTE", "OTHER"],
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const warning = String(spy.mock.calls[0]?.[0]);
    expect(warning).toMatch(/ROUTE/);
    expect(warning).toMatch(/OTHER/);
    expect(warning).not.toContain("credential-value-one");
    expect(warning).not.toContain("credential-value-two");
  });

  it("still lets passThrough bring back a secret that only the denylist took", () => {
    expect(sanitisedEnv({ CODEX_API_KEY: "k" }, ["CODEX_API_KEY"]).CODEX_API_KEY).toBe("k");
    expect(sanitisedEnv({ CODEX_API_KEY: "k" }).CODEX_API_KEY).toBeUndefined();
  });
});
