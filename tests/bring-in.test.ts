/**
 * ***Bring into this chat***, the pure half (src/web/bring-in.ts) — plan
 * docs/plans/261017e-bring-a-web-page-into-chat.md § Stage 1.
 */
import { describe, expect, it } from "vitest";
import type { Job } from "../src/types.js";
import { ADDING, describeBringIn, pastedAddresses } from "../src/web/bring-in.js";

function job(status: Job["status"], extra: Partial<Job> = {}): Job {
  return {
    id: "j1",
    ownerId: "o" as Job["ownerId"],
    slug: "smith-2024",
    url: "https://example.com/smith",
    steps: [
      { name: "fetch", label: "Fetching the page", status: status === "running" ? "running" : "done" },
    ],
    status,
    createdAt: "2026-10-17T10:00:00.000Z",
    ...extra,
  } as Job;
}

describe("describeBringIn", () => {
  it("offers the press before anything was asked", () => {
    expect(describeBringIn(undefined, null, "open")).toEqual({ kind: "offer", after: null });
  });

  it("says it is adding while the POST is out, and before the engine has the job", () => {
    expect(describeBringIn({ kind: "sending", wait: Promise.resolve() }, null, "open")).toEqual({
      kind: "working",
      line: ADDING,
    });
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, null, "open")).toEqual({ kind: "working", line: ADDING });
  });

  it("names the running step", () => {
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, job("running"), "open")).toEqual({
      kind: "working",
      line: "Fetching the page",
    });
  });

  it("is ready with the job's slug and title once the import is done", () => {
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, job("done", { title: "Smith" }), "open")).toEqual({
      kind: "ready",
      slug: "smith-2024",
      title: "Smith",
    });
  });

  it("is ready at once for a page already on the shelf", () => {
    expect(describeBringIn({ kind: "have", slug: "smith-2024", title: "Smith" }, null, "open")).toEqual({
      kind: "ready",
      slug: "smith-2024",
      title: "Smith",
    });
  });

  it("says so when the address is the open article", () => {
    expect(describeBringIn({ kind: "have", slug: "open", title: null }, null, "open")).toEqual({ kind: "open" });
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, job("done", { slug: "open" }), "open")).toEqual({
      kind: "open",
    });
  });

  it("shows a failed job's sentence with no button", () => {
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, job("error", { error: "The page would not load." }), "o"))
      .toEqual({ kind: "refused", message: "The page would not load." });
  });

  it("offers again after a cancel", () => {
    expect(describeBringIn({ kind: "queued", jobId: "j1" }, job("cancelled"), "o")).toEqual({
      kind: "offer",
      after: null,
    });
  });

  it("offers again under a refusal worth another go, and not under one that is not", () => {
    expect(describeBringIn({ kind: "refused", message: "Something went wrong." }, null, "o")).toEqual({
      kind: "offer",
      after: "Something went wrong.",
    });
  });
});

describe("pastedAddresses", () => {
  it("finds web addresses in order", () => {
    expect(pastedAddresses("compare https://a.example/x with http://b.example/y please")).toEqual([
      "https://a.example/x",
      "http://b.example/y",
    ]);
  });

  it("gives each page once, however it is spelled", () => {
    expect(pastedAddresses("https://a.example/x and https://A.example/x")).toHaveLength(1);
  });

  it("stops at three, the most one question can bring in", () => {
    const four = ["a", "b", "c", "d"].map((h) => `https://${h}.example/p`).join(" ");
    expect(pastedAddresses(four)).toHaveLength(3);
  });

  it("ignores words, and anything that is not http(s)", () => {
    expect(pastedAddresses("see example.com and ftp://x.example/f and mailto:a@b.c")).toEqual([]);
  });

  it("does not take the question mark after an address", () => {
    expect(pastedAddresses("what about https://a.example/x?")).toEqual(["https://a.example/x"]);
  });
});
