/**
 * **The capability floor, proved as an exposure ladder rather than as a passing
 * test** — Sol P2-C08, adopted by
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § C1a.
 *
 * The rule is one line of arithmetic, and every way it can be wrong is invisible
 * from outside: it can fire on nothing, it can fire in production and not in the
 * harness, it can be "tightened" later by somebody who reads 500 as a guess. So
 * each rung below is a separate assertion, and they are in the order the value
 * travels:
 *
 *   source candidates → accepted matches → what production does →
 *   what `Candidate.refused` becomes → the changed assertion
 *
 * and the counterfactual runs both ways: with the floor's own number the two
 * walls refuse, with the floor disabled the very same call still hands back the
 * article stage 2 used to publish, and a genuinely real 749-character page goes
 * through untouched so that nobody can quietly raise the number to 1,000.
 *
 * **What this file does not test is what the page *is*.** The floor reads no
 * markup and makes no claim about walls, logins or 404s — that is C1, a separate
 * registry. src/extract.ts § `capabilityFloor`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readability } from "@mozilla/readability";
import { describe, expect, it } from "vitest";

import {
  MIN_ARTICLE_CHARS,
  TooLittleTextToRead,
  readArticle,
  readArticleWithProvenance,
  runExtract,
} from "../src/extract.js";
import { pageHadTooLittleText } from "../src/messages.js";
import { SHIPPED_ARM, armNamed, preparedSourceHtml } from "../evals/extraction/arms.mjs";
import { parseManifest } from "../evals/extraction/manifest.mjs";
import { score } from "../evals/extraction/scorecard.mjs";

const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
const bytes = (file: string): string => readFileSync(path.join(FIXTURES, file), "utf-8");

/**
 * **The rung-one numbers, measured rather than asserted from the plan.**
 *
 * Readability's own `textContent`, whitespace-collapsed the way Readability
 * collapses it before comparing against its threshold — so these are the
 * lengths the library itself called failures. Re-measured across all 36 fixtures
 * on 2026-09-06: nothing at all lies between 185 and 1,798.
 */
const WALLS = [
  { name: "medium-about", file: "medium_about.html", url: "https://medium.com/about", chars: 185 },
  {
    name: "pmc-article",
    file: "pmc_article.html",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/",
    chars: 130,
  },
] as const;

/** The shortest genuine page in the corpus — the nearest real page above the floor. */
const SHORTEST_REAL = {
  name: "arxiv-abs",
  file: "arxiv_abs.html",
  url: "https://arxiv.org/abs/1706.03762",
  chars: 1798,
} as const;

/**
 * **A real page of 749 characters, and it is here to pin the floor from ABOVE.**
 *
 * The negative fixture a recogniser normally carries — *a real page this must
 * not fire on* — is the wrong test for this rule, because the floor decides
 * nothing about what any text is and would fire on a genuine 300-character page
 * too, correctly (Fable, 2026-09-06, quoted in § C1a). What can still go wrong
 * is somebody deciding later that 500 is timid. This page is what goes red then:
 * it is unmistakably an article, it is under 1,000 characters, and it must come
 * through the shipping path with its words intact.
 */
const SHORT_REAL_PAGE = `<!doctype html><html><head><title>The Newlyn tide gauge</title></head><body>
<article><h1>The Newlyn tide gauge</h1>
<p>The tide gauge at Newlyn has been read every day since 1915, and for most of that time nobody
thought the readings were interesting. A clerk wrote the number in a ledger, the ledger went into a
cupboard, and the cupboard was opened again only when somebody wanted to settle an argument about a
harbour wall.</p>
<p>What changed was not the measurement but the length of the record. A century of boring numbers,
taken the same way by people who had no theory to defend, turned out to be the most trustworthy
sea-level series in Britain — precisely because nobody had ever had a reason to lean on it.</p>
<p>That is the ordinary shape of good evidence. It is short, it is dull, and it was collected by
somebody who did not know what it would later be asked to show.</p></article>
</body></html>`;

describe("rung 1 — the source candidates, and what the floor accepts of them", () => {
  it.each(WALLS)("refuses $name at the length Readability measured", ({ file, url, chars }) => {
    const { refusal } = readArticle(bytes(file), url);
    expect(refusal).toBeInstanceOf(TooLittleTextToRead);
    /* The exact number, not "below the floor": the count is what the reader is
       shown and what a later re-measurement is checked against. */
    expect(refusal?.chars).toBe(chars);
  });

  it("does not fire on the shortest genuine page in the corpus", () => {
    const { article, refusal } = readArticle(bytes(SHORTEST_REAL.file), SHORTEST_REAL.url);
    expect(refusal).toBeNull();
    /* And the measurement it did not fire on, so the 3.6× headroom is a number
       this suite keeps rather than a claim in a plan. */
    const measured = (article?.textContent ?? "").trim().replace(/\s{2,}/g, " ").length;
    expect(measured).toBe(SHORTEST_REAL.chars);
  });
});

/**
 * **A page of exactly `n` characters of article text**, which is what pins the
 * floor to a number rather than to a direction.
 *
 * One paragraph, no markup Readability will strip, and no whitespace to
 * collapse: the body's length and the measured length are the same integer, so
 * the case can name 499 and 500 and mean them. GPT Sol's mutation run, 2026-09-06
 * — with only the walls at 130/185 and a real page at 749 asserted, `chars < 200`
 * and a floor of 600 both stayed green, so the tests were pinning the *shape* of
 * the rule and not its number.
 */
const SEED =
  "The clerk wrote the number down every morning without once wondering what it was for, and " +
  "that incuriosity is the reason the series can be trusted a hundred years later. ";
const pageOf = (n: number): string =>
  `<!doctype html><html><head><title>A note on the gauge</title></head><body>` +
  `<article><p>${SEED.repeat(Math.ceil(n / SEED.length) + 1).slice(0, n)}</p></article>` +
  "</body></html>";

describe("the floor is a number, and these are the two characters either side of it", () => {
  it("refuses 499 and accepts 500 — the library's own threshold, from both sides", () => {
    const under = readArticle(pageOf(MIN_ARTICLE_CHARS - 1), "https://example.com/n");
    const at = readArticle(pageOf(MIN_ARTICLE_CHARS), "https://example.com/n");
    /* The page's own text, measured, so this cannot pass by generating
       something other than what it says it generated. */
    const measured = (r: typeof under): number =>
      (r.article?.textContent ?? "").trim().replace(/\s{2,}/g, " ").length;
    expect(measured(under)).toBe(MIN_ARTICLE_CHARS - 1);
    expect(measured(at)).toBe(MIN_ARTICLE_CHARS);
    expect(under.refusal?.chars).toBe(MIN_ARTICLE_CHARS - 1);
    expect(at.refusal).toBeNull();
  });

  it("is Readability's 500 and not a number of ours", () => {
    /* **Read off the dependency**, rather than repeated from memory. The claim
       everywhere else — that this is the library's number and not ours — is
       otherwise a sentence in a comment, and an upgrade that moved the threshold
       would leave every one of those sentences quietly false.

       The cast is because `DEFAULT_CHAR_THRESHOLD` is on the prototype and not
       in `@mozilla/readability`'s `.d.ts`; that it is *there* is what the
       assertion checks, since `undefined` fails it. */
    const library = Readability.prototype as unknown as { DEFAULT_CHAR_THRESHOLD?: number };
    expect(MIN_ARTICLE_CHARS).toBe(library.DEFAULT_CHAR_THRESHOLD);
  });
});

describe("the reader is told the count of the page in front of them", () => {
  it("says a different number for a different page", () => {
    /* Two counts, because one call can be satisfied by a hardcoded 185 — which
       is a mutation that survived every other case here. */
    const [medium, pmc] = WALLS.map((w) => pageHadTooLittleText(w.chars).message);
    expect(medium).toContain("185");
    expect(pmc).toContain("130");
    expect(medium).not.toContain("130");
    expect(medium).not.toBe(pmc);
  });
});

describe("the counterfactual, both directions", () => {
  it.each(WALLS)("with the floor disabled, $name is still what stage 2 published", ({
    file,
    url,
    chars,
  }) => {
    /* **Disabled is not a flag, it is the return value.** `readArticle` hands
       back the article Readability produced *and* the verdict, so what
       production did before this rule existed is still in front of the test:
       a parse Readability had itself concluded failed, with a title on it,
       ready to be published and to spend a reader's slot. */
    const { article, refusal } = readArticle(bytes(file), url);
    expect(article).not.toBeNull();
    expect(article?.title).toBeTruthy();
    expect(refusal?.chars).toBe(chars);
    /* The disabled arm of the counterfactual, said as arithmetic: at a floor of
       zero nothing here is refused, and it is the number alone that separates
       the two worlds. */
    expect(chars < MIN_ARTICLE_CHARS).toBe(true);
    expect(chars < 0).toBe(false);
  });

  it("lets a real 749-character page through untouched, so nobody raises the floor", () => {
    const { article, refusal } = readArticle(SHORT_REAL_PAGE, "https://example.com/newlyn");
    expect(refusal).toBeNull();
    const measured = (article?.textContent ?? "").trim().replace(/\s{2,}/g, " ").length;
    /* Named rather than ranged: a floor moved to 1,000 makes this red, which is
       the whole job of the case. */
    expect(measured).toBe(749);
    expect(measured).toBeLessThan(1000);
    expect(MIN_ARTICLE_CHARS).toBeLessThanOrEqual(measured);
  });

  it("keeps that page's own words through the shipping path", async () => {
    const out = await runExtract({
      html: SHORT_REAL_PAGE,
      url: "https://example.com/newlyn",
      slug: "newlyn",
    });
    expect(out.extractedHtml).toContain("the most trustworthy");
    expect(out.meta.title).toBe("The Newlyn tide gauge");
  });
});

describe("rung 2 — what production does with an accepted match", () => {
  it.each(WALLS)("throws the typed refusal out of runExtract for $name", async ({
    file,
    url,
    name,
    chars,
  }) => {
    const err = await runExtract({ html: bytes(file), url, slug: name }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TooLittleTextToRead);
    expect((err as TooLittleTextToRead).chars).toBe(chars);
    /* **A type and not a sentence.** src/pipeline.ts classifies on `instanceof`,
       and `ReadabilityRefused`'s docstring is the record of what a prose match
       cost when it was the other way round. The message is the log's. */
    expect((err as Error).message).toMatch(/Readability/);
  });
});

describe("rung 3 — the same verdict on the path the harness takes", () => {
  /**
   * **The seam this whole stage exists to keep honest.** `readArticle` and
   * `readArticleWithProvenance` are separate entry points and neither calls the
   * other: `runExtract` uses the first, `shippedOf` in evals/extraction/arms.mts
   * uses the second directly. A floor written into `runExtract` passes every
   * production test above and leaves the harness scoring a refusal that never
   * happens.
   */
  it.each(WALLS)("gives $name the identical refusal through both read paths", ({
    file,
    url,
    chars,
  }) => {
    const shipping = readArticle(bytes(file), url).refusal;
    const instrumented = readArticleWithProvenance(bytes(file), url).refusal;
    expect(shipping?.chars).toBe(chars);
    expect(instrumented?.chars).toBe(chars);
  });

  it("agrees on a page it does not fire on either", () => {
    expect(readArticle(SHORT_REAL_PAGE, "https://example.com/newlyn").refusal).toBeNull();
    expect(
      readArticleWithProvenance(SHORT_REAL_PAGE, "https://example.com/newlyn").refusal,
    ).toBeNull();
  });
});

describe("rungs 4 and 5 — Candidate.refused, and the assertion that changes", () => {
  for (const wall of WALLS) {
    const raw = bytes(wall.file);
    const manifest = parseManifest(
      JSON.parse(readFileSync(path.join(FIXTURES, `${wall.name}.manifest.json`), "utf-8")),
      wall.name,
    );
    const candidate = armNamed(SHIPPED_ARM).run(raw, wall.url, { manifest, url: wall.url });

    it(`sets Candidate.refused on ${wall.name}`, () => {
      expect(candidate.refused).toBe(true);
      /* And nothing of the page travels on as an extraction. */
      expect(candidate.html).toBe("");
    });

    it(`turns ${wall.name}'s notAnArticle assertion from FAIL to PASS`, () => {
      /* The manifest asserts one thing — this is not an article — and it has
         failed since the day it was committed, which was the finding. This is
         the line where the fix becomes visible to the instrument rather than
         only to production. */
      expect(manifest.notAnArticle).toBe(true);
      const card = score({
        fixture: wall.name,
        arm: SHIPPED_ARM,
        html: candidate.html,
        title: candidate.title,
        byline: candidate.byline,
        refused: candidate.refused,
        sourceHtml: preparedSourceHtml(raw, wall.url),
        manifest,
      });
      expect(card.failures).toEqual([]);
      expect(card.assertionsPassed).toBe(true);
    });
  }
});
