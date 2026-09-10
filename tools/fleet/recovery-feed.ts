/**
 * `~/.overseer/recovery.json`, read and parsed at the fleet boundary, and
 * projected to the first page the dashboard draws.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 6. The daemon is the file's single writer; this module only reads it.
 *
 * ## A validator of its own, and why it does not import the store
 *
 * `tools/overseer/store.ts` has a strict parser for this file already. Fleet
 * does not use it, under the roadmap's ownership contract: the daemon owns
 * interpretation, the dashboard reads the daemon's files and parses them itself
 * (the same rule `attention.ts` and `overseer-status.ts` follow for
 * `current.json`). The practical reason is the one that contract was written
 * for: importing the store would put its lock, its fold and its replay one
 * refactor away from a request path whose whole point is to stay up when the
 * Overseer is broken.
 *
 * ## Five arms, and no path from any of them to an empty list
 *
 * `absent` (the ordinary state before the daemon has anything to record),
 * `unreadable` (with why), `unsupported-schema` (what it saw, what it knows),
 * `oversized` (refused before reading), and `published`. Only `published`
 * carries records, and a published file with none is the one real empty list.
 *
 * **The records fail whole.** One malformed record makes the file `unreadable`,
 * naming the record, rather than dropping it and drawing the rest: a half-read
 * index is a record Greg never sees, which is the exact failure the recovery
 * inventory exists to prevent. The store restores this file under the same rule.
 *
 * **The view does not fail the records.** The view is derived (the daemon's
 * classification and evidence, recovery-view.ts), and the records are the
 * facts. A malformed view is drawn as its own state, `unreadable`, over records
 * shown unchecked — never folded into the records' verdict, and never hidden.
 *
 * ## Asynchronous, on purpose
 *
 * The route calls this on a request, in the one Node process that serves the
 * whole dashboard. `routes-decisions.ts` reads its file synchronously and
 * defends that with an input ceiling; this reads through `fs/promises`, so a
 * slow disk stalls one request rather than the server. The ceiling is here as
 * well, and is checked on the descriptor that is then read, so the bytes
 * measured are the bytes loaded (the rule `loadCheckpoint` in attention.ts
 * states).
 */
import { open } from "node:fs/promises";
import { join } from "node:path";

import { isRecord, storeRoot } from "./attention.js";
import type {
  RecoveryFeed,
  RecoveryWireClass,
  RecoveryWireDir,
  RecoveryWireDisappearance,
  RecoveryWireEntry,
  RecoveryWireEvidence,
  RecoveryWireLastSeen,
  RecoveryWireLiveRow,
  RecoveryWireNotFoundReason,
  RecoveryWireRecord,
  RecoveryWireRecordState,
  RecoveryWireReplay,
  RecoveryWireResolution,
  RecoveryWireResume,
  RecoveryWireTranscript,
  RecoveryWireView,
  RecoveryWireWorktree,
} from "./wire.js";

export const RECOVERY_FILE = "recovery.json";

/** The one `recovery.json` schema this reader understands (store.ts § `RECOVERY_SCHEMA`). */
export const KNOWN_RECOVERY_SCHEMA = 1;

/** The first page, as the daemon's own view pass bounds it (recovery-view.ts § `RECOVERY_PAGE_SIZE`). */
export const RECOVERY_FIRST_PAGE = 100;

/**
 * The largest file this request path will read.
 *
 * The index holds at most 500 unresolved records, each at most 16 KB before it
 * becomes a stub (recovery.ts § the caps), so 8 MB is the worst case for the
 * unresolved half; resolved records are kept 30 days on top of that. A real
 * index after a reboot is ~40 records at ~1.5 KB. 16 MiB is twice the
 * unresolved worst case and four orders of magnitude over the ordinary one.
 */
export const MAX_RECOVERY_INPUT_BYTES = 16 * 1024 * 1024;

/** What the file system can tell us, and nothing about the shape. */
export type RecoveryFileLoad =
  | { kind: "json"; path: string; json: unknown }
  | { kind: "absent"; path: string }
  | { kind: "unreadable"; why: string }
  | { kind: "oversized"; path: string; sizeBytes: number; limitBytes: number };

function errnoCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * The bytes, once, as JSON — or the reason there are none. **Never rejects.**
 *
 * `root` is for tests and the drill. Production resolves it as `storeRoot`
 * does, from `OVERSEER_STORE_DIR` or `~/.overseer`, **at call time**, and a
 * relative override is `unreadable` with the reason rather than a throw.
 */
export async function loadRecoveryFile(root?: string): Promise<RecoveryFileLoad> {
  let path: string;
  try {
    path = join(root ?? storeRoot(), RECOVERY_FILE);
  } catch (cause) {
    return { kind: "unreadable", why: `the Overseer's store could not be located: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch (cause) {
    /* ONLY `ENOENT` ESTABLISHES ABSENCE — attention.ts § loadCheckpoint has the
       argument. A permissions error is "we failed to look", not "there is
       nothing here". */
    const code = errnoCode(cause);
    if (code === "ENOENT") return { kind: "absent", path };
    return { kind: "unreadable", why: `${path} could not be opened: ${code ?? String(cause)}` };
  }
  let text: string;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { kind: "unreadable", why: `${path} is not a file` };
    if (stats.size > MAX_RECOVERY_INPUT_BYTES) {
      return { kind: "oversized", path, sizeBytes: stats.size, limitBytes: MAX_RECOVERY_INPUT_BYTES };
    }
    text = await handle.readFile({ encoding: "utf8" });
  } catch (cause) {
    return { kind: "unreadable", why: `${path} could not be read: ${errnoCode(cause) ?? String(cause)}` };
  } finally {
    await handle.close().catch(() => {
      /* The bytes are read or the failure is already on its way out. */
    });
  }
  if (text.trim() === "") return { kind: "unreadable", why: `${path} is empty` };
  try {
    return { kind: "json", path, json: JSON.parse(text) as unknown };
  } catch (cause) {
    return { kind: "unreadable", why: `${path} is not JSON: ${String(cause)}` };
  }
}

/* ------------------------------------------------------------------ *
 * The validator: the daemon's shapes, checked arm by arm.
 * ------------------------------------------------------------------ */

type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(why: string): Parsed<T> => ({ ok: false, why });

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(u: unknown): u is string {
  return typeof u === "string" && ISO_INSTANT.test(u) && Number.isFinite(Date.parse(u));
}

function nonBlank(u: unknown): u is string {
  return typeof u === "string" && u.trim() !== "";
}

function textOrNull(u: unknown): u is string | null {
  return u === null || typeof u === "string";
}

function whole(u: unknown): u is number {
  return typeof u === "number" && Number.isSafeInteger(u) && u >= 0;
}

function parseResolution(u: unknown): Parsed<RecoveryWireResolution> {
  if (!isRecord(u)) return bad("resolution is not an object");
  const d = u["disposition"];
  if (d === "unresolved") return ok({ disposition: "unresolved" });
  const at = u["at"];
  const e = u["evidence"];
  if (!instant(at)) return bad("resolution.at is not a timestamp");
  if (!isRecord(e)) return bad("resolution.evidence is not an object");
  switch (d) {
    case "resumed":
      return nonBlank(e["previousToken"]) && nonBlank(e["token"]) && nonBlank(e["conversationId"])
        ? ok({ disposition: "resumed", at, evidence: { previousToken: e["previousToken"], token: e["token"], conversationId: e["conversationId"] } })
        : bad("a resumed resolution lacks its two tokens and its conversation");
    case "superseded":
      return nonBlank(e["by"]) ? ok({ disposition: "superseded", at, evidence: { by: e["by"] } }) : bad("a superseded resolution names no newer candidate");
    case "dismissed":
      return nonBlank(e["requestId"]) && typeof e["why"] === "string"
        ? ok({ disposition: "dismissed", at, evidence: { requestId: e["requestId"], why: e["why"] } })
        : bad("a dismissed resolution lacks its request and its sentence");
    default:
      return bad(`resolution.disposition ${JSON.stringify(d)} is not one this reader knows`);
  }
}

function parseEntry(u: unknown): Parsed<RecoveryWireEntry> {
  if (!isRecord(u)) return bad("entry is not an object");
  const meta = u["meta"];
  if (!isRecord(meta)) return bad("entry.meta is not an object");
  let dir: string | null;
  if (meta["version"] === "legacy") dir = null;
  else if (meta["version"] === 1 && nonBlank(meta["dir"])) dir = meta["dir"];
  else return bad("entry.meta is neither version 1 with a directory nor legacy");
  if (!textOrNull(u["worktree"])) return bad("entry.worktree is not text or null");
  if (!instant(u["lastSeenAlive"])) return bad("entry.lastSeenAlive is not a timestamp");
  if (!nonBlank(u["lastStatusKey"])) return bad("entry.lastStatusKey is not a status key");
  return ok({ dir, worktree: u["worktree"], lastSeenAlive: u["lastSeenAlive"], lastStatusKey: u["lastStatusKey"] });
}

function parseLastSeen(u: unknown): Parsed<RecoveryWireLastSeen | null> {
  if (u === null) return ok(null);
  if (!isRecord(u)) return bad("lastSeen is not an object or null");
  if (!nonBlank(u["statusKey"])) return bad("lastSeen.statusKey is not a status key");
  if (!textOrNull(u["title"]) || !textOrNull(u["harness"])) return bad("lastSeen.title or lastSeen.harness is not text or null");
  if (!instant(u["collectedAt"])) return bad("lastSeen.collectedAt is not a timestamp");
  return ok({ statusKey: u["statusKey"], title: u["title"], harness: u["harness"], collectedAt: u["collectedAt"] });
}

function parseDisappearance(u: unknown): Parsed<RecoveryWireDisappearance> {
  if (!isRecord(u)) return bad("disappearance is not an object");
  const g = u["generation"];
  const p = u["producerRun"];
  if (!nonBlank(u["goneWhy"])) return bad("disappearance.goneWhy is not a reason");
  if (g !== "same" && g !== "changed" && g !== "unverifiable") return bad("disappearance.generation is not same, changed or unverifiable");
  if (p !== "same" && p !== "changed" && p !== "cannot-tell") return bad("disappearance.producerRun is not same, changed or cannot-tell");
  if (typeof u["watched"] !== "boolean" || typeof u["bootChanged"] !== "boolean") return bad("disappearance.watched or bootChanged is not a boolean");
  return ok({ goneWhy: u["goneWhy"], generation: g, producerRun: p, watched: u["watched"], bootChanged: u["bootChanged"] });
}

/** One record of the fold, without its state: that needs the view. */
type RecordFacts = Omit<RecoveryWireRecord, "state"> & { resolution: RecoveryWireResolution };

function parseRecord(u: unknown): Parsed<RecordFacts> {
  if (!isRecord(u)) return bad("not an object");
  const { id, key, name, at, origin } = u;
  if (!nonBlank(id)) return bad("id is not a candidate id");
  if (!nonBlank(key)) return bad("key is not a session key");
  if (typeof name !== "string") return bad("name is not a string");
  if (!instant(at)) return bad("at is not a timestamp");
  if (origin !== "journal" && origin !== "legacy") return bad("origin is neither journal nor legacy");
  const resolution = parseResolution(u["resolution"]);
  if (!resolution.ok) return resolution;
  const common = { id, key, name, at, origin, resolution: resolution.value } as const;
  if (u["oversize"] === true) return ok({ ...common, oversize: true, entry: null, lastSeen: null, disappearance: null });
  if (u["oversize"] !== false) return bad("oversize is not a boolean");
  let entry: RecoveryWireEntry | null = null;
  if (u["entry"] === null) {
    // Null only for a legacy stub (recovery.ts § `RecoveryRecord`).
    if (origin !== "legacy") return bad("a journal record has no entry");
  } else {
    const parsed = parseEntry(u["entry"]);
    if (!parsed.ok) return parsed;
    entry = parsed.value;
  }
  const lastSeen = parseLastSeen(u["lastSeen"]);
  if (!lastSeen.ok) return lastSeen;
  const disappearance = parseDisappearance(u["disappearance"]);
  if (!disappearance.ok) return disappearance;
  return ok({ ...common, oversize: false, entry, lastSeen: lastSeen.value, disappearance: disappearance.value });
}

function parseReplay(u: unknown): Parsed<RecoveryWireReplay> {
  if (!isRecord(u)) return bad("replay is not an object");
  if (u["kind"] === "not-run") return typeof u["why"] === "string" ? ok({ kind: "not-run", why: u["why"] }) : bad("a replay that did not run says no why");
  if (u["kind"] === "ran" && whole(u["worldChanges"]) && whole(u["derived"]) && whole(u["scannedBytes"])) {
    return ok({ kind: "ran", worldChanges: u["worldChanges"], derived: u["derived"], scannedBytes: u["scannedBytes"] });
  }
  return bad("replay is neither a completed scan with its counts nor not-run");
}

function parseLiveRow(u: unknown): Parsed<RecoveryWireLiveRow> {
  if (!isRecord(u)) return bad("row is not an object");
  if (!nonBlank(u["tmuxId"]) || typeof u["name"] !== "string" || !nonBlank(u["statusKey"])) return bad("row lacks its handle, name or status");
  if (!textOrNull(u["dir"]) || !textOrNull(u["claimedConversationId"]) || !textOrNull(u["executionToken"]) || !textOrNull(u["conversationId"])) {
    return bad("row has a field that is not text or null");
  }
  return ok({
    tmuxId: u["tmuxId"],
    name: u["name"],
    dir: u["dir"],
    claimedConversationId: u["claimedConversationId"],
    statusKey: u["statusKey"],
    executionToken: u["executionToken"],
    conversationId: u["conversationId"],
  });
}

function parseClass(u: unknown): Parsed<RecoveryWireClass> {
  if (!isRecord(u)) return bad("classification is not an object");
  const why = u["why"];
  if (!nonBlank(why)) return bad("classification says no why");
  switch (u["kind"]) {
    case "unknown":
      return ok({ kind: "unknown", why });
    case "interrupted":
      return ok({ kind: "interrupted", why });
    case "ended-before-reboot":
      return nonBlank(u["statusKey"]) && instant(u["observedAt"])
        ? ok({ kind: "ended-before-reboot", why, statusKey: u["statusKey"], observedAt: u["observedAt"] })
        : bad("ended-before-reboot lacks its status or its clock");
    case "already-live": {
      const sameRun = u["sameRun"];
      if (sameRun !== null && typeof sameRun !== "boolean") return bad("already-live.sameRun is not a boolean or null");
      const row = parseLiveRow(u["row"]);
      return row.ok ? ok({ kind: "already-live", why, sameRun, row: row.value }) : row;
    }
    case "present-but-unmatched": {
      const row = parseLiveRow(u["row"]);
      return row.ok ? ok({ kind: "present-but-unmatched", why, row: row.value }) : row;
    }
    default:
      return bad(`classification ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

function parseDir(u: unknown): Parsed<RecoveryWireDir> {
  if (!isRecord(u)) return bad("evidence.dir is not an object");
  switch (u["kind"]) {
    case "exists":
      return nonBlank(u["path"]) ? ok({ kind: "exists", path: u["path"] }) : bad("dir exists with no path");
    case "missing":
      return nonBlank(u["path"]) && typeof u["why"] === "string" ? ok({ kind: "missing", path: u["path"], why: u["why"] }) : bad("dir missing without path or why");
    case "not-recorded":
      return typeof u["why"] === "string" ? ok({ kind: "not-recorded", why: u["why"] }) : bad("dir not-recorded without why");
    case "cannot-tell":
      return nonBlank(u["path"]) && typeof u["why"] === "string" ? ok({ kind: "cannot-tell", path: u["path"], why: u["why"] }) : bad("dir cannot-tell without path or why");
    default:
      return bad(`dir evidence ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

function parseWorktree(u: unknown): Parsed<RecoveryWireWorktree> {
  if (!isRecord(u)) return bad("evidence.worktree is not an object");
  switch (u["kind"]) {
    case "none":
      return ok({ kind: "none" });
    case "recorded":
      return nonBlank(u["name"]) && nonBlank(u["dir"]) ? ok({ kind: "recorded", name: u["name"], dir: u["dir"] }) : bad("worktree recorded without name or dir");
    case "not-recorded":
      return nonBlank(u["name"]) && typeof u["why"] === "string" ? ok({ kind: "not-recorded", name: u["name"], why: u["why"] }) : bad("worktree not-recorded without name or why");
    default:
      return bad(`worktree evidence ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

const NOT_FOUND_REASONS: Record<RecoveryWireNotFoundReason, true> = {
  "no-claude-session-id": true,
  "malformed-claude-session-id": true,
  "no-projects-directory": true,
  "no-transcript-file": true,
};

function parseTranscript(u: unknown): Parsed<RecoveryWireTranscript> {
  if (!isRecord(u)) return bad("evidence.transcript is not an object");
  const mtime = u["mtime"];
  const under = u["under"];
  switch (u["kind"]) {
    case "found": {
      const via = u["via"];
      if (!nonBlank(u["conversationId"]) || !nonBlank(u["path"]) || (via !== "slug-guess" && via !== "scan") || !(mtime === null || instant(mtime))) {
        return bad("a found transcript lacks its conversation, path, route or clock");
      }
      return ok({ kind: "found", conversationId: u["conversationId"], path: u["path"], via, mtime });
    }
    case "found-under-claim":
      if (!nonBlank(u["claimedConversationId"]) || !nonBlank(u["path"]) || !(mtime === null || instant(mtime)) || typeof u["why"] !== "string") {
        return bad("a transcript found under a claim lacks its claim, path, clock or why");
      }
      return ok({ kind: "found-under-claim", claimedConversationId: u["claimedConversationId"], path: u["path"], mtime, why: u["why"] });
    case "not-found": {
      const reason = u["reason"];
      if ((under !== "verified" && under !== "claim") || !nonBlank(u["conversationId"]) || typeof u["why"] !== "string") {
        return bad("a missing transcript lacks what it was looked for under, or why");
      }
      if (typeof reason !== "string" || !Object.hasOwn(NOT_FOUND_REASONS, reason)) return bad(`transcript reason ${JSON.stringify(reason)} is not one this reader knows`);
      return ok({ kind: "not-found", under, conversationId: u["conversationId"], reason: reason as RecoveryWireNotFoundReason, why: u["why"] });
    }
    case "cannot-tell":
      if ((under !== "verified" && under !== "claim") || !nonBlank(u["conversationId"]) || !nonBlank(u["why"])) {
        return bad("a transcript that cannot be told lacks what it was looked for under, or why");
      }
      return ok({ kind: "cannot-tell", under, conversationId: u["conversationId"], why: u["why"] });
    case "no-conversation":
      return typeof u["why"] === "string" ? ok({ kind: "no-conversation", why: u["why"] }) : bad("no-conversation without why");
    default:
      return bad(`transcript evidence ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

function parseResume(u: unknown): Parsed<RecoveryWireResume> {
  if (!isRecord(u)) return bad("evidence.resume is not an object");
  switch (u["kind"]) {
    case "supported":
      return nonBlank(u["conversationId"]) && nonBlank(u["transcriptPath"])
        ? ok({ kind: "supported", conversationId: u["conversationId"], transcriptPath: u["transcriptPath"] })
        : bad("resume supported without a conversation and a transcript");
    case "not-supported":
      return nonBlank(u["why"]) ? ok({ kind: "not-supported", why: u["why"] }) : bad("resume not-supported without why");
    case "manual":
      return nonBlank(u["host"]) && textOrNull(u["dir"]) && typeof u["why"] === "string"
        ? ok({ kind: "manual", host: u["host"], dir: u["dir"], why: u["why"] })
        : bad("manual resume without a host, a directory or why");
    default:
      return bad(`resume evidence ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

function parseEvidence(u: unknown): Parsed<RecoveryWireEvidence> {
  if (!isRecord(u)) return bad("evidence is not an object");
  if (u["kind"] === "unavailable") return nonBlank(u["why"]) ? ok({ kind: "unavailable", why: u["why"] }) : bad("unavailable evidence without why");
  if (u["kind"] !== "checked") return bad(`evidence ${JSON.stringify(u["kind"])} is not one this reader knows`);
  const dir = parseDir(u["dir"]);
  if (!dir.ok) return dir;
  const worktree = parseWorktree(u["worktree"]);
  if (!worktree.ok) return worktree;
  const transcript = parseTranscript(u["transcript"]);
  if (!transcript.ok) return transcript;
  const resume = parseResume(u["resume"]);
  if (!resume.ok) return resume;
  const activity = u["lastActivity"];
  if (!isRecord(activity) || !instant(activity["at"]) || (activity["source"] !== "transcript" && activity["source"] !== "register-floor")) {
    return bad("lastActivity is not a clock with its source");
  }
  return ok({
    kind: "checked",
    dir: dir.value,
    worktree: worktree.value,
    transcript: transcript.value,
    lastActivity: { at: activity["at"], source: activity["source"] },
    resume: resume.value,
  });
}

type ViewItem = { classification: RecoveryWireClass | null; evidence: RecoveryWireEvidence | null };

type ParsedView =
  | { kind: "not-yet-checked" }
  | { kind: "checked"; wire: Extract<RecoveryWireView, { kind: "checked" }>; items: Map<string, ViewItem> };

function parseView(u: unknown): Parsed<ParsedView> {
  if (u === null || u === undefined) return ok({ kind: "not-yet-checked" });
  if (!isRecord(u)) return bad("the view is not an object or null");
  if (!instant(u["checkedAt"])) return bad("view.checkedAt is not a timestamp");
  const inv = u["inventory"];
  let inventory: Extract<RecoveryWireView, { kind: "checked" }>["inventory"];
  if (isRecord(inv) && inv["kind"] === "trusted" && instant(inv["collectedAt"]) && whole(inv["rows"])) {
    inventory = { kind: "trusted", collectedAt: inv["collectedAt"], rows: inv["rows"] };
  } else if (isRecord(inv) && inv["kind"] === "untrusted" && nonBlank(inv["why"])) {
    inventory = { kind: "untrusted", why: inv["why"] };
  } else {
    return bad("view.inventory is neither trusted with its clock nor untrusted with why");
  }
  const page = u["page"];
  if (!Array.isArray(page)) return bad("view.page is not a list");
  const items = new Map<string, ViewItem>();
  for (const [index, raw] of page.entries()) {
    if (!isRecord(raw) || !nonBlank(raw["id"])) return bad(`view.page[${index}] has no id`);
    let classification: RecoveryWireClass | null = null;
    let evidence: RecoveryWireEvidence | null = null;
    if (raw["classification"] !== null) {
      const parsed = parseClass(raw["classification"]);
      if (!parsed.ok) return bad(`view.page[${index}]: ${parsed.why}`);
      classification = parsed.value;
    }
    if (raw["evidence"] !== null) {
      const parsed = parseEvidence(raw["evidence"]);
      if (!parsed.ok) return bad(`view.page[${index}]: ${parsed.why}`);
      evidence = parsed.value;
    }
    items.set(raw["id"], { classification, evidence });
  }
  return ok({ kind: "checked", wire: { kind: "checked", checkedAt: u["checkedAt"], inventory }, items });
}

/* ------------------------------------------------------------------ *
 * The projection.
 * ------------------------------------------------------------------ */

/**
 * The grouping within the unresolved half, interrupted first. The rest follow
 * by how much a person has to do about them: an unproven resemblance, then
 * what nobody can yet say, then what stopped on its own, then what is already
 * running again.
 */
const GROUP_RANK: Record<RecoveryWireClass["kind"] | "unchecked", number> = {
  interrupted: 0,
  "present-but-unmatched": 1,
  unknown: 2,
  unchecked: 3,
  "ended-before-reboot": 4,
  "already-live": 5,
};

function groupOf(state: RecoveryWireRecordState): number {
  switch (state.kind) {
    case "resolved":
      return 100;
    case "unchecked":
      return GROUP_RANK.unchecked;
    case "classified":
      return GROUP_RANK[state.classification.kind];
    default: {
      const never: never = state;
      throw new Error(`no group for ${JSON.stringify(never)}`);
    }
  }
}

/** Newest disappearance first, then id — the daemon's tie-break (recovery-view.ts § `recoveryOrder`). */
function newestFirst(a: { at: string; id: string }, b: { at: string; id: string }): number {
  const byAt = Date.parse(b.at) - Date.parse(a.at);
  if (byAt !== 0) return byAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function stateOf(facts: RecordFacts, view: ParsedView | { kind: "unreadable" }): RecoveryWireRecordState {
  if (facts.resolution.disposition !== "unresolved") return { kind: "resolved", resolution: facts.resolution };
  if (view.kind === "not-yet-checked") {
    return { kind: "unchecked", why: "not yet checked by this daemon: it classifies records only after its first pass since it started" };
  }
  if (view.kind === "unreadable") return { kind: "unchecked", why: "the daemon's view could not be read, so this record's classification is unknown" };
  const item = view.items.get(facts.id);
  if (item === undefined || item.classification === null || item.evidence === null) {
    return {
      kind: "unchecked",
      why: "the daemon's last check did not classify this record: it arrived after that pass, or lies past the pass's first page",
    };
  }
  return { kind: "classified", classification: item.classification, evidence: item.evidence };
}

function projectPublished(path: string, json: Record<string, unknown>, composedAt: string): RecoveryFeed {
  const unreadable = (why: string): RecoveryFeed => ({ schema: 1, kind: "unreadable", composedAt, why: `${path}: ${why}` });
  const writtenAt = json["writtenAt"];
  if (!(writtenAt === null || writtenAt === undefined || instant(writtenAt))) return unreadable("writtenAt is not a timestamp");
  const replay = parseReplay(json["replay"]);
  if (!replay.ok) return unreadable(replay.why);
  if (!whole(json["overflow"])) return unreadable("overflow is not a count");
  const rawRecords = json["records"];
  if (!Array.isArray(rawRecords)) return unreadable("records is not a list");
  const facts: RecordFacts[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawRecords.entries()) {
    const parsed = parseRecord(raw);
    if (!parsed.ok) return unreadable(`records[${index}]: ${parsed.why}. The index is refused whole rather than drawn without it`);
    if (seen.has(parsed.value.id)) return unreadable(`records holds ${parsed.value.id} twice`);
    seen.add(parsed.value.id);
    facts.push(parsed.value);
  }
  const viewParse = parseView(json["view"]);
  const view: ParsedView | { kind: "unreadable" } = viewParse.ok ? viewParse.value : { kind: "unreadable" };
  const wireView: RecoveryWireView = !viewParse.ok
    ? { kind: "unreadable", why: viewParse.why }
    : viewParse.value.kind === "not-yet-checked"
      ? {
          kind: "not-yet-checked",
          why: "the daemon has not yet checked these records since it started: it classifies them only after its first pass",
        }
      : viewParse.value.wire;

  // The first page is chosen in the daemon's order (unresolved first, newest
  // first), so it is exactly the set the daemon's view pass checked; the
  // grouping is applied within it. Grouping first would let old unchecked
  // records push classified ones off the page.
  const unresolvedFirst = [...facts].sort((a, b) => {
    const ua = a.resolution.disposition === "unresolved" ? 0 : 1;
    const ub = b.resolution.disposition === "unresolved" ? 0 : 1;
    return ua !== ub ? ua - ub : newestFirst(a, b);
  });
  const records: RecoveryWireRecord[] = unresolvedFirst.slice(0, RECOVERY_FIRST_PAGE).map((f) => ({
    id: f.id,
    key: f.key,
    name: f.name,
    at: f.at,
    origin: f.origin,
    oversize: f.oversize,
    entry: f.entry,
    lastSeen: f.lastSeen,
    disappearance: f.disappearance,
    state: stateOf(f, view),
  }));
  records.sort((a, b) => groupOf(a.state) - groupOf(b.state) || newestFirst(a, b));

  return {
    schema: 1,
    kind: "published",
    composedAt,
    path,
    writtenAt: instant(writtenAt) ? writtenAt : null,
    view: wireView,
    replay: replay.value,
    overflow: json["overflow"],
    total: facts.length,
    unresolved: facts.filter((f) => f.resolution.disposition === "unresolved").length,
    olderCount: facts.length - records.length,
    records,
  };
}

/** The file's arm, projected. Pure: no I/O, no clock of its own. */
export function projectRecovery(load: RecoveryFileLoad, composedAt: string): RecoveryFeed {
  switch (load.kind) {
    case "absent":
      return {
        schema: 1,
        kind: "absent",
        composedAt,
        path: load.path,
        why:
          "the Overseer has not written a recovery index here. That is the ordinary state until it first records a disappearance or replays an old log — not an index that exists and is empty.",
      };
    case "unreadable":
      return { schema: 1, kind: "unreadable", composedAt, why: load.why };
    case "oversized":
      return {
        schema: 1,
        kind: "oversized",
        composedAt,
        path: load.path,
        sizeBytes: load.sizeBytes,
        limitBytes: load.limitBytes,
        why: `${load.path} is ${load.sizeBytes} bytes, over this route's ${load.limitBytes}-byte limit. It was refused before it was read; the recovery CLI's list reads it without this limit.`,
      };
    case "json": {
      if (!isRecord(load.json)) return { schema: 1, kind: "unreadable", composedAt, why: `${load.path} is not a JSON object` };
      const schema = load.json["schema"];
      if (schema !== KNOWN_RECOVERY_SCHEMA) {
        const saw = JSON.stringify(schema) ?? "nothing";
        return {
          schema: 1,
          kind: "unsupported-schema",
          composedAt,
          path: load.path,
          saw,
          known: KNOWN_RECOVERY_SCHEMA,
          why: `${load.path} says schema ${saw}, and this dashboard reads only schema ${KNOWN_RECOVERY_SCHEMA}. Its records are not shown rather than guessed at.`,
        };
      }
      return projectPublished(load.path, load.json, composedAt);
    }
    default: {
      const never: never = load;
      return { schema: 1, kind: "unreadable", composedAt, why: `the recovery reader returned ${JSON.stringify(never)}` };
    }
  }
}
