/**
 * **"Save for Spideryarn" saves the page as a file the upload path reads, with
 * its images still pointing somewhere** — src/web/save-page-bookmarklet.ts.
 * docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md § Stage 2.
 *
 * Each page is its own JSDOM at a real-looking address, so `document.baseURI`
 * is what a browser would say. What a download *is* here: the Blob handed to
 * `URL.createObjectURL` and the `download` name on the anchor that was clicked.
 *
 * The test that matters most is the address one: an upload has no address, so
 * a saved page with relative image addresses would leave stage 4.5 nothing to
 * fetch. So each `<base>` case (none, absolute, relative, several) goes all the
 * way through `readArticle(html, null)`, which is how stage 2 reads an upload,
 * and so does an in-page footnote link, which must stay in-page.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { readArticle } from "../src/extract.js";
import { decodeHtml, uploadedDocumentKind } from "../src/fetch.js";
import { MAX_UPLOAD_BYTES } from "../src/uploads.js";
import { bookmarkletHref, capturePage, savePageForSpideryarn } from "../src/web/save-page-bookmarklet.js";

type Win = Window & typeof globalThis;

interface Saved {
  blobs: Blob[];
  names: string[];
  hrefs: string[];
  revoked: string[];
  alerts: string[];
}

/** A page at `url`, with downloads, alerts and timers recorded rather than done. */
function page(html: string, url = "https://www.cell.com/article/S0092-8674(24)00001-1/fulltext") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window as unknown as Win;
  const saved: Saved = { blobs: [], names: [], hrefs: [], revoked: [], alerts: [] };
  let n = 0;
  win.URL.createObjectURL = (blob: Blob) => {
    saved.blobs.push(blob);
    return `blob:${url}/${++n}`;
  };
  win.URL.revokeObjectURL = (href: string) => void saved.revoked.push(href);
  win.alert = (message?: unknown) => void saved.alerts.push(String(message));
  win.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.names.push(this.download);
    saved.hrefs.push(this.getAttribute("href") ?? "");
  };
  return { win, saved };
}

async function text(blob: Blob): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
}

/** Enough prose that Readability takes it as an article, and two images, one relative to the path. */
function article(headExtra = "", bodyExtra = ""): string {
  const para =
    "The cells were cultured for fourteen days under controlled conditions, and the results " +
    "were measured against a control group of equal size, which is the comparison the paper rests on. ";
  return `<!doctype html><html><head><title>Cell biology: a study</title>${headExtra}</head>
<body><header>Signed in as Somebody</header><article><h1>Cell biology: a study</h1>
<p>${para.repeat(4)}</p>
<figure><img src="/figures/one.png" alt="Figure one"><figcaption>Figure one.</figcaption></figure>
<p>${para.repeat(4)}</p>
<figure><img src="images/two.png" alt="Figure two"><figcaption>Figure two.</figcaption></figure>
<p>${para.repeat(4)}</p>${bodyExtra}</article></body></html>`;
}

function imageSources(html: string): string[] {
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!);
}

async function save(html: string, url?: string) {
  const { win, saved } = page(html, url);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    savePageForSpideryarn(win, MAX_UPLOAD_BYTES, capturePage);
  } finally {
    vi.useRealTimers();
  }
  return { win, saved };
}

describe("savePageForSpideryarn", () => {
  it("downloads one .html file that the upload path calls a web page", async () => {
    const { saved } = await save(article());
    expect(saved.blobs).toHaveLength(1);
    expect(saved.blobs[0]!.type).toBe("text/html");
    expect(saved.names).toEqual(["Cell biology a study.html"]);
    const html = await text(saved.blobs[0]!);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(uploadedDocumentKind(saved.names[0]!, new TextEncoder().encode(html))).toBe("html");
  });

  it("revokes the blob URL, after a tick rather than at once", () => {
    const { win, saved } = page(article());
    vi.useFakeTimers();
    try {
      savePageForSpideryarn(win, MAX_UPLOAD_BYTES, capturePage);
      expect(saved.revoked).toEqual([]);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(saved.revoked).toEqual(saved.hrefs);
    expect(win.document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  const at = "https://www.cell.com/article/S0092/fulltext";
  const cases: { name: string; head: string; one: string; two: string }[] = [
    {
      name: "no <base>",
      head: "",
      one: "https://www.cell.com/figures/one.png",
      two: "https://www.cell.com/article/S0092/images/two.png",
    },
    {
      name: "an absolute <base>",
      head: `<base href="https://cdn.cell.com/content/">`,
      one: "https://cdn.cell.com/figures/one.png",
      two: "https://cdn.cell.com/content/images/two.png",
    },
    {
      name: "a relative <base>",
      head: `<base href="/assets/">`,
      one: "https://www.cell.com/figures/one.png",
      two: "https://www.cell.com/assets/images/two.png",
    },
    {
      name: "several <base>s, the first with an href winning, as in a browser",
      head: `<base target="_blank"><base href="/assets/"><base href="https://elsewhere.example/">`,
      one: "https://www.cell.com/figures/one.png",
      two: "https://www.cell.com/assets/images/two.png",
    },
  ];
  for (const c of cases) {
    it(`${c.name}: no <base> in the file, and the upload reads absolute image addresses`, async () => {
      const { saved } = await save(article(c.head), at);
      const html = await text(saved.blobs[0]!);
      expect(html).not.toMatch(/<base\b/i);
      expect(html).toMatch(/^<!doctype html>\n<html><head><meta charset="utf-8">/);

      const read = readArticle(html, null);
      expect(read.refusal).toBeNull();
      expect(imageSources(read.article!.content!)).toEqual([c.one, c.two]);
    });
  }

  it("leaves an in-page link in-page, through the upload", async () => {
    const { saved } = await save(
      article(
        "",
        `<p>A claim with a footnote<sup><a href="#fn1" id="ref1">1</a></sup>, and a link to ` +
          `<a href="/other">another page</a> on the same site, which is the end of it.</p>` +
          `<ol class="footnotes"><li id="fn1">The footnote itself. <a href="#ref1">back</a></li></ol>`,
      ),
      at,
    );
    const html = await text(saved.blobs[0]!);
    expect(html).toContain(`<a href="#fn1" id="ref1">`);
    expect(html).toContain(`<a href="https://www.cell.com/other">`);
    const content = readArticle(html, null).article!.content!;
    expect(content).not.toContain(`${at}#`);
    expect(content).toMatch(/href="#[^"]*fn1|href="#spya-note-/);
    expect(content).toContain(`href="https://www.cell.com/other"`);
  });

  it("makes srcset, poster and data-src absolute, and leaves what it should not touch", async () => {
    const { saved } = await save(
      article(
        "",
        `<picture><source srcset="/a.webp 1x, b.webp 2x"><img src="c.png" srcset="/c-2x.png 2x" data-src="/lazy.png"></picture>` +
          `<video poster="poster.jpg"></video>` +
          `<a href="mailto:someone@example.com">mail</a><a href="javascript:void(0)">js</a>` +
          `<img src="data:image/png;base64,AAAA"><a href="http://[bad">bad</a>`,
      ),
      at,
    );
    const html = await text(saved.blobs[0]!);
    expect(html).toContain(
      `<source srcset="https://www.cell.com/a.webp 1x, https://www.cell.com/article/S0092/b.webp 2x">`,
    );
    expect(html).toContain(
      `<img src="https://www.cell.com/article/S0092/c.png" srcset="https://www.cell.com/c-2x.png 2x" data-src="https://www.cell.com/lazy.png">`,
    );
    expect(html).toContain(`<video poster="https://www.cell.com/article/S0092/poster.jpg">`);
    expect(html).toContain(`href="mailto:someone@example.com"`);
    expect(html).not.toContain(`href="javascript:void(0)"`);
    expect(html).toContain(`src="data:image/png;base64,AAAA"`);
    expect(html).toContain(`href="http://[bad"`);
  });

  it("does not split commas inside srcset URLs, and resolves the other candidates", async () => {
    const { saved } = await save(
      article(
        "",
        `<picture><source srcset="data:image/png;base64,AAAA 1x, //cdn.example.com/two.png 2x">` +
          `<img src="fallback.png" srcset="figures/a,b.png 640w, figures/c.png 1280w">` +
          `<source srcset="figures/a b.png 1x"></picture>`,
      ),
      at,
    );
    const html = await text(saved.blobs[0]!);
    expect(html).toContain(
      `srcset="data:image/png;base64,AAAA 1x, https://cdn.example.com/two.png 2x"`,
    );
    expect(html).toContain(
      `srcset="https://www.cell.com/article/S0092/figures/a,b.png 640w, ` +
        `https://www.cell.com/article/S0092/figures/c.png 1280w"`,
    );
    expect(html).toContain(`srcset="https://www.cell.com/article/S0092/figures/a%C2%A0b.png 1x"`);
  });

  it("resolves HTML and SVG address attributes, but leaves local fragments local", async () => {
    const { saved } = await save(
      article(
        `<link rel="preload" href="styles/site.css">`,
        `<map><area href="chapters/two.html" shape="rect" coords="0,0,10,10"></map>` +
          `<svg><use href="#local"></use><use xlink:href="icons.svg#external"></use></svg>`,
      ),
      at,
    );
    const html = await text(saved.blobs[0]!);
    expect(html).toContain(`href="https://www.cell.com/article/S0092/styles/site.css"`);
    expect(html).toContain(`href="https://www.cell.com/article/S0092/chapters/two.html"`);
    expect(html).toContain(`<use href="#local"></use>`);
    expect(html).toContain(`xlink:href="https://www.cell.com/article/S0092/icons.svg#external"`);
  });

  it("removes what may be a credential, and only that", async () => {
    const { saved } = await save(
      article(
        `<meta name="csrf-token" content="secret1"><meta name="X-CSRF-Token" content="secret2">` +
          `<meta name="csrf-param" content="secret8"><meta name="_csrf" content="secret9">` +
          `<meta name="description" content="kept"><meta name="twitter:token-ish" content="kept2">` +
          `<script>var key = "secret3"</script><script type="module">import "secret10"</script>` +
          `<script type="application/json" id="__NEXT_DATA__">{"session":"secret11"}</script>` +
          `<script type="application/ld+json">{"@type":"ScholarlyArticle","name":"kept3"}</script>`,
        `<form><input type="hidden" name="authenticity_token" value="secret4">` +
          `<input type="password" value="secret5"><input name="email" value="secret6">` +
          `<input type="search" value="secret7"><input type="checkbox" id="sn-1" checked>` +
          `<input type="submit" value="Search"><input type="button" value="Show note">` +
          `<input type="image" alt="Find" value="image-secret"></form>`,
      ),
    );
    const html = await text(saved.blobs[0]!);
    for (let i = 1; i <= 11; i++) expect(html).not.toContain(`secret${i}`);
    expect(html).not.toContain("image-secret");
    expect(html).toContain(`<meta name="description" content="kept">`);
    expect(html).toContain("kept2");
    expect(html).toContain(`<script type="application/ld+json">`);
    expect(html).toContain("kept3");
    /* The value-less inputs stay, and so does the checkbox, untouched. */
    expect(html).toContain(`<input name="email">`);
    expect(html).toContain(`<input type="checkbox" id="sn-1" checked="">`);
    expect(html).toContain(`<input type="submit" value="Search">`);
    expect(html).toContain(`<input type="button" value="Show note">`);
    expect(html).toContain(`<input type="image" alt="Find">`);
    expect(html).toContain("The cells were cultured");
  });

  it("removes executable attributes and URLs while keeping data scripts the pipeline reads", async () => {
    const { saved } = await save(
      article(
        `<script type="application/ld+json">{"@type":"Article"}</script>`,
        `<a href="javascript:steal()" onclick="steal()">link</a>` +
          `<img src="javascript:steal()" onerror="steal()">` +
          `<p>The energy is <script type="math/tex">E = mc^2</script>.</p>`,
      ),
    );
    const html = await text(saved.blobs[0]!);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/(?:href|src)="\s*javascript:/i);
    expect(html).toContain(`<script type="application/ld+json">`);
    expect(html).toContain(`<script type="math/tex">E = mc^2</script>`);

    const root = page(article()).win;
    root.document.documentElement.setAttribute("onload", "steal()");
    const captured = capturePage(MAX_UPLOAD_BYTES, 0, root);
    expect(captured.kind === "page" && captured.html).not.toContain(`onload="steal()"`);
  });

  /*
   * R2-1: things stage 2 reads that a blunter list would have removed. Each
   * page, read from the bookmarklet's file with no address, gives the same
   * article as the page itself read at its address.
   */
  const kept: { name: string; body: string; shows: RegExp }[] = [
    {
      name: "a YouTube embed",
      body: `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>`,
      shows: /<iframe[^>]*youtube\.com\/embed\/dQw4w9WgXcQ/,
    },
    {
      name: "a Tufte sidenote",
      body:
        `<p>A claim that needs a note<label for="sn-a" class="margin-toggle sidenote-number"></label>` +
        `<input type="checkbox" id="sn-a" class="margin-toggle"><span class="sidenote">The sidenote's own words.</span>` +
        ` and the sentence goes on after it, as the prose of a Tufte page does.</p>`,
      shows: /The sidenote's own words\./,
    },
    {
      name: "MathJax 2 TeX",
      body: `<p>The energy is <script type="math/tex">E = mc^2</script> in the rest frame of the body.</p>`,
      shows: /E = mc\^2/,
    },
    {
      name: "a code sample in a textarea",
      body: `<p>Paste this:</p><textarea readonly>const answer = 42;</textarea>`,
      shows: /const answer = 42;/,
    },
    {
      name: "a lazy image's noscript fallback",
      body: `<figure><noscript><img src="/figures/lazy.png" alt="Lazy"></noscript></figure>`,
      shows: /lazy\.png/,
    },
  ];
  for (const k of kept) {
    it(`keeps ${k.name}: the upload reads as the page itself does`, async () => {
      const original = article("", k.body);
      const { saved } = await save(original, at);
      const html = await text(saved.blobs[0]!);
      expect(html).toMatch(k.shows);
      const fromPage = readArticle(original, at).article!.content!;
      const fromFile = readArticle(html, null).article!.content!;
      expect(fromFile).toBe(fromPage);
    });
  }

  /*
   * R2-2: a Blob of a string is UTF-8, so the file must say so and nothing else
   * may say otherwise. Through the bytes, as the upload path takes them:
   * `decodeHtml(bytes, null)` (src/pipeline.ts), then `readArticle(text, null)`.
   */
  const prose = "日本語の本文はここにあります。 A naïve reader's café, in Zürich. ";
  const charsetCases: { name: string; head: string }[] = [
    { name: "no charset declared", head: "" },
    { name: "a conflicting <meta charset>", head: `<meta charset="iso-8859-1">` },
    {
      name: "a conflicting http-equiv",
      head: `<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">`,
    },
    {
      name: "both, and twice",
      head: `<meta charset="windows-1252"><meta http-equiv="content-type" content="text/html; charset=iso-8859-1"><meta charset="shift_jis">`,
    },
  ];
  for (const c of charsetCases) {
    it(`${c.name}: one <meta charset="utf-8">, first, and the prose survives the bytes`, async () => {
      const { saved } = await save(article(c.head, `<p>${prose.repeat(3)}</p>`), at);
      const bytes = new Uint8Array(await saved.blobs[0]!.arrayBuffer());
      const { text: decoded, encoding } = decodeHtml(bytes, null);
      expect(encoding).toBe("UTF-8");
      expect(decoded).toMatch(/^<!doctype html>\n<html><head><meta charset="utf-8">/);
      expect(decoded.match(/charset/gi)).toHaveLength(1);
      expect(uploadedDocumentKind("page.html", bytes)).toBe("html");
      const read = readArticle(decoded, null);
      expect(read.article!.content!).toContain("日本語の本文はここにあります。");
      expect(read.article!.content!).toContain("A naïve reader's café, in Zürich.");
    });
  }

  it("names the file from a multibyte title, and the file is still a web page", async () => {
    const { win, saved } = page(article("", `<p>${prose}</p>`));
    win.document.title = "日本語の論文: a naïve study";
    savePageForSpideryarn(win, MAX_UPLOAD_BYTES, capturePage);
    expect(saved.names).toEqual(["日本語の論文 a naïve study.html"]);
    const bytes = new Uint8Array(await saved.blobs[0]!.arrayBuffer());
    expect(uploadedDocumentKind(saved.names[0]!, bytes)).toBe("html");
    expect(new TextDecoder().decode(bytes)).toContain("<title>日本語の論文: a naïve study</title>");
  });

  describe("the size check counts bytes", () => {
    async function sizeOf(html: string): Promise<{ bytes: number; chars: number }> {
      const { saved } = await save(html);
      return { bytes: saved.blobs[0]!.size, chars: (await text(saved.blobs[0]!)).length };
    }

    it("saves a page exactly at the limit, and refuses one byte over", async () => {
      const html = article();
      const { bytes } = await sizeOf(html);
      const exact = page(html);
      savePageForSpideryarn(exact.win, bytes, capturePage);
      expect(exact.saved.names).toHaveLength(1);
      expect(exact.saved.alerts).toEqual([]);
      const over = page(html);
      savePageForSpideryarn(over.win, bytes - 1, capturePage);
      expect(over.saved.names).toEqual([]);
      expect(over.saved.alerts).toHaveLength(1);
    });

    it("a multibyte page is measured in bytes, not characters", async () => {
      const html = article("", `<p>${prose.repeat(20)}</p>`);
      const { bytes, chars } = await sizeOf(html);
      expect(bytes).toBeGreaterThan(chars);
      const { win, saved } = page(html);
      savePageForSpideryarn(win, chars, capturePage);
      expect(saved.names).toEqual([]);
      expect(saved.alerts).toHaveLength(1);
    });
  });

  it("leaves the live page alone", async () => {
    const { win } = await save(article(`<base href="/assets/"><script>1</script>`));
    expect(win.document.querySelectorAll("script, base")).toHaveLength(2);
  });

  it("refuses a page over the cap, says so, and downloads nothing", () => {
    const { win, saved } = page(article());
    savePageForSpideryarn(win, 1000, capturePage);
    expect(saved.alerts).toHaveLength(1);
    expect(saved.alerts[0]).toMatch(/too big/);
    expect(saved.names).toEqual([]);
    expect(saved.blobs).toEqual([]);
  });

  /** The `spideryarn-saved-from` metas in a saved file, in order. */
  function savedFrom(html: string): string[] {
    const doc = new JSDOM(html).window.document;
    return [...doc.querySelectorAll('head meta[name="spideryarn-saved-from"]')].map(
      (m) => m.getAttribute("content") ?? "",
    );
  }

  it("writes where the page was saved from into its head, without the fragment", async () => {
    const { saved } = await save(
      article(),
      "https://www.cell.com/trends/cognitive-sciences/fulltext/S1364-6613(15)00180-1?rss=yes#sec1",
    );
    expect(savedFrom(await text(saved.blobs[0]!))).toEqual([
      "https://www.cell.com/trends/cognitive-sciences/fulltext/S1364-6613(15)00180-1?rss=yes",
    ]);
  });

  it("replaces a saved-from meta the page itself carried, wherever it was", async () => {
    const { saved } = await save(
      article(
        `<meta name="spideryarn-saved-from" content="https://evil.example/">`,
        `<meta name="Spideryarn-Saved-From" content="https://evil.example/body">`,
      ),
      "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001",
    );
    const html = await text(saved.blobs[0]!);
    expect(savedFrom(html)).toEqual([
      "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001",
    ]);
    expect(html).not.toContain("evil.example");
  });

  const unsavable: [string, string][] = [
    ["a file: page", "file:///home/someone/paper.html"],
    ["an address with credentials", "https://user:secret@www.cell.com/article"],
  ];
  for (const [name, url] of unsavable) {
    it(`${name}: no saved-from meta at all, and any the page carried is gone`, async () => {
      const { saved } = await save(
        article(`<meta name="spideryarn-saved-from" content="https://evil.example/">`),
        url,
      );
      const html = await text(saved.blobs[0]!);
      expect(savedFrom(html)).toEqual([]);
      expect(html).not.toContain("evil.example");
    });
  }

  const titles: [string, string][] = [
    [`A/B: "tests" <live> | why?*`, "A B tests live why.html"],
    ["Line\none\ttwo\u0007", "Line one two.html"],
    ["   ", "page.html"],
    ["", "page.html"],
    ["...", "page.html"],
    ["x".repeat(300), `${"x".repeat(120)}.html`],
  ];
  for (const [title, name] of titles) {
    it(`names the file from the title ${JSON.stringify(title.slice(0, 20))}`, async () => {
      const { win, saved } = page(article());
      win.document.title = title;
      savePageForSpideryarn(win, MAX_UPLOAD_BYTES, capturePage);
      expect(saved.names).toEqual([name]);
    });
  }
});

describe("bookmarkletHref", () => {
  it("is a javascript: URL that carries the function and the real upload cap", () => {
    const href = bookmarkletHref();
    expect(href.startsWith("javascript:")).toBe(true);
    const body = decodeURIComponent(href.slice("javascript:".length));
    expect(body).toBe(
      `void (${savePageForSpideryarn.toString()})(window,${MAX_UPLOAD_BYTES},${capturePage.toString()});`,
    );
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const revived = new Function(`return (${capturePage.toString()})`)() as typeof capturePage;
    expect(revived.toString()).toBe(capturePage.toString());
  });

  it("run as a bookmark in a page, downloads the page and returns nothing", async () => {
    const { win, saved } = page(article());
    const body = decodeURIComponent(bookmarkletHref().slice("javascript:".length));
    const result = (win as unknown as { eval: (src: string) => unknown }).eval(body);
    expect(result).toBeUndefined();
    expect(saved.names).toEqual(["Cell biology a study.html"]);
    expect(await text(saved.blobs[0]!)).toContain("The cells were cultured");
  });
});

/**
 * The capture alone, which the Chrome extension runs through `executeScript`
 * (docs/plans/261024q-chrome-extension-one-click-add-the-page.md § Stage 1).
 * The bookmarklet is `capturePage` then a download, so every test above
 * already holds what is in the string; these hold its three answers.
 */
describe("capturePage", () => {
  it("hands back the page, its file name and its size, and downloads nothing", () => {
    const { win, saved } = page(article());
    const got = capturePage(MAX_UPLOAD_BYTES, 0, win);
    if (got.kind !== "page") throw new Error(`expected a page, got ${got.kind}`);
    expect(got.filename).toBe("Cell biology a study.html");
    expect(got.bytes).toBe(new TextEncoder().encode(got.html).length);
    expect(got.html.startsWith('<!doctype html>\n<html><head><meta charset="utf-8">')).toBe(true);
    expect(saved.names).toEqual([]);
    expect(saved.alerts).toEqual([]);
  });

  it("is the same text the bookmarklet saves", async () => {
    const got = capturePage(MAX_UPLOAD_BYTES, 0, page(article()).win);
    const { saved } = await save(article());
    expect(got.kind === "page" && got.html).toBe(await text(saved.blobs[0]!));
  });

  it("says too-big, with the size, one byte over the cap", () => {
    const { win } = page(article());
    const at = capturePage(MAX_UPLOAD_BYTES, 0, win);
    if (at.kind !== "page") throw new Error("expected a page");
    expect(capturePage(at.bytes, 0, win).kind).toBe("page");
    expect(capturePage(at.bytes - 1, 0, win)).toEqual({ kind: "too-big", bytes: at.bytes });
  });

  it("says pdf for Chrome's PDF viewer, a document of type application/pdf", () => {
    const { win } = page(article());
    Object.defineProperty(win.document, "contentType", { value: "application/pdf" });
    expect(capturePage(MAX_UPLOAD_BYTES, 0, win)).toEqual({ kind: "pdf" });
  });

  it("the bookmarklet says so for a PDF, and saves nothing", () => {
    const { win, saved } = page(article());
    Object.defineProperty(win.document, "contentType", { value: "application/pdf" });
    savePageForSpideryarn(win, MAX_UPLOAD_BYTES, capturePage);
    expect(saved.names).toEqual([]);
    expect(saved.alerts[0]).toMatch(/PDF/);
  });

  it("with a message cap, refuses a page under the upload cap whose JSON is over it", () => {
    /* A quote is one byte of HTML and two of JSON (GPT Sol, 261024q F9). */
    const { win } = page(article("", `<p>${'"'.repeat(20_000)}</p>`));
    const plain = capturePage(MAX_UPLOAD_BYTES, 0, win);
    if (plain.kind !== "page") throw new Error("expected a page");
    const json = new TextEncoder().encode(JSON.stringify(plain.html)).length;
    expect(json).toBeGreaterThan(plain.bytes + 19_000);
    expect(capturePage(MAX_UPLOAD_BYTES, json, win).kind).toBe("page");
    expect(capturePage(MAX_UPLOAD_BYTES, json - 1, win)).toEqual({ kind: "too-big", bytes: plain.bytes });
  });
});
