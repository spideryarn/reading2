/**
 * **The owner's inventory of what a shared link carries** — and the two ways it
 * could quietly become a lie.
 *
 * The list under the sharing switch is the one place in this app where being
 * wrong means an owner published somebody else's article believing something
 * different from what happened. So the suite is not "does it render three
 * lists": it is the two specific failures.
 *
 * 1. **A mode drifts out of the list.** `sharedInventory` sweeps `MODES` through
 *    `visitorGap`, so a fourteenth mode is covered whether or not whoever adds
 *    it opens the file. The sweep below is what says so, and the positive
 *    control is that the same call, with the same modes, produces *different*
 *    buckets under different artefacts — a partition that never moves looks
 *    exactly like one that is not being computed.
 * 2. **A key reaches the wire with no row.** `WIRE_ROW` is a total
 *    `Record<keyof PublicArticle, …>`, so adding a field to the public payload
 *    is a red compiler here. That is the guard, and it is at compile time
 *    because a runtime one would need a whole `publicArticle` fixture and would
 *    still only cover the keys the fixture happened to set.
 *
 * And the trap the whole slice exists because of, at the bottom: `available`
 * means *the column is not null*, never *the stage is current*.
 * docs/plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md.
 */
import { describe, expect, it } from "vitest";

import { MODES, type Mode } from "../src/modes.js";
import type { Glossary, PublicArtefacts } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
import { sharedInventory, type InventoryItem } from "../src/web/shared-inventory.js";
import { ARTEFACT_KEYS, asPublicArtefacts } from "../src/web/AccessSharing.js";
import { shareableArtefacts } from "../src/store/pg.js";

const NOTHING: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
};
const EVERYTHING: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
};

const keys = (items: InventoryItem[]): string[] => items.map((i) => i.key);

/**
 * **The five rows that appear or do not according to a flag**, and which flag
 * each one reads.
 *
 * Written out rather than derived from `PublicArtefacts`, because three of them
 * are mode rows reached through `visitorGap`'s own table and two are hand-added
 * beside it — so this is the mapping under test, not a restatement of it. A
 * sixth artefact reaching the wire wants a line here.
 */
const FLAG = {
  glossary: "glossary",
  ideas: "ideas",
  quotes: "quotes",
  arc: "arc",
  tweets: "tweets",
} as const satisfies Record<string, keyof PublicArtefacts>;
const ROWS = Object.keys(FLAG) as (keyof typeof FLAG)[];

describe("the sweep over the modes", () => {
  /* **The partition, and it is asserted as a partition rather than as three
     lists.** A row appearing twice is the failure that reads best on screen and
     is worst in fact: the owner is told a thing both goes out and stays. */
  it.each([
    ["nothing built", NOTHING],
    ["everything built", EVERYTHING],
  ])("puts every mode but Plain in exactly one list, with %s", (_name, available) => {
    const { shared, ifBuilt, withheld } = sharedInventory(available);
    const all = [...keys(shared), ...keys(ifBuilt), ...keys(withheld)];
    expect(new Set(all).size).toBe(all.length);
    for (const mode of MODES) {
      if (mode === "plain") {
        expect(all).not.toContain(mode);
        continue;
      }
      expect(all).toContain(mode);
    }
  });

  /* **The positive control for the two above.** They would both pass over a
     function that put every mode in `withheld` and never looked at `available`,
     which is precisely the shape a careless refactor produces. */
  it("moves the artefact rows between the lists as the artefacts appear", () => {
    const none = sharedInventory(NOTHING);
    const all = sharedInventory(EVERYTHING);
    for (const key of ROWS) {
      expect(keys(none.ifBuilt)).toContain(key);
      expect(keys(none.shared)).not.toContain(key);
      expect(keys(all.shared)).toContain(key);
      expect(keys(all.ifBuilt)).not.toContain(key);
    }
  });

  /**
   * **One flag at a time, because all-false against all-true proves almost
   * nothing.**
   *
   * GPT Sol's list of mutations that would have stayed green, 2026-09-02, and
   * every one of them is a cross-wiring: `arc` never read at all (it was not,
   * for a day); Glossary consulting `available.ideas`; a parser that assigns
   * `arc: row.tweets`. Two symmetric fixtures agree with all of those. Turning
   * exactly one flag on and asserting that exactly one row moves does not.
   */
  it.each(ROWS)("moves %s and nothing else when only that one exists", (key) => {
    const oneOn = sharedInventory({ ...NOTHING, [FLAG[key]]: true });
    expect(keys(oneOn.shared)).toContain(key);
    for (const other of ROWS) {
      if (other === key) continue;
      expect(keys(oneOn.ifBuilt), `${other} moved when only ${key} exists`).toContain(other);
    }
  });

  /**
   * **Never-built is not the same answer as never-shared**, and this is the
   * distinction the third bucket exists for. An owner told "your glossary is
   * not shared" who then builds one has been misled: it goes out, and nothing
   * asks again.
   */
  it("never files a missing artefact under what stays with you", () => {
    const { withheld } = sharedInventory(NOTHING);
    for (const key of ROWS) {
      expect(keys(withheld)).not.toContain(key);
    }
  });

  /* The six that cost a model call or are somebody's own work, whatever has
     been generated. Written out rather than derived, deliberately: this is the
     test asserting the policy, and a test that derives its expectation from the
     code under test asserts nothing. */
  const OWNERS_ONLY: Mode[] = ["chat", "search", "remember", "referee", "diagram", "timeline"];
  it.each(OWNERS_ONLY)("keeps %s with the owner whatever exists", (mode) => {
    expect(keys(sharedInventory(NOTHING).withheld)).toContain(mode);
    expect(keys(sharedInventory(EVERYTHING).withheld)).toContain(mode);
  });

  /* The four that cost nothing and are drawn from the payload the visitor
     already holds — the whole point of the feature, so they are pinned. */
  it.each(["hierarchy", "outline", "summary"])("always shares %s", (mode) => {
    expect(keys(sharedInventory(NOTHING).shared)).toContain(mode);
  });

  it("always lists the text, the pictures and where it came from", () => {
    expect(keys(sharedInventory(NOTHING).shared)).toEqual(
      expect.arrayContaining(["text", "pictures", "provenance"]),
    );
  });

  /**
   * **The five that are not modes**, which the sweep cannot see and which a
   * refactor can therefore drop in silence.
   *
   * Each is settled in a different file — the projection in src/public/dto.ts,
   * the reader's `select` in src/store/public-reader.ts, `SeeTheOriginal` in
   * src/web/Masthead.tsx — so there is nothing structural holding them here.
   * Written out by key, which is what makes deleting one a red test rather than
   * a shorter list.
   */
  it("always names the owner's own work, which no mode covers", () => {
    expect(keys(sharedInventory(EVERYTHING).withheld)).toEqual(
      expect.arrayContaining([
        "comments",
        "lookups",
        "profile",
        "rename",
        "original",
        "provenance-internal",
      ]),
    );
  });

  /* Every row says something, and nothing says the same thing twice. A label
     with no tooltip is a row the owner cannot act on; two rows with one
     sentence is the copy having been pasted. */
  it("gives every row its own label and its own sentence", () => {
    const { shared, ifBuilt, withheld } = sharedInventory(EVERYTHING);
    const rows = [...shared, ...ifBuilt, ...withheld];
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.detail.length).toBeGreaterThan(10);
    }
    expect(new Set(rows.map((r) => r.detail)).size).toBe(rows.length);
  });
});

/**
 * **Every key the public payload can carry has a row in the list.**
 *
 * A total record, so a field added to `PublicArticle` fails to compile until
 * somebody decides which line of the owner's inventory covers it. That decision
 * is the one this slice is about, and the compiler is the only thing that can
 * force it at the moment the field is added rather than the month after.
 *
 * The values are inventory keys from `sharedInventory`, and the runtime half
 * below checks they exist — so a renamed row is caught too.
 */
const WIRE_ROW = {
  meta: "provenance",
  blocks: "text",
  assets: "pictures",
  /* The tree is three rows, because it is three things the owner recognises:
     the nested contents, the flat outline, and the gists down the page. Any one
     of them proves the tree crosses. */
  tree: "hierarchy",
  /* The arc has no mode of its own — it is the extra rung Outline draws when
     there is one. src/web/visitor.ts § outline. */
  arc: "outline",
  glossary: "glossary",
  ideas: "ideas",
  quotes: "quotes",
  tweets: "tweets",
} satisfies Record<keyof PublicArticle, string>;

describe("the list against the wire", () => {
  it("names a row for every key a shared payload can carry", () => {
    const { shared } = sharedInventory(EVERYTHING);
    for (const row of Object.values(WIRE_ROW)) {
      expect(keys(shared)).toContain(row);
    }
  });
});

describe("reading the flags off the wire", () => {
  it("covers every artefact, so none can be validated into existence by omission", () => {
    const probe: Record<keyof PublicArtefacts, true> = {
      arc: true,
      tweets: true,
      glossary: true,
      ideas: true,
      quotes: true,
    };
    expect([...ARTEFACT_KEYS].sort()).toEqual(Object.keys(probe).sort());
  });

  it("accepts the five booleans", () => {
    expect(asPublicArtefacts(EVERYTHING)).toEqual(EVERYTHING);
  });

  /**
   * **Each flag read from its own key**, one at a time.
   *
   * `asPublicArtefacts` reads five keys by hand, so `arc: row.tweets` is a live
   * typo — it compiles, and an all-true fixture accepts it. GPT Sol listed it,
   * 2026-09-02. A one-hot body is the only shape that catches a cross-wire.
   */
  it.each(["arc", "tweets", "glossary", "ideas", "quotes"] as const)(
    "reads %s from its own key and not another's",
    (key) => {
      const oneOn = { ...NOTHING, [key]: true };
      expect(asPublicArtefacts(oneOn)).toEqual(oneOn);
    },
  );

  /* **A missing key is not a `false`.** Defaulting would tell an owner their
     glossary stays private, which is the exact sentence this slice exists to
     stop being guessed at. */
  it.each(["arc", "tweets", "glossary", "ideas", "quotes"])(
    "refuses a body with no %s, rather than defaulting it",
    (missing) => {
      const partial: Record<string, unknown> = { ...EVERYTHING };
      delete partial[missing];
      expect(asPublicArtefacts(partial)).toBeUndefined();
    },
  );

  it.each([null, undefined, 42, "yes", [], { ...EVERYTHING, quotes: "yes" }])(
    "refuses %s",
    (bad) => {
      expect(asPublicArtefacts(bad)).toBeUndefined();
    },
  );
});

/**
 * **Presence, never currency — the trap this whole slice was written around.**
 *
 * `StageState.done` is `status === "done" && isCurrent(step)`. The public
 * projection asks neither question: `publicArticle` spreads an artefact in when
 * the column is not null. So a **stale** glossary is `done: false` and is still
 * exactly what every visitor reads, and an inventory built on `done` would tell
 * its owner nobody had built one.
 *
 * The fixture is therefore a glossary that is unambiguously out of date — a
 * `sourceHash` and a `generator` that match nothing — and the assertion is that
 * it counts. Watch this go red by putting a currency check in
 * `shareableArtefacts`; that is the change it exists to stop.
 */
describe("what counts as shareable", () => {
  const STALE: Glossary = {
    version: "0",
    generator: "a-model-nobody-runs",
    slug: "noema",
    sourceHash: "0000000000000000",
    passes: 1,
    generatedAt: "2020-01-01T00:00:00.000Z",
    elapsedMs: 1,
    entries: [],
  };

  it("counts a stale artefact, because a visitor reads it", () => {
    const available = shareableArtefacts({
      arc: null,
      tweets: null,
      glossary: STALE,
      ideas: null,
      quotes: null,
    });
    expect(available.glossary).toBe(true);
  });

  it("counts an empty one, and does not count an absent one", () => {
    /* Built-but-empty and never-built are different facts everywhere else in
       this codebase (src/public-types.ts § PublicArtefactSet), and they are
       different here: an owner with an empty glossary is publishing an empty
       glossary. */
    const empty = shareableArtefacts({
      arc: null,
      tweets: null,
      glossary: { ...STALE, entries: [] },
      ideas: null,
      quotes: null,
    });
    expect(empty.glossary).toBe(true);
    const none = shareableArtefacts({
      arc: null,
      tweets: null,
      glossary: null,
      ideas: null,
      quotes: null,
    });
    expect(none).toEqual(NOTHING);
  });
});
