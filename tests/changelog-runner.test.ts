/**
 * **The runner's refusals, watched refusing.**
 *
 * [`scripts/changelog/changelog.ts`](../scripts/changelog/changelog.ts) exists
 * to stop a model's prose becoming a false public claim, and every one of its
 * assertions is load-bearing rather than decorative. A gate nobody has seen go
 * red is not evidence ([silent-success.md](../docs/reusable/silent-success.md)),
 * and a cross-family review on 2026-09-06 found three of them exiting 0 while
 * letting an unreviewed, misattributed or vanished change through — so each test
 * here is one of those, and each was checked red against the code as it was.
 *
 * The gates throw `Refused` rather than exiting, which is what makes them
 * testable at all; `main` turns it back into an exit code at the edge. That is
 * also why these go through `main` where the fixture is cheap enough — the CLI
 * wiring is part of what can be wrong.
 *
 * `tests/changelog-file.test.ts` is the other half: the *file's* invariants,
 * checkable without a run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildLines, checkReview, installAppend, main } from "../scripts/changelog/changelog.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Real shas, because the ancestry check is the point and it asks git. */
function rev(ref: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: REPO, encoding: "utf8" }).trim();
}

const HEAD = rev("HEAD");
const OLDER = rev("HEAD~3");
const TYPO = "f".repeat(40);

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), "changelog-runner-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  /* Left behind deliberately when a test fails, so the fixture can be read. */
  for (const d of dirs.splice(0)) execFileSync("rm", ["-rf", d]);
});

/** What a refusal printed on the way out — the detail is there, not in the throw. */
function complaints(run: () => void): string {
  const said: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    said.push(a.map(String).join(" "));
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return said.join("\n");
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
}

// ---------------------------------------------------------------------------
// verify — the review stage, and where a sha is allowed to have come from

/** One trawl item, as the merged `review/<day>-items.json` carries it. */
function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _index: 0,
    summary: "Something a reader would notice",
    user_facing: true,
    where: "/",
    files: [],
    commits: [{ sha: OLDER, subject: null }],
    evidence: "src/thing.ts § doThing",
    confidence: "high",
    ...over,
  };
}

/**
 * A work directory `verify` can run against: one version whose range is
 * `OLDER..HEAD`, one day of items, and whatever review answer the test wants.
 */
function verifyWork(a: { items: Record<string, unknown>[]; sol: unknown }): string {
  const work = scratch();
  const day = "2026-09-06";
  writeJson(path.join(work, "spine.json"), [
    {
      version: "2026-09-06T09:49:37Z",
      deployment_id: "dpl_one",
      sha: HEAD,
      previous_sha: OLDER,
      commit_count: 1,
      ancestor_ok: "yes",
      commits: [OLDER],
      code_commits: [OLDER],
    },
  ]);
  mkdirSync(path.join(work, "batches"), { recursive: true });
  writeFileSync(path.join(work, "batches", `${day}-00.txt`), `${OLDER}\n`);
  writeJson(path.join(work, "review", `${day}-items.json`), a.items);
  writeJson(path.join(work, "review", `${day}-sol.json`), a.sol);
  return work;
}

const RULED = { _index: 0, verdict: "confirmed", note: null };

describe("checkReview — is the review answer a review", () => {
  const items = [item(), item({ _index: 1 })];

  it("names the user-facing items nobody ruled on", () => {
    const { problems, unruled } = checkReview(items, { items: [RULED] }, "2026-09-06");
    expect(problems).toEqual([]);
    expect(unruled).toEqual([1]);
  });

  it("counts an item raised out of invisible as ruled on", () => {
    const sol = { items: [RULED], misclassified_as_invisible: [{ _index: 1, why: "a reader sees it" }] };
    expect(checkReview(items, sol, "2026-09-06").unruled).toEqual([]);
  });

  it("reports an _index that names no item", () => {
    const { problems } = checkReview(items, { items: [{ ...RULED, _index: 7 }] }, "d");
    expect(problems.join(" ")).toContain("_index 7 names no item");
  });

  it("reports the same item ruled on twice — one of the two rulings is lost", () => {
    const { problems } = checkReview(items, { items: [RULED, { ...RULED, verdict: "rejected" }] }, "d");
    expect(problems.join(" ")).toContain("appears twice");
  });

  it("reports a verdict the review is not allowed to give", () => {
    const { problems } = checkReview(items, { items: [{ ...RULED, verdict: "probably" }] }, "d");
    expect(problems.join(" ")).toContain('verdict "probably" is not one of');
  });

  /* The one that would otherwise pass silently while leaving the trawler's
     unverified sentence in place, marked reviewed. */
  it("reports a corrected ruling that corrects nothing", () => {
    const { problems } = checkReview(items, { items: [{ ...RULED, verdict: "corrected" }] }, "d");
    expect(problems.join(" ")).toContain("carries no correction");
  });

  it("says nothing about a corrected ruling that carries the correction", () => {
    const corrected = { ...RULED, verdict: "corrected", corrected_summary: "What it really did" };
    expect(checkReview(items, { items: [corrected] }, "d").problems).toEqual([]);
  });
});

describe("verify", () => {
  /**
   * **The review stage is not optional** — changelog.md § Review. Requiring the
   * answer *file* was the whole gate until 2026-09-06, and a file ruling on one
   * of two items passed it: the second reached the page carrying whatever the
   * cheap trawler wrote, marked `unreviewed`, with nothing failing.
   */
  it("refuses when a user-facing item has no ruling", () => {
    const work = verifyWork({ items: [item(), item({ _index: 1 })], sol: { items: [RULED] } });
    expect(() => main(["verify", "--work", work])).toThrow(/no ruling|user-facing items/);
  });

  it("proceeds on the same input when the run says it may", () => {
    const work = verifyWork({ items: [item(), item({ _index: 1 })], sol: { items: [RULED] } });
    main(["verify", "--work", work, "--allow-unreviewed"]);
    expect(existsSync(path.join(work, "assigned.json"))).toBe(true);
  });

  it("refuses a malformed review answer before folding any of it in", () => {
    const work = verifyWork({ items: [item()], sol: { items: [{ ...RULED, verdict: "maybe" }] } });
    expect(() => main(["verify", "--work", work])).toThrow(/problems in the review answers/);
    expect(existsSync(path.join(work, "verified"))).toBe(true);
    expect(readdirSync(path.join(work, "verified"))).toEqual([]);
  });

  /**
   * **A sha on an assigned item has to be one that version actually contains.**
   *
   * The assignment drops shas it cannot place and assigns the item on the
   * strength of any one it can, so before 2026-09-06 an item citing a good sha
   * and a bad one was assigned on the good one and carried the bad one into
   * `copy-in` — where the writer accepted it, because *its* check is only
   * "present in this version's input" and the typo was in the input. The
   * review's own `missing` items skipped even the earlier "is this a commit"
   * check, which is why both cases below come in through `missing`.
   */
  it("refuses a sha that is not a commit in this repo", () => {
    const sol = {
      items: [RULED],
      missing: [{ commits: [OLDER, TYPO], summary: "A change nobody trawled", user_facing: true }],
    };
    const work = verifyWork({ items: [item()], sol });
    const said = complaints(() => expect(() => main(["verify", "--work", work])).toThrow(/shas on assigned items/));
    expect(said).toContain("not a commit in this repo");
  });

  it("refuses a real commit the version it was assigned to does not contain", () => {
    /* `HEAD` is a real commit and a descendant of the version's own sha, so it
       had not shipped when that version deployed: an entry carrying it would
       date a change earlier than it happened. */
    const sol = {
      items: [RULED],
      missing: [{ commits: [OLDER, HEAD], summary: "Not shipped yet", user_facing: true }],
    };
    const work = verifyWork({ items: [item()], sol });
    /* The version's own sha is OLDER here, so HEAD is ahead of it. */
    const spine = JSON.parse(readFileSync(path.join(work, "spine.json"), "utf8")) as {
      sha: string;
    }[];
    if (spine[0]) spine[0].sha = OLDER;
    writeJson(path.join(work, "spine.json"), spine);
    const said = complaints(() => expect(() => main(["verify", "--work", work])).toThrow(/shas on assigned items/));
    expect(said).toContain("undeployed, or a side branch");
  });

  it("leaves an item whose commits are all undeployed for a later run", () => {
    /* Not the same thing at all: nothing maps, so it belongs to no version yet
       and the watermark picks it up once it ships. changelog.md § Enumerate. */
    const sol = {
      items: [RULED],
      missing: [{ commits: [HEAD], summary: "Committed, not deployed", user_facing: true }],
    };
    const work = verifyWork({ items: [item()], sol });
    main(["verify", "--work", work]);
    const unassigned = JSON.parse(
      readFileSync(path.join(work, "unassigned.json"), "utf8"),
    ) as unknown[];
    expect(unassigned).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// write — what the copy stage is allowed to say

/** A copy-in / copy-out pair for one version, and the `buildLines` call on it. */
function copyRun(a: { changes: unknown[]; entries: unknown[] }) {
  const work = scratch();
  const slug = "20260906T094937";
  const inDir = path.join(work, "copy-in");
  const outDir = path.join(work, "copy-out");
  writeJson(path.join(inDir, `${slug}.json`), {
    version: { deployedAt: "2026-09-06T09:49:37Z", label: "2026-09-06 09:49" },
    changes: a.changes,
  });
  writeJson(path.join(outDir, `${slug}.json`), { entries: a.entries });
  return buildLines({
    versions: [
      {
        version_index: 0,
        version: "2026-09-06T09:49:37Z",
        deployment_id: "dpl_one",
        sha: HEAD,
        previous_sha: OLDER,
        commit_count: 2,
        items: a.changes.map(() => ({ user_facing: true, provenance_verdict: "confirmed" })),
      },
    ],
    inDir,
    outDir,
    generatedAt: "2026-09-06T10:00:00Z",
  });
}

const CHANGE_A = { summary: "The first change", commits: [{ sha: OLDER }] };
const CHANGE_B = { summary: "The second change", commits: [{ sha: HEAD }] };

function copyEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    section: "fix",
    title: "A thing that works now",
    body: "One or two sentences, in the reader's words.",
    links: [],
    commits: [OLDER],
    sources: [0],
    ...over,
  };
}

describe("buildLines — the copy stage's output against the input it was given", () => {
  /**
   * **Nothing out of something is an error.** Five verified user-facing changes
   * in and `entries: []` back was a warning until 2026-09-06, and the line it
   * then wrote said `invisible: true` — a release with five real changes
   * shipping as one that had none, which reads exactly like the common quiet
   * deploy and leaves nothing anywhere to notice.
   */
  it("refuses a version whose copy came back empty", () => {
    const report = copyRun({ changes: [CHANGE_A, CHANGE_B], entries: [] });
    expect(report.errors.join(" ")).toContain("no usable entry");
  });

  /**
   * An entry's `sources` are the only statement of what it is allowed to know,
   * so a commit belonging to an item it did not draw on is misattribution —
   * plausible, well-formed, linking to a real commit, and about the wrong change.
   */
  it("refuses an entry carrying a commit from an item it did not cite", () => {
    const report = copyRun({
      changes: [CHANGE_A, CHANGE_B],
      entries: [copyEntry({ commits: [OLDER, HEAD], sources: [0] }), copyEntry({ sources: [1], commits: [HEAD] })],
    });
    expect(report.errors.join(" ")).toContain("belongs to no item in its sources");
  });

  it("accepts the same commits once the entry cites the item they came from", () => {
    const report = copyRun({
      changes: [CHANGE_A, CHANGE_B],
      entries: [copyEntry({ commits: [OLDER, HEAD], sources: [0, 1] })],
    });
    expect(report.errors).toEqual([]);
  });

  /* Dropping an input on purpose stays a warning — the first run dropped 15 of
     504 — but the count is on the summary line rather than in the noise. */
  it("counts a deliberately dropped input rather than failing on it", () => {
    const report = copyRun({ changes: [CHANGE_A, CHANGE_B], entries: [copyEntry()] });
    expect(report.errors).toEqual([]);
    expect(report.stats.uncited).toBe(1);
  });
});

describe("installAppend", () => {
  function target(before: string): string {
    const file = path.join(scratch(), "versions.ndjson");
    writeFileSync(file, before);
    return file;
  }

  const LINE = {
    version: "2026-09-06T09:49:37Z",
    deployment_id: "dpl_one",
    sha: HEAD,
    previous_sha: null,
    commit_count: 1,
    invisible: true,
    generated_at: "2026-09-06T10:00:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries: [],
  };

  it("appends and reads back what it installed", () => {
    const file = target("");
    const check = installAppend(file, "", [LINE]);
    expect(check.problems).toEqual([]);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  /**
   * **Two runs reading the same `before` had the second silently overwrite the
   * first.** `write` reads the file at the top of the command and installs at
   * the bottom; anything that landed in between — another run, a person with the
   * file open — was gone without a trace.
   */
  it("refuses when the file changed since the caller read it", () => {
    const stale = `${JSON.stringify(LINE)}\n`;
    const file = target(`${stale}${JSON.stringify({ ...LINE, deployment_id: "dpl_other" })}\n`);
    const wasThere = readFileSync(file, "utf8");
    expect(() => installAppend(file, stale, [LINE])).toThrow(/changed while this command ran/);
    expect(readFileSync(file, "utf8")).toBe(wasThere);
  });

  /**
   * The old code wrote the target, read it back, and restored it if the read
   * failed — a window in which the file on disk is wrong, and a crash inside it
   * leaves a truncated product with nothing left running to fix it. Nothing is
   * installed now until the staged copy has parsed, and the staging file never
   * outlives the call.
   */
  it("leaves the file and its directory untouched when the result does not parse", () => {
    const before = `${JSON.stringify(LINE)}\n`;
    const file = target(before);
    const bad = { ...LINE, version: "not-a-stamp", deployment_id: "dpl_two" };
    expect(() => installAppend(file, before, [bad])).toThrow(/does not parse/);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(path.dirname(file))).toEqual(["versions.ndjson"]);
  });
});

// ---------------------------------------------------------------------------
// plan — what has to be true before a run starts at all

/** A deploy row in the shape Vercel's list gives it. */
function deploy(a: { id: string; at: string; sha?: string }): Record<string, unknown> {
  return {
    id: a.id,
    created: Date.parse(a.at),
    state: "READY",
    target: "production",
    meta: a.sha === undefined ? {} : { githubCommitSha: a.sha },
  };
}

/**
 * `plan` against a one-line changelog, so the range it works out is
 * `OLDER..HEAD` rather than the whole history.
 */
function planWork(rows: Record<string, unknown>[]): { work: string; args: string[] } {
  const work = scratch();
  const deploys = path.join(work, "deploys.json");
  writeJson(deploys, rows);
  const file = path.join(work, "versions.ndjson");
  writeFileSync(
    file,
    `${JSON.stringify({
      version: "2026-09-06T00:00:00Z",
      deployment_id: "dpl_watermark",
      sha: OLDER,
      previous_sha: null,
      commit_count: 1,
      invisible: true,
      generated_at: "2026-09-06T10:00:00Z",
      generated_by: { trawl: "t", review: "r", copy: "c" },
      entries: [],
    })}\n`,
  );
  return {
    work,
    args: ["plan", "--work", work, "--deploys", deploys, "--file", file],
  };
}

const WATERMARK = deploy({ id: "dpl_watermark", at: "2026-09-06T00:00:00Z", sha: OLDER });

describe("plan", () => {
  /**
   * **The stages address each other by index and file name, not by run.** The
   * documented default work directory is reused, and `plan` retired nothing — so
   * a same-day `<day>-sol.json` left from an earlier attempt was folded into a
   * fresh item set, each ruling landing on whichever item now sat at that
   * position. No run identity, no content hash: refusing to start is the cheap
   * half, and it is the half that cannot itself be wrong.
   */
  it("refuses to start on top of an earlier run's stage output", () => {
    const { work, args } = planWork([WATERMARK, deploy({ id: "dpl_new", at: "2026-09-06T09:00:00Z", sha: HEAD })]);
    writeJson(path.join(work, "review", "2026-09-06-sol.json"), { items: [] });
    expect(() => main(args)).toThrow(/already holds an earlier run/);
  });

  it("empties them when told to, and runs", () => {
    const { work, args } = planWork([WATERMARK, deploy({ id: "dpl_new", at: "2026-09-06T09:00:00Z", sha: HEAD })]);
    writeJson(path.join(work, "review", "2026-09-06-sol.json"), { items: [] });
    main([...args, "--fresh"]);
    expect(existsSync(path.join(work, "review"))).toBe(false);
    expect(existsSync(path.join(work, "spine.json"))).toBe(true);
  });

  /**
   * One production deploy is one version — changelog.md § A version is a deploy.
   * A READY production deploy with no git sha attaches no ref, so it shipped
   * something no range covers; skipping it, which is what this did until
   * 2026-09-06, attributes that work to a later version or to none at all. The
   * 11 deploys that predate the first sha'd one are the documented exception,
   * and their work is inside the first version's range.
   */
  it("refuses a deploy after the first version that has no git sha", () => {
    const { args } = planWork([
      WATERMARK,
      deploy({ id: "dpl_bare", at: "2026-09-06T08:00:00Z" }),
      deploy({ id: "dpl_new", at: "2026-09-06T09:00:00Z", sha: HEAD }),
    ]);
    expect(() => main(args)).toThrow(/no git sha/);
  });

  it("still accepts the ones that predate every sha'd deploy", () => {
    const { args } = planWork([
      deploy({ id: "dpl_early", at: "2026-08-25T00:00:00Z" }),
      WATERMARK,
      deploy({ id: "dpl_new", at: "2026-09-06T09:00:00Z", sha: HEAD }),
    ]);
    expect(() => main(args)).not.toThrow();
  });

  /**
   * A version's id is its stamp to the second, and the format is not ours to
   * change — it is the id of every line in the file and of every `copy-in` file
   * name. So two deploys inside one second are caught here, where the deployment
   * ids are still to hand to name them, rather than downstream as a
   * strict-ordering failure between two lines that look identical.
   */
  it("refuses two deploys that would share a version id", () => {
    const rows = [
      WATERMARK,
      deploy({ id: "dpl_a", at: "2026-09-06T09:00:00Z", sha: HEAD }),
      deploy({ id: "dpl_b", at: "2026-09-06T09:00:00Z", sha: HEAD }),
    ];
    /* The millisecond that tells them apart, and that the stamp drops. */
    (rows[2] as { created: number }).created += 400;
    const { args } = planWork(rows);
    expect(() => main(args)).toThrow(/share a version id/);
  });
});
