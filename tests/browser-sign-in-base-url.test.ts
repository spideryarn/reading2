/**
 * Which dev server a browser check points at — the question that decides whether
 * the check tested your code or somebody else's.
 *
 * `scripts/browser-sign-in.ts` defaulted to `http://localhost:5273`, which is the
 * **primary checkout's** port. Measured on 2026-09-02: no worktree on this box
 * was running a dev server at all, so every browser check ever run from one had
 * exercised the primary — the client because the primary's vite excludes
 * `.claude/worktrees/**` from its watcher, the server because its middleware was
 * imported when the primary booted. And it printed `ok`.
 *
 * There were no tests for any of this when the refusal was written; GPT Sol's
 * review said so plainly — *"a `baseUrl()` that always returned 5273 would pass
 * every touched test"* — and it was right. These are those tests, against real
 * git worktrees, because the whole question is one only git can answer.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { baseUrl } from "../scripts/browser-sign-in.js";
import { PRIMARY_PORT } from "../scripts/worktree-port.js";

let root: string;
let primary: string;
let worktree: string;
const saved = process.env.SPIDERYARN_BASE_URL;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  delete process.env.SPIDERYARN_BASE_URL;
  root = mkdtempSync(path.join(tmpdir(), "spideryarn-baseurl-"));
  primary = path.join(root, "primary");
  worktree = path.join(root, "wt");
  git(["init", "--quiet", "-b", "dev", primary], root);
  git(["config", "user.email", "t@e.com"], primary);
  git(["config", "user.name", "T"], primary);
  git(["commit", "--quiet", "--allow-empty", "-m", "first"], primary);
  git(["worktree", "add", "--quiet", "-b", "worktree-x", worktree, "HEAD"], primary);
});

afterEach(() => {
  if (saved === undefined) delete process.env.SPIDERYARN_BASE_URL;
  else process.env.SPIDERYARN_BASE_URL = saved;
  rmSync(root, { recursive: true, force: true });
});

describe("baseUrl", () => {
  it("REFUSES inside a worktree rather than pointing at the primary's server", () => {
    /* The whole point. A default here is a browser check that passes while
       testing a tree the agent is not working in. */
    expect(() => baseUrl(worktree)).toThrow(/worktree/i);
    expect(() => baseUrl(worktree)).toThrow(new RegExp(String(PRIMARY_PORT)));
  });

  it("tells you what to run instead, rather than only saying no", () => {
    let message = "";
    try {
      baseUrl(worktree);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("npm run dev");
    expect(message).toContain("SPIDERYARN_BASE_URL");
  });

  it("defaults to the primary's port in the primary checkout", () => {
    expect(baseUrl(primary)).toBe(`http://localhost:${PRIMARY_PORT}`);
  });

  it("lets an explicit SPIDERYARN_BASE_URL through from a worktree", () => {
    process.env.SPIDERYARN_BASE_URL = "http://localhost:5291";
    expect(baseUrl(worktree)).toBe("http://localhost:5291");
  });

  it("ignores an empty SPIDERYARN_BASE_URL rather than pointing at nothing", () => {
    process.env.SPIDERYARN_BASE_URL = "";
    expect(baseUrl(primary)).toBe(`http://localhost:${PRIMARY_PORT}`);
  });

  it("FAILS CLOSED when git cannot say which checkout a path belongs to", () => {
    /* The first version left `linked` false here and handed back the primary's
       port — reachable for any caller whose path git cannot place, and the exact
       silent success the refusal exists to prevent. GPT Sol, finding 2. */
    const nowhere = mkdtempSync(path.join(tmpdir(), "spideryarn-not-a-repo-"));
    try {
      expect(() => baseUrl(nowhere)).toThrow(/cannot tell which checkout/);
    } finally {
      rmSync(nowhere, { recursive: true, force: true });
    }
  });
});
