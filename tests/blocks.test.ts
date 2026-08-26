/**
 * Pipeline stage 3 — src/blocks.ts. Two things matter here and both are
 * silent when they break: what counts as a block (docs/project/architecture.md),
 * and whether an id survives re-extraction (docs/project/block-ids.md).
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import { isSpideryarnId } from "../src/ids.js";

const ARTICLE = `
  <article>
    <h1>Soul Machine</h1>
    <p>The first paragraph carries the argument.</p>
    <p>The second paragraph continues it at some length.</p>
    <ul>
      <li>Outer item
        <ul><li>Inner item</li></ul>
      </li>
    </ul>
    <figure><img src="/diagram.png" alt="a diagram"></figure>
    <p>Figure 1: A modern version of a McCulloch-Pitts neuron.</p>
    <pre><code>const x = 1;</code></pre>
    <hr>
  </article>
`;

describe("splitIntoBlocks", () => {
  const { blocks, stats } = splitIntoBlocks(ARTICLE);
  const byText = (needle: string) => blocks.find((b) => b.text.includes(needle))!;

  it("gives every block a valid id, all distinct", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(isSpideryarnId(b.id), b.text).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it("counts what it minted", () => {
    expect(stats.total).toBe(blocks.length);
    expect(stats.minted).toBe(blocks.length);
    expect(stats.reused + stats.carried).toBe(0);
  });

  it("emits blocks in document order", () => {
    const order = blocks.map((b) => b.text);
    expect(order.indexOf("Soul Machine")).toBeLessThan(order.indexOf("The first paragraph carries the argument."));
  });

  it("classifies a heading with its level", () => {
    const h = byText("Soul Machine");
    expect(h.kind).toBe("heading");
    expect(h.level).toBe(1);
  });

  it("makes each list item its own block, nested ones included", () => {
    // The <ul> is a container, not a block; the nested item must not be
    // swallowed into its parent's text.
    const outer = byText("Outer item");
    const inner = byText("Inner item");
    expect(outer.tag).toBe("li");
    expect(inner.tag).toBe("li");
    expect(outer.text).not.toContain("Inner item");
  });

  it("marks media, rules and captions ungistable so the ToC writes no row for them", () => {
    for (const b of blocks.filter((b) => b.kind === "media" || b.tag === "hr")) {
      expect(b.gistable, b.tag).toBe(false);
    }
    const caption = byText("A modern version");
    expect(caption.kind).toBe("caption");
    expect(caption.gistable).toBe(false);
  });

  it("keeps prose gistable", () => {
    expect(byText("The first paragraph").gistable).toBe(true);
  });
});

describe("id stability", () => {
  it("reuses ids already written into the HTML", () => {
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(first.html);
    expect(second.blocks.map((b) => b.id)).toEqual(first.blocks.map((b) => b.id));
    expect(second.stats.minted).toBe(0);
    expect(second.stats.reused).toBe(second.stats.total);
  });

  it("carries ids across re-extraction, where the HTML arrives with none", () => {
    // This is the case random ids exist for: stage 2 rewrites the document from
    // Readability, so the ids are gone and only the previous blocks.json knows
    // them. Matching is on text, so an inserted paragraph must not shift anyone.
    const first = splitIntoBlocks(ARTICLE);
    const reExtracted = ARTICLE.replace(
      "<p>The second paragraph",
      "<p>A paragraph inserted by a later edit.</p>\n<p>The second paragraph",
    );
    const second = splitIntoBlocks(reExtracted, first.blocks);

    const idOf = (r: typeof first, needle: string) =>
      r.blocks.find((b) => b.text.includes(needle))!.id;

    for (const survivor of ["Soul Machine", "The first paragraph", "The second paragraph", "Inner item"]) {
      expect(idOf(second, survivor), survivor).toBe(idOf(first, survivor));
    }
    expect(isSpideryarnId(idOf(second, "inserted by a later edit"))).toBe(true);
  });

  it("re-mints blocks that carry neither text nor a src — currently just <hr>", () => {
    // Not a bug so much as the honest limit of matching on content: a rule has
    // no content. It is gistable:false and never gets a ToC row, so nothing
    // points at it — but a leaf anchored to one does go stale across a
    // re-extraction. Pinned here so a future fix is a deliberate one.
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(ARTICLE, first.blocks);
    const rule = (r: typeof first) => r.blocks.find((b) => b.tag === "hr")!.id;
    expect(rule(second)).not.toBe(rule(first));
    expect(second.stats.minted).toBe(1);
    expect(second.stats.carried).toBe(second.stats.total - 1);
  });

  it("carries a figure's id on its src, since it has no text to match on", () => {
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(ARTICLE, first.blocks);
    const figure = (r: typeof first) => r.blocks.find((b) => b.html.includes("/diagram.png"))!.id;
    expect(figure(second)).toBe(figure(first));
  });

  it("gives an edited paragraph a fresh id rather than guessing", () => {
    const first = splitIntoBlocks(ARTICLE);
    const edited = ARTICLE.replace("carries the argument", "carries a different argument entirely");
    const second = splitIntoBlocks(edited, first.blocks);
    const before = first.blocks.find((b) => b.text.includes("first paragraph"))!.id;
    const after = second.blocks.find((b) => b.text.includes("first paragraph"))!.id;
    expect(after).not.toBe(before);
  });

  it("never hands one id to two blocks that read identically", () => {
    // Two paragraphs with the same words are indistinguishable to the matcher.
    // Consuming each previous id once is what stops both claiming the same one —
    // duplicate ids would corrupt every artefact keyed on them.
    const twice = `<article><p>Time is short.</p><p>Time is short.</p></article>`;
    const first = splitIntoBlocks(twice);
    const second = splitIntoBlocks(twice, first.blocks);
    expect(new Set(second.blocks.map((b) => b.id)).size).toBe(second.blocks.length);
    expect(second.stats.carried).toBe(2);
  });
});

/**
 * Captions are excluded by their marker, never by their length. The temptation
 * is to treat short paragraphs as chrome — but the test article's "Given all
 * this, what should we do?" is seven words of genuine argument and pivots the
 * whole piece, while one of its captions runs to 94 words. Length tells you
 * nothing here, and a word-count rule would silently drop real prose out of the
 * ToC. See docs/project/table-of-contents.md.
 */
describe("caption detection is by marker, not by length", () => {
  const { blocks } = splitIntoBlocks(`
    <article>
      <p>Given all this, what should we do?</p>
      <p>Figure 2: A modern version of a McCulloch-Pitts neuron. Input signals arrive
         weighted, are summed, and the unit fires when the total clears a threshold,
         which is the abstraction the whole computational story rests upon.</p>
      <p>Credits</p>
    </article>
  `);
  const byText = (needle: string) => blocks.find((b) => b.text.includes(needle))!;

  it("keeps a short paragraph that is actually an argument", () => {
    const pivot = byText("what should we do");
    expect(pivot.words).toBeLessThan(10);
    expect(pivot.gistable).toBe(true);
  });

  it("drops a long caption, despite it being longer than the prose", () => {
    const caption = byText("McCulloch-Pitts");
    expect(caption.words).toBeGreaterThan(30);
    expect(caption.kind).toBe("caption");
    expect(caption.gistable).toBe(false);
  });

  it("drops a standalone boilerplate label", () => {
    expect(byText("Credits").gistable).toBe(false);
  });
});

/**
 * The sanitiser is wired into stage 3, not bolted onto the client — so a
 * hostile article is already clean by the time it reaches blocks.json, and
 * every later consumer inherits that. Policy lives in src/sanitize.ts and is
 * tested in tests/sanitize.test.ts; what matters here is that stage 3 actually
 * calls it, and that doing so did not disturb ids. See docs/project/security.md.
 */
describe("splitIntoBlocks sanitises", () => {
  const HOSTILE = `
    <article>
      <p id="spya-k3m9qt">Prose with an <img src="/x.png" onerror="alert(1)"> image.</p>
      <p>Prose with a <span onmouseover="alert(1)">span</span> in it.</p>
      <p>Prose with <svg onload="alert(1)"><circle r="5"/></svg> a diagram.</p>
      <ul><li>An item with <b onclick="alert(1)">a handler</b> nested inside.</li></ul>
      <script>alert(1)</script>
    </article>
  `;

  it("leaves nothing executable in any block, or in the html it writes back", () => {
    const { blocks, html } = splitIntoBlocks(HOSTILE);
    const bad = /\son\w+\s*=|javascript:|<script/i;
    for (const b of blocks) expect(bad.test(b.html), b.html).toBe(false);
    expect(bad.test(html)).toBe(false);
  });

  it("still gives every block an id, and keeps one that was already there", () => {
    const { blocks } = splitIntoBlocks(HOSTILE);
    for (const b of blocks) expect(isSpideryarnId(b.id), b.text).toBe(true);
    // Sanitising happens before ids are minted, so an id on a surviving element
    // is reused rather than replaced.
    expect(blocks.some((b) => b.id === "spya-k3m9qt")).toBe(true);
  });

  it("keeps the prose itself", () => {
    const { blocks } = splitIntoBlocks(HOSTILE);
    const text = blocks.map((b) => b.text).join(" ");
    for (const phrase of ["Prose with an", "span", "a diagram", "An item with"]) {
      expect(text).toContain(phrase);
    }
  });

  it("is idempotent across a re-run, ids and all", () => {
    // `npm run blocks` writes its html back over its own input and is re-run
    // routinely, so pass two must be a no-op.
    const first = splitIntoBlocks(HOSTILE);
    const second = splitIntoBlocks(first.html, first.blocks);
    expect(second.html).toBe(first.html);
    expect(second.blocks.map((b) => b.id)).toEqual(first.blocks.map((b) => b.id));
    expect(second.stats.minted).toBe(0);
  });
});

/**
 * Both of these are regressions the sanitiser introduced and GPT-5's review
 * caught, 2026-08-25. See docs/project/security.md.
 */
describe("splitIntoBlocks after sanitising", () => {
  it("makes an allowlisted video embed a real block, so it reaches the reader", () => {
    // The embed is kept by src/sanitize.ts, but it only reaches the client if
    // it also becomes a block — blocks.json is all the reading view ever sees.
    const { blocks } = splitIntoBlocks(
      `<article><p>Prose before the video, long enough to be a real paragraph.</p>
       <iframe src="https://www.youtube.com/embed/abc"></iframe>
       <p>Prose after the video, also long enough to count as one.</p></article>`,
    );
    const embed = blocks.find((b) => b.tag === "iframe");
    expect(embed).toBeDefined();
    expect(embed?.kind).toBe("media");
    expect(embed?.gistable).toBe(false); // nothing to write a ToC row about
    expect(isSpideryarnId(embed!.id)).toBe(true);
  });

  it("drops an embed from anywhere else entirely", () => {
    const { blocks, html } = splitIntoBlocks(
      `<article><p>Prose long enough to be a real paragraph here.</p>
       <iframe src="https://evil.test/embed/abc"></iframe></article>`,
    );
    expect(blocks.some((b) => b.tag === "iframe")).toBe(false);
    expect(html).not.toContain("evil.test");
  });

  it("keeps prose that loses its wrapper to the sanitiser", () => {
    // DOMPurify unwraps an unknown custom element but keeps its text. Without
    // rewrapping, that text is invisible to the element walk and disappears.
    const { blocks } = splitIntoBlocks(
      `<article><x-article>Prose inside a custom element that a CMS emitted.</x-article>
       <p>An ordinary paragraph following it.</p></article>`,
    );
    const text = blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Prose inside a custom element");
    expect(text).toContain("An ordinary paragraph");
    for (const b of blocks) expect(isSpideryarnId(b.id)).toBe(true);
  });

  it("carries an id across a re-extraction that ate the wrapper", () => {
    // The point of rewrapping rather than dropping: the words survive, so
    // carryOverIds can still match them. See docs/project/block-ids.md.
    const before = splitIntoBlocks(
      `<article><p>Prose inside a wrapper that is about to vanish.</p></article>`,
    );
    const after = splitIntoBlocks(
      `<article><x-article>Prose inside a wrapper that is about to vanish.</x-article></article>`,
      before.blocks,
    );
    expect(after.blocks[0]?.id).toBe(before.blocks[0]?.id);
    expect(after.stats.carried).toBe(1);
  });
});

/**
 * The matcher used to normalise text with `[^a-z0-9 ]`, which is a correct
 * spelling of "punctuation" only if the only text you have ever looked at is
 * English. In every other script it deleted the paragraph, and the failures all
 * reported success — see docs/postmortems/block-id-matching-non-latin.md.
 *
 * Every test here fails against that regex, and most of them fail silently in
 * production rather than loudly: a re-minted id is indistinguishable from a new
 * paragraph, and a dropped one from a paragraph that was never there.
 */
describe("text in a script other than Latin", () => {
  const RUSSIAN = `
    <article>
      <p>Сознание — это одна из самых трудных проблем философии.</p>
      <p>Но машины пока не дают нам ответа на этот вопрос.</p>
    </article>
  `;

  it("carries ids across a re-extraction, exactly as it does for English", () => {
    const first = splitIntoBlocks(RUSSIAN);
    const reExtracted = RUSSIAN.replace(
      "<p>Но машины",
      "<p>Вставленный позже абзац.</p>\n<p>Но машины",
    );
    const second = splitIntoBlocks(reExtracted, first.blocks);
    const idOf = (r: typeof first, needle: string) =>
      r.blocks.find((b) => b.text.includes(needle))!.id;
    for (const survivor of ["Сознание", "Но машины"]) {
      expect(idOf(second, survivor), survivor).toBe(idOf(first, survivor));
    }
    expect(second.stats.carried).toBe(2);
  });

  it("does not swap two ids between paragraphs that share only a year", () => {
    // Both of these used to normalise to "2024" — one bucket, two ids, handed
    // out by order. Re-render them the other way round and the reader's note
    // moves to a different claim, while the stage reports `carried: 2`.
    const before = `<article>
      <p>人工智能在 2024 年取得了巨大的进展。</p>
      <p>但是，关于意识的问题在 2024 年仍然没有答案。</p>
    </article>`;
    const after = `<article>
      <p>但是，关于意识的问题在 2024 年仍然没有答案。</p>
      <p>人工智能在 2024 年取得了巨大的进展。</p>
    </article>`;
    const first = splitIntoBlocks(before);
    const second = splitIntoBlocks(after, first.blocks);
    const idOf = (r: typeof first, needle: string) =>
      r.blocks.find((b) => b.text.includes(needle))!.id;
    expect(idOf(second, "人工智能")).toBe(idOf(first, "人工智能"));
    expect(idOf(second, "关于意识")).toBe(idOf(first, "关于意识"));
  });

  it("keeps Greek prose that lost its wrapper to the sanitiser", () => {
    // rewrapOrphanText asked `normalize` whether a bare text node held
    // anything, so it rewrapped English and discarded everything else.
    const { blocks } = splitIntoBlocks(
      `<article><x-article>Ελληνικό κείμενο μέσα σε ένα άγνωστο στοιχείο.</x-article>
       <p>An ordinary paragraph following it.</p></article>`,
    );
    const text = blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Ελληνικό κείμενο");
    expect(text).toContain("An ordinary paragraph");
  });

  it("keeps Japanese prose inside an unknown wrapper", () => {
    const { blocks } = splitIntoBlocks(
      `<article><span>日本語のテキストがここにあります。</span></article>`,
    );
    expect(blocks.map((b) => b.text).join(" ")).toContain("日本語のテキスト");
  });

  it("keeps prose made only of symbols, which no fold can rescue", () => {
    // ★ and © survive NFKC and are not letters or numbers, so a Unicode-aware
    // match key still folds them to nothing. Whether content exists is a
    // different question from what its match key is, and has to be asked
    // separately — otherwise this paragraph disappears either way.
    const { blocks } = splitIntoBlocks(`<article><span>★ ★ ★</span></article>`);
    expect(blocks.map((b) => b.text).join(" ")).toContain("★");
  });

  it("does not mistake an Arabic caption beside an image for an empty one", () => {
    const { blocks } = splitIntoBlocks(
      `<article><p><img src="/x.png"> صورة توضيحية للنظرية الأساسية.</p></article>`,
    );
    const p = blocks.find((b) => b.tag === "p")!;
    expect(p.note).not.toBe("image-only paragraph");
    expect(p.gistable).toBe(true);
  });

  it("matches the same word written in two Unicode normalisation forms", () => {
    // NFC café and NFD café are the same word and the same reading; only the
    // bytes differ, and which one arrives depends on the extractor's mood.
    const nfc = "Le café était fermé ce matin-là, comme toujours.".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfc).not.toBe(nfd);
    const first = splitIntoBlocks(`<article><p>${nfc}</p></article>`);
    const second = splitIntoBlocks(`<article><p>${nfd}</p></article>`, first.blocks);
    expect(second.blocks[0]?.id).toBe(first.blocks[0]?.id);
  });

  it("re-mints rather than guessing when a folded bucket is ambiguous", () => {
    // NFKC creates equivalence classes the old key did not have: ① and 1 fold
    // together, and so do Ⅳ and IV. Two previous blocks in one bucket, two new
    // ones whose raw text has moved on, and no way to tell which is which. A
    // lost anchor is safer than one attached to the wrong paragraph.
    const before = `<article><p>Note ① of the argument.</p><p>Note 1 of the argument.</p></article>`;
    const after = `<article><p>Note ① of the argument!</p><p>Note 1 of the argument!</p></article>`;
    const first = splitIntoBlocks(before);
    const second = splitIntoBlocks(after, first.blocks);
    const oldIds = new Set(first.blocks.map((b) => b.id));
    for (const b of second.blocks) expect(oldIds.has(b.id)).toBe(false);
    expect(second.stats.minted).toBe(2);
    expect(second.stats.carried).toBe(0);
  });
});

/**
 * GPT Sol reviewed the fix above and found four more wrong-anchor paths in the
 * same matcher, 2026-08-26. Each one carries a real id onto content a reader
 * would call different, and every one of them reports success.
 * See docs/postmortems/block-id-matching-non-latin.md § The second review.
 */
describe("the matcher's remaining ways to guess", () => {
  it("does not trade ids between a heading and a paragraph that read alike", () => {
    // Both sides are exact matches, so the fold's ambiguity rule never sees
    // them. What tells them apart is the tag, and the key did not carry it.
    const before = `<article><h2>Same words</h2><p>Same words</p></article>`;
    const after = `<article><p>Same words</p><h2>Same words</h2></article>`;
    const first = splitIntoBlocks(before);
    const second = splitIntoBlocks(after, first.blocks);
    const idOf = (r: typeof first, tag: string) => r.blocks.find((b) => b.tag === tag)!.id;
    expect(idOf(second, "h2")).toBe(idOf(first, "h2"));
    expect(idOf(second, "p")).toBe(idOf(first, "p"));
  });

  it("never emits one id twice, even when the document arrives with a duplicate", () => {
    // Nothing stops an author, a CMS or a bad hand-edit putting the same id on
    // two elements. Seeding `taken` from a Set hid it: both were "already
    // ours", both were reused, and blocks.json came out with a duplicate key
    // that would corrupt every artefact built on it.
    const { blocks, stats } = splitIntoBlocks(
      `<article><p id="spya-aaaaaa">one</p><p id="spya-aaaaaa">two</p></article>`,
    );
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(stats.reused).toBe(1);
    expect(stats.minted).toBe(1);
  });

  it("carries an id through ordinary punctuation drift in Cyrillic", () => {
    // The fold's actual job, in a script the old one deleted. Exact matching
    // cannot do this one, so it proves pass two runs at all.
    const first = splitIntoBlocks(`<article><p>Это — тест матчера.</p></article>`);
    const second = splitIntoBlocks(`<article><p>ЭТО - тест матчера!</p></article>`, first.blocks);
    expect(second.blocks[0]?.id).toBe(first.blocks[0]?.id);
    expect(second.stats.carried).toBe(1);
  });

  it("mints when a folded bucket is lopsided in either direction", () => {
    // Two old, one new — and one old, two new. Both used to be decided by
    // whichever `.shift()` happened to reach first.
    const twoOld = splitIntoBlocks(`<article><p>Note ①.</p><p>Note 1.</p></article>`);
    const oneNew = splitIntoBlocks(`<article><p>Note ①!</p></article>`, twoOld.blocks);
    expect(oneNew.stats.minted).toBe(1);
    expect(oneNew.stats.carried).toBe(0);

    const oneOld = splitIntoBlocks(`<article><p>Note ①.</p></article>`);
    const twoNew = splitIntoBlocks(`<article><p>Note ①!</p><p>Note 1!</p></article>`, oneOld.blocks);
    expect(twoNew.stats.minted).toBe(2);
    expect(twoNew.stats.carried).toBe(0);
  });

  it("does not carry an id between two different emoji", () => {
    // U+FE0F is a mark, so keeping \p{M} kept it — and stripping the heart and
    // the sun left both paragraphs keyed on the same invisible character. One
    // old, one new, a confident match, and completely different content.
    const first = splitIntoBlocks(`<article><p>❤️</p></article>`);
    const second = splitIntoBlocks(`<article><p>☀️</p></article>`, first.blocks);
    expect(second.blocks[0]?.id).not.toBe(first.blocks[0]?.id);
  });

  it("treats invisible characters as no content at all", () => {
    // Zero-width space, soft hyphen and a lone variation selector are all
    // non-whitespace to /\S/, so a presence test built on it admits paragraphs
    // that render as nothing.
    for (const invisible of ["​", "­", "️", "‍"]) {
      const { blocks } = splitIntoBlocks(`<article><span>${invisible}</span></article>`);
      expect(blocks.length, JSON.stringify(invisible)).toBe(0);
    }
    const { blocks } = splitIntoBlocks(`<article><p><img src="/x.png">​</p></article>`);
    expect(blocks[0]?.note).toBe("image-only paragraph");
  });

  it("skips past a previous id the document has already reused", () => {
    // Two paragraphs that read identically, one of which kept its id in the
    // HTML. The other must reach the *second* id in that bucket rather than
    // failing on the first, which is taken.
    const twice = `<article><p>Time is short.</p><p>Time is short.</p></article>`;
    const first = splitIntoBlocks(twice);
    const keptOne = `<article><p id="${first.blocks[0]!.id}">Time is short.</p><p>Time is short.</p></article>`;
    const second = splitIntoBlocks(keptOne, first.blocks);
    expect(second.stats.reused).toBe(1);
    expect(second.stats.carried).toBe(1);
    expect(second.stats.minted).toBe(0);
    expect(new Set(second.blocks.map((b) => b.id)).size).toBe(2);
  });
});

describe("internal links", () => {
  /**
   * The bug: the Anthropic constitution links to its own sections, stage 3
   * renamed the headings' ids, and the links were left pointing at fragments
   * that exist nowhere. Clicking one put the fragment in the address bar and
   * moved nothing. See src/blocks.ts § retargetAnchors.
   */
  const PAGE = `
    <article>
      <p>See the section on <a href="#corrigibility">how we think about it</a>.</p>
      <h2 id="corrigibility">How we think about corrigibility</h2>
      <p>Corrigibility does not mean blind obedience.</p>
    </article>
  `;

  it("repoints a link at the id the heading actually ended up with", () => {
    const { blocks, stats } = splitIntoBlocks(PAGE);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
    expect(blocks[0]?.html).not.toContain("#corrigibility");
    expect(stats.retargeted).toBe(1);
  });

  it("leaves a link to somebody else's page alone, fragment and all", () => {
    // `#corrigibility` is in this href too, and it is not ours to rename: the
    // link goes out to another site, whose ids we have not touched.
    const away = `<article><p><a href="https://example.test/p#corrigibility">there</a></p>
      <h2 id="corrigibility">Here</h2></article>`;
    const { blocks, stats } = splitIntoBlocks(away);
    expect(blocks[0]?.html).toContain(`href="https://example.test/p#corrigibility"`);
    expect(stats.retargeted).toBe(0);
  });

  it("leaves a fragment no block answers to alone", () => {
    // A dead link stays dead rather than being pointed somewhere plausible.
    const { blocks, stats } = splitIntoBlocks(
      `<article><p><a href="#footer">footer</a></p><p>Words.</p></article>`,
    );
    expect(blocks[0]?.html).toContain(`href="#footer"`);
    expect(stats.retargeted).toBe(0);
  });

  it("reaches a link inside a block whose html is a clone", () => {
    // `ownContent` clones an element that has nested lists, and it used to
    // clone it *before* the rewrite — so the stored html kept the old href
    // while the document had the new one.
    const nested = `<article><ul><li>Outer <a href="#appendix">link</a>
      <ul><li>Inner</li></ul></li></ul><h2 id="appendix">Appendix</h2></article>`;
    const { blocks } = splitIntoBlocks(nested);
    const outer = blocks.find((b) => b.text.startsWith("Outer"))!;
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(outer.html).toContain(`href="#${heading.id}"`);
  });

  it("matches a percent-encoded fragment against the plain id", () => {
    const encoded = `<article><p><a href="#caf%C3%A9%20noir">there</a></p>
      <h2 id="caf\u00e9 noir">Caf\u00e9 noir</h2></article>`;
    const { blocks, stats } = splitIntoBlocks(encoded);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("repoints a link whose target id the sanitiser deletes", () => {
    // DOMPurify's SANITIZE_DOM drops any `id` naming a property of `document`
    // or of a form element — `target`, `title`, `name`, `method`, `action`,
    // `links`, `images`, `forms`. Those ids are gone before the id-assignment
    // above ever sees the element, which is why the author's name is stamped
    // onto the element *before* the sanitiser runs. Without that stamp this
    // link is unrepairable and stays dead.
    const clobbery = `<article><p><a href="#target">there</a></p>
      <h2 id="target">Target</h2></article>`;
    const { blocks, stats } = splitIntoBlocks(clobbery);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("sends a link to a wrapper to the first block inside it", () => {
    // A <section> id survives stage 3 untouched, so this looks like the case
    // that needs no work. It is the opposite: a wrapper is in nobody's
    // block.html, so it is not in the rendered page at all and the link is dead
    // in the reading view while looking perfectly healthy in the document.
    const wrapped = `<article><p><a href="#methods">jump</a></p>
      <section id="methods"><h2>Methods</h2><p>What we did.</p></section></article>`;
    const { blocks, stats } = splitIntoBlocks(wrapped);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("sends a link to something inside a block to that block", () => {
    const inline = `<article><p><a href="#fn1">the note</a></p>
      <p>Text <span id="fn1">and a footnote</span>.</p></article>`;
    const { blocks } = splitIntoBlocks(inline);
    expect(blocks[0]?.html).toContain(`href="#${blocks[1]!.id}"`);
  });

  it("follows a legacy <a name> anchor", () => {
    // What a page written before ids were universal uses for the same job, and
    // `href="#note"` cannot tell you which of the two it is aiming at.
    const named = `<article><p><a href="#note">the note</a></p>
      <p><a name="note"></a>The note itself.</p></article>`;
    const { blocks, stats } = splitIntoBlocks(named);
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${blocks[1]!.id}"`);
  });

  it("resolves a duplicated id the way a browser does — the first one", () => {
    // Invalid, and common in CMS output. The browser scrolls to the first
    // element carrying the id, so that is the block this has to name.
    const twice = `<article><p><a href="#x">go</a></p>
      <p id="x">First.</p><p id="x">Second.</p></article>`;
    const { blocks } = splitIntoBlocks(twice);
    expect(blocks[0]?.html).toContain(`href="#${blocks[1]!.id}"`);
    expect(blocks[0]?.html).not.toContain(`href="#${blocks[2]!.id}"`);
  });

  it("never leaves its own scaffolding in the stored html", () => {
    // The author's name rides through the sanitiser on a data attribute. If one
    // of those ever reached blocks.json it would be article-controlled text in
    // an attribute the reading view does not expect — so both the article's own
    // copies and ours are scrubbed, and this is the check that says so.
    const forged = `<article><p data-spya-was-id="forged"><a href="#s">go</a></p>
      <h2 id="s">Section</h2></article>`;
    const { blocks, html } = splitIntoBlocks(forged);
    for (const b of blocks) expect(b.html).not.toContain("data-spya-was-id");
    expect(html).not.toContain("data-spya-was-id");
    // And the forged name is not a rename anybody can ask for.
    expect(blocks[0]?.html).not.toContain("#forged");
  });

  it("follows a standalone named anchor to the block after it", () => {
    // An empty <a name> sitting between blocks is in no block and contains
    // none, so the first three rules have nothing to say. A browser lands the
    // reader at the next thing, and so does this. It is also the shape a named
    // anchor inside a table collapses to, the parser foster-parenting it out.
    const standalone = `<article><p><a href="#note">the note</a></p>
      <a name="note"></a><h2>The note</h2><p>Body.</p></article>`;
    const { blocks, stats } = splitIntoBlocks(standalone);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("prefers the block a wrapper contains over the block it sits in", () => {
    // A nested list is both inside a block (the outer <li>) and around one (the
    // inner <li>). Climbing first answered "the outer row"; the link named the
    // inner list, and that is where it starts.
    const nested = `<article><p><a href="#inner">jump</a></p>
      <ul><li>Outer<ul id="inner"><li>Inner</li></ul></li></ul></article>`;
    const { blocks } = splitIntoBlocks(nested);
    const inner = blocks.find((b) => b.text === "Inner")!;
    expect(blocks[0]?.html).toContain(`href="#${inner.id}"`);
  });

  it("keeps the anchor name when the sanitiser unwraps its element", () => {
    // DOMPurify deletes an element it does not know and keeps the contents, so
    // a name living only on the wrapper dies with it. The name is written onto
    // the first child as well for exactly this.
    const custom = `<article><p><a href="#methods">jump</a></p>
      <x-section id="methods"><h2>Methods</h2><p>What we did.</p></x-section></article>`;
    const { blocks, stats } = splitIntoBlocks(custom);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(stats.retargeted).toBe(1);
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("lets an id beat a named anchor that claims the same word", () => {
    // The HTML spec resolves a fragment against every id in the document first
    // and only then against named anchors, so the earlier <a name> loses.
    const both = `<article><p><a href="#x">jump</a></p>
      <p><a name="x"></a>Named first.</p><h2 id="x">The id</h2></article>`;
    const { blocks } = splitIntoBlocks(both);
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });

  it("scrubs a forged stamp out of a <template>, which no query reaches", () => {
    // A DOM query does not enter template content, so a stamp in there is
    // invisible to both scrubs while `outerHTML` serialises it in full. Nothing
    // of *ours* is ever written in there — the stamping query cannot reach it
    // either — so the case that matters is one the article shipped itself, and
    // it used to survive into blocks.json.
    const templated = `<article><p>Text<template>
      <span data-spya-was-id="forged">x</span></template></p>
      <p><a href="#forged">go</a></p><h2 id="s">Section</h2></article>`;
    const { blocks, html } = splitIntoBlocks(templated);
    for (const b of blocks) expect(b.html).not.toContain("data-spya-was-");
    expect(html).not.toContain("data-spya-was-");
    // And it never named a destination, which is the other half of forging one.
    expect(blocks[1]?.html).toContain(`href="#forged"`);
  });

  it("never reads a stamp from outside the body", () => {
    // <html> and <body> sit outside the subtree the sanitiser rewrites, so an
    // attribute there crosses it untouched — which is what a forged one needs.
    // Two things stop it: the stamps are read from inside the body, and the two
    // root elements are cleared before ours are written.
    const forged = `<html data-spya-was-id="ghost" data-spya-was-name="ghost">
      <body><article><p><a href="#ghost">go</a></p><p>Words.</p></article></body></html>`;
    const { blocks, stats, html } = splitIntoBlocks(forged);
    expect(stats.retargeted).toBe(0);
    expect(blocks[0]?.html).toContain(`href="#ghost"`);
    expect(html).not.toContain("data-spya-was-");
  });

  it("is idempotent: a second run has nothing left to rewrite", () => {
    // Which is the normal case. Every re-run of stage 3 reads HTML this stage
    // already stamped, so no author id is left to rename.
    const once = splitIntoBlocks(PAGE);
    const twice = splitIntoBlocks(once.html, once.blocks);
    expect(twice.stats.retargeted).toBe(0);
    expect(twice.stats.minted).toBe(0);
    const heading = twice.blocks.find((b) => b.kind === "heading")!;
    expect(twice.blocks.find((b) => b.tag === "p")?.html).toContain(`href="#${heading.id}"`);
  });

  it("carries the rewrite across a re-extraction, which is where ids move", () => {
    // Stage 2 re-runs and the author's ids come back; the spideryarn ids are
    // carried over by text. The links have to end up pointing at the carried
    // id, not at a fresh one.
    const first = splitIntoBlocks(PAGE);
    const again = splitIntoBlocks(PAGE, first.blocks);
    expect(again.stats.minted).toBe(0);
    const heading = again.blocks.find((b) => b.kind === "heading")!;
    expect(heading.id).toBe(first.blocks.find((b) => b.kind === "heading")!.id);
    expect(again.blocks[0]?.html).toContain(`href="#${heading.id}"`);
  });
});
