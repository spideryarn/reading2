/**
 * **A bot-check page is refused by its own markup, proved as an exposure ladder**
 * — docs/plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md, and the
 * shape is tests/extract-capability-floor.test.ts's on purpose.
 *
 * `hal_anubis.html` is what hal.science answers a plain GET with: an Anubis
 * proof-of-work check, 1,034 characters of it readable as article text. That is
 * twice the capability floor, so stage 2 published it as an article titled
 * *"Making sure you're not a bot!"*. The floor asks *how much*; this asks *what*
 * (src/challenge-page.ts).
 *
 * The rungs, in the order the verdict travels:
 *
 *   the page's own markup → both read paths → what production throws →
 *   the reader's sentence (tests/job-failure.test.ts) → what `Candidate.refused` becomes
 *
 * and three things beside them that a passing rung cannot show: **the
 * counterfactual** (the same bytes less one element are an article, so the
 * refusal is the recogniser's and not the floor's), **the negative controls**
 * (a page that quotes the markup, or says the words, or carries a script of
 * that id that is not a challenge, is not refused), and **the precedence** (a
 * challenge page that is also short, or that Readability declines, is still
 * reported as a challenge).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ChallengePage,
  MIN_ARTICLE_CHARS,
  ReadabilityRefused,
  TooLittleTextToRead,
  readArticle,
  readArticleWithProvenance,
  runExtract,
} from "../src/extract.js";
import { SHIPPED_ARM, armNamed, preparedSourceHtml, withoutTheCapabilityFloor } from "../evals/extraction/arms.mjs";
import { ALL_FIXTURES } from "../evals/extraction/corpus.mjs";
import { parseManifest } from "../evals/extraction/manifest.mjs";
import { score } from "../evals/extraction/scorecard.mjs";

const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
const bytes = (file: string): string => readFileSync(path.join(FIXTURES, file), "utf-8");

const HAL = { name: "hal-anubis", file: "hal_anubis.html", url: "https://hal.science/hal-05779468" } as const;
const hal = bytes(HAL.file);

/** Readability's own measure of an article — src/extract.ts § `visibleLength`. */
const measured = (text: string | null | undefined): number =>
  (text ?? "").trim().replace(/\s{2,}/g, " ").length;

/** What `runExtract` threw, or `null` when it published. */
const thrownBy = (html: string, url: string | null): Promise<unknown> =>
  runExtract({ html, url, slug: "a-slug" }).then(
    () => null,
    (e: unknown) => e,
  );

/**
 * **The one element, found in the bytes so the test can take it out.** Only the
 * test reads the page with a regex; the recogniser reads the parsed DOM.
 */
const THE_SCRIPT = /<script id="anubis_challenge" type="application\/json">[\s\S]*?<\/script>/g;

/** The payload the captured page carries, cut down to the two fields the entry asks for. */
const PAYLOAD = '{"rules":{"algorithm":"fast","difficulty":4},"challenge":{"id":"01a1","method":"fast"}}';
const marker = (payload = PAYLOAD, type = "application/json"): string =>
  `<script id="anubis_challenge" type="${type}">${payload}\n</script>`;

/**
 * **A real article of well over the floor**, which every negative control and
 * the precedence controls are built on, so that nothing below can pass because
 * the page was too short to be an article anyway.
 */
const PROSE = `<p>The tide gauge at Newlyn has been read every day since 1915, and for most of that time nobody
thought the readings were interesting. A clerk wrote the number in a ledger, the ledger went into a
cupboard, and the cupboard was opened again only when somebody wanted to settle an argument about a
harbour wall.</p>
<p>What changed was not the measurement but the length of the record. A century of boring numbers,
taken the same way by people who had no theory to defend, turned out to be the most trustworthy
sea-level series in Britain — precisely because nobody had ever had a reason to lean on it.</p>
<p>That is the ordinary shape of good evidence. It is short, it is dull, and it was collected by
somebody who did not know what it would later be asked to show.</p>`;
const page = (opts: { title?: string; head?: string; body?: string } = {}): string =>
  `<!doctype html><html><head><title>${opts.title ?? "The Newlyn tide gauge"}</title>${opts.head ?? ""}</head>` +
  `<body><article><h1>${opts.title ?? "The Newlyn tide gauge"}</h1>${opts.body ?? PROSE}</article></body></html>`;

describe("rung 1 — the page's own markup, through both read paths", () => {
  it("refuses the HAL page as a challenge through readArticle", () => {
    const { refusal } = readArticle(hal, HAL.url);
    expect(refusal).toBeInstanceOf(ChallengePage);
    expect((refusal as ChallengePage).provider).toBe("anubis");
  });

  it("refuses it identically through readArticleWithProvenance", () => {
    /* The seam C1a was warned about: `runExtract` uses the first entry point and
       the eval harness the second, and neither calls the other. */
    const { refusal } = readArticleWithProvenance(hal, HAL.url);
    expect(refusal).toBeInstanceOf(ChallengePage);
    expect((refusal as ChallengePage).provider).toBe("anubis");
  });

  it("is not the floor's refusal: the page clears the floor twice over", () => {
    /* `readArticle` still hands back what Readability made of it, so the number
       the floor measured is in front of the test. */
    const { article, refusal } = readArticle(hal, HAL.url);
    expect(refusal).not.toBeInstanceOf(TooLittleTextToRead);
    expect(measured(article?.textContent)).toBe(1034);
    expect(measured(article?.textContent)).toBeGreaterThan(2 * MIN_ARTICLE_CHARS);
  });
});

describe("the counterfactual — the same bytes, less the one element", () => {
  const found = hal.match(THE_SCRIPT) ?? [];
  const without = hal.replace(THE_SCRIPT, "");

  it("removes exactly one element and nothing else", () => {
    expect(found).toHaveLength(1);
    expect(hal.length - without.length).toBe(found[0]?.length);
    /* The other three Anubis scripts are still there: it is this one, not the
       family, that the entry reads. */
    expect(without).toContain('id="anubis_version"');
    expect(without).toContain('id="anubis_base_prefix"');
  });

  it("is an article of the same length on both read paths, with no refusal", () => {
    const shipping = readArticle(without, HAL.url);
    const instrumented = readArticleWithProvenance(without, HAL.url);
    expect(shipping.refusal).toBeNull();
    expect(instrumented.refusal).toBeNull();
    expect(measured(shipping.article?.textContent)).toBe(1034);
    expect(measured(instrumented.article?.textContent)).toBe(1034);
    expect(1034).toBeGreaterThanOrEqual(MIN_ARTICLE_CHARS);
  });

  it("is published by runExtract, which is the bug this file is about", async () => {
    const out = await runExtract({ html: without, url: HAL.url, slug: "a-slug" });
    expect(out.meta.title).toBe("Making sure you're not a bot!");
  });
});

describe("rung 2 — what production throws", () => {
  it("throws the typed refusal out of runExtract", async () => {
    const err = await thrownBy(hal, HAL.url);
    expect(err).toBeInstanceOf(ChallengePage);
    expect((err as ChallengePage).provider).toBe("anubis");
  });

  it("throws it for an uploaded copy too, which has no address", async () => {
    expect(await thrownBy(hal, null)).toBeInstanceOf(ChallengePage);
  });
});

describe("negative controls — a real article is not refused", () => {
  const ESCAPED = marker()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const CONTROLS: { name: string; html: string; url: string }[] = [
    /* The corpus's own: it says "just a moment" twice. */
    { name: "acx.html", html: bytes("acx.html"), url: ALL_FIXTURES.find((f) => f.name === "acx")!.url },
    {
      name: "an article that shows the markup, escaped, in a code sample",
      html: page({ body: `${PROSE}<p>Anubis writes its challenge into the page like this:</p><pre><code>${ESCAPED}</code></pre>` }),
      url: "https://example.com/how-anubis-works",
    },
    {
      name: "an article with the phrase as its title and in its prose",
      html: page({
        title: "Making sure you're not a bot!",
        body: `<p>Making sure you're not a bot! is what the page says while it works. Loading... You are seeing this because the administrator of this website has set up Anubis.</p>${PROSE}`,
      }),
      url: "https://example.com/making-sure",
    },
    {
      name: "a script of that id with another type",
      html: page({ head: marker(PAYLOAD, "text/plain") }),
      url: "https://example.com/other-type",
    },
    {
      name: "a script of that id with no type at all",
      html: page({ head: `<script id="anubis_challenge">${PAYLOAD}</script>` }),
      url: "https://example.com/no-type",
    },
    {
      name: "a script of that id whose text does not parse",
      html: page({ head: marker('{"rules":{"algorithm":"fast"},"challenge":') }),
      url: "https://example.com/unparseable",
    },
    {
      name: "valid JSON that is an empty object",
      html: page({ head: marker("{}") }),
      url: "https://example.com/empty-object",
    },
    {
      name: "valid JSON with rules and no challenge",
      html: page({ head: marker('{"rules":{"algorithm":"fast"}}') }),
      url: "https://example.com/rules-only",
    },
    {
      name: "valid JSON with challenge and no rules",
      html: page({ head: marker('{"challenge":{"id":"01a1"}}') }),
      url: "https://example.com/challenge-only",
    },
    {
      name: "valid JSON whose rules and challenge are not objects",
      html: page({ head: marker('{"rules":[],"challenge":"01a1"}') }),
      url: "https://example.com/wrong-shapes",
    },
    {
      name: "valid JSON that is not an object at all",
      html: page({ head: marker('"devel"') }),
      url: "https://example.com/a-string",
    },
    {
      name: "the id on an element that is not a script",
      html: page({ body: `${PROSE}<div id="anubis_challenge" type="application/json">${PAYLOAD.replace(/"/g, "&quot;")}</div>` }),
      url: "https://example.com/a-div",
    },
  ];

  it.each(CONTROLS)("$name", async ({ html, url }) => {
    const shipping = readArticle(html, url);
    expect(shipping.refusal).toBeNull();
    expect(measured(shipping.article?.textContent)).toBeGreaterThanOrEqual(MIN_ARTICLE_CHARS);
    expect(readArticleWithProvenance(html, url).refusal).toBeNull();
    expect(await thrownBy(html, url)).toBeNull();
  });

  it("and the same real article WITH the element is refused, so the controls are about the element", async () => {
    /* Without this the twelve cases above would pass against a recogniser that
       never fires on a synthetic page at all. */
    const html = page({ head: marker() });
    expect(readArticle(html, "https://example.com/marked").refusal).toBeInstanceOf(ChallengePage);
    expect(readArticleWithProvenance(html, "https://example.com/marked").refusal).toBeInstanceOf(ChallengePage);
    expect(await thrownBy(html, "https://example.com/marked")).toBeInstanceOf(ChallengePage);
  });
});

describe("precedence — the challenge wins over both older refusals", () => {
  /* HAL's page clears the floor and Readability accepts it, so it cannot detect
     either precedence error (GPT Sol, F3). These two pages can, and each is
     shown first WITHOUT the element, so the rung is standing on the older
     refusal it claims to outrank. */
  const SHORT = "<p>Checking your browser before you are let in. This will take a moment.</p>";
  const short = (head: string): string => page({ head, body: SHORT });
  const declined = (head: string): string => `<!doctype html><html><head>${head}</head><body></body></html>`;
  const URL_ = "https://example.com/behind-a-check";

  it("the short page, unmarked, is the floor's", async () => {
    expect(readArticle(short(""), URL_).refusal).toBeInstanceOf(TooLittleTextToRead);
    expect(readArticleWithProvenance(short(""), URL_).refusal).toBeInstanceOf(TooLittleTextToRead);
    expect(await thrownBy(short(""), URL_)).toBeInstanceOf(TooLittleTextToRead);
  });

  it("the short page, marked, is a challenge and not too little text", async () => {
    const html = short(marker());
    expect(readArticle(html, URL_).refusal).toBeInstanceOf(ChallengePage);
    expect(readArticleWithProvenance(html, URL_).refusal).toBeInstanceOf(ChallengePage);
    expect(await thrownBy(html, URL_)).toBeInstanceOf(ChallengePage);
  });

  it("the declined page, unmarked, is ReadabilityRefused", async () => {
    const plain = readArticle(declined(""), URL_);
    expect(plain.article).toBeNull();
    expect(plain.refusal).toBeNull();
    expect(readArticleWithProvenance(declined(""), URL_).article).toBeNull();
    expect(await thrownBy(declined(""), URL_)).toBeInstanceOf(ReadabilityRefused);
  });

  it("the declined page, marked, is a challenge and not ReadabilityRefused", async () => {
    const html = declined(marker());
    /* `article: null` beside a non-null `refusal` — new with this refusal, and
       said in `readArticle`'s header. */
    const shipping = readArticle(html, URL_);
    expect(shipping.article).toBeNull();
    expect(shipping.refusal).toBeInstanceOf(ChallengePage);
    const instrumented = readArticleWithProvenance(html, URL_);
    expect(instrumented.article).toBeNull();
    expect(instrumented.refusal).toBeInstanceOf(ChallengePage);
    expect(await thrownBy(html, URL_)).toBeInstanceOf(ChallengePage);
  });
});

/* **Rung 3 — the reader's sentence, through the real step — is in
   tests/job-failure.test.ts**, beside the other two stage-2 refusals. The real
   `STEPS.extract` reads the document out of Storage, and this file runs in the
   `unit` lane, where Storage is deliberately unreachable (vitest.config.ts). */

describe("rungs 4 and 5 — Candidate.refused, with the floor held open", () => {
  const manifest = parseManifest(
    JSON.parse(readFileSync(path.join(FIXTURES, `${HAL.name}.manifest.json`), "utf-8")),
    HAL.name,
  );
  const shipped = (raw: string, url: string) => armNamed(SHIPPED_ARM).run(raw, url, { manifest, url });

  it("is in the corpus every instrument walks", () => {
    expect(ALL_FIXTURES.find((f) => f.name === HAL.name)).toMatchObject({ file: HAL.file, url: HAL.url });
  });

  it("sets Candidate.refused, and nothing of the page travels on", () => {
    const candidate = shipped(hal, HAL.url);
    expect(candidate.refused).toBe(true);
    expect(candidate.html).toBe("");
  });

  it("stays refused with the capability floor suspended", () => {
    /* The suspension is a door past the FLOOR, for one scorer test. A challenge
       page is not a short page and must not walk through it. */
    const candidate = withoutTheCapabilityFloor(() => shipped(hal, HAL.url));
    expect(candidate.refused).toBe(true);
    expect(candidate.html).toBe("");
  });

  it("and the suspension is real: the same call lets a floor refusal through", () => {
    /* Without this, "stays refused" would pass against a seam that had stopped
       suspending anything. */
    const wall = bytes("medium_about.html");
    expect(shipped(wall, "https://medium.com/about").refused).toBe(true);
    expect(withoutTheCapabilityFloor(() => shipped(wall, "https://medium.com/about")).refused).toBe(false);
  });

  it("passes the manifest's one assertion, that this is not an article", () => {
    expect(manifest.notAnArticle).toBe(true);
    const candidate = shipped(hal, HAL.url);
    const card = score({
      fixture: HAL.name,
      arm: SHIPPED_ARM,
      html: candidate.html,
      title: candidate.title,
      byline: candidate.byline,
      refused: candidate.refused,
      sourceHtml: preparedSourceHtml(hal, HAL.url),
      manifest,
    });
    expect(card.failures).toEqual([]);
    expect(card.assertionsPassed).toBe(true);
  });
});
