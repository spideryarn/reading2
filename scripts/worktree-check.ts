/**
 * **Is it safe to delete this worktree?** Run it inside the worktree:
 *
 *     npm run worktree:check
 *
 * Answers one question and refuses to guess at it: *if this directory were
 * deleted right now, would anything be lost?* Nothing here writes, moves or
 * removes anything — the removal itself stays a human's keystroke, which is
 * the whole reason this can afford to be blunt about what it does not know.
 *
 * `scripts/worktree-sweep.ts` calls `blockers(gather(path))` for its per-tree
 * verdict rather than deriving a weaker one from `git status`. That is the
 * seam: everything below is root-relative and read-only.
 *
 * ## Why `git status` is not this check
 *
 * The trap is written up in docs/project/worktrees.md § Traps and it is the
 * reason this file exists: **`data/` and `.env.local` are gitignored**, so a
 * clean `git status` reports "nothing to see" over the top of a pipeline run
 * that cost money. Claude Code's own worktree cleanup has the same blind spot,
 * and so does git itself: `git worktree remove` refuses over modified and
 * untracked files but **not** over ignored ones. So for the case that matters
 * most — an unfixtured `data/` — nothing else is looking, and `blockers()` is
 * the only guard.
 *
 * Four things git will not volunteer, then:
 *
 * - ignored files, via `--ignored=matching`, classified rather than counted —
 *   and the ones copied in at creation are *compared against the primary's
 *   copy*, because "there is a copy elsewhere" is a claim, not an assumption;
 * - tracked files hidden from `git status` by `assume-unchanged` or
 *   `skip-worktree`, which is a per-worktree index bit and so goes with the
 *   directory;
 * - whether the commits **landed** — `merge-base --is-ancestor` against a
 *   freshly fetched trunk, not "is there anything unpushed", which is what the
 *   native sweep asks and is a different question;
 * - a merge, cherry-pick, rebase or bisect left half-finished, which can sit in
 *   a git dir with a clean-looking work tree.
 *
 * ## Fail closed, everywhere
 *
 * Every unknown counts as a blocker: a fetch that fails, a git command that
 * errors, an ignored path nobody recognises. The cost of a false "not yet" is
 * that somebody reads a list; the cost of a false "safe" is an agent's only
 * copy of a day's work. Those are not the same size.
 *
 * **The first draft got that wrong in one place, and a GPT Sol review caught
 * it**: `.env.local` was a note rather than a blocker, so a worktree whose only
 * uncommitted state was an edited `.env.local` printed SAFE and exited 0. A
 * note now means *compared, and identical* — a fact rather than a shrug, which
 * is what makes exiting 0 honest.
 *
 * ## What it still cannot see, on purpose
 *
 * File modes, xattrs and empty directories under `data/`; a commit reachable
 * only through this worktree's HEAD reflog, which needs a branch-moving
 * operation AGENTS.md bans; and anything held only in the session's context.
 * Named here rather than left for the next reader to discover.
 *
 * ## What this deliberately does not do
 *
 * **No removal, and no `--all`.** Removal is `scripts/worktree-sweep.ts`, which
 * is guarded and per-branch, and reading across every tree is its job too —
 * including the age floor that keeps it off a live worktree, which would be
 * wrong here: this command answers for the tree you are standing in, and you
 * are standing in it.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMain } from "../src/is-main.js";
import { CORPUS_HALVES, CORPUS_ROOT } from "./corpus-materialise.js";
import { TRUNK_BRANCH } from "./deploy-checks.js";
import { gitCommonDir, inLinkedWorktree } from "./worktree-port.js";

/* ---------------------------------------------------------------- facts -- */

/** How this tree stands against the trunk on the remote. */
export type TrunkStanding =
  | { kind: "landed" }
  /** Commits here that the trunk has never seen. */
  | { kind: "ahead"; commits: string[] }
  /** Could not find out. Counts against the tree, never for it. */
  | { kind: "unknown"; why: string };

export interface CheckFacts {
  /** False in the primary checkout, which is never a thing to remove. */
  linked: boolean;
  /** `undefined` on a detached HEAD. */
  branch: string | undefined;
  /** `merge`, `cherry-pick`, `rebase`, `bisect` — anything left half-applied. */
  inProgress: string[];
  /** `git status --porcelain=v1 -uall` lines: staged, modified, untracked. */
  dirty: string[];
  /** Tracked paths this worktree's index has told `git status` to ignore. */
  hidden: string[];
  /** Ignored paths git has no copy of and nothing here can explain. */
  unexplained: string[];
  /** Ignored paths that are fine but worth an eye. Never blocks. */
  notes: string[];
  /**
   * Things this looked at properly and found nothing in. Said out loud, because
   * a check that stays silent whether or not it ran is not evidence —
   * docs/reusable/silent-success.md.
   */
  verified: string[];
  /** Ignored paths recognised as rebuildable. Counted, not listed. */
  disposable: number;
  trunk: TrunkStanding;
}

export interface Blocker {
  why: string;
  detail: string[];
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The whole judgement, as a pure function of the facts, so the awkward
 * combinations can be tested without a repository to arrange them in.
 *
 * Order is worst-first: a tree that is both dirty and unmerged should read as
 * "you have uncommitted work" before it reads as "you have unpushed commits",
 * because that is the order you have to fix them in.
 */
export function blockers(f: CheckFacts): Blocker[] {
  const out: Blocker[] = [];

  if (!f.linked) {
    out.push({
      why: "this is the primary checkout, not a worktree",
      detail: [
        "Nothing to remove here, and the answer below is about the shared tree",
        "a dozen agents work out of. Run this inside a worktree instead.",
      ],
    });
  }

  if (f.inProgress.length > 0) {
    out.push({
      why: `a ${f.inProgress.join(" and ")} is half-finished`,
      detail: [
        "The state lives in the worktree's git dir and goes with the directory.",
        "Finish it or abort it before deciding anything about removal.",
      ],
    });
  }

  if (f.dirty.length > 0) {
    out.push({
      why: `${f.dirty.length} uncommitted or untracked ${plural(f.dirty.length, "file", "files")}`,
      detail: f.dirty,
    });
  }

  if (f.hidden.length > 0) {
    out.push({
      why: `${f.hidden.length} tracked ${plural(f.hidden.length, "file is", "files are")} hidden from git status`,
      detail: [
        ...f.hidden,
        "",
        "`assume-unchanged` or `skip-worktree` is set, so an edit to one of these shows",
        "up nowhere. The bit is in this worktree's own index, so it goes with the",
        "directory and so does the edit.",
        "clear it:  git update-index --no-assume-unchanged --no-skip-worktree -- <path>",
      ],
    });
  }

  if (f.unexplained.length > 0) {
    out.push({
      why: `${f.unexplained.length} ignored ${plural(f.unexplained.length, "path", "paths")} git has no copy of`,
      detail: [
        ...f.unexplained,
        "",
        "Gitignored, so committing and pushing will not save these. Move anything",
        "worth keeping out of the tree first — docs/project/worktrees.md § Traps.",
      ],
    });
  }

  if (f.trunk.kind === "ahead") {
    const n = f.trunk.commits.length;
    out.push({
      why: `${n} ${plural(n, "commit", "commits")} that origin/${TRUNK_BRANCH} does not have`,
      detail: [
        ...f.trunk.commits,
        "",
        `land them:  git fetch origin ${TRUNK_BRANCH} && git merge origin/${TRUNK_BRANCH} && git push origin HEAD:${TRUNK_BRANCH}`,
      ],
    });
  }

  if (f.trunk.kind === "unknown") {
    out.push({
      why: `could not tell whether this work is on origin/${TRUNK_BRANCH}`,
      detail: [f.trunk.why, "Unknown counts as unsafe. Fix the fetch and ask again."],
    });
  }

  return out;
}

/* ------------------------------------------------- ignored-file triage -- */

/**
 * Ignored paths that can be rebuilt or refetched, so losing them costs time
 * and nothing else.
 *
 * A trailing slash means **prefix**, matched against git's own spelling — a
 * wholly ignored directory comes back from `--ignored=matching` as one entry
 * with a trailing slash. Anything without one must match **exactly**: a bare
 * `startsWith` here made `.DS_Store-important` disposable (GPT Sol, finding 5).
 */
export const DISPOSABLE_IGNORED = [
  "node_modules/",
  "dist/",
  "api-dist/",
  ".playwright-mcp/",
  "supabase/.temp/",
  "supabase/.branches/",
  ".vercel/",
  "scratch-bakeoff/",
  ".DS_Store",
] as const;

/**
 * Ignored paths that are here because something copied them in, and whose
 * original is in the primary checkout.
 *
 * **The copy is checked, not assumed.** These were plain notes until a review
 * pointed out that an edited `.env.local` — a key added for a spike, a URL
 * pointed somewhere else — is uncommittable, uncopied work, and that the check
 * printed SAFE over it.
 */
export const COPIED_FROM_PRIMARY: Record<string, string> = {
  ".env.local": "`.worktreeinclude` copies it in when the worktree is created",
  ".env": "`.worktreeinclude` copies it in when the worktree is created",
  ".claude/settings.local.json": "this machine's permission grants, written by Claude Code",
};

export type IgnoredVerdict = "disposable" | "copied-from-primary" | "corpus-half" | "unexplained";

/**
 * What one line of `git status --ignored=matching` means for removal.
 *
 * The corpus halves get their own verdict rather than an allowlist entry: a
 * worktree's `data/` is a *copy* of `tests/fixtures/data-root/data/` right up
 * until somebody runs a pipeline stage in there, and it is exactly that run
 * this check exists to notice. Deciding it needs the files, so the caller does
 * it — see `corpusStrays`.
 *
 * Git quotes any path with an awkward character in it, and nothing here
 * un-quotes. That is the safe direction: a quoted path starts with `"`, matches
 * nothing below, and comes out `unexplained`.
 */
export function classifyIgnored(p: string): IgnoredVerdict {
  if (DISPOSABLE_IGNORED.some((d) => (d.endsWith("/") ? p.startsWith(d) : p === d))) return "disposable";
  /* run-codex writes one of these beside every review answer, a megabyte of
     whatever it read on the way. `.gitignore` says the review belongs in git
     and the log does not. */
  if (p.endsWith(".activity.log")) return "disposable";
  if (p in COPIED_FROM_PRIMARY) return "copied-from-primary";
  if (CORPUS_HALVES.some((h) => p === `${h}/`)) return "corpus-half";
  return "unexplained";
}

/* --------------------------------------------- comparing to the original -- */

export type CopyVerdict = { kind: "same" } | { kind: "differs" } | { kind: "only-here" } | { kind: "unreadable"; why: string };

/**
 * Is this file the same as the primary checkout's copy of it?
 *
 * `only-here` and `unreadable` both block. `only-here` is the interesting one:
 * it is what a file the setup script knows nothing about looks like, and it is
 * indistinguishable from a copy somebody deleted over there.
 */
export function comparedWithPrimary(root: string, primary: string, rel: string): CopyVerdict {
  const theirs = path.join(primary, rel);
  if (!existsSync(theirs)) return { kind: "only-here" };
  try {
    return digest(path.join(root, rel)) === digest(theirs) ? { kind: "same" } : { kind: "differs" };
  } catch (err) {
    return { kind: "unreadable", why: (err as Error).message };
  }
}

/** The primary checkout's root, from anywhere in it or in one of its worktrees. */
export function primaryRoot(root: string): string {
  return path.dirname(gitCommonDir(root));
}

/* ----------------------------------------------------- the corpus halves -- */

interface CorpusEntry {
  rel: string;
  /** `other` is a FIFO, socket, or anything else this will not vouch for. */
  kind: "file" | "symlink" | "other";
}

/** Every entry under `dir`, as paths relative to it. `[]` if it is not there. */
function entriesUnder(dir: string): CorpusEntry[] {
  if (!existsSync(dir)) return [];
  const out: CorpusEntry[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      /* Symlinks first, and not followed: a link to a directory is one entry
         rather than a subtree, and never a loop. Dropping them entirely is what
         the first draft did, and a symlink into a generated location is real
         work that then vanished from the comparison (GPT Sol, finding 3). */
      if (entry.isSymbolicLink()) out.push({ rel: next, kind: "symlink" });
      else if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push({ rel: next, kind: "file" });
      else out.push({ rel: next, kind: "other" });
    }
  };
  walk("");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

const digest = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * Entries under a corpus half — `data/`, `output/` — that the committed fixture
 * corpus does not account for: a path it does not have, a path whose contents
 * have changed, a symlink pointing somewhere else, or anything that is not the
 * same kind of thing on both sides.
 *
 * Hashing is bounded by the *corpus*, not by the tree: an extra path is
 * unexplained without reading it, so only the paths present in both get opened.
 * That is 58 files and 1.4 MB as this was written.
 *
 * A file the corpus has and the tree does not is not reported. Deleting a
 * fixture copy loses nothing — the original is committed.
 *
 * **Not compared**: file modes, xattrs, and empty directories. A `data/` full of
 * JSON has no meaningful execute bit, and saying so here is cheaper than a
 * `stat` per file that nothing would ever act on.
 */
export function corpusStrays(root: string, half: string): string[] {
  const here = path.join(root, half);
  const from = path.join(root, CORPUS_ROOT, half);
  const fixture = new Map(entriesUnder(from).map((e) => [e.rel, e]));
  const strays: string[] = [];

  for (const entry of entriesUnder(here)) {
    const original = fixture.get(entry.rel);
    const name = `${half}/${entry.rel}`;

    if (!original || original.kind !== entry.kind) {
      strays.push(entry.kind === "file" ? name : `${name}  (${entry.kind})`);
      continue;
    }
    if (entry.kind === "symlink") {
      if (readlinkSync(path.join(here, entry.rel)) !== readlinkSync(path.join(from, entry.rel))) {
        strays.push(`${name}  (symlink, pointing somewhere else)`);
      }
      continue;
    }
    if (entry.kind === "other") {
      strays.push(`${name}  (not a file or a symlink, and nothing here can vouch for it)`);
      continue;
    }
    if (digest(path.join(here, entry.rel)) !== digest(path.join(from, entry.rel))) {
      strays.push(`${name}  (differs from the fixture)`);
    }
  }
  return strays;
}

/* -------------------------------------------------------------- gather -- */

interface Ran {
  ok: boolean;
  out: string;
  status: number | null;
}

function run(cwd: string, args: string[], timeout?: number): Ran {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", ...(timeout === undefined ? {} : { timeout }) });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error) return { ok: false, out: out === "" ? r.error.message : `${out} (${r.error.message})`, status: null };
  return { ok: r.status === 0, out, status: r.status };
}

/** Half-applied operations, read from the worktree's own git dir. */
function inProgressOps(root: string): string[] {
  const dir = run(root, ["rev-parse", "--absolute-git-dir"]);
  if (!dir.ok) return [];
  const g = dir.out;
  const ops: string[] = [];
  if (existsSync(path.join(g, "MERGE_HEAD"))) ops.push("merge");
  if (existsSync(path.join(g, "CHERRY_PICK_HEAD"))) ops.push("cherry-pick");
  if (existsSync(path.join(g, "REVERT_HEAD"))) ops.push("revert");
  if (existsSync(path.join(g, "rebase-merge")) || existsSync(path.join(g, "rebase-apply"))) ops.push("rebase");
  /* A clean bisect session has nothing in the work tree to notice, and losing
     it loses the search rather than a file. */
  if (existsSync(path.join(g, "BISECT_LOG"))) ops.push("bisect");
  return ops;
}

/**
 * Tracked files this worktree's index has told `git status` to stop looking at.
 *
 * `git ls-files -v` tags every path: a **lowercase** letter means
 * `assume-unchanged`, `S` means `skip-worktree`. Either way an edit to the file
 * appears in no status output at all, and the bit lives in the worktree's own
 * index — so it goes with the directory, and so does the edit (GPT Sol,
 * finding 2).
 */
export function hiddenFromStatus(lsFilesV: string): string[] {
  const out: string[] = [];
  for (const line of lsFilesV.split("\n")) {
    const tag = line[0];
    if (tag === undefined || line[1] !== " ") continue;
    if (tag === "S" || (tag >= "a" && tag <= "z")) out.push(`${tag} ${line.slice(2)}`);
  }
  return out;
}

/**
 * Has this tree's history reached the trunk?
 *
 * **Fetch first, every time, and then read what the fetch wrote.** A
 * remote-tracking ref that was current an hour ago answers a question about an
 * hour ago, and this answer gets used to justify deleting things.
 *
 * The first draft fetched and then compared against `origin/${trunk}`, which a
 * remapped or absent `remote.origin.fetch` refspec leaves untouched by a
 * perfectly successful fetch — so a stale local ref could say "landed" (GPT
 * Sol, finding 4). Fetching `refs/heads/${trunk}` explicitly and testing
 * `FETCH_HEAD` reads the ref this very command just retrieved, and `FETCH_HEAD`
 * is per-worktree, so a peer fetching at the same moment cannot move it under
 * us.
 *
 * A failed fetch is `unknown`, never `landed`. So is a hung one: the timeout
 * kills it, and a killed process is not a successful one.
 */
export function standingAgainstTrunk(root: string, trunk: string = TRUNK_BRANCH): TrunkStanding {
  const fetched = run(root, ["fetch", "origin", `refs/heads/${trunk}`], 120_000);
  if (!fetched.ok) {
    return { kind: "unknown", why: `git fetch origin refs/heads/${trunk} failed: ${fetched.out.split("\n").slice(-3).join(" ")}` };
  }

  const head = run(root, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  if (!head.ok) return { kind: "unknown", why: `the fetch reported success but FETCH_HEAD does not resolve: ${head.out}` };

  const ancestor = run(root, ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"]);
  if (ancestor.status === 0) return { kind: "landed" };
  if (ancestor.status !== 1) return { kind: "unknown", why: `git merge-base exited ${ancestor.status}: ${ancestor.out}` };

  const log = run(root, ["log", "--oneline", "--no-decorate", "FETCH_HEAD..HEAD"]);
  if (!log.ok) return { kind: "unknown", why: `HEAD is not on the trunk, and git log could not say what is missing: ${log.out}` };
  return { kind: "ahead", commits: log.out === "" ? ["(git log listed nothing, which should not happen)"] : log.out.split("\n") };
}

/** What the `--ignored=matching` lines came to, once each was chased down. */
export interface IgnoredTriage {
  unexplained: string[];
  notes: string[];
  verified: string[];
  disposable: number;
}

/**
 * Chase down every ignored path git reported.
 *
 * Its own function because it is the half of `gather` with the judgement in it,
 * and because the loop wants reading on its own: four verdicts, two of which
 * go and look at other files before deciding.
 */
export function triageIgnored(root: string, linked: boolean, ignoredLines: string): IgnoredTriage {
  const t: IgnoredTriage = { unexplained: [], notes: [], verified: [], disposable: 0 };

  const primary = whereTheOriginalsAre(root, linked);

  for (const line of ignoredLines.split("\n")) {
    if (!line.startsWith("!! ")) continue;
    const p = line.slice(3);

    switch (classifyIgnored(p)) {
      case "disposable":
        t.disposable += 1;
        break;
      case "copied-from-primary":
        copiedFromPrimary(t, root, primary, p);
        break;
      case "corpus-half":
        corpusHalf(t, root, linked, p);
        break;
      default:
        t.unexplained.push(p);
    }
  }
  return t;
}

/**
 * Where the originals of the copied-in files live, from here.
 *
 * A union rather than a `string | undefined`, because there are three answers
 * and only one of them is a path: standing in the primary means there is
 * nothing to compare against and nothing wrong, while failing to *find* the
 * primary from a worktree blocks. Collapsing those two into `undefined` printed
 * "could not find the primary checkout" in the primary itself.
 */
type Originals = { kind: "is-the-primary" } | { kind: "at"; root: string } | { kind: "not-found"; why: string };

function whereTheOriginalsAre(root: string, linked: boolean): Originals {
  if (!linked) return { kind: "is-the-primary" };
  try {
    return { kind: "at", root: primaryRoot(root) };
  } catch (err) {
    return { kind: "not-found", why: (err as Error).message };
  }
}

function copiedFromPrimary(t: IgnoredTriage, root: string, primary: Originals, p: string): void {
  if (primary.kind === "is-the-primary") {
    t.notes.push(`${p} — the original, which every worktree gets a copy of`);
    return;
  }
  if (primary.kind === "not-found") {
    t.unexplained.push(`${p} — could not find the primary checkout to compare it against: ${primary.why}`);
    return;
  }
  const verdict = comparedWithPrimary(root, primary.root, p);
  if (verdict.kind === "same") t.verified.push(`${p} is byte-for-byte the primary's copy — ${COPIED_FROM_PRIMARY[p]}`);
  else if (verdict.kind === "differs") t.unexplained.push(`${p} — DIFFERS from the primary's copy, so what was changed here exists nowhere else`);
  else if (verdict.kind === "only-here") t.unexplained.push(`${p} — the primary has no copy of this`);
  else t.unexplained.push(`${p} — could not be compared with the primary's copy: ${verdict.why}`);
}

function corpusHalf(t: IgnoredTriage, root: string, linked: boolean, p: string): void {
  /* In the primary, `data/` is the real article store rather than a fixture
     copy, and walking it would report thousands of "strays" about a tree
     nobody is deleting. */
  if (!linked) {
    t.notes.push(`${p} — the primary's real store, not checked`);
    return;
  }
  const half = p.replace(/\/$/, "");
  const strays = corpusStrays(root, half);
  if (strays.length === 0) t.verified.push(`${p} matches ${CORPUS_ROOT}/${half}/ file for file`);
  else t.unexplained.push(...strays);
}

export function gather(root: string): CheckFacts {
  let linked = false;
  try {
    linked = inLinkedWorktree(root);
  } catch {
    /* Answering "no" makes the primary blocker fire, which is the cautious
       direction: it says so rather than assuming this is a worktree. */
  }

  const branch = run(root, ["branch", "--show-current"]);
  const status = run(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const ignored = run(root, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"]);
  const lsFiles = run(root, ["ls-files", "-v"]);

  const dirty = status.ok ? status.out.split("\n").filter((l) => l !== "" && !l.startsWith("!! ")) : [`(git status failed: ${status.out})`];
  const hidden = lsFiles.ok ? hiddenFromStatus(lsFiles.out) : [`(git ls-files -v failed: ${lsFiles.out})`];
  const triaged = ignored.ok
    ? triageIgnored(root, linked, ignored.out)
    : { unexplained: [`(could not list ignored files: ${ignored.out})`], notes: [], verified: [], disposable: 0 };

  return {
    linked,
    branch: branch.ok && branch.out !== "" ? branch.out : undefined,
    inProgress: inProgressOps(root),
    dirty,
    hidden,
    ...triaged,
    trunk: standingAgainstTrunk(root),
  };
}

/* ---------------------------------------------------------------- report -- */

export interface Report {
  lines: string[];
  safe: boolean;
}

/**
 * What the command prints, and whether it exits 0 — pure, and the two produced
 * together, so a test can hold them against each other. `main()` is then thin
 * enough to read in one go, which matters because "always printed SAFE" is a
 * bug with no error message.
 */
export function report(facts: CheckFacts): Report {
  const found = blockers(facts);
  const lines: string[] = [];

  lines.push(`  ·    branch: ${facts.branch ?? "(detached HEAD)"}`);
  if (facts.trunk.kind === "landed") lines.push(`  ok   every commit here is on origin/${TRUNK_BRANCH}`);
  if (facts.dirty.length === 0) lines.push("  ok   nothing uncommitted or untracked");
  if (facts.hidden.length === 0) lines.push("  ok   nothing tracked is hidden from git status");
  for (const v of facts.verified) lines.push(`  ok   ${v}`);
  if (facts.disposable > 0) {
    lines.push(`  ·    ${facts.disposable} ignored ${plural(facts.disposable, "entry", "entries")} rebuildable (node_modules, dist, …)`);
  }
  for (const n of facts.notes) lines.push(`  ·    ${n}`);
  lines.push("");

  for (const b of found) {
    lines.push(`  FAIL ${b.why}`);
    for (const line of b.detail) lines.push(`       ${line}`);
    lines.push("");
  }

  if (found.length === 0) {
    lines.push(`  SAFE TO REMOVE — nothing here that is not also on origin/${TRUNK_BRANCH}`);
    lines.push("");
    lines.push("  Not checked, and worth a thought yourself: file modes under data/, a commit");
    lines.push("  reachable only through this worktree's HEAD reflog, and whatever is only in");
    lines.push("  the session's context. docs/project/worktrees.md § Before you remove one.");
    lines.push("");
    return { lines, safe: true };
  }

  lines.push(`  DO NOT REMOVE — ${found.length} ${plural(found.length, "blocker", "blockers")} above.`);
  lines.push("");
  return { lines, safe: false };
}

/* ----------------------------------------------------------------- cli -- */

function main(argv: string[]): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const say = (s = "") => console.log(s);

  /* Silently ignoring an argument is how `worktree:check -- ../other-tree`
     comes to look like it checked the other tree. It did not: `root` is this
     file's own directory, so the answer is always about the checkout this copy
     of the script lives in. Reading across trees is `npm run worktree:sweep`,
     which imports `gather` rather than shelling out here for that reason. */
  if (argv.length > 0) {
    say(`\nworktree:check takes no arguments, and got: ${argv.join(" ")}`);
    say("It answers for the worktree it is run from. For every tree at once: npm run worktree:sweep\n");
    process.exit(2);
  }

  say(`\nworktree:check  ${root}`);
  say();
  const { lines, safe } = report(gather(root));
  for (const line of lines) say(line);
  if (!safe) process.exit(1);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
