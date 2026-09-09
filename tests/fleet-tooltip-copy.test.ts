/**
 * **The rules the dashboard's explanations are written under, enforced rather
 * than remembered.**
 *
 * Greg, 2026-09-09: *"look through the web-dashboard, and add rich tooltips to
 * anything that the user might require explanation of, and/or to provide extra
 * detail/information that might be valuable"*.
 *
 * This page already carried ~47 cards before that, so the risk is not that
 * nobody writes one — it is that the next one is written the two ways the house
 * rules forbid, both of which look fine on the laptop of whoever wrote them.
 *
 *  1. **A native `title=` attribute.** It shows *something* under a mouse, so
 *     it passes every check a laptop can make — and it does not exist on a
 *     phone, which is the device this page is actually read on, or to a screen
 *     reader that never fires a hover. `Tooltip.tsx`'s header states this and
 *     three of them had accumulated anyway.
 *  2. **A second paragraph that is the first one again.** `Tip` has a `what`
 *     and a `how` because *"the first sentence is what a reader could have
 *     guessed by pressing the control; the second is what they could not"*
 *     (docs/project/tooltips.md). A `how` that restates the `what` costs a
 *     reader 240 ms to be told what the label already told them.
 *
 * And one rule about the words themselves: **copy describes the artefact, not
 * the gesture**. A tip is read on hover, on a tap, by a screen reader as
 * `aria-describedby`, and in this repo's docs — so *"click to see X"* is false
 * on three of those four surfaces.
 *
 * ## Why the first half is a source scan rather than a render
 *
 * Because the claim is about **every component**, including the arms a fixture
 * does not reach — a `title=` inside a five-deep conditional is exactly the one
 * that survives a render test. Mounting each panel would need its whole prop
 * surface (`SessionsPanel` alone takes fifteen), and the thing being asserted is
 * not behavioural: the attribute is either written in the file or it is not.
 *
 * The scan is deliberately narrow — a `title=` on a **host** element, i.e. a
 * lowercase tag — because `title` is also an ordinary prop name on this page's
 * own components (`<Section title="Latest message">`), and a check that flagged
 * those would be turned off within a week.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tipText, type Tip } from "../tools/fleet/web/src/Tooltip";
import { MODE_TIPS } from "../tools/fleet/web/src/Dock";
import { HANDLE_TIPS, STATUS_TIPS, UPTIME_TIP } from "../tools/fleet/web/src/SessionParts";
import {
  ANY_BAND_TIP,
  BAND_TIPS,
  GENERATED_TITLE_TIP,
  ORDER_TIP,
  OVERSEER_BADGE_TIP,
} from "../tools/fleet/web/src/SessionsPanel";
import { CLAIM_TIPS, COUNT_TIPS } from "../tools/fleet/web/src/Header";
import { SPEAKER_TIPS } from "../tools/fleet/web/src/Turn";
/* The Usage tab's stat cards, exported for this guard rather than written
   inline — session `dashboard-design-system`, 2026-09-09, on this file's own
   author pointing out that a tip written inline in a component gets none of the
   three rules below and does not count towards the floor. `usageWindowTip` is
   computed from a window, so it is registered on one value each way, like
   `instantTip`. */
import { USAGE_TIPS, usageWindowTip } from "../tools/fleet/web/src/UsagePanel";
import {
  BADGE_TIPS,
  FACT_TIPS,
  HISTORY_TIP,
  PROBLEM_TIPS,
  SETTLED_TIP,
  badgeTip,
} from "../tools/fleet/web/src/QueuePanel";
import { instantTip } from "../tools/fleet/web/src/instant";

const WEB_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tools/fleet/web/src",
);

/**
 * **The one `title=` on a host element that is allowed, and why.**
 *
 * `ReadinessPanel.tsx` marks each run in its day band with a native `title`.
 * It is the same mistake as the two this pass removed from `SessionsPanel`, and
 * it is left standing because the file belongs to another session
 * (`readiness-tab`) which was still finishing it on 2026-09-09 — editing it
 * would have been a conflict, not a fix.
 *
 * **Delete this entry rather than growing it.** It is a note of one known debt,
 * not a door: an addition here is somebody about to ship hover-only text on a
 * page read on a phone.
 */
const KNOWN_HOVER_ONLY: Readonly<Record<string, number>> = { "ReadinessPanel.tsx": 1 };

/** Every `.tsx` in the client, as `[filename, source]`. */
function components(): [string, string][] {
  return readdirSync(WEB_SRC)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => [name, readFileSync(path.join(WEB_SRC, name), "utf8")]);
}

/**
 * The source with every comment blanked out, newlines kept.
 *
 * **Without this the check reads its own prose.** The first version flagged
 * `SessionsPanel.tsx` for a `title=` that was in the doc comment explaining
 * that the two badges used to have one — a checker fooled by a file talking
 * about the thing it is being checked for. Blanking rather than deleting so
 * that a reported line number is still the line in the file.
 *
 * **Comments only, and string literals deliberately NOT.** The version before
 * this one blanked strings too, and GPT Sol found what that costs: this is a
 * character scanner, not a parser, so it cannot tell a JavaScript quote from an
 * apostrophe in JSX text — and this codebase is full of `session's transcript`.
 * From that apostrophe to the next one, everything was blanked, and a real
 * `title=` in between would have vanished. **A guard that goes quiet is worse
 * than one that cries wolf**, so the trade is now the other way round: a
 * `title=` inside a string literal WOULD be reported, and that is a loud
 * one-line diagnosis rather than a silent miss. A real parse (a TypeScript/JSX
 * AST walk) would beat both and is what to reach for if this ever gets fiddly.
 */
function codeOnly(source: string): string {
  const out = source.split("");
  let i = 0;
  const blankTo = (end: number) => {
    for (let j = i; j < end && j < out.length; j += 1) if (out[j] !== "\n") out[j] = " ";
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blankTo(end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blankTo(stop);
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/**
 * The tag a `title=` at `index` belongs to, or `null` if it cannot be found.
 *
 * Walks back to the nearest `<`, which is the opening of the element the
 * attribute is on — attribute values on this page never contain one, and a
 * false answer here can only ever *add* a finding for somebody to read.
 */
function owningTag(source: string, index: number): string | null {
  const open = source.lastIndexOf("<", index);
  if (open === -1) return null;
  const match = /^<\s*([A-Za-z][\w.-]*)/.exec(source.slice(open, index));
  return match?.[1] ?? null;
}

describe("nothing on this page explains itself by hover alone", () => {
  it("has no `title=` attribute on a host element", () => {
    const found: string[] = [];
    const allowed: Record<string, number> = {};
    for (const [name, raw] of components()) {
      const source = codeOnly(raw);
      for (const hit of source.matchAll(/\btitle\s*=\s*["'{]/g)) {
        const tag = owningTag(source, hit.index);
        /* A lowercase tag is a DOM element and `title` is the browser's own
           tooltip; a capitalised one is a component of ours and `title` is an
           ordinary prop. */
        if (tag !== null && /^[a-z]/.test(tag)) {
          const line = source.slice(0, hit.index).split("\n").length;
          if (KNOWN_HOVER_ONLY[name] !== undefined) allowed[name] = (allowed[name] ?? 0) + 1;
          else found.push(`${name}:${line} — <${tag} title=…>`);
        }
      }
    }
    expect(found).toEqual([]);
    /* **The exemption is a COUNT, not a file.** Skipping the whole file let a
       second hover-only tooltip land in it unnoticed while the stale-entry
       check below still passed. GPT Sol's P2. */
    expect(allowed).toEqual(KNOWN_HOVER_ONLY);
  });

  it("would still catch one — the blanking keeps attributes and drops prose", () => {
    /* **The check's own check.** `codeOnly` was added because the scan read a
       doc comment that merely mentioned `title=`, and a fix of that shape can
       just as easily blank the thing being looked for — leaving a test that
       passes because it now sees nothing at all. So: a real attribute survives
       it, and each of the three ways of writing prose does not.
       docs/reusable/silent-success.md. */
    const attribute = codeOnly('<span title="hover only">x</span>');
    expect(/\btitle\s*=\s*["'{]/.test(attribute)).toBe(true);
    expect(owningTag(attribute, attribute.indexOf("title="))).toBe("span");

    // Whitespace before `=` is legal JSX, and the first pattern missed it.
    expect(/\btitle\s*=\s*["'{]/.test(codeOnly("<span title = 'x'>y</span>"))).toBe(true);

    // Both comment forms are blanked — the false positive this exists for.
    for (const prose of ['<b>x</b>\n// it had title="x" once', '<b>x</b>\n/* it had title="x" once */']) {
      expect(/\btitle\s*=\s*["'{]/.test(codeOnly(prose))).toBe(false);
    }

    /* **An apostrophe in JSX text must not blank what follows it.** This is the
       false NEGATIVE that blanking string literals bought, and it is the reason
       this function no longer does. */
    const apostrophe = codeOnly("<p>the session's transcript</p>\n<span title=\"real\">x</span>");
    expect(/\btitle\s*=\s*["'{]/.test(apostrophe)).toBe(true);
    // And the line numbers a finding is reported at still line up.
    expect(codeOnly("a\n// b\nc").split("\n").length).toBe(3);
  });

  it("still watches the file that is allowed one, so the entry cannot go stale unnoticed", () => {
    /* An allow-list whose entry has been fixed is a check that has quietly
       stopped checking anything. This fails when `ReadinessPanel.tsx` loses its
       `title=`, which is the moment to delete the entry above — and it is the
       reason the list is a note of a debt rather than a permanent exemption. */
    const source = readFileSync(path.join(WEB_SRC, "ReadinessPanel.tsx"), "utf8");
    expect(source).toContain("title={`");
  });
});

/**
 * Every tip this page can draw, gathered so that a rule can be asserted over
 * all of them at once rather than one test per card.
 *
 * **Not every tip on the page** — most are object literals written inline at
 * their use site, and reaching those would mean exporting a const from every
 * panel, which is a change to files three other sessions are in. What is here
 * is what is already exported, plus the registry this pass adds. A tip written
 * inline tomorrow is not covered, and that is a known limit rather than a
 * claim: see § the registry in
 * docs/plans/260909c-rich-tooltips-across-the-fleet-dashboard.md.
 */
function everyTip(): [string, Tip][] {
  const out: [string, Tip][] = [
    ["UPTIME_TIP", UPTIME_TIP],
    ["OVERSEER_BADGE_TIP", OVERSEER_BADGE_TIP],
    ["GENERATED_TITLE_TIP", GENERATED_TITLE_TIP],
    ["ANY_BAND_TIP", ANY_BAND_TIP],
    ["ORDER_TIP", ORDER_TIP],
    ["HISTORY_TIP", HISTORY_TIP],
    ["SETTLED_TIP", SETTLED_TIP],
    /* The two computed ones, on a value each can read. `instantTip`'s other arm
       — an instant it cannot parse — is covered in fleet-speaker-tips. */
    ["instantTip", instantTip("2026-09-08T23:40:00.000Z")],
    ["badgeTip(unknown)", badgeTip("a badge from a newer server")],
    [
      "usageWindowTip(value)",
      usageWindowTip({
        kind: "value",
        window: "five_hour",
        utilizationPercent: 40,
        resetsAt: "2026-09-09T12:00:00.000Z",
      }),
    ],
    ["usageWindowTip(unknown)", usageWindowTip({ kind: "unknown", window: "five_hour", why: "no resets_at on it" })],
  ];
  const maps: [string, Record<string, Tip>][] = [
    ["MODE_TIPS", MODE_TIPS],
    ["STATUS_TIPS", STATUS_TIPS],
    ["HANDLE_TIPS", HANDLE_TIPS],
    ["BAND_TIPS", BAND_TIPS],
    ["COUNT_TIPS", COUNT_TIPS],
    ["CLAIM_TIPS", CLAIM_TIPS],
    ["SPEAKER_TIPS", SPEAKER_TIPS],
    ["BADGE_TIPS", BADGE_TIPS],
    ["PROBLEM_TIPS", PROBLEM_TIPS],
    ["FACT_TIPS", FACT_TIPS],
    ["USAGE_TIPS", USAGE_TIPS],
  ];
  for (const [name, map] of maps) {
    for (const [key, tip] of Object.entries(map)) out.push([`${name}.${key}`, tip]);
  }
  return out;
}

/** The words in a sentence, lowercased, without the ones every sentence has. */
function contentWords(text: string): Set<string> {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "it", "is", "are", "was",
    "were", "be", "been", "that", "this", "which", "what", "with", "for", "from", "by", "as", "so",
    "not", "no", "than", "then", "there", "its", "one", "has", "have", "had", "can", "could",
    "would", "will", "does", "do", "did", "you", "your", "they", "them",
  ]);
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}

describe("the shape of a card, over every tip that can be reached from a module", () => {
  it("still reaches the tips it thinks it does", () => {
    /* **A floor, not an exact count**, because new cards arrive weekly and a
       test that had to be edited for each of them would be edited without being
       read. What it catches is the other direction: an import quietly dropped in
       a refactor, which leaves every assertion below passing over a shorter
       list. The three rules under it are only worth what this number is. */
    /* Set just under the real count, so dropping ANY ONE of the imported maps
       fails. A floor of 60 against ~70 reachable tips did not do that, which
       GPT Sol pointed out was the stated purpose unmet. */
    expect(everyTip().length).toBeGreaterThanOrEqual(68);
  });

  it("gives each one a head, a what and a how", () => {
    for (const [name, tip] of everyTip()) {
      expect(`${name}: ${tip.head}`).toMatch(/: \S/);
      expect(`${name}: ${tip.what.length > 20}`).toBe(`${name}: true`);
      expect(`${name}: ${tip.how.length > 20}`).toBe(`${name}: true`);
    }
  });

  it("never lets the second paragraph be the first one again", () => {
    /* **A copy is what this catches; a paraphrase is not.** Its value is that it
       makes the cheapest way to fill a `how` — restating the `what` — fail,
       which is the failure the dock's own tips were shipped with once
       (docs/plans/260907b-rich-tooltips-on-the-dock-modes.md). Lifted from
       `restates` in tests/dock-mode-tooltips.tsx. */
    for (const [name, tip] of everyTip()) {
      const what = contentWords(tip.what);
      const how = contentWords(tip.how);
      const shared = [...how].filter((w) => what.has(w));
      const overlap = how.size === 0 ? 1 : shared.length / how.size;
      expect(`${name}: ${overlap < 0.6}`).toBe(`${name}: true`);
    }
  });

  it("describes the artefact rather than the gesture", () => {
    /* docs/project/tooltips.md. A card is read on hover, on a tap, by a screen
       reader and in a doc — "click to X" is false on three of those. The words
       are matched narrowly, so a sentence that legitimately says what pressing
       a *different* control does is not caught by accident. */
    const gestures = [/\bclick\b/i, /\btap (?:it|this|here)\b/i, /\bhover(?:ing)? over\b/i, /\bopening (?:it|this)\b/i];
    for (const [name, tip] of everyTip()) {
      const words = tipText(tip);
      for (const gesture of gestures) {
        expect(`${name} ${gesture}: ${gesture.test(words)}`).toBe(`${name} ${gesture}: false`);
      }
    }
  });
});
