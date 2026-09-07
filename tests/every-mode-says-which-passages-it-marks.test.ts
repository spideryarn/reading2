/**
 * **Every mode answers for its own passages, and nine of them answer "none".**
 *
 * `selectPassages` (src/web/reader/passages.ts) replaced two independent ternary
 * chains inside `Reader` on 2026-09-06. The chains had two faults, and this file
 * is one assertion per fault:
 *
 * - **They agreed by coincidence.** One chain picked the marks and the other
 *   picked the ring, and nothing but the order they tested `mode` in made them
 *   pick the same band's. So the first block below drives every producer and
 *   asserts the pair came from *one* slot — a version that read the marks from
 *   Timeline and the key from Ideas would pass a per-field check and fail here.
 * - **Nine modes inherited Search's results**, because both chains ended
 *   `: found` / `: openHit`. The second block names all nine and requires the
 *   empty constant, **by identity**, which is the only way that property can be
 *   checked: `toEqual([])` passes for a fresh `[]` every render, and a fresh
 *   `[]` is what would rebuild every block's marks on every render in a mode
 *   that has nothing to draw.
 *
 * **The coverage is driven from `MODES`**, not from a list written here. A
 * fifteenth mode is already a compile error in the `never` default; this makes
 * it a red test as well, so somebody running the suite before the typecheck
 * still finds out. And it is the guard against the cheap wrong fix — a mode
 * quietly added to the non-producer arm to make the compiler happy would have
 * to be added to the list below too, which is a line somebody has to write on
 * purpose.
 *
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
 * § Stage 4b.
 */
import { describe, expect, it } from "vitest";

import { MODES, type Mode } from "../src/modes.js";
import { NO_FOUND, selectPassages, type PassageSlots } from "../src/web/reader/passages.js";
import type { Found } from "../src/web/search-hits.js";
import type { BlockId } from "../src/types.js";

/**
 * One passage, distinguishable by the `key` alone — which is what the assertions
 * read, so a slot that came back from the wrong band names itself in the
 * failure.
 */
function passage(name: string): Found {
  return {
    key: `${name}-key`,
    blockId: "spya-k3m9qt" as BlockId,
    runId: null,
    slot: null,
    index: 0,
    start: 0,
    end: 4,
    confidence: null,
    valence: null,
    reasoning: null,
    short: name,
    long: name,
    at: 0,
    whole: false,
  };
}

/** The five slots `Reader` holds, each carrying its own name. */
const SLOTS: PassageSlots = {
  ideas: { found: [passage("ideas")], openKey: "ideas-open" },
  quotes: { found: [passage("quotes")], openKey: "quotes-open" },
  timeline: { found: [passage("timeline")], openKey: "timeline-open" },
  referee: { found: [passage("referee")], openKey: "referee-open" },
  search: { found: [passage("search")], openKey: "search-open" },
};

/** The mode each slot belongs to. Its keys are the five producer modes. */
const PRODUCERS = {
  ideas: "ideas",
  quotes: "quotes",
  timeline: "timeline",
  referee: "referee",
  search: "search",
} as const satisfies Record<string, keyof PassageSlots>;

/**
 * **The modes with no passage producer**, named rather than derived — the
 * point of the file is that this set is a decision somebody made and not a
 * fall-through. `chat` and `remember` were verified to publish nothing when
 * they moved out of `App.tsx`; `glossary`'s selection is a different currency
 * (`termSelections`) that never reaches this state.
 *
 * `structure` joined on 2026-09-07, and this is the one place to be sceptical
 * about it: adding a mode here is also the cheap wrong fix for the compile
 * error `selectPassages` raises, so the entry has to be earned. It is — the
 * mode is navigation over the tree, so every row of it is already a door into a
 * passage rather than a claim about one, and a version that lit its own rows'
 * blocks in the prose would mark the whole article. Same position as `outline`
 * and `hierarchy` for the same reason.
 */
const SILENT: Mode[] = [
  "plain",
  "hierarchy",
  "chat",
  "glossary",
  "summary",
  "diagram",
  "remember",
  "outline",
  "structure",
  "debate",
];

describe("selectPassages", () => {
  it("gives each producer its own marks and its own ring, from one slot", () => {
    for (const [mode, slot] of Object.entries(PRODUCERS) as [Mode, keyof PassageSlots][]) {
      const chosen = selectPassages(mode, SLOTS);
      expect(chosen.found, `${mode} drew another band's marks`).toBe(SLOTS[slot].found);
      expect(chosen.openKey, `${mode} rang another band's passage`).toBe(SLOTS[slot].openKey);
    }
  });

  it("gives every mode with no producer the shared empty list, by identity", () => {
    for (const mode of SILENT) {
      const chosen = selectPassages(mode, SLOTS);
      /* `toBe`, not `toEqual`: the four memos in `Reader` key on this array by
         identity, so a fresh `[]` here would be a correct-looking answer that
         recomputes every block's marks on every render. */
      expect(chosen.found, `${mode} did not get the shared empty list`).toBe(NO_FOUND);
      expect(chosen.openKey, `${mode} came back with a ring`).toBeNull();
    }
  });

  it("Search's results reach Search and stop there", () => {
    /* The bug, stated as a test. Both chains ended in Search's slot, so every
       one of the nine was showing whatever Search had left behind — a painted
       frame of it until the unmount clear became a layout cleanup earlier the
       same day, and after that a correctness that lived in another file. */
    expect(selectPassages("search", SLOTS).found).toHaveLength(1);
    for (const mode of SILENT) {
      expect(selectPassages(mode, SLOTS).found, `${mode} inherited Search's results`).toHaveLength(
        0,
      );
    }
  });

  it("answers for every mode in MODES, and for no mode twice", () => {
    const answered = [...Object.keys(PRODUCERS), ...SILENT];
    expect([...answered].sort(), "a mode is in two arms at once").toEqual(
      [...new Set(answered)].sort(),
    );
    expect(
      [...answered].sort(),
      "a mode in MODES has no arm here — add it to PRODUCERS or to SILENT",
    ).toEqual([...MODES].sort());
  });
});
