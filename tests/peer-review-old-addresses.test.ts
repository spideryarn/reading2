/**
 * **Every old Citations and Debate address lands on the right Peer review
 * sub-mode** — on boot (`settleAddress`), on a client navigation and on Back
 * (`liftedLegacyHref`), and from a remembered last view (`restoredHref`). One
 * canonicaliser behind all three, so a stored `?mode=debate&debate=claims`
 * cannot parse through `RETIRED_MODES` as Peer review and land on its default
 * Bibliography (GPT Sol's F1 on plan 261009l). The chat list's old
 * `?chatfrom=debate|citations` filters land on the combined word (F5).
 *
 * The DOM half — the real router, nuqs and a band — is
 * tests/debate-navigation.test.tsx.
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md § Stage 1.
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

/** What each old address must become: the mode, the sub-mode (null for the default), and no `debate`. */
const LIFTS: readonly [string, "bibliography" | "reception" | "claims"][] = [
  ["?mode=citations", "bibliography"],
  ["?mode=citations&citeby=year&citebar=3", "bibliography"],
  ["?mode=debate", "reception"],
  ["?mode=debate&debate=reception", "reception"],
  ["?mode=debate&debate=claims", "claims"],
  ["?mode=debate&debateby=claim", "claims"],
  ["?mode=debate&debate=reception&debateby=claim", "reception"],
  /* An explicit new word wins over the old one. */
  ["?mode=debate&debate=claims&peer-review=reception", "reception"],
  ["?mode=citations&peer-review=claims", "claims"],
];

describe("an old Citations or Debate address, on boot", () => {
  it.each(LIFTS)("%s opens Peer review on %s", (search, view) => {
    const { q } = settled(search);
    expect(q.getAll("mode")).toEqual(["peer-review"]);
    expect(q.get("peer-review")).toBe(view === "bibliography" ? null : view);
    expect(q.has("debate")).toBe(false);
    expect(q.has("debateby")).toBe(false);
  });

  it("keeps each sub-mode's own parameters, and the hash", () => {
    const { q, hash } = settled("?mode=citations&citeby=year&citebar=3&at=spya-k3m9qt", "#passage");
    expect(q.get("citeby")).toBe("year");
    expect(q.get("citebar")).toBe("3");
    expect(hash).toBe("#passage");
    const debate = settled("?mode=debate&debateby=date&bears=directly&debatethread=key").q;
    expect(debate.get("debateby")).toBe("date");
    expect(debate.get("bears")).toBe("directly");
    expect(debate.get("debatethread")).toBe("key");
    expect(debate.get("peer-review")).toBe("reception");
  });

  it("leaves a Peer review address alone", () => {
    expect(settleAddress(PATH, "?mode=peer-review&peer-review=claims", "")).toBeNull();
    expect(settleAddress(PATH, "?mode=peer-review", "")).toBeNull();
  });

  it.each(["debate", "citations"])("lifts ?chatfrom=%s to the combined filter", (word) => {
    const { q } = settled(`?mode=chat&chatfrom=${word}`);
    expect(q.get("chatfrom")).toBe("peer-review");
    expect(q.get("mode")).toBe("chat");
  });
});

describe("an old Citations or Debate address, after boot", () => {
  it.each(LIFTS)("navigate and Back lift %s to %s", (search, view) => {
    const lifted = liftedLegacyHref(`${PATH}${search}#here`);
    expect(lifted).not.toBeNull();
    const out = lifted ?? "";
    expect(out.endsWith("#here")).toBe(true);
    const q = new URLSearchParams(out.slice(out.indexOf("?") + 1, out.indexOf("#")));
    expect(q.getAll("mode")).toEqual(["peer-review"]);
    expect(q.get("peer-review")).toBe(view === "bibliography" ? null : view);
    expect(q.has("debate")).toBe(false);
  });

  it("is null for an address with nothing old in it", () => {
    expect(liftedLegacyHref(`${PATH}?mode=peer-review&peer-review=reception`)).toBeNull();
  });
});

describe("a remembered last view from before the merge", () => {
  it.each(LIFTS)("%s restores Peer review on %s", (stored, view) => {
    const out = restoredHref(PATH, "", stored);
    expect(out).not.toBeNull();
    const q = new URLSearchParams((out ?? "").slice((out ?? "").indexOf("?") + 1));
    expect(q.getAll("mode")).toEqual(["peer-review"]);
    expect(q.get("peer-review")).toBe(view === "bibliography" ? null : view);
    expect(q.has("debate")).toBe(false);
  });

  it("restores an old chat filter as the combined one", () => {
    const out = restoredHref(PATH, "", "?chatfrom=citations&at=spya-k3m9qt");
    const q = new URLSearchParams((out ?? "").slice((out ?? "").indexOf("?") + 1));
    expect(q.get("chatfrom")).toBe("peer-review");
  });
});
