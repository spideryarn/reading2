/**
 * **Every "older version of the article" banner is drawn by StaleNotice.tsx**,
 * so every one has the × — docs/plans/261010a-dismiss-older-version-notices.md,
 * GPT Sol's plan review finding 7. Greg, 2026-10-09 (`spya-mutgym`): *"Look for
 * all of those and in each case make sure there is a way for me to dismiss
 * them if I don't want to rerun it."*
 *
 * A source guard over src/web, read as syntax rather than text, so comments do
 * not count. It fails when either of these appears outside a `<StaleNotice>`
 * or `<DismissibleNotice>` element:
 *
 *  - a stale banner's box class — `gloss-stale`, `quotes-stale`, `clm-stale`,
 *    `srch-stale`, `sk-stale`, `ill-stale` — in a string, which is how a second
 *    hand-built banner would start;
 *  - the words *"older version of the article"* in a string or in JSX text,
 *    which is how a banner in other markup would say it.
 *
 * Each exception is named with its reason. tests/stale-notice-every-mode.test.tsx
 * is the other half: each mode's banner, mounted, has an × that works.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { type Node, VISITOR_KEYS } from "@babel/types";
import { describe, expect, it } from "vitest";

const WEB = path.join(import.meta.dirname, "..", "src", "web");

/** Files that may draw the banner themselves, and why. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  "StaleNotice.tsx": "It is the banner.",
  "QuizPanel.tsx":
    "Quiz keeps a banner with no ×: a stale quiz refuses every mark and disables the answer box, " +
    "and the banner is the only explanation of why (plan 261010a, GPT Sol's finding 3).",
};

const BOX = /(?:^|[\s"'`])(?:gloss|quotes|clm|srch|sk|ill)-stale(?![\w-])/;
const WORDS = /older version of the article/i;
const NOTICES = new Set(["StaleNotice", "DismissibleNotice"]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Each string or JSX text in `code` that says it, outside a notice element. */
function offences(code: string): string[] {
  const tree = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found: string[] = [];

  const textOf = (node: Node): string | null => {
    if (node.type === "StringLiteral" || node.type === "JSXText") return node.value;
    if (node.type === "TemplateElement") return node.value.raw;
    return null;
  };

  const beginsNotice = (node: Node): boolean => {
    if (node.type !== "JSXElement") return false;
    const name = node.openingElement.name;
    return name.type === "JSXIdentifier" && NOTICES.has(name.name);
  };

  const childrenOf = (node: Node): Node[] => {
    const out: Node[] = [];
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      const children = Array.isArray(child) ? child : [child];
      for (const candidate of children) {
        if (candidate && typeof candidate === "object" && "type" in candidate) out.push(candidate as Node);
      }
    }
    return out;
  };

  const walk = (node: Node, inNotice: boolean): void => {
    const inside = inNotice || beginsNotice(node);
    const text = textOf(node);
    if (text !== null && !inside && (BOX.test(` ${text}`) || WORDS.test(text))) {
      found.push(`line ${node.loc?.start.line}: ${text.trim().slice(0, 80)}`);
    }
    for (const child of childrenOf(node)) walk(child, inside);
  };
  walk(tree.program, false);
  return found;
}

describe("the stale notice guard", () => {
  it("finds a hand-built banner, and the words outside a notice — and nothing in a comment", () => {
    const bad = `
      // These describe an older version of the article — a comment, so fine.
      export const A = () => <div className="gloss-stale"><p>x</p></div>;
      export const B = () => <p>This describes an older version of the article.</p>;
      export const C = () => <StaleNotice notice={n}>This describes an older version of the article.</StaleNotice>;
      export const D = () => <StaleNotice notice={n} className="quotes-stale">x</StaleNotice>;
      export const E = () => <p className="srch-stale-hint">a hint, not a box</p>;
    `;
    expect(offences(bad)).toEqual([
      "line 3: gloss-stale",
      "line 4: This describes an older version of the article.",
    ]);
  });

  it("finds no stale banner in src/web outside StaleNotice.tsx, bar the named exceptions", () => {
    const all: string[] = [];
    for (const file of sources(WEB)) {
      const rel = path.relative(WEB, file);
      if (EXCEPTIONS[path.basename(file)] !== undefined) continue;
      for (const offence of offences(readFileSync(file, "utf8"))) all.push(`src/web/${rel} ${offence}`);
    }
    expect(all, "draw it with <StaleNotice> (src/web/StaleNotice.tsx), or name the exception and why").toEqual([]);
  });

  it("names exceptions that still exist and still draw a banner", () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      const file = sources(WEB).find((f) => path.basename(f) === name);
      expect(file, `${name} is on the exception list and is gone`).toBeTruthy();
      if (name === "StaleNotice.tsx") continue;
      expect(offences(readFileSync(file ?? "", "utf8")).length, `${name} no longer needs its exception`).toBeGreaterThan(0);
    }
  });

  it("gates every job-bearing panel on the banner showing, not on stale", () => {
    const cases: readonly [string, RegExp, number][] = [
      ["IdeasPanel.tsx", /!bannerShowing\s*&&/g, 1],
      ["FaqPanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 1],
      ["TimelinePanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 1],
      ["SimplePanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 1],
      ["BibliographyPanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 1],
      ["Tweets.tsx", /!bannerShowing\s*&&/g, 3],
      ["QuotesPanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 1],
      ["ReceptionAndClaimsPanel.tsx", /staleNotice\.showing\.length === 0\s*&&/g, 2],
    ];
    for (const [name, pattern, expected] of cases) {
      const code = readFileSync(path.join(WEB, name), "utf8");
      expect(code.match(pattern)?.length ?? 0, `${name}'s job gate`).toBe(expected);
    }
  });
});
