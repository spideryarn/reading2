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
  documentTitle,
  MANAGED_HEAD_END,
  MANAGED_HEAD_START,
  PUBLIC_ORIGIN,
} from "../src/public/page-head.js";
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
       actually hurt: docs/plans/public-read-only-access.md § Stage 1. */
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
    expect([...d.title]).toHaveLength(64 + " · Spideryarn".length);
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

describe("the two copies of the title rule", () => {
  it("composes character for character what the client composes on mount", () => {
    /* `src/web/page-title.ts` imports React, so a module reached by
       `src/public/routes.ts` cannot import it (tests/public-imports.test.ts).
       `APP_NAME` and the separator are therefore duplicated in
       src/public/page-head.ts, and this is what stops the copies drifting: the
       tab a reader sees before React mounts and the one it sets afterwards are
       the same string.

       `documentTitle` is the function the composer itself calls, not a
       restatement of it — a helper the tests use and the code does not can be
       right while the code is wrong. */
    for (const title of ["The hard problem is a distraction", "A · B", "  spaced  "]) {
      expect(documentTitle(title), title).toBe(
        pageTitle({ kind: "read", title: title.trim(), view: "article" }),
      );
    }
    expect(documentTitle(null)).toBe(pageTitle({ kind: "read", title: "", view: "article" }));
    /* And the one place they deliberately differ, written down so it is a
       decision rather than a surprise: over 64 code points the client cuts at a
       word boundary and adds an ellipsis, and the head does neither, because an
       `…` in an `og:title` is a claim that the title contained one. */
    const long = "word ".repeat(40);
    expect(documentTitle(long)).not.toContain("…");
    expect(pageTitle({ kind: "read", title: long, view: "article" })).toContain("…");
  });

  /**
   * **And the second place they differ, which nobody decided** — pinned here as
   * it is, not papered over.
   *
   * The case above passes `title.trim()` to the client, which hides this: the
   * server's title goes through `headText` (src/html.ts), so internal runs of
   * whitespace collapse, control characters become a space, and bidi overrides
   * are dropped. The client's `clamp()` only trims the ends and cuts to length.
   * So for a title with a double space, a newline or an RLO in it, **the tab
   * changes the moment React mounts** — the normalised title is replaced by the
   * less normalised one. GPT Sol's review of slice 1 found it.
   *
   * This is a product decision and it is Greg's, so nothing is changed here. The
   * value of the assertion is that the divergence is now a fact somebody wrote
   * down: if either side is ever brought into line with the other, this test
   * goes red and asks whether that was on purpose.
   *
   * **Mutation: make `documentTitle` skip `headText` and only trim.** Red on
   * every `not.toBe` below — which is the point, because that is precisely the
   * "fix" that would look like tidying.
   */
  it("but diverges from the client on internal whitespace, controls and bidi — pinned, not fixed", () => {
    const cases: [string, string, string][] = [
      /* [ the title, what the server writes, what React writes over it ] */
      ["A  B", "A B · Spideryarn", "A  B · Spideryarn"],
      ["A\nB", "A B · Spideryarn", "A\nB · Spideryarn"],
      ["A\tB", "A B · Spideryarn", "A\tB · Spideryarn"],
      ["A‮B", "AB · Spideryarn", "A‮B · Spideryarn"],
    ];
    for (const [title, server, client] of cases) {
      expect(documentTitle(title), title).toBe(server);
      expect(pageTitle({ kind: "read", title, view: "article" }), title).toBe(client);
      /* Said as a comparison too, so this test is about the pair rather than
         about two independent constants that happen to be written here. */
      expect(documentTitle(title), title).not.toBe(
        pageTitle({ kind: "read", title, view: "article" }),
      );
    }
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
