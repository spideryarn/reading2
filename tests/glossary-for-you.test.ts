/**
 * **"For you" marks on the glossary — the parts with a right answer.**
 *
 * The marks are a model's claims about a list we hold, so what is checked here
 * is what code does to those claims: an invented term is dropped, the list is
 * capped, a note is held to one line, and the hash that says *which* glossary
 * the marks annotate moves with exactly what the prompt was shown (GPT Sol's
 * finding 5 on plan 261001m: one serializer for the prompt and the hash).
 *
 * The call itself is stubbed at `openRouterJson`; no model is reached.
 * docs/plans/261001m-shared-mode-output-for-everyone-personalisation-as-an-addendum.md.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const answer = { content: "" };
const calls: { job: string; body: { model: string; messages: { role: string; content: string }[] } }[] = [];

vi.mock("../src/ai-call.js", () => ({
  openRouterJson: vi.fn(async (job: string, body: (typeof calls)[number]["body"]) => {
    calls.push({ job, body });
    return {
      json: {
        choices: [{ message: { content: answer.content } }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      },
      answeredBy: "openai/gpt-test",
      generationId: null,
    };
  }),
}));

const {
  failedForYou,
  FOR_YOU_MAX_MARKS,
  FOR_YOU_NOTE_MAX,
  forYouGlossaryHash,
  forYouIsCurrent,
  forYouTermList,
  forYouView,
  marksForGlossary,
  generateGlossaryForYou,
  GLOSSARY_FOR_YOU_SYSTEM,
  PROMPT_VERSION,
  toMarks,
} = await import("../src/glossary-for-you.js");
const { hashProfile } = await import("../src/profile.js");

import type { GlossaryEntry } from "../src/types.js";

function entry(id: string, name: string, senseHere: string): GlossaryEntry {
  return { id, name, kind: "concept", aliases: [], senseHere, blocks: [] };
}

/** Twelve terms, so a cap of eight has something to cut. */
const ENTRIES: GlossaryEntry[] = Array.from({ length: 12 }, (_, i) =>
  entry(`spya-term${String(i).padStart(2, "0")}`, `Term ${i}`, `What term ${i} means here.`),
);
const GLOSSARY = { entries: ENTRIES };
const PROFILE = "About the reader: A neuroscientist who works on attention.";

beforeEach(() => {
  calls.length = 0;
  answer.content = "";
});

describe("toMarks", () => {
  it("drops a mark naming a term the glossary does not have", () => {
    const got = toMarks(
      {
        marks: [
          { id: "spya-term03", note: "Real." },
          { id: "spya-invent", note: "The model made this term up." },
        ],
      },
      GLOSSARY,
    );
    expect(got?.marks).toEqual([{ termId: "spya-term03", note: "Real." }]);
    expect(got?.dropped.unknownId).toBe(1);
  });

  it(`keeps at most ${FOR_YOU_MAX_MARKS}, the first the model gave, in the glossary's order`, () => {
    /* Given in reverse, so "the first eight given" and "the first eight in the
       list" are different sets, and the order of what is returned is checked
       against the glossary rather than the answer. */
    const given = [...ENTRIES].reverse().map((e) => ({ id: e.id, note: `About ${e.name}.` }));
    const got = toMarks({ marks: given }, GLOSSARY);
    expect(got?.marks).toHaveLength(FOR_YOU_MAX_MARKS);
    expect(got?.dropped.overCap).toBe(ENTRIES.length - FOR_YOU_MAX_MARKS);
    expect(got?.marks.map((m) => m.termId)).toEqual(ENTRIES.slice(4).map((e) => e.id));
  });

  it("drops a duplicate and a blank note, and cuts a long note to one line", () => {
    const long = `${"word ".repeat(60)}end.`;
    const got = toMarks(
      {
        marks: [
          { id: "spya-term01", note: long },
          { id: "spya-term01", note: "Again." },
          { id: "spya-term02", note: "   " },
        ],
      },
      GLOSSARY,
    );
    expect(got?.marks).toHaveLength(1);
    expect(got?.marks[0]?.note.length).toBeLessThanOrEqual(FOR_YOU_NOTE_MAX);
    expect(got?.marks[0]?.note.endsWith("…")).toBe(true);
    expect(got?.dropped).toMatchObject({ duplicate: 1, noNote: 1, shortened: 1 });
  });

  it("takes an empty list as a real answer, and no list as no answer", () => {
    expect(toMarks({ marks: [] }, GLOSSARY)?.marks).toEqual([]);
    expect(toMarks({ terms: [] }, GLOSSARY)).toBeNull();
    expect(toMarks("not json", GLOSSARY)).toBeNull();
  });
});

describe("forYouGlossaryHash", () => {
  it("moves when a gloss changes, and the prompt's list moves with it", () => {
    const before = forYouGlossaryHash(GLOSSARY);
    const edited = {
      entries: ENTRIES.map((e, i) => (i === 5 ? { ...e, senseHere: "A different sense entirely." } : e)),
    };
    expect(forYouGlossaryHash(edited)).not.toBe(before);
    /* The one serializer: what moved the hash is in what the model reads. */
    expect(forYouTermList(edited)).toContain("A different sense entirely.");
  });

  it("moves when the order or a name changes, and not for a web lookup", () => {
    const before = forYouGlossaryHash(GLOSSARY);
    expect(forYouGlossaryHash({ entries: [...ENTRIES].reverse() })).not.toBe(before);
    expect(
      forYouGlossaryHash({ entries: ENTRIES.map((e, i) => (i === 0 ? { ...e, name: "Renamed" } : e)) }),
    ).not.toBe(before);
    const looked = ENTRIES.map((e, i) =>
      i === 0
        ? { ...e, lookup: { answer: "web", citations: [], searches: 1, model: "m", at: "2026-10-01" } }
        : e,
    );
    expect(forYouGlossaryHash({ entries: looked })).toBe(before);
  });
});

describe("the prompt", () => {
  it("carries the term list and the profile, and no article text", async () => {
    answer.content = JSON.stringify({ marks: [{ id: "spya-term02", note: "Bridges to what you know." }] });
    const run = await generateGlossaryForYou({ slug: "a-slug", glossary: GLOSSARY, profile: PROFILE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toBe("glossary-for-you");
    const user = calls[0]?.body.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain(PROFILE);
    expect(user).toContain(forYouTermList(GLOSSARY));
    expect(run.forYou).toMatchObject({
      version: PROMPT_VERSION,
      glossaryHash: forYouGlossaryHash(GLOSSARY),
      profileHash: hashProfile(PROFILE),
      marks: [{ termId: "spya-term02", note: "Bridges to what you know." }],
    });
  });

  it("forbids the flattering shape verbatim", () => {
    expect(GLOSSARY_FOR_YOU_SYSTEM).toContain("As a cognitive scientist, you'll appreciate that…");
    /* The profile goes in the user message, never the instructions. */
    expect(GLOSSARY_FOR_YOU_SYSTEM).not.toContain(PROFILE);
  });

  it("throws on an answer with no marks list rather than storing an empty one", async () => {
    answer.content = "I could not find any terms.";
    await expect(
      generateGlossaryForYou({ slug: "a-slug", glossary: GLOSSARY, profile: PROFILE }),
    ).rejects.toThrow();
  });

  it("does not turn a non-empty but wholly unusable answer into a successful empty result", async () => {
    answer.content = JSON.stringify({
      marks: [{ id: "spya-invent", note: "The model made this term up." }],
    });
    await expect(
      generateGlossaryForYou({ slug: "a-slug", glossary: GLOSSARY, profile: PROFILE }),
    ).rejects.toThrow(/no usable marks/);
  });

  it("keeps an explicit empty marks list as a successful answer", async () => {
    answer.content = JSON.stringify({ marks: [] });
    const run = await generateGlossaryForYou({
      slug: "a-slug",
      glossary: GLOSSARY,
      profile: PROFILE,
    });
    expect(run.forYou.marks).toEqual([]);
  });
});

describe("what the owner's glossary GET shows", () => {
  const stored = {
    version: PROMPT_VERSION,
    generator: "m",
    slug: "a-slug",
    glossaryHash: forYouGlossaryHash(GLOSSARY),
    profileHash: hashProfile(PROFILE),
    marks: [{ termId: "spya-term02", note: "A line." }],
    generatedAt: "2026-10-01T00:00:00.000Z",
    elapsedMs: 1,
  };

  it("hides marks made for a different version of the list", () => {
    /* A *Find more* appended a term: the stored marks annotate the list before it. */
    const grown = { entries: [...ENTRIES, entry("spya-termnew", "New term", "Arrived later.")] };
    expect(marksForGlossary(stored, grown)).toBeNull();
    /* The control: the same marks against the list they were made for. */
    expect(marksForGlossary(stored, GLOSSARY)).toBe(stored);
  });

  it("says when the marks were made for an older profile, and shows none with no profile", () => {
    expect(forYouView(stored, PROFILE)).toEqual({
      marks: stored.marks,
      marksProfileChanged: false,
      failed: false,
    });
    expect(forYouView(stored, `${PROFILE} Now economics too.`)?.marksProfileChanged).toBe(true);
    expect(forYouView(stored, null)).toBeNull();
    expect(forYouView(null, PROFILE)).toBeNull();
  });
});

describe("forYouIsCurrent", () => {
  const stored = {
    version: PROMPT_VERSION,
    generator: "m",
    slug: "a-slug",
    glossaryHash: forYouGlossaryHash(GLOSSARY),
    profileHash: hashProfile(PROFILE),
    marks: [],
    generatedAt: "2026-10-01T00:00:00.000Z",
    elapsedMs: 1,
  };

  it("is current for the same glossary, profile and prompt", () => {
    expect(forYouIsCurrent(stored, GLOSSARY, PROFILE)).toBe(true);
  });

  it("is never current after a failed call, which the GET says out loud", () => {
    const failed = failedForYou({ slug: "a-slug", glossary: GLOSSARY, profile: PROFILE, elapsedMs: 3 });
    expect(failed.marks).toEqual([]);
    expect(forYouIsCurrent(failed, GLOSSARY, PROFILE)).toBe(false);
    expect(forYouView(marksForGlossary(failed, GLOSSARY), PROFILE)?.failed).toBe(true);
  });

  it("is not for another profile, another list, another prompt, or no profile", () => {
    expect(forYouIsCurrent(stored, GLOSSARY, `${PROFILE} And economics.`)).toBe(false);
    expect(forYouIsCurrent(stored, { entries: ENTRIES.slice(1) }, PROFILE)).toBe(false);
    expect(forYouIsCurrent({ ...stored, version: "glossary-for-you/0" }, GLOSSARY, PROFILE)).toBe(false);
    expect(forYouIsCurrent(stored, GLOSSARY, null)).toBe(false);
  });
});
