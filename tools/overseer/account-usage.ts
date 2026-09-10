/**
 * **WHICH SUBSCRIPTION STILL HAS ROOM?** — one live headroom reading per
 * account-subscription on the box, Claude and Codex alike.
 *
 * Greg, 2026-09-10, asking for the page this feeds:
 *
 * > The Usage Limits page should have sections for each Claude and Codex
 * > account-subscription, summarising 5d and weekly X% used and when they
 * > reset.
 *
 * The plan is docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md;
 * the registry and the per-account launcher underneath it are plan 260909g's.
 *
 * ## What this is NOT
 *
 * **It is not a second usage collector.** `tools/overseer/usage.ts` owns the
 * ~2.9 GB transcript scan, the `~/.claude.json` cache read and the verdict, for
 * the one account the Overseer is logged in as. Nothing here scans a transcript
 * or reads a cache. This module makes one cheap provider call per account and
 * reports what came back — Claude's `/api/oauth/usage` through
 * `accounts.ts § readUsage`, Codex's `account/rateLimits/read` through
 * `codex-usage.ts § collectCodexUsage`.
 *
 * **It produces no verdict and no rejections.** Rule 4 of the eight in
 * docs/project/usage-history.md: *rejections are never attributed to an
 * account*. A 429 in a transcript carries no account id, and the scan spans
 * days that may include a `/login` swap, so feeding the one global scan into a
 * per-account verdict would count the same rejection once against every account
 * on the box. `AccountUsageSection` has nowhere to put one, deliberately.
 *
 * ## TESTABILITY SPLIT
 *
 * `collectAccountUsage` performs no I/O of its own: the registry read, the two
 * provider calls, the ambient directory resolution and the clock are all
 * injected. `defaultAccountUsageDeps()` is the only function here that reaches
 * the real world, and the composition root (`scripts/overseer.ts`) is the only
 * caller of it.
 *
 * ## A FAILURE IS DATA, AT TWO DIFFERENT SCOPES
 *
 * One account failing is that account's `unknown`, and its neighbours are
 * unaffected — the whole point of reading them separately. A fault that belongs
 * to no account, chiefly a registry that will not parse, goes in `problems`,
 * because folding it into a section would attribute it to an account that did
 * nothing wrong, and dropping it would let a SHORT list of accounts read as a
 * complete one. `StoredAccountUsage`'s header is the argument.
 */
import { homedir } from "node:os";
import path from "node:path";

import type {
  AccountUsageOrigin,
  AccountUsageRole,
  AccountUsageSection,
  CodexUsageBucket,
  CodexUsageReading,
  StoredAccountUsage,
  UsageWindowCard,
} from "../fleet/wire.js";
import {
  readAccountRegistry,
  readUsage,
  type AccountEntry,
  type AccountUsageReading,
  type RegistryReading,
} from "./accounts.js";
import { collectCodexUsage } from "./codex-usage.js";
import type { UsageWindowReading } from "./usage.js";

/**
 * Everything this module would otherwise reach for itself.
 *
 * `ambientClaudeDir` and `ambientCodexHome` are injected rather than read from
 * `process.env` inside the collector because the dedup rule below turns on
 * them, and a test that cannot move them cannot exercise the case that rule
 * exists for.
 */
export type AccountUsageDeps = {
  registry: () => Promise<RegistryReading>;
  /** One Claude account's live `/profile` + `/usage` pair, on one credential snapshot. */
  claudeUsage: (configDir: string) => Promise<AccountUsageReading>;
  /** One REGISTERED Codex account's app-server reading, at that account's `CODEX_HOME`. */
  codexUsage: (target: { stateDir: string; expectedAccountId: string }) => Promise<CodexUsageReading>;
  /** Where an unrouted `claude` would look. */
  ambientClaudeDir: () => string;
  /** Where an unrouted `codex` would look. */
  ambientCodexHome: () => string;
  now: () => Date;
};

/**
 * The ambient Codex reading, **handed in rather than taken**.
 *
 * The daemon's existing usage pass already spawns one `collectCodexUsage()` per
 * tick and stashes it for the history recorder
 * (`scripts/overseer.ts § usageHistoryDaemonOptions`). Collecting it a second
 * time here would be two app-server spawns per five minutes AND — the part that
 * matters — two independently-taken numbers for one subscription on one page,
 * a point apart, each undermining the other. GPT Sol's P0, 2026-09-10.
 *
 * So the composition root fans **one** observation to both consumers, and this
 * module is handed the value. `null` means the pass did not produce one, which
 * is a different sentence from a reading that failed.
 */
export type AmbientCodexObservation = CodexUsageReading | null;

export function defaultAccountUsageDeps(): AccountUsageDeps {
  return {
    registry: readAccountRegistry,
    // `readUsage` never selects, sends or spends the refresh token — it does
    // read the credentials file that contains it, which is unavoidable, and
    // owns the 401 policy: it may re-read a token another Claude process
    // already rotated. The same seam scripts/overseer.ts gives `overseer usage`.
    claudeUsage: (configDir) => readUsage(configDir, { fetch }),
    codexUsage: ({ stateDir, expectedAccountId }) =>
      collectCodexUsage({ env: { ...process.env, CODEX_HOME: stateDir }, expectedAccountId }),
    ambientClaudeDir: () => process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
    ambientCodexHome: () => process.env.CODEX_HOME ?? path.join(homedir(), ".codex"),
    now: () => new Date(),
  };
}

/**
 * Narrow a producer-side window reading to the card shape.
 *
 * **The expired arm loses its percentage here and keeps its `why`**, which is
 * the same narrowing `usage-feed.ts` performs for the singular card and for the
 * same reason: a renderer handed a numeric field will eventually render it, so
 * the void number survives only as prose. `UsageWindowCard`'s header in
 * tools/fleet/wire.ts is the full argument.
 */
function windowCard(reading: UsageWindowReading): UsageWindowCard {
  if (reading.kind === "value") {
    return {
      kind: "value",
      window: reading.window,
      utilizationPercent: reading.utilizationPercent,
      resetsAt: reading.resetsAt,
    };
  }
  if (reading.kind === "expired") {
    return { kind: "expired", window: reading.window, resetsAt: reading.resetsAt, why: reading.why };
  }
  return { kind: "unknown", window: reading.window, why: reading.why };
}

/**
 * Does a live Claude reading belong to the account the registry says it should?
 *
 * **CLAUDE ONLY, and that is deliberate rather than incidental.** A registered
 * Codex account is pinned a different way — `expectedAccountId` inside
 * `collectCodexUsage`, checked against what the app-server itself answered —
 * and it has no organisation equivalent at all. An earlier draft of this made
 * `providerTenantId` nullable so one comparison could serve both families;
 * GPT Sol's P0-3 on 2026-09-10 is why it does not. Weakening Claude's
 * organisation pin, which is a real and required fact, to accommodate a family
 * that never uses this function would have traded a live check for nothing.
 *
 * `displayEmail` is checked only when the registry recorded one, because it is
 * optional in the registry and an absent pin cannot be violated.
 */
function pinMismatch(entry: AccountEntry, reading: Extract<AccountUsageReading, { kind: "value" }>): string | null {
  if (reading.identity.providerAccountId !== entry.providerAccountId) {
    return "live identity does not match the registry pin: the provider answered for a different account id";
  }
  if (reading.identity.providerTenantId !== entry.providerTenantId) {
    return "live identity does not match the registry pin: the provider answered for a different organisation";
  }
  if (entry.displayEmail !== undefined && reading.identity.displayEmail !== entry.displayEmail) {
    return "live identity does not match the registry pin: the provider answered for a different email address";
  }
  return null;
}

type Identity = { name: string; role: AccountUsageRole; origin: AccountUsageOrigin; email: string | null };

async function claudeSection(
  entry: Identity & { stateDir: string; pin: AccountEntry | null },
  deps: AccountUsageDeps,
): Promise<AccountUsageSection> {
  const base = { name: entry.name, role: entry.role, origin: entry.origin, family: "claude" } as const;
  let reading: AccountUsageReading;
  try {
    reading = await deps.claudeUsage(entry.stateDir);
  } catch (cause) {
    // A rejected collector is this account's unknown and nobody else's. The
    // message is the thrown one because `readUsage` never puts a credential in
    // an error it RETURNS; anything thrown past it is a programming fault,
    // which is exactly what a reader needs to see.
    return {
      ...base,
      displayEmail: entry.email,
      providerAccountId: entry.pin?.providerAccountId ?? null,
      takenAt: deps.now().toISOString(),
      reading: {
        kind: "unknown",
        why: `the usage reader rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
      },
    };
  }

  if (reading.kind === "unknown") {
    return {
      ...base,
      displayEmail: entry.email,
      providerAccountId: entry.pin?.providerAccountId ?? null,
      takenAt: reading.takenAt,
      reading: { kind: "unknown", why: reading.why },
    };
  }

  const mismatch = entry.pin === null ? null : pinMismatch(entry.pin, reading);
  if (mismatch !== null) {
    // The windows are discarded rather than shown under a warning. They are a
    // real reading of SOMETHING; what nothing establishes is whose. Drawing
    // them under this heading is the `/login`-swap failure `attributeCache`
    // exists to prevent, one file along.
    return {
      ...base,
      displayEmail: entry.email,
      providerAccountId: null,
      takenAt: reading.takenAt,
      reading: { kind: "unknown", why: mismatch },
    };
  }

  return {
    ...base,
    displayEmail: reading.identity.displayEmail ?? entry.email,
    providerAccountId: reading.identity.providerAccountId,
    takenAt: reading.takenAt,
    reading: { kind: "windows", windows: reading.windows.map(windowCard) },
  };
}

/**
 * Turn one Codex reading into a section.
 *
 * **A reading whose `accountId` is null carries no numbers**, whether it was
 * pinned or not, and this is the rule GPT Sol's P1 asked for on 2026-09-10.
 * `enforceExpectedAccount` already refuses a null when an id was *supplied* —
 * so a registered account is covered there — but the ambient read supplies
 * none, and the app-server is entitled to answer without saying whose account
 * it answered for. A percentage under a heading saying *ambient Codex* that
 * nothing ties to any subscription is precisely the claim this page may not
 * make, so it becomes `unknown` with the reason in words.
 */
function codexSectionFrom(entry: Identity & { expectedAccountId: string | null }, reading: CodexUsageReading, now: () => Date): AccountUsageSection {
  const base = { name: entry.name, role: entry.role, origin: entry.origin, family: "codex" } as const;
  if (reading.kind === "unknown") {
    return {
      ...base,
      displayEmail: entry.email,
      providerAccountId: entry.expectedAccountId,
      // `collectCodexUsage`'s unknown arm carries no instant of its own, so the
      // observation time is this clock's. It is still the moment the attempt
      // was made, which is what an age is drawn from.
      takenAt: now().toISOString(),
      reading: { kind: "unknown", why: reading.why },
    };
  }
  if (reading.accountId === null) {
    return {
      ...base,
      displayEmail: entry.email,
      providerAccountId: null,
      takenAt: reading.readAt,
      reading: {
        kind: "unknown",
        why:
          "the Codex app-server answered without saying which account the numbers belong to, so they cannot " +
          "be shown under this heading",
      },
    };
  }
  return {
    ...base,
    displayEmail: entry.email,
    providerAccountId: reading.accountId,
    takenAt: reading.readAt,
    reading: { kind: "buckets", buckets: reading.buckets, resetCredits: reading.resetCredits },
  };
}

async function codexSection(
  entry: Identity & { stateDir: string; expectedAccountId: string },
  deps: AccountUsageDeps,
): Promise<AccountUsageSection> {
  try {
    const reading = await deps.codexUsage({ stateDir: entry.stateDir, expectedAccountId: entry.expectedAccountId });
    return codexSectionFrom(entry, reading, deps.now);
  } catch (cause) {
    return {
      name: entry.name,
      role: entry.role,
      origin: entry.origin,
      family: "codex",
      displayEmail: entry.email,
      providerAccountId: entry.expectedAccountId,
      takenAt: deps.now().toISOString(),
      reading: {
        kind: "unknown",
        why: `the Codex usage reader rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
      },
    };
  }
}

/* ------------------------------------------------------------------ *
 * READING IT BACK
 *
 * **The producer owns the body parser, the store owns the wrapper.** Same split
 * `parseUsageReport` and `parseStoredUsage` already use, and for the same
 * reason: a consumer-written parser for this shape is a second hand-written
 * declaration of a type that lives here, and it fails in the quiet direction —
 * a field silently absent reads as a section that merely says less.
 *
 * **Strict, and null on the FIRST mismatch.** A half-parsed section is worse
 * than none, because it is indistinguishable from a complete one that found
 * less: a `windows` arm that lost its windows array renders as an account with
 * no limits rather than as an account nobody could read.
 * ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function instant(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)) ? value : null;
}

function parseWindowCard(value: unknown): UsageWindowCard | null {
  const raw = record(value);
  if (raw === null) return null;
  const window = text(raw.window);
  if (window === null) return null;
  if (raw.kind === "value") {
    const resetsAt = instant(raw.resetsAt);
    return typeof raw.utilizationPercent === "number" && Number.isFinite(raw.utilizationPercent) && resetsAt !== null
      ? { kind: "value", window, utilizationPercent: raw.utilizationPercent, resetsAt }
      : null;
  }
  if (raw.kind === "expired") {
    const resetsAt = instant(raw.resetsAt);
    const why = text(raw.why);
    return resetsAt !== null && why !== null ? { kind: "expired", window, resetsAt, why } : null;
  }
  if (raw.kind === "unknown") {
    const why = text(raw.why);
    return why === null ? null : { kind: "unknown", window, why };
  }
  return null;
}

const ROLES: readonly AccountUsageRole[] = ["orchestrator", "pool"];
const ORIGINS: readonly AccountUsageOrigin[] = ["ambient", "registered"];

/** The fields every section has, whatever family it is. */
function parseCommon(raw: Record<string, unknown>): Omit<AccountUsageSection, "family" | "reading"> | null {
  const name = text(raw.name);
  const takenAt = instant(raw.takenAt);
  const role = ROLES.find((candidate) => candidate === raw.role);
  const origin = ORIGINS.find((candidate) => candidate === raw.origin);
  if (name === null || takenAt === null || role === undefined || origin === undefined) return null;
  const displayEmail = raw.displayEmail === null ? null : text(raw.displayEmail);
  if (raw.displayEmail !== null && displayEmail === null) return null;
  const providerAccountId = raw.providerAccountId === null ? null : text(raw.providerAccountId);
  if (raw.providerAccountId !== null && providerAccountId === null) return null;
  return { name, role, origin, displayEmail, providerAccountId, takenAt };
}

function parseClaudeReading(
  reading: Record<string, unknown>,
): Extract<AccountUsageSection, { family: "claude" }>["reading"] | null {
  if (reading.kind === "unknown") {
    const why = text(reading.why);
    return why === null ? null : { kind: "unknown", why };
  }
  if (reading.kind !== "windows" || !Array.isArray(reading.windows)) return null;
  const windows: UsageWindowCard[] = [];
  for (const entry of reading.windows) {
    const parsed = parseWindowCard(entry);
    if (parsed === null) return null;
    windows.push(parsed);
  }
  return { kind: "windows", windows };
}

function parseCodexReading(
  reading: Record<string, unknown>,
): Extract<AccountUsageSection, { family: "codex" }>["reading"] | null {
  if (reading.kind === "unknown") {
    const why = text(reading.why);
    return why === null ? null : { kind: "unknown", why };
  }
  // The buckets are handed back as the Codex collector produced them. This
  // parser checks the envelope rather than re-deriving a bucket's shape: the
  // alternative is a fourth hand-written declaration of `CodexUsageBucket`,
  // which is the thing this split exists to avoid. A bucket that has lost its
  // interior renders as an empty bucket, which says nothing rather than
  // something false.
  if (reading.kind !== "buckets" || !Array.isArray(reading.buckets)) return null;
  const credits = reading.resetCredits;
  if (credits !== null && credits !== undefined && (typeof credits !== "number" || !Number.isFinite(credits))) {
    return null;
  }
  return {
    kind: "buckets",
    buckets: reading.buckets as CodexUsageBucket[],
    resetCredits: typeof credits === "number" ? credits : null,
  };
}

function parseSection(value: unknown): AccountUsageSection | null {
  const raw = record(value);
  if (raw === null) return null;
  const common = parseCommon(raw);
  const reading = record(raw.reading);
  if (common === null || reading === null) return null;

  if (raw.family === "claude") {
    const claude = parseClaudeReading(reading);
    return claude === null ? null : { ...common, family: "claude", reading: claude };
  }

  if (raw.family === "codex") {
    const codex = parseCodexReading(reading);
    return codex === null ? null : { ...common, family: "codex", reading: codex };
  }

  return null;
}

/** Every section, or `null` on the first one this build cannot read. */
export function parseAccountUsageSections(value: unknown): AccountUsageSection[] | null {
  if (!Array.isArray(value)) return null;
  const sections: AccountUsageSection[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const section = parseSection(entry);
    if (section === null) return null;
    // A duplicate `family/name` would draw one subscription twice with two
    // readings — the same failure the ambient dedup exists to prevent, arriving
    // through the file instead of through the collector.
    const key = `${section.family}/${section.name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    sections.push(section);
  }
  return sections;
}

/** Family first (Claude, then Codex), ambient before registered, then by name. */
function ordered(sections: AccountUsageSection[]): AccountUsageSection[] {
  return [...sections].sort((left, right) => {
    if (left.family !== right.family) return left.family === "claude" ? -1 : 1;
    if (left.origin !== right.origin) return left.origin === "ambient" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/**
 * **TWO SECTIONS FOR ONE SUBSCRIPTION IS WORSE THAN EITHER ALONE**, and the
 * directory comparison below cannot catch every way of producing them.
 *
 * `path.resolve` catches two spellings of one path. It does **not** catch two
 * distinct state directories holding the same login, a symlinked alias, or an
 * ambient login copied into a registered home — and because the ambient account
 * is absent from the registry, the registry's own uniqueness rules cannot catch
 * them either. GPT Sol's P1, 2026-09-10.
 *
 * So identity has the last word, after the reads: two sections in one family
 * whose provider account ids are the same *are* one subscription, however they
 * were reached. The registered one is kept — it is the one whose reading was
 * checked against a pin — and the collision is reported as a configuration
 * problem, loudly, because it means the box thinks it has more headroom than it
 * has.
 *
 * **Sections with no established identity are never collapsed.** A null id is
 * *nobody proved whose this is*, and merging two of those would be inventing
 * the very fact that is missing.
 */
function collapseDuplicateSubscriptions(
  sections: AccountUsageSection[],
  problems: string[],
): AccountUsageSection[] {
  const byIdentity = new Map<string, AccountUsageSection>();
  const kept: AccountUsageSection[] = [];
  for (const section of sections) {
    if (section.providerAccountId === null) {
      kept.push(section);
      continue;
    }
    const key = `${section.family}/${section.providerAccountId}`;
    const existing = byIdentity.get(key);
    if (existing === undefined) {
      byIdentity.set(key, section);
      kept.push(section);
      continue;
    }
    const [winner, loser] = existing.origin === "registered" ? [existing, section] : [section, existing];
    problems.push(
      `${loser.name} and ${winner.name} are the same ${winner.family} subscription reached two ways, so only ` +
        `${winner.name} is listed. This box has fewer account-subscriptions than its configuration suggests.`,
    );
    byIdentity.set(key, winner);
    kept.splice(kept.indexOf(existing), 1, winner);
  }
  return kept;
}

/**
 * One pass: read every account-subscription this box knows about.
 *
 * **The ambient login is emitted only when no registry entry already covers
 * it**, and that dedup is a real trap rather than hygiene. The Overseer daemon
 * may itself be running routed — `CLAUDE_CONFIG_DIR` pointed at a registered
 * account. "The ambient account" is then that same account, and without this
 * check the page draws it twice, once labelled `ambient` and once labelled
 * `pool`, with two independently-taken readings that will disagree by a few
 * percent. Two rows disagreeing about one subscription is worse than either row
 * alone, because it makes both untrustworthy.
 *
 * Compared on `path.resolve` rather than on the raw strings: the registry
 * enforces absolute, trailing-slash-free `stateDir`s, but `CLAUDE_CONFIG_DIR`
 * is whatever a launcher put there.
 */
export async function collectAccountUsage(
  deps: AccountUsageDeps,
  /**
   * The ambient Codex reading the daemon's usage pass already took, or `null`
   * when it took none. Never collected here — see `AmbientCodexObservation`.
   */
  ambientCodex: AmbientCodexObservation = null,
): Promise<StoredAccountUsage> {
  const startedAt = deps.now().toISOString();
  const registry = await deps.registry();
  const problems: string[] = [];
  if (registry.kind === "error") {
    // Registered accounts are lost for this pass, and the ambient ones below
    // still read fine — so this cannot be a total failure, and it must not be
    // silent either. See `StoredAccountUsage`'s header on short lists.
    problems.push(
      `the account registry could not be read, so no registered account is listed here — only the logins this box falls back to. ${registry.why}`,
    );
  }
  const entries = registry.kind === "value" ? registry.accounts : [];

  const claudeDirs = new Set(
    entries.filter((entry) => entry.family === "claude").map((entry) => path.resolve(entry.stateDir)),
  );
  const codexDirs = new Set(
    entries.filter((entry) => entry.family === "codex").map((entry) => path.resolve(entry.stateDir)),
  );
  const ambientClaude = path.resolve(deps.ambientClaudeDir());
  const ambientCodexHome = path.resolve(deps.ambientCodexHome());

  const work: Promise<AccountUsageSection>[] = [];

  for (const entry of entries) {
    const identity = {
      name: entry.name,
      role: entry.role,
      origin: "registered" as const,
      email: entry.displayEmail ?? null,
    };
    work.push(
      entry.family === "claude"
        ? claudeSection({ ...identity, stateDir: entry.stateDir, pin: entry }, deps)
        : codexSection({ ...identity, stateDir: entry.stateDir, expectedAccountId: entry.providerAccountId }, deps),
    );
  }

  if (!claudeDirs.has(ambientClaude)) {
    work.push(
      claudeSection(
        { name: "ambient", role: "orchestrator", origin: "ambient", email: null, stateDir: ambientClaude, pin: null },
        deps,
      ),
    );
  }

  const sections = await Promise.all(work);

  /* The ambient Codex observation is handed in rather than taken, so it joins
     here rather than in the `Promise.all` above. Same dedup rule as its Claude
     twin: if a registry entry already points at the ambient CODEX_HOME, that
     entry's own pinned read is the one to show, and this would be a second
     unpinned number for the same subscription. */
  if (ambientCodex !== null && !codexDirs.has(ambientCodexHome)) {
    sections.push(
      codexSectionFrom(
        { name: "ambient", role: "orchestrator", origin: "ambient", email: null, expectedAccountId: null },
        ambientCodex,
        deps.now,
      ),
    );
  }
  // A GUARD, NOT AN EXPECTED PATH — and worth keeping despite that. Every
  // target above produces a section whether its read succeeded or not, and the
  // two ambient logins are only skipped when a registry entry already covers
  // them, so this list cannot be empty as the function stands today. It is here
  // because the day somebody adds a filter — "skip accounts whose token has
  // expired", say — the empty case becomes reachable, and the failure it would
  // produce is a page silently claiming the box has no subscriptions. Cheap
  // insurance against the expensive kind of regression. `tests/overseer-account-usage.test.ts`
  // pins the property that makes it unreachable rather than pretending to
  // exercise this branch.
  if (sections.length === 0) {
    return {
      kind: "none",
      why:
        problems.length === 0
          ? "no account-subscription was read: this box has no registry entries and no ambient login to fall back on"
          : problems.join(" · "),
      at: startedAt,
    };
  }
  const distinct = collapseDuplicateSubscriptions(sections, problems);
  return { kind: "reading", collectedAt: startedAt, accounts: ordered(distinct), problems };
}
