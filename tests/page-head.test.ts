// @vitest-environment jsdom
/**
 * **What a pasted link turns into**, asserted against the repo's real
 * `index.html` rather than a fixture of one.
 *
 * `composeShell()` (src/public/page-head.ts) swaps the managed-head region of
 * the built client shell for a head about one article, so that a shared
 * `/read/<slug>` previews as the article instead of as the bare word
 * *Spideryarn*. Everything else in the document — the referrer policy, the
 * icons, the manifest, the whole `<body>` — has to come through untouched, and
 * the text that goes in comes from two of the four untrusted parties in
 * docs/project/security-map.md: the article's own page, and the model.
 *
 * ## Two kinds of assertion, on purpose
 *
 * **Structural**, through jsdom, wherever a browser's parse is the thing that
 * matters: an element count, an attribute list. A string comparison updated to
 * match a bug is green forever; a second `<meta>` where one was written is
 * visible in the DOM and invisible in the string.
 *
 * **Raw markup**, on the composed bytes, for the escapes a parse cannot see.
 * tests/head-text.test.ts worked this out and measured it: `<title>` is RCDATA,
 * so escaping `>` alone already stops `</title>` breaking out, and every reader
 * of the parsed result normalises the difference away — `doc.title` decodes
 * entities, `innerHTML` re-serialises with correct escaping, and the escaped
 * and unescaped inputs come back byte-identical. So the one assertion that dies
 * when `<` stops being escaped has to look at what we emitted, not at what a
 * parser made of it.
 *
 * ## The mutations, all run
 *
 * Each row of the plan's table was applied, watched go red, and put back. The
 * per-test comments say which mutation belongs to which assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  composeShell,
  MANAGED_HEAD_END,
  MANAGED_HEAD_START,
} from "../src/public/page-head.js";
/* `PUBLIC_ORIGIN` is in src/urls.ts, not in page-head.ts, since 2026-09-02 —
   the export bundle needs the same origin and a store file cannot import a page
   renderer for it. The assertion below is still about what `composeShell`
   publishes; it just names the constant where the constant now lives. */
import { isSlug } from "../src/ingest.js";
import { PUBLIC_ORIGIN, articleUrl } from "../src/urls.js";
/* From the shared leaf rather than from page-head.js, because the leaf is the
   only definition there now is — see src/title-text.ts. `composeShell` calls
   this same function, so comparing it against `pageTitle()` below is a
   statement about what actually reaches the document. */
import { DEFAULT_MODE, MODES } from "../src/modes.js";
import { clamp, documentTitle } from "../src/title-text.js";
import type { PublicHead } from "../src/store/public-reader.js";
import { pageTitle } from "../src/web/page-title.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * **The real `index.html`**, not a fixture.
 *
 * A fixture would pass while the file the build actually compiles in had lost
 * its sentinels, or its robots meta, or had gained a second copy of either. The
 * built `dist/index.html` differs from this only in the script tag, which is
 * below the region this function touches.
 */
const SHELL = readFileSync(path.join(ROOT, "index.html"), "utf8");

/** An ordinary public article. Fields are overridden per test. */
function head(over: Partial<PublicHead> = {}): PublicHead {
  return {
    slug: "the-hard-problem",
    title: "The hard problem is a distraction",
    gist: "Consciousness research keeps circling one question that may not be the useful one.",
    canonical: "https://aeon.co/essays/the-hard-problem-is-a-distraction",
    ...over,
  };
}

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

/** The `content` of one meta, by whichever attribute names it, or null. */
function metaContent(d: Document, selector: string): string | null {
  return d.querySelector(selector)?.getAttribute("content") ?? null;
}

describe("the shell that is not touched", () => {
  it("returns the shell byte for byte when there is no article", () => {
    /* The answer for a private slug, an absent one, a malformed one and a
       storage failure. Those responses carry their own status code and the
       app's ordinary head — which is why the next test matters. */
    expect(composeShell(SHELL, null)).toBe(SHELL);
  });

  it("keeps everything above the managed head, and the whole body, byte for byte", () => {
    /* **Mutation: insert one character after `<body>` in `composeShell`.** Red,
       as it must be — this is the assertion that stops this function quietly
       becoming a second renderer. The plan says server-side rendering is not
       what this is; React still mounts and still draws the page. */
    const composed = composeShell(SHELL, head());
    const body = (s: string) => s.slice(s.indexOf("<body"));
    expect(body(composed)).toBe(body(SHELL));

    const above = (s: string) => s.slice(0, s.indexOf(MANAGED_HEAD_START));
    expect(above(composed)).toBe(above(SHELL));
    /* Named individually as well, because "the prefix is unchanged" is true of
       a prefix that got shorter too. The referrer policy is the one that would
       actually hurt: docs/plans/260827ai-public-read-only-access.md § Stage 1. */
    expect(metaContent(doc(composed), 'meta[name="referrer"]')).toBe("no-referrer");
    expect(composed).toContain('<script type="module" src="/src/web/boot.tsx"></script>');
  });

  it("refuses a shell whose sentinel appears twice", () => {
    /* Which pair of markers would the composer use? There is no right answer,
       so it refuses rather than guessing — and it refuses on the `head === null`
       path too, because a shell it cannot understand is a broken build whether
       or not anybody happens to be sharing a link that second.

       **Mutation: delete the `requireOnce` calls.** Both cases went green (no
       throw), which is the failure this test exists to catch. */
    const twice = SHELL.replace(MANAGED_HEAD_START, `${MANAGED_HEAD_START}\n${MANAGED_HEAD_START}`);
    expect(() => composeShell(twice, head())).toThrow(/appears more than once/);
    expect(() => composeShell(twice, null)).toThrow(/appears more than once/);

    const none = SHELL.replace(MANAGED_HEAD_END, "");
    expect(() => composeShell(none, head())).toThrow(/no <!-- spideryarn:managed-head:end/);
  });

  /**
   * **Both sentinels have to be above the `<body`**, which uniqueness and
   * ordering do not give you.
   *
   * The invariant the previous test asserts — "the whole body, byte for byte" —
   * was documented and unenforced. A shell whose end marker had drifted below
   * `<body>` passes "exactly once" and passes "start before end", and the
   * replacement then eats everything from the head down to it, `<div id="root">`
   * included. That is a page that boots into nothing. GPT Sol's review of slice
   * 1, finding 2.
   *
   * **Mutation: delete the `requireMarkersInHead` call from `composeShell`.**
   * All four `toThrow`s below go green.
   */
  it("refuses a shell whose sentinels are not both above the body", () => {
    /* End marker moved below `<body>`, start left where it is — which is the
       shape that passes both of the older checks. */
    const late = SHELL.replace(MANAGED_HEAD_END, "").replace(
      "  <body>",
      `  <body>\n    ${MANAGED_HEAD_END}`,
    );
    /* The fixture is dangerous, said out loud: the span this function would
       replace has the body tag inside it. Without this pair of lines the
       assertions below could be passing over a fixture that was never a threat. */
    expect(late.indexOf(MANAGED_HEAD_END)).toBeGreaterThan(late.indexOf("<body"));
    expect(late.slice(late.indexOf(MANAGED_HEAD_START), late.indexOf(MANAGED_HEAD_END))).toContain(
      "<body",
    );
    expect(() => composeShell(late, head())).toThrow(/end sentinel is at \d+, below the <body/);
    /* And on the `head === null` path too, for the reason the duplicate-sentinel
       case gives: a shell we cannot understand is a broken build whether or not
       anybody happens to be sharing a link that second. */
    expect(() => composeShell(late, null)).toThrow(/end sentinel is at \d+, below the <body/);

    /* Both of them below, which is the case that names the *start* marker —
       with only the start moved, the start-before-end check fires first and
       says something else. */
    const bothLate = SHELL.replace(MANAGED_HEAD_START, "")
      .replace(MANAGED_HEAD_END, "")
      .replace("  <body>", `  <body>\n    ${MANAGED_HEAD_START}\n    ${MANAGED_HEAD_END}`);
    expect(() => composeShell(bothLate, head())).toThrow(
      /start sentinel is at \d+, below the <body/,
    );

    /* No body at all. There is no way to keep a promise about a landmark that
       is not there, so it is refused rather than passed by default. */
    const headless = SHELL.slice(0, SHELL.indexOf("<body"));
    expect(headless).toContain(MANAGED_HEAD_END);
    expect(() => composeShell(headless, head())).toThrow(/no <body tag/);
  });
});

describe("what a link preview is told", () => {
  it("names the article, the site, and nothing about the reader", () => {
    const d = doc(composeShell(SHELL, head()));
    expect(d.title).toBe("The hard problem is a distraction · Spideryarn");
    expect(metaContent(d, 'meta[property="og:type"]')).toBe("article");
    expect(metaContent(d, 'meta[property="og:site_name"]')).toBe("Spideryarn");
    /* Without the app suffix: the card already carries `og:site_name`, so
       repeating it spends the visible half of the card on the same word twice. */
    expect(metaContent(d, 'meta[property="og:title"]')).toBe(
      "The hard problem is a distraction",
    );
    expect(metaContent(d, 'meta[name="twitter:card"]')).toBe("summary");
    expect(metaContent(d, 'meta[name="twitter:title"]')).toBe(
      "The hard problem is a distraction",
    );
    /* One head, not two: the shell's own `<title>` was inside the sentinels and
       has been replaced rather than joined. */
    expect(d.querySelectorAll("title")).toHaveLength(1);
    /* No image in this slice. A third-party lead image would be an endorsement,
       a privacy contact and another untrusted `src` sink — and
       `summary_large_image` without one renders as a broken card. */
    expect(d.querySelector('meta[property="og:image"]')).toBeNull();
    expect(d.querySelector('meta[name="twitter:image"]')).toBeNull();
  });

  it("gives the same description to all three, and omits all three when there is none", () => {
    const one = "Consciousness research keeps circling one question that may not be the useful one.";
    const withGist = doc(composeShell(SHELL, head()));
    expect(metaContent(withGist, 'meta[name="description"]')).toBe(one);
    expect(metaContent(withGist, 'meta[property="og:description"]')).toBe(one);
    expect(metaContent(withGist, 'meta[name="twitter:description"]')).toBe(one);

    /* **Mutation: emit the strapline ("AI-assisted reading: …") instead of
       omitting.** Red on all three. `root_gist` is already the
       gist → summary → excerpt fallback (src/library-scalars.ts), so a null here
       means we genuinely have nothing to say about this article, and three tags
       saying the wrong thing is worse than none. */
    const without = doc(composeShell(SHELL, head({ gist: null })));
    expect(without.querySelector('meta[name="description"]')).toBeNull();
    expect(without.querySelector('meta[property="og:description"]')).toBeNull();
    expect(without.querySelector('meta[name="twitter:description"]')).toBeNull();
    /* And it is not the *shell's* description surviving either — that tag was
       inside the sentinels and is gone with the rest of the region. */
    expect(composeShell(SHELL, head({ gist: null }))).not.toContain("AI-assisted reading");
  });

  it("tells crawlers to stay away, before and after enhancement", () => {
    /* **Mutation: delete the robots meta from index.html.** Red on the default
       and on the enhanced case, which is the pair that matters: this slice
       changes what a card looks like and changes crawler exposure not at all.
       The header Vercel sets says the same thing today; this is the fail-closed
       backstop for the slice that narrows it. */
    for (const markup of [composeShell(SHELL, null), composeShell(SHELL, head())]) {
      const d = doc(markup);
      expect(d.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
      expect(metaContent(d, 'meta[name="robots"]')).toBe("noindex, nofollow");
    }
  });
});

describe("the address we publish for this page", () => {
  it("is built from the fixed origin, never from anything a request carried", () => {
    /* **Mutation: build it from a `host` argument instead** — the "improvement"
       somebody makes later so preview deployments unfurl under their own
       hostname. Red. A stranger can send any `Host` (or `X-Forwarded-Host`) to
       an edge function, and `og:url` is a tag whose entire purpose is to be
       believed: their domain would go out attributed to us. */
    const d = doc(composeShell(SHELL, head()));
    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
      "https://www.spideryarn.com/read/the-hard-problem",
    );
    expect(PUBLIC_ORIGIN).toBe("https://www.spideryarn.com");
  });

  it("percent-encodes the slug rather than trusting it to be tame", () => {
    const d = doc(composeShell(SHELL, head({ slug: 'a"b/c' })));
    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
      "https://www.spideryarn.com/read/a%22b%2Fc",
    );
  });

  it("is safe from the dot-segment attack because isSlug is, not because articleUrl is", () => {
    /* **The one input percent-encoding does not answer.** `encodeURIComponent`
       leaves a dot alone, so a slug of `..` composes to `/read/..` — which a
       browser resolves to the library, a link quietly naming the wrong page.
       Encoding the dots is no fix: the URL standard counts `%2e` as a dot
       segment too, which is asserted below so nobody re-adds that guard.

       What actually holds the line is the slug's own shape, so that is what
       this pins. If `isSlug` is ever widened to admit a dot, this goes red —
       which is the point, because the widening and the broken link would
       otherwise be in two different files a month apart. */
    for (const dots of ["..", ".", "...", ""]) {
      expect(isSlug(dots), `isSlug should refuse ${JSON.stringify(dots)}`).toBe(false);
    }

    // And the escape that looks like it would work, watched not working.
    expect(new URL(articleUrl("..")).pathname).toBe("/");
    expect(new URL("https://www.spideryarn.com/read/%2E%2E").pathname).toBe("/");
  });

  it("keeps every other awkward slug inside its own path segment", () => {
    /* One assertion for the whole adversarial table rather than a test each:
       none of these may leave the segment, and none may reach the origin. */
    for (const slug of ['a"b', "a/b", "..%2f..", "a\\b", "a\nb", "a\u0000b", "//evil.com", "a%b"]) {
      const url = new URL(articleUrl(slug));
      expect(url.origin).toBe(PUBLIC_ORIGIN);
      expect(url.pathname.split("/").length).toBe(3);
      expect(decodeURIComponent(url.pathname.slice("/read/".length))).toBe(slug);
    }
  });

  it("publishes a clean canonical and refuses one carrying a query", () => {
    /* **Mutation: delete the `search !== ""` refusal in src/urls.ts.** Red — the
       query URL gains a canonical. Both directions of that judgement are in
       src/urls.ts: `?utm_source=` is unsafe to publish and `?id=123` *is* the
       article on many sites, so the stripped URL names a different page. */
    const clean = doc(composeShell(SHELL, head()));
    expect(clean.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://aeon.co/essays/the-hard-problem-is-a-distraction",
    );

    for (const canonical of [
      "https://example.com/a?id=123",
      "https://user:pw@example.com/a",
      "javascript:alert(1)",
      null,
    ]) {
      const d = doc(composeShell(SHELL, head({ canonical })));
      expect(d.querySelector('link[rel="canonical"]'), String(canonical)).toBeNull();
    }
  });
});

describe("text from a stranger, on its way into a document head", () => {
  it("escapes the characters a parse cannot tell you about", () => {
    /* **Mutations: map `<` to itself; separately map `>`; separately map `&`.**
       Each one red here, and *only* here — this is a raw-markup assertion for
       the reason the file header gives: inside `<title>` RCDATA the escaping of
       `<` changes the bytes and changes nothing about the parse, and every way
       of reading the parsed result normalises the difference away. Measured in
       tests/head-text.test.ts, 2026-08-29. */
    const composed = composeShell(SHELL, head({ title: "A<B>C&D" }));
    expect(composed).toContain("<title>A&lt;B&gt;C&amp;D · Spideryarn</title>");
    expect(composed).toContain('content="A&lt;B&gt;C&amp;D"');
  });

  it("cannot smuggle an attribute into the tag it is already inside", () => {
    /* **Mutation: map `"` to itself.** Red. This is the payload that needs `"`
       and *nothing else*: it opens no tag, so no other entry in the escape table
       can save it, and the assertion is therefore the attribute list rather than
       an element count. The obvious payload — close the attribute, close the
       tag, open a new `<meta>` — needs `<` and `>` as well and stays green under
       this mutation; tests/head-text.test.ts has the whole story. */
    const d = doc(composeShell(SHELL, head({ gist: '" onload="alert(1)' })));
    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]) {
      const tag = d.querySelector(selector);
      expect(tag, selector).not.toBeNull();
      expect([...(tag as Element).attributes].map((a) => a.name).sort(), selector).toEqual(
        selector.startsWith("meta[property") ? ["content", "property"] : ["content", "name"],
      );
    }
  });

  it("clamps by code point, so a title that is really a paragraph cannot fill the tab", () => {
    /* **Mutation: remove the clamp (pass `Infinity`).** Red — 10,000 characters
       arrive intact. Code points rather than `.length` is the second half:
       slicing at a UTF-16 offset can cut an astral character in half and leave a
       lone surrogate, which is not valid text. */
    const d = doc(composeShell(SHELL, head({ title: "x".repeat(10_000) })));
    /* **64 plus one.** The tab's clamp appends an ellipsis rather than counting
       it, so a title with no space to cut at comes out one code point over
       budget — see `clamp` in src/title-text.ts, which says so. That is the
       client's rule, and since 2026-08-30 the tab is composed by the client's
       rule on both sides. `og:title` keeps `headText`'s hard 120, because
       metadata is a promise about a length. */
    expect([...d.title]).toHaveLength(64 + 1 + " · Spideryarn".length);
    expect([...(metaContent(d, 'meta[property="og:title"]') ?? "")]).toHaveLength(120);

    const astral = doc(composeShell(SHELL, head({ title: "\u{1D54F}".repeat(200) })));
    const title = metaContent(astral, 'meta[property="og:title"]') ?? "";
    expect([...title]).toHaveLength(120);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("makes a line break a space and drops the invisible direction changes", () => {
    const d = doc(composeShell(SHELL, head({ title: "A\r\nB‮evil" })));
    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A Bevil");
  });

  it("says Untitled rather than nothing, as the client does", () => {
    for (const title of [null, "   "]) {
      const d = doc(composeShell(SHELL, head({ title })));
      expect(d.title, String(title)).toBe("Untitled · Spideryarn");
      expect(metaContent(d, 'meta[property="og:title"]'), String(title)).toBe("Untitled");
    }
  });
});

describe("the one title rule, applied by both sides", () => {
  /**
   * **The tab must not change when React mounts**, and until 2026-08-30 it did.
   *
   * A shared `/read/<slug>` is served with a `<title>` this file's
   * `composeShell` composed; React then assigns `document.title` from
   * `pageTitle()` in src/web/page-title.ts, over the top of it. The server ran
   * the title through `headText` (src/html.ts) and the client did not, so for
   * any title with a double space, a newline, a tab or a bidi override in it the
   * reader watched the title they were given turn into a worse one. GPT Sol
   * found it reviewing slice 1; it was pinned as a divergence nobody had chosen
   * and put to Greg, who left the call here.
   *
   * **The call: the server's normalising wins and the client's clamp wins**, and
   * they are one function now — `documentTitle` in src/title-text.ts, which both
   * sides import. That header has the argument for each half.
   *
   * The expected strings below are **spelled out** rather than computed from
   * either side. An expectation written as `documentTitle(t)` would agree with
   * every possible behaviour of `documentTitle`, which is the way a test about
   * two things that must agree quietly becomes a test about nothing.
   */
  it("normalises whitespace, controls and bidi identically on both sides", () => {
    const cases: [string, string][] = [
      /* [ the article's title, what BOTH sides must put in the tab ] */
      ["A  B", "A B · Spideryarn"],
      ["A\nB", "A B · Spideryarn"],
      ["A\r\nB", "A B · Spideryarn"],
      ["A\tB", "A B · Spideryarn"],
      /* U+202E RIGHT-TO-LEFT OVERRIDE: invisible, and it reverses what follows
         it. The client used to keep it. */
      ["A\u202eB", "AB · Spideryarn"],
      ["  spaced  ", "spaced · Spideryarn"],
      /* The separator inside a title, which must survive being one. */
      ["A · B", "A · B · Spideryarn"],
      ["The hard problem is a distraction", "The hard problem is a distraction · Spideryarn"],
      /* Arabic keeps every character it had — the strip is of invisible
         instructions, not of right-to-left text. */
      ["مرحبا بالعالم", "مرحبا بالعالم · Spideryarn"],
    ];
    for (const [title, expected] of cases) {
      const client = pageTitle({ kind: "read", title, view: "article", mode: DEFAULT_MODE });
      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe(expected);
      expect(client, `client: ${JSON.stringify(title)}`).toBe(expected);
      /* Said as a comparison too, so this is about the pair and not about two
         independent constants that happen to be written on one line. */
      expect(documentTitle(title), `pair: ${JSON.stringify(title)}`).toBe(client);
    }
  });

  it("says Untitled on both sides for a title that is nothing", () => {
    for (const title of [null, "", "   ", "\u202e", "\n\t"]) {
      expect(documentTitle(title), `server: ${JSON.stringify(title)}`).toBe("Untitled · Spideryarn");
      expect(
        pageTitle({ kind: "read", title: title ?? "", view: "article", mode: DEFAULT_MODE }),
        `client: ${JSON.stringify(title)}`,
      ).toBe("Untitled · Spideryarn");
    }
  });

  it("clamps long titles to the same string, ellipsis and all", () => {
    /* 40 words of five characters. The clamp cuts at the last word boundary
       inside 64 code points, which is after the twelfth. Written out rather
       than derived: `clamp(x)` as the expectation would pass for any clamp. */
    const long = "word ".repeat(40);
    const expected = `${Array(12).fill("word").join(" ")}… · Spideryarn`;
    expect(documentTitle(long)).toBe(expected);
    expect(pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE })).toBe(
      expected,
    );
  });

  /**
   * **The plumbing, not the rule** — and this is the case that answers "is the
   * equality guaranteed, or only usually?"
   *
   * The three cases above are about `documentTitle`, which both sides call. This
   * one is about everything the *client* wraps around it: `pageTitle` reaches it
   * through `segments` → `readTitle` → `join`, and `join` trims every part and
   * drops the empty ones. Reasoning says that is a no-op — `articleTitle`
   * normalises, so its result cannot begin or end in whitespace, and it falls
   * back to `Untitled` rather than returning `""`. Reasoning is exactly what was
   * wrong last time, so this looks instead.
   *
   * Seeded, so a failure is reproducible from the number rather than from luck,
   * and the alphabet is built out of the things that broke the two sides apart
   * before: bidi controls, the C0/C1 range, whitespace the `CONTROLS` class does
   * **not** cover (NBSP, zero-width space, ideographic space) which only the
   * `\s` collapse can touch, surrogate pairs either side of the clamp, and the
   * separator itself inside a title.
   *
   * **`oldClient` is the control.** A fuzz that finds nothing is worthless until
   * it has been shown to find something, and "no divergence" is precisely the
   * output an inert loop produces. So the same loop runs against the client
   * behaviour as it was before 2026-08-30, and is required to fail.
   */
  it("finds no divergence the client's own wrapping could introduce — and can find one", () => {
    /* The client before the fix: trim the ends, clamp, fall back. Nothing calls
       this; it exists so that the loop below can be seen failing. */
    const oldClient = (t: string) => `${clamp(t.trim()) || "Untitled"} · Spideryarn`;

    const ALPHABET = [
      " ", "  ", "\t", "\n", "\r\n", "\v", "\f", "\u0000", "\u001f", "\u007f", "\u009f",
      "\u202e", "\u202a", "\u2066", "\u2069", "\u061c", // RLO, LRE, LRI, PDI, ALM
      /* NBSP and the ideographic space are outside the CONTROLS class but are
         `\s`, so the collapse reaches them. U+200B and U+FEFF are neither, and
         survive normalising untouched — which is fine, and is why src/html.ts no
         longer claims to remove "nothing invisible". */
      "\u00a0", "\u3000", "\u200b", "\ufeff",
      "a", "word", "the", "·", " · ", "…", "&", "<", "'", '"',
      "\u{1D54F}", "\u{1F1EC}\u{1F1E7}", "é", "e\u0301", "\u0645\u0631\u062d\u0628\u0627",
    ];

    /* A linear congruential generator — deterministic, and no dependency. */
    let seed = 20260830;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const titles: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      let t = "";
      const n = Math.floor(rnd() * 40);
      for (let j = 0; j < n; j++) t += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      titles.push(t);
    }

    const diverged = titles.filter(
      (t) =>
        documentTitle(t) !==
        pageTitle({ kind: "read", title: t, view: "article", mode: DEFAULT_MODE }),
    );
    expect(diverged.slice(0, 3).map((t) => JSON.stringify(t))).toEqual([]);

    /* The control. If this ever comes back empty the corpus has stopped
       exercising anything and the assertion above means nothing. */
    const wouldHaveDiverged = titles.filter((t) => documentTitle(t) !== oldClient(t));
    expect(wouldHaveDiverged.length).toBeGreaterThan(1_000);
  });

  /**
   * **Every mode, through the served page** — the dimension the fuzz could not
   * see.
   *
   * The fuzz varies the title's *characters* and leaves `mode` absent on both
   * sides, so it fixes the one axis this case is about. `/read/x?mode=glossary`
   * was served as `Article · Spideryarn` and then replaced by React with
   * `Article · Glossary · Spideryarn`: a fourth instance of the same fault, and
   * invisible to a corpus that only ever asked about the default mode. GPT Sol
   * found it, 2026-08-30, and the phrase worth keeping is his — **the missing
   * dimension was title state, not title characters.**
   *
   * `MODES` is read from src/modes.ts rather than listed here, so an eleventh
   * mode arrives in this loop without anybody remembering to add it.
   */
  it("agrees with the client in every one of the fourteen modes", () => {
    /* Ten on one side of the 2026-08-31 merge and eleven on the other, because
       `plain` and `quotes`/`timeline` were added in parallel. Twelve was both;
       thirteen is that plus `referee`, added the same night
       (docs/plans/260831an-referee-mode-for-peer-reviewers.md). Fourteen is
       that plus `debate`, added 2026-09-05
       (docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md). */
    expect(MODES.length, "a mode was added or removed; check this still covers them").toBe(14);
    for (const mode of MODES) {
      const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), mode));
      const client = pageTitle({ kind: "read", title: "A shared piece", view: "article", mode });
      expect(d.title, mode).toBe(client);
    }
  });

  it("and spells the two ends of that out, so the loop is not comparing two bugs", () => {
    /* The default mode is left out of the title entirely — the rule in
       `readTitle`, and the reason the loop above cannot be satisfied by a
       function that simply appends every mode.

       `DEFAULT_MODE` rather than the literal it used to be. This said
       `"hierarchy"` until 2026-08-31, when the default moved to `plain` and the
       assertion started failing for the right reason — the omitted mode is
       whichever one is the default, not that particular one. Hierarchy is now
       named like any other, which is what the second half asserts. */
    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), DEFAULT_MODE)).title).toBe(
      "A shared piece · Spideryarn",
    );
    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "hierarchy")).title).toBe(
      "A shared piece · Hierarchy · Spideryarn",
    );
    expect(doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary")).title).toBe(
      "A shared piece · Glossary · Spideryarn",
    );
  });

  it("says Metadata where the client will, and drops the mode as the client does", () => {
    /* The composed head for `/read/x?about=1&mode=glossary`. `readTitle` gives a
       non-article view its own label and ignores the mode entirely, so the
       server must too — otherwise the tab reads `· Glossary ·` for a second and
       then `· Metadata ·`. Spelled out on both sides. */
    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary", "metadata"));
    expect(d.title).toBe("A shared piece · Metadata · Spideryarn");
    expect(d.title).toBe(
      /* No mode: `TitleSpec` forbids one on this view now, which is the same
         claim this line was making by hand. */
      pageTitle({ kind: "read", title: "A shared piece", view: "metadata" }),
    );
    /* And the card is still about the article, not about which of its pages the
       address named. */
    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
    expect(metaContent(d, 'meta[property="og:url"]')).toBe(
      "https://www.spideryarn.com/read/the-hard-problem",
    );
  });

  it("but keeps the mode out of the card, which is about the article", () => {
    /* A shared link is about the article, not about which panel the person who
       shared it happened to have open — and `og:url` is the mode-free address
       for the same reason. */
    const d = doc(composeShell(SHELL, head({ title: "A shared piece" }), "glossary"));
    expect(metaContent(d, 'meta[property="og:title"]')).toBe("A shared piece");
    expect(metaContent(d, 'meta[name="twitter:title"]')).toBe("A shared piece");
    expect(metaContent(d, 'meta[property="og:url"]')).not.toContain("mode");
  });

  /**
   * **The difference that remains, which is a decision rather than a drift.**
   *
   * `<title>` and `og:title` are different sinks read by different things, so
   * they are allowed to differ — and the divergence this test is about is
   * between a tab and a card, not between two copies of one rule.
   *
   * The card drops the ` · Spideryarn` suffix, because the card already carries
   * `og:site_name` and repeating it spends the visible half of the card saying
   * one word twice. And it clamps hard at 120 with no ellipsis, because an `…`
   * in published metadata is a claim that the title contained one.
   */
  it("but the card title is not the tab title, on purpose", () => {
    const long = "word ".repeat(40);
    const d = doc(composeShell(SHELL, head({ title: long })));
    const card = metaContent(d, 'meta[property="og:title"]');

    expect(card).not.toContain("…");
    expect(card).not.toContain("Spideryarn");
    /* 24 words, not 25: `headText` cuts at 120 code points — which lands on the
       space after the twenty-fourth — and trims the end, because a metadata
       string ending in a space is one that will not compare equal to the obvious
       expectation of it. Written out for the reason the case above is. */
    expect(card).toBe(Array(24).fill("word").join(" "));
    expect(card).not.toBe(d.title);
    /* And the tab, from the same document, is the client's string — so this
       case is also a check that `composeShell` uses `documentTitle` rather than
       composing a third title of its own. */
    expect(d.title).toBe(
      pageTitle({ kind: "read", title: long, view: "article", mode: DEFAULT_MODE }),
    );
  });

  it("puts the composed head between the sentinels and leaves them in place", () => {
    /* The next composition has to be able to find the region again — this
       function's output is not served twice, but the assertion is what makes
       "replace between the markers" true rather than "delete the markers and
       hope". */
    const composed = composeShell(SHELL, head());
    expect(composed.split(MANAGED_HEAD_START)).toHaveLength(2);
    expect(composed.split(MANAGED_HEAD_END)).toHaveLength(2);
    expect(composeShell(composed, head())).toBe(composed);
  });
});
