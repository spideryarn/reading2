/**
 * Putting the request URL back together after Vercel's rewrite — src/vercel.ts.
 *
 * This file exists because of a deployment that looked fine and served almost
 * nothing. `api/[...path].js` reads like a catch-all and is not one: Vercel's
 * filesystem routing treats every bracketed filename as a SINGLE segment, so
 * `/api/library` reached the function and `/api/article/writes` got a platform
 * 404 — nearly every route in src/routes.ts, failing before any of our code ran
 * and therefore appearing in no log we write.
 *
 * The fix routes every `/api/*` through one rewrite that carries the real path
 * in `__spy_path`. That puts a string the client can influence in front of the
 * router, which is why the two nastiest cases below — a second `__spy_path`, and
 * a `%` that must not be decoded — are tested rather than reasoned about.
 *
 * Deterministic — no network, no deployment. docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import { originalUrl } from "../src/vercel.js";

describe("originalUrl", () => {
  it("restores a multi-segment path, which is the case that was 404ing", () => {
    expect(originalUrl("/api/index?__spy_path=article/writes")).toBe("/api/article/writes");
    expect(originalUrl("/api/index?__spy_path=jobs/abc/retry")).toBe("/api/jobs/abc/retry");
  });

  it("keeps the caller's own query string, and drops only our parameter", () => {
    /* `/api/library?archived=1` is a real request, and `handleApi` reads that
       parameter. Losing it would hand back the wrong shelf with a 200. */
    expect(originalUrl("/api/index?__spy_path=library&archived=1")).toBe("/api/library?archived=1");
  });

  it("leaves a URL alone when nothing rewrote it", () => {
    /* Not hypothetical: it is what happens if the rewrite is ever removed from
       vercel.json, and the right behaviour then is to route the URL as given
       rather than to invent one. */
    expect(originalUrl("/api/health")).toBe("/api/health");
    expect(originalUrl("/api/library?archived=1")).toBe("/api/library?archived=1");
  });

  it("decodes the capture exactly once, because Vercel encodes it exactly once", () => {
    /* Measured, not assumed: /api/jobs/abc/retry arrives as
       `__spy_path=jobs%2Fabc%2Fretry`. Keeping it raw — which this function did
       at first — made every multi-segment route answer "No API route for
       /api/jobs%2Fabc%2Fretry", which looks like our bug and is not. */
    expect(originalUrl("/api/index?__spy_path=jobs%2Fabc%2Fretry")).toBe("/api/jobs/abc/retry");
    /* And the case that motivated keeping it raw, which turns out to be fine:
       `%` is legal in the slug patterns in src/routes.ts, and it reaches us
       double-encoded, so one decode gives it back unharmed. */
    expect(originalUrl("/api/index?__spy_path=article%2Fa%25b")).toBe("/api/article/a%b");
  });

  it("refuses a capture that cannot have come from that encoder", () => {
    expect(originalUrl("/api/index?__spy_path=article%2Fa%zzb")).toBeNull();
  });

  it("refuses two __spy_path parameters instead of picking one", () => {
    /* A client that can append `__spy_path=library` chooses which route runs.
       Both orderings, because which one arrives first is Vercel's business and
       could change without telling us. */
    expect(originalUrl("/api/index?__spy_path=jobs&__spy_path=library")).toBeNull();
    expect(originalUrl("/api/index?__spy_path=library&__spy_path=jobs")).toBeNull();
  });

  it("handles an empty capture, which is what /api/ itself produces", () => {
    expect(originalUrl("/api/index?__spy_path=")).toBe("/api/");
  });
});
