/**
 * **The deploy record reader, and the check that it has not drifted from the
 * file it reads.**
 *
 * `tools/fleet/deploys.ts` is a SECOND reader of a format `src/changelog.ts`
 * already parses — the reasoning is in that file's header and in
 * docs/plans/260909b, and the whole cost of the decision is that the two can
 * drift. So the last describe block below reads **the real committed
 * `src/web/changelog-versions.ndjson`**, not a fixture, and asserts the reader
 * found one version per non-blank line with nothing it could not read.
 *
 * That is the test that can go red on a day nobody touched this file, which is
 * the only kind of agreement worth having here — a fixture cut proves the reader
 * parses the fixture, and would stay green through a format change forever
 * (docs/reusable/silent-success.md).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  lastGeneratedAt,
  newestDeploy,
  readDeploys,
  type DeployVersion,
} from "../tools/fleet/deploys.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_FILE = path.join(ROOT, "src/web/changelog-versions.ndjson");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

/** A well-formed line, with anything the caller wants overridden. */
function line(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "2026-09-01T10:00:00Z",
    deployment_id: "dpl_one",
    sha: SHA_A,
    previous_sha: null,
    commit_count: 12,
    invisible: false,
    generated_at: "2026-09-02T08:00:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries: [
      {
        id: "x",
        section: "headline",
        title: "A thing changed",
        body: "In a way a reader would notice.",
        where: "/read",
        links: [],
        commits: [SHA_B],
        provenance: { sources: [0], verdicts: ["confirmed"] },
      },
    ],
    ...over,
  });
}

describe("readDeploys", () => {
  it("returns versions newest first, which is the opposite of the file", () => {
    const text = [
      line({ version: "2026-09-01T10:00:00Z", sha: SHA_A, deployment_id: "dpl_1" }),
      line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, previous_sha: SHA_A, deployment_id: "dpl_2" }),
      line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, previous_sha: SHA_B, deployment_id: "dpl_3" }),
    ].join("\n");

    const read = readDeploys(text);

    expect(read.versions.map((v) => v.version)).toEqual([
      "2026-09-03T10:00:00Z",
      "2026-09-02T10:00:00Z",
      "2026-09-01T10:00:00Z",
    ]);
    expect(read.unreadable).toEqual([]);
    expect(read.lines).toBe(3);
  });

  it("numbers releases from the OLDEST line, so the newest has the highest number", () => {
    const text = [line({ deployment_id: "dpl_1" }), line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, deployment_id: "dpl_2" })].join("\n");

    expect(readDeploys(text).versions.map((v) => v.release)).toEqual([2, 1]);
  });

  it("skips blank lines without counting them", () => {
    const read = readDeploys(`\n${line()}\n\n`);

    expect(read.lines).toBe(1);
    expect(read.versions).toHaveLength(1);
    expect(read.versions[0]?.release).toBe(1);
  });

  it("derives `invisible` from the entries rather than trusting the field", () => {
    /* The file says one thing and the entries say another. What is on screen is
       what is in `entries`, so a line claiming to be quiet cannot hide them. */
    const read = readDeploys(line({ invisible: true }));

    expect(read.versions[0]?.invisible).toBe(false);
    expect(read.versions[0]?.entries).toHaveLength(1);
  });

  it("reads a quiet deploy as quiet", () => {
    const read = readDeploys(line({ invisible: false, entries: [] }));

    expect(read.versions[0]?.invisible).toBe(true);
    expect(read.unreadable).toEqual([]);
  });
});

describe("a line that will not parse", () => {
  it("is counted and NAMED, never swallowed", () => {
    const read = readDeploys([line(), "{not json", line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));

    expect(read.versions).toHaveLength(2);
    expect(read.unreadable).toHaveLength(1);
    expect(read.unreadable[0]).toContain("line 2");
    expect(read.unreadable[0]).toContain("does not parse");
  });

  it("takes its own release number down with it, and moves nothing else", () => {
    /* One unreadable line in the middle must not silently renumber every
       release above it — the number is the join between this tab, /changelog and
       the logo's build stamp. */
    const read = readDeploys([line({ deployment_id: "dpl_1" }), "{not json", line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));

    expect(read.versions.map((v) => v.release)).toEqual([3, 1]);
    expect(read.lines).toBe(3);
  });

  it.each([
    ["a version that is not a UTC stamp", { version: "yesterday" }, "not a UTC stamp"],
    ["a version that is not a real date", { version: "2026-99-99T99:99:99Z" }, "not a real date"],
    ["a short sha", { sha: "abc123" }, "not a 40-character sha"],
    ["no deployment_id", { deployment_id: "" }, "no deployment_id"],
    ["a previous_sha that is neither null nor a sha", { previous_sha: "nope" }, "neither null nor a sha"],
    ["a line that is not an object", null, "not an object"],
  ])("rejects %s with a sentence saying why", (_name, over, expected) => {
    const text = over === null ? "[1,2,3]" : line(over as Record<string, unknown>);
    const read = readDeploys(text);

    expect(read.versions).toEqual([]);
    expect(read.unreadable).toHaveLength(1);
    expect(read.unreadable[0]).toContain(expected);
  });
});

describe("the fields that may be missing without losing the deploy", () => {
  it("carries a missing commit_count as null, not as zero", () => {
    /* A line that does not say how many commits it shipped has not shipped
       zero. Zero is a number a panel would draw and a reader would believe. */
    for (const bad of [undefined, -1, 1.5, "12", null]) {
      const read = readDeploys(line({ commit_count: bad }));
      expect(read.versions[0]?.commitCount, `commit_count ${JSON.stringify(bad)}`).toBeNull();
      expect(read.versions[0]?.version).toBe("2026-09-01T10:00:00Z");
    }
  });

  it("keeps a real commit_count, including a genuine zero", () => {
    expect(readDeploys(line({ commit_count: 0 })).versions[0]?.commitCount).toBe(0);
    expect(readDeploys(line({ commit_count: 137 })).versions[0]?.commitCount).toBe(137);
  });

  it("carries a missing or malformed generated_at as null", () => {
    expect(readDeploys(line({ generated_at: "whenever" })).versions[0]?.generatedAt).toBeNull();
    expect(readDeploys(line({ generated_at: undefined })).versions[0]?.generatedAt).toBeNull();
  });
});

describe("entries", () => {
  it("drops an entry whose section is not one of the three", () => {
    const read = readDeploys(line({ entries: [{ section: "engineering", title: "t", body: "b" }] }));

    expect(read.versions[0]?.entries).toEqual([]);
    /* And so the version reads as quiet, which is the true thing to say about a
       version with nothing showable on it. */
    expect(read.versions[0]?.invisible).toBe(true);
  });

  it("drops a sha that is not 40 hex characters, and keeps the rest", () => {
    const read = readDeploys(
      line({ entries: [{ section: "fix", title: "t", body: "b", commits: [SHA_B, "abc", 7, SHA_C] }] }),
    );

    expect(read.versions[0]?.entries[0]?.commits).toEqual([SHA_B, SHA_C]);
  });

  it("keeps `where` when it is there and nulls it when it is not", () => {
    expect(readDeploys(line()).versions[0]?.entries[0]?.where).toBe("/read");
    const bare = readDeploys(line({ entries: [{ section: "fix", title: "t", body: "b" }] }));
    expect(bare.versions[0]?.entries[0]?.where).toBeNull();
  });
});

describe("newestDeploy and lastGeneratedAt", () => {
  it("newestDeploy is the head of the reversed list, and null for an empty record", () => {
    const read = readDeploys([line({ deployment_id: "dpl_1" }), line({ version: "2026-09-04T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));

    expect(newestDeploy(read)?.version).toBe("2026-09-04T10:00:00Z");
    expect(newestDeploy(readDeploys(""))).toBeNull();
  });

  it("lastGeneratedAt takes the NEWEST stamp, not the last line's", () => {
    /* A run that filled in an older gap leaves the freshest stamp somewhere
       other than the end, and reading the end would understate how fresh the
       record is. */
    const read = readDeploys(
      [
        line({ deployment_id: "dpl_1", generated_at: "2026-09-07T08:00:00Z" }),
        line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, deployment_id: "dpl_2", generated_at: "2026-09-03T08:00:00Z" }),
      ].join("\n"),
    );

    expect(lastGeneratedAt(read)).toBe("2026-09-07T08:00:00Z");
  });

  it("lastGeneratedAt is null when no line carries a usable stamp", () => {
    expect(lastGeneratedAt(readDeploys(line({ generated_at: "nope" })))).toBeNull();
    expect(lastGeneratedAt(readDeploys(""))).toBeNull();
  });
});

/**
 * **THE CHECK THAT CAN GO RED WITHOUT ANYBODY TOUCHING THIS BRANCH.**
 *
 * Everything above proves the reader parses text this file wrote. This proves it
 * parses the file it is actually pointed at — which is the only half that
 * notices the day the changelog format moves under it.
 */
describe("the real committed record", () => {
  const text = readFileSync(REAL_FILE, "utf8");
  const read = readDeploys(text);

  it("reads every non-blank line", () => {
    const nonBlank = text.split("\n").filter((l) => l.trim() !== "").length;

    expect(read.lines).toBe(nonBlank);
    expect(read.unreadable).toEqual([]);
    expect(read.versions).toHaveLength(nonBlank);
    /* Not a fixture with three lines in it. If this ever reads as a handful,
       the path is wrong and every assertion above it is vacuous. */
    expect(nonBlank).toBeGreaterThan(50);
  });

  it("comes back newest first, with releases counting up towards it", () => {
    const versions = read.versions;
    for (let i = 1; i < versions.length; i++) {
      const newer = versions[i - 1] as DeployVersion;
      const older = versions[i] as DeployVersion;
      expect(newer.version > older.version, `${newer.version} should be later than ${older.version}`).toBe(true);
      expect(newer.release).toBe(older.release + 1);
    }
    expect(versions[versions.length - 1]?.release).toBe(1);
  });

  it("has a sha, a deployment id and a commit count on every line", () => {
    for (const v of read.versions) {
      expect(v.sha, v.version).toMatch(/^[0-9a-f]{40}$/);
      expect(v.deploymentId, v.version).not.toBe("");
      /* A null here would be a real gap in the record rather than a reader
         fault — and would mean the panel starts saying "not recorded" on a line
         that used to carry a number. Worth failing over. */
      expect(v.commitCount, v.version).not.toBeNull();
    }
  });

  it("has something a reader would notice on at least some deploys", () => {
    /* The count that collapses is the signal — changelog.md § The traps. A
       reader that silently stopped recognising `entries` would leave every
       version quiet, which renders as a plausible-looking list of empty
       deploys. */
    const loud = read.versions.filter((v) => !v.invisible);

    expect(loud.length).toBeGreaterThan(10);
    expect(loud.flatMap((v) => v.entries).length).toBeGreaterThan(50);
  });
});
