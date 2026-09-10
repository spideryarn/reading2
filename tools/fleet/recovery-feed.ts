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
 * ## The fields that must agree are checked to agree (Sol's F29)
 *
 * Each field parsing on its own is not enough: a record whose `entry` is
 * another session's, or a view item whose id is one record's and whose
 * identity is another's, would draw one session's directory, classification
 * or evidence under another's name — the one thing this page may never do. So
 * `entry.key` must be the record's key (the store refuses the file on this
 * too, store.ts § `parseRecoveryRecord`), and every view item must name a
 * record the file holds, once, with that record's key, name, time and
 * resolution, carrying a classification and evidence exactly when it is
 * unresolved. One exception, and only in one direction: see `parseView`.
 *
 * ## The optional `resume` field, which never touches the records
 *
 * Plan 260910f (Sol's G9) puts the resume projection in this file as an
 * optional top-level `resume` field beside `view`. It has a strict validator of
 * its own and four arms of its own (`RecoveryResumeSection`): absent, published,
 * unreadable (naming what was wrong) and unsupported-schema. **Whatever it
 * holds, it cannot change `records`, `view` or any other part of the feed** — it
 * is parsed after them, from them, and only into `resume`. A malformed field
 * means the page offers no Resume, and nothing else. A request, preview or pace
 * naming a candidate the file does not hold, or with another record's name, is
 * `unreadable`, in F29's spirit: one record's resume state must never be drawn
 * under another's name.
 *
 * ## Asynchronous, on purpose
 *
 * The route calls this on a request, in the one Node process that serves the
 * whole dashboard. `routes-decisions.ts` reads its file synchronously and
 * defends that with an input ceiling; this reads through `fs/promises`, so a
 * slow disk stalls one request rather than the server. The ceiling is here as
 * well, and it bounds **the bytes read from the descriptor**, not the size a
 * `stat` reported a moment earlier — see `loadRecoveryFile`.
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
  RecoveryResumeAccount,
  RecoveryResumeGateWire,
  RecoveryResumeLaunchState,
  RecoveryResumeLaunchWire,
  RecoveryResumePreview,
  RecoveryResumeProjection,
  RecoveryResumeQuote,
  RecoveryResumeRequestState,
  RecoveryResumeSection,
  RecoveryResumeVerification,
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

/** One read's worth: an ordinary index is one read, the ceiling a few dozen. */
const READ_CHUNK_BYTES = 256 * 1024;

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
    // THE CEILING BOUNDS THE BYTES READ, NOT THE SIZE `stat` REPORTED (Sol's
    // F27). `readFile` reads to EOF, so a file that grew after the check above
    // was loaded whole, whatever the limit said. So read from the descriptor,
    // at most one byte past the limit, and let that one byte mean `oversized`;
    // only the bounded buffer is ever decoded. The check above stays as the
    // cheap refusal that reads nothing.
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_RECOVERY_INPUT_BYTES) {
      const want = Math.min(READ_CHUNK_BYTES, MAX_RECOVERY_INPUT_BYTES + 1 - total);
      const chunk = Buffer.allocUnsafe(want);
      const { bytesRead } = await handle.read(chunk, 0, want, total);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_RECOVERY_INPUT_BYTES) {
      const grown = await handle.stat().catch(() => null);
      return { kind: "oversized", path, sizeBytes: Math.max(total, grown?.size ?? 0), limitBytes: MAX_RECOVERY_INPUT_BYTES };
    }
    text = Buffer.concat(chunks, total).toString("utf8");
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

/** The entry, and the key it says it belongs to — kept only to be compared, and not put on the wire. */
function parseEntry(u: unknown): Parsed<{ key: string; entry: RecoveryWireEntry }> {
  if (!isRecord(u)) return bad("entry is not an object");
  if (!nonBlank(u["key"])) return bad("entry.key is not a session key");
  const meta = u["meta"];
  if (!isRecord(meta)) return bad("entry.meta is not an object");
  let dir: string | null;
  if (meta["version"] === "legacy") dir = null;
  else if (meta["version"] === 1 && nonBlank(meta["dir"])) dir = meta["dir"];
  else return bad("entry.meta is neither version 1 with a directory nor legacy");
  if (!textOrNull(u["worktree"])) return bad("entry.worktree is not text or null");
  if (!instant(u["lastSeenAlive"])) return bad("entry.lastSeenAlive is not a timestamp");
  if (!nonBlank(u["lastStatusKey"])) return bad("entry.lastStatusKey is not a status key");
  return ok({ key: u["key"], entry: { dir, worktree: u["worktree"], lastSeenAlive: u["lastSeenAlive"], lastStatusKey: u["lastStatusKey"] } });
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
    // THE ENTRY IS THIS RECORD'S, or the file is refused (Sol's F29) — the
    // store's own parser refuses it on exactly this.
    if (parsed.value.key !== key) {
      return bad(`entry.key ${JSON.stringify(parsed.value.key)} does not agree with the record's key ${JSON.stringify(key)}`);
    }
    entry = parsed.value.entry;
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

/** Held only for an unresolved record the view is current about, so both halves are always there. */
type ViewItem = { classification: RecoveryWireClass; evidence: RecoveryWireEvidence };

type ParsedView =
  | { kind: "not-yet-checked" }
  | { kind: "checked"; wire: Extract<RecoveryWireView, { kind: "checked" }>; items: Map<string, ViewItem> };

/** Both sides come from `parseResolution`, which builds each arm with one key order. */
function sameResolution(a: RecoveryWireResolution, b: RecoveryWireResolution): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The view, checked against the records it describes (Sol's F29).
 *
 * **One disagreement is lawful, in one direction only.** An item may say
 * `unresolved` of a record the file now holds resolved. The daemon appends a
 * derived disposition, and the next checkpoint writes the fold beside the view
 * it already held, before the pass it asked for lands (daemon.ts §
 * `appendDerived`, store.ts § `checkpoint`). That is the view lagging the fold,
 * not a contradiction, and refusing it would put an alarm on the page after
 * every resume. Such an item is still checked for shape and identity, and then
 * not used: the record's own resolution decides its state. Every other
 * disagreement — a resolved item over an unresolved record, or two different
 * resolutions — makes the view unreadable.
 */
function parseView(u: unknown, records: ReadonlyMap<string, RecordFacts>): Parsed<ParsedView> {
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
  const listed = new Set<string>();
  for (const [index, raw] of page.entries()) {
    const where = `view.page[${index}]`;
    if (!isRecord(raw) || !nonBlank(raw["id"])) return bad(`${where} has no id`);
    const id = raw["id"];
    if (listed.has(id)) return bad(`${where}: the view lists ${id} twice`);
    listed.add(id);
    const record = records.get(id);
    if (record === undefined) return bad(`${where} names ${id}, which the index does not hold`);
    if (raw["key"] !== record.key || raw["name"] !== record.name || raw["at"] !== record.at) {
      return bad(`${where} names ${id} but carries a different key, name or time from that record's`);
    }
    const resolution = parseResolution(raw["resolution"]);
    if (!resolution.ok) return bad(`${where}: ${resolution.why}`);
    const unresolved = resolution.value.disposition === "unresolved";
    let current = true;
    if (!sameResolution(resolution.value, record.resolution)) {
      // The lag in this function's comment, and nothing else.
      if (unresolved && record.resolution.disposition !== "unresolved") current = false;
      else return bad(`${where}: its resolution disagrees with ${id}'s own`);
    }
    if (!unresolved) {
      if (raw["classification"] !== null || raw["evidence"] !== null) return bad(`${where} is resolved and still carries a classification or evidence`);
      continue;
    }
    if (raw["classification"] === null || raw["evidence"] === null) return bad(`${where} is unresolved and lacks its classification or its evidence`);
    const classification = parseClass(raw["classification"]);
    if (!classification.ok) return bad(`${where}: ${classification.why}`);
    const evidence = parseEvidence(raw["evidence"]);
    if (!evidence.ok) return bad(`${where}: ${evidence.why}`);
    if (current) items.set(id, { classification: classification.value, evidence: evidence.value });
  }
  return ok({ kind: "checked", wire: { kind: "checked", checkedAt: u["checkedAt"], inventory }, items });
}

/* ------------------------------------------------------------------ *
 * The optional `resume` field (plan 260910f, Sol's G9).
 * ------------------------------------------------------------------ */

/** The one `resume` schema this reader understands. */
export const KNOWN_RESUME_SCHEMA = 1;

const LAUNCH_STATES: Record<RecoveryResumeLaunchState, true> = {
  planned: true,
  "waiting-admission": true,
  reserved: true,
  launching: true,
  "observed-running": true,
  completed: true,
  "failed-before-launch": true,
  "outcome-unknown": true,
};

function instantOrNull(u: unknown): u is string | null {
  return u === null || instant(u);
}

function parseLaunch(u: unknown): Parsed<RecoveryResumeLaunchWire> {
  if (!isRecord(u)) return bad("launch is not an object");
  const { occurrenceId, state, attempt, reservationHeld, disposed, endedAt, completion } = u;
  if (!nonBlank(occurrenceId)) return bad("launch.occurrenceId is not an occurrence id");
  if (typeof state !== "string" || !Object.hasOwn(LAUNCH_STATES, state)) return bad(`launch.state ${JSON.stringify(state)} is not one the launch protocol has`);
  if (!(attempt === null || whole(attempt))) return bad("launch.attempt is not a count or null");
  if (typeof reservationHeld !== "boolean" || typeof disposed !== "boolean") return bad("launch.reservationHeld or launch.disposed is not a boolean");
  if (!instantOrNull(endedAt)) return bad("launch.endedAt is not a timestamp or null");
  let done: RecoveryResumeLaunchWire["completion"];
  if (completion === null) done = null;
  else if (isRecord(completion) && completion["kind"] === "exit" && (completion["code"] === null || Number.isSafeInteger(completion["code"]))) {
    done = { kind: "exit", code: completion["code"] as number | null };
  } else if (isRecord(completion) && completion["kind"] === "rebooted") done = { kind: "rebooted" };
  else return bad("launch.completion is neither an exit, a reboot nor null");
  return ok({ occurrenceId, state: state as RecoveryResumeLaunchState, attempt, reservationHeld, disposed, endedAt, completion: done });
}

function parseVerification(u: unknown): Parsed<RecoveryResumeVerification> {
  if (!isRecord(u)) return bad("verification is not an object");
  const { inventoryResumed, observedRunning, transcriptGrew, sessionLineSeen } = u;
  if (typeof inventoryResumed !== "boolean" || typeof observedRunning !== "boolean" || typeof transcriptGrew !== "boolean" || typeof sessionLineSeen !== "boolean") {
    return bad("verification lacks one of its four parts");
  }
  return ok({ inventoryResumed, observedRunning, transcriptGrew, sessionLineSeen });
}

/** One request's state, exhaustively (Sol's G1). Each arm is rebuilt from its own fields only. */
function parseRequestState(u: unknown): Parsed<RecoveryResumeRequestState> {
  if (!isRecord(u)) return bad("state is not an object");
  const requestedAt = u["requestedAt"];
  const kind = u["kind"];
  if (kind !== "resumed" && !instant(requestedAt)) return bad(`a ${JSON.stringify(kind)} state has no requestedAt timestamp`);
  const at = requestedAt as string;
  switch (kind) {
    case "pending": {
      const { position, actor, why, until } = u;
      if (!whole(position) || position < 1) return bad("a pending state's position is not a count from 1");
      if (actor !== "dashboard" && actor !== "cli") return bad(`a pending state's actor ${JSON.stringify(actor)} is neither dashboard nor cli`);
      if (!nonBlank(why)) return bad("a pending state says no why");
      if (!instantOrNull(until)) return bad("a pending state's until is not a timestamp or null");
      return ok({ kind, position, requestedAt: at, actor, why, until });
    }
    case "refused":
      return instant(u["refusedAt"]) && nonBlank(u["why"])
        ? ok({ kind, requestedAt: at, refusedAt: u["refusedAt"], why: u["why"] })
        : bad("a refused state lacks its time or its reason");
    case "launched": {
      const launch = parseLaunch(u["launch"]);
      if (!launch.ok) return launch;
      const verification = parseVerification(u["verification"]);
      if (!verification.ok) return verification;
      if (!nonBlank(u["waitingFor"])) return bad("a launched state says nothing about what it waits for");
      return ok({ kind, requestedAt: at, launch: launch.value, verification: verification.value, waitingFor: u["waitingFor"] });
    }
    case "ended-unverified": {
      const launch = parseLaunch(u["launch"]);
      if (!launch.ok) return launch;
      return nonBlank(u["how"]) ? ok({ kind, requestedAt: at, launch: launch.value, how: u["how"] }) : bad("an ended-unverified state says not how it ended");
    }
    case "needs-greg": {
      const launch = parseLaunch(u["launch"]);
      if (!launch.ok) return launch;
      return nonBlank(u["why"]) && nonBlank(u["disposeCommand"])
        ? ok({ kind, requestedAt: at, launch: launch.value, why: u["why"], disposeCommand: u["disposeCommand"] })
        : bad("a needs-greg state lacks its why or its dispose command");
    }
    case "disposed": {
      const launch = parseLaunch(u["launch"]);
      return launch.ok ? ok({ kind, requestedAt: at, launch: launch.value }) : launch;
    }
    case "resumed": {
      if (!instantOrNull(requestedAt)) return bad("a resumed state's requestedAt is not a timestamp or null");
      if (!instant(u["verifiedAt"])) return bad("a resumed state has no verifiedAt timestamp");
      let launch: RecoveryResumeLaunchWire | null = null;
      if (u["launch"] !== null) {
        const parsed = parseLaunch(u["launch"]);
        if (!parsed.ok) return parsed;
        launch = parsed.value;
      }
      return ok({ kind, requestedAt, launch, verifiedAt: u["verifiedAt"] });
    }
    default:
      return bad(`state ${JSON.stringify(kind)} is not one this reader knows`);
  }
}

function parseQuote(u: unknown, where: string): Parsed<RecoveryResumeQuote> {
  if (!isRecord(u)) return bad(`${where} is not an object`);
  if (u["kind"] === "quoted" && typeof u["text"] === "string" && typeof u["truncated"] === "boolean") return ok({ kind: "quoted", text: u["text"], truncated: u["truncated"] });
  if (u["kind"] === "unavailable" && nonBlank(u["why"])) return ok({ kind: "unavailable", why: u["why"] });
  return bad(`${where} is neither a quotation with its text nor unavailable with why`);
}

function parseAccount(u: unknown): Parsed<RecoveryResumeAccount> {
  if (!isRecord(u)) return bad("account is not an object");
  if (u["kind"] === "pinned" && nonBlank(u["name"]) && nonBlank(u["configDir"])) return ok({ kind: "pinned", name: u["name"], configDir: u["configDir"] });
  if (u["kind"] === "unknown" && nonBlank(u["why"])) return ok({ kind: "unknown", why: u["why"] });
  return bad(`account ${JSON.stringify(u["kind"])} is neither pinned with its name and config directory nor unknown with why`);
}

function parsePreview(u: unknown): Parsed<RecoveryResumePreview> {
  if (!isRecord(u)) return bad("not an object");
  const { candidateId, conversationId, dir, title, uncertainty, nudge } = u;
  if (!nonBlank(candidateId)) return bad("candidateId is not a candidate id");
  if (!nonBlank(conversationId) || !nonBlank(dir)) return bad("it lacks its conversation or its directory");
  if (!textOrNull(title)) return bad("title is not text or null");
  const brief = parseQuote(u["brief"], "brief");
  if (!brief.ok) return brief;
  const lastWords = parseQuote(u["lastWords"], "lastWords");
  if (!lastWords.ok) return lastWords;
  if (!Array.isArray(uncertainty) || !uncertainty.every(nonBlank)) return bad("uncertainty is not a list of sentences");
  if (!nonBlank(nudge)) return bad("the nudge is blank");
  const account = parseAccount(u["account"]);
  if (!account.ok) return account;
  return ok({ candidateId, conversationId, dir, title, brief: brief.value, lastWords: lastWords.value, uncertainty: [...uncertainty], nudge, account: account.value });
}

function parseGate(u: unknown): Parsed<RecoveryResumeGateWire | null> {
  if (u === null) return ok(null);
  if (isRecord(u) && u["kind"] === "clear" && Array.isArray(u["notes"]) && u["notes"].every((n) => typeof n === "string")) return ok({ kind: "clear", notes: [...u["notes"]] });
  if (isRecord(u) && u["kind"] === "held" && nonBlank(u["why"]) && instantOrNull(u["until"])) return ok({ kind: "held", why: u["why"], until: u["until"] });
  return bad("gate is neither null, clear with its notes, nor held with why");
}

function parsePace(u: unknown): Parsed<RecoveryResumeProjection["pace"]> {
  if (!isRecord(u)) return bad("pace is not an object");
  switch (u["kind"]) {
    case "free":
      return ok({ kind: "free" });
    case "waiting-for-verification":
      return nonBlank(u["candidateId"]) && typeof u["name"] === "string" && instant(u["since"])
        ? ok({ kind: "waiting-for-verification", candidateId: u["candidateId"], name: u["name"], since: u["since"] })
        : bad("pace waiting-for-verification lacks its candidate, name or since");
    case "spacing":
      return instant(u["until"]) ? ok({ kind: "spacing", until: u["until"] }) : bad("pace spacing has no until");
    default:
      return bad(`pace ${JSON.stringify(u["kind"])} is not one this reader knows`);
  }
}

/** The projection's own shape, before anything is compared with the records. */
function parseProjection(u: Record<string, unknown>): Parsed<RecoveryResumeProjection> {
  if (!instant(u["writtenAt"])) return bad("writtenAt is not a timestamp");
  const l = u["launcher"];
  let launcher: RecoveryResumeProjection["launcher"];
  if (isRecord(l) && l["kind"] === "wired") launcher = { kind: "wired" };
  else if (isRecord(l) && l["kind"] === "unwired" && nonBlank(l["why"])) launcher = { kind: "unwired", why: l["why"] };
  else return bad("launcher is neither wired nor unwired with why");
  const gate = parseGate(u["gate"]);
  if (!gate.ok) return gate;
  const pace = parsePace(u["pace"]);
  if (!pace.ok) return pace;
  const rawRequests = u["requests"];
  if (!Array.isArray(rawRequests)) return bad("requests is not a list");
  const requests: RecoveryResumeProjection["requests"] = [];
  for (const [index, raw] of rawRequests.entries()) {
    if (!isRecord(raw) || !nonBlank(raw["candidateId"]) || typeof raw["name"] !== "string") return bad(`requests[${index}] lacks its candidate or its name`);
    const state = parseRequestState(raw["state"]);
    if (!state.ok) return bad(`requests[${index}]: ${state.why}`);
    requests.push({ candidateId: raw["candidateId"], name: raw["name"], state: state.value });
  }
  const rawPreviews = u["previews"];
  if (!Array.isArray(rawPreviews)) return bad("previews is not a list");
  const previews: RecoveryResumePreview[] = [];
  for (const [index, raw] of rawPreviews.entries()) {
    const preview = parsePreview(raw);
    if (!preview.ok) return bad(`previews[${index}]: ${preview.why}`);
    previews.push(preview.value);
  }
  if (!whole(u["pendingOverflow"])) return bad("pendingOverflow is not a count");
  return ok({ schema: 1, writtenAt: u["writtenAt"], launcher, gate: gate.value, pace: pace.value, requests, previews, pendingOverflow: u["pendingOverflow"] });
}

/**
 * The projection checked against the file's records and view (the F29
 * spirit): every candidate it names is one the file holds, under that record's
 * name, once; pending positions are distinct; and a preview's conversation is
 * the one its record's evidence supports, when the view says which.
 */
function resumeContradiction(p: RecoveryResumeProjection, records: ReadonlyMap<string, RecordFacts>, view: ParsedView | { kind: "unreadable" }): string | null {
  const named = (where: string, id: string, name: string | null): string | null => {
    const record = records.get(id);
    if (record === undefined) return `${where} names ${id}, which the index does not hold`;
    if (name !== null && name !== record.name) return `${where} names ${id} but carries a different name from that record's`;
    return null;
  };
  const requested = new Set<string>();
  const positions = new Set<number>();
  for (const [index, r] of p.requests.entries()) {
    const why = named(`requests[${index}]`, r.candidateId, r.name);
    if (why !== null) return why;
    if (requested.has(r.candidateId)) return `requests lists ${r.candidateId} twice`;
    requested.add(r.candidateId);
    if (r.state.kind === "pending") {
      if (positions.has(r.state.position)) return `requests[${index}]: two pending requests share position ${r.state.position}`;
      positions.add(r.state.position);
    }
  }
  const previewed = new Set<string>();
  for (const [index, preview] of p.previews.entries()) {
    const why = named(`previews[${index}]`, preview.candidateId, null);
    if (why !== null) return why;
    if (previewed.has(preview.candidateId)) return `previews lists ${preview.candidateId} twice`;
    previewed.add(preview.candidateId);
    const item = view.kind === "checked" ? view.items.get(preview.candidateId) : undefined;
    if (item?.evidence.kind === "checked" && item.evidence.resume.kind === "supported" && item.evidence.resume.conversationId !== preview.conversationId) {
      return `previews[${index}] for ${preview.candidateId} names conversation ${preview.conversationId}, but that record's evidence supports ${item.evidence.resume.conversationId}`;
    }
  }
  if (p.pace.kind === "waiting-for-verification") return named("pace", p.pace.candidateId, p.pace.name);
  return null;
}

/** `recovery.json`'s optional `resume` field. Never throws, and cannot touch anything but itself. */
function parseResumeSection(u: unknown, records: ReadonlyMap<string, RecordFacts>, view: ParsedView | { kind: "unreadable" }): RecoveryResumeSection {
  if (u === undefined || u === null) {
    return {
      kind: "absent",
      why: "the recovery index carries no resume data: the daemon that wrote it predates resume, or resume is not composed into it yet",
    };
  }
  const unreadable = (why: string): RecoveryResumeSection => ({
    kind: "unreadable",
    why: `the index's resume field: ${why}. The records are shown as they are; only Resume is unavailable`,
  });
  if (!isRecord(u)) return unreadable("it is not an object");
  if (u["schema"] !== KNOWN_RESUME_SCHEMA) {
    const saw = JSON.stringify(u["schema"]) ?? "nothing";
    return {
      kind: "unsupported-schema",
      saw,
      known: KNOWN_RESUME_SCHEMA,
      why: `the index's resume field says schema ${saw}, and this dashboard reads only schema ${KNOWN_RESUME_SCHEMA} of it. The records are shown; Resume is not offered.`,
    };
  }
  const parsed = parseProjection(u);
  if (!parsed.ok) return unreadable(parsed.why);
  const contradiction = resumeContradiction(parsed.value, records, view);
  if (contradiction !== null) return unreadable(contradiction);
  return { kind: "published", projection: parsed.value };
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
  if (item === undefined) {
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
  const byId = new Map<string, RecordFacts>();
  for (const [index, raw] of rawRecords.entries()) {
    const parsed = parseRecord(raw);
    if (!parsed.ok) return unreadable(`records[${index}]: ${parsed.why}. The index is refused whole rather than drawn without it`);
    if (byId.has(parsed.value.id)) return unreadable(`records holds ${parsed.value.id} twice`);
    byId.set(parsed.value.id, parsed.value);
    facts.push(parsed.value);
  }
  const viewParse = parseView(json["view"], byId);
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
    // Last, and from what is already settled: nothing in it can reach the fields above.
    resume: parseResumeSection(json["resume"], byId, view),
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
