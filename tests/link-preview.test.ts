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

  /* --------------------------------------------------------- citations --
     The answer to the trail rule's own complaint. The block above deletes
     `SHATRA-2` and `10.1073/pnas.2306525120` for not reading as words, which
     is right about the words and wrong about the value — a catalogue key is
     exactly the thing you paste into a search box. Every URL below is one that
     block drops, taken from the corpus, so the two rules are tested against
     each other rather than in isolation. */
  describe("the identifier a path is carrying", () => {
    const CITED: [string, string, string][] = [
      ["https://arxiv.org/abs/0706.3639", "arXiv", "0706.3639"],
      // The version suffix stays: v1 and v3 are different papers to anyone who
      // has read both, and dropping it would claim the reader is being sent to
      // the latest.
      ["https://arxiv.org/abs/2411.00986v1", "arXiv", "2411.00986v1"],
      ["https://arxiv.org/pdf/2212.13345.pdf", "arXiv", "2212.13345"],
      // Legacy ids, where the archive is *part of* the identifier. Taking the
      // last path segment gave `0301234`, which names nothing.
      ["https://arxiv.org/abs/math/0301234", "arXiv", "math/0301234"],
      [
        "https://arxiv.org/abs/cond-mat.stat-mech/0703470",
        "arXiv",
        "cond-mat.stat-mech/0703470",
      ],
      ["https://philpapers.org/rec/SHATRA-2", "PhilPapers", "SHATRA-2"],
      ["https://philpapers.org/rec/NAGWII", "PhilPapers", "NAGWII"],
      ["https://doi.org/10.1073/pnas.2306525120", "DOI", "10.1073/pnas.2306525120"],
      // The five in this corpus that carry a DOI behind a publisher's own
      // routing. Finding one mid-path is the whole reason the registrant rule
      // (`10.` then 4–9 digits) is worth spelling out.
      ["https://www.pnas.org/doi/10.1073/pnas.2306525120", "DOI", "10.1073/pnas.2306525120"],
      ["https://www.science.org/doi/10.1126/science.aan8871", "DOI", "10.1126/science.aan8871"],
      [
        "https://link.springer.com/article/10.1007/s11229-022-03524-1",
        "DOI",
        "10.1007/s11229-022-03524-1",
      ],
      ["https://link.springer.com/book/10.1007/978-94-009-8947-4", "DOI", "10.1007/978-94-009-8947-4"],
    ];
    for (const [url, label, id] of CITED) {
      it(`reads ${label} ${id} out of ${new URL(url).pathname}`, () => {
        const out = describeLink(url, NOEMA);
        expect(out.kind === "external" && out.citation).toEqual({ label, id });
      });
    }

    const UNCITED = [
      // A year is not a registrant: `10.` has to be followed by four to nine
      // digits and then a slash, which is the DOI registry's own rule.
      "https://example.com/10.5/x",
      "https://example.com/2024/03/the-title-of-the-piece",
      // A bare DOI prefix with nothing after it identifies nothing.
      "https://doi.org/10.1073",
      "https://www.sciencedirect.com/science/article/pii/S1364661313002118",
      "https://philpapers.org/browse/philosophy-of-mind",
      /* arXiv pages that are not a paper. The first version labelled these
         "arXiv search" and "arXiv new" — not merely useless but confidently
         wrong, since the reader has no way to tell an invented id from a real
         one. Found by a GPT Sol review, 2026-08-27. */
      "https://arxiv.org/search",
      "https://arxiv.org/list/cs.AI/new",
      "https://arxiv.org/abs/not-an-id",
      "https://arxiv.org/abs/12.34",
      "https://www.noemamag.com/the-mythology-of-conscious-ai/",
    ];
    for (const url of UNCITED) {
      it(`claims no identifier for ${new URL(url).pathname}`, () => {
        const out = describeLink(url, NOEMA);
        expect(out.kind === "external" && out.citation).toBe(null);
      });
    }
  });

  /* --------------------------------------------------------- wikipedia --
     Deciding *whether* a URL names a Wikipedia article is reading an href, so
     it lives here rather than in the fetching code — link-facts.ts is handed a
     title and never parses a URL a second time. */
  describe("naming a wikipedia article", () => {
    it("reads the language and the title, underscores and all", () => {
      /* The underscores stay: the summary API wants the title in the form the
         URL spells it, and turning them into spaces here would only mean
         turning them back there. This is the one real Wikipedia link in the
         corpus. */
      const out = describeLink("https://en.wikipedia.org/wiki/Antikythera_mechanism", NOEMA);
      expect(out.kind === "external" && out.wiki).toEqual({
        lang: "en",
        title: "Antikythera_mechanism",
      });
    });

    it("decodes a percent-encoded title", () => {
      const out = describeLink("https://fr.wikipedia.org/wiki/Ph%C3%A9nom%C3%A9nologie", NOEMA);
      expect(out.kind === "external" && out.wiki).toEqual({
        lang: "fr",
        title: "Phénoménologie",
      });
    });

    it("takes the mobile host too", () => {
      const out = describeLink("https://en.m.wikipedia.org/wiki/Qualia", NOEMA);
      expect(out.kind === "external" && out.wiki?.title).toBe("Qualia");
    });

    const NOT_AN_ARTICLE = [
      // The namespaces. The summary endpoint answers oddly or not at all for
      // these, and a colon is what they all have in common — at the cost of the
      // handful of real titles containing one, which lose the extra section and
      // keep the ordinary card.
      "https://en.wikipedia.org/wiki/Special:Random",
      "https://en.wikipedia.org/wiki/Talk:Consciousness",
      "https://en.wikipedia.org/wiki/File:Antikythera.jpg",
      // Not an article page at all.
      "https://en.wikipedia.org/w/index.php",
      "https://www.wikidata.org/wiki/Q42",
      "https://en.wikipedia.org/wiki/Portal/Contents/Overviews",
    ];
    for (const url of NOT_AN_ARTICLE) {
      it(`does not offer to look up ${url.replace(/^https:\/\//, "")}`, () => {
        const out = describeLink(url, NOEMA);
        expect(out.kind === "external" && out.wiki).toBe(null);
      });
    }

    it("claims nothing for a host that merely mentions wikipedia", () => {
      const out = describeLink("https://wikipedia.org.evil.test/wiki/Qualia", NOEMA);
      expect(out.kind === "external" && out.wiki).toBe(null);
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
