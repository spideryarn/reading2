// @vitest-environment jsdom
/**
 * **Sources › Links' rows** — src/web/outbound-links.ts. Plan
 * docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md.
 *
 * The last block runs the same fixtures through chat's `articleLinks`
 * (src/chat-tools.ts), the first parse of the article's links and the scope
 * check behind `/api/link-preview`: the two must agree on which external
 * addresses an article has, bar the one deliberate difference (an address
 * carrying a user name or password, which this list does not draw).
 */
import { describe, expect, it } from "vitest";
import { articleLinks } from "../src/chat-tools.js";
import type { Block } from "../src/types.js";
import { describeLink, type ExternalPreview } from "../src/web/link-preview.js";
import { type LinkableWork, MAX_PHRASE_CHARS, outboundLinks, workAt } from "../src/web/outbound-links.js";

const SELF = "https://www.noemamag.com/the-mythology-of-conscious-ai/";
const b = (id: string, html: string) => ({ id, html });

describe("outboundLinks", () => {
  it("gives one row per address, in the order a reader first meets it", () => {
    const rows = outboundLinks(
      [
        b("spya-aaaaaa", '<p><a href="https://b.example/x">second</a> and <a href="https://a.example/">first</a></p>'),
        b("spya-bbbbbb", '<p>Again <a href="https://a.example/">first</a>.</p>'),
      ],
      SELF,
    );
    expect(rows.map((r) => r.url)).toEqual(["https://b.example/x", "https://a.example/"]);
    expect(rows[1]?.blockIds).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
  });

  it("keeps every phrase the article links one address under, each once", () => {
    const rows = outboundLinks(
      [
        b("spya-aaaaaa", '<p><a href="https://philpapers.org/rec/BUTAAT">Butlin et al.</a></p>'),
        b("spya-bbbbbb", '<p><a href="https://philpapers.org/rec/BUTAAT">the  report</a> and <a href="https://philpapers.org/rec/BUTAAT">Butlin et al.</a></p>'),
      ],
      SELF,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phrases).toEqual(["Butlin et al.", "the report"]);
    expect(rows[0]?.blockIds).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
  });

  it("says what the href says, through describeLink", () => {
    const [row] = outboundLinks([b("spya-aaaaaa", '<p><a href="https://arxiv.org/abs/2308.08708">a survey</a></p>')], SELF);
    expect(row?.preview).toMatchObject({ kind: "external", host: "arxiv.org", sameSite: false });
    expect(row?.preview.citation).toEqual({ label: "arXiv", id: "2308.08708" });
  });

  it("leaves out what goes nowhere outside the piece", () => {
    const rows = outboundLinks(
      [
        b(
          "spya-aaaaaa",
          '<p><a href="#spya-bbbbbb">that section</a>' +
            ' <a href="#fn1" data-spya-note-ref="spya-note-0000000001">1</a>' +
            ` <a href="${SELF}">this essay</a> <a href="${SELF}#spya-bbbbbb">here</a>` +
            ' <a href="mailto:x@y.z">write</a> <a href="javascript:alert(1)">go</a>' +
            ' <a href="https://ok.example/"><img src="https://ok.example/i.png" alt=""></a>' +
            ' <a href="https://user:pw@secret.example/">secret</a>' +
            ' <a href="">empty</a></p>',
        ),
      ],
      SELF,
    );
    expect(rows).toEqual([]);
  });

  it("resolves a relative href against the article's address, and drops it for an upload", () => {
    const html = [b("spya-aaaaaa", '<p><a href="/other">there</a></p>')];
    expect(outboundLinks(html, "https://example.com/essays/x").map((r) => r.url)).toEqual(["https://example.com/other"]);
    expect(outboundLinks(html, null)).toEqual([]);
  });

  it("ignores a <base> inside a block", () => {
    const rows = outboundLinks(
      [b("spya-aaaaaa", '<p><base href="https://evil.example/"><a href="/other">there</a></p>')],
      "https://example.com/x",
    );
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/other"]);
  });

  it("does not see markup that is only an attribute's value", () => {
    const rows = outboundLinks(
      [b("spya-aaaaaa", '<p data-note="&lt;a href=&quot;https://evil.example/&quot;&gt;x&lt;/a&gt;">a note</p>')],
      SELF,
    );
    expect(rows).toEqual([]);
  });

  it("clips a long phrase at a word, to chat's same 80-character limit", () => {
    const long = "word ".repeat(40).trim();
    const [row] = outboundLinks([b("spya-aaaaaa", `<p><a href="https://a.example/">${long}</a></p>`)], SELF);
    expect(row?.phrases[0]?.endsWith("…")).toBe(true);
    expect(row?.phrases[0]?.length).toBeLessThanOrEqual(MAX_PHRASE_CHARS + 1);
  });

  it("says nothing about leaving the site when the article came from nowhere", () => {
    const [row] = outboundLinks([b("spya-aaaaaa", '<p><a href="https://a.example/">a</a></p>')], null);
    expect(row?.preview.sameSite).toBeNull();
  });

  it("skips malformed hrefs without taking down the rest of the list", () => {
    const rows = outboundLinks(
      [b("spya-aaaaaa", '<p><a href="http://[">broken</a> <a href="https://ok.example/path">still here</a></p>')],
      "not an article URL",
    );
    expect(rows.map((row) => row.url)).toEqual(["https://ok.example/path"]);
  });
});

describe("workAt — the In Bibliography join", () => {
  const works: LinkableWork[] = [
    { id: "w1", url: "https://doi.org/10.1126/Science.aan8871", linkFrom: "doi" },
    { id: "w2", url: "https://scholar.google.com/scholar?q=Some+title", linkFrom: "search" },
    { id: "w3", url: "https://philpapers.org/rec/BUTAAT", linkFrom: "article" },
    { id: "w4", url: "https://arxiv.org/abs/2308.08708", linkFrom: "arxiv" },
    { id: "w5", linkFrom: "article" },
  ];
  const at = (url: string) => ({ url, preview: describeLink(url, SELF) as ExternalPreview });

  it("finds the work at the same address, ignoring a fragment", () => {
    expect(workAt(at("https://philpapers.org/rec/BUTAAT#abstract"), works)?.id).toBe("w3");
    expect(workAt(at("https://doi.org/10.1126/Science.aan8871"), works)?.id).toBe("w1");
  });

  it("finds the same paper at a publisher's DOI page, whatever the DOI's case", () => {
    /* Bibliography rewrites a publisher's DOI link to doi.org (src/bibliography.ts § fromAnchor). */
    expect(workAt(at("https://www.science.org/doi/10.1126/science.aan8871"), works)?.id).toBe("w1");
  });

  it("finds the same arXiv paper at its PDF, whatever the version", () => {
    expect(workAt(at("https://arxiv.org/pdf/2308.08708v3"), works)?.id).toBe("w4");
  });

  it("never matches a Scholar search, which is not an address the article gave", () => {
    expect(workAt(at("https://scholar.google.com/scholar?q=Some+title"), works)).toBeNull();
  });

  it("is null for an address no work has, and for a different paper", () => {
    expect(workAt(at("https://elsewhere.example/"), works)).toBeNull();
    expect(workAt(at("https://arxiv.org/abs/2308.08709"), works)).toBeNull();
  });

  it("ignores a malformed work address rather than throwing", () => {
    expect(
      workAt(at("https://elsewhere.example/"), [
        { id: "broken", url: "http://[", linkFrom: "doi" },
        ...works,
      ]),
    ).toBeNull();
  });
});

describe("agrees with chat's articleLinks on the external addresses", () => {
  /* The fixtures chat's own suite uses (tests/chat-tools.test.ts § articleLinks),
     and the corpus shapes this list draws. */
  const FIXTURES: Array<{ base: string | null; html: string }> = [
    { base: SELF, html: '<p>Google’s engineer <a href="https://www.washingtonpost.com/technology/2022/06/11/google-ai-lamda-blake-lemoine/">claimed</a> otherwise.</p>' },
    { base: SELF, html: `<p><a href="${SELF}">The Mythology Of Conscious AI</a> <a href="${SELF}?page=2">page two</a> <a href="#gone">that bit</a></p>` },
    { base: null, html: '<p><a href="mailto:x@y.z">write</a> <a href="javascript:alert(1)">go</a> <a href="tel:+15551234">ring</a> <a href="https://ok.example/">read</a></p>' },
    { base: "https://example.com/essays/x", html: '<p><a href="/other">there</a> <a HREF="https://UPPER.example/">loud</a></p>' },
    { base: null, html: '<p><a href="/other">there</a></p>' },
    { base: "https://example.com/x", html: '<p><base href="https://evil.example/"><a href="/other">there</a></p>' },
    { base: SELF, html: '<p><a href="https://ok.example/"><img src="x.png" alt=""></a> <a href="https://ok.example/">   </a></p>' },
  ];

  for (const [i, { base, html }] of FIXTURES.entries()) {
    it(`fixture ${i}`, () => {
      const block = { id: "spya-aaaaaa", html, text: html.replace(/<[^>]*>/g, "") } as unknown as Block;
      const chat = new Set(
        articleLinks([block], base ?? undefined)
          .map((l) => l.url)
          .filter((u): u is string => u !== null),
      );
      const ours = new Set(outboundLinks([block], base).map((r) => r.url));
      expect(ours).toEqual(chat);
    });
  }
});
