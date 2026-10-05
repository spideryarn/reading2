/**
 * **A private link's key: what counts as one, what the predicate does with
 * one, and how it is taken off an address.** No database.
 *
 * The behaviour against real rows is tests/public-visibility-pg.test.ts. This
 * file is the part that can be read off values and generated SQL, and its job
 * is the cases that must never match: an empty key, a short one, and a caller
 * that cast its way past the type.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 */

import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { articles } from "../src/db/schema.js";
import { SHARE_KEY_CHARS, type ShareKey, parseShareKey, withoutShareKey } from "../src/share-key.js";
import { linkSharedSlug } from "../src/store/link-shared-slug.js";
import { PUBLIC_ONLY, accessFor, publicAccessWhere } from "../src/store/public-access.js";
import { mintShareKey } from "../src/store/pg-share-link.js";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";

/** The statement a predicate becomes, with nothing connected. */
function whereSql(predicate: ReturnType<typeof publicAccessWhere>) {
  return new QueryBuilder().select({ id: articles.id }).from(articles).where(predicate).toSQL();
}

describe("what counts as a key", () => {
  it("is 22 base64url characters, which is what sixteen random bytes come to", () => {
    expect(SHARE_KEY_CHARS).toBe(22);
    expect(parseShareKey(KEY)).toBe(KEY);
    expect(parseShareKey("abcdefghijklmnopqrstu-_".slice(0, 22))).not.toBeNull();
  });

  it("and a minted one is a key, and no two are the same", () => {
    const made = new Set(Array.from({ length: 200 }, () => mintShareKey()));
    expect(made.size).toBe(200);
    for (const key of made) expect(parseShareKey(key), key.length.toString()).toBe(key);
  });

  it("and nothing else is: absent, empty, short, long, or the wrong alphabet", () => {
    for (const raw of [
      null,
      undefined,
      "",
      " ",
      KEY.slice(1),
      `${KEY}A`,
      /* base64, not base64url */
      "AAAAAAAAAAAAAAAAAAAA+/",
      "AAAAAAAAAAAAAAAAAAAAA=",
      "AAAAAAAAAAAAAAAAAAAAA%",
      "AAAAAAAAAAAAAAAAAAAAA\n",
      /* What a repeated parameter or a parsed body could hand over. */
      [KEY],
      { key: KEY },
      22,
      true,
    ]) {
      expect(parseShareKey(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("the link predicate", () => {
  it("compares the slug and the token, in SQL, both bound", () => {
    const q = whereSql(linkSharedSlug("a-slug", KEY as ShareKey));
    expect(q.sql).toMatch(/"articles"\."slug" = \$1 and "spideryarn"\."articles"\."share_token" = \$2/);
    expect(q.params).toEqual(["a-slug", KEY]);
    expect(q.sql).not.toContain("owner_id");
  });

  /* The type refuses these. The function refuses them again, because the cost
     of being wrong is somebody's private article. */
  it("matches nothing for an empty key, or for a value that is not a string", () => {
    for (const forged of ["", undefined, null]) {
      const q = whereSql(linkSharedSlug("a-slug", forged as never));
      expect(q.sql, String(forged)).toMatch(/where false$/);
      expect(q.sql).not.toContain("share_token");
      expect(q.params).toEqual([]);
    }
  });
});

describe("the access value", () => {
  it("is public only when no usable key came", () => {
    expect(accessFor(null)).toEqual({ kind: "public" });
    expect(accessFor(parseShareKey(""))).toEqual({ kind: "public" });
    expect(accessFor(parseShareKey("short"))).toEqual({ kind: "public" });
    expect(accessFor(parseShareKey(KEY))).toEqual({ kind: "link", key: KEY });
  });

  it("asks for a public article, and nothing about a token, without a key", () => {
    const q = whereSql(publicAccessWhere("a-slug", PUBLIC_ONLY));
    expect(q.sql).toMatch(/where \("spideryarn"\."articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2\)$/);
    expect(q.params).toEqual(["a-slug", "public"]);
    expect(q.sql).not.toContain("share_token");
  });

  /* Public OR this key: a public article never refuses a reader for carrying
     a stale key, and a private one needs its own. The slug is in both halves,
     so a key can only ever open the article it was asked about. */
  it("asks for public or this key, each with the slug, with one", () => {
    const q = whereSql(publicAccessWhere("a-slug", accessFor(parseShareKey(KEY))));
    expect(q.sql).toMatch(
      /where \(\("spideryarn"\."articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2\) or \("spideryarn"\."articles"\."slug" = \$3 and "spideryarn"\."articles"\."share_token" = \$4\)\)$/,
    );
    expect(q.params).toEqual(["a-slug", "public", "a-slug", KEY]);
    expect(q.sql).not.toContain("owner_id");
  });
});

describe("an address with its key taken off", () => {
  it("loses the key and keeps everything else", () => {
    expect(withoutShareKey(`https://www.spideryarn.com/read/a-slug?key=${KEY}`)).toBe(
      "https://www.spideryarn.com/read/a-slug",
    );
    expect(
      withoutShareKey(`https://www.spideryarn.com/read/a-slug?mode=glossary&key=${KEY}&find=x#spya-k3m9qt`),
    ).toBe("https://www.spideryarn.com/read/a-slug?mode=glossary&find=x#spya-k3m9qt");
  });

  it("whatever the value looks like, and however many there are", () => {
    for (const address of [
      "https://www.spideryarn.com/read/a-slug?key=",
      "https://www.spideryarn.com/read/a-slug?key=half-a-key",
      `https://www.spideryarn.com/read/a-slug?key=${KEY}&key=${KEY}`,
      `https://www.spideryarn.com/read/a-slug/metadata?key=${KEY}`,
    ]) {
      const cleaned = withoutShareKey(address);
      expect(cleaned, address).not.toContain("key=");
      expect(cleaned, address).not.toContain(KEY);
    }
  });

  it("is the same string when there was no key, or no address to parse", () => {
    for (const address of [
      "https://www.spideryarn.com/read/a-slug",
      "https://www.spideryarn.com/read/a-slug?q=the monkey&find=a",
      "https://www.spideryarn.com/read?keys=1&monkey=2",
      "not an address",
      "",
    ]) {
      expect(withoutShareKey(address)).toBe(address);
    }
  });
});
