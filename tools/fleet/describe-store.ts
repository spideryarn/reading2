/**
 * WHAT WE ALREADY KNOW ABOUT EACH SESSION — the describer's memory, on disk.
 *
 * One file beside the rest of the fleet's state, holding a description per
 * session key. It is **both the cache and the published artefact**, which is
 * simpler than the attention pass's arrangement and is allowed to be: attention
 * has a private memory *and* a ranked list because most of its verdicts are
 * `no-question` and never appear on the page. Every description we hold is one
 * we want to show.
 *
 * ## A LOST FILE IS A COST, NEVER A LIE
 *
 * If it is missing or unreadable it is **replaced, not repaired**, and the pass
 * says so. Everything in it is recoverable by asking again: the cost is a few
 * model calls, and every row reads *not yet described* until they land — which
 * is a true sentence rather than a blank. The other direction, carrying a
 * description across a gap we cannot vouch for, is the mistake this whole
 * neighbourhood keeps having to repair.
 *
 * ## THE KEY IS IN THE RECORD, NOT ONLY IN THE MAP
 *
 * Each entry carries the fingerprint it was computed under and the execution
 * token the session was running as. A record filed under one key and holding
 * another is a corrupted memory, and it is refused here rather than rendered —
 * a cache whose staleness is invisible would go on answering, confidently, about
 * a conversation that ended an hour ago.
 *
 * **The execution token is in the key for a reason a review found.**
 * `CLAUDE_SESSION_ID` is set once when a tmux session is created and never
 * updated, so a pane re-used for a second conversation still names the first —
 * and a description keyed on content alone would match, and conversation A's
 * confident sentence would render on conversation B's row. With the token in the
 * key, B simply misses the cache and describes itself: the stale entry becomes
 * **unreachable** rather than merely unrendered.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { writeAtomically } from "../overseer/jsonl.js";
import type { Described } from "./describe.js";

export const DESCRIPTIONS_FILE = "descriptions.json";

/**
 * Bumped when a reader that ignored the change would be WRONG rather than
 * merely poorer. Nothing but this pass reads the file, so the version is here to
 * make a shape change an explicit refusal rather than a silent misread.
 */
export const DESCRIPTIONS_SCHEMA = 1;

/**
 * Where the fleet's state lives.
 *
 * `OVERSEER_STORE_DIR` when it is absolute, else `~/.overseer`. A relative
 * override is refused rather than resolved against a working directory nobody
 * chose — the same rule `tools/fleet/attention.ts` applies to the checkpoint.
 */
export function descriptionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const given = env["OVERSEER_STORE_DIR"];
  if (given !== undefined && given !== "" && path.isAbsolute(given)) return given;
  return path.join(homedir(), ".overseer");
}

/** One session's description, with everything needed to know it is still about that session. */
export type DescriptionRecord = {
  /** The fingerprint of the opening this was computed from. */
  fingerprint: string;
  /** `boot:pid:startTicks` of the process it was running as, or null when unverified. */
  executionToken: string | null;
  describedAt: string;
  described: Described;
};

export type DescriptionMemory = {
  readonly records: ReadonlyMap<string, DescriptionRecord>;
};

export const EMPTY_DESCRIPTIONS: DescriptionMemory = { records: new Map() };

/**
 * What a read found — three answers, never two.
 *
 * `absent` is an ordinary state on a box that has not run the pass yet;
 * `unusable` is a file that exists and cannot be trusted. Collapsing them would
 * make a corrupted memory indistinguishable from a fresh box.
 */
export type DescriptionMemoryRead =
  | { kind: "memory"; memory: DescriptionMemory }
  | { kind: "absent" }
  | { kind: "unusable"; why: string };

function parseRecord(u: unknown): DescriptionRecord | null {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return null;
  const o = u as Record<string, unknown>;
  const fingerprint = typeof o["fingerprint"] === "string" ? o["fingerprint"] : null;
  const describedAt = typeof o["describedAt"] === "string" ? o["describedAt"] : null;
  const d = o["described"];
  if (fingerprint === null || describedAt === null) return null;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const dd = d as Record<string, unknown>;
  const title = typeof dd["title"] === "string" ? dd["title"].trim() : "";
  const description = typeof dd["description"] === "string" ? dd["description"].trim() : "";
  /* An empty string is not a description — the arm Greg ruled out by name. A
     file holding one was written by a build that allowed it, and reading it back
     would reintroduce exactly what the parser refuses at the source. */
  if (title === "" || description === "") return null;
  const token = o["executionToken"];
  return {
    fingerprint,
    executionToken: typeof token === "string" ? token : null,
    describedAt,
    described: { title, description },
  };
}

export function parseDescriptionMemory(u: unknown): DescriptionMemoryRead {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return { kind: "unusable", why: "not a JSON object" };
  const o = u as Record<string, unknown>;
  if (o["schema"] !== DESCRIPTIONS_SCHEMA) {
    return { kind: "unusable", why: `schema ${JSON.stringify(o["schema"])}, and this build reads ${DESCRIPTIONS_SCHEMA}` };
  }
  const raw = o["records"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "unusable", why: "`records` is not an object" };
  }
  const records = new Map<string, DescriptionRecord>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = parseRecord(value);
    if (record === null) return { kind: "unusable", why: `the record under ${JSON.stringify(key)} is not readable` };
    records.set(key, record);
  }
  return { kind: "memory", memory: { records } };
}

export function readDescriptionMemory(root: string): DescriptionMemoryRead {
  let text: string;
  try {
    text = readFileSync(path.join(root, DESCRIPTIONS_FILE), "utf8");
  } catch (err) {
    /* Only absence is absence. A permissions error is a file we cannot read,
       which is a different fact from a box that has not described anything. */
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unusable", why: `could not read it: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    return parseDescriptionMemory(JSON.parse(text));
  } catch {
    return { kind: "unusable", why: "the file is not JSON" };
  }
}

export function writeDescriptionMemory(root: string, memory: DescriptionMemory): void {
  const records: Record<string, DescriptionRecord> = {};
  for (const [key, record] of memory.records) records[key] = record;
  writeAtomically(
    path.join(root, DESCRIPTIONS_FILE),
    root,
    `${JSON.stringify({ schema: DESCRIPTIONS_SCHEMA, writtenAt: new Date().toISOString(), records }, null, 2)}\n`,
  );
}
