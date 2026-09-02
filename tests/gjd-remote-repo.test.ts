/**
 * Which repo you are standing in, and where that repo lives on the box.
 *
 * `localRepo` is tested against REAL temporary git repositories — `git init`,
 * `git remote add`, `git worktree add`, `git submodule add` — rather than a
 * mocked git. The whole value of the function is knowing what git actually
 * answers in the awkward cases (a subdirectory, a worktree, a submodule), and a
 * mock would only ever answer what we already believed. See
 * docs/reusable/silent-success.md.
 *
 * `resolveRemoteCheckout` is pure, so it gets table tests — including the case
 * this whole feature exists for: spideryarn/reading2 is checked out on the box
 * as `spideryarn2`, so the name is not the answer and the origin is.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  describeLocalRepo,
  describeResolution,
  localRepo,
  remoteSlug,
  resolveRemoteCheckout,
  type RemoteSibling,
} from "../scripts/gjd-remote-repo.js";

// ------------------------------------------------------------------ fixtures

let root: string;

/** git, quietly, with an identity and no user config in the way — a machine
 *  with `commit.gpgsign` or a template dir set must not change the answers. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/** A repo with one commit, at `<root>/<where>`, optionally with an origin. */
function makeRepo(where: string, origin?: string): string {
  const dir = join(root, where);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), `# ${where}\n`);
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "first");
  if (origin !== undefined) git(dir, "remote", "add", "origin", origin);
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gjd-remote-repo-"));
  writeFileSync(join(root, "gitconfig"), "[protocol \"file\"]\n\tallow = always\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- remoteSlug

describe("remoteSlug", () => {
  const cases: [string, string | undefined][] = [
    ["https://github.com/Spideryarn/Reading2.git", "spideryarn/reading2"],
    ["https://github.com/spideryarn/reading2", "spideryarn/reading2"],
    ["https://git:token@github.com/spideryarn/reading2.git", "spideryarn/reading2"],
    ["git@github.com:spideryarn/reading2.git", "spideryarn/reading2"],
    ["git@github.com:spideryarn/reading2", "spideryarn/reading2"],
    ["ssh://git@github.com/spideryarn/reading2.git", "spideryarn/reading2"],
    ["  https://github.com/spideryarn/reading2/  ", "spideryarn/reading2"],
    ["https://gitlab.com/spideryarn/reading2.git", undefined],
    ["/home/greg/code/somewhere", undefined],
    ["", undefined],
  ];
  for (const [url, want] of cases) {
    it(`${url || "(empty)"} → ${want ?? "(unrecognised)"}`, () => {
      expect(remoteSlug(url)).toBe(want);
    });
  }
});

// ----------------------------------------------------------------- localRepo

describe("localRepo", () => {
  it("tells two repos with the same basename apart by their origins", () => {
    const a = makeRepo("owner-a/reading2", "https://github.com/spideryarn/reading2.git");
    const b = makeRepo("owner-b/reading2", "https://github.com/gregdetre/reading2.git");
    const ra = localRepo(a);
    const rb = localRepo(b);
    expect(ra.kind).toBe("repo");
    expect(rb.kind).toBe("repo");
    if (ra.kind !== "repo" || rb.kind !== "repo") throw new Error("unreachable");
    expect(ra.slug).toBe("spideryarn/reading2");
    expect(rb.slug).toBe("gregdetre/reading2");
    expect(ra.owner).toBe("spideryarn");
    expect(ra.name).toBe("reading2");
  });

  it("gives the same slug for https, ssh and scp-style origins", () => {
    const urls = [
      "https://github.com/Spideryarn/Reading2.git",
      "git@github.com:spideryarn/reading2",
      "ssh://git@github.com/SPIDERYARN/reading2.git",
    ];
    const slugs = urls.map((url, i) => {
      const r = localRepo(makeRepo(`same-slug-${i}`, url));
      if (r.kind !== "repo") throw new Error(`expected repo, got ${r.kind}`);
      return r.slug;
    });
    expect(slugs).toEqual(["spideryarn/reading2", "spideryarn/reading2", "spideryarn/reading2"]);
  });

  it("resolves a subdirectory to the toplevel", () => {
    const top = makeRepo("subdir-repo", "https://github.com/spideryarn/reading2.git");
    const deep = join(top, "docs", "project");
    mkdirSync(deep, { recursive: true });
    const r = localRepo(deep);
    if (r.kind !== "repo") throw new Error(`expected repo, got ${r.kind}`);
    expect(r.slug).toBe("spideryarn/reading2");
    // The toplevel, not the directory we asked from.
    expect(r.toplevel.endsWith("/docs/project")).toBe(false);
    expect(localRepo(r.toplevel).kind).toBe("repo");
  });

  it("resolves a worktree to its parent's origin", () => {
    const top = makeRepo("worktree-parent", "https://github.com/spideryarn/reading2.git");
    const wt = join(root, "worktree-child");
    git(top, "worktree", "add", "-q", "-b", "side", wt);
    const r = localRepo(wt);
    if (r.kind !== "repo") throw new Error(`expected repo, got ${r.kind}`);
    expect(r.slug).toBe("spideryarn/reading2");
    // And it is the worktree's own toplevel, not the parent checkout's.
    expect(r.toplevel).toContain("worktree-child");
  });

  it("refuses inside a submodule, naming both repos", () => {
    const inner = makeRepo("sub-inner", "https://github.com/spideryarn/inner.git");
    const outer = makeRepo("sub-outer", "https://github.com/spideryarn/outer.git");
    git(outer, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "vendor/inner");
    git(outer, "commit", "-q", "-m", "add submodule");
    const r = localRepo(join(outer, "vendor", "inner"));
    expect(r.kind).toBe("submodule");
    if (r.kind !== "submodule") throw new Error("unreachable");
    expect(r.toplevel).toContain("vendor/inner");
    expect(r.superproject).toContain("sub-outer");
    // A submodule's origin is the path it was added from, so the inner slug is
    // undefined here; the superproject's is the one that is recognisable.
    expect(r.superSlug).toBe("spideryarn/outer");
  });

  it("says not-git outside any repository", () => {
    const plain = join(root, "not-a-repo");
    mkdirSync(plain, { recursive: true });
    const r = localRepo(plain);
    expect(r.kind).toBe("not-git");
    if (r.kind !== "not-git") throw new Error("unreachable");
    expect(r.cwd).toBe(plain);
  });

  it("says no-origin for a repo that has no origin remote", () => {
    const dir = makeRepo("no-origin-repo");
    const r = localRepo(dir);
    expect(r.kind).toBe("no-origin");
    if (r.kind !== "no-origin") throw new Error("unreachable");
    expect(r.toplevel).toContain("no-origin-repo");
  });

  it("says unrecognised-remote for a non-GitHub origin", () => {
    const dir = makeRepo("gitlab-repo", "https://gitlab.com/spideryarn/reading2.git");
    const r = localRepo(dir);
    expect(r.kind).toBe("unrecognised-remote");
    if (r.kind !== "unrecognised-remote") throw new Error("unreachable");
    expect(r.origin).toBe("https://gitlab.com/spideryarn/reading2.git");
  });

  it("says not-git for a directory that does not exist", () => {
    const r = localRepo(join(root, "nowhere-at-all"));
    expect(r.kind).toBe("not-git");
  });
});

// ------------------------------------------------------- resolveRemoteCheckout

const CODE = "/home/greg/code";
const checkout = (dir: string, origin: string): RemoteSibling => ({ dir, origin, isCheckout: true });

describe("resolveRemoteCheckout", () => {
  it("finds reading2 checked out under a different name", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/hellozenno`, "https://github.com/gregdetre/hellozenno.git"),
      checkout(`${CODE}/spideryarn2`, "https://github.com/spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/spideryarn2` });
  });

  it("matches an ssh-form origin on the box, and ignores case", () => {
    const r = resolveRemoteCheckout("Spideryarn/Reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/spideryarn2`, "git@github.com:SPIDERYARN/reading2"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/spideryarn2` });
  });

  it("refuses to choose when two checkouts share an origin", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/spideryarn2`, "https://github.com/spideryarn/reading2.git"),
      checkout(`${CODE}/reading2-old`, "git@github.com:spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({
      kind: "ambiguous",
      dirs: [`${CODE}/reading2-old`, `${CODE}/spideryarn2`],
    });
  });

  it("is absent when nothing matches and the proposed path is free", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      checkout(`${CODE}/spideryarn2`, "https://github.com/spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({ kind: "absent", proposedDir: `${CODE}/hellozenno` });
  });

  it("is absent when the box has nothing under ~/code at all", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, []);
    expect(r).toEqual({ kind: "absent", proposedDir: `${CODE}/hellozenno` });
  });

  it("reports occupied when the proposed path holds another repo", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      checkout(`${CODE}/hellozenno`, "https://github.com/someoneelse/hellozenno.git"),
    ]);
    expect(r).toEqual({
      kind: "occupied",
      dir: `${CODE}/hellozenno`,
      foundSlug: "someoneelse/hellozenno",
    });
  });

  it("reports occupied with no slug when the proposed path is not a checkout", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      { dir: `${CODE}/hellozenno`, origin: undefined, isCheckout: false },
    ]);
    expect(r).toEqual({ kind: "occupied", dir: `${CODE}/hellozenno`, foundSlug: undefined });
  });

  it("reports occupied with no slug when the path holds a checkout of an unrecognised remote", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      checkout(`${CODE}/hellozenno`, "https://gitlab.com/gregdetre/hellozenno.git"),
    ]);
    expect(r).toEqual({ kind: "occupied", dir: `${CODE}/hellozenno`, foundSlug: undefined });
  });

  it("never matches a sibling whose origin could not be read", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      { dir: `${CODE}/mystery`, origin: undefined, isCheckout: true },
    ]);
    expect(r).toEqual({ kind: "absent", proposedDir: `${CODE}/reading2` });
  });

  it("matches the proposed path itself when the origin agrees", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/reading2`, "https://github.com/spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/reading2` });
  });

  it("does not care about a trailing slash on either side", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno/`, [
      { dir: `${CODE}/hellozenno`, origin: undefined, isCheckout: false },
    ]);
    expect(r).toEqual({ kind: "occupied", dir: `${CODE}/hellozenno`, foundSlug: undefined });
  });
});

// ---------------------------------------------------------------- the wording

describe("describeResolution", () => {
  it("says where an absent repo would go, and how to put it there", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "absent",
      proposedDir: `${CODE}/hellozenno`,
    });
    expect(msg).toContain("gregdetre/hellozenno");
    expect(msg).toContain(`${CODE}/hellozenno`);
    expect(msg).toContain("gjd-remote clone gregdetre/hellozenno");
  });

  it("names both directories when the answer is ambiguous, and asks for --dir", () => {
    const msg = describeResolution("spideryarn/reading2", {
      kind: "ambiguous",
      dirs: [`${CODE}/reading2-old`, `${CODE}/spideryarn2`],
    });
    expect(msg).toContain(`${CODE}/reading2-old`);
    expect(msg).toContain(`${CODE}/spideryarn2`);
    expect(msg).toContain("--dir");
  });

  it("names the repo that is in the way, and says nothing was touched", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "occupied",
      dir: `${CODE}/hellozenno`,
      foundSlug: "someoneelse/hellozenno",
    });
    expect(msg).toContain("someoneelse/hellozenno");
    expect(msg).toContain(`${CODE}/hellozenno`);
    expect(msg).toContain("Nothing was cloned");
  });

  it("says what it found when the occupier is not a checkout at all", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "occupied",
      dir: `${CODE}/hellozenno`,
      foundSlug: undefined,
    });
    expect(msg).toContain("not a git checkout");
    expect(msg).not.toContain("undefined");
  });
});

describe("describeLocalRepo", () => {
  it("offers --repo and --dir outside a git repository", () => {
    const msg = describeLocalRepo({ kind: "not-git", cwd: "/Users/greg" });
    expect(msg).toContain("/Users/greg");
    expect(msg).toContain("--repo owner/name");
    expect(msg).toContain("--dir");
  });

  it("names both candidates inside a submodule", () => {
    const msg = describeLocalRepo({
      kind: "submodule",
      toplevel: "/Users/greg/dev/hellozenno/backend/api",
      superproject: "/Users/greg/dev/hellozenno",
      slug: "gregdetre/hz-api",
      superSlug: "gregdetre/hellozenno",
    });
    expect(msg).toContain("gregdetre/hz-api");
    expect(msg).toContain("gregdetre/hellozenno");
    expect(msg).toContain("--repo owner/name");
  });

  it("says which remote it could not read", () => {
    const msg = describeLocalRepo({
      kind: "unrecognised-remote",
      toplevel: "/Users/greg/dev/thing",
      origin: "https://gitlab.com/greg/thing.git",
    });
    expect(msg).toContain("https://gitlab.com/greg/thing.git");
    expect(msg).toContain("GitHub");
  });

  it("says a repo with no origin cannot be identified", () => {
    const msg = describeLocalRepo({ kind: "no-origin", toplevel: "/Users/greg/dev/thing" });
    expect(msg).toContain("/Users/greg/dev/thing");
    // Naming the missing remote, not just the word "origin" — the escape line
    // at the bottom of every message mentions origins too, so a looser
    // assertion here passes on a message that never says what is wrong.
    expect(msg).toContain("no 'origin' remote");
  });
});
