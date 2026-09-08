// @vitest-environment jsdom
/**
 * **A Debate row written before the lean vocabulary changed, drawn by the panel
 * that came after it.**
 *
 * On 2026-09-08 `DebateValence` became `DebateLean` and its four values went
 * from sentiment words to agreement words — `positive` → `leans-for`, and so on
 * (src/types.ts § `DebateLean`, and the plan's § E″ for why). Every row already
 * in `article_revisions.debate` was written under the old vocabulary.
 *
 * **Nothing revalidates those rows on the way out.** `isDebateDocument` checks
 * that the two groups hold arrays and asks nothing at all about the rows inside
 * them, and Postgres hands JSONB back unchecked — so an old row arrives typed as
 * `DebateRow` while carrying a field that no longer exists and missing the one
 * that does. Index the appearance table with it directly and you get
 * `undefined`; the next property access takes the panel down. That is Sol's F68,
 * and it is the second time this exact assumption has been wrong here — the
 * first cost a reader the sentence *"offered 5 of these; 3 are shown — ."*, with
 * `lossesOf` written afterwards to close it (src/types.ts).
 *
 * So these tests build their fixtures the way the database does: an object in
 * the **old** shape, cast through `unknown`. A fixture that satisfies the
 * current type would be testing nothing, because the current type is exactly
 * what the stored row does not satisfy.
 *
 * The positive control is the last test in each block: something that proves
 * these assertions can still fail.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BlockId,
  ClaimDebateRow,
  Debate,
  DebateCounts,
  DebateLosses,
  DirectDebateRow,
  IdentificationLevel,
} from "../src/types.js";
import { readStoredLean } from "../src/types.js";
import type { UseDebate } from "../src/web/useDebate.js";

const { DebatePanel, LEAN_APPEARANCE } = await import("../src/web/DebatePanel.js");

const KNOWN = "spya-k3m9qt" as BlockId;

/**
 * **A row in the vocabulary of 2026-09-07**, cast the way the store casts.
 *
 * `valence` and no `lean`, which is what every stored artefact looks like.
 */
function legacyDirect(valence: string): DirectDebateRow {
  return {
    id: "spya-d2w4rt",
    url: "https://example.org/a-reply",
    title: "A reply to the piece",
    sourceQuote: "the argument here does not survive its own third section",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "disputes",
    valence,
    applies: "It says the piece's third section contradicts its second.",
    identifies: [{ kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" }],
  } as unknown as DirectDebateRow;
}

function legacyClaim(valence: string): ClaimDebateRow {
  return {
    id: "spya-c7w2dn",
    url: "https://another.example.net/on-starters",
    title: "On starters",
    sourceQuote: "warmer water is what a day-three starter wants",
    relation: "qualifies",
    valence,
    applies: "It agrees with the claim but only above 22°C.",
    claimQuote: "a starter needs cool water",
    blockId: KNOWN,
  } as unknown as ClaimDebateRow;
}

function losses(): DebateLosses {
  return {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  };
}

function counts(): DebateCounts {
  return {
    returnedSources: 2,
    reportedRows: 1,
    keptRows: 1,
    omittedOverCap: 0,
    lost: losses(),
    webSearches: 3,
  };
}

function artefact(rows: { direct: DirectDebateRow[]; claims: ClaimDebateRow[] }): Debate {
  return {
    version: "debate/1",
    generator: "a-model",
    slug: "a-piece",
    sourceHash: "hash",
    searchedAt: "2026-09-05T10:00:00.000Z",
    direct: { rows: rows.direct, counts: counts() },
    claims: { rows: rows.claims, counts: counts() },
    elapsedMs: 1,
  };
}

function owner(debate: Debate): UseDebate {
  return {
    status: "ready",
    debate,
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

let host: HTMLDivElement;
let root: Root;

/* `named` is *show everything* — the fixture row is `named`-only, so any other
   level would be testing the identification bar by accident. */
function paint(o: UseDebate, level: IdentificationLevel | null = "named") {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        access: { kind: "owner", owner: o },
        onJump: () => {},
        level,
        onLevel: () => {},
      }),
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("readStoredLean carries the old vocabulary forward", () => {
  /* All four, because a partial map is the shape that reads as working: three
     right and one `cannot-tell` would look calm on screen and be a lie. */
  it("maps every one of the four legacy values", () => {
    expect(readStoredLean({ valence: "positive" })).toBe("leans-for");
    expect(readStoredLean({ valence: "negative" })).toBe("leans-against");
    expect(readStoredLean({ valence: "neutral" })).toBe("neither");
    expect(readStoredLean({ valence: "unknown" })).toBe("cannot-tell");
  });

  it("prefers a row's own lean when it has one", () => {
    expect(readStoredLean({ lean: "leans-for" })).toBe("leans-for");
    /* A row written after the change has no `valence` at all. */
    expect(readStoredLean({ lean: "neither" })).toBe("neither");
  });

  it("ignores a valence when a valid lean is present, rather than blending them", () => {
    expect(readStoredLean({ lean: "leans-for", valence: "negative" })).toBe("leans-for");
  });

  it("answers cannot-tell for a row that has neither field, and for nonsense", () => {
    expect(readStoredLean({})).toBe("cannot-tell");
    expect(readStoredLean({ lean: "62% negative" })).toBe("cannot-tell");
    expect(readStoredLean({ valence: "supportive" })).toBe("cannot-tell");
    /* A lean-shaped value in the wrong field is still not a lean. */
    expect(readStoredLean({ lean: null, valence: 7 })).toBe("cannot-tell");
  });

  /* The positive control. If the two vocabularies ever collapsed into one set of
     strings, every assertion above would pass while proving nothing. */
  it("is mapping between two genuinely different vocabularies", () => {
    const legacy = ["positive", "negative", "neutral", "unknown"];
    const current = Object.keys(LEAN_APPEARANCE);
    expect(current).toHaveLength(4);
    for (const word of legacy) expect(current).not.toContain(word);
  });
});

describe("the panel draws a row stored under the old vocabulary", () => {
  /* The crash this is here for: `LEAN_APPEARANCE[row.lean]` on a legacy row is
     `undefined`, and the line after it reads `look.icon`. */
  it("renders without throwing, and says Critical for a legacy negative", () => {
    const debate = artefact({ direct: [legacyDirect("negative")], claims: [] });
    expect(() => paint(owner(debate))).not.toThrow();
    expect(host.textContent ?? "").toContain(LEAN_APPEARANCE["leans-against"].label);
  });

  it("says Supportive for a legacy positive, on a claim row too", () => {
    const debate = artefact({ direct: [], claims: [legacyClaim("positive")] });
    expect(() => paint(owner(debate))).not.toThrow();
    expect(host.textContent ?? "").toContain(LEAN_APPEARANCE["leans-for"].label);
  });

  it("draws the quiet pair calmly rather than as a failure", () => {
    const debate = artefact({ direct: [legacyDirect("unknown")], claims: [] });
    paint(owner(debate));
    expect(host.textContent ?? "").toContain(LEAN_APPEARANCE["cannot-tell"].label);
    /* Same chip element as the other three — the quiet answers are not styled as
       a warning. src/web/DebatePanel.tsx § `LEAN_APPEARANCE`. */
    expect(host.querySelector(".dbt-lean")).not.toBeNull();
  });

  it("gives a row with no stance at all the calm answer rather than nothing", () => {
    const debate = artefact({ direct: [legacyDirect("")], claims: [] });
    expect(() => paint(owner(debate))).not.toThrow();
    expect(host.textContent ?? "").toContain(LEAN_APPEARANCE["cannot-tell"].label);
  });

  /* The positive control for this block: the labels are distinguishable, so
     "contains the label" is a real assertion rather than a substring accident. */
  it("has four labels no two of which are the same", () => {
    const labels = Object.values(LEAN_APPEARANCE).map((a) => a.label);
    expect(new Set(labels).size).toBe(4);
  });
});
