/**
 * **The holdout selector, checked rather than believed.**
 *
 * GPT Sol's review of
 * [260904e](../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md)
 * found `evals/extraction/wcxb.mts` had no test at all, and three claims in it
 * that nothing checked: that the selection is order-independent, that
 * `selectHoldout` knows which split it was handed, and that re-running it
 * reproduces the committed file. The last two were false — `opts.split` was
 * copied into the output as a label, and `selectedOn` read the clock.
 *
 * **The 84 MB archive is deliberately not committed** (`wcxb.mts` says why), so
 * every record here is synthetic. That is not a shortcut: what is under test is
 * the *selection function*, and a function that takes a list of records is best
 * tested with a list of records whose eligibility you chose on purpose. The one
 * thing the archive would add — that the recorded 200 really are the top 200 of
 * a real `test` split — is unreachable here and is not claimed. What *is*
 * reachable, and is checked at the bottom, is that the committed file is
 * internally consistent with its own recorded seed: 200 unique ids ranked in
 * the order this code ranks them. A hand-edited or truncated selection fails it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_FIXTURES } from "../evals/extraction/corpus.mjs";
import {
  HOLDOUT,
  WCXB,
  holdoutRank,
  selectHoldout,
  type WcxbRecordInSplit,
} from "../evals/extraction/wcxb.mjs";

const ON = "2026-09-05";

/**
 * Overrides accept an explicit `undefined` where `WcxbRecordInSplit` merely
 * allows the key to be absent. That is the point: the records this file has to
 * produce are the malformed ones — no `url`, no `_internal` — and under
 * `exactOptionalPropertyTypes` "absent" and "present and undefined" are
 * different types, while `JSON.parse` produces the second one.
 */
type Overrides = {
  url?: string | undefined;
  _internal?: { page_type?: { primary?: string; confidence?: string } } | undefined;
  _split?: "dev" | "test" | undefined;
  pageType?: string;
};

/** One synthetic record, eligible unless you make it otherwise. */
function mk(file_id: string, over: Overrides = {}): WcxbRecordInSplit {
  const { pageType = "article", ...rest } = over;
  const base = {
    schema_version: "1.0",
    file_id,
    url: `https://example-${file_id}.test/article`,
    _split: "test" as const,
    _internal: { page_type: { primary: pageType, confidence: "high" } },
    ground_truth: { title: `page ${file_id}`, main_content: "words words words" },
  };
  return { ...base, ...rest } as WcxbRecordInSplit;
}

const many = (n: number): WcxbRecordInSplit[] =>
  Array.from({ length: n }, (_, i) => mk(String(1000 + i)));

/** A deterministic shuffle, so "order-independent" is not tested by luck. */
function shuffled<T>(xs: T[], seed: string): T[] {
  const keyed = xs.map((x, i) => ({
    x,
    k: createHash("sha256").update(`${seed}:${i}`).digest("hex"),
  }));
  keyed.sort((a, b) => a.k.localeCompare(b.k));
  return keyed.map((e) => e.x);
}

const OPTS = {
  seed: "test-seed",
  size: 10,
  split: "test" as const,
  custodian: "nobody",
  selectedOn: ON,
};

describe("selectHoldout is deterministic and order-independent", () => {
  it("gives the identical selection twice over", () => {
    const records = many(40);
    expect(selectHoldout(records, OPTS)).toEqual(selectHoldout(records, OPTS));
  });

  it("does not depend on the order the records arrived in", () => {
    const records = many(40);
    const straight = selectHoldout(records, OPTS);
    const jumbled = selectHoldout(shuffled(records, "jumble"), OPTS);
    expect(jumbled.chosen).toEqual(straight.chosen);
    // The whole record, not only `chosen`: the excluded lists are part of the
    // selection's provenance, and one of them used to be in input order.
    expect(jumbled).toEqual(straight);
  });

  it("keeps the excluded lists order-independent too", () => {
    const fixtureUrls = [ALL_FIXTURES[0]!.url, ALL_FIXTURES[1]!.url, ALL_FIXTURES[2]!.url];
    const records = fixtureUrls.map((url, i) => mk(String(2000 + i), { url }));
    const straight = selectHoldout(records, OPTS);
    const backwards = selectHoldout([...records].reverse(), OPTS);
    expect(straight.excluded.exactUrlOverlap).toHaveLength(3);
    expect(backwards.excluded.exactUrlOverlap).toEqual(straight.excluded.exactUrlOverlap);
  });

  it("selects different pages under a different seed", () => {
    const records = many(40);
    const a = selectHoldout(records, OPTS);
    const b = selectHoldout(records, { ...OPTS, seed: "a-different-seed" });
    expect(b.chosen).not.toEqual(a.chosen);
    // Not merely reshuffled: a different seed reaches different pages.
    const idsA = new Set(a.chosen.map((c) => c.file_id));
    expect(b.chosen.some((c) => !idsA.has(c.file_id))).toBe(true);
  });
});

describe("every exclusion filter excludes, and is counted", () => {
  const chosenIds = (rs: WcxbRecordInSplit[]) =>
    new Set(selectHoldout(rs, OPTS).chosen.map((c) => c.file_id));

  it("drops a record whose URL is verbatim one of ours", () => {
    const url = ALL_FIXTURES[0]!.url;
    const records = [...many(5), mk("dupe", { url })];
    const sel = selectHoldout(records, OPTS);
    expect(sel.excluded.exactUrlOverlap).toEqual([url]);
    expect(chosenIds(records).has("dupe")).toBe(false);
  });

  it("drops a record on a fixture host, and names the host", () => {
    const host = new URL(ALL_FIXTURES[0]!.url).host.replace(/^www\./, "");
    const records = [...many(5), mk("same-host", { url: `https://${host}/some-other-page` })];
    const sel = selectHoldout(records, OPTS);
    expect(sel.excluded.hostOverlap).toEqual([host]);
    expect(sel.excluded.exactUrlOverlap).toEqual([]);
    expect(chosenIds(records).has("same-host")).toBe(false);
  });

  it("drops anything the dataset does not label an article", () => {
    const records = [
      ...many(5),
      mk("forum", { pageType: "forum" }),
      mk("product", { pageType: "product" }),
      mk("untyped", { _internal: undefined }),
    ];
    const sel = selectHoldout(records, OPTS);
    expect(sel.excluded.nonArticle).toBe(3);
    const ids = chosenIds(records);
    expect(ids.has("forum")).toBe(false);
    expect(ids.has("product")).toBe(false);
    expect(ids.has("untyped")).toBe(false);
  });

  it("drops a record with no url at all", () => {
    const records = [...many(5), mk("urlless", { url: undefined })];
    const sel = selectHoldout(records, OPTS);
    expect(sel.excluded.noUrl).toBe(1);
    expect(sel.excluded.nonArticle).toBe(0);
    expect(chosenIds(records).has("urlless")).toBe(false);
  });

  it("counts nothing when there is nothing to exclude", () => {
    const sel = selectHoldout(many(20), OPTS);
    expect(sel.excluded).toEqual({
      exactUrlOverlap: [],
      hostOverlap: [],
      nonArticle: 0,
      noUrl: 0,
    });
    expect(sel.chosen).toHaveLength(10);
  });
});

describe("size is the number actually chosen", () => {
  it("caps at the requested size", () => {
    const sel = selectHoldout(many(40), { ...OPTS, size: 7 });
    expect(sel.chosen).toHaveLength(7);
    expect(sel.size).toBe(7);
  });

  it("reports the smaller number when fewer are eligible", () => {
    const records = [...many(4), mk("forum", { pageType: "forum" }), mk("u", { url: undefined })];
    const sel = selectHoldout(records, { ...OPTS, size: 200 });
    expect(sel.chosen).toHaveLength(4);
    expect(sel.size).toBe(4);
    expect(sel.size).toBe(sel.chosen.length);
  });
});

describe("the split is verified, not labelled", () => {
  it("accepts records stamped with the split it was asked for", () => {
    const sel = selectHoldout(many(12), OPTS);
    expect(sel.split).toBe("test");
    expect(sel.chosen).toHaveLength(10);
  });

  it("refuses a dev record smuggled into a test-split selection", () => {
    const records = [...many(12), mk("smuggled", { _split: "dev" })];
    expect(() => selectHoldout(records, OPTS)).toThrow(/dev/);
  });

  it("refuses a record carrying no split at all", () => {
    const naked = { ...mk("naked"), _split: undefined } as unknown as WcxbRecordInSplit;
    expect(() => selectHoldout([...many(12), naked], OPTS)).toThrow();
  });

  it("selects a dev holdout when the records really are dev", () => {
    const records = many(12).map((r) => ({ ...r, _split: "dev" as const }));
    const sel = selectHoldout(records, { ...OPTS, split: "dev" });
    expect(sel.split).toBe("dev");
    expect(sel.chosen).toHaveLength(10);
  });
});

describe("selectedOn is supplied, not read off the clock", () => {
  it("puts the given date in the selection", () => {
    expect(selectHoldout(many(12), { ...OPTS, selectedOn: "2020-01-02" }).selectedOn).toBe(
      "2020-01-02",
    );
  });

  it("makes two identical calls byte-for-byte identical", () => {
    const records = many(40);
    const a = selectHoldout(records, OPTS);
    const b = selectHoldout(records, OPTS);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.selectedOn).toBe(ON);
  });

  it("refuses anything that is not a plain YYYY-MM-DD", () => {
    expect(() =>
      selectHoldout(many(12), { ...OPTS, selectedOn: new Date().toISOString() }),
    ).toThrow(/selectedOn/);
  });
});

describe("the committed selection is consistent with its own seed", () => {
  const file = path.join("evals", "results", "wcxb-holdout-selection.json");
  const committed = JSON.parse(readFileSync(file, "utf-8")) as ReturnType<typeof selectHoldout>;

  it("records the seed, split and page type the code says it used", () => {
    expect(committed.seed).toBe(HOLDOUT.seed);
    expect(committed.split).toBe(HOLDOUT.split);
    expect(committed.pageType).toBe("article");
    expect(committed.dataset.doi).toBe(WCXB.doi);
    expect(committed.scores).toBe("text-selection-only");
  });

  it("carries the dataset facts the code still asserts — bar one recorded drift", () => {
    const { alsoKnownAs, ...rest } = committed.dataset as typeof WCXB & { alsoKnownAs?: string };
    expect(rest).toEqual(WCXB);
    /* The committed file was written on 2026-09-05, while `WCXB` still claimed
       the dataset was also called *WCEB*. That claim was fetched against the
       live repo and Zenodo record the same day, found in neither, and dropped —
       so the file on disk carries one key the code no longer emits.
       **Regenerating it needs the 84 MB archive, which is not committed**, so
       the difference is recorded here rather than hand-edited into agreement.
       When somebody does re-run the selection this assertion goes red, and the
       right response is to delete these six lines. */
    expect(alsoKnownAs).toBe("WCEB");
  });

  it("carries the custodian string the code no longer writes — the second recorded drift", () => {
    /**
     * Same reason, same day, same remedy. The custodian ceremony was dropped on
     * 2026-09-05 in favour of running the holdout in its own agent (260904e § B,
     * *Two decisions*), so `HOLDOUT.custodian` now records who is **answerable**
     * rather than describing a mechanism. The committed file predates that and
     * still reads as though the line were the mechanism.
     *
     * Pinned rather than hand-edited, so that regenerating the selection reddens
     * this and nothing else silently changes underneath it. Delete this test when
     * the file is regenerated from the archive.
     */
    expect(committed.custodian).not.toBe(HOLDOUT.custodian);
    expect(committed.custodian).toBe(
      "Greg Detre — holds the frozen thresholds; nobody opens a page before they are frozen",
    );
  });

  it("holds `size` distinct pages, each on the host its URL says", () => {
    expect(committed.chosen).toHaveLength(committed.size);
    expect(committed.size).toBe(HOLDOUT.size);
    expect(new Set(committed.chosen.map((c) => c.file_id)).size).toBe(committed.size);
    expect(new Set(committed.chosen.map((c) => c.url)).size).toBe(committed.size);
    for (const c of committed.chosen) {
      expect(c.host).toBe(new URL(c.url).host.replace(/^www\./, ""));
    }
  });

  it("is in the rank order this seed produces — so a hand-edit shows up", () => {
    const ranks = committed.chosen.map((c) => holdoutRank(committed.seed, c.file_id));
    expect(ranks).toEqual([...ranks].sort((a, b) => a.localeCompare(b)));
  });

  it("excludes no fixture of ours, and says so rather than being silent", () => {
    const fixtureUrls = new Set(ALL_FIXTURES.map((f) => f.url));
    const fixtureHosts = new Set(
      ALL_FIXTURES.map((f) => {
        try {
          return new URL(f.url).host.replace(/^www\./, "");
        } catch {
          return "";
        }
      }).filter(Boolean),
    );
    for (const c of committed.chosen) {
      expect(fixtureUrls.has(c.url)).toBe(false);
      expect(fixtureHosts.has(c.host)).toBe(false);
    }
  });
});
