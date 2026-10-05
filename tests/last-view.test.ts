/**
 * Reopening an article where you left it — the pure half.
 *
 * Everything that decides *what* is remembered and *whether* to put it back is
 * a pure function in src/web/last-view.ts, deliberately, so that each clause can
 * be watched failing rather than reasoned about
 * (docs/reusable/silent-success.md). The storage and the two effects around
 * them are three lines each and are checked by hand
 * (docs/project/browser-testing.md).
 *
 * The last test in this file is the one that will still be earning its keep in
 * six months: it scans the client for `useQueryState` keys and fails on one that
 * neither list in last-view.ts has heard of. Adding the thirty-sixth parameter
 * is then a decision instead of an omission — and the failure it prevents is
 * quiet, because an unrecognised parameter makes a link carrying only *it* look
 * like a bare address, which a restore would then write over.
 *
 * docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARTICLE_PARAMS,
  claimFirstOpen,
  firstOpenHref,
  firstOpenSearch,
  hasArticleState,
  NEVER_REMEMBERED,
  readLastView,
  REMEMBERED,
  rememberableSearch,
  restoredHref,
  writeLastView,
} from "../src/web/last-view.js";

describe("rememberableSearch", () => {
  it("keeps the parameters that say how you are looking at the article", () => {
    expect(rememberableSearch("?at=spya-tgnssb&mode=summary&summary=fuller")).toBe(
      "?at=spya-tgnssb&mode=summary&summary=fuller",
    );
  });

  it("never stores `deep`, but lets an old link carrying it win over a restore", () => {
    /* `?deep=` was Summary's Parts | Sections until the outline went on
       2026-10-01 (plan 261001p). Nothing writes it now, so it is never
       stored — but `/read/x?deep=2` is an address somebody may still open,
       and it must read as a link, not as a bare address a remembered view
       could be restored over. GPT Sol's plan review of 261001p, P1. */
    expect(rememberableSearch("?mode=summary&deep=2")).toBe("?mode=summary");
    expect(hasArticleState("?deep=2")).toBe(true);
    expect(restoredHref("/read/x", "?deep=2", "?mode=quotes")).toBe(null);
  });

  it("keeps Summary's sub-mode, which only a press can spend on", () => {
    /* `?summary=simple` restored mounts Simple's read and nothing else: the run
       is armed by a press — the bar's Summary, or the slider (SummaryMode.tsx) —
       never by arrival — so
       it is a place you were, like `?at=`. Plan 260930i. */
    expect(rememberableSearch("?mode=summary&summary=simple")).toBe("?mode=summary&summary=simple");
    expect(hasArticleState("?summary=simple")).toBe(true);
  });

  /* Debate's Reception | Claims, since 2026-10-03 (plan 261003o; GPT Sol's
     F6). Left out of `REMEMBERED`, a reader who was reading Claims comes back
     to Reception — on a paper with no reception, an empty band. Restoring it
     spends nothing: Debate searches on a press, never on arrival. */
  it("keeps Debate's sub-mode, so Claims is restored as Claims", () => {
    expect(rememberableSearch("?mode=debate&debate=claims&bears=partly")).toBe(
      "?mode=debate&debate=claims&bears=partly",
    );
    expect(restoredHref("/read/x", "", "?mode=debate&debate=claims")).toBe("/read/x?mode=debate&debate=claims");
    expect(hasArticleState("?debate=claims")).toBe(true);
  });

  it("no longer stores the retired identification threshold, or puts an old one back", () => {
    expect(rememberableSearch("?mode=debate&name=linked")).toBe("?mode=debate");
    expect(restoredHref("/read/x", "", "?mode=debate&name=linked")).toBe("/read/x?mode=debate");
  });

  it("lets an old link carrying only `name` win over a remembered view", () => {
    expect(hasArticleState("?name=linked")).toBe(true);
    expect(restoredHref("/read/x", "?name=linked", "?mode=debate&debate=claims&bears=directly")).toBeNull();
  });

  it("keeps each pair byte-for-byte, so a comma list is not reserialised", () => {
    /* `URLSearchParams` would hand back `crits=spya-a%2Cspya-b`, which parses
       to the same thing and reads as somebody else's URL. Same reason
       router.ts's rewrites are textual. (This was `?cols=0,1,2` until that
       parameter retired with the Hierarchy mode on 2026-09-29.) */
    expect(rememberableSearch("?crits=spya-a,spya-b")).toBe("?crits=spya-a,spya-b");
  });

  it("drops the dialog, the drawer, the conversation and the search", () => {
    expect(
      rememberableSearch("?note=spya-a&panel=questions&thread=spya-b&find=wet+hardware&run=spya-c"),
    ).toBe("");
    expect(rememberableSearch("?at=spya-a&note=spya-b")).toBe("?at=spya-a");
    expect(rememberableSearch("?match=words&order=confidence&conf=65&runs=spya-a")).toBe("");
  });

  it("drops the four modes that start something merely by being arrived in", () => {
    /* Diagram POSTs `/api/similar` or `/api/projection` for three of its five
       pictures, and Remember opens a conversation exactly as Chat does — both
       found by GPT Sol (F1, F2) after a first survey wrongly reported all
       thirteen modes inert. last-view.ts § NEEDS_AN_EXPLICIT_PRESS. */
    expect(rememberableSearch("?mode=chat")).toBe("");
    expect(rememberableSearch("?mode=diagram")).toBe("");
    expect(rememberableSearch("?mode=remember")).toBe("");
    expect(rememberableSearch("?at=spya-a&mode=chat&thread=spya-b")).toBe("?at=spya-a");
    /* **The one that would have cost money**: the mode goes, the picture stays,
       so pressing Diagram later still returns Force — but nothing fetches while
       nobody is in the mode. */
    expect(rememberableSearch("?at=spya-a&mode=diagram&diagram=force&dhue=topic")).toBe(
      "?at=spya-a&diagram=force&dhue=topic",
    );
    expect(rememberableSearch("?mode=remember&remember=quiz")).toBe("?remember=quiz");
    /* **Summary's Thread** (the Tweets mode until 2026-10-03): opening it with
       no thread writes one on arrival (useTweets.ts § `useAutoRunOnArrival`),
       and a restore is the one arrival nobody chose. So the mode is dropped
       when the remembered view is the thread — and `summary=thread` itself
       stays, dormant, as `diagram=force` does above. Plan 261003l. */
    expect(rememberableSearch("?mode=summary&summary=thread")).toBe("?summary=thread");
    expect(rememberableSearch("?at=spya-a&summary=thread&mode=summary")).toBe("?at=spya-a&summary=thread");
    expect(restoredHref("/read/x", "", "?at=spya-a&mode=summary&summary=thread")).toBe(
      "/read/x?at=spya-a&summary=thread",
    );
    /* The positive control: Summary at a length is restored as it stands. */
    expect(rememberableSearch("?mode=summary&summary=fuller")).toBe("?mode=summary&summary=fuller");
    expect(rememberableSearch("?mode=summary")).toBe("?mode=summary");
    /* A browser that remembered the old mode word: `settleAddress` would lift
       it to the thread, so it is dropped the same way. */
    expect(rememberableSearch("?mode=tweets")).toBe("");
    expect(rememberableSearch("?at=spya-a&mode=tweets")).toBe("?at=spya-a");
    expect(restoredHref("/read/x", "", "?at=spya-a&mode=tweets")).toBe("/read/x?at=spya-a");
    expect(restoredHref("/read/x", "", "?mode=tweets")).toBe(null);
  });

  it("keeps every other mode as it stands", () => {
    for (const mode of ["plain", "glossary", "search", "referee", "summary", "ideas", "structure", "quotes", "timeline"]) {
      expect(rememberableSearch(`?mode=${mode}`), mode).toBe(`?mode=${mode}`);
    }
    expect(rememberableSearch("?mode=glossary&term=spya-h4r2wd")).toBe(
      "?mode=glossary&term=spya-h4r2wd",
    );
  });

  /* Marginalia's column, since 2026-10-01 a switch of its own:
     docs/plans/261001i-annotations-column-beside-a-band-mode.md. It reads what
     the article already has and starts no job, so restoring it is inert. */
  it("remembers the notes beside a band, and the link always wins", () => {
    expect(rememberableSearch("?mode=glossary&margin=1")).toBe("?mode=glossary&margin=1");
    expect(restoredHref("/read/x", "", "?mode=glossary&margin=1")).toBe(
      "/read/x?mode=glossary&margin=1",
    );
    /* A link that asks for the notes is a view of its own: no remembered band. */
    expect(restoredHref("/read/x", "?margin=1", "?mode=glossary")).toBe(null);
  });

  it("reads a remembered mode=annotations from its first day as the notes on", () => {
    expect(rememberableSearch("?mode=annotations")).toBe("?margin=1");
    expect(rememberableSearch("?at=spya-a&mode=annotations&margin=1")).toBe("?at=spya-a&margin=1");
    expect(rememberableSearch("?margin=0&mode=annotations")).toBe("?margin=1");
    expect(rememberableSearch("?mode=annotations&margin=0")).toBe("?margin=1");
    expect(restoredHref("/read/x", "", "?mode=annotations")).toBe("/read/x?margin=1");
  });

  /* The mode's own word since 261001n, `marginalia`, is translated the same
     way (`isMarginaliaModeWord`): the word wins over any simultaneous margin
     value, in either order, and neither spelling is put back. */
  it("reads a remembered mode=marginalia as the notes on", () => {
    expect(rememberableSearch("?mode=marginalia")).toBe("?margin=1");
    expect(rememberableSearch("?at=spya-a&mode=marginalia&margin=1")).toBe("?at=spya-a&margin=1");
    expect(rememberableSearch("?margin=0&mode=marginalia")).toBe("?margin=1");
    expect(rememberableSearch("?mode=marginalia&margin=0")).toBe("?margin=1");
    expect(restoredHref("/read/x", "", "?mode=marginalia")).toBe("/read/x?margin=1");
  });

  it("reads a percent-encoded key as the parameter it is", () => {
    /* `?%61t=…` is `?at=…` to every parser in this app, because they all go
       through URLSearchParams. A filter that only matched the literal spelling
       is the shape of two address bugs already (router.ts § hasKey). */
    expect(rememberableSearch("?%61t=spya-a")).toBe("?%61t=spya-a");
    expect(rememberableSearch("?%6Eote=spya-a")).toBe("");
  });

  it("is empty when there is nothing of ours in the address", () => {
    expect(rememberableSearch("")).toBe("");
    expect(rememberableSearch("?")).toBe("");
    expect(rememberableSearch("?utm_source=newsletter")).toBe("");
  });

  it("does not throw on a malformed escape", () => {
    /* This runs on whatever address the reader arrived with, and a throw here
       would be a throw during a layout effect — the whole page. */
    expect(() => rememberableSearch("?%zz=1&at=spya-a")).not.toThrow();
    expect(rememberableSearch("?%zz=1&at=spya-a")).toBe("?at=spya-a");
  });
});

describe("hasArticleState", () => {
  it("is true for anything this app puts on an article's address", () => {
    for (const key of ARTICLE_PARAMS) {
      expect(hasArticleState(`?${key}=x`), key).toBe(true);
    }
  });

  it("is true for the parameters we would never put back — the link still wins", () => {
    /* The point of asking over *every* parameter rather than the remembered
       ones: a shared `?note=` link carries no `?at=`, and restoring a position
       under it would open an explanation of a paragraph somewhere off screen —
       which is the exact bug url-state.md records as fixed on 2026-08-26. */
    expect(hasArticleState("?note=spya-a")).toBe(true);
    expect(hasArticleState("?thread=spya-a")).toBe(true);
    expect(hasArticleState("?find=wet+hardware")).toBe(true);
  });

  it("is false for an address with nothing of ours on it", () => {
    expect(hasArticleState("")).toBe(false);
    expect(hasArticleState("?")).toBe(false);
    expect(hasArticleState("?utm_source=newsletter&fbclid=x")).toBe(false);
  });
});

describe("restoredHref", () => {
  it("puts the remembered view back on a bare address", () => {
    expect(restoredHref("/read/x", "", "?at=spya-a&mode=summary")).toBe(
      "/read/x?at=spya-a&mode=summary",
    );
  });

  it("leaves a link that says anything alone", () => {
    /* A shared link is a statement about where the reader should be, and it has
       to beat this browser's memory of where it last was. */
    expect(restoredHref("/read/x", "?at=spya-sent", "?at=spya-remembered")).toBe(null);
    expect(restoredHref("/read/x", "?note=spya-a", "?at=spya-remembered")).toBe(null);
    expect(restoredHref("/read/x", "?mode=chat", "?at=spya-remembered")).toBe(null);
  });

  it("does nothing when this device has never seen the article", () => {
    expect(restoredHref("/read/x", "", null)).toBe(null);
    expect(restoredHref("/read/x", "", "")).toBe(null);
  });

  it("keeps a foreign parameter that came in on the link", () => {
    expect(restoredHref("/read/x", "?utm_source=nl", "?at=spya-a")).toBe(
      "/read/x?utm_source=nl&at=spya-a",
    );
  });

  /**
   * **What is already in a browser's storage is not covered by the policy that
   * put it there.**
   *
   * `REMEMBERED` decides what gets *written*, so moving a parameter out of it
   * stops tomorrow's writes and does nothing whatever about yesterday's. On
   * 2026-09-05 `text` moved to `NEVER_REMEMBERED`, because the `Text` pill that
   * turned the prose back on had gone and `?mode=hierarchy&text=0` became a
   * state with no exit — `settleAddress` rewrote it to `?mode=structure` at boot
   * for exactly that reason, until the Hierarchy mode retired on 2026-09-29.
   *
   * But a restore runs from a layout effect, *after* boot. So a browser holding
   * the old value would have put the reader straight back into the stranded
   * state the rewrite existed to prevent, walking past it — and the passive
   * save that would clean the storage up happens too late to help the address
   * they are already looking at. `text` and `cols` have since left both lists,
   * and this is what drops them from a browser that still holds them.
   *
   * Filtering on the way **out** as well as on the way in is the general fix
   * rather than a patch for `text`: it makes the current policy authoritative
   * over whatever any past version of this app wrote, so the next parameter to
   * leave `REMEMBERED` is safe without anybody remembering this.
   *
   * GPT Sol, reviewing stage 3 of
   * docs/plans/260905d-declutter-the-reading-view-top-bars.md, 2026-09-05.
   */
  it("filters stored state through today's policy, not the one that wrote it", () => {
    expect(restoredHref("/read/x", "", "?mode=hierarchy&text=0")).toBe("/read/x?mode=hierarchy");
    // Nothing left worth restoring is the same as nothing stored.
    expect(restoredHref("/read/x", "", "?text=0")).toBe(null);
    // And a parameter that is still remembered rides through untouched.
    expect(restoredHref("/read/x", "", "?at=spya-a&text=0&cols=1,2&summary=brief&deep=2")).toBe(
      "/read/x?at=spya-a&summary=brief",
    );
  });

  it("restores onto whichever of the article's pages the address names", () => {
    /* The path says which article and which page; only the query string is
       remembered. Stepping out to the metadata page carries the parameters
       anyway (`carriedSearch` in router.ts), so this is only about arriving. */
    expect(restoredHref("/read/x/metadata", "", "?at=spya-a")).toBe("/read/x/metadata?at=spya-a");
  });

  /**
   * **`?section=` is an instruction, not a place** — the command bar's *Run
   * again* lands on `/read/x/metadata?section=ai-processing` (plan 261002c).
   * Unclassified, that address reads as bare and the remembered view is
   * appended over it; never remembered, because once the section has been
   * revealed the page takes it off again. GPT Sol's F5.
   */
  it("leaves the metadata page's section link alone, and never stores it", () => {
    expect(hasArticleState("?section=ai-processing")).toBe(true);
    expect(restoredHref("/read/x/metadata", "?section=ai-processing", "?at=spya-a&mode=quotes")).toBe(
      null,
    );
    expect(rememberableSearch("?at=spya-a&section=ai-processing")).toBe("?at=spya-a");
    expect(NEVER_REMEMBERED).toContain("section");
  });
});

/**
 * **The first-open default** — Greg, 2026-10-04 (spya-ax5tmm):
 *
 * > When I open an article for the first time, default to Summary/Briefer in left-hand (if there's
 * > room) and (if there's even more room) Marginalia mode in right-hand
 *
 * docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md.
 * The storage is a hand-made one handed in, because this file runs in node and
 * the two failures that matter — a read that throws, a write that throws — are
 * not ones a real `localStorage` can be asked to produce.
 */
describe("the first-open default", () => {
  const KEY = "spya.lastView.x";

  /** A `localStorage` over a map, with either verb made to throw. */
  function storage(initial: Record<string, string> = {}, broken: { read?: boolean; write?: boolean } = {}) {
    const held = new Map(Object.entries(initial));
    const source = () =>
      ({
        getItem(key: string) {
          if (broken.read) throw new Error("blocked");
          return held.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          if (broken.write) throw new Error("blocked");
          held.set(key, value);
        },
      }) as unknown as Storage;
    return { held, source };
  }

  describe("firstOpenSearch: what the window has room for", () => {
    it("is the article alone just below 700 usable px, and Summary from 700", () => {
      expect(firstOpenSearch(699, 16, true)).toBe("");
      expect(firstOpenSearch(700, 16, true)).toBe("?mode=summary");
    });

    it("adds the notes from 900, and not at 899", () => {
      expect(firstOpenSearch(899, 16, true)).toBe("?mode=summary");
      expect(firstOpenSearch(900, 16, true)).toBe("?mode=summary&margin=1");
    });

    it("leaves the notes out at any width for a reader whose experimental switch is off", () => {
      expect(firstOpenSearch(900, 16, false)).toBe("?mode=summary");
      expect(firstOpenSearch(2400, 16, false)).toBe("?mode=summary");
      expect(firstOpenSearch(699, 16, false)).toBe("");
    });
  });

  describe("readLastView: a failed read is not a missing key", () => {
    it("tells the three answers apart", () => {
      expect(readLastView("x", storage().source)).toEqual({ kind: "none" });
      expect(readLastView("x", storage({ [KEY]: "" }).source)).toEqual({ kind: "stored", search: "" });
      expect(readLastView("x", storage({ [KEY]: "?at=spya-a" }).source)).toEqual({
        kind: "stored",
        search: "?at=spya-a",
      });
      expect(readLastView("x", storage({}, { read: true }).source)).toEqual({ kind: "failed" });
    });
  });

  describe("writeLastView: Plain is stored, not forgotten", () => {
    it("keeps the key, empty, when there is nothing to remember", () => {
      const s = storage({ [KEY]: "?mode=summary" });
      expect(writeLastView("x", "", s.source)).toBe(true);
      expect(s.held.get(KEY)).toBe("");
    });

    it("says so when the write did not happen", () => {
      expect(writeLastView("x", "?at=spya-a", storage({}, { write: true }).source)).toBe(false);
    });
  });

  describe("claimFirstOpen: is this the first open, and is it on record", () => {
    it("claims a bare address with nothing stored, and leaves the marker behind", () => {
      const s = storage();
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(true);
      expect(s.held.get(KEY)).toBe("");
      /* The marker is what makes it once: the same question again is a no. */
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(false);
    });

    it("keeps a foreign parameter from counting as state", () => {
      const s = storage();
      expect(claimFirstOpen("x", "?utm_source=nl", readLastView("x", s.source), s.source)).toBe(true);
    });

    it("lets a link that says anything win, and writes no marker for it", () => {
      const s = storage();
      expect(claimFirstOpen("x", "?at=spya-sent", readLastView("x", s.source), s.source)).toBe(false);
      expect(claimFirstOpen("x", "?note=spya-a", readLastView("x", s.source), s.source)).toBe(false);
      expect(s.held.has(KEY)).toBe(false);
    });

    it("does not take a stored empty view for a first open", () => {
      const s = storage({ [KEY]: "" });
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(false);
    });

    it("stays Plain for a reader who went back to Plain and reopens", () => {
      const s = storage();
      /* First open, the default lands, the reader presses Plain at the top. */
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(true);
      writeLastView("x", rememberableSearch("?mode=summary&margin=1"), s.source);
      writeLastView("x", rememberableSearch(""), s.source);
      const again = readLastView("x", s.source);
      expect(again).toEqual({ kind: "stored", search: "" });
      expect(claimFirstOpen("x", "", again, s.source)).toBe(false);
      expect(restoredHref("/read/x", "", again.kind === "stored" ? again.search : null)).toBe(null);
    });

    it("claims nothing when the storage cannot be read", () => {
      const s = storage({}, { read: true });
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(false);
    });

    it("claims nothing when the marker cannot be written", () => {
      /* Otherwise every open would be a first one, and the default would
         override a later choice of Plain on every visit. GPT Sol, F1. */
      const s = storage({}, { write: true });
      expect(claimFirstOpen("x", "", readLastView("x", s.source), s.source)).toBe(false);
    });

    it("claims nothing where there is no storage at all", () => {
      /* The default source reads `window.localStorage`, and node has no window. */
      expect(readLastView("x")).toEqual({ kind: "failed" });
      expect(writeLastView("x", "")).toBe(false);
    });
  });

  describe("firstOpenHref: the address to arrive at, once the switch has answered", () => {
    const signedIn = { signedIn: true };

    it("puts the default on a bare address", () => {
      expect(firstOpenHref("x", "/read/x", "", signedIn, "?mode=summary&margin=1")).toBe(
        "/read/x?mode=summary&margin=1",
      );
      expect(firstOpenHref("x", "/read/x", "?utm_source=nl", signedIn, "?mode=summary")).toBe(
        "/read/x?utm_source=nl&mode=summary",
      );
    });

    it("gives a signed-out reader no default", () => {
      expect(firstOpenHref("x", "/read/x", "", { signedIn: false }, "?mode=summary")).toBe(null);
    });

    it("leaves the address alone where there is no room", () => {
      expect(firstOpenHref("x", "/read/x", "", signedIn, "")).toBe(null);
    });

    it("leaves a reader who has moved since the page opened alone", () => {
      /* On a cold load the switch answers a moment after the article draws. */
      expect(firstOpenHref("x", "/read/x", "?at=spya-a", signedIn, "?mode=summary")).toBe(null);
      expect(firstOpenHref("x", "/read/x", "?mode=quotes", signedIn, "?mode=summary")).toBe(null);
    });

    it("applies only to the reading view of the article it was claimed for", () => {
      expect(firstOpenHref("x", "/read/y", "", signedIn, "?mode=summary")).toBe(null);
      expect(firstOpenHref("x", "/read/x/metadata", "", signedIn, "?mode=summary")).toBe(null);
      expect(firstOpenHref("x", "/", "", signedIn, "?mode=summary")).toBe(null);
    });
  });
});

describe("the two lists cover every parameter the client writes", () => {
  /**
   * The shelf's own parameters, which never reach an article's address:
   * `topics` and `archived` joined the first five on 2026-09-28
   * (docs/project/shelf-terms.md). `topicsView` (pills or one row per topic)
   * joined them the same day (plan 260928d § Stage 2), and `public` (Include
   * public, plan 261002b) on 2026-10-02, and `tags` (the reader's own tags,
   * plan 261003d) on 2026-10-03.
   */
  const NOT_AN_ARTICLES = new Set([
    "q",
    "by",
    "dir",
    "view",
    "show",
    "topics",
    "archived",
    "public",
    "topicsView",
    "tags",
    /* `/admin/costs` (plan 261005a): its period, its switch, its grouping and
       sort, and one filter per dimension. An administrator's page, never an
       article's address. An article parameter given one of these names later
       would be hidden by this list, so check here first. */
    "period",
    "evals",
    "thenBy",
    "sort",
    "user",
    "article",
    "task",
    "category",
    "model",
    "upstream",
    "scope",
    "outcome",
    "day",
  ]);

  function clientFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...clientFiles(path));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
    }
    return out;
  }

  it("has heard of every nuqs-managed key in src/web", () => {
    const keys = new Set<string>();
    for (const file of clientFiles("src/web")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/useQueryState\(\s*["']([^"']+)["']/g)) {
        if (m[1]) keys.add(m[1]);
      }
      /* **`useQueryStates` too, and finding it is the reason this test exists.**
         The plural form takes an object of name → parser, so a parameter reached
         only that way is invisible to the singular pattern above — `?remember=`
         and `?thread=` are set through one of them in
         modes/conversation/ConversationModes.tsx. Both happened
         already to be in the lists, so this caught no live bug; it closes the
         hole a future one would arrive through. Matched to the closing `})` on
         its own line, which is what prettier gives every call in this repo. */
      let matched = 0;
      for (const m of text.matchAll(/useQueryStates\(\{([\s\S]*?)^\s*\}\)/gm)) {
        matched += 1;
        for (const k of (m[1] ?? "").matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
          if (k[1]) keys.add(k[1]);
        }
      }
      /* **Every call must have been understood, not just the ones that were.**
         The pattern above expects an object literal closing on its own line,
         which is what this repo's formatter produces — but a one-line
         `useQueryStates({ fresh: p })` would be skipped in silence, and a scan
         that quietly covers less than it claims is the exact shape
         docs/reusable/silent-success.md is about. Counting the calls and
         comparing turns "I did not match it" into a failure. GPT Sol, F3,
         2026-09-05. If this fires, widen the pattern — do not delete the
         count. */
      /* **Widened 2026-10-05 for a named map**: `useQueryStates(PARAMS, …)`,
         where `const PARAMS = { … };` is in the same file and closes on a line
         of its own. AdminCostsPage.tsx passes options as a second argument, so
         its call cannot end `})`. A name with no such declaration is not
         counted, and the comparison below still fails. */
      for (const m of text.matchAll(/useQueryStates\(([A-Z][A-Z0-9_]*)\b/g)) {
        const declared = new RegExp(`^const ${m[1]} = \\{([\\s\\S]*?)^\\};`, "m").exec(text);
        if (!declared) continue;
        matched += 1;
        for (const k of (declared[1] ?? "").matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
          if (k[1]) keys.add(k[1]);
        }
      }
      const calls = [...text.matchAll(/useQueryStates\(/g)].length;
      expect(matched, `${file}: a useQueryStates call this scan cannot read`).toBe(calls);
    }
    /* If this finds nothing the assertion below passes vacuously, which is the
       failure mode a scanning test has and the reason for this line. There were
       thirty-five parameters on 2026-09-05. */
    expect(keys.size).toBeGreaterThan(20);

    const unknown = [...keys].filter((k) => !NOT_AN_ARTICLES.has(k) && !ARTICLE_PARAMS.includes(k));
    expect(
      unknown,
      "a new article parameter: add it to REMEMBERED or NEVER_REMEMBERED in src/web/last-view.ts, " +
        "with the reason. Left out, a link carrying only this parameter reads as a bare address " +
        "and a remembered view is written over it.",
    ).toEqual([]);
  });

  it("does not name the same parameter twice", () => {
    expect(new Set(ARTICLE_PARAMS).size).toBe(ARTICLE_PARAMS.length);
    for (const key of NEVER_REMEMBERED) {
      expect(REMEMBERED as readonly string[], key).not.toContain(key);
    }
  });
});
