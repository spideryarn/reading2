/**
 * **The manifests assert their own preconditions**, the way
 * `tests/fixture-corpus.test.ts` makes the committed corpus prove it still has
 * the properties it is kept for.
 *
 * ## The rule this file exists for
 *
 * **A `mustNotContain` needle that does not occur in the page is satisfied by
 * every arm, including one that returns an empty string.** It looks like an
 * assertion, it counts towards `exclusionPrecision`, and it is testing nothing.
 * That is the needle-level form of the exposure problem — the same shape as
 * 260827ab's "zero regressions across fourteen pages" for an arm the corpus
 * could not exercise, and of 260830at's marker rule scoring **246/246** on a
 * corpus that contained none of the content it would have deleted.
 *
 * So every needle on both lists has to be **findable in the fixture's own
 * bytes**, and that is checked here rather than trusted. A typo'd needle, a
 * needle written from memory, a needle that survived a fixture being re-captured
 * — all three go red.
 *
 * ## And the negative controls have to still be there
 *
 * The eight shapes in `NEGATIVE_CONTROLS` are what defeat a
 * length-or-character-class rule. If one of them quietly stops being claimed by
 * any manifest, the corpus goes back to being one that cannot contradict such a
 * rule, and nothing else would say so.
 *
 * No network, no model, no database.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SCORABLE_FIXTURES } from "../evals/extraction/corpus.mjs";
import { ARMS } from "../evals/extraction/arms.mjs";
import { CORRUPTIONS } from "../evals/extraction/corruptions.mjs";
import { METRICS, forbiddenInsideRegion } from "../evals/extraction/scorecard.mjs";
import { visibleText } from "../evals/extraction/visible-text.mjs";
import {
  NEGATIVE_CONTROLS,
  type AssertionManifest,
  parseManifest,
} from "../evals/extraction/manifest.mjs";

const DIR = path.join("evals", "extraction", "fixtures");

const files = readdirSync(DIR).filter((f) => f.endsWith(".manifest.json"));

const manifests: { name: string; file: string; manifest: AssertionManifest }[] = files.map((f) => {
  const name = f.replace(/\.manifest\.json$/, "");
  return {
    name,
    file: f,
    manifest: parseManifest(JSON.parse(readFileSync(path.join(DIR, f), "utf-8")), f),
  };
});

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The page's text, whitespace collapsed — **by a small hand-written scanner, not
 * by parsing and not by stripping tags with a regex.**
 *
 * It parsed with JSDOM until it didn't. On an idle box that costs seven seconds
 * over twelve fixtures; on this one, under a load average of 103, it took
 * **44 seconds and timed out**, and a red that is really a stopwatch is worse
 * than no check at all — the next person reads it as a broken manifest.
 *
 * The replacement was a chain of regexes, and GPT Sol's review of stage B took it
 * apart on 2026-09-05: it leaked attribute values through `<p title="x > y">`,
 * kept `&trade;` and `&frac12;` undecoded, mishandled semicolonless entities,
 * CDATA, `<textarea>` and `</script >`, and **threw a `RangeError`** on
 * `&#1114112;`. The quoted *"66 needles over 12 manifests, 0 disagreements"* was
 * honest evidence about today's corpus and no evidence at all about the
 * implementation — corpus-compatible is not parser-correct.
 * [visible-text.mts](../evals/extraction/visible-text.mts) is the scanner that
 * replaced it: 20 ms a fixture, and `tests/extraction-visible-text.test.ts` holds
 * it against a JSDOM reference over an adversarial table, with the 27 cases the
 * regex chain got wrong pinned so they cannot come back.
 *
 * It is **deliberately looser than the scorer's matching**: `scorecard.mts`
 * matches a needle carrying its own indentation literally against the code
 * blocks, so it can tell a preserved `<pre>` from a collapsed one. This asks only
 * "is this string on the page at all", because that is the question integrity is
 * about — a needle nobody can find is a needle asserting nothing.
 */
const sourceText = new Map<string, string>();
function textOfFixture(fixture: string): string {
  const hit = sourceText.get(fixture);
  if (hit !== undefined) return hit;
  const entry = SCORABLE_FIXTURES.find((f) => f.name === fixture);
  if (!entry) throw new Error(`${fixture}: not in SCORABLE_FIXTURES`);
  const text = visibleText(readFileSync(path.join(DIR, entry.file), "utf-8"));
  sourceText.set(fixture, text);
  return text;
}

describe("the assertion manifests", () => {
  it("has some", () => {
    /* An empty glob passes every `for` loop below in silence. */
    expect(manifests.length).toBeGreaterThanOrEqual(10);
  });

  it("names a fixture that exists, with the file that fixture really is", () => {
    for (const { name, manifest } of manifests) {
      expect(manifest.fixture, `${name}: fixture field disagrees with the filename`).toBe(name);
      const entry = SCORABLE_FIXTURES.find((f) => f.name === name);
      expect(entry, `${name}: no such fixture in corpus.mts`).toBeDefined();
      expect(manifest.file, `${name}: file field disagrees with corpus.mts`).toBe(entry!.file);
    }
  });

  it("can find every needle, on both lists, in the fixture's own bytes", () => {
    const missing: string[] = [];
    for (const { name, manifest } of manifests) {
      const text = textOfFixture(name);
      for (const [list, needles] of [
        ["mustContain", manifest.mustContain],
        ["mustNotContain", manifest.mustNotContain],
      ] as const) {
        for (const n of needles) {
          if (!text.includes(norm(n.text))) {
            missing.push(`${name}.${list}: ${JSON.stringify(n.text.slice(0, 60))}`);
          }
        }
      }
    }
    expect(
      missing,
      "these needles are not on the page they claim to be about — a mustNotContain " +
        "needle that is not on the page is satisfied by an arm that deletes the article",
    ).toEqual([]);
  });

  it("says which part of the page is the article, on every page that has one", () => {
    /**
     * **The field GPT Sol's second review made unavoidable.** He built an arm on
     * `aaronson` out of genuine stamped source elements — the required passages,
     * real figures, real blockquotes — and then padded it with the page's own
     * comment thread until it cleared `minArticleChars: 30000`. It kept **178
     * characters of the post, 0.542%**, and passed everything. Provenance proves
     * text came from somewhere on the page; it cannot tell 5,560 words of post
     * from the 52,776 words of comment underneath.
     *
     * So a manifest about an article has to say which part of the page that is,
     * and a manifest about a bot wall must not, because there is none. The
     * parser refuses `minArticleChars` without a region and refuses a region
     * beside `notAnArticle`; this is the other half — that no article fixture
     * quietly has neither.
     */
    for (const { name, manifest } of manifests) {
      if (manifest.notAnArticle) {
        expect(manifest.articleRegion, `${name}: not an article, so it has no article region`)
          .toBeUndefined();
        continue;
      }
      expect(manifest.articleRegion, `${name}: does not say which part of the page is the article`)
        .toBeDefined();
      expect(
        manifest.minArticleChars,
        `${name}: declares a region and no floor on it — the measure with nothing measuring`,
      ).toBeDefined();
      /* A region is a judgement and a generous one flatters the pipeline exactly
         as the ar5iv floors did, so the reason has to be long enough to be a
         reason. The parser enforces non-empty; this enforces argued. */
      expect(
        (manifest.articleRegion!.why ?? "").length,
        `${name}: articleRegion.why is too short to be an argument`,
      ).toBeGreaterThan(80);
    }
  });

  it("never asks for a string and forbids it on the same page", () => {
    for (const { name, manifest } of manifests) {
      const wanted = new Set(manifest.mustContain.map((n) => norm(n.text)));
      const banned = manifest.mustNotContain.map((n) => norm(n.text)).filter((t) => wanted.has(t));
      expect(banned, `${name}: contradicts itself`).toEqual([]);
    }
  });

  it("still claims every one of the eight negative controls", () => {
    const claimed = new Map<string, string[]>();
    for (const { name, manifest } of manifests) {
      for (const n of manifest.mustContain) {
        if (!n.negativeControl) continue;
        claimed.set(n.negativeControl, [...(claimed.get(n.negativeControl) ?? []), name]);
      }
    }
    const unclaimed = NEGATIVE_CONTROLS.filter((k) => !claimed.has(k));
    expect(
      unclaimed,
      "no manifest holds these shapes any more — the corpus can no longer contradict " +
        "a length-or-character-class rule, which is how 260830at's got to 246/246",
    ).toEqual([]);
  });

  it("holds most of them on real captured pages, not only on the built one", () => {
    /* A hand-built control page is a control, not a sample: its damage is
       whatever its author thought of. Recorded as a floor so the corpus cannot
       drift into resting entirely on it. */
    const onReal = new Set<string>();
    for (const { name, manifest } of manifests) {
      if (name === "negative-controls") continue;
      for (const n of manifest.mustContain) if (n.negativeControl) onReal.add(n.negativeControl);
    }
    expect([...onReal].sort()).toEqual(
      ["dated-update", "numeric-cell", "short-article", "short-dialogue", "short-heading"].sort(),
    );
  });
});

describe("the manifest parser refuses what it says it refuses", () => {
  /* Each of these is a shape a person editing JSON by hand actually produces,
     and each would otherwise sit in the corpus asserting nothing. Watched red
     against a parser that only cast, which is how the first draft read. */
  const base = { fixture: "x", file: "x.html", note: "n", mustContain: [], mustNotContain: [] };

  it("refuses a needle with no reason for being there", () => {
    expect(() =>
      parseManifest({ ...base, mustContain: [{ text: "hello" }] }, "t"),
    ).toThrow(/why/);
  });

  it("refuses a structure floor on a tag it cannot count", () => {
    expect(() => parseManifest({ ...base, structure: { marquee: { atLeast: 1 } } }, "t")).toThrow(
      /not a tag/,
    );
  });

  it("refuses a structure entry that declares no bound at all", () => {
    expect(() => parseManifest({ ...base, structure: { h2: {} } }, "t")).toThrow(/neither/);
  });

  /**
   * **The typo tests, and they are the ones that were missing.**
   *
   * GPT Sol's review of stage B, 2026-09-05: `mustContian`, `maxBlockChar` and a
   * needle field `negativeContorl` all parsed successfully and asserted less than
   * their author intended. Every one of those is a shape a person editing JSON by
   * hand produces on a Tuesday, and every one of them leaves a manifest sitting in
   * the corpus looking like an assertion and testing nothing — the same class as a
   * `mustNotContain` needle that is not on the page, which this file already
   * guards. An unknown key is now an error, recursively.
   */
  it("refuses a misspelt top-level key rather than ignoring it", () => {
    expect(() => parseManifest({ ...base, mustContian: [] }, "t")).toThrow(/mustContian/);
    expect(() => parseManifest({ ...base, maxBlockChar: 10 }, "t")).toThrow(/maxBlockChar/);
  });

  it("refuses a misspelt key on a needle", () => {
    expect(() =>
      parseManifest(
        { ...base, mustContain: [{ text: "x", why: "y", negativeContorl: "scoreline" }] },
        "t",
      ),
    ).toThrow(/negativeContorl/);
  });

  it("refuses a misspelt key inside a structure floor", () => {
    expect(() => parseManifest({ ...base, structure: { h2: { atLeat: 2 } } }, "t")).toThrow(
      /atLeat/,
    );
  });

  it("refuses a floor that is not a finite non-negative integer", () => {
    /* A float floor, a negative floor and a NaN floor all used to parse. `atLeast:
       -1` is satisfied by an empty document and reads like an assertion. */
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseManifest({ ...base, structure: { h2: { atLeast: bad } } }, "t")).toThrow(
        /non-negative whole number/,
      );
    }
    for (const bad of [-1, 2.5, Number.NaN]) {
      expect(() => parseManifest({ ...base, maxBlockChars: bad }, "t")).toThrow(
        /non-negative whole number/,
      );
      expect(() => parseManifest({ ...base, minArticleChars: bad }, "t")).toThrow(
        /non-negative whole number/,
      );
    }
  });

  /**
   * **The floor and the measure travel together, or neither means anything.**
   *
   * `minArticleChars` counts the characters of the declared `articleRegion` that
   * came back. Without a region there is nothing to count, and the behaviour it
   * replaced — counting every gistable character of output — is what let a
   * collage of comment-thread paragraphs clear a floor written for the post.
   */
  const region = { within: ["article"], why: "the piece, and not the comment thread under it" };

  it("refuses a floor on the article without saying which part of the page that is", () => {
    expect(() => parseManifest({ ...base, minArticleChars: 100 }, "t")).toThrow(/articleRegion/);
    expect(() =>
      parseManifest({ ...base, minArticleChars: 100, articleRegion: region }, "t"),
    ).not.toThrow();
  });

  it("refuses a region on a page that is not an article, and a region with no argument", () => {
    expect(() =>
      parseManifest({ ...base, notAnArticle: true, articleRegion: region }, "t"),
    ).toThrow(/no part of it is the article/);
    expect(() =>
      parseManifest({ ...base, articleRegion: { within: ["article"] } }, "t"),
    ).toThrow(/why/);
    expect(() =>
      parseManifest({ ...base, articleRegion: { ...region, within: [] } }, "t"),
    ).toThrow(/non-empty array/);
    expect(() =>
      parseManifest({ ...base, articleRegion: { ...region, wihtin: ["x"] } }, "t"),
    ).toThrow(/wihtin/);
  });

  it("records each gate on its own in a finding, because one boolean could not", () => {
    /* `gatesPassed` was documented as "both hard gates passed" and computed by
       discarding the abstentions, so `pmc-article` — attribution ok, order `—`
       — would have recorded `true`. GPT Sol, 2026-09-05. */
    const finding = {
      assertionsHeld: false,
      gates: { attribution: true, sourceOrder: null },
      regressions: ["articleRecall"],
      articleChars: 178,
      gistableChars: 30052,
      articleRecall: 0.00542,
    };
    const parsed = parseManifest({ ...base, findings: { "some-arm": finding } }, "t");
    expect(parsed.findings?.["some-arm"]).toEqual(finding);
    expect(() =>
      parseManifest({ ...base, findings: { a: { ...finding, gatesPassed: true } } }, "t"),
    ).toThrow(/gatesPassed/);
    /* An abstained region measure is `null`, and `null` is not zero: an arm that
       could not be asked has not been shown to return nothing. */
    expect(
      parseManifest(
        { ...base, findings: { a: { ...finding, articleChars: null, articleRecall: null } } },
        "t",
      ).findings?.["a"]?.articleChars,
    ).toBeNull();
    expect(() =>
      parseManifest({ ...base, findings: { a: { ...finding, articleRecall: 1.5 } } }, "t"),
    ).toThrow(/0\.\.1/);
  });

  it("refuses an article manifest that also claims the page is not an article", () => {
    expect(() =>
      parseManifest(
        { ...base, notAnArticle: true, mustContain: [{ text: "x", why: "y" }] },
        "t",
      ),
    ).toThrow(/notAnArticle/);
  });

  it("refuses an unknown negative-control kind", () => {
    expect(() =>
      parseManifest({ ...base, mustContain: [{ text: "x", why: "y", negativeControl: "vibes" }] }, "t"),
    ).toThrow(/unknown kind/);
  });

  it("keeps null as a byline, which is not the same as not asserting one", () => {
    /* `byline: null` means "this page has none and inventing one is a failure".
       Absent means "not asserted here". A parser that folded them together would
       make the arxiv-abs manifest silently assert something it deliberately does
       not. */
    expect("byline" in parseManifest({ ...base, byline: null }, "t")).toBe(true);
    expect("byline" in parseManifest(base, "t")).toBe(false);
  });
});

/**
 * **The committed result has to be a result of THIS ruler.**
 *
 * `evals/results/extraction-score.json` is what somebody reads when they want
 * yesterday's numbers without waiting five minutes for the run, and on
 * 2026-09-05 GPT Sol found it was 125 rows from an eight-arm run in a schema two
 * revisions old: no `articleRecall`, an old `gatesPassed` field, and no
 * `region-padded-collage` at all. Nothing said so, because nothing read it.
 *
 * A file nobody validates rots quietly, which is the same shape as a needle
 * nobody can find on the page. This is cheap — it parses one JSON file and
 * compares names — and it goes red the moment an arm, a fixture, a metric or a
 * corruption is added without the run being re-recorded.
 *
 * Regenerate with:
 *
 *   npx tsx evals/extraction/score.mts --json evals/results/extraction-score.json
 */
describe("no region may credit what its own manifest forbids", () => {
  /**
   * **The general form, and it was not general.** `forbiddenInsideRegion` joined
   * each region element's own text on a NUL, so a forbidden string that straddles
   * two inline elements was invisible to it. GPT Sol, 2026-09-05:
   * `<span>Bad</span><span>Stuff</span>` with `mustNotContain: "BadStuff"` came
   * back clean, while `exclusionPrecision` scored 0 on it and `articleRecall`
   * scored 1 — and the comment saying `articleReturned` could not pay for such
   * text was wrong, because it credits both halves, one per element.
   *
   * The fifteen committed manifests were clean under both versions, which is why
   * this is a synthetic page: the corpus could not have told the difference, and
   * a check that only ever sees clean input has never been shown to work.
   */
  const region = { within: ["article"], why: "the synthetic article, for this test only" };
  const manifestWith = (text: string): AssertionManifest =>
    parseManifest(
      {
        fixture: "synthetic", file: "synthetic.html",
        note: "a page built for this test and for nothing else",
        mustContain: [{ text: "the piece itself", why: "so the manifest asserts something" }],
        mustNotContain: [{ text, why: "the string the region must not credit" }],
        articleRegion: region,
        minArticleChars: 1,
      },
      "synthetic",
    );

  it("sees a forbidden string that straddles two inline elements", () => {
    const html =
      "<body><article><p>the piece itself</p>" +
      "<p><span>Bad</span><span>Stuff</span> and more</p></article></body>";
    expect(
      forbiddenInsideRegion(html, manifestWith("BadStuff")),
      "a forbidden string split across two spans was not seen inside the region",
    ).toEqual(["BadStuff"]);
  });

  it("still sees one that sits inside a single element, and lets a clean region through", () => {
    const html = "<body><article><p>the piece itself</p><p>BadStuff and more</p></article></body>";
    expect(forbiddenInsideRegion(html, manifestWith("BadStuff"))).toEqual(["BadStuff"]);
    /* And the other way, or the test above passes for a checker that says
       everything is forbidden. */
    const clean = "<body><article><p>the piece itself</p></article>" +
      "<footer><span>Bad</span><span>Stuff</span></footer></body>";
    expect(
      forbiddenInsideRegion(clean, manifestWith("BadStuff")),
      "text outside the region was reported as inside it",
    ).toEqual([]);
  });

  it("ignores whitespace between the halves, as every other comparison here does", () => {
    const html =
      "<body><article><p>the piece itself</p><p><span>Bad</span>\n  <span>Stuff</span></p></article></body>";
    expect(forbiddenInsideRegion(html, manifestWith("Bad Stuff"))).toEqual(["Bad Stuff"]);
  });
});

describe("the committed score run", () => {
  const RESULTS = path.join("evals", "results", "extraction-score.json");
  const rows = JSON.parse(readFileSync(RESULTS, "utf-8")) as Record<string, unknown>[];
  const scored = rows.filter((r) => typeof r.fixture === "string");
  const conformance = rows.filter((r) => typeof r.conformance === "string");

  /**
   * **Two-sided, because one-sided validation rots the other way.** The first
   * version checked only for *missing* pairs, so an arm or a fixture that was
   * deleted left its rows sitting in the artefact for ever, and a run recorded
   * twice would have doubled every row unnoticed. GPT Sol, 2026-09-05.
   */
  it("covers exactly the current fixture x arm matrix — no gaps, no strangers, no repeats", () => {
    const want = new Set<string>();
    for (const { name } of manifests) for (const arm of ARMS) want.add(`${arm.name} on ${name}`);
    const seen = new Map<string, number>();
    for (const r of scored) {
      const k = `${r.arm} on ${r.fixture}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(
      [...want].filter((k) => !seen.has(k)),
      `${RESULTS} is stale — re-record it with score.mts --json`,
    ).toEqual([]);
    expect(
      [...seen.keys()].filter((k) => !want.has(k)),
      `${RESULTS} carries rows for an arm or fixture that no longer exists`,
    ).toEqual([]);
    expect(
      [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`),
      `${RESULTS} has duplicate rows`,
    ).toEqual([]);
    expect(scored.length, "row count disagrees with the matrix").toBe(want.size);
  });

  it("has no row of an unknown shape", () => {
    /* A row is either a scored fixture/arm pair or a conformance result. The
       first version of this block filtered the file into those two buckets and
       never asked what was left, so anything else in the artefact was invisible
       to every check below it. GPT Sol, 2026-09-06. */
    const strangers = rows.filter(
      (r) => typeof r.fixture !== "string" && typeof r.conformance !== "string",
    );
    expect(
      strangers.map((r) => JSON.stringify(r).slice(0, 80)),
      `${RESULTS} carries rows that are neither a scored pair nor a conformance result`,
    ).toEqual([]);
    expect(rows.length).toBe(scored.length + conformance.length);
  });

  it("carries the metrics and gates this scorer has, on EVERY exercised row", () => {
    /**
     * **It filtered to the rows that already had what it was about to check.**
     *
     * The first version selected `scored.filter((r) => r.metrics)` and then
     * validated those, so deleting `metrics` from an exercised row left the test
     * green — the survivors still numbered more than the ten it asked for. Same
     * for `gates`. GPT Sol, 2026-09-06: *"the test does not keep it that way"*.
     *
     * The population is now every row the run says it **exercised**, and a row
     * missing the field is the failure rather than a row excused from it.
     */
    /**
     * **It trusted `exercised` before validating it.** Removing `exercised`,
     * `metrics` and `gates` from one scored row left it inside the fixture/arm
     * matrix while escaping schema validation entirely — the remaining 115 rows
     * cleared the `>100` floor and nothing said a row had gone dark. GPT Sol,
     * 2026-09-06. So the flag is checked first, on every row.
     */
    const badFlag = scored.filter(
      (r) => typeof r.exercised !== "boolean",
    );
    expect(
      badFlag.map((r) => `${r.fixture}/${r.arm}`),
      `${RESULTS} has rows that do not say whether they were exercised`,
    ).toEqual([]);
    const exercised = scored.filter((r) => r.exercised === true);
    expect(exercised.length, "no row in the artefact is marked exercised").toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const r of exercised) {
      const where = `${r.fixture}/${r.arm}`;
      if (!r.metrics) { wrong.push(`${where}: no metrics at all`); continue; }
      const keys = Object.keys(r.metrics as Record<string, unknown>).sort();
      if (JSON.stringify(keys) !== JSON.stringify([...METRICS].sort())) {
        wrong.push(`${where}: metrics are ${keys.join(",")}`);
      }
      if (!r.gates) { wrong.push(`${where}: no gates at all`); continue; }
      const gates = Object.keys(r.gates as Record<string, unknown>).sort();
      if (JSON.stringify(gates) !== JSON.stringify(["attribution", "sourceOrder"])) {
        wrong.push(`${where}: gates are ${gates.join(",")}`);
      }
    }
    expect(wrong, `${RESULTS} is from an older schema — re-record it`).toEqual([]);
    expect(
      scored.some((r) => "gatesPassed" in ((r.finding as object) ?? {})),
      "a row still carries the retracted `gatesPassed` summary",
    ).toBe(false);
  });

  it("says how many shipped extractions pass each gate, read from the run", () => {
    /**
     * **The tally is read, not written.** It has moved three times in two days —
     * fourteen of fifteen, then "all fifteen" (an artefact of a counting rule and
     * retracted), then back, then changed again by the text-run walk — and each
     * time a hand-written sentence somewhere went stale. GPT Sol caught it twice.
     *
     * So nothing states the number: this prints it from the recorded run, and
     * fails only on the thing that is always wrong — a gate that is neither
     * passed nor honestly abstaining on a shipped extraction.
     */
    const shipped = scored.filter((r) => r.arm === "shipped" && r.gates);
    expect(shipped.length, "no shipped rows in the artefact").toBeGreaterThan(10);
    const tally: Record<string, string> = {};
    const broken: string[] = [];
    for (const r of shipped) {
      const g = r.gates as Record<string, { passed: boolean | null; exercised: number } | undefined>;
      const show = (name: string): string => {
        const gate = g[name];
        if (!gate) return `${name} MISSING`;
        return `${name} ${gate.passed === null ? "—" : gate.passed ? "ok" : "FAIL"} (${gate.exercised})`;
      };
      tally[r.fixture as string] = `${show("attribution")}, ${show("sourceOrder")}`;
      for (const name of ["attribution", "sourceOrder"] as const) {
        const gate = g[name];
        if (!gate) { broken.push(`${r.fixture}: ${name} is missing`); continue; }
        if (gate.passed === false) broken.push(`${r.fixture}: ${name} FAILS`);
        /* An abstention is only honest with nothing to judge. A gate that saw
           observations and still says `—` is a gate that lost its answer. */
        if (gate.passed === null && gate.exercised > 1) {
          broken.push(`${r.fixture}: ${name} abstains over ${gate.exercised} observations`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log("shipped gates, from the recorded run:", JSON.stringify(tally, null, 2));
    expect(broken, "a shipped extraction fails a gate, or abstains without cause").toEqual([]);
  });

  it("covers exactly the corruption bank — no gaps and no strangers", () => {
    const seen = conformance.map((r) => r.conformance as string);
    const want = CORRUPTIONS.map((c) => c.name);
    expect(want.filter((n) => !seen.includes(n)), "missing from the artefact").toEqual([]);
    expect(seen.filter((n) => !want.includes(n)), "no longer in the bank").toEqual([]);
    expect(seen.length, "the bank is recorded more than once").toBe(want.length);
  });
});
