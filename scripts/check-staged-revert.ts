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
 */
import { execFileSync } from "node:child_process";

/** How far back through one path's own history to look. */
const WINDOW = 40;

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** `git show`, but `null` rather than a throw when the object is absent. */
function objectId(rev: string): string | null {
  try {
    return git(["rev-parse", rev]);
  } catch {
    return null;
  }
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

function main(): void {
  const stale = staleSnapshot();
  if (stale) {
    console.log(
      `✗ The index is a clean snapshot of ${stale.commit}, ${stale.behind} commit(s) behind HEAD —\n` +
        `    "${stale.subject}"\n\n` +
        `  Nothing has been hand-reverted. The index was read at that commit and left there while\n` +
        `  others landed, and a stale index is byte-identical to a revert of everything since.\n` +
        `  Committing it would undo those ${stale.behind} commit(s).\n\n` +
        `  Fix: \`git reset\` (no paths, no --hard) refreshes the index from HEAD and touches no\n` +
        `  file on disk. Do that only when nobody else has work staged.`,
    );
    process.exitCode = 1;
    return;
  }

  const found = findings();
  const reverts = found.filter((f) => f.kind === "reverted");
  const deletes = found.filter((f) => f.kind === "deleted");
  const unknowns = found.filter((f) => f.kind === "unknown");

  for (const f of reverts) {
    if (f.kind !== "reverted") continue;
    console.log(`✗ ${f.path}`);
    console.log(`    staged content is exactly what this path held before ${f.commit} — "${f.subject}"`);
  }
  for (const f of deletes) {
    if (f.kind !== "deleted") continue;
    console.log(`✗ ${f.path}`);
    console.log(
      `    staged for DELETION though HEAD still has it${f.onDisk ? ", and it is still on disk" : ""}`,
    );
  }
  for (const f of unknowns) {
    if (f.kind !== "unknown") continue;
    console.log(`? ${f.path}`);
    console.log(`    could not tell — searched ${f.checked} commits and did not reach the start`);
  }

  if (reverts.length === 0 && deletes.length === 0) {
    console.log(
      unknowns.length === 0
        ? "✓ nothing in the index undoes a commit"
        : `✓ no revert found, but ${unknowns.length} path(s) could not be judged — see above`,
    );
    return;
  }

  console.log(
    "\nThe index holds an undo of committed work. Usually this is staleness rather than\n" +
      "anybody's intent — see docs/project/version-control.md § A stale index is a revert.\n" +
      "Do NOT `git commit` or `git commit -a` until it is cleared; `git reset -- <those paths>`\n" +
      "restores the index from HEAD and touches no file on disk.\n\n" +
      "Note that `git diff` will NOT show you this — it is index-relative, so a staged revert\n" +
      "makes your own patch look like it re-adds work you never touched.",
  );
  process.exitCode = 1;
}

main();
