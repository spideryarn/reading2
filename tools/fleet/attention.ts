/**
 * **THE EDGE THAT DID NOT EXIST**: the fleet server reading the attention inbox
 * out of the Overseer's checkpoint file.
 *
 * `tools/overseer/attention-pass.ts` ranks what needs Greg and publishes it as
 * `Checkpoint.attention` in `~/.overseer/current.json`. Until this file nothing
 * read it — measured 2026-09-08: `grep -rln "Checkpoint" tools/fleet/` found
 * nothing — so the wave's headline feature was invisible while looking finished
 * from either end. That is Class A of
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md:
 * *the edge does not exist, and no type can express "somebody must call this"*.
 *
 * ## THE FILE IS THE CONTRACT, NOT THE OVERSEER'S PARSER
 *
 * docs/project/overseer-direction.md says so, and it is load-bearing rather
 * than stylistic:
 *
 * > **The dashboard should parse `current.json` itself rather than importing
 * > the Overseer's parser** […] `tools/overseer/` already imports `collect.ts`
 * > and `status.ts` from `tools/fleet/`, so a `tools/fleet/` that imported
 * > `readCheckpoint` would close a cycle between the two things this seam
 * > exists to keep apart. **The file is the contract; the function is one
 * > implementation of reading it.**
 *
 * Three further reasons, each of which would have bitten:
 *
 *  - **`parseCheckpoint` fails the WHOLE checkpoint on one malformed register
 *    entry** — deliberately, because the register is the thing there is no
 *    second copy of. Borrowing it would make a bad row in a part of the file
 *    that is none of our business render as *the inbox is unreadable*, when the
 *    inbox was fine.
 *  - **It drags the Overseer's usage, memory, diff, lock and log modules into
 *    this process.** A module-load regression over there would stop the
 *    dashboard starting — and the dashboard is the thing you reach for when
 *    something else is broken.
 *  - **It gives us our own compatibility policy**, which we need: this reader
 *    refuses a `list` with no `sessionsUnreadable` where the store's parser
 *    reads it as zero. See `parseList`.
 *
 * So: parse **only the projection this tool needs** — `schema`, `writtenAt`,
 * `attention` — and ignore `register`, `cursor`, `heartbeat` and `usage`
 * entirely. They are not ours, and a field we do not read is a field that
 * cannot break us.
 *
 * The TYPES still come from `wire.ts`, which both sides import, so a required
 * field added to `AttentionItem` is a compile error here as well as there. It
 * is the shape that is shared and the parse that is not — the same split
 * `web/src/types.ts` already makes about the server's own payload.
 *
 * ## THIS FUNCTION MUST NOT THROW, AND THAT IS NOT A STYLE POINT
 *
 * It is called while composing `/api/state`, and `deps.publish()` in refresh.ts
 * sits **outside** the try/catch that guards collection. So a throw out of here
 * escapes `refreshOnce`, ends the refresh loop, and leaves the dashboard
 * sitting there wearing its last good timestamp — the exact silent stall
 * `attemptedAt` was added to expose. Everything, root resolution included, is
 * inside one try/catch, and every path returns an arm.
 *
 * ## Read per request, never cached
 *
 * `statePayload` calls this on every payload. The file is ~10KB and is replaced
 * by atomic rename, so the read is cheap and a reader sees one whole version or
 * the other. Caching it in the refresh loop would put a list regenerated every
 * two minutes on the collection's 55–60s clock and make its age a property of a
 * loop it has nothing to do with.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
} from "./wire.js";

/** The checkpoint's file name, spelled here rather than imported — see the header. */
const CHECKPOINT_FILE = "current.json";

/**
 * **The store schema this reader knows, as a number rather than as "not
 * something else".**
 *
 * The literal, not an import of `STORE_SCHEMA`: importing it is the cycle this
 * whole file exists to avoid, and a shared constant would also let the two ends
 * move together without anybody deciding to.
 *
 * The direction doc's argument for checking it positively is not hypothetical —
 * the bump to 2 happened the day after that paragraph was written, and
 * `statusSince` went from a bare timestamp to a pair. A reader pinned to 1 that
 * accepted anything would have done `Date.parse` on an object and drawn a blank
 * age instead of an error. **An unknown schema renders as *I cannot read this*.**
 */
const KNOWN_SCHEMA = 2;

/**
 * How large a checkpoint we are willing to read into this process.
 *
 * The real one is about 10KB. Atomic rename means a reader never sees a torn
 * file; it does nothing about an enormous one, and this read is synchronous on
 * the event loop that is serving the page. 4 MB is roughly four hundred times
 * the real size and still nothing, so the ceiling only ever fires on something
 * that has already gone wrong.
 */
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;

/**
 * The inbox, or the reason there isn't one. **Never throws.**
 *
 * `root` is for tests. Production resolves it the way the Overseer does, from
 * `OVERSEER_STORE_DIR` or `~/.overseer` — and a relative override is refused
 * rather than resolved against a cwd nobody controls, which is the store's own
 * rule and the reason root resolution is inside the try/catch.
 */
export function readAttention(root?: string): AttentionFeed {
  try {
    const dir = root ?? storeRoot();
    const path = join(dir, CHECKPOINT_FILE);

    let size: number;
    try {
      const stats = statSync(path);
      if (!stats.isFile()) {
        return { kind: "checkpoint-unreadable", why: `${path} is not a file` };
      }
      size = stats.size;
    } catch {
      /* ENOENT is the ordinary case and is not a fault: no checkpoint has been
         published at this path. Any other stat failure lands here too, and
         calling that "absent" would be a claim — but the distinction is not
         recoverable from a thrown errno without guessing, and the arm below is
         the honest one for both: nothing was read here. Anything that gets PAST
         stat and then fails is `checkpoint-unreadable` with the reason. */
      return { kind: "checkpoint-absent" };
    }
    if (size > MAX_CHECKPOINT_BYTES) {
      return {
        kind: "checkpoint-unreadable",
        why: `${path} is ${size} bytes, over the ${MAX_CHECKPOINT_BYTES}-byte ceiling this reader will load`,
      };
    }

    const text = readFileSync(path, "utf8");
    if (text.trim() === "") return { kind: "checkpoint-unreadable", why: `${path} is empty` };

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      return { kind: "checkpoint-unreadable", why: `${path} is not JSON: ${String(cause)}` };
    }
    return readProjection(json);
  } catch (cause) {
    /* The outer net. A relative `OVERSEER_STORE_DIR`, a permissions change, an
       EIO — none of them may reach the refresh loop, because `publish()` is
       outside its try/catch and a throw there stops the dashboard updating
       while it goes on looking current. */
    return { kind: "checkpoint-unreadable", why: `the inbox could not be read: ${String(cause)}` };
  }
}

/**
 * Where the store is, resolved the way the Overseer resolves it.
 *
 * **Throws on a relative override**, matching `storeRoot` in store.ts: an
 * operator has written something that cannot mean what they think it means —
 * it resolves differently for systemd and for a person in a worktree, which is
 * two stores and two histories — and there is no sensible value to carry on
 * with. `readAttention` catches it and says so on the page.
 */
function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OVERSEER_STORE_DIR"];
  if (override === undefined || override.trim() === "") return join(homedir(), ".overseer");
  const trimmed = override.trim();
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `OVERSEER_STORE_DIR must be an absolute path; got ${JSON.stringify(override)}`,
    );
  }
  return trimmed;
}

/* ------------------------------------------------------------------ *
 * The projection: three fields out of a file that has eight.
 * ------------------------------------------------------------------ */

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/** A timestamp that came from `toISOString()`, checked by round trip. */
function iso(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const at = new Date(u);
  return Number.isNaN(at.getTime()) || at.toISOString() !== u ? null : u;
}

function count(u: unknown): number | null {
  return typeof u === "number" && Number.isInteger(u) && u >= 0 ? u : null;
}

function readProjection(json: unknown): AttentionFeed {
  if (!isRecord(json)) return { kind: "checkpoint-unreadable", why: "the checkpoint is not a JSON object" };
  if (json["schema"] !== KNOWN_SCHEMA) {
    return {
      kind: "checkpoint-unreadable",
      why: `the checkpoint says schema ${JSON.stringify(json["schema"])} and this reader knows schema ${KNOWN_SCHEMA}`,
    };
  }
  const writtenAt = iso(json["writtenAt"]);
  if (writtenAt === null) {
    /* Without it there is no clock on the reading, and an inbox with no clock
       is the failure this whole panel is about: a list that stopped being
       produced looks exactly like a calm fleet. Refuse rather than invent one. */
    return { kind: "checkpoint-unreadable", why: "the checkpoint has no readable `writtenAt`, so its age cannot be told" };
  }
  return { kind: "published", list: parseList(json["attention"], writtenAt), coordinatorWrittenAt: writtenAt };
}

/**
 * The list, degrading to `unknown` rather than to empty.
 *
 * Absent, malformed and *nothing needs you* are three different facts and only
 * the third is a claim, so every failure below lands in the arm that carries a
 * reason. The first bad ITEM degrades the whole list for a stronger version of
 * the same argument: an inbox of four out of five says *these are the ones that
 * need you*, and is then wrong about the fifth.
 *
 * **A `list` with no `sessionsUnreadable` is refused, and this is where we part
 * company with the store's parser.** That one comments that a producer which
 * never had the field "made no claim either way" and then returns `0` — but `0`
 * IS a claim, and the strongest one available: that every judgement it
 * attempted succeeded. The whole point of the field is that an incomplete
 * observation may not be read as a negative one. Refusing costs nothing that
 * lasts: the pass runs every two minutes, so the next list carries the field
 * and the page clears itself.
 */
function parseList(u: unknown, writtenAt: string): AttentionList {
  const bad = (why: string): AttentionList => ({
    kind: "unknown",
    why: `the published list was unusable: ${why}`,
    scannedAt: writtenAt,
  });
  if (u === undefined) {
    return {
      kind: "unknown",
      why: "this checkpoint carries no attention list: it was written before the Overseer had one.",
      scannedAt: writtenAt,
    };
  }
  if (!isRecord(u)) return bad("it is not an object");
  const scannedAt = iso(u["scannedAt"]);
  if (scannedAt === null) return bad("scannedAt is not a timestamp this reader can read");

  if (u["kind"] === "unknown") {
    const why = u["why"];
    return typeof why === "string" ? { kind: "unknown", why, scannedAt } : bad("an unknown list with no reason");
  }
  if (u["kind"] !== "list") {
    return bad(`kind ${JSON.stringify(u["kind"])} is neither "list" nor "unknown"`);
  }

  const sessionsScanned = count(u["sessionsScanned"]);
  if (sessionsScanned === null) return bad("sessionsScanned is not a count");
  const sessionsUnreadable = count(u["sessionsUnreadable"]);
  if (sessionsUnreadable === null) {
    return {
      kind: "unknown",
      why:
        "the published list predates the field that says how much of the fleet could not be judged, " +
        "so its completeness cannot be established",
      scannedAt,
    };
  }

  const rawItems = u["items"];
  if (!Array.isArray(rawItems)) return bad("items is not an array");
  const items: AttentionItem[] = [];
  for (const raw of rawItems) {
    const item = parseItem(raw);
    if (item === null) return bad("an item is not one this reader can read");
    items.push(item);
  }
  /* IN THE PRODUCER'S ORDER. It ranks by consequence and then by how long each
     has waited; two halves that both sort are two halves that disagree about
     what is at the top, and the half with the model calls is the one that can
     see why. */
  return { kind: "list", items, sessionsScanned, sessionsUnreadable, scannedAt };
}

const ATTENTION_KINDS: readonly AttentionKind[] = ["irreversible", "product", "technical", "other"];

/** Every field, every arm. `null` on the first mismatch — the list then degrades whole. */
function parseItem(u: unknown): AttentionItem | null {
  if (!isRecord(u)) return null;
  const id = u["id"];
  const sessionId = u["sessionId"];
  const sessionName = u["sessionName"];
  if (typeof id !== "string" || typeof sessionId !== "string" || typeof sessionName !== "string") return null;
  const waitingSince = iso(u["waitingSince"]);
  if (waitingSince === null) return null;
  const kind = ATTENTION_KINDS.find((k) => k === u["kind"]);
  if (kind === undefined) return null;
  const evidence = parseEvidence(u["evidence"]);
  if (evidence === null) return null;
  const answerability = parseAnswerability(u["answerability"]);
  if (answerability === null) return null;
  const rawDuplicates = u["duplicates"];
  if (!Array.isArray(rawDuplicates)) return null;
  const duplicates: { sessionId: string; sessionName: string; waitingSince: string }[] = [];
  for (const d of rawDuplicates) {
    if (!isRecord(d)) return null;
    const dupId = d["sessionId"];
    const dupName = d["sessionName"];
    const dupSince = iso(d["waitingSince"]);
    if (typeof dupId !== "string" || typeof dupName !== "string" || dupSince === null) return null;
    duplicates.push({ sessionId: dupId, sessionName: dupName, waitingSince: dupSince });
  }
  return { id, sessionId, sessionName, waitingSince, kind, evidence, answerability, duplicates };
}

/**
 * The evidence union, both arms in full.
 *
 * **This is the boundary the whole inbox is built to hold.** `dialog` means the
 * harness saw a dialog and enumerated it — observed, mechanical. `prose` means
 * we INFERRED from the tail of a turn, and it may be wrong: the producer's own
 * `readTurnTail` bug quoted Greg's last message back as an agent's question. A
 * `dialog` with no question and no options must not cross wearing the first
 * arm's authority.
 */
function parseEvidence(u: unknown): AttentionEvidence | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "dialog") {
    const question = u["question"];
    const options = u["options"];
    if (typeof question !== "string" || !Array.isArray(options)) return null;
    if (!options.every((o) => typeof o === "string")) return null;
    return { kind: "dialog", question, options: options as string[] };
  }
  if (u["kind"] === "prose") {
    const excerpt = u["excerpt"];
    const why = u["why"];
    if (typeof excerpt !== "string" || typeof why !== "string") return null;
    return { kind: "prose", excerpt, why };
  }
  return null;
}

/** Whether answering from a phone is a real option. */
function parseAnswerability(u: unknown): AttentionAnswerability | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "phone") return { kind: "phone" };
  const why = u["why"];
  if (typeof why !== "string") return null;
  if (u["kind"] === "needs-a-screen") return { kind: "needs-a-screen", why };
  if (u["kind"] === "unknown") return { kind: "unknown", why };
  return null;
}
