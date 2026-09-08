/**
 * WHAT WE ALREADY KNEW — the attention pass's memory, on disk.
 *
 * Two things, in one small file beside the checkpoint:
 *
 *  - **`waits`** — when we FIRST saw each session asking each question. The pane
 *    can say a dialog is open; it cannot say for how long, and duration is the
 *    thing the inbox ranks on after kind. This is the same fact `StatusSince` in
 *    store.ts holds one level up, and it is here rather than there because a
 *    question's clock is not a status's clock: an agent can end three different
 *    turns with three different questions without its status changing once.
 *  - **`verdicts`** — what the classifier last said about a tail, keyed by the
 *    tail's fingerprint. This is the whole of Astra's A30 in one map: *thirty-six
 *    sessions must not trigger thirty-six model reviews a minute*.
 *
 * **The key is in the record, not only in the map.** A `CachedVerdict` carries
 * the `fingerprint` it was computed under, so a record filed under one key and
 * holding another is a corrupted memory that `planClassifications` refuses
 * rather than renders. A cache whose staleness is invisible is the shape of bug
 * docs/reusable/silent-success.md is about: it would go on answering, confidently,
 * about a turn that ended an hour ago.
 *
 * ## Why not the checkpoint
 *
 * `Checkpoint.attention` holds the published list, and it does hold
 * `waitingSince` — so the waits could in principle be recovered from it. The
 * verdicts could not: most of them are `no-question`, which is exactly the
 * population that never appears in the list and exactly the population whose
 * caching saves the money. A memory that could only remember the questions
 * would re-ask the model about every quiet session on every tick.
 *
 * ## A lost memory is a cost, never a lie
 *
 * If this file is missing or unreadable it is REPLACED, not repaired, and the
 * pass says so. Everything in it is recoverable by looking again: the verdicts
 * cost a few model calls, and the waits restart from now — which reads every
 * question as newer than it is, in the direction that under-states a wait rather
 * than inventing one. The other direction, carrying a duration across a gap we
 * cannot vouch for, is the mistake that once printed four sessions as `13m`
 * because it was measuring the daemon's uptime (see `StatusSince` in store.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AttentionAnswerability, AttentionKind } from "../fleet/wire.js";
import type { CacheableVerdict, CachedVerdict } from "./attention-classify.js";
import type { AttentionWaits } from "./attention.js";
import { writeAtomically } from "./jsonl.js";

export const ATTENTION_MEMORY_FILE = "attention.json";

/**
 * The memory's own schema, and the same rule as `STORE_SCHEMA`: bumped when a
 * reader that ignored the change would be WRONG rather than merely poorer.
 *
 * Nothing else reads this file — it is the pass talking to its future self — so
 * the version is here to make a shape change an explicit refusal rather than a
 * silent misread of somebody's fields.
 */
export const ATTENTION_MEMORY_SCHEMA = 1;

export type AttentionMemory = {
  readonly waits: AttentionWaits;
  readonly verdicts: ReadonlyMap<string, CachedVerdict>;
  /**
   * Which continuous run of observation the WAITS belong to.
   *
   * **GPT Sol's finding 2, and it is the `13m` bug wearing a different hat.**
   * `store.ts` deliberately refuses to republish the previous attention list
   * after a restart, because a first-seen instant for a question that may have
   * been answered while we were down is a false claim about a person's
   * obligations. This file then quietly undid that, by persisting the waits: a
   * question first seen at 09:00, answered during three hours of downtime, and
   * asked again at 12:00 came back as *"waiting since 09:00"*, spanning a gap
   * nobody observed.
   *
   * So the waits are tagged with the epoch that observed them, and an epoch that
   * does not match drops them. **The verdicts are NOT dropped**, and that
   * asymmetry is the whole point: a verdict is about a piece of TEXT and stays
   * true across any gap, while a wait is about CONTINUOUS OBSERVATION and cannot
   * survive one.
   */
  readonly epoch: string;
};

export const EMPTY_ATTENTION_MEMORY: AttentionMemory = { waits: new Map(), verdicts: new Map(), epoch: "" };

/** How the memory came back, because "empty" and "there was none" are different facts. */
export type AttentionMemoryRead =
  | { kind: "memory"; memory: AttentionMemory }
  | { kind: "absent" }
  | { kind: "unusable"; why: string };

function isInstant(u: unknown): u is string {
  return typeof u === "string" && !Number.isNaN(Date.parse(u));
}

/**
 * A verdict, parsed EXHAUSTIVELY rather than cast.
 *
 * GPT Sol's finding 3: the first version validated the fingerprint and the
 * instant and then cast, so `{"kind":"question"}` with no `topic`, no `why`, no
 * `attentionKind` and no `answerability` became a `CachedVerdict` that later
 * code would read fields off. Every arm and every field, or nothing.
 */
function parseCachedVerdict(u: unknown): CacheableVerdict | null {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return null;
  const v = u as Record<string, unknown>;
  const why = v["why"];
  if (typeof why !== "string") return null;
  if (v["kind"] === "no-question") return { kind: "no-question", why };
  // `unreadable` IS DELIBERATELY NOT AN ARM HERE, and the type says so too — see
  // `CacheableVerdict`. GPT Sol's second round: the pass had stopped WRITING one,
  // and a memory file from an older build could still hold one, which read back
  // as a cache hit, never reached `unclassified`, and went on publishing false
  // calm indefinitely. A file holding one is now refused whole and rebuilt, which
  // costs a fleet's worth of cheap calls once.
  if (v["kind"] !== "question") return null;
  const topic = v["topic"];
  const attentionKind = v["attentionKind"];
  if (typeof topic !== "string" || typeof attentionKind !== "string") return null;
  if (!(ATTENTION_KINDS as readonly string[]).includes(attentionKind)) return null;
  const answerability = parseAnswerability(v["answerability"]);
  if (answerability === null) return null;
  return {
    kind: "question",
    topic,
    why,
    attentionKind: attentionKind as AttentionKind,
    answerability,
  };
}

/** Every arm, spelled out, so an unknown one is refused rather than cast. */
export function parseAnswerability(u: unknown): AttentionAnswerability | null {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return null;
  const a = u as Record<string, unknown>;
  if (a["kind"] === "phone") return { kind: "phone" };
  if (a["kind"] === "needs-a-screen" && typeof a["why"] === "string") {
    return { kind: "needs-a-screen", why: a["why"] };
  }
  if (a["kind"] === "unknown" && typeof a["why"] === "string") return { kind: "unknown", why: a["why"] };
  return null;
}

export const ATTENTION_KINDS: readonly AttentionKind[] = ["irreversible", "product", "technical", "other"];

export function parseAttentionMemory(u: unknown): AttentionMemoryRead {
  if (typeof u !== "object" || u === null || Array.isArray(u)) {
    return { kind: "unusable", why: "the memory is not a JSON object" };
  }
  const o = u as Record<string, unknown>;
  if (o["schema"] !== ATTENTION_MEMORY_SCHEMA) {
    return { kind: "unusable", why: `schema ${JSON.stringify(o["schema"])} is not ${ATTENTION_MEMORY_SCHEMA}` };
  }
  const epoch = o["epoch"];
  if (typeof epoch !== "string") return { kind: "unusable", why: "`epoch` is not a string" };
  const waits = new Map<string, string>();
  const rawWaits = o["waits"];
  if (typeof rawWaits !== "object" || rawWaits === null || Array.isArray(rawWaits)) {
    return { kind: "unusable", why: "`waits` is not an object" };
  }
  for (const [k, v] of Object.entries(rawWaits as Record<string, unknown>)) {
    if (!isInstant(v)) return { kind: "unusable", why: `the wait for ${JSON.stringify(k)} is not an instant` };
    waits.set(k, v);
  }
  const verdicts = new Map<string, CachedVerdict>();
  const rawVerdicts = o["verdicts"];
  if (typeof rawVerdicts !== "object" || rawVerdicts === null || Array.isArray(rawVerdicts)) {
    return { kind: "unusable", why: "`verdicts` is not an object" };
  }
  for (const [k, v] of Object.entries(rawVerdicts as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) return { kind: "unusable", why: `the verdict for ${k} is not an object` };
    const r = v as Record<string, unknown>;
    // THE KEY IS CHECKED AGAINST THE RECORD HERE, not only at lookup. A memory
    // that survived a bad write with its keys and its contents disagreeing would
    // otherwise be believed until something happened to compare them.
    if (r["fingerprint"] !== k) {
      return { kind: "unusable", why: `a verdict filed under ${k} says it is about ${JSON.stringify(r["fingerprint"])}` };
    }
    if (!isInstant(r["classifiedAt"])) {
      return { kind: "unusable", why: `the verdict for ${k} has no usable instant` };
    }
    const verdict = parseCachedVerdict(r["verdict"]);
    if (verdict === null) return { kind: "unusable", why: `the verdict for ${k} is not a verdict this build knows` };
    verdicts.set(k, { fingerprint: k, classifiedAt: r["classifiedAt"], verdict });
  }
  return { kind: "memory", memory: { waits, verdicts, epoch } };
}

/**
 * The memory as this run may use it: verdicts always, waits only if the epoch
 * matches.
 *
 * The asymmetry is the fix for finding 2 and it is worth stating where a caller
 * will meet it. **A verdict is about a piece of text** and stays true across any
 * gap, so it survives a restart and saves the money it was cached to save. **A
 * wait is about continuous observation** and cannot survive one: everything that
 * happened while we were not looking is unknown, and the safe direction is to
 * call the question new. That under-states a wait, which is the harmless error;
 * the other direction tells Greg he has ignored something for three hours when
 * he has ignored it for three minutes.
 */
export function memoryForEpoch(memory: AttentionMemory, epoch: string): AttentionMemory {
  if (memory.epoch === epoch) return memory;
  return { waits: new Map(), verdicts: memory.verdicts, epoch };
}

export function readAttentionMemory(root: string): AttentionMemoryRead {
  let text: string;
  try {
    text = readFileSync(join(root, ATTENTION_MEMORY_FILE), "utf8");
  } catch {
    return { kind: "absent" };
  }
  try {
    return parseAttentionMemory(JSON.parse(text));
  } catch (e) {
    return { kind: "unusable", why: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Write the memory, keeping only what this pass saw.
 *
 * Eviction is *what was not seen is dropped*, which is what keeps the file
 * bounded without a size limit or a clock: a fleet of thirty sessions cannot
 * hold more than thirty waits and thirty verdicts, whatever it did yesterday.
 */
export function writeAttentionMemory(root: string, memory: AttentionMemory): void {
  const waits: Record<string, string> = {};
  for (const [k, v] of memory.waits) waits[k] = v;
  const verdicts: Record<string, CachedVerdict> = {};
  for (const [k, v] of memory.verdicts) verdicts[k] = v;
  // ATOMIC, temp-then-rename, the same way the checkpoint is written — GPT Sol's
  // finding 5. A daemon shutting down while a pass is still in flight can have
  // two writers on this file for a moment, and a torn JSON file would be
  // `unusable` on the next read: recoverable, but it costs a fleet's worth of
  // model calls and every wait we were timing. A rename costs nothing.
  writeAtomically(
    join(root, ATTENTION_MEMORY_FILE),
    root,
    `${JSON.stringify({ schema: ATTENTION_MEMORY_SCHEMA, epoch: memory.epoch, waits, verdicts }, null, 2)}\n`,
  );
}
