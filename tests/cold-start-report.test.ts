/**
 * **Two cold-start numbers, once per instance** — src/cold-start.ts.
 *
 * A Vercel function's own clock starts *after* `api/index.js` has finished
 * `await import("../api-dist/vercel.js")`, so the 3.5 MB module initialisation
 * is invisible in every number the app records
 * (docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 1).
 *
 * `api/index.js` brackets both — the import, and the whole first invocation —
 * and hands them across the seam on **every** request, because it has no
 * business deciding which ones matter. This module makes that decision, and it
 * is the only place it is made, which is what makes it testable here.
 *
 * ## Why two numbers rather than one
 *
 * GPT Sol's review: a handler-local dynamic import would make the outer
 * import timer look faster while merely moving the same wait later in the same
 * request. The end-to-end number is the one that cannot be gamed that way, and
 * one number alone would report a success that had not happened.
 *
 * ## Why "once per instance" is the assertion
 *
 * A warm invocation re-runs the same code with a cached module, so it would
 * report ~0 ms of import time and a warm duration. Logging those would drown the
 * one line that is about the cold start in a stream of lines that are not — and
 * "the median of the `cold start` lines" would then be a number about warm
 * requests wearing the cold start's name.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The log level, before any import: `level()` in src/log.ts reads `LOG_LEVEL`
 * once at load, and vitest's `NODE_ENV=test` otherwise makes the logger silent —
 * which writes nothing, which satisfies every assertion about absence below.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "info";
  }
  return { previousLevel };
});

import {
  reportBundleImport,
  reportFirstRequest,
  resetColdStartReporting,
} from "../src/cold-start.js";
import { logLinesWhile } from "./helpers/log-capture.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

beforeEach(() => {
  resetColdStartReporting();
});

/** How many lines of `text` carry `needle`. */
function lines(text: string, needle: string): string[] {
  return text.split("\n").filter((line) => line.includes(needle));
}

describe("the cold-start instrument", () => {
  it("writes the module-import time once, however many requests arrive", async () => {
    const written = await logLinesWhile(async () => {
      reportBundleImport(2610);
      reportBundleImport(0.4);
      reportBundleImport(0.3);
    });
    /* The capture has to have caught something, or every assertion below is
       satisfied by an empty string. tests/helpers/log-capture.ts § 2. */
    expect(written).toContain("moduleImport");
    expect(lines(written, "moduleImport")).toHaveLength(1);
    expect(written).toContain("2610");
    /* The warm readings must not be in the log at all — not merely outnumbered. */
    expect(written).not.toContain("0.4");
  });

  it("writes the first invocation's end-to-end time once, not per request", async () => {
    const written = await logLinesWhile(async () => {
      reportFirstRequest(2884);
      reportFirstRequest(11);
      reportFirstRequest(9);
    });
    expect(written).toContain("firstRequest");
    expect(lines(written, "firstRequest")).toHaveLength(1);
    expect(written).toContain("2884");
    expect(lines(written, '"ms":11')).toHaveLength(0);
  });

  it("keeps the two numbers apart, so neither can stand in for the other", async () => {
    const written = await logLinesWhile(async () => {
      reportBundleImport(2610);
      reportFirstRequest(2884);
    });
    expect(lines(written, "cold start")).toHaveLength(2);
    expect(lines(written, "moduleImport")).toHaveLength(1);
    expect(lines(written, "firstRequest")).toHaveLength(1);
  });

  it("logs through the health component, not a bare console call", async () => {
    const written = await logLinesWhile(async () => {
      reportBundleImport(2610);
    });
    expect(written).toContain('"component":"health"');
  });

  it("never carries anything but a duration", async () => {
    const written = await logLinesWhile(async () => {
      reportBundleImport(2610);
      reportFirstRequest(2884);
    });
    for (const line of lines(written, "cold start")) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      /* Whatever pino's own base fields are, the only thing this instrument
         itself contributes is a duration and which of the two it is. A reader's
         path, a slug or a token has no business on a line about the deployment. */
      const ours = Object.keys(parsed).filter(
        (key) => !["level", "time", "service", "env", "component", "msg"].includes(key),
      );
      expect(ours.sort()).toEqual(["ms", "phase"]);
    }
  });
});
