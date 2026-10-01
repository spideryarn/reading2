/**
 * **What the next glossary run will do with the list it finds** —
 * `glossaryRunKind` in src/glossary.ts, which the Metadata page shows before
 * the press (docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md § 3).
 *
 * The verdict has to be the run's own, so these cases are the branches of
 * `existingFor` read through it: an `append` that the run then rewrote, or the
 * other way round, is the page promising one thing and the button doing
 * another — exactly what *Find more terms* did until 2026-09-30.
 */
import { describe, expect, it } from "vitest";

import { glossaryRunKind, PROMPT_VERSION } from "../src/glossary.js";
import { hashProfile, renderProfile } from "../src/profile.js";
import type { Glossary } from "../src/types.js";

const SOURCE = "deadbeefdeadbeef";
const PROFILE = renderProfile({ profile: "A physicist.", purpose: null });
if (PROFILE === null) throw new Error("the fixture profile rendered as nothing");

const list = (over: Partial<Glossary> = {}): Glossary => ({
  version: PROMPT_VERSION,
  generator: "m",
  slug: "a-slug",
  sourceHash: SOURCE,
  profileHash: null,
  entries: [],
  passes: 1,
  generatedAt: "2026-10-01T00:00:00.000Z",
  elapsedMs: 1,
  ...over,
});

describe("glossaryRunKind", () => {
  it("is first when there is no list", () => {
    expect(glossaryRunKind(null, SOURCE)).toBe("first");
  });

  it("is append for a list of this source and this prompt", () => {
    expect(glossaryRunKind(list(), SOURCE)).toBe("append");
    /* Written before the field existed: the same as written without one. */
    const { profileHash: _gone, ...old } = list();
    expect(glossaryRunKind(old, SOURCE)).toBe("append");
    /* A legacy profiled list too: the run carries no profile since plan
       261001m, and an unprofiled run appends to it under its old stamp. */
    expect(glossaryRunKind(list({ profileHash: hashProfile(PROFILE) }), SOURCE)).toBe("append");
  });

  it("is rewrite when the article or the prompt has moved", () => {
    expect(glossaryRunKind(list(), "another-source")).toBe("rewrite");
    expect(glossaryRunKind(list({ version: "glossary/1" }), SOURCE)).toBe("rewrite");
  });

  it("cannot tell without a source fingerprint, unless there is no list at all", () => {
    expect(glossaryRunKind(list(), null)).toBeNull();
    expect(glossaryRunKind(null, null)).toBe("first");
  });
});
