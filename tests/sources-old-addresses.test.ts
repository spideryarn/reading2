/**
 * **Every old Citations, Debate and Peer review address lands on the right
 * Sources sub-mode** — on boot (`settleAddress`), on a client navigation and
 * on Back (`liftedLegacyHref`), and from a remembered last view
 * (`restoredHref`). One canonicaliser behind all three, so a stored
 * `?mode=debate&debate=claims` cannot parse through `RETIRED_MODES` as Sources
 * and land on its default Bibliography (GPT Sol's F1 on plan 261009l). The
 * chat list's old `?chatfrom=debate|citations|peer-review` filters land on the
 * combined word (F5). The mode was called Peer review until 2026-10-09, when
 * it became Sources (plan 261009w § Old links still land).
 *
 * The DOM half — the real router, nuqs and a band — is
 * tests/reception-navigation.test.tsx.
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md § Stage 1,
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md.
 */
import { describe, expect, it } from "vitest";
import { liftedLegacyHref, settleAddress } from "../src/web/router.js";
import { restoredHref } from "../src/web/last-view.js";

const PATH = "/read/a-piece";

/** The query an address settles to, as pairs in a map, plus its hash. */
function settled(search: string, hash = ""): { q: URLSearchParams; hash: string; all: string } {
  const out = settleAddress(PATH, search, hash) ?? `${PATH}${search}${hash}`;
  const hashAt = out.indexOf("#");
  const rest = hashAt === -1 ? out : out.slice(0, hashAt);
  return {
    q: new URLSearchParams(rest.slice(rest.indexOf("?") + 1)),
    hash: hashAt === -1 ? "" : out.slice(hashAt),
    all: out,
  };
}

/** What each old address must become: the sub-mode it opens on. */
const LIFTS: readonly [string, "bibliography" | "reception" | "claims"][] = [
  ["?mode=citations", "bibliography"],
  ["?mode=citations&citeby=year&citebar=3", "bibliography"],
  ["?mode=debate", "reception"],
  ["?mode=debate&debate=reception", "reception"],
  ["?mode=debate&debate=claims", "claims"],
  ["?mode=debate&debateby=claim", "claims"],
  ["?mode=debate&debate=reception&debateby=claim", "reception"],
  ["?mode=peer-review", "bibliography"],
  ["?mode=peer-review&peer-review=claims", "claims"],
  ["?mode=peer-review&peer-review=reception", "reception"],
  ["?mode=peer-review&peer-review=bibliography", "bibliography"],
  /* An explicit newer word wins over an older one. */
  ["?mode=debate&debate=claims&peer-review=reception", "reception"],
  ["?mode=citations&peer-review=claims", "claims"],
  ["?mode=debate&debate=claims&sources=reception", "reception"],
  ["?mode=peer-review&peer-review=claims&sources=reception", "reception"],
];

/** The sub-mode an address names: `bibliography`, the default, when it names none. */
function viewOf(q: URLSearchParams): string {
  return q.get("sources") ?? "bibliography";
}

function expectNoOldWords(q: URLSearchParams): void {
  expect(q.has("debate")).toBe(false);
  expect(q.has("peer-review")).toBe(false);
  expect(q.getAll("sources").length).toBeLessThanOrEqual(1);
}

describe("an old Citations, Debate or Peer review address, on boot", () => {
  it.each(LIFTS)("%s opens Sources on %s", (search, view) => {
    const { q } = settled(search);
    expect(q.getAll("mode")).toEqual(["sources"]);
    expect(viewOf(q)).toBe(view);
    expectNoOldWords(q);
    expect(q.has("debateby")).toBe(false);
  });

  it("keeps each sub-mode's own parameters, and the hash", () => {
    const { q, hash } = settled("?mode=citations&citeby=year&citebar=3&at=spya-k3m9qt", "#passage");
    expect(q.get("citeby")).toBe("year");
    expect(q.get("citebar")).toBe("3");
    expect(hash).toBe("#passage");
    /* Reception's own order and thread arrive under the words they had until
       2026-10-09 and leave under the new ones (plan 261009w, Stage 3). */
    const reception = settled("?mode=debate&debateby=date&bears=directly&debatethread=key").q;
    expect(reception.get("receptionby")).toBe("date");
    expect(reception.get("bears")).toBe("directly");
    expect(reception.get("receptionthread")).toBe("key");
    expect(reception.has("debateby")).toBe(false);
    expect(reception.has("debatethread")).toBe(false);
    expect(reception.get("sources")).toBe("reception");
    const peer = settled("?mode=peer-review&peer-review=claims&bears=partly&at=spya-k3m9qt").q;
    expect(peer.get("bears")).toBe("partly");
    expect(peer.get("at")).toBe("spya-k3m9qt");
  });

  it("leaves a Sources address alone", () => {
    expect(settleAddress(PATH, "?mode=sources&sources=claims", "")).toBeNull();
    expect(settleAddress(PATH, "?mode=sources", "")).toBeNull();
  });

  it.each(["debate", "citations", "peer-review"])("lifts ?chatfrom=%s to the combined filter", (word) => {
    const { q } = settled(`?mode=chat&chatfrom=${word}`);
    expect(q.get("chatfrom")).toBe("sources");
    expect(q.get("mode")).toBe("chat");
  });
});

describe("an old Citations, Debate or Peer review address, after boot", () => {
  it.each(LIFTS)("navigate and Back lift %s to %s", (search, view) => {
    const lifted = liftedLegacyHref(`${PATH}${search}#here`);
    expect(lifted).not.toBeNull();
    const out = lifted ?? "";
    expect(out.endsWith("#here")).toBe(true);
    const q = new URLSearchParams(out.slice(out.indexOf("?") + 1, out.indexOf("#")));
    expect(q.getAll("mode")).toEqual(["sources"]);
    expect(viewOf(q)).toBe(view);
    expectNoOldWords(q);
  });

  it("lifts an old chat filter after boot too", () => {
    const out = liftedLegacyHref(`${PATH}?mode=chat&chatfrom=peer-review`) ?? "";
    expect(new URLSearchParams(out.slice(out.indexOf("?") + 1)).get("chatfrom")).toBe("sources");
  });

  it("is null for an address with nothing old in it", () => {
    expect(liftedLegacyHref(`${PATH}?mode=sources&sources=reception`)).toBeNull();
  });
});

describe("a remembered last view from before a rename", () => {
  it.each(LIFTS)("%s restores Sources on %s", (stored, view) => {
    const out = restoredHref(PATH, "", stored);
    expect(out).not.toBeNull();
    const q = new URLSearchParams((out ?? "").slice((out ?? "").indexOf("?") + 1));
    expect(q.getAll("mode")).toEqual(["sources"]);
    expect(viewOf(q)).toBe(view);
    expectNoOldWords(q);
  });

  it("restores a Peer review view on the sub-mode it named", () => {
    expect(restoredHref(PATH, "", "?mode=peer-review&peer-review=reception")).toBe(
      `${PATH}?mode=sources&sources=reception`,
    );
  });

  it.each(["citations", "peer-review"])("restores an old chat filter %s as the combined one", (word) => {
    const out = restoredHref(PATH, "", `?chatfrom=${word}&at=spya-k3m9qt`);
    const q = new URLSearchParams((out ?? "").slice((out ?? "").indexOf("?") + 1));
    expect(q.get("chatfrom")).toBe("sources");
  });
});

/**
 * **Reception's order and thread, under the words they had until 2026-10-09**
 * (`?debateby=`, `?debatethread=`; plan 261009w, Stage 3). Each lands under
 * its new word on boot, after boot and from a remembered view; an old
 * `debateby=claim` still opens Claims, as it did before (above).
 */
describe("Reception's old order and thread words", () => {
  it("lifts ?debateby=X on a Sources address to ?receptionby=X", () => {
    expect(settleAddress(PATH, "?mode=sources&sources=reception&debateby=date", "")).toBe(
      `${PATH}?mode=sources&sources=reception&receptionby=date`,
    );
  });

  it("lifts ?debatethread=X to ?receptionthread=X", () => {
    expect(settleAddress(PATH, "?debatethread=spya-ttm222", "")).toBe(`${PATH}?receptionthread=spya-ttm222`);
    expect(settleAddress(PATH, "?mode=sources&sources=claims&debatethread=key", "")).toBe(
      `${PATH}?mode=sources&sources=claims&receptionthread=key`,
    );
  });

  it("lifts both after boot, on a navigation or Back", () => {
    expect(liftedLegacyHref(`${PATH}?mode=sources&sources=reception&debateby=stance&debatethread=key#x`)).toBe(
      `${PATH}?mode=sources&sources=reception&receptionby=stance&receptionthread=key#x`,
    );
  });

  it("still opens Claims for ?mode=debate&debateby=claim, with no order left behind", () => {
    const { q } = settled("?mode=debate&debateby=claim");
    expect(viewOf(q)).toBe("claims");
    expect(q.has("debateby")).toBe(false);
    expect(q.has("receptionby")).toBe(false);
  });

  it("lets an explicit new word win over the old one", () => {
    expect(settleAddress(PATH, "?mode=sources&sources=reception&debateby=date&receptionby=stance", "")).toBe(
      `${PATH}?mode=sources&sources=reception&receptionby=stance`,
    );
    expect(settleAddress(PATH, "?receptionthread=key&debatethread=spya-ttm222", "")).toBe(
      `${PATH}?receptionthread=key`,
    );
  });

  it("restores a remembered view holding debateby and debatethread under the new words", () => {
    expect(
      restoredHref(PATH, "", "?mode=sources&sources=reception&debateby=date&debatethread=key"),
    ).toBe(`${PATH}?mode=sources&sources=reception&receptionby=date&receptionthread=key`);
  });

  it("leaves an address with the new words alone", () => {
    expect(settleAddress(PATH, "?mode=sources&sources=reception&receptionby=date&receptionthread=key", "")).toBeNull();
  });
});
