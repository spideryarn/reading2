/**
 * The one list of places a worktree may be.
 *
 * Until 2026-10-05 there was one place, `<primary>/.claude/worktrees/<name>`,
 * and four functions each recognised it in their own way. Then new trees on the
 * box moved to `/var/tmp/spideryarn-worktrees/<name>` and all four said "not a
 * worktree" — safely, and wrongly. The callers' own tests are beside the callers;
 * this file is the list itself, and the check that it names the same directory
 * the hook that makes the trees does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTERNAL_WORKTREE_ROOT,
  EXTERNAL_WORKTREE_ROOT_ENV,
  externalWorktreeRoot,
  isWorktreeOfCheckout,
  worktreePlace,
} from "../scripts/worktree-roots.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIMARY = "/home/greg/code/spideryarn2";
const NO_ENV = {};

describe("externalWorktreeRoot", () => {
  it("is the directory the WorktreeCreate hook makes trees in, by the same variable and the same default", () => {
    const hook = readFileSync(path.join(REPO, ".claude/hooks/worktree-create.sh"), "utf8");
    expect(hook).toContain(`ROOT="\${${EXTERNAL_WORKTREE_ROOT_ENV}:-${DEFAULT_EXTERNAL_WORKTREE_ROOT}}"`);
  });

  it("is the directory provision.sh creates on a new box", () => {
    const provision = readFileSync(path.join(REPO, "infra/hetzner/provision.sh"), "utf8");
    expect(provision).toMatch(new RegExp(`install -d [^\\n]* ${DEFAULT_EXTERNAL_WORKTREE_ROOT}\\n`));
  });

  it("follows the variable, and ignores one that is empty or not an absolute path", () => {
    expect(externalWorktreeRoot(NO_ENV)).toBe(DEFAULT_EXTERNAL_WORKTREE_ROOT);
    expect(externalWorktreeRoot({ [EXTERNAL_WORKTREE_ROOT_ENV]: "/mnt/big/trees/" })).toBe("/mnt/big/trees");
    expect(externalWorktreeRoot({ [EXTERNAL_WORKTREE_ROOT_ENV]: "" })).toBe(DEFAULT_EXTERNAL_WORKTREE_ROOT);
    expect(externalWorktreeRoot({ [EXTERNAL_WORKTREE_ROOT_ENV]: "trees" })).toBe(DEFAULT_EXTERNAL_WORKTREE_ROOT);
    expect(externalWorktreeRoot({ [EXTERNAL_WORKTREE_ROOT_ENV]: "/" })).toBe(DEFAULT_EXTERNAL_WORKTREE_ROOT);
    expect(externalWorktreeRoot({ [EXTERNAL_WORKTREE_ROOT_ENV]: "/mnt/../trees" })).toBe(DEFAULT_EXTERNAL_WORKTREE_ROOT);
  });
});

describe("worktreePlace", () => {
  it("names a tree under .claude/worktrees/, from its root or from inside it", () => {
    const root = `${PRIMARY}/.claude/worktrees/logo-animations`;
    expect(worktreePlace(root, NO_ENV)).toEqual({ name: "logo-animations", root, where: "in-repo" });
    expect(worktreePlace(`${root}/`, NO_ENV)).toEqual({ name: "logo-animations", root, where: "in-repo" });
    expect(worktreePlace(`${root}/src/web`, NO_ENV)).toEqual({ name: "logo-animations", root, where: "in-repo" });
  });

  it("names a tree under the external root, from its root or from inside it", () => {
    const root = `${DEFAULT_EXTERNAL_WORKTREE_ROOT}/bar-reads-profile`;
    expect(worktreePlace(root, NO_ENV)).toEqual({ name: "bar-reads-profile", root, where: "external" });
    expect(worktreePlace(`${root}/tools/fleet`, NO_ENV)).toEqual({ name: "bar-reads-profile", root, where: "external" });
    // The repo carries a `.claude/` of its own, so this path exists in every external tree.
    expect(worktreePlace(`${root}/.claude/worktrees/x`, NO_ENV)).toEqual({ name: "bar-reads-profile", root, where: "external" });
  });

  it("is null for the roots themselves, a plain checkout, and a look-alike", () => {
    for (const dir of [
      PRIMARY,
      `${PRIMARY}/.claude/worktrees`,
      `${PRIMARY}/.claude/worktrees/`,
      DEFAULT_EXTERNAL_WORKTREE_ROOT,
      `${DEFAULT_EXTERNAL_WORKTREE_ROOT}/`,
      `${DEFAULT_EXTERNAL_WORKTREE_ROOT}-old/x`,
      "/var/tmp/x",
      "/home/greg/.claude/projects/x",
      "/home/greg/worktrees/x",
      "",
      "/",
    ]) {
      expect(worktreePlace(dir, NO_ENV), dir).toBeNull();
    }
  });

  it("is null for anything that is not a plain absolute path: `..` and `.` are not followed, they are refused", () => {
    for (const dir of [
      ".claude/worktrees/x",
      `${PRIMARY}/.claude/worktrees/x/../../..`,
      `${PRIMARY}/.claude/worktrees/../worktrees/x`,
      `${PRIMARY}/.claude/worktrees/./x`,
      `${PRIMARY}/.claude/worktrees/..`,
      `${DEFAULT_EXTERNAL_WORKTREE_ROOT}/x/../../../../etc`,
      `${DEFAULT_EXTERNAL_WORKTREE_ROOT}/..`,
      `${DEFAULT_EXTERNAL_WORKTREE_ROOT}//x`,
      `${PRIMARY}/.claude/worktrees/x\0`,
    ]) {
      expect(worktreePlace(dir, NO_ENV), JSON.stringify(dir)).toBeNull();
    }
  });

  it("follows the variable", () => {
    const env = { [EXTERNAL_WORKTREE_ROOT_ENV]: "/mnt/big/trees" };
    expect(worktreePlace("/mnt/big/trees/x", env)).toEqual({ name: "x", root: "/mnt/big/trees/x", where: "external" });
    expect(worktreePlace(`${DEFAULT_EXTERNAL_WORKTREE_ROOT}/x`, env)).toBeNull();
  });
});

describe("isWorktreeOfCheckout", () => {
  it("accepts this checkout's in-repo trees and any external one", () => {
    expect(isWorktreeOfCheckout(`${PRIMARY}/.claude/worktrees/x`, PRIMARY, NO_ENV)).toBe(true);
    expect(isWorktreeOfCheckout(`${PRIMARY}/.claude/worktrees/x/src`, `${PRIMARY}/`, NO_ENV)).toBe(true);
    expect(isWorktreeOfCheckout(`${DEFAULT_EXTERNAL_WORKTREE_ROOT}/x`, PRIMARY, NO_ENV)).toBe(true);
  });

  it("refuses another checkout's in-repo tree, the primary, and anything that is not a tree", () => {
    expect(isWorktreeOfCheckout("/home/greg/somewhere-else/.claude/worktrees/x", PRIMARY, NO_ENV)).toBe(false);
    expect(isWorktreeOfCheckout(PRIMARY, PRIMARY, NO_ENV)).toBe(false);
    expect(isWorktreeOfCheckout("/etc", PRIMARY, NO_ENV)).toBe(false);
    expect(isWorktreeOfCheckout(`${PRIMARY}/.claude/worktrees/x/../../..`, PRIMARY, NO_ENV)).toBe(false);
  });
});
