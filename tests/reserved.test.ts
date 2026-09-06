/**
 * **Only src/reserved.ts may name a `data-spya-*` attribute.**
 *
 * Those attributes are how stage 2 tells stage 3 what the author's markup said
 * before Readability deleted it, and every one of them carries the same two
 * obligations: scrub the copies the page arrived with, `<template>` fragments
 * included, and never carry a value the page supplied. Three families had grown
 * three correct copies of that walk — and the risk was never the copies that
 * exist. It is the fourth, written by somebody who has read none of them.
 *
 * So the rule is enforced by scanning the source rather than by hoping, which is
 * the only form that catches the case it exists for.
 * docs/plans/260831af-carrying-markup-facts-past-readability.md.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  CONTEXT_ATTRS,
  CONTEXT_ID_PATTERN,
  RESERVED_ATTRS,
  RESERVED_PREFIX,
  mintContextId,
  scrubReserved,
} from "../src/reserved.js";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const OWNER = path.join(SRC, "reserved.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/**
 * Source with comments removed, so **prose cannot satisfy or fail the scan**.
 *
 * Both directions matter here. Every one of these files explains itself at
 * length and several quote the attribute by name in a sentence; a scan over raw
 * text would fail on the documentation and pass on a file that mentioned the
 * name in a comment while writing a different one in code.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("the reserved attribute namespace", () => {
  it("is named in one file and nowhere else", () => {
    const registered = new Set<string>(Object.values(RESERVED_ATTRS));
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === OWNER) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      /* **The bare prefix, wherever it appears** — not just after a quote. The
         first version matched `["'`]data-spya-…`, which is a tripwire rather
         than a rule: a JSX attribute (`<div data-spya-rogue="" />`) and an
         unquoted token both walked past it. GPT Sol, 2026-08-31. */
      for (const match of code.matchAll(new RegExp(`${RESERVED_PREFIX}[a-z-]*`, "g"))) {
        offenders.push(`${path.relative(SRC, file)} → ${match[0]}`);
      }
      /* And the other way round the rule: a name *composed* from the exported
         prefix never contains the literal, so the scan above cannot see it. */
      if (/RESERVED_PREFIX\s*[+`]/.test(code) || /\$\{RESERVED_PREFIX\}/.test(code)) {
        offenders.push(`${path.relative(SRC, file)} → composes a name from RESERVED_PREFIX`);
      }
    }
    /* The message is the point: somebody hits this while writing the fourth
       recogniser, and what they need is the rule, not a diff. */
    expect(offenders, "register it in src/reserved.ts and import the constant").toEqual([]);
    // And the registry is not empty, or the assertion above proves nothing.
    expect(registered.size).toBeGreaterThan(0);
  });

  it("catches the two shapes that used to walk past the scan", () => {
    /* The scan is a regex over source, so its own coverage is worth pinning:
       these are the strings GPT Sol showed slipping through, checked against the
       same patterns the test above uses rather than against a second spelling. */
    const bare = `<div ${RESERVED_PREFIX}rogue="" />`;
    const composed = "const attr = RESERVED_PREFIX + \"rogue\";";
    expect(new RegExp(`${RESERVED_PREFIX}[a-z-]*`).test(bare)).toBe(true);
    expect(/RESERVED_PREFIX\s*[+`]/.test(composed)).toBe(true);
  });

  it("registers every attribute the recognisers actually write", () => {
    // A name could be registered and unused, which is harmless. The reverse is
    // the failure, and the scan above only sees string literals — so this pins
    // the two families by their exported constants.
    const used = [
      RESERVED_ATTRS.note,
      RESERVED_ATTRS.noteRef,
      RESERVED_ATTRS.noteBack,
      RESERVED_ATTRS.notesContainer,
      RESERVED_ATTRS.callout,
      RESERVED_ATTRS.wasId,
      RESERVED_ATTRS.wasName,
      RESERVED_ATTRS.pdfFigure,
    ];
    for (const attr of used) expect(attr.startsWith(RESERVED_PREFIX)).toBe(true);
    expect(new Set(used).size).toBe(used.length); // no two families sharing a name
  });

  it("maps each context attribute to exactly one type", () => {
    const types = CONTEXT_ATTRS.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    for (const { attr } of CONTEXT_ATTRS) {
      expect(Object.values(RESERVED_ATTRS)).toContain(attr);
    }
  });
});

describe("the shared scrub", () => {
  function docOf(body: string): Document {
    return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;
  }

  it("takes the attribute off ordinary elements", () => {
    const doc = docOf(`<p ${RESERVED_ATTRS.callout}="c-0000000000">Forged.</p>`);
    scrubReserved(doc, [RESERVED_ATTRS.callout]);
    expect(doc.querySelector(`[${RESERVED_ATTRS.callout}]`)).toBeNull();
  });

  it("enters a template, which querySelectorAll does not", () => {
    /* The failure this function exists for: a template's children live in a
       separate fragment, so a query walks past them while `outerHTML`
       serialises them in full. A stamp inside one survived two scrubs once. */
    const doc = docOf(`<template><p ${RESERVED_ATTRS.note}="spya-note-0123456789">In here.</p></template>`);
    scrubReserved(doc, [RESERVED_ATTRS.note]);
    const inside = doc.querySelector("template") as HTMLTemplateElement;
    expect(inside.innerHTML).not.toContain(RESERVED_ATTRS.note);
  });

  it("reaches html and body when called from the document", () => {
    // The two elements a body-rooted scrub cannot see, and the two that sit
    // outside the subtree the sanitiser rewrites.
    const dom = new JSDOM(
      `<!doctype html><html ${RESERVED_ATTRS.callout}="c-0000000000">` +
        `<body ${RESERVED_ATTRS.callout}="c-0000000000"><p>Prose.</p></body></html>`,
    );
    scrubReserved(dom.window.document, [RESERVED_ATTRS.callout]);
    expect(dom.window.document.documentElement.hasAttribute(RESERVED_ATTRS.callout)).toBe(false);
    expect(dom.window.document.body.hasAttribute(RESERVED_ATTRS.callout)).toBe(false);
  });

  it("leaves attributes it was not asked about alone", () => {
    const doc = docOf(`<p ${RESERVED_ATTRS.note}="spya-note-0123456789" id="keep">Note.</p>`);
    scrubReserved(doc, [RESERVED_ATTRS.callout]);
    expect(doc.querySelector(`[${RESERVED_ATTRS.note}]`)).not.toBeNull();
    expect(doc.querySelector("#keep")).not.toBeNull();
  });
});

describe("context ids", () => {
  it("are stable across runs, so a re-extraction diff shows real changes", () => {
    expect(mintContextId("callout:the same words", new Set())).toBe(
      mintContextId("callout:the same words", new Set()),
    );
  });

  it("are different for different text", () => {
    expect(mintContextId("callout:one", new Set())).not.toBe(
      mintContextId("callout:two", new Set()),
    );
  });

  it("separate two boxes that happen to hold the same words", () => {
    const taken = new Set<string>();
    const first = mintContextId("callout:same", taken);
    const second = mintContextId("callout:same", taken);
    expect(second).not.toBe(first);
    expect(second.startsWith(`${first}-`)).toBe(true);
  });

  it("always match the pattern stage 3 validates against", () => {
    const taken = new Set<string>();
    for (const text of ["", "a", "…unicode ✓", "x".repeat(5000), "callout:same", "callout:same"]) {
      expect(mintContextId(text, taken)).toMatch(CONTEXT_ID_PATTERN);
    }
  });
});
