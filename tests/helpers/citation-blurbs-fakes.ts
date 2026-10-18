/**
 * **Fakes for the notes on cited works** — the registries and the model the
 * `citation-blurbs` step is handed in tests/citation-blurbs.test.ts and
 * tests/citation-blurbs-pg.test.ts. No network and no paid call: a test that
 * needed either would be measuring the wrong thing.
 */
import type { LookupResult, ServiceLimiter, WorkId, WorkRecord } from "../../src/bibliographic.js";
import type { BlurbCall, BlurbDeps, BlurbWork } from "../../src/citation-blurbs.js";
import type { Evidence, EvidenceDeps } from "../../src/citation-evidence.js";
import type { Log } from "../../src/log.js";
import type { Bibliography, CitedWork } from "../../src/types.js";

/* ------------------------------------------------------------ fixtures -- */

export const NOW = Date.parse("2026-10-18T10:00:00.000Z");

export const A_ABSTRACT =
  "We show that sleep spindles couple the hippocampus to the cortex during deep sleep, and that boosting the coupling improves memory the next day.";
export const B_ABSTRACT =
  "This paper argues that attention is a mechanism for selecting among competing inputs, and reviews twenty years of experiments on visual search.";
/** Words copied from A's abstract, which is not B's. */
export const A_QUOTE = "sleep spindles couple the hippocampus to the cortex during deep sleep";
export const B_QUOTE = "attention is a mechanism for selecting among competing inputs";

export function evidence(workId: string, text: string): Evidence {
  return {
    kind: "author-abstract",
    source: "crossref",
    via: "id",
    workId: workId as WorkId,
    url: `https://doi.org/${workId.slice(4)}`,
    host: "doi.org",
    readAt: "2026-10-18T09:00:00.000Z",
    text,
    evidenceHash: `hash-${workId}`,
  };
}

export const WORK_A: BlurbWork = { id: "a", title: "Spindles and memory", evidence: evidence("doi:10.1234/a", A_ABSTRACT) };
export const WORK_B: BlurbWork = { id: "b", title: "Attention as selection", evidence: evidence("doi:10.1234/b", B_ABSTRACT) };

/** A chat-completions body carrying `content`, finished as `finish`. */
export function body(content: unknown, finish = "stop") {
  return { choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] };
}

export function silentLog(): Log {
  const l = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => l };
  return l as unknown as Log;
}

/** The indices a writer request asks for, in order, read off its last line. */
export function indicesOf(request: Record<string, unknown>): string[] {
  const messages = request.messages as { content: string }[];
  const line = messages[1]!.content.split("\n").at(-1)!;
  return line.replace(/^.*each once: /, "").replace(/\.$/, "").split(", ");
}

/** Which work each index in a writer request belongs to, by the abstract printed under it. */
export function worksOf(request: Record<string, unknown>, works: readonly BlurbWork[]): Map<string, BlurbWork> {
  const content = (request.messages as { content: string }[])[1]!.content;
  const out = new Map<string, BlurbWork>();
  for (const index of indicesOf(request)) {
    const start = content.indexOf(`Work ${index}:`);
    const chunk = content.slice(start, start + 2000);
    const work = works.find((w) => chunk.includes(w.evidence.text));
    if (work) out.set(index, work);
  }
  return out;
}

export interface FakeModel {
  deps: BlurbDeps;
  writes: Record<string, unknown>[];
  checks: Record<string, unknown>[];
}

/**
 * A model that writes each work's note with `write` and judges each with
 * `judge` (default: every sentence supported). Counts every call.
 */
export function fakeModel(
  works: readonly BlurbWork[],
  write: (work: BlurbWork, index: string, all: Map<string, BlurbWork>) => object[] = (work, index) => [
    { i: index, sentences: [{ text: `A note on ${work.title}.`, quote: work.id === "a" ? A_QUOTE : B_QUOTE }] },
  ],
  judge: (request: Record<string, unknown>) => object = () => ({ verdicts: [{ n: 1, supported: true }] }),
): FakeModel {
  const writes: Record<string, unknown>[] = [];
  const checks: Record<string, unknown>[] = [];
  const call: BlurbCall = async (job, request) => {
    if (job === "citation-blurbs") {
      writes.push(request);
      const byIndex = worksOf(request, works);
      const notes = [...byIndex].flatMap(([index, work]) => write(work, index, byIndex));
      return { json: body({ notes }) };
    }
    checks.push(request);
    return { json: body(judge(request)) };
  };
  return { deps: { call, now: () => NOW, log: silentLog() }, writes, checks };
}


/* ------------------------------------------------------ item 7: the step -- */

export function cited(id: string, over: Partial<CitedWork> = {}): CitedWork {
  return {
    id,
    key: `doi:10.1234/${id}`,
    title: id === "a" ? "Spindles and memory" : "Attention as selection",
    authors: "Someone, A.",
    year: "2016",
    why: "The article leans on it.",
    relevance: 0.5,
    mentions: [],
    citedAt: [],
    firstCited: "spya-aaaaaa",
    citedInBody: true,
    url: `https://doi.org/10.1234/${id}`,
    linkFrom: "doi",
    ...over,
  };
}

export function bibliography(rows: CitedWork[]): Bibliography {
  return {
    version: "citations/6",
    generator: "fixture",
    slug: "fixture",
    sourceHash: "list-hash",
    citations: rows,
    capped: false,
    generatedAt: "2026-10-18T00:00:00.000Z",
    elapsedMs: 1,
  };
}

export function record(id: string, title: string, abstract: string | undefined): WorkRecord {
  return {
    id: id as WorkId,
    source: "crossref",
    title,
    authors: [{ family: "Someone", given: "A." }],
    year: 2016,
    doi: id.replace(/^doi:/, ""),
    ...(abstract ? { abstract, abstractReadAt: "2026-10-18T09:00:00.000Z" } : {}),
  };
}

export const LIMITER: ServiceLimiter = {
  coolingDown: async () => false,
  takeSlot: async (service, leaseMs) => ({ service, slot: 1, until: new Date(Date.now() + leaseMs) }),
  freeSlot: async () => {},
  takeStart: async () => ({ kind: "start", waitMs: 0 }),
  coolDown: async () => {},
};

/** Registries where `a` and `b` have abstracts unless told otherwise, counting every lookup. */
export function registries(lookups: Partial<Record<string, LookupResult>> = {}) {
  const asked: string[] = [];
  const defaults: Record<string, LookupResult> = {
    "doi:10.1234/a": { kind: "found", record: record("doi:10.1234/a", "Spindles and memory", A_ABSTRACT) },
    "doi:10.1234/b": { kind: "found", record: record("doi:10.1234/b", "Attention as selection", B_ABSTRACT) },
  };
  const d: EvidenceDeps = {
    lookup: async (id) => {
      asked.push(id);
      return lookups[id] ?? defaults[id] ?? { kind: "not-found" };
    },
    fetchJson: async () => {
      throw new Error("no fetch in this test");
    },
    limiter: LIMITER,
    sleep: async () => {},
    now: () => NOW,
    log: silentLog(),
  };
  return { d, asked };
}

export const WORKS = [WORK_A, WORK_B];
