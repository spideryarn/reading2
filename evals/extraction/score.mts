/**
 * **The scorecard over the whole corpus** — every fixture that has a manifest,
 * every arm, no model, no money, no network.
 *
 *   npx tsx evals/extraction/score.mts
 *   npx tsx evals/extraction/score.mts --fixture negative-controls
 *   npx tsx evals/extraction/score.mts --record        # store what it found
 *   npx tsx evals/extraction/score.mts --json evals/results/extraction-score.json
 *
 * ## What this run is, and is not
 *
 * It is a **run**, not a test. `tests/extraction-scorer.test.ts` holds the part
 * that must be true on every change — the polarity pair, the exposure counts,
 * mutation testing and the degenerate arms — and takes seconds. This walks
 * **every fixture that has a manifest** — fifteen of the thirty-five on
 * 2026-09-05 — through **thirteen** arms: the shipped one and twelve degenerate.
 * It takes a few minutes, and its output is a
 * table to read. A fixture with no manifest is skipped in silence, because there
 * is nothing it could be scored against.
 *
 * ## Four sections, and the second is not what it looks like
 *
 * 1. **The scorecard.** Per fixture and arm: the metrics with their exposure
 *    counts, the two gates, the binary per-fixture assertion verdict, how many
 *    characters of article came back, and which metrics fell against the shipped
 *    arm. A metric with nothing declared prints `—`, never a score. **There is no
 *    per-arm verdict word**, and there used to be: see `findingFor`.
 * 2. **Scorer conformance.** The [corruption bank](corruptions.mts) — damage
 *    made by a local transform, so a model shown it can learn to reverse it
 *    perfectly and be useless on a real failure. **These numbers say whether the
 *    scorer can see a thing that is definitely wrong. They are never extraction
 *    quality**, and the run says so on the line above them.
 * 3. **The polarity pair, per fixture.** Two mutations of that page: a thousand
 *    characters of its own body taken away and put back, and the page's own
 *    navigation glued into the article. The card has to move up on the first and
 *    down on the second. Where the second cannot move — because the manifest
 *    names none of the furniture the arm adds — the row reads
 *    **`POLARITY NOT ESTABLISHED`** rather than passing quietly, because a page
 *    on which the card cannot be shown to fall is a page whose numbers say
 *    nothing about furniture.
 * 4. **Every degenerate arm has to lose.** § B claimed this over all fifteen
 *    while the only thing enforcing it ran over three, and over the other eleven
 *    it was false. It is enforced here, and **this run exits non-zero** when a
 *    pair loses nothing and is not in `arms.mts` § `HARMLESS_HERE`. It is the
 *    one thing the run gates on: everything else it prints is a finding to read.
 *
 * ## The `article/output` column
 *
 * Two numbers, and the gap between them is the point. The left is characters of
 * the **declared article region** this arm gave back, by source stamp; the right
 * is every gistable character it returned. An arm reading `2129/26271` deleted
 * the article and refilled the space with the page's comment thread, which is
 * exactly what GPT Sol's `region-padded-collage` does. `—` means the region or
 * the provenance was missing and the run declined to guess.
 *
 * @see [scorecard.mts](scorecard.mts) · [manifest.mts](manifest.mts) · [arms.mts](arms.mts)
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { isMain } from "../../src/is-main.js";
import { ARMS, HARMLESS_HERE, SHIPPED_ARM, armNamed, preparedSourceHtml } from "./arms.mjs";
import { SCORABLE_FIXTURES } from "./corpus.mjs";
import {
  CONFORMANCE_CANDIDATE,
  CONFORMANCE_GOLD,
  CONFORMANCE_HTML,
  CONFORMANCE_MANIFEST,
} from "./conformance-page.mjs";
import { CORRUPTIONS, type Candidate } from "./corruptions.mjs";
import { type ArmFinding, loadManifest, recordFindings } from "./manifest.mjs";
import { SHAPE_PAGES, runShapeCorpus } from "./shapes.mjs";
import {
  GATES,
  type MetricName,
  METRICS,
  RUN_PLACEMENTS,
  type RunPlacement,
  type Scorecard,
  bodyRunToRemove,
  detects,
  forbiddenInsideRegion,
  gistableChars,
  regionTextById,
  regionVisibleText,
  polarityPair,
  score,
} from "./scorecard.mjs";

const DIR = path.join("evals", "extraction", "fixtures");

/**
 * **How many fixtures are supposed to carry a manifest**, pinned exactly so the
 * corpus cannot change size by accident in either direction.
 *
 * Without it, deleting a manifest makes the run smaller and quieter and still
 * green — and regenerating the artefact then writes the smaller matrix, so the
 * test that checks the artefact against the corpus agrees with both. Changing
 * this number is how you say a manifest was added or removed on purpose.
 *
 * It was `<` for a day, which GPT Sol correctly called a minimum rather than a
 * pin. `!==` costs nothing and closes the other direction; what neither closes is
 * a manifest *replaced* by another without the count changing, and the artefact's
 * fixture-by-fixture matrix is what catches that.
 */
const MANIFESTS_EXPECTED = 15;

const SHORT: Record<MetricName, string> = {
  requiredRecall: "recall",
  exclusionPrecision: "exclude",
  bodyPurity: "purity",
  articleRecall: "article",
  regionPrecision: "region%",
  structureFidelity: "struct",
  metadataExactness: "meta",
  blockCleanliness: "clean",
};

/** `0.83 (6)` — the value and, always beside it, how much it saw. `—` for nothing. */
function cell(card: Scorecard, m: MetricName): string {
  const metric = card.metrics[m];
  if (metric.value === null) return "     —".padStart(10);
  return `${metric.value.toFixed(2)} (${metric.exercised})`.padStart(10);
}

function gateCell(card: Scorecard): string {
  return (["attribution", "sourceOrder"] as const)
    .map((g) => {
      const r = card.gates[g];
      return r.passed === null ? "—" : r.passed ? "ok" : "FAIL";
    })
    .join("/");
}

/**
 * **What this run may say about an arm — which is less than it used to say.**
 *
 * Until 2026-09-05 this function was `labelFor`, and it turned the card into one
 * of `acceptable` / `damaged` / `improved` and wrote that word into the fixture's
 * manifest. § B called those labels a *blinded* better/same/worse judgement. They
 * were nothing of the kind: they were computed from the same card they were meant
 * to audit. GPT Sol showed what that is worth by building
 * [`needle-collage`](arms.mts) — three strings copied out of `aaronson`, 0.55% of
 * the article — which satisfied every declared assertion and came out
 * **`acceptable`**.
 *
 * So the runner reports what it knows and stops: whether the declared assertions
 * still hold, whether the hard gates passed, which metrics fell against the
 * shipped arm, and how many characters of article came back. Nobody reading those
 * four can mistake them for "this extraction is fine", which is exactly the
 * mistake the word `acceptable` invited.
 *
 * **The floor-masking exception went with it.** It disqualified `improved` when a
 * metric sat at zero in both cards, and by the 2026-09-05 run the case it was
 * written for no longer reproduced — `wiki-gdp-table`'s shipped exclusion is 0.67,
 * not 0.00. Accumulating exceptions to a label that cannot be made sound is worse
 * than not having the label.
 */
function findingFor(base: Scorecard, card: Scorecard, gistable: number): ArmFinding {
  return {
    assertionsHeld: card.assertionsPassed,
    /* **Each gate on its own.** This used to be one boolean called
       `gatesPassed`, computed by dropping the abstentions and asking whether the
       rest passed — so `pmc-article`, whose order gate abstains for want of a
       second stamped node, recorded "both gates passed". GPT Sol, 2026-09-05. */
    gates: Object.fromEntries(GATES.map((g) => [g, card.gates[g].passed])) as ArmFinding["gates"],
    regressions:
      card.arm === SHIPPED_ARM
        ? []
        : (() => {
            const d = detects(base, card);
            return [...d.byMetric, ...d.byGate];
          })(),
    articleChars: card.article.chars,
    gistableChars: gistable,
    articleRecall: card.article.recall,
  };
}

/** A thousand characters of body the polarity pair may take out and put back. */
const POLARITY_CHARS = 1000;

async function main(): Promise<string[]> {
  const argv = process.argv.slice(2);
  const only = argv.includes("--fixture") ? argv[argv.indexOf("--fixture") + 1] : null;
  /**
   * **A run that selects nothing must not report success, and this is the third
   * time that sentence has been written here.**
   *
   * First `--fixture definitely-not-a-fixture` exited **0** announcing *"All 0
   * fixtures move the card in both directions"*, because the argument was never
   * checked. That was fixed by validating against `SCORABLE_FIXTURES` — and
   * **the fix was wrong, and I reported it closed**: most fixtures in that list
   * have no manifest, so `--fixture man-open` passed validation, matched a
   * fixture, found no manifest, was skipped by `continue`, and exited 0
   * announcing the same empty result. GPT Sol found it twice.
   *
   * It is this repository's signature failure arriving inside the instrument
   * built to detect it, which is why it gets three sentences rather than a line.
   * 260830at's marker rule scored 246/246 on a corpus that contained none of the
   * content it would have deleted. 260827ab reported "zero regressions across
   * fourteen pages" for an arm no page could exercise. Both were true sentences
   * about an empty set, and so were both of these. **A check that has been
   * declared closed twice and was not is a check to make structural**: the
   * selectable set is now the manifest-bearing fixtures, computed once, and the
   * run refuses an argument outside it, a missing argument, and any manifest
   * that goes absent under it.
   */
  const selectable = (
    await Promise.all(
      SCORABLE_FIXTURES.map(async (f) => ((await loadManifest(f.name)) ? f.name : null)),
    )
  ).filter((n): n is string => n !== null);
  if (selectable.length !== MANIFESTS_EXPECTED) {
    throw new Error(
      `${selectable.length} manifests loaded, expected exactly ${MANIFESTS_EXPECTED} ` +
        `(${selectable.join(", ")}). A corpus must not change size by accident in either ` +
        "direction: if a manifest was added or removed deliberately, change " +
        "MANIFESTS_EXPECTED in the same commit.",
    );
  }
  if (argv.includes("--fixture") && (only === undefined || only === null || only.startsWith("--"))) {
    throw new Error("--fixture needs a fixture name after it");
  }
  if (only !== undefined && only !== null && !selectable.includes(only)) {
    const known = SCORABLE_FIXTURES.map((f) => f.name);
    throw new Error(
      `--fixture ${JSON.stringify(only)}: ${
        known.includes(only)
          ? "that fixture has no manifest, so there is nothing to score it against"
          : "no such fixture"
      }. A run that selects nothing must not report success. Scorable: ${selectable.join(", ")}`,
    );
  }
  const doRecord = argv.includes("--record");
  const jsonAt = argv.indexOf("--json");

  const rows: Record<string, unknown>[] = [];
  const polarity: { fixture: string; established: boolean; detail: string }[] = [];
  /**
   * **Every (arm, fixture) pair this run exercised on which the arm lost nothing.**
   *
   * Section B claimed *"all seven degenerate arms lose on a named metric or gate
   * on every fixture they are exercised on"* while the only thing enforcing it
   * ran over three fixtures of fourteen — and over the other eleven it was
   * false: `drop-every-short-block` removed 1,072 leaf elements and 1,393
   * gistable characters from `ar5iv-attention` with no metric and no gate
   * moving. GPT Sol, 2026-09-05. So the claim is enforced here as well, over all
   * fifteen, and this run **exits non-zero** when a pair loses nothing and is
   * not in `HARMLESS_HERE`.
   */
  const flat: string[] = [];
  /** Fixtures that declare a manifest and whose bytes are not on disk. */
  const missing: string[] = [];
  /**
   * **Fixtures where the two readings of the article region disagree.**
   *
   * `articleRecall` divides by the region as `regionTextById` records it, which
   * keeps only elements carrying a stamp; `regionVisibleText` keeps every
   * character in the same subtree. An unstamped region element would make the
   * denominator smaller than the region and every recall quietly optimistic.
   * The fast test asks this of six fixtures; this asks it of all of them, which
   * is GPT Sol's fifth-review finding 3.
   */
  const denominator: string[] = [];
  /** Every exercised (arm, fixture) pair, and whether it lost anything. */
  const exercised = new Map<string, boolean>();
  /**
   * **Manifests whose declared region credits text the same manifest forbids.**
   *
   * The general form of GPT Sol's fourth finding, and it is a bug in the ruler
   * rather than in the extraction: `articleRecall` pays for the licence block,
   * `exclusionPrecision` docks for it, and an arm can be rewarded for taking it
   * either way. See `scorecard.mts` § `forbiddenInsideRegion`. Gated with the
   * degenerate-arm claim below, because a corpus that cannot say what the
   * article is cannot say what an arm did to it.
   */
  const selfContradicting: string[] = [];
  /**
   * **Which branch of the order walk the SHIPPED extractions actually take.**
   *
   * Printed because the interesting number is the zero: the `ancestor`-cannot-
   * supply branch fires zero times across all fifteen, so nothing here prices
   * it and the shape corpus is the only thing that does. A branch the run
   * reaches is a branch the run is evidence about; a branch it does not is one
   * where a green card says nothing at all.
   */
  const shippedRuns: Record<RunPlacement, number> = {
    owner: 0, subtreeEarlier: 0, subtreeOnly: 0, page: 0,
    behind: 0, behindSubtree: 0, unplaceable: 0,
  };
  let shippedOwnerless = 0;
  /** Which of them, so the number is a place to look rather than a total. */
  const ownerlessBy: string[] = [];

  console.log(
    "fixture".padEnd(24) + "arm".padEnd(24) +
      METRICS.map((m) => SHORT[m].padStart(10)).join("") +
      "   gates      assertions  article/output",
  );

  for (const entry of SCORABLE_FIXTURES) {
    if (only && entry.name !== only) continue;
    const manifest = await loadManifest(entry.name);
    /* Not `continue` in silence: a fixture in `selectable` whose manifest has
       gone away between the count above and here is the corpus shrinking under
       the run, which is the thing the count exists to refuse. */
    if (!manifest) {
      if (selectable.includes(entry.name)) missing.push(`${entry.name} (manifest vanished mid-run)`);
      continue;
    }
    const file = path.join(DIR, entry.file);
    if (!existsSync(file)) {
      /* A fixture with a manifest and no bytes is a broken corpus, not a fixture
         to step over quietly — the same reason an unknown `--fixture` throws. */
      missing.push(`${entry.name} (${entry.file})`);
      console.log(`${entry.name.padEnd(24)} — FILE MISSING, and that is a failure`);
      continue;
    }
    const raw = await readFile(file, "utf-8");

    const ctx = { manifest, url: entry.url };
    const shipped = armNamed(SHIPPED_ARM).run(raw, entry.url, ctx);
    /* The document the arms are transforms of, not the fetched bytes — see
       `preparedSourceHtml`. */
    const prepared = preparedSourceHtml(raw, entry.url);
    const cardOf = (c: Candidate, arm: string): Scorecard =>
      score({
        fixture: entry.name, arm, html: c.html, title: c.title, byline: c.byline,
        stampedHtml: c.stampedHtml, refused: c.refused, sourceHtml: prepared, manifest,
      });
    const base = cardOf(shipped, SHIPPED_ARM);
    for (const k of RUN_PLACEMENTS) shippedRuns[k] += base.placements.runs[k];
    shippedOwnerless += base.placements.ownerlessStamped;
    if (base.placements.ownerlessStamped > 0) {
      ownerlessBy.push(`${entry.name} ${base.placements.ownerlessStamped}`);
    }
    const findings: Record<string, ArmFinding> = {};
    for (const t of forbiddenInsideRegion(prepared, manifest)) {
      selfContradicting.push(`${entry.name}: ${JSON.stringify(t.slice(0, 60))}`);
    }
    if (manifest.articleRegion) {
      const byStamp = [...regionTextById(prepared, manifest.articleRegion).values()].reduce(
        (n, t) => n + t.length,
        0,
      );
      const visible = regionVisibleText(prepared, manifest.articleRegion).length;
      if (byStamp !== visible) {
        denominator.push(`${entry.name}: ${byStamp} by stamp against ${visible} visible`);
      }
    }

    for (const arm of ARMS) {
      if (arm.name !== SHIPPED_ARM && !arm.precondition(raw, shipped, ctx)) {
        console.log(
          `${entry.name.padEnd(24)}${arm.name.padEnd(24)}` +
            "  NOT EXERCISED — this page gives the arm nothing to act on",
        );
        rows.push({ fixture: entry.name, arm: arm.name, exercised: false });
        continue;
      }
      const out = arm.name === SHIPPED_ARM ? shipped : arm.run(raw, entry.url, ctx);
      const card = arm.name === SHIPPED_ARM ? base : cardOf(out, arm.name);
      const finding = findingFor(base, card, gistableChars(out.html));
      findings[arm.name] = finding;
      card.finding = finding;
      console.log(
        `${entry.name.padEnd(24)}${arm.name.padEnd(24)}` +
          METRICS.map((m) => cell(card, m)).join("") +
          `   ${gateCell(card).padEnd(10)} ` +
          (card.assertionsPassed === null ? "—" : card.assertionsPassed ? "PASS" : "FAIL") +
          `  ${String(finding.articleChars ?? "—").padStart(7)}/${String(finding.gistableChars).padStart(7)}` +
          (finding.regressions.length ? `  worse: ${finding.regressions.join("+")}` : ""),
      );
      if (arm.name === SHIPPED_ARM && card.failures.length) {
        for (const f of card.failures.slice(0, 6)) console.log(`${" ".repeat(26)}· ${f}`);
        if (card.failures.length > 6) {
          console.log(`${" ".repeat(26)}  … and ${card.failures.length - 6} more`);
        }
      }
      rows.push({ ...card, exercised: true });
      /**
       * **The claim is about pages that have an article**, and the two bot-wall
       * fixtures do not.
       *
       * `medium-about` is a 404 shell and `pmc-article` a reCAPTCHA
       * interstitial; each asserts one thing, `notAnArticle`, and the shipped
       * extraction already fails it. There is no article on either page for an
       * arm to damage, and the one metric they exercise —
       * `exclusionPrecision` — is already on its floor for the shipped arm, so
       * nothing can fall from it either. That is seven of the eight flat pairs
       * the first enforcing run found, and writing seven near-identical
       * exemptions into `HARMLESS_HERE` would have made that table meaningless.
       * The claim is narrowed once, here, instead.
       */
      if (arm.name !== SHIPPED_ARM && !manifest.notAnArticle) {
        const pair = `${arm.name} on ${entry.name}`;
        exercised.set(pair, finding.regressions.length > 0);
        if (finding.regressions.length === 0 && !HARMLESS_HERE.has(pair)) flat.push(pair);
      }
    }

    /* -- the polarity pair, on this page's own text ------------------------- */
    const withBody = shipped.html;
    const cut = bodyRunToRemove(withBody, {
      want: manifest.mustContain.map((n) => n.text),
      avoid: manifest.mustNotContain.map((n) => n.text),
      minChars: POLARITY_CHARS,
    });
    const railArm = armNamed("article-plus-rail");
    const withNav = railArm.precondition(raw, shipped, ctx)
      ? railArm.run(raw, entry.url, ctx).html
      : null;
    if (cut === null) {
      polarity.push({
        fixture: entry.name, established: false,
        detail:
          `no run of ${POLARITY_CHARS}+ characters on this page is known body and nothing else ` +
          "— the rising half cannot be run",
      });
    } else if (withNav === null) {
      polarity.push({
        fixture: entry.name, established: false,
        detail: "the page has no nav/header/footer to admit — the falling half cannot be run",
      });
    } else {
      const v = polarityPair(
        { fixture: entry.name, arm: "polarity", html: withBody, sourceHtml: prepared, manifest },
        { withoutBody: cut.html, withBody, withNav },
      );
      polarity.push({
        fixture: entry.name,
        established: v.passed,
        detail: v.passed
          ? `${cut.removedChars} chars of body out and back: ${v.movedOnRestore} metric(s) rose, ` +
            `${v.movedOnNav} fell on the page's own furniture`
          : v.failures.join("; "),
      });
    }

    if (doRecord) await recordFindings(entry.name, findings);
  }

  /* -- scorer conformance, and the sentence that has to travel with it ----- */
  console.log(
    "\n=== SCORER CONFORMANCE — NOT EXTRACTION QUALITY ===\n" +
      "Synthetic damage, made by a local transform on one hand-built page. It says whether the\n" +
      "card can see a thing that is definitely wrong. A model shown damage of this shape can learn\n" +
      "to reverse it perfectly and be useless on a real failure. Never quote these as a score.",
  );
  {
    const cardOf = (c: Candidate): Scorecard =>
      score({
        fixture: "conformance-page", arm: "corruption", html: c.html, title: c.title,
        byline: c.byline, sourceHtml: CONFORMANCE_HTML,
        manifest: CONFORMANCE_MANIFEST, gold: CONFORMANCE_GOLD,
      });
    const cleanCard = cardOf(CONFORMANCE_CANDIDATE);
    for (const c of CORRUPTIONS) {
      const d = detects(cleanCard, cardOf(c.apply(CONFORMANCE_CANDIDATE)));
      const routes = [...d.byMetric, ...d.byGate];
      console.log(
        `  ${c.name.padEnd(28)}${d.detected ? `noticed by ${routes.join(", ")}` : "NOT NOTICED"}`,
      );
      rows.push({ conformance: c.name, noticed: d.detected, routes });
    }
  }

  /* -- polarity, per fixture ---------------------------------------------- */
  console.log("\n=== POLARITY, PER FIXTURE ===");
  for (const p of polarity) {
    console.log(
      `  ${p.fixture.padEnd(24)}${p.established ? "established" : "POLARITY NOT ESTABLISHED"} — ${p.detail}`,
    );
  }
  const unestablished = polarity.filter((p) => !p.established).map((p) => p.fixture);
  console.log(
    unestablished.length
      ? `\n${unestablished.length}/${polarity.length} fixtures CANNOT EXERCISE THE PAIR — some ` +
          "cannot show the card rising, some cannot show it falling, and the reason is on each " +
          `row above. Their numbers are not evidence about the half they cannot move: ${unestablished.join(", ")}`
      : `\nAll ${polarity.length} fixtures move the card in both directions.`,
  );

  /* -- the claim section B makes, enforced over all fifteen ----------------- */
  console.log(
    "\n=== EVERY DEGENERATE ARM HAS TO LOSE, ON EVERY FIXTURE WITH AN ARTICLE IT IS EXERCISED ON ===",
  );
  if (flat.length === 0) {
    console.log(
      `  All exercised pairs lost something, with ${HARMLESS_HERE.size} argued exemption(s): ` +
        `${[...HARMLESS_HERE.keys()].join(", ")}`,
    );
  } else {
    for (const pair of flat) {
      console.log(`  ${pair}: NOTHING — this arm did no damage this card could see`);
    }

    console.log(
      `\n${flat.length} pair(s) scored no worse than the shipped arm. Either the arm is genuinely ` +
        "inert on that page — in which case it goes in HARMLESS_HERE with an argued, checkable " +
        "reason — or that page's manifest is not yet doing its job. Do not widen the table to " +
        "make this quiet.",
    );
  }

  /**
   * **And an exemption has to stay earned.** A pair excused from losing that now
   * loses something, or that this run never exercised at all, is a claim nothing
   * is testing — the same shape as the needle nobody can find on the page.
   */
  /**
   * **Scoped to what this invocation actually selected**, and it was not.
   *
   * The check asked every exemption in the table whether *this run* had
   * exercised it, so `--fixture aaronson` failed over the `arxiv-abs` exemption
   * — a fixture it had been told not to look at. GPT Sol, 2026-09-05. An
   * exemption belonging to a **selected** fixture must still fail when it goes
   * unexercised or stops being harmless, which is the half worth keeping.
   */
  console.log("\n=== NO REGION MAY CREDIT WHAT ITS OWN MANIFEST FORBIDS ===");
  if (selfContradicting.length === 0) {
    console.log("  Every declared region excludes every mustNotContain string it encloses.");
  } else {
    for (const line of selfContradicting) {
      console.log(`  ${line} — this string is INSIDE the credited article region`);
    }
    console.log(
      "\nRemoving it lowers articleRecall and raises exclusionPrecision at once, so the two " +
        "metrics disagree about what the article is. Narrow the region with `except` and " +
        "re-derive the floor; do not delete the needle.",
    );
  }

  /* -- the shape corpus, and the branches this run cannot reach ------------ */
  const shapes = runShapeCorpus();
  const shapeFailures = shapes.filter((v) => !v.ok);
  const holes = shapes.filter((v) => v.case.hole);
  console.log(
    "\n=== THE SHAPE CORPUS, AND THE BRANCHES THE SHIPPED EXTRACTIONS CANNOT REACH ===\n" +
      "Named source shapes and named candidate transformations, each pinning the gate verdicts\n" +
      "AND the branch every node and run took — see evals/extraction/shapes.mts for the matrix.",
  );
  console.log(
    `  ${shapes.length - shapeFailures.length}/${shapes.length} case(s) hold over ` +
      `${SHAPE_PAGES.length} source shape(s); ${holes.length} pin a HOLE rather than a check: ` +
      `${holes.map((v) => v.case.name).join(", ")}`,
  );
  for (const v of shapeFailures) {
    console.log(`  ${v.case.name}: ${v.problems.join("; ")}`);
  }
  /**
   * **The census is a claim about every fixture, so a scoped run may not make
   * it.** `--fixture medium-about` accumulates one page's branches, and printing
   * those under a sentence about the shipped extractions would be a number
   * describing a set the run never looked at — the exact offence this file's
   * `--fixture` validation exists to refuse, committed by the section added to
   * report on it. GPT Sol's first finding, 2026-09-06.
   *
   * **The ownerless branch is not hypothetical on real pages**, and until it was
   * counted it was believed to be. Those runs are placed anywhere on the page,
   * so the order gate is checking their global order and nothing about which
   * container they belong in — see `shapes.mts`
   * § `borrowing-under-a-text-free-wrapper`.
   */
  const scope = only === null ? "Shipped extractions" : `\`${only}\` ALONE — not the corpus —`;
  console.log(
    `  ${scope} place their runs: ${RUN_PLACEMENTS.map((k) => `${k} ${shippedRuns[k]}`).join(", ")}.`,
  );
  console.log(
    `  ${shippedOwnerless} run(s) placed page-wide under a stamp \`owners\` has no entry for` +
      (ownerlessBy.length ? `: ${ownerlessBy.join(", ")}` : " — none"),
  );

  console.log("\n=== THE REGION MEASURES THE SAME WAY TWICE ===");
  if (denominator.length === 0) {
    console.log(
      "  Every declared region's stamped total equals its visible text, so no recall is " +
        "divided by less than the region.",
    );
  } else {
    for (const line of denominator) console.log(`  ${line} — THE DENOMINATOR IS TOO SMALL`);
  }

  const stale = [...HARMLESS_HERE.keys()]
    .filter((pair) => only === null || pair.endsWith(` on ${only}`))
    .filter((pair) => exercised.get(pair) !== false);
  for (const pair of stale) {
    console.log(
      `  ${pair}: STALE EXEMPTION — ${
        exercised.has(pair) ? "this pair now loses something" : "this run did not exercise it"
      }`,
    );
  }
  flat.push(
    ...shapeFailures.map((v) => `shape case failed — ${v.case.name}: ${v.problems.join("; ")}`),
    ...stale,
    ...selfContradicting.map((l) => `region credits forbidden text — ${l}`),
    ...denominator.map((l) => `the region measures two different ways — ${l}`),
    ...missing.map((l) => `fixture file missing — ${l}`),
  );

  if (jsonAt !== -1 && argv[jsonAt + 1]) {
    await writeFile(argv[jsonAt + 1]!, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
    console.log(`\nWritten to ${argv[jsonAt + 1]}`);
  }
  return flat;
}

if (isMain(import.meta.url)) {
  /* **The run is a report, and a gate for exactly one claim.** Everything else
     it prints — the failing manifests, the unestablished polarity halves — is a
     finding to read rather than a failure to fix, and exiting non-zero on those
     would make the run useless as a report. */
  const flatPairs = await main();
  if (flatPairs.length) process.exitCode = 1;
}
