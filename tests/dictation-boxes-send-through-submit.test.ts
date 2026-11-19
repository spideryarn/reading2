/**
 * **Every box with a microphone and a done action presses it through
 * `submit`, or says why it has no done action** — report spya-gjcyq3, plan
 * docs/plans/261103b-send-while-dictating-stops-and-sends-in-every-box.md.
 *
 * Greg, 2026-11-03: *"the better thing would have been for it to automatically
 * click the Stop Dictating button + click the Send button for them in one fell
 * swoop. This should ideally be true for all existing voice dictate buttons
 * (at least where it makes sense) and going forwards."*
 *
 * `useDictationField().submit()` is the one entry point: idle, it runs the
 * box's `onDone`; while the microphone is involved, it stops it and runs
 * `onDone` once the words land. A box that wires its Send to its own send
 * instead refuses while dictating, which is the behaviour reported. So:
 *
 * - a component whose `useDictationField({...})` has an `onDone` must use
 *   `.submit` somewhere in that component;
 * - a component whose field has none must be listed below with its reason.
 *
 * A ratchet read from the source, per top-level component (the shape
 * tests/prose-boxes-have-a-microphone.test.ts uses). What it does NOT prove:
 * that the Send button is *live* while dictating — that is each box's own
 * test (tests/the-enter-key-really-sends.test.tsx for chat) and
 * docs/project/dictation.md § Adding it to a box.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "src/web");

/** Components with a microphone and no done action, and why. Each is a decision. */
const NO_DONE: Record<string, string> = {
  "src/web/ProfileBox.tsx#ProfileBox": "no Send: the profile box saves itself once the words land",
  "src/web/AddPage.tsx#useBusyDictation": "the add page's two boxes have no Send: they save themselves, and the page holds its exits while a box is busy",
  "src/web/CommentDialog.tsx#CommentBody": "the comment's own note has no Send: it saves itself once the words land (onCommit)",
  "src/web/IllustratedView.tsx#useSteerNote":
    "Repaint is a paid run on words the reader has not seen; the double press there waits on Greg's yes (qi-wd4mg6p6), and so does this",
};

interface SyntaxNode {
  type: string;
  [key: string]: unknown;
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key === "loc" || key === "extra" || key === "comments" || key === "tokens") continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) walk(item as SyntaxNode, visit);
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walk(child as SyntaxNode, visit);
    }
  }
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

interface Field {
  where: string;
  done: boolean;
  submits: boolean;
}

function topLevel(entry: SyntaxNode): { name: string; root: SyntaxNode }[] {
  const top =
    entry.type === "ExportNamedDeclaration" || entry.type === "ExportDefaultDeclaration"
      ? (entry.declaration as SyntaxNode | undefined)
      : entry;
  if (!top) return [];
  if (top.type === "FunctionDeclaration") {
    const id = top.id as SyntaxNode | undefined;
    return [{ name: id?.type === "Identifier" ? String(id.name) : "?", root: top }];
  }
  if (top.type !== "VariableDeclaration") return [];
  return (top.declarations as SyntaxNode[]).flatMap((d) => {
    const id = d.id as SyntaxNode | undefined;
    const init = d.init as SyntaxNode | undefined;
    return init ? [{ name: id?.type === "Identifier" ? String(id.name) : "?", root: init }] : [];
  });
}

function fieldsIn(file: string, source: string): Field[] {
  const tree = babelParse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found: Field[] = [];
  for (const entry of tree.program.body as unknown as SyntaxNode[]) {
    for (const { name, root } of topLevel(entry)) {
      let field = false;
      let done = false;
      let submits = false;
      walk(root, (node) => {
        if (node.type === "CallExpression") {
          const callee = node.callee as SyntaxNode;
          if (callee.type === "Identifier" && callee.name === "useDictationField") {
            field = true;
            const arg = (node.arguments as SyntaxNode[])[0];
            if (arg?.type === "ObjectExpression") {
              for (const p of arg.properties as SyntaxNode[]) {
                const key = p.key as SyntaxNode | undefined;
                if (key?.type === "Identifier" && key.name === "onDone") done = true;
                /* `...(loaded ? { onDone } : {})`, the annotate box's shape. */
                if (p.type === "SpreadElement") {
                  walk(p, (inner) => {
                    const k = inner.key as SyntaxNode | undefined;
                    if (k?.type === "Identifier" && k.name === "onDone") done = true;
                  });
                }
              }
            }
          }
        }
        if (node.type === "MemberExpression") {
          const prop = node.property as SyntaxNode;
          if (prop.type === "Identifier" && prop.name === "submit") submits = true;
        }
      });
      if (field) found.push({ where: `${file}#${name}`, done, submits });
    }
  }
  return found;
}

const fields = tsxFiles(WEB)
  .filter((p) => !p.endsWith("useDictationField.ts"))
  .flatMap((p) => {
    const source = readFileSync(p, "utf8");
    return /useDictationField\s*[<(]/.test(source) ? fieldsIn(relative(ROOT, p), source) : [];
  });

describe("a box's done action goes through submit, so Send while dictating stops and sends", () => {
  it("finds the boxes (a scan that finds none proves nothing)", () => {
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.map((f) => f.where)).toContain("src/web/ChatPanel.tsx#Composer");
    expect(fields.map((f) => f.where)).toContain("src/web/CommandBar.tsx#CommandBar");
  });

  it("every box with an onDone wires its Send through .submit", () => {
    const missing = fields.filter((f) => f.done && !f.submits).map((f) => f.where);
    expect(missing).toEqual([]);
  });

  it("every box without an onDone is listed with its reason", () => {
    const unlisted = fields.filter((f) => !f.done && !(f.where in NO_DONE)).map((f) => f.where);
    expect(unlisted).toEqual([]);
  });

  it("the list holds no box that has gone or gained an onDone", () => {
    const stale = Object.keys(NO_DONE).filter((where) => !fields.some((f) => f.where === where && !f.done));
    expect(stale).toEqual([]);
  });
});
