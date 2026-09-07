/**
 * Is something in the index quietly undoing a commit?
 *
 *     npx tsx scripts/check-staged-revert.ts
 *
 * Exits non-zero when the staged content of a path is **byte-identical to what
 * that path held before one of its own commits** — that is, when a revert is
 * sitting in the index waiting for somebody to commit it by accident.
 *
 * ## Why this exists
 *
 * On 2026-08-29 the shared `.git/index` in this tree held, three times in one
 * day, what looked exactly like a precise back-out of one session's commits and
 * nothing else. The third looked worst: eight paths byte-identical to
 * `1fe0a8d^`, including a `src/fetch.ts` with **zero** occurrences of
 * `pinnedAgent` where `HEAD` had four. Committing it would have removed the
 * DNS-rebinding fix — connections made to an address nobody checked — under
 * whatever message the committer happened to be writing.
 *
 * ## It is staleness, not sabotage, and they are byte-identical
 *
 * The first draft of this file said something was targeting one session's
 * commits. **That was wrong**, and the way it was wrong is the useful part.
 * `git write-tree` on the shared index gave a tree exactly equal to `HEAD~2`'s:
 * a *clean snapshot of a commit*, not a hand-built revert of anything. A session
 * had read the index at that commit, two more commits landed, and the index
 * simply stayed where it was.
 *
 * A stale index is **indistinguishable from a deliberate revert**, because that
 * is what it is: content that predates the commits since. And it necessarily
 * looks *targeted at the newest commits*, since those are the only ones it can
 * predate — which is why three separate incidents all appeared to single out one
 * session. That was arithmetic, not malice. The six "staged deletions of one
 * session's files" were exactly the union of the files added by its last three
 * commits, which is what an index snapshotted before them must contain.
 *
 * The hazard is unchanged and this check is still worth running: committing a
 * stale index still destroys the work committed since. Only the diagnosis
 * changed, and with it the fix — nobody to find, just an index to refresh.
 *
 * ## Why nobody noticed, which is the part worth understanding
 *
 * Both sessions working in the tree were **immune, by two different routes**,
 * and immunity here means *not noticing*:
 *
 *  - `git commit -F msg -- <paths>` commits the working tree of those paths and
 *    ignores the index (docs/project/version-control.md — the same property
 *    that makes it a hazard when a peer has unfinished edits);
 *  - committing from a private `GIT_INDEX_FILE` never reads the shared index at
 *    all.
 *
 * Both are the forms this repo prescribes. So the revert sat there, harmless to
 * everyone who follows the rules and waiting for anyone who runs a bare
 * `git commit` or `git commit -a`. **A hazard that only bites people who do not
 * know about it, and is invisible to everyone who does, cannot be handled by a
 * note in a doc.** It needs a check that runs — which is the argument that got
 * this file written rather than left in a scratchpad.
 *
 * ## Why reading the diff does not work
 *
 * `git diff` is **index-relative**. With a revert staged, your own `git diff`
 * shows your patch *plus* a re-addition of all the work the revert removed — so
 * it looks like you are about to commit somebody else's feature. The instrument
 * has to be the staged blob's hash against history, not the diff.
 *
 * ## Three states, not two
 *
 * A path is `clean`, `reverted`, or **`unknown`** — and the third is why this is
 * not fifteen lines. If the search window does not reach far enough back
 * through a path's history, the honest answer is *I could not tell*, and it must
 * say so: a detector that goes quiet when it runs out of range looks exactly
 * like one reporting a clean index, which is the failure shape this whole file
 * is about. Raised by the other session on 2026-08-29, and it was right.
 *
 * **Until 2026-09-07 that third state exited 0**, so a run that judged nothing
 * printed a leading `✓` and passed. It is a `Judgement` now, and the exhaustive
 * switch over it is what makes "could not tell" impossible to spell as success.
 *
 * ## A merge is a different question, and it used to get the wrong answer
 *
 * During a merge the index legitimately holds content this branch never wrote.
 * Judged against `HEAD` alone, every deliberate deletion arriving from the other
 * side reads as a revert — and the advice attached to that verdict,
 * `git reset -- <path>`, *restores the file the other branch deleted*. The guard
 * against undoing committed work, causing it.
 *
 * Worse, the path-by-path shape could not see the accident that matters most.
 * A stale index equal to `HEAD` makes `git diff --cached HEAD` **empty**, so
 * there is nothing to iterate over; the check printed `✓ nothing in the index
 * undoes a commit`, and the `git commit` that followed produced a merge commit
 * with two parents and none of the incoming work in it. The incoming commit is
 * then an *ancestor* of the trunk, so every "did it land?" test says yes while
 * the code is gone. Reproduced in docs/plans/260907e.
 *
 * So mid-merge this asks one whole-tree question instead:
 *
 *     git merge-tree --write-tree HEAD MERGE_HEAD   # what the merge should be
 *     git write-tree                                # what is actually staged
 *
 * Equal is safe. Anything else — a mismatch, a conflict, an octopus, an old git
 * — is `unknown` and exits non-zero, and never suggests `reset`. It cannot
 * validate a human's conflict resolution, and does not pretend to: no comparison
 * of blobs can infer what somebody meant by keeping one side.
 *
 * **And standing down mid-merge is not an option**, which is the part worth
 * knowing. `git commit -F msg -- <paths>` — the recipe that makes a commit safe
 * from everyone else's index — is *refused* during a merge:
 * `fatal: cannot do a partial commit during a merge`. The only way to conclude a
 * merge is the whole-index `git commit` this file exists to guard. Mid-merge is
 * when it matters most, not least.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** How far back through one path's own history to look. */
const WINDOW = 40;

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/**
 * `git rev-parse`, but `null` rather than a throw when the object is absent.
 *
 * `stdio` silences the child's stderr as well as swallowing the exception.
 * Without it git's own `fatal: path 'x' exists on disk, but not in 'HEAD'` (an
 * added path) and `fatal: invalid object name '<root>^'` (the first commit)
 * printed straight through this function's "expected" failures and into the
 * report, where they read as the tool breaking.
 */
function objectId(rev: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", rev], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The merge this repository is in the middle of, if it is in one. */
interface Merge {
  /** `MERGE_HEAD`'s commits — more than one is an octopus, which we do not judge. */
  heads: string[];
}

function mergeInProgress(): Merge | null {
  let dir: string;
  try {
    dir = git(["rev-parse", "--absolute-git-dir"]);
  } catch {
    return null;
  }
  const file = path.join(dir, "MERGE_HEAD");
  if (!existsSync(file)) return null;
  try {
    return { heads: git(["rev-parse", "MERGE_HEAD"]).split("\n").filter(Boolean) };
  } catch {
    /* The file is there and unreadable: in a merge, and unable to say more. */
    return { heads: [] };
  }
}

/**
 * Whether the staged tree is exactly the merge git would have produced.
 *
 * Whole-tree, not path-by-path, and that is the point: the dangerous case is a
 * stale index equal to `HEAD`, where there are no differing paths to walk and
 * the incoming side vanishes without a single finding. Two tree object ids
 * either match or they do not.
 */
function mergeIsIntact(merge: Merge): { ok: true } | { ok: false; why: string } {
  if (merge.heads.length !== 1) {
    return { ok: false, why: `this is an octopus merge (${merge.heads.length} incoming heads), which is not judged here` };
  }

  let expected: string;
  try {
    /* merge-tree exits non-zero on conflicts but still prints the tree first;
       a genuine failure (git < 2.38) throws and is caught below. */
    expected = git(["merge-tree", "--write-tree", "HEAD", "MERGE_HEAD"]).split("\n")[0] ?? "";
  } catch (err) {
    const out = `${(err as { stdout?: string }).stdout ?? ""}`.split("\n")[0] ?? "";
    if (!/^[0-9a-f]{40,}$/.test(out.trim())) {
      return { ok: false, why: `git merge-tree could not say what this merge should produce (${(err as Error).message.split("\n")[0]})` };
    }
    expected = out.trim();
  }

  let actual: string;
  try {
    actual = git(["write-tree"]);
  } catch {
    return { ok: false, why: "the index has unresolved conflicts, so it has no tree to compare" };
  }

  if (expected === actual) return { ok: true };
  return {
    ok: false,
    why: "the staged tree is not the merge git would have produced on its own",
  };
}

type Finding =
  | { kind: "reverted"; path: string; commit: string; subject: string }
  | { kind: "deleted"; path: string; onDisk: boolean }
  | { kind: "unknown"; path: string; checked: number };

function findings(): Finding[] {
  const staged = git(["diff", "--cached", "--name-status", "HEAD"]);
  if (staged === "") return [];

  const out: Finding[] = [];
  for (const line of staged.split("\n")) {
    const [status, ...rest] = line.split("\t");
    const path = rest.at(-1);
    if (!path || !status) continue;

    /* **A staged deletion is its own finding.** Six of these — every one a file
       that session had created and committed — were the second of the three
       incidents. They are not "a revert of a commit" in the hash sense, because
       there is no blob to compare; the tell is that HEAD still has the file. */
    if (status.startsWith("D")) {
      let onDisk = false;
      try {
        onDisk = git(["ls-files", "--others", "--exclude-standard", "--", path]) === path;
      } catch {
        onDisk = false;
      }
      out.push({ kind: "deleted", path, onDisk });
      continue;
    }

    const stagedId = objectId(`:${path}`);
    const headId = objectId(`HEAD:${path}`);
    if (!stagedId || stagedId === headId) continue;

    /* Walk this path's own history, newest first, asking of each commit that
       touched it: is what is staged exactly what the path held *before* that
       commit? A yes means the index holds that commit undone. */
    const history = git(["rev-list", `--max-count=${WINDOW}`, "HEAD", "--", path])
      .split("\n")
      .filter(Boolean);

    let matched: string | null = null;
    for (const commit of history) {
      if (objectId(`${commit}^:${path}`) === stagedId) {
        matched = commit;
        break;
      }
    }

    if (matched) {
      out.push({
        kind: "reverted",
        path,
        commit: matched.slice(0, 7),
        subject: git(["log", "-1", "--format=%s", matched]),
      });
      continue;
    }

    /* Ran out of window rather than out of history: we did not reach the start
       of this path's life, so "no match" is not an answer. */
    if (history.length === WINDOW) out.push({ kind: "unknown", path, checked: WINDOW });
  }
  return out;
}

/**
 * If the whole index is a snapshot of some ancestor, say so and stop.
 *
 * **One line that explains every finding at once**, and far more useful than a
 * list of paths: it names staleness as the cause, gives the commit, and points
 * at a fix that is a refresh rather than a hunt. Checked first for that reason.
 */
function staleSnapshot(): { commit: string; behind: number; subject: string } | null {
  let tree: string;
  try {
    tree = git(["write-tree"]);
  } catch {
    return null;
  }
  const recent = git(["rev-list", "--max-count=60", "HEAD"]).split("\n").filter(Boolean);
  for (const [behind, commit] of recent.entries()) {
    if (git(["rev-parse", `${commit}^{tree}`]) === tree) {
      if (behind === 0) return null; // the index simply matches HEAD: nothing to say
      return { commit: commit.slice(0, 7), behind, subject: git(["log", "-1", "--format=%s", commit]) };
    }
  }
  return null;
}

/**
 * What this run concluded, as one closed set.
 *
 * The exhaustive `switch` in `main` is the mechanism: before this existed, a run
 * whose only output was `unknown` fell past the `reverts.length === 0 &&
 * deletes.length === 0` test, printed a leading `✓` and exited 0 — the failure
 * shape this whole file is about, in the file about it. There is now no way to
 * spell "could not tell" that also spells success.
 */
type Judgement =
  | { kind: "safe"; say: string }
  | { kind: "unsafe"; lines: string[] }
  | { kind: "unknown"; lines: string[] };

/** The merge path: one whole-tree question, no per-path walk. */
function judgeMerge(merge: Merge): Judgement {
  const intact = mergeIsIntact(merge);
  if (intact.ok) {
    return { kind: "safe", say: "✓ a merge is in progress, and the index is exactly the merge git would have made" };
  }
  return {
    kind: "unknown",
    lines: [
      `? a merge is in progress and this index cannot be vouched for:`,
      `    ${intact.why}`,
      "",
      "  That is expected if you resolved conflicts by hand — no comparison of blobs can",
      "  tell a considered resolution from a mistake, so this stands aside rather than",
      "  guessing. Check it yourself before committing:",
      "",
      "    git diff HEAD          what the merge does to your side",
      "    git diff MERGE_HEAD    what it does to theirs — look for work of theirs going missing",
      "",
      "  Do NOT run `git reset` here. Mid-merge it restores HEAD's copy of files the other",
      "  side deleted, and the merge commit then silently drops their work.",
    ],
  };
}

function main(): void {
  /* Asked first: during a merge the per-path walk below is not merely noisy, it
     is blind to the worst case (a stale index equal to HEAD has no differing
     paths at all). See the header. */
  const merge = mergeInProgress();
  if (merge !== null) {
    report(judgeMerge(merge));
    return;
  }

  report(judgeIndex());
}

/** The ordinary, not-mid-a-merge judgement. */
function judgeIndex(): Judgement {
  const stale = staleSnapshot();
  if (stale) {
    return {
      kind: "unsafe",
      lines: [
        `✗ The index is a clean snapshot of ${stale.commit}, ${stale.behind} commit(s) behind HEAD —`,
        `    "${stale.subject}"`,
        "",
        "  Nothing has been hand-reverted. The index was read at that commit and left there while",
        "  others landed, and a stale index is byte-identical to a revert of everything since.",
        `  Committing it would undo those ${stale.behind} commit(s).`,
        "",
        "  Fix: `git reset` (no paths, no --hard) refreshes the index from HEAD and touches no",
        "  file on disk. Do that only when nobody else has work staged.",
      ],
    };
  }

  const found = findings();
  const reverts = found.filter((f) => f.kind === "reverted");
  const deletes = found.filter((f) => f.kind === "deleted");
  const unknowns = found.filter((f) => f.kind === "unknown");

  const lines: string[] = [];
  for (const f of found) {
    switch (f.kind) {
      case "reverted":
        lines.push(`✗ ${f.path}`);
        lines.push(`    staged content is exactly what this path held before ${f.commit} — "${f.subject}"`);
        break;
      case "deleted":
        lines.push(`✗ ${f.path}`);
        lines.push(`    staged for DELETION though HEAD still has it${f.onDisk ? ", and it is still on disk" : ""}`);
        break;
      case "unknown":
        lines.push(`? ${f.path}`);
        lines.push(`    could not tell — searched ${f.checked} commits and did not reach the start`);
        break;
    }
  }

  if (reverts.length > 0 || deletes.length > 0) {
    lines.push(
      "",
      "The index holds an undo of committed work. Usually this is staleness rather than",
      "anybody's intent — see docs/project/version-control.md § A stale index is a revert.",
      "Do NOT `git commit` or `git commit -a` until it is cleared; `git reset -- <those paths>`",
      "restores the index from HEAD and touches no file on disk.",
      "",
      "Note that `git diff` will NOT show you this — it is index-relative, so a staged revert",
      "makes your own patch look like it re-adds work you never touched.",
    );
    return { kind: "unsafe", lines };
  }

  /* **Not a `✓`.** Until 2026-09-07 this branch printed one and exited 0, so a
     run that judged nothing was indistinguishable from a run that found nothing
     — the exact shape docs/reusable/silent-success.md is about. */
  if (unknowns.length > 0) {
    lines.push(
      "",
      `${unknowns.length} path(s) could not be judged, so this run cannot tell you the index is safe.`,
      "Look at the staged content of those paths yourself: `git show :<path>` is what would be",
      "committed, and `git show HEAD:<path>` is what is there now.",
    );
    return { kind: "unknown", lines };
  }

  return { kind: "safe", say: "✓ nothing in the index undoes a commit" };
}

/**
 * The one place an outcome becomes an exit code.
 *
 * Exhaustive on purpose, with no `default`: adding a fourth state to `Judgement`
 * has to fail the typecheck here rather than quietly inherit whatever the last
 * branch did. Only `safe` exits 0.
 */
function report(j: Judgement): void {
  switch (j.kind) {
    case "safe":
      console.log(j.say);
      return;
    case "unsafe":
    case "unknown":
      for (const line of j.lines) console.log(line);
      process.exitCode = 1;
      return;
    default: {
      const never: never = j;
      throw new Error(`unhandled judgement: ${JSON.stringify(never)}`);
    }
  }
}

main();
