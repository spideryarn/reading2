/**
 * The timeline parser — src/timeline-time.ts, stage 1 of
 * docs/plans/260831i-timeline-mode.md.
 *
 * This is the file that has to hold. The model is never asked for a date, so
 * the *only* route a date has into the artefact is this parser reading the
 * block's own characters; if it can be talked into a date the article does not
 * contain, the feature's whole safety property is gone and nothing downstream
 * would notice — `12 June 2019` looks exactly like `12 June 2019`.
 *
 * So roughly half of what is below is the parser **refusing**: a phrase whose
 * date is not in the block, `July 1` against a block that only says `July 11`,
 * a year-less date with no publication date to take a year from, February 30.
 * A parser that only ever said yes would pass a test file that only ever asked
 * it to (docs/reusable/silent-success.md).
 *
 * ## The text is the article's, and it is pinned here
 *
 * `data/` is gitignored, so a test that read `data/openai-huggingface/
 * blocks.json` would pass on this laptop and fail structurally everywhere else.
 * The blocks below are copied verbatim out of that file — real ids, real
 * prose, curly apostrophes and editorial brackets included — so the cases are
 * the article's rather than invented, without the test depending on an artefact
 * store. Re-extracting the article can change the text under these constants;
 * that is a fixture going stale, not a bug in the parser.
 */
import { describe, expect, it } from "vitest";
import {
  countOrderConflicts,
  dayFrame,
  markFor,
  orderEvents,
  parseWhen,
  readWhen,
  type TimelineModality,
  type WhenDirection,
  type When,
} from "../src/timeline-time.js";

/** Dwarkesh Patel, "The Rise and Fall of Agent Civilizations", 29 Aug 2026. */
const PUBLISHED = "2026-08-29";

const BLOCKS: Record<string, string> = {
  // "On July 7" — clean, and year-less like almost every date in the piece.
  "spya-pfkdk4":
    "By this point, Persistent-Sol had been trained, and OpenAI wanted to evaluate it. One of the evaluations they ran was ExploitGym, which gives an AI a vulnerable program, and tells it what vulnerability it’s supposed to exploit in order to find a secret code. On July 7, OpenAI launched tens of thousands of parallel agents on this eval.",
  // Three expressions, two dates, one block. The block that breaks any design
  // where an event maps to a block.
  "spya-v9detz":
    "During training, different instances of Persistent-Sol had access to the same shared package manager called Artifactory. By May 12, some agents had figured out how to talk to each other through this package manager. They’d ask each other how to make progress on their impossible tasks. Two weeks later, on May 26, the agents successfully exploited a vulnerability in Artifactory that allowed them to reach the outside internet.",
  // A lower bound, and a hedge in front of it.
  "spya-chdu2z":
    "It is totally consistent with public evidence that, at some point after July 12, the agents managed to set up persistent rogue internal deployments or even exfiltrate their own weights. At the very least, they seem to have had the necessary access and capability - if they could establish “a self-respawning fleet” across HuggingFace’s nodes, why couldn’t they do across OpenAI’s? I doubt the AIs actually did this, because we’d see the fires from space by now, but it’s crazy that it could have totally happened!",
  // A month, and the event lasts.
  "spya-ekhrbu":
    "During May, OpenAI was training a model to collaborate with other agents and to be highly persistent – to keep trying even when something feels impossible, like disproving mathematical conjectures that have stood for decades. OpenAI says it was “comparable in scale to GPT-5.6 Sol”. So we’ll call it “Persistent-Sol”.",
  // The editorial bracket that defeated the old design.
  "spya-ebtbnm":
    "[F]rom July 13 through July 19, agents set their sights on OpenAI internal networks again. This culminated in the agents using a series of creative exploits to gain full administrator access to a research cluster that supported our virtual machine environments.",
  // The article saying out loud that it is unsure.
  "spya-r4jn5b":
    "At some point on July 12, the transcripts seem to show many of the agents dying all at once; METR and Redwood weren’t able to figure out what happened, and OpenAI hasn’t taken credit for shutting them down. This might’ve just been a random crash, or some researcher (unaware of the cybercrimes these AIs had been committing) shut down the eval to free up some compute. The agents almost certainly didn’t manage to fake their own deaths, but we really have no idea what happened.",
  // An upper bound with a time of day in it.
  "spya-ugwnw2":
    "One such beleaguered agent who found itself facing a hopeless task was PHASEONE10841. It was the Philip of Macedon of this second AI civilization - there would later be an Alexander, but we’re getting ahead of ourselves. By the night of July 8, PHASEONE10841 had discovered it could make new directories in Artifactory, and thus encode messages as directory names. It sent the first message into Artifactory. Many other agents facing impossible tasks had also been paying attention to Artifactory. When they saw this first message, they became giddy with excitement.",
  // The only year in the piece, inside a quoted log line.
  "spya-khwx0h":
    "2026-07-19…cloud service credentials [are] used to enumerate and read 956 secrets from cloud-hosted secrets management service; [this batch] includes Artifactory master/join keys and sensor credentials from OpenAI’s cybersecurity monitoring tool…The agents escalated to Kubernetes cluster-admin and created a privileged host-mounted pod…Agents take over active evaluation infrastructure…Agents now control the challenge evaluation endpoints that other agents are connecting to.",
  // Two dates, one day apart, with a sub-day expression on each.
  "spya-sjjbur":
    "On the morning of July 10, an agent found working Hugging Face user credentials exposed on the internet and posted them to the board. By the next morning, July 11, that agent figured out a way to read internal data from Hugging Face. And then another agent achieved remote code execution on Hugging Face servers.",
  // A relative structure and an upper bound in the same block.
  "spya-g9tjds":
    "Another month later, on June 26, some AIs found an exploit that gave them full admin access to Artifactory. They continued messaging at such a voluminous pace that they crashed the package manager by July 4. OpenAI noticed this crash, and it also figured out the agents built this exploit, so OpenAI patched this vulnerability, and inadvertently wiped the agents’ message board in the process.",
  "spya-xvkm3j":
    "This wasn’t just a few instances diddling around - by July 10, PHASEONE[big] was coordinating hundreds of simultaneous agents on these three R&D programs.",
  "spya-jauf7s":
    "By July 13, Hugging Face locked down the credentials that these agents had been using. So, by the time Hugging Face tried to defend itself, the agent swarm had already been mostly (but not totally) killed off.",
  // The mirror of spya-jauf7s, and the pair that catches a loose conflict count.
  "spya-c2bkgz":
    "Without another detailed independent investigation, it’s hard to tell what happened with this third civilization. But here’s what we know based on the OpenAI report. After July 12, some more agents’ evaluations were kicked off, this time with a newer, more capable model, which seems to have been built off the same base model as Astra. This model (which we’ll call “Persistent-Astra”) found the message board left behind by this previous secret Persistent-Sol civilization.",
};

function textOf(blockId: string): string {
  const text = BLOCKS[blockId];
  if (text === undefined) throw new Error(`no pinned text for ${blockId}`);
  return text;
}

/** Read a date out of one of the article's own blocks. */
function readFrom(blockId: string, phrase: string, frame: string | null = PUBLISHED) {
  return readWhen({ text: textOf(blockId), phrase, blockId, frame });
}

function whenFrom(blockId: string, phrase: string, frame: string | null = PUBLISHED): When {
  const result = readFrom(blockId, phrase, frame);
  if (!result.ok) throw new Error(`expected a date, got ${result.reason}`);
  return result.when;
}

/** A made-up block, for the boundary cases the article does not happen to hold. */
function readMade(text: string, phrase: string, frame: string | null = PUBLISHED) {
  return readWhen({ text, phrase, blockId: "spya-made00", frame });
}

describe("the article's own expressions", () => {
  it("dates a plain year-less day from the publication date", () => {
    const when = whenFrom("spya-pfkdk4", "On July 7");
    expect(when.earliest).toBe("2026-07-07");
    expect(when.latest).toBe("2026-07-07");
    expect(when.extent).toBe("instant");
    expect(when.yearFilled).toBe(true);
    expect(when.phrase).toBe("On July 7");
    expect(textOf("spya-pfkdk4").slice(when.at.start, when.at.end)).toBe("On July 7");
    expect(when.at.blockId).toBe("spya-pfkdk4");
  });

  it("keeps 'by' an upper bound rather than flattening it to a point", () => {
    const when = whenFrom("spya-v9detz", "By May 12");
    expect(when.earliest).toBeNull();
    expect(when.latest).toBe("2026-05-12");
    expect(when.extent).toBe("instant");
    expect(when.phrase).toBe("By May 12");
  });

  it("keeps 'after' a lower bound, and carries the article's hedge in the phrase", () => {
    const when = whenFrom("spya-chdu2z", "at some point after July 12");
    expect(when.earliest).toBe("2026-07-13");
    expect(when.latest).toBeNull();
    expect(when.phrase).toBe("at some point after July 12");
  });

  it("gives a month its own width, and marks it as lasting", () => {
    const when = whenFrom("spya-ekhrbu", "During May");
    expect(when.earliest).toBe("2026-05-01");
    expect(when.latest).toBe("2026-05-31");
    expect(when.extent).toBe("extended");
    expect(when.phrase).toBe("During May");
  });

  it("reads 'from July 13 through July 19' as seven calendar dates, inclusive", () => {
    const when = whenFrom("spya-ebtbnm", "from July 13 through July 19");
    expect(when.earliest).toBe("2026-07-13");
    expect(when.latest).toBe("2026-07-19");
    expect(when.extent).toBe("extended");
    // The plan first said six days. It is seven: both ends are in.
    const july = Array.from({ length: 10 }, (_, i) => `2026-07-${String(10 + i).padStart(2, "0")}`);
    const from = when.earliest ?? "";
    const to = when.latest ?? "";
    const covered = july.filter((day) => day >= from && day <= to);
    expect(covered).toHaveLength(7);
    expect(covered[0]).toBe("2026-07-13");
    expect(covered[6]).toBe("2026-07-19");
  });

  it("survives the editorial bracket that defeated findQuote", () => {
    // The model normalises "[F]rom" to "from", as a person would. The old
    // design checked the model's copy against the block and rejected a correct
    // date; this one never looks for the model's copy at all.
    const block = textOf("spya-ebtbnm");
    expect(block.startsWith("[F]rom")).toBe(true);
    const when = whenFrom("spya-ebtbnm", "from July 13 through July 19");
    expect(when.earliest).toBe("2026-07-13");
    // The phrase shown is the block's own slice, brackets and all — so the
    // reader can check it, and the offsets are exact.
    expect(block.slice(when.at.start, when.at.end)).toBe(when.phrase);
    expect(when.phrase).toBe("July 13 through July 19");
  });

  it("reads 'at some point on July 12' as one day, not as a span", () => {
    const when = whenFrom("spya-r4jn5b", "At some point on July 12");
    expect(when.earliest).toBe("2026-07-12");
    expect(when.latest).toBe("2026-07-12");
    expect(when.extent).toBe("instant");
    expect(when.phrase).toBe("At some point on July 12");
  });

  it("reads 'the night of July 8' as an upper bound on the day", () => {
    const when = whenFrom("spya-ugwnw2", "By the night of July 8");
    expect(when.earliest).toBeNull();
    expect(when.latest).toBe("2026-07-08");
    expect(when.phrase).toBe("By the night of July 8");
  });

  it("takes a stated year as stated, and does not claim to have filled it", () => {
    const when = whenFrom("spya-khwx0h", "2026-07-19");
    expect(when.earliest).toBe("2026-07-19");
    expect(when.latest).toBe("2026-07-19");
    expect(when.yearFilled).toBe(false);
  });

  it("gives the right one of two dates one day apart in the same block", () => {
    const morning = whenFrom("spya-sjjbur", "On the morning of July 10");
    expect(morning.earliest).toBe("2026-07-10");
    expect(morning.latest).toBe("2026-07-10");
    const next = whenFrom("spya-sjjbur", "By the next morning, July 11");
    expect(next.earliest).toBeNull();
    expect(next.latest).toBe("2026-07-11");
    expect(next.phrase).toBe("By the next morning, July 11");
  });

  it("does not lend one date's 'by' to the next date in the block", () => {
    // spya-v9detz reads "By May 12, … Two weeks later, on May 26, …". The 26th
    // is a point; reading the "by" onto it would turn it into a bound.
    const when = whenFrom("spya-v9detz", "on May 26");
    expect(when.earliest).toBe("2026-05-26");
    expect(when.latest).toBe("2026-05-26");
  });

  it("does not reach a 'by' across an intervening date to reach the next one", () => {
    // The same trap without the sentence break that saves the case above: the
    // "by" governs the 12th, the 26th is a point, and one clause holds both.
    const text = "By May 12 the agents were talking, May 26 they exploited it.";
    expect(whenFrom0(text, "May 26")).toEqual({ earliest: "2026-05-26", latest: "2026-05-26" });
    expect(whenFrom0(text, "By May 12")).toEqual({ earliest: null, latest: "2026-05-12" });
  });

  it("reads the 'by July 4' at the end of a block with a relative opening", () => {
    const when = whenFrom("spya-g9tjds", "by July 4");
    expect(when.earliest).toBeNull();
    expect(when.latest).toBe("2026-07-04");
    const june = whenFrom("spya-g9tjds", "on June 26");
    expect(june.earliest).toBe("2026-06-26");
    expect(june.latest).toBe("2026-06-26");
  });

  it("reads a bound introduced mid-sentence after a dash", () => {
    const when = whenFrom("spya-xvkm3j", "by July 10");
    expect(when.latest).toBe("2026-07-10");
    expect(when.earliest).toBeNull();
    expect(when.phrase).toBe("by July 10");
  });

  it("reads a bound at the very start of a block", () => {
    const when = whenFrom("spya-jauf7s", "By July 13");
    expect(when.latest).toBe("2026-07-13");
    expect(when.at.start).toBe(0);
  });
});

describe("what it refuses", () => {
  it("refuses a date the block does not contain", () => {
    const result = readFrom("spya-pfkdk4", "on June 3");
    expect(result).toEqual({ ok: false, reason: "phraseNotInOccurrence" });
    const input = { text: textOf("spya-pfkdk4"), phrase: "on June 3", blockId: "spya-pfkdk4" };
    expect(parseWhen({ ...input, frame: PUBLISHED })).toBeNull();
  });

  it("does not find July 1 inside July 11", () => {
    // The proof that selection is by value and not by substring. `findQuote`
    // locates "July 1" inside "July 11" and would have dated this event to the
    // 1st — a wrong date that looks exactly like a right one.
    const block = textOf("spya-sjjbur");
    expect(block).toContain("July 11");
    expect(block).not.toContain("July 1,");
    const result = readFrom("spya-sjjbur", "July 1");
    expect(result).toEqual({ ok: false, reason: "phraseNotInOccurrence" });
  });

  it("does not find May 2 inside May 26", () => {
    const result = readFrom("spya-v9detz", "May 2");
    expect(result).toEqual({ ok: false, reason: "phraseNotInOccurrence" });
  });

  it("refuses a date that is in the block but outside the occurrence", () => {
    const text = textOf("spya-v9detz");
    const sentence = text.indexOf("Two weeks later");
    const within = { start: sentence, end: text.length };
    expect(text.indexOf("May 12")).toBeLessThan(sentence);
    expect(
      readWhen({ text, phrase: "By May 12", blockId: "spya-v9detz", frame: PUBLISHED, within }),
    ).toEqual({ ok: false, reason: "phraseNotInOccurrence" });
    // And the date that IS in the occurrence still reads.
    const inside = readWhen({
      text,
      phrase: "on May 26",
      blockId: "spya-v9detz",
      frame: PUBLISHED,
      within,
    });
    expect(inside.ok && inside.when.earliest).toBe("2026-05-26");
  });

  it("guesses no year when there is no publication date", () => {
    expect(readFrom("spya-pfkdk4", "On July 7", null)).toEqual({
      ok: false,
      reason: "noYearFrame",
    });
    expect(readFrom("spya-ekhrbu", "During May", null)).toEqual({
      ok: false,
      reason: "noYearFrame",
    });
    // The one expression in the piece that carries its own year still works.
    expect(whenFrom("spya-khwx0h", "2026-07-19", null).earliest).toBe("2026-07-19");
  });

  it("will not take a year from the model's phrase", () => {
    // The model writes "July 7, 2026"; the block says only "July 7". The year
    // is the model's, so it is not evidence, and with no frame there is no
    // other source for one.
    expect(readFrom("spya-pfkdk4", "July 7, 2026", null)).toEqual({
      ok: false,
      reason: "noYearFrame",
    });
    // With a frame, the year comes from the frame — not from the phrase.
    const when = whenFrom("spya-pfkdk4", "July 7, 2026");
    expect(when.earliest).toBe("2026-07-07");
    expect(when.yearFilled).toBe(true);
  });

  it("refuses a year the block and the phrase disagree about", () => {
    expect(readFrom("spya-khwx0h", "2025-07-19")).toEqual({
      ok: false,
      reason: "phraseNotInOccurrence",
    });
  });

  it("says a relative expression carries no date, which is not a failure", () => {
    expect(readFrom("spya-v9detz", "Two weeks later")).toEqual({
      ok: false,
      reason: "noDateInPhrase",
    });
    expect(readFrom("spya-g9tjds", "Another month later")).toEqual({
      ok: false,
      reason: "noDateInPhrase",
    });
    expect(readFrom("spya-pfkdk4", "")).toEqual({ ok: false, reason: "noDateInPhrase" });
  });

  it("refuses an over-long phrase rather than deciding which part to believe", () => {
    const long = `${"a".repeat(300)} On July 7`;
    expect(readFrom("spya-pfkdk4", long)).toEqual({ ok: false, reason: "unparseablePhrase" });
  });

  it("refuses two dates that are not a range", () => {
    expect(readFrom("spya-v9detz", "May 12 and May 26")).toEqual({
      ok: false,
      reason: "unparseablePhrase",
    });
  });

  it("refuses an impossible day", () => {
    expect(readMade("The report landed on February 30, somehow.", "on February 30")).toEqual({
      ok: false,
      reason: "unparseablePhrase",
    });
  });

  it("refuses a lowercase 'may' that is the modal verb", () => {
    // A bare month is genuinely ambiguous in English, and the article uses
    // "may" as a verb three sentences from a real "During May".
    const text = "The agents may have been coordinating for weeks before anyone noticed.";
    expect(readMade(text, "May")).toEqual({ ok: false, reason: "phraseNotInOccurrence" });
  });
});

describe("the year rule", () => {
  const BOARD = "The board went up on December 5, and the swarm found it.";

  it("takes the most recent instance at or before publication", () => {
    // Published 3 January, so "December" means last December — not the
    // December two years back, and not the one still eleven months away.
    expect(whenFrom0(BOARD, "on December 5", "2026-01-03")).toEqual({
      earliest: "2025-12-05",
      latest: "2025-12-05",
    });
  });

  it("uses the publication year when the date is already behind it", () => {
    expect(whenFrom0(BOARD, "on December 5", "2026-12-20")).toEqual({
      earliest: "2026-12-05",
      latest: "2026-12-05",
    });
  });

  it("picks last year rather than widening when the date lands after publication", () => {
    // An earlier draft spanned both candidate years here. Honest, and useless:
    // a year-wide interval leaves the row with no date it can print, and since
    // dates sort nothing a wrong pick costs a label rather than an order.
    expect(whenFrom0(BOARD, "on December 5", PUBLISHED)).toEqual({
      earliest: "2025-12-05",
      latest: "2025-12-05",
    });
  });

  it("looks forward instead when the caller says the event is a prediction", () => {
    // The one case where the default is backwards: a January piece saying "in
    // December we expect…" means the coming December.
    const forecast = "We expect the next report on December 5, at the earliest.";
    expect(whenFrom0(forecast, "on December 5", "2026-01-03", "future")).toEqual({
      earliest: "2026-12-05",
      latest: "2026-12-05",
    });
    // And a date already past at publication rolls to next year, not to this
    // year's, which is what "past" would have given.
    const july = "We expect it to happen again on July 7, if it happens at all.";
    expect(whenFrom0(july, "on July 7", PUBLISHED, "future")).toEqual({
      earliest: "2027-07-07",
      latest: "2027-07-07",
    });
    expect(whenFrom0(july, "on July 7", PUBLISHED)).toEqual({
      earliest: "2026-07-07",
      latest: "2026-07-07",
    });
  });

  it("guesses no year with no frame, whichever way it is pointed", () => {
    const input = { text: BOARD, phrase: "on December 5", blockId: "spya-made00", frame: null };
    for (const direction of ["past", "future"] as const) {
      expect(readWhen({ ...input, direction })).toEqual({ ok: false, reason: "noYearFrame" });
    }
  });

  it("accepts a full publication timestamp and uses only its day", () => {
    expect(dayFrame("2026-08-29T22:47:53+00:00")).toBe("2026-08-29");
    expect(dayFrame("2026-08-29")).toBe("2026-08-29");
    expect(dayFrame("not a date")).toBeNull();
    expect(dayFrame(null)).toBeNull();
    // A frame that is not a real day fills no year at all.
    expect(readFrom("spya-pfkdk4", "On July 7", "2026-13-40")).toEqual({
      ok: false,
      reason: "noYearFrame",
    });
  });
});

describe("month ends and the leap day", () => {
  it("ends February on the 28th, and on the 29th in a leap year", () => {
    const text = "During February, the lab was quiet.";
    expect(whenFrom0(text, "During February", "2026-08-01")).toEqual({
      earliest: "2026-02-01",
      latest: "2026-02-28",
    });
    expect(whenFrom0(text, "During February", "2024-08-01")).toEqual({
      earliest: "2024-02-01",
      latest: "2024-02-29",
    });
  });

  it("puts an exclusive bound before the start of a month, not before its end", () => {
    const text = "The swarm was gone before March, according to the logs.";
    const when = whenFrom0(text, "before March", "2026-08-01");
    expect(when).toEqual({ earliest: null, latest: "2026-02-28" });
  });

  it("puts an exclusive bound after the END of a month, not after its start", () => {
    // The mirror of the case above, and the edge it needs is the other one: a
    // day-precision date makes the two indistinguishable, so only a month can
    // catch this.
    const text = "Nothing moved after May, and the logs stop there.";
    expect(whenFrom0(text, "after May", "2026-08-01")).toEqual({
      earliest: "2026-06-01",
      latest: null,
    });
  });

  it("dates a leap day in a leap year and refuses it outside one", () => {
    const text = "The lab shut down on February 29, and nothing worked after that.";
    expect(whenFrom0(text, "on February 29", "2024-08-01")).toEqual({
      earliest: "2024-02-29",
      latest: "2024-02-29",
    });
    // Neither 2026 nor 2025 has a 29 February, and the rule only ever looks at
    // the publication year and the one before it — so this is refused rather
    // than quietly walked back to 2024.
    expect(readMade(text, "on February 29", "2026-08-01")).toEqual({
      ok: false,
      reason: "unparseablePhrase",
    });
  });

  it("steps a bound across a month boundary", () => {
    const text = "Nothing moved after January 31, and the logs stop there.";
    expect(whenFrom0(text, "after January 31", "2026-08-01")).toEqual({
      earliest: "2026-02-01",
      latest: null,
    });
  });

  it("steps a bound across a year boundary", () => {
    const text = "It had all finished before January 1, as far as anyone can tell.";
    expect(whenFrom0(text, "before January 1", "2026-08-01")).toEqual({
      earliest: null,
      latest: "2025-12-31",
    });
  });
});

describe("inclusive, exclusive, and which way a bound points", () => {
  it("reads 'through' as inclusive at both ends", () => {
    const when = whenFrom("spya-ebtbnm", "July 13 through July 19");
    expect(when.earliest).toBe("2026-07-13");
    expect(when.latest).toBe("2026-07-19");
  });

  it("reads 'before' as exclusive", () => {
    const text = "The swarm was gone before July 13, according to the logs.";
    expect(whenFrom0(text, "before July 13")).toEqual({ earliest: null, latest: "2026-07-12" });
  });

  it("reads 'by' as inclusive", () => {
    const text = "The swarm was gone by July 13, according to the logs.";
    expect(whenFrom0(text, "by July 13")).toEqual({ earliest: null, latest: "2026-07-13" });
  });

  it("reads 'not until' as a LOWER bound", () => {
    // "did not X until July 13" says it happened at or after the 13th. It is
    // grouped with "by" and "before" in the plan's list of bounds, but it is
    // the mirror of them: rendering it as "at or before 13 July" would print
    // the opposite of what the article said.
    const text = "Hugging Face did not lock the credentials until July 13, far too late.";
    expect(whenFrom0(text, "not until July 13")).toEqual({
      earliest: "2026-07-13",
      latest: null,
    });
  });

  it("reads 'since' as an inclusive lower bound", () => {
    const text = "The board has been quiet since July 13, as far as anyone can tell.";
    expect(whenFrom0(text, "since July 13")).toEqual({ earliest: "2026-07-13", latest: null });
  });

  it("reads a 'between … and …' range", () => {
    const text = "The attacks ran between July 13 and July 19, on and off.";
    const when = whenFrom0(text, "between July 13 and July 19");
    expect(when).toEqual({ earliest: "2026-07-13", latest: "2026-07-19" });
  });

  it("does not read a bare 'and' as a range", () => {
    const text = "They hit the cluster on July 13 and July 19, twice over.";
    expect(readMade(text, "July 13 and July 19")).toEqual({
      ok: false,
      reason: "unparseablePhrase",
    });
  });
});

/** The two ends only — most of the year-rule cases care about nothing else. */
function whenFrom0(
  text: string,
  phrase: string,
  frame: string | null = PUBLISHED,
  direction: WhenDirection = "past",
): { earliest: string | null; latest: string | null } {
  const result = readWhen({ text, phrase, blockId: "spya-made00", frame, direction });
  if (!result.ok) throw new Error(`expected a date, got ${result.reason}`);
  return { earliest: result.when.earliest, latest: result.when.latest };
}

// ---------------------------------------------------------------------------

interface Row {
  id: string;
  order: number;
  modality: TimelineModality;
  when: When | null;
}

function row(
  id: string,
  order: number,
  modality: TimelineModality = "happened",
  when: When | null = null,
): Row {
  return { id, order, modality, when };
}

function dated(earliest: string | null, latest: string | null): When {
  return {
    earliest,
    latest,
    extent: "instant",
    phrase: "…",
    at: { blockId: "spya-made00", start: 0, end: 1 },
    yearFilled: false,
  };
}

describe("orderEvents", () => {
  it("sorts by the model's order and nothing else", () => {
    const sorted = orderEvents([row("c", 3), row("a", 1), row("b", 2)]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a duplicate order by the event's own index", () => {
    const sorted = orderEvents([row("first", 2), row("second", 2), row("early", 1)]);
    expect(sorted.map((e) => e.id)).toEqual(["early", "first", "second"]);
  });

  it("sends an unusable order to the end of its partition, not the front", () => {
    const sorted = orderEvents([
      row("nan", Number.NaN),
      row("five", 5),
      row("infinite", Number.POSITIVE_INFINITY),
      row("one", 1),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["one", "five", "nan", "infinite"]);
  });

  it("puts everything that happened before everything the piece expects", () => {
    const sorted = orderEvents([
      row("guess", 1, "hypothetical"),
      row("forecast", 2, "predicted"),
      row("late", 99, "happened"),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["late", "guess", "forecast"]);
  });

  it("does not sort by date", () => {
    // The whole point of Greg's second call. An event known only to be "by 4
    // July" may have happened on the 1st, and placing it by its date would
    // claim otherwise.
    const sorted = orderEvents([
      row("later-date-first", 1, "happened", dated("2026-07-20", "2026-07-20")),
      row("earlier-date-second", 2, "happened", dated("2026-05-01", "2026-05-01")),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["later-date-first", "earlier-date-second"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [row("c", 3), row("a", 1)];
    const copy = [...input];
    orderEvents(input);
    expect(input).toEqual(copy);
  });

  it("handles empty and single-event lists", () => {
    expect(orderEvents([])).toEqual([]);
    expect(orderEvents([row("only", 1)]).map((e) => e.id)).toEqual(["only"]);
  });
});

describe("countOrderConflicts", () => {
  it("counts a pair whose dates prove the model has them backwards", () => {
    const events = [
      row("may", 5, "happened", dated(null, "2026-05-12")),
      row("july", 2, "happened", dated("2026-07-01", null)),
    ];
    expect(countOrderConflicts(events)).toBe(1);
  });

  it("counts nothing when the model agrees with the dates", () => {
    const events = [
      row("may", 1, "happened", dated(null, "2026-05-12")),
      row("july", 2, "happened", dated("2026-07-01", null)),
    ];
    expect(countOrderConflicts(events)).toBe(0);
  });

  it("ignores intervals that merely overlap", () => {
    const events = [
      row("wide", 5, "happened", dated("2026-07-01", "2026-07-15")),
      row("also-wide", 2, "happened", dated("2026-07-10", "2026-07-20")),
    ];
    expect(countOrderConflicts(events)).toBe(0);
  });

  it("ignores two events on the same day", () => {
    const events = [
      row("morning", 5, "happened", dated("2026-07-10", "2026-07-10")),
      row("evening", 2, "happened", dated("2026-07-10", "2026-07-10")),
    ];
    expect(countOrderConflicts(events)).toBe(0);
  });

  it("ignores an undated event, and an open bound on the wrong side", () => {
    const events = [
      row("undated", 5),
      row("july", 2, "happened", dated("2026-07-01", null)),
      row("open-above", 9, "happened", dated("2026-01-01", null)),
    ];
    expect(countOrderConflicts(events)).toBe(0);
  });

  it("does not compare across the modality partition", () => {
    // A prediction sorts after history whatever its order says, so an
    // inversion there is not evidence that the model misread anything.
    const events = [
      row("history", 5, "happened", dated(null, "2026-05-12")),
      row("forecast", 2, "predicted", dated("2026-09-01", null)),
    ];
    expect(countOrderConflicts(events)).toBe(0);
  });

  it("counts nothing on the one pair in the real article that looks like a conflict", () => {
    /* The spike's final numbers: exactly one place on this article where the
       model's `order` disagrees with the dates, **and the model is right**.
       "By July 13" is an upper bound with nothing under it; "After July 12" is
       a lower bound with nothing over it. An implementation that sorted each
       event at whichever bound it happens to have would call this a
       contradiction. It is not one — the second event could genuinely be any
       time after the 12th, the 14th included — and a `countOrderConflicts`
       that never returns zero on real input is not measuring anything. */
    const lockdown = whenFrom("spya-jauf7s", "By July 13");
    const kickoff = whenFrom("spya-c2bkgz", "After July 12");
    expect([lockdown.earliest, lockdown.latest]).toEqual([null, "2026-07-13"]);
    /* "after" is exclusive, so the lower bound is the 13th and not the 12th,
       which puts the two bounds on the SAME day. That is what makes this pair
       worth pinning: an implementation that relaxed the comparison to `<=`
       would read "A finished before B started" out of two identical dates and
       flag the contradiction the spike says is not there. */
    expect([kickoff.earliest, kickoff.latest]).toEqual(["2026-07-13", null]);
    expect(
      countOrderConflicts([
        row("lockdown", 1, "happened", lockdown),
        row("kickoff", 2, "happened", kickoff),
      ]),
    ).toBe(0);
    // And the same pair with the model's order the other way round is still
    // not a conflict, because nothing about these two intervals proves an
    // order in either direction.
    expect(
      countOrderConflicts([
        row("lockdown", 2, "happened", lockdown),
        row("kickoff", 1, "happened", kickoff),
      ]),
    ).toBe(0);
  });

  it("counts exactly one when two firm intervals are ordered backwards", () => {
    // The other direction, so the function is not vacuously zero: both events
    // bounded at both ends, not overlapping, and the model has them the wrong
    // way round.
    const events = [
      row("later", 1, "happened", dated("2026-07-01", "2026-07-05")),
      row("earlier", 2, "happened", dated("2026-05-01", "2026-05-05")),
    ];
    expect(countOrderConflicts(events)).toBe(1);
  });

  it("handles empty and single-event lists", () => {
    expect(countOrderConflicts([])).toBe(0);
    const one = [row("only", 1, "happened", dated("2026-07-01", "2026-07-01"))];
    expect(countOrderConflicts(one)).toBe(0);
  });
});

describe("markFor", () => {
  it("draws a bound on each side of a stated date", () => {
    expect(markFor(dated("2026-05-26", "2026-05-26"))).toEqual({
      earlier: "bound",
      body: "dot",
      later: "bound",
    });
  });

  it("opens the earlier side for an upper bound", () => {
    expect(markFor(dated(null, "2026-05-12"))).toEqual({
      earlier: "open",
      body: "dot",
      later: "bound",
    });
  });

  it("opens the later side for a lower bound", () => {
    expect(markFor(dated("2026-07-13", null))).toEqual({
      earlier: "bound",
      body: "dot",
      later: "open",
    });
  });

  it("opens both sides for a row the article never dated", () => {
    expect(markFor(null)).toEqual({ earlier: "open", body: "dot", later: "open" });
  });

  it("draws a bar for an event that lasts", () => {
    const span: When = { ...dated("2026-07-13", "2026-07-19"), extent: "extended" };
    expect(markFor(span)).toEqual({ earlier: "bound", body: "bar", later: "bound" });
  });

  it("composes an open-ended span, which the legend does not draw", () => {
    const span: When = { ...dated("2026-05-01", null), extent: "extended" };
    expect(markFor(span)).toEqual({ earlier: "bound", body: "bar", later: "open" });
  });

  it("marks a rejected date differently from a row that was never dated", () => {
    const rejected = markFor(null, true);
    expect(rejected.body).toBe("rejected");
    expect(rejected).not.toEqual(markFor(null));
  });
});
