/**
 * **IS SUPERVISION STILL WORKING?** — the fleet-owned reading of the Overseer's
 * own state, out of `~/.overseer/current.json`.
 *
 * The page could not say *the Overseer last wrote 12 minutes ago; its fleet
 * source last updated 15 minutes ago* until this file existed. It could not
 * tell a dead daemon from a deaf one either, and those are the two failures the
 * direction doc names:
 *
 * > **A dead dashboard is a fact the Overseer records, not a silence it sits
 * > in.** […] the thing that must therefore never be allowed to look healthy is
 * > a daemon ticking against an empty stream — which is exactly what the two
 * > clocks are for, and exactly what a watchdog reading only the heartbeat
 * > would bless.
 * >
 * > — docs/project/overseer-direction.md § Two tenses
 *
 * ## Why it is here and not an import of the Overseer's parser
 *
 * The whole of attention.ts's header applies unchanged, and it is worth not
 * re-deriving: **the file is the contract; the function is one implementation
 * of reading it.** `tools/overseer/` imports `collect.ts` and `status.ts` from
 * this directory, so a `tools/fleet/` that imported `readCheckpoint` would
 * close the cycle the seam exists to prevent — and would drag the store's
 * usage, memory, diff, lock and log modules into the one process you reach for
 * when something else is broken. It would also fail this whole reading on one
 * malformed register entry, which is the opposite of what this file does.
 *
 * ## The split this file makes, which attention.ts does not have to
 *
 * **The two clocks are the card. Everything else sits beside it.**
 *
 *  - `writtenAt` and `lastGoodSnapshotAt` are what the card exists to say, and
 *    a reading missing either is not a degraded card, it is no card: refusing
 *    the projection whole (`checkpoint-unreadable`) is the honest outcome, and
 *    the fleet rows are untouched by it.
 *  - `heartbeat`, `scheduler` and `register` each degrade on their own. A
 *    `scheduler.kind` this build has never seen is *I cannot read this part*
 *    and not an error for the whole card — asked for by the scheduler stage
 *    (260908g), whose Stage 3c may widen that discriminant, and right anyway:
 *    the same rule `parseStatus` follows for a session status it does not know.
 *
 * ## And the schema is refused positively
 *
 * `KNOWN_SCHEMA` is attention.ts's, imported rather than re-declared, because a
 * second copy is two policies that can drift and this reader has no reason to
 * want its own. **The live case is not hypothetical**: the checkpoint on the
 * box read schema 1 on 2026-09-08 against a checked-in `STORE_SCHEMA` of 2, so
 * `unsupported-schema` is the arm production renders first. Coercing a schema-1
 * file into this shape would draw `NaN` for every duration, because that is the
 * version where `statusSince` was a bare timestamp rather than a pair.
 *
 * ## No cache, and that is a decision rather than an omission
 *
 * The checkpoint is ~10KB, replaced by atomic rename, and read once per
 * payload — the same clock the inbox is already on. Nothing here reads
 * `events.jsonl`, which is the scan a request must never do (161 KB and
 * growing). A cache keyed on file metadata would buy a syscall and cost the
 * page the one property it is built on: that the ages on it are as old as the
 * request and not as old as some other loop. attention.ts § Read per request.
 */
import {
  count,
  isRecord,
  iso,
  KNOWN_SCHEMA,
  loadCheckpoint,
  nonBlank,
  projectAttention,
} from "./attention.js";
import { projectUsage } from "./usage-feed.js";
import type {
  AttentionFeed,
  OverseerHeartbeat,
  OverseerRegister,
  OverseerRegisterWork,
  OverseerScheduler,
  OverseerSessionHistory,
  OverseerStatusFeed,
  PaneJob,
  PaneWork,
  UsageFeed,
} from "./wire.js";

/**
 * How many register entries cross the wire.
 *
 * The register can hold every session on the box — thirty-six on 2026-09-08 —
 * and this is a card that answers *is supervision working*, not a second
 * session list. Eight is the oldest eight status records worth showing, which
 * is where anything worth acting on will be, and `OverseerRegister.total`
 * carries the whole count beside them so eight of thirty-six never reads as
 * thirty-six.
 *
 * The daemon's own `overseer status` prints six, for the same reason and
 * against the same register. Two is not worth trying to share across the seam.
 */
const MAX_HISTORY = 8;

/**
 * **THE LONGEST SOURCE DEADLINE THIS READER WILL PASS ON**, in milliseconds.
 *
 * The daemon's own `snapshotStaleAfterMs` is preferred over a restated constant
 * — the two ends drifted once at exactly this number — but an unbounded value
 * taken on trust is a way to make a dead source look healthy for ever: a
 * `lastGoodSnapshotAt` from 2020 with a deadline of `1e300` is a card that says
 * *supervision is running*. GPT Sol's P1, 2026-09-08.
 *
 * An hour is twelve times the documented normal (five missed 60-second
 * collections), so past it we are looking at a bug or a hand-edited file rather
 * than a cadence change. Over the ceiling the field becomes `null` — *the daemon
 * did not say* — and the page falls back to its own deadline and names it. The
 * card is not failed over it: the two clocks are still readable, and they are
 * the thing worth showing.
 */
const MAX_SOURCE_STALE_MS = 60 * 60_000;

/**
 * The status this build can read, or the reason there is none.
 *
 * **It cannot throw for anything `JSON.parse` can produce**, which is the whole
 * of what production hands it — and that is the honest form of the promise. It
 * matters because this is composed into `/api/state` alongside the inbox, and
 * `deps.publish()` in refresh.ts sits OUTSIDE the try/catch that guards
 * collection: a throw from here ends the refresh loop and leaves the page
 * wearing its last good timestamp.
 *
 * The catch below makes that true even for a cyclic object or a `bigint`, which
 * `JSON.stringify` refuses. It is **not** an unconditional promise for every
 * value of type `unknown`: a hostile Proxy whose property access throws an
 * object whose `String()` also throws escapes it, and hardening against that
 * would be machinery guarding a case no file can contain. GPT Sol's P2, both
 * rounds, 2026-09-08 — the first version of this comment claimed the
 * unconditional form.
 *
 * It takes parsed JSON rather than a path: there is nothing in it that touches
 * the disk, so there is nothing in it that can throw an `EIO`.
 */
export function projectOverseerStatus(json: unknown): OverseerStatusFeed {
  try {
    return project(json);
  } catch (cause) {
    /* **THE NET, AND IT IS NOT DECORATION.** This function's signature says
       `unknown`, and the guarantee above says it never throws — but `describe()`
       below can be handed a value `JSON.stringify` refuses (a cyclic object, a
       bigint), and a throw here ends the refresh loop rather than failing one
       card. Production reaches this only through `JSON.parse`, so no real
       checkpoint can contain such a value; the contract still has to hold for
       the callers that do not know that. GPT Sol's P2, 2026-09-08. */
    return { kind: "checkpoint-unreadable", why: `the checkpoint could not be projected: ${String(cause)}` };
  }
}

function project(json: unknown): OverseerStatusFeed {
  if (!isRecord(json)) {
    return { kind: "checkpoint-unreadable", why: "the checkpoint is not a JSON object" };
  }
  if (json["schema"] !== KNOWN_SCHEMA) {
    /* THE VERSION IS NAMED, both halves of it, because this is the one failure
       with an action attached: somebody deploys the other end. */
    return { kind: "unsupported-schema", saw: describe(json["schema"]), known: KNOWN_SCHEMA };
  }
  const writtenAt = iso(json["writtenAt"]);
  if (writtenAt === null) {
    return {
      kind: "checkpoint-unreadable",
      why: "the checkpoint has no readable `writtenAt`, so there is no clock on anything in it",
    };
  }

  /* **`null` IS A READING AND ABSENT IS NOT.** `lastGoodSnapshotAt: null` means
     the Overseer has accepted no snapshot since it started — the deaf case in
     its purest form, and the card says so. A field that is simply MISSING is a
     producer this reader does not understand, and treating that as "never
     accepted one" would manufacture the alarming reading out of an unreadable
     file. Schema 2 always writes the field. */
  const rawSource = json["lastGoodSnapshotAt"];
  let lastGoodSnapshotAt: string | null;
  if (rawSource === null) {
    lastGoodSnapshotAt = null;
  } else {
    const at = iso(rawSource);
    if (at === null) {
      return {
        kind: "checkpoint-unreadable",
        why: "the checkpoint's `lastGoodSnapshotAt` is neither a timestamp nor null, so the source clock cannot be read",
      };
    }
    /* THE SOURCE CANNOT HAVE BEEN HEARD AFTER THE FILE THAT REPORTS IT WAS
       WRITTEN. Both come off one clock in one process — the Overseer stamps
       `writtenAt` as it writes the snapshot's own `collectedAt` — so there is no
       skew to tolerate here, and a source clock in the future of its checkpoint
       would read as "0s ago" for as long as the fault lasted, suppressing the
       stale-source warning this card exists to raise. The same check
       attention.ts makes on `scannedAt`. */
    if (Date.parse(at) > Date.parse(writtenAt)) {
      return {
        kind: "checkpoint-unreadable",
        why: `the checkpoint says it last heard from the fleet at ${at}, after the ${writtenAt} checkpoint that reports it`,
      };
    }
    lastGoodSnapshotAt = at;
  }

  /* THE DAEMON'S OWN DEADLINE — said, not said, or wrong. The third fails the
     reading: it is part of the health judgement, not a decoration on it. See
     `sourceDeadline`. */
  const deadline = sourceDeadline(json["snapshotStaleAfterMs"]);
  if (deadline.kind === "bad") return { kind: "checkpoint-unreadable", why: deadline.why };
  const work = resolveWork(json["work"], lastGoodSnapshotAt, writtenAt);

  return {
    kind: "published",
    status: {
      schema: KNOWN_SCHEMA,
      writtenAt,
      lastGoodSnapshotAt,
      sourceStaleAfterMs: deadline.kind === "said" ? deadline.ms : null,
      heartbeat: projectHeartbeat(json["heartbeat"], writtenAt),
      scheduler: projectScheduler(json["scheduler"]),
      register: projectRegister(json["register"], writtenAt, work),
    },
  };
}

/**
 * All three projections out of ONE read of the file.
 *
 * **The sharing is a correctness property, not a saving.** The checkpoint is
 * replaced by atomic rename, so two separate reads can land either side of a
 * write and the page would then print *the inbox was scanned at X* beside *the
 * Overseer last wrote at Y* out of two different versions of the file — and the
 * relationship between those two numbers is the whole of what the card claims.
 * One read, three projections, each with its own compatibility policy.
 *
 * **`usage` joined them on 2026-09-08 and made the argument stronger rather
 * than merely longer.** The usage card's central sentence is *the Overseer
 * wrote thirty seconds ago and this headroom reading is two hours old* — the
 * two clocks in one line, which cannot be assembled honestly out of two reads.
 * `tools/fleet/usage-feed.ts` § the edge that did not exist.
 *
 * `root` is for tests; production resolves it the way the Overseer does.
 * **Never throws**, because `loadCheckpoint` does not and no projection
 * touches anything but the value it is handed.
 */
export type CheckpointFeeds = { attention: AttentionFeed; overseer: OverseerStatusFeed; usage: UsageFeed };

export function readCheckpointFeeds(root?: string): CheckpointFeeds {
  const load = loadCheckpoint(root);
  switch (load.kind) {
    case "absent":
      return {
        attention: { kind: "checkpoint-absent" },
        overseer: { kind: "checkpoint-absent" },
        usage: { kind: "checkpoint-absent" },
      };
    case "unreadable":
      return {
        attention: { kind: "checkpoint-unreadable", why: load.why },
        overseer: { kind: "checkpoint-unreadable", why: load.why },
        usage: { kind: "checkpoint-unreadable", why: load.why },
      };
    case "json":
      return {
        attention: projectAttention(load.json),
        overseer: projectOverseerStatus(load.json),
        usage: projectUsage(load.json),
      };
    default: {
      /* Unreachable; returns rather than throws, for the reason `readAttention`
         does. The assignment is what makes a fourth arm a compile error. */
      const never: never = load;
      const why = `the checkpoint reader returned ${JSON.stringify(never)}`;
      return {
        attention: { kind: "checkpoint-unreadable", why },
        overseer: { kind: "checkpoint-unreadable", why },
        usage: { kind: "checkpoint-unreadable", why },
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * The three parts that degrade on their own.
 * ------------------------------------------------------------------ */

/**
 * The daemon's own deadline — **and an invalid one is not a missing one.**
 *
 * Absent or `null` is a producer that did not say, which an older daemon
 * legitimately is: the page falls back to its own deadline and names it. A
 * value that is THERE and cannot be a deadline — a string, a zero, an hour and
 * one millisecond, `1e300` — is a file whose health metadata is wrong, and the
 * deadline is part of the health judgement rather than a decoration on it. So
 * that fails the reading, the way an unreadable `writtenAt` does.
 *
 * Collapsing the two into `null` closed the *healthy for ever* case and left the
 * boundary blurred: a fresh write with a four-minute-old source and a deadline
 * of `3_600_001` would have read as *supervision is running* off a number
 * nobody could have meant. GPT Sol's P1 in round two, 2026-09-08.
 */
type SourceDeadline = { kind: "said"; ms: number } | { kind: "not-said" } | { kind: "bad"; why: string };

function sourceDeadline(u: unknown): SourceDeadline {
  if (u === undefined || u === null) return { kind: "not-said" };
  if (typeof u !== "number" || !Number.isFinite(u)) {
    return { kind: "bad", why: `the checkpoint's \`snapshotStaleAfterMs\` is ${describe(u)}, which is not a duration` };
  }
  if (u <= 0 || u > MAX_SOURCE_STALE_MS) {
    return {
      kind: "bad",
      why: `the checkpoint's \`snapshotStaleAfterMs\` is ${u}ms, outside the 1…${MAX_SOURCE_STALE_MS}ms range a daemon could mean`,
    };
  }
  return { kind: "said", ms: u };
}

/**
 * A value named for a person, bounded, and **without throwing**.
 *
 * `JSON.stringify` is the obvious way to spell this and it throws on a cyclic
 * object and on a `bigint` — inside the one function that promises not to. It
 * is still the right renderer for the values that survive `JSON.parse`, so it
 * is used and caught rather than replaced with something that quotes `"1"` and
 * `1` identically.
 */
function describe(u: unknown): string {
  if (u === undefined) return "no schema at all";
  try {
    return JSON.stringify(u) ?? String(u);
  } catch {
    return `a value this reader cannot print (${typeof u})`;
  }
}

/**
 * The daemon's own facts: which process, since when, how many ticks.
 *
 * **A stopped heartbeat is not a missing one.** A daemon that has died leaves
 * its last `lastTickAt` in the file and the page ages it; a daemon that has
 * just started has `lastTickAt: null` and nothing to age. Both are readings,
 * and only a field this build cannot parse is `unreadable`.
 *
 * `ticks` is carried because it separates *started and immediately wedged* from
 * *ran for a day and stopped*, which look identical through one timestamp.
 */
function projectHeartbeat(u: unknown, writtenAt: string): OverseerHeartbeat {
  const bad = (why: string): OverseerHeartbeat => ({ kind: "unreadable", why });
  if (u === undefined) return bad("this checkpoint carries no heartbeat");
  if (!isRecord(u)) return bad("the heartbeat is not an object");
  const pid = count(u["pid"]);
  if (pid === null || pid === 0) return bad("the heartbeat has no readable pid");
  const instanceId = nonBlank(u["instanceId"]);
  if (instanceId === null) return bad("the heartbeat has no instance id");
  const startedAt = iso(u["startedAt"]);
  if (startedAt === null) return bad("the heartbeat has no readable start time");
  const ticks = count(u["ticks"]);
  if (ticks === null) return bad("the heartbeat has no readable tick count");
  const rawTick = u["lastTickAt"];
  let lastTickAt: string | null;
  if (rawTick === null) {
    lastTickAt = null;
  } else {
    lastTickAt = iso(rawTick);
    if (lastTickAt === null) return bad("the heartbeat's last tick is neither a timestamp nor null");
  }
  /* ONE CLOCK, AGAIN. The daemon stamps its tick and then writes the file, in
     that order and in one process, so either timestamp ahead of `writtenAt` is
     a corrupt or hand-edited file — and an age computed from it would render as
     freshly ticking for exactly as long as the fault lasted. */
  if (Date.parse(startedAt) > Date.parse(writtenAt)) {
    return bad(`the heartbeat says it started at ${startedAt}, after the ${writtenAt} checkpoint it wrote`);
  }
  if (lastTickAt !== null && Date.parse(lastTickAt) > Date.parse(writtenAt)) {
    return bad(`the heartbeat's last tick is ${lastTickAt}, after the ${writtenAt} checkpoint that reports it`);
  }
  return { kind: "reading", pid, instanceId, startedAt, lastTickAt, ticks };
}

/**
 * Whether the scheduler is switched on, in the daemon's own words.
 *
 * **The default arm is the whole reason this is a function.** 260908g's Stage
 * 3c may widen `StoredScheduler`'s discriminant, and a `kind` this build has
 * never seen must land as *I cannot read this part* — never as `off`, which
 * would say the scheduler is disarmed about a scheduler that is running, and
 * never as a failure of the card around it.
 *
 * An ABSENT field is `unreadable` too, and deliberately not `not-said`: that
 * arm is the daemon saying *nobody has decided*, which is a claim with a clock
 * on it, and a checkpoint written before the field existed made no claim at
 * all. The distinction `StoredScheduler`'s own three arms are built on.
 */
function projectScheduler(u: unknown): OverseerScheduler {
  const bad = (why: string): OverseerScheduler => ({ kind: "unreadable", why });
  if (u === undefined) {
    return bad("this checkpoint carries no scheduler line: it was written before the Overseer had one");
  }
  if (!isRecord(u)) return bad("the scheduler line is not an object");
  const why = nonBlank(u["why"]);
  const at = iso(u["at"]);
  if (why === null || at === null) return bad("the scheduler line has no reason or no readable time on it");
  switch (u["kind"]) {
    case "armed":
      return { kind: "armed", why, at };
    case "blocked":
      // GPT Sol's S8-7, arriving here as the arm the comment above predicted.
      // NOT folded into `armed` or `off`: it is the switch on with nothing
      // runnable, which is the state that used to be reported as `armed`.
      return { kind: "blocked", why, at };
    case "off":
      return { kind: "off", why, at };
    case "unknown":
      /* The store's `unknown` — no daemon in that build ever said. Renamed on
         this side so it cannot be read as *we could not tell*. See wire.ts. */
      return { kind: "not-said", why, at };
    default:
      return bad(`this page does not know the scheduler state ${describe(u["kind"] ?? null)}`);
  }
}

type ResolvedWork =
  | { kind: "scanned"; scannedAt: string; panes: ReadonlyMap<string, PaneWork> }
  | { kind: "unavailable"; why: string };

/** `ps etimes` gives whole seconds, so its derived start and duration may differ by one second. */
const PROCESS_START_TOLERANCE_MS = 1_000;

/**
 * The work reading that belongs to this exact inventory, or one sentence saying
 * why no join may be drawn. A bad enrichment never takes the register down.
 */
function resolveWork(u: unknown, lastGoodSnapshotAt: string | null, writtenAt: string): ResolvedWork {
  const malformed = (): ResolvedWork => ({
    kind: "unavailable",
    why: "the checkpoint's work scan could not be read",
  });
  if (u === undefined) {
    return {
      kind: "unavailable",
      why: "this checkpoint was written before the Overseer recorded work scans",
    };
  }
  if (!isRecord(u)) return malformed();

  switch (u["kind"]) {
    case "not-yet-run": {
      const why = nonBlank(u["why"]);
      const at = iso(u["at"]);
      return why === null || at === null ? malformed() : { kind: "unavailable", why };
    }
    case "probe-failed": {
      const why = nonBlank(u["why"]);
      const attemptedAt = iso(u["attemptedAt"]);
      const sourceCollectedAt = iso(u["sourceCollectedAt"]);
      if (why === null || attemptedAt === null || sourceCollectedAt === null) return malformed();
      if (lastGoodSnapshotAt === null) {
        return {
          kind: "unavailable",
          why: `the failed work probe belongs to the ${sourceCollectedAt} inventory, but the register has no accepted inventory to match it to`,
        };
      }
      if (sourceCollectedAt !== lastGoodSnapshotAt) {
        return {
          kind: "unavailable",
          why: `the failed work probe belongs to the ${sourceCollectedAt} inventory, not the register's ${lastGoodSnapshotAt} inventory`,
        };
      }
      if (Date.parse(attemptedAt) < Date.parse(sourceCollectedAt) || Date.parse(attemptedAt) > Date.parse(writtenAt)) {
        return malformed();
      }
      return { kind: "unavailable", why };
    }
    case "scan": {
      const scannedAt = iso(u["scannedAt"]);
      const sourceCollectedAt = iso(u["sourceCollectedAt"]);
      if (scannedAt === null || sourceCollectedAt === null || !Array.isArray(u["panes"])) return malformed();

      if (lastGoodSnapshotAt === null) {
        return {
          kind: "unavailable",
          why: `the work scan belongs to the ${sourceCollectedAt} inventory, but the register has no accepted inventory to match it to`,
        };
      }
      if (sourceCollectedAt !== lastGoodSnapshotAt) {
        return {
          kind: "unavailable",
          why: `the work scan belongs to the ${sourceCollectedAt} inventory, not the register's ${lastGoodSnapshotAt} inventory`,
        };
      }
      if (Date.parse(scannedAt) < Date.parse(sourceCollectedAt)) {
        return {
          kind: "unavailable",
          why: `the work scan says it read the process table at ${scannedAt}, before the ${sourceCollectedAt} inventory it claims to describe was collected`,
        };
      }
      if (Date.parse(scannedAt) > Date.parse(writtenAt)) {
        return {
          kind: "unavailable",
          why: `the work scan says it read the process table at ${scannedAt}, after the ${writtenAt} checkpoint that reports it`,
        };
      }

      const panes = new Map<string, PaneWork>();
      for (const rawPane of u["panes"]) {
        if (!isRecord(rawPane)) return malformed();
        const key = nonBlank(rawPane["key"]);
        const paneWork = parsePaneWork(rawPane["work"]);
        if (
          key === null ||
          paneWork === null ||
          !paneWorkFitsScan(paneWork, Date.parse(scannedAt)) ||
          panes.has(key)
        ) return malformed();
        panes.set(key, paneWork);
      }

      return { kind: "scanned", scannedAt, panes };
    }
    default:
      return malformed();
  }
}

/** Producer invariants which the wire type cannot express. */
function paneWorkFitsScan(work: PaneWork, scannedAtMs: number): boolean {
  if (work.kind === "cannot-tell") return true;
  const paneStartedAtMs = Date.parse(work.paneStartedAt);
  if (paneStartedAtMs > scannedAtMs) return false;
  if (work.kind === "none") return true;
  if (work.inspected < work.jobs.length) return false;
  const pids = new Set<number>();
  return work.jobs.every((job) => {
    if (job.depth === 0 || job.depth > work.inspected || pids.has(job.pid)) return false;
    pids.add(job.pid);
    if (job.startedAt === null) return job.ranForMs === null;
    const startedAtMs = Date.parse(job.startedAt);
    return startedAtMs >= paneStartedAtMs &&
      startedAtMs <= scannedAtMs &&
      job.ranForMs !== null &&
      Math.abs(scannedAtMs - startedAtMs - job.ranForMs) <= PROCESS_START_TOLERANCE_MS;
  });
}

function parsePaneWork(u: unknown): PaneWork | null {
  if (!isRecord(u)) return null;
  switch (u["kind"]) {
    case "cannot-tell": {
      const cause = nonBlank(u["cause"]);
      const why = nonBlank(u["why"]);
      return cause === null || why === null ? null : { kind: "cannot-tell", cause, why };
    }
    case "none": {
      const inspected = count(u["inspected"]);
      const paneCommand = nonBlank(u["paneCommand"]);
      const paneStartedAt = iso(u["paneStartedAt"]);
      return inspected === null || paneCommand === null || paneStartedAt === null
        ? null
        : { kind: "none", inspected, paneCommand, paneStartedAt };
    }
    case "work": {
      const inspected = count(u["inspected"]);
      const paneCommand = nonBlank(u["paneCommand"]);
      const paneStartedAt = iso(u["paneStartedAt"]);
      if (
        inspected === null ||
        paneCommand === null ||
        paneStartedAt === null ||
        !Array.isArray(u["jobs"]) ||
        u["jobs"].length === 0
      ) {
        return null;
      }
      const jobs: PaneJob[] = [];
      for (const rawJob of u["jobs"]) {
        const job = parsePaneJob(rawJob);
        if (job === null) return null;
        jobs.push(job);
      }
      const [first, ...rest] = jobs;
      if (first === undefined) return null;
      return { kind: "work", jobs: [first, ...rest], inspected, paneCommand, paneStartedAt };
    }
    default:
      return null;
  }
}

function parsePaneJob(u: unknown): PaneJob | null {
  if (!isRecord(u)) return null;
  const recogniser = nonBlank(u["recogniser"]);
  const label = nonBlank(u["label"]);
  const pid = count(u["pid"]);
  const depth = count(u["depth"]);
  const command = nonBlank(u["command"]);
  if (recogniser === null || label === null || pid === null || pid === 0 || depth === null || command === null) {
    return null;
  }

  let startedAt: string | null;
  if (u["startedAt"] === null) {
    startedAt = null;
  } else {
    const parsed = iso(u["startedAt"]);
    if (parsed === null) return null;
    startedAt = parsed;
  }

  let ranForMs: number | null;
  if (u["ranForMs"] === null) {
    ranForMs = null;
  } else {
    const parsed = count(u["ranForMs"]);
    if (parsed === null) return null;
    ranForMs = parsed;
  }

  return { recogniser, label, startedAt, ranForMs, pid, depth, command };
}

function registerWork(work: ResolvedWork): OverseerRegisterWork {
  return work.kind === "scanned"
    ? { kind: "scanned", scannedAt: work.scannedAt }
    : { kind: "unavailable", why: work.why };
}

/**
 * The register, ranked and capped — **the Overseer's history, and not a join
 * to the live fleet rows.**
 *
 * These are the oldest status records worth showing: non-idle sessions, idle
 * sessions with recognised child work, and idle sessions for which a scan
 * could not supply a usable pane reading. The last group is load-bearing: if
 * it were filtered out, an unreadable or missing measurement would be rendered
 * as idle. Rows remain ordered by pane-status age; the sort deliberately does
 * not claim that child work has waited for the whole status age.
 *
 * **One bad entry degrades the whole register**, the way one bad item degrades
 * the inbox and unlike the way a bad row is dropped from `rows`. The claim this
 * makes is *these are the oldest status records worth showing*, which is a
 * negative claim about every entry not shown; a list that quietly dropped the
 * entry it could not read would be wrong about exactly the session worth
 * looking at. Nothing about the fleet rows depends on this, so the cost of
 * refusing is one card saying it cannot read the register while the sessions
 * below it carry on.
 */
function projectRegister(u: unknown, writtenAt: string, work: ResolvedWork): OverseerRegister {
  const bad = (why: string): OverseerRegister => ({ kind: "unreadable", why });
  if (u === undefined) return bad("this checkpoint carries no register");
  if (!Array.isArray(u)) return bad("the register is not an array");
  const entries: OverseerSessionHistory[] = [];
  const keys = new Set<string>();
  for (const raw of u) {
    if (!isRecord(raw)) return bad("an entry in the register is not one this page can read");
    const key = nonBlank(raw["key"]);
    if (key === null) return bad("an entry in the register is not one this page can read");
    if (keys.has(key)) return bad(`the register carries the session key ${key} twice`);
    keys.add(key);
    const paneWork = work.kind === "scanned" ? (work.panes.get(key) ?? null) : null;
    const entry = projectEntry(raw, writtenAt, paneWork);
    if (entry === null) return bad("an entry in the register is not one this page can read");
    entries.push(entry);
  }
  const waiting = entries
    .filter((entry) => entry.status !== "idle" || (work.kind === "scanned" && entry.work?.kind !== "none"))
    .sort((a, b) => Date.parse(a.since.at) - Date.parse(b.since.at))
    .slice(0, MAX_HISTORY);
  /* `total` IS THE WHOLE REGISTER, idle included, because it answers "how many
     sessions is the Overseer holding history for" — which is what makes eight
     rows legible as eight of thirty-six rather than as the fleet. */
  return { kind: "read", total: entries.length, sessions: waiting, work: registerWork(work) };
}

/** One entry, every field. `null` on the first mismatch — the register then degrades whole. */
function projectEntry(u: unknown, writtenAt: string, work: PaneWork | null): OverseerSessionHistory | null {
  if (!isRecord(u)) return null;
  const name = nonBlank(u["name"]);
  const tmuxId = nonBlank(u["tmuxId"]);
  const status = nonBlank(u["lastStatusKey"]);
  if (name === null || tmuxId === null || status === null) return null;
  const since = u["statusSince"];
  if (!isRecord(since)) return null;
  const at = iso(since["at"]);
  if (at === null) return null;
  /* A DURATION CANNOT HAVE STARTED AFTER THE FILE THAT REPORTS IT WAS WRITTEN,
     and this one is the schema-1 file's fingerprint as well: there `statusSince`
     was a bare timestamp, so `since["at"]` is undefined and the entry is refused
     here even if a future schema check ever let one through. */
  if (Date.parse(at) > Date.parse(writtenAt)) return null;
  if (since["kind"] !== "observed" && since["kind"] !== "lower-bound") return null;
  return { name, tmuxId, status, work, since: { kind: since["kind"], at } };
}
