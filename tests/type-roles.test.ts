/**
 * **The six text roles in a mode band, and the lines that use them.**
 *
 * docs/project/typography.md § Text roles in a band is the rule: a line in a
 * band that does one of six recurring jobs — a row's main line, verbatim source
 * words, a sentence explaining the row, a small provenance line, a count, a
 * group's small heading — takes that job's `--type-*` token from
 * src/web/styles/tokens.css. Anything else may pick its own size. The plan is
 * docs/plans/261008i-text-styles-for-the-recurring-lines-in-a-mode-band.md.
 *
 * Three checks:
 *
 *   1. **The tokens exist, with their values**, in the `:root` of tokens.css.
 *   2. **Each moved line uses its token.** `REGISTRY` is the table as built.
 *      For each row, every rule in every reading-view sheet whose selector list
 *      contains that exact selector — at any `@media`/`@supports` depth, and
 *      counting a `font:` shorthand as a size — sets it to `var(--type-<role>)`
 *      and nothing else. So a later rule, or a narrow-window override, that
 *      quietly put a literal back is a failure here, not a surprise in a
 *      screenshot.
 *   3. **Each named exception keeps its literal and its reason.** Quiz's
 *      question is the first: so the next tidy-up cannot "fix" it onto
 *      `--type-item` without deleting the comment that says why it is not one.
 *
 * **Parsed, not grepped.** Comments, nested at-rules and `font:` shorthands
 * are all real in these sheets (GPT Sol's F6 on the plan), so the sheets go
 * through jsdom's CSSOM — jsdom is already a declared dependency, which is why
 * it and not postcss. A parser that silently dropped a rule it did not
 * understand would make this file green over nothing, so `parse()` counts the
 * blocks in the source and refuses to go on if the CSSOM holds fewer.
 *
 * **What it does not do**: say which role a line *should* have. That is a
 * judgement about the line's job in its row, made against the component, and
 * written down here as a registry row. A new band line that never joins the
 * registry is not caught — no ratchet on literal sizes, for the reason the
 * plan's § The test gives.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readerSheets, stripComments } from "./helpers/stylesheets.js";

const ROLES = {
  item: "0.92rem",
  quote: "0.88rem",
  body: "0.85rem",
  meta: "0.78rem",
  count: "0.83rem",
  label: "0.77rem",
} as const;
type Role = keyof typeof ROLES;

interface Row {
  /** Under src/web/styles/, where the rule lives. */
  file: string;
  /** Exactly as written, one selector of a list; whitespace is normalised. */
  selector: string;
  role: Role;
}

/** The table as built. Grouped by mode, in the order the plan lists them. */
const REGISTRY: Row[] = [
  // Skim
  { file: "skim.css", selector: ".skim-place", role: "item" },
  { file: "skim.css", selector: ".skim-words", role: "quote" },
  { file: "skim.css", selector: ".skim-cue", role: "body" },
  { file: "skim.css", selector: ".skim-cluster-h", role: "label" },
  // Timeline
  { file: "timeline.css", selector: ".tl-label", role: "item" },
  { file: "timeline.css", selector: ".tl-quote", role: "quote" },
  { file: "timeline.css", selector: ".tl-when", role: "meta" },
  { file: "timeline.css", selector: ".tl-group > h3", role: "label" },
  { file: "timeline.css", selector: ".tl-group > h3 > .gloss-count", role: "count" },
  // FAQ
  { file: "faq.css", selector: ".faq-question", role: "item" },
  { file: "faq.css", selector: ".faq-quote", role: "quote" },
  // Glossary (and the parts Ideas and Timeline borrow from it)
  { file: "glossary.css", selector: ".gloss-name", role: "item" },
  { file: "glossary.css", selector: ".gloss-gloss", role: "body" },
  { file: "glossary.css", selector: ".gloss-part-text", role: "body" },
  { file: "glossary.css", selector: ".gloss-sources a", role: "meta" },
  { file: "glossary.css", selector: ".gloss-part-label > .gloss-count", role: "count" },
  // Ideas
  { file: "ideas.css", selector: ".ideas-name", role: "item" },
  { file: "ideas.css", selector: ".ideas-quote", role: "quote" },
  { file: "ideas.css", selector: ".ideas-reason", role: "body" },
  { file: "ideas.css", selector: ".ideas-group > h3", role: "label" },
  { file: "ideas.css", selector: ".ideas-group > h3 > .gloss-count", role: "count" },
  // Quotes — the quote IS the row here, so it is an item, not a quote.
  { file: "quotes.css", selector: ".quotes-text", role: "item" },
  { file: "quotes.css", selector: ".quotes-prov", role: "meta" },
  // Citations
  { file: "citations.css", selector: ".cite-title", role: "item" },
  { file: "citations.css", selector: ".cite-quote blockquote", role: "quote" },
  { file: "citations.css", selector: ".cite-why", role: "body" },
  { file: "citations.css", selector: ".cite-meta", role: "meta" },
  // Debate
  { file: "debate.css", selector: ".dbt-title", role: "item" },
  { file: "debate.css", selector: ".dbt-quote", role: "quote" },
  { file: "debate.css", selector: ".dbt-applies", role: "body" },
  { file: "debate.css", selector: ".dbt-meta", role: "meta" },
  { file: "debate.css", selector: ".dbt-group-count", role: "count" },
  { file: "debate.css", selector: ".dbt-group-head", role: "label" },
  // Referee: Criteria, Claims, Mirror, Candidates
  { file: "referee.css", selector: ".crit-criterion", role: "item" },
  { file: "referee.css", selector: ".clm-claim", role: "item" },
  { file: "referee.css", selector: ".cnd-name", role: "item" },
  { file: "referee.css", selector: ".crit-quote", role: "quote" },
  { file: "referee.css", selector: ".clm-quote", role: "quote" },
  { file: "referee.css", selector: ".mir-quote", role: "quote" },
  { file: "referee.css", selector: ".crit-why", role: "body" },
  { file: "referee.css", selector: ".clm-why", role: "body" },
  { file: "referee.css", selector: ".cnd-why", role: "body" },
  { file: "referee.css", selector: ".crit-meta", role: "meta" },
  { file: "referee.css", selector: ".cnd-count", role: "count" },
  // Search — a result row is the passage, so its quotation is the item.
  { file: "search.css", selector: ".srch-hit-quote", role: "item" },
  { file: "search.css", selector: ".srch-hit-why", role: "body" },
  { file: "search.css", selector: ".srch-count", role: "count" },
];

interface Exception {
  file: string;
  selector: string;
  /** The literal it keeps. */
  value: string;
  /** Why it is not on a role — the comment beside the rule says the same. */
  reason: string;
}

const EXCEPTIONS: Exception[] = [
  {
    file: "quiz.css",
    selector: ".quiz-question",
    value: "1.03rem",
    reason:
      "One prompt the reader answers, set above its 0.94rem premise and answer box — not a row " +
      "in a list, so not --type-item (GPT Sol's F3 on the plan).",
  },
];

// ---------------------------------------------------------------- parsing --

interface ParsedRule {
  selectors: string[];
  /** The enclosing at-rule preludes, outermost first — for the failure message. */
  context: string[];
  /** Every value that sets the size: `font-size`, or a `font:` shorthand. */
  sizes: string[];
}

const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>");

/** Split a selector list on its top-level commas — not the ones inside `:is(…)`. */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map(normalise).filter((s) => s.length > 0);
}

function normalise(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** Strip quoted strings so a `{` in `content: "{"` is not counted as a block. */
function stripStrings(css: string): string {
  return css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

const parsed = new Map<string, ParsedRule[]>();

function parse(path: string, css: string): ParsedRule[] {
  const hit = parsed.get(path);
  if (hit) return hit;
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
  const sheet = style.sheet;
  if (!sheet) throw new Error(`${path}: jsdom produced no sheet`);

  const rules: ParsedRule[] = [];
  let blocks = 0;
  const visit = (list: CSSRuleList, context: string[]): void => {
    for (const rule of Array.from(list)) {
      /* `@import` ends in `;`, not a block (styles.css is nothing else). */
      if (rule.type === window.CSSRule.IMPORT_RULE) continue;
      blocks++;
      if ("selectorText" in rule && typeof rule.selectorText === "string") {
        const style = (rule as CSSStyleRule).style;
        const sizes: string[] = [];
        const size = style.getPropertyValue("font-size");
        const font = style.getPropertyValue("font");
        /* A `font:` shorthand jsdom could expand shows up in `font-size`; one it
           could not (a `var()` in it, say) leaves `font-size` empty, and is
           still a size — so it is counted rather than skipped. */
        if (size) sizes.push(size);
        else if (font && !CSS_WIDE.has(font)) sizes.push(`font: ${font}`);
        rules.push({ selectors: splitSelectors(rule.selectorText), context, sizes });
      } else if ("cssRules" in rule) {
        const prelude =
          (rule as CSSMediaRule).media?.mediaText ??
          (rule as CSSSupportsRule).conditionText ??
          rule.constructor.name;
        visit((rule as CSSGroupingRule).cssRules, [...context, prelude]);
      }
    }
  };
  visit(sheet.cssRules, []);
  style.remove();

  /* The guard against green-over-nothing: every `{` in the source is one rule
     (style, grouping, keyframe, font-face). Fewer in the CSSOM means the parser
     dropped something it did not understand, and a dropped rule is one this
     file cannot see. The one exception is `@property` (logo-animations.css),
     which jsdom does not keep and which cannot hold a font size. */
  const bare = stripStrings(stripComments(css));
  const source = (bare.match(/\{/g) ?? []).length - (bare.match(/@property\b/g) ?? []).length;
  if (blocks !== source) {
    throw new Error(
      `${path}: the source has ${source} blocks and jsdom's CSSOM holds ${blocks}. ` +
        "It dropped a rule it could not parse, and this test cannot vouch for a rule it never saw.",
    );
  }
  parsed.set(path, rules);
  return rules;
}

const SHEETS = readerSheets();

function sheet(file: string): { path: string; css: string } {
  const path = `src/web/styles/${file}`;
  const found = SHEETS.find((s) => s.path === path);
  if (!found) throw new Error(`${path} is not among the sheets the reading view loads`);
  return found;
}

/** Every size set on exactly `selector`, across every reading-view sheet. */
function sizesOf(selector: string): { where: string; value: string }[] {
  const want = normalise(selector);
  const out: { where: string; value: string }[] = [];
  for (const s of SHEETS) {
    for (const rule of parse(s.path, s.css)) {
      if (!rule.selectors.includes(want)) continue;
      for (const value of rule.sizes) {
        out.push({ where: [s.path, ...rule.context].join(" › "), value });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ tests --

describe("the text-role tokens", () => {
  it("are defined on :root in tokens.css, with their values", () => {
    const tokens = sheet("tokens.css");
    const style = window.document.createElement("style");
    style.textContent = tokens.css;
    window.document.head.appendChild(style);
    const roots = Array.from(style.sheet?.cssRules ?? []).filter(
      (r): r is CSSStyleRule => "selectorText" in r && (r as CSSStyleRule).selectorText === ":root",
    );
    style.remove();
    const defined = Object.fromEntries(
      Object.keys(ROLES).map((role) => [
        role,
        roots.map((r) => r.style.getPropertyValue(`--type-${role}`).trim()).find((v) => v) ?? "",
      ]),
    );
    expect(defined).toEqual(ROLES);
  });
});

describe("each registered line uses its role's token", () => {
  it("names each selector once", () => {
    const seen = REGISTRY.map((r) => normalise(r.selector));
    expect(seen.filter((s, i) => seen.indexOf(s) !== i)).toEqual([]);
  });

  for (const row of REGISTRY) {
    it(`${row.selector} (${row.file}) is --type-${row.role}`, () => {
      const own = parse(sheet(row.file).path, sheet(row.file).css).filter(
        (r) => r.selectors.includes(normalise(row.selector)) && r.sizes.length > 0,
      );
      expect(own.length, `no rule for exactly \`${row.selector}\` sets a size in ${row.file}`).toBeGreaterThan(0);
      const sizes = sizesOf(row.selector);
      const wrong = sizes
        .filter((s) => s.value !== `var(--type-${row.role})`)
        .map((s) => `${s.where}: ${s.value}`);
      expect(wrong, `every size on \`${row.selector}\` should be var(--type-${row.role})`).toEqual([]);
    });
  }

  /* `.faq-quote` sits on the same element as `.gloss-part-text` (FaqPanel.tsx),
     a body line, and wins only because faq.css is later in the cascade at the
     same specificity. If the order ever flipped, FAQ's quotation would silently
     become body text and the registry row above would still be green. */
  it("FAQ's quote wins over the glossary part it shares an element with", () => {
    const order = SHEETS.map((s) => s.path);
    expect(order.indexOf("src/web/styles/faq.css")).toBeGreaterThan(
      order.indexOf("src/web/styles/glossary.css"),
    );
  });
});

describe("the named exceptions", () => {
  for (const ex of EXCEPTIONS) {
    it(`${ex.selector} (${ex.file}) keeps ${ex.value}, with a comment saying why`, () => {
      expect(ex.reason.length).toBeGreaterThan(20);
      const sizes = sizesOf(ex.selector);
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.map((s) => s.value)).toEqual(sizes.map(() => ex.value));

      /* The comment, read from the raw source: inside the rule or in the
         comment directly above it, and it must call itself an exception. */
      const raw = readFileSync(sheet(ex.file).path, "utf8");
      const escaped = ex.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const at = raw.search(new RegExp(`(^|[}\\s])${escaped}\\s*\\{`, "m"));
      expect(at, `\`${ex.selector} {\` not found in ${ex.file}`).toBeGreaterThanOrEqual(0);
      const before = raw.lastIndexOf("}", at);
      const after = raw.indexOf("}", at);
      const region = raw.slice(before + 1, after);
      expect(region, `no comment calling \`${ex.selector}\` an exception`).toMatch(
        /\/\*[\s\S]*?\bexception\b[\s\S]*?\*\//i,
      );
    });
  }
});
