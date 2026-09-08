/**
 * `/changelog` — every release since launch, most recent first.
 *
 * Greg, 2026-09-06, in the process this page is the last stage of: *"the copy
 * will be aimed at smart, non-technical users, but we'll still include links
 * to the commits for curious technical users."* docs/project/changelog.md has
 * the whole pipeline; this file is only the reader of its output — the
 * decisions under "The page" there are recorded and implemented here, not
 * re-opened.
 *
 * ## The file reaches the browser through Vite's `?raw`
 *
 * No API route, no database: `src/web/changelog-versions.ndjson` is 210 KB of
 * committed text, and the simplest thing that ships it is a build-time string
 * import, parsed with `parseChangelog` (src/changelog.ts) exactly as the
 * writer re-reads its own output. **That import lives inside this,
 * lazily-loaded module and nowhere eager** — App.tsx reaches this page through
 * `LazyPage`, the way it reaches `/design`, so the 210 KB is not in any
 * reader's first download. `tests/eager-client-graph.test.ts` is what would
 * catch a future edit that moved the import somewhere eager.
 *
 * ## Newest first, and quiet releases collapse
 *
 * `parseChangelog` returns oldest first, matching the file on disk, so this
 * reverses before drawing anything. Most releases ship nothing a reader would
 * notice — that is `changelog.md`'s own measurement, not a guess — and listing
 * sixty-odd empty headings would bury the ones that matter, so a run of them
 * collapses into one muted line rather than being shown individually.
 * `groupForDisplay` below is the whole of that decision, pulled out so
 * `tests/changelog-page.test.tsx` can drive it without needing the real file.
 *
 * ## A release is shut, and its number is its line
 *
 * Greg, 2026-09-07: *"add a table of contents to /changelog, and make each
 * version a collapsible section, all default-collapsed except the most recent
 * one … And include a link to GitHub for the commit corresponding to each
 * version."* Drawn out, the page was **46,368 pixels tall** at 1280×1000 —
 * fifty releases with no way to see what was in it but to scroll all of it.
 *
 * **The number is the release's position in the file**, counted from the
 * oldest, and it is a display label rather than anything minted or stored. Greg
 * asked for a version number *"as part of the deploy"*; Fable's answer, which he
 * took, was that the deploy cannot honestly carry one — production builds on
 * Vercel's machine from a git push, `scripts/deploy.ts` has no channel into that
 * build's environment, and a release's own line in this file is always written
 * *after* it ships, so a build's sha is never in the copy of the file it is
 * carrying. What both sides do hold with certainty is the sha. So the number
 * lives here, where the whole file is in hand and the count cannot be wrong, and
 * the logo's tooltip says the build date and the sha instead (HomeLogo.tsx).
 *
 * A number, once given, never changes: new releases are appended, so counting
 * from the oldest end means release 42 is release 42 for ever. **Quiet releases
 * are counted too** even though they are never drawn, so the numbers on the page
 * and the lines in the file stay in step — as does the one line that is a
 * redeploy of the line above it (line 6, 2026-08-27, the same sha as line 5).
 *
 * `<details>`/`<summary>` rather than a `<div>` and an `aria-expanded`: correct
 * for the keyboard and for a screen reader with no work. **Which release is open
 * is React state all the same** — the first draft let the element keep its own
 * and had the contents list write `details.open` directly, and arriving at
 * `/changelog#release-64` then scrolled to release 64 and left it shut, because
 * a re-render put the attribute back. `VersionBlock` has the measurement.
 *
 * ## One place commits appear
 *
 * Greg, same message: *"I found the difference between the link to the changes
 * and the commit a bit confusing."* They were the same thing drawn twice — an
 * entry's `links` carry a commit labelled *"the change"*, in highlight orange
 * beside a link to `/features`, and its `commits` carry the rest, tiny and grey
 * underneath. So this file no longer sorts an entry's links by where they came
 * from. It sorts them by **where they point**: a path is somewhere in the app to
 * go and try the thing, and everything else is a commit, which joins the sha row
 * under the GitHub mark. `shaFromCommitUrl` in src/changelog.ts is that
 * question, asked once.
 *
 * Nothing about the file or the copy stage changes for this: the prompt goes on
 * emitting *"the change"* and the page stops drawing it twice. Sixty-nine
 * committed lines already say it, so the page has to handle them either way.
 *
 * ## Never blank the page
 *
 * `parseChangelog` reports a bad line rather than throwing, and this renders
 * whatever parsed — the reader never sees `problems`, and neither does this
 * file's layout: a release that failed to parse simply is not there, the same
 * as a release that shipped nothing.
 */
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SECTIONS,
  commitUrl,
  parseChangelog,
  shaFromCommitUrl,
  type ChangelogEntry,
  type ChangelogLink,
  type ChangelogVersion,
  type Section,
} from "../changelog.js";
import { GitHubMark } from "./GitHubMark.js";
import { Link } from "./Link.js";
import { CHANGELOG_LABEL } from "./router.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SiteFooter } from "./SiteFooter.js";
/* The 210 KB the header above is about. Only ever reached through this
   lazily-loaded module — see LazyPage.tsx and App.tsx § loadChangelog.

   **Beside this file, and that is not a filing preference.** It lived in
   `docs/`, which `.vercelignore` prunes out of the upload, so the import
   resolved on every laptop and in the deploy's own `build` gate and failed on
   Vercel alone —
   docs/postmortems/260907a-an-import-into-a-vercelignored-directory-built-everywhere-except-vercel.md. */
import versionsText from "./changelog-versions.ndjson?raw";

/** What each section is called on the page, in the order `changelog.md` sets. */
const SECTION_LABEL: Record<Section, string> = {
  headline: "Headline changes",
  enhancement: "Minor enhancements",
  fix: "Bug fixes",
};

/**
 * How a section is counted in the shut row and in the contents list.
 *
 * Not `SECTION_LABEL` lower-cased: *"2 headline changes"* is right and
 * *"2 minor enhancements"* is not — the word "minor" is a heading's framing of a
 * group, not a property of each thing in it.
 */
const SECTION_COUNT_LABEL: Record<Section, [one: string, many: string]> = {
  headline: ["headline change", "headline changes"],
  enhancement: ["enhancement", "enhancements"],
  fix: ["bug fix", "bug fixes"],
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `"2026-09-06T09:49:03Z"` → `"6 September 2026, 09:49"`.
 *
 * Read and formatted in UTC throughout, deliberately: the stamp *is* UTC
 * (changelog.md), and formatting it in the viewer's own zone would make a
 * release's date depend on who is reading rather than when it shipped.
 */
export function formatVersionStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()] ?? "";
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

/** `"2026-09-06T09:49:03Z"` → `"6 Sep"`, for the contents list's narrow column. */
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${(MONTHS[d.getUTCMonth()] ?? "").slice(0, 3)}`;
}

/**
 * *"2 headline changes · 1 bug fix"* — what a shut release says it holds.
 *
 * Sections in `SECTIONS` order, and a section with nothing in it is left out
 * rather than drawn as a zero.
 */
function describeContents(version: ChangelogVersion): string {
  return SECTIONS.map((section) => {
    const n = version.entries.filter((e) => e.section === section).length;
    if (n === 0) return null;
    const [one, many] = SECTION_COUNT_LABEL[section];
    return `${n} ${n === 1 ? one : many}`;
  })
    .filter((s): s is string => s !== null)
    .join(" · ");
}

/**
 * An entry's links, sorted by **where they point** rather than by which field
 * they arrived in — see this file's header, and Greg's *"a bit confusing"*.
 *
 * `commits` keeps the entry's own order and gains any sha that only a link
 * mentioned, so nothing is lost by the sort and nothing appears twice.
 *
 * **Deduplicated across `commits` itself, not only against `links`.** The first
 * version built its list with `[...entry.commits]` and only checked the links
 * against it, so `"commits": [sha, sha]` — which nothing upstream forbids or
 * reports — drew the same commit twice under two identical React keys. GPT Sol's
 * review, P2; the test that existed proved deduplication in the direction it did
 * not happen in.
 *
 * A link that is neither a path nor one of our commits cannot reach here:
 * `parseChangelog` drops it and reports it (src/changelog.ts § `badLinkUrl`).
 */
export function splitEntryLinks(entry: ChangelogEntry): {
  appLinks: ChangelogLink[];
  commits: string[];
} {
  const appLinks: ChangelogLink[] = [];
  /* A `Set` rather than `includes` on an array: it is the structure that means
     "each of these once", and it keeps insertion order, which is the order the
     entry listed its commits in. */
  const commits = new Set(entry.commits);
  for (const link of entry.links) {
    const sha = shaFromCommitUrl(link.url);
    if (sha === null) appLinks.push(link);
    else commits.add(sha);
  }
  return { appLinks, commits: [...commits] };
}

/** The faint row of shas, under a GitHub mark so its kind is legible at a glance. */
function CommitRow({ commits }: { commits: string[] }) {
  if (commits.length === 0) return null;
  return (
    <p className="tw:mt-1.5 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-ink-faint">
      <GitHubMark size={12} className="tw:shrink-0 tw:opacity-70" />
      {commits.map((sha) => (
        <a
          key={sha}
          href={commitUrl(sha)}
          target="_blank"
          rel="noreferrer noopener"
          /* The accessible name says what the seven characters are. Read aloud,
             a bare "0297784" is a link to nowhere describable. */
          aria-label={`Commit ${sha.slice(0, 7)} on GitHub`}
          className="tw:font-mono tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          {sha.slice(0, 7)}
        </a>
      ))}
    </p>
  );
}

/** One thing that changed: its words, where to go and try it, and its commits. */
function Entry({ entry }: { entry: ChangelogEntry }) {
  const { appLinks, commits } = splitEntryLinks(entry);
  return (
    <div className="tw:mt-5 tw:first:mt-0">
      <h4 className="tw:m-0 tw:text-sm tw:font-semibold tw:leading-snug tw:text-foreground">
        {/* h1 page → h2 release → h3 section → h4 entry. The levels were h1 →
            h3 → h4 → h4, which reads fine and navigates badly: somebody moving
            by heading gets a skipped level and then cannot tell a section from
            an entry. GPT Sol's review of this page, 2026-09-06. */}
        {entry.title}
      </h4>
      <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        {entry.body}
      </p>
      {appLinks.length > 0 && (
        <p className="tw:mt-1.5 tw:mb-0 tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1 tw:text-sm">
          {appLinks.map((l) => (
            /* Every one of these is a path — `parseChangelog` will not let
               anything else through as a non-commit link — so `Link` is always
               right and there is no `target="_blank"` branch to get wrong. The
               arrow says *go here*, which is the whole difference between this
               row and the shas below it. */
            <Link
              key={l.url}
              href={l.url}
              className="tw:text-highlight tw:no-underline tw:hover:underline"
            >
              {l.label} <span aria-hidden="true">→</span>
            </Link>
          ))}
        </p>
      )}
      {/* Small and muted, for the curious rather than the ordinary reader —
          changelog.md's own instruction for this row. Every commit behind this
          entry, and the only place any of them appears: see the header. */}
      <CommitRow commits={commits} />
    </div>
  );
}

/** The `id` a release answers to, in the contents list and in the address bar. */
export function releaseAnchor(release: number): string {
  return `release-${release}`;
}

/**
 * One release: a shut box saying what is in it, opening onto its entries.
 *
 * **Controlled, rather than left to the element.** The first version of this
 * passed `open` as `true`-or-`undefined` and let the contents list set
 * `details.open` on the DOM node, on the reasoning that React does not manage an
 * attribute it was not given a value for. Measured in Chrome the same afternoon:
 * arriving at `/changelog#release-64` scrolled to release 64 and left it shut —
 * the effect ran, the element opened, and a re-render put it back. So the open
 * set is React state (`ChangelogBody`), `onToggle` reports the reader's own
 * clicks into it, and nothing writes to the DOM behind React's back.
 *
 * **`onToggle` also catches the openings that are nobody's click**, which is
 * what makes the arrangement safe rather than merely tidy. Chrome restores a
 * `<details>`'s open state from session history, and find-in-page opens one to
 * reveal a match; both fire `toggle`. Measured on a reload of
 * `/changelog#release-40` after a visit that had opened release 55: Chrome
 * brought 55 back open, and a later re-render left it open rather than slamming
 * it shut — so the state had absorbed it. Had this been `open={…}` with no
 * `onToggle`, React would have closed it on the reader at the next render.
 */
function VersionBlock({ version, release, open, onOpenChange }: {
  version: ChangelogVersion;
  release: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      id={releaseAnchor(release)}
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="changelog-release tw:group tw:mt-2 tw:scroll-mt-20 tw:overflow-hidden tw:rounded-md tw:border tw:border-rule"
    >
      <summary className="tw:flex tw:cursor-pointer tw:list-none tw:flex-wrap tw:items-baseline tw:gap-x-3 tw:gap-y-1 tw:px-3 tw:py-2.5 tw:hover:bg-surface-raised">
        {/* `list-none` here, and `changelog-release` above for the vendor pseudo
            element Safari needs (styles/changelog.css): the native triangle is
            drawn differently in every browser and cannot be aligned with a
            baseline row. The chevron below is ours, and it turns because
            `group-open:` reads the parent's `open` attribute. */}
        <ChevronRight
          size={14}
          className="tw:mt-0.5 tw:shrink-0 tw:self-start tw:text-ink-faint tw:transition-transform tw:group-open:rotate-90"
          aria-hidden="true"
        />
        <h2 className="tw:m-0 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2.5 tw:gap-y-0.5 tw:text-sm tw:font-normal tw:text-foreground">
          <span className="tw:font-medium">Release {release}</span>
          <span className="tw:text-xs tw:text-ink-faint">
            {formatVersionStamp(version.version)}
          </span>
        </h2>
        {/* Pushed to the right on a wide window and given a line of its own on a
            narrow one, because it is the least important thing in the row —
            narrow-windows.md § rows wrap. `w-full` below `sm` rather than
            letting it wrap on its own: wrapping put it beside the date, where
            two greys of the same size read as one confused sentence, and left
            the release's name broken across two lines to make room for it. */}
        <span className="tw:w-full tw:text-xs tw:text-ink-faint tw:sm:ml-auto tw:sm:w-auto">
          {describeContents(version)}
        </span>
      </summary>

      <div className="tw:border-t tw:border-rule tw:px-3 tw:pt-3 tw:pb-4">
        {SECTIONS.map((section) => {
          const entries = version.entries.filter((e) => e.section === section);
          if (entries.length === 0) return null;
          return (
            <div key={section} className="tw:mt-5 tw:first:mt-0">
              <h3 className="tw:m-0 tw:mb-2.5 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
                {SECTION_LABEL[section]}
              </h3>
              <div className="tw:border-l tw:border-rule tw:pl-3.5">
                {entries.map((e, i) => (
                  <Entry key={e.id ?? `${version.sha}-${section}-${i}`} entry={e} />
                ))}
              </div>
            </div>
          );
        })}

        {/* The release's own commit, which is Greg's *"a link to GitHub for the
            commit corresponding to each version"*. In the body rather than in
            the summary row: a link inside a `<summary>` both follows and toggles
            unless its click is stopped, and a control that does two things is
            worse than a row further down.

            **"Built from", not "Deployed from".** A version *is* a deploy
            (changelog.md), but "deploy" is our word for it and the reader's is
            "release" — and `tests/changelog-page.test.tsx` holds the whole page
            to that vocabulary, which is how the first wording of this line was
            caught. */}
        <p className="tw:mt-5 tw:mb-0 tw:border-t tw:border-rule tw:pt-3 tw:text-xs tw:text-ink-faint">
          <a
            href={commitUrl(version.sha)}
            target="_blank"
            rel="noreferrer noopener"
            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
          >
            <GitHubMark size={12} className="tw:opacity-70" />
            Built from commit <span className="tw:font-mono">{version.sha.slice(0, 7)}</span>
          </a>
        </p>
      </div>
    </details>
  );
}

/** One entry in the display list: a real release, or a run of quiet ones. */
type DisplayItem =
  | { kind: "version"; version: ChangelogVersion; release: number }
  /**
   * `after` is the sha of the release drawn immediately above this line, or
   * `"top"` when the list opens on one. It exists to be a React key: an index
   * would do today, because the list is built once from a build-time constant
   * and never reorders, but a key that is only correct while nothing moves is
   * the kind that stops being correct silently.
   */
  | { kind: "quiet"; count: number; after: string };

/**
 * Newest first, with consecutive quiet releases collapsed into one line.
 *
 * `versions` arrives oldest-first, the order `parseChangelog` gives it — see
 * the file header. A release is quiet exactly when it has no entries, which is
 * also what `invisible` means (parse.ts recomputes that field from the entries
 * it kept, so the two can never disagree).
 *
 * **`release` is `parseChangelog`'s own count of the file's lines**, carried
 * through rather than recomputed here as an array index — a line that fails to
 * parse would otherwise renumber every release above it, silently
 * (src/changelog.ts § `ChangelogVersion.release`). See this file's header for
 * why the number is worked out from the file at all and not minted at deploy
 * time.
 *
 * Exported for `tests/changelog-page.test.tsx`, which drives it with synthetic
 * versions rather than the real 210 KB file.
 */
export function groupForDisplay(versions: ChangelogVersion[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let quietRun = 0;
  let above = "top";
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i];
    if (!v) continue;
    if (v.entries.length === 0) {
      quietRun++;
      continue;
    }
    if (quietRun > 0) {
      items.push({ kind: "quiet", count: quietRun, after: above });
      quietRun = 0;
    }
    items.push({ kind: "version", version: v, release: v.release });
    above = v.sha;
  }
  if (quietRun > 0) items.push({ kind: "quiet", count: quietRun, after: above });
  return items;
}

/**
 * "Release" rather than "deploy" or "version" — the reader's word for it.
 *
 * **"In between" is only true when there is something above.** The newest
 * release is often a quiet one, so this line opens the page more days than not,
 * and there it was claiming to sit between the heading and the first entry.
 */
function quietLine(count: number, after: string): string {
  if (after === "top") {
    return count === 1
      ? "The most recent release changed nothing you’d notice."
      : `The ${count} most recent releases changed nothing you’d notice.`;
  }
  return `${count} release${count === 1 ? "" : "s"} in between with nothing you’d notice.`;
}

/**
 * `"release-64"` → `64`, and `null` for anything else in the address bar.
 *
 * The inverse of `releaseAnchor`, and it is deliberately strict about the digits
 * — a hash is whatever somebody typed, and `Number("release-64x")` is the sort
 * of question that answers `NaN` in one engine's mood and something else in
 * another's.
 */
export function releaseFromAnchor(anchor: string): number | null {
  const m = /^release-(\d+)$/.exec(anchor);
  if (m?.[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Scroll a release into view, for the one case the browser will not.
 *
 * **Only on first load.** A fragment link inside the page navigates and scrolls
 * on its own — that is why the contents list no longer cancels the click — but
 * an address typed or pasted with `#release-64` already on it lands with React
 * not yet mounted, so there is nothing at that id for the browser to find. Hence
 * one call, from the mount effect.
 *
 * It runs before the state has painted, which is fine: the box is on the page
 * whether it is open or shut, and it is the box's *top* being scrolled to.
 */
function scrollToRelease(release: number): void {
  /* `?.` on the *call* as well as the lookup, which is the house form —
     PrivacyPage.tsx and PricingPage.tsx both carry it, for the reason this
     needed it too: jsdom has no `scrollIntoView`, so without it every test that
     lands on a page with a fragment throws inside a passive effect. */
  document.getElementById(releaseAnchor(release))?.scrollIntoView?.({
    behavior: "smooth",
    block: "start",
  });
}

/**
 * The contents list — Greg's *"table of contents"*.
 *
 * **Each row says something the shut release below it does not**: the titles of
 * that release's headline changes. Otherwise a list of fifty rows would repeat
 * fifty rows verbatim, which is furniture rather than a contents list. A
 * release with no headline entry falls back to what it does have, which is the
 * same sentence its own row carries — for those two the duplication is the
 * honest answer, since there is nothing else to say about them.
 *
 * It scrolls inside itself rather than growing to fifty rows, so the newest
 * release stays on the first screen.
 *
 * **Not `PageContents.tsx`**, which is also a contents list and was the first
 * thing looked at. That one is a side-tab that scans the DOM for
 * `[data-section]`, takes each row's label from a heading, and runs a scroll-spy
 * to say which section you are in. None of the three fits: a row's useful text
 * here is its release's *headline entry titles*, which are not headings and sit
 * inside a shut `<details>`; and *which release are you in* is not a question
 * this page has, because they are all shut. Bending it to cover both would give
 * one component two jobs instead of one component each.
 */
function ContentsList({
  items,
  onJump,
}: {
  items: DisplayItem[];
  onJump: (release: number) => void;
}) {
  const releases = items.filter(
    (i): i is Extract<DisplayItem, { kind: "version" }> => i.kind === "version",
  );
  if (releases.length === 0) return null;
  return (
    <nav
      aria-label="Releases"
      className="tw:mt-6 tw:rounded-md tw:border tw:border-rule tw:bg-surface-raised/40"
    >
      <h2 className="tw:m-0 tw:border-b tw:border-rule tw:px-3 tw:py-2 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
        Contents
      </h2>
      <ol className="tw:m-0 tw:max-h-72 tw:list-none tw:overflow-y-auto tw:p-1.5">
        {releases.map(({ version, release }) => {
          const headlines = version.entries
            .filter((e) => e.section === "headline")
            .map((e) => e.title);
          return (
            <li key={version.version}>
              <a
                /* **An ordinary fragment link, and the click is not prevented.**
                   The first version called `preventDefault()` and scrolled by
                   hand, which cost four things at once: the address stayed at
                   `/changelog`, so a reload lost the release and the address bar
                   could not be copied; Back could not undo the jump; and a
                   Ctrl- or Cmd-click opened a new tab at the *top* of the page,
                   because the modified click was cancelled too. GPT Sol's
                   review, P2.

                   So the browser does the navigating — which is also the scroll —
                   and `onJump` only opens the box. A modified click never
                   reaches `onJump` and does not need to: the new tab loads
                   `/changelog#release-64`, which `ChangelogBody` reads on
                   mount. */
                href={`#${releaseAnchor(release)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  onJump(release);
                }}
                className="tw:flex tw:gap-x-3 tw:rounded tw:px-1.5 tw:py-1 tw:text-xs tw:leading-snug tw:no-underline tw:hover:bg-surface-raised"
              >
                {/* Three columns rather than one wrapping line. The two narrow
                    ones are `whitespace-nowrap` **and** fixed-width: without the
                    first, "Release 65" and "5 Sep" break across two lines at any
                    width that is not quite enough; without the second, fifty
                    rows do not line up and the eye has nothing to run down. */}
                <span className="tw:w-[5.5rem] tw:shrink-0 tw:whitespace-nowrap tw:text-foreground">
                  Release {release}
                </span>
                <span className="tw:w-11 tw:shrink-0 tw:whitespace-nowrap tw:text-ink-faint">
                  {formatShortDate(version.version)}
                </span>
                <span className="tw:min-w-0 tw:text-muted-foreground">
                  {headlines.length > 0 ? headlines.join(" · ") : describeContents(version)}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The list itself, given already-parsed versions.
 *
 * Split out of `ChangelogPage` so it can be tested without the `?raw` import —
 * see this file's header and `tests/changelog-page.test.tsx`.
 *
 * **The newest release is the only one open**, which is `openFirst` below and
 * Greg's *"all default-collapsed except the most recent one"*. "Most recent" is
 * the first release drawn, not the first item: the newest deploy is more often
 * than not a quiet one, and a page that opened nothing because of that would be
 * the letter of the instruction and none of the point of it.
 */
export function ChangelogBody({ versions }: { versions: ChangelogVersion[] }) {
  const items = groupForDisplay(versions);

  /**
   * Which releases are open, by number.
   *
   * Seeded once, from two things: the newest release, and whatever release the
   * address names. An address carrying `#release-42` is somebody's own bookmark
   * or a link they were sent, and landing on a shut box is landing on nothing.
   *
   * `window.location` read during the initial state, not in an effect: there is
   * no server render here (main.tsx reads `location` at module scope before
   * React exists), and reading it later means one paint with the wrong box open.
   */
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    const seed = new Set<number>();
    const newest = items.find((i) => i.kind === "version");
    if (newest?.kind === "version") seed.add(newest.release);
    const asked = releaseFromAnchor(window.location.hash.slice(1));
    if (asked !== null) seed.add(asked);
    return seed;
  });

  const setReleaseOpen = (release: number, isOpen: boolean) =>
    setOpen((was) => {
      if (was.has(release) === isOpen) return was;
      const next = new Set(was);
      if (isOpen) next.add(release);
      else next.delete(release);
      return next;
    });

  /* The scroll half of *arriving* at `#release-42` — see `scrollToRelease` for
     why only this one case needs it. After paint, so the box is the open one. */
  useEffect(() => {
    const asked = releaseFromAnchor(window.location.hash.slice(1));
    if (asked !== null) scrollToRelease(asked);
  }, []);

  /* **And every later change of fragment, which is not the same event.** The
     hash was read on mount alone, so Back out of a contents-list jump, or a
     second `#release-…` link followed within the page, moved the browser to a
     release React had left shut — the page scrolled and nothing opened. GPT
     Sol's review, P2. `hashchange` is the event for exactly this and does not
     fire for the initial load, so the two effects do not overlap. */
  useEffect(() => {
    const onHashChange = () => {
      const asked = releaseFromAnchor(window.location.hash.slice(1));
      if (asked !== null) setReleaseOpen(asked, true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div>
      {/* `onJump` opens the box and stops there — the click is an ordinary
          fragment navigation now, so the browser does the scrolling and the
          address bar keeps up. `ContentsList` has the four things that cost. */}
      <ContentsList items={items} onJump={(release) => setReleaseOpen(release, true)} />
      <div className="tw:mt-8">
        {items.map((item) =>
          item.kind === "version" ? (
            <VersionBlock
              key={item.version.version}
              version={item.version}
              release={item.release}
              open={open.has(item.release)}
              onOpenChange={(isOpen) => setReleaseOpen(item.release, isOpen)}
            />
          ) : (
            <p
              key={`quiet-after-${item.after}`}
              className="tw:my-3 tw:px-3 tw:text-xs tw:text-ink-faint tw:italic"
            >
              {quietLine(item.count, item.after)}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Parsed once, when this chunk loads, rather than on every render.
 *
 * `versionsText` is a build-time constant, so the parse has the same answer
 * every time and there is nothing for a hook to depend on. In the component it
 * would run twice on the first paint under StrictMode alone, over 210 KB, for
 * no reason. Never thrown to the reader either: a bad line becomes a sentence
 * in `problems`, which nothing here reads — see the file header.
 */
const PARSED = parseChangelog(versionsText);

export function ChangelogPage() {
  useDocumentTitle(pageTitle({ kind: "changelog" }));

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-dvh tw:max-w-2xl tw:flex-col tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans">
      {/* **"Home", not "Back", since 2026-09-08.** It goes to `/` rather than
          `history.back()`, and most people who open this page were *sent* to it
          — from an email, from the footer of another page, from a link in an
          article — so there was often no "back" for it to mean. It is also the
          label the footer uses for the same destination, and one page should not
          call one address two things. */}
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Home
      </Link>

      {/* The same string the footer, the command bar and the tab title use —
          router.ts § `CHANGELOG_LABEL`. A heading that had drifted from the
          link a reader followed to reach it would read as the wrong page. */}
      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
        {CHANGELOG_LABEL}
      </h1>
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        Every update to Spideryarn since it launched, newest first — each numbered release below is
        one update to the live site. Open one to see what changed. This list is written up a little
        after the fact, so the very latest change may not have made it on here yet.
      </p>
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        Spideryarn is <Link href="/opensource" className="tw:text-highlight tw:no-underline tw:hover:underline">open source</Link>, so every
        release links to the code behind it.
      </p>

      <ChangelogBody versions={PARSED.versions} />

      {/* The spacer that puts the footer on the floor of a `min-h-dvh` flex
          column. It grows to nothing on a page this long and is here so the
          four bare pages have one shape rather than two; ContactPage.tsx, where
          it does the work, says why it is a spacer and not `mt-auto` on the
          footer. */}
      <div className="tw:flex-1" />

      <SiteFooter />
    </main>
  );
}
