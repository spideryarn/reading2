/**
 * **What the glossary panel's run button will do — append or rewrite** —
 * `panelRunKind` in src/glossary.ts, which picks the label *Find more* or *Find
 * terms again*. Plan 261003c § 1.
 *
 * The case that made it a server answer rather than the panel's own guess is
 * the cleared profile: a list written for a profile, pressed after the reader
 * deleted theirs, is run with no profile, so `existingFor` refuses to append —
 * and `profileChanged` deliberately says false there (src/profile.ts §
 * `profileIsStale`). GPT Sol's plan review, P1.
 *
 * Each case is also checked against `existingFor` itself, with the press's
 * profile hash, so the two cannot reach different verdicts.
 */
import { describe, expect, it } from "vitest";
import { existingFor, PROMPT_VERSION, panelRunKind } from "../src/glossary.js";
import type { Glossary } from "../src/types.js";

const SOURCE = "source-hash";

function list(over: Partial<Glossary> = {}): Glossary {
  return {
    version: PROMPT_VERSION,
    generator: "test",
    slug: "a-piece",
    sourceHash: SOURCE,
    profileHash: null,
    entries: [],
    passes: 1,
    generatedAt: "2026-10-03T00:00:00.000Z",
    elapsedMs: 1,
    ...over,
  };
}

/** The verdict `existingFor` reaches for the panel's press: the list's own setting. */
function viaExistingFor(g: Glossary, sourceNow: string, nowHash: string | null): "append" | "rewrite" {
  const pressHash = g.profileHash == null ? null : nowHash;
  return existingFor(g, sourceNow, pressHash) ? "append" : "rewrite";
}

const CASES: {
  name: string;
  g: Glossary;
  sourceNow: string;
  nowHash: string | null;
  want: "append" | "rewrite";
}[] = [
  { name: "a current plain list, reader with a profile", g: list(), sourceNow: SOURCE, nowHash: "p1", want: "append" },
  { name: "a current plain list, reader without one", g: list(), sourceNow: SOURCE, nowHash: null, want: "append" },
  { name: "a profiled list, same profile", g: list({ profileHash: "p1" }), sourceNow: SOURCE, nowHash: "p1", want: "append" },
  { name: "a profiled list, profile changed", g: list({ profileHash: "p1" }), sourceNow: SOURCE, nowHash: "p2", want: "rewrite" },
  { name: "a profiled list, profile cleared", g: list({ profileHash: "p1" }), sourceNow: SOURCE, nowHash: null, want: "rewrite" },
  { name: "an outdated list", g: list({ version: "glossary/4" }), sourceNow: SOURCE, nowHash: null, want: "rewrite" },
  { name: "a stale list", g: list(), sourceNow: "moved", nowHash: null, want: "rewrite" },
];

describe("panelRunKind", () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.want}`, () => {
      const found = {
        glossary: c.g,
        stale: c.g.sourceHash !== c.sourceNow,
        outdated: c.g.version !== PROMPT_VERSION,
      };
      expect(panelRunKind(found, c.nowHash)).toBe(c.want);
      expect(viaExistingFor(c.g, c.sourceNow, c.nowHash)).toBe(c.want);
    });
  }
});
