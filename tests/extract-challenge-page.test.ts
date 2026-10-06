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
 * counterfactual** (the same bytes less the markup the entry reads are an
 * article, so the refusal is the recogniser's and not the floor's), **the
 * negative controls** (a page that quotes the markup, or says the words, or
 * carries a script of that id that is not a challenge, is not refused), and
 * **the precedence** (a challenge page that is also short, or that Readability
 * declines, is still reported as a challenge).
 *
 * **Two pages since 2026-10-06, because the entry has two shapes**
 * (docs/plans/261006f-other-bot-check-walls-that-clear-the-floor.md).
 * `winehq_anubis.html` is what bugs.winehq.org answers with: Anubis v1.15,
 * whose page has no `anubis_challenge` element at all, so the entry as first
 * written missed it and it was an article of 1,106 characters. Every rung
 * below is walked for both pages, and each shape has its own counterfactual
 * and its own controls.
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

/** The older page: the challenge is fetched afterwards, so it is not in the bytes. */
const WINEHQ = { name: "winehq-anubis", file: "winehq_anubis.html", url: "https://bugs.winehq.org/" } as const;
const winehq = bytes(WINEHQ.file);

/** Both captured pages, with the article text each one has: the number the floor measured. */
const PAGES = [
  { ...HAL, html: hal, chars: 1034 },
  { ...WINEHQ, html: winehq, chars: 1106 },
] as const;

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
 * **The three elements the entry reads, found in the bytes so the test can take
 * them out.** Only the test reads the page with a regex; the recogniser reads
 * the parsed DOM. The first is the first shape's; the other two together are
 * the second's.
 */
const THE_SCRIPT = /<script id="anubis_challenge" type="application\/json">[\s\S]*?<\/script>/g;
const THE_VERSION = /<script id="anubis_version" type="application\/json">[\s\S]*?<\/script>/g;
const THE_SOLVER = /<script async type="module" src="[^"]*\/static\/js\/main\.mjs[^"]*"><\/script>/g;

/** The payload the captured page carries, cut down to the two fields the entry asks for. */
const PAYLOAD = '{"rules":{"algorithm":"fast","difficulty":4},"challenge":{"id":"01a1","method":"fast"}}';
const marker = (payload = PAYLOAD, type = "application/json"): string =>
  `<script id="anubis_challenge" type="${type}">${payload}\n</script>`;

/** The second shape's two elements, as bugs.winehq.org's page writes them. */
const SOLVER_PATH = "/.within.website/x/cmd/anubis/static/js/main.mjs";
const SOLVER_SRC = `${SOLVER_PATH}?cacheBuster=v1.15.0-37-g878b371`;
const version = (payload = '"v1.15.0-37-g878b371"', type = "application/json"): string =>
  `<script id="anubis_version" type="${type}">${payload}\n</script>`;
const solver = (src = SOLVER_SRC, type = "module"): string => `<script async type="${type}" src="${src}"></script>`;

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
  it.each(PAGES)("refuses $file as a challenge through readArticle", ({ html, url }) => {
    const { refusal } = readArticle(html, url);
    expect(refusal).toBeInstanceOf(ChallengePage);
    expect((refusal as ChallengePage).provider).toBe("anubis");
  });

  it.each(PAGES)("refuses $file identically through readArticleWithProvenance", ({ html, url }) => {
    /* The seam C1a was warned about: `runExtract` uses the first entry point and
       the eval harness the second, and neither calls the other. */
    const { refusal } = readArticleWithProvenance(html, url);
    expect(refusal).toBeInstanceOf(ChallengePage);
    expect((refusal as ChallengePage).provider).toBe("anubis");
  });

  it.each(PAGES)("is not the floor's refusal: $file clears the floor twice over", ({ html, url, chars }) => {
    /* `readArticle` still hands back what Readability made of it, so the number
       the floor measured is in front of the test. */
    const { article, refusal } = readArticle(html, url);
    expect(refusal).not.toBeInstanceOf(TooLittleTextToRead);
    expect(measured(article?.textContent)).toBe(chars);
    expect(measured(article?.textContent)).toBeGreaterThan(2 * MIN_ARTICLE_CHARS);
  });

  it("the two pages are the two shapes: only HAL's carries the challenge in the page", () => {
    /* What makes the second page a test of the second shape and not a second
       test of the first. Both carry the version element and the solver. */
    expect(hal.match(THE_SCRIPT) ?? []).toHaveLength(1);
    expect(winehq.match(THE_SCRIPT) ?? []).toHaveLength(0);
    expect(winehq).not.toContain("anubis_challenge");
    for (const { html } of PAGES) {
      expect(html.match(THE_VERSION) ?? []).toHaveLength(1);
      expect(html.match(THE_SOLVER) ?? []).toHaveLength(1);
    }
  });
});

/** An article of `chars` on both read paths and published by `runExtract`: no refusal anywhere. */
async function expectAnArticle(html: string, url: string, chars: number): Promise<void> {
  const shipping = readArticle(html, url);
  const instrumented = readArticleWithProvenance(html, url);
  expect(shipping.refusal).toBeNull();
  expect(instrumented.refusal).toBeNull();
  expect(measured(shipping.article?.textContent)).toBe(chars);
  expect(measured(instrumented.article?.textContent)).toBe(chars);
  expect(chars).toBeGreaterThanOrEqual(MIN_ARTICLE_CHARS);
  /* Published, under the check's own title: the bug this file is about. */
  const out = await runExtract({ html, url, slug: "a-slug" });
  expect(out.meta.title).toBe("Making sure you're not a bot!");
}

/**
 * Refused as a challenge on both read paths and by `runExtract`. With no
 * address there is one read path: `readArticleWithProvenance` is the harness's
 * and always has one.
 */
async function expectAChallenge(html: string, url: string | null): Promise<void> {
  expect(readArticle(html, url).refusal).toBeInstanceOf(ChallengePage);
  if (url !== null) expect(readArticleWithProvenance(html, url).refusal).toBeInstanceOf(ChallengePage);
  expect(await thrownBy(html, url)).toBeInstanceOf(ChallengePage);
}

describe("the counterfactual, second shape — the winehq bytes, less either of its two elements", () => {
  const lessVersion = winehq.replace(THE_VERSION, "");
  const lessSolver = winehq.replace(THE_SOLVER, "");

  it("removes exactly one element each time and nothing else", () => {
    const v = winehq.match(THE_VERSION) ?? [];
    const m = winehq.match(THE_SOLVER) ?? [];
    expect(v).toHaveLength(1);
    expect(m).toHaveLength(1);
    expect(winehq.length - lessVersion.length).toBe(v[0]?.length);
    expect(winehq.length - lessSolver.length).toBe(m[0]?.length);
    /* Each copy still carries the half that was not taken out. */
    expect(lessVersion).toContain(SOLVER_SRC);
    expect(lessSolver).toContain('id="anubis_version"');
  });

  it("less the version element, it is an article with no refusal: the solver alone is not enough", async () => {
    await expectAnArticle(lessVersion, WINEHQ.url, 1106);
  });

  it("less the solver script, it is an article with no refusal: the version alone is not enough", async () => {
    await expectAnArticle(lessSolver, WINEHQ.url, 1106);
  });
});

describe("the counterfactual, first shape — the HAL bytes, which carry BOTH shapes", () => {
  /* HAL's page has the challenge element and, like every Anubis page seen, the
     version element and the solver too. So taking out the challenge element
     alone no longer makes it an article: the second shape still holds. That was
     this file's counterfactual until 2026-10-06 (GPT Sol, 261006f F2). */
  const found = hal.match(THE_SCRIPT) ?? [];
  const lessChallenge = hal.replace(THE_SCRIPT, "");
  const lessSecondShape = hal.replace(THE_VERSION, "").replace(THE_SOLVER, "");
  const lessBoth = lessChallenge.replace(THE_VERSION, "").replace(THE_SOLVER, "");

  it("removes exactly the elements it names and nothing else", () => {
    expect(found).toHaveLength(1);
    expect(hal.length - lessChallenge.length).toBe(found[0]?.length);
    /* The other Anubis scripts are still there: it is this one, not the
       family, that the first shape reads. */
    expect(lessChallenge).toContain('id="anubis_version"');
    expect(lessChallenge).toContain('id="anubis_base_prefix"');
    expect(lessChallenge).toContain(SOLVER_PATH);

    expect(lessSecondShape).toContain('id="anubis_challenge"');
    expect(lessSecondShape).not.toContain('id="anubis_version"');
    expect(lessSecondShape).not.toContain("main.mjs");

    expect(lessBoth).not.toContain('id="anubis_challenge"');
    expect(lessBoth).not.toContain('id="anubis_version"');
    expect(lessBoth).not.toContain("main.mjs");
    /* An Anubis script the entry does not read is still in all three. */
    expect(lessBoth).toContain('id="anubis_base_prefix"');
  });

  it("less only the challenge element, it is STILL refused: the second shape holds", async () => {
    await expectAChallenge(lessChallenge, HAL.url);
  });

  it("less only the second shape's two elements, it is still refused: the first shape holds on its own", async () => {
    await expectAChallenge(lessSecondShape, HAL.url);
  });

  it("with both shapes disabled, it is an article of the same length, with no refusal", async () => {
    await expectAnArticle(lessBoth, HAL.url, 1034);
  });
});

describe("rung 2 — what production throws", () => {
  it.each(PAGES)("throws the typed refusal out of runExtract for $file", async ({ html, url }) => {
    const err = await thrownBy(html, url);
    expect(err).toBeInstanceOf(ChallengePage);
    expect((err as ChallengePage).provider).toBe("anubis");
  });

  it.each(PAGES)("throws it for an uploaded copy of $file too, which has no address", async ({ html }) => {
    /* The winehq half is 261006f F1. A document with no address has
       `about:blank` as its base, and the solver's root-relative `src` does not
       resolve against that — so a rule that resolved it against the document
       would miss exactly the copy a reader is told to save and upload. */
    expect(await thrownBy(html, null)).toBeInstanceOf(ChallengePage);
    expect(readArticle(html, null).refusal).toBeInstanceOf(ChallengePage);
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

describe("negative controls, second shape — neither half alone, and nothing that only resembles one", () => {
  const asText = (h: string): string => h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ORIGIN = "https://example.com";

  /* Every page here is the real article over the floor, so none can pass by
     being too short to publish anyway; `it.each` below asserts that. Each
     "solver" control carries the real version element beside it, and each
     "version" control the real solver, so only the one thing named is wrong. */
  const CONTROLS: { name: string; html: string; url: string }[] = [
    { name: "the version element alone", html: page({ head: version() }), url: `${ORIGIN}/version-only` },
    { name: "the solver script alone", html: page({ body: PROSE + solver() }), url: `${ORIGIN}/solver-only` },
    {
      name: "a version element whose JSON is a number, not a string",
      html: page({ head: version("115"), body: PROSE + solver() }),
      url: `${ORIGIN}/version-number`,
    },
    {
      name: "a version element whose JSON is an object",
      html: page({ head: version('{"version":"v1.15.0"}'), body: PROSE + solver() }),
      url: `${ORIGIN}/version-object`,
    },
    {
      name: "a version element whose JSON is the empty string",
      html: page({ head: version('""'), body: PROSE + solver() }),
      url: `${ORIGIN}/version-empty`,
    },
    {
      name: "a version element whose text does not parse",
      html: page({ head: version("v1.15.0-37-g878b371"), body: PROSE + solver() }),
      url: `${ORIGIN}/version-unparseable`,
    },
    {
      name: "a version element with another type",
      html: page({ head: version(undefined, "text/plain"), body: PROSE + solver() }),
      url: `${ORIGIN}/version-other-type`,
    },
    {
      name: "a version element with no type at all",
      html: page({ head: '<script id="anubis_version">"v1.15.0"</script>', body: PROSE + solver() }),
      url: `${ORIGIN}/version-no-type`,
    },
    {
      name: "the version id on an element that is not a script",
      html: page({ body: `${PROSE}<div id="anubis_version" type="application/json">&quot;v1.15.0&quot;</div>${solver()}` }),
      url: `${ORIGIN}/version-a-div`,
    },
    {
      name: "a module script whose path only CONTAINS the solver's (main.mjs.map)",
      html: page({ head: version(), body: PROSE + solver(`${SOLVER_PATH}.map`) }),
      url: `${ORIGIN}/solver-map`,
    },
    {
      name: "a module script whose path goes on past the solver's",
      html: page({ head: version(), body: PROSE + solver(`${SOLVER_PATH}/loader.js`) }),
      url: `${ORIGIN}/solver-longer`,
    },
    {
      name: "a module script with the solver's path in its query string",
      html: page({ head: version(), body: PROSE + solver(`/assets/app.mjs?from=${SOLVER_PATH}`) }),
      url: `${ORIGIN}/solver-in-query`,
    },
    {
      name: "a module script with the solver's path in its fragment",
      html: page({ head: version(), body: PROSE + solver(`/assets/app.mjs#${SOLVER_PATH}`) }),
      url: `${ORIGIN}/solver-in-fragment`,
    },
    {
      name: "a module script whose src does not parse as a URL",
      html: page({ head: version(), body: PROSE + solver(`https://[not-a-host${SOLVER_PATH}`) }),
      url: `${ORIGIN}/solver-malformed`,
    },
    {
      name: "a script of the solver's path that is not a module",
      html: page({ head: version(), body: `${PROSE}<script async src="${SOLVER_SRC}"></script>` }),
      url: `${ORIGIN}/solver-classic`,
    },
    {
      name: "a script of the solver's path with another type",
      html: page({ head: version(), body: PROSE + solver(SOLVER_SRC, "text/javascript") }),
      url: `${ORIGIN}/solver-other-type`,
    },
    {
      name: "a module script with the solver's path as its text and no src",
      html: page({ head: version(), body: `${PROSE}<script type="module">import "${SOLVER_SRC}";</script>` }),
      url: `${ORIGIN}/solver-inline`,
    },
    {
      name: "a link to the solver, which is not a script",
      html: page({ head: version(), body: `${PROSE}<p><a href="${SOLVER_SRC}">Anubis's script</a></p>` }),
      url: `${ORIGIN}/solver-linked`,
    },
    {
      name: "both elements, escaped, in a code sample",
      html: page({ body: `${PROSE}<p>The older page looks like this:</p><pre><code>${asText(version() + solver())}</code></pre>` }),
      url: `${ORIGIN}/how-anubis-used-to-work`,
    },
    {
      name: "the version element, and the solver only escaped in a code sample",
      html: page({ head: version(), body: `${PROSE}<pre><code>${asText(solver())}</code></pre>` }),
      url: `${ORIGIN}/solver-quoted`,
    },
  ];

  it.each(CONTROLS)("$name", async ({ html, url }) => {
    const shipping = readArticle(html, url);
    expect(shipping.refusal).toBeNull();
    expect(measured(shipping.article?.textContent)).toBeGreaterThanOrEqual(MIN_ARTICLE_CHARS);
    expect(readArticleWithProvenance(html, url).refusal).toBeNull();
    expect(await thrownBy(html, url)).toBeNull();
    /* And with no address, which is the base the path is NOT resolved against. */
    expect(readArticle(html, null).refusal).toBeNull();
    expect(await thrownBy(html, null)).toBeNull();
  });

  const POSITIVES: { name: string; html: string }[] = [
    { name: "as the captured page writes them", html: page({ head: version(), body: PROSE + solver() }) },
    { name: "with no query string", html: page({ head: version(), body: PROSE + solver(SOLVER_PATH) }) },
    {
      /* sourceware.org serves it from /git/: an install may sit under a prefix. */
      name: "with a prefix in front of the path",
      html: page({ head: version(), body: PROSE + solver(`/git${SOLVER_SRC}`) }),
    },
    {
      name: "with the solver given as a whole address",
      html: page({ head: version(), body: PROSE + solver(`https://bugs.winehq.org${SOLVER_SRC}`) }),
    },
    {
      name: "with the type attributes in another case and padded",
      html: page({ head: version(undefined, " Application/JSON "), body: PROSE + solver(SOLVER_SRC, " Module ") }),
    },
  ];

  it.each(POSITIVES)(
    "and the same real article WITH both elements is refused — $name",
    async ({ html }) => {
      /* Without these the controls above would pass against a second shape that
         never fires on a synthetic page at all. With and without an address. */
      await expectAChallenge(html, `${ORIGIN}/marked`);
      await expectAChallenge(html, null);
    },
  );

  it("and it is the page's own base that is ignored: a <base> elsewhere changes nothing", async () => {
    /* The path is read off the attribute, not resolved against the document. */
    const html = page({ head: `<base href="https://cdn.example.net/deep/">${version()}`, body: PROSE + solver() });
    await expectAChallenge(html, `${ORIGIN}/based`);
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

  it("the short page, marked with the second shape, is a challenge too", async () => {
    const html = page({ head: version(), body: SHORT + solver() });
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

  it("the declined page, marked with the second shape, is a challenge too", async () => {
    const html = declined(version() + solver());
    expect(readArticle(html, URL_).article).toBeNull();
    expect(readArticle(html, URL_).refusal).toBeInstanceOf(ChallengePage);
    expect(readArticleWithProvenance(html, URL_).refusal).toBeInstanceOf(ChallengePage);
    expect(await thrownBy(html, URL_)).toBeInstanceOf(ChallengePage);
  });
});

/* **Rung 3 — the reader's sentence, through the real step — is in
   tests/job-failure.test.ts**, beside the other two stage-2 refusals. The real
   `STEPS.extract` reads the document out of Storage, and this file runs in the
   `unit` lane, where Storage is deliberately unreachable (vitest.config.ts). */

describe.each(PAGES)("rungs 4 and 5 — Candidate.refused for $name, with the floor held open", (PAGE) => {
  const manifest = parseManifest(
    JSON.parse(readFileSync(path.join(FIXTURES, `${PAGE.name}.manifest.json`), "utf-8")),
    PAGE.name,
  );
  const shipped = (raw: string, url: string) => armNamed(SHIPPED_ARM).run(raw, url, { manifest, url });

  it("is in the corpus every instrument walks", () => {
    expect(ALL_FIXTURES.find((f) => f.name === PAGE.name)).toMatchObject({ file: PAGE.file, url: PAGE.url });
  });

  it("sets Candidate.refused, and nothing of the page travels on", () => {
    const candidate = shipped(PAGE.html, PAGE.url);
    expect(candidate.refused).toBe(true);
    expect(candidate.html).toBe("");
  });

  it("stays refused with the capability floor suspended", () => {
    /* The suspension is a door past the FLOOR, for one scorer test. A challenge
       page is not a short page and must not walk through it. */
    const candidate = withoutTheCapabilityFloor(() => shipped(PAGE.html, PAGE.url));
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
    const candidate = shipped(PAGE.html, PAGE.url);
    const card = score({
      fixture: PAGE.name,
      arm: SHIPPED_ARM,
      html: candidate.html,
      title: candidate.title,
      byline: candidate.byline,
      refused: candidate.refused,
      sourceHtml: preparedSourceHtml(PAGE.html, PAGE.url),
      manifest,
    });
    expect(card.failures).toEqual([]);
    expect(card.assertionsPassed).toBe(true);
  });
});
