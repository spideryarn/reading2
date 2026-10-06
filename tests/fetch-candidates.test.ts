/**
 * **The fetch step tries a paper source's addresses in order, and moves on only
 * when the source says it has no such document.**
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § Caller 2. The loop is `fetchFirstCandidate` in src/pipeline.ts, and it takes
 * its candidates as an argument, so these cases hand it two even while arXiv
 * ships one.
 *
 * Almost every case goes through the **real** `fetchDocument` over an injected
 * network, so a 404, a 503, a private address and an oversized body are
 * classified by the fetcher itself and not by a guess here at what it throws.
 * Two counts are kept: `asked`, the candidates tried, and `requested`, the
 * addresses that reached the network.
 *
 * Failures are matched on their bracketed code and kind, never on the prose
 * (docs/project/copy.md § The bracketed code).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchFailure, type FetchedDocument, type FetchOptions } from "../src/fetch.js";
import { declaredFailure } from "../src/job-failure.js";
import { codeOfMessage, fetchFailed } from "../src/messages.js";
import { type FetchCandidate, fetchDetail, fetchFirstCandidate, STEPS } from "../src/pipeline.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

/** The seam tests/fetch-failure-sentences.test.ts uses: the real fetcher, plus an injected network. */
const network: { seams: FetchOptions | null } = { seams: null };

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchDocument: async (url: string, options: FetchOptions = {}) =>
      real.fetchDocument(url, { ...options, ...(network.seams ?? {}) }),
  };
});

const { fetchDocument: realFetchDocument } = await vi.importActual<typeof import("../src/fetch.js")>("../src/fetch.js");

afterEach(() => {
  network.seams = null;
});

const HTML_ADDRESS = "https://arxiv.org/html/2608.13566";
const PDF_ADDRESS = "https://arxiv.org/pdf/2608.13566";

/** arXiv's two renderings, HTML first: the order a later stage of the plan ships. */
const HTML_THEN_PDF: readonly FetchCandidate[] = [
  { url: HTML_ADDRESS, expect: "html", marker: "ltx_document" },
  { url: PDF_ADDRESS, expect: "pdf" },
];

const pdf = () =>
  new Response(new TextEncoder().encode("%PDF-1.4\n% a paper\n") as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });

const page = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const PAPER_PAGE = '<!doctype html><html><body><article class="ltx_document"><p>The paper.</p></article></body></html>';
const ERROR_PAGE = "<!doctype html><html><body><h1>No HTML for this paper</h1></body></html>";

const status = (code: number) => () => new Response("no", { status: code, headers: { "content-type": "text/html" } });

/** A network that answers each address from a script, and the two counts. */
function scripted(
  script: Record<string, () => Response | Promise<Response>>,
  options: FetchOptions = {},
  signal: AbortSignal = new AbortController().signal,
) {
  const asked: string[] = [];
  const requested: string[] = [];
  const seams: FetchOptions = {
    attempts: 1,
    sleep: async () => {},
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async (url) => {
      requested.push(url);
      const respond = script[url];
      if (!respond) throw new Error(`the test network has no answer for ${url}`);
      return respond();
    },
    ...options,
  };
  const deps = {
    signal,
    fetchDocument: (url: string, given: { signal: AbortSignal }) => {
      asked.push(url);
      return realFetchDocument(url, { ...given, ...seams });
    },
  };
  return { asked, requested, deps };
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  const thrown = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(thrown, "the fetch succeeded").toBeInstanceOf(Error);
  return thrown as Error;
}

/** The bracketed code on the sentence a failure declared. */
function codeOf(err: Error): string | null {
  const failure = declaredFailure(err);
  expect(failure, "the failure declared no reader's sentence").not.toBeNull();
  return codeOfMessage(failure?.message ?? "");
}

describe("the candidates of a paper source, in order", () => {
  it("uses the first when it is there and is what it promised, with one request", async () => {
    const net = scripted({ [HTML_ADDRESS]: () => page(PAPER_PAGE), [PDF_ADDRESS]: pdf });
    const { doc, candidate, tried } = await fetchFirstCandidate(HTML_THEN_PDF, net.deps);
    expect(doc.kind).toBe("html");
    expect(candidate.url).toBe(HTML_ADDRESS);
    expect(tried).toBe(1);
    expect(net.requested).toEqual([HTML_ADDRESS]);
  });

  for (const gone of [404, 410]) {
    it(`moves on to the second when the first answers ${gone}`, async () => {
      const net = scripted({ [HTML_ADDRESS]: status(gone), [PDF_ADDRESS]: pdf });
      const { doc, candidate, tried } = await fetchFirstCandidate(HTML_THEN_PDF, net.deps);
      expect(doc.kind).toBe("pdf");
      expect(candidate.url).toBe(PDF_ADDRESS);
      expect(tried).toBe(2);
      expect(net.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
    });
  }

  it("moves on when the first is the wrong kind of document", async () => {
    /* A PDF served where HTML was promised. */
    const net = scripted({ [HTML_ADDRESS]: pdf, [PDF_ADDRESS]: pdf });
    const { doc, candidate } = await fetchFirstCandidate(HTML_THEN_PDF, net.deps);
    expect(doc.kind).toBe("pdf");
    expect(candidate.url).toBe(PDF_ADDRESS);
    expect(net.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
  });

  it("moves on from the wrong kind when the candidate names no marker, and either way round", async () => {
    /* Without a marker the kind is the only thing checked, so this is the case
       that goes red if the kind check is dropped. */
    const other = "https://arxiv.org/format/2608.13566";
    const pdfWanted = scripted({ [PDF_ADDRESS]: () => page(PAPER_PAGE), [other]: pdf });
    const first = await fetchFirstCandidate([{ url: PDF_ADDRESS, expect: "pdf" }, { url: other, expect: "pdf" }], pdfWanted.deps);
    expect(first.candidate.url).toBe(other);
    expect(pdfWanted.requested).toEqual([PDF_ADDRESS, other]);

    const htmlWanted = scripted({ [HTML_ADDRESS]: pdf, [PDF_ADDRESS]: pdf });
    const second = await fetchFirstCandidate([{ url: HTML_ADDRESS, expect: "html" }, { url: PDF_ADDRESS, expect: "pdf" }], htmlWanted.deps);
    expect(second.candidate.url).toBe(PDF_ADDRESS);
    expect(htmlWanted.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
  });

  it("moves on when the first is a web page without the source's marker", async () => {
    const net = scripted({ [HTML_ADDRESS]: () => page(ERROR_PAGE), [PDF_ADDRESS]: pdf });
    const { doc, candidate } = await fetchFirstCandidate(HTML_THEN_PDF, net.deps);
    expect(doc.kind).toBe("pdf");
    expect(candidate.url).toBe(PDF_ADDRESS);
    expect(net.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
  });

  describe("and does not move on past a failure that is not absence", () => {
    const slow = () => {
      throw Object.assign(new Error("slow"), { name: "TimeoutError" });
    };
    const cases: [string, Parameters<typeof scripted>[0], FetchOptions, string][] = [
      ["a 503", { [HTML_ADDRESS]: status(503), [PDF_ADDRESS]: pdf }, {}, "server-error"],
      ["a 429", { [HTML_ADDRESS]: status(429), [PDF_ADDRESS]: pdf }, {}, "rate-limited"],
      ["a 403", { [HTML_ADDRESS]: status(403), [PDF_ADDRESS]: pdf }, {}, "forbidden"],
      ["a timeout", { [HTML_ADDRESS]: slow, [PDF_ADDRESS]: pdf }, {}, "timeout"],
      ["a private address", { [HTML_ADDRESS]: () => page(PAPER_PAGE), [PDF_ADDRESS]: pdf }, { resolve: async () => ["10.0.0.1"] }, "blocked-address"],
      ["a body over the size limit", { [HTML_ADDRESS]: () => page(PAPER_PAGE), [PDF_ADDRESS]: pdf }, { maxBytes: 16 }, "too-large"],
    ];
    for (const [name, script, options, code] of cases) {
      it(`${name} on the first is the step's failure, and the second is never asked`, async () => {
        const net = scripted(script, options);
        const thrown = await failureOf(fetchFirstCandidate(HTML_THEN_PDF, net.deps));
        expect(codeOf(thrown)).toBe(codeOfMessage(fetchFailed(code as FetchFailure["code"], null).message));
        expect(net.asked).toEqual([HTML_ADDRESS]);
        expect(net.requested).not.toContain(PDF_ADDRESS);
      });
    }
  });

  it("fails, with nothing handed back, when the last candidate is the wrong kind", async () => {
    /* arXiv as it ships today: the PDF only, and its address served a web page. */
    const net = scripted({ [PDF_ADDRESS]: () => page(ERROR_PAGE) });
    const thrown = await failureOf(fetchFirstCandidate([{ url: PDF_ADDRESS, expect: "pdf" }], net.deps));
    const failure = declaredFailure(thrown);
    expect(failure).toEqual(fetchFailed("http-error", null));
    expect(failure?.kind).toBe("retry");
    expect(codeOf(thrown)).toBe("fetch-incomplete");
    /* The diagnostic is fixed words: no address, and no word of the page. */
    expect(thrown.message).not.toContain("arxiv");
    expect(thrown.message).not.toContain("2608");
    expect(thrown.message).not.toContain("No HTML");
  });

  it("fails the same way when both are served and neither is what it promised", async () => {
    const net = scripted({ [HTML_ADDRESS]: () => page(ERROR_PAGE), [PDF_ADDRESS]: () => page(ERROR_PAGE) });
    const thrown = await failureOf(fetchFirstCandidate(HTML_THEN_PDF, net.deps));
    expect(codeOf(thrown)).toBe("fetch-incomplete");
    expect(net.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
  });

  it("fails with the last candidate's own failure when the first was absent and the last is too", async () => {
    const net = scripted({ [HTML_ADDRESS]: status(404), [PDF_ADDRESS]: status(404) });
    const thrown = await failureOf(fetchFirstCandidate(HTML_THEN_PDF, net.deps));
    expect(codeOf(thrown)).toBe("fetch-not-found");
    expect(net.requested).toEqual([HTML_ADDRESS, PDF_ADDRESS]);
  });

  describe("and stops when the job is stopped during the first", () => {
    /* A hand-written fetcher here, because the point is this loop's own check:
       each of these outcomes would move on to the second if the signal had not
       fired. */
    const stoppedDuring = (outcome: () => FetchedDocument) => {
      const controller = new AbortController();
      const asked: string[] = [];
      return {
        asked,
        deps: {
          signal: controller.signal,
          fetchDocument: async (url: string) => {
            asked.push(url);
            controller.abort();
            return outcome();
          },
        },
      };
    };

    it("after a 404", async () => {
      const net = stoppedDuring(() => {
        throw new FetchFailure("not-found", HTML_ADDRESS, "There's nothing at that address.", { status: 404 });
      });
      await failureOf(fetchFirstCandidate(HTML_THEN_PDF, net.deps));
      expect(net.asked).toEqual([HTML_ADDRESS]);
    });

    it("after a document of the wrong kind", async () => {
      const net = stoppedDuring(
        () => ({ kind: "pdf", text: null, encoding: null, url: HTML_ADDRESS, bytes: new Uint8Array(4) }) as FetchedDocument,
      );
      await failureOf(fetchFirstCandidate(HTML_THEN_PDF, net.deps));
      expect(net.asked).toEqual([HTML_ADDRESS]);
    });
  });
});

describe("an address no source recognises", () => {
  const ADDRESS = "https://example.com/why-trees?utm_source=x";

  it("is one request for exactly that address, and whatever it serves is the document", async () => {
    for (const respond of [() => page(ERROR_PAGE), pdf]) {
      const net = scripted({ [ADDRESS]: respond });
      const { doc, tried } = await fetchFirstCandidate([{ url: ADDRESS }], net.deps);
      expect(doc.requestedUrl).toBe(ADDRESS);
      expect(tried).toBe(1);
      expect(net.requested).toEqual([ADDRESS]);
    }
  });

  it("fails with the sentence it always failed with", async () => {
    const net = scripted({ [ADDRESS]: status(404) });
    const thrown = await failureOf(fetchFirstCandidate([{ url: ADDRESS }], net.deps));
    expect(codeOf(thrown)).toBe("fetch-not-found");
    expect(net.requested).toEqual([ADDRESS]);
  });

  it("keeps the step detail it always had, and a source says which rendering was used", () => {
    expect(fetchDetail(312, null)).toBe("312 KB");
    expect(fetchDetail(1040, { source: "arxiv", format: "pdf" })).toBe("1040 KB, arXiv PDF");
    expect(fetchDetail(312, { source: "arxiv", format: "html" })).toBe("312 KB, arXiv HTML");
  });
});

describe("the fetch step itself", () => {
  const ctx = (url: string) => ({
    slug: "test-fetch-candidates",
    url,
    report: () => {},
    preview: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
    power: "standard" as const,
  });

  /** Every address the step put on the network. Each is answered 404, so nothing is stored. */
  async function requestedBy(url: string): Promise<string[]> {
    const requested: string[] = [];
    network.seams = {
      attempts: 1,
      sleep: async () => {},
      resolve: async () => ["93.184.216.34"],
      fetchImpl: async (address) => {
        requested.push(address);
        return new Response("no", { status: 404 });
      },
    };
    await failureOf(STEPS.fetch.run(ctx(url), memoryArtefacts(), nullCheckpointStore()));
    return requested;
  }

  it("asks arXiv for the paper when it is given the abstract page's address", async () => {
    /* Both answer 404 here, so the step asks for the HTML and then for the PDF. */
    expect(await requestedBy("https://arxiv.org/abs/2608.13566?utm_source=x")).toEqual([
      "https://arxiv.org/html/2608.13566",
      PDF_ADDRESS,
    ]);
  });

  it("asks for a versioned paper by its version", async () => {
    expect(await requestedBy("https://arxiv.org/pdf/2608.13566v2")).toEqual([
      "https://arxiv.org/html/2608.13566v2",
      "https://arxiv.org/pdf/2608.13566v2",
    ]);
  });

  it("asks for any other address exactly as it was given", async () => {
    const address = "https://example.com/abs/2608.13566?utm_source=x";
    expect(await requestedBy(address)).toEqual([address]);
  });
});
