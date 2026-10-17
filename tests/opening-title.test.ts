/**
 * **A title read off the page's opening is held to the page's words**
 * (src/opening-title.ts, plan 261017a).
 */
import { describe, expect, it } from "vitest";

import { CHAT_REASONING } from "../src/ai-call.js";
import type { OpeningRecord } from "../src/front-matter-authors.js";
import {
  MAX_RECORDS,
  type OpeningTitleGateway,
  openingTitleReader,
  readOpeningTitle,
  titlePrintedIn,
} from "../src/opening-title.js";

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

  it("treats an astral Unicode letter as one word character at either boundary", () => {
    const letter = "\u{10400}"; // DESERET CAPITAL LETTER LONG I, Unicode category Letter.
    expect(titlePrintedIn([{ id: "r1", text: `${letter}Title` }], { id: "r1", title: "Title" })).toBeNull();
    expect(titlePrintedIn([{ id: "r1", text: `Title${letter}` }], { id: "r1", title: "Title" })).toBeNull();
  });

  it("counts Unicode code points for the title length limits", () => {
    const short = "\u{10400}\u{10401}";
    expect(titlePrintedIn([{ id: "r1", text: short }], { id: "r1", title: short })).toBeNull();
    const long = "\u{10400}".repeat(151);
    expect(titlePrintedIn([{ id: "r1", text: long }], { id: "r1", title: long })).toBe(long);
  });

  it("refuses an ill-formed answer that ends halfway through an astral character", () => {
    expect(titlePrintedIn([{ id: "r1", text: "AB\u{10400}C" }], { id: "r1", title: "AB\ud801" })).toBeNull();
  });

  it("keeps looking when an earlier occurrence is not on whole-word boundaries", () => {
    expect(titlePrintedIn([{ id: "r1", text: "NotATitle; Title" }], { id: "r1", title: "Title" })).toBe("Title");
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

  it("accepts answers only from the same record cap the model was shown", async () => {
    const many = Array.from({ length: MAX_RECORDS + 1 }, (_, i) => ({ id: `r${i + 1}`, text: `Record ${i + 1} title` }));
    const gateway: OpeningTitleGateway = async (_job, request) => {
      const shown = ((request.messages as { content: string }[])[1]?.content) ?? "";
      expect(shown).toContain(`"id":"r${MAX_RECORDS}"`);
      expect(shown).not.toContain(`"id":"r${MAX_RECORDS + 1}"`);
      return answering(JSON.stringify({ id: `r${MAX_RECORDS + 1}`, title: `Record ${MAX_RECORDS + 1} title` }))(
        "opening-title",
        request,
        {},
      );
    };
    expect((await readOpeningTitle(many, { gateway })).title).toBeNull();
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
