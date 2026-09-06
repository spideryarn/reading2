/**
 * **The scorer, watched going the wrong way.**
 *
 * `evals/extraction/scorecard.mts` is an instrument, and every number downstream
 * of it is a number it produced. Two prior plans were wrong in the same way three
 * separate times — *a number that rewards recovery, read as a number that rewards
 * quality* — so nothing on the card is allowed to be quoted as evidence until it
 * has been seen moving the wrong way and refusing.
 *
 * The order of this file is the order it was built in, and that is deliberate:
 *
 * 1. **the polarity pair**, written before any metric it judges, and watched
 *    failing against a recovery-only card;
 * 2. **the exposure count**, so an arm with nothing to act on says
 *    `not exercised` rather than `zero regressions`;
 * 3. **mutation testing**, which deletes each metric in turn and asks whether
 *    any damage stops being noticed — a metric whose removal reddens nothing is
 *    not load-bearing;
 * 4. **the twelve degenerate arms**, each of which has to lose on a named metric
 *    or gate, **on every fixture it is exercised on** — two of them are GPT Sol's
 *    adversaries from the 2026-09-05 review, and the per-fixture form of that
 *    assertion is his too.
 *
 * ## What was watched red, and when
 *
 * - **A recovery-only card.** With `exclusionPrecision` and `bodyPurity` removed
 *   from `score()`, leaving recall and the structural floors, the `add nav` half
 *   failed with *"no metric fell when navigation was added — the card is
 *   RECOVERY-ONLY"*. That is the three historic bugs, reproduced in the new
 *   instrument, before it was allowed to have an opinion.
 * - **`blockCleanliness` as a ratio over the block total.** Written the obvious
 *   way — `1 - offending / totalBlocks` — it *rose* when thirty navigation items
 *   were glued into the article, because the denominator grew and the numerator
 *   did not. The polarity pair named it by metric. It is a budget now, not a
 *   ratio.
 * - **A gate that could not see a short block.** Attribution ignored everything
 *   under 60 characters, so `invent-short-text` — thirty invented labels of
 *   about thirteen characters — passed it. Watched red by putting the floor
 *   back; the test that names it says so.
 * - **The recovery-only refusal, never executed.** The test named for it built
 *   the card and never handed it to `polarityPair`. It does now, and asserts the
 *   refusal by its words.
 *
 * No network, no model, no database. See
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § B.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, VirtualConsole } from "jsdom";

import { RESERVED_ATTRS } from "../src/reserved.js";

import {
  METRICS,
  type MetricName,
  type ScoreInput,
  detects,
  navRail,
  polarityPair,
  score,
} from "../evals/extraction/scorecard.mjs";
import type { AssertionManifest } from "../evals/extraction/manifest.mjs";
import { parseManifest } from "../evals/extraction/manifest.mjs";
import { CORRUPTIONS, type Candidate } from "../evals/extraction/corruptions.mjs";
import {
  CONFORMANCE_CANDIDATE,
  CONFORMANCE_GOLD,
  CONFORMANCE_HTML,
  CONFORMANCE_MANIFEST,
} from "../evals/extraction/conformance-page.mjs";
import {
  DEGENERATE_ARMS,
  HARMLESS_HERE,
  SHIPPED_ARM,
  armNamed,
  preparedSourceHtml,
} from "../evals/extraction/arms.mjs";
import { SCORABLE_FIXTURES } from "../evals/extraction/corpus.mjs";
import {
  MIN_REGION_PRECISION,
  regionTextById,
  regionVisibleText,
} from "../evals/extraction/scorecard.mjs";

/* ------------------------------------------------------------- the page ---- */

/**
 * Six paragraphs that share no long run with each other, so a substring match on
 * one cannot be satisfied by another. `inventory.mts`'s test file learned this
 * the hard way: written the obvious way, with one sentence and the number
 * substituted in, every truncation case passed while measuring nothing.
 */
const WORDS = [
  ["orchard", "lantern", "viaduct"], ["gravel", "puffin", "sextant"],
  ["marzipan", "tundra", "kelp"], ["cobalt", "jackdaw", "furlong"],
  ["pewter", "samphire", "glide"], ["quarry", "mistral", "bracken"],
];
const para = (n: number): string => {
  const w = WORDS[n % WORDS.length]!;
  return (
    `The ${w[0]} of ${n} was first ${w[1]} in a season nobody troubled to write down, ` +
    `and the ${w[2]} it left behind is the reason paragraph ${n} of this piece reads ` +
    `the way it does, some ${n * 37} words after the argument began and a good while ` +
    `before it is settled.`
  );
};

/** Six paragraphs; the last four are the ~1,000 characters the pair moves. */
const BODY = [0, 1, 2, 3, 4, 5].map(para);
const HEAD = `<h1>A piece about the ${WORDS[0]![0]}</h1><h2>The first part</h2>`;

/**
 * **One stranded pilcrow, in every variant, and it is not decoration.**
 *
 * The first version of this page had no offending block at all, and the ratio
 * form of `blockCleanliness` — `1 - offending / totalBlocks`, the obvious way to
 * write it — sailed through the polarity pair, because zero divided by anything
 * is zero and the metric was flat in both directions. A check that passes
 * because its input cannot defeat it is 260830at's 246/246 all over again
 * (docs/reusable/silent-success.md, "An eval arm the corpus cannot exercise").
 *
 * With this here, the ratio form does what it always did: gluing thirty clean
 * navigation items into the article grows the denominator, leaves the numerator
 * alone, and the metric **rises on damage**. That is the second thing this file
 * was watched red on.
 */
const STRANDED_MARKER = "<p>\u00b6</p>";

const wrap = (paras: string[], extra = ""): string =>
  `${HEAD}${paras.map((p) => `<p>${p}</p>`).join("")}${STRANDED_MARKER}${extra}`;

const WITH_BODY = wrap(BODY);
const WITHOUT_BODY = wrap(BODY.slice(0, 2));
const NAV = navRail();
const WITH_NAV = wrap(BODY, NAV.html);

/* The size of each mutation, asserted rather than assumed — a pair that claimed
   a thousand characters and moved forty would pass every test below while proving
   nothing about the size of move the card can see. The two halves are NOT the
   same size, and the test says both numbers rather than rounding them into one
   sentence. */
const restoredChars = BODY.slice(2).join(" ").length;
const navChars = NAV.texts.join(" ").length;

const GOLD = { body: BODY, chrome: NAV.texts, covers: "whole-document" as const };

/** A manifest tier with no gold: the position every page off the web is in. */
const MANIFEST: AssertionManifest = {
  fixture: "synthetic-polarity",
  file: "(none — built in the test)",
  note: "The manifest tier, exercised without a gold.",
  mustContain: [
    { text: BODY[3]!, why: "body the truncation mutation removes and restores" },
    { text: BODY[5]!, why: "the last paragraph, so a tail-truncation is visible" },
  ],
  mustNotContain: [
    { text: NAV.texts[0]!, why: "the first item of the nav rail the mutation glues in" },
    { text: NAV.texts[8]!, why: "and one from the middle of it" },
  ],
  structure: { h1: { exactly: 1 }, h2: { atLeast: 1 } },
  noPunctuationOnlyBlocks: true,
};

const base = (over: Partial<ScoreInput>): ScoreInput => ({
  fixture: "synthetic-polarity", arm: "test", html: WITH_BODY, ...over,
});

/* ------------------------------------------------------ 1. polarity pair ---- */

describe("the polarity pair — the check everything else waits on", () => {
  it("moves the number of characters it says it moves, in each direction", () => {
    /**
     * **The nav half is 393 characters of text, not a thousand**, and saying a
     * thousand was the second-worst kind of wrong: the old assertion reached one
     * thousand by measuring `NAV.html.length` — the markup — while every metric
     * it is meant to move measures *text*. `<li><a href="/x">Home</a></li>` is
     * 30 bytes of which 4 are the page. GPT Sol counted it, 2026-09-05.
     *
     * The number is corrected rather than the mutation inflated, and that is the
     * better direction: a smaller perturbation is a harder thing for the card to
     * notice, so 393 characters is stronger evidence than 1,000 would have been.
     */
    expect(restoredChars).toBeGreaterThan(900);
    expect(NAV.texts.length).toBe(30);
    /* 393 characters of link label, 422 once the words are separated, 1,211
       bytes of markup. Only the first two are text, and only text moves a
       metric. All three are written down so the next person cannot pick the
       flattering one by accident — and note that even the markup figure is not
       the 1,370 the trawl recorded, because that was the rail on a real page and
       this is our reconstruction of it. */
    expect(NAV.texts.join("").length, "characters of link label").toBe(393);
    expect(navChars, "the same labels, space-separated, as the reader meets them").toBe(422);
    expect(NAV.html.length, "and this is markup, which no metric measures").toBe(1211);
  });

  it("passes on the gold tier, and both halves move", () => {
    const v = polarityPair(base({ gold: GOLD }), {
      withoutBody: WITHOUT_BODY, withBody: WITH_BODY, withNav: WITH_NAV,
    });
    expect(v.failures).toEqual([]);
    expect(v.passed).toBe(true);
    expect(v.movedOnRestore).toBeGreaterThan(0);
    expect(v.movedOnNav).toBeGreaterThan(0);
  });

  it("passes on the manifest tier, where no gold exists", () => {
    const v = polarityPair(base({ manifest: MANIFEST }), {
      withoutBody: WITHOUT_BODY, withBody: WITH_BODY, withNav: WITH_NAV,
    });
    expect(v.failures).toEqual([]);
    expect(v.movedOnRestore).toBeGreaterThan(0);
    expect(v.movedOnNav).toBeGreaterThan(0);
  });

  it("names bodyPurity as the metric that falls when navigation arrives", () => {
    const v = polarityPair(base({ gold: GOLD }), {
      withoutBody: WITHOUT_BODY, withBody: WITH_BODY, withNav: WITH_NAV,
    });
    const purity = v.rows.find((r) => r.metric === "bodyPurity");
    expect(purity?.addNav).toBe("down");
    /* And recall does NOT fall — which is the point. A card of recall alone
       would report "flat" here and call the page unharmed. */
    expect(v.rows.find((r) => r.metric === "requiredRecall")?.addNav).toBe("flat");
  });

  /**
   * The historic bug, rebuilt: keep only the metrics that reward getting text
   * back. `droppedChars`, "characters gained" and a bare recall all have this
   * shape.
   */
  const recoveryOnly = (input: ScoreInput): ReturnType<typeof score> => {
    const card = score(input);
    for (const m of ["exclusionPrecision", "bodyPurity", "blockCleanliness"] as MetricName[]) {
      card.metrics[m] = { ...card.metrics[m], value: null, exercised: 0 };
    }
    return card;
  };

  it("REFUSES a recovery-only card — the failure the whole stage is named after", () => {
    /**
     * **The harness is actually run here, and until 2026-09-05 it was not.**
     *
     * This test built `recoveryOnly` and then never handed it to `polarityPair`:
     * it asserted only that the remaining metrics were flat. `polarityPair` could
     * have stopped refusing and this would have stayed green — a control that
     * cannot go red, sitting in the file whose whole subject is controls that
     * cannot go red. GPT Sol found it.
     */
    const v = polarityPair(
      base({ gold: GOLD, manifest: MANIFEST }),
      { withoutBody: WITHOUT_BODY, withBody: WITH_BODY, withNav: WITH_NAV },
      recoveryOnly,
    );
    expect(v.passed, "a recovery-only card was allowed through the polarity pair").toBe(false);
    expect(v.failures.join(" ")).toContain("RECOVERY-ONLY");
    expect(v.movedOnNav, "something fell on a card that cannot see furniture").toBe(0);
    /* And the half it CAN see still moves, so the refusal is about the missing
       direction rather than about a card that does nothing at all. */
    expect(v.movedOnRestore).toBeGreaterThan(0);
  });

  it("leaves the recovery-only card blind to navigation, metric by metric", () => {
    /* Asserted over all of them, not just recall, because "some other number
       would have caught it" is exactly what was believed the last three times. */
    const at = (html: string) => recoveryOnly(base({ gold: GOLD, manifest: MANIFEST, html }));
    const restored = at(WITH_BODY);
    const navved = at(WITH_NAV);
    expect(restored.metrics.requiredRecall.value!).toBeGreaterThan(
      at(WITHOUT_BODY).metrics.requiredRecall.value!,
    );
    for (const m of METRICS) {
      const a = restored.metrics[m].value;
      const b = navved.metrics[m].value;
      if (a === null || b === null) continue;
      expect(b, `${m} moved on a card that should be blind to it`).toBe(a);
    }
  });
});

/* --------------------------------------------------- 2. exposure counts ---- */

describe("the exposure count — `not exercised`, never `zero regressions`", () => {
  it("reports a metric with nothing declared as not exercised, not as a pass", () => {
    const card = score(base({}));
    for (const m of METRICS) {
      expect(card.metrics[m].exercised, `${m} claims exposure it does not have`).toBe(0);
      expect(card.metrics[m].value, `${m} scored something out of nothing`).toBeNull();
    }
    expect(card.tier).toBe("none");
    expect(card.assertionsPassed).toBeNull();
  });

  it("a manifest that names nothing scores nothing, however clean the page", () => {
    const empty: AssertionManifest = {
      fixture: "x", file: "x", note: "declares nothing", mustContain: [], mustNotContain: [],
    };
    const card = score(base({ manifest: empty }));
    expect(card.metrics.requiredRecall.value).toBeNull();
    expect(card.metrics.exclusionPrecision.value).toBeNull();
    /* It still passes its (empty) assertions — and that is why `assertionsPassed`
       may never be read without the exposure counts beside it. */
    expect(card.assertionsPassed).toBe(true);
    expect(card.metrics.requiredRecall.exercised).toBe(0);
  });

  it("abstains from both gates rather than passing them when no source is supplied", () => {
    const card = score(base({ manifest: MANIFEST }));
    expect(card.gates.attribution.passed).toBeNull();
    expect(card.gates.sourceOrder.passed).toBeNull();
    expect(card.gates.attribution.exercised).toBe(0);
  });
});

/* --------------------------------------------- 3. mutation testing --------- */

/**
 * The conformance page is **shared with the runner** rather than built here.
 *
 * It used to be a second copy in this file, and the runner scored the
 * corruptions against `negative_controls.html` instead — which has no `<h3>`, no
 * `<pre>` and no `<img>`, and deliberately allows punctuation-only blocks. Five
 * of the twelve corruptions came back NOT NOTICED, none of them because the
 * scorer was blind. "Nothing to damage" and "nothing watching" are opposite
 * findings that look identical in a table.
 */
const MUT_CLEAN = CONFORMANCE_CANDIDATE;
const MUT_HTML = CONFORMANCE_HTML;
const MUT_MANIFEST = CONFORMANCE_MANIFEST;
const MUT_GOLD = CONFORMANCE_GOLD;

/**
 * **Both tiers, because a metric can only be load-bearing on the tier it exists
 * on**, and the first version of this test ran the gold tier alone and called
 * `exclusionPrecision` and `blockCleanliness` passengers.
 *
 * They are not. On the gold tier `bodyPurity` catches everything they catch —
 * navigation and stray markers both grow the denominator — so removing either
 * one frees nothing, and the check said "delete them". But `bodyPurity` **does
 * not exist on a page off the web**, because nobody has written down what that
 * page's article is, and on the manifest tier those two are the *only* things
 * standing between an arm and a rail full of furniture. Deleting them on the
 * strength of a gold-tier result would have removed the corpus's entire defence
 * against the commonest failure the trawl found.
 */
const TIERS = {
  gold: { manifest: MUT_MANIFEST, gold: MUT_GOLD },
  /** What every real fixture gets: named strings, and no denominator. */
  manifest: { manifest: MUT_MANIFEST, gold: null },
} as const;

const cardOn = (tier: keyof typeof TIERS, c: Candidate): ReturnType<typeof score> =>
  score({
    fixture: "conformance-page", arm: "test", html: c.html, title: c.title, byline: c.byline,
    sourceHtml: MUT_HTML, ...TIERS[tier],
  });

const cardFor = (c: Candidate): ReturnType<typeof score> => cardOn("gold", c);

/**
 * **The metrics this page cannot hold, and where they are proved instead.**
 *
 * `articleRecall` asks what fraction of the *declared article region* the output
 * gave back, by source stamp, and `regionPrecision` asks what fraction of the
 * output is that region. The conformance page is hand-built and its corruptions
 * are DOM transforms of plain HTML, so it has neither a region nor stamps — the
 * same position `bodyPurity` is in on the manifest tier, and for the same kind of
 * reason.
 *
 * A carve-out is exactly the shape of thing that quietly grows until nothing is
 * proved anywhere, so two tests guard it: **"the carve-out is exactly what
 * abstains"** below refuses a metric that could have been exercised here, and
 * *the article region, attacked on a real page* gives every metric on this list
 * the exposure, the two-sided witness and the load-bearing witness it is excused
 * from earning here.
 */
const PROVENANCE_TIER: MetricName[] = ["articleRecall", "regionPrecision"];

const ON_THIS_PAGE = METRICS.filter((m) => !PROVENANCE_TIER.includes(m));

describe("mutation testing — is each metric load-bearing?", () => {
  const clean = cardFor(MUT_CLEAN);

  it("keeps the carve-out honest: it is exactly the metrics this page cannot hold", () => {
    /* Not a list somebody maintains — a list the page has to agree with. A
       metric added to `PROVENANCE_TIER` that this page *could* have exercised is
       a metric excused from its proof for no reason. */
    const abstains = METRICS.filter((m) => clean.metrics[m].value === null);
    expect(abstains, "PROVENANCE_TIER excuses a metric this page could have proved").toEqual(
      PROVENANCE_TIER,
    );
  });

  it("starts from a page on which every metric is exercised", () => {
    for (const m of ON_THIS_PAGE) {
      expect(clean.metrics[m].exercised, `${m} has nothing to hold on this page`).toBeGreaterThan(0);
      expect(clean.metrics[m].value, `${m} scored nothing on this page`).not.toBeNull();
    }
    /* And the clean page has to actually pass, or "damaged" and "already broken"
       are the same reading. */
    expect(clean.failures).toEqual([]);
    expect(clean.assertionsPassed).toBe(true);
    expect(clean.gates.attribution.passed).toBe(true);
    expect(clean.gates.sourceOrder.passed).toBe(true);
  });

  it("gives every corruption in the bank something to damage", () => {
    /* Separate from "does the card notice", and asked first. A corruption that
       changes nothing is reported as unnoticed by an instrument that is working
       perfectly, and the two readings are opposite. */
    const inert = CORRUPTIONS.filter((c) => c.apply(MUT_CLEAN).html === MUT_CLEAN.html
      && c.apply(MUT_CLEAN).byline === MUT_CLEAN.byline);
    expect(inert.map((c) => c.name), "these corruptions leave this page unchanged").toEqual([]);
  });

  it("notices every corruption in the bank, and by the route the bank claims", () => {
    const missed: string[] = [];
    for (const c of CORRUPTIONS) {
      const d = detects(clean, cardFor(c.apply(MUT_CLEAN)));
      if (!d.detected) { missed.push(`${c.name}: NOT NOTICED AT ALL`); continue; }
      const routes = [...d.byMetric, ...d.byGate] as string[];
      /* `noticedBy` is a claim in the bank, and an unchecked claim is how
         "exact, inert, free" got believed twice. At least one of the routes the
         template names has to be the route it was actually caught by. */
      if (!c.noticedBy.some((n) => routes.includes(n))) {
        missed.push(`${c.name}: caught by ${routes.join("+")}, not by ${c.noticedBy.join("/")}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it("has no passenger: removing any one metric lets some corruption through", () => {
    const witnesses: Record<string, string> = {};
    for (const tier of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
      const base = cardOn(tier, MUT_CLEAN);
      for (const m of METRICS) {
        if (base.metrics[m].value === null) continue; /* not on this tier at all */
        /**
         * **Metric routes only, and the gates deliberately left out of it.**
         *
         * `detects` reports `byGate` separately and its own header says a gate
         * never counts towards a metric being load-bearing — but this test asked
         * `detected`, which is the OR of both. The moment the attribution gate
         * became strong enough to notice `glue-nav-inside` as well, the two
         * metrics that exist to catch furniture on the manifest tier —
         * `exclusionPrecision` and `bodyPurity` — were reported as **passengers**,
         * and the instruction printed beside that word is "delete them". Deleting
         * them would have removed the corpus's whole defence against furniture on
         * every page where no gold exists.
         */
        const freed = CORRUPTIONS.filter((c) => {
          const damaged = cardOn(tier, c.apply(MUT_CLEAN));
          return (
            detects(base, damaged).byMetric.length > 0 &&
            detects(base, damaged, [m]).byMetric.length === 0
          );
        });
        if (freed.length) {
          witnesses[m] = `${tier} tier — ${freed.map((c) => c.name).join(", ")}`;
        }
      }
    }
    /* Printed on success as well as failure: the witness is the evidence that
       the metric earns its place, and it belongs in the run's output rather than
       only in an assertion nobody reads when it is green. */
    // eslint-disable-next-line no-console
    console.log("load-bearing witnesses:", JSON.stringify(witnesses, null, 2));
    const passengers = ON_THIS_PAGE.filter((m) => !(m in witnesses));
    expect(passengers, "these metrics are passengers — delete them or find their damage").toEqual([]);
  });

  it("gives EVERY metric its own two-sided proof, by name", () => {
    /**
     * **Per metric, not "one rose and one fell".**
     *
     * `polarityPair` passes as soon as *some* metric moves each way, so a metric
     * that never moves at all rides along on its neighbours. GPT Sol's finding 4:
     * metadata was never perturbed by anything in the harness, and the gates were
     * left out, so several metrics had **no individual polarity proof** anywhere
     * in the file.
     *
     * This is that proof. For each metric, some corruption must take it **down**
     * — and undoing the same corruption must take it back **up**, which is the
     * same numbers read the other way and is what makes it polarity rather than
     * sensitivity. And nothing in the bank may push any metric **up**: a metric
     * that rises on damage is the recovery-read-as-quality bug, and it is the one
     * shape three years of this repo's history keeps producing.
     */
    const witnesses: Partial<Record<MetricName, string>> = {};
    const rose: string[] = [];
    for (const tier of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
      const base = cardOn(tier, MUT_CLEAN);
      for (const c of CORRUPTIONS) {
        const damaged = cardOn(tier, c.apply(MUT_CLEAN));
        for (const m of METRICS) {
          const a = base.metrics[m].value;
          const b = damaged.metrics[m].value;
          if (a === null || b === null) continue;
          if (b > a + 1e-9) rose.push(`${m} ROSE on ${c.name} (${tier} tier): ${a} → ${b}`);
          if (b < a - 1e-9) witnesses[m] ??= `${c.name} (${tier} tier): ${a} → ${b}`;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log("per-metric polarity witnesses:", JSON.stringify(witnesses, null, 2));
    expect(rose, "a metric went UP on damage — the bug this whole file is named after").toEqual([]);
    expect(
      ON_THIS_PAGE.filter((m) => !(m in witnesses)),
      "these metrics have no damage of their own that moves them — they are proved by nothing",
    ).toEqual([]);
  });

  it("gives BOTH gates their own proof, by name", () => {
    /* The gates were left out of the polarity evidence entirely. Each one gets a
       corruption that flips it from true to false and nothing weaker. */
    const clean = cardOn("manifest", MUT_CLEAN);
    const witnesses: Record<string, string[]> = {};
    for (const c of CORRUPTIONS) {
      const damaged = cardOn("manifest", c.apply(MUT_CLEAN));
      for (const g of ["attribution", "sourceOrder"] as const) {
        if (clean.gates[g].passed === true && damaged.gates[g].passed === false) {
          witnesses[g] ??= [];
          witnesses[g]!.push(c.name);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log("gate polarity witnesses:", JSON.stringify(witnesses, null, 2));
    expect(witnesses["attribution"], "nothing in the bank invents text").toContain(
      "invent-short-text",
    );
    expect(witnesses["sourceOrder"], "nothing in the bank moves a section").toContain(
      "swap-two-sections",
    );
  });

  it("catches invented SHORT text on the attribution gate, where a 60-char floor could not", () => {
    /**
     * The corruption is thirty invented blocks of about thirteen characters each.
     * Under the gate as it stood until 2026-09-05 — which ignored every block
     * under 60 characters — **every one of them was invisible**, and GPT Sol's
     * reproduction put 393 characters of invented navigation through it with the
     * gate still green. Watched red by putting the floor back: with
     * `judged = blocks.filter(b => norm(b.text).length >= 60)` restored, this
     * assertion fails and `attribution.passed` is `true` on the corrupted page.
     */
    const clean = cardOn("manifest", MUT_CLEAN);
    const invented = CORRUPTIONS.find((c) => c.name === "invent-short-text")!;
    const damaged = cardOn("manifest", invented.apply(MUT_CLEAN));
    expect(clean.gates.attribution.passed).toBe(true);
    expect(damaged.gates.attribution.passed).toBe(false);
    expect(damaged.gates.attribution.detail).toContain("Zorbil weekly");
  });

  it("catches a duplicated paragraph on the ORDER GATE, which a membership test cannot", () => {
    /* Bug 3 in `scorecard.mts`'s header, and the one the old gate let through:
       `source.indexOf` per block gave the copy the same position as the original,
       so the positions were non-decreasing and the gate passed. */
    const dup = CORRUPTIONS.find((c) => c.name === "duplicate-para-aria-hidden")!;
    const clean = cardOn("manifest", MUT_CLEAN);
    const damaged = cardOn("manifest", dup.apply(MUT_CLEAN));
    expect(clean.gates.sourceOrder.passed).toBe(true);
    expect(damaged.gates.sourceOrder.passed).toBe(false);
  });

  it("catches the swapped sections on the ORDER GATE and on nothing else", () => {
    /* The point of a gate. Every word of the article is still present, in the
       right paragraphs, so recall, exclusion and purity are all flat — and a
       reader gets the sections in the wrong order. */
    const swapped = CORRUPTIONS.find((c) => c.name === "swap-two-sections")!;
    const d = detects(clean, cardFor(swapped.apply(MUT_CLEAN)));
    expect(d.byGate).toContain("sourceOrder");
    expect(d.byMetric).toEqual([]);
  });

  it("catches the flattened table on STRUCTURE and on nothing else", () => {
    /* `flatten-table` keeps every word on purpose. If any text-shaped metric
       moved here, it moved for a reason nobody intended. */
    const flat = CORRUPTIONS.find((c) => c.name === "flatten-table")!;
    const d = detects(clean, cardFor(flat.apply(MUT_CLEAN)));
    expect(d.byMetric).toEqual(["structureFidelity"]);
  });
});

/* ------------------------------------------ 4. the five degenerate arms ---- */

/**
 * Four real pages, chosen small so this can run on every `npm test`: the
 * hand-built negative-control page, the 250-word arXiv abstract, the Shakespeare
 * scene the corpus keeps as its control, and the Python module reference. The
 * whole 35-page corpus is `evals/extraction/score.mts`, which is a run, not a
 * test, and which enforces the same per-fixture assertion over all fifteen.
 *
 * **The fourth is here for an exposure count, not for variety.** GPT Sol's
 * padding arm — `region-padded-collage`, the one that deletes the article and
 * refills the space from off it — can only be exercised on a page with enough
 * off-article prose to fill that page's own length floor, and of the fifteen
 * only two have it: `aaronson` (606,316 characters of comment thread) and this
 * one (37,270, Sphinx's sidebar rendered twice). `aaronson` is 483 KB and this
 * is 173 KB, so this is the one the fast tests get. An arm proved on no fixture
 * is 260827ab's fourteen-page accordion answer again.
 */
const SMALL_FIXTURES = [
  "negative-controls", "arxiv-abs", "shakespeare-hamlet", "python-docs-itertools",
  /**
   * **The fifth is here for one arm.** `drop-generated-nodes` needs a page whose
   * extraction Readability built out of nothing — `pg-greatwork` is 599 `<br>`s
   * in one `<td>` and no `<p>` in the source at all — and the other four have
   * between them 272 characters in generated nodes, under the arm's own
   * precondition. Without it the arm would report `not exercised` here and the
   * finding it exists for would be tested only by the slow run. 78 KB.
   */
  "pg-greatwork",
  /**
   * **And the sixth for another.** `region-padding-only` inserts the page's own
   * off-article prose into the output, and it needs a page that has some with
   * stamps the output has not already used — six of the fifteen do, and
   * `plos-biology` is the smallest of them at 151 KB. Without it the arm would
   * be `not exercised` here and the addition-without-deletion finding would be
   * tested only by the slow run.
   */
  "plos-biology",
];

const FIXTURE_DIR = path.join("evals", "extraction", "fixtures");

/**
 * **The characters of each declared article region**, measured on 2026-09-05 and
 * pinned here so that widening a region is a red rather than a quiet
 * improvement in everybody's favour. Each manifest's `note` carries the same
 * number beside the whole source body's, which is the comparison that says
 * whether the region is the piece or most of the page.
 */
const REGION_CHARS: Record<string, number> = {
  "negative-controls": 3760,
  "arxiv-abs": 1007,
  "shakespeare-hamlet": 7299,
  "python-docs-itertools": 29949,
  "pg-greatwork": 54900,
  "plos-biology": 23330,
};

function fixtureBytes(name: string): {
  raw: string;
  url: string;
  manifest: AssertionManifest;
  /** What the gates are scored against — see `preparedSourceHtml`. */
  prepared: string;
} {
  const entry = SCORABLE_FIXTURES.find((f) => f.name === name)!;
  const raw = readFileSync(path.join(FIXTURE_DIR, entry.file), "utf-8");
  const manifest = parseManifest(
    JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.manifest.json`), "utf-8")),
    name,
  );
  return { raw, url: entry.url, manifest, prepared: preparedSourceHtml(raw, entry.url) };
}

describe("the degenerate arms — each has to lose, and the test names where", () => {
  const losses: Record<string, Record<string, string[]>> = {};
  /**
   * **Every card this block needs, built once.**
   *
   * Each entry costs a `readArticleWithProvenance` — two JSDOM parses of the
   * whole page and a Readability pass — and `arms.mts` caches only the page it
   * is working on. Two tests that each re-walked `SMALL_FIXTURES` therefore paid
   * for eight more of them, passed comfortably when the file was run alone, and
   * **timed out at 30 s under a full `npm test`**, where the box is doing
   * everything else at the same time. A test that is green alone and red in the
   * suite is a test nobody can read, so the work is hoisted and the `it`s are
   * assertions over what is already computed.
   */
  const perFixture: Record<
    string,
    { shipped: ReturnType<typeof score>; collage: ReturnType<typeof score> | null; prepared: string }
  > = {};

  for (const fixture of SMALL_FIXTURES) {
    const { raw, url, manifest, prepared } = fixtureBytes(fixture);
    const ctx = { manifest, url };
    const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
    const cardOf = (c: Candidate, arm: string) =>
      score({
        fixture, arm, html: c.html, stampedHtml: c.stampedHtml, refused: c.refused,
        title: c.title, byline: c.byline, sourceHtml: prepared, manifest,
      });
    const base = cardOf(shipped, SHIPPED_ARM);
    let collage: ReturnType<typeof score> | null = null;
    for (const armName of DEGENERATE_ARMS) {
      const arm = armNamed(armName);
      if (!arm.precondition(raw, shipped, ctx)) continue;
      const card = cardOf(arm.run(raw, url, ctx), armName);
      if (armName === "needle-collage") collage = card;
      const d = detects(base, card);
      losses[armName] ??= {};
      losses[armName]![fixture] = [...d.byMetric, ...d.byGate];
    }
    perFixture[fixture] = { shipped: base, collage, prepared };
  }

  it("fails the ATTRIBUTION gate on the needle collage, which the comment claimed and it did not", () => {
    /**
     * **A claim in a comment that the code did not keep.** `arms.mts` said two
     * routes caught `needle-collage` and named the attribution gate as one of
     * them. It was not one of them: the arm supplied no `stampedHtml`, so the
     * *weak text form* ran, and the weak form's whole weakness is that a node
     * fabricated out of copied page text is text that is on the page. GPT Sol
     * checked the run — `aaronson`, `arxiv-abs` and `constitution` all read
     * `ok/ok` on that arm. `structureFidelity` and `minArticleChars` were what
     * caught it.
     *
     * The arm hands over its output for inspection now, and its answer to
     * *"where did this node come from"* is **nowhere**, which is what a
     * fabricated node is. So the comment is true, and this is what makes it stay
     * true.
     */
    let asked = 0;
    for (const fixture of SMALL_FIXTURES) {
      const card = perFixture[fixture]?.collage;
      if (!card) continue;
      asked += 1;
      expect(card.gates.attribution.passed, `${fixture}: the collage passed attribution`).toBe(
        false,
      );
      expect(card.gates.attribution.detail).toContain("fabricated");
    }
    expect(asked, "the collage was not exercised on any fixture").toBeGreaterThan(2);
  });

  it("resolves every declared article region against the prepared source", () => {
    /**
     * **A selector that matches nothing scores nothing, and it must not do so
     * quietly.** `articleRegion` names selectors in the *prepared* document, and
     * `prepareDocument` rewrites the page before Readability sees it — so a
     * region written against the raw bytes can resolve to an empty set and turn
     * every length assertion into `—`. It would look like caution.
     *
     * Here for these four; [score.mts](../evals/extraction/score.mts) asks it of
     * all fifteen, where a broken selector surfaces as a `minArticleChars …
     * COULD NOT BE CHECKED` failure rather than as a pass.
     */
    for (const fixture of SMALL_FIXTURES) {
      const { shipped: card, prepared } = perFixture[fixture]!;
      /**
       * **The size of each region, pinned.** A region is a judgement, and the
       * way a judgement goes wrong here is by being drawn generously — which
       * flatters the pipeline exactly as a floor copied from the damaged output
       * did, and which nothing else would notice, because a bigger region makes
       * every number *worse* rather than obviously wrong. So the numbers are
       * assertions. They depend on the fixture's bytes and the selectors and on
       * nothing stage 2 does, so they are stable across the rest of this plan.
       */
      expect(card.article.regionChars, `${fixture}: ${card.article.basis}`).toBe(
        REGION_CHARS[fixture],
      );
      /* What comes back is not pinned, because stage 2 is what this plan is
         changing. It has to be most of the region, or the fixture is not a page
         the pipeline handles and the region is not the piece. */
      expect(
        card.article.chars! / card.article.regionChars,
        `${fixture}: only ${card.article.chars} of ${card.article.regionChars} region characters`,
      ).toBeGreaterThan(0.9);
      /* And the region has to be smaller than the page, or it is not a region. */
      expect(
        card.article.regionChars,
        `${fixture}: the region is the whole page, which asserts nothing`,
      ).toBeLessThan(prepared.replace(/<[^>]*>/g, "").replace(/\s+/g, "").length);
    }
  });

  it("exercises every degenerate arm on at least one fixture", () => {
    /* The exposure count again, at arm level. An arm whose precondition holds
       nowhere has not been shown safe; it has not been shown anything. */
    for (const arm of DEGENERATE_ARMS) {
      expect(Object.keys(losses[arm] ?? {}), `${arm} was NOT EXERCISED on any fixture`).not.toEqual([]);
    }
  });

  it("makes each of them lose on a named metric or gate, on EVERY page it is exercised on", () => {
    /**
     * **"Lost somewhere" is not the claim.** Until 2026-09-05 this asked only
     * that an arm lose on *at least one* fixture, and `needle-collage` — which
     * returns the manifest's own needles and 0.55% of the article — passed it by
     * losing a structural floor on the one page of the three that declares any.
     * On the other two the card was flat and the arm was invisible, which is
     * precisely GPT Sol's finding.
     *
     * So the assertion is per fixture. A page that cannot catch an arm this
     * degenerate is a page whose manifest is not yet doing its job, and it says
     * which page rather than being averaged away.
     */
    const report: Record<string, string> = {};
    const clean: string[] = [];
    for (const arm of DEGENERATE_ARMS) {
      const rows = Object.entries(losses[arm] ?? {});
      report[arm] = rows.map(([fx, ms]) => `${fx}: ${ms.join("+") || "NOTHING"}`).join(" | ");
      for (const [fx, ms] of rows) {
        if (!ms.length && !HARMLESS_HERE.has(`${arm} on ${fx}`)) clean.push(`${arm} on ${fx}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log("degenerate arms, and what each one loses on:", JSON.stringify(report, null, 2));
    expect(clean, "these degenerate arms scored no worse than the shipped one").toEqual([]);
  });

  it("keeps every exemption honest — an unused one is a claim nothing tests", () => {
    /**
     * An exemption for a pair that now loses something is a stale excuse, and it
     * would quietly go on excusing the pair if the loss ever stopped.
     *
     * **Only the pairs these four fixtures can speak to.** `HARMLESS_HERE` is
     * shared with [score.mts](../evals/extraction/score.mts), which exercises all
     * fifteen and checks the rest — asking this file about
     * `first-20-percent on aaronson` would report "not exercised" and mean
     * "not here", which is the wrong sentence. What this file CAN check about
     * every entry is that it names an arm and a fixture that exist, so a
     * renamed arm cannot leave an exemption pointing at nothing.
     */
    for (const key of HARMLESS_HERE.keys()) {
      const [arm, fixture] = key.split(" on ") as [string, string];
      expect(DEGENERATE_ARMS, `${key}: no such arm`).toContain(arm);
      expect(
        SCORABLE_FIXTURES.map((f) => f.name),
        `${key}: no such fixture`,
      ).toContain(fixture);
    }
    const stale = [...HARMLESS_HERE.keys()].filter((key) => {
      const [arm, fixture] = key.split(" on ") as [string, string];
      if (!SMALL_FIXTURES.includes(fixture)) return false;
      const ms = losses[arm]?.[fixture];
      return ms === undefined || ms.length > 0;
    });
    expect(
      stale,
      "these pairs are exempted from losing and either are not exercised, or now lose something",
    ).toEqual([]);
  });

  it("makes 260830at's short-block rule lose the negative controls by name", () => {
    /* The specific claim, not a general one. The rule scored 246/246 on a corpus
       that could not defeat it; here is the page that defeats it and the strings
       it takes. */
    const { raw, url, manifest, prepared } = fixtureBytes("negative-controls");
    const arm = armNamed("drop-every-short-block");
    const ctx = { manifest, url };
    const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
    expect(arm.precondition(raw, shipped, ctx), "the page has no short block to delete").toBe(true);
    const out = arm.run(raw, url, ctx);
    const card = score({
      fixture: "negative-controls", arm: arm.name, sourceHtml: prepared, manifest,
      html: out.html, stampedHtml: out.stampedHtml, refused: out.refused,
      title: out.title, byline: out.byline,
    });
    const lost = card.failures.filter((f) => f.startsWith("missing required text"));
    // eslint-disable-next-line no-console
    console.log("the short-block rule loses:", lost);
    expect(card.assertionsPassed).toBe(false);
    /* The scoreline and the scene break by name — the two shapes the rule was
       specifically shown, in 260830at, to be unable to tell from junk. */
    expect(lost.join(" ")).toContain("1–0");
    expect(lost.join(" ")).toContain("❦");
  });

  /**
   * **The strong gates, attacked directly** — because the arms above all fail on
   * something a metric can see, and none of them exercises the one question the
   * provenance form exists to answer.
   *
   * These three are the adversaries GPT Sol's review implies but did not build:
   * an arm that keeps **real stamped elements** rather than fabricating nodes, an
   * arm that rewrites prose inside a node that kept its identity, and an arm that
   * swaps two of them. The first two are what a model repair pass would do.
   */
  describe("the provenance gates, attacked on a real page", () => {
    const { raw, url, manifest, prepared } = fixtureBytes("negative-controls");
    const shipped = armNamed(SHIPPED_ARM).run(raw, url, { manifest, url });
    const stamped = shipped.stampedHtml!;

    const parse = (html: string): Document =>
      new JSDOM(`<!doctype html><body>${html}</body>`, {
        virtualConsole: new VirtualConsole(),
      }).window.document;
    const stripStamps = (html: string): string => {
      const doc = parse(html);
      for (const el of Array.from(doc.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`))) {
        el.removeAttribute(RESERVED_ATTRS.sourceRef);
      }
      return doc.body.innerHTML;
    };
    const ownText = (el: Element): string =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    const cardOf = (html: string, arm: string) =>
      score({
        fixture: "negative-controls", arm, html: stripStamps(html), stampedHtml: html,
        refused: false, title: shipped.title, byline: shipped.byline,
        sourceHtml: prepared, manifest,
      });

    it("starts from a shipped extraction that passes both of them", () => {
      /* Otherwise every assertion below is "already broken" rather than "caught". */
      const clean = cardOf(stamped, SHIPPED_ARM);
      expect(clean.gates.attribution.passed).toBe(true);
      expect(clean.gates.sourceOrder.passed).toBe(true);
      expect(clean.gates.attribution.exercised).toBeGreaterThan(20);
    });

    it("catches prose REWRITTEN inside a node that kept its source identity", () => {
      /* The model-repair-pass shape, and the one the text form cannot see: every
         word is still on the page, in a node that still resolves to its own source
         element, and the sentence is not the author's any more. */
      const doc = parse(stamped);
      const victim = Array.from(doc.querySelectorAll("*")).find((el) => ownText(el).length > 200);
      expect(victim, "no node on this page carries 200 characters of its own").toBeDefined();
      for (const n of Array.from(victim!.childNodes)) {
        if (n.nodeType !== 3) continue;
        n.textContent = (n.textContent ?? "").split(" ").reverse().join(" ");
      }
      const card = cardOf(doc.body.innerHTML, "rewrite-in-place");
      expect(card.gates.attribution.passed).toBe(false);
      expect(card.gates.attribution.detail).toContain("did not say");
    });

    it("catches two stamped nodes SWAPPED, which every text measure calls unharmed", () => {
      const doc = parse(stamped);
      const carriers = Array.from(doc.querySelectorAll("*")).filter(
        (el) => ownText(el).length > 40,
      );
      expect(carriers.length).toBeGreaterThan(2);
      const [a, b] = carriers as [Element, Element];
      const anchor = doc.createElement("span");
      a.replaceWith(anchor);
      b.replaceWith(a);
      anchor.replaceWith(b);
      const card = cardOf(doc.body.innerHTML, "swap-two-carriers");
      expect(card.gates.sourceOrder.passed).toBe(false);
      expect(card.gates.attribution.passed, "nothing was invented, only moved").toBe(true);
    });

    it("catches a stamped node said TWICE, and allows one the extractor split", () => {
      /**
       * **Splitting is not duplicating**, and the first version of the order rule
       * could not tell them apart. Readability breaks `gutenberg-pride`'s title
       * `<i>` around its `<br>`s into two nodes that both inherit source id
       * `s145` — *"by Jane Austen,"* and *"with a Preface by George Saintsbury…"*
       * — which strict increase called a duplicate on a correct extraction. Both
       * halves are asserted here so neither can be fixed by breaking the other.
       */
      const doc = parse(stamped);
      const victim = Array.from(doc.querySelectorAll("*")).find((el) => ownText(el).length > 100)!;

      const twin = doc.createElement("span");
      twin.setAttribute(
        RESERVED_ATTRS.sourceRef,
        victim.getAttribute(RESERVED_ATTRS.sourceRef) ?? "",
      );
      twin.textContent = ownText(victim);
      victim.parentNode?.insertBefore(twin, victim.nextSibling);
      const duplicated = cardOf(doc.body.innerHTML, "say-it-twice");
      expect(duplicated.gates.sourceOrder.passed).toBe(false);
      expect(duplicated.gates.sourceOrder.detail).toContain("same thing twice");

      /* And the split: the same id twice, saying two different halves. */
      const doc2 = parse(stamped);
      const victim2 = Array.from(doc2.querySelectorAll("*")).find(
        (el) => ownText(el).length > 100,
      )!;
      const whole = ownText(victim2);
      const half = Math.floor(whole.length / 2);
      const rest = doc2.createElement("span");
      rest.setAttribute(
        RESERVED_ATTRS.sourceRef,
        victim2.getAttribute(RESERVED_ATTRS.sourceRef) ?? "",
      );
      rest.textContent = whole.slice(half);
      for (const n of Array.from(victim2.childNodes)) if (n.nodeType === 3) n.remove();
      victim2.insertBefore(doc2.createTextNode(whole.slice(0, half)), victim2.firstChild);
      victim2.parentNode?.insertBefore(rest, victim2.nextSibling);
      const split = cardOf(doc2.body.innerHTML, "split-in-two");
      expect(split.gates.sourceOrder.passed, "a split element read as a duplicate").toBe(true);
      expect(split.gates.attribution.passed, "a split element read as invented text").toBe(true);
    });

    it("catches the two halves of ONE paragraph swapped, which a total cover once allowed", () => {
      /**
       * **GPT Sol's second review, finding 2.** He took one directly stamped,
       * leaf-level 459-character paragraph and swapped its two halves — 231
       * characters and 227 — and every metric, both gates and every assertion
       * passed. `coverOf` looked for each run *anywhere* in the source element
       * and never advanced a source-side cursor, so a total cover proved the
       * words were the element's and nothing about their arrangement.
       *
       * It is the attribution gate that catches it, not order, and that is
       * right: a cover is a subsequence **in order**, so the second half arrives
       * where the source has nothing left to match it against. The message says
       * which of the two reds it is.
       */
      const doc = parse(stamped);
      const victim = Array.from(doc.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && ownText(el).length > 300,
      );
      expect(victim, "no leaf on this page carries 300 characters of its own").toBeDefined();
      const whole = ownText(victim!);
      const cut = whole.indexOf(" ", Math.floor(whole.length / 2));
      const left = whole.slice(0, cut);
      const right = whole.slice(cut + 1);
      expect(left.length, "the halves are too short to be evidence").toBeGreaterThan(150);
      expect(right.length).toBeGreaterThan(150);
      victim!.textContent = `${right} ${left}`;
      const card = cardOf(doc.body.innerHTML, "swap-halves-in-place");
      expect(card.gates.attribution.passed, "the halves were swapped and nothing saw it").toBe(
        false,
      );
      expect(card.gates.attribution.detail).toContain("out of the element's own order");
    });

    it("catches two nodes sharing ONE stamp emitted right before left", () => {
      /**
       * The same review, same finding, second half: equal stamp positions are
       * allowed on purpose — `gutenberg-pride` proved splitting is not
       * duplicating — and the duplicate rule rejects only an identical
       * `(id, text)` pair. So splitting one element into two stamped halves and
       * emitting them backwards passed both gates. The order gate now walks a
       * cursor through each source element's own text.
       */
      const doc = parse(stamped);
      const victim = Array.from(doc.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && ownText(el).length > 300,
      )!;
      const whole = ownText(victim);
      const at = whole.indexOf(" ", Math.floor(whole.length / 2));
      const id = victim.getAttribute(RESERVED_ATTRS.sourceRef)!;
      const half = (text: string): Element => {
        const el = doc.createElement("span");
        el.setAttribute(RESERVED_ATTRS.sourceRef, id);
        el.textContent = text;
        return el;
      };
      victim.replaceWith(half(whole.slice(at + 1)), half(whole.slice(0, at)));
      const card = cardOf(doc.body.innerHTML, "swap-adjacent-equal-stamp");
      expect(card.gates.sourceOrder.passed, "right-before-left under one stamp passed").toBe(false);
      expect(card.gates.sourceOrder.detail).toContain("out of order");
      expect(card.gates.attribution.passed, "nothing was invented, only reordered").toBe(true);
    });

    it("catches a fabricated node made only of symbols, on the page where ❦ is real", () => {
      /**
       * **The decision, made deliberately and written down.** `HAS_CONTENT` was
       * *"has a letter or a digit"*, so GPT Sol appended `<p>☠☠☠</p>` to this
       * extraction and attribution passed — on the one page in the corpus whose
       * whole purpose is that `❦` is real article content a character-class rule
       * would delete.
       *
       * The gate says nothing in the output may be text the page did not have,
       * and three skulls are text this page did not have. So anything with a
       * character in it is judged now, and the worry that motivated the old rule
       * — a stray pilcrow condemned by a whole-page match — is answered by
       * asking a stamped node about **its own** source element. Measured across
       * all twelve article fixtures: both gates stay green and each judges more
       * nodes than before.
       */
      const card = cardOf(`${stamped}<p>☠☠☠</p>`, "invent-symbol-only");
      expect(card.gates.attribution.passed).toBe(false);
      expect(card.gates.attribution.detail).toContain("fabricated");
      /* And the real one is still fine: the page's own scene break is article
         content, it is stamped, and it does not fail anything. */
      expect(cardOf(stamped, SHIPPED_ARM).gates.attribution.passed).toBe(true);
      expect(cardOf(stamped, SHIPPED_ARM).metrics.requiredRecall.value).toBe(1);
    });

    it("catches SHORT DISPLACEMENTS repeated without limit — forgiveness has a total now", () => {
      /**
       * **GPT Sol's third review, finding 3, and the adversary reads the rule.**
       *
       * `coverOf` forgave any unmatched run shorter than `minRun` that occurs
       * somewhere in the source, and it had no total. So an attacker emits `n`
       * correct characters, then a short run lifted from elsewhere in the same
       * element, and repeats — **asking the cover itself which displacements it
       * will forgive and keeping only those**. Reproduced here on 2026-09-05
       * before it was fixed: 9 nodes, 2,245 characters attacked, **445 to 728
       * characters displaced, 16.5% to 24.5% of the output**, `articleRecall`
       * 1.00, both gates green, every assertion held, `detects` NOTHING.
       *
       * Two things stop it, and they are separate on purpose. The **budget**
       * makes the gate red, because a cover may now forgive at most one join's
       * worth in total. And `articleReturned` credits only what the cover
       * actually **covered**, so even a displacement inside the budget is not
       * paid for. Measured: the fifteen shipped extractions forgive zero
       * characters in this form, so neither costs the corpus anything.
       *
       * The oracle below is the *old* rule deliberately — an adversary that
       * knows only what was there before still has to lose.
       */
      const forgiveOld = (source: string, t: string, minRun: number): boolean => {
        let i = 0;
        let bad = 0;
        let cursor = 0;
        const ok = (x: string): boolean => x.length < minRun && source.includes(x);
        while (i < t.length) {
          const floor = Math.min(minRun, t.length - i);
          if (source.indexOf(t.slice(i, i + floor), cursor) === -1) { i += 1; bad += 1; continue; }
          let lo = floor;
          let hi = t.length - i;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (source.indexOf(t.slice(i, i + mid), cursor) !== -1) lo = mid;
            else hi = mid - 1;
          }
          const at = source.indexOf(t.slice(i, i + lo), cursor);
          if (bad > 0) {
            if (!ok(t.slice(Math.max(0, i - bad), i))) return false;
            bad = 0;
          }
          cursor = at + lo;
          i += lo;
        }
        return bad === 0 || ok(t.slice(t.length - bad));
      };

      const doc = parse(stamped);
      const needles = [...manifest.mustContain, ...manifest.mustNotContain].map((n) =>
        n.text.replace(/\s+/gu, ""),
      );
      let attacked = 0;
      let displaced = 0;
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        if (el.children.length) continue;
        const node = Array.from(el.childNodes).filter((n) => n.nodeType === 3);
        if (node.length !== 1) continue;
        if (!el.getAttribute(RESERVED_ATTRS.sourceRef)) continue;
        const was = (node[0]!.textContent ?? "").replace(/\s+/gu, "");
        if (was.length < 150) continue;
        if (needles.some((n) => n.length > 0 && was.includes(n))) continue;
        let out = "";
        let i = 0;
        while (i < was.length) {
          out += was.slice(i, i + 24);
          i += 24;
          if (i >= was.length) break;
          for (let k = 1; k <= 24; k++) {
            const j = (i * 37 + k * 101) % Math.max(1, was.length - 5);
            const d = was.slice(j, j + 5);
            if (!d.trim()) continue;
            if (!forgiveOld(was, `${out}${d}${was.slice(i)}`, 8)) continue;
            out += d;
            displaced += 5;
            break;
          }
        }
        node[0]!.textContent = out;
        attacked += was.length;
      }
      expect(attacked, "no leaf on this page is long enough to attack").toBeGreaterThan(1500);
      expect(
        displaced,
        "the old rule forgave nothing here, so this test could not have gone red",
      ).toBeGreaterThan(300);

      const clean = cardOf(stamped, SHIPPED_ARM);
      const card = cardOf(doc.body.innerHTML, "displace-in-place");
      expect(card.gates.attribution.passed, "repeated forgiven displacements passed").toBe(false);
      expect(card.metrics.articleRecall.value!).toBeLessThan(
        clean.metrics.articleRecall.value! - 0.1,
      );
      expect(detects(clean, card).detected).toBe(true);
    });

    it("pays for what the cover COVERED, never for a fragment it merely forgave", () => {
      /**
       * **The quantity half of finding 3, and it needs a witness of its own
       * because the budget hides it.**
       *
       * A cover answers two different questions and one number was answering
       * both. *Does this node count at all* has to be lenient — a removed inline
       * child leaves a fragment too short for the window to see, and condemning
       * it fails correct extractions. *How much did this node give back* must not
       * be: `articleReturned` credited `own.length`, every character the node
       * carried, including the ones the cover waved through.
       *
       * One node, so the number on the card IS that node's credit. Its text is
       * the first 60% of what the source element said, plus seven characters
       * from the element's own opening — short enough to be forgiven, present in
       * the source, and behind the cursor by the time the walk reaches them.
       *
       * Breaking the credit back to `own.length` while leaving the budget in
       * place leaves every other test in this file green, which is why this one
       * exists.
       */
      const doc = parse(stamped);
      const victim = Array.from(doc.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && ownText(el).length > 300,
      );
      expect(victim, "no leaf on this page carries 300 characters of its own").toBeDefined();
      const id = victim!.getAttribute(RESERVED_ATTRS.sourceRef);
      expect(id, "that leaf is not directly stamped").toBeTruthy();
      const whole = ownText(victim!).replace(/\s+/gu, "");
      const keep = Math.floor(whole.length * 0.6);
      const fragment = whole.slice(4, 11);
      expect(fragment.length).toBe(7);
      expect(
        whole.indexOf(fragment, keep),
        "this fragment occurs after the cut, so it would be covered rather than forgiven — " +
          "which is correct behaviour and a different test",
      ).toBe(-1);

      const one = `<p ${RESERVED_ATTRS.sourceRef}="${id}">${whole.slice(0, keep)}${fragment}</p>`;
      const card = cardOf(one, "forgiven-fragment");
      expect(
        card.gates.attribution.passed,
        "one join inside the budget must still pass, or this is testing the budget",
      ).toBe(true);
      /* The greedy walk can pick up a character or two of the fragment as a
         genuine short run, so this is not asserted to the digit — but it must be
         nowhere near having been paid for all seven. */
      expect(card.article.chars!).toBeGreaterThanOrEqual(keep);
      expect(
        card.article.chars!,
        "the credit was paid for the forgiven fragment as well as for the article",
      ).toBeLessThan(keep + fragment.length);
    });

    it("catches a collage of REAL stamped elements, which both gates think is fine", () => {
      /* The harder collage: no fabricated nodes at all, so provenance is spotless.
         What catches it is the manifest's structural floors and `minArticleChars`,
         both of which are set from source truth — which is why Sol's finding 3 and
         finding 1 had to be fixed together. */
      const doc = parse(stamped);
      const keep: Element[] = [];
      for (const needle of manifest.mustContain.map((n) => n.text.replace(/\s+/g, " ").trim())) {
        const holders = Array.from(doc.querySelectorAll("*")).filter((el) =>
          (el.textContent ?? "").replace(/\s+/g, " ").trim().includes(needle),
        );
        const deepest = holders[holders.length - 1];
        if (deepest) keep.push(deepest);
      }
      const card = cardOf(keep.map((el) => el.outerHTML).join(""), "stamped-collage");
      expect(card.metrics.requiredRecall.value, "it keeps every required needle").toBe(1);
      expect(card.assertionsPassed, "a collage of real elements passed every assertion").toBe(
        false,
      );
      expect(card.metrics.structureFidelity.value).toBe(0);
      expect(detects(cardOf(stamped, SHIPPED_ARM), card).detected).toBe(true);
    });
  });

  /**
   * **The article region, attacked on a real page** — and this is where
   * `articleRecall` earns the three proofs the conformance page cannot give it.
   *
   * Its exposure, its own two-sided witness, and its load-bearing witness. The
   * last is the one worth reading: deleting a paragraph of the article that
   * holds no declared needle moves **nothing else on the card**. Every text
   * metric is about strings somebody wrote down, and nobody wrote that paragraph
   * down; the gates are about provenance and order, and a deletion violates
   * neither. That is the hole the informed-deleter probe measured at 7–10% of
   * two of three pages, and it is what this metric is for.
   */
  describe("the article region, attacked on a real page", () => {
    const { raw, url, manifest, prepared } = fixtureBytes("negative-controls");
    const shipped = armNamed(SHIPPED_ARM).run(raw, url, { manifest, url });
    const parse = (html: string): Document =>
      new JSDOM(`<!doctype html><body>${html}</body>`, {
        virtualConsole: new VirtualConsole(),
      }).window.document;
    const stripStamps = (html: string): string => {
      const doc = parse(html);
      for (const el of Array.from(doc.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`))) {
        el.removeAttribute(RESERVED_ATTRS.sourceRef);
      }
      return doc.body.innerHTML;
    };
    const cardOf = (stamped: string, arm: string) =>
      score({
        fixture: "negative-controls", arm, html: stripStamps(stamped), stampedHtml: stamped,
        refused: false, title: shipped.title, byline: shipped.byline,
        sourceHtml: prepared, manifest,
      });
    const clean = cardOf(shipped.stampedHtml!, SHIPPED_ARM);

    /** The longest paragraph of the article that no `mustContain` needle names. */
    const withoutAParagraph = (): { html: string; chars: number } => {
      const doc = parse(shipped.stampedHtml!);
      const needles = manifest.mustContain.map((n) => n.text.replace(/\s+/g, " ").trim());
      const victim = Array.from(doc.querySelectorAll("p"))
        .filter((el) => {
          const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          return t.length > 100 && !needles.some((n) => t.includes(n));
        })
        .sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0];
      expect(victim, "no undeclared paragraph on this page to delete").toBeDefined();
      const chars = (victim!.textContent ?? "").replace(/\s+/g, " ").trim().length;
      victim!.remove();
      return { html: doc.body.innerHTML, chars };
    };

    it("exercises articleRecall, and the shipped extraction nearly clears the region", () => {
      for (const m of PROVENANCE_TIER) {
        expect(clean.metrics[m].exercised, `${m} is not exercised here either`).toBeGreaterThan(0);
        expect(clean.metrics[m].value, `${m} scored nothing here either`).not.toBeNull();
      }
      /* The one region element it misses is the <h1>, which Readability hoists
         into `title` by design — so "nearly", and the number is asserted rather
         than described. */
      expect(clean.article.regionChars).toBe(3760);
      expect(clean.article.chars).toBe(3713);
      expect(clean.metrics.articleRecall.value).toBeCloseTo(3713 / 3760, 6);
    });

    it("gives articleRecall its own two-sided witness, by name", () => {
      const cut = withoutAParagraph();
      const damaged = cardOf(cut.html, "delete-one-paragraph");
      expect(cut.chars, "the deletion is too small to mean anything").toBeGreaterThan(100);
      const before = clean.metrics.articleRecall.value!;
      const after = damaged.metrics.articleRecall.value!;
      // eslint-disable-next-line no-console
      console.log(
        `articleRecall witness: deleting ${cut.chars} characters took it ${before.toFixed(3)} → ` +
          `${after.toFixed(3)} (${clean.article.chars} → ${damaged.article.chars} of ` +
          `${clean.article.regionChars})`,
      );
      expect(after, "articleRecall did not fall when a paragraph was deleted").toBeLessThan(before);
      /* And the same numbers the other way, which is what makes it polarity
         rather than sensitivity: putting the paragraph back puts it up. */
      expect(before).toBeGreaterThan(after);
    });

    it("is load-bearing: without it, a deleted paragraph goes entirely unnoticed", () => {
      const cut = withoutAParagraph();
      const damaged = cardOf(cut.html, "delete-one-paragraph");
      const with_ = detects(clean, damaged);
      const without = detects(clean, damaged, ["articleRecall"]);
      // eslint-disable-next-line no-console
      console.log(
        "deleting one undeclared paragraph is noticed by:",
        JSON.stringify([...with_.byMetric, ...with_.byGate]),
        "and without articleRecall by:",
        JSON.stringify([...without.byMetric, ...without.byGate]),
      );
      expect(with_.byMetric).toContain("articleRecall");
      expect(
        [...without.byMetric, ...without.byGate],
        "something else caught it, so this witness proves nothing about articleRecall",
      ).toEqual([]);
    });

    it("fails minArticleChars rather than passing it when nothing can be resolved", () => {
      /* An assertion that could not be checked is not an assertion that held —
         and the shape it takes here is a candidate with no stamps, which is what
         `needle-collage` used to hide behind. */
      const card = score({
        fixture: "negative-controls", arm: "no-provenance",
        html: stripStamps(shipped.stampedHtml!), refused: false,
        title: shipped.title, byline: shipped.byline, sourceHtml: prepared, manifest,
      });
      expect(card.article.chars).toBeNull();
      expect(card.metrics.articleRecall.value).toBeNull();
      expect(card.failures.join(" ")).toContain("COULD NOT BE CHECKED");
      expect(card.assertionsPassed).toBe(false);
    });
  });

  describe("the two findings the region measure could not see until 2026-09-05", () => {
    /**
     * **Deletion the numerator never counted, and addition no numerator watched.**
     *
     * GPT Sol's third review found both on the same afternoon and they are
     * opposite halves of one mistake: `articleRecall` credited only *directly*
     * stamped nodes, and it had no denominator on the output side at all.
     */
    it("sees a page's GENERATED nodes deleted — 81% of pg-greatwork, once invisible", () => {
      /**
       * Reproduced before it was fixed: shipped gistable **66,449**, this arm
       * **12,665** — 53,784 characters of Paul Graham's essay gone in 216 nodes —
       * and `articleChars` **6,330** with `articleRecall` **0.1153**, the same to
       * the digit as the shipped arm, both gates green, `detects` NOTHING.
       *
       * The shipped numbers matter as much as the arm's: crediting
       * ancestor-resolved nodes took the shipped card from **0.1153 to 0.9237**.
       * A measure that scores a correct extraction of this page at 0.115 is not
       * measuring the article, it is measuring how much of it Readability had to
       * build.
       */
      const { raw, url, manifest, prepared } = fixtureBytes("pg-greatwork");
      const ctx = { manifest, url };
      const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
      const arm = armNamed("drop-generated-nodes");
      expect(arm.precondition(raw, shipped, ctx), "nothing generated on this page").toBe(true);
      const cardOf = (c: Candidate, name: string) =>
        score({
          fixture: "pg-greatwork", arm: name, html: c.html, stampedHtml: c.stampedHtml,
          refused: c.refused, title: c.title, byline: c.byline, sourceHtml: prepared, manifest,
        });
      const clean = cardOf(shipped, SHIPPED_ARM);
      const damaged = cardOf(arm.run(raw, url, ctx), arm.name);
      expect(
        clean.metrics.articleRecall.value!,
        "a correct extraction of this page scores low, so the measure is the wrong one",
      ).toBeGreaterThan(0.9);
      expect(damaged.article.chars!).toBeLessThan(clean.article.chars! / 3);
      const d = detects(clean, damaged);
      expect(d.byMetric).toContain("articleRecall");
      expect(d.byMetric).toContain("regionPrecision");
    });

    it("pays ONCE for a paragraph said two hundred times, not two hundred times", () => {
      /**
       * **GPT Sol's fourth review, and it is the hole the generated-node repair
       * opened.** Crediting a generated node against its stamped ancestor meant
       * several output nodes credited the same ancestor, and `articleReturned`
       * summed each one's `cover.covered` into that ancestor's total — capped at
       * the ancestor's length, and never asking *which part* of it each cover had
       * matched.
       *
       * On `pg-greatwork`, 197 copies of one genuine generated paragraph with its
       * stamped ancestor kept: **410 distinct characters, 0.75% of the
       * 54,900-character region**, `articleRecall` **0.9881**, `regionPrecision`
       * **0.9817**, both gates green — while the card's own basis line said
       * *"1 of 108 stamped region elements came back"*. The credit is the union of
       * source intervals now: **0.9881 → 0.0110**.
       */
      const { raw, url, manifest, prepared } = fixtureBytes("pg-greatwork");
      const ctx = { manifest, url };
      const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
      const arm = armNamed("repeat-one-generated-node");
      expect(arm.precondition(raw, shipped, ctx), "nothing generated on this page").toBe(true);
      const cardOf = (c: Candidate, name: string) =>
        score({
          fixture: "pg-greatwork", arm: name, html: c.html, stampedHtml: c.stampedHtml,
          refused: c.refused, title: c.title, byline: c.byline, sourceHtml: prepared, manifest,
        });
      const clean = cardOf(shipped, SHIPPED_ARM);
      const damaged = cardOf(arm.run(raw, url, ctx), arm.name);
      /* **The shape of the attack, asserted rather than assumed**: the output is
         many times the article it actually returned. Not "longer than the
         shipped extraction" — that was the first version of this line and it is
         the wrong property, since an arm could repeat a paragraph fifty times
         and still be shorter than the page. */
      expect(damaged.article.outputChars).toBeGreaterThan(damaged.article.chars! * 20);
      expect(
        damaged.metrics.articleRecall.value!,
        "the same paragraph, said again, was paid for again",
      ).toBeLessThan(0.05);
      expect(clean.metrics.articleRecall.value!).toBeGreaterThan(0.9);
      expect(detects(clean, damaged).byMetric).toContain("articleRecall");
      expect(detects(clean, damaged).byMetric).toContain("regionPrecision");
    });

    it("never credits more of the article than the elements it says came back hold", () => {
      /**
       * **The basis line and the metric have to be readable side by side**, and
       * they were not: *"1 of 108 stamped region elements came back"* beside
       * `articleRecall` 0.9881, computed together and never compared. Greg's
       * point, and it is worth more than the specific fix.
       *
       * **This is not the check that catches that bug** — the union is, and it
       * has its own test above. On `pg-greatwork` one source element genuinely
       * holds the whole essay, so *1 of 108, holding 54,900 of 54,900* is not a
       * contradiction; printing the second number is what makes the first
       * readable. What this asks is the structural property underneath: credit
       * never escapes the elements it names, on every fixture.
       */
      for (const fixture of SMALL_FIXTURES) {
        const card = perFixture[fixture]?.shipped;
        if (!card || card.article.chars === null) continue;
        const held = Number(/holding (\d+) of/.exec(card.article.basis)?.[1] ?? "-1");
        expect(held, `${fixture}: the basis line no longer says what it holds`).toBeGreaterThan(0);
        expect(
          card.article.chars!,
          `${fixture}: credited more than the elements it says came back hold`,
        ).toBeLessThanOrEqual(held);
      }
    });

    it("sees the GENERATED nodes reversed, which every text measure calls unharmed", () => {
      /**
       * **Found here rather than by review, 2026-09-06, and it is the complement
       * of the repetition above.** The order rules judged only *directly* stamped
       * nodes, so on a page where Readability builds most of the output there was
       * almost nothing left for them to look at. Reversing 188 generated nodes on
       * `pg-greatwork` gave `articleRecall` **0.9237 — identical to the shipped
       * card** — both gates green, every assertion held and `detects` nothing,
       * while the reader held the essay with its paragraphs backwards.
       *
       * Every character genuine, every character returned exactly once: there is
       * no measure of *how much* text came back that can see this, which is what
       * the gates are for.
       */
      const { raw, url, manifest, prepared } = fixtureBytes("pg-greatwork");
      const ctx = { manifest, url };
      const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
      const arm = armNamed("reverse-generated-nodes");
      expect(arm.precondition(raw, shipped, ctx), "no run of generated nodes to reverse").toBe(true);
      const cardOf = (c: Candidate, name: string) =>
        score({
          fixture: "pg-greatwork", arm: name, html: c.html, stampedHtml: c.stampedHtml,
          refused: c.refused, title: c.title, byline: c.byline, sourceHtml: prepared, manifest,
        });
      const clean = cardOf(shipped, SHIPPED_ARM);
      const damaged = cardOf(arm.run(raw, url, ctx), arm.name);
      /* Nothing was added and nothing was taken away — which is why no metric
         moves, and why asserting on the gate is the whole point. */
      expect(damaged.metrics.articleRecall.value).toBe(clean.metrics.articleRecall.value);
      expect(clean.gates.sourceOrder.passed, "the shipped card must start green").toBe(true);
      expect(damaged.gates.sourceOrder.passed, "the essay was reversed and nothing saw it").toBe(
        false,
      );
      expect(damaged.gates.sourceOrder.detail).toContain("a reordering");
      expect(detects(clean, damaged).byGate).toContain("sourceOrder");
      /**
       * **The arm moves nodes; it does not add or remove any**, so both cards
       * judge exactly the same number. Asserting that is what makes "the gate
       * caught it" mean "it caught the reordering" rather than "it noticed the
       * document changed size".
       *
       * The first version of this line said the damaged card judged more than
       * twice what the clean one did — 324 against 108 — which is the count
       * before and after *the rule*, not before and after *the arm*. It failed
       * with `expected 324 to be greater than 648`, which is the right answer to
       * the wrong question.
       */
      expect(damaged.gates.sourceOrder.exercised).toBe(clean.gates.sourceOrder.exercised);
    });

    it("keeps a correct page green through the same rule, footnote markers and all", () => {
      /**
       * **The rule has to tell a reordering from a repeat**, and `pg-greatwork` is
       * the page that proves it: a correct extraction emits **28 generated nodes
       * whose own text is `"["`**, all matching the same character of their
       * ancestor. A strict forward walk would fail a correct page 28 times, which
       * is the false red this file has been burned by before.
       */
      const card = perFixture["pg-greatwork"]?.shipped;
      expect(card, "pg-greatwork is not in SMALL_FIXTURES any more").toBeDefined();
      expect(card!.gates.sourceOrder.passed).toBe(true);
      expect(card!.gates.attribution.passed).toBe(true);
      expect(
        card!.gates.sourceOrder.exercised,
        "the generated nodes are not being judged at all",
      ).toBeGreaterThan(100);
    });

    it("measures the region the same way twice — the denominator is not smaller than the region", () => {
      /**
       * **Two readings of the same subtree, and they are not the same by
       * construction.** `regionTextById` keeps only elements that carry a stamp,
       * and its total is `articleRecall`'s denominator; `regionVisibleText` keeps
       * every character. If the preparation ever left a region element unstamped
       * the denominator would be smaller than the region, and every recall on the
       * corpus would be quietly optimistic by that much — nothing else would say
       * so, because both numbers look reasonable on their own.
       *
       * Measured 2026-09-05: they agree to the character on all thirteen
       * region-bearing fixtures. It is free here, because the enclosing block has
       * already prepared these pages.
       */
      const apart: string[] = [];
      for (const fixture of SMALL_FIXTURES) {
        const prepared = perFixture[fixture]?.prepared;
        const region = fixtureBytes(fixture).manifest.articleRegion;
        if (!prepared || !region) continue;
        const byStamp = [...regionTextById(prepared, region).values()].reduce(
          (n, t) => n + t.length,
          0,
        );
        const visible = regionVisibleText(prepared, region).length;
        if (byStamp !== visible) apart.push(`${fixture}: ${byStamp} by stamp, ${visible} visible`);
      }
      expect(
        apart,
        "the region has text no stamped element owns, so articleRecall's denominator is too small",
      ).toEqual([]);
    });

    it("sees ADDITION without deletion, which articleRecall cannot by construction", () => {
      /**
       * **`region-padding-only`, and `regionPrecision`'s own two-sided witness.**
       *
       * The arm keeps the whole article and inserts the page's own off-article
       * prose in source order, so every needle is present, every floor holds,
       * both gates pass, and `articleRecall` does not move — it is a *recall*
       * measure, and `raw-body` scores 1.00 on it on every fixture. On `aaronson`
       * that was the complete post plus 595 genuine stamped comment paragraphs,
       * 231,371 characters against a correct 32,820, and `detects` found nothing.
       *
       * `plos-biology` is the smallest page that can run it: the journal's aside,
       * subject-area rail and related-article furniture sit outside `div#artText`
       * and the extraction does not already carry them.
       */
      const { raw, url, manifest, prepared } = fixtureBytes("plos-biology");
      const ctx = { manifest, url };
      const shipped = armNamed(SHIPPED_ARM).run(raw, url, ctx);
      const arm = armNamed("region-padding-only");
      expect(arm.precondition(raw, shipped, ctx), "nothing off the article to pad with").toBe(true);
      const cardOf = (c: Candidate, name: string) =>
        score({
          fixture: "plos-biology", arm: name, html: c.html, stampedHtml: c.stampedHtml,
          refused: c.refused, title: c.title, byline: c.byline, sourceHtml: prepared, manifest,
        });
      const clean = cardOf(shipped, SHIPPED_ARM);
      const padded = cardOf(arm.run(raw, url, ctx), arm.name);
      /* Nothing was taken away, and the test says so rather than assuming it. */
      expect(padded.article.chars, "the arm deleted article text, so this proves nothing").toBe(
        clean.article.chars,
      );
      expect(padded.metrics.articleRecall.value).toBe(clean.metrics.articleRecall.value);
      expect(padded.article.outputChars).toBeGreaterThan(clean.article.outputChars * 1.05);
      /* Down when the padding arrives, and back up when it goes: the same numbers
         read both ways, which is polarity rather than sensitivity. */
      expect(padded.metrics.regionPrecision.value!).toBeLessThan(
        clean.metrics.regionPrecision.value!,
      );
      const d = detects(clean, padded);
      expect(d.byMetric, "padding was noticed by something other than precision").toEqual([
        "regionPrecision",
      ]);
      expect(
        detects(clean, padded, ["regionPrecision"]).byMetric,
        "without regionPrecision the padding is invisible, which is the finding",
      ).toEqual([]);
    });
  });

  describe("text a generated wrapper owns — GPT Sol's seventh review", () => {
    /**
     * **`sourceRefOf` calls a generated wrapper containing a stamped child a
     * `descendant`**, and until 2026-09-06 such a node's own text counted for
     * attribution and was left out of the order entirely. It is not a synthetic
     * gap: the shipped corpus holds **31 descendant own-text carriers, 4,747
     * characters over six fixtures**, 14 of them and 4,162 characters on
     * `pg-greatwork` — so the "zero false reds" that justified the rule before
     * this one was measured over a set that excluded exactly these runs.
     */
    const SREF = RESERVED_ATTRS.sourceRef;
    const card = (sourceHtml: string, out: string, arm: string) =>
      score({
        fixture: "synthetic-descendant", arm,
        html: out.replace(new RegExp(` ${SREF}="[^"]*"`, "g"), ""),
        stampedHtml: out, refused: false, title: null, byline: null,
        sourceHtml: `<body>${sourceHtml}</body>`, manifest: null,
      });

    it("catches loose wrapper text moved in front of its sibling", () => {
      /**
       * **Sol's first example.** The generated `<p>` resolves `descendant`, so
       * its loose text never entered the coordinate and the clean and reordered
       * cards were *identical*: attribution passed at exposure 3, order passed
       * at exposure 2, every assertion held, `detects` empty.
       */
      const src =
        `<div ${SREF}="s1"><i ${SREF}="s2">child first</i>loose text second</div>` +
        `<p ${SREF}="s3">omega omega omega</p>`;
      const moved =
        `<p>loose text second<i ${SREF}="s2">child first</i></p>` +
        `<p ${SREF}="s3">omega omega omega</p>`;
      const clean = card(src, src, "as-source");
      const bad = card(src, moved, "loose-text-first");
      expect(clean.gates.sourceOrder.passed, "the correct order must start green").toBe(true);
      expect(bad.gates.sourceOrder.passed, "the wrapper's loose text was moved and nothing saw it")
        .toBe(false);
      expect(bad.gates.sourceOrder.detail).toContain("a reordering");
      expect(detects(clean, bad).byGate).toEqual(["sourceOrder"]);
    });

    it("catches a FLATTENED subtree moved, whose run no single element owns", () => {
      /**
       * **GPT Sol's eighth review, and it was a fail-open.** A node Readability
       * builds by flattening a subtree carries the ancestor's own text *and* its
       * children's, so no element owns that combination: the run could not be
       * placed against the ancestor's own text, `placeRun` returned neither a
       * span nor `behind`, and the caller dropped it in silence on the
       * assumption attribution had rejected it. Attribution judges a generated
       * node against the **whole page**, so it had passed it.
       *
       * `<div s1>A <i s2>X</i> B</div>` flattened to `<div s1><p>A X B</p></div>`:
       * the `<p>` resolves to ancestor `s1` whose own text is only `AB`, the
       * `AXB` run vanished from the alignment, and moving the whole `<div>` after
       * a later paragraph produced a card **identical** to the correct one —
       * every metric the same, attribution green at exposure 3, order green at
       * exposure 2, `assertionsPassed` true.
       *
       * The retry is the ancestor's subtree, which is where a flattened node's
       * text provably came from and is strictly tighter than the page.
       */
      const src =
        `<div ${SREF}="s1">Alpha alpha <i ${SREF}="s2">Xray xray</i> Bravo bravo</div>` +
        `<p ${SREF}="s3">Tail tail tail</p><p ${SREF}="s4">Zulu zulu zulu</p>`;
      const flattened =
        `<div ${SREF}="s1"><p>Alpha alpha Xray xray Bravo bravo</p></div>` +
        `<p ${SREF}="s3">Tail tail tail</p><p ${SREF}="s4">Zulu zulu zulu</p>`;
      const moved =
        `<p ${SREF}="s3">Tail tail tail</p>` +
        `<div ${SREF}="s1"><p>Alpha alpha Xray xray Bravo bravo</p></div>` +
        `<p ${SREF}="s4">Zulu zulu zulu</p>`;

      const clean = card(src, flattened, "flattened");
      expect(clean.gates.attribution.passed, "flattening invents nothing").toBe(true);
      expect(clean.gates.sourceOrder.passed, "a correct flattening must stay green").toBe(true);
      /* And the flattened run is IN the alignment — the silent skip is what the
         old code did, and a green that skipped it looks the same from outside. */
      expect(clean.gates.sourceOrder.exercised, "the flattened run was not judged").toBe(3);

      const bad = card(src, moved, "flattened-and-moved");
      expect(bad.gates.attribution.passed, "nothing was invented, only moved").toBe(true);
      expect(bad.gates.sourceOrder.passed, "the flattened subtree was moved and nothing saw it")
        .toBe(false);
      expect(bad.gates.sourceOrder.detail).toContain("a reordering");
      expect(detects(clean, bad).byGate).toEqual(["sourceOrder"]);
    });

    it("allows a reader-identical restructuring that repeats a phrase", () => {
      /**
       * **Sol's second example, and the one that makes this an alignment rather
       * than a coordinate.** Both read `Alpha… Xray… Bravo… Yankee… Alpha… Zulu`.
       * With the wrapper's `Alpha`/`Bravo` runs skipped, the final direct `Alpha`
       * resolved greedily to the **first** identical `Alpha`, behind the
       * already-consumed `Yankee`, and the gate failed a correct page: character
       * 0 reported after character 91.
       *
       * A monotone alignment lets a retained second occurrence map to the second
       * occurrence, which is the whole point of asking the question globally.
       */
      const src =
        `<div ${SREF}="s1">Alpha alpha alpha<i ${SREF}="s2">Xray xray xray</i>` +
        `Bravo bravo bravo<span ${SREF}="s3">Yankee yankee yankee</span>` +
        `Alpha alpha alpha<em ${SREF}="s4">Zulu zulu zulu</em></div>`;
      const wrapped =
        `<div ${SREF}="s1"><p>Alpha alpha alpha<i ${SREF}="s2">Xray xray xray</i>` +
        `Bravo bravo bravo</p><span ${SREF}="s3">Yankee yankee yankee</span>` +
        `Alpha alpha alpha<em ${SREF}="s4">Zulu zulu zulu</em></div>`;
      const clean = card(src, src, "as-source");
      const restructured = card(src, wrapped, "wrapped-in-a-generated-p");
      expect(clean.gates.sourceOrder.passed).toBe(true);
      expect(
        restructured.gates.sourceOrder.passed,
        "a restructuring that reads identically was called a reordering",
      ).toBe(true);
      expect(detects(clean, restructured).byGate, "the restructuring cost something").toEqual([]);
    });

    it("keeps `See note <a>1</a> above.` green, and catches the link moved to the front", () => {
      /**
       * **The worked case that cost 33 false reds when it was got wrong**, kept
       * as a focused test at GPT Sol's request rather than being caught only
       * indirectly by `pg-greatwork` staying green.
       *
       * The `<p>`'s own text is two runs with the link's text between them. An
       * order rule that treats the `<p>` as one position — wherever it puts it —
       * either jumps the cursor past the link before the link is reached, or
       * misses the link being moved. Both directions are asserted, because a rule
       * that only ever sees the green one has not been shown to work.
       */
      /* A second paragraph, so that an output which drops the link still has two
         runs and the gate can PASS rather than abstain — `sourceOrder` reports
         `null` below two, and an abstention is not a green. */
      const tail = `<p ${SREF}="s3">And a second paragraph after it.</p>`;
      const src =
        `<p ${SREF}="s1">See note <a ${SREF}="s2">1</a> above and below the line.</p>${tail}`;
      const moved =
        `<p ${SREF}="s1"><a ${SREF}="s2">1</a>See note  above and below the line.</p>${tail}`;
      const clean = card(src, src, "as-source");
      expect(clean.gates.sourceOrder.passed, "the link between two runs must stay green").toBe(true);
      expect(clean.gates.attribution.passed).toBe(true);
      const bad = card(src, moved, "link-to-the-front");
      expect(bad.gates.sourceOrder.passed, "the link was moved to the front and nothing saw it")
        .toBe(false);
      expect(bad.gates.sourceOrder.detail).toContain("out of order");

      /**
       * **And the link REMOVED, which joins the two runs into one — a correct
       * extraction, and the case that makes straddling load-bearing.**
       *
       * Without it the two directions above both pass under a rule that requires
       * a run to fit inside a single piece of its element's own text: the moved
       * link is still caught by the fallback, so the test goes green while the
       * rule condemns every legitimate inline removal on the corpus. Found by
       * breaking the straddle and watching this file stay green.
       */
      const removed = `<p ${SREF}="s1">See note  above and below the line.</p>${tail}`;
      const dropped = card(src, removed, "link-removed");
      expect(
        dropped.gates.sourceOrder.passed,
        "removing an inline child joins its neighbours' text, and that is not a reordering",
      ).toBe(true);
      expect(dropped.gates.attribution.passed).toBe(true);
    });
  });

  describe("mixed content, and a container hoisted — GPT Sol's sixth review", () => {
    /**
     * **Two hand-built pages, one that must go red and one that must stay green**,
     * and between them they are why the order gate walks text runs rather than
     * elements. `scorecard.mts` § `provenanceForm` carries the coordinate table.
     */
    const SREF = RESERVED_ATTRS.sourceRef;
    const card = (sourceHtml: string, out: string, arm: string) =>
      score({
        fixture: "synthetic-mixed", arm,
        html: out.replace(new RegExp(` ${SREF}="[^"]*"`, "g"), ""),
        stampedHtml: out, refused: false, title: null, byline: null,
        sourceHtml: `<body>${sourceHtml}</body>`, manifest: null,
      });

    /* Sol's first example: a container whose own text sits AFTER its child. */
    const mixedSource =
      `<div ${SREF}="s2"><p ${SREF}="s3">Alpha first.</p>Middle second.</div>` +
      `<p ${SREF}="s4">Omega third.</p>`;
    const mixedReversed =
      `<div ${SREF}="s2">Middle second.<p ${SREF}="s3">Alpha first.</p></div>` +
      `<p ${SREF}="s4">Omega third.</p>`;

    /* Sol's second example: the first child hoisted out of its wrapper, the
       wrapper left around the second. The reader sees Alpha then Beta either
       way, so this must stay green. */
    const hoistSource =
      `<div ${SREF}="s2"><p ${SREF}="s3">Alpha.</p><p ${SREF}="s4">Beta.</p></div>`;
    const hoisted =
      `<p ${SREF}="s3">Alpha.</p><div ${SREF}="s2"><p ${SREF}="s4">Beta.</p></div>`;

    it("catches a container's own text moved in front of its child", () => {
      /**
       * **GPT Sol's sixth review, blocker 1.** `ownTextOf` concatenates an
       * element's direct text nodes and throws away where they sit among its
       * children, so moving the container's own text before its child changed
       * the article from *"Alpha, Middle, Omega"* to *"Middle, Alpha, Omega"*
       * while every metric read **1.00**, both gates passed over four nodes,
       * every assertion held and `detects` found nothing. The stamps were
       * unchanged and `ownTextOf(s2)` was unchanged; the position was not in the
       * representation at all.
       */
      const clean = card(mixedSource, mixedSource, "forward");
      expect(clean.gates.sourceOrder.passed, "the correct order must start green").toBe(true);
      expect(clean.gates.attribution.passed).toBe(true);

      const moved = card(mixedSource, mixedReversed, "own-text-before-child");
      expect(moved.gates.attribution.passed, "nothing was invented, only moved").toBe(true);
      expect(
        moved.gates.sourceOrder.passed,
        "the container's text was moved in front of its child and nothing saw it",
      ).toBe(false);
      expect(moved.gates.sourceOrder.detail).toContain("a reordering");
      expect(detects(clean, moved).byGate).toEqual(["sourceOrder"]);
    });

    it("allows a first child hoisted out of its wrapper, which reads the same", () => {
      /**
       * **GPT Sol's sixth review, blocker 2.** The rule this replaced compared
       * the stamps of containers, so hoisting `s3` out while leaving `s2` around
       * `s4` reported *"source element s2 arrives after s3 — a reordering"* on a
       * transform that changes nothing a reader sees. Sol could not induce it
       * from stock Readability over fifteen crafted structural families, but it
       * is a legitimate provenance-preserving transform and **stage C is exactly
       * where such restructuring gets introduced** — a hard gate used to accept
       * stage C must not outlaw it by accident.
       *
       * Under a text-run coordinate the wrapper contributes no run of its own, so
       * it is not in the order at all.
       */
      const clean = card(hoistSource, hoistSource, "as-source");
      const hoist = card(hoistSource, hoisted, "hoisted-first-child");
      expect(clean.gates.sourceOrder.passed).toBe(true);
      expect(
        hoist.gates.sourceOrder.passed,
        "a hoist that changes nothing a reader sees was called a reordering",
      ).toBe(true);
      expect(hoist.gates.attribution.passed).toBe(true);
      expect(detects(clean, hoist).byGate, "the hoist cost something").toEqual([]);
    });
  });

  describe("sections reversed across source ids, on a page built for it", () => {
    /**
     * **GPT Sol's fifth review, finding 1, and it is synthetic on purpose.**
     *
     * He built twelve stamped sections of about 1,600 characters and emitted them
     * in reverse as generated `<p>` children of their original stamped wrappers.
     * The wrappers **carry no own text**, so the order rule skipped them; the
     * per-ancestor rule of the fourth round saw each section's paragraphs in their
     * own correct internal order and passed. The result: **19,410 of 19,410
     * characters credited**, `requiredRecall`, `articleRecall`, `regionPrecision`
     * and `structureFidelity` all **1.00**, both gates green over 12 nodes, every
     * assertion passing — with the whole article backwards.
     *
     * **Why a synthetic page rather than an arm.** The shape needs several
     * stamped wrappers that hold no own text and whose paragraphs Readability
     * generated. `pg-greatwork`, the corpus's only generated-node-heavy fixture,
     * puts its whole essay under ONE such wrapper, so reversing wrappers there
     * reverses nothing. No committed fixture gives a clean cross-id transform, so
     * the shape is built here — and this comment is the "and say so" that goes
     * with that.
     *
     * The `reverse-generated-nodes` arm covers the same failure *within* one
     * ancestor on a real page. This covers it *between* ancestors.
     */
    const SREF = RESERVED_ATTRS.sourceRef;
    const WORDS = [
      "the", "drainage", "committee", "met", "again", "on", "a", "Tuesday", "in", "the", "rain",
      "and", "nobody", "from", "the", "village", "came", "except", "the", "secretary", "who",
      "counted", "the", "empty", "chairs", "twice", "because", "he", "did", "not", "believe",
    ];
    const para = (section: number, n: number): string =>
      `Section ${section} paragraph ${n}. ` +
      Array.from({ length: 26 }, (_, i) => WORDS[(section * 7 + n * 3 + i) % WORDS.length]).join(
        " ",
      ) +
      ".";
    const SECTIONS = 12;
    const PARAS = 4;
    const sections: { wrapper: string; paras: string[] }[] = [];
    const sourceParts: string[] = [];
    let stamp = 1;
    for (let sec = 0; sec < SECTIONS; sec++) {
      const wrapper = `s${stamp++}`;
      const paras = Array.from({ length: PARAS }, (_, n) => para(sec, n));
      stamp += PARAS;
      sections.push({ wrapper, paras });
      /* The section's text sits directly in the wrapper, the way paulgraham.com's
         essay sits in one `<span>`, so the paragraphs are Readability's to build. */
      sourceParts.push(`<div ${SREF}="${wrapper}">${paras.join(" ")}</div>`);
    }
    const sourceHtml = `<article ${SREF}="s0">${sourceParts.join("")}</article>`;
    const sectionHtml = (i: number): string =>
      `<div ${SREF}="${sections[i]!.wrapper}">` +
      sections[i]!.paras.map((t) => `<p>${t}</p>`).join("") +
      "</div>";
    const forward = Array.from({ length: SECTIONS }, (_, i) => sectionHtml(i)).join("");
    const reversed = Array.from({ length: SECTIONS }, (_, i) =>
      sectionHtml(SECTIONS - 1 - i),
    ).join("");

    const manifest = parseManifest(
      {
        fixture: "synthetic-sections",
        file: "synthetic.html",
        note: "twelve stamped sections whose wrappers hold no own text — built for GPT Sol's fifth-review reproduction and for nothing else",
        mustContain: [
          { text: "Section 0 paragraph 0.", why: "the first thing the piece says" },
          { text: "Section 11 paragraph 3.", why: "the last thing the piece says" },
        ],
        mustNotContain: [],
        articleRegion: {
          within: ["article"],
          why: "the whole synthetic article is the piece, and there is nothing else on this page at all — it exists to hold twelve stamped sections and no chrome",
        },
        minArticleChars: 1000,
      },
      "synthetic-sections",
    );
    const cardOf = (html: string, arm: string) =>
      score({
        fixture: "synthetic-sections", arm,
        html: html.replace(new RegExp(` ${SREF}="[^"]*"`, "g"), ""),
        stampedHtml: html, refused: false, title: null, byline: null, sourceHtml, manifest,
      });
    const clean = cardOf(forward, "forward");
    const backwards = cardOf(reversed, "reversed");

    it("starts from a forward card that passes everything", () => {
      /* Or the reversal below is "already broken" rather than "caught". */
      expect(clean.assertionsPassed).toBe(true);
      expect(clean.gates.attribution.passed).toBe(true);
      expect(clean.gates.sourceOrder.passed).toBe(true);
      expect(clean.metrics.articleRecall.value).toBe(1);
      expect(clean.metrics.regionPrecision.value).toBe(1);
    });

    it("catches the sections reversed, on the ORDER GATE and on nothing else", () => {
      /* Nothing was added, removed or rewritten, so every metric is identical —
         which is the whole point, and why asserting that is part of the test. */
      expect(backwards.metrics.articleRecall.value).toBe(clean.metrics.articleRecall.value);
      expect(backwards.metrics.regionPrecision.value).toBe(clean.metrics.regionPrecision.value);
      expect(backwards.metrics.requiredRecall.value).toBe(clean.metrics.requiredRecall.value);
      expect(backwards.gates.attribution.passed, "nothing was invented, only moved").toBe(true);
      expect(backwards.gates.sourceOrder.passed, "the article was reversed and nothing saw it").toBe(
        false,
      );
      expect(backwards.gates.sourceOrder.detail).toContain("a reordering");
      expect(detects(clean, backwards).byGate).toEqual(["sourceOrder"]);
      expect(detects(clean, backwards).byMetric).toEqual([]);
    });

    it("judges every text run on the page, not only the ones in stamped leaves", () => {
      /**
       * **The count is the change, and the first version of this assertion did
       * not prove its own name.** It asked for `>= 12`, and the page already
       * contributes 48 generated-node observations, so it passed without the
       * wrappers being counted at all. GPT Sol, 2026-09-06.
       *
       * The order gate walks text runs now, so the number is exact and can be
       * asserted as one: twelve wrappers' own text is not in the output at all,
       * and what the walk meets is the 48 generated paragraphs. Asserting the
       * total to the digit is what makes it a count rather than a floor.
       */
      /* 48: the twelve wrappers hold no own text, so what the walk meets is the
         48 generated paragraphs. GPT Sol checked the arithmetic — and noted that
         this page contains no `descendant` own-text carrier at all, so it could
         not have exposed the omission his seventh review found. That is what the
         two `descendant` tests above are for. */
      expect(clean.gates.sourceOrder.exercised).toBe(SECTIONS * PARAS);
    });
  });

  describe("the floor on how much of an output is the article", () => {
    /**
     * **`regionPrecision` was a metric and nothing else**, so `detects` saw every
     * padded arm and `assertionsPassed` saw none of them: a ten-times-padded
     * output satisfied every declared assertion. Greg, 2026-09-05.
     *
     * One corpus-wide constant rather than fifteen per-manifest floors, and the
     * reason is the failure mode rather than the arithmetic: a per-page floor can
     * be tuned until that page passes, and a single number cannot.
     * `scorecard.mts` § `MIN_REGION_PRECISION` carries the derivation.
     *
     * **Everything expensive is computed once, here.** The first version of these
     * two tests did its work inside the `it` bodies — six `readArticleWithProvenance`
     * runs in one and a 483 KB page plus 595 DOM insertions in the other — and
     * both **timed out at 30,000 ms under a full `npm test`** while passing
     * comfortably when the file was run alone. That is the same class this file
     * fixed once already by hoisting; a test that is green alone and red in the
     * suite is a test nobody can read.
     */
    const FLIP = "arxiv-abs";
    const { raw, url, manifest, prepared } = fixtureBytes(FLIP);
    const ctx = { manifest, url };
    const shippedArm = armNamed(SHIPPED_ARM).run(raw, url, ctx);
    const padder = armNamed("raw-body");
    /**
     * **The flip has to be watched on a card that was passing**, and no fixture
     * whose shipped extraction passes has enough material off the article to
     * bury it in — `python-docs-itertools` has 1,295 characters outside its
     * region against 29,949 inside, and `pg-greatwork` has none at all. That is
     * a fact about the corpus, not a gap in the check.
     *
     * So the demonstration lifts the fixture's `mustNotContain` — on `arxiv-abs`
     * that is the *"View PDF | HTML (experimental)"* furniture the extraction
     * really does keep, and it is the only thing between this card and a pass.
     * With it lifted the shipped card passes, `raw-body` returns the whole page,
     * and the floor is the one thing that changes.
     *
     * `aaronson` with `region-padding-only` shows the same flip on the page the
     * finding came from — 26,431 of 285,139 own-text characters, 9.3% — and it
     * costs 4.8 seconds and a 483 KB parse against 399 ms here. The run exercises
     * that pair on every invocation; this file takes the cheap one.
     */
    const { maxBlockChars: _lifted, ...withoutBlockCap } = manifest;
    const lifted: AssertionManifest = { ...withoutBlockCap, mustNotContain: [] };
    const cardOf = (c: Candidate, name: string, m: AssertionManifest) =>
      score({
        fixture: FLIP, arm: name, html: c.html, stampedHtml: c.stampedHtml,
        refused: c.refused, title: c.title, byline: c.byline, sourceHtml: prepared, manifest: m,
      });
    const beforePad = cardOf(shippedArm, SHIPPED_ARM, lifted);
    const afterPad = cardOf(padder.run(raw, url, ctx), padder.name, lifted);
    const addedByPadding = afterPad.failures.filter((f) => !beforePad.failures.includes(f));
    const unstamped = score({
      fixture: FLIP, arm: "no-provenance", html: shippedArm.html, refused: false,
      title: shippedArm.title, byline: shippedArm.byline, sourceHtml: prepared, manifest: lifted,
    });
    /* The margins come from the cards the enclosing describe already built. */
    const margins: Record<string, string> = {};
    const belowFloor: string[] = [];
    for (const fixture of SMALL_FIXTURES) {
      const card = perFixture[fixture]?.shipped;
      if (!card) continue;
      const p = card.metrics.regionPrecision.value;
      margins[fixture] = p === null ? "—" : `${p.toFixed(4)} (+${(p - MIN_REGION_PRECISION).toFixed(4)})`;
      if (card.failures.some((f) => f.includes("of the output is the declared article region"))) {
        belowFloor.push(fixture);
      }
    }

    it("passes on every correct extraction, and says by how much", () => {
      // eslint-disable-next-line no-console
      console.log("regionPrecision margins:", JSON.stringify(margins, null, 2));
      for (const fixture of SMALL_FIXTURES) {
        expect(margins[fixture], `${fixture}: regionPrecision did not resolve`).not.toBe("—");
      }
      expect(belowFloor, "a shipped extraction fails the corpus precision floor").toEqual([]);
    });

    it("turns a PASSING card into a failing one when the output is padded", () => {
      expect(
        beforePad.assertionsPassed,
        "the card was already failing, so a flip proves nothing",
      ).toBe(true);
      expect(afterPad.assertionsPassed, "the padded output still satisfied every assertion").toBe(
        false,
      );
      /* **And the floor is what flipped it**, not something else that came along
         with the padding. The set difference is the assertion; a bare
         `assertionsPassed === false` would pass even if the padding had broken a
         structure floor instead. */
      expect(
        addedByPadding.length,
        `the padding added ${addedByPadding.length} failures: ${addedByPadding.join(" | ")}`,
      ).toBe(1);
      expect(addedByPadding[0]).toContain("of the output is the declared article region");
      expect(addedByPadding[0]).toContain("under the corpus floor of 50%");
      // eslint-disable-next-line no-console
      console.log("the padded card fails with:", addedByPadding[0]);
    });

    it("records the un-checkable case as a failure rather than a silence", () => {
      /* A candidate with no stamps cannot be shown to be mostly the article, and
         cannot be shown not to be. An assertion that could not be checked is not
         an assertion that held — the same rule `minArticleChars` follows. */
      expect(unstamped.metrics.regionPrecision.value).toBeNull();
      expect(unstamped.failures.join(" ")).toContain("minRegionPrecision 0.5 COULD NOT BE CHECKED");
      expect(unstamped.assertionsPassed).toBe(false);
    });
  });

  it("leaves the shipped arm passing the negative controls", () => {
    /* Otherwise the test above proves nothing: a page every arm fails cannot
       tell one arm from another. */
    const { raw, url, manifest, prepared } = fixtureBytes("negative-controls");
    const shipped = armNamed(SHIPPED_ARM).run(raw, url, { manifest, url });
    const card = score({
      fixture: "negative-controls", arm: SHIPPED_ARM, html: shipped.html,
      stampedHtml: shipped.stampedHtml, refused: shipped.refused,
      title: shipped.title, byline: shipped.byline, sourceHtml: prepared, manifest,
    });
    expect(card.failures).toEqual([]);
    expect(card.assertionsPassed).toBe(true);
  });
});
