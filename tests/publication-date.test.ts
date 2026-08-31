/**
 * **The publication date, from the page to the fingerprint.**
 *
 * Readability has been handing `publishedTime` back since before this repo
 * existed and stage 2 dropped it on the floor. Timeline needs it as the
 * reference frame — the year nobody writes down, which nineteen of the
 * twenty-four temporal expressions on the test article depend on
 * (docs/plans/260831i-timeline-mode.md § The reference frame).
 *
 * Three things have to hold, and the second is the one that matters most:
 *
 * 1. A page that states a date produces one.
 * 2. **A page that does not states nothing** — no key, no empty string, no
 *    `undefined` in the hash. Every article ingested before 2026-08-31 is in
 *    this state and stays in it until re-extracted, so the no-frame path is the
 *    common path, not the edge case.
 * 3. The date reaches the fingerprint of the stage that prints it, and no
 *    further — the five stages whose prompt never names a date must not be
 *    marked stale by one arriving.
 *
 * The Readability assertions are positive controls in the style of
 * tests/extract-sanitize.test.ts: without them this file goes green the day
 * Readability stops returning `publishedTime`, proving nothing and looking
 * exactly like a passing test.
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { beforeAll, describe, expect, it } from "vitest";

import { publicationDate, runExtract } from "../src/extract.js";
import {
  articleFingerprint,
  articleWithIdsFingerprint,
  datedArticleFingerprint,
  type BlockFingerprint,
  type MetaFingerprintDated,
} from "../src/source-hash.js";
import type { Meta, Tree } from "../src/types.js";

/** Readability throws a page away unless there is enough of it. */
const prose = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p>`,
  ).join("\n");

const SOURCE = "https://example.test/an-article";

const page = (head: string) => `<!doctype html>
<html lang="en">
<head><title>An article</title>${head}</head>
<body><article>${prose(8)}</article></body>
</html>`;

const DATED = page('<meta property="article:published_time" content="2026-08-29T22:47:53+00:00">');
const UNDATED = page("");

describe("publicationDate, on the strings a page can actually contain", () => {
  it("keeps a full ISO instant in the publisher's own zone", () => {
    /* Not `toISOString()`. 8pm on 31 December in New York is 1 January in UTC,
       and the calendar day is the entire point of the field. */
    expect(publicationDate("2026-12-31T20:00:00-05:00")).toBe("2026-12-31T20:00:00-05:00");
    expect(publicationDate("2026-08-29T22:47:53+00:00")).toBe("2026-08-29T22:47:53+00:00");
    expect(publicationDate("2026-08-29T22:47:53Z")).toBe("2026-08-29T22:47:53Z");
  });

  it("takes a bare date, which is what most publishers emit", () => {
    expect(publicationDate("2026-08-29")).toBe("2026-08-29");
  });

  it("spells one offset one way, so a re-extraction cannot move the hash", () => {
    expect(publicationDate("2026-08-29T22:47:53+0000")).toBe("2026-08-29T22:47:53+00:00");
    expect(publicationDate("2026-08-29 22:47:53")).toBe("2026-08-29T22:47:53");
  });

  it("drops anything it cannot read as a date rather than guessing", () => {
    /* `Date.parse` takes all of these and reads them in the *server's* local
       zone. A silently wrong frame misdates every year-less event in the piece
       and looks like a fact; no frame at all is honest and already handled. */
    for (const junk of [
      "Last updated Tuesday",
      "July 7, 2026",
      "29/08/2026",
      "2026",
      "2026-08",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(publicationDate(junk)).toBeUndefined();
    }
  });

  it("drops a date that is well-formed and does not exist", () => {
    expect(publicationDate("2026-02-31")).toBeUndefined();
    expect(publicationDate("2026-13-01")).toBeUndefined();
    /* And keeps the leap day that does. */
    expect(publicationDate("2024-02-29")).toBe("2024-02-29");
  });
});

describe("what stage 2 writes", () => {
  let dated: Meta;
  let undated: Meta;

  beforeAll(async () => {
    dated = (await runExtract({ html: DATED, url: SOURCE, slug: "dated" })).meta;
    undated = (await runExtract({ html: UNDATED, url: SOURCE, slug: "undated" })).meta;
  });

  /* The positive control. If Readability stops returning the field, this fails
     here rather than the extraction assertion passing for the wrong reason. */
  it("Readability itself reads the date off the dated page and not off the other", () => {
    const parsed = (html: string) =>
      new Readability(new JSDOM(html, { url: SOURCE }).window.document).parse();
    expect(parsed(DATED)?.publishedTime).toBe("2026-08-29T22:47:53+00:00");
    expect(parsed(UNDATED)?.publishedTime ?? null).toBeNull();
  });

  it("carries the date into the metadata artefact when the page states one", () => {
    expect(dated.publishedAt).toBe("2026-08-29T22:47:53+00:00");
    /* Through a serialisation round trip as well as in memory. Stage 2 returns
       the artefact now rather than writing it, so this is what the filesystem
       store puts in meta.json and what the Postgres store puts in the column —
       the same `JSON.stringify` either way, which is the step the assertion
       below is really about. */
    const serialised = JSON.parse(JSON.stringify(dated)) as Meta;
    expect(serialised.publishedAt).toBe("2026-08-29T22:47:53+00:00");
  });

  /* The common case, and so the one that gets the strict assertion: the key is
     **absent**, not present and holding `undefined`. `in` rather than a falsy
     check, because `JSON.stringify` drops an undefined value — so the file on
     disk would look identical while every in-memory consumer that asks whether
     the key is there got the opposite answer. */
  it("says nothing at all when the page states no date", () => {
    expect("publishedAt" in undated).toBe(false);
    const raw = JSON.stringify(undated);
    expect(raw).not.toContain("publishedAt");
    expect(JSON.parse(raw)).not.toHaveProperty("publishedAt");
  });

  /* The confusion the field exists to prevent. `fetchedAt` is when *we*
     downloaded the page and can be fifteen years after publication, so a stage
     that reached for it as a reference frame would date every undated "on
     July 7" to the day the article happened to be ingested. */
  it("keeps fetchedAt as the separate fact it is", () => {
    expect(undated.fetchedAt).toBeTruthy();
    expect(dated.fetchedAt).toBeTruthy();
    expect(dated.fetchedAt).not.toBe(dated.publishedAt);
  });
});

describe("the date in the fingerprint", () => {
  const BLOCKS: BlockFingerprint[] = [{ id: "spya-aaaaaa", text: "One paragraph." }];
  const TREE = {
    version: "toc/2",
    generator: "fixture",
    slug: "a-slug",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        parent: null,
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: "All",
        gist: "One sentence.",
        children: [],
      },
    },
  } as unknown as Tree;

  const BASE: MetaFingerprintDated = {
    title: "An article",
    byline: "Ann Author",
    siteName: "Example",
    url: SOURCE,
  };
  const hash = (meta: MetaFingerprintDated | null) => datedArticleFingerprint(BLOCKS, TREE, meta);

  it("changes when the publication date changes", () => {
    expect(hash({ ...BASE, publishedAt: "2026-08-29" })).not.toBe(
      hash({ ...BASE, publishedAt: "2026-08-30" }),
    );
    expect(hash({ ...BASE, publishedAt: "2026-08-29" })).not.toBe(hash(BASE));
  });

  it("changes only then — the same date twice is the same hash", () => {
    expect(hash({ ...BASE, publishedAt: "2026-08-29" })).toBe(
      hash({ ...BASE, publishedAt: "2026-08-29" }),
    );
    expect(hash({ ...BASE, byline: "Bob Byline", publishedAt: "2026-08-29" })).not.toBe(
      hash({ ...BASE, publishedAt: "2026-08-29" }),
    );
  });

  it("hashes a meta with no date at all, and hashes it as absent", () => {
    expect(hash(BASE)).toMatch(/^[0-9a-f]{16}\.[0-9a-f]{16}\.[0-9a-f]{16}$/);
    /* The other spelling of absent — `{ publishedAt: undefined }`, which is
       what a careless rebuild of a `Meta` out of nullable columns produces — is
       not asserted here because it **cannot be written**: this project runs
       `exactOptionalPropertyTypes`, so the compiler rejects it, and every store
       helper already uses the conditional-spread form for exactly that reason
       (`metaFingerprintOf` in src/store/pg.ts). Asserting it would need an `as`
       cast manufacturing a state no typed caller can reach.
       And nothing stringifies the absence into the canonical form. A
       `${meta.publishedAt}` anywhere in it would make these two agree. */
    expect(hash({ ...BASE, publishedAt: "undefined" })).not.toBe(hash(BASE));
    expect(hash(null)).not.toBe(hash(BASE));
  });

  /* The reason this is a third fingerprint rather than a fourth field on
     `MetaFingerprint`. `arc`, `tweets`, `glossary`, `summary` and `quotes`
     print no date, so a date arriving by re-extraction must not mark their
     artefacts stale and re-run five paid stages for bytes no model saw. */
  it("does not reach the stages whose prompt never names a date", () => {
    const withDate = { ...BASE, publishedAt: "2026-08-29" };
    expect(articleFingerprint(BLOCKS, TREE, withDate)).toBe(articleFingerprint(BLOCKS, TREE, BASE));
    expect(articleWithIdsFingerprint(BLOCKS, TREE, withDate)).toBe(
      articleWithIdsFingerprint(BLOCKS, TREE, BASE),
    );
  });

  /* Different domain strings, so the two families can never be compared by
     accident — the module's rule for every hash in it. */
  it("is its own question, not the articleWithIds one", () => {
    expect(hash(BASE)).not.toBe(articleWithIdsFingerprint(BLOCKS, TREE, BASE));
  });
});
