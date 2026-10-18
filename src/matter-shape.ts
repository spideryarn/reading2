/**
 * **Whether a value is a stored `Matter` document** (src/types.ts) — the shape
 * alone, and nothing about the blocks it names.
 *
 * A leaf of its own, importing types only, because the store's artefact table
 * (src/store/artifacts.ts § `SHAPE`) asks it, and src/matter.ts — where the
 * kinds list lives — imports the model gateway. src/matter-step.ts holds the
 * kinds here equal to `MATTER_KINDS` there at compile time.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md.
 */
import type {
  Matter,
  MatterKindName,
  MatterModelUnavailable,
  MatterStretchStored,
  MatterUnavailableReason,
} from "./types.js";

/** `MatterKindName`, as a set to test stored strings against. */
export const MATTER_KIND_NAMES: ReadonlySet<string> = new Set<MatterKindName>([
  "title",
  "authors",
  "abstract",
  "keywords",
  "contents",
  "dates",
  "acknowledgements",
  "funding",
  "declarations",
  "references",
]);

const REASONS: ReadonlySet<string> = new Set<MatterUnavailableReason>(["no-blocks", "step-failed"]);
const MODEL_REASONS: ReadonlySet<string> = new Set<MatterModelUnavailable>(["call-failed", "timed-out", "invalid-answer"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function isStretch(v: unknown): v is MatterStretchStored {
  return (
    isObj(v) &&
    isText(v.from) &&
    isText(v.to) &&
    Array.isArray(v.kinds) &&
    v.kinds.length > 0 &&
    v.kinds.every((k) => typeof k === "string" && MATTER_KIND_NAMES.has(k))
  );
}

/** Both statuses are a document: `unavailable` is the step's honest answer, not an absence. */
export function isMatterDocument(v: unknown): v is Matter {
  if (!isObj(v) || !isText(v.version) || !isText(v.sourceHash)) return false;
  if (v.status === "ok") {
    return (
      isText(v.generator) &&
      Array.isArray(v.stretches) &&
      v.stretches.every(isStretch) &&
      (v.modelUnavailable === undefined || (typeof v.modelUnavailable === "string" && MODEL_REASONS.has(v.modelUnavailable)))
    );
  }
  if (v.status === "unavailable") return typeof v.reason === "string" && REASONS.has(v.reason);
  return false;
}
