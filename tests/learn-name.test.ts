/**
 * **Remember's identifiers are `learn`** (2026-10-06, qi-dabpymjd): the mode
 * word, and what is left of the old one. `?mode=remember` still opens Learn;
 * `?remember=<view>` and `?chatfrom=remember` are let go, but an old link
 * carrying them is still a link.
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, RETIRED_MODES, modeFromParam } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { MODE_LABEL } from "../src/title-text.js";
import { THREAD_KINDS } from "../src/types.js";
import { resolveHelpAnchor } from "../src/web/help/help-anchors.js";
import {
  ARTICLE_PARAMS,
  NEVER_REMEMBERED,
  REMEMBERED,
  claimFirstOpen,
  firstOpenHref,
  hasArticleState,
  lastViewKey,
  readLastView,
  rememberableSearch,
  restoredHref,
} from "../src/web/last-view.js";
import { chatFromParam, learnInSearch, learnParam, modeParam } from "../src/web/params.js";
import { PHRASES } from "../evals/command-pick/phrases.js";

const A = "1a1a1a1a-1111-4111-8111-000000000004";
import CATALOGUE from "../src/command-pick-catalogue.generated.json" with { type: "json" };

const labels: Record<string, string> = MODE_LABEL;
const catalog: Record<string, { aliases: readonly string[] }> = MODE_CATALOG;

describe("Learn, the mode whose id was `remember`", () => {
  it("is called Learn, and its mode word is learn", () => {
    expect(labels.learn).toBe("Learn");
    expect(MODES as readonly string[]).toContain("learn");
    expect(MODES as readonly string[]).not.toContain("remember");
    expect(THREAD_KINDS as readonly string[]).toContain("learn");
    expect(THREAD_KINDS as readonly string[]).not.toContain("remember");
  });

  it("the command bar still finds it by its old name", () => {
    expect(catalog.learn?.aliases).toContain("remember");
    expect(catalog.learn?.aliases).not.toContain("learn");
  });

  it("an old ?mode=remember link opens Learn, on the client and the server", () => {
    expect(RETIRED_MODES.remember).toBe("learn");
    expect(modeFromParam("remember")).toBe("learn");
    expect(modeParam.parse("remember")).toBe("learn");
    /* The server's tab-title path: src/read-address.ts § readMode. */
    expect(readMode("/read/x?mode=remember")).toBe("learn");
    /* The control: an unknown word is still nothing. */
    expect(modeFromParam("rememberx")).toBe(null);
  });

  it("Help's old #mode-remember anchor lands on Learn's section", () => {
    expect(resolveHelpAnchor("#mode-remember")).toBe("mode-learn");
  });

  it("the sub-mode is ?learn=, and an old ?remember= opens Learn at its default", () => {
    expect(learnInSearch("?mode=learn&learn=quiz")).toBe("quiz");
    /* Let go, not aliased: the old key is not read at all. */
    expect(learnInSearch("?mode=remember&remember=quiz")).toBe(learnParam.defaultValue);
  });

  it("an old ?chatfrom=remember is not aliased: an unknown word reads as All", () => {
    expect(chatFromParam.parse("learn")).toBe("learn");
    expect(chatFromParam.parse("remember")).toBe(null);
  });
});

/**
 * **The alias must not reopen a conversation unasked.** `?mode=remember` is
 * alive through `RETIRED_MODES`, so the explicit-press filter has to ask about
 * the mode the word *means*, not the word. GPT Sol's PR-1 on 261005l, the other
 * way round.
 */
describe("last-view: the old word is neither stored nor replayed", () => {
  it("drops a conversation mode under either spelling, and keeps the rest of the address", () => {
    expect(rememberableSearch("?mode=remember&at=spya-x")).toBe("?at=spya-x");
    expect(rememberableSearch("?mode=learn&at=spya-x")).toBe("?at=spya-x");
    expect(rememberableSearch("?mode=remember")).toBe("");
    expect(restoredHref("/read/x", "", "?mode=remember&at=spya-x")).toBe("/read/x?at=spya-x");
  });

  it("leaves chat, diagram and the other retired words as they were", () => {
    expect(rememberableSearch("?mode=chat&at=spya-x")).toBe("?at=spya-x");
    expect(rememberableSearch("?mode=diagram&at=spya-x")).toBe("?at=spya-x");
    /* A retired word that is not a conversation is kept as written: this
       function has never rewritten it, and `modeParam` reads it as Skim. */
    expect(rememberableSearch("?mode=trajectory&at=spya-x")).toBe("?mode=trajectory&at=spya-x");
    expect(rememberableSearch("?mode=outline")).toBe("?mode=outline");
    /* The Marginalia translation runs before the filter and is untouched. */
    expect(rememberableSearch("?mode=marginalia&at=spya-x")).toBe("?margin=1&at=spya-x");
    expect(rememberableSearch("?mode=annotations")).toBe("?margin=1");
  });

  it("stores the sub-mode under `learn`, and never the old key", () => {
    expect(REMEMBERED as readonly string[]).toContain("learn");
    expect(REMEMBERED as readonly string[]).not.toContain("remember");
    expect(NEVER_REMEMBERED as readonly string[]).toContain("remember");
    expect(rememberableSearch("?mode=learn&learn=quiz")).toBe("?learn=quiz");
    expect(rememberableSearch("?mode=remember&remember=quiz&at=spya-x")).toBe("?at=spya-x");
    /* A browser still holding the old pair: dropped on the way out. */
    expect(restoredHref("/read/x", "", "?remember=quiz&at=spya-x")).toBe("/read/x?at=spya-x");
    expect(restoredHref("/read/x", "", "?remember=quiz")).toBe(null);
  });
});

/**
 * The command bar's picker is sent ids and answers with ids, and the eval's
 * accept lists score those answers. One blind case takes its ids from a frozen
 * file written under the old id (GPT Sol's plan review of 261006a, PR-6).
 */
describe("the command-pick eval's accept lists follow the id", () => {
  it("has no phrase that only an old id could satisfy", () => {
    const old = PHRASES.filter((p) => p.accept.some((id) => /(^|:)remember(:|$)/.test(id)));
    expect(old.map((p) => `${p.id}: ${p.accept.join(", ")}`)).toEqual([]);
  });

  it("scores Learn's Quiz as right for the blind case written under the old id", () => {
    const b15 = PHRASES.find((p) => p.id === "b15");
    expect(b15?.text).toBe("help me actually remember this stuff, quiz me on it");
    expect(b15?.accept).toEqual(["submode:learn:quiz", "mode:learn"]);
    /* And those are rows the picker is really offered today. */
    const ids = new Set(CATALOGUE.map((row) => row.id));
    for (const id of b15?.accept ?? []) expect(ids.has(id), id).toBe(true);
    /* The control: the old ids are not. */
    expect(ids.has("mode:remember")).toBe(false);
    expect(ids.has("submode:remember:quiz")).toBe(false);
  });
});

/** GPT Sol's PR-2 on 261006a: an old link is still a link, and the link wins. */
describe("last-view: an old ?remember=<view> link is not a bare address", () => {
  const KEY = lastViewKey("x", A);

  function storage(initial: Record<string, string> = {}) {
    const held = new Map(Object.entries(initial));
    const source = () =>
      ({
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => void held.set(key, value),
        removeItem: (key: string) => void held.delete(key),
      }) as unknown as Storage;
    return { held, source };
  }

  it("counts as article state", () => {
    expect(ARTICLE_PARAMS).toContain("remember");
    expect(hasArticleState("?remember=quiz")).toBe(true);
  });

  it("is not overridden by the browser's stored view", () => {
    expect(restoredHref("/read/x", "?remember=quiz", "?mode=quotes&at=spya-far")).toBe(null);
    /* The control: the same stored view is put back on a bare address. */
    expect(restoredHref("/read/x", "", "?mode=quotes&at=spya-far")).toBe("/read/x?mode=quotes&at=spya-far");
  });

  it("is not taken for a first open, and gets no first-open default", () => {
    const s = storage();
    expect(claimFirstOpen("x", A, "?remember=quiz", readLastView("x", A, s.source), s.source)).toBe(false);
    expect(s.held.has(KEY)).toBe(false);
    expect(firstOpenHref("x", "/read/x", "?remember=quiz", { signedIn: true }, "?mode=summary")).toBe(null);
    /* The control: a bare address is claimed and gets the default. */
    expect(claimFirstOpen("x", A, "", readLastView("x", A, s.source), s.source)).toBe(true);
    expect(firstOpenHref("x", "/read/x", "", { signedIn: true }, "?mode=summary")).toBe("/read/x?mode=summary");
  });
});
