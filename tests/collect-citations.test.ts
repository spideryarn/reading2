/**
 * `collectCitations` — src/openrouter-stream.ts.
 *
 * The rules a model's `annotations` are read by, which chat and explain kept a
 * byte-identical copy of each until 2026-08-28. This file exists because the
 * *reason* to merge them was that a fix to one would not have reached the other,
 * and the only way that stays true is if the rules are pinned in one place.
 *
 * **These are characterisation tests, not a specification.** Every case here was
 * written against the two copies and passed against them before the extraction;
 * where the behaviour is arguably wrong it is pinned as it is, and the case says
 * so. The end-to-end half — that the wire still reaches this function at all —
 * is in tests/explain.test.ts § citations, deliberately kept there: a pure
 * function passing its unit tests says nothing about whether anything calls it.
 *
 * See docs/project/security.md § "`Citation.url` becomes an `href`" for why the
 * scheme check is here rather than only at the render, and
 * docs/project/logging.md for why the drop is reported without the URL.
 */
import { describe, expect, it, vi } from "vitest";
import { collectCitations } from "../src/openrouter-stream.js";
import type { Citation } from "../src/types.js";

const cite = (url: string, title?: string) => ({
  type: "url_citation",
  url_citation: { url, ...(title === undefined ? {} : { title }) },
});

/** What a caller does: one map for the whole answer, drained once at the end. */
const collect = (annotations: unknown[], onDropped?: () => void): Citation[] => {
  const into = new Map<string, Citation>();
  collectCitations(annotations as Parameters<typeof collectCitations>[0], into, onDropped);
  return [...into.values()];
};

describe("collectCitations", () => {
  it("keeps an http(s) citation, with its title when it has one", () => {
    expect(collect([cite("https://a.test", "A page"), cite("http://b.test")])).toEqual([
      { url: "https://a.test", title: "A page" },
      { url: "http://b.test" },
    ]);
  });

  /* `toStrictEqual`, not `toEqual`: the citation is stored, and `toEqual` treats
     an explicit `title: undefined` as equal to no title at all. The spread that
     omits the key is the thing under test, so the assertion has to be able to
     see the difference. */
  it("omits the title key entirely rather than storing undefined", () => {
    expect(collect([cite("https://a.test")])).toStrictEqual([{ url: "https://a.test" }]);
  });

  it("keeps one entry per url, however many sentences it grounded", () => {
    const got = collect([cite("https://a.test", "First"), cite("https://a.test", "Second")]);
    expect(got).toEqual([{ url: "https://a.test", title: "First" }]);
  });

  it("refuses a URL that is not http(s), and tells the caller once per sighting", () => {
    const dropped = vi.fn();
    const got = collect(
      [cite("javascript:alert(1)"), cite("data:text/html,<script>"), cite("https://ok.test")],
      dropped,
    );
    expect(got).toEqual([{ url: "https://ok.test" }]);
    expect(dropped).toHaveBeenCalledTimes(2);
  });

  /* A refused URL never enters the map, so the dedupe cannot suppress its second
     sighting and the caller is told twice about one bad page. Pinned rather than
     defended: the two copies did this, the log line is rare and carries no URL,
     and quietening it would mean keeping a second set of the URLs we refused to
     keep. */
  it("reports the same bad URL again if the model cites it twice", () => {
    const dropped = vi.fn();
    expect(collect([cite("javascript:a"), cite("javascript:a")], dropped)).toEqual([]);
    expect(dropped).toHaveBeenCalledTimes(2);
  });

  /* `type` is the discriminator, not the presence of `url_citation`.
     `annotations` is a list OpenRouter adds to, and a new member arriving with a
     URL-shaped payload must not be read as a source the model consulted. */
  it("ignores an annotation of another type even when it carries a url_citation", () => {
    const dropped = vi.fn();
    expect(collect([{ type: "file_citation", url_citation: { url: "https://x.test" } }], dropped)).toEqual([]);
    expect(dropped).not.toHaveBeenCalled();
  });

  /* Not a drop: nothing was refused, there was nothing there. The caller's
     warning says a citation was thrown away, and it would be false here. */
  it("ignores a url_citation with no url, and does not call it a drop", () => {
    const dropped = vi.fn();
    expect(collect([{ type: "url_citation" }, { type: "url_citation", url_citation: {} }], dropped)).toEqual([]);
    expect(dropped).not.toHaveBeenCalled();
  });

  /** Most deltas of a stream have no annotations at all. */
  it("does nothing with an absent annotations list", () => {
    const into = new Map<string, Citation>();
    expect(() => collectCitations(undefined, into)).not.toThrow();
    expect(into.size).toBe(0);
  });

  /**
   * The accumulator is the caller's because a streamed answer arrives in pieces
   * and chat's spans several model rounds. A page cited in one delta must not be
   * cited again in the next.
   */
  it("dedupes across calls, because that is how a stream arrives", () => {
    const into = new Map<string, Citation>();
    collectCitations([cite("https://a.test", "A")], into);
    collectCitations([cite("https://a.test", "A"), cite("https://b.test")], into);
    expect([...into.values()]).toEqual([{ url: "https://a.test", title: "A" }, { url: "https://b.test" }]);
  });

  it("does not require a callback to refuse a URL", () => {
    expect(() => collect([cite("javascript:alert(1)")])).not.toThrow();
  });
});
