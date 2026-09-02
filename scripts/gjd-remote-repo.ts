/**
 * Which repo you are standing in on the laptop, and which directory on the box
 * is that same repo. Pure decisions only — no ssh, no network, and the one
 * impurity (running `git` locally) is injectable — so the rules that matter can
 * be tested against real temporary repositories: tests/gjd-remote-repo.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for the reason the other gjd-remote-*.ts
 * modules were: that file runs main() on import, so nothing in it is unit
 * testable, and an entrypoint guard is a bad thing to depend on.
 *
 * The rule underneath all of it: **a repo's identity is its git origin, never a
 * folder name.** spideryarn/reading2 is checked out on the box as `spideryarn2`
 * and on the laptop as `reading2`, and both are the same repo. Two different
 * repos can share a basename. So every comparison here is on `owner/name` read
 * out of a remote URL, lower-cased, and never on a path.
 *
 * See docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 */
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------- the slug

/**
 * `owner/name`, lower-cased, out of any GitHub remote URL — the comparable
 * form. GitHub owners and repo names are case-insensitive, so the comparison
 * has to be too, or an existing checkout goes unrecognised and gets a twin.
 *
 * Every URL form git will actually hand back is accepted, because the box may
 * have been cloned by hand: https (with or without a `user@` or a token),
 * scp-style `git@github.com:owner/name`, and `ssh://git@github.com/owner/name`,
 * each with or without `.git` and a trailing slash. Anything else — GitLab, a
 * local path, an empty string — is `undefined`, which callers must treat as
 * "cannot be compared", never as "no match".
 *
 * This is the same regex `remoteSlug()` in scripts/gjd-remote.ts uses; it lives
 * here so that file can import it rather than keep a second copy.
 */
export function remoteSlug(url: string): string | undefined {
  const m =
    /^(?:https:\/\/(?:[^@/]*@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  const owner = m?.[1];
  const name = m?.[2];
  return owner && name ? `${owner}/${name}`.toLowerCase() : undefined;
}

// ------------------------------------------------------- the repo you are in

/**
 * What we know about the repo the user is standing in, or why we do not know.
 *
 * A union rather than a nullable record on purpose: every refusal carries the
 * facts its message needs, so the CLI cannot print "not a repo" when what
 * happened was "a repo with no origin". `slug` and `superSlug` on the submodule
 * arm are present-but-undefined rather than optional, so constructing one
 * cannot silently omit them.
 */
export type LocalRepo =
  | { kind: "repo"; slug: string; owner: string; name: string; toplevel: string; origin: string }
  | { kind: "not-git"; cwd: string }
  | { kind: "no-origin"; toplevel: string }
  | {
      kind: "submodule";
      toplevel: string;
      superproject: string;
      slug: string | undefined;
      superSlug: string | undefined;
    }
  | { kind: "unrecognised-remote"; toplevel: string; origin: string };

/**
 * Run `git` somewhere and give back its trimmed stdout, or `undefined` if it
 * failed for any reason at all — a missing directory, a non-zero exit, no git
 * on PATH. The distinction that matters is `undefined` (the question could not
 * be answered) versus `""` (git answered, and the answer is nothing): those are
 * two different facts for `--show-superproject-working-tree`.
 */
export type GitRunner = (args: string[], cwd: string) => string | undefined;

const runGit: GitRunner = (args, cwd) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * The repo containing `cwd`, identified by its origin.
 *
 * Order matters. The submodule question is asked BEFORE the origin one, because
 * inside a submodule both repos have an origin and answering with the inner one
 * would quietly start a session in the wrong tree. `--show-superproject-working-tree`
 * prints nothing and exits 0 when there is no superproject, which is why the
 * runner distinguishes an empty answer from a failed one.
 *
 * A worktree needs no special case: `--show-toplevel` gives the worktree's own
 * directory and `git remote get-url origin` reads the shared config, so a
 * worktree resolves to the same repo as the checkout it came from.
 */
export function localRepo(cwd: string, git: GitRunner = runGit): LocalRepo {
  const toplevel = git(["rev-parse", "--show-toplevel"], cwd);
  if (!toplevel) return { kind: "not-git", cwd };

  const superproject = git(["rev-parse", "--show-superproject-working-tree"], cwd);
  if (superproject) {
    const origin = git(["remote", "get-url", "origin"], cwd);
    const superOrigin = git(["remote", "get-url", "origin"], superproject);
    return {
      kind: "submodule",
      toplevel,
      superproject,
      slug: origin ? remoteSlug(origin) : undefined,
      superSlug: superOrigin ? remoteSlug(superOrigin) : undefined,
    };
  }

  const origin = git(["remote", "get-url", "origin"], cwd);
  if (!origin) return { kind: "no-origin", toplevel };

  const slug = remoteSlug(origin);
  if (!slug) return { kind: "unrecognised-remote", toplevel, origin };

  const [owner, name] = slug.split("/");
  // The regex that produced the slug guarantees both halves; this keeps the
  // types honest without inventing a fallback that could ever be printed.
  if (!owner || !name) return { kind: "unrecognised-remote", toplevel, origin };
  return { kind: "repo", slug, owner, name, toplevel, origin };
}

// ------------------------------------------------- the checkout on the box

/**
 * One directory under the box's code folder, as the remote scan saw it.
 *
 * `isCheckout` and `origin` are separate facts because the scan can find a
 * directory that is not a checkout at all, and because a checkout's origin can
 * be unreadable. `origin: undefined` means "unknown", and unknown never
 * matches anything — see the test that pins it.
 */
export type RemoteSibling = { dir: string; origin: string | undefined; isCheckout: boolean };

/** Where the repo lives on the box, or why we are not going to guess. */
export type RemoteCheckout =
  | { kind: "found"; dir: string }
  | { kind: "absent"; proposedDir: string }
  | { kind: "ambiguous"; dirs: string[] }
  | { kind: "occupied"; dir: string; foundSlug: string | undefined };

/** Trailing slashes are noise; `/home/greg/code/x/` and `/home/greg/code/x` are
 *  the same directory, and the scan and the caller need not agree about it. */
function normalisePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

/**
 * Match the repo to a directory on the box, by origin.
 *
 * `proposedDir` is where a clone WOULD go — box policy (`~/code/<name>`),
 * decided by the caller, not a property of the repo. It is only consulted when
 * nothing matches by origin, because a checkout under any other name is still
 * the right answer: that is how `~/code/spideryarn2` is found for
 * `spideryarn/reading2` with no registry anywhere.
 *
 * Two matches is `ambiguous` and never a choice. Picking the first would put a
 * session in one of two diverging trees at random, and the wrong one looks
 * exactly like the right one from a tmux pane.
 */
export function resolveRemoteCheckout(
  slug: string,
  proposedDir: string,
  siblings: readonly RemoteSibling[],
): RemoteCheckout {
  const want = slug.trim().toLowerCase();
  const matches = siblings
    .filter((s) => s.isCheckout && s.origin !== undefined && remoteSlug(s.origin) === want)
    .map((s) => normalisePath(s.dir))
    .sort();

  const first = matches[0];
  if (first !== undefined && matches.length === 1) return { kind: "found", dir: first };
  if (matches.length > 1) return { kind: "ambiguous", dirs: matches };

  const proposed = normalisePath(proposedDir);
  const atProposed = siblings.find((s) => normalisePath(s.dir) === proposed);
  if (atProposed) {
    return {
      kind: "occupied",
      dir: proposed,
      foundSlug:
        atProposed.isCheckout && atProposed.origin !== undefined
          ? remoteSlug(atProposed.origin)
          : undefined,
    };
  }
  return { kind: "absent", proposedDir: proposed };
}

// ------------------------------------------------------------- the wording

/**
 * What to say when the box has no single answer. Each arm names what was asked
 * for, what was found, and the exact next command — the shape every `die()` in
 * gjd-remote.ts uses. The caller passes it to `die()`; it does not print, so it
 * can be tested.
 *
 * `found` is excluded from the input type rather than returning an empty
 * string, so a caller that forgets to handle the success case does not get a
 * blank message at run time.
 */
export function describeResolution(
  slug: string,
  r: Exclude<RemoteCheckout, { kind: "found" }>,
): string {
  switch (r.kind) {
    case "absent":
      return (
        `${slug} is not on the box yet.\n` +
        `  expected at: ${r.proposedDir}\n` +
        `  Nothing on the box has that git origin — the search is by origin, not by\n` +
        `  directory name, so a checkout under another name would have been found.\n` +
        `  To put it there:\n` +
        `    gjd-remote clone ${slug}`
      );
    case "ambiguous":
      return (
        `${slug} is checked out more than once on the box, so I will not choose:\n` +
        r.dirs.map((d) => `    ${d}\n`).join("") +
        `  Both have that origin and they may have diverged. Say which:\n` +
        `    gjd-remote <command> --dir ${r.dirs[0] ?? ""}`
      );
    case "occupied":
      return (
        `${r.dir} on the box is not ${slug}.\n` +
        `  asked for: ${slug}\n` +
        `  found:     ${r.foundSlug ?? "something that is not a git checkout"}\n` +
        `  Nothing was cloned and nothing was touched. Either say where ${slug}\n` +
        `  really is, with --dir, or move what is in the way.`
      );
    default: {
      const never: never = r;
      return String(never);
    }
  }
}

/**
 * What to say when the LAPTOP cannot say which repo this is. Same shape, same
 * rule: name what was found, then the way out. `--repo owner/name` is the way
 * out of all of them, because it skips the question entirely.
 */
export function describeLocalRepo(r: Exclude<LocalRepo, { kind: "repo" }>): string {
  const sayWhich =
    `  Say which repo you mean instead:\n` +
    `    --repo owner/name   the repo, resolved on the box by its origin\n` +
    `    --dir DIR           a path on the BOX, skipping the question entirely`;
  switch (r.kind) {
    case "not-git":
      return `${r.cwd} is not inside a git repository, so I cannot tell which repo you mean.\n${sayWhich}`;
    case "no-origin":
      return (
        `${r.toplevel} is a git repository with no 'origin' remote.\n` +
        `  A repo is identified by its origin here, never by its folder name.\n${sayWhich}`
      );
    case "submodule":
      return (
        `${r.toplevel} is a submodule, so there are two repos it could mean:\n` +
        `    the submodule:    ${r.slug ?? "(unrecognised remote)"} at ${r.toplevel}\n` +
        `    the superproject: ${r.superSlug ?? "(unrecognised remote)"} at ${r.superproject}\n` +
        `  I will not guess which tree you want to work in.\n${sayWhich}`
      );
    case "unrecognised-remote":
      return (
        `${r.toplevel} has an origin I do not recognise:\n` +
        `    ${r.origin}\n` +
        `  Only GitHub remotes can be resolved to a repo on the box.\n${sayWhich}`
      );
    default: {
      const never: never = r;
      return String(never);
    }
  }
}
