/**
 * "Is it safe to delete this worktree?", and the ways that question gets
 * answered wrongly.
 *
 * The failure this guards against has no error message: a check that says SAFE
 * over the top of work nobody has a second copy of. So most of what is here
 * asserts a *blocker fires* — the direction that costs a person a list to read
 * when it is wrong, rather than a day's work.
 *
 * **The last describe block is the one that matters.** A GPT Sol review pointed
 * out that every test in the first version still passed if `gather()` stopped
 * gathering: they all fed hand-written facts to the pure judgement and never
 * asked whether anything filled those facts in. So there is a real repository
 * with a real linked worktree down there, and its first case is the false-safe
 * the same review found — an edited `.env.local`, which used to print SAFE.
 *
 * Watched red on purpose, each against the version of the code that had the
 * bug: the fetch failure that fell through to a stale ancestry check, the
 * path-set comparison that called an overwritten fixture identical, and the
 * three real-worktree cases below.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CORPUS_ROOT } from "../scripts/corpus-materialise.js";
import {
  blockers,
  type CheckFacts,
  classifyIgnored,
  comparedWithPrimary,
  corpusStrays,
  gather,
  hiddenFromStatus,
  listenersUnder,
  logStrays,
  report,
  standingAgainstTrunk,
} from "../scripts/worktree-check.js";

const git = (args: string[], cwd: string): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function commit(cwd: string, file: string, body: string, message: string): void {
  const full = path.join(cwd, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  git(["add", "--", file], cwd);
  git(["commit", "--quiet", "-m", message], cwd);
}

function identify(cwd: string): void {
  git(["config", "user.email", "test@example.com"], cwd);
  git(["config", "user.name", "Test"], cwd);
}

/** A tree with nothing wrong with it. Each test spoils one thing. */
const clean: CheckFacts = {
  linked: true,
  branch: "worktree-thing",
  inProgress: [],
  dirty: [],
  hidden: [],
  unexplained: [],
  notes: [],
  verified: ["data/ matches the fixtures"],
  disposable: 3,
  trunk: { kind: "landed" },
  listeners: { kind: "checked", found: [] },
};

describe("listenersUnder", () => {
  const line = (addr: string, pid: number) =>
    `LISTEN 0      511      ${addr}       0.0.0.0:*    users:(("node-MainThread",pid=${pid},fd=33))`;

  it("matches a real pid whose cwd is under the root, and skips one whose is not", () => {
    // Uses this very process as the positive case: vitest runs with its cwd in
    // the tree, so the readlink and the prefix comparison are the real ones
    // rather than a fake standing in for them. pid 1 runs from `/`, which no
    // worktree is ever under.
    const root = process.cwd();
    const out = [line("127.0.0.1:8787", process.pid), line("0.0.0.0:22", 1)].join("\n");
    const scan = listenersUnder(root, out);
    expect(scan.kind).toBe("checked");
    if (scan.kind !== "checked") return;
    expect(scan.found.map((l) => l.pid)).toEqual([process.pid]);
    expect(scan.found[0]?.addr).toBe("127.0.0.1:8787");
    expect(scan.found[0]?.command).not.toBe("(command unreadable)");
  });

  it("does not treat a sibling worktree as being under this one", () => {
    // `…/fleet-dashboard-v01` must not match `…/fleet-dashboard-v01-old`, which
    // a bare startsWith on the root without a separator would.
    const scan = listenersUnder(`${process.cwd()}-old`, line("127.0.0.1:8787", process.pid));
    expect(scan).toEqual({ kind: "checked", found: [] });
  });

  it("reports a pid that has gone as nothing, not as a crash", () => {
    // `ss` and the readlink are two moments; a process can exit in between.
    const scan = listenersUnder(process.cwd(), line("127.0.0.1:9999", 4194303));
    expect(scan).toEqual({ kind: "checked", found: [] });
  });
});

describe("blockers", () => {
  it("clears a worktree whose commits are all on the trunk", () => {
    expect(blockers(clean)).toEqual([]);
  });

  it("refuses a worktree something is still serving out of", () => {
    // The case this check was added for. Nothing would be LOST by deleting the
    // directory — which is why every other blocker here stays silent, and why
    // the answer used to be SAFE while the fleet dashboard was running inside.
    const found = blockers({
      ...clean,
      listeners: {
        kind: "checked",
        found: [{ pid: 421345, addr: "127.0.0.1:8787", command: "node tools/fleet/server.ts" }],
      },
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("server is running out of this directory");
    expect(found[0]?.detail.join("\n")).toContain("8787");
  });

  it("does NOT block when it could not look, and says so instead", () => {
    // The one place this file does not fail closed. `ss` is Linux-only, so on
    // the Mac this unknown would be permanent and universal, and an alarm that
    // can never be cleared teaches people to remove the check.
    const facts: CheckFacts = { ...clean, listeners: { kind: "cannot-tell", why: "ss: not found" } };
    expect(blockers(facts)).toEqual([]);
    expect(report(facts).lines.join("\n")).toContain("did not check for running servers: ss: not found");
    expect(report(facts).safe).toBe(true);
  });

  it("refuses the primary checkout, which is never a thing to remove", () => {
    const found = blockers({ ...clean, linked: false });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("primary checkout");
  });

  it("blocks on uncommitted work", () => {
    const found = blockers({ ...clean, dirty: [" M src/blocks.ts", "?? notes.md"] });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("2 uncommitted");
    expect(found[0]?.detail).toContain("?? notes.md");
  });

  it("blocks on tracked files hidden from git status", () => {
    const found = blockers({ ...clean, hidden: ["h src/blocks.ts"] });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("hidden from git status");
  });

  it("blocks on commits the trunk has never seen, and names them", () => {
    const found = blockers({ ...clean, trunk: { kind: "ahead", commits: ["abc1234 a fix"] } });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("1 commit that origin/dev does not have");
    expect(found[0]?.detail).toContain("abc1234 a fix");
  });

  /* The one that matters most: gitignored work is invisible to every other
     signal, committing does not save it, and git's own `worktree remove`
     refusal does not cover it either. */
  it("blocks on gitignored files git has no copy of, even with a clean tree", () => {
    const found = blockers({ ...clean, unexplained: ["data/some-article/blocks.json"] });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("git has no copy of");
    expect(found[0]?.detail).toContain("data/some-article/blocks.json");
  });

  it("blocks on a half-finished merge", () => {
    const found = blockers({ ...clean, inProgress: ["merge"] });
    expect(found[0]?.why).toContain("half-finished");
  });

  /* Fail closed. An unreadable remote must not read as "nothing outstanding". */
  it("treats not knowing as a blocker, not as a pass", () => {
    const found = blockers({ ...clean, trunk: { kind: "unknown", why: "fetch failed" } });
    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain("could not tell");
  });

  it("reports every blocker at once rather than the first", () => {
    const found = blockers({
      ...clean,
      dirty: [" M x"],
      unexplained: ["data/y"],
      trunk: { kind: "ahead", commits: ["abc1234 z"] },
    });
    expect(found).toHaveLength(3);
  });
});

describe("report", () => {
  it("says SAFE and means exit 0 only when nothing blocks", () => {
    const r = report(clean);
    expect(r.safe).toBe(true);
    expect(r.lines.join("\n")).toContain("SAFE TO REMOVE");
  });

  /* The two must move together: a printout saying SAFE with `safe: false`, or
     the reverse, is the whole failure mode in one line. */
  it("never says SAFE when something blocks", () => {
    const r = report({ ...clean, unexplained: ["data/paid-for-this/hierarchy.json"] });
    expect(r.safe).toBe(false);
    expect(r.lines.join("\n")).not.toContain("SAFE TO REMOVE");
    expect(r.lines.join("\n")).toContain("DO NOT REMOVE — 1 blocker");
  });

  it("names what it verified rather than passing in silence", () => {
    expect(report(clean).lines.join("\n")).toContain("ok   data/ matches the fixtures");
  });
});

describe("classifyIgnored", () => {
  it("knows what can be rebuilt", () => {
    expect(classifyIgnored("node_modules/")).toBe("disposable");
    expect(classifyIgnored("dist/")).toBe("disposable");
    expect(classifyIgnored("supabase/.temp/")).toBe("disposable");
    expect(classifyIgnored("docs/plans/260902f-review-sol.md.activity.log")).toBe("disposable");
  });

  it("sends the copied-in files off to be compared with the primary's", () => {
    expect(classifyIgnored(".env.local")).toBe("copied-from-primary");
    expect(classifyIgnored(".claude/settings.local.json")).toBe("copied-from-primary");
  });

  it("sends logs/ for a look too, because git will not say what is in it", () => {
    expect(classifyIgnored("logs/")).toBe("logs");
    /* Only the one at the top. A `src/…/logs/` would be somebody else's. */
    expect(classifyIgnored("src/logs/")).toBe("unexplained");
  });

  it("sends the corpus halves for a file-by-file look", () => {
    expect(classifyIgnored("data/")).toBe("corpus-half");
    expect(classifyIgnored("output/")).toBe("corpus-half");
  });

  /* The default has to be "unexplained": a new gitignore entry nobody told this
     file about should make the check cautious, not silent. */
  it("does not recognise anything else", () => {
    expect(classifyIgnored("scratch/notes.md")).toBe("unexplained");
    expect(classifyIgnored(".env.prod")).toBe("unexplained");
  });

  it("does not let a prefix match the wrong directory", () => {
    expect(classifyIgnored("distillery/results.json")).toBe("unexplained");
  });

  /* An entry with no trailing slash is a file, so it matches exactly. Watched
     red against a bare `startsWith`, which made this disposable. */
  it("does not let a file entry swallow its neighbours", () => {
    expect(classifyIgnored(".DS_Store")).toBe("disposable");
    expect(classifyIgnored(".DS_Store-important")).toBe("unexplained");
  });

  /* Nothing un-quotes git's spelling, and that is the safe direction. */
  it("treats a path git had to quote as unexplained", () => {
    expect(classifyIgnored('"data/odd\\nname"')).toBe("unexplained");
  });
});

describe("hiddenFromStatus", () => {
  it("finds assume-unchanged and skip-worktree, and nothing else", () => {
    const out = ["H src/kept.ts", "h src/assume-unchanged.ts", "S src/skip-worktree.ts", "H src/also-kept.ts"].join("\n");
    expect(hiddenFromStatus(out)).toEqual(["h src/assume-unchanged.ts", "S src/skip-worktree.ts"]);
  });

  it("says nothing about an ordinary index", () => {
    expect(hiddenFromStatus("H a.ts\nH b.ts")).toEqual([]);
  });
});

describe("corpusStrays", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "spideryarn-wtcheck-"));
    mkdirSync(path.join(root, CORPUS_ROOT, "data", "slug"), { recursive: true });
    writeFileSync(path.join(root, CORPUS_ROOT, "data", "slug", "blocks.json"), "[]\n");
    mkdirSync(path.join(root, "data", "slug"), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("says nothing about a plain copy of the fixtures", () => {
    writeFileSync(path.join(root, "data", "slug", "blocks.json"), "[]\n");
    expect(corpusStrays(root, "data")).toEqual([]);
  });

  it("catches an article the fixtures do not have", () => {
    writeFileSync(path.join(root, "data", "slug", "blocks.json"), "[]\n");
    mkdirSync(path.join(root, "data", "paid-for-this"), { recursive: true });
    writeFileSync(path.join(root, "data", "paid-for-this", "hierarchy.json"), "{}\n");
    expect(corpusStrays(root, "data")).toEqual(["data/paid-for-this/hierarchy.json"]);
  });

  /* Watched red against a path-set comparison, which called this identical. */
  it("catches a fixture that was overwritten in place", () => {
    writeFileSync(path.join(root, "data", "slug", "blocks.json"), '[{"id":"spya-k3m9qt"}]\n');
    expect(corpusStrays(root, "data")).toEqual(["data/slug/blocks.json  (differs from the fixture)"]);
  });

  /* Watched red against a walk that recorded only files and directories: a
     symlink is neither, so it vanished from the comparison entirely. */
  it("catches a symlink, which is not a file and is not nothing", () => {
    writeFileSync(path.join(root, "data", "slug", "blocks.json"), "[]\n");
    symlinkSync("../../elsewhere/generated", path.join(root, "data", "paid-for-this"));
    expect(corpusStrays(root, "data")).toEqual(["data/paid-for-this  (symlink)"]);
  });

  it("does not mind a fixture the worktree never materialised", () => {
    expect(corpusStrays(root, "data")).toEqual([]);
  });
});

/**
 * The class, guarded where it happens.
 *
 * `worktree-check.ts` landed at a743c5de on 2026-09-02 at 15:40. `/logs/` was
 * added to `.gitignore` at d0141d13 three hours later, by a commit about the
 * sweep loop, and nobody gave it a verdict. Fail-closed did the rest: from that
 * afternoon, **every worktree where a job had been run refused to be removed**,
 * for ever, and the only symptom was an agent arguing with a refusal.
 *
 * Two files have to agree and nothing held them together — the shape in
 * docs/reusable/silent-success.md, where the wrong answer has no error message.
 * This is the thread between them: adding a line to `.gitignore` now means
 * saying which kind of thing it is, at the moment of adding it.
 *
 * It does not weaken the runtime default. An ignored path nobody has classified
 * still blocks; this only moves the noticing from three weeks later to now.
 *
 * **Two gaps, said out loud rather than left to be discovered** (GPT Sol,
 * 2026-09-08, on an earlier draft that claimed more than it delivered):
 *
 * - **The root `.gitignore` only.** `supabase/.gitignore` and
 *   `infra/hetzner/.gitignore` exist too, and a `.terraform/` left in a worktree
 *   would block for ever exactly as `logs/` did. That is the right answer today
 *   — `*.tfvars` beside it holds real values and *should* block — and if a
 *   nested entry becomes the everyday false alarm, widen this to walk them
 *   rather than adding a second allowlist somewhere else.
 * - **Literal paths only.** A glob names no single path, so a directory rule
 *   with a star in it is skipped here, and the directories it matches would be
 *   unexplained for ever. Every ignore rule in the root file is literal today
 *   except the two `.env` and `.activity.log` globs, which have cases above.
 *
 * So this catches the way `/logs/` actually arrived, not every way one could.
 */
describe("the repo's own .gitignore", () => {
  /**
   * Ignore rules that are *meant* to have no verdict, so they go on blocking.
   *
   * `uploads/` is `gjd-remote upload` — somebody handing a screenshot or a log
   * to the agent working here, which may be the only copy of it. A worktree
   * holding one should absolutely refuse to be deleted quietly.
   *
   * `.claude/worktrees/` is where worktrees live. In the primary that is every
   * peer's whole checkout, and the primary is refused on its own blocker; a
   * *worktree* containing worktrees is strange enough to be worth a human look.
   */
  const BLOCKS_ON_PURPOSE = new Set(["uploads", ".claude/worktrees"]);

  it("gives every directory it names a verdict, or says it blocks on purpose", () => {
    const body = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    const undecided: string[] = [];

    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
      /* A glob names no single path, so there is nothing to look up. `.env*`
         and `*.activity.log` are covered by cases above instead. */
      if (/[*?[\]]/.test(line)) continue;

      const bare = line.replace(/^\//, "").replace(/\/$/, "");
      if (BLOCKS_ON_PURPOSE.has(bare)) continue;

      /* A rule ending in `/` can only ever match a directory, and git reports a
         wholly-ignored directory *with* the trailing slash — so only the slashed
         spelling counts. Accepting either let a hypothetical `/.env.local/`
         pass on the verdict belonging to the file `.env.local`, while the
         runtime spelling `.env.local/` stayed unexplained for ever (GPT Sol,
         2026-09-08). A rule without a slash can match either, so it may use
         either: `.gitignore` writes `.vercel`, git reports `.vercel/`, and
         `DISPOSABLE_IGNORED` holds the latter. */
      const spellings = line.endsWith("/") ? [`${bare}/`] : [`${bare}/`, bare];
      if (spellings.some((sp) => classifyIgnored(sp) !== "unexplained")) continue;
      undecided.push(line);
    }

    expect(undecided, "give it a verdict in classifyIgnored, or add it to BLOCKS_ON_PURPOSE above").toEqual([]);
  });
});

describe("logStrays", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "spideryarn-wtlogs-"));
    mkdirSync(path.join(root, "logs", "tmux-jobs"), { recursive: true });
    writeFileSync(path.join(root, "logs", "tmux-jobs", "chk-0311-2679167.log"), "786 files\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("says nothing about a directory of job logs", () => {
    writeFileSync(path.join(root, "logs", "tmux-jobs", "sol-0729-2534237.log"), "review\n");
    expect(logStrays(root)).toEqual([]);
  });

  /* `dev-server` was allowlisted for a day and a GPT Sol review took it out:
     nothing in the repo writes it, so the name was a guess about a writer. */
  it("blocks on a logs/ subtree nothing in the repo writes", () => {
    mkdirSync(path.join(root, "logs", "dev-server"), { recursive: true });
    writeFileSync(path.join(root, "logs", "dev-server", "260903-0705.log"), "listening\n");
    expect(logStrays(root)).toEqual(["logs/dev-server/  (1 file, and nothing here knows what they are)"]);
  });

  it("does not mind a tree that has never run a job", () => {
    expect(logStrays(mkdtempSync(path.join(tmpdir(), "spideryarn-wtnolo-")))).toEqual([]);
  });

  /* The reason `logs/` is not simply disposable: `/logs/` was gitignored *for*
     these, at d0141d13, and a dated report is the only record that the loop ran. */
  it("catches a loop's reports, which exist nowhere else", () => {
    mkdirSync(path.join(root, "logs", "loops", "get-ready-to-deploy"), { recursive: true });
    writeFileSync(path.join(root, "logs", "loops", "get-ready-to-deploy", "260908.md"), "# found\n");
    expect(logStrays(root)).toEqual(["logs/loops/  (1 file, and nothing here knows what they are)"]);
  });

  it("catches a loose file somebody redirected into logs/", () => {
    writeFileSync(path.join(root, "logs", "notes.txt"), "what I was doing\n");
    expect(logStrays(root)).toEqual(["logs/notes.txt"]);
  });

  /* The `.DS_Store-important` lesson, one directory down: an exact segment
     match, never a prefix. Watched red against a `startsWith` version of the
     allowlist test, which called this directory captured stdout. */
  it("does not let a lookalike name inherit the allowlist", () => {
    mkdirSync(path.join(root, "logs", "tmux-jobs-keep"), { recursive: true });
    writeFileSync(path.join(root, "logs", "tmux-jobs-keep", "the-good-one.log"), "keep me\n");
    expect(logStrays(root)).toEqual(["logs/tmux-jobs-keep/  (1 file, and nothing here knows what they are)"]);
  });

  /* The allowlisted name buys an inspection, not a pass. Without this, the only
     copy of anything could be parked inside `logs/tmux-jobs/` and skipped along
     with the directory — GPT Sol, 2026-09-08. Watched red against the version
     that `continue`d on the directory name alone. */
  it("blocks on something that is not a job log hiding among the job logs", () => {
    writeFileSync(path.join(root, "logs", "tmux-jobs", "notes.md"), "the only copy\n");
    expect(logStrays(root)).toEqual(["logs/tmux-jobs/notes.md  (not a job log, and nothing here knows what it is)"]);
  });

  it("blocks on a directory nested inside the job logs", () => {
    mkdirSync(path.join(root, "logs", "tmux-jobs", "kept"), { recursive: true });
    expect(logStrays(root)).toEqual(["logs/tmux-jobs/kept  (not a job log, and nothing here knows what it is)"]);
  });

  it("blocks on a symlink wearing a job log's name", () => {
    symlinkSync("../../../elsewhere/real.log", path.join(root, "logs", "tmux-jobs", "pretend.log"));
    expect(logStrays(root)).toEqual(["logs/tmux-jobs/pretend.log  (not a job log, and nothing here knows what it is)"]);
  });

  /* A symlink named `tmux-jobs` would otherwise be walked into as if it were
     the directory it is pretending to be. */
  it("does not follow a symlink wearing an allowlisted name", () => {
    rmSync(path.join(root, "logs", "tmux-jobs"), { recursive: true });
    symlinkSync("../../elsewhere/real-work", path.join(root, "logs", "tmux-jobs"));
    expect(logStrays(root)).toEqual(["logs/tmux-jobs  (symlink)"]);
  });
});

describe("comparedWithPrimary", () => {
  let root: string;
  let primary: string;

  beforeEach(() => {
    const base = mkdtempSync(path.join(tmpdir(), "spideryarn-wtcopy-"));
    root = path.join(base, "worktree");
    primary = path.join(base, "primary");
    mkdirSync(root);
    mkdirSync(primary);
  });

  afterEach(() => rmSync(path.dirname(root), { recursive: true, force: true }));

  it("is happy when the copy is the copy", () => {
    writeFileSync(path.join(primary, ".env.local"), "KEY=1\n");
    writeFileSync(path.join(root, ".env.local"), "KEY=1\n");
    expect(comparedWithPrimary(root, primary, ".env.local")).toEqual({ kind: "same" });
  });

  it("catches an edit made only in the worktree", () => {
    writeFileSync(path.join(primary, ".env.local"), "KEY=1\n");
    writeFileSync(path.join(root, ".env.local"), "KEY=1\nSPIKE=2\n");
    expect(comparedWithPrimary(root, primary, ".env.local")).toEqual({ kind: "differs" });
  });

  it("does not assume a copy it cannot see", () => {
    writeFileSync(path.join(root, ".env.local"), "KEY=1\n");
    expect(comparedWithPrimary(root, primary, ".env.local")).toEqual({ kind: "only-here" });
  });
});

describe("standingAgainstTrunk", () => {
  let root: string;
  let origin: string;
  let clone: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "spideryarn-wttrunk-"));
    origin = path.join(root, "origin");
    clone = path.join(root, "clone");
    git(["init", "--quiet", "-b", "dev", origin], root);
    identify(origin);
    commit(origin, "shared.txt", "one\n", "first");
    git(["clone", "--quiet", origin, clone], root);
    identify(clone);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("calls a tree level with the trunk landed", () => {
    expect(standingAgainstTrunk(clone, "dev")).toEqual({ kind: "landed" });
  });

  /* Behind the trunk is still landed: every commit here is on origin/dev, which
     is the only question removal cares about. */
  it("calls a tree behind the trunk landed too", () => {
    commit(origin, "later.txt", "a\n", "trunk moved");
    expect(standingAgainstTrunk(clone, "dev")).toEqual({ kind: "landed" });
  });

  it("lists the commits a tree is ahead by", () => {
    commit(clone, "mine.txt", "work\n", "my unpushed work");
    const r = standingAgainstTrunk(clone, "dev");
    expect(r.kind).toBe("ahead");
    if (r.kind !== "ahead") throw new Error("unreachable");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]).toContain("my unpushed work");
  });

  /* Watched red: an ancestry-only check answered `landed` here, because the
     stale remote-tracking ref still contained HEAD. */
  it("says it does not know when the remote is unreachable", () => {
    git(["remote", "set-url", "origin", path.join(root, "gone")], clone);
    commit(clone, "mine.txt", "work\n", "my unpushed work");
    expect(standingAgainstTrunk(clone, "dev").kind).toBe("unknown");
  });

  /* The nastier half of the same failure: nothing local is outstanding, so
     every other signal says safe — and the fetch that would have proved it
     could not run. */
  it("says it does not know even when the stale ref would have said landed", () => {
    git(["remote", "set-url", "origin", path.join(root, "gone")], clone);
    expect(standingAgainstTrunk(clone, "dev").kind).toBe("unknown");
  });

  /* The ancestry test must read what the fetch just wrote, not a local ref the
     fetch may not have moved. Watched red against `origin/dev`: with no
     configured refspec the fetch succeeds and leaves the local ref where it
     was, so the stale ref still contains HEAD and the tree reads as landed
     although the trunk no longer has that commit at all (GPT Sol, finding 4). */
  it("does not trust an origin/dev the fetch never moved", () => {
    git(["config", "--unset-all", "remote.origin.fetch"], clone);
    const landed = git(["rev-parse", "HEAD"], clone);
    /* The trunk is rewritten under us, so HEAD is genuinely no longer on it. */
    git(["commit", "--quiet", "--amend", "-m", "trunk rewritten"], origin);

    const r = standingAgainstTrunk(clone, "dev");
    expect(r.kind).toBe("ahead");
    /* …and the stale local ref, which still says everything is fine. */
    expect(git(["rev-parse", "origin/dev"], clone)).toBe(landed);
    expect(git(["rev-parse", "dev"], origin)).not.toBe(landed);
  });
});

/**
 * The wiring, against a real repository with a real linked worktree.
 *
 * Everything above tests a judgement in isolation. This asks the question the
 * command actually answers, and it is the block that fails if `gather()` stops
 * gathering.
 */
describe("gather, in a real linked worktree", () => {
  let root: string;
  let origin: string;
  let primary: string;
  let worktree: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "spideryarn-wtreal-"));
    origin = path.join(root, "origin");
    primary = path.join(root, "primary");

    git(["init", "--quiet", "-b", "dev", origin], root);
    identify(origin);
    commit(origin, ".gitignore", "/data/\n/output/\n/logs/\n.env*\nnode_modules/\n", "ignore what the real repo ignores");
    commit(origin, `${CORPUS_ROOT}/data/slug/blocks.json`, "[]\n", "the committed fixture corpus");

    git(["clone", "--quiet", origin, primary], root);
    identify(primary);
    /* The primary's own gitignored environment, which `.worktreeinclude`
       copies into every new worktree. */
    writeFileSync(path.join(primary, ".env.local"), "OPENROUTER_API_KEY=stub\n");

    worktree = path.join(root, "wt");
    git(["worktree", "add", "--quiet", "-b", "worktree-thing", worktree, "HEAD"], primary);
    identify(worktree);
    writeFileSync(path.join(worktree, ".env.local"), "OPENROUTER_API_KEY=stub\n");
    mkdirSync(path.join(worktree, "data", "slug"), { recursive: true });
    writeFileSync(path.join(worktree, "data", "slug", "blocks.json"), "[]\n");
  });

  afterEach(() => {
    git(["worktree", "remove", "--force", worktree], primary);
    rmSync(root, { recursive: true, force: true });
  });

  it("knows it is in a worktree, and clears one that is finished", () => {
    const facts = gather(worktree);
    expect(facts.linked).toBe(true);
    expect(facts.branch).toBe("worktree-thing");
    expect(facts.trunk).toEqual({ kind: "landed" });
    expect(blockers(facts)).toEqual([]);
    expect(report(facts).safe).toBe(true);
  });

  it("proves the copied-in .env.local rather than assuming it", () => {
    expect(gather(worktree).verified.join("\n")).toContain(".env.local is byte-for-byte the primary's copy");
  });

  /* The false safe a GPT Sol review found, and the reason this block exists:
     an edit with no second copy anywhere, invisible to `git status` because the
     file is gitignored, and the whole command printed SAFE over it. */
  it("blocks on an .env.local edited only here", () => {
    appendFileSync(path.join(worktree, ".env.local"), "MY_WORKTREE_ONLY_SETTING=important\n");
    const facts = gather(worktree);
    expect(facts.dirty).toEqual([]);
    expect(facts.unexplained.join("\n")).toContain(".env.local — DIFFERS");
    expect(report(facts).safe).toBe(false);
    /* The blocker names the file and never its contents — and the resolution it
       points at is the docs, not a raw `diff`, which would put both secrets on
       stdout and from there into a transcript (GPT Sol, 2026-09-08). */
    expect(facts.unexplained.join("\n")).not.toContain("MY_WORKTREE_ONLY_SETTING");
    expect(facts.unexplained.join("\n")).not.toContain("diff ");
  });

  /* A worktree that has merely fallen *behind* the primary still blocks, and
     that is the settled answer rather than a gap. A line-subset test looked
     like it could clear this case and was reverted: a worktree that *deleted* a
     key is a subset too, so "nothing here is only here" cannot be read off two
     current snapshots. See the comment in copiedFromPrimary. */
  it("blocks on an .env.local the primary has moved on from, rather than guessing", () => {
    appendFileSync(path.join(primary, ".env.local"), "ADDED_SINCE_THE_COPY=1\n");
    const facts = gather(worktree);
    expect(facts.unexplained.join("\n")).toContain(".env.local — DIFFERS");
    expect(report(facts).safe).toBe(false);
  });

  /* The complaint this whole change came from: `npm run tmux-job` writes into
     `logs/tmux-jobs/`, so *every* tree where a suite or a review has been run
     printed DO NOT REMOVE at a directory holding nothing but captured stdout —
     13 of the box's 19 worktrees on 2026-09-08, all of them on this one line.
     Watched red before the `logs` verdict existed. */
  it("does not block on a tmux job's captured stdout", () => {
    mkdirSync(path.join(worktree, "logs", "tmux-jobs"), { recursive: true });
    writeFileSync(path.join(worktree, "logs", "tmux-jobs", "chk-0311-2679167.log"), "786 files, 2 red\n");
    const facts = gather(worktree);
    expect(facts.unexplained).toEqual([]);
    expect(report(facts).safe).toBe(true);
  });

  /* And the half that must survive it. `/logs/` was gitignored for a loop's
     dated reports, which are the only record that the loop ran. */
  it("still blocks on a loop's report under logs/", () => {
    mkdirSync(path.join(worktree, "logs", "loops", "get-ready-to-deploy"), { recursive: true });
    writeFileSync(path.join(worktree, "logs", "loops", "get-ready-to-deploy", "260908.md"), "# what it found\n");
    const facts = gather(worktree);
    expect(facts.dirty).toEqual([]);
    expect(facts.unexplained.join("\n")).toContain("logs/loops");
    expect(report(facts).safe).toBe(false);
  });

  it("blocks on a pipeline run in data/ that git cannot see", () => {
    mkdirSync(path.join(worktree, "data", "paid-for-this"), { recursive: true });
    writeFileSync(path.join(worktree, "data", "paid-for-this", "hierarchy.json"), "{}\n");
    const facts = gather(worktree);
    expect(facts.dirty).toEqual([]);
    expect(facts.unexplained).toContain("data/paid-for-this/hierarchy.json");
    expect(report(facts).safe).toBe(false);
  });

  it("blocks on an edit hidden with assume-unchanged", () => {
    git(["update-index", "--assume-unchanged", "--", ".gitignore"], worktree);
    appendFileSync(path.join(worktree, ".gitignore"), "\n# something I meant to keep\n");
    const facts = gather(worktree);
    expect(facts.dirty).toEqual([]);
    expect(facts.hidden.join("\n")).toContain(".gitignore");
    expect(report(facts).safe).toBe(false);
  });

  it("blocks on work committed here and not yet landed", () => {
    commit(worktree, "src/mine.ts", "export const x = 1;\n", "my work");
    const facts = gather(worktree);
    expect(facts.trunk.kind).toBe("ahead");
    expect(report(facts).safe).toBe(false);
  });
});
