/**
 * **The committed changelog reads back clean, and `parseChangelog` still says
 * so when it doesn't.**
 *
 * Two halves, and they need each other. The first parses
 * `src/web/changelog-versions.ndjson` and asserts zero problems — that file is
 * public claims about the product, written by three models and appended to by a
 * script, and [`ChangelogPage.tsx`](../src/web/ChangelogPage.tsx) renders around
 * a bad line rather than blanking. **That tolerance is exactly what would let an
 * error go quiet**, so this is where it is not allowed to
 * ([silent-success.md](../docs/reusable/silent-success.md)).
 *
 * The second half is the reason the first is worth anything: a parser that
 * reported nothing would pass it too. So each invariant gets a hand-built line
 * that breaks it, and the last of them is the case real history taught us — a
 * repeated sha is a **redeploy**, not a fault, and must stay silent.
 *
 * Floors rather than counts on the sizes, because the file only ever grows: a
 * truncated or half-written file has to fail, and a normal run must not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OK_LINK_PATHS } from "../scripts/changelog/changelog.js";
import { LAUNCH_VERSION, REPO_URL, parseChangelog } from "../src/changelog.js";
import { parseRoute } from "../src/web/router.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(REPO, "src/web/changelog-versions.ndjson");

/**
 * Floors taken from the 2026-09-06 retrospective run, which wrote 68 versions
 * and 236 entries — deliberately below those, so an append never reddens this
 * and a truncation always does.
 * docs/plans/260906d-retrospective-changelog-for-every-version-since-the-beginning.md § Results.
 */
const LEAST_VERSIONS = 60;
const LEAST_ENTRIES = 200;

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A line that is fine, so a test can break exactly one thing about it. */
function version(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "2026-09-05T22:19:14Z",
    deployment_id: "dpl_test",
    sha: SHA_A,
    previous_sha: null,
    commit_count: 3,
    invisible: false,
    generated_at: "2026-09-06T10:00:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries: [entry()],
    ...over,
  };
}

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: null,
    section: "headline",
    title: "Something a reader would notice",
    body: "One or two sentences, in the reader's words.",
    where: null,
    links: [],
    commits: [SHA_B],
    provenance: { sources: [0], verdicts: ["confirmed"] },
    ...over,
  };
}

function parseOf(...lines: Record<string, unknown>[]) {
  return parseChangelog(lines.map((l) => JSON.stringify(l)).join("\n"));
}

describe("the committed versions.ndjson", () => {
  const text = readFileSync(FILE, "utf8");
  const result = parseChangelog(text);

  it("has no problems", () => {
    expect(result.problems).toEqual([]);
  });

  it("is not empty or truncated", () => {
    expect(text.trim()).not.toBe("");
    expect(result.versions.length).toBeGreaterThanOrEqual(LEAST_VERSIONS);
    const entries = result.versions.reduce((n, v) => n + v.entries.length, 0);
    expect(entries).toBeGreaterThanOrEqual(LEAST_ENTRIES);
  });

  it("starts at the launch version and runs oldest first", () => {
    expect(result.versions[0]?.version).toBe(LAUNCH_VERSION);
    expect(result.versions[0]?.previous_sha).toBeNull();
  });

  /**
   * **Every in-app link goes somewhere that exists**, asked of the router
   * rather than of a list.
   *
   * This is the check the process was missing. The copy stage may only use
   * addresses on a closed list, and the writer enforces it — but the list
   * itself carried `/read` for "your library" while the shelf has always been
   * at `/`, so 32 entries shipped pointing at `not-found` and every check
   * agreed, because all of them asked whether the address was *permitted*
   * rather than whether it was *real*. Found 2026-09-06, while building the
   * page that would have rendered them.
   *
   * It also holds the other direction, which is the one that will bite later:
   * renaming a route silently 404s every changelog entry that ever linked to
   * it, and nothing else in the repo would notice.
   */
  it("links only to addresses the router recognises", () => {
    const dead: string[] = [];
    for (const v of result.versions) {
      for (const e of v.entries) {
        for (const l of e.links) {
          if (l.url.startsWith("http")) continue;
          if (parseRoute(l.url).kind === "not-found") {
            dead.push(`${v.version}: ${JSON.stringify(l.label)} → ${l.url}`);
          }
        }
      }
    }
    expect(dead).toEqual([]);
  });
});

/**
 * The writer's closed list and the router are two statements of the same fact,
 * and only one of them can be checked by running it.
 */
describe("the addresses the copy stage may link to", () => {
  it("are all real routes", () => {
    const dead = [...OK_LINK_PATHS].filter((p) => parseRoute(p).kind === "not-found");
    expect(dead).toEqual([]);
  });

  it("are the same list the copy prompt gives the model", () => {
    /* The prompt is prose for a model, so this reads the paragraph rather than
       a data structure: every backticked path in § Links' first item. If that
       paragraph is rewritten this test fails, which is the right outcome — the
       two lists disagreeing quietly is what put `/read` in both of them. */
    const prompt = readFileSync(path.join(REPO, "scripts/changelog/copy-prompt.md"), "utf8");
    /* `[\s\S]` rather than `[^]` for "any character, newlines included": the
       two mean the same thing and only one of them reads as a typo. */
    const para = /addresses you may use are exactly these[\s\S]*?No fragments/.exec(prompt)?.[0];
    expect(para, "the § Links paragraph has moved or been reworded").toBeTruthy();
    const quoted = [...(para ?? "").matchAll(/`(\/[^`]*)`/g)].map((m) => m[1] as string);
    const named = new Set(quoted.filter((p) => !p.includes("…") && !p.includes("#")));
    expect([...named].sort()).toEqual([...OK_LINK_PATHS].sort());
  });
});

describe("parseChangelog on a line that is wrong", () => {
  it("reports a sha that is not 40 hex characters", () => {
    const { problems } = parseOf(version({ entries: [entry({ commits: ["abc123"] })] }));
    expect(problems.join(" ")).toContain("is not a 40-character sha");
  });

  it("reports an entry that cites no sources", () => {
    const { problems } = parseOf(
      version({ entries: [entry({ provenance: { sources: [], verdicts: [] } })] }),
    );
    expect(problems.join(" ")).toContain("cites no sources");
  });

  it("reports entries out of section order", () => {
    const { problems } = parseOf(
      version({ entries: [entry({ section: "fix" }), entry({ section: "enhancement" })] }),
    );
    expect(problems.join(" ")).toContain("not in headline > enhancement > fix order");
  });

  it("reports three headlines on a version that is not the launch note", () => {
    const three = version({ entries: [entry(), entry(), entry()] });
    expect(three.version).not.toBe(LAUNCH_VERSION);
    expect(parseOf(three).problems.join(" ")).toContain("3 headlines");

    /* The launch version had nothing to be a change from, so the cap is lifted
       for it alone — changelog.md § The first run is retrospective. */
    const launch = version({ version: LAUNCH_VERSION, entries: [entry(), entry(), entry()] });
    expect(parseOf(launch).problems).toEqual([]);
  });

  it("reports a previous_sha that is not the line above's sha", () => {
    const first = version();
    const second = version({
      version: "2026-09-05T23:00:00Z",
      deployment_id: "dpl_two",
      sha: SHA_B,
      previous_sha: "c".repeat(40),
    });
    expect(parseOf(first, second).problems.join(" ")).toContain(
      "previous_sha is not the line above's sha",
    );
  });

  /**
   * **The fields nothing else would miss.**
   *
   * Each of these was accepted in silence until 2026-09-06, when a cross-family
   * review of the runner exercised the parser directly and got `problems: []`
   * from every one of them. They matter for the same reason: `entries` is read
   * by the page and `sha` by the writer, so a fault in either surfaces
   * somewhere, while a line that has forgotten when it shipped, how much it
   * shipped, or which models wrote it renders perfectly and quietly stops being
   * the evidence the whole process exists to produce.
   */
  it("reports a version stamp that is shaped right but is not a date", () => {
    const { problems } = parseOf(version({ version: "2026-99-99T99:99:99Z" }));
    expect(problems.join(" ")).toContain("is not a real date");
  });

  it("reports a commit_count that is not a non-negative whole number", () => {
    expect(parseOf(version({ commit_count: "3" })).problems.join(" ")).toContain(
      "is not a non-negative whole number",
    );
    expect(parseOf(version({ commit_count: -1 })).problems.join(" ")).toContain(
      "is not a non-negative whole number",
    );
    expect(parseOf(version({ commit_count: 2.5 })).problems.join(" ")).toContain(
      "is not a non-negative whole number",
    );
  });

  it("reports a missing generated_at and a stage with no model named", () => {
    const noStamp = version({ generated_at: undefined });
    expect(parseOf(noStamp).problems.join(" ")).toContain("generated_at");
    const noModel = version({ generated_by: { trawl: "t", review: "", copy: "c" } });
    expect(parseOf(noModel).problems.join(" ")).toContain("generated_by.review");
  });

  it("reports a provenance verdict outside the vocabulary", () => {
    const made_up = version({
      entries: [entry({ provenance: { sources: [0], verdicts: ["definitely"] } })],
    });
    expect(parseOf(made_up).problems.join(" ")).toContain('verdict "definitely"');
  });

  it("reports two lines claiming the same deployment", () => {
    const first = version();
    const second = version({
      version: "2026-09-05T23:00:00Z",
      sha: SHA_B,
      previous_sha: SHA_A,
    });
    expect(second.deployment_id).toBe(first.deployment_id);
    expect(parseOf(first, second).problems.join(" ")).toContain("deployment_id already used by");
  });

  /**
   * **The page renders these as anchors**, which makes an unvetted URL the one
   * defect in this file that could hurt somebody rather than merely mislead
   * them. Dropped as well as reported: tolerance elsewhere means returning a
   * usable record, and a link we cannot account for is not usable.
   */
  it("drops and reports a link that goes somewhere other than the app or this repo", () => {
    for (const url of ["https://evil.example/phish", "//evil.example", "javascript:alert(1)"]) {
      const bad = parseOf(version({ entries: [entry({ links: [{ label: "More", url }] })] }));
      expect(bad.problems.join(" "), url).toContain("is neither an app path nor a commit in");
      expect(bad.versions[0]?.entries[0]?.links, url).toEqual([]);
    }

    /* The two shapes that are the point of having links at all. */
    const good = parseOf(
      version({
        entries: [
          entry({
            links: [
              { label: "Your library", url: "/" },
              { label: "The commit", url: `${REPO_URL}/commit/${SHA_B}` },
            ],
          }),
        ],
      }),
    );
    expect(good.problems).toEqual([]);
    expect(good.versions[0]?.entries[0]?.links).toHaveLength(2);
  });

  /**
   * A redeploy is `A → A`; `A → B → A` is a **rollback**, which puts a different
   * product in front of readers and cannot be waved through as the no-op the
   * line above it is. The distinction was missing until 2026-09-06 and the chain
   * reported nothing about the second case.
   */
  it("reports the same sha again when it is not the line immediately above", () => {
    const SHA_C = "c".repeat(40);
    const a = version({ version: "2026-08-27T07:06:08Z" });
    const b = version({
      version: "2026-08-27T07:36:09Z",
      deployment_id: "dpl_b",
      sha: SHA_C,
      previous_sha: SHA_A,
    });
    const backToA = version({
      version: "2026-08-27T08:06:10Z",
      deployment_id: "dpl_c",
      previous_sha: SHA_C,
      commit_count: 0,
      invisible: true,
      entries: [],
    });
    expect(parseOf(a, b, backToA).problems.join(" ")).toContain("a rollback, not a redeploy");
  });

  it("says nothing about a redeploy — the same sha again, with no commits", () => {
    /* 2026-08-27 shipped `903b33e6` twice, half an hour apart. The second is a
       version with nothing in it, not a mistake, and it is in the committed
       file. A duplicate sha only matters when the second line claims work. */
    const first = version({ version: "2026-08-27T07:06:08Z" });
    const redeploy = version({
      version: "2026-08-27T07:36:09Z",
      deployment_id: "dpl_again",
      previous_sha: SHA_A,
      commit_count: 0,
      invisible: true,
      entries: [],
    });
    expect(parseOf(first, redeploy).problems).toEqual([]);

    /* But the same sha again claiming commits would count somebody's work twice. */
    const claims = { ...redeploy, commit_count: 4 };
    expect(parseOf(first, claims).problems.join(" ")).toContain("sha already used by");
  });
});
