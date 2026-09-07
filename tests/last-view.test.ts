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
  hasArticleState,
  NEVER_REMEMBERED,
  REMEMBERED,
  rememberableSearch,
  restoredHref,
} from "../src/web/last-view.js";

describe("rememberableSearch", () => {
  it("keeps the parameters that say how you are looking at the article", () => {
    expect(rememberableSearch("?at=spya-tgnssb&mode=summary&deep=2")).toBe(
      "?at=spya-tgnssb&mode=summary&deep=2",
    );
  });

  it("keeps each pair byte-for-byte, so a comma list is not reserialised", () => {
    /* `URLSearchParams` would hand back `cols=0%2C1%2C2`, which parses to the
       same thing and reads as somebody else's URL. Same reason router.ts's
       rewrites are textual. */
    expect(rememberableSearch("?cols=0,1,2")).toBe("?cols=0,1,2");
  });

  it("drops the dialog, the drawer, the conversation and the search", () => {
    expect(
      rememberableSearch("?note=spya-a&panel=questions&thread=spya-b&find=wet+hardware&run=spya-c"),
    ).toBe("");
    expect(rememberableSearch("?at=spya-a&note=spya-b")).toBe("?at=spya-a");
    expect(rememberableSearch("?match=words&order=confidence&conf=65&runs=spya-a")).toBe("");
  });

  it("drops the three modes that start something merely by being arrived in", () => {
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
  });

  it("keeps every other mode as it stands", () => {
    for (const mode of ["plain", "hierarchy", "glossary", "search", "referee", "summary", "ideas", "outline", "quotes", "timeline"]) {
      expect(rememberableSearch(`?mode=${mode}`), mode).toBe(`?mode=${mode}`);
    }
    expect(rememberableSearch("?mode=glossary&term=spya-h4r2wd")).toBe(
      "?mode=glossary&term=spya-h4r2wd",
    );
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
   * state with no exit — `settleAddress` rewrites it to `?mode=outline` at boot
   * for exactly that reason (router.ts § `liftStrandedText`).
   *
   * But a restore runs from a layout effect, *after* boot. So a browser holding
   * the old value would put the reader straight back into the stranded state
   * the rewrite exists to prevent, walking past it — and the passive save that
   * would clean the storage up happens too late to help the address they are
   * already looking at.
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
    expect(restoredHref("/read/x", "", "?at=spya-a&text=0&cols=1,2")).toBe(
      "/read/x?at=spya-a&cols=1,2",
    );
  });

  it("restores onto whichever of the article's pages the address names", () => {
    /* The path says which article and which page; only the query string is
       remembered. Stepping out to the metadata page carries the parameters
       anyway (`carriedSearch` in router.ts), so this is only about arriving. */
    expect(restoredHref("/read/x/metadata", "", "?at=spya-a")).toBe("/read/x/metadata?at=spya-a");
  });
});

describe("the two lists cover every parameter the client writes", () => {
  /** The five that belong to the shelf and the one that belongs to /admin. */
  const NOT_AN_ARTICLES = new Set(["q", "by", "dir", "view", "show"]);

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
