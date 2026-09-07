/**
 * **The shape of `src/web/changelog-versions.ndjson`, and how to read it.**
 *
 * The file is the product of the process in
 * [changelog.md](../docs/project/changelog.md). This module is its schema and
 * its reader, in one place and flat under `src/`, because three callers need it
 * and they sit on opposite sides of the app:
 *
 *  - [`ChangelogPage.tsx`](web/ChangelogPage.tsx) renders what parsed and
 *    ignores the rest. A single bad line must not blank the page.
 *  - `scripts/changelog/changelog.ts` re-reads the file it is about to append
 *    to, and refuses to append if what it found is not what it expects.
 *  - `tests/changelog-file.test.ts` asserts `problems` is empty, which is what
 *    stops the page's tolerance from becoming a place errors go to be quiet
 *    ([silent-success.md](../docs/reusable/silent-success.md)).
 *
 * Hence `parseChangelog` reporting problems rather than throwing: the same bad
 * line is three different situations. And hence one file rather than a
 * `src/changelog/` pair — the client may only reach modules sitting directly
 * under `src/` and named in `tests/client-imports.test.ts` § `SHARED`, which is
 * the same call `asset-delivery.ts` made for the same reason.
 *
 * **It imports nothing**, `node:` built-ins included, because the browser
 * bundle pulls it in.
 *
 * The checks here are the ones that can be made from the file alone. Whether a
 * sha is one this version actually shipped is a question about the *run*, and
 * lives in the writer, which still has the run's inputs to hand.
 */

/** The three headings a version's entries appear under, in this order. */
export const SECTIONS = ["headline", "enhancement", "fix"] as const;

export type Section = (typeof SECTIONS)[number];

/**
 * How many entries a version may put under *Headline changes*.
 *
 * A cap rather than a convention, because the copy stage is a model and a model
 * asked for the important ones will happily call six things important. The
 * launch version is the one exemption — see `LAUNCH_VERSION`.
 */
export const MAX_HEADLINES = 2;

/**
 * The first version, whose 388 commits had nothing to be a change *from*.
 *
 * It is a launch note rather than a change list, so the two-headline cap is
 * lifted for it alone. changelog.md § The first run is retrospective.
 */
export const LAUNCH_VERSION = "2026-08-26T23:04:25Z";

/** The repository the commit links point into. Public since 2026-09-06. */
export const REPO_URL = "https://github.com/spideryarn/reading2";

/**
 * The rulings that may appear in `provenance.verdicts`.
 *
 * The review's own vocabulary is `confirmed` / `corrected` / `rejected`
 * (changelog.md § Review) and a rejected item is dropped rather than written, so
 * what reaches a line is these four. Checked rather than assumed, because the
 * verdicts are how "only a third of entries rest purely on claims the trawl got
 * right first time" is counted, and a typo would quietly become a fifth category
 * nobody counts.
 */
export const VERDICTS = ["confirmed", "corrected", "sol-found", "unreviewed"] as const;

/** A link an entry offers the reader: into the app, or at a commit. */
export interface ChangelogLink {
  label: string;
  url: string;
}

/**
 * Why an entry is believed, kept beside the entry rather than in a log.
 *
 * `sources` are indexes into the copy stage's own input, so an entry with
 * nothing behind it is detectable rather than merely wrong. `verdicts` are the
 * review stage's rulings on those sources — `confirmed`, `corrected`,
 * `sol-found` — which is how "only a third of entries rest purely on claims the
 * trawl got right first time" is a countable fact rather than an impression.
 */
export interface ChangelogProvenance {
  sources: number[];
  verdicts: string[];
}

/** One thing that changed, in the reader's words. */
export interface ChangelogEntry {
  id: string | null;
  section: Section;
  title: string;
  body: string;
  where: string | null;
  links: ChangelogLink[];
  /** Full 40-character shas. The page renders them as links into `REPO_URL`. */
  commits: string[];
  provenance: ChangelogProvenance;
}

/**
 * One production deploy.
 *
 * `invisible` means the deploy shipped nothing a reader would notice, which is
 * the common case — it still gets a line, because the watermark is the last
 * line's `sha` and a gap in the file would be read as work never done.
 */
export interface ChangelogVersion {
  /** The deploy's `created` time, UTC, and the version's id. */
  version: string;
  deployment_id: string;
  sha: string;
  previous_sha: string | null;
  commit_count: number;
  invisible: boolean;
  generated_at: string;
  generated_by: { trawl: string; review: string; copy: string };
  entries: ChangelogEntry[];
}

/** `https://github.com/spideryarn/reading2/commit/<sha>` */
export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

const SHA = /^[0-9a-f]{40}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** What a parse found: the lines that were good, and a sentence per line that was not. */
export interface ParseResult {
  versions: ChangelogVersion[];
  problems: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * **The page renders these as anchors, so a link off this repo is the one defect
 * here that could hurt somebody** — a changelog is a plausible place to click.
 *
 * A link either stays in the app (a path, and whether that path is a real route
 * is a question only the router can answer — `tests/changelog-file.test.ts`
 * asks it) or points at a commit in `REPO_URL`, which is the only outside
 * address this process has any reason to emit. Anything else is dropped as well
 * as reported: the tolerance elsewhere returns a usable record, and a URL we
 * cannot account for is not usable.
 *
 * `//` is excluded from "a path" deliberately — `//evil.example` is protocol
 * relative and leaves the site.
 */
function badLinkUrl(url: string): boolean {
  if (url.startsWith("/")) return url.startsWith("//");
  const prefix = `${REPO_URL}/commit/`;
  return !(url.startsWith(prefix) && SHA.test(url.slice(prefix.length)));
}

function readLinks(raw: unknown, where: string, problems: string[]): ChangelogLink[] {
  if (!Array.isArray(raw)) {
    problems.push(`${where}: links is not an array`);
    return [];
  }
  const links: ChangelogLink[] = [];
  for (const l of raw) {
    if (!isRecord(l) || typeof l.label !== "string" || typeof l.url !== "string") {
      problems.push(`${where}: a link is not {label, url}`);
      continue;
    }
    if (l.label.trim() === "") {
      problems.push(`${where}: a link to ${JSON.stringify(l.url)} has an empty label`);
      continue;
    }
    if (badLinkUrl(l.url)) {
      problems.push(
        `${where}: link ${JSON.stringify(l.url)} is neither an app path nor a commit in ${REPO_URL}`,
      );
      continue;
    }
    links.push({ label: l.label, url: l.url });
  }
  return links;
}

function readEntry(raw: unknown, where: string, problems: string[]): ChangelogEntry | null {
  if (!isRecord(raw)) {
    problems.push(`${where}: entry is not an object`);
    return null;
  }
  const section = raw.section;
  if (typeof section !== "string" || !(SECTIONS as readonly string[]).includes(section)) {
    problems.push(`${where}: section ${JSON.stringify(section)} is not one of ${SECTIONS.join("/")}`);
    return null;
  }
  if (typeof raw.title !== "string" || raw.title.trim() === "") {
    problems.push(`${where}: empty title`);
    return null;
  }
  if (typeof raw.body !== "string" || raw.body.trim() === "") {
    problems.push(`${where}: entry ${JSON.stringify(raw.title)} has an empty body`);
    return null;
  }

  const commits: string[] = [];
  if (!Array.isArray(raw.commits)) {
    problems.push(`${where}: commits is not an array`);
  } else {
    for (const sha of raw.commits) {
      /* A short or mistyped sha is a 404 in the one place a reader is most
         likely to click, and the copy stage has produced one — changelog.md
         § Copy. Dropped rather than rendered. */
      if (typeof sha !== "string" || !SHA.test(sha)) {
        problems.push(`${where}: ${JSON.stringify(sha)} is not a 40-character sha`);
        continue;
      }
      commits.push(sha);
    }
  }

  const prov = isRecord(raw.provenance) ? raw.provenance : {};
  const sources = Array.isArray(prov.sources)
    ? prov.sources.filter((s): s is number => Number.isInteger(s))
    : [];
  if (sources.length === 0) {
    /* An entry with no sources drew on nothing, which is how a copy model's
       invention would look. Reported, not dropped: the page still shows it,
       and the test is what fails. */
    problems.push(`${where}: entry ${JSON.stringify(raw.title)} cites no sources`);
  }
  const verdicts = Array.isArray(prov.verdicts)
    ? prov.verdicts.filter((v): v is string => typeof v === "string")
    : [];
  for (const v of verdicts) {
    if (!(VERDICTS as readonly string[]).includes(v)) {
      problems.push(`${where}: verdict ${JSON.stringify(v)} is not one of ${VERDICTS.join("/")}`);
    }
  }

  return {
    id: typeof raw.id === "string" ? raw.id : null,
    section: section as Section,
    title: raw.title,
    body: raw.body,
    where: typeof raw.where === "string" ? raw.where : null,
    links: readLinks(raw.links ?? [], where, problems),
    commits,
    provenance: { sources, verdicts },
  };
}

function readVersion(raw: unknown, where: string, problems: string[]): ChangelogVersion | null {
  if (!isRecord(raw)) {
    problems.push(`${where}: not an object`);
    return null;
  }
  const { version, deployment_id, sha, previous_sha } = raw;
  if (typeof version !== "string" || !STAMP.test(version)) {
    problems.push(`${where}: version ${JSON.stringify(version)} is not a UTC stamp`);
    return null;
  }
  /* The shape and the date are two questions. `2026-99-99T99:99:99Z` passes the
     first, sorts and compares like any other string — so the chain check below
     is happy with it — and reaches the page as `Invalid Date`. */
  if (Number.isNaN(Date.parse(version))) {
    problems.push(`${where}: version ${JSON.stringify(version)} is not a real date`);
  }
  if (typeof sha !== "string" || !SHA.test(sha)) {
    problems.push(`${where}: sha ${JSON.stringify(sha)} is not a 40-character sha`);
    return null;
  }
  if (typeof deployment_id !== "string" || deployment_id === "") {
    problems.push(`${where}: no deployment_id`);
    return null;
  }
  if (previous_sha !== null && (typeof previous_sha !== "string" || !SHA.test(previous_sha))) {
    problems.push(`${where}: previous_sha is neither null nor a sha`);
    return null;
  }

  const entries: ChangelogEntry[] = [];
  if (!Array.isArray(raw.entries)) {
    problems.push(`${where}: entries is not an array`);
  } else {
    for (const [i, e] of raw.entries.entries()) {
      const entry = readEntry(e, `${version} entry ${i}`, problems);
      if (entry) entries.push(entry);
    }
  }

  const rank = (s: Section) => SECTIONS.indexOf(s);
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const here = entries[i];
    if (prev && here && rank(prev.section) > rank(here.section)) {
      problems.push(`${version}: entries are not in ${SECTIONS.join(" > ")} order`);
      break;
    }
  }
  const headlines = entries.filter((e) => e.section === "headline").length;
  if (headlines > MAX_HEADLINES && version !== LAUNCH_VERSION) {
    problems.push(`${version}: ${headlines} headlines (at most ${MAX_HEADLINES})`);
  }

  const invisible = raw.invisible === true;
  if (invisible !== (entries.length === 0)) {
    /* The two ways this goes wrong are opposite and both bad: a version marked
       quiet that has entries hides them, and a version marked loud with none
       draws an empty heading. */
    problems.push(
      `${version}: invisible is ${invisible} with ${entries.length} entries`,
    );
  }

  /* **The provenance fields are the ones nothing else would miss.** `entries`
     is read by the page and `sha` by the writer, so a fault in either surfaces;
     a version that has forgotten how many commits it shipped, or which models
     wrote it, renders perfectly and quietly stops being evidence. Reported and
     then coerced, because the rest of the line is still worth showing. */
  const count = raw.commit_count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    problems.push(
      `${where}: commit_count ${JSON.stringify(count)} is not a non-negative whole number`,
    );
  }
  if (typeof raw.generated_at !== "string" || !STAMP.test(raw.generated_at)) {
    problems.push(`${where}: generated_at ${JSON.stringify(raw.generated_at)} is not a UTC stamp`);
  }
  const by = isRecord(raw.generated_by) ? raw.generated_by : {};
  for (const stage of ["trawl", "review", "copy"] as const) {
    const who = by[stage];
    if (typeof who !== "string" || who.trim() === "") {
      problems.push(`${where}: generated_by.${stage} does not name a model`);
    }
  }
  return {
    version,
    deployment_id,
    sha,
    previous_sha: previous_sha as string | null,
    commit_count: typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0,
    invisible: entries.length === 0,
    generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
    generated_by: {
      trawl: typeof by.trawl === "string" ? by.trawl : "",
      review: typeof by.review === "string" ? by.review : "",
      copy: typeof by.copy === "string" ? by.copy : "",
    },
    entries,
  };
}

/**
 * Parse the whole file. Oldest first, as it is on disk.
 *
 * Blank lines are skipped rather than reported — a trailing newline is not a
 * fault.
 */
export function parseChangelog(text: string): ParseResult {
  const problems: string[] = [];
  const versions: ChangelogVersion[] = [];

  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      problems.push(`line ${i + 1}: does not parse (${(err as Error).message.slice(0, 60)})`);
      continue;
    }
    const v = readVersion(raw, `line ${i + 1}`, problems);
    if (v) versions.push(v);
  }

  problems.push(...chainProblems(versions));
  return { versions, problems };
}

/**
 * **The file is a chain, and this is what says so.**
 *
 * Each line's `previous_sha` is the line before's `sha`, and the stamps only go
 * forwards. A version appended out of order, or one whose range was computed
 * against the wrong predecessor, is otherwise a perfectly well-formed line that
 * quietly attributes somebody's work to the wrong deploy — which is the failure
 * that has no symptom anywhere else.
 */
export function chainProblems(versions: ChangelogVersion[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const deployments = new Map<string, string>();
  for (const [i, v] of versions.entries()) {
    const prev = i === 0 ? undefined : versions[i - 1];
    const first = seen.get(v.sha);
    /* **A repeated sha is a redeploy, and those happen** — 2026-08-27 shipped
       `903b33e6` twice, half an hour apart, and the second is a version with
       nothing in it rather than a mistake. Two conditions, and the second was
       missing until 2026-09-06: the repeat must claim no work, *and* it must be
       of the line immediately above. `A → B → A` is a rollback, which puts a
       different product in front of readers and cannot be waved through as a
       no-op the way `A → A` can. */
    if (first && (v.commit_count > 0 || v.entries.length > 0)) {
      problems.push(`${v.version}: sha already used by ${first}, and claims ${v.commit_count} commits`);
    } else if (first && prev?.sha !== v.sha) {
      problems.push(
        `${v.version}: sha already used by ${first} and the line above is a different sha — ` +
          "a rollback, not a redeploy",
      );
    }
    if (!first) seen.set(v.sha, v.version);

    /* The deployment id is what `plan` matches the watermark on, so two lines
       sharing one would make the watermark ambiguous rather than wrong. */
    const sameId = deployments.get(v.deployment_id);
    if (sameId) problems.push(`${v.version}: deployment_id already used by ${sameId}`);
    else deployments.set(v.deployment_id, v.version);

    if (!prev) {
      if (v.previous_sha !== null) {
        problems.push(`${v.version}: the first line has a previous_sha`);
      }
      continue;
    }
    if (v.version <= prev.version) {
      problems.push(`${v.version}: not later than the line above (${prev.version})`);
    }
    if (v.previous_sha !== prev.sha) {
      problems.push(
        `${v.version}: previous_sha is not the line above's sha (${prev.sha.slice(0, 8)})`,
      );
    }
  }
  return problems;
}
