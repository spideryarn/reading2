// @vitest-environment jsdom
/**
 * The **browser** sanitiser — src/web/sanitize.ts.
 *
 * Two things are being pinned here, and the second is the more important:
 *
 * 1. the browser binding applies the policy at all, and survives HTML that a
 *    stored `blocks.json` from before the sanitiser existed could contain;
 * 2. **the two bindings agree.** Two passes that disagree are worse than one
 *    pass, because the setup looks like defence in depth and is really two
 *    half-policies. `agree on every case` below is the guard against that, and
 *    it is why the config lives in src/sanitize-policy.ts rather than being
 *    written out twice.
 *
 * A caveat this file cannot fix: vitest's jsdom environment means the "browser"
 * side here is still jsdom, so this does *not* test the parser differential the
 * browser pass exists to close. It tests that the policy is wired up and
 * identical. A real Chromium test is still owed — docs/project/browser-testing.md
 * and docs/project/security.md § Known gaps.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeArticle, sanitizeBlockHtml } from "../src/web/sanitize.js";
import { sanitizeHtml as sanitizeOnServer } from "../src/sanitize.js";
import type { Article, Block } from "../src/types.js";

/** Every interesting shape, in one place, so both suites see the same corpus. */
const CORPUS: Array<[string, string]> = [
  ["img onerror", `<p>a <img src="/x.png" onerror="alert(1)"> b</p>`],
  ["svg onload", `<p>a <svg onload="alert(1)"><circle r="5"/></svg> b</p>`],
  ["span onmouseover", `<p>a <span onmouseover="alert(1)">x</span> b</p>`],
  ["javascript href", `<p><a href="javascript:alert(1)">l</a></p>`],
  ["script tag", `<p>a</p><script>alert(1)</script>`],
  ["author css", `<svg style="position:fixed;inset:0;width:100vw"><rect/></svg>`],
  ["style element", `<style>body{display:none}</style><p>x</p>`],
  ["form", `<form action="https://evil.test"><input name="p"></form>`],
  ["forged comment mark", `<mark class="cmt" data-comment="c1">x</mark>`],
  ["mXSS via style in svg", `<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">`],
  ["good embed", `<iframe src="https://www.youtube.com/embed/abc"></iframe>`],
  ["lookalike embed", `<iframe src="https://www.youtube.com.evil.test/embed/x"></iframe>`],
  ["srcdoc embed", `<iframe src="https://www.youtube.com/embed/a" srcdoc="<script>x</script>"></iframe>`],
  ["block id", `<p id="spya-k3m9qt">keep me</p>`],
  ["prose", `<p>An <em>em</em>, a <a href="https://e.com/a">link</a>, <code>c</code>.</p>`],
  ["nested list", `<ul><li>one<ul><li>nested</li></ul></li></ul>`],
  ["figure", `<figure><img src="/d.png" alt="d"><figcaption>Fig 1</figcaption></figure>`],
];

describe("the browser pass applies the policy", () => {
  const executable = /\son\w+\s*=|javascript:|<script|<style|style=/i;

  for (const [name, html] of CORPUS) {
    it(`neutralises: ${name}`, () => {
      expect(executable.test(sanitizeBlockHtml(html))).toBe(false);
    });
  }

  it("keeps block ids, which the whole project hangs off", () => {
    expect(sanitizeBlockHtml(`<p id="spya-k3m9qt">x</p>`)).toContain(`id="spya-k3m9qt"`);
  });

  it("keeps an allowlisted embed and sandboxes it", () => {
    const out = sanitizeBlockHtml(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`);
    expect(out).toContain("<iframe");
    expect(out).toContain(`sandbox="allow-scripts allow-same-origin"`);
  });

  it("drops an embed from anywhere else", () => {
    expect(
      sanitizeBlockHtml(`<iframe src="https://www.youtube.com.evil.test/embed/x"></iframe>`),
    ).not.toContain("<iframe");
  });

  it("strips a forged comment mark, so an article can't fake an annotation", () => {
    // The reason the browser pass runs BEFORE annotateHtml rather than after:
    // after annotation these attributes are legitimate and must be allowed.
    const out = sanitizeBlockHtml(`<mark class="cmt" data-comment="c1">x</mark>`);
    expect(out).not.toContain("data-comment");
    expect(out).not.toMatch(/\bcmt\b/);
    expect(out).toContain("x");
  });
});

describe("the two bindings are one policy", () => {
  for (const [name, html] of CORPUS) {
    it(`agree on: ${name}`, () => {
      expect(sanitizeBlockHtml(html)).toBe(sanitizeOnServer(html));
    });
  }

  it("the browser pass is a no-op on already-sanitised HTML", () => {
    // The common case by far: stage 3 cleaned it, so ingress should change
    // nothing and `sanitizeArticle` should hand back the very same block objects.
    for (const [, html] of CORPUS) {
      const once = sanitizeOnServer(html);
      expect(sanitizeBlockHtml(once)).toBe(once);
    }
  });
});

describe("sanitizeArticle", () => {
  const block = (id: string, html: string): Block => ({
    id, tag: "p", kind: "text", text: "t", words: 1, html, gistable: true,
  });
  const article = (blocks: Block[]) => ({ blocks }) as unknown as Article;

  it("cleans every block's html", () => {
    const out = sanitizeArticle(
      article([
        block("spya-aaaaaa", `<p id="spya-aaaaaa">ok</p>`),
        block("spya-bbbbbb", `<p id="spya-bbbbbb">bad <img src="/x" onerror="alert(1)"></p>`),
      ]),
    );
    expect(out.blocks.map((b) => b.html).join()).not.toContain("onerror");
    expect(out.blocks[1]?.html).toContain(`id="spya-bbbbbb"`);
  });

  it("leaves ids and every other field alone", () => {
    const before = article([block("spya-aaaaaa", `<p>x <img src="/y" onerror="alert(1)"></p>`)]);
    const after = sanitizeArticle(before);
    expect(after.blocks[0]?.id).toBe("spya-aaaaaa");
    expect(after.blocks[0]?.text).toBe("t");
    expect(after.blocks[0]?.words).toBe(1);
  });

  it("does not mutate the article it was given", () => {
    const dirty = `<p>x <img src="/y" onerror="alert(1)"></p>`;
    const before = article([block("spya-aaaaaa", dirty)]);
    sanitizeArticle(before);
    expect(before.blocks[0]?.html).toBe(dirty);
  });

  it("returns the identical block object when nothing changed", () => {
    // Cheap identity check keeps React from re-rendering every block on every
    // article load just because a new object was allocated.
    const clean = block("spya-aaaaaa", `<p id="spya-aaaaaa">already fine</p>`);
    const out = sanitizeArticle(article([clean]));
    expect(out.blocks[0]).toBe(clean);
  });
});

/**
 * Wiring guards.
 *
 * Everything above tests `sanitizeArticle` as a function. None of it would
 * notice if somebody deleted the one call to it in `resolveAccess` — every test here
 * would stay green while the original XSS path quietly reopened. GPT-5's review
 * called that out, 2026-08-25.
 *
 * The honest thing to say about these two: they read source text, not
 * behaviour. A mount test driving the real fetch → state → annotate → render
 * chain would be stronger, and it is still owed
 * (docs/project/security.md § Known gaps) — it needs a React testing library
 * this project doesn't have yet, and picking one is its own decision
 * (docs/reusable/third-party-library-selection.md). Until then these catch the
 * regression that actually matters: the call going missing.
 */
describe("the ingress is wired up", () => {
  // A cwd-relative path, not `new URL(..., import.meta.url)`: this file runs in
  // vitest's jsdom environment, where `import.meta.url` is an http:// URL and
  // readFileSync rejects it. Vitest runs from the repo root.
  /* The doorway left `App.tsx` for src/web/article/access.ts on 2026-09-06,
     with `ArticlePage` and the rest of the access unit. The read is what fails
     if it moves again: a path that no longer exists throws, where an assertion
     pointed at the wrong file would simply stop finding the call. */
  const ACCESS = readFileSync("src/web/article/access.ts", "utf8");

  /** The argument text of every `name(...)` call, brackets balanced. */
  function callArgs(src: string, name: string): string[] {
    const out: string[] = [];
    const needle = `${name}(`;
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
      let depth = 0;
      for (let j = i + needle.length - 1; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) {
          out.push(src.slice(i + needle.length, j));
          break;
        }
      }
    }
    return out;
  }

  /**
   * **The scan follows the doorway, not a setter's name** — and the name was a
   * liability this test has now been bitten by twice. It was `setArticle` until
   * 2026-08-27, when `ArticlePage` started storing the slug beside the payload
   * and it became `setLoaded`; on 2026-08-28 the two-step for public reading
   * arrived, the payload stopped being handed to the setter at all, and the
   * scan found nothing again. Both times the `toBeGreaterThan(0)` line is what
   * reported it, and that line is the whole reason this test is worth keeping —
   * a rename is the cheap failure, and a scan that quietly matches nothing
   * while the XSS path reopens is the expensive one.
   *
   * What it reads now is the property `resolveAccess` was split in two to have:
   * **one call to `sanitizeArticle`, and every answer that carries an article
   * carries that one value.** A second call would be a second doorway; an
   * `article:` fed by anything other than the local that call produced would be
   * a way past it.
   */
  it("every article that reaches state has been sanitised", () => {
    const calls = callArgs(ACCESS, "sanitizeArticle");
    expect(calls.length).toBeGreaterThan(0); // the scan itself must not silently find nothing
    /* Exactly one, which is what makes the rest of this checkable at all: two
       doorways would need two proofs, and the second is the one nobody
       writes. */
    expect(calls).toHaveLength(1);

    /* And its result is what the answers carry. Property shorthand (`article`
       on its own, from `const article = sanitizeArticle(…)`) is the only form
       allowed; `article: <anything>` is a second source and fails here. The
       exception is the raw two-step below it, which is deliberately not
       sanitised — it hands its payload to the doorway.

       **One exemption, added 2026-09-06**: `article: Article` immediately
       followed by `)` or `,` — a parameter annotation and nothing else. Stage E
       gave `resolveAccess` two answers to build, the first draw and the one
       with the article's own images in it, and the thing that builds both takes
       an `(article: Article)` parameter. A declaration cannot be a source of an
       unsanitised payload, where every other right-hand side can.

       **The delimiter narrows the exemption; it does not make it exact.**
       Exempting the bare word let `{ article: Article }` and
       `{ article: Article as Article }` through as value expressions, which is
       what the delimiter was added to stop. It does not stop the comma arm:
       `{ article: Article, other: 1 }` is an object property and is still
       exempted, so the rule separates a parameter annotation from a value
       expression only in the `)` case. Nothing reaches it today because
       `Article` is a type-only import and cannot be a value — which is an
       accident of another file, not a property of this scan. GPT Sol, merge
       review, 2026-09-07. `article: found.article` still fails, which is the
       assignment this test exists for.

       **And be honest about what this proves.** It is a wiring check, not a
       data-flow proof: `const article = found.article; return { …, article }`
       has always passed it, because the shorthand is matched by shape and not by
       origin. An AST check would be the real thing, and `tests/helpers/ts-ast.ts`
       is already in hand for it. The scan's value is that a *deletion* or a
       *rename* — the two ways this has actually broken, twice — cannot be
       silent. */
    const start = ACCESS.indexOf("async function resolveAccess");
    const end = ACCESS.indexOf("async function findArticle");
    /* Both anchors, checked before the slice. `indexOf` returning -1 would make
       `slice` read from the end of the file and the two assertions below would
       then hold against nothing — docs/reusable/silent-success.md. This is the
       same failure the doorway moving to `src/web/article/access.ts` on
       2026-09-06 would otherwise have caused, silently. */
    expect(start, "resolveAccess must exist in src/web/article/access.ts").toBeGreaterThan(-1);
    expect(end, "findArticle must follow it there").toBeGreaterThan(start);
    const doorway = ACCESS.slice(start, end);
    expect(doorway).toContain("sanitizeArticle(");
    expect(doorway).not.toMatch(/article:\s*(?!article\b|Article[,)])\S/);
  });

  it("the client never imports the jsdom-bound sanitiser", () => {
    // src/sanitize.ts imports jsdom at module scope. Reaching for it from the
    // client would pull a Node HTML parser into the browser bundle — or fail the
    // build, on a good day. The shared policy is the supported route.
    const clientFiles = globSync("src/web/**/*.{ts,tsx}");
    expect(clientFiles.length).toBeGreaterThan(0);
    /* **The specifier is resolved, not pattern-matched on its dots.** This was
       `/(\.\.\/)+sanitize\.js/` until 2026-09-06, which asks how many levels an
       import climbs rather than where it lands — so it read `src/web/` as flat.
       That stopped being true the moment a client file moved into a
       subdirectory: `src/web/article/access.ts` imports `../sanitize.js`, which
       is `src/web/sanitize.ts`, the client binding this whole file is *about*,
       and the old pattern called it the jsdom one. Resolving says which file,
       at any depth, and it is wrong in neither direction. */
    const nodeSanitiser = path.resolve("src/sanitize.ts");
    let resolved = 0;
    for (const file of clientFiles) {
      const src = readFileSync(file, "utf8");
      for (const [, spec] of src.matchAll(/from\s+["'](\.{1,2}\/[^"']*sanitize\.js)["']/g)) {
        resolved++;
        const target = path.resolve(path.dirname(file), spec as string).replace(/\.js$/, ".ts");
        expect(target, `${file} imports ${spec}`).not.toBe(nodeSanitiser);
      }
      expect(src, file).not.toMatch(/from\s+["']jsdom["']/);
    }
    /* The scan must have found something to resolve. Client files importing the
       *client* sanitiser are what make the loop above meaningful, and a regex
       that matched nothing would pass this test in silence —
       docs/reusable/silent-success.md. */
    expect(
      resolved,
      "no client file imports a sanitiser at all; the scan matched nothing",
    ).toBeGreaterThan(0);
  });
});
