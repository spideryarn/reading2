/**
 * **The addresses the lookup offers, and how sure it says it is** —
 * src/author-candidates.ts, plan
 * docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md § R3.
 *
 * Every confidence is computed here, never the model's, so each rule that
 * raises one above *long shot* has a case that keeps it down when its
 * condition fails.
 */
import { describe, expect, it } from "vitest";

import { assembleCandidates, CANDIDATES_MAX, judgeGuess, patternsFor } from "../src/author-candidates.js";

const BOB = { name: "Bob Jones", address: "bob.jones@inkandswitch.com", sourceUrl: "https://inkandswitch.com/people" };

describe("patternsFor", () => {
  it("names the pattern a person's address follows", () => {
    expect(patternsFor("Bob Jones", "bob.jones")).toEqual(["first.last"]);
    expect(patternsFor("Bob Jones", "bjones")).toEqual(["flast"]);
    expect(patternsFor("Bob Jones", "bob")).toEqual(["first"]);
    expect(patternsFor("Zoë Müller", "zoe.muller")).toEqual(["first.last"]);
    expect(patternsFor("Bob Jones", "someoneelse")).toEqual([]);
    expect(patternsFor("Cher", "cher")).toEqual([]);
  });
});

describe("judgeGuess", () => {
  it("is possible when a seen colleague's pattern gives exactly this guess at their domain", () => {
    const c = judgeGuess({ address: "alessandro.warth@inkandswitch.com", colleague: BOB }, "Alessandro Warth");
    expect(c).toMatchObject({ confidence: "medium", patternSeen: true, kind: "guess", sourceUrl: BOB.sourceUrl });
  });

  it("is a long shot when the pattern does not give it", () => {
    expect(judgeGuess({ address: "awarth@inkandswitch.com", colleague: BOB }, "Alessandro Warth")).toMatchObject({
      confidence: "low",
      patternSeen: false,
    });
  });

  it("is a long shot at a different domain", () => {
    expect(judgeGuess({ address: "alessandro.warth@example.org", colleague: BOB }, "Alessandro Warth")).toMatchObject({
      confidence: "low",
    });
  });

  it("is a long shot at a public mail service, however well the pattern fits", () => {
    const gmailBob = { ...BOB, address: "bob.jones@gmail.com" };
    const c = judgeGuess({ address: "alessandro.warth@gmail.com", colleague: gmailBob }, "Alessandro Warth");
    expect(c.confidence).toBe("low");
    expect(c.why).toContain("public mail service");
  });

  it("is a long shot with no colleague, or no author name to apply a pattern to", () => {
    expect(judgeGuess({ address: "a@inkandswitch.com", colleague: null }, "Alessandro Warth").confidence).toBe("low");
    expect(judgeGuess({ address: "alessandro.warth@inkandswitch.com", colleague: BOB }, null).confidence).toBe("low");
  });
});

describe("assembleCandidates", () => {
  const page = (url: string, addresses: { address: string; disguised: boolean }[]) =>
    ({ kind: "read", url, addresses, text: "" }) as const;

  it("puts likely before possible before long shot, each address once", () => {
    const out = assembleCandidates({
      authorName: "Alessandro Warth",
      seenNotNamed: { address: "office@inkandswitch.com", sourceUrl: "https://inkandswitch.com/contact" },
      pages: [
        page("https://tinlizzie.org/~awarth/", [
          { address: "labs@tinlizzie.org", disguised: false },
          { address: "alexwarth@gmail.com", disguised: true },
        ]),
      ],
      guesses: [
        { address: "zzz@inkandswitch.com", colleague: null },
        { address: "alexwarth@gmail.com", colleague: null },
      ],
      exclude: [],
    });
    expect(out.map((c) => [c.address, c.kind, c.confidence])).toEqual([
      ["alexwarth@gmail.com", "on-page-disguised", "high"],
      ["labs@tinlizzie.org", "on-page", "medium"],
      ["office@inkandswitch.com", "in-result", "medium"],
      ["zzz@inkandswitch.com", "guess", "low"],
    ]);
  });

  it("is capped, and never lists an excluded or malformed address", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ address: `a${i}@x.example`, disguised: false }));
    const out = assembleCandidates({
      authorName: null,
      seenNotNamed: null,
      pages: [page("https://x.example/", [...many, { address: "not an address", disguised: false }])],
      guesses: [],
      exclude: ["a0@x.example"],
    });
    expect(out).toHaveLength(CANDIDATES_MAX);
    expect(out.map((c) => c.address)).not.toContain("a0@x.example");
  });
});
