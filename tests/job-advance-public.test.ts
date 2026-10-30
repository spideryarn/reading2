/**
 * The browser-driven job route must apply the same public projection as every
 * other job response. In particular, a Skim brief is frozen into `profile`, so
 * sending raw `Advanced.job` exposes the reader's sentence on the polling wire.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const advanceJob = vi.hoisted(() => vi.fn());
vi.mock("../src/jobs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/jobs.js")>()),
  advanceJob,
}));

const { handleApi } = await import("../src/routes.js");

it("strips reader prose from the job nested in an advance response, while keeping the brief id", async () => {
  advanceJob.mockResolvedValue({
    job: {
      id: "spya-job2ab",
      ownerId: "reader-private-id",
      slug: "a-piece",
      steps: [{ name: "skim", status: "running", attempts: 1 }],
      status: "running",
      createdAt: "2026-10-27T10:00:00.000Z",
      profile: "Purpose for reading: Only the statistics",
      illustrationNote: "Paint this in my own words",
      skimBrief: "spya-bf2abc",
    },
    ran: "skim",
    busy: false,
    done: false,
  });
  const req = Object.assign((async function* () {})(), {
    method: "POST",
    url: "/api/jobs/spya-job2ab/advance",
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  let raw = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    on() {},
    writeHead(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    },
    write(chunk: unknown) {
      raw += String(chunk);
      return true;
    },
    end(this: { writableEnded: boolean }, chunk?: unknown) {
      if (chunk !== undefined) raw += String(chunk);
      this.writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  const body = JSON.parse(raw) as { job: Record<string, unknown>; ran: string; busy: boolean; done: boolean };
  expect(body).toMatchObject({ ran: "skim", busy: false, done: false });
  expect(body.job.skimBrief).toBe("spya-bf2abc");
  expect(body.job).not.toHaveProperty("profile");
  expect(body.job).not.toHaveProperty("ownerId");
  expect(body.job).not.toHaveProperty("illustrationNote");
  expect(raw).not.toContain("Only the statistics");
});
