/**
 * **The full-page verification experiment, and the ways it could lie.**
 *
 * [`evals/debate/verify-fallback.ts`](../evals/debate/verify-fallback.ts)
 * answers one question — *would fetching the whole page have rescued the rows
 * the search extract lost?* — and two opposite builds follow from the two
 * answers. So the tests here are mostly about the answer being **wrong in the
 * cheap direction rather than the expensive one**: a page that could not be
 * fetched must never be counted as a page that lacks the words, and a PDF must
 * never be read as an empty document.
 *
 * **No network.** `fetchDocument` is driven through its own `fetchImpl` and
 * `resolve` seams, so every guard it makes still runs — the private-address
 * check has a test of its own here — and nothing opens a socket.
 * `tests/setup/no-provider-calls.ts` would refuse one anyway.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUDGET,
  fetchPages,
  headline,
  HOW_TO_READ,
  present,
  verifyFallback,
  verifyLines,
  visibleText,
} from "../evals/debate/verify-fallback.js";
import {
  fixtureFetch,
  fixtureFetchOptions,
  fixtureJournal,
  QUOTES,
  URLS,
} from "../evals/debate/verify-fixture.js";
import type { FetchLike } from "../src/fetch.js";

/**
 * The fixture journal against the fixture web, which is what most of these ask
 * about.
 *
 * **Memoised**, because every call parses four pages twice over with JSDOM and
 * the answer is deterministic. Nothing here mutates the report, and `asked` is
 * the same list every time; the tests that need a *different* run — a budget, a
 * private address — build their own.
 */
let shared: Promise<{ report: Awaited<ReturnType<typeof verifyFallback>>; asked: string[] }> | null = null;
function overTheFixture() {
  shared ??= (async () => {
    const web = fixtureFetch();
    const report = await verifyFallback({
      events: fixtureJournal(),
      fetchOptions: fixtureFetchOptions(web.impl),
    });
    return { report, asked: web.asked };
  })();
  return shared;
}

/** One check, by the row it came from. */
function at(
  report: Awaited<ReturnType<typeof verifyFallback>>,
  rowIndex: number,
  field: "sourceQuote" | "articleReferenceQuote" = "sourceQuote",
) {
  const found = report.checks.find((c) => c.rowIndex === rowIndex && c.field === field);
  if (!found) throw new Error(`no check for row ${String(rowIndex)} ${field}`);
  return found;
}

describe("visibleText", () => {
  it("does not offer a script's contents as something a reader saw", () => {
    const html = `<html><body><p>Nothing to see.</p><script>var quote = "the schedule collapses entirely";</script></body></html>`;
    const text = visibleText(html, "https://example.test/a");
    expect(text.wholeBody).not.toContain("the schedule collapses entirely");
  });

  it("does not offer a comment's contents either", () => {
    /* `Node.textContent` on an Element is its descendant *Text* nodes, so a
       comment is already invisible to it. Pinned rather than trusted: it is the
       difference between "the page says this" and "somebody's CMS left it in the
       markup". */
    const html = `<html><body><p>Nothing to see.</p><!-- the schedule collapses entirely --></body></html>`;
    const text = visibleText(html, "https://example.test/a");
    expect(text.wholeBody).not.toContain("the schedule collapses entirely");
  });

  it("keeps a section Readability throws away — which is why both haystacks are measured", () => {
    /* This is also the pin on the **two parses**. `Readability.parse()` mutates
       the document it is handed, so a whole-body read taken from that same DOM
       afterwards would be reading Readability's leftovers and agreeing with it
       by construction — which is exactly the disagreement being measured. Share
       one DOM between the two and this test goes red. */
    const html = `<html><body><article><h1>A piece</h1>${"<p>Body text that is long enough to be the article, repeated so Readability has a candidate to pick.</p>".repeat(
      6,
    )}</article><div id="comments" class="comments discussion"><p>A reader says the schedule collapses entirely.</p></div></body></html>`;
    const text = visibleText(html, "https://example.test/a");
    expect(text.readability ?? "").not.toContain("the schedule collapses entirely");
    expect(text.wholeBody).toContain("the schedule collapses entirely");
  });
});

describe("present", () => {
  it("uses the spaced matcher, so a word the model split in two is not a match", () => {
    /* `findQuote`'s forgiving pass deletes whitespace and would accept this.
       Production asks for `"spaced"` wherever a match is read as a claim that
       the model copied the text, and so does this. */
    expect(present("the loaf will fall apart in a week", "fall apart in a week")).toBe(true);
    expect(present("the loaf will fall apart in a week", "fall a part in a week")).toBe(false);
  });

  it("is false for a haystack that is not there, rather than throwing", () => {
    expect(present(null, "anything at all, at length")).toBe(false);
  });
});

describe("classifying against the provider extract", () => {
  it("counts a quotation the extract holds as one production already keeps", async () => {
    const { report } = await overTheFixture();
    expect(at(report, 0).klass).toBe("inExtract");
    expect(report.summary.inExtract).toBe(3);
  });

  it("never fetches a page whose quotation the extract already had", async () => {
    /* Stage F's ordering rule, F53: the extract first, and only a miss invokes
       the fallback. It is also what keeps the fetch count proportionate to the
       failures rather than to the rows. */
    const { asked } = await overTheFixture();
    expect(asked).not.toContain(URLS.inExtract);
  });

  it("fetches each page that does need it exactly once", async () => {
    const { asked } = await overTheFixture();
    expect(asked.length).toBe(new Set(asked).size);
    expect(asked.length).toBe(6);
  });

  it("keeps a two-word quotation out of the denominator, because no fetch could rescue it", async () => {
    const { report, asked } = await overTheFixture();
    expect(at(report, 8).klass).toBe("belowFloor");
    expect(at(report, 8).page).toBeNull();
    expect(report.summary.belowFloor).toBe(1);
    /* And it did not put its page on the fetch list either. */
    expect(asked).not.toContain(URLS.inExtract);
  });

  it("keeps a row citing an address the search never returned out of the denominator too", async () => {
    const { report, asked } = await overTheFixture();
    expect(at(report, 7).klass).toBe("noExtract");
    expect(report.summary.noExtract).toBe(1);
    expect(asked).not.toContain(URLS.uncited);
  });

  it("adds up: every quotation is in exactly one class", async () => {
    const { report } = await overTheFixture();
    const s = report.summary;
    expect(s.inExtract + s.observedFailures + s.noExtract + s.belowFloor).toBe(s.quotations);
  });
});

describe("the recovery question", () => {
  it("recovers a quotation the extract stopped short of and the article body holds", async () => {
    const { report } = await overTheFixture();
    expect(at(report, 1).klass).toBe("missingFromExtract");
    expect(at(report, 1).page?.recovered).toBe(true);
    expect(at(report, 1).page?.inReadability).toBe(true);
  });

  it("recovers a quotation that lives only in a comment thread — by whole-body text, not Readability", async () => {
    /* The whole reason both haystacks are measured. Readability extracts *the
       article* and discards exactly this. */
    const { report } = await overTheFixture();
    expect(at(report, 2).page?.inWholeBody).toBe(true);
    expect(at(report, 2).page?.inReadability).toBe(false);
    expect(report.summary.wholeBodyOnly).toBe(1);
  });

  it("does not recover a paraphrase, and says the page was genuinely read", async () => {
    const { report } = await overTheFixture();
    expect(at(report, 3).page?.outcome).toBe("ok");
    expect(at(report, 3).page?.recovered).toBe(false);
  });

  it("flags a quotation straddling a paragraph break as a textContent artefact rather than a paraphrase", async () => {
    /* `textContent` welds `<p>…day.</p><p>Never…</p>` into `day.Never`, so the
       words are on the page and in neither haystack. Reporting that as a
       paraphrase would defer Stage F for a DOM artefact. */
    const { report } = await overTheFixture();
    expect(at(report, 4).page?.recovered).toBe(false);
    expect(at(report, 4).page?.inSpacedBody).toBe(true);
    expect(report.summary.spacedBodyOnly).toBe(1);
  });

  it("puts the headline exactly the way the plan words it", async () => {
    const { report } = await overTheFixture();
    expect(headline(report.summary)).toBe("recovered 2 of 6 observed failures");
  });
});

describe("what must never be read as evidence about the model", () => {
  it("records a PDF as unsupported and never as a page without the words", async () => {
    /* `FetchedDocument.text` is `null` for a PDF. Reading that as `""` would
       answer "the quotation is not on this page" about a document nothing looked
       inside — F53 says so in as many words. */
    const { report } = await overTheFixture();
    expect(at(report, 5).page?.outcome).toBe("unsupported");
    expect(at(report, 5).page?.inReadability).toBe(false);
    expect(at(report, 5).page?.inWholeBody).toBe(false);
    expect(at(report, 5).page?.recovered).toBe(false);
  });

  it("records a dead link as not-found", async () => {
    const { report } = await overTheFixture();
    expect(at(report, 6).page?.outcome).toBe("not-found");
  });

  it("counts every unfetchable page as `not attempted`, never as `not recovered`", async () => {
    const { report } = await overTheFixture();
    const s = report.summary;
    expect(s.notAttempted).toBe(2);
    expect(s.notRecovered).toBe(2);
    expect(s.recovered + s.notRecovered + s.notAttempted).toBe(s.observedFailures);
  });

  it("keeps `fetchDocument`'s private-address guard, and calls what it refuses `blocked`", async () => {
    /* The safety rule is that fetching goes through `fetchDocument` and never a
       bare `fetch`. This is what proves it: point the injected resolver at a
       private address and every page is refused before a request is made. */
    const web = fixtureFetch();
    const report = await verifyFallback({
      events: fixtureJournal(),
      fetchOptions: { ...fixtureFetchOptions(web.impl), resolve: async () => ["10.0.0.5"] },
    });
    expect(web.asked).toEqual([]);
    expect(report.summary.outcomes.blocked).toBe(6);
    expect(report.summary.notAttempted).toBe(6);
    expect(report.summary.notRecovered).toBe(0);
    expect(headline(report.summary)).toBe("recovered 0 of 6 observed failures");
  });
});

describe("the whole-run budget", () => {
  it("stops dispatching at the fetch cap and names the rest `budget-exhausted`", async () => {
    const web = fixtureFetch();
    const report = await verifyFallback({
      events: fixtureJournal(),
      fetchOptions: fixtureFetchOptions(web.impl),
      budget: { maxFetches: 2, concurrency: 1 },
    });
    expect(web.asked.length).toBe(2);
    expect(report.summary.outcomes["budget-exhausted"]).toBe(4);
    expect(report.summary.notRecovered).toBe(0);
    expect(report.summary.notAttempted).toBe(4);
  });

  it("stops on elapsed time too, without billing the request it then refuses", async () => {
    const web = fixtureFetch();
    let clock = 0;
    const report = await verifyFallback({
      events: fixtureJournal(),
      fetchOptions: fixtureFetchOptions(web.impl),
      budget: { maxElapsedMs: 10, concurrency: 1 },
      /* Each read of the clock advances it, so the budget is spent part-way
         through rather than before the first fetch. */
      now: () => (clock += 6),
    });
    expect(web.asked.length).toBeLessThan(6);
    expect(report.summary.outcomes["budget-exhausted"]).toBeGreaterThan(0);
  });

  it("has a default budget with every ceiling set", () => {
    for (const [name, value] of Object.entries(DEFAULT_BUDGET)) {
      expect(Number.isFinite(value), `${name} must be a real ceiling`).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it("fetches one page per distinct URL, however many rows cite it", async () => {
    const twice: FetchLike = async () =>
      new Response("<html><body><p>Hello.</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const seen: string[] = [];
    const pages = await fetchPages([URLS.paraphrase, URLS.paraphrase, URLS.blockJoin], {
      fetchOptions: {
        fetchImpl: async (url, init) => {
          seen.push(url);
          return await twice(url, init);
        },
        resolve: async () => ["93.184.216.34"],
        attempts: 1,
      },
    });
    expect(seen.length).toBe(2);
    expect(pages.size).toBe(2);
  });
});

describe("what a journal contributes, and what it does not", () => {
  it("reads the direct pass and refuses to read the claims pass, saying why", async () => {
    const { report } = await overTheFixture();
    const direct = report.attempts.find((a) => a.attemptId === "direct-1");
    const claims = report.attempts.find((a) => a.attemptId === "claims-1");
    expect(direct?.skipped).toBeNull();
    expect(direct?.reportedRows).toBe(9);
    expect(claims?.skipped).toContain("not a direct pass");
  });

  it("names an attempt that never heard back rather than counting it as empty", async () => {
    const { report } = await overTheFixture();
    expect(report.attempts.find((a) => a.attemptId === "dead-1")?.skipped).toContain("never heard back");
  });

  it("reports nothing at all for an empty journal, and does not call that a zero recovery", async () => {
    const report = await verifyFallback({ events: [] });
    expect(report.summary.quotations).toBe(0);
    expect(report.summary.observedFailures).toBe(0);
    expect(headline(report.summary)).toBe("recovered 0 of 0 observed failures");
  });
});

describe("what the report may print", () => {
  it("prints the zero-recoveries caveat rather than leaving it in a comment", async () => {
    const { report } = await overTheFixture();
    const printed = verifyLines(report).join("\n");
    for (const sentence of HOW_TO_READ) expect(printed).toContain(sentence);
    expect(printed).toContain(
      "Zero recoveries defers Stage F and does NOT establish that full-page fetching can never help.",
    );
  });

  it("names hosts and never a full URL", async () => {
    const { report } = await overTheFixture();
    const printed = verifyLines(report).join("\n");
    for (const url of Object.values(URLS)) expect(printed).not.toContain(url);
    expect(printed).toContain("slowrise.example");
  });

  it("never prints a quotation, an extract, or a line of anybody's prose", async () => {
    const { report } = await overTheFixture();
    const printed = verifyLines(report).join("\n");
    for (const quote of Object.values(QUOTES)) expect(printed).not.toContain(quote);
  });

  it("says how many attempts contributed nothing, so the denominator is not read as the whole journal", async () => {
    const { report } = await overTheFixture();
    expect(verifyLines(report).join("\n")).toContain("The denominator is not the whole journal");
  });
});
