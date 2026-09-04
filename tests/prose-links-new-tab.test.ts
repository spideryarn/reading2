// @vitest-environment jsdom
/**
 * **A link out of the article opens a new tab, and one out of the app never
 * replaces the app.**
 *
 * > So I'm using Spideryarn shared to home page, and so if I click the link I
 * > certainly don't want it to open instead of Spideryarn, so then I have to
 * > click back. I wanted to open in a new blank tab or whatever.
 * >
 * > — Greg, 2026-09-04 (SPIDERYARN-READING2-10)
 *
 * Added to a home screen there is no browser chrome, so an in-place navigation
 * takes the whole app away and leaves nothing to go back with.
 *
 * The rule lives in `src/web/external-links.ts`, which is why this file runs
 * under jsdom, and it is applied by `sanitizeArticle` — the one thing every
 * article goes through on every load, so the rule reaches articles ingested
 * before it existed, and every sink `block.html` is later injected into.
 *
 * **It is deliberately not inside the sanitiser**, and the tests below run the
 * two in the order ingress runs them. It *was* a DOMPurify hook for a day
 * (0f754742), and that made the browser binding stop matching the server one —
 * `tests/sanitize-client.test.ts` is what reported it, and the top of that file
 * says why the equality is worth more than the convenience. Two halves are
 * asserted here and neither is decoration —
 *
 * - that the attributes are written on the links that leave, and
 * - that they are **not** written on the ones that do not, which is the half a
 *   regex fix would get wrong. A `mailto:` opening a blank tab is litter, and a
 *   same-origin link opening a second copy of Spideryarn is the report's own
 *   complaint pointed the other way.
 *
 * The pinned precondition — that DOMPurify strips an author's own `target` — is
 * what makes "only our pass can write one" true, and it was measured rather than
 * assumed: `src/web/TableView.tsx` carried a comment saying the opposite for
 * weeks. It is also why the order is sanitise, *then* rewrite.
 */
import { describe, expect, it } from "vitest";

import { openExternalLinksInNewTab } from "../src/web/external-links.js";
import { sanitizeArticle, sanitizeBlockHtml } from "../src/web/sanitize.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, Block } from "../src/types.js";

/** What ingress does to one block, in the order it does it. */
const ingest = (html: string) => openExternalLinksInNewTab(sanitizeBlockHtml(html));

/** The first `<a>` of a block that has been through ingress, as a real element. */
function anchor(html: string): HTMLAnchorElement | null {
  const holder = document.createElement("div");
  holder.innerHTML = ingest(html);
  return holder.querySelector("a");
}

describe("a link that leaves the app", () => {
  it("opens a new tab, without a referrer or an opener", () => {
    const a = anchor('<p><a href="https://gwern.net/xanadu">Xanadu</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the destination exactly as the author wrote it", () => {
    const href = "https://philpapers.org/rec/BUTAAT?x=1#frag";
    expect(anchor(`<p><a href="${href}">a paper</a></p>`)?.getAttribute("href")).toBe(href);
  });

  /* `http:` too, not only `https:` — an old page's links are the ones most
     likely to be worth leaving for, and a rule that covers one scheme of two
     looks exactly like a rule that covers both. */
  it("covers plain http", () => {
    const a = anchor('<p><a href="http://example.test/old">old</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
  });
});

describe("a link that does not", () => {
  it("leaves an in-article fragment alone", () => {
    const a = anchor('<p><a href="#spya-k3m9qt">above</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  it("leaves a relative link alone", () => {
    const a = anchor('<p><a href="/library">the shelf</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  /* A blank tab that hands off to the mail client and then sits there empty is
     litter, and the reader never asked for it. */
  it("leaves a mailto alone", () => {
    const a = anchor('<p><a href="mailto:hi@example.test">write</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  /* The reading view is the app; a link back into it should stay in it. jsdom
     serves `http://localhost:3000` by default, so this is a genuine
     same-origin URL rather than a contrived one. */
  it("leaves a link back into Spideryarn alone", () => {
    const a = anchor(`<p><a href="${window.location.origin}/read/x">here</a></p>`);
    expect(a?.hasAttribute("target")).toBe(false);
  });
});

/**
 * **The invariant the whole design rests on.**
 *
 * If an author's `target` could reach the reader, a publisher could aim a link
 * at `_top` and take the app away on purpose — and the hover card's tap rule,
 * which is keyed on `target="_blank"`, would be theirs to opt into as well.
 */
describe("the article may not choose its own target", () => {
  it("drops a target the publisher wrote, and writes ours instead", () => {
    const a = anchor('<p><a href="https://example.test/x" target="_top">out</a></p>');
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("drops one on a link that stays in the app", () => {
    const a = anchor('<p><a href="#spya-k3m9qt" target="_top">up</a></p>');
    expect(a?.hasAttribute("target")).toBe(false);
  });
});

/**
 * **The attack corpus, forced down the reserialising path.**
 *
 * `tests/sanitize-client.test.ts` stops at DOMPurify, and every case in it that
 * this pass would touch has no outbound link — so the pass returns early and the
 * reparse never happens. That leaves the question nobody had asked: *is parsing
 * the sanitiser's own output again and re-serialising it ever unsafe?* DOMPurify's
 * README warns in general terms that post-processing sanitised markup can
 * invalidate its guarantee, so the honest answer is a test rather than a
 * paragraph. GPT Sol asked for it, 2026-09-04.
 *
 * An outbound anchor is appended to each shape, which forces the round trip, and
 * the result is put into a real element and inspected as a DOM rather than as a
 * string — a `<script>` that the string test spelled differently would still be
 * a `<script>` here.
 */
describe("the reparse cannot reopen what the sanitiser closed", () => {
  const ATTACKS = [
    `<p>a <img src="/x.png" onerror="alert(1)"> b</p>`,
    `<p>a <svg onload="alert(1)"><circle r="5"/></svg> b</p>`,
    `<p>a <span onmouseover="alert(1)">x</span> b</p>`,
    `<p><a href="javascript:alert(1)">l</a></p>`,
    `<p>a</p><script>alert(1)</script>`,
    `<svg style="position:fixed;inset:0;width:100vw"><rect/></svg>`,
    `<style>body{display:none}</style><p>x</p>`,
    `<form action="https://evil.test"><input name="p"></form>`,
    `<mark class="cmt" data-comment="c1">x</mark>`,
    `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`,
    `<iframe src="https://www.youtube.com.evil.test/embed/x"></iframe>`,
    `<iframe src="https://www.youtube.com/embed/a" srcdoc="<script>x</script>"></iframe>`,
  ];
  const OUTBOUND = `<p><a href="https://evil.test/out">go</a></p>`;

  for (const attack of ATTACKS) {
    it(`stays clean through the round trip: ${attack.slice(0, 38)}`, () => {
      const out = ingest(attack + OUTBOUND);
      /* The guard that makes the rest mean something: if the anchor were lost,
         the pass would have returned early and reserialised nothing. */
      expect(out, "the outbound anchor must survive, or nothing was reparsed").toContain(
        'target="_blank"',
      );

      const holder = document.createElement("div");
      holder.innerHTML = out;
      expect(holder.querySelector("script, style, form, input, iframe[srcdoc]")).toBeNull();
      for (const el of Array.from(holder.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name, `${el.tagName} ${attr.name}`).not.toMatch(/^on/i);
          expect(attr.value.replace(/\s/g, "").toLowerCase(), attr.name).not.toContain(
            "javascript:",
          );
        }
      }
      /* And the forged annotation attributes are still gone — those are the ones
         a reparse would have had to invent, not merely fail to strip. */
      expect(out).not.toContain("data-comment");
    });
  }
});

/**
 * **A link that is not an `<a>`.**
 *
 * `<area>` is an image map's link and an SVG `<a>` is a link, and the SVG one
 * may spell its destination `xlink:href` — all three survive the sanitiser
 * (measured 2026-09-04). None of them appears anywhere in the local store —
 * 0 blocks of 5,301 — so this is the promise being true rather than a live hole,
 * which is the reason to pin it: nothing else would ever notice it going.
 * Found by a GPT Sol review, 2026-09-04.
 */
describe("the links that are not anchors", () => {
  it("aims an image map's link too", () => {
    const out = ingest(
      '<map name="m"><area href="https://example.test/x" shape="rect" coords="0,0,1,1"></map>',
    );
    const holder = document.createElement("div");
    holder.innerHTML = out;
    const area = holder.querySelector("area");
    expect(area?.getAttribute("target")).toBe("_blank");
    expect(area?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  /* And the destination is copied to a plain `href`, so the hover card's
     `closest("a[href]")` and the touch rule find the same link this pass did. */
  it("aims an SVG anchor that spells its destination xlink:href", () => {
    const out = ingest('<svg><a xlink:href="https://example.test/x"><text>x</text></a></svg>');
    const holder = document.createElement("div");
    holder.innerHTML = out;
    const a = holder.querySelector("a");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("href")).toBe("https://example.test/x");
  });

  it("leaves an SVG anchor that stays in the app alone", () => {
    const out = ingest('<svg><a xlink:href="#spya-k3m9qt"><text>x</text></a></svg>');
    const holder = document.createElement("div");
    holder.innerHTML = out;
    expect(holder.querySelector("a")?.hasAttribute("target")).toBe(false);
  });
});

/**
 * **The sanitiser writes no presentation attribute of its own**, which is the
 * invariant this whole change is about and which every other test here would
 * miss.
 *
 * Everything above asserts on the *composed* result, so all of it would stay
 * green if somebody moved the rule back into the shared policy — server and
 * browser would agree again, and the output would still carry `_blank`. This is
 * the assertion that would not. GPT Sol, 2026-09-04.
 */
describe("the sanitiser stays presentation-free", () => {
  it("writes no target of its own on an outbound link", () => {
    const once = sanitizeBlockHtml('<p><a href="https://gwern.net/x">g</a></p>');
    expect(once).not.toContain("target=");
    expect(once).not.toContain("noopener");
    /* And the second pass is what puts it there — so this is a statement about
       where the attribute comes from, not about it being absent. */
    expect(openExternalLinksInNewTab(once)).toContain('target="_blank"');
  });
});

/**
 * **The wiring, which is the half a unit test of a pure function cannot see.**
 *
 * Everything above composes the two passes by hand. None of it would notice if
 * `sanitizeArticle` stopped calling the second one — every assertion here would
 * stay green while every reader's links went back to replacing the app. The
 * rule was moved out of the sanitiser precisely so the two *are* separable, so
 * this guard has to come with it.
 */
describe("ingress applies it", () => {
  const block = (html: string): Block => ({
    id: "spya-aaaaaa",
    tag: "p",
    kind: "text",
    text: "t",
    words: 1,
    html,
    gistable: true,
  });
  const article = (b: Block) => ({ blocks: [b] }) as unknown as Article;

  it("sanitizeArticle aims an outbound link at a new tab", () => {
    const out = sanitizeArticle(article(block('<p><a href="https://gwern.net/x">g</a></p>')));
    expect(out.blocks[0]?.html).toContain('target="_blank"');
    expect(out.blocks[0]?.html).toContain('rel="noopener noreferrer"');
  });

  /* The identity optimisation that keeps React from rebuilding every block on
     every article load has to survive the second pass — so a block with nothing
     to rewrite must come back as the very same object. */
  it("hands back the identical block when there is nothing to rewrite", () => {
    const clean = block('<p id="spya-aaaaaa">no links here</p>');
    expect(sanitizeArticle(article(clean)).blocks[0]).toBe(clean);
  });
});

/**
 * The pass is only ever handed the sanitiser's output, and that output is
 * already a browser serialisation — so a block with no outbound link must come
 * back **byte-identical**, unparsed and unreserialised. That is what lets it sit
 * at ingress without perturbing the html of the blocks with no anchor in them,
 * which is most of an article.
 */
describe("the pass is a strict no-op when there is nothing to do", () => {
  for (const html of [
    "<p>plain prose</p>",
    '<p id="spya-k3m9qt">with an id</p>',
    '<p><a href="#spya-k3m9qt">a fragment</a></p>',
    '<p><a href="mailto:hi@example.test">mail</a></p>',
    "<ul><li>one<ul><li>nested</li></ul></li></ul>",
    '<figure><img src="/d.png" alt="d"><figcaption>Fig 1</figcaption></figure>',
  ]) {
    it(`returns its input unchanged: ${html.slice(0, 34)}`, () => {
      const once = sanitizeBlockHtml(html);
      expect(openExternalLinksInNewTab(once)).toBe(once);
    });
  }

  it("is idempotent on a link it has already rewritten", () => {
    const once = ingest('<p><a href="https://gwern.net/x">g</a></p>');
    expect(openExternalLinksInNewTab(once)).toBe(once);
  });

  /* **The whole of ingress, not just the second half.** Running the pair again
     is what a re-fetch of the same article does, and it has to land on the same
     bytes or the block is allocated afresh and React rebuilds a paragraph that
     did not change. It did not, until the attributes were removed before being
     set: the sanitiser strips `target` and keeps `rel`, so ours used to land
     after the author's and the second run produced a different order. GPT Sol
     found it, 2026-09-04. */
  it("the sanitise-then-rewrite pair is idempotent, including over an author's own rel", () => {
    for (const html of [
      '<p><a href="https://gwern.net/x">g</a></p>',
      '<p><a href="https://gwern.net/x" rel="noopener">g</a></p>',
      '<p><a href="https://gwern.net/x" rel="nofollow" title="t">g</a></p>',
    ]) {
      const once = ingest(html);
      expect(ingest(once), html).toBe(once);
    }
  });
});

/**
 * **The same three claims, over real articles rather than invented markup.**
 *
 * The cases above are one anchor in one `<p>`, which is the shape that never
 * catches a reserialisation bug: this pass reparses a block and re-serialises
 * it, so what has to be pinned is that a *whole article's* html survives that
 * round trip with nothing but the two attributes changed. Invented fixtures
 * cannot say that — the corpus can, and the committed one is the same three
 * files stage 3 wrote ([`helpers/article-from-dir.ts`](./helpers/article-from-dir.ts)).
 *
 * Measured over the whole local store on 2026-09-04 as well, which is the wider
 * version of this and cannot be committed: **5,301 blocks, 1,104 rewritten, 0
 * structural differences, 0 non-idempotent.**
 */
describe("over the committed corpus", () => {
  /** One block's html with every anchor's `target`/`rel` removed, so only structure is left. */
  function bare(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    for (const a of Array.from(div.querySelectorAll("a"))) {
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }
    return div.innerHTML;
  }

  for (const slug of ["noema-mythology-of-conscious-ai", "constitution", "openai-huggingface"]) {
    it(`changes nothing but target and rel, and is idempotent: ${slug}`, async () => {
      const { blocks } = await readArticleFromDir(`tests/fixtures/data-root/data/${slug}`);
      let rewritten = 0;
      for (const block of blocks) {
        const out = openExternalLinksInNewTab(block.html);
        expect(bare(out), `${slug} ${block.id} changed shape`).toBe(bare(block.html));
        expect(openExternalLinksInNewTab(out), `${slug} ${block.id} not idempotent`).toBe(out);
        if (out !== block.html) rewritten++;

        /* And the rule itself, over every anchor rather than a chosen one. */
        const div = document.createElement("div");
        div.innerHTML = out;
        for (const a of Array.from(div.querySelectorAll("a[href]"))) {
          const href = a.getAttribute("href") ?? "";
          const leaves = /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
          expect(a.getAttribute("target"), `${slug} ${block.id} ${href}`).toBe(
            leaves ? "_blank" : null,
          );
          if (leaves) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
        }
      }
      /* The guard that makes the zeros above mean something: a corpus with no
         outbound links would pass every assertion having tested nothing. */
      expect(rewritten, `${slug} has no outbound links — this test proved nothing`).toBeGreaterThan(
        0,
      );
    });
  }
});
