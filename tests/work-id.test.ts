/** The identifier move preserves the existing modules' exports for their callers. */
import { describe, expect, it } from "vitest";

import * as bibliographic from "../src/bibliographic.js";
import * as citationEvidence from "../src/citation-evidence.js";
import * as citedInSpideryarn from "../src/cited-in-spideryarn.js";
import * as workId from "../src/work-id.js";

describe("the work identifier's existing import paths", () => {
  it("keeps the bibliographic lookup's parser and DOI builder", () => {
    expect(bibliographic.parseWorkId).toBe(workId.parseWorkId);
    expect(bibliographic.doiFor).toBe(workId.doiFor);
  });

  it("keeps the citation matcher's address parser and identifier shapes", () => {
    expect(citedInSpideryarn.identityOf).toBe(workId.identityOf);
    expect(citedInSpideryarn.DOI_SHAPE).toBe(workId.DOI_SHAPE);
    expect(citedInSpideryarn.ARXIV_ID_SHAPE).toBe(workId.ARXIV_ID_SHAPE);
  });

  it("keeps the evidence address builder and negative-cache lifetime", () => {
    expect(citationEvidence.evidenceUrl).toBe(workId.evidenceUrl);
    expect(citationEvidence.REGISTRY_NEGATIVE_TTL_MS).toBe(workId.REGISTRY_NEGATIVE_TTL_MS);
  });
});
