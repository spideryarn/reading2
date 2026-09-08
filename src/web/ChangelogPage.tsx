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
 * ## Never blank the page
 *
 * `parseChangelog` reports a bad line rather than throwing, and this renders
 * whatever parsed — the reader never sees `problems`, and neither does this
 * file's layout: a release that failed to parse simply is not there, the same
 * as a release that shipped nothing.
 */
import { ArrowLeft } from "lucide-react";

import {
  SECTIONS,
  commitUrl,
  parseChangelog,
  type ChangelogEntry,
  type ChangelogVersion,
  type Section,
} from "../changelog.js";
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
function formatVersionStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()] ?? "";
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

/** One thing that changed: its words, its links, and the commits behind it. */
function Entry({ entry }: { entry: ChangelogEntry }) {
  const linked = new Set(
    entry.links.map((l) => l.url.slice(l.url.lastIndexOf("/") + 1)).filter((s) => s.length === 40),
  );
  const rest = entry.commits.filter((sha) => !linked.has(sha));
  return (
    <div className="tw:mt-4 tw:first:mt-0">
      <h4 className="tw:m-0 tw:text-sm tw:font-medium tw:leading-snug tw:text-foreground">
        {/* h1 page → h2 release → h3 section → h4 entry. The levels were h1 →
            h3 → h4 → h4, which reads fine and navigates badly: somebody moving
            by heading gets a skipped level and then cannot tell a section from
            an entry. GPT Sol's review of this page, 2026-09-06. */}
        {entry.title}
      </h4>
      <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        {entry.body}
      </p>
      {entry.links.length > 0 && (
        <p className="tw:mt-1 tw:mb-0 tw:text-sm">
          {entry.links.map((l, i) => (
            <span key={l.url}>
              {i > 0 && " · "}
              {l.url.startsWith("/") ? (
                <Link
                  href={l.url}
                  className="tw:text-highlight tw:no-underline tw:hover:underline"
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="tw:text-highlight tw:no-underline tw:hover:underline"
                >
                  {l.label}
                </a>
              )}
            </span>
          ))}
        </p>
      )}
      {/* Small and muted, for the curious rather than the ordinary reader —
          changelog.md's own instruction for this row.

          **Minus whatever the links above already point at.** The copy stage is
          told to link the main commit inline, usually as *the change*, and to
          leave the rest to `commits` — so drawing `commits` whole puts the same
          commit on the page twice, which for a single-commit entry is the whole
          row duplicated. What is left here is the honest remainder: the other
          commits behind this entry. */}
      {rest.length > 0 && (
        <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-ink-faint">
          {rest.map((sha, i) => (
            <span key={sha}>
              {i > 0 && " "}
              <a
                href={commitUrl(sha)}
                target="_blank"
                rel="noreferrer noopener"
                className="tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
              >
                {sha.slice(0, 7)}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** One release: its heading, and its entries under up to three headings. */
function VersionBlock({ version }: { version: ChangelogVersion }) {
  return (
    <section className="tw:mt-10 tw:border-t tw:border-rule tw:pt-6 tw:first:mt-0 tw:first:border-t-0 tw:first:pt-0">
      <h2 className="tw:m-0 tw:font-prose tw:text-base tw:leading-snug tw:text-foreground">
        {formatVersionStamp(version.version)}
      </h2>
      {SECTIONS.map((section) => {
        const entries = version.entries.filter((e) => e.section === section);
        if (entries.length === 0) return null;
        return (
          <div key={section} className="tw:mt-4">
            <h3 className="tw:m-0 tw:mb-2 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
              {SECTION_LABEL[section]}
            </h3>
            {entries.map((e, i) => (
              <Entry key={e.id ?? `${version.sha}-${section}-${i}`} entry={e} />
            ))}
          </div>
        );
      })}
    </section>
  );
}

/** One entry in the display list: a real release, or a run of quiet ones. */
type DisplayItem =
  | { kind: "version"; version: ChangelogVersion }
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
    items.push({ kind: "version", version: v });
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
 * The list itself, given already-parsed versions.
 *
 * Split out of `ChangelogPage` so it can be tested without the `?raw` import —
 * see this file's header and `tests/changelog-page.test.tsx`.
 */
export function ChangelogBody({ versions }: { versions: ChangelogVersion[] }) {
  const items = groupForDisplay(versions);
  return (
    <div>
      {items.map((item) =>
        item.kind === "version" ? (
          <VersionBlock key={item.version.sha} version={item.version} />
        ) : (
          <p
            key={`quiet-after-${item.after}`}
            className="tw:my-6 tw:text-sm tw:text-ink-faint tw:italic"
          >
            {quietLine(item.count, item.after)}
          </p>
        ),
      )}
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
        Every update to Spideryarn since it launched, newest first — each dated entry below is one
        release. This list is written up a little after the fact, so the very latest change may not
        have made it on here yet.
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
