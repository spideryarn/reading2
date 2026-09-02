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
 * One entry directly under the box's code folder, as the inventory saw it.
 *
 * EVERY entry, not only the checkouts — a plain directory, a file, a symlink
 * and a half-finished clone all get a row, because each of them is a different
 * reason not to start a session there and "no row" would make them all look
 * like an empty slot. The scan `cloneFacts()` does in scripts/gjd-remote.ts
 * only ever reported checkouts with a readable origin, which is why it could
 * not answer this question (see the plan's "Findings along the way").
 *
 * Each field is a separate fact for the same reason:
 *  - `realpath` is `undefined` when the box could not resolve it — a directory
 *    with no execute permission, a symlink into nowhere. Unknown, never "the
 *    entry path", because the caller de-duplicates on this.
 *  - `origin: undefined` means "unknown", and unknown never matches anything.
 *  - `hasHead` is `git rev-parse --verify HEAD`, which is what tells a finished
 *    clone from a `.git` that arrived and stopped.
 */
export type InventoryEntry = {
  /** The path as listed: `<base>/<name>`, symlinks not followed. */
  dir: string;
  realpath: string | undefined;
  isSymlink: boolean;
  isDir: boolean;
  /** A git toplevel that IS this directory — not a subdirectory of one. */
  isCheckout: boolean;
  origin: string | undefined;
  hasHead: boolean;
};

/** Which URL form the box's own remote uses. The box has no GitHub ssh key, so
 *  an ssh remote there can never fetch again — `found`, and a thing `doctor`
 *  fails on by name rather than a thing that reads as healthy. */
export type OriginTransport = "https" | "ssh";

/**
 * Why a directory cannot be used, in the tool's own words elsewhere.
 *
 * `other-repo` and `incomplete-checkout` carry the slug they found; the rest
 * cannot have one by construction, so they do not have the field at all. That
 * is the exact-union rule this repo runs `exactOptionalPropertyTypes` for: a
 * `foundSlug?: string` would let every arm be built with or without it, and
 * "undefined" and "not applicable" would print the same.
 */
export type BlockedReason =
  | "non-checkout"
  | "unrecognised-origin"
  | "incomplete-checkout"
  | "symlink"
  | "unreadable"
  | "other-repo";

/** Where the repo lives on the box, or why we are not going to guess. */
export type RemoteCheckout =
  | { kind: "found"; dir: string; originTransport: OriginTransport }
  | { kind: "absent"; proposedDir: string }
  | { kind: "ambiguous"; dirs: string[] }
  | { kind: "blocked"; dir: string; reason: "other-repo"; foundSlug: string }
  | { kind: "blocked"; dir: string; reason: "incomplete-checkout"; foundSlug: string }
  | {
      kind: "blocked";
      dir: string;
      reason: "non-checkout" | "unrecognised-origin" | "symlink" | "unreadable";
    };

/** Trailing slashes are noise; `/home/greg/code/x/` and `/home/greg/code/x` are
 *  the same directory, and the scan and the caller need not agree about it. */
function normalisePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

/** `git@github.com:…` and `ssh://…` are the two forms the box cannot fetch. */
export function originTransport(url: string): OriginTransport {
  return /^(git@|ssh:\/\/)/.test(url.trim()) ? "ssh" : "https";
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
 * Three rules that are not obvious, each of them a way this went wrong on
 * paper before it went wrong on the box:
 *
 *  - **A match needs a valid HEAD.** A `.git` at the right origin with no HEAD
 *    is a clone that was interrupted, and starting a session in it gives an
 *    agent a tree with no commits that still looks like the repo.
 *  - **Symlinks never match.** They are listed, so one AT the proposed path is
 *    reported rather than cloned over; but a symlink and its target both live
 *    under `~/code` and matching both would read as two checkouts of one repo.
 *    De-duplication is by realpath, so the target is the one that answers.
 *  - **Two matches is `ambiguous` and never a choice.** Picking the first would
 *    put a session in one of two diverging trees at random, and the wrong one
 *    looks exactly like the right one from a tmux pane.
 */
export function resolveRemoteCheckout(
  slug: string,
  proposedDir: string,
  entries: readonly InventoryEntry[],
): RemoteCheckout {
  const want = slug.trim().toLowerCase();
  const proposed = normalisePath(proposedDir);

  // Candidates first, symlinks excluded, then one representative per realpath.
  // The key falls back to the entry's own path only when the box could not
  // resolve one — two unresolvable entries are two different unknowns.
  const byReal = new Map<string, InventoryEntry>();
  for (const e of entries) {
    if (e.isSymlink) continue;
    if (!e.isCheckout || e.origin === undefined) continue;
    if (remoteSlug(e.origin) !== want) continue;
    const key = e.realpath === undefined ? `?${normalisePath(e.dir)}` : normalisePath(e.realpath);
    const existing = byReal.get(key);
    if (existing === undefined || normalisePath(e.dir) < normalisePath(existing.dir)) byReal.set(key, e);
  }
  const matches = [...byReal.values()].sort((a, b) => normalisePath(a.dir).localeCompare(normalisePath(b.dir)));

  if (matches.length > 1) return { kind: "ambiguous", dirs: matches.map((m) => normalisePath(m.dir)) };
  const only = matches[0];
  if (only !== undefined) {
    const dir = normalisePath(only.dir);
    // The origin is defined — it is how this entry matched at all — but the
    // type does not know that, and a cast here would be the one place this
    // module lies to itself.
    if (!only.hasHead) return { kind: "blocked", dir, reason: "incomplete-checkout", foundSlug: want };
    return { kind: "found", dir, originTransport: originTransport(only.origin ?? "") };
  }

  const atProposed = entries.find((e) => normalisePath(e.dir) === proposed);
  if (atProposed) return blockedAt(proposed, atProposed);
  return { kind: "absent", proposedDir: proposed };
}

/** Why the thing sitting at the proposed path is not the answer. Ordered
 *  most-specific-first: a symlink is a symlink whatever it points at, and a
 *  directory the box cannot enter is unreadable rather than "not a checkout",
 *  which would be a guess dressed as a fact. */
function blockedAt(dir: string, e: InventoryEntry): RemoteCheckout {
  if (e.isSymlink) return { kind: "blocked", dir, reason: "symlink" };
  if (e.isDir && e.realpath === undefined) return { kind: "blocked", dir, reason: "unreadable" };
  if (!e.isCheckout) return { kind: "blocked", dir, reason: "non-checkout" };
  const found = e.origin === undefined ? undefined : remoteSlug(e.origin);
  if (found === undefined) return { kind: "blocked", dir, reason: "unrecognised-origin" };
  return { kind: "blocked", dir, reason: "other-repo", foundSlug: found };
}

// ------------------------------------------------------- the box-side scan

/** Printed last, and only if everything before it worked — the same sentinel
 *  scripts/gjd-remote-tmux.ts uses, and for the same reason: a script that
 *  fell over prints nothing, which is byte-for-byte an empty `~/code`. */
export const INVENTORY_SENTINEL = "GJDOK";

/** How many entries the box found, printed before any of them. A row lost
 *  between `find` and this laptop is a shorter list, and a shorter list is
 *  indistinguishable from a correct one — see ROW_COUNT in gjd-remote-tmux.ts
 *  and docs/postmortems/260901b-the-session-that-was-never-listed.md. */
export const INVENTORY_ROWS = "GJDROWS";

/** Single-quote for /bin/sh. A second copy of the one in gjd-remote.ts, which
 *  is not exported because that file runs main() on import. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * Ask the box what is directly under `base` — every entry, not only the
 * checkouts, and without following a single symlink.
 *
 * SIX FACTS PER ENTRY, and they are all separate because folding any two of
 * them together is how a blocked path reads as a free one: the listed path, its
 * realpath, whether it is a symlink, whether it is a directory at all, whether
 * it is a checkout whose toplevel IS that path, its origin, and whether HEAD
 * resolves.
 *
 * `--show-toplevel` alone is NOT "is this a checkout": inside a repo it happily
 * answers for an ancestor, so a plain subdirectory of one would read as a
 * checkout of its parent. It counts only when the toplevel is the directory we
 * asked about — the same guard `cloneFacts()` uses.
 *
 * Every path and URL travels BASE64, so the wire format has no free text in it
 * at all: a directory name containing `|` or a newline cannot shift a field or
 * fake a row.
 *
 * `base64 | tr -d` rather than GNU's `base64 -w0`, which is what the session
 * script uses. The output is identical and the portability is the point: this
 * script is RUN, under the laptop's own bash, against a temporary directory in
 * tests/gjd-remote-repo.test.ts, and BSD base64 has no `-w`. A wire format
 * whose two ends are only ever tested against each other's assumptions is one
 * neither end can see is broken.
 *
 * `wc -l | tr -d " "` because BSD `wc` right-pads its count and GNU's does not,
 * and `GJDROWS        4` is not the record the parser was written against — the
 * strict parse would refuse a perfectly good listing on the laptop. Caught by
 * running the script here rather than by reading it.
 *
 * `find -exec sh -c` rather than a shell loop over names, because a `for` loop
 * or a `read` loop has to decide how names are separated and a newline in one
 * would make it split a row in half. find hands each name to the inner script
 * as `$1`, whatever is in it.
 */
export function inventoryScript(base: string): string {
  return `
    PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
    command -v git >/dev/null 2>&1 || { echo 'GJDERR git is not on this box'; exit 3; }
    command -v base64 >/dev/null 2>&1 || { echo 'GJDERR base64 is not on this box'; exit 3; }
    b=${shq(base)}
    if [ ! -d "$b" ]; then
      printf '${INVENTORY_ROWS} 0\\n'
      echo ${INVENTORY_SENTINEL}
      exit 0
    fi
    rows=$(find "$b" -mindepth 1 -maxdepth 1 -exec sh -c '
      p=$1
      real=$(cd "$p" 2>/dev/null && pwd -P) || real=
      if [ -z "$real" ] && [ ! -d "$p" ]; then real=$(readlink -f "$p" 2>/dev/null || true); fi
      if [ -L "$p" ]; then lnk=1; else lnk=0; fi
      if [ -d "$p" ]; then isdir=1; else isdir=0; fi
      co=0; origin=; head=0
      if [ -n "$real" ]; then
        top=$(git -C "$real" rev-parse --show-toplevel 2>/dev/null || true)
        if [ -n "$top" ] && [ "$top" = "$real" ]; then
          co=1
          origin=$(git -C "$real" remote get-url origin 2>/dev/null || true)
          if git -C "$real" rev-parse --verify -q HEAD >/dev/null 2>&1; then head=1; fi
        fi
      fi
      e() { printf %s "$1" | base64 | tr -d "\\n"; }
      printf "%s|%s|%s|%s|%s|%s|%s\\n" "$(e "$p")" "$(e "$real")" \\
        "$lnk" "$isdir" "$co" "$(e "$origin")" "$head"
      exit 0
    ' _ {} \\;) || { echo 'GJDERR could not list the code directory on the box'; exit 3; }
    if [ -z "$rows" ]; then n=0; else n=$(printf '%s\\n' "$rows" | wc -l | tr -d " "); fi
    printf '${INVENTORY_ROWS} %s\\n' "$n"
    [ -z "$rows" ] || printf '%s\\n' "$rows"
    echo ${INVENTORY_SENTINEL}`;
}

/** base64 back to text, or null if it is not valid base64 of valid UTF-8.
 *  Buffer.from ignores what it cannot read rather than throwing, so the only
 *  way to know it read the whole thing is to encode it again and compare. */
function decode(b64: string): string | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return null;
  return buf.toString("utf8");
}

/**
 * The box's reply into entries, or the reason there aren't any.
 *
 * FAILS CLOSED, and each clause is a way of getting a confident wrong answer:
 *
 *  - **No sentinel as the LAST line** — an empty `~/code` and a script that
 *    died on its first command look identical, and the caller reads the first
 *    as permission to clone. A sentinel that is present but not last is a
 *    reply something else got into.
 *  - **A count that does not match** — the guard that catches the next way of
 *    losing a row, whatever it turns out to be.
 *  - **A row that will not decode** is fatal to the whole listing, never
 *    skipped. Skipping is how a checkout that exists becomes an empty slot.
 */
export function parseInventory(
  stdout: string,
): { ok: true; entries: InventoryEntry[] } | { ok: false; why: string } {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return { ok: false, why: errLine.slice("GJDERR".length).trim() };

  const end = lines.length - 1;
  if (end < 0 || lines[end] !== INVENTORY_SENTINEL) {
    return {
      ok: false,
      why: lines.includes(INVENTORY_SENTINEL)
        ? "the box printed something after it had finished listing ~/code, so the reply is not the one this asked for"
        : "the box did not finish listing ~/code (no completion marker), so the list may be short",
    };
  }
  const body = lines.slice(0, end);

  const marked = (l: string, m: string) => l === m || l.startsWith(`${m} `);
  const counts = body.filter((l) => marked(l, INVENTORY_ROWS));
  if (counts.length !== 1) {
    return { ok: false, why: `the box gave ${counts.length} row counts, and this needs exactly one` };
  }
  const declared = new RegExp(`^${INVENTORY_ROWS} (0|[1-9]\\d{0,4})$`).exec(counts[0] as string);
  if (!declared) return { ok: false, why: `could not read the box's row count out of '${counts[0]}'` };

  const entries: InventoryEntry[] = [];
  for (const line of body) {
    if (marked(line, INVENTORY_ROWS)) continue;
    const e = parseInventoryRow(line);
    if (!e) return { ok: false, why: `the box sent a row this cannot read, so the listing is not trustworthy: '${line}'` };
    entries.push(e);
  }

  if (entries.length !== Number(declared[1])) {
    return {
      ok: false,
      why: `the box found ${declared[1]} entries under ~/code and ${entries.length} reached this laptop, so the list is not the box's`,
    };
  }
  return { ok: true, entries };
}

/** One line into an entry, or null if it is not exactly the record asked for.
 *  Seven fields, no more and no fewer, and every flag is `0` or `1` — a field
 *  this was not written against means the record came from something else, and
 *  guessing which half is which is how the tmux parser's two bugs happened. */
function parseInventoryRow(line: string): InventoryEntry | null {
  const parts = line.split("|");
  if (parts.length !== 7) return null;
  const [dirB64, realB64, lnk, isdir, co, originB64, head] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const flag = (v: string): boolean | null => (v === "0" ? false : v === "1" ? true : null);
  const isSymlink = flag(lnk);
  const isDir = flag(isdir);
  const isCheckout = flag(co);
  const hasHead = flag(head);
  if (isSymlink === null || isDir === null || isCheckout === null || hasHead === null) return null;

  const dir = decode(dirB64);
  const real = decode(realB64);
  const origin = decode(originB64);
  if (dir === null || real === null || origin === null) return null;
  // An entry with no path is not an entry. The other two are legitimately
  // empty — a directory the box could not resolve, a checkout with no origin —
  // and empty means unknown, which never matches anything.
  if (dir === "") return null;

  return {
    dir,
    realpath: real === "" ? undefined : real,
    isSymlink,
    isDir,
    isCheckout,
    origin: origin === "" ? undefined : origin,
    hasHead,
  };
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
    case "blocked":
      return `${describeBlocked(slug, r)}\n${NOTHING_TOUCHED}`;
    default: {
      const never: never = r;
      return String(never);
    }
  }
}

/** The last two lines of every blocked message. Said once, because it is the
 *  fact that matters most and the one a reader will look for: this command
 *  changed nothing on the box. */
const NOTHING_TOUCHED =
  `  Nothing was cloned and nothing was touched. Either say where it really is,\n` +
  `  with --dir, or move what is in the way.`;

/** One line per blocked reason, each naming what is actually there. The switch
 *  is exhaustive over `reason`, so a reason added to the union without a
 *  sentence here is a type error rather than a blank line. */
function describeBlocked(slug: string, r: Extract<RemoteCheckout, { kind: "blocked" }>): string {
  switch (r.reason) {
    case "other-repo":
      return (
        `${r.dir} on the box is not ${slug}.\n` +
        `  asked for: ${slug}\n` +
        `  found:     ${r.foundSlug}`
      );
    case "incomplete-checkout":
      return (
        `${r.dir} on the box is a half-finished checkout of ${slug}.\n` +
        `  Its origin is right, but HEAD does not resolve — a clone that was\n` +
        `  interrupted, or a repo that was init'd and never fetched. A session\n` +
        `  started there would look like the repo and have none of it.`
      );
    case "non-checkout":
      return `${r.dir} on the box exists and is not a git checkout at all.`;
    case "unrecognised-origin":
      return (
        `${r.dir} on the box is a checkout whose origin I do not recognise,\n` +
        `  so I cannot tell whether it is ${slug} or something else entirely.`
      );
    case "symlink":
      return (
        `${r.dir} on the box is a symlink.\n` +
        `  Symlinks are listed but never followed here — the tree it points at may\n` +
        `  be outside ~/code, and cloning over it would replace the link.`
      );
    case "unreadable":
      return `${r.dir} on the box is a directory this cannot enter, so nothing about it is known.`;
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
