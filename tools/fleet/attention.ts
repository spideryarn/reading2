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
 * `attention` — and ignore `cursor` and `usage` entirely. They are not ours,
 * and a field we do not read is a field that cannot break us.
 *
 * **`heartbeat`, `register` and `scheduler` moved out of that sentence on
 * 2026-09-08, into `overseer-status.ts` beside this file**, and the rule is
 * unchanged rather than relaxed: that reader parses those three, arm by arm,
 * with its own compatibility policy, and each of them degrades on its own
 * rather than failing the file. What it shares with this one is the READ —
 * `loadCheckpoint` below — because two reads of a file replaced by atomic
 * rename can straddle a write, and the inbox and the clock beside it must come
 * out of the same bytes.
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
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
  AttentionProposal,
  ProposalAuthor,
  ProposalReach,
  ProposalRecipient,
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
export const KNOWN_SCHEMA = 2;

/**
 * How large a checkpoint we are willing to read into this process.
 *
 * The real one is about 10KB. Atomic rename means a reader never sees a torn
 * file; it does nothing about an enormous one, and this read is synchronous on
 * the event loop that is serving the page. 4 MB is roughly four hundred times
 * the real size and still nothing, so the ceiling only ever fires on something
 * that has already gone wrong.
 *
 * **The ceiling is measured on the descriptor we then read from**, not on the
 * path. `statSync(path)` followed by `readFileSync(path)` opens the file twice,
 * and the writer replaces the path by atomic rename — so a checkpoint that
 * grew past the ceiling could land between the two calls and be read whole,
 * with the check having passed on the file it replaced. One `openSync`, an
 * `fstatSync` of that descriptor, and a read from the same descriptor close it:
 * the bytes measured are the bytes loaded. GPT Sol's C7, 2026-09-08.
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
  const load = loadCheckpoint(root);
  switch (load.kind) {
    case "absent":
      return { kind: "checkpoint-absent" };
    case "unreadable":
      return { kind: "checkpoint-unreadable", why: load.why };
    case "json":
      return projectAttention(load.json);
    default: {
      /* Unreachable, and it RETURNS rather than throws. A `never` check that
         throws is still a throw on the one path this function promises never to
         take — see § THIS FUNCTION MUST NOT THROW. The assignment is what makes
         a fourth arm of `CheckpointLoad` a compile error here; the return is
         what keeps the promise if one arrives at runtime anyway. */
      const never: never = load;
      return { kind: "checkpoint-unreadable", why: `the checkpoint reader returned ${JSON.stringify(never)}` };
    }
  }
}

/**
 * The bytes, once, as JSON — or the reason there are none. **Never throws.**
 *
 * **Split out of `readAttention` so that two projections can share one read**,
 * which is a correctness property and not a saving: `overseer-status.ts` draws
 * the checkpoint's clocks and this file draws the inbox inside it, and two
 * separate reads of a file replaced by atomic rename can land either side of a
 * write. The page would then say *the inbox was scanned at X* beside *the
 * Overseer last wrote at Y* out of two different files, and the pair is
 * precisely what the card is for. `readCheckpointFeeds` in overseer-status.ts
 * is the one composition, and **production goes through it and not through
 * `readAttention`** — which stays as the inbox's own contract, drives
 * tests/fleet-attention.test.ts, and is the thing to reach for if anything ever
 * wants the inbox without the rest.
 *
 * The three arms are what the file system can tell us and nothing more: `json`
 * carries whatever parsed, with no claim about its shape. Deciding what the
 * shape means is each projection's own business, which is how the two get
 * separate compatibility policies — the reason this reader exists at all.
 */
export type CheckpointLoad =
  | { kind: "json"; json: unknown }
  | { kind: "absent" }
  | { kind: "unreadable"; why: string };

export function loadCheckpoint(root?: string): CheckpointLoad {
  try {
    const dir = root ?? storeRoot();
    const path = join(dir, CHECKPOINT_FILE);

    /* **ONLY `ENOENT` ESTABLISHES ABSENCE.** Every open failure used to land in
       `checkpoint-absent`, which turned `EACCES`, `EIO` and `ENAMETOOLONG` into
       the sentence *no checkpoint has been published here* — a positive claim
       about the box manufactured out of a permissions error, and the page then
       says it without a caveat because absence is a fact it trusts. `ENOENT`
       means the file is not there; everything else means **we failed to look**,
       which is the arm that carries a reason. `ENOTDIR` is in the second group
       on purpose: a parent that is not a directory is a misconfigured path, not
       an empty store. GPT Sol's C3, 2026-09-08. */
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch (cause) {
      const code = errnoCode(cause);
      if (code === "ENOENT") return { kind: "absent" };
      return {
        kind: "unreadable",
        why: `${path} could not be opened: ${code ?? String(cause)}`,
      };
    }

    let text: string;
    try {
      /* `fstat` of the descriptor we hold, and the read from that same
         descriptor — see MAX_CHECKPOINT_BYTES. A directory opens successfully
         on Linux, so this is also where "the path is not a file" is caught. */
      const stats = fstatSync(fd);
      if (!stats.isFile()) return { kind: "unreadable", why: `${path} is not a file` };
      if (stats.size > MAX_CHECKPOINT_BYTES) {
        return {
          kind: "unreadable",
          why: `${path} is ${stats.size} bytes, over the ${MAX_CHECKPOINT_BYTES}-byte ceiling this reader will load`,
        };
      }
      text = readFileSync(fd, "utf8");
    } finally {
      /* Swallowed, and only here: by this point the bytes are either read or
         the failure above is already on its way out, so a descriptor that will
         not close is a leak to fix rather than a reason to tell the reader the
         inbox is unreadable. An unswallowed throw in a `finally` would also
         REPLACE the return value above it. */
      try {
        closeSync(fd);
      } catch {
        /* nothing to do about it here */
      }
    }
    if (text.trim() === "") return { kind: "unreadable", why: `${path} is empty` };

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      return { kind: "unreadable", why: `${path} is not JSON: ${String(cause)}` };
    }
    return { kind: "json", json };
  } catch (cause) {
    /* The outer net. A relative `OVERSEER_STORE_DIR`, a permissions change, an
       EIO — none of them may reach the refresh loop, because `publish()` is
       outside its try/catch and a throw there stops the dashboard updating
       while it goes on looking current. */
    return { kind: "unreadable", why: `the checkpoint could not be read: ${String(cause)}` };
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
export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
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

/**
 * The `errno` string off a thrown filesystem error, or `null`.
 *
 * A narrowing rather than a cast: anything can be thrown, and `cause.code` on a
 * non-object is a TypeError inside the one function that is not allowed to
 * throw. Absent means the failure did not come from `node:fs` and cannot be
 * classified, which is the unreadable arm either way.
 */
function errnoCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/* ------------------------------------------------------------------ *
 * The projection: three fields out of a file that has eight.
 * ------------------------------------------------------------------ */

/* **THE FOUR BELOW ARE EXPORTED FOR `overseer-status.ts` AND FOR NOTHING
   ELSE.** There are copies of `nonBlank` and `iso` in store.ts and in
   web/src/types.ts, each with a comment defending itself, and those defences
   are about crossing a boundary: a different process, a different tool, a
   different compatibility policy. `overseer-status.ts` is none of those — it is
   the same reader of the same file, one directory along, sharing this file's
   read — so a fifth copy there would be the simplified one nobody notices is
   wrong. Same rule `lock.ts` came out of `store.ts` under. */
export function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/** A timestamp that came from `toISOString()`, checked by round trip. */
export function iso(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const at = new Date(u);
  return Number.isNaN(at.getTime()) || at.toISOString() !== u ? null : u;
}

export function count(u: unknown): number | null {
  return typeof u === "number" && Number.isInteger(u) && u >= 0 ? u : null;
}

/**
 * A string with something in it. **`""` is not a value, it is a hole.**
 *
 * Every string in this projection is something a person reads off a card — an
 * id it is addressed by, a session's name, the question, the excerpt — and a
 * blank one renders as an empty space under a heading that says we observed
 * something. `{kind: "dialog", question: "", options: []}` passed a
 * `typeof === "string"` check and arrived at the renderer wearing the observed,
 * enumerable arm with nothing in it, which is precisely what wire.ts says must
 * not cross. Whitespace counts as blank: it is indistinguishable on screen.
 * GPT Sol's C4, 2026-09-08. The same helper, same name, is in web/src/types.ts.
 */
export function nonBlank(u: unknown): string | null {
  return typeof u === "string" && u.trim() !== "" ? u : null;
}

/**
 * The inbox out of a checkpoint that has already been read. **Never throws.**
 *
 * Exported so `overseer-status.ts` can project this and the clocks out of one
 * `loadCheckpoint` — see that arm's comment. It takes parsed JSON rather than a
 * path precisely so there is nothing left in it that can touch the disk.
 */
export function projectAttention(json: unknown): AttentionFeed {
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
  /* **A SCAN CANNOT HAVE HAPPENED AFTER THE FILE THAT REPORTS IT WAS WRITTEN.**
     Both timestamps come off ONE clock — the Overseer stamps `scannedAt` when
     the pass runs and `writtenAt` when it checkpoints, in the same process — so
     this pair is not subject to any skew and there is nothing to tolerate: a
     `scannedAt` in the future of its own checkpoint is a corrupt or hand-edited
     file. It matters because the page's staleness check is `now − scannedAt`,
     and a future timestamp reads as "0s ago" for as long as it stays in the
     future, which suppresses the staleness branch and leaves an empty list
     looking permanently calm. Equal is ordinary: the store's `attentionNotYetRun`
     stamps a not-yet-run list with the checkpoint's own instant.
     GPT Sol's C2, 2026-09-08 — the server half. The client cannot make this
     check against ITS clock, and ageMs in AttentionPanel.tsx says why. */
  if (Date.parse(scannedAt) > Date.parse(writtenAt)) {
    return bad(`it was scanned at ${scannedAt}, after the ${writtenAt} checkpoint that carries it`);
  }

  if (u["kind"] === "unknown") {
    /* **`nonBlank`, NOT `typeof === "string"`, and this arm is the one that
       cannot afford it.** The `why` is not a field beside the content — it IS
       the content: the panel renders "no ranked list: {why}" and has nothing
       else to draw. A blank one produced a sentence that stops at its colon,
       which reads as the page being broken rather than as the coordinator not
       having judged. GPT Sol's C4, extended by the implementer's own report to
       the two fields the brief's list had missed. */
    const why = nonBlank(u["why"]);
    return why === null ? bad("an unknown list with no reason") : { kind: "unknown", why, scannedAt };
  }
  /* `limited` (plan 260910f D6) is parsed as strictly as `list` — the same
     fields, plus `stopped`. It is a KIND rather than a field on `list` because
     of the branch below: an older copy of this reader rejects an unknown kind
     into `unknown`, whereas a new field would have been ignored and an empty
     list from a stopped judge drawn as a calm fleet. */
  const kind = u["kind"];
  if (kind !== "list" && kind !== "limited") {
    return bad(`kind ${JSON.stringify(kind)} is none of "list", "limited" or "unknown"`);
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
  /* **MORE FAILURES THAN ATTEMPTS IS CORRUPTION, NOT A READING.**
     `sessionsUnreadable` counts sessions the pass TRIED to judge and could not,
     so it is a subset of `sessionsScanned` by construction and a producer that
     reports otherwise is not reporting. It has to be refused rather than
     clamped, because the page subtracts one from the other to say how many were
     judged, and a negative there would be printed. GPT Sol's C1, 2026-09-08. */
  if (sessionsUnreadable > sessionsScanned) {
    return bad(
      `it says ${sessionsUnreadable} of ${sessionsScanned} sessions could not be judged, which is more than it scanned`,
    );
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
  if (kind === "list") return { kind: "list", items, sessionsScanned, sessionsUnreadable, scannedAt };
  const stopped = parseStopped(u["stopped"]);
  if (stopped === null) return bad("a limited list does not say why the model was stopped, or until when");
  return { kind: "limited", items, sessionsScanned, sessionsUnreadable, scannedAt, stopped };
}

/** Every field, `nonBlank` for the `why` because the page draws it as the whole line. */
function parseStopped(u: unknown): Extract<AttentionList, { kind: "limited" }>["stopped"] | null {
  if (!isRecord(u)) return null;
  const kind = u["kind"];
  if (kind !== "exhausted" && kind !== "cooling-down") return null;
  const why = nonBlank(u["why"]);
  const until = iso(u["until"]);
  return why === null || until === null ? null : { kind, why, until };
}

const ATTENTION_KINDS: readonly AttentionKind[] = ["irreversible", "product", "technical", "other"];

/** Every field, every arm. `null` on the first mismatch — the list then degrades whole. */
function parseItem(u: unknown): AttentionItem | null {
  if (!isRecord(u)) return null;
  const id = nonBlank(u["id"]);
  const sessionId = nonBlank(u["sessionId"]);
  const sessionName = nonBlank(u["sessionName"]);
  if (id === null || sessionId === null || sessionName === null) return null;
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
    const dupId = nonBlank(d["sessionId"]);
    const dupName = nonBlank(d["sessionName"]);
    const dupSince = iso(d["waitingSince"]);
    if (dupId === null || dupName === null || dupSince === null) return null;
    duplicates.push({ sessionId: dupId, sessionName: dupName, waitingSince: dupSince });
  }
  const proposal = parseProposal(u["proposal"]);
  if (proposal === null) return null;
  // THE QUOTE IS IN THIS ITEM'S OWN EXCERPT — GPT Sol's F15. The card labels it
  // "the sentence this proposal is about", so one the excerpt does not hold is
  // an invented sentence wearing the label. A dialog has no excerpt to hold one.
  if (proposal.kind === "proposed" && !(evidence.kind === "prose" && quotedIn(proposal.asks, evidence.excerpt))) return null;
  return { id, sessionId, sessionName, waitingSince, kind, evidence, answerability, duplicates, proposal };
}

/**
 * A quote, checked as the producer checks it — RESTATED from
 * tools/overseer/attention-classify.ts (`normaliseSpace`, `MAX_ASKS_CHARS`,
 * `MIN_ASKS_CHARS`, `MIN_ASKS_WORDS`, whose comments say why each value), which
 * this module may not import (see the header). tests/fleet-attention.test.ts
 * drives the bounds from those constants, so a copy that drifts goes red.
 */
function normaliseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
const MAX_ASKS_CHARS = 300;
const MIN_ASKS_CHARS = 12;
const MIN_ASKS_WORDS = 2;

function asksInBounds(asks: string): boolean {
  const s = normaliseSpace(asks);
  return s.length <= MAX_ASKS_CHARS && s.length >= MIN_ASKS_CHARS && s.split(" ").length >= MIN_ASKS_WORDS;
}

function quotedIn(asks: string, text: string): boolean {
  return normaliseSpace(text).includes(normaliseSpace(asks));
}

const PROPOSAL_RECIPIENTS: readonly ProposalRecipient[] = ["sol", "fable", "greg", "overseer", "self"];

/**
 * An item's proposal, every arm in full (plan 260910f Stage 2).
 *
 * **ABSENT IS `not-reported`, NOT A FAILURE**: a checkpoint from an Overseer
 * that predates the field made no claim, and degrading the whole list over it
 * would blank a live inbox until the daemon restarts. Present and malformed is
 * refused like every other field — a half-read proposal would draw a holder
 * nobody proposed, or an attribution nobody made. `nonBlank` for every text,
 * because each is drawn as a line of its own.
 */
function parseProposal(u: unknown): AttentionProposal | null {
  if (u === undefined) return { kind: "not-reported" };
  if (!isRecord(u)) return null;
  switch (u["kind"]) {
    case "proposed": {
      const id = nonBlank(u["id"]);
      const recipient = PROPOSAL_RECIPIENTS.find((r) => r === u["recipient"]);
      const reason = nonBlank(u["reason"]);
      const asks = nonBlank(u["asks"]);
      const by = parseProposalAuthor(u["by"]);
      const reach = parseProposalReach(u["reach"]);
      if (id === null || recipient === undefined || reason === null || asks === null || by === null || reach === null) return null;
      // Inside the producer's length bounds (F17), or the card could draw a whole tail in the flow.
      if (!asksInBounds(asks)) return null;
      return { kind: "proposed", id, recipient, reason, asks, by, reach };
    }
    case "unplaced": {
      const id = nonBlank(u["id"]);
      const why = nonBlank(u["why"]);
      const by = parseProposalAuthor(u["by"]);
      return id === null || why === null || by === null ? null : { kind: "unplaced", id, why, by };
    }
    case "off":
    case "not-reached": {
      const why = nonBlank(u["why"]);
      return why === null ? null : { kind: u["kind"], why };
    }
    case "not-applicable":
      return { kind: "not-applicable" };
    case "not-reported":
      return { kind: "not-reported" };
    default:
      return null;
  }
}

/** The wire's one author arm: a model, via the Overseer. A person is never an author (D9). */
function parseProposalAuthor(u: unknown): ProposalAuthor | null {
  if (!isRecord(u) || u["kind"] !== "model" || u["via"] !== "overseer") return null;
  const model = nonBlank(u["model"]);
  return model === null ? null : { kind: "model", model, via: "overseer" };
}

function parseProposalReach(u: unknown): ProposalReach | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "available") return { kind: "available" };
  const why = nonBlank(u["why"]);
  if (why === null) return null;
  if (u["kind"] === "unavailable") return { kind: "unavailable", why };
  if (u["kind"] === "not-checked") return { kind: "not-checked", why };
  return null;
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
    /* **NON-BLANK, not merely a string.** An option labelled `""` is a button
       with no words on it and a question of `""` is a heading with nothing
       under it — both arrive as something the harness is said to have SEEN and
       enumerated. See `nonBlank` above. */
    const question = nonBlank(u["question"]);
    const options = u["options"];
    if (question === null || !Array.isArray(options)) return null;
    if (!options.every((o) => nonBlank(o) !== null)) return null;
    return { kind: "dialog", question, options: options as string[] };
  }
  if (u["kind"] === "prose") {
    const excerpt = nonBlank(u["excerpt"]);
    const why = nonBlank(u["why"]);
    if (excerpt === null || why === null) return null;
    return { kind: "prose", excerpt, why };
  }
  return null;
}

/** Whether answering from a phone is a real option. */
function parseAnswerability(u: unknown): AttentionAnswerability | null {
  if (!isRecord(u)) return null;
  if (u["kind"] === "phone") return { kind: "phone" };
  /* Both arms that carry a `why` carry NOTHING ELSE, so a blank one puts an
     empty explanation on a card and leaves a reader worse off than the arm
     being absent. `nonBlank`, for the reason the list's own `why` uses it. */
  const why = nonBlank(u["why"]);
  if (why === null) return null;
  if (u["kind"] === "needs-a-screen") return { kind: "needs-a-screen", why };
  if (u["kind"] === "unknown") return { kind: "unknown", why };
  return null;
}
