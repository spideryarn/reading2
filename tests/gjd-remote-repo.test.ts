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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INVENTORY_ROWS,
  INVENTORY_SENTINEL,
  type InventoryEntry,
  describeLocalRepo,
  describeResolution,
  inventoryScript,
  localRepo,
  parseInventory,
  remoteSlug,
  resolveRemoteCheckout,
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

/** An entry as the box's inventory reports it. The defaults are the ordinary
 *  case — a real directory, not a symlink, resolving to itself — so each test
 *  names only the fact it is about. */
function entry(dir: string, over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    dir,
    realpath: dir,
    isSymlink: false,
    isDir: true,
    isCheckout: false,
    origin: undefined,
    hasHead: false,
    ...over,
  };
}

/** A finished checkout: origin readable, HEAD resolves. */
const checkout = (dir: string, origin: string): InventoryEntry =>
  entry(dir, { isCheckout: true, origin, hasHead: true });

describe("resolveRemoteCheckout", () => {
  it("finds reading2 checked out under a different name", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/hellozenno`, "https://github.com/gregdetre/hellozenno.git"),
      checkout(`${CODE}/spideryarn2`, "https://github.com/spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/spideryarn2`, originTransport: "https" });
  });

  it("matches an ssh-form origin on the box, ignores case, and says it is ssh", () => {
    // Found, not refused: the checkout is the right one and a session in it
    // works. Saying that the box can never fetch it again is doctor's job, so
    // the transport travels with the answer rather than being re-derived by
    // whoever wants to complain about it.
    const r = resolveRemoteCheckout("Spideryarn/Reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/spideryarn2`, "git@github.com:SPIDERYARN/reading2"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/spideryarn2`, originTransport: "ssh" });
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

  it("counts a symlink and the checkout it points at as ONE match", () => {
    // Both are directly under ~/code and both have the same origin. Two rows,
    // one tree — reporting `ambiguous` here would refuse to start a session on
    // a box that has exactly one checkout of the repo.
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/spideryarn2`, "https://github.com/spideryarn/reading2.git"),
      entry(`${CODE}/current`, {
        realpath: `${CODE}/spideryarn2`,
        isSymlink: true,
        isCheckout: true,
        origin: "https://github.com/spideryarn/reading2.git",
        hasHead: true,
      }),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/spideryarn2`, originTransport: "https" });
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

  it("blocks on another repo at the proposed path", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      checkout(`${CODE}/hellozenno`, "https://github.com/someoneelse/hellozenno.git"),
    ]);
    expect(r).toEqual({
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "other-repo",
      foundSlug: "someoneelse/hellozenno",
    });
  });

  it("blocks with 'non-checkout' when the proposed path is a plain directory", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      entry(`${CODE}/hellozenno`),
    ]);
    expect(r).toEqual({ kind: "blocked", dir: `${CODE}/hellozenno`, reason: "non-checkout" });
  });

  it("blocks with 'incomplete-checkout' on a .git at the right origin with no HEAD", () => {
    // The origin MATCHES, so this is not the proposed-path branch at all — it
    // is the one match, refused. `found` here would hand an agent a tree that
    // looks like the repo from a tmux pane and has none of it in it.
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      entry(`${CODE}/hellozenno`, {
        isCheckout: true,
        origin: "https://github.com/gregdetre/hellozenno.git",
        hasHead: false,
      }),
    ]);
    expect(r).toEqual({
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "incomplete-checkout",
      foundSlug: "gregdetre/hellozenno",
    });
  });

  it("blocks with 'unreadable' when the box could not resolve the directory", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      entry(`${CODE}/hellozenno`, { realpath: undefined }),
    ]);
    expect(r).toEqual({ kind: "blocked", dir: `${CODE}/hellozenno`, reason: "unreadable" });
  });

  it("blocks with 'unrecognised-origin' when the path holds a checkout of something else entirely", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno`, [
      checkout(`${CODE}/hellozenno`, "https://gitlab.com/gregdetre/hellozenno.git"),
    ]);
    expect(r).toEqual({ kind: "blocked", dir: `${CODE}/hellozenno`, reason: "unrecognised-origin" });
  });

  it("never matches an entry whose origin could not be read", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      entry(`${CODE}/mystery`, { isCheckout: true, hasHead: true }),
    ]);
    expect(r).toEqual({ kind: "absent", proposedDir: `${CODE}/reading2` });
  });

  it("never matches a symlink on its own, and blocks if one is at the proposed path", () => {
    const link = entry(`${CODE}/reading2`, {
      realpath: "/srv/elsewhere/reading2",
      isSymlink: true,
      isCheckout: true,
      origin: "https://github.com/spideryarn/reading2.git",
      hasHead: true,
    });
    expect(resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [link])).toEqual({
      kind: "blocked",
      dir: `${CODE}/reading2`,
      reason: "symlink",
    });
    // And anywhere else under ~/code it is simply not an answer.
    expect(
      resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [{ ...link, dir: `${CODE}/current` }]),
    ).toEqual({ kind: "absent", proposedDir: `${CODE}/reading2` });
  });

  it("matches the proposed path itself when the origin agrees", () => {
    const r = resolveRemoteCheckout("spideryarn/reading2", `${CODE}/reading2`, [
      checkout(`${CODE}/reading2`, "https://github.com/spideryarn/reading2.git"),
    ]);
    expect(r).toEqual({ kind: "found", dir: `${CODE}/reading2`, originTransport: "https" });
  });

  it("does not care about a trailing slash on either side", () => {
    const r = resolveRemoteCheckout("gregdetre/hellozenno", `${CODE}/hellozenno/`, [
      entry(`${CODE}/hellozenno`),
    ]);
    expect(r).toEqual({ kind: "blocked", dir: `${CODE}/hellozenno`, reason: "non-checkout" });
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
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "other-repo",
      foundSlug: "someoneelse/hellozenno",
    });
    expect(msg).toContain("someoneelse/hellozenno");
    expect(msg).toContain(`${CODE}/hellozenno`);
    expect(msg).toContain("Nothing was cloned");
  });

  it("says what it found when the occupier is not a checkout at all", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "non-checkout",
    });
    expect(msg).toContain("not a git checkout");
    expect(msg).not.toContain("undefined");
  });

  it("says a half-finished checkout is half-finished, not merely wrong", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "incomplete-checkout",
      foundSlug: "gregdetre/hellozenno",
    });
    expect(msg).toContain("HEAD");
    expect(msg).toContain(`${CODE}/hellozenno`);
    // The distinction worth having: the origin is RIGHT, and saying "is not
    // gregdetre/hellozenno" about a checkout of gregdetre/hellozenno would
    // send a reader looking for a name collision that is not there.
    expect(msg).not.toContain("is not gregdetre/hellozenno");
  });

  it("says a symlink is a symlink", () => {
    const msg = describeResolution("gregdetre/hellozenno", {
      kind: "blocked",
      dir: `${CODE}/hellozenno`,
      reason: "symlink",
    });
    expect(msg).toContain("symlink");
    expect(msg).toContain("Nothing was cloned");
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

// -------------------------------------------------------------- the inventory

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** One wire row, field by field, so a test can bend exactly one of them. */
function row(
  dir: string,
  o: { real?: string; lnk?: string; isdir?: string; co?: string; origin?: string; head?: string } = {},
): string {
  return [
    b64(dir),
    b64(o.real ?? dir),
    o.lnk ?? "0",
    o.isdir ?? "1",
    o.co ?? "0",
    b64(o.origin ?? ""),
    o.head ?? "0",
  ].join("|");
}

/** A well-formed reply: the count, the rows, the sentinel last. */
const reply = (rows: string[], count = rows.length) =>
  [`${INVENTORY_ROWS} ${count}`, ...rows, INVENTORY_SENTINEL].join("\n");

describe("parseInventory", () => {
  it("reads a well-formed reply, including a directory name full of separators", () => {
    // Nothing in the wire format is free text, so a name containing the field
    // separator and a newline has to survive whole rather than shifting fields.
    const awkward = `${CODE}/we|ird\nname`;
    const got = parseInventory(
      reply([
        row(`${CODE}/spideryarn2`, { co: "1", origin: "https://github.com/spideryarn/reading2.git", head: "1" }),
        row(awkward),
      ]),
    );
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable");
    expect(got.entries).toEqual([
      {
        dir: `${CODE}/spideryarn2`,
        realpath: `${CODE}/spideryarn2`,
        isSymlink: false,
        isDir: true,
        isCheckout: true,
        origin: "https://github.com/spideryarn/reading2.git",
        hasHead: true,
      },
      {
        dir: awkward,
        realpath: awkward,
        isSymlink: false,
        isDir: true,
        isCheckout: false,
        origin: undefined,
        hasHead: false,
      },
    ]);
  });

  it("accepts an empty ~/code — zero rows, and the sentinel", () => {
    expect(parseInventory(reply([]))).toEqual({ ok: true, entries: [] });
  });

  it("refuses a reply that was cut off before the sentinel", () => {
    // The case this shape exists for: a script that died on its first line
    // prints nothing, which is byte-for-byte an empty ~/code — and an empty
    // ~/code is what the caller reads as permission to clone.
    const got = parseInventory([`${INVENTORY_ROWS} 1`, row(`${CODE}/spideryarn2`)].join("\n"));
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("unreachable");
    expect(got.why).toContain("completion marker");
  });

  it("refuses a reply that carried on talking after the sentinel", () => {
    const got = parseInventory(
      [`${INVENTORY_ROWS} 0`, INVENTORY_SENTINEL, "Connection to 1.2.3.4 closed."].join("\n"),
    );
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("unreachable");
    expect(got.why).toContain("after");
  });

  it("refuses a reply whose row count does not match its rows", () => {
    const got = parseInventory(reply([row(`${CODE}/spideryarn2`), row(`${CODE}/hellozenno`)], 3));
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("unreachable");
    expect(got.why).toContain("3");
    expect(got.why).toContain("2");
  });

  it("refuses the WHOLE listing for one unreadable row, rather than skipping it", () => {
    // Skipping is how a checkout that exists turns into an empty slot, and an
    // empty slot means `absent`, which means a second clone of a repo that is
    // already there. So one bad row fails everything.
    for (const bad of [
      "not-a-row-at-all",
      `${row(`${CODE}/x`)}|extra`,
      [b64(`${CODE}/x`), "!!!not base64!!!", "0", "1", "0", "", "0"].join("|"),
      row(`${CODE}/x`, { lnk: "2" }),
      row(`${CODE}/x`, { head: "yes" }),
      row(""),
    ]) {
      const got = parseInventory(reply([row(`${CODE}/spideryarn2`), bad]));
      expect(got.ok, `should have refused: ${bad}`).toBe(false);
    }
  });

  it("passes the box's own complaint through instead of reading the rest", () => {
    expect(parseInventory("GJDERR git is not on this box\n")).toEqual({
      ok: false,
      why: "git is not on this box",
    });
  });

  it("refuses a reply with two row counts in it", () => {
    const got = parseInventory(
      [`${INVENTORY_ROWS} 0`, `${INVENTORY_ROWS} 1`, row(`${CODE}/x`), INVENTORY_SENTINEL].join("\n"),
    );
    expect(got.ok).toBe(false);
  });
});

// ------------------------------------------------ the script and the parser

/**
 * The script is RUN, against a real directory, and its output goes through the
 * real parser.
 *
 * Two unit tests either side of a wire format cannot see the format itself:
 * both are written against the same belief about it, so the day the script
 * emits six fields where the parser wants seven, both stay green. This is the
 * only test here that can tell whether the two still agree —
 * docs/reusable/silent-success.md.
 *
 * bash, and the laptop's own: it is the same POSIX text the box's shell runs.
 * Using `base64 | tr -d` instead of GNU's `base64 -w0` is what makes running it
 * here possible at all, and it costs nothing on the box.
 */
describe("inventoryScript, run for real", () => {
  it("agrees with parseInventory about a base holding one of everything", () => {
    // realpathSync because /tmp is a symlink to /private/tmp on macOS, and the
    // script reports what `pwd -P` says — otherwise the listed path and the
    // realpath differ for every entry and the comparison proves nothing.
    const base = realpathSync(mkdtempSync(join(root, "inv-")));

    const repo = join(base, "spideryarn2");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "# x\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-q", "-m", "first");
    git(repo, "remote", "add", "origin", "https://github.com/spideryarn/reading2.git");

    symlinkSync(repo, join(base, "current"));
    mkdirSync(join(base, "plain-dir"));
    writeFileSync(join(base, "a-file"), "hello\n");

    // A clone that arrived and stopped: a real .git, an origin, and no HEAD.
    const partial = join(base, "halfway");
    mkdirSync(partial);
    git(partial, "init", "-q", "-b", "main");
    git(partial, "remote", "add", "origin", "https://github.com/example/halfway.git");

    const out = execFileSync("bash", ["-c", inventoryScript(base)], { encoding: "utf8" });
    const got = parseInventory(out);
    expect(got.ok, `the parser refused the real script's output:\n${out}`).toBe(true);
    if (!got.ok) throw new Error("unreachable");

    const by = new Map(got.entries.map((e) => [e.dir, e]));
    expect([...by.keys()].sort()).toEqual(
      [join(base, "a-file"), join(base, "current"), join(base, "halfway"), join(base, "plain-dir"), repo].sort(),
    );

    expect(by.get(repo)).toEqual({
      dir: repo,
      realpath: repo,
      isSymlink: false,
      isDir: true,
      isCheckout: true,
      origin: "https://github.com/spideryarn/reading2.git",
      hasHead: true,
    });

    const link = by.get(join(base, "current"));
    expect(link?.isSymlink).toBe(true);
    // Resolved to the checkout, NOT to itself — this is the fact the
    // de-duplication rests on.
    expect(link?.realpath).toBe(repo);

    const half = by.get(join(base, "halfway"));
    expect(half?.isCheckout).toBe(true);
    expect(half?.origin).toBe("https://github.com/example/halfway.git");
    expect(half?.hasHead).toBe(false);

    expect(by.get(join(base, "plain-dir"))?.isCheckout).toBe(false);
    expect(by.get(join(base, "a-file"))?.isDir).toBe(false);

    // And the point of the exercise: the resolver, fed the real thing, finds
    // the checkout once despite the symlink sitting beside it.
    expect(resolveRemoteCheckout("spideryarn/reading2", join(base, "reading2"), got.entries)).toEqual({
      kind: "found",
      dir: repo,
      originTransport: "https",
    });
    // And refuses the half-finished one by name.
    expect(resolveRemoteCheckout("example/halfway", join(base, "halfway"), got.entries)).toEqual({
      kind: "blocked",
      dir: join(base, "halfway"),
      reason: "incomplete-checkout",
      foundSlug: "example/halfway",
    });
  });

  it("says zero rows and signs off when the base does not exist", () => {
    const out = execFileSync("bash", ["-c", inventoryScript(join(root, "no-such-code-dir"))], {
      encoding: "utf8",
    });
    expect(parseInventory(out)).toEqual({ ok: true, entries: [] });
  });

  it("survives a directory name containing a quote, a pipe and a newline", () => {
    const base = realpathSync(mkdtempSync(join(root, "inv-odd-")));
    const odd = join(base, "it's|a\nname");
    mkdirSync(odd);
    const got = parseInventory(execFileSync("bash", ["-c", inventoryScript(base)], { encoding: "utf8" }));
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable");
    expect(got.entries.map((e) => e.dir)).toEqual([odd]);
  });
});
