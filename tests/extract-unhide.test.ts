/**
 * Stage 2 un-hides `aria-hidden="true"` before Readability looks at the page,
 * and leaves `[hidden]` and `display: none` alone.
 *
 * The reasoning and the fifteen-page evidence are on `unhideCollapsedSections`
 * in src/extract.ts. What is pinned here is the *shape* of the rule, because
 * every part of it was arrived at by measurement and each is one careless edit
 * from being widened back:
 *
 * - `[hidden]` is left alone because removing it recovered 95 characters of
 *   furniture on arxiv.org and nothing anywhere else.
 * - inline `display: none` is left alone because stripping it on Wikipedia would
 *   restore 188 MathML formulas *beside* the 188 images already rendering them.
 *
 * A rule that removed too much would not throw. It would quietly *enlarge* the
 * article, which is the direction nothing downstream checks — so the last block
 * of tests below states, as behaviour rather than as a claim of safety, the case
 * where this rule is known to admit furniture.
 */
import { describe, expect, it } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { unhideCollapsedSections, runExtract } from "../src/extract.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const doc = (html: string): Document =>
  new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() }).window.document;

describe("unhideCollapsedSections", () => {
  it("removes aria-hidden=true", () => {
    const d = doc('<div aria-hidden="true"><p>A collapsed section of the article.</p></div>');
    unhideCollapsedSections(d);
    expect(d.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("leaves aria-hidden=false alone, rather than removing the attribute wholesale", () => {
    const d = doc('<div aria-hidden="false"><p>Shown.</p></div>');
    unhideCollapsedSections(d);
    expect(d.querySelector("div")?.getAttribute("aria-hidden")).toBe("false");
  });

  it("does NOT remove [hidden] — measured as furniture, not article text", () => {
    const d = doc("<div hidden><p>View a PDF of the paper titled …</p></div>");
    unhideCollapsedSections(d);
    expect(d.querySelectorAll("[hidden]")).toHaveLength(1);
  });

  it("does NOT touch inline display:none — a stronger claim than aria-hidden", () => {
    const d = doc('<span style="display: none;"><math><mi>x</mi></math></span>');
    unhideCollapsedSections(d);
    expect(d.querySelector("span")?.getAttribute("style")).toContain("display: none");
  });

  it("changes nothing on a page with nothing hidden", () => {
    const html = "<article><p>One paragraph.</p><p>And another.</p></article>";
    const d = doc(html);
    const before = d.body.innerHTML;
    unhideCollapsedSections(d);
    expect(d.body.innerHTML).toBe(before);
  });
});

describe("what Readability then does with it", () => {
  /* Long enough that Readability keeps it: its default charThreshold is 500,
     and a fixture under that falls through to a retry with different rules and
     tests nothing anybody can reason about. */
  const para = (n: number): string =>
    `<p>${`Sentence ${n} of a genuinely long paragraph, written out at length so the extractor has something with real weight to score. `.repeat(6)}</p>`;

  const page = (attr: string): string =>
    `<html><body><article>${para(1)}${para(2)}` +
    `<div ${attr}>${para(3)}${para(4)}</div>` +
    `${para(5)}</article></body></html>`;

  const extract = (html: string, unhide: boolean): string => {
    const d = new JSDOM(html, { url: "https://example.invalid/a", virtualConsole: new VirtualConsole() })
      .window.document;
    if (unhide) unhideCollapsedSections(d);
    return new Readability(d).parse()?.textContent ?? "";
  };

  it("drops a collapsed section without the fix, and keeps it with", () => {
    /* **Watched red first.** Both halves are asserted in one test on purpose:
       either alone passes against broken code — the first against a rule that
       does nothing, the second against one that removes everything. */
    const html = page('aria-hidden="true"');
    expect(extract(html, false)).not.toContain("Sentence 3");
    expect(extract(html, true)).toContain("Sentence 3");
  });

  it("still drops a [hidden] section, because we no longer un-hide those", () => {
    const html = page("hidden");
    expect(extract(html, true)).not.toContain("Sentence 3");
  });

  it("still drops an inline display:none section", () => {
    const html = page('style="display: none"');
    expect(extract(html, true)).not.toContain("Sentence 3");
  });

  it("adds nothing to a page that hides nothing", () => {
    const html = page("data-nothing");
    expect(extract(html, true)).toBe(extract(html, false));
  });
});

describe("stage 2 actually calls it", () => {
  /* **The gap GPT Sol found, 2026-08-28.** Every test above calls
     `unhideCollapsedSections` by hand, so deleting the one line in `runExtract`
     that invokes it left this entire file green. A helper that works and is
     never called is the same article as a helper that does not work, and the
     tests could not tell the difference. This one goes through the real
     entry point. */
  const para = (n: number): string =>
    `<p>${`Sentence ${n} of a genuinely long paragraph, written out at length so the extractor has something with real weight to score. `.repeat(6)}</p>`;

  it("recovers a collapsed section through runExtract, not just through the helper", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-unhide-"));
    try {
      const outFile = path.join(dir, "out.html");
      await runExtract({
        html:
          `<html><head><title>A page with an accordion</title></head><body><article>` +
          `${para(1)}${para(2)}<div aria-hidden="true">${para(3)}${para(4)}</div>${para(5)}` +
          `</article></body></html>`,
        url: "https://example.invalid/accordion",
        outFile,
        dataDir: dir,
      });
      expect(await readFile(outFile, "utf-8")).toContain("Sentence 3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("what this rule is known to let in", () => {
  /* **Not a safety claim — the opposite.** GPT Sol's counter-example, reproduced
     here: a navigation drawer hidden by external CSS only, `aria-hidden="true"`
     on the container and no `[hidden]` or inline `display: none` for Readability
     to catch it by. Un-hiding admits it, and at thirty items it is over a
     thousand characters, which is enough to look like a win in a run that counts
     recovered characters.

     Two facts decide whether it matters, and both are here so that a future
     change to the rule shows up as a changed expectation rather than as nothing:
     it is admitted only when it sits INSIDE the article container — outside it,
     link density sinks it either way — and the fifteen-page corpus contains no
     real instance of the pattern, so "0 regressions in 15 pages" is silent about
     it. See docs/plans/readability-repair-pass.md. */
  const para = (n: number): string =>
    `<p>${`Sentence ${n} of a real paragraph of article prose, long enough for the extractor to score it properly. `.repeat(5)}</p>`;
  const drawer = `<div aria-hidden="true"><ul>${Array.from(
    { length: 30 },
    (_, i) => `<li><a href="/s${i}">Navigation item number ${i} in the mobile drawer</a></li>`,
  ).join("")}</ul></div>`;

  const extract = (html: string, unhide: boolean): string => {
    const d = new JSDOM(html, { url: "https://example.invalid/a", virtualConsole: new VirtualConsole() })
      .window.document;
    if (unhide) unhideCollapsedSections(d);
    return new Readability(d).parse()?.textContent ?? "";
  };

  const body = `<article>${para(1)}${para(2)}${para(3)}${para(4)}</article>`;

  it("keeps a hidden nav drawer OUT when it sits beside the article", () => {
    const html = `<html><body><div class="shell">${drawer}${body}</div></body></html>`;
    expect(extract(html, true)).not.toContain("Navigation item number 17");
  });

  it("lets a hidden nav drawer IN when it sits inside the article — known, unfixed", () => {
    const html =
      `<html><body><div class="shell"><article>${drawer}` +
      `${para(1)}${para(2)}${para(3)}${para(4)}</article></div></body></html>`;
    const gained = extract(html, true).length - extract(html, false).length;
    expect(extract(html, true)).toContain("Navigation item number 17");
    /* Over the runner's 1,000-character "recovered a lot" bar, which is the
       whole reason that flag is no longer allowed to suppress the READ THEM
       warning in evals/extraction/corpus.mts. */
    expect(gained).toBeGreaterThan(1000);
  });
});
