/**
 * **Every class the per-voice faces name still exists, and every page and mode
 * has said whose words it shows.** src/web/styles/voices.css; docs/project/fonts.md.
 *
 * The faces were behind the Experimental switch until 2026-10-02, when Greg
 * said "Yes they should now be used throughout and always going forwards"
 * (docs/plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md).
 * Ways that file can go wrong with nothing on screen to say so:
 *
 *  1. **A class it names is renamed in a component.** The selector then matches
 *     nothing and that element quietly drops back to Geist.
 *  2. **A new page or mode arrives and nobody asks whose words it shows.**
 *     `VOICES_BY_SURFACE` and `VOICES_BY_MODE` make that a type error.
 *  3. **The switch path creeps back.** A rule under `:root[data-voices]` would
 *     match nothing now that nothing sets the attribute.
 *
 * A hand scan rather than a CSS parser, as in styles-entry-is-imports-only:
 * the file is three lists of selectors and a parser to check that is the wrong
 * trade.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import type { Mode } from "../src/modes.js";
import type { ArticleView } from "../src/read-address.js";
import { gistVoiceOf } from "../src/library-scalars.js";
import type { Route } from "../src/web/router.js";
import { type Voice, voiceClass } from "../src/web/voice.js";

const CSS = readFileSync("src/web/styles/voices.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule's selector text, one string per rule. */
const selectors = [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.trim());

function selectorUsing(
  token: "--font-author" | "--font-ai" | "--font-reader" | "--font-ui",
): string {
  const rule = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[2]!.includes(`var(${token})`),
  );
  if (!rule) throw new Error(`voices.css has no rule using ${token}`);
  return rule[1]!.trim();
}

function selectorsUsingIn(file: string, token: "--font-ui", className: string): string[] {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.includes(className) && m[2]!.includes(`var(${token})`))
    .map((m) => m[1]!.trim());
}

/** Every `.class` the file names. */
const classes = [...new Set([...CSS.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!))];

type AstNode = Record<string, unknown> & { type: string };

function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visitAst(child, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string") return;
  visit(node as AstNode);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "loc" && !key.endsWith("Comments")) visitAst(child, visit);
  }
}

function textLiteralsUnder(value: unknown): string[] {
  const strings: string[] = [];
  visitAst(value, (node) => {
    if (node.type === "StringLiteral" && typeof node.value === "string") {
      strings.push(node.value);
    }
    if (node.type === "TemplateElement") {
      const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
      if (typeof cooked === "string") strings.push(cooked);
    }
  });
  return strings;
}

interface SourceLiterals {
  classNames: string[];
  strings: string[];
}

function sourceLiteralsUnder(dir: string): SourceLiterals {
  const result: SourceLiterals = { classNames: [], strings: [] };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = sourceLiteralsUnder(p);
      result.classNames.push(...nested.classNames);
      result.strings.push(...nested.strings);
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;

    const tree = babelParse(readFileSync(p, "utf8"), {
      sourceType: "module",
      sourceFilename: p,
      plugins: ["typescript", "jsx"],
    });
    result.strings.push(...textLiteralsUnder(tree.program));
    visitAst(tree.program, (node) => {
      let value: unknown;
      if (node.type === "JSXAttribute") {
        const name = node.name as { name?: unknown } | undefined;
        if (name?.name !== "className") return;
        value = node.value;
      } else if (node.type === "ObjectProperty") {
        const key = node.key as { name?: unknown } | undefined;
        if (key?.name !== "className") return;
        value = node.value;
      } else {
        return;
      }
      // Spaces stand in for expressions: class tokens may be split across
      // quasis (`... ${status}${condition ? " own" : ""}`).
      result.classNames.push(textLiteralsUnder(value).join(" "));
    });
  }
  return result;
}
const SOURCE_LITERALS = sourceLiteralsUnder("src/web");

/**
 * Classes components build from templates rather than writing out:
 * `prose-card-part-${section.key}` in ProseHoverCard's TermCard, whose keys are
 * the glossary's two sections (`GlossaryPanel.tsx`, `key: "senseHere" |
 * "background"`), Timeline's `tl-when-${tone}`, and LiveStatus's
 * `chat-live-line ${line.role}`. Each is checked by the template and its typed
 * key instead of by its whole name.
 */
const TEMPLATED: Record<string, { template: string; key: string }> = {
  done: { template: "dock-question-state ", key: "done" },
  "prose-card-part-senseHere": { template: "prose-card-part-", key: "senseHere" },
  "prose-card-part-background": { template: "prose-card-part-", key: "background" },
  "tl-when-words": { template: "tl-when tl-when-", key: "words" },
  companion: { template: "chat-live-line ", key: "companion" },
  reader: { template: "chat-live-line ", key: "reader" },
};

const TEMPLATED_COMPOUNDS: Record<string, { template: string; key: string }> = {
  ".chat-live-line.companion": { template: "chat-live-line ", key: "companion" },
  ".chat-live-line.reader": { template: "chat-live-line ", key: "reader" },
  /* Dock.tsx: `dock-question-state ${c.status}…`, status "done" */
  ".dock-question-state.done": { template: "dock-question-state ", key: "done" },
};

/**
 * **Every mode has been asked whose words it shows.** For each mode, a few of
 * the AI-voice classes it renders — enough that a reader of this table knows the
 * mode was looked at — or `{ noModelText }` saying why it has none.
 *
 * Being a `Record<Mode, …>`, a mode added to `MODES` is a **type error** under
 * `npm run typecheck` until somebody decides its voices: the question arrives
 * at the moment it can still be answered cheaply. It cannot prove a new element
 * in an existing mode is covered — nothing short of provenance-tagging every
 * string could — so it is a prompt with teeth, not a proof.
 * docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md § 3;
 * docs/project/fonts.md says how to voice a new element.
 */
const VOICES_BY_MODE: Record<Mode, readonly string[] | { noModelText: string }> = {
  plain: {
    noModelText:
      "the article alone; the spine's cards it shares with every mode are listed under structure",
  },
  chat: [".chat-turn.model", ".chat-thread-last.model", ".chat-pointed-why"],
  glossary: [".gloss-gloss", ".gloss-name", ".gloss-detail", ".prose-card-term-lead"],
  search: [".srch-hit-why"],
  referee: [
    ".clm-list .clm-claim",
    ".crit-why",
    ".mir-note",
    ".cnd-answer",
    ".cnd-person-name",
    ".cnd-affil-name",
  ],
  summary: [".simple-text"],
  diagram: [".sk-card-title", ".sk-title", ".ill-title", ".ill-prompt"],
  ideas: [".ideas-name", ".ideas-reason"],
  remember: [".chat-turn.model", ".quiz-question"],
  quotes: [".quotes-why-card"],
  timeline: [".tl-label"],
  debate: [".dbt-ai", ".dbt-title-ai", ".dbt-thread-gist"],
  /* `.voice-ai`: a title or navLabel the model wrote (tree.ts § nodeLabel). */
  structure: [".struct-gist", ".voice-ai", ".tip-gist"],
  citations: [".cite-why", ".cite-does", ".prose-card-cite-does-text"],
  faq: [".faq-question"],
  skim: [".skim-cue", ".skim-door-cue-next", ".skim-sense-text", ".skim-chip-name"],
  tweets: [".tweets-text"],
  marginalia: [
    ".marg-question",
    ".marg-idea-name",
    ".marg-arc",
    ".marg-debate-applies",
    ".marg-cite-why",
    ".marg-open-answer",
  ],
};

/**
 * **Every page has been asked whose words it shows** — the same question
 * `VOICES_BY_MODE` asks of a mode, asked of every address the client draws.
 * Keyed by `Route["kind"]` (src/web/router.ts), with an article's address
 * split by `ArticleView`, so **a new page is a type error** until somebody
 * lists the voice classes it renders (any voice), or says why it has none.
 * The reading view's own entry is the article; its modes are `VOICES_BY_MODE`.
 * docs/plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md § 5.
 */
type Surface = Exclude<Route["kind"], "read"> | `read:${ArticleView}`;
const OURS = "our own page: every word on it is the app's";
const VOICES_BY_SURFACE: Record<Surface, readonly string[] | { none: string }> = {
  "read:article": [".prose", ".voice-author"],
  /* the one-sentence gist and summary; the title; where you left off; the
     reader's purpose and profile */
  "read:metadata": [".voice-ai", ".voice-author", ".voice-reader", ".prof-box-input"],
  /* the blurb (gist or excerpt), titles, abstracts, search hits, the search box */
  library: [".voice-ai", ".voice-author", ".voice-reader"],
  /* titles only: the gist's voice would need a column on `publicLibraryQuery`,
     a listed defence (security-map.md), so it is left in the app's face */
  "public-library": [".voice-author"],
  add: [".voice-reader", ".prof-box-input"],
  "add-upload": [".voice-reader", ".prof-box-input"],
  profile: [".prof-box-input", ".prof-interim", ".voice-author"],
  /* the reading column's specimen is a sample of an article */
  design: [".prose"],
  login: { none: "a sign-in form: an email address is a credential, not something said" },
  admin: { none: "an administrator's tables; other readers' words there are left in the app's face" },
  privacy: { none: OURS },
  features: { none: OURS },
  "public-sharing": { none: OURS },
  pricing: { none: OURS },
  contact: { none: OURS },
  /* An agent drafts each entry at deploy time, but the page is the app talking
     about itself, as /help is, so it is ours (changelog.md). */
  changelog: { none: OURS },
  help: { none: OURS },
  opensource: { none: OURS },
  callback: { none: "a redirect; it draws no text" },
  "not-found": { none: OURS },
};

/** Split a selector list without splitting commas inside :is(), :not(), or attributes. */
function selectorBranches(selector: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      branches.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  branches.push(selector.slice(start).trim());
  return branches;
}

/** The branches inside a rule's `:root :is(…)`, each as written. */
function innerBranches(selector: string): string[] {
  const m = /^:root\s+:is\(([\s\S]*)\)(?:::placeholder)?$/.exec(selector);
  if (!m) throw new Error(`not a guarded :is() rule: ${selector.slice(0, 60)}`);
  return selectorBranches(m[1]!).map((b) => b.replace(/\s+/g, " "));
}

describe("voices.css", () => {
  it("finds rules to check", () => {
    expect(selectors.length).toBe(5); // author, AI, reader, reader placeholders, and voice-ui
    expect(classes.length).toBeGreaterThan(40);
  });

  /* `:root` is part of each rule's specificity, not a switch: without it some
     rules would only tie with the ones they override (voices.css § header). */
  it("writes every rule as :root :is(…), for everyone", () => {
    for (const selector of selectors) innerBranches(selector);
  });

  it("leaves no trace of the Experimental switch that used to gate the faces", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(e.name) && readFileSync(p, "utf8").includes("data-voices")) {
          hits.push(p);
        }
      }
    };
    walk("src");
    walk("styles");
    expect(hits).toEqual([]);
  });

  it("keeps the UI-face corrections that live beside their inherited rules", () => {
    expect(selectorsUsingIn("src/web/styles/mode-band.css", "--font-ui", ".chat-stance-tag")).toEqual([
      ":root .chat-stance-tag",
    ]);
    for (const file of ["src/web/styles/annotations.css", "src/web/styles/dock.css"]) {
      expect(selectorsUsingIn(file, "--font-ui", ".passage-whole"), file).toEqual([
        `:root .${file.includes("annotations") ? "cmt-quote" : "dock-question-quote"} .passage-whole`,
      ]);
    }
  });

  /* `voiceClass` builds these four in TypeScript, so the className scan below
     cannot see them; check them against the function instead, both ways. */
  it("has a rule for exactly the classes voiceClass returns, each in its own voice", () => {
    const voices: Voice[] = ["author", "ai", "reader", "ui"];
    const built = voices.map(voiceClass);
    expect(classes.filter((c) => c.startsWith("voice-")).sort()).toEqual([...built].sort());
    expect(innerBranches(selectorUsing("--font-author"))).toContain(".voice-author");
    expect(innerBranches(selectorUsing("--font-ai"))).toContain(".voice-ai");
    expect(innerBranches(selectorUsing("--font-reader"))).toContain(".voice-reader");
    const ui = selectors.find((sel) => /^:root\s+:is\(\s*\.voice-ui\s*\)$/.test(sel));
    expect(ui, "a rule for .voice-ui alone").toBeDefined();
  });

  it("names only classes some component still renders", () => {
    const missing = classes.filter((c) => {
      if (c.startsWith("voice-")) return false; // voiceClass's; checked above
      const t = TEMPLATED[c];
      if (t) {
        return !(
          SOURCE_LITERALS.classNames.some((fragment) => fragment.includes(t.template)) &&
          SOURCE_LITERALS.strings.includes(t.key)
        );
      }
      const token = new RegExp(`(^|\\s)${c.replace(/-/g, "\\-")}($|\\s)`);
      return !SOURCE_LITERALS.classNames.some((fragment) => token.test(fragment));
    });
    expect(missing).toEqual([]);
  });

  /* A class can exist and an adjacent-class compound still match nothing:
     `.chat-turn.model`
     needs both on ONE element, and each could survive somewhere else after the
     pair is split. So every compound must be found together in one className
     string or template. GPT Sol, plan review. */
  it("finds every adjacent-class compound together in one component className", () => {
    const compounds = [
      ...new Set([...CSS.matchAll(/(?:\.[A-Za-z][\w-]*){2,}/g)].map((m) => m[0])),
    ];
    expect(compounds).toContain(".chat-turn.model");
    const token = (c: string) => new RegExp(`(^|\\s)${c}($|\\s)`);
    const apart = compounds.filter((compound) => {
      const templated = TEMPLATED_COMPOUNDS[compound];
      if (templated) {
        return !(
          SOURCE_LITERALS.classNames.some((fragment) => fragment.includes(templated.template)) &&
          SOURCE_LITERALS.strings.includes(templated.key)
        );
      }
      const parts = compound.split(".").filter(Boolean);
      return !SOURCE_LITERALS.classNames.some((fragment) =>
        parts.every((c) => token(c).test(fragment)),
      );
    });
    expect(apart).toEqual([]);
  });

  it("uses only the voice tokens, and tokens.css defines them", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    const used = [...new Set([...CSS.matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1]!))];
    /* --font-ui only in the placeholder rule: app copy inside a reader's box. */
    expect(used.sort()).toEqual(["--font-ai", "--font-author", "--font-reader", "--font-ui"]);
    for (const t of used) expect(tokens, t).toMatch(new RegExp(`${t}:`));
  });

  it("keeps the representative mixed and inheritance-breaking surfaces in the right voice", () => {
    const author = selectorUsing("--font-author");
    const ai = selectorUsing("--font-ai");
    const reader = selectorUsing("--font-reader");

    for (const selector of [
      ".faq-quote",
      ".gloss-ask-found",
      ".tip-cite-text",
      ".skim-words-tip",
      ".dbt-claim-text",
      ".mir-quote:not(.mir-block-id)",
      ".ideas-quote:not(.ideas-quote-moved)",
      ".tl-quote:not(.tl-quote-moved)",
      ".tl-when-words",
      ".voice-author",
    ]) {
      expect(author, selector).toContain(selector);
    }

    for (const selector of [
      ".ideas-name",
      ".cnd-answer",
      ".cnd-answer .fmt-h",
      ".cnd-person-name",
      ".cnd-affil-name",
      ".cnd-requirement",
      ".cnd-why",
      ".chat-live-line.companion .chat-live-words",
      ".dbt-thread:not(.dbt-thread-key) .dbt-thread-name",
      ".clm-list .clm-claim",
      ".clm-why:not(.clm-why-withheld)",
    ]) {
      expect(ai, selector).toContain(selector);
    }
    expect(ai).not.toContain(".ideas-blurb");
    expect(ai).not.toContain(".cite-verdict-text");
    /* Fixed words that report a model's verdict stay UI (261002b § 2). */
    expect(innerBranches(ai)).not.toContain(".dbt-relation");
    expect(innerBranches(ai)).not.toContain(".cnd-name");
    expect(innerBranches(ai)).not.toContain(".cnd-affil");
    expect(innerBranches(ai)).not.toContain(".dbt-thread-name");
    /* Hidden, untrusted source text is not obviously the author's (Sol, P2). */
    expect(author).not.toContain(".ref-scan-text");
    expect(ai).not.toContain(".ref-scan-text");

    for (const selector of [
      ".crit-text",
      ".crit-poles input",
      ".cnd-asked",
      ".cnd-box",
      ".mir-criterion",
      ".mir-placement-criterion",
      ".chat-live-line.reader .chat-live-words",
      ".chat-rename",
      ".skim-purpose-text",
      ".skim-purpose-tip p",
      ".chat-thread-last.you",
      ".chat-head-title",
      ".prof-panel-text:not(.quiet)",
    ]) {
      expect(reader, selector).toContain(selector);
    }
    /* `You: leans … · −50` is our template around the reader's choice. */
    expect(innerBranches(reader)).not.toContain(".crit-yours");
  });

  it("puts placeholders in the reader's boxes back in the app's face", () => {
    const placeholders = selectorUsing("--font-ui");
    expect(placeholders).toMatch(/\)::placeholder$/);
    for (const selector of [".chat-input", "textarea.cmt-note", ".srch-input"]) {
      expect(innerBranches(placeholders), selector).toContain(selector);
    }
  });

  /* Exact branches, not substrings: `.tip-gist` must not pass on the strength
     of `.tip-gist-something`. */
  it("finds every mode's AI-voice classes in the AI rule (VOICES_BY_MODE)", () => {
    const ai = innerBranches(selectorUsing("--font-ai"));
    const missing = Object.entries(VOICES_BY_MODE).flatMap(([mode, voiced]) =>
      Array.isArray(voiced)
        ? voiced.filter((c) => !ai.includes(c)).map((c) => `${mode}: ${c}`)
        : [],
    );
    expect(missing).toEqual([]);
    for (const voiced of Object.values(VOICES_BY_MODE)) {
      if (Array.isArray(voiced)) expect(voiced.length).toBeGreaterThan(0);
      else expect((voiced as { noModelText: string }).noModelText.trim()).not.toBe("");
    }
  });

  it("finds every page's voice classes in some voice's rule (VOICES_BY_SURFACE)", () => {
    const all = selectors.flatMap((sel) => innerBranches(sel));
    const missing = Object.entries(VOICES_BY_SURFACE).flatMap(([surface, voiced]) =>
      Array.isArray(voiced) ? voiced.filter((c) => !all.includes(c)).map((c) => `${surface}: ${c}`) : [],
    );
    expect(missing).toEqual([]);
    for (const voiced of Object.values(VOICES_BY_SURFACE)) {
      if (Array.isArray(voiced)) expect(voiced.length).toBeGreaterThan(0);
      else expect((voiced as { none: string }).none.trim()).not.toBe("");
    }
  });
});

/**
 * **Whose words the shelf's blurb is.** `root_gist` is stored as
 * `gist ?? summary ?? excerpt`, so the blurb that equals the revision's own
 * excerpt is the author's and any other is a model's (library-scalars.ts §
 * `gistVoiceOf`). Equality is a read-time heuristic: an AI gist that exactly
 * copies the excerpt is the known ambiguous case until provenance is stored.
 */
describe("gistVoiceOf", () => {
  it("is the author's when the blurb is the excerpt", () => {
    expect(gistVoiceOf("The paper's own first lines.", "The paper's own first lines.")).toBe("author");
  });
  it("is the model's when it is anything else, or there is no excerpt", () => {
    expect(gistVoiceOf("A model's one sentence.", "The paper's own first lines.")).toBe("ai");
    expect(gistVoiceOf("A model's one sentence.", null)).toBe("ai");
    expect(gistVoiceOf("A model's one sentence.", undefined)).toBe("ai");
  });
});
