/**
 * Does doctor's MCP check tell the truth about a box?
 *
 * The interesting cases are all the ones where something is absent rather than
 * wrong, because an absent MCP server produces no error anywhere — an agent
 * just never has the tool. See scripts/gjd-remote-mcp.ts and
 * infra/hetzner/README.md#mcp-servers.
 */
import { describe, expect, it } from "vitest";
import { declaredServers, mcpVerdict } from "../scripts/gjd-remote-mcp.js";

/** The real shape, copied from `claude mcp list` on the box on 2026-08-31. */
const REAL = [
  "Checking MCP server health…",
  "",
  "claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication",
  "chrome-devtools: npx -y chrome-devtools-mcp@1.8.0 --headless - ✔ Connected",
  "playwright: npx -y @playwright/mcp@0.0.79 --headless --isolated - ✔ Connected",
  "sentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication",
  "vercel: https://mcp.vercel.com (HTTP) - ✔ Connected",
  "supabase: http://127.0.0.1:54361/mcp (HTTP) - ✔ Connected",
].join("\n");

const THREE = ["sentry", "supabase", "vercel"];

describe("declaredServers", () => {
  it("reads the names out of a real .mcp.json", () => {
    const got = declaredServers(
      JSON.stringify({ mcpServers: { vercel: {}, supabase: {}, sentry: {} } }),
    );
    expect(got).toEqual({ ok: true, names: ["sentry", "supabase", "vercel"] });
  });

  // Each of these used to be a way to end up checking nothing while looking fine.
  it.each([
    ["not JSON at all", "{"],
    ["JSON, but not an object", '"hello"'],
    ["an object with no mcpServers", "{}"],
    ["an mcpServers that is empty", '{"mcpServers":{}}'],
  ])("refuses %s rather than returning an empty list", (_label, text) => {
    const got = declaredServers(text);
    expect(got.ok).toBe(false);
  });
});

describe("mcpVerdict", () => {
  it("fails when one of the three needs a login, and names the command", () => {
    const got = mcpVerdict(REAL, THREE);
    expect(got.ok).toBe(false);
    expect(got.why).toContain("sentry");
    expect(got.why).toContain("claude mcp login sentry");
  });

  it("passes only when all of them say Connected", () => {
    const all = REAL.replace("sentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication",
                             "sentry: https://mcp.sentry.dev/mcp (HTTP) - ✔ Connected");
    expect(mcpVerdict(all, THREE)).toEqual({
      ok: true,
      why: "3 connected: sentry, supabase, vercel",
    });
  });

  // Somebody else's Notion server needing auth is not this repo's problem, and
  // a check that reddened over it would be ignored within a week.
  it("ignores account-level servers that need auth", () => {
    const all = REAL.replace("sentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication",
                             "sentry: https://mcp.sentry.dev/mcp (HTTP) - ✔ Connected");
    expect(mcpVerdict(all, THREE).ok).toBe(true);
    expect(all).toContain("Notion: https://mcp.notion.com/mcp - ! Needs authentication");
  });

  it("says 'pending approval' is not connected", () => {
    const pending = REAL.replace("supabase: http://127.0.0.1:54361/mcp (HTTP) - ✔ Connected",
                                 "supabase: http://127.0.0.1:54361/mcp (HTTP) - ⏸ Pending approval (run `claude` to approve)");
    expect(mcpVerdict(pending, ["supabase"]).ok).toBe(false);
  });

  // The distinction that matters: telling a person to run `claude mcp login`
  // when the real problem is that the box has not pulled .mcp.json sends them
  // to do a ceremony that cannot help.
  it("distinguishes a stale checkout from a missing login", () => {
    const none = mcpVerdict("Checking MCP server health…\n\nplaywright: npx - ✔ Connected", THREE);
    expect(none.ok).toBe(false);
    expect(none.why).toContain(".mcp.json");
    expect(none.why).not.toContain("claude mcp login");
  });

  it("fails on empty output rather than reading it as nothing wrong", () => {
    expect(mcpVerdict("", THREE).ok).toBe(false);
  });

  // The check must not be able to pass by having nothing to check.
  it("refuses an empty wanted list", () => {
    const got = mcpVerdict(REAL, []);
    expect(got.ok).toBe(false);
    expect(got.why).toContain("asserting nothing");
  });

  // A name that is a prefix of another must not satisfy it.
  it("does not let 'sentry-old' answer for 'sentry'", () => {
    const odd = "sentry-old: https://example.invalid (HTTP) - ✔ Connected";
    expect(mcpVerdict(odd, ["sentry"]).ok).toBe(false);
  });
});
