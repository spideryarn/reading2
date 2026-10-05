// @vitest-environment jsdom
/**
 * **`/features` names every mode, and marks the experimental ones from the
 * code rather than from the caption.**
 *
 * The page went stale by omission: Structure, Skim, Tweets, Debate, Citations,
 * FAQ and Marginalia all shipped while it still described Outline, which was
 * gone. A new mode now turns this red until it has a tile. The Experimental tag
 * is drawn by SiteBits.tsx from `MODE_CATALOG[mode].experimental`, so a mode
 * that leaves the switch loses its tag without anyone editing a caption — which
 * captions had already got wrong three times (Structure, Skim, Tweets).
 *
 * `TITLES` is the explicit visible-title → mode map, so a tile carrying the
 * wrong `mode` (a Quiz tile saying `quotes`, say) is caught rather than
 * counted. The tag is checked on every occurrence; duplicates are removed only
 * for the coverage check. docs/plans/261002b-…, Stage 1 (Sol #8).
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES, type Mode } from "../src/modes.js";
import {
  experimental,
  isMode,
  type ModeMention,
  mount,
  unmount,
} from "./helpers/marketing-page-render.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { FeaturesPage } = await import("../src/web/FeaturesPage.js");

/** What each titled element on `/features` is about. */
const TITLES = {
  "Structure.": "structure",
  "Diagram.": "diagram",
  "Skim.": "skim",
  "Summary.": "summary",
  "Or just the article.": "plain",
  "Glossary.": "glossary",
  "Search by meaning.": "search",
  "Every hit says how sure.": "search",
  "Ideas.": "ideas",
  "Quotes.": "quotes",
  "Timeline.": "timeline",
  "Citations.": "citations",
  "Marginalia.": "marginalia",
  "A chat that cites.": "chat",
  "Or say it out loud.": "chat",
  "FAQ.": "faq",
  "Debate.": "debate",
  "Learn.": "remember",
  "Quiz.": "remember",
  "Referee mode.": "referee",
  /* The thread is Summary's Thread view since 2026-10-03 (plan 261003l); its
     tile stays, tagged with the mode it is found in. */
  "Thread.": "summary",
} satisfies Record<string, Mode>;

/**
 * Every titled feature promised above, found from its visible title rather
 * than from `[data-mode]`. Starting with `[data-mode]` made an omitted `mode`
 * prop disappear from the test altogether — particularly bad for the duplicate
 * Search, Chat and Remember representations, whose other occurrence kept the
 * coverage assertion green.
 */
function expectedMentions(page: HTMLElement): (ModeMention & { expectedMode: Mode })[] {
  const titled = [...page.querySelectorAll<HTMLElement>("h2, h3, figcaption > strong")];
  return Object.entries(TITLES).map(([title, expectedMode]) => {
    const matches = titled.filter((el) => el.textContent?.trim() === title);
    expect(matches, title).toHaveLength(1);
    const container = matches[0]?.closest<HTMLElement>(".site-panel, section, figure") ?? null;
    expect(container, `${title} has no feature container`).not.toBeNull();
    return {
      title,
      mode: container?.dataset.mode ?? "",
      tagged: container?.querySelector(".site-experimental") !== null,
      expectedMode,
    };
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("/features", () => {
  it("names every mode in MODES", async () => {
    const page = await mount(<FeaturesPage signedIn={false} />, "/features");
    const named = new Set(expectedMentions(page).map((m) => m.mode));
    expect(MODES.filter((mode) => !named.has(mode))).toEqual([]);
  });

  it("gives each mode element the mode its title says", async () => {
    const page = await mount(<FeaturesPage signedIn={false} />, "/features");
    const mentions = expectedMentions(page);
    /* The positive control: an empty list would pass the loop below. */
    expect(mentions.length).toBeGreaterThanOrEqual(MODES.length);
    for (const { title, mode, expectedMode } of mentions) {
      expect({ title, mode }).toEqual({ title, mode: expectedMode });
    }
  });

  it("draws the Experimental tag exactly on the modes MODE_CATALOG marks", async () => {
    const page = await mount(<FeaturesPage signedIn={false} />, "/features");
    const mentions = expectedMentions(page);
    /* Both halves have to occur, or the iff is only half tested. */
    expect(mentions.some((m) => m.tagged)).toBe(true);
    expect(mentions.some((m) => !m.tagged)).toBe(true);
    for (const { title, mode, tagged } of mentions) {
      expect(isMode(mode)).toBe(true);
      if (!isMode(mode)) continue;
      expect({ title, tagged }).toEqual({ title, tagged: experimental(mode) });
    }
  });

  it("says once what the tag means", async () => {
    const page = await mount(<FeaturesPage signedIn={false} />, "/features");
    const text = page.textContent ?? "";
    expect(text.match(/turn these on from the bar or their profile/g)?.length).toBe(1);
  });
});
