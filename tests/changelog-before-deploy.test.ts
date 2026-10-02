/**
 * **Release notes written before the deploy, so they go out in it** —
 * docs/plans/261001q. Each of these was watched red against the code before it.
 *
 * The pieces, and the one question each answers:
 *
 *  - `release-paths.ts` — which commits a reader could see. The planner, the
 *    promoter and the deploy gate all ask it, so it is tested once, here.
 *  - `parsePending` — does the pending release fit after the history's last line?
 *  - `plan --upcoming` — one version, no deployment id, or nothing at all.
 *  - `installPending` — the pending file replaced whole, or not at all.
 *  - `planPromotion` — one history line per production deploy, with the serving
 *    build's own id and time, and nothing shipped after the notes left behind
 *    the watermark undescribed.
 *  - `changelogGap` / `notesAt` — the deploy gate: notes were written for this
 *    deploy, and anything after them rolls to the next release (261002h).
 *
 * Mostly real commits from this repo's history, because the ancestry questions
 * are asked of git and a fixture repo would be testing a different history
 * shape; `repoWithALateCommit` builds the one shape the history lacks.
 */
import * as childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseChangelog, parsePending, type ChangelogVersion } from "../src/changelog.js";
import {
  cmdWrite,
  installPending,
  main,
  planPromotion,
  Refused,
  servingFrom,
} from "../scripts/changelog/changelog.js";
import * as changelogModule from "../scripts/changelog/changelog.js";
import { main as releaseNotes, fastForwardTo, Stop } from "../scripts/changelog/release-notes.js";
import { isReleasePath, notesAt, releaseCommits } from "../scripts/changelog/release-paths.js";
import { changelogGap, servingUnrecorded } from "../scripts/deploy-checks.js";

vi.mock("node:child_process", { spy: true });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Touches only `docs/` — a reader cannot see it. */
const DOCS = "c7b34e58dacb6c0ce826bc229f1146bad5a5bd00";
const DOCS_PARENT = "f214f020ca80925d6668c2da2aa89430dd0970b0";
/** Touches only the history file — the previous run's notes commit. */
const NOTES = "89d67401b14489b9c01e0d58e1fa954dd90984f0";
const NOTES_PARENT = "cfd0428e5a95c2da2bb5e86f8233c915bfa62bff";
/** Touches `src/web/OrderGroup.tsx` — a reader can see it. */
const CODE = "fd6bf2ca735ab406ae575d3751e82a419882018b";
const CODE_PARENT = "7ce23c5d137345e318541949166089c5c3162ff5";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), "changelog-before-deploy-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
  /* Module spies keep their mock implementations after restoreAllMocks. */
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "2026-10-01T00:00:00Z",
    deployment_id: "dpl_zero",
    sha: CODE_PARENT,
    previous_sha: null,
    commit_count: 1,
    invisible: true,
    generated_at: "2026-10-01T00:05:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries: [],
    ...over,
  };
}

function entry(): Record<string, unknown> {
  return {
    id: null,
    section: "enhancement",
    title: "Order buttons stay on one line",
    body: "One or two sentences, in the reader's words.",
    where: null,
    links: [],
    commits: [CODE],
    provenance: { sources: [0], verdicts: ["confirmed"] },
  };
}

/** The pending release `write --pending` would produce on top of `line()`. */
function pending(over: Record<string, unknown> = {}): Record<string, unknown> {
  return line({
    version: "2026-10-01T01:00:00Z",
    deployment_id: null,
    sha: CODE,
    previous_sha: CODE_PARENT,
    invisible: false,
    generated_at: "2026-10-01T01:00:00Z",
    entries: [entry()],
    ...over,
  });
}

function history(...lines: Record<string, unknown>[]): ChangelogVersion[] {
  const parsed = parseChangelog(lines.map((l) => JSON.stringify(l)).join("\n"));
  expect(parsed.problems).toEqual([]);
  return parsed.versions;
}

const SERVING = { commit: CODE, deploymentId: "dpl_one", builtAt: "2026-10-01T01:20:30.456Z" };

/**
 * A real repo: one recorded deploy (`first`), notes describing a later commit
 * (`noted`, committed in `notesCommit`), and a commit a reader can see that
 * landed after `prepare` planned (`late`) — 261002h's case.
 */
function repoWithALateCommit(): { repo: string; first: string; noted: string; notesCommit: string; late: string } {
  const repo = scratch();
  const run = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  const commit = (file: string, text: string, msg: string): string => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
    run("add", file);
    run("commit", "--quiet", "-m", msg);
    return run("rev-parse", "HEAD");
  };
  run("init", "--quiet");
  const first = commit("src/a.ts", "a\n", "the first deploy");
  commit("src/web/changelog-pending.json", "null\n", "nothing pending");
  commit("src/web/changelog-versions.ndjson", `${JSON.stringify(line({ sha: first }))}\n`, "its line");
  const noted = commit("src/b.ts", "b\n", "a change the notes describe");
  const notesCommit = commit(
    "src/web/changelog-pending.json",
    `${JSON.stringify(pending({ sha: noted, previous_sha: first }))}\n`,
    "the notes",
  );
  const late = commit("src/c.ts", "c\n", "a change that landed after prepare planned");
  return { repo, first, noted, notesCommit, late };
}

describe("release paths", () => {
  it("does not count the changelog's own files as a change", () => {
    expect(isReleasePath("src/web/changelog-versions.ndjson")).toBe(false);
    expect(isReleasePath("src/web/changelog-pending.json")).toBe(false);
    expect(isReleasePath("src/web/OrderGroup.tsx")).toBe(true);
    expect(isReleasePath("docs/plans/x.md")).toBe(false);
  });

  it("finds the commit a reader can see, and neither of the others", () => {
    expect(releaseCommits(`${CODE_PARENT}..${CODE}`, REPO)).toEqual([CODE]);
    expect(releaseCommits(`${DOCS_PARENT}..${DOCS}`, REPO)).toEqual([]);
    expect(releaseCommits(`${NOTES_PARENT}..${NOTES}`, REPO)).toEqual([]);
  });
});

describe("parsePending", () => {
  const h = () => history(line());

  it("reads null as nothing pending", () => {
    expect(parsePending("null\n", h())).toEqual({ pending: null, problems: [] });
  });

  it("numbers a release that fits as the history's next line", () => {
    const r = parsePending(JSON.stringify(pending()), h());
    expect(r.problems).toEqual([]);
    expect(r.pending?.release).toBe(2);
    expect(r.pending?.deployment_id).toBeNull();
  });

  it("refuses one that claims a deployment it cannot have had", () => {
    expect(parsePending(JSON.stringify(pending({ deployment_id: "dpl_x" })), h()).problems.join()).toMatch(
      /must be null/,
    );
  });

  it("refuses one that names a deployed commit it cannot have had", () => {
    expect(parsePending(JSON.stringify(pending({ deployed_sha: CODE })), h()).problems.join()).toMatch(
      /deployed_sha must be absent/,
    );
  });

  it("reads a history line's deployed commit, and refuses one that is not a sha", () => {
    expect(history(line({ deployed_sha: CODE }))[0]?.deployed_sha).toBe(CODE);
    expect(history(line())[0]?.deployed_sha).toBeNull();
    expect(parseChangelog(JSON.stringify(line({ deployed_sha: "nope" }))).problems.join()).toMatch(
      /deployed_sha is neither absent nor a sha/,
    );
  });

  it("refuses one that does not chain onto the last line", () => {
    const r = parsePending(JSON.stringify(pending({ previous_sha: DOCS })), h());
    expect(r.problems.join()).toMatch(/previous_sha/);
  });

  it("refuses one stamped before the last line", () => {
    const r = parsePending(JSON.stringify(pending({ version: "2026-09-30T00:00:00Z" })), h());
    expect(r.problems.join()).toMatch(/not later/);
  });
});

describe("plan --upcoming", () => {
  function planned(from: string, to: string): { work: string; run: () => void } {
    const work = path.join(scratch(), "work");
    const file = path.join(path.dirname(work), "versions.ndjson");
    writeFileSync(file, `${JSON.stringify(line({ sha: from }))}\n`);
    return { work, run: () => main(["plan", "--upcoming", to, "--work", work, "--file", file]) };
  }

  it("plans one version, with no deployment id, from the last line to the tip", () => {
    const { work, run } = planned(CODE_PARENT, CODE);
    vi.spyOn(console, "log").mockImplementation(() => {});
    run();
    const spine = JSON.parse(readFileSync(path.join(work, "spine.json"), "utf8"));
    expect(spine).toHaveLength(1);
    expect(spine[0]).toMatchObject({ deployment_id: null, sha: CODE, previous_sha: CODE_PARENT });
    expect(spine[0].code_commits).toEqual([CODE]);
  });

  it("plans nothing when no commit in the range is one a reader could see", () => {
    const { work, run } = planned(NOTES_PARENT, NOTES);
    vi.spyOn(console, "log").mockImplementation(() => {});
    run();
    expect(JSON.parse(readFileSync(path.join(work, "upcoming.json"), "utf8")).release_commits).toBe(0);
    expect(JSON.parse(readFileSync(path.join(work, "spine.json"), "utf8"))).toEqual([]);
  });

  it("refuses a tip the last line is not an ancestor of", () => {
    const { run } = planned(CODE, CODE_PARENT);
    expect(run).toThrow(/not an ancestor/);
  });
});

describe("write --pending", () => {
  it("refuses success when the run assembled no pending release", () => {
    const dir = scratch();
    const work = path.join(dir, "work");
    const file = path.join(dir, "versions.ndjson");
    const pendingFile = path.join(dir, "pending.json");
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, "assigned.json"), "[]\n");
    writeFileSync(file, `${JSON.stringify(line())}\n`);
    writeFileSync(pendingFile, "null\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() => cmdWrite(REPO, work, false, file, "sonnet", pendingFile)).toThrow(/assembled no release/);
    expect(readFileSync(pendingFile, "utf8")).toBe("null\n");
  });
});

describe("installPending", () => {
  it("replaces the file whole with a release that fits", () => {
    const file = path.join(scratch(), "pending.json");
    writeFileSync(file, "null\n");
    installPending(file, "null\n", pending(), history(line()));
    expect(JSON.parse(readFileSync(file, "utf8")).sha).toBe(CODE);
  });

  it("leaves it untouched when the release does not fit", () => {
    const file = path.join(scratch(), "pending.json");
    writeFileSync(file, "null\n");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => installPending(file, "null\n", pending({ previous_sha: DOCS }), history(line()))).toThrow(
      Refused,
    );
    expect(readFileSync(file, "utf8")).toBe("null\n");
  });

  it("refuses when somebody else wrote it in the meantime", () => {
    const file = path.join(scratch(), "pending.json");
    writeFileSync(file, `${JSON.stringify(pending())}\n`);
    expect(() => installPending(file, "null\n", null, history(line()))).toThrow(/changed while/);
  });
});

describe("promote", () => {
  function promote(over: Partial<Parameters<typeof planPromotion>[0]> = {}) {
    return planPromotion({
      root: REPO,
      history: history(line()),
      serving: SERVING,
      servingPendingText: JSON.stringify(pending()),
      localPendingText: JSON.stringify(pending()),
      ...over,
    });
  }

  it("appends the serving release with the build's own id and time, and clears it", () => {
    const p = promote();
    expect(p.kind).toBe("append");
    if (p.kind !== "append") return;
    expect(p.line).toMatchObject({
      version: "2026-10-01T01:20:30Z",
      deployment_id: "dpl_one",
      sha: CODE,
      deployed_sha: CODE,
      previous_sha: CODE_PARENT,
      commit_count: 1,
    });
    expect(p.line.entries).toEqual([entry()]);
    expect(p.clearPending).toBe(true);
    /* And what it appends is a line the history accepts. */
    expect(parseChangelog([line(), p.line].map((l) => JSON.stringify(l)).join("\n")).problems).toEqual([]);
  });

  it("leaves a newer local pending release alone", () => {
    const p = promote({ localPendingText: JSON.stringify(pending({ generated_at: "2026-10-01T02:00:00Z" })) });
    expect(p.kind === "append" && p.clearPending).toBe(false);
  });

  it("does nothing for a deployment the history already has", () => {
    expect(promote({ serving: { ...SERVING, deploymentId: "dpl_zero" } }).kind).toBe("recorded");
  });

  it("records a deploy with no notes, rather than losing it", () => {
    const p = promote({
      history: history(line({ sha: DOCS_PARENT })),
      serving: { ...SERVING, commit: DOCS },
      servingPendingText: "null\n",
    });
    expect(p.kind === "append" && p.line).toMatchObject({ sha: DOCS, entries: [], invisible: true });
  });

  /**
   * `--force-gate=changelog` shipped a change nobody described. Recording the
   * deployed commit would put it behind the watermark for ever; stopping the
   * line at what was described leaves it for the next prepare.
   */
  it("stops the line at the notes when the deploy shipped more than they cover", () => {
    const p = promote({ servingPendingText: "null\n" });
    expect(p.kind).toBe("append");
    if (p.kind !== "append") return;
    expect(p.line.sha).toBe(CODE_PARENT);
    expect(p.line.commit_count).toBe(0);
    expect(p.notes.join()).toMatch(/after the notes/);
    expect(parseChangelog([line(), p.line].map((l) => JSON.stringify(l)).join("\n")).problems).toEqual([]);
  });

  /**
   * The claim 261002h rests on: a commit the deploy gate let through after the
   * notes is not lost behind the watermark — the line stops at the notes, so
   * the next `prepare`'s range (from the last line's `sha`) contains it.
   */
  it("leaves a commit that landed after the notes in the next release's range", () => {
    const { repo, first, noted, late } = repoWithALateCommit();
    const notesText = JSON.stringify(pending({ sha: noted, previous_sha: first }));
    const p = promote({
      root: repo,
      history: history(line({ sha: first })),
      serving: { ...SERVING, commit: late },
      servingPendingText: notesText,
      localPendingText: notesText,
    });
    expect(p.kind).toBe("append");
    if (p.kind !== "append") return;
    expect(p.line.sha).toBe(noted);
    /* And what was built, for the fleet dashboard's distance. */
    expect(p.line.deployed_sha).toBe(late);
    expect(p.line.entries).toEqual([entry()]);
    expect(releaseCommits(`${String(p.line.sha)}..${late}`, repo)).toEqual([late]);
  });

  it("records repeated redeploys of a rolled release without advancing its coverage", () => {
    const { repo, first, noted, late } = repoWithALateCommit();
    const notesText = JSON.stringify(pending({ sha: noted, previous_sha: first }));
    const rows = [line({ sha: first })];
    for (let i = 1; i <= 3; i++) {
      const p = promote({
        root: repo, history: history(...rows),
        serving: { commit: late, deploymentId: `dpl_${i}`, builtAt: `2026-10-01T0${i + 1}:00:00Z` },
        servingPendingText: notesText, localPendingText: "null\n",
      });
      expect(p.kind).toBe("append");
      if (p.kind !== "append") throw new Error("unreachable");
      expect(p.line).toMatchObject({ sha: noted, deployed_sha: late });
      if (i > 1) expect(p.line).toMatchObject({ commit_count: 0, entries: [] });
      rows.push(p.line);
    }
    expect(releaseCommits(`${noted}..${late}`, repo)).toEqual([late]);
  });

  it("still records a redeploy of a legacy rolled line with no deployed_sha", () => {
    const { repo, first, noted, late } = repoWithALateCommit();
    const notesText = JSON.stringify(pending({ sha: noted, previous_sha: first }));
    const rows = history(line({ sha: first }), line({
      ...pending({ sha: noted, previous_sha: first }),
      deployment_id: "dpl_one", version: "2026-10-01T02:00:00Z",
    }));
    const p = promote({
      root: repo, history: rows,
      serving: { ...SERVING, commit: late, deploymentId: "dpl_two", builtAt: "2026-10-01T03:00:00Z" },
      servingPendingText: notesText,
    });
    expect(p.kind === "append" && p.line).toMatchObject({
      sha: noted, deployed_sha: late, commit_count: 0, entries: [],
    });
  });

  it("does not call a rollback to the notes commit a redeploy of a rolled build", () => {
    const { repo, first, noted, notesCommit, late } = repoWithALateCommit();
    const notesText = JSON.stringify(pending({ sha: noted, previous_sha: first }));
    const rows = history(line({ sha: first }), line({
      ...pending({ sha: noted, previous_sha: first }),
      deployment_id: "dpl_one", deployed_sha: late, version: `${SERVING.builtAt.slice(0, 19)}Z`,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => promote({
      root: repo, history: rows,
      serving: { ...SERVING, commit: notesCommit, deploymentId: "dpl_rollback", builtAt: "2026-10-01T03:00:00Z" },
      servingPendingText: notesText,
    })).toThrow(/rollback/);
  });

  it("refuses a rollback with null notes even when it is ahead of the coverage watermark", () => {
    const { repo, first, noted, late } = repoWithALateCommit();
    const rows = history(line({ sha: first }), line({
      ...pending({ sha: noted, previous_sha: first }),
      deployment_id: "dpl_one", deployed_sha: late, version: "2026-10-01T02:00:00Z",
    }));
    expect(() => promote({
      root: repo, history: rows,
      serving: { ...SERVING, commit: noted, deploymentId: "dpl_rollback", builtAt: "2026-10-01T03:00:00Z" },
      servingPendingText: "null\n",
    })).toThrow(/rollback/);
  });

  it("does not match quiet coverage rows from a different build as repeated redeploys", () => {
    const { repo, first, noted, notesCommit, late } = repoWithALateCommit();
    const rows = history(line({ sha: first }), line({
      ...pending({ sha: noted, previous_sha: first }),
      deployment_id: "dpl_one", deployed_sha: late, version: "2026-10-01T02:00:00Z",
    }), line({
      sha: noted, previous_sha: noted, deployed_sha: notesCommit,
      deployment_id: "dpl_wrong", commit_count: 0, version: "2026-10-01T03:00:00Z",
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => promote({
      root: repo, history: rows,
      serving: { ...SERVING, commit: late, deploymentId: "dpl_two", builtAt: "2026-10-01T04:00:00Z" },
      servingPendingText: JSON.stringify(pending({ sha: noted, previous_sha: first })),
    })).toThrow(/does not chain/);
  });

  it("records a redeploy of a release already promoted as a line with nothing in it", () => {
    const promoted = line({ ...pending(), deployment_id: "dpl_one", version: "2026-10-01T01:20:30Z" });
    const p = promote({
      history: history(line(), promoted),
      serving: { ...SERVING, deploymentId: "dpl_two", builtAt: "2026-10-01T03:00:00Z" },
    });
    expect(p.kind === "append" && p.line).toMatchObject({ sha: CODE, commit_count: 0, entries: [] });
  });

  it("records a second redeploy of the same release after the first quiet redeploy row", () => {
    const promoted = line({ ...pending(), deployment_id: "dpl_one", version: "2026-10-01T01:20:30Z" });
    const first = promote({
      history: history(line(), promoted),
      serving: { ...SERVING, deploymentId: "dpl_two", builtAt: "2026-10-01T03:00:00Z" },
    });
    expect(first.kind).toBe("append");
    if (first.kind !== "append") return;

    const second = promote({
      history: history(line(), promoted, first.line),
      serving: { ...SERVING, deploymentId: "dpl_three", builtAt: "2026-10-01T04:00:00Z" },
    });
    expect(second.kind === "append" && second.line).toMatchObject({
      deployment_id: "dpl_three",
      sha: CODE,
      commit_count: 0,
      entries: [],
    });
  });

  it("does not mistake different notes with the same timestamp for the release already promoted", () => {
    const promoted = line({ ...pending(), deployment_id: "dpl_one", version: "2026-10-01T01:20:30Z" });
    const different = pending({
      entries: [{ ...entry(), title: "Different notes from the same planning second" }],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      promote({
        history: history(line(), promoted),
        serving: { ...SERVING, deploymentId: "dpl_two", builtAt: "2026-10-01T03:00:00Z" },
        servingPendingText: JSON.stringify(different),
      }),
    ).toThrow(/does not chain/);
  });

  it("does not accept malformed notes because their normalized entries match a promoted release", () => {
    const promoted = line({ ...pending(), deployment_id: "dpl_one", version: "2026-10-01T01:20:30Z" });
    const malformed = pending({ entries: [entry(), { section: "fix" }] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      promote({
        history: history(line(), promoted),
        serving: { ...SERVING, deploymentId: "dpl_two", builtAt: "2026-10-01T03:00:00Z" },
        servingPendingText: JSON.stringify(malformed),
      }),
    ).toThrow(/does not chain/);
  });

  it("refuses a serving release that does not chain onto the history — a rollback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => promote({ servingPendingText: JSON.stringify(pending({ previous_sha: DOCS })) })).toThrow(
      /does not chain/,
    );
  });

  it("refuses a serving build that predates the pending file and has no line", () => {
    expect(() => promote({ servingPendingText: null })).toThrow(/predates/);
  });

  it("refuses a build time that is not after the last line", () => {
    expect(() => promote({ serving: { ...SERVING, builtAt: "2026-09-30T00:00:00Z" } })).toThrow(/not after/);
  });

  it("refuses a build stamp that is not one", () => {
    expect(() => servingFrom({ commit: "abc", deploymentId: "dpl_x", builtAt: "now" })).toThrow(/not a sha/);
    expect(() => servingFrom({ ...SERVING, deploymentId: null })).toThrow(/not a Vercel/);
  });
});

describe("changelogGap — the deploy gate", () => {
  const base = { problems: [], described: CODE, describedInCandidate: true, pendingPresent: true, uncovered: [] };

  it("passes notes that cover everything the candidate ships", () => {
    expect(changelogGap(base)).toBeNull();
  });

  /**
   * A commit that landed after `prepare` planned rolls to the next release's
   * notes rather than sending `prepare` round again — 261002h. Strict until
   * then (261001q § The deploy gate).
   */
  it("passes a release commit after the notes, which the next release describes", () => {
    expect(changelogGap({ ...base, uncovered: [DOCS] })).toBeNull();
  });

  /** No notes at all since the last promote means prepare did not run for this deploy. */
  it("refuses a release commit when nothing is pending", () => {
    expect(changelogGap({ ...base, pendingPresent: false, uncovered: [DOCS] })).toMatch(
      /no release notes describe them/,
    );
  });

  it("refuses notes about some other history", () => {
    expect(changelogGap({ ...base, describedInCandidate: false })).toMatch(/does not contain/);
  });

  it("refuses changelog files that do not parse", () => {
    expect(changelogGap({ ...base, problems: ["pending: does not parse"] })).toMatch(/do not parse/);
  });

  it("cannot pass a candidate whose committed changelog history is empty", () => {
    const repo = scratch();
    mkdirSync(path.join(repo, "src/web"), { recursive: true });
    writeFileSync(path.join(repo, "src/web/changelog-versions.ndjson"), "");
    writeFileSync(path.join(repo, "src/web/changelog-pending.json"), "null\n");
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    execFileSync("git", ["add", "src/web/changelog-versions.ndjson", "src/web/changelog-pending.json"], {
      cwd: repo,
    });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "empty history"],
      { cwd: repo },
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    expect(notesAt(sha, repo).gap).toMatch(/history has no releases/);
  });

  describe("notesAt, against a real history", () => {
    const build = repoWithALateCommit;

    it("passes a late commit after the notes, and names it as the next release's", () => {
      const { repo, noted, late } = build();
      const notes = notesAt(late, repo);
      expect(notes.gap).toBeNull();
      expect(notes.described).toBe(noted);
      expect(notes.late).toEqual([late]);
    });

    it("names nothing late when the notes cover the candidate", () => {
      const { repo, notesCommit } = build();
      expect(notesAt(notesCommit, repo)).toMatchObject({ gap: null, late: [] });
    });

    it("still refuses a release commit when no notes are pending", () => {
      const { repo, noted } = build();
      expect(notesAt(noted, repo).gap).toMatch(/no release notes describe them/);
    });
  });
});

/**
 * The deploy being replaced must already be in the history — otherwise its id
 * is lost for good, since `promote` reads only what is serving now. GPT Sol's
 * code review of 261001q, finding 1.
 */
describe("servingUnrecorded — the deploy gate's second question", () => {
  it("passes when the serving deploy has its line", () => {
    expect(
      servingUnrecorded({ servingDeploymentId: "dpl_one", recordedDeploymentIds: ["dpl_zero", "dpl_one"] }),
    ).toBeNull();
  });

  it("refuses to deploy over one that was never promoted", () => {
    expect(servingUnrecorded({ servingDeploymentId: "dpl_two", recordedDeploymentIds: ["dpl_one"] })).toMatch(
      /changelog:promote/,
    );
  });

  it("refuses when it cannot tell", () => {
    expect(servingUnrecorded({ servingDeploymentId: null, recordedDeploymentIds: ["dpl_one"] })).toMatch(
      /could not read/,
    );
  });
});

/**
 * `prepare` brings the primary to `origin/dev` by fast-forward only, in a tree
 * that holds other agents' uncommitted edits. `merge --ff-only` on its own says
 * "Already up to date" from a HEAD that is AHEAD and leaves it there — GPT Sol
 * on 261002h — so `fastForwardTo` asks ancestry first and checks after.
 */
describe("fastForwardTo — prepare's only way of moving HEAD", () => {
  function inRepo(dir: string) {
    const run = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
        cwd: dir, encoding: "utf8",
      }).trim();
    const commit = (file: string, msg: string): string => {
      writeFileSync(path.join(dir, file), `${msg}\n`);
      run("add", file);
      run("commit", "--quiet", "-m", msg);
      return run("rev-parse", "HEAD");
    };
    const at = (sha: string) => {
      const tree = path.join(scratch(), "tree");
      run("worktree", "add", "--quiet", "--detach", tree, sha);
      return inRepo(tree);
    };
    return { dir, run, commit, at };
  }
  function repo() {
    const result = inRepo(scratch());
    result.run("init", "--quiet");
    return result;
  }

  it("moves a HEAD that is behind to exactly the target, keeping an unrelated edit", () => {
    const source = repo();
    const a = source.commit("a.txt", "a");
    const b = source.commit("b.txt", "b");
    const { dir, run } = source.at(a);
    writeFileSync(path.join(dir, "a.txt"), "somebody's edit\n");

    fastForwardTo(b, dir);
    expect(run("rev-parse", "HEAD")).toBe(b);
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("somebody's edit\n");
  });

  it("stops on a HEAD that is AHEAD, rather than calling it up to date", () => {
    const { dir, run, commit } = repo();
    const a = commit("a.txt", "a");
    const b = commit("b.txt", "b");
    expect(() => fastForwardTo(a, dir)).toThrow(Stop);
    expect(() => fastForwardTo(a, dir)).toThrow(/ahead or has diverged/);
    expect(run("rev-parse", "HEAD")).toBe(b);
  });

  it("stops on a HEAD that has diverged", () => {
    const source = repo();
    const a = source.commit("a.txt", "a");
    const b = source.commit("b.txt", "b");
    const { dir, run, commit } = source.at(a);
    const c = commit("c.txt", "c");
    expect(() => fastForwardTo(b, dir)).toThrow(/ahead or has diverged/);
    expect(run("rev-parse", "HEAD")).toBe(c);
  });

  it("detects a concurrent HEAD move during the fast-forward", () => {
    const heads = [CODE_PARENT, DOCS];
    vi.spyOn(childProcess, "execFileSync").mockImplementation(() => heads.shift() ?? DOCS);
    vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      pid: 1, output: [], signal: null, status: 0, stdout: "", stderr: "",
    });
    expect(() => fastForwardTo(CODE, scratch())).toThrow(/fast-forwarded, but HEAD is/);
  });

  it("keeps an ignored local file when the target starts tracking that path", () => {
    const source = repo();
    const a = source.commit(".gitignore", "local.txt");
    writeFileSync(path.join(source.dir, "local.txt"), "the deployed version\n");
    source.run("add", "--force", "local.txt");
    source.run("commit", "--quiet", "-m", "start tracking local.txt");
    const b = source.run("rev-parse", "HEAD");
    const { dir, run } = source.at(a);
    writeFileSync(path.join(dir, "local.txt"), "somebody's ignored work\n");
    expect(() => fastForwardTo(b, dir)).toThrow(/could not fast-forward/);
    expect(run("rev-parse", "HEAD")).toBe(a);
    expect(readFileSync(path.join(dir, "local.txt"), "utf8")).toBe("somebody's ignored work\n");
  });

  it("refuses an overlapping edit even when merge.autoStash is enabled", () => {
    const source = repo();
    const a = source.commit("a.txt", "a");
    const b = source.commit("a.txt", "a again");
    const { dir, run } = source.at(a);
    run("config", "merge.autoStash", "true");
    writeFileSync(path.join(dir, "a.txt"), "somebody's edit\n");
    expect(() => fastForwardTo(b, dir)).toThrow(/could not fast-forward/);
    expect(run("rev-parse", "HEAD")).toBe(a);
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("somebody's edit\n");
    expect(run("for-each-ref", "refs/stash")).toBe("");
  });

  it("stops, and keeps the edit, when the target would change a file somebody is editing", () => {
    const source = repo();
    const a = source.commit("a.txt", "a");
    const b = source.commit("a.txt", "a again");
    const { dir, run } = source.at(a);
    writeFileSync(path.join(dir, "a.txt"), "somebody's edit\n");

    expect(() => fastForwardTo(b, dir)).toThrow(/could not fast-forward/);
    expect(run("rev-parse", "HEAD")).toBe(a);
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("somebody's edit\n");
  });
});

describe("prepare after the model stages (external commands stubbed)", () => {
  function setup({ fetchFails = false, headMoved = false, remoteMoved = false } = {}) {
    const cwd = scratch();
    mkdirSync(path.join(cwd, ".git"));
    mkdirSync(path.join(cwd, "src/web"), { recursive: true });
    mkdirSync(path.join(cwd, "scripts/changelog"), { recursive: true });
    writeFileSync(path.join(cwd, "src/web/changelog-versions.ndjson"), JSON.stringify(line()));
    writeFileSync(path.join(cwd, "src/web/changelog-pending.json"), "null\n");
    writeFileSync(path.join(cwd, "scripts/changelog/prepare-prompt.md"), "{{SHA}} {{WORK}}");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SERVING))));
    let modeled = false;
    let currentHead = CODE;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(changelogModule, "main").mockImplementation((args) => {
      if (args[0] === "plan") {
        const work = args[args.indexOf("--work") + 1] as string;
        mkdirSync(work, { recursive: true });
        writeFileSync(path.join(work, "upcoming.json"), '{"release_commits":1}');
      }
    });
    vi.spyOn(childProcess, "execFileSync").mockImplementation(((_cmd: string, args: string[]) => {
      if (args[0] === "branch") return "dev";
      if (args[0] === "log") return modeled && remoteMoved ? `\0${DOCS}\nsrc/late.ts\n` : "";
      const refs: Record<string, string> = {
        "--show-toplevel": cwd,
        "--git-common-dir": ".git",
        "origin/dev": modeled && remoteMoved ? DOCS : CODE,
        HEAD: modeled && headMoved ? DOCS : currentHead,
      };
      return refs[args[1] ?? ""] ?? currentHead;
    }) as typeof execFileSync);
    const commands: string[][] = [];
    vi.spyOn(childProcess, "spawnSync").mockImplementation(((_cmd: string, args: string[]) => {
      commands.push(args);
      if (args.includes("scripts/run-claude.ts")) {
        writeFileSync(path.join(cwd, "src/web/changelog-pending.json"), JSON.stringify(pending()));
        modeled = true;
      }
      if (args[0] === "merge" && remoteMoved) currentHead = DOCS;
      if (args[0] === "show") {
        return { status: 0, stdout: args[1]?.endsWith(".ndjson") ? JSON.stringify(line()) : JSON.stringify(pending()), stderr: "" };
      }
      const refused = (modeled && fetchFails && args[0] === "fetch") ||
        (modeled && headMoved && args[0] === "merge-base" && args[2] === DOCS);
      return { status: refused || (modeled && args[0] === "diff") ? 1 : 0, stdout: "", stderr: refused ? "simulated refusal" : "" };
    }) as typeof childProcess.spawnSync);
    return { cwd, commands };
  }

  it("finishes one model round when the checkout stays level with dev", async () => {
    const { commands } = setup();
    expect(await releaseNotes(["prepare"])).toBe(0);
    expect(commands.filter(args => args.includes("scripts/run-claude.ts"))).toHaveLength(1);
    expect(commands.filter(args => args[0] === "fetch")).toHaveLength(3);
    expect(commands.some(args => args[0] === "commit")).toBe(true);
    expect(commands.some(args => args[0] === "push")).toBe(true);
  });

  it("does one model round and fast-forwards over late release work", async () => {
    const { commands } = setup({ remoteMoved: true });
    expect(await releaseNotes(["prepare"])).toBe(0);
    expect(commands.filter(args => args.includes("scripts/run-claude.ts"))).toHaveLength(1);
    expect(commands.some(args => args[0] === "merge" && args.at(-1) === DOCS)).toBe(true);
    expect(commands.some(args => args[0] === "push")).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 later release commit(s) roll"));
  });

  it("stops before committing when the post-model fetch fails, keeping the generated notes", async () => {
    const { cwd, commands } = setup({ fetchFails: true });
    expect(await releaseNotes(["prepare"])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("could not fetch origin"));
    expect(commands.some((args) => args[0] === "commit" || args[0] === "push")).toBe(false);
    expect(JSON.parse(readFileSync(path.join(cwd, "src/web/changelog-pending.json"), "utf8")).sha).toBe(CODE);
  });

  it("rechecks a locally moved HEAD even when origin/dev stayed at the planned tip", async () => {
    const { commands } = setup({ headMoved: true });
    expect(await releaseNotes(["prepare"])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("ahead or has diverged"));
    expect(commands.some((args) => args[0] === "commit" || args[0] === "push")).toBe(false);
  });
});
