/**
 * **A fetched PDF has no text, a fetched web page always has some, and the
 * compiler is what says so.**
 *
 * `FetchedDocument` was one interface with `kind`, `text: string | null` and
 * `encoding: string | null` side by side, so a PDF carrying text and a web page
 * carrying `null` both type-checked. Nothing produced either, but
 * `storedDocumentBytes` covered the second with `doc.text ?? ""` — which would
 * have stored an empty document under a real hash and said nothing.
 * docs/plans/261004d-sweep-cluster-17-boundary-types-and-false-comments.md.
 *
 * The checks here are `npm run typecheck`'s, not vitest's: vitest does not
 * type-check, and the `@ts-expect-error` lines are what fail if the union is
 * ever flattened again ("Unused '@ts-expect-error' directive"). The `it` is
 * there so the file is a suite, and to check the one runtime rule beside it.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { storedDocumentBytes, type FetchedDocument } from "../src/fetch.js";

const common = {
  requestedUrl: "https://example.test/a",
  url: "https://example.test/a",
  chain: ["https://example.test/a"],
  status: 200,
  contentType: null,
  bytes: new Uint8Array([1, 2, 3]),
  fetchedAt: "2026-10-04T10:00:00.000Z",
};

/** Never called: it exists to be compiled. */
function shapesTheCompilerMustRefuse(): FetchedDocument[] {
  return [
    // @ts-expect-error — a PDF has no decoded text.
    { ...common, kind: "pdf", text: "words", encoding: null },
    // @ts-expect-error — nor an encoding.
    { ...common, kind: "pdf", text: null, encoding: "utf-8" },
    // @ts-expect-error — a web page always has its text.
    { ...common, kind: "html", text: null, encoding: "utf-8" },
    // @ts-expect-error — and the encoding it was decoded with.
    { ...common, kind: "html", text: "<p>words</p>", encoding: null },

    { ...common, kind: "pdf", text: null, encoding: null },
    { ...common, kind: "html", text: "<p>words</p>", encoding: "utf-8" },
  ];
}

/** Never called either. */
function argumentsTheCompilerMustRefuse(): void {
  /* Keep `bytes` present, as the old signature required it. A variable avoids
     an excess-property error on the new HTML arm masking acceptance of null. */
  const htmlWithNullText = { kind: "html" as const, bytes: common.bytes, text: null };
  // @ts-expect-error — a web page is stored from its text, so the text is required.
  storedDocumentBytes({ kind: "html", bytes: common.bytes });
  // @ts-expect-error — and `null` is not text.
  storedDocumentBytes(htmlWithNullText);
  // @ts-expect-error — a PDF is stored from its bytes.
  storedDocumentBytes({ kind: "pdf", text: null });
}

describe("FetchedDocument", () => {
  it("is narrowed by `kind`, so `text` needs no null check after it", () => {
    expectTypeOf(shapesTheCompilerMustRefuse).toBeFunction();
    expectTypeOf(argumentsTheCompilerMustRefuse).toBeFunction();
    expectTypeOf<Extract<FetchedDocument, { kind: "html" }>["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Extract<FetchedDocument, { kind: "html" }>["encoding"]>().toEqualTypeOf<string>();
    expectTypeOf<Extract<FetchedDocument, { kind: "pdf" }>["text"]>().toEqualTypeOf<null>();
  });

  it("stores a web page's decoded text and a PDF's own bytes", () => {
    expect(new TextDecoder().decode(storedDocumentBytes({ kind: "html", text: "“hi”" }))).toBe("“hi”");
    expect(storedDocumentBytes({ kind: "pdf", bytes: common.bytes })).toBe(common.bytes);
  });
});
