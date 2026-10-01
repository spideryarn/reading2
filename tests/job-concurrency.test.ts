import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JOB_CONCURRENCY, jobConcurrency } from "../src/jobs.js";

/**
 * **The number production runs**, because nothing sets the variable on Vercel
 * (checked 2026-10-01) and so the default *is* production's cap.
 * docs/plans/261001b-raise-the-job-concurrency-cap-to-six.md.
 */
describe("jobConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is six when nothing is set", () => {
    vi.stubEnv("SPIDERYARN_JOB_CONCURRENCY", "");
    expect(DEFAULT_JOB_CONCURRENCY).toBe(6);
    expect(jobConcurrency()).toBe(6);
  });

  it("obeys a positive whole number, read at call time", () => {
    vi.stubEnv("SPIDERYARN_JOB_CONCURRENCY", "8");
    expect(jobConcurrency()).toBe(8);
  });

  /* `0` would stop every job in the account and read exactly like a wedged
     queue, so anything that is not a positive whole number falls back. */
  it.each(["0", "-2", "2.5", "eight"])("ignores %j and uses the default", (value) => {
    vi.stubEnv("SPIDERYARN_JOB_CONCURRENCY", value);
    expect(jobConcurrency()).toBe(DEFAULT_JOB_CONCURRENCY);
  });
});
