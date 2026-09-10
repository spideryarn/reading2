/**
 * **WHICH SUBSCRIPTION STILL HAS ROOM?** — the fleet server's reading of the
 * per-account block inside the Overseer's checkpoint.
 *
 * `tools/fleet/usage-feed.ts` is the sibling of this file and its header is the
 * argument for both. Everything there applies unchanged:
 *
 *  - **This file collects nothing.** `tools/overseer/account-usage.ts` runs
 *    inside the daemon on its own timer and is the single owner of these
 *    readings. A dashboard that read `/api/oauth/usage` per poll would be a
 *    second collector of a fact the box already measures, and a second
 *    interpretation of one measurement is the class of bug this area keeps
 *    producing.
 *  - **Never throws.** Composed into `/api/state`, where a throw ends the
 *    refresh loop and leaves the page wearing its last good timestamp. Every
 *    path returns an arm.
 *  - **Pure.** No clock, no I/O, so a stored reading replayed later goes
 *    through this exact function and comes out the same.
 *  - **The import surface stays leaves** — `./attention.js` for the four shared
 *    narrowings and `./wire.js` for types. Nothing from `tools/overseer/`,
 *    which would close the cycle that seam exists to prevent.
 *
 * ## Why this parses the sections again rather than importing the producer's parser
 *
 * `tools/overseer/account-usage.ts` has a `parseAccountUsageSections`, and this
 * file deliberately does not use it — the same decision `usage-feed.ts` made
 * about `parseStoredUsage`, for the same two reasons. The file is the contract
 * and each end reads it; and importing across would drag the daemon's module
 * graph into the process you reach for when something else is broken.
 *
 * It also buys the compatibility policy this side needs. The store degrades a
 * bad block to its own *no reading*; this one degrades it to
 * `reading-unreadable` — a separate arm, because *no pass has run* and *a
 * reading is there and cannot be read* call for different words on a page and
 * send a person to different places. The two ends are allowed to disagree about
 * what "bad" means without either being a bug.
 *
 * ## What it will not do
 *
 * **It will not drop a section it cannot read.** A list quietly one shorter
 * than it should be is a page claiming the box has fewer subscriptions than it
 * has, which is worse than a page that says it could not read the block — so a
 * single unreadable section fails the whole feed, exactly as one unusable
 * rejection fails the singular card's hit list.
 *
 * **It will not invent a percentage.** Nothing here reads a number out of an
 * `unknown` arm or defaults one, and there is no field on that arm to default.
 * Rule 1 of the eight in docs/project/usage-history.md.
 */
import { isRecord, iso, KNOWN_SCHEMA, nonBlank } from "./attention.js";
import type {
  AccountUsageFeed,
  AccountUsageOrigin,
  AccountUsageRole,
  AccountUsageSection,
  CodexUsageBucket,
  UsageWindowCard,
} from "./wire.js";

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const ROLES: readonly AccountUsageRole[] = ["orchestrator", "pool"];
const ORIGINS: readonly AccountUsageOrigin[] = ["ambient", "registered"];

/** One window, or a sentence saying what stopped it. A string return, for `parseSummary`'s reason. */
function parseWindow(u: unknown): UsageWindowCard | string {
  if (!isRecord(u)) return "a window is not an object";
  const window = nonBlank(u["window"]);
  if (window === null) return "a window has no name";
  const kind = u["kind"];
  if (kind === "value") {
    const resetsAt = iso(u["resetsAt"]);
    const percent = u["utilizationPercent"];
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      return `window ${window} has no readable utilisation`;
    }
    if (resetsAt === null) return `window ${window} has no readable reset instant`;
    return { kind: "value", window, utilizationPercent: percent, resetsAt };
  }
  if (kind === "expired") {
    const resetsAt = iso(u["resetsAt"]);
    const why = nonBlank(u["why"]);
    if (resetsAt === null) return `expired window ${window} has no readable reset instant`;
    if (why === null) return `expired window ${window} does not say why`;
    /* NO PERCENTAGE IS CARRIED ACROSS, and there is nowhere to put one. The
       stale number lives inside `why` as prose. `UsageWindowCard`'s header. */
    return { kind: "expired", window, resetsAt, why };
  }
  if (kind === "unknown") {
    const why = nonBlank(u["why"]);
    return why === null ? `unknown window ${window} does not say why` : { kind: "unknown", window, why };
  }
  return `window ${window} has an arm this reader does not know: ${describeValue(kind)}`;
}

function parseSection(u: unknown): AccountUsageSection | string {
  if (!isRecord(u)) return "a section is not an object";
  const name = nonBlank(u["name"]);
  if (name === null) return "a section has no account name";
  const takenAt = iso(u["takenAt"]);
  /* THE FIELD THAT MAKES THE SECTION HONEST, and it is per section rather than
     per pass on purpose: these are independent calls, and one account can
     answer while its neighbour fails for another quarter of an hour. Without it
     the page would age every section by the pass, putting a fresh badge on a
     stale reading. */
  if (takenAt === null) return `section ${name} has no readable takenAt, so its age cannot be told`;
  const role = ROLES.find((candidate) => candidate === u["role"]);
  if (role === undefined) return `section ${name} has a role this reader does not know: ${describeValue(u["role"])}`;
  const origin = ORIGINS.find((candidate) => candidate === u["origin"]);
  if (origin === undefined) {
    return `section ${name} does not say whether it is a registered or an ambient account: ${describeValue(u["origin"])}`;
  }
  const displayEmail = u["displayEmail"] === null ? null : nonBlank(u["displayEmail"]);
  const providerAccountId = u["providerAccountId"] === null ? null : nonBlank(u["providerAccountId"]);
  if (u["displayEmail"] !== null && displayEmail === null) return `section ${name} has an unreadable display email`;
  if (u["providerAccountId"] !== null && providerAccountId === null) return `section ${name} has an unreadable provider account id`;
  const common = { name, role, origin, displayEmail, providerAccountId, takenAt };

  const reading = u["reading"];
  if (!isRecord(reading)) return `section ${name} has no readable reading`;
  const family = u["family"];

  if (family === "claude") {
    if (reading["kind"] === "unknown") {
      const why = nonBlank(reading["why"]);
      return why === null
        ? `section ${name} could not be read and does not say why`
        : { ...common, family: "claude", reading: { kind: "unknown", why } };
    }
    if (reading["kind"] !== "windows") {
      return `section ${name} has a reading arm this reader does not know: ${describeValue(reading["kind"])}`;
    }
    const raw = reading["windows"];
    if (!Array.isArray(raw)) return `section ${name} carries no window list`;
    const windows: UsageWindowCard[] = [];
    const seenWindows = new Set<string>();
    for (const entry of raw) {
      const window = parseWindow(entry);
      /* ONE BAD WINDOW FAILS THE SECTION rather than being skipped. A five-hour
         row silently missing from a two-row section reads as an account with no
         five-hour limit, which is a claim, and the section would then be wrong
         about its own contents. Same argument `parseHit` makes one file along. */
      if (typeof window === "string") return `section ${name}: ${window}`;
      /* And one window name, one reading: two `five_hour` entries would render
         as two conflicting numbers under one heading. GPT Sol's re-review. */
      if (seenWindows.has(window.window)) return `section ${name} lists window ${window.window} twice`;
      seenWindows.add(window.window);
      windows.push(window);
    }
    return providerAccountId === null
      ? `section ${name} carries numbers without naming the provider account they belong to`
      : { ...common, providerAccountId, family: "claude", reading: { kind: "windows", windows } };
  }

  if (family === "codex") {
    if (reading["kind"] === "unknown") {
      const why = nonBlank(reading["why"]);
      return why === null
        ? `section ${name} could not be read and does not say why`
        : { ...common, family: "codex", reading: { kind: "unknown", why } };
    }
    if (reading["kind"] !== "buckets") {
      return `section ${name} has a reading arm this reader does not know: ${describeValue(reading["kind"])}`;
    }
    const raw = reading["buckets"];
    if (!Array.isArray(raw)) return `section ${name} carries no bucket list`;
    const rawCredits = reading["resetCredits"];
    /* A count, or nothing: `-1` and `1.5` are finite and not counts. The same
       rule the history route's parser applies. GPT Sol's re-review. */
    const resetCredits =
      rawCredits === null || rawCredits === undefined
        ? null
        : typeof rawCredits === "number" && Number.isSafeInteger(rawCredits) && rawCredits >= 0
          ? rawCredits
          : undefined;
    if (resetCredits === undefined) return `section ${name} has an unreadable reset-credit count`;
    /* One `limitId`, one bucket — two would draw as conflicting readings. */
    const limitIds = new Set<string>();
    for (const bucket of raw) {
      const limitId = isRecord(bucket) ? nonBlank(bucket["limitId"]) : null;
      if (limitId === null) return `section ${name} carries a bucket with no limit id`;
      if (limitIds.has(limitId)) return `section ${name} lists bucket ${limitId} twice`;
      limitIds.add(limitId);
    }
    /* The bucket interiors are carried as the collector produced them and are
       re-checked by the browser's own Codex view parser, which already exists
       for the history route. Re-deriving `CodexUsageBucket` here would be a
       fourth hand-written declaration of one type. */
    return providerAccountId === null
      ? `section ${name} carries numbers without naming the provider account they belong to`
      : {
          ...common,
          providerAccountId,
          family: "codex",
          reading: { kind: "buckets", buckets: raw as CodexUsageBucket[], resetCredits },
        };
  }

  return `section ${name} has a family this reader does not know: ${describeValue(family)}`;
}

/**
 * The per-account readings out of a checkpoint that has already been read.
 * **Never throws.**
 *
 * Takes parsed JSON rather than a path, exactly like `projectUsage`, so both
 * come out of the one `loadCheckpoint` and the page can say *the Overseer wrote
 * thirty seconds ago and this account was read two hours ago* — two clocks in
 * one line, which cannot be assembled honestly out of two reads.
 */
export function projectAccountUsage(json: unknown): AccountUsageFeed {
  if (!isRecord(json)) return { kind: "checkpoint-unreadable", why: "the checkpoint is not a JSON object" };
  const schema = json["schema"];
  if (schema !== KNOWN_SCHEMA) {
    return { kind: "unsupported-schema", saw: describeValue(schema), known: KNOWN_SCHEMA };
  }
  const writtenAt = iso(json["writtenAt"]);
  if (writtenAt === null) {
    return {
      kind: "checkpoint-unreadable",
      why: "the checkpoint has no readable `writtenAt`, so its age cannot be told",
    };
  }

  const raw = json["accountUsage"];
  const noReading = (why: string): AccountUsageFeed => ({ kind: "no-reading", why, at: writtenAt });
  const unreadable = (why: string): AccountUsageFeed => ({
    kind: "reading-unreadable",
    why: `the published per-account usage reading was unusable: ${why}`,
    at: writtenAt,
  });

  if (raw === undefined) {
    return noReading(
      "this checkpoint carries no per-account usage reading: it was written before the Overseer had one.",
    );
  }
  if (!isRecord(raw)) return unreadable("it is not an object");
  if (raw["kind"] === "none") {
    const why = nonBlank(raw["why"]);
    const at = iso(raw["at"]);
    return why === null ? unreadable("its `none` arm gave no reason") : { kind: "no-reading", why, at: at ?? writtenAt };
  }
  if (raw["kind"] !== "reading") {
    return unreadable(`this reader does not know the arm ${describeValue(raw["kind"])}`);
  }
  const collectedAt = iso(raw["collectedAt"]);
  if (collectedAt === null) return unreadable("it has no readable instant saying when the pass ran");
  const rawAccounts = raw["accounts"];
  if (!Array.isArray(rawAccounts)) return unreadable("it carries no list of accounts");

  const accounts: AccountUsageSection[] = [];
  const seenNames = new Set<string>();
  const seenProviders = new Set<string>();
  for (const entry of rawAccounts) {
    const section = parseSection(entry);
    if (typeof section === "string") return unreadable(section);
    /* Two rows for one subscription, taken a moment apart and disagreeing by a
       percent or two, make both untrustworthy. The collector already refuses
       this; so does the file's reader, because a hand-edited checkpoint is a
       thing that happens. */
    const nameKey = `${section.family}/${section.name}`;
    if (seenNames.has(nameKey)) return unreadable(`it lists ${nameKey} twice`);
    seenNames.add(nameKey);
    if (section.providerAccountId !== null) {
      const providerKey = `${section.family}/${section.providerAccountId}`;
      if (seenProviders.has(providerKey)) return unreadable(`it lists provider account ${providerKey} twice`);
      seenProviders.add(providerKey);
    }
    accounts.push(section);
  }
  /* An empty list is not a reading. It renders as "this box has no
     account-subscriptions", which is a claim; the truth behind an empty list is
     always that something did not look. `StoredAccountUsage`'s header. */
  if (accounts.length === 0) return unreadable("it carries a reading with no accounts in it");

  const rawProblems = raw["problems"];
  if (!Array.isArray(rawProblems)) return unreadable("it carries no problem list");
  const problems: string[] = [];
  for (const problem of rawProblems) {
    const parsed = nonBlank(problem);
    if (parsed === null) return unreadable("its problem list contains an unreadable entry");
    problems.push(parsed);
  }

  return { kind: "published", collectedAt, accounts, problems, coordinatorWrittenAt: writtenAt };
}
