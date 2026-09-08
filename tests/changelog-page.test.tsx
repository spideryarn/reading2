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
import {
  ChangelogBody,
  groupForDisplay,
  releaseAnchor,
  releaseFromAnchor,
} from "../src/web/ChangelogPage.js";

/** What `groupForDisplay` returns, named so a `filter` predicate can narrow it. */
type DisplayItemForTest = ReturnType<typeof groupForDisplay>[number];

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
  /* **The address is shared state, and jsdom does not reset it between tests.**
     `ChangelogBody` seeds its open set from `location.hash`, so a test that
     leaves `#release-1` behind opens a second release in every test after it —
     which is a pass or a failure depending only on the order vitest happened to
     run them in. Cleared here rather than in the two tests that set it, so the
     next one to set a hash cannot forget. */
  history.replaceState(null, "", window.location.pathname);
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
const SHA_E = "e".repeat(40);

/**
 * Four releases, oldest first: loud, quiet, quiet, loud.
 *
 * The **lines** rather than the parsed versions, because a release's number is a
 * property of its line's position in a file — so the tests that are about
 * numbering have to be able to add a line, or break one, and parse the whole
 * thing again.
 */
const FIXTURE_LINES: readonly string[] = [
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
];

function fixtureVersions(): ChangelogVersion[] {
  const { versions, problems } = parseChangelog(FIXTURE_LINES.join("\n"));
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
   * **Greg, 2026-09-07: *"I found the difference between the link to the
   * changes and the commit a bit confusing."*** They were the same thing drawn
   * twice — the copy stage links one commit inline, usually labelled *the
   * change*, and leaves the rest to `commits`, so the page drew one commit as
   * an orange link beside `/features` and the others as tiny grey shas.
   *
   * The page used to answer that by *subtracting* the linked sha from the sha
   * row (an earlier browser pass counted 855 commit links against the file's
   * 619). It answers it now by sorting links on where they point: every commit
   * is a sha in one row, and the label goes. Both rules forbid a duplicate, so
   * the assertion that mattered — one link per commit — is the one kept.
   */
  it("draws each commit exactly once, whichever field it arrived in", async () => {
    const { versions } = parseChangelog(
      versionLine({
        /* The **release's** sha is deliberately not the entry's. The release
           links its own commit too ("Built from commit …"), which is a different
           fact from "this entry came from that commit" — so a fixture where they
           were the same sha counted two perfectly correct links as a duplicate.
           It failed exactly that way when this test was written. */
        version: "2026-09-06T09:49:03Z",
        sha: SHA_D,
        previous_sha: null,
        title: "One commit, linked inline",
        commits: [SHA_A],
        links: [{ label: "the change", url: commitUrl(SHA_A) }],
      }),
    );
    await draw(versions);
    expect(
      [...host.querySelectorAll("a")].filter((a) => a.getAttribute("href") === commitUrl(SHA_A)),
    ).toHaveLength(1);
  });

  /**
   * **The label is what confused Greg, so the label may not survive.** A commit
   * that reaches the page as a named link — *the change*, or anything else the
   * copy stage writes — is drawn as a sha like every other commit.
   */
  it("does not draw a commit as a named link", async () => {
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
    expect(host.textContent).not.toContain("the change");
    expect(host.textContent).toContain(SHA_A.slice(0, 7));
  });

  /**
   * **Within `commits`, not only across `commits` and `links`.** Nothing
   * upstream forbids or reports `"commits": [sha, sha]`, and the first version
   * of `splitEntryLinks` deduplicated only in the other direction — so it drew
   * the same commit twice, under two identical React keys. GPT Sol's review, P2:
   * the test that existed proved deduplication in the direction it did happen in.
   */
  it("draws a commit once even when the entry lists it twice", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_D,
        previous_sha: null,
        title: "The same commit, twice",
        commits: [SHA_A, SHA_A],
      }),
    );
    await draw(versions);
    expect(
      [...host.querySelectorAll("a")].filter((a) => a.getAttribute("href") === commitUrl(SHA_A)),
    ).toHaveLength(1);
  });

  it("lists every commit behind an entry, linked inline or not", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Two commits, one of them only linked",
        commits: [SHA_B],
        links: [{ label: "the change", url: commitUrl(SHA_A) }],
      }),
    );
    await draw(versions);
    expect(host.textContent).toContain(SHA_A.slice(0, 7));
    expect(host.textContent).toContain(SHA_B.slice(0, 7));
  });

  /**
   * **A link into the app is not a commit and must not be swallowed by the sha
   * row.** That row is the other half of the fix, and a `/features` link turned
   * into seven hex characters would be the same confusion inverted.
   */
  it("keeps a link into the app as a link, with its label", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Somewhere to go and try it",
        commits: [SHA_A],
        links: [
          { label: "Quotes", url: "/features" },
          { label: "the change", url: commitUrl(SHA_A) },
        ],
      }),
    );
    await draw(versions);
    const app = [...host.querySelectorAll("a")].filter(
      (a) => a.getAttribute("href") === "/features",
    );
    expect(app).toHaveLength(1);
    expect(app[0]?.textContent).toContain("Quotes");
  });

  /**
   * Greg, 2026-09-07: *"include a link to GitHub for the commit corresponding
   * to each version."* A release's own sha need not appear in any of its
   * entries, so nothing above would catch this link going missing.
   */
  it("links the release's own commit, not only its entries'", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_D,
        previous_sha: null,
        title: "An entry whose commits are not the release's",
        commits: [SHA_A],
      }),
    );
    await draw(versions);
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(commitUrl(SHA_D));
  });
});

/**
 * **The number is the release's line in the file, counted from the oldest**, so
 * a release keeps its number for ever as new ones are appended — and quiet
 * releases are counted even though they are never drawn, so the numbers on the
 * page and the lines in the file stay in step. ChangelogPage.tsx § A release is
 * shut, and its number is its line, has why it is not minted at deploy time.
 */
describe("release numbers", () => {
  it("count from the oldest release, so the newest has the highest", () => {
    const items = groupForDisplay(fixtureVersions());
    const numbers = items
      .filter((i): i is Extract<typeof i, { kind: "version" }> => i.kind === "version")
      .map((i) => i.release);
    /* Four in the fixture — loud, quiet, quiet, loud — and the two quiet ones
       are counted even though the page never draws them. */
    expect(numbers).toEqual([4, 1]);
  });

  /** The numbers a page would draw, newest first. */
  function drawnNumbers(versions: ChangelogVersion[]): number[] {
    return groupForDisplay(versions)
      .filter((i): i is Extract<DisplayItemForTest, { kind: "version" }> => i.kind === "version")
      .map((i) => i.release);
  }

  it("do not renumber when a newer release is added on top", () => {
    /* Parsed as one file rather than two results concatenated, because the
       number is a fact about a line's position in *its* file — sticking two
       parses together would give the appended line the number 1 and prove
       nothing about appending. */
    const grown = parseChangelog(
      [
        FIXTURE_LINES.join("\n"),
        versionLine({
          version: "2026-09-07T00:00:00Z",
          sha: SHA_E,
          previous_sha: SHA_D,
          title: "Newer still",
        }),
      ].join("\n"),
    );
    expect(grown.problems).toEqual([]);
    expect(drawnNumbers(fixtureVersions())).toEqual([4, 1]);
    /* The two that were 4 and 1 are still 4 and 1; the new one is 5. */
    expect(drawnNumbers(grown.versions)).toEqual([5, 4, 1]);
  });

  /**
   * **A line that cannot be parsed takes its own number down with it, and moves
   * nothing else.**
   *
   * The page's rule is *never blank the page* — a bad line is dropped and
   * reported rather than thrown — so if the number were an index into what
   * survived, one bad line would silently renumber every release above it. That
   * is exactly the shape docs/reusable/silent-success.md is about: nothing
   * fails, and the answer is wrong. `tests/changelog-file.test.ts` says the real
   * file has no such line, which is what keeps this hypothetical; this is the
   * test that says it would not matter if it did.
   */
  it("keep their numbers when a line above them fails to parse", () => {
    const lines = [...FIXTURE_LINES];
    lines[1] = "{ not json at all";
    const broken = parseChangelog(lines.join("\n"));
    /* Two problems, not one, and the second is the interesting one: dropping a
       line breaks the `previous_sha` chain across the gap as well. Asserted by
       what they name rather than by their count, so this test is about the
       numbering and does not also become a spelling test for `chainProblems`. */
    expect(broken.problems.some((p) => p.startsWith("line 2:"))).toBe(true);
    /* Release 2 is gone. Releases 4 and 1 are exactly where they were. */
    expect(drawnNumbers(broken.versions)).toEqual([4, 1]);
  });
});

/**
 * Greg, 2026-09-07: *"make each version a collapsible section, all
 * default-collapsed except the most recent one."*
 *
 * *"The most recent"* is read as the newest release **that is drawn**, not the
 * newest line in the file: the newest deploy is more often than not a quiet
 * one, and a page that opened nothing on those days would be the letter of the
 * instruction and none of the point of it.
 */
describe("which releases start open", () => {
  it("opens the newest drawn release and no other", async () => {
    await draw(fixtureVersions());
    const boxes = [...host.querySelectorAll("details")];
    expect(boxes).toHaveLength(2);
    expect(boxes.map((d) => d.open)).toEqual([true, false]);
  });

  it("opens the newest release with entries, even when quieter ones are newer", async () => {
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
    const boxes = [...host.querySelectorAll("details")];
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.open).toBe(true);
  });
});

/**
 * Greg, 2026-09-07: *"add a table of contents to /changelog."*
 *
 * **Every row has to say something the shut release below it does not**, or the
 * list is fifty rows repeating fifty rows. What it says is that release's
 * headline titles, falling back to its counts when it has none.
 */
describe("the contents list", () => {
  it("has one row per drawn release, and none for the quiet ones", async () => {
    await draw(fixtureVersions());
    expect(host.querySelectorAll('nav[aria-label="Releases"] li')).toHaveLength(2);
  });

  it("names a release's headline changes, so it is not a copy of the rows below", async () => {
    await draw(fixtureVersions());
    const nav = host.querySelector('nav[aria-label="Releases"]');
    expect(nav?.textContent).toContain("The first headline");
  });

  it("falls back to the counts for a release with no headline entry", async () => {
    const { versions } = parseChangelog(
      versionLine({
        version: "2026-09-06T09:49:03Z",
        sha: SHA_A,
        previous_sha: null,
        title: "Only a fix",
        section: "fix",
      }),
    );
    await draw(versions);
    expect(host.querySelector('nav[aria-label="Releases"]')?.textContent).toContain("1 bug fix");
  });

  it("points each row at a release that is actually on the page", async () => {
    await draw(fixtureVersions());
    const hrefs = [...host.querySelectorAll('nav[aria-label="Releases"] a')].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([`#${releaseAnchor(4)}`, `#${releaseAnchor(1)}`]);
    for (const href of hrefs) {
      expect(host.querySelector(`details#${href?.slice(1)}`), href ?? "").not.toBeNull();
    }
  });

  /**
   * **A plain click opens the release and lets the browser navigate.**
   *
   * The first version called `preventDefault()` and scrolled by hand, which cost
   * the address bar, a reload, Back, and a Ctrl-click — four things at once, and
   * every one of them invisible to a test that only asked whether the box
   * opened. GPT Sol's review, P2. So this asserts on the event as well as the
   * state: the default must survive.
   */
  it("opens a release on a plain click, without cancelling the navigation", async () => {
    await draw(fixtureVersions());
    const shut = host.querySelector<HTMLDetailsElement>(`details#${releaseAnchor(1)}`);
    expect(shut?.open).toBe(false);

    const link = host.querySelector<HTMLAnchorElement>(
      `nav[aria-label="Releases"] a[href="#${releaseAnchor(1)}"]`,
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link?.dispatchEvent(click);
    });
    expect(shut?.open).toBe(true);
    expect(click.defaultPrevented, "the fragment navigation must not be cancelled").toBe(false);
  });

  /**
   * **A modified click belongs to the browser entirely.** It opens a new tab —
   * where `#release-1` is read on mount — so this tab must not cancel it. That
   * is the regression worth pinning: the first version called `preventDefault()`
   * unconditionally, so a Ctrl-click opened a new tab at the *top* of the page.
   *
   * **Only `defaultPrevented` is asserted, and that is jsdom's fault rather than
   * a gap.** jsdom does not model "a modified click opens another tab"; it
   * follows the fragment in this document, fires `hashchange`, and the handler
   * that exists for Back opens the box. So "the box stays shut" is not a fact
   * about this code that jsdom can be asked. Asserting it anyway is how a test
   * comes to encode the runner's limitations as the product's behaviour.
   */
  it("leaves a Ctrl- or Cmd-click alone", async () => {
    await draw(fixtureVersions());
    const link = host.querySelector<HTMLAnchorElement>(
      `nav[aria-label="Releases"] a[href="#${releaseAnchor(1)}"]`,
    );
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      await act(async () => {
        link?.dispatchEvent(click);
      });
      expect(click.defaultPrevented, modifier).toBe(false);
    }
  });
});

/**
 * **The hash was read on mount and nowhere else**, so going Back out of a jump —
 * or following a second `#release-…` link inside the page — moved the browser to
 * a release React had left shut: the page scrolled and nothing opened. GPT Sol's
 * review, P2. `hashchange` is the event for exactly that.
 */
describe("a fragment that changes after the page has loaded", () => {
  it("opens the release the new fragment names", async () => {
    await draw(fixtureVersions());
    const shut = host.querySelector<HTMLDetailsElement>(`details#${releaseAnchor(1)}`);
    expect(shut?.open).toBe(false);

    history.replaceState(null, "", `#${releaseAnchor(1)}`);
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(shut?.open).toBe(true);
  });

  it("ignores a fragment that is not a release", async () => {
    await draw(fixtureVersions());
    const openCount = () =>
      [...host.querySelectorAll("details")].filter((d) => d.open).length;
    const before = openCount();

    history.replaceState(null, "", "#spya-k3m9qt");
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(openCount()).toBe(before);
  });
});

/**
 * `releaseFromAnchor` reads whatever is in the address bar, which is whatever
 * somebody typed — so what it refuses matters as much as what it accepts.
 */
describe("reading a release number out of an anchor", () => {
  it("reads the number a release anchor names", () => {
    expect(releaseFromAnchor(releaseAnchor(42))).toBe(42);
  });

  it("refuses anything that is not exactly a release anchor", () => {
    for (const bad of ["", "release-", "release-0", "release-4x", "release--1", "spya-k3m9qt"]) {
      expect(releaseFromAnchor(bad), bad).toBeNull();
    }
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
