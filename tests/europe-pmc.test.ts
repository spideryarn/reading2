/**
 * **Europe PMC's fixed door, and the lookups behind a refused paper's free copy.**
 *
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 1, with GPT Sol's S6. The door is `fetchEuropePmc` in src/fetch.ts;
 * the lookups are src/europe-pmc.ts. No network: every request goes to an
 * injected `fetchImpl`, and the address guard is given a public answer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  doiForPii,
  findOpenCopy,
  openPmcidForDoi,
  type PaperId,
  paperIdsInUrl,
} from "../src/europe-pmc.js";
import {
  BIBLIOGRAPHIC_USER_AGENT,
  EUROPE_PMC_LIMITS,
  fetchEuropePmc,
  type FetchLike,
  writeConvertedRaw,
} from "../src/fetch.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { createHash } from "node:crypto";

const resolve = async () => ["193.62.193.80"];
const SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x&format=json";
const XML = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4595480/fullTextXML";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json;charset=UTF-8" } });

describe("fetchEuropePmc, the fixed door", () => {
  it("refuses every other address before a DNS lookup or a request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const lookup = vi.fn(resolve);
    for (const url of [
      "https://ebi.ac.uk/europepmc/webservices/rest/search?query=x",
      "https://europepmc.org/europepmc/webservices/rest/search?query=x",
      "https://www.ebi.ac.uk/ebisearch/ws/rest/x",
      "https://www.ebi.ac.uk/europepmc/webservices/restful/x",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/../../ebisearch/x",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/%2e%2e/%2e%2e/x",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/%2e%2e%2febisearch/x",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/..%2febisearch/x",
      "https://www.ebi.ac.uk/europepmc/webservices/rest/%252e%252e/ebisearch/x",
      "http://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x",
      "https://www.ebi.ac.uk:443/europepmc/webservices/rest/search?query=x",
      "https://www.ebi.ac.uk:8443/europepmc/webservices/rest/search?query=x",
      "https://user:pw@www.ebi.ac.uk/europepmc/webservices/rest/search?query=x",
      "https://www.ebi.ac.uk.evil.example/europepmc/webservices/rest/search?query=x",
      "https://evil.example/?www.ebi.ac.uk/europepmc/webservices/rest/",
    ]) {
      await expect(fetchEuropePmc(url, "json", { fetchImpl, resolve: lookup }), url).rejects.toMatchObject({
        code: "blocked-address",
      });
      await expect(fetchEuropePmc(url, "xml", { fetchImpl, resolve: lookup }), url).rejects.toMatchObject({
        code: "blocked-address",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("follows no redirect, even to its own host", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response(null, { status: 302, headers: { location: "https://www.ebi.ac.uk/europepmc/webservices/rest/other" } }),
    );
    await expect(fetchEuropePmc(SEARCH, "json", { fetchImpl, resolve })).rejects.toMatchObject({ code: "too-many-redirects" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks once, honestly, and reads JSON only as JSON", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ hitCount: 0 }));
    expect(await fetchEuropePmc(SEARCH, "json", { fetchImpl, resolve })).toEqual({ hitCount: 0 });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string> | undefined)?.["User-Agent"]).toBe(BIBLIOGRAPHIC_USER_AGENT);
    expect(init?.redirect).toBe("manual");

    const html = vi.fn<FetchLike>(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    await expect(fetchEuropePmc(SEARCH, "json", { fetchImpl: html, resolve })).rejects.toMatchObject({ code: "unsupported-type" });
  });

  it("gives a 500 as a failure with its status, once", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("no", { status: 500 }));
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl, resolve })).rejects.toMatchObject({ code: "server-error", status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("hands back XML as its bytes and their strict UTF-8, and refuses anything else", async () => {
    const body = new TextEncoder().encode('<?xml version="1.0"?><article>é</article>');
    const ok = vi.fn<FetchLike>(async () => new Response(body as unknown as BodyInit, { headers: { "content-type": "application/xml" } }));
    const got = await fetchEuropePmc(XML, "xml", { fetchImpl: ok, resolve });
    expect(got.text).toBe('<?xml version="1.0"?><article>é</article>');
    expect(got.bytes.byteLength).toBe(body.byteLength);
    expect(got.contentType).toBe("application/xml");

    const latin1 = vi.fn<FetchLike>(
      async () => new Response(new Uint8Array([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e]) as unknown as BodyInit, { headers: { "content-type": "text/xml" } }),
    );
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl: latin1, resolve })).rejects.toMatchObject({ code: "unsupported-type" });
    const html = vi.fn<FetchLike>(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl: html, resolve })).rejects.toMatchObject({ code: "unsupported-type" });

    const declaredUtf16 = vi.fn<FetchLike>(async () =>
      new Response(body as unknown as BodyInit, { headers: { "content-type": "application/xml; charset=utf-16" } }),
    );
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl: declaredUtf16, resolve })).rejects.toMatchObject({
      code: "unsupported-type",
    });
    const utf16Bom = vi.fn<FetchLike>(async () =>
      new Response(new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00]) as unknown as BodyInit, {
        headers: { "content-type": "application/xml" },
      }),
    );
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl: utf16Bom, resolve })).rejects.toMatchObject({ code: "unsupported-type" });
  });

  it("caps the XML at its own limit", async () => {
    const big = new Uint8Array(EUROPE_PMC_LIMITS.xml.maxBytes + 1).fill(0x20);
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(big as unknown as BodyInit, { headers: { "content-type": "application/xml" } }));
    await expect(fetchEuropePmc(XML, "xml", { fetchImpl, resolve })).rejects.toMatchObject({ code: "too-large" });
  });
});

describe("writeConvertedRaw", () => {
  it("stores the page as UTF-8 HTML and describes what arrived", async () => {
    const objects = new Map<string, Uint8Array>();
    const store: RawSourceStore = {
      head: async (key) => (objects.has(key) ? { bytes: objects.get(key)?.byteLength ?? 0, contentType: "text/html" } : null),
      get: async (key) => objects.get(key) ?? null,
      putIfAbsent: async (key, bytes) => {
        objects.set(key, bytes);
        return "stored";
      },
      remove: async (key) => {
        objects.delete(key);
      },
    };
    const xml = new TextEncoder().encode("<article><body><p>é</p></body></article>");
    const page = "<!doctype html>\n<html><body><p>é</p></body></html>";
    const manifest = await writeConvertedRaw(
      {
        kind: "html",
        convertedFrom: "jats",
        requestedUrl: XML,
        url: "https://europepmc.org/article/PMC/PMC4595480",
        text: page,
        source: { contentType: "application/xml", bytes: xml },
        fetchedAt: "2026-10-18T00:00:00.000Z",
      },
      store,
    );
    const stored = new TextEncoder().encode(page);
    expect(manifest).toMatchObject({
      kind: "html",
      file: "raw.html",
      requestedUrl: XML,
      url: "https://europepmc.org/article/PMC/PMC4595480",
      contentType: "application/xml",
      encoding: "UTF-8",
      bytes: xml.byteLength,
      sha256: createHash("sha256").update(xml).digest("hex"),
      storedSha256: createHash("sha256").update(stored).digest("hex"),
      storedBytes: stored.byteLength,
    });
    expect([...objects.values()].map((b) => new TextDecoder().decode(b))).toEqual([page]);
  });
});

/* ------------------------------------------------------------------ *
 * Which paper an address names
 * ------------------------------------------------------------------ */

/** The 261017a sample (docs/investigations/261017a-evidence/sample.tsv): address → its DOI. */
const SAMPLE = readFileSync(new URL("../docs/investigations/261017a-evidence/sample.tsv", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split("\t") as [string, string, string]);

/** What each sampled address's own path is expected to give, by host. */
const READ_BY_ADDRESS: Readonly<Record<string, PaperId>> = {
  "https://www.cell.com/fulltext/S1364-6613(15)00180-1": { kind: "pii", pii: "S1364661315001801" },
  "https://www.cell.com/cell/fulltext/S0092-8674(22)01377-0": { kind: "pii", pii: "S0092867422013770" },
  "https://www.cell.com/cell/fulltext/S0092-8674(25)00414-3": { kind: "pii", pii: "S0092867425004143" },
  "https://www.cell.com/neuron/fulltext/S0896-6273(23)00308-2": { kind: "pii", pii: "S0896627323003082" },
  "https://www.sciencedirect.com/science/article/pii/S0010027713002497": { kind: "pii", pii: "S0010027713002497" },
  "https://www.sciencedirect.com/science/article/pii/S0167268123001531": { kind: "pii", pii: "S0167268123001531" },
  "https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(15)60461-5/fulltext": { kind: "pii", pii: "S0140673615604615" },
};

describe("paperIdsInUrl", () => {
  it("reads a DOI or a PII off every sampled address that carries one, and the DOI is the sample's", () => {
    let found = 0;
    for (const [url, doi] of SAMPLE) {
      const got = paperIdsInUrl(url);
      const byAddress = READ_BY_ADDRESS[url];
      if (byAddress) {
        expect(got, url).toEqual([byAddress]);
        found += 1;
      } else if (got.length > 0) {
        expect(got, url).toEqual([{ kind: "doi", doi: doi.toLowerCase() }]);
        found += 1;
      }
    }
    /* 14 DOI routes and 7 PIIs; OUP, IEEE, JSTOR, JAMA, BMJ, Nature, PLOS, Cambridge and Frontiers carry neither on a route we read. */
    expect(found).toBe(21);
  });

  it("reads none off the sample's addresses that have no identifier on a route we know", () => {
    for (const url of [
      "https://academic.oup.com/brain/article/146/8/3117/7067886",
      "https://www.bmj.com/content/372/bmj.n71",
      "https://ieeexplore.ieee.org/document/9069875",
      "https://www.jstor.org/stable/1914185",
      "https://jamanetwork.com/journals/jama/fullarticle/2760741",
    ]) {
      expect(paperIdsInUrl(url), url).toEqual([]);
    }
  });

  it("takes the whole rest of a DOI route as the DOI: no suffix is stripped, so a real DOI ending .pdf or /full is kept", () => {
    expect(paperIdsInUrl("https://onlinelibrary.wiley.com/doi/10.1111/x.pdf")).toEqual([{ kind: "doi", doi: "10.1111/x.pdf" }]);
    expect(paperIdsInUrl("https://www.tandfonline.com/doi/full/10.1080/abc/full")).toEqual([{ kind: "doi", doi: "10.1080/abc/full" }]);
    expect(paperIdsInUrl("https://journals.sagepub.com/doi/10.1177%2F0956797620916782")).toEqual([
      { kind: "doi", doi: "10.1177/0956797620916782" },
    ]);
  });

  it("reads a DOI only on its own host's route", () => {
    for (const url of [
      "https://example.com/doi/10.1177/0956797620916782",
      "https://journals.sagepub.com/toc/10.1177/0956797620916782",
      "https://journals.sagepub.com/x/doi/10.1177/0956797620916782",
      "https://journals.sagepub.com:444/doi/10.1177/0956797620916782",
      "https://user@journals.sagepub.com/doi/10.1177/0956797620916782",
      "https://journals.sagepub.com.evil.example/doi/10.1177/0956797620916782",
      "https://www.cell.com/fulltext/S1364-6613(15)00180-1/extra",
      "https://www.cell.com/fulltext/S1364",
      "https://example.com/science/article/pii/S0010027713002497",
      "not a url",
    ]) {
      expect(paperIdsInUrl(url), url).toEqual([]);
    }
  });

  it("reads a doi.org link through identityOf", () => {
    expect(paperIdsInUrl("https://doi.org/10.1016/J.TICS.2015.08.003")).toEqual([{ kind: "doi", doi: "10.1016/j.tics.2015.08.003" }]);
  });
});

/* ------------------------------------------------------------------ *
 * The lookups
 * ------------------------------------------------------------------ */

/** A scripted network, by address; anything unscripted is an error the test names. */
function network(script: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    asked.push(url);
    const answer = script[url];
    if (!answer) throw new Error(`the test network has no answer for ${url}`);
    return answer();
  };
  return { asked, options: { fetchImpl, resolve } };
}

const CROSSREF = (pii: string) =>
  `https://api.crossref.org/works?filter=alternative-id:${pii}&rows=2&select=DOI,alternative-id`;
const SEARCH_FOR = (doi: string) =>
  `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite&pageSize=5`;
const hit = (over: Record<string, unknown> = {}) => ({
  resultList: {
    result: [{ doi: "10.1016/j.tics.2015.08.003", pmcid: "PMC4595480", isOpenAccess: "Y", inEPMC: "Y", ...over }],
  },
});

describe("doiForPii", () => {
  it("is the one work whose own alternative-id is the PII", async () => {
    const net = network({
      [CROSSREF("S1364661315001801")]: () =>
        json({ message: { items: [{ DOI: "10.1016/J.TICS.2015.08.003", "alternative-id": ["S1364661315001801"] }] } }),
    });
    expect(await doiForPii("S1364-6613(15)00180-1", net.options)).toBe("10.1016/j.tics.2015.08.003");
  });

  it("is nothing for two works, none, or one that does not carry the PII", async () => {
    for (const items of [
      [],
      [
        { DOI: "10.1/a", "alternative-id": ["S1364661315001801"] },
        { DOI: "10.1/b", "alternative-id": ["S1364661315001801"] },
      ],
      [{ DOI: "10.1/a", "alternative-id": ["S9999999999999999"] }],
      [{ DOI: "10.1/a" }],
      [{ "alternative-id": ["S1364661315001801"] }],
    ]) {
      const net = network({ [CROSSREF("S1364661315001801")]: () => json({ message: { items } }) });
      expect(await doiForPii("S1364661315001801", net.options), JSON.stringify(items)).toBeNull();
    }
  });
});

describe("openPmcidForDoi", () => {
  const DOI = "10.1016/j.tics.2015.08.003";
  it("is the PMCID of the result that names the same DOI and is open access in Europe PMC", async () => {
    const net = network({ [SEARCH_FOR(DOI)]: () => json(hit({ doi: "10.1016/J.TICS.2015.08.003" })) });
    expect(await openPmcidForDoi(DOI, net.options)).toBe("PMC4595480");
  });

  it.each([
    ["a closed paper", { isOpenAccess: "N" }],
    ["one not in Europe PMC", { inEPMC: "N" }],
    ["another paper's DOI", { doi: "10.1016/j.tics.2015.08.004" }],
    ["no PMCID", { pmcid: undefined }],
    ["a PMCID of the wrong shape", { pmcid: "PMC12x" }],
  ])("is nothing for %s", async (_name, over) => {
    const net = network({ [SEARCH_FOR(DOI)]: () => json(hit(over)) });
    expect(await openPmcidForDoi(DOI, net.options)).toBeNull();
  });
});

describe("findOpenCopy", () => {
  it("goes PII → DOI → PMCID", async () => {
    const net = network({
      [CROSSREF("S1364661315001801")]: () =>
        json({ message: { items: [{ DOI: "10.1016/j.tics.2015.08.003", "alternative-id": ["S1364661315001801"] }] } }),
      [SEARCH_FOR("10.1016/j.tics.2015.08.003")]: () => json(hit()),
    });
    expect(await findOpenCopy(["https://www.cell.com/fulltext/S1364-6613(15)00180-1"], net.options)).toEqual({
      found: true,
      pmcid: "PMC4595480",
      idKind: "pii",
    });
    expect(net.asked).toHaveLength(2);
  });

  it("says where it stopped, and turns a failed lookup into a miss", async () => {
    expect(await findOpenCopy(["https://example.com/x"], network({}).options)).toEqual({
      found: false,
      idKind: null,
      endedAt: "no-identifier",
    });
    const down = network({ [SEARCH_FOR("10.1073/pnas.1800165115")]: () => new Response("no", { status: 503 }) });
    expect(await findOpenCopy(["https://www.pnas.org/doi/10.1073/pnas.1800165115"], down.options)).toEqual({
      found: false,
      idKind: "doi",
      endedAt: "lookup-failed",
    });
    const closed = network({ [SEARCH_FOR("10.1073/pnas.1800165115")]: () => json({ resultList: { result: [] } }) });
    expect(await findOpenCopy(["https://www.pnas.org/doi/10.1073/pnas.1800165115"], closed.options)).toEqual({
      found: false,
      idKind: "doi",
      endedAt: "no-open-copy",
    });
  });

  it("tries the second address's identifier when the first leads nowhere", async () => {
    const net = network({
      [SEARCH_FOR("10.1/none")]: () => json({ resultList: { result: [] } }),
      [SEARCH_FOR("10.1016/j.tics.2015.08.003")]: () => json(hit()),
    });
    const got = await findOpenCopy(["https://doi.org/10.1/none", "https://doi.org/10.1016/j.tics.2015.08.003"], net.options);
    expect(got).toEqual({ found: true, pmcid: "PMC4595480", idKind: "doi" });
  });
});
