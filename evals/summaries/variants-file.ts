/**
 * **[`variants.md`](variants.md) is the source of the prompt text, and this
 * reads it.** Not a second copy of it in TypeScript.
 *
 * The alternative was to transcribe four forty-line prompt blocks into string
 * literals here and leave the markdown as prose about them. That is two homes
 * for one fact, and the repo's rule is one
 * (`CLAUDE.md` § *Cite, don't restate*): the day somebody fixes a typo in V2's
 * WEIGHS branch, the arm the harness actually sends is the one nobody edited,
 * and no test can tell because both files are internally consistent.
 *
 * So `variants.md` is the artefact — it carries the axes, the worked examples,
 * the reasoning and the code change V4 needs — and the fenced blocks in it are
 * what goes on the wire, verbatim.
 *
 * **The parse is loud on every failure and silent on none.** A section that
 * moved, a section that appeared twice, a fence that disappeared, an anchor row
 * that stopped being a table row: each throws, naming the heading it was looking
 * under. (It used to say *"a fence that lost its language tag"*, which was never
 * true — every prompt fence in `variants.md` is untagged and always has been, so
 * the one example given was the one thing that could not happen. GPT Sol, F15,
 * 2026-09-07.) That matters
 * more here than in most parsers, because the failure mode of a lenient one is
 * an arm that sends an EMPTY questions block, produces plausible output anyway
 * (the model still has the gist rules and the shape of the JSON) and scores as
 * a variant — `docs/reusable/silent-success.md`, in the one place a screen
 * cannot afford it.
 *
 * Adding a fifth variant is therefore: a `## V5 — <axis>` section with one
 * fenced block in `variants.md`, plus one entry in `ARMS`
 * ([`arms.ts`](arms.ts)). No code changes here.
 */

import { readFileSync } from "node:fs";

/** `variants.md`, beside this file. */
export const VARIANTS_PATH = new URL("variants.md", import.meta.url);

/**
 * The text of the first fenced block under a `##` heading matching `test`.
 *
 * `test` matches against the heading line with the `## ` stripped, so
 * `/^V1\b/` finds `## V1 — presupposed direction, hint in the topic slot` and
 * would not find `### V1 something`.
 */
function fencedUnder(markdown: string, test: RegExp, label: string): string {
  const lines = markdown.split("\n");
  let i = lines.findIndex((l) => l.startsWith("## ") && test.test(l.slice(3).trim()));
  if (i < 0) throw new Error(`variants.md: no "## " heading matching ${test} (${label})`);
  for (i += 1; i < lines.length; i++) {
    const line = lines[i]!;
    /* A new `##` before a fence means the section has none — which is a
       different fault from "the file has no such section", and says so. */
    if (line.startsWith("## ")) break;
    if (!line.startsWith("```")) continue;
    const body: string[] = [];
    for (i += 1; i < lines.length; i++) {
      if (lines[i]!.startsWith("```")) {
        const text = body.join("\n").trim();
        if (text === "") throw new Error(`variants.md: the fenced block under ${label} is empty`);
        return text;
      }
      body.push(lines[i]!);
    }
    throw new Error(`variants.md: unterminated fenced block under ${label}`);
  }
  throw new Error(`variants.md: no fenced block under ${label}`);
}

/** One negative anchor, exactly as the table in variants.md gives it. */
export interface AnchorRow {
  /** 1–5, the table's own numbering — quoted in the calibration report. */
  n: number;
  /** The single defect this line carries, in Fable's words. */
  failure: string;
  /** The line itself, as it would be rendered to a reader. */
  line: string;
}

/**
 * The five rows of the anchors table.
 *
 * Read out of the markdown for the same reason as the prompts: the anchor lines
 * are quoted verbatim in the write-up, and a second copy would let the gate
 * test a line the document does not describe.
 */
function anchorRows(markdown: string): AnchorRow[] {
  const lines = markdown.split("\n");
  let i = lines.findIndex((l) => l.startsWith("## ") && /negative anchors/i.test(l));
  if (i < 0) throw new Error(`variants.md: no "## …negative anchors" heading`);
  const rows: AnchorRow[] = [];
  for (i += 1; i < lines.length && !lines[i]!.startsWith("## "); i++) {
    const cells = lines[i]!.split("|").map((c) => c.trim());
    /* `| n | failure | line |` splits to ["", n, failure, line, ""]. */
    if (cells.length !== 5) continue;
    const n = Number(cells[1]);
    if (!Number.isInteger(n) || n < 1) continue;
    const failure = cells[2]!;
    const quoted = /^`(.+)`$/.exec(cells[3]!);
    if (!quoted) {
      throw new Error(
        `variants.md: anchor row ${n} does not carry its line in backticks — got ${JSON.stringify(cells[3])}`,
      );
    }
    rows.push({ n, failure, line: quoted[1]! });
  }
  return rows;
}

export interface VariantsFile {
  /** Variant name (`V1`…) to the QUESTIONS block it replaces the production one with. */
  questions: Map<string, string>;
  /** The one replacement GISTS block. */
  gists: string;
  /**
   * **Shipped GISTS blocks, pinned by prompt version** — `"toc/5"`, `"toc/6"`.
   *
   * These are not variants anybody is choosing between: they are copies of what
   * `src/hierarchy.ts` sent before and after a bump, so an arm can measure the
   * bump itself over the same fixed trees. `productionGists()` slices the *live*
   * SYSTEM and therefore always carries the newest one — which is exactly why a
   * before/after cannot be built out of the `incumbent` arm alone.
   */
  shippedGists: Map<string, string>;
  /**
   * **Shipped QUESTIONS blocks, pinned by prompt version** — `"toc/6"`.
   *
   * The exact mirror of `shippedGists`, and it exists for the same reason one
   * bump later: `productionQuestions()` slices the *live* SYSTEM, which has been
   * V4 since `toc/7`, so the block V4 replaced has no other home. Without it the
   * eval has no pre-V4 control and cannot return *"the control was better all
   * along"*.
   */
  shippedQuestions: Map<string, string>;
  anchors: AnchorRow[];
}

/**
 * **Two headings of one name is a fault, not a preference**, and it has to throw
 * where the discovery loop finds the second one.
 *
 * `fencedUnder` always takes the **first** heading that matches, and each
 * discovery loop below writes into a `Map`, so a duplicated section parsed
 * silently: the map reported one entry, the block used was the first copy, and
 * the copy a person had just edited was the one ignored. GPT Sol demonstrated it
 * on 2026-09-07 by adding a second `## The shipped QUESTIONS block, toc/6`,
 * poisoning the **first** with a rule the prompt forbids, and watching
 * `readVariants` return happily with every current test still green. ⟨F14.⟩
 *
 * That is this file's own stated failure mode — *"an arm that sends an EMPTY
 * questions block, produces plausible output anyway and scores as a variant"* —
 * in the one form the loud-on-every-failure parse did not cover.
 */
function refuseDuplicate(seen: Map<string, string>, key: string, label: string): void {
  if (!seen.has(key)) return;
  throw new Error(
    `variants.md: two "## " headings for ${label}. The first copy is the one that would be parsed and the second silently ignored, so the block you just edited may not be the block that goes on the wire. Delete one.`,
  );
}

let cached: VariantsFile | null = null;

/**
 * `variants.md`, parsed — and **held to a shape rather than to a sentence**.
 *
 * The three assertions at the end are the ones that would catch a parse that
 * "worked" over the wrong text: the file must yield at least the four variants
 * the table declares, a GISTS block that still contains the rule it exists to
 * add, and exactly five anchors. A count is checked because the gate's whole
 * claim is *all five ranked below every real line*, and four of five silently
 * parsed is a weaker gate reporting the same verdict.
 */
export function readVariants(path: URL = VARIANTS_PATH): VariantsFile {
  if (path === VARIANTS_PATH && cached) return cached;
  const markdown = readFileSync(path, "utf-8");
  const questions = new Map<string, string>();
  /* Discovered from the file, not from a list here — that is what makes a fifth
     variant an edit to variants.md plus one entry in ARMS. */
  for (const line of markdown.split("\n")) {
    const m = /^## (V\d+)\b/.exec(line);
    if (m) {
      const name = m[1]!;
      refuseDuplicate(questions, name, `variant ${name}`);
      questions.set(name, fencedUnder(markdown, new RegExp(`^${name}\\b`), name));
    }
  }
  const gists = fencedUnder(markdown, /^The GISTS block\b/, "The GISTS block");
  /* Discovered from the file the same way the variants are, so pinning a
     `toc/7` block later is a section plus an ARMS entry and no code change. */
  const shippedGists = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const m = /^## The shipped GISTS block, (toc\/\d+)\s*$/.exec(line);
    if (m) {
      const version = m[1]!;
      refuseDuplicate(shippedGists, version, `the shipped ${version} GISTS block`);
      shippedGists.set(
        version,
        fencedUnder(markdown, new RegExp(`^The shipped GISTS block, ${version.replace("/", "\\/")}\\s*$`), `the shipped ${version} GISTS block`),
      );
    }
  }
  /* The same discovery, for the QUESTIONS axis's before halves. */
  const shippedQuestions = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const m = /^## The shipped QUESTIONS block, (toc\/\d+)\s*$/.exec(line);
    if (m) {
      const version = m[1]!;
      refuseDuplicate(shippedQuestions, version, `the shipped ${version} QUESTIONS block`);
      shippedQuestions.set(
        version,
        fencedUnder(markdown, new RegExp(`^The shipped QUESTIONS block, ${version.replace("/", "\\/")}\\s*$`), `the shipped ${version} QUESTIONS block`),
      );
    }
  }
  const anchors = anchorRows(markdown);

  if (questions.size < 4) {
    throw new Error(`variants.md: found ${questions.size} variant blocks, expected at least 4`);
  }
  for (const [name, text] of questions) {
    if (!text.startsWith("QUESTIONS")) {
      throw new Error(`variants.md: ${name}'s fenced block does not begin "QUESTIONS" — it begins ${JSON.stringify(text.slice(0, 40))}`);
    }
  }
  if (!gists.startsWith("GISTS")) {
    throw new Error(`variants.md: the GISTS block does not begin "GISTS"`);
  }
  for (const [version, text] of shippedGists) {
    if (!text.startsWith("GISTS")) {
      throw new Error(`variants.md: the shipped ${version} GISTS block does not begin "GISTS" — it begins ${JSON.stringify(text.slice(0, 40))}`);
    }
  }
  for (const [version, text] of shippedQuestions) {
    if (!text.startsWith("QUESTIONS")) {
      throw new Error(`variants.md: the shipped ${version} QUESTIONS block does not begin "QUESTIONS" — it begins ${JSON.stringify(text.slice(0, 40))}`);
    }
  }
  /* The pre-V4 control has to exist, and it has to be the block V4 replaced.
     A lenient parse here gives `questions-toc6` no block at all, which
     `promptBlocksFor` would throw on — but the count is checked anyway, because
     the day somebody renames the section is the day the eval quietly loses the
     only arm that can say the control won. */
  if (!shippedQuestions.has("toc/6")) {
    throw new Error(
      `variants.md: no "## The shipped QUESTIONS block, toc/6" section — that block is the pre-V4 control (arms.ts § questions-toc6) and the live SYSTEM has been V4 since toc/7, so nothing else has a copy of it`,
    );
  }
  if (anchors.length !== 5) {
    throw new Error(`variants.md: found ${anchors.length} anchor rows, expected 5 — the calibration gate's claim is about all five`);
  }
  const parsed = { questions, gists, shippedGists, shippedQuestions, anchors };
  if (path === VARIANTS_PATH) cached = parsed;
  return parsed;
}
