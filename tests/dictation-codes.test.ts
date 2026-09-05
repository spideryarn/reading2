/**
 * **One `[mic-…]` code, one sentence.**
 *
 * [copy.md](../docs/project/copy.md) states the rule and
 * [`tests/messages.test.ts`](./messages.test.ts) enforces it — for
 * `src/messages.ts`. The whole `mic-` family lives *outside* that file on
 * purpose (a blocked permission and a headset unplugged mid-sentence are not
 * failures a model call can return), and so it was outside the check as well.
 *
 * The cost of that gap, found on 2026-09-05 while reading a feedback report
 * that said only *"I got a [mic-offline] error"*: **three codes carried two
 * different sentences each**, and the reader quoting four characters had
 * therefore named two branches rather than one. `[mic-offline]` was the
 * recogniser losing its connection *while the reader was still talking* and
 * also the upload failing *after they had stopped* — which is why that report
 * had to be written with an "if" in front of each half.
 *
 * So this test does for the `mic-` family exactly what `messages.test.ts` does
 * for `src/messages.ts`: it reads the tree, finds every sentence that ends in a
 * `[mic-…]` code, and fails if one code has two of them.
 *
 * It reads the **source**, not a registry, because a registry is a second list
 * to keep in step and the thing being checked is what a reader will actually
 * see. See `sentencesInTree` for how a sentence is recovered from a literal.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;

/** Every `.ts`/`.tsx` under `src/`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
      continue;
    }
    if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

export interface MicSentence {
  code: string;
  /** The literal's text, with any `${…}` reduced to a placeholder. */
  sentence: string;
  file: string;
}

/**
 * Recover the sentence a `[mic-…]` code sits at the end of.
 *
 * **Forwards to the closing quote first, then backwards to the matching one**,
 * rather than the other way round — which is the whole trick. Walking backwards
 * from the code to "the nearest quote character" finds the apostrophe in
 * *"this page's language"* and returns half a sentence. The closing delimiter
 * is unambiguous (a `"` or a backtick after the `]`), and once it is known, the
 * opening one is the last of that same character before the code.
 *
 * `${…}` is replaced with `…` so that the server's interpolated megabyte figure
 * compares equal to itself, and whitespace is collapsed because a template
 * literal in `src/routes.ts` is wrapped across four lines with its indentation
 * inside the string.
 */
export function sentenceAround(text: string, at: number): string | null {
  const offset = text.slice(at).search(/["`]/);
  if (offset === -1) return null;
  const close = at + offset;
  const delim = text[close];
  if (!delim) return null;
  /* **`close - 1`, not `close`.** `lastIndexOf` searches backwards *from and
     including* its second argument, and the character at `close` is the closing
     delimiter itself — so the unguarded spelling found the closer as the opener
     and every sentence in the tree came back empty. The first run of this file
     found nothing at all and said so, which is the only reason it is not still
     doing that. */
  const open = text.lastIndexOf(delim, close - 1);
  if (open === -1) return null;
  return text
    .slice(open + 1, close)
    .replace(/\$\{[^{}]*\}/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * **The comments have to go before the strings can be read.**
 *
 * Half these files explain their own codes in prose, and a doc comment writes
 * one as `` `[mic-too-long]` `` — a backtick either side, which is
 * indistinguishable from a template literal to anything short of a parser. The
 * first run of this file duly reported `dictation-limits.ts` as raising a
 * sentence consisting of nothing but a code.
 *
 * Block comments only. Every prose mention in the tree is in one, and stripping
 * `//` to end-of-line would mangle any line holding a `https://` inside a
 * string. The count assertion in the first test is what says this did not strip
 * too much.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Codes the scanner found but could not read a sentence around. See below. */
export const skipped: string[] = [];

export function sentencesInTree(): MicSentence[] {
  const found: MicSentence[] = [];
  skipped.length = 0;
  for (const file of sourceFiles(SRC)) {
    const text = withoutComments(readFileSync(file, "utf8"));
    const codes = /\[mic-[a-z-]+\]/g;
    let m: RegExpExecArray | null = codes.exec(text);
    while (m) {
      const end = m.index + m[0].length;
      const sentence = sentenceAround(text, end);
      /* A `[mic-…]` written in a comment rather than in a string — this file's
         own prose reaches here too when the suite runs over `src/`, and so does
         every explanatory comment in `useDictation.ts`. A sentence recovered
         from one is not copy and must not be compared as though it were. */
      if (sentence?.endsWith(m[0])) {
        found.push({ code: m[0], sentence, file: file.slice(SRC.length) });
      } else {
        /* **Recorded rather than dropped.** A code the scanner cannot resolve
           to a sentence is not a code that is fine — it is one this file is
           blind to, and a collision hiding behind it would never be reported.
           The count assertion catches the scanner failing *entirely*; this
           catches it failing for one message. GPT Sol's code review, T1. */
        skipped.push(`${file.slice(SRC.length)}: ${m[0]}`);
      }
      m = codes.exec(text);
    }
  }
  return found;
}

describe("the mic- codes", () => {
  it("finds the sentences at all", () => {
    /* Guards the scanner rather than the copy. If `sentenceAround` ever stopped
       working, every assertion below would pass over an empty list and this
       whole file would be a check that never checks anything —
       docs/reusable/silent-success.md. */
    const all = sentencesInTree();
    expect(all.length).toBeGreaterThan(12);
    expect(all.map((s) => s.code)).toContain("[mic-offline]");
  });

  it("reads every code it finds, rather than passing over the ones it cannot parse", () => {
    /* The scanner understands `"` and backtick delimiters. A message written
       with single quotes, or one whose sentence contains an escaped delimiter,
       would be skipped — and a skipped message is one this file cannot see a
       collision in. So a skip is a failure of the scanner, reported as one,
       rather than a message quietly excused from the rule. */
    sentencesInTree();
    expect(skipped).toEqual([]);
  });

  it("never gives one code two different sentences", () => {
    const byCode = new Map<string, Set<string>>();
    for (const { code, sentence } of sentencesInTree()) {
      const seen = byCode.get(code) ?? new Set<string>();
      seen.add(sentence);
      byCode.set(code, seen);
    }
    const clashes = [...byCode.entries()]
      .filter(([, sentences]) => sentences.size > 1)
      .map(([code, sentences]) => `${code}\n    ${[...sentences].join("\n    ")}`);
    expect(clashes).toEqual([]);
  });

  it("puts the code last, in brackets, after a full sentence", () => {
    /* The shape copy.md asks for: a sentence somebody can stop reading at the
       full stop, and then a reference. `tests/dictation-errors.test.ts` checks
       this for the recogniser's table; this covers the other four files. */
    for (const { code, sentence, file } of sentencesInTree()) {
      expect(`${file}: ${sentence}`).toMatch(/[.!?] \[mic-[a-z-]+\]$/);
      expect(code).toMatch(/^\[mic-[a-z-]+\]$/);
    }
  });
});
