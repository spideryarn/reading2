/**
 * The real captured snapshots, loaded for the Overseer's tests.
 *
 * Not a test file: it is shared by `overseer-observation.test.ts` and
 * `overseer-diff.test.ts`, and one loader means one place where "which fixtures
 * exist" is written down. See tests/fixtures/overseer-snapshots/README.md for
 * what the capture proves and — more usefully — what it cannot test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseObservation, type FreshSnapshot, type JsonValue } from "../tools/overseer/observation.js";

/** The eight files, named so a typo is a compile error rather than an ENOENT at run time. */
export type FixtureName =
  | "status-change-before"
  | "status-change-after"
  | "session-gone-before"
  | "session-gone-after"
  | "session-new-before"
  | "session-new-after"
  | "duplicate-first"
  | "duplicate-second";

export const EVERY_FIXTURE: readonly FixtureName[] = [
  "status-change-before",
  "status-change-after",
  "session-gone-before",
  "session-gone-after",
  "session-new-before",
  "session-new-after",
  "duplicate-first",
  "duplicate-second",
];

/**
 * The bytes as captured, parsed only by `JSON.parse`.
 *
 * Deliberately typed as opaque JSON rather than as the payload type: a test
 * that constructs a case by editing one of these must go through the same
 * strict parser as the daemon, or it is testing a shape nothing produces.
 */
export function rawFixture(name: FixtureName): JsonValue {
  const path = fileURLToPath(new URL(`./fixtures/overseer-snapshots/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
}

/** A deep copy, so a test that edits one field cannot leak it into the next test. */
export function editableFixture(name: FixtureName): Record<string, JsonValue> {
  return rawFixture(name) as Record<string, JsonValue>;
}

/** The rows of a fixture, as editable JSON. */
export function rowsOf(snapshot: Record<string, JsonValue>): Record<string, JsonValue>[] {
  return snapshot["rows"] as unknown as Record<string, JsonValue>[];
}

/**
 * A fixture through the real parser, refusing loudly rather than returning a
 * half-built object — a fixture that stopped parsing is the whole warning in
 * that README, and a test helper that swallowed it would hide it.
 */
export function freshFixture(name: FixtureName): FreshSnapshot {
  return freshFrom(rawFixture(name), name);
}

export function freshFrom(payload: JsonValue, label: string): FreshSnapshot {
  const parsed = parseObservation(payload);
  if (!parsed.ok) throw new Error(`${label} did not parse: ${parsed.reason}`);
  const { clock } = parsed.value;
  if (!clock.collected) throw new Error(`${label} has no collectedAt, so it is not a collection`);
  return { ...parsed.value, clock };
}
