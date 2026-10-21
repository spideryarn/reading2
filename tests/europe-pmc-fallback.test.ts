/**
 * **A paper its publisher refuses is read from Europe PMC, and every other
 * refusal ends exactly as it did.**
 *
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 2, with GPT Sol's S1 (the converted acquisition's own seam) and S2
 * (the raw outcome kept, the same failure or the same document on a miss).
 *
 * Every request goes through the real doors in src/fetch.ts over an injected
 * network (the seam tests/fetch-candidates.test.ts uses), so the address
 * guard, the fixed hosts and the status classification are the real ones. The
 * bytes are stored in a store of this file's own.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConvertedHtml, FetchedDocument, FetchOptions } from "../src/fetch.js";
import { declaredFailure } from "../src/job-failure.js";
import { fetchByAddress, STEPS } from "../src/pipeline.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

const network: { seams: FetchOptions | null } = { seams: null };
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

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  const seams = () => network.seams ?? {};
  return {
    ...real,
    fetchDocument: (url: string, options: FetchOptions = {}) => real.fetchDocument(url, { ...options, ...seams() }),
    fetchBibliographicJson: (url: string, options = {}) => real.fetchBibliographicJson(url, { ...options, ...seams() }),
    fetchEuropePmc: ((url: string, as: "json" | "xml", options = {}) =>
      as === "json" ? real.fetchEuropePmc(url, as, { ...options, ...seams() }) : real.fetchEuropePmc(url, as, { ...options, ...seams() })) as typeof real.fetchEuropePmc,
    writeRaw: (doc: FetchedDocument) => real.writeRaw(doc, store),
    writeConvertedRaw: (doc: ConvertedHtml) => real.writeConvertedRaw(doc, store),
  };
});

const logged: { level: string; fields: Record<string, unknown> }[] = [];
vi.mock("../src/log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/log.js")>();
  return {
    ...actual,
    log: (component: string) => ({
      ...actual.log(component as Parameters<typeof actual.log>[0]),
      info: (fields: Record<string, unknown>) => void logged.push({ level: "info", fields }),
      warn: (fields: Record<string, unknown>) => void logged.push({ level: "warn", fields }),
    }),
  };
});

afterEach(() => {
  network.seams = null;
  objects.clear();
  logged.length = 0;
});

const CELL = "https://www.cell.com/fulltext/S1364-6613(15)00180-1";
const DOI = "10.1016/j.tics.2015.08.003";
const CROSSREF = "https://api.crossref.org/works?filter=alternative-id:S1364661315001801&rows=2&select=DOI,alternative-id";
const SEARCH = (doi: string) =>
  `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite&pageSize=5`;
const XML = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4595480/fullTextXML";
const ARTICLE = "https://europepmc.org/article/PMC/PMC4595480";
const FIXTURE = readFileSync(new URL("./fixtures/europe-pmc/PMC4595480.xml", import.meta.url));

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json;charset=UTF-8" } });
const status = (code: number) => () => new Response("no", { status: code, headers: { "content-type": "text/html" } });
const xml = (bytes: Uint8Array) => () => new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": "application/xml" } });
const page = (html: string) => () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const piiAnswer = json({ message: { items: [{ DOI, "alternative-id": ["S1364661315001801"] }] } });
const openHit = (over: Record<string, unknown> = {}) =>
  json({ resultList: { result: [{ doi: DOI, pmcid: "PMC4595480", isOpenAccess: "Y", inEPMC: "Y", ...over }] } });

/** A network answering from a script; anything unscripted is a 404. Every address asked is kept. */
function scripted(script: Record<string, () => Response>) {
  const requested: string[] = [];
  network.seams = {
    attempts: 1,
    sleep: async () => {},
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async (url) => {
      requested.push(url);
      return (script[url] ?? status(404))();
    },
  };
  return requested;
}

const ctx = (url: string) => ({
  slug: "test-europe-pmc-fallback",
  url,
  report: () => {},
  preview: () => {},
  signal: new AbortController().signal,
  cacheArticle: false,
  power: "standard" as const,
});

async function failureOf(work: Promise<unknown>): Promise<Error> {
  const thrown = await work.then(
    () => null,
    (err: unknown) => err,
  );
  expect(thrown, "it did not fail").toBeInstanceOf(Error);
  return thrown as Error;
}

/** What a failure says, all of it a reader or a log could see. */
const said = (err: Error) => ({ name: err.name, message: err.message, declared: declaredFailure(err) });

/** Today's failure for a refusal, from an address that carries no identifier and so never asks Europe PMC. */
async function todaysFailure(code: number): Promise<ReturnType<typeof said>> {
  const requested = scripted({ "https://example.com/refused": status(code) });
  const err = await failureOf(STEPS.fetch.run(ctx("https://example.com/refused"), memoryArtefacts(), nullCheckpointStore()));
  expect(requested).toEqual(["https://example.com/refused"]);
  return said(err);
}

describe("a refused paper with an open-access copy", () => {
  it("is read from Europe PMC: the page stored, the XML described, the article known by its Europe PMC address", async () => {
    const requested = scripted({
      [CELL]: status(403),
      [CROSSREF]: piiAnswer,
      [SEARCH(DOI)]: openHit(),
      [XML]: xml(FIXTURE),
    });
    const product = await STEPS.fetch.run(ctx(CELL), memoryArtefacts(), nullCheckpointStore());
    expect(requested).toEqual([CELL, CROSSREF, SEARCH(DOI), XML]);
    const raw = product.parts.raw;
    expect(raw).toMatchObject({
      kind: "html",
      file: "raw.html",
      requestedUrl: XML,
      url: ARTICLE,
      contentType: "application/xml",
      encoding: "UTF-8",
      bytes: FIXTURE.byteLength,
      sha256: createHash("sha256").update(FIXTURE).digest("hex"),
    });
    const stored = objects.get([...objects.keys()][0] ?? "");
    expect(objects.size).toBe(1);
    const html = new TextDecoder().decode(stored);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Mental Imagery: Functional Mechanisms and Clinical Applications");
    expect(raw?.storedSha256).toBe(createHash("sha256").update(stored ?? new Uint8Array()).digest("hex"));
    expect(product.detail).toBe(`${Math.round(FIXTURE.byteLength / 1024)} KB, Europe PMC's free full text`);
  });

  it("logs the host, the identifier's kind and where it ended — never an address or an identifier", async () => {
    scripted({ [CELL]: status(403), [CROSSREF]: piiAnswer, [SEARCH(DOI)]: openHit(), [XML]: xml(FIXTURE) });
    await STEPS.fetch.run(ctx(CELL), memoryArtefacts(), nullCheckpointStore());
    const line = logged.find((l) => l.fields.why !== undefined);
    expect(line?.fields).toMatchObject({ host: "www.cell.com", why: "refused", idKind: "pii", endedAt: "imported" });
    const text = JSON.stringify(logged);
    for (const secret of ["S1364", "10.1016", "PMC4595480", "fulltext"]) expect(text).not.toContain(secret);
  });

  it("is asked for by a 401 too, and through a redirect the pasted link's DOI names", async () => {
    const LINK = `https://doi.org/${DOI}`;
    const OUP = "https://academic.oup.com/somewhere/article/1/2/3/4";
    const requested = scripted({
      [LINK]: () => new Response(null, { status: 302, headers: { location: OUP } }),
      [OUP]: status(401),
      [SEARCH(DOI)]: openHit(),
      [XML]: xml(FIXTURE),
    });
    const got = await fetchByAddress(LINK, ctx(LINK));
    expect(requested).toEqual([LINK, OUP, SEARCH(DOI), XML]);
    expect(got.doc.url).toBe(ARTICLE);
    expect(got.paper?.source).toBe("europepmc");
  });

  it("is read from a bot check served with a 200, when the address names the paper", async () => {
    const SPRINGER = "https://link.springer.com/article/10.1007/s10648-015-9348-9";
    const challenge = readFileSync(path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures", "springer_client_challenge.html"), "utf8");
    const requested = scripted({
      [SPRINGER]: page(challenge),
      [SEARCH("10.1007/s10648-015-9348-9")]: openHit({ doi: "10.1007/s10648-015-9348-9" }),
      [XML]: xml(FIXTURE),
    });
    const got = await fetchByAddress(SPRINGER, ctx(SPRINGER));
    expect(requested).toEqual([SPRINGER, SEARCH("10.1007/s10648-015-9348-9"), XML]);
    expect(got.doc.url).toBe(ARTICLE);
  });
});

describe("a pasted Europe PMC address", () => {
  it("imports the paper directly, through the same door", async () => {
    const requested = scripted({ [XML]: xml(FIXTURE) });
    const product = await STEPS.fetch.run(ctx(ARTICLE), memoryArtefacts(), nullCheckpointStore());
    expect(requested).toEqual([XML]);
    expect(product.parts.raw).toMatchObject({ url: ARTICLE, requestedUrl: XML, kind: "html" });
  });

  /* A page built from Europe PMC's JATS is a web page, so it stays one slot
     and is never priced by pages (plan 261020b). */
  it("is not priced by pages: the JATS page stays one slot", async () => {
    scripted({ [XML]: xml(FIXTURE) });
    const asked: number[] = [];
    const product = await STEPS.fetch.run(
      {
        ...ctx(ARTICLE),
        priceFetchedPdf: async (pages: number) => {
          asked.push(pages);
          return { kind: "priced", slots: 1, pages };
        },
      },
      memoryArtefacts(),
      nullCheckpointStore(),
    );
    expect(asked).toEqual([]);
    expect(product.parts.raw?.pages).toBeUndefined();
  });

  it("says the paper is not there when Europe PMC has no full text for it", async () => {
    scripted({ [XML]: status(404) });
    const err = await failureOf(STEPS.fetch.run(ctx(ARTICLE), memoryArtefacts(), nullCheckpointStore()));
    expect(declaredFailure(err)?.message).toMatch(/\[FETCH_PAPER_MISSING\]|paper/i);
  });
});

describe("every other refusal ends exactly as it did", () => {
  it.each([
    ["a closed paper", { [SEARCH(DOI)]: openHit({ isOpenAccess: "N" }) }, 3],
    ["a search naming another DOI", { [SEARCH(DOI)]: openHit({ doi: "10.1016/j.tics.2015.08.004" }) }, 3],
    ["Europe PMC's full text answering 500", { [SEARCH(DOI)]: openHit(), [XML]: status(500) }, 4],
    ["Europe PMC's search down", { [SEARCH(DOI)]: status(503) }, 3],
    ["a PII Crossref does not know", { [CROSSREF]: json({ message: { items: [] } }) }, 2],
    [
      "full text the converter refuses",
      { [SEARCH(DOI)]: openHit(), [XML]: xml(new TextEncoder().encode('<!DOCTYPE article [<!ENTITY e "x">]><article/>')) },
      4,
    ],
  ])("%s: the same failure, sentence for sentence", async (_name, script: Record<string, () => Response>, asks) => {
    const today = await todaysFailure(403);
    const requested = scripted({ [CELL]: status(403), [CROSSREF]: piiAnswer, ...script });
    const err = await failureOf(STEPS.fetch.run(ctx(CELL), memoryArtefacts(), nullCheckpointStore()));
    /* It did ask: a miss that never looked would pass the comparison below too. */
    expect(requested).toHaveLength(asks);
    expect(said(err)).toEqual(today);
    expect(objects.size).toBe(0);
  });

  it("a refused page that names no paper asks nothing more", async () => {
    await todaysFailure(403);
    await todaysFailure(401);
  });

  it("a 404, a 429 and a 500 never ask", async () => {
    for (const code of [404, 429, 500]) {
      const requested = scripted({ [CELL]: status(code) });
      await failureOf(STEPS.fetch.run(ctx(CELL), memoryArtefacts(), nullCheckpointStore()));
      expect(requested, String(code)).toEqual([CELL]);
    }
  });

  it("a bot check with no copy is handed back as the very document that arrived", async () => {
    const SPRINGER = "https://link.springer.com/article/10.1007/s10648-015-9348-9";
    const challenge = readFileSync(path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures", "springer_client_challenge.html"), "utf8");
    scripted({ [SEARCH("10.1007/s10648-015-9348-9")]: json({ resultList: { result: [] } }) });
    const arrived: FetchedDocument = {
      kind: "html",
      requestedUrl: SPRINGER,
      url: SPRINGER,
      chain: [SPRINGER],
      status: 200,
      contentType: "text/html",
      bytes: new TextEncoder().encode(challenge),
      text: challenge,
      encoding: "UTF-8",
      fetchedAt: "2026-10-18T00:00:00.000Z",
    };
    const got = await fetchByAddress(SPRINGER, ctx(SPRINGER), async () => arrived);
    expect(got.doc).toBe(arrived);
    expect(got.paper).toBeNull();
  });

  it("an ordinary page that names a paper is not taken for a bot check", async () => {
    const PNAS = "https://www.pnas.org/doi/10.1073/pnas.1800165115";
    const requested = scripted({ [PNAS]: page("<!doctype html><html><head><title>A paper</title></head><body><p>Text.</p></body></html>") });
    const got = await fetchByAddress(PNAS, ctx(PNAS));
    expect(requested).toEqual([PNAS]);
    expect(got.doc.url).toBe(PNAS);
  });
});
