/**
 * **Debate's authors and year, from the registry** — plan 261001a stage 6
 * (src/debate-registry.ts). No network: `lookupWork` is a fake.
 */
import { describe, expect, it } from "vitest";

import type { LookupResult, WorkId, WorkRecord } from "../src/bibliographic.js";
import { attachDebateRegistry, debateTitleAgrees, debateWorkId, publisherPathDoi } from "../src/debate-registry.js";
import type { BlockId, ClaimDebateRow, Debate, DirectDebateRow } from "../src/types.js";

describe("which addresses carry an identifier", () => {
  it("reads doi.org and arxiv.org addresses through parseWorkId", () => {
    expect(debateWorkId("https://doi.org/10.1038/nn.4304")).toBe("doi:10.1038/nn.4304");
    expect(debateWorkId("https://arxiv.org/abs/1706.03762v7")).toBe("arxiv:1706.03762");
    expect(debateWorkId("https://arxiv.org/pdf/1809.10635")).toBe("arxiv:1809.10635");
  });

  it("reads a publisher path whose first segment is doi", () => {
    expect(debateWorkId("https://www.pnas.org/doi/10.1073/pnas.2208839120")).toBe("doi:10.1073/pnas.2208839120");
    expect(debateWorkId("https://onlinelibrary.wiley.com/doi/full/10.1111/cogs.13154")).toBe("doi:10.1111/cogs.13154");
    expect(debateWorkId("https://dl.acm.org/doi/10.1145/3442188.3445922")).toBe("doi:10.1145/3442188.3445922");
    expect(debateWorkId("https://dl.acm.org/doi/pdf/10.1145/3442188.3445922?download=true")).toBe(
      "doi:10.1145/3442188.3445922",
    );
    /* A suffix with its own slash is kept whole. */
    expect(publisherPathDoi("https://journals.sagepub.com/doi/abs/10.1177/0956797614524581/x")).toBe(
      "10.1177/0956797614524581/x",
    );
  });

  it("refuses a 10. that is anywhere else", () => {
    /* A path that merely contains a DOI-shaped run. */
    expect(debateWorkId("https://example.com/files/10.1073/pnas.2208839120")).toBeNull();
    /* `doi` further down the path, not first. */
    expect(debateWorkId("https://example.com/blog/doi/10.1073/pnas.2208839120")).toBeNull();
    /* An unknown word between `doi` and the DOI. */
    expect(debateWorkId("https://example.com/doi/mirror/10.1073/pnas.2208839120")).toBeNull();
    /* In the query string. */
    expect(debateWorkId("https://example.com/doi?id=10.1073/pnas.2208839120")).toBeNull();
    expect(debateWorkId("https://example.com/view?doi=10.1073/pnas.2208839120")).toBeNull();
    /* A prefix with no suffix, and a registrant too short to be one. */
    expect(debateWorkId("https://www.pnas.org/doi/10.1073")).toBeNull();
    expect(debateWorkId("https://www.pnas.org/doi/10.17/x")).toBeNull();
    /* A non-default port, a credential, a non-web scheme. */
    expect(debateWorkId("https://www.pnas.org:8443/doi/10.1073/pnas.1")).toBeNull();
    expect(debateWorkId("https://u:p@www.pnas.org/doi/10.1073/pnas.1")).toBeNull();
    expect(debateWorkId("ftp://www.pnas.org/doi/10.1073/pnas.1")).toBeNull();
    /* A publisher's subordinate-object DOI is not the article page. */
    expect(debateWorkId("https://journals.plos.org/doi/10.1371/journal.pone.0123456.s001")).toBeNull();
    /* A plain page. */
    expect(debateWorkId("https://www.nature.com/articles/nn.4304")).toBeNull();
  });
});

describe("the title must agree with the engine's", () => {
  const REG = "Memory sources associated with REM and NREM dream reports throughout the night";
  it("agrees on the whole title, and on the whole title with a site after it", () => {
    expect(debateTitleAgrees(REG, REG)).toBe(true);
    expect(debateTitleAgrees(`${REG} | PNAS`, REG)).toBe(true);
  });
  it("agrees on a cut-short title by its opening words", () => {
    expect(debateTitleAgrees("Memory Sources Associated with REM and NREM Dream Reports ...", REG)).toBe(true);
    expect(debateTitleAgrees("Memory Sources Associated with REM and NREM Dream Reports …", REG)).toBe(true);
  });
  it("disagrees on a different work, a notice about the work, a too-short cut, or no engine title", () => {
    expect(debateTitleAgrees("Soil microbiomes of the Atacama desert", REG)).toBe(false);
    expect(debateTitleAgrees(`Correction to: ${REG}`, REG)).toBe(false);
    expect(debateTitleAgrees("Memory sources ...", REG)).toBe(false);
    expect(debateTitleAgrees(undefined, REG)).toBe(false);
    expect(debateTitleAgrees("  ", REG)).toBe(false);
  });

  it("does not let a generic title or a supplement tail establish identity", () => {
    expect(debateTitleAgrees("Editorial", "Editorial")).toBe(false);
    expect(debateTitleAgrees(`${REG} - Supplementary information`, REG)).toBe(false);
  });
});

/* -------------------------------------------------------------- the step -- */

const BLOCK = "spya-k3m9qt" as BlockId;

function claimRow(id: string, url: string, title?: string): ClaimDebateRow {
  return {
    id,
    url,
    ...(title === undefined ? {} : { title }),
    sourceQuote: "a passage",
    relation: "qualifies",
    lean: "neither",
    applies: "It narrows the claim.",
    claimQuote: "the claim",
    blockId: BLOCK,
  };
}

function directRow(id: string, url: string, title: string): DirectDebateRow {
  return {
    id,
    url,
    title,
    sourceQuote: "a passage",
    relation: "disputes",
    lean: "leans-against",
    applies: "It disputes it.",
    articleReferenceQuote: "the piece",
    identifies: [{ kind: "named", by: "title", witness: "the piece" }],
  };
}

function debateOf(direct: DirectDebateRow[], claims: ClaimDebateRow[]): Debate {
  const counts = {
    returnedSources: 0,
    reportedRows: 0,
    keptRows: 0,
    omittedOverCap: 0,
    lost: {
      uncited: 0,
      selfSource: 0,
      unverifiedSource: 0,
      directnessUnverified: 0,
      sourceIsCopy: 0,
      claimNotInBlock: 0,
      unknownBlockId: 0,
      malformed: 0,
    },
    webSearches: 0,
  };
  return {
    version: "debate/4",
    generator: "m",
    slug: "s",
    sourceHash: "h",
    searchedAt: "2026-10-01T00:00:00.000Z",
    direct: { rows: direct, counts },
    claims: { rows: claims, counts },
    elapsedMs: 1,
  };
}

function found(title: string, over: Partial<WorkRecord> = {}): LookupResult {
  return {
    kind: "found",
    record: {
      id: "doi:10.1073/pnas.1" as WorkId,
      source: "crossref",
      title,
      authors: [{ family: "Wamsley", given: "Erin" }],
      year: 2019,
      doi: "10.1073/pnas.1",
      ...over,
    },
  };
}

describe("attachDebateRegistry", () => {
  it("keeps an agreeing record on every row with that address, asks each identifier once, and never asks for a plain page", async () => {
    const asked: string[] = [];
    const url = "https://www.pnas.org/doi/10.1073/pnas.1";
    const debate = debateOf(
      [directRow("d1", url, "Dreams and memory | PNAS")],
      [claimRow("c1", url, "Dreams and memory | PNAS"), claimRow("c2", "https://blog.example.org/post", "A post")],
    );
    const out = await attachDebateRegistry(debate, {
      lookup: async (id) => {
        asked.push(id);
        return found("Dreams and memory");
      },
    });
    expect(asked).toEqual(["doi:10.1073/pnas.1"]);
    const want = { source: "crossref", title: "Dreams and memory", authors: [{ family: "Wamsley", given: "Erin" }], year: 2019 };
    expect(out.debate.direct.rows[0]?.registry).toEqual(want);
    expect(out.debate.claims.rows[0]?.registry).toEqual(want);
    expect("registry" in (out.debate.claims.rows[1] ?? {})).toBe(false);
    expect(out.counts).toMatchObject({ identified: 1, found: 1, disagreed: 0 });
  });

  it("drops a record whose title disagrees — doi.org included — and one for a row with no engine title", async () => {
    const debate = debateOf(
      [],
      [
        claimRow("c1", "https://doi.org/10.1073/pnas.1", "Something else entirely"),
        claimRow("c2", "https://doi.org/10.1073/pnas.2"),
      ],
    );
    const out = await attachDebateRegistry(debate, {
      lookup: async (id) => found("Dreams and memory", { id, doi: id.slice("doi:".length) }),
    });
    expect(out.debate.claims.rows.map((r) => "registry" in r)).toEqual([false, false]);
    expect(out.counts.disagreed).toBe(2);
  });

  it("survives a registry that is unavailable or throws", async () => {
    const debate = debateOf([], [claimRow("c1", "https://doi.org/10.1073/pnas.1", "Dreams and memory")]);
    const a = await attachDebateRegistry(debate, { lookup: async () => ({ kind: "unavailable", why: "busy" }) });
    expect("registry" in (a.debate.claims.rows[0] ?? {})).toBe(false);
    const b = await attachDebateRegistry(debate, {
      lookup: async () => {
        throw new Error("boom");
      },
    });
    expect("registry" in (b.debate.claims.rows[0] ?? {})).toBe(false);
    expect(b.counts.unavailable).toBe(1);
  });

  it("stops starting lookups when the run budget is spent and leaves every row present", async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      claimRow(`c${i}`, `https://doi.org/10.1073/pnas.${i}`, `Distinctive source title ${i}`),
    );
    let clock = 0;
    const asked: WorkId[] = [];
    const out = await attachDebateRegistry(debateOf([], rows), {
      now: () => clock,
      lookupBudgetMs: 60,
      lookup: async (id) => {
        asked.push(id);
        clock += 61;
        return { kind: "not-found" };
      },
    });
    expect(asked).toEqual(["doi:10.1073/pnas.0"]);
    expect(out.debate.claims.rows).toHaveLength(4);
    expect(out.counts).toMatchObject({ notFound: 1, overBudget: 3 });
  });
});
