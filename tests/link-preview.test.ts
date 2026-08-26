/**
 * What a link card can say for free — src/web/link-preview.ts.
 *
 * The pure half of the hover cards on the article's own hyperlinks. Everything
 * here is a string in and a shape out, which is why it is the part with tests:
 * the hover machine around it is timers and a delegated listener, and
 * docs/project/glossary.md § What is still open says plainly that it has none.
 */
import { describe, expect, it } from "vitest";
import { describeLink } from "../src/web/link-preview.js";

const NOEMA = "https://www.noemamag.com/the-mythology-of-conscious-ai/";

describe("describeLink", () => {
  it("calls a fragment an anchor, which the view resolves itself", () => {
    // `#…` is the article pointing at its own sections. Nothing in the href
    // says where that is; internal-links.ts answers that against the document.
    expect(describeLink("#spya-k3m9qt", NOEMA).kind).toBe("anchor");
  });

  it("names the host without www", () => {
    const out = describeLink("https://www.arxiv.org/abs/2401.00001", NOEMA);
    expect(out.kind).toBe("external");
    if (out.kind !== "external") return;
    expect(out.host).toBe("arxiv.org");
  });

  it("says when a link stays on the publication the article came from", () => {
    // The fact the bare host cannot give you: you have to know where you are.
    const out = describeLink("https://www.noemamag.com/some-other-essay/", NOEMA);
    expect(out.kind === "external" && out.sameSite).toBe(true);
  });

  it("says when it leaves", () => {
    const out = describeLink("https://arxiv.org/abs/2401.00001", NOEMA);
    expect(out.kind === "external" && out.sameSite).toBe(false);
  });

  it("answers null rather than false when the article has no source host", () => {
    /* An uploaded PDF came from nowhere on the web, so "does this leave the
       site" has no answer. Null and false are different, and a card that
       printed "leaves noemamag.com" for an article that has no host would be
       inventing the one fact this field exists to supply. */
    const out = describeLink("https://arxiv.org/abs/2401.00001", null);
    expect(out.kind === "external" && out.sameSite).toBe(null);
  });

  it("matches a subdomain against the bare host", () => {
    const out = describeLink("https://blog.example.com/x", "https://example.com/piece");
    expect(out.kind === "external" && out.sameSite).toBe(true);
  });

  it("names a PDF, because following a link is a rude way to find that out", () => {
    const out = describeLink("https://example.com/papers/whatever.pdf", NOEMA);
    expect(out.kind === "external" && out.file).toBe("PDF");
  });

  it("does not name HTML, which tells the reader what they already assumed", () => {
    const out = describeLink("https://example.com/papers/whatever.html", NOEMA);
    expect(out.kind === "external" && out.file).toBe(null);
  });

  it("keeps the words in a path and drops the filing system", () => {
    const out = describeLink("https://example.com/2024/03/the-title-of-the-piece", NOEMA);
    expect(out.kind === "external" && out.trail).toEqual(["the title of the piece"]);
  });

  it("drops a path that is only structure", () => {
    // philpapers.org/rec/BUTAAT — `rec` is the site's filing, and the record id
    // is not a word. Better to say nothing than to print noise under the host.
    const out = describeLink("https://philpapers.org/rec/12345", NOEMA);
    expect(out.kind === "external" && out.trail).toEqual([]);
  });

  it("survives a segment that is not valid percent-encoding", () => {
    // `decodeURIComponent` throws on a stray `%`, and one bad segment must not
    // take the whole card down with it.
    expect(() => describeLink("https://example.com/100%-of-it", NOEMA)).not.toThrow();
  });

  /* ------------------------------------------- the real corpus, not invented --
     Every distinct destination shape in data/, checked against what the card
     should say. **This table exists because the first version of the filter was
     wrong about the commonest host in it.** It dropped a segment only when the
     whole thing was digits, which is true of `/2024/03/` and false of nearly
     every real identifier — so `philpapers.org/rec/SHATRA-2` printed "SHATRA 2"
     under the host as though it were a title, and philpapers is the single most
     linked-to site in this corpus. Caught by a browser pass, 2026-08-27, not by
     the tests above, which had used a numeric id and so agreed with the bug. */
  describe("against every link shape in the corpus", () => {
    const KEEP: [string, string][] = [
      ["https://en.wikipedia.org/wiki/Antikythera_mechanism", "Antikythera mechanism"],
      ["https://plato.stanford.edu/entries/whitehead/", "whitehead"],
      ["https://consc.net/papers/qualia.html", "qualia"],
      ["https://bostonreview.net/articles/could-a-large-language-model-be-conscious/",
        "could a large language model be conscious"],
      ["https://www.berggruen.org/eu/news/2025-berggruen-prize-essay-competition-winners",
        "2025 berggruen prize essay competition winners"],
      ["https://www.cs.virginia.edu/~robins/Turing_Paper_1936.pdf", "Turing Paper 1936"],
      ["https://mitpress.mit.edu/9780262512398/on-the-origins-of-cognitive-science/",
        "on the origins of cognitive science"],
      ["https://profilebooks.com/work/the-idea-of-the-brain/", "the idea of the brain"],
    ];
    for (const [url, expected] of KEEP) {
      it(`keeps the words in ${new URL(url).hostname}`, () => {
        const out = describeLink(url, NOEMA);
        expect(out.kind === "external" && out.trail.join(" › ")).toContain(expected);
      });
    }

    const DROP = [
      "https://philpapers.org/rec/SHATRA-2", // the one that was wrong
      "https://philpapers.org/rec/NAGWII",
      "https://philpapers.org/rec/VARTSP",
      "https://arxiv.org/abs/2411.00986v1",
      "https://www.nature.com/articles/s41928-020-0448-2",
      "https://www.pnas.org/doi/10.1073/pnas.2306525120",
      "https://www.semanticscholar.org/paper/a496212ca3444e1e14b0668b82e2459d02dc275a",
      "https://www.youtube.com/watch",
    ];
    for (const url of DROP) {
      it(`says nothing about the path of ${new URL(url).pathname}`, () => {
        const out = describeLink(url, NOEMA);
        expect(out.kind === "external" && out.trail).toEqual([]);
      });
    }

    it("still names the PDF behind an unreadable path", () => {
      // The path says nothing, but "this is a PDF" is worth saying anyway —
      // the two facts are independent and only one of them needs words.
      const out = describeLink("https://www.cs.ox.ac.uk/activities/ieg/e-library/sources/t_article.pdf", NOEMA);
      expect(out.kind === "external" && out.file).toBe("PDF");
    });
  });

  it("hands a mailto: back as itself rather than pretending it is a page", () => {
    const out = describeLink("mailto:someone@example.com", NOEMA);
    expect(out.kind).toBe("other");
    expect(out.kind === "other" && out.scheme).toBe("mailto");
  });

  it("does not throw on an href that is not a URL at all", () => {
    /* Stage 3 absolutises what it can against the article's own address, so a
       still-relative href here has no base — we genuinely do not know where it
       goes, and saying so beats guessing a host. */
    const out = describeLink("../elsewhere", NOEMA);
    expect(out.kind).toBe("other");
  });
});
