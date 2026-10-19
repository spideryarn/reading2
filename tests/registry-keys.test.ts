/**
 * **The two registry keys travel only as a header, and only to their own
 * host** — plan 261018o stage 1, tests 1 and 2
 * (docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md,
 * R5 and R10 of its review). No network: `fetchImpl` and `resolve` are fakes.
 *
 * What is pinned, because each fails quietly: a key in a URL reaches a log and
 * Sentry through `FetchFailure.url`; a key sent to the wrong host hands it to
 * another service; and a Semantic Scholar key that switches the source on by
 * itself would use a non-commercial licence in a paid product.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorFields } from "../src/log.js";
import { sanitise } from "../src/monitoring-scrub.js";
import { BIBLIOGRAPHIC_HOSTS, FetchFailure, fetchBibliographicJson, type FetchLike } from "../src/fetch.js";
import { openAlexKey, optionalSources, registryKeyHeaders, semanticScholarKey } from "../src/registry-keys.js";

const OA_KEY = "oa-secret-key-0123456789";
const S2_KEY = "s2-secret-key-9876543210";
const NAMES = ["OPENALEX_API_KEY", "SEMANTIC_SCHOLAR_API_KEY", "SEMANTIC_SCHOLAR_COMMERCIAL_USE"] as const;

let saved: Partial<Record<(typeof NAMES)[number], string>> = {};
beforeEach(() => {
  saved = {};
  for (const name of NAMES) {
    if (process.env[name] !== undefined) saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const resolve = vi.fn(async () => ["104.18.0.1"]);
const OA_URL = "https://api.openalex.org/works/doi:10.1038/nn.4304?select=display_name";
const S2_URL = "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/nn.4304?fields=paperId,title,abstract";
const CROSSREF_URL = "https://api.crossref.org/works/10.1038/nn.4304";

function headersOf(fetchImpl: ReturnType<typeof vi.fn<FetchLike>>): Record<string, string> {
  return fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
}

/** Everything a failure could carry to a log line or an event: message, url, cause, and the logger's own view. */
function everythingAbout(err: unknown): string {
  const f = err as FetchFailure;
  return JSON.stringify([f.message, f.url, String(f.cause), f.stack, errorFields(err), Object.entries(f)]);
}

describe("the readers", () => {
  it("read each value per call, trimmed, and null when unset or blank", () => {
    expect(openAlexKey()).toBeNull();
    process.env.OPENALEX_API_KEY = `  ${OA_KEY}\n`;
    expect(openAlexKey()).toBe(OA_KEY);
    process.env.OPENALEX_API_KEY = "   ";
    expect(openAlexKey()).toBeNull();
    process.env.SEMANTIC_SCHOLAR_API_KEY = S2_KEY;
    expect(semanticScholarKey()).toBe(S2_KEY);
  });

  it("switch Semantic Scholar on only with its key AND the approval, and OpenAlex with its key alone (R5)", () => {
    expect(optionalSources()).toEqual({ semanticScholar: false, openAlexKeyed: false });
    process.env.SEMANTIC_SCHOLAR_API_KEY = S2_KEY;
    expect(optionalSources().semanticScholar).toBe(false);
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "yes";
    expect(optionalSources().semanticScholar).toBe(false);
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
    expect(optionalSources().semanticScholar).toBe(true);
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    expect(optionalSources().semanticScholar).toBe(false);
    process.env.OPENALEX_API_KEY = OA_KEY;
    expect(optionalSources().openAlexKeyed).toBe(true);
  });

  it("give a header only for the named registry's own host — and Semantic Scholar's only with its approval (R5)", () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    process.env.SEMANTIC_SCHOLAR_API_KEY = S2_KEY;
    expect(registryKeyHeaders("semantic-scholar", "api.semanticscholar.org")).toEqual({});
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
    expect(registryKeyHeaders("openalex", "api.openalex.org")).toEqual({ Authorization: `Bearer ${OA_KEY}` });
    expect(registryKeyHeaders("semantic-scholar", "api.semanticscholar.org")).toEqual({ "x-api-key": S2_KEY });
    expect(registryKeyHeaders("openalex", "api.crossref.org")).toEqual({});
    expect(registryKeyHeaders("openalex", "api.semanticscholar.org")).toEqual({});
    expect(registryKeyHeaders("semantic-scholar", "api.openalex.org")).toEqual({});
  });
});

/** Both of Semantic Scholar's switches on: its key and the recorded approval. */
function approveS2(): void {
  process.env.SEMANTIC_SCHOLAR_API_KEY = S2_KEY;
  process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
}

describe("fetchBibliographicJson with a registry key", () => {
  it("dials Semantic Scholar's API host only with its key AND approval, named — refused before DNS otherwise (R5)", async () => {
    expect(BIBLIOGRAPHIC_HOSTS).toContain("api.semanticscholar.org");
    const refusedWith = async (registryKey?: "openalex" | "semantic-scholar") => {
      const fetchImpl = vi.fn<FetchLike>(async () => Response.json({ paperId: "x" }));
      const dns = vi.fn(async () => ["104.18.0.1"]);
      await expect(
        fetchBibliographicJson(S2_URL, { fetchImpl, resolve: dns, ...(registryKey ? { registryKey } : {}) }),
        String(registryKey),
      ).rejects.toMatchObject({ code: "blocked-address" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(dns).not.toHaveBeenCalled();
    };
    /* No key: no anonymous request either. */
    await refusedWith("semantic-scholar");
    await refusedWith();
    /* A key with no approval, or the wrong word. */
    process.env.SEMANTIC_SCHOLAR_API_KEY = S2_KEY;
    await refusedWith("semantic-scholar");
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "yes";
    await refusedWith("semantic-scholar");
    /* Approved, but the caller did not name Semantic Scholar's key. */
    process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE = "approved";
    await refusedWith();
    await refusedWith("openalex");

    const fetchImpl = vi.fn<FetchLike>(async () => Response.json({ paperId: "x" }));
    await expect(fetchBibliographicJson(S2_URL, { fetchImpl, resolve, registryKey: "semantic-scholar" })).resolves.toEqual({
      paperId: "x",
    });
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe("manual");
  });

  it("sends each key in its header, never in the URL", async () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    approveS2();
    const oa = vi.fn<FetchLike>(async () => Response.json({}));
    await fetchBibliographicJson(OA_URL, { fetchImpl: oa, resolve, registryKey: "openalex" });
    expect(headersOf(oa).Authorization).toBe(`Bearer ${OA_KEY}`);
    expect(String(oa.mock.calls[0]![0])).not.toContain(OA_KEY);

    const s2 = vi.fn<FetchLike>(async () => Response.json({}));
    await fetchBibliographicJson(S2_URL, { fetchImpl: s2, resolve, registryKey: "semantic-scholar" });
    expect(headersOf(s2)["x-api-key"]).toBe(S2_KEY);
    expect(String(s2.mock.calls[0]![0])).not.toContain(S2_KEY);
  });

  it("sends no key to another host, whatever registry the caller names", async () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    approveS2();
    /* (Semantic Scholar's host with OpenAlex named is refused outright: the first test.) */
    for (const [url, name] of [
      [CROSSREF_URL, "openalex"],
      [CROSSREF_URL, "semantic-scholar"],
      [OA_URL, "semantic-scholar"],
    ] as const) {
      const fetchImpl = vi.fn<FetchLike>(async () => Response.json({}));
      await fetchBibliographicJson(url, { fetchImpl, resolve, registryKey: name });
      const sent = JSON.stringify(headersOf(fetchImpl));
      expect(sent, `${name} → ${url}`).not.toContain(OA_KEY);
      expect(sent, `${name} → ${url}`).not.toContain(S2_KEY);
    }
  });

  it("sends no key when none is named, or none is set", async () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    const unnamed = vi.fn<FetchLike>(async () => Response.json({}));
    await fetchBibliographicJson(OA_URL, { fetchImpl: unnamed, resolve });
    expect(headersOf(unnamed)).not.toHaveProperty("Authorization");
    delete process.env.OPENALEX_API_KEY;
    const unset = vi.fn<FetchLike>(async () => Response.json({}));
    await fetchBibliographicJson(OA_URL, { fetchImpl: unset, resolve, registryKey: "openalex" });
    expect(headersOf(unset)).not.toHaveProperty("Authorization");
  });

  it("keeps the key out of a 429's failure: message, url, cause and log fields alike", async () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    approveS2();
    for (const [url, name, key] of [
      [OA_URL, "openalex", OA_KEY],
      [S2_URL, "semantic-scholar", S2_KEY],
    ] as const) {
      const limited = vi.fn<FetchLike>(async () => new Response("{}", { status: 429, headers: { "retry-after": "5" } }));
      const tooMany = await fetchBibliographicJson(url, { fetchImpl: limited, resolve, registryKey: name }).catch((e: unknown) => e);
      expect(tooMany).toBeInstanceOf(FetchFailure);
      expect((tooMany as FetchFailure).status).toBe(429);
      expect((tooMany as FetchFailure).retryAfterMs).toBe(5_000);
      expect(headersOf(limited)).not.toEqual({});
      expect(everythingAbout(tooMany), `${name} 429`).not.toContain(key);
    }
  });

  /**
   * **A transport that puts the key it was handed into its own error** — in
   * its message and in its cause, the worst a dependency could do. The
   * failure we throw is rebuilt from safe fields, so neither it, nor what the
   * logger writes of it, nor the event Sentry is sent carries the key.
   */
  it("rebuilds a keyed request's network failure from safe fields, whatever the transport said", async () => {
    process.env.OPENALEX_API_KEY = OA_KEY;
    approveS2();
    for (const [url, name, key] of [
      [OA_URL, "openalex", OA_KEY],
      [S2_URL, "semantic-scholar", S2_KEY],
    ] as const) {
      const leaky = vi.fn<FetchLike>(async (_url, init) => {
        const sent = JSON.stringify(init.headers);
        throw new TypeError(`fetch failed with ${sent}`, { cause: new Error(`socket hang up, headers ${sent}`) });
      });
      const down = await fetchBibliographicJson(url, { fetchImpl: leaky, resolve, registryKey: name }).catch((e: unknown) => e);
      expect(leaky).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(leaky.mock.calls[0]![1].headers), "the fake really held the key").toContain(key);
      expect(down).toBeInstanceOf(FetchFailure);
      expect((down as FetchFailure).url).toBe(url);
      expect(everythingAbout(down), `${name} failure`).not.toContain(key);
      expect(JSON.stringify(errorFields(down)), `${name} log`).not.toContain(key);
      const scrubbed = sanitise(down);
      expect(JSON.stringify([scrubbed.error.message, scrubbed.error.stack, scrubbed.props]), `${name} sentry`).not.toContain(key);
    }
  });

  it("leaves a keyless request's network failure as it always was, cause and all", async () => {
    const broken = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed", { cause: new Error("socket hang up") });
    });
    const down = await fetchBibliographicJson(OA_URL, { fetchImpl: broken, resolve }).catch((e: unknown) => e);
    expect(down).toBeInstanceOf(FetchFailure);
    expect((down as FetchFailure).cause).toBeDefined();
  });
});
