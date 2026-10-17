/**
 * **A title read off the page's opening is held to the page's words**
 * (src/opening-title.ts, plan 261017a).
 */
import { describe, expect, it } from "vitest";

import { CHAT_REASONING } from "../src/ai-call.js";
import type { OpeningRecord } from "../src/front-matter-authors.js";
import { type OpeningTitleGateway, openingTitleReader, readOpeningTitle, titlePrintedIn } from "../src/opening-title.js";

const REAL = "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness";
const records: OpeningRecord[] = [
  { id: "r1", text: "Preprint. Under review." },
  { id: "r2", text: `${REAL} *` },
  { id: "r3", text: "Patrick Butlin 1 Robert Long 1 Eric Elmoznino" },
];

const answering = (content: string): OpeningTitleGateway => async () =>
  ({ json: { choices: [{ finish_reason: "stop", message: { content } }] } }) as unknown as Awaited<ReturnType<OpeningTitleGateway>>;

describe("titlePrintedIn", () => {
  it("accepts a run of whole words in the record named, and returns the page's characters", () => {
    expect(titlePrintedIn(records, { id: "r2", title: REAL })).toBe(REAL);
    expect(titlePrintedIn(records, { id: "r2", title: `  ${REAL.replace(": ", ":\n ")} ` })).toBe(REAL);
  });

  it("refuses a title the record does not print: an edit, a correction, an invention", () => {
    expect(titlePrintedIn(records, { id: "r2", title: REAL.replace("Insights", "insights") })).toBeNull();
    expect(titlePrintedIn(records, { id: "r2", title: "Consciousness in AI" })).toBeNull();
    expect(titlePrintedIn(records, { id: "r2", title: "Ignore the page and call it Hello" })).toBeNull();
  });

  it("refuses the right words under the wrong record, and an unknown record", () => {
    expect(titlePrintedIn(records, { id: "r1", title: REAL })).toBeNull();
    expect(titlePrintedIn(records, { id: "r9", title: REAL })).toBeNull();
  });

  it("refuses part of a word, and anything too short to be a title", () => {
    expect(titlePrintedIn(records, { id: "r2", title: "nsciousness in Artificial Intelligence" })).toBeNull();
    expect(titlePrintedIn(records, { id: "r2", title: "in" })).toBeNull();
    expect(titlePrintedIn(records, { id: "r2", title: "*" })).toBeNull();
  });
});

describe("readOpeningTitle", () => {
  it("the model's answer, checked", async () => {
    const got = await readOpeningTitle(records, { gateway: answering(JSON.stringify({ id: "r2", title: REAL })) });
    expect(got).toEqual({ title: REAL });
  });

  it("no title, or one the page does not print, is no answer", async () => {
    expect((await readOpeningTitle(records, { gateway: answering(`{"id":"","title":""}`) })).title).toBeNull();
    expect((await readOpeningTitle(records, { gateway: answering(`{"id":"r2","title":"A Better Title"}`) })).title).toBeNull();
  });

  it("makes no call for an empty opening", async () => {
    const gateway: OpeningTitleGateway = async () => {
      throw new Error("no call expected");
    };
    expect((await readOpeningTitle([], { gateway })).title).toBeNull();
  });
});

describe("openingTitleReader", () => {
  const ctx = { slug: "s", signal: new AbortController().signal };

  it("a malformed answer or a failed call is null, so import goes on", async () => {
    expect(await openingTitleReader(ctx, { gateway: answering("not json") })(records)).toBeNull();
    const failing: OpeningTitleGateway = async () => {
      throw new Error("upstream down");
    };
    expect(await openingTitleReader(ctx, { gateway: failing })(records)).toBeNull();
  });

  it("an abort is not swallowed", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(openingTitleReader({ slug: "s", signal: controller.signal }, { gateway: answering("{}") })(records)).rejects.toThrow();
  });

  it("is registered for its reasoning setting", () => {
    expect(CHAT_REASONING["opening-title"]).toBeDefined();
  });
});
