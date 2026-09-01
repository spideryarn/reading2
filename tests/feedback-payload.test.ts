/**
 * **The diagnostics blob's vocabularies, checked against the things they are
 * copies of.** src/feedback-payload.ts.
 *
 * That file may not import src/pipeline.ts — it is shared with the dialog, and
 * nothing under `src/web/` may pull the pipeline behind it
 * (tests/client-imports.test.ts) — so its list of step names is a second copy of
 * `STEP_ORDER`. This file is what keeps the copy honest, the same way
 * tests/feedback-store.test.ts keeps the CHECK constraints honest: by feeding
 * the real list through and watching every value survive.
 *
 * A test file may import anything, which is the whole reason this arrangement
 * works.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFeedbackDiagnostics, safeDiagnosticName } from "../src/feedback-payload.js";
import { MODES } from "../src/modes.js";
import { STEP_ORDER } from "../src/pipeline.js";
import { ARTICLE_VIEWS } from "../src/read-address.js";

/** The blob's `job` field for one step name. */
function stepOf(step: string): string | null {
  return parseFeedbackDiagnostics({ job: { step } })?.job?.step ?? null;
}

describe("the diagnostics vocabularies", () => {
  it("accepts every step the pipeline actually has", () => {
    const dropped = STEP_ORDER.filter((step) => stepOf(step) === null);
    /* Named rather than counted, so a red line says which step was added to the
       pipeline and not to src/feedback-payload.ts. */
    expect(dropped).toEqual([]);
  });

  it("drops a step name that is not one", () => {
    /* The other half, and the reason the loop above is not a slow way of
       asserting nothing. */
    expect(stepOf("Four score and seven years ago")).toBeNull();
    expect(stepOf("extractx")).toBeNull();
  });

  it("accepts every mode and every article view", () => {
    for (const mode of MODES) {
      expect([mode, parseFeedbackDiagnostics({ article: { mode } })?.article?.mode]).toEqual([
        mode,
        mode,
      ]);
    }
    for (const view of ARTICLE_VIEWS) {
      expect([view, parseFeedbackDiagnostics({ article: { view } })?.article?.view]).toEqual([
        view,
        view,
      ]);
    }
  });

  it("returns null for a blob with nothing left in it", () => {
    /* Which is what keeps the database's `feedback_diagnostics_version` CHECK
       something nobody has to think about: a version standing beside an absent
       blob is a row this schema does not have. */
    expect(parseFeedbackDiagnostics({ nonsense: 1 })).toBeNull();
    expect(parseFeedbackDiagnostics({ api: [], errors: [] })).toBeNull();
    expect(parseFeedbackDiagnostics("not an object")).toBeNull();
  });
});

/**
 * **The error-name vocabulary, pinned against the code it is a list of.**
 *
 * `safeDiagnosticName` is a closed list, and the cost of a closed list is that
 * somebody has to add to it. The built-in and DOM halves are spec constants and
 * do not move; the authored half is `class … extends Error` under `src/web/`,
 * and *that* moves. So the list is checked against the source rather than
 * against a second copy of itself: a new client error class that sets
 * `this.name` turns into a red line here, naming itself, instead of into a
 * report that says `Error` where it meant `StreamStalled`.
 *
 * Only `src/web/` is swept. A server-side class never reaches a browser as a
 * thrown `Error` — it arrives as a JSON body and becomes `HttpError` — so
 * listing those would be listing names that can only arrive by forgery.
 */
function assignedErrorNames(dir: string): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const name of assignedErrorNames(full)) found.add(name);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    for (const m of readFileSync(full, "utf8").matchAll(/this\.name = "([A-Za-z0-9_$]+)"/g)) {
      found.add(m[1]!);
    }
  }
  return [...found];
}

describe("the error-name vocabulary", () => {
  it("knows every error name the client code assigns", () => {
    const assigned = assignedErrorNames("src/web");
    /* Not an empty sweep passing for a clean one: there are three today, and a
       regex that stopped matching would be the quietest possible failure. */
    expect(assigned.length).toBeGreaterThanOrEqual(3);

    const unknown = assigned.filter((name) => safeDiagnosticName(name) !== name);
    /* Named rather than counted, so a red line says which class was added to
       `src/web/` and not to `DIAGNOSTIC_ERROR_NAMES`. */
    expect(unknown).toEqual([]);
  });

  it("reduces a name that is not on the list, however well-shaped", () => {
    /* The other half, and the reason the sweep above is not a slow way of
       asserting nothing. Both of these are syntactically perfect identifiers —
       which is exactly why a shape check was not one. */
    expect(safeDiagnosticName("PROVIDER_BODY_MARKER")).toBe("Error");
    expect(safeDiagnosticName("reader_search_term")).toBe("Error");
    expect(safeDiagnosticName("TypeErrorr")).toBe("Error");
    expect(safeDiagnosticName(42)).toBe("Error");
    expect(safeDiagnosticName(undefined)).toBe("Error");
    // And the control: a real one survives.
    expect(safeDiagnosticName("TypeError")).toBe("TypeError");
  });

  /**
   * The mismatch GPT Sol found and this closes: the client used to keep an
   * identifier of any length while the server's expression capped it at 64, so
   * a 65-character name was kept by one end and silently dropped by the other.
   * Neither end has a length rule any more, because neither end has a shape
   * rule — they have the same list.
   */
  it("does not keep a long name at either end", () => {
    const long = `A${"b".repeat(120)}`;
    expect(safeDiagnosticName(long)).toBe("Error");
    expect(parseFeedbackDiagnostics({ errors: [{ name: long }] })?.errors).toEqual([
      { name: "Error", at: null },
    ]);
  });

  /**
   * **Reduced, not dropped.** An error that happened is worth a row even when
   * its name is one we will not repeat — the `at` beside it is half of what the
   * buffer is for, and an error that vanishes looks exactly like one that never
   * happened.
   */
  it("keeps the row for an error whose name it will not repeat", () => {
    const at = "2026-08-31T12:00:00.000Z";
    expect(
      parseFeedbackDiagnostics({ errors: [{ name: "PROVIDER_BODY_MARKER", at }] })?.errors,
    ).toEqual([{ name: "Error", at }]);
  });
});
