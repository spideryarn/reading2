// @vitest-environment jsdom
/**
 * `/changelog`, actually rendered — src/web/ChangelogPage.tsx.
 *
 * `src/changelog/parse.test.ts` (if it exists) or the pipeline's own tests
 * cover the NDJSON format; what only a render can see is the display logic
 * this page adds on top of it: quiet releases collapsing into one line,
 * newest-first order, and a commit sha actually linking where it says it
 * does. `ChangelogBody` and `groupForDisplay` are exported so this file can
 * drive them with synthetic versions instead of the real 210 KB file — the
 * same reason `not-found-page.test.tsx` and `admin-page.test.tsx` mount the
 * real component rather than a stand-in, but without paying for the whole
 * changelog on every run.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitUrl, parseChangelog, type ChangelogVersion } from "../src/changelog.js";
import { ChangelogBody, groupForDisplay } from "../src/web/ChangelogPage.js";

/* What every other React test file here sets, and this one did not until the
   warning was read rather than skimmed: without it `act()` does not flush, so
   an assertion can land on a render that has not settled — a test that passes
   for a reason unrelated to the one it claims. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** One NDJSON line, as `writeVersion` in the writer would leave it. */
function versionLine(v: {
  version: string;
  sha: string;
  previous_sha: string | null;
  title?: string;
  section?: "headline" | "enhancement" | "fix";
  commits?: string[];
  links?: { label: string; url: string }[];
}): string {
  const entries = v.title
    ? [
        {
          id: null,
          section: v.section ?? "headline",
          title: v.title,
          body: `${v.title}, in full.`,
          where: null,
          links: v.links ?? [],
          commits: v.commits ?? [],
          provenance: { sources: [0], verdicts: ["confirmed"] },
        },
      ]
    : [];
  return JSON.stringify({
    version: v.version,
    deployment_id: `dpl_${v.sha.slice(0, 8)}`,
    sha: v.sha,
    previous_sha: v.previous_sha,
    commit_count: entries.length > 0 ? 3 : 0,
    invisible: entries.length === 0,
    generated_at: "2026-09-06T10:00:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries,
  });
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);

/** Four releases, oldest first: loud, quiet, quiet, loud. */
function fixtureVersions(): ChangelogVersion[] {
  const text = [
    versionLine({
      version: "2026-09-01T00:00:00Z",
      sha: SHA_A,
      previous_sha: null,
      title: "The first headline",
      commits: [SHA_A],
    }),
    versionLine({ version: "2026-09-02T00:00:00Z", sha: SHA_B, previous_sha: SHA_A }),
    versionLine({ version: "2026-09-03T00:00:00Z", sha: SHA_C, previous_sha: SHA_B }),
    versionLine({
      version: "2026-09-06T09:49:03Z",
      sha: SHA_D,
      previous_sha: SHA_C,
      title: "The newest headline",
      section: "fix",
      commits: [SHA_D],
    }),
  ].join("\n");
  const { versions, problems } = parseChangelog(text);
  expect(problems).toEqual([]);
  return versions;
}

async function draw(versions: ChangelogVersion[]): Promise<void> {
  await act(async () => root.render(<ChangelogBody versions={versions} />));
}

describe("grouping releases for display", () => {
  it("puts the newest release first", () => {
    const items = groupForDisplay(fixtureVersions());
    const first = items[0];
    expect(first?.kind).toBe("version");
    expect(first?.kind === "version" && first.version.sha).toBe(SHA_D);
  });

  it("collapses a run of consecutive quiet releases into one line", () => {
    const items = groupForDisplay(fixtureVersions());
    // newest headline, then the two quiet ones collapsed, then the oldest headline
    expect(items.map((i) => i.kind)).toEqual(["version", "quiet", "version"]);
    const quiet = items[1];
    expect(quiet?.kind === "quiet" && quiet.count).toBe(2);
  });

  it("never mentions a deploy, an invisible version, or any other internal word", async () => {
    await draw(fixtureVersions());
    for (const word of ["invisible", "deploy"]) {
      expect(host.textContent?.toLowerCase()).not.toContain(word);
    }
  });
});

describe("the page's three headings", () => {
  it("shows only the headings that have entries", async () => {
    // One release, one headline entry, nothing under Minor enhancements or Bug fixes.
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Only a headline",
      }),
    );
    await draw(versions);
    expect(host.textContent).toContain("Headline changes");
    expect(host.textContent).not.toContain("Minor enhancements");
    expect(host.textContent).not.toContain("Bug fixes");
  });

  it("shows Bug fixes when that is the only section with an entry", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "A quiet fix",
        section: "fix",
      }),
    );
    await draw(versions);
    expect(host.textContent).not.toContain("Headline changes");
    expect(host.textContent).toContain("Bug fixes");
  });
});

/**
 * **A reader moving by heading has to be able to tell a release from a section
 * from an entry**, and the levels are the only thing that says so.
 *
 * They were h1 → h3 → h4 → h4: a skipped level, and then a section and the
 * entries under it claiming to be siblings. It looked right, because the sizes
 * are set by classes rather than by the level. GPT Sol's review, 2026-09-06.
 */
describe("the heading levels", () => {
  it("go release, section, entry without skipping or repeating a level", async () => {
    await draw(fixtureVersions());
    const levels = [...host.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName);
    /* The body starts at h2 because the page's own <h1> is above it. */
    expect(levels[0]).toBe("H2");
    expect(levels).toContain("H3");
    expect(levels).toContain("H4");
    for (let i = 1; i < levels.length; i++) {
      const prev = Number((levels[i - 1] ?? "H2").slice(1));
      const here = Number((levels[i] ?? "H2").slice(1));
      expect(here, `${levels[i - 1]} → ${levels[i]} skips a level`).toBeLessThanOrEqual(prev + 1);
    }
  });
});

describe("commit links", () => {
  it("point a sha at its own commit, not at the repo root", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Something with a commit",
        commits: [SHA_A, SHA_B],
      }),
    );
    await draw(versions);
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(commitUrl(SHA_A));
    expect(hrefs).toContain(commitUrl(SHA_B));
  });

  it("shows the short form of the sha, not the full 40 characters", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Something with a commit",
        commits: [SHA_A],
      }),
    );
    await draw(versions);
    expect(host.textContent).toContain(SHA_A.slice(0, 7));
    expect(host.textContent).not.toContain(SHA_A);
  });

  /**
   * The copy stage links the main commit inline, usually as *the change*, and
   * leaves the rest to `commits`. Drawing `commits` whole therefore put the
   * same commit on the page twice — for a single-commit entry, the entire row
   * duplicated. A browser pass counted 855 commit links against the file's 619.
   */
  it("does not repeat a commit the copy already linked", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "One commit, linked inline",
        commits: [SHA_A],
        links: [{ label: "the change", url: commitUrl(SHA_A) }],
      }),
    );
    await draw(versions);
    expect(host.textContent).toContain("the change");
    expect(host.textContent).not.toContain(SHA_A.slice(0, 7));
    expect([...host.querySelectorAll("a")].filter((a) => a.getAttribute("href") === commitUrl(SHA_A)))
      .toHaveLength(1);
  });

  it("still lists the commits the copy did not link", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Two commits, one linked inline",
        commits: [SHA_A, SHA_B],
        links: [{ label: "the change", url: commitUrl(SHA_A) }],
      }),
    );
    await draw(versions);
    expect(host.textContent).not.toContain(SHA_A.slice(0, 7));
    expect(host.textContent).toContain(SHA_B.slice(0, 7));
  });
});

/**
 * **"In between" is a claim about what is above the line.**
 *
 * The newest release is quiet more often than not — that is the whole reason
 * these collapse — so this line opens the page on most days, where there is
 * nothing for it to be between.
 */
describe("the line that stands in for quiet releases", () => {
  it("says 'in between' only when there is a release above it", async () => {
    await draw(fixtureVersions());
    expect(host.textContent).toContain("in between");
    expect(host.textContent).not.toContain("most recent release");
  });

  it("says what it means at the top, where nothing is above it", async () => {
    /* Newest first on the page, so a quiet newest release is the opening line. */
    const { versions } = parseChangelog(
      [
        versionLine({
          version: "2026-09-01T00:00:00Z",
          sha: SHA_A,
          previous_sha: null,
          title: "The only release with anything in it",
        }),
        versionLine({ version: "2026-09-02T00:00:00Z", sha: SHA_B, previous_sha: SHA_A }),
      ].join("\n"),
    );
    await draw(versions);
    expect(host.textContent).toContain("The most recent release changed nothing");
    expect(host.textContent).not.toContain("in between");
  });
});

describe("a file whose lines are partly broken", () => {
  it("still renders the releases that parsed", async () => {
    const bad = "{not json at all";
    const good = versionLine({
      version: "2026-09-06T09:49:03Z",
      sha: SHA_A,
      previous_sha: null,
      title: "A release that parsed fine",
    });
    const { versions, problems } = parseChangelog(`${bad}\n${good}`);
    expect(problems.length).toBeGreaterThan(0);
    expect(versions).toHaveLength(1);
    await draw(versions);
    expect(host.textContent).toContain("A release that parsed fine");
  });
});
