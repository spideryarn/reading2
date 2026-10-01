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
 *    build's own id and time, and nothing a forced deploy shipped left
 *    behind the watermark undescribed.
 *  - `changelogGap` / `notesAt` — the deploy gate, strict: nothing a reader
 *    would see may ship after the notes stop.
 *
 * Real commits from this repo's history, because the ancestry questions are
 * asked of git and a fixture repo would be testing a different history shape.
 */
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
import { isReleasePath, notesAt, releaseCommits } from "../scripts/changelog/release-paths.js";
import { changelogGap, servingUnrecorded } from "../scripts/deploy-checks.js";

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
    expect(p.notes.join()).toMatch(/without notes/);
    expect(parseChangelog([line(), p.line].map((l) => JSON.stringify(l)).join("\n")).problems).toEqual([]);
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
  const base = { problems: [], described: CODE, describedInCandidate: true, uncovered: [] };

  it("passes notes that cover everything the candidate ships", () => {
    expect(changelogGap(base)).toBeNull();
  });

  /** The revert that lands after the notes: the reason the rule is strict (261001q § The deploy gate). */
  it("refuses a release commit after the notes, however fresh they are", () => {
    expect(changelogGap({ ...base, uncovered: [DOCS] })).toMatch(/no release notes describe them/);
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
