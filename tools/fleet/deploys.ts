/**
 * **Reading the deploy record — `src/web/changelog-versions.ndjson` — for the
 * Deploys tab.** Pure: text in, versions out, no clock and no filesystem.
 *
 * ## What this file is a record OF
 *
 * One production deploy on Vercel is one version, named by its timestamp, and
 * the list of them is not in git: `main` is fast-forwarded a sha at a time by
 * `scripts/deploy.ts`, so history alone cannot say which shas were deploy
 * points. Vercel's deployment list is the source of truth and **this box cannot
 * reach it** — no `VERCEL_TOKEN`, and the CLI is logged out. So the committed
 * NDJSON is the whole record available here, and it is only as fresh as the last
 * time somebody ran the changelog job. docs/project/changelog.md.
 *
 * ## Why this is a SECOND reader of a format that already has one
 *
 * `src/changelog.ts` is a complete, dependency-free parser for exactly this
 * file, and reusing it is the first instinct and the house rule. It is not
 * imported here, deliberately: `tests/fleet-imports.test.ts` pins the set of
 * `src/` modules this tool may reach, and the rule behind that pin
 * (docs/project/overseer-direction.md § Principles) is that the fleet dashboard
 * must be movable to its own repo. `src/changelog.ts` is leaf and browser-safe
 * but hardcodes the product's repository URL, its launch version and its three
 * section names. **The fleet's relationship to this file is the one it has to
 * tmux and to `~/.claude/projects`: an artefact at a path**, and the coupling
 * belongs on the path rather than on the type.
 *
 * The cost is two readers that can drift, and the mitigation is a check that can
 * go red rather than a comment: `tests/fleet-deploys.test.ts` reads the **real
 * committed file** and asserts one version per non-blank line with nothing
 * unreadable. Two independent readings that are able to disagree is the only
 * kind of agreement worth having — docs/reusable/silent-success.md, and
 * docs/plans/260909b.
 *
 * ## Tolerant, and loud about it
 *
 * A line that will not parse is **counted and placed**, never swallowed. The
 * fleet's standing discipline (routes-health-history.ts) is that *we looked and
 * there is nothing* and *we could not look* must never render the same way; the
 * per-line version of that is a list that is quietly two entries short. So
 * `unreadable` carries a sentence per bad line and the panel shows the count.
 *
 * What this does NOT re-check: the chain (`previous_sha` matching the line
 * above), the two-headline cap, the link scheme. `src/changelog.ts` and
 * `tests/changelog-file.test.ts` own those, and a second opinion here would be a
 * second place to be wrong about the product's rules.
 *
 * **Its only import is `wire.ts`, which itself imports nothing** — so this stays
 * a leaf the browser project can reach. The shapes live there rather than here
 * because both ends read them, which is the twin-type problem wire.ts's header
 * is about. `tests/fleet-imports.test.ts` walks every edge and would say so.
 */

import type {
  DeployEntry,
  DeploySection,
  DeployVersion,
} from "./wire.js";

/**
 * The three headings, as a runtime value.
 *
 * The TYPE lives in `wire.ts`, which both ends import and which may hold no
 * runtime values at all. This array is the one thing that cannot live there,
 * and it is derived from the type rather than beside it — `satisfies` makes a
 * heading added to one and forgotten in the other a compile error rather than a
 * section that silently never renders.
 */
export const DEPLOY_SECTIONS = ["headline", "enhancement", "fix"] as const satisfies readonly DeploySection[];

export type { DeployEntry, DeploySection, DeployVersion };

/**
 * What a read found.
 *
 * `versions` is **newest first**, which is the opposite of the file. The file is
 * append-only and therefore oldest first; a list of deploys is read from the top
 * down, most recent first, so the reversal happens once, here, rather than in
 * every caller.
 */
export type DeployRead = {
  versions: DeployVersion[];
  /** One sentence per line that would not parse. Never merely counted. */
  unreadable: string[];
  /** Non-blank lines seen, parsed or not. The denominator for any claim about the file. */
  lines: number;
  /**
   * **Whether the LAST non-blank line of the file parsed.**
   *
   * Its own field because a corrupt last line is a different situation from a
   * corrupt middle one, and only this one poisons the header. The file is
   * append-only, so its last line is the newest deploy; if it fails,
   * `newestDeploy()` returns the one before it, and everything downstream then
   * calls that "the newest recorded deploy" and measures a distance from it —
   * confidently, and about the wrong deploy. GPT Sol's P1 finding 4, 2026-09-09,
   * and the tests only covered a corrupt OLDEST line, which costs nothing.
   *
   * False on an empty file too: there is no newest line, so nothing may claim to
   * be it.
   */
  newestLineRead: boolean;
};

const SHA = /^[0-9a-f]{40}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A string field, or null. Never `undefined`, never `"undefined"`. */
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function readEntry(raw: unknown): DeployEntry | null {
  if (!isRecord(raw)) return null;
  const section = raw.section;
  if (typeof section !== "string" || !(DEPLOY_SECTIONS as readonly string[]).includes(section)) {
    return null;
  }
  const title = str(raw.title);
  const body = str(raw.body);
  if (title === null || body === null) return null;
  /* Shas are filtered rather than trusted: the panel draws them as links into
     the repository, and a short or mistyped one is a 404 in the one place
     somebody is most likely to click. The copy stage has produced one before —
     changelog.md § Copy. */
  const commits = Array.isArray(raw.commits)
    ? raw.commits.filter((c): c is string => typeof c === "string" && SHA.test(c))
    : [];
  return { section: section as DeploySection, title, body, where: str(raw.where), commits };
}

/**
 * **What changed on this deploy — and whether that could be read at all.**
 *
 * THE HOLE GPT SOL FOUND, AND IT IS THE ONE THAT MATTERS ON THIS PANEL.
 * `invisible` used to be derived as `entries.length === 0`, so a line whose
 * `entries` was missing, not an array, or full of unreadable objects came out as
 * a *quiet deploy* — and the panel says "Nothing a reader would notice", which
 * is the exact opposite of "we could not read what changed". A deploy that
 * shipped a headline feature would render as one that shipped nothing, with no
 * error anywhere. P1 finding 3, 2026-09-09.
 *
 * So three outcomes, not two:
 *
 *  - `entries: []` on a line that claims to be quiet → genuinely quiet;
 *  - some readable, some not → what was read, plus a count of what was not;
 *  - `entries` absent, not an array, or wholly unreadable on a line that claims
 *    to be loud → **changelog unreadable, never quiet**.
 *
 * Its own function rather than a block inside `readVersion`, which was over the
 * complexity limit with it inline — and this is the half worth reading on its
 * own anyway.
 */
function readChangelog(raw: Record<string, unknown>): {
  entries: DeployEntry[];
  readable: boolean;
  unreadable: number;
} {
  const entries: DeployEntry[] = [];
  let unreadable = 0;

  if (!Array.isArray(raw.entries)) {
    /* No `entries` key at all, or not an array. Says nothing about whether the
       deploy was quiet — so this must not answer that question. */
    return { entries, readable: false, unreadable };
  }

  for (const e of raw.entries) {
    const entry = readEntry(e);
    if (entry !== null) entries.push(entry);
    else unreadable += 1;
  }
  if (entries.length > 0) return { entries, readable: true, unreadable };

  /* Nothing readable came out. That is only "quiet" if the line agrees it is
     quiet AND nothing was dropped getting here; a line marked loud with an
     empty array has lost its entries somewhere upstream. */
  return { entries, readable: unreadable === 0 && raw.invisible === true, unreadable };
}

/**
 * One line.
 *
 * Returns the version, or a sentence saying what was wrong with it. The three
 * fields that can be missing without the line being useless — `commit_count`,
 * `generated_at`, `invisible` — are coerced with a stated default rather than
 * rejecting the whole deploy, because a version that has forgotten how many
 * commits it shipped still has a time, a sha and its entries, and those are most
 * of what this tab draws.
 */
function readVersion(raw: unknown, release: number, where: string): DeployVersion | string {
  if (!isRecord(raw)) return `${where}: not an object`;

  const version = str(raw.version);
  if (version === null || !STAMP.test(version)) {
    return `${where}: version ${JSON.stringify(raw.version)} is not a UTC stamp`;
  }
  /* The shape and the date are two questions, and `2026-99-99T99:99:99Z` passes
     the first. It would reach the panel as `Invalid Date`, or as a `null` out of
     `zonedLine` — which the panel can say something true about, but only if this
     has not already claimed the line was fine. */
  if (Number.isNaN(Date.parse(version))) {
    return `${where}: version ${JSON.stringify(version)} is not a real date`;
  }
  const sha = str(raw.sha);
  if (sha === null || !SHA.test(sha)) {
    return `${where}: sha ${JSON.stringify(raw.sha)} is not a 40-character sha`;
  }
  const deploymentId = str(raw.deployment_id);
  if (deploymentId === null) return `${where}: no deployment_id`;

  const generatedAt = str(raw.generated_at);
  const previous = raw.previous_sha;
  if (previous !== null && !(typeof previous === "string" && SHA.test(previous))) {
    return `${where}: previous_sha is neither null nor a sha`;
  }

  const changelog = readChangelog(raw);

  const count = raw.commit_count;
  const commitCount =
    typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;

  return {
    version,
    release,
    deploymentId,
    sha,
    previousSha: typeof previous === "string" ? previous : null,
    commitCount,
    /* **Quiet is a claim, and it is only made when it can be made.** Not
       `entries.length === 0`: that reads an unreadable changelog as a deploy
       with nothing in it. `changelogReadable` is false in exactly the cases
       where this file cannot tell, and the panel draws that differently. */
    invisible: changelog.readable && changelog.entries.length === 0,
    changelogReadable: changelog.readable,
    unreadableEntries: changelog.unreadable,
    entries: changelog.entries,
    generatedAt: generatedAt !== null && STAMP.test(generatedAt) ? generatedAt : null,
  };
}

/**
 * Read the whole file. Newest first.
 *
 * **`release` counts non-blank LINES, not successes.** A line that fails takes
 * its own number down with it and nothing else moves — otherwise one unreadable
 * line in the middle silently renumbers every release above it, and the number
 * is the join between this tab, `/changelog` and the logo's build stamp.
 * `src/changelog.ts` § `ChangelogVersion.release` makes the same call for the
 * same reason.
 */
export function readDeploys(text: string): DeployRead {
  const versions: DeployVersion[] = [];
  const unreadable: string[] = [];
  let release = 0;
  /* Set on every non-blank line and therefore describing the LAST one when the
     loop ends. The file is append-only, so that line is the newest deploy —
     see `DeployRead.newestLineRead`. */
  let newestLineRead = false;

  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    release += 1;
    const where = `line ${i + 1}`;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      unreadable.push(`${where}: does not parse (${(err as Error).message.slice(0, 60)})`);
      newestLineRead = false;
      continue;
    }
    const read = readVersion(raw, release, where);
    if (typeof read === "string") {
      unreadable.push(read);
      newestLineRead = false;
    } else {
      versions.push(read);
      newestLineRead = true;
    }
  }

  versions.reverse();
  return { versions, unreadable, lines: release, newestLineRead };
}

/**
 * The newest version, or null for an empty record.
 *
 * The watermark: the sha the git probe asks its two questions about. Taken from
 * the head of the reversed list rather than re-scanning, so there is one
 * definition of "newest" and the panel and the probe cannot pick different ones.
 */
export function newestDeploy(read: DeployRead): DeployVersion | null {
  return read.versions[0] ?? null;
}

/**
 * When the record was last written — the newest `generated_at` on any line.
 *
 * **The newest, not the last line's.** They are usually the same and need not
 * be: the pipeline appends in version order, and a run that fills in an older
 * gap would leave the freshest stamp somewhere other than the end. This is the
 * number the tab uses to say how stale the record is, and reading it off the
 * wrong line would understate the freshness of a file that had just been
 * updated. Empty when no line carries a usable stamp.
 */
export function lastGeneratedAt(read: DeployRead): string | null {
  let newest: string | null = null;
  for (const v of read.versions) {
    if (v.generatedAt === null) continue;
    if (newest === null || v.generatedAt > newest) newest = v.generatedAt;
  }
  return newest;
}
