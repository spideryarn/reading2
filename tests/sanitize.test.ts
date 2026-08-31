/**
 * src/sanitize.ts — the gate between a stranger's HTML and the reading view.
 *
 * Every payload here was verified to survive Mozilla Readability first, so these
 * are not hypotheticals: without the sanitiser each one reaches
 * `dangerouslySetInnerHTML` in src/web/TableView.tsx and executes. See
 * docs/project/security.md.
 *
 * The `id`/`data-*` cases matter as much as the payloads. A sanitiser that
 * strips those is "secure" and has quietly broken every block id in the
 * project — docs/project/block-ids.md.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { sanitizeHtml, sanitizeInPlace } from "../src/sanitize.js";

/** True if anything executable is left. Deliberately broad. */
const looksExecutable = (html: string) =>
  /\son\w+\s*=|javascript:|vbscript:|<script|<iframe(?![^>]*\bsandbox=)/i.test(html);

describe("sanitizeHtml — what must not survive", () => {
  const payloads: Array<[string, string]> = [
    ["img onerror", `<p>a <img src="/x.png" onerror="alert(1)"> b</p>`],
    ["svg onload", `<p>a <svg onload="alert(1)"><circle r="5"/></svg> b</p>`],
    ["span onmouseover", `<p>a <span onmouseover="alert(1)">x</span> b</p>`],
    ["video onerror", `<p><video src="x" onerror="alert(1)"></video></p>`],
    ["body onload", `<p onload="alert(1)">x</p>`],
    ["javascript: href", `<p><a href="javascript:alert(1)">link</a></p>`],
    ["vbscript: href", `<p><a href="vbscript:alert(1)">link</a></p>`],
    ["data: html src", `<p><img src="data:text/html,<script>alert(1)</script>"></p>`],
    ["script tag", `<p>a</p><script>alert(1)</script>`],
    ["mXSS via style in svg", `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`],
    ["mXSS via noscript", `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`],
    ["nested handler", `<div><ul><li><b onclick="alert(1)">deep</b></li></ul></div>`],
  ];

  for (const [name, html] of payloads) {
    it(`strips: ${name}`, () => {
      expect(looksExecutable(sanitizeHtml(html))).toBe(false);
    });
  }

  it("drops form controls, which are never prose", () => {
    const out = sanitizeHtml(
      `<form action="https://evil.test"><input name="password"><button>Go</button></form>`,
    );
    expect(out).not.toMatch(/<form|<input|<button/i);
  });
});

describe("sanitizeHtml — what must survive", () => {
  it("keeps block ids untouched", () => {
    // If this ever fails, every comment and every #spya- link in the project
    // has been orphaned. DOMPurify's SANITIZE_NAMED_PROPS is the way to break
    // it: it rewrites id to `user-content-<id>` and nothing throws.
    const out = sanitizeHtml(`<p id="spya-k3m9qt">text</p>`);
    expect(out).toContain(`id="spya-k3m9qt"`);
  });

  it("keeps ordinary data-* attributes", () => {
    // Not the annotation ones — those are reserved to the client and stripped
    // from source markup; see "does not let an article forge a comment mark".
    const out = sanitizeHtml(`<p data-footnote="3" data-lang="fr">x</p>`);
    expect(out).toContain("data-footnote");
    expect(out).toContain("data-lang");
  });

  it("keeps ordinary prose markup", () => {
    const html = `<p>An <em>emphasis</em>, a <strong>bold</strong>, a <a href="https://example.com/a">link</a>, a <code>span</code>.</p>`;
    const out = sanitizeHtml(html);
    for (const tag of ["em", "strong", "a", "code"]) expect(out).toContain(`<${tag}`);
    expect(out).toContain("https://example.com/a");
  });

  it("keeps the structures the block splitter looks for", () => {
    const out = sanitizeHtml(
      `<figure><img src="/d.png" alt="d"><figcaption>Fig 1: x</figcaption></figure>` +
        `<blockquote><p>q</p></blockquote><pre><code>const x = 1;</code></pre>` +
        `<ul><li>one<ul><li>nested</li></ul></li></ul><table><tr><td>c</td></tr></table>`,
    );
    for (const tag of ["figure", "figcaption", "blockquote", "pre", "code", "li", "table"]) {
      expect(out, tag).toContain(`<${tag}`);
    }
  });

  it("keeps inline svg, minus its handlers", () => {
    // Greg's call, 2026-08-25: inline diagrams are worth keeping.
    const out = sanitizeHtml(`<p><svg viewBox="0 0 10 10"><circle r="5"/></svg></p>`);
    expect(out).toContain("<svg");
    expect(out).toContain("circle");
  });
});

describe("video embeds", () => {
  it("keeps a YouTube embed and sandboxes it", () => {
    const out = sanitizeHtml(
      `<iframe src="https://www.youtube.com/embed/Jg7ooLzzXeg?si=abc" allow="autoplay; clipboard-write"></iframe>`,
    );
    expect(out).toContain("<iframe");
    expect(out).toContain("youtube.com/embed/Jg7ooLzzXeg");
    expect(out).toContain(`sandbox="allow-scripts allow-same-origin"`);
    // The author's permissions-policy grant is replaced, not trusted.
    expect(out).not.toContain("clipboard-write");
  });

  it("keeps a Vimeo embed", () => {
    const out = sanitizeHtml(`<iframe src="https://player.vimeo.com/video/12345"></iframe>`);
    expect(out).toContain("<iframe");
  });

  /**
   * The whole point of the allowlist. Each of these defeats a host check
   * written with `includes`, `endsWith`, or a regex without an anchor — which
   * is why the real one compares `url.origin` exactly.
   */
  const lookalikes = [
    "https://www.youtube.com.evil.test/embed/x",
    "https://evil.test/www.youtube.com/embed/x",
    "https://notyoutube.com/embed/x",
    "https://www.youtube.com.co/embed/x",
    "http://www.youtube.com/embed/x", // plain http
    "https://www.youtube.com/watch?v=x", // right origin, wrong path
    "https://evil.test/#https://www.youtube.com/embed/x",
    "//www.youtube.com/embed/x", // protocol-relative
    "javascript:alert(1)",
    "",
  ];

  for (const src of lookalikes) {
    it(`rejects lookalike: ${src || "(empty)"}`, () => {
      expect(sanitizeHtml(`<iframe src="${src}"></iframe>`)).not.toContain("<iframe");
    });
  }

  it("rejects an iframe with no src at all", () => {
    expect(sanitizeHtml(`<iframe></iframe>`)).not.toContain("<iframe");
  });
});

describe("sanitizeInPlace", () => {
  it("mutates the caller's node and leaves the head alone", () => {
    const dom = new JSDOM(
      `<!doctype html><html><head><meta charset="utf-8"><title>T</title>` +
        `<style>body { color: red; }</style></head>` +
        `<body><p id="spya-k3m9qt">a <img src="/x.png" onerror="alert(1)"></p></body></html>`,
    );
    const { document } = dom.window;
    sanitizeInPlace(document.body);

    expect(document.body.innerHTML).not.toContain("onerror");
    expect(document.body.innerHTML).toContain(`id="spya-k3m9qt"`);
    // Stage 3 writes this whole document back to disk, so the head must survive.
    const page = dom.serialize();
    expect(page).toContain("<style>body { color: red; }</style>");
    expect(page).toContain(`<meta charset="utf-8">`);
    expect(page).toContain("<title>T</title>");
  });

  it("cleans a document built by a different JSDOM than the sanitiser's", () => {
    // Stage 3 parses its own document; the purify instance has a throwaway one
    // of its own. Only strings cross between them — deliberately, since passing
    // live nodes between realms is what CVE-2026-49458 was about.
    const dom = new JSDOM(`<body><p onclick="alert(1)">x</p></body>`);
    sanitizeInPlace(dom.window.document.body);
    expect(dom.window.document.body.innerHTML).toBe("<p>x</p>");
  });

  it("strips risky attributes from the root element itself", () => {
    // Sanitising innerHTML says nothing about the node it was read from.
    const dom = new JSDOM(
      `<body onload="alert(1)" style="display:none" data-comment="c1" class="keep"><p>x</p></body>`,
    );
    const { body } = dom.window.document;
    sanitizeInPlace(body);
    expect(body.hasAttribute("onload")).toBe(false);
    expect(body.hasAttribute("style")).toBe(false);
    expect(body.hasAttribute("data-comment")).toBe(false);
    expect(body.getAttribute("class")).toBe("keep");
  });
});

describe("idempotence", () => {
  /**
   * Required, not merely tidy: `npm run blocks` writes its output back over its
   * own input file, so stage 3 routinely sanitises HTML it already sanitised.
   * If that were lossy the article would erode a little on every run.
   */
  it("sanitising twice equals sanitising once", () => {
    const samples = [
      `<p id="spya-k3m9qt">a <img src="/x.png" onerror="alert(1)"> b</p>`,
      `<iframe src="https://www.youtube.com/embed/abc"></iframe>`,
      `<figure><img src="/d.png" alt="d"><figcaption>Fig 1</figcaption></figure>`,
      `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`,
      `<ul><li>one<ul><li>nested</li></ul></li></ul>`,
    ];
    for (const html of samples) {
      const once = sanitizeHtml(html);
      expect(sanitizeHtml(once), html).toBe(once);
    }
  });
});

/**
 * Everything below came out of GPT-5's review of the first version of this
 * file, 2026-08-25. Each one is a way the sanitiser looked right and wasn't.
 */
describe("things the first draft got wrong", () => {
  it("strips author CSS, which DOMPurify does not police", () => {
    // A retained SVG with fixed positioning covers the whole reading view and
    // takes the clicks. CSS is outside DOMPurify's threat model, so it is on us.
    const out = sanitizeHtml(
      `<svg style="position:fixed;inset:0;width:100vw;height:100vh"><a href="https://evil.test"><rect width="99" height="99"/></a></svg>`,
    );
    expect(out).not.toContain("position:fixed");
    expect(out).not.toContain("style=");
  });

  it("strips <style> elements too", () => {
    expect(sanitizeHtml(`<style>body { display: none }</style><p>x</p>`)).not.toContain("<style");
  });

  it("does not let an article forge a comment mark", () => {
    // annotateHtml owns these; the reading view treats them as its own.
    const out = sanitizeHtml(
      `<p><mark class="cmt" data-comment="c1" data-mark-end="" data-open="">forged</mark></p>`,
    );
    expect(out).not.toContain("data-comment");
    expect(out).not.toContain("data-mark-end");
    expect(out).not.toContain("data-open");
    expect(out).not.toContain("cmt");
    expect(out).toContain("forged"); // the words are still the author's
  });

  it("does not let an article forge a chat mark, which is clickable", () => {
    /* `data-chat` and `data-chat-end` were missing from FORBID_ATTR until
       2026-08-26, so this passed nothing and an article could ship a mark that
       opens a conversation of the publisher's choosing in someone else's
       document. The comment above it was already right about why that matters;
       chat had simply not been added to the list. Found by a GPT Sol review. */
    const out = sanitizeHtml(
      `<p><mark class="chat" data-chat="t1" data-chat-end="">forged</mark></p>`,
    );
    expect(out).not.toContain("data-chat");
    expect(out).not.toContain("data-chat-end");
    /* **The class, too, and it was not stripped until 2026-08-28.** This file's
       header has named `chat` as one of the reserved classes since chat marks
       landed, and the hook's list was `["cmt", "term"]` the whole time. The
       assertions above could not see it: `class="chat"` does not contain the
       string `data-chat`, so the test agreed with a policy it was not checking.
       The comment above was right and the code was not. */
    expect(out).not.toMatch(/\bchat\b/);
    expect(out).toContain("forged");
  });

  it("does not let an article forge the enlarge control", () => {
    /* `zoomable` and `zoom-btn` are ours (src/web/zoomable.ts), injected into
       the prose after this sanitiser has run. Forbidding `<button>` does not
       settle it on its own, because the delegated handler in TableView finds
       the control by its class — so a forged pair would take our chrome, our
       light figure sheet and our absolutely-positioned corner. GPT Sol,
       2026-08-28. */
    const out = sanitizeHtml(
      `<p><span class="zoomable" data-zoom-kind="table"><img src="/x.png"><span class="zoom-btn">forged</span></span></p>`,
    );
    expect(out).not.toMatch(/\bzoomable\b/);
    expect(out).not.toMatch(/\bzoom-btn\b/);
    expect(out).not.toContain("data-zoom-kind");
    expect(out).toContain("forged"); // the words are still the author's
  });

  it("does not let an article forge a search or quote highlight", () => {
    /* The fourth `MarkKind`, and the one nobody had claimed. Search, ideas and
       quotes all draw `hit` marks, and `data-hues` drives the paragraph bar's
       colour count (src/web/annotate.ts) — so a forged pair reads as *the app
       having selected these words for you* and paints our rail from a
       stranger's document. `data-hit-open` had been forbidden all along, which
       is the asymmetry that gave the gap away. GPT Sol, 2026-08-31, reviewing
       docs/plans/quotes-mode.md. */
    const out = sanitizeHtml(
      `<p><mark class="hit" data-hit="q1" data-hues="3">forged</mark></p>`,
    );
    expect(out).not.toContain("data-hit");
    expect(out).not.toContain("data-hues");
    expect(out).not.toMatch(/\bhit\b/);
    expect(out).toContain("forged"); // the words are still the author's
  });

  it("does not let an article forge any of the four pressed-mark attributes", () => {
    // One per kind since 2026-08-26 — annotate.ts says why. Each is as
    // forgeable as `data-open` was, so each has to be forbidden.
    for (const attr of ["data-cmt-open", "data-chat-open", "data-hit-open", "data-term-open"]) {
      const out = sanitizeHtml(`<p><mark class="term" ${attr}="">forged</mark></p>`);
      expect(out, attr).not.toContain(attr);
    }
  });

  it("keeps a non-reserved class beside the stripped one", () => {
    const out = sanitizeHtml(`<p class="cmt lede">x</p>`);
    expect(out).toContain("lede");
    expect(out).not.toMatch(/\bcmt\b/);
  });

  it("strips srcdoc, which would put the frame in our own origin", () => {
    const out = sanitizeHtml(
      `<iframe src="https://www.youtube.com/embed/abc" srcdoc="<script>alert(1)</script>"></iframe>`,
    );
    expect(out).not.toContain("srcdoc");
  });

  it("does not grant the embed the Presentation API", () => {
    const out = sanitizeHtml(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`);
    expect(out).toContain(`sandbox="allow-scripts allow-same-origin"`);
    expect(out).not.toContain("allow-presentation");
  });

  /**
   * The allowlist compares `url.origin`, so these are the forms that defeat a
   * host check written any other way. GPT-5 verified the origin comparison
   * against all of them; pinning them here so it stays that way.
   */
  const trickyUrls = [
    "https://www.youtube.com@evil.test/embed/x", // userinfo, not host
    "https://evil.test\\@www.youtube.com/embed/x",
    "https://www.youtube.com\t.evil.test/embed/x",
    "https://xn--youtube-1n0d.com/embed/x", // punycode lookalike
    "https://WWW.YOUTUBE.COM.evil.test/embed/x",
    "https://www.youtube.com:8080/embed/x", // non-default port is a different origin
    "https://www.youtube.com/embed", // no trailing slash: not the embed path
  ];
  for (const src of trickyUrls) {
    it(`rejects: ${src}`, () => {
      expect(sanitizeHtml(`<iframe src="${src}"></iframe>`)).not.toContain("<iframe");
    });
  }

  it("accepts a path that normalises onto the embed path", () => {
    // `new URL` resolves the dot segment, and the result really is YouTube's
    // own embed URL — so accepting it is correct, not a gap.
    expect(sanitizeHtml(`<iframe src="https://www.youtube.com/../embed/x"></iframe>`)).toContain(
      "<iframe",
    );
  });

  it("accepts the host in a different case, since origins normalise", () => {
    expect(sanitizeHtml(`<iframe src="https://WWW.YouTube.com/embed/abc"></iframe>`)).toContain(
      "<iframe",
    );
  });
});
