/**
 * The reader profile, as prompt bytes.
 *
 * Two properties carry the whole feature and both are pure, so both belong
 * here: **absence leaves no trace**, and **two spellings of one profile are one
 * profile**. The first is what stops an empty box teaching the model that this
 * reader is nobody in particular; the second is what stops a trailing newline
 * marking every artefact on the shelf stale.
 *
 * The staleness table is tested exhaustively rather than by example, because it
 * has three input states and two of them collapse — which is exactly the shape
 * somebody "simplifies" into a boolean a year from now.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_CHARS,
  MAX_PURPOSE_CHARS,
  hashProfile,
  normaliseProfileText,
  profileIsStale,
  renderProfile,
} from "../src/profile.js";

describe("normaliseProfileText", () => {
  it("treats nothing, empty and whitespace-only as the same absence", () => {
    expect(normaliseProfileText(undefined)).toBeNull();
    expect(normaliseProfileText(null)).toBeNull();
    expect(normaliseProfileText("")).toBeNull();
    expect(normaliseProfileText("   \n\t  ")).toBeNull();
  });

  it("settles Windows line endings", () => {
    /* Invisible in every surface a reader or a reviewer would look at, and the
       one place it would matter is the hash. A paste from Word must not be a
       different profile from the same words typed. */
    expect(normaliseProfileText("one\r\ntwo")).toBe("one\ntwo");
  });

  it("keeps the middle of the text exactly as written", () => {
    expect(normaliseProfileText("  I care about  the evidence.  ")).toBe(
      "I care about  the evidence.",
    );
  });
});

describe("renderProfile", () => {
  it("is null when both boxes are empty", () => {
    // Not `""`. A caller that tested truthiness would treat the two the same;
    // a caller that tested `=== null` and got `""` would emit an empty header.
    expect(renderProfile({})).toBeNull();
    expect(renderProfile({ profile: "  ", purpose: "" })).toBeNull();
  });

  it("carries one half on its own", () => {
    expect(renderProfile({ profile: "A physicist." })).toBe("About the reader: A physicist.");
    expect(renderProfile({ purpose: "The evidence." })).toBe(
      "Why they are reading this piece: The evidence.",
    );
  });

  it("puts the two halves in a fixed order", () => {
    /* Fixed because this string is hashed. If the order could vary, the same
       profile would produce two hashes and mark every artefact on the shelf
       stale for a change nobody made. */
    const out = renderProfile({ profile: "A physicist.", purpose: "The evidence." });
    expect(out).toBe("About the reader: A physicist.\nWhy they are reading this piece: The evidence.");
  });

  it("gives one answer for two spellings of one profile", () => {
    const typed = renderProfile({ profile: "A physicist.", purpose: "The evidence." });
    const pasted = renderProfile({ profile: "  A physicist.\r\n", purpose: "The evidence.  " });
    expect(pasted).toBe(typed);
    expect(hashProfile(pasted!)).toBe(hashProfile(typed!));
  });
});

describe("hashProfile", () => {
  it("is sixteen hex characters", () => {
    // Compared for equality and never for closeness, so width past this buys
    // nothing — the same argument hashBlocks makes in src/source-hash.ts.
    expect(hashProfile("anything")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the profile does", () => {
    expect(hashProfile("About the reader: A physicist.")).not.toBe(
      hashProfile("About the reader: A historian."),
    );
  });
});

describe("profileIsStale", () => {
  const now = hashProfile("About the reader: A physicist.");
  const then = hashProfile("About the reader: A historian.");

  it("says no for an artefact written before the feature existed", () => {
    // Nobody's existing glossary should light up with a warning about a profile
    // it never had.
    expect(profileIsStale(undefined, now)).toBe(false);
    expect(profileIsStale(undefined, null)).toBe(false);
  });

  it("says no for one written deliberately without a profile", () => {
    /* The line the whole design rests on. A reader who unchecked the box and
       paid for a plain glossary must not then be told it is out of date — that
       would be a control whose result the app immediately complains about. */
    expect(profileIsStale(null, now)).toBe(false);
    expect(profileIsStale(null, null)).toBe(false);
  });

  it("says no when the profile has not changed", () => {
    expect(profileIsStale(now, now)).toBe(false);
  });

  it("says yes when it has", () => {
    expect(profileIsStale(then, now)).toBe(true);
  });

  it("says no when the reader clears their profile", () => {
    /* You have not changed what you want from the article; you have stopped
       telling us. Rewriting on that would spend money to remove information. */
    expect(profileIsStale(then, null)).toBe(false);
  });
});

describe("the caps", () => {
  it("gives the per-article box the same cap as the summary steer", () => {
    /* The two boxes sit next to each other in the reader's head. One refusing
       at 600 while the other refused at 900 would be a rule about nothing.
       MAX_GUIDANCE_CHARS in src/routes.ts is the other half of this pair. */
    expect(MAX_PURPOSE_CHARS).toBe(600);
  });

  it("gives the global box more room, because it is written once", () => {
    expect(MAX_PROFILE_CHARS).toBeGreaterThan(MAX_PURPOSE_CHARS);
  });
});
