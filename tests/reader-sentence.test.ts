/**
 * `sayToReader` — what a streaming route may put in its `error` frame and on
 * the stored row. Plan 260924a § Stage 2b (GPT Sol's F5).
 *
 * The route-level proof is in tests/glossary-asked-term-stream-route.test.ts;
 * this pins the two conventions it reuses and the log line.
 */
import { describe, expect, it, vi } from "vitest";

const logged: { fields: Record<string, unknown>; msg: string }[] = [];
vi.mock("../src/log.js", async () => {
  const real = await vi.importActual<typeof import("../src/log.js")>("../src/log.js");
  return {
    ...real,
    log: () => ({
      error: (fields: Record<string, unknown>, msg: string) => logged.push({ fields, msg }),
    }),
  };
});

const { sayToReader } = await import("../src/reader-sentence.js");
const { ANSWER_GAVE_UP, STORAGE_FAILED } = await import("../src/messages.js");
const { stageFailure } = await import("../src/job-failure.js");

describe("sayToReader", () => {
  it("passes a sentence from the closed vocabulary through", () => {
    logged.length = 0;
    expect(sayToReader(new Error(STORAGE_FAILED.message), { route: "r", slug: "s" })).toBe(
      STORAGE_FAILED.message,
    );
    expect(logged).toEqual([]);
  });

  it("passes a declared stage failure's sentence through", () => {
    const err = stageFailure(STORAGE_FAILED, "a diagnostic nobody should read");
    expect(sayToReader(err, { route: "r", slug: "s" })).toBe(STORAGE_FAILED.message);
  });

  it("withholds anything else, and logs it instead", () => {
    logged.length = 0;
    const err = new TypeError("fetch failed: raw-internal-words");
    expect(sayToReader(err, { route: "referee-mirror", slug: "a-slug" })).toBe(ANSWER_GAVE_UP.message);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ err, route: "referee-mirror", slug: "a-slug" });
  });

  it("withholds a thrown non-Error", () => {
    expect(sayToReader("a string", { route: "r", slug: "s" })).toBe(ANSWER_GAVE_UP.message);
  });
});
