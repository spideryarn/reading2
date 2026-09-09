/**
 * **CAN THIS ACCOUNT AFFORD MORE WORK?** — the fleet server's reading of the
 * usage report inside the Overseer's checkpoint, and the grouping of thirty
 * rejections into the one thing that happened.
 *
 * ## The edge that did not exist, again
 *
 * `tools/overseer/usage.ts` has measured this since 2026-09-08 and stores it on
 * every daemon tick; `tools/fleet/attention.ts` says, in as many words, that it
 * *"ignores `cursor` and `usage` entirely"*. So the reading existed, was
 * correct, was written to disk every 300 seconds — and nothing rendered it.
 * That is the same Class A the attention inbox was in the day before, and the
 * repair is the same shape: a projection at the fleet's own boundary, sharing
 * the one `loadCheckpoint` read.
 *
 * **This file collects nothing.** `collectUsage` runs inside the daemon on its
 * own timer and is the single owner of the ~2.9 GB transcript scan; a dashboard
 * that scanned on its own would be a second collector of the most expensive
 * thing on the box, which the plan's *one collector* contract forbids outright.
 * Everything here is a pure function of bytes somebody else already wrote.
 *
 * ## The reading rules are NOT re-derived here
 *
 * `tools/overseer/usage.ts` holds them and its header is the argument: the
 * cache is a hint and a stale entry reads exactly like a current one; a 429 in
 * a transcript is ground truth; an expired window carries no percentage; a zero
 * needs a positive control before it means anything. This file **narrows** that
 * reading into `UsageSummary` and adds exactly one idea of its own — the
 * grouping below. Where the two could disagree, this one is wrong.
 *
 * ## Why parse it again rather than import the store's parser
 *
 * attention.ts's header is the whole answer and it applies unchanged: the file
 * is the contract, the function is one implementation of reading it, and
 * `tools/overseer/` already imports from `tools/fleet/` — so importing
 * `parseStoredUsage` would close the cycle the seam exists to prevent and drag
 * `node:child_process` into the process you reach for when something else is
 * broken. It also buys the compatibility policy this side needs: the store
 * degrades a bad report to its own *no report*, and this one degrades it to
 * `report-unreadable` — a separate arm, because *no pass has run* and *a report
 * is there and cannot be read* call for different words on a page. The two ends
 * are allowed to disagree about what "bad" means without either being a bug.
 *
 * ## Never throws
 *
 * Composed into `/api/state`, where `deps.publish()` sits outside the try/catch
 * that guards collection — a throw here ends the refresh loop and leaves the
 * page wearing its last good timestamp. Every path returns an arm.
 *
 * ## IT IS SAFE TO CALL FROM THE DAEMON TOO, AND THAT IS A PROPERTY WORTH
 * KEEPING RATHER THAN AN ACCIDENT
 *
 * `projectUsage` is **pure, takes no clock, and reads nothing live** — the same
 * three facts that make the card honest also make one projection serve two
 * callers in two processes. So the live card and a *replayed history* can be
 * the same reading rather than two interpretations of one measurement, which is
 * the whole class of bug this area keeps producing. Session `usage-limits-tab`
 * is building a usage history on top of it (2026-09-09); whichever process ends
 * up appending, it wraps a stored line as
 * `{schema, writtenAt, usage}` and gets back exactly what the card is drawn
 * from.
 *
 * **The import surface is what keeps that true, so keep it to leaves.** Today
 * this file reaches `./attention.js` (for its four shared narrowings, and
 * `node:fs` behind them), `./usage-absence.js` (no imports at all) and
 * `./wire.js` (types only). **None of them touches `tools/overseer/`**, so a
 * daemon-side caller closes no cycle. Reaching for `store.ts` or the Overseer's
 * `usage.ts` from here would: those import `collect.ts` and `status.ts` back
 * out of `tools/fleet/`, and the second caller stops being free the moment one
 * of them arrives.
 *
 * Note that the constraint is WEIGHT rather than DIRECTION, which is easy to
 * get backwards: `tools/fleet/health-history.ts` imports `jsonl.ts` and
 * `lock.ts` out of `tools/overseer/` quite happily, because both are pure
 * leaves. It is the modules that drag `node:child_process` and the daemon's
 * module graph that may not cross.
 */
import { isRecord, iso, KNOWN_SCHEMA, nonBlank } from "./attention.js";
import { absenceGapReason } from "./usage-absence.js";
import type {
  ScanCoverage,
  UsageAccount,
  UsageFeed,
  UsageIncident,
  UsageLevel,
  UsageSummary,
  UsageWindowCard,
} from "./wire.js";

/**
 * The rejection fields an incident is built out of — **a structural slice, not
 * the whole `RateLimitHit`.**
 *
 * The grouping needs four facts and the type has ten. Taking the slice means
 * the projection below parses four fields instead of ten, and
 * `scripts/overseer.ts` can hand this function its full `RateLimitHit[]`
 * unchanged, because a `RateLimitHit` IS one of these. One implementation of
 * the grouping, two callers, no adapter between them.
 */
export type IncidentInput = {
  window: string;
  resetsAtMs: number;
  hitAtMs: number | null;
  claudeSessionId: string | null;
};

/**
 * **THIRTY SESSIONS, ONE WINDOW, ONE INCIDENT.**
 *
 * The stage's acceptance line, and the reasoning is on `UsageIncident` in
 * wire.ts: a rate limit is a fact about an account and a window, so the
 * rejections that share a window and a reset instant are one event seen thirty
 * times rather than thirty events. Measured on this box on 2026-09-08: 27
 * rejections, one `resetsAt`.
 *
 * **Sorted by reset instant, latest first**, which is the same rule
 * `UsageVerdict.activeLimit` follows: when several windows are in force the one
 * that frees up LAST is the one that decides when work can resume, so it is the
 * one at the top. Ties break on the window name and then the id, so two
 * renderings of one report cannot disagree about the order.
 *
 * Pure, total, and it takes no clock: whether an incident has expired is a
 * question for the renderer, against its own skew-corrected now. A server that
 * pre-computed *expired* would ship an answer as old as the payload.
 */
export function groupUsageIncidents(hits: readonly IncidentInput[]): UsageIncident[] {
  const byWindow = new Map<
    string,
    { window: string; resetsAtMs: number; conversations: string[]; seen: Set<string>; rejections: number; unidentified: number; firstMs: number | null; lastMs: number | null }
  >();
  for (const raw of hits) {
    /* **THE KEY AND THE ID MUST COME OUT OF THE SAME NUMBER.** Grouping on the
       raw millisecond while minting the id from `toISOString()` — which clips
       to whole milliseconds — put `1000.1` and `1000.9` in two groups wearing
       ONE id, which is two rows with one React key and a page that reconciles
       them into each other. `epochMs` returns the canonical integer, so the map
       key, the id and the rendered instant are all the same instant.
       GPT Sol's P2(1), 2026-09-09. */
    const resetsAtMs = epochMs(raw.resetsAtMs);
    if (resetsAtMs === null) continue;
    const hit = { ...raw, resetsAtMs, hitAtMs: raw.hitAtMs === null ? null : epochMs(raw.hitAtMs) };
    /* **THE KEY IS A WINDOW AND ITS RESET INSTANT, AND IT IS NOT AN ACCOUNT.**
       A transcript 429 carries no account id at all, and the scan covers eight
       days of transcripts that may span a `/login` swap — that is the whole
       reason `classifyHit` exists over in usage.ts. So two accounts whose
       rejections happen to share a window name and a reset instant would land
       in one group here, and there is nothing in the data that could separate
       them. These are observed window clusters; whether any of them binds THIS
       account is the verdict's question and not this function's. An earlier
       comment here claimed the account was "implicit in the report", which is
       false: `chooseUsage` proves the REPORT was collected for the current
       account, not that the hits inside it belong to it. GPT Sol's P1(4). */
    const key = `${hit.window} ${resetsAtMs}`;
    let group = byWindow.get(key);
    if (group === undefined) {
      group = {
        window: hit.window,
        resetsAtMs: hit.resetsAtMs,
        conversations: [],
        seen: new Set(),
        rejections: 0,
        unidentified: 0,
        firstMs: null,
        lastMs: null,
      };
      byWindow.set(key, group);
    }
    group.rejections += 1;
    /* AN UNIDENTIFIED REJECTION IS COUNTED, NEVER FOLDED IN. A transcript
       record with no `sessionId` is a real thing; adding it to the conversation
       list would inflate the session count with a fiction, and dropping it
       would understate the incident. Both numbers are on the card. */
    if (hit.claudeSessionId === null) group.unidentified += 1;
    else if (!group.seen.has(hit.claudeSessionId)) {
      group.seen.add(hit.claudeSessionId);
      group.conversations.push(hit.claudeSessionId);
    }
    if (hit.hitAtMs !== null) {
      group.firstMs = group.firstMs === null ? hit.hitAtMs : Math.min(group.firstMs, hit.hitAtMs);
      group.lastMs = group.lastMs === null ? hit.hitAtMs : Math.max(group.lastMs, hit.hitAtMs);
    }
  }

  const incidents: UsageIncident[] = [];
  for (const group of byWindow.values()) {
    const resetsAt = new Date(group.resetsAtMs).toISOString();
    incidents.push({
      /* Derived, never minted per render — wire.ts § `UsageIncident.id`. It is
         a React key and a thing a person points at between two readings. */
      id: `${group.window}@${resetsAt}`,
      window: group.window,
      resetsAt,
      conversations: group.conversations,
      rejections: group.rejections,
      unidentifiedRejections: group.unidentified,
      firstHitAt: group.firstMs === null ? null : new Date(group.firstMs).toISOString(),
      lastHitAt: group.lastMs === null ? null : new Date(group.lastMs).toISOString(),
    });
  }
  incidents.sort(
    (a, b) =>
      Date.parse(b.resetsAt) - Date.parse(a.resetsAt) || a.window.localeCompare(b.window) || a.id.localeCompare(b.id),
  );
  return incidents;
}

/**
 * The usage reading out of a checkpoint that has already been read. **Never
 * throws.**
 *
 * Takes parsed JSON rather than a path, exactly like `projectAttention`, so
 * there is nothing left in it that can touch the disk and so all three
 * projections come out of one `loadCheckpoint`.
 *
 * The schema is refused positively and the whole feed fails on it, for the
 * reason `projectOverseerStatus` does: a version this build has not read is a
 * file whose FIELDS may have moved, and coercing one into the other draws
 * confident nonsense rather than a gap.
 */
export function projectUsage(json: unknown): UsageFeed {
  if (!isRecord(json)) return { kind: "checkpoint-unreadable", why: "the checkpoint is not a JSON object" };
  const schema = json["schema"];
  if (schema !== KNOWN_SCHEMA) {
    return { kind: "unsupported-schema", saw: describe(schema), known: KNOWN_SCHEMA };
  }
  const writtenAt = iso(json["writtenAt"]);
  if (writtenAt === null) {
    /* The same refusal `projectAttention` makes, and for a sharper reason here:
       a usage reading with no clock beside it is a headroom number that may be
       hours old, which is the one failure mode `tools/overseer/usage.ts` was
       written to prevent. */
    return { kind: "checkpoint-unreadable", why: "the checkpoint has no readable `writtenAt`, so its age cannot be told" };
  }

  const raw = json["usage"];
  /* **TWO ARMS, NOT ONE, AND THE PAGE SAYS DIFFERENT THINGS ABOUT THEM.**
     `no-report` is ordinary — no pass has run — and the card's sentence for it
     ends "nothing is wrong with the file". `report-unreadable` is a producer
     and a consumer that have come apart, and telling somebody nothing is wrong
     is then false and sends them away from the thing that is. They were folded
     into one arm; GPT Sol's P1(3), 2026-09-09. */
  const noReport = (why: string): UsageFeed => ({ kind: "no-report", why, at: writtenAt });
  const unreadable = (why: string): UsageFeed => ({
    kind: "report-unreadable",
    why: `the published usage report was unusable: ${why}`,
    at: writtenAt,
  });
  if (raw === undefined) {
    return noReport("this checkpoint carries no usage report: it was written before the Overseer had one.");
  }
  if (!isRecord(raw)) return unreadable("it is not an object");
  if (raw["kind"] === "none") {
    /* `StoredUsage`'s own `none`, passed through with its sentence intact. It
       is the arm production draws most — a daemon run with `--no-usage`, or one
       that has not reached its first 300-second usage tick — and flattening it
       into `checkpoint-unreadable` would send a reader to look for a broken
       file that is fine. */
    const why = nonBlank(raw["why"]);
    const at = iso(raw["at"]);
    if (why === null) return unreadable("its `none` arm gave no reason");
    return { kind: "no-report", why, at: at ?? writtenAt };
  }
  if (raw["kind"] !== "report") {
    return unreadable(`this reader does not know the arm ${describe(raw["kind"])}`);
  }

  const summary = parseSummary(raw["report"]);
  if (typeof summary === "string") return unreadable(summary);
  return { kind: "published", summary, coordinatorWrittenAt: writtenAt };
}

/**
 * The report, narrowed — or a sentence saying what stopped it.
 *
 * **A string return rather than `null`**, because the caller's job is to say
 * what went wrong and a bare null forces it to guess. The failures here are all
 * of one kind (a producer this reader cannot read) and each of them ends up on
 * screen, where "its account could not be read" and "it has no collectedAt" send
 * a person to two different places.
 *
 * **The whole report degrades together, into `report-unreadable`.** Half a
 * usage reading is worse than none: a card showing windows with no verdict, or
 * a verdict with no coverage behind it, is a page making a claim it cannot
 * support — the same argument `parseList` makes about an inbox of four out of
 * five. The store's `parseStoredUsage` degrades whole in the same way, one file
 * along; it lands on its own *no report* because the store has only that arm,
 * and the split between *nothing has run* and *this cannot be read* is this
 * side's, because this side is the one that has to say it in words.
 *
 * **"Together" reaches all the way into the hit list**, and that took a review
 * round to get right: `parseHit` refuses an unusable rejection rather than
 * letting the grouper skip it, because one rejection quietly missing from a
 * list of nine reads as a calmer box, and the `hits` arm is then wrong about
 * its own contents. GPT Sol's P1(2), round two.
 */
function parseSummary(u: unknown): UsageSummary | string {
  if (!isRecord(u)) return "the report is not an object";
  const collectedAt = iso(u["collectedAt"]);
  /* THE FIELD THAT MAKES THE REST HONEST. A usage pass takes 30-45 seconds and
     `chooseUsage` deliberately republishes an EARLIER pass's report when a
     fresh scan falls over, so without this the card would age a two-hour-old
     reading against the checkpoint's thirty-second-old clock. wire.ts §
     `UsageSummary`. */
  if (collectedAt === null) return "it has no readable `collectedAt`, so the age of the reading cannot be told";

  const account = parseAccount(u["account"]);
  if (account === null) return "its account could not be read";

  const verdict = u["verdict"];
  if (!isRecord(verdict)) return "it has no verdict";
  const level = parseLevel(verdict["level"]);
  if (level === null) return `its verdict level ${describe(verdict["level"])} is not one this reader knows`;
  const reasons = parseReasons(verdict["reasons"]);
  if (reasons === null) return "its verdict's reasons are not a list of sentences";
  const activeLimit = verdict["activeLimit"];
  /* `null` is the ordinary case — nothing is blocking. An object that will not
     parse is not, and it is the one field that says WHEN WORK CAN RESUME, so it
     fails the report rather than quietly becoming "nothing is blocking". */
  let dueBackAt: string | null = null;
  let dueBackWindow: string | null = null;
  if (activeLimit !== null && activeLimit !== undefined) {
    if (!isRecord(activeLimit)) return "its active limit is neither null nor an object";
    /* `epochMs`, NOT a bare finite check — `new Date(1e100).toISOString()`
       throws, and this is inside the function that promises not to. */
    const resetsAtMs = epochMs(activeLimit["resetsAtMs"]);
    if (resetsAtMs === null) {
      return "its active limit carries no usable reset instant, which is the one thing that limit is for";
    }
    /* BOTH HALVES OF THE INCIDENT KEY — see wire.ts § `dueBackWindow`. A limit
       that cannot name its window cannot be matched to one incident rather than
       to every incident resetting at that instant, so it fails rather than
       being matched loosely. */
    const window = nonBlank(activeLimit["window"]);
    if (window === null) return "its active limit does not say which window it belongs to";
    dueBackAt = new Date(resetsAtMs).toISOString();
    dueBackWindow = window;
  }

  /* THE ACCOUNT IS PASSED IN because the cache cannot be rendered without it —
     see `parseCache`. This is the P0 of 2026-09-09: the two uuids were both
     carried and neither compared. */
  const cache = parseCache(u["cache"], account);
  if (typeof cache === "string") return cache;

  const limits = parseLimits(u["rateLimits"]);
  if (typeof limits === "string") return limits;

  return { collectedAt, account, level, reasons, cache, limits, dueBackAt, dueBackWindow };
}

/** Whose headroom this is — the shared type, verbatim, because it is already flat and already right. */
function parseAccount(u: unknown): UsageAccount | null {
  if (!isRecord(u)) return null;
  switch (u["kind"]) {
    case "value":
      return {
        kind: "value",
        email: nonBlank(u["email"]),
        orgId: nonBlank(u["orgId"]),
        orgName: nonBlank(u["orgName"]),
        subscriptionType: nonBlank(u["subscriptionType"]),
        accountUuid: nonBlank(u["accountUuid"]),
        rateLimitTier: nonBlank(u["rateLimitTier"]),
      };
    case "logged-out":
      /* NOT A FAILURE, and the reason it has its own arm: `claude auth status`
         answered, and the answer was that nobody is logged in. A page that drew
         that as "could not tell" would hide the one thing a person can fix. */
      return { kind: "logged-out", projectsDirectory: nonBlank(u["projectsDirectory"]) };
    case "unknown": {
      const why = nonBlank(u["why"]);
      return why === null ? null : { kind: "unknown", why };
    }
    default:
      return null;
  }
}

function parseLevel(u: unknown): UsageLevel | null {
  return u === "ok" || u === "approaching" || u === "limited" || u === "unknown" ? u : null;
}

/** Sentences a person reads. A blank one is a hole on the card, so it fails the list — `nonBlank`'s rule. */
function parseReasons(u: unknown): string[] | null {
  if (!Array.isArray(u)) return null;
  const out: string[] = [];
  for (const entry of u) {
    const reason = nonBlank(entry);
    if (reason === null) return null;
    out.push(reason);
  }
  return out;
}

/**
 * The cache, **and whether it may be shown as this account's at all.**
 *
 * ## The bug this shape exists to make impossible
 *
 * A cache belongs to whichever account was logged in when `~/.claude.json` was
 * written. Greg swaps between Max subscriptions with `/login` every couple of
 * days, so after a swap the file can still hold the PREVIOUS account's numbers —
 * measured, and the whole reason `attributeCache` exists in
 * tools/overseer/usage.ts. This projection carried both uuids and compared
 * neither, so a card could name account B in its heading and draw account A's
 * *96% used* underneath it: somebody else's headroom, reported as this
 * account's. GPT Sol's P0(1), 2026-09-09.
 *
 * ## The clauses are the producer's, over the producer's own fields
 *
 * `attributeCache(account, cache, null)` — the whole-cache question, which is
 * the one being asked here — is five clauses, and every field they read is on
 * the wire in the stored report: the cache parsed, the account was read, both
 * name an account, and they name the same one. So this is the same rule over
 * the same data rather than a looser second interpretation. (The sixth clause,
 * *the cache was fetched after the rejection*, belongs to the per-rejection
 * question, which is `computeUsageVerdict`'s and is already reflected in the
 * verdict this card prints.)
 *
 * **It cannot import that function**: `tools/overseer/usage.ts` reaches
 * `node:child_process`, and importing it here would close the cycle the seam
 * exists to prevent. If `attributeCache` gains a clause, this must gain it too —
 * and if the two ever disagree, this one is wrong.
 *
 * ## The unattributable arm carries no windows
 *
 * Not "windows the card should be careful with" — none at all. The repair is
 * `UsageWindowCard`'s own, one level down: a percentage a renderer can reach is
 * a percentage that eventually gets rendered, so the consumer is not given the
 * option. The two account ids survive in `why`, as prose.
 */
function parseCache(u: unknown, account: UsageAccount): UsageSummary["cache"] | string {
  if (!isRecord(u)) return "its cache reading is not an object";
  if (u["kind"] === "unknown") {
    const why = nonBlank(u["why"]);
    return why === null ? "its cache reading is unknown and gives no reason" : { kind: "unknown", why };
  }
  if (u["kind"] !== "value") return `this reader does not know the cache arm ${describe(u["kind"])}`;
  const fetchedAtMs = epochMs(u["fetchedAtMs"]);
  if (fetchedAtMs === null) {
    return "its cache reading has no usable fetch time, and an undated cache is exactly the reading this subsystem refuses";
  }
  const fetchedAt = new Date(fetchedAtMs).toISOString();
  const cacheUuid = nonBlank(u["accountUuid"]);

  /* THE ATTRIBUTION, BEFORE ANY WINDOW IS PARSED — so there is no path on which
     a percentage exists in this function and the attribution fails afterwards. */
  const unattributed = (why: string): UsageSummary["cache"] => ({
    kind: "unattributed",
    why,
    fetchedAt,
    accountUuid: cacheUuid,
  });
  if (account.kind === "logged-out") {
    return unattributed("nobody is logged in, so there is no account to attribute this cached utilisation to");
  }
  if (account.kind !== "value") {
    return unattributed(`the logged-in account could not be established, so this cached utilisation cannot be attributed: ${account.why}`);
  }
  if (account.accountUuid === null) {
    return unattributed("the logged-in account has no accountUuid in ~/.claude.json's .oauthAccount, so there is nothing to match this cached utilisation against");
  }
  if (cacheUuid === null) {
    return unattributed("the cached utilisation carries no accountUuid, so there is nothing to match it against");
  }
  if (cacheUuid !== account.accountUuid) {
    return unattributed(
      `the cached utilisation belongs to account ${cacheUuid} and the logged-in account is ${account.accountUuid} — probably a /login swap since the cache was written, so its percentages describe somebody else's headroom`,
    );
  }

  const rawWindows = u["windows"];
  if (!Array.isArray(rawWindows)) return "its cache reading has no window list";
  const windows: UsageWindowCard[] = [];
  for (const raw of rawWindows) {
    const window = parseWindow(raw);
    /* ONE BAD WINDOW FAILS THE READING, rather than dropping a row. The card's
       whole claim is *this is what is known about the account*, and a list
       missing the one window that is at 96% is worse than no list at all. */
    if (window === null) return "one of its cached windows could not be read";
    windows.push(window);
  }
  return { kind: "attributed", fetchedAt, accountUuid: cacheUuid, windows };
}

/**
 * One window. **The `expired` arm takes no percentage from the producer even if
 * one is there** — wire.ts § `UsageWindowCard` has the argument, and this is
 * the line that enforces it.
 */
function parseWindow(u: unknown): UsageWindowCard | null {
  if (!isRecord(u)) return null;
  const window = nonBlank(u["window"]);
  if (window === null) return null;
  switch (u["kind"]) {
    case "value": {
      const utilizationPercent = u["utilizationPercent"];
      /* `instant`, NOT `iso` — this string came out of `~/.claude.json` and is
         not in `toISOString()` form. See `instant`; getting this wrong voided
         the whole cache against the real file. */
      const resetsAt = instant(u["resetsAt"]);
      /* 0–100 IS THE WIRE'S CONTRACT AND IS CHECKED, not assumed. `999%` on a
         progress-shaped reading is either a producer bug or a file somebody
         edited, and drawing it is worse than saying the window is unreadable —
         a reader who sees 999% learns nothing except to distrust the card. */
      if (typeof utilizationPercent !== "number" || !Number.isFinite(utilizationPercent)) return null;
      if (utilizationPercent < 0 || utilizationPercent > 100) return null;
      if (resetsAt === null) return null;
      return { kind: "value", window, utilizationPercent, resetsAt };
    }
    case "expired": {
      const resetsAt = instant(u["resetsAt"]);
      const why = nonBlank(u["why"]);
      if (resetsAt === null || why === null) return null;
      return { kind: "expired", window, resetsAt, why };
    }
    case "unknown": {
      const why = nonBlank(u["why"]);
      return why === null ? null : { kind: "unknown", window, why };
    }
    default:
      return null;
  }
}

/**
 * The 429s, grouped — and the coverage that makes a zero mean anything.
 *
 * **Every arm carries coverage, including `unknown`.** *No limits hit* and *we
 * opened nothing* are the same sentence without it, which is the failure
 * docs/reusable/silent-success.md names; and an `unknown` with coverage says
 * how far the probe got before it gave up, which is what tells a reader whether
 * to believe the rest of the card.
 */
function parseLimits(u: unknown): UsageSummary["limits"] | string {
  if (!isRecord(u)) return "its rate-limit scan is not an object";
  const coverage = parseCoverage(u["coverage"]);
  if (coverage === null) {
    return "its rate-limit scan carries no readable coverage, and without that a scan finding nothing cannot be told from a scan that opened nothing";
  }
  switch (u["kind"]) {
    case "none": {
      /* **A `none` WHOSE OWN NUMBERS CANNOT SUPPORT AN ABSENCE BECOMES
         `unknown`.** Every coverage field being present is not the same as the
         coverage being consistent: `{transcriptsOpened: 0, linesScanned: 0}`
         passes every check above and renders as *nothing is blocking this
         account* over *scanned 0 of 0 transcripts, 0 lines* — the
         zero-means-we-did-not-look failure, arriving through the one door the
         positive control was built to shut. `summariseRateLimitScan` will not
         emit such a `none`, so this only ever fires on a payload that is
         already wrong; it costs one call and it is the difference between a
         caveat and a reader who stops looking. GPT Sol's P1(5), 2026-09-09. */
      const gap = absenceGapReason(coverage);
      if (gap !== null) {
        return { kind: "unknown", why: `the scan reported no rejection, and its own coverage cannot support that: ${gap}`, coverage };
      }
      return { kind: "none", coverage };
    }
    case "unknown": {
      const why = nonBlank(u["why"]);
      return why === null ? "its rate-limit scan is unknown and gives no reason" : { kind: "unknown", why, coverage };
    }
    case "hits": {
      const raw = u["hits"];
      if (!Array.isArray(raw)) return "its rate-limit scan says it found hits and carries no list of them";
      const hits: IncidentInput[] = [];
      for (const entry of raw) {
        const hit = parseHit(entry);
        if (hit === null) return "one of its rate-limit hits could not be read";
        hits.push(hit);
      }
      const incidents = groupUsageIncidents(hits);
      /* A `hits` arm that groups to nothing is a producer contradicting itself
         — the arm asserts at least one rejection. Better said than drawn as a
         calm account. */
      if (incidents.length === 0) return "its rate-limit scan says it found hits and none of them could be grouped";
      return { kind: "incidents", incidents, coverage };
    }
    default:
      return `this reader does not know the rate-limit arm ${describe(u["kind"])}`;
  }
}

/** The four fields an incident is built from. The other six on a `RateLimitHit` are not carried. */
function parseHit(u: unknown): IncidentInput | null {
  if (!isRecord(u)) return null;
  const window = nonBlank(u["window"]);
  /* `epochMs`, so an out-of-range instant fails HERE — where the caller turns a
     null into a failed report — rather than being dropped later by the
     grouper's own guard. Those are different outcomes for the same bad data:
     one rejection silently missing from a list of nine reads as a calmer box,
     and the arm asserting `hits` is then wrong about its own contents.
     GPT Sol's P1(2) in round two, 2026-09-09. */
  const resetsAtMs = window === null ? null : epochMs(u["resetsAtMs"]);
  if (window === null || resetsAtMs === null) return null;
  /* ABSENT AND UNUSABLE ARE DIFFERENT. A record with no `hitAtMs` is ordinary
     and becomes `null`; one carrying a number nobody can turn into an instant
     is a malformed record and fails the report. */
  const rawHitAt = u["hitAtMs"];
  let hitAtMs: number | null = null;
  if (rawHitAt !== null && rawHitAt !== undefined) {
    hitAtMs = epochMs(rawHitAt);
    if (hitAtMs === null) return null;
  }
  return { window, resetsAtMs, hitAtMs, claudeSessionId: nonBlank(u["claudeSessionId"]) };
}

/**
 * THE POSITIVE CONTROL, crossing whole.
 *
 * Every field is required and every one is checked, because the point of the
 * type is that it cannot be partly true: a coverage with a plausible
 * `transcriptsOpened` and a missing `truncatedByLimit` reads as a complete scan
 * that was in fact cut short. `unreadableWhy` is capped by the producer at five.
 */
function parseCoverage(u: unknown): ScanCoverage | null {
  if (!isRecord(u)) return null;
  /* **NO `?? 0` ANYWHERE BELOW**, deliberately: a default on a counted field is
     how a scan that opened nothing comes out reading as a scan that found
     nothing, which is the precise inversion this type exists to prevent. Every
     field is read by name and a missing one fails the coverage — and failing
     the coverage fails the whole report, one level up. */
  const transcriptsFound = counted(u["transcriptsFound"]);
  const transcriptsSelected = counted(u["transcriptsSelected"]);
  const transcriptsOpened = counted(u["transcriptsOpened"]);
  const transcriptsUnreadable = counted(u["transcriptsUnreadable"]);
  const linesScanned = counted(u["linesScanned"]);
  const candidateLines = counted(u["candidateLines"]);
  const linesParsed = counted(u["linesParsed"]);
  const malformedCandidates = counted(u["malformedCandidates"]);
  const quotaLimitsWithoutErrorSignal = counted(u["quotaLimitsWithoutErrorSignal"]);
  const tookMs = counted(u["tookMs"]);
  if (
    transcriptsFound === null ||
    transcriptsSelected === null ||
    transcriptsOpened === null ||
    transcriptsUnreadable === null ||
    linesScanned === null ||
    candidateLines === null ||
    linesParsed === null ||
    malformedCandidates === null ||
    quotaLimitsWithoutErrorSignal === null ||
    tookMs === null
  ) {
    return null;
  }
  const truncatedByLimit = u["truncatedByLimit"];
  if (typeof truncatedByLimit !== "boolean") return null;
  const rawSince = u["sinceMs"];
  /* `null` is a real value here — it means the scan applied no mtime window at
     all — so it is accepted, and anything else that is not a finite number is
     refused rather than collapsed into it. */
  if (rawSince !== null && (typeof rawSince !== "number" || !Number.isFinite(rawSince))) return null;
  const sinceMs: number | null = rawSince === null ? null : rawSince;
  const rawWhy = u["unreadableWhy"];
  if (!Array.isArray(rawWhy)) return null;
  const unreadableWhy: string[] = [];
  for (const entry of rawWhy) {
    if (typeof entry !== "string") return null;
    unreadableWhy.push(entry);
  }
  return {
    transcriptsFound,
    transcriptsSelected,
    transcriptsOpened,
    transcriptsUnreadable,
    unreadableWhy,
    linesScanned,
    candidateLines,
    linesParsed,
    malformedCandidates,
    quotaLimitsWithoutErrorSignal,
    truncatedByLimit,
    sinceMs,
    tookMs,
  };
}

/** A counted quantity: finite, non-negative. `-1` transcripts is a bug, not a reading. */
function counted(u: unknown): number | null {
  return typeof u === "number" && Number.isFinite(u) && u >= 0 ? u : null;
}

/**
 * A timestamp that came from ANTHROPIC rather than from us, normalised.
 *
 * **`iso()` would reject every one of these, and it took reading the real file
 * to find out.** That helper checks a round trip through `toISOString()`, which
 * is right for a timestamp our own code produced and wrong for `resets_at`,
 * which `~/.claude.json` writes as `2026-09-09T02:50:00.313670+00:00` —
 * microsecond precision and a numeric offset, both perfectly valid ISO 8601 and
 * neither of them what `toISOString()` emits. Measured against the live
 * checkpoint on 2026-09-08: a strict check here failed every cached window,
 * which failed the cache, which degraded the whole report to *no usage pass has
 * run* — a page confidently reporting an absence, off a file that was fine.
 * Exactly the shape docs/reusable/silent-success.md names.
 *
 * So: parse permissively, **emit canonically**. The wire type promises ISO and
 * the browser's own parser is the strict one, so normalising here is what lets
 * both those things stay true.
 */
function instant(u: unknown): string | null {
  if (typeof u !== "string" || u.trim() === "") return null;
  const at = Date.parse(u);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * **AN EPOCH MILLISECOND THAT `new Date(…).toISOString()` WILL NOT THROW ON.**
 *
 * `Number.isFinite(1e100)` is `true` and `new Date(1e100).toISOString()` throws
 * `RangeError: Invalid time value`. Every producer parser upstream of here
 * checks finiteness and nothing checks the range, so a hand-edited or corrupt
 * checkpoint carrying `1e100` reached four `toISOString()` calls in this
 * module — and this module's whole contract is that it does not throw. In
 * `/api/state` that throw escapes `projectUsage`, and `deps.publish()` in
 * refresh.ts sits OUTSIDE the try/catch that guards collection, so it ends the
 * refresh loop and leaves the dashboard wearing its last good timestamp. In
 * `overseer status` it takes the whole status page down. **Both "never throws"
 * claims were false.** GPT Sol's P0(2), 2026-09-09.
 *
 * ±8.64e15 is the ECMAScript time-value range (±100,000,000 days from the
 * epoch), which is what `Date` itself refuses beyond. Non-integers are clipped
 * to integers here rather than rejected, because a fractional millisecond is a
 * real thing to receive and its instant is unambiguous — and because the id and
 * the map key have to be minted off the SAME canonical number.
 */
function epochMs(u: unknown): number | null {
  if (typeof u !== "number" || !Number.isFinite(u)) return null;
  const ms = Math.trunc(u);
  return Math.abs(ms) > 8.64e15 ? null : ms;
}

/**
 * A value named for a person, bounded, without throwing.
 *
 * A fourth copy of the same six lines that are in overseer-status.ts, store.ts
 * and web/src/types.ts, and it stays a copy for the reason those do: it is what
 * a reader sees when a producer sends something nobody expected, and a shared
 * one would have to be exported from a module this file is deliberately not
 * coupled to. `JSON.stringify` alone throws on a cyclic value and returns
 * `undefined` for a function — inside the one function that may not throw.
 */
function describe(u: unknown): string {
  if (u === undefined) return "absent";
  if (typeof u === "string") return JSON.stringify(u.length > 60 ? `${u.slice(0, 60)}…` : u);
  if (u === null || typeof u === "number" || typeof u === "boolean") return String(u);
  return typeof u;
}
