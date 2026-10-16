/**
 * **`SUGGESTS_UPLOAD` and the sentences it stands for cannot drift apart.**
 *
 * The add page draws an upload control under a failed import whose code is in
 * the set (src/web/AddPage.tsx § `UploadInstead`). A code in the set whose
 * sentence no longer says upload would offer a control the sentence does not
 * explain; a sentence that says upload without its code in the set would tell
 * the reader to do something the page gives them no way to do from there.
 * docs/plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md.
 */
import { describe, expect, it } from "vitest";
import type { FetchFailureCode } from "../src/fetch.js";
import {
  codeOfMessage,
  documentIsABotCheck,
  FETCH_PAPER_MISSING,
  failureSuggestsUpload,
  fetchFailed,
  SUGGESTS_UPLOAD,
} from "../src/messages.js";

/** A `Record` over the union, so a new code is a red typecheck here. */
const ALL: Record<FetchFailureCode, true> = {
  "invalid-url": true,
  "unsupported-scheme": true,
  "blocked-address": true,
  dns: true,
  connection: true,
  certificate: true,
  timeout: true,
  "too-many-redirects": true,
  unauthorized: true,
  forbidden: true,
  "not-found": true,
  "rate-limited": true,
  "server-error": true,
  "http-error": true,
  "too-large": true,
  "unsupported-type": true,
  empty: true,
};

/** Every sentence an import from an address can fail with that names a way round. */
const SENTENCES: string[] = [
  ...(Object.keys(ALL) as FetchFailureCode[]).flatMap((code) =>
    code === "http-error"
      ? [fetchFailed(code, 403).message, fetchFailed(code, 500).message]
      : [fetchFailed(code, null).message],
  ),
  FETCH_PAPER_MISSING.message,
  documentIsABotCheck("url").message,
];

const saysUpload = (message: string) => /\bupload/i.test(message);

describe("SUGGESTS_UPLOAD", () => {
  for (const message of SENTENCES) {
    const code = codeOfMessage(message);
    it(`[${code}] is in the set exactly when its sentence says upload`, () => {
      expect(code).not.toBeNull();
      expect(SUGGESTS_UPLOAD.has(code as string)).toBe(saysUpload(message));
    });
  }

  it("names no code that none of those sentences carries", () => {
    const carried = new Set(SENTENCES.map(codeOfMessage));
    expect([...SUGGESTS_UPLOAD].filter((code) => !carried.has(code))).toEqual([]);
  });

  it("is read off a stored message's bracketed code, and nothing else", () => {
    expect(failureSuggestsUpload(fetchFailed("forbidden", 403).message)).toBe(true);
    expect(failureSuggestsUpload(documentIsABotCheck("url").message)).toBe(true);
    expect(failureSuggestsUpload(fetchFailed("timeout", null).message)).toBe(false);
    expect(failureSuggestsUpload(documentIsABotCheck("upload").message)).toBe(false);
    expect(failureSuggestsUpload("Something went wrong, upload it. [jb-made-up]")).toBe(false);
    expect(failureSuggestsUpload(undefined)).toBe(false);
  });
});
