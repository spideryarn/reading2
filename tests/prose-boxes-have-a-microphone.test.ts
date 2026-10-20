/**
 * **Every box for the reader's prose has a microphone, or says why not** —
 * plan docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md
 * § Stage 5.
 *
 * Greg, 2026-10-19 (spya-wc4vku): *"we really want a dictate button next to
 * pretty much all of our input boxes that are going to have more than a few
 * words of text typed into them. Let's make a minimal tweak to our docs and/or
 * design system to make this more likely going forwards."*
 *
 * A ratchet, read from the source. Every `<textarea>` under `src/web/` is
 * found, with the top-level component it is drawn in (`File.tsx#Component`),
 * and that component must set up a microphone — `useDictationField`, or a
 * `DictationButton` or `ProfileBox` it draws — or be listed below with its
 * reason. Per component rather than per file, because one file can hold a box
 * with a microphone and one without (GPT Sol's plan review, P2-4). A new
 * textarea without one fails here, so its author decides rather than forgets.
 * How to add one: docs/project/dictation.md § Adding it to a box.
 *
 * Textareas only. Almost every textarea is prose; an `<input>` is as often a
 * search field or a title as a sentence, and no reading of the source can
 * tell which, so those are left to the reviewer. The fleet dashboard
 * (`tools/fleet/`) has its own microphone, `DictationControl`, and is not
 * scanned.
 *
 * What it does NOT prove: that the microphone works in that box. That is the
 * box's own test, and dictation.md's checklist (`busy`, the keeper, the
 * unmount).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "src/web");

/** Components whose textareas have no microphone, and why. Each reason is a decision, not an excuse. */
const WITHOUT: Record<string, string> = {
  "src/web/DesignPage.tsx#ControlsAcrossModes": "a specimen of the text box's look on /design, not a box anyone writes in",
  "src/web/ViewportProbe.tsx#ProbePanel": "read-only: a report to copy, not a box to type into",
  "src/web/AdminVouchersPage.tsx#CreateForm": "admin only: a short note sent with a voucher",
  "src/web/AdminVouchersPage.tsx#VoucherRow": "admin only: a short note sent with a voucher",
  "src/web/AdminAuthorGifts.tsx#Notes": "admin only: notes on an author gift",
  "src/web/AdminAuthorGifts.tsx#DraftEditor": "admin only: the draft of an author gift's email",
  /* Prose boxes a reader writes in, without a microphone yet. Queued as the
     sweep in plan 261020r § Stage 5; each has its own send and unmount to
     check, so each is a change of its own. Delete the line when it lands. */
  "src/web/SkimPurpose.tsx#PurposeLine": "not yet: queued (Skim's own purpose box)",
  "src/web/CriteriaPanel.tsx#NewCriterion": "not yet: queued (Referee's new-criterion box)",
  "src/web/CandidatesPanel.tsx#Composer": "not yet: queued (scoping the candidates search)",
  "src/web/ChatPanel.tsx#EditQuestion": "not yet: queued (rewriting a question already asked)",
  "src/web/CommentDialog.tsx#CommentBody": "not yet: queued (editing a comment's note)",
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

interface Box {
  /** `src/web/File.tsx#Component`. */
  where: string;
  mic: boolean;
}

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

interface ComponentRoot {
  name: string;
  root: SyntaxNode;
}

function componentRoots(entry: SyntaxNode): ComponentRoot[] {
  const top =
    entry.type === "ExportNamedDeclaration" || entry.type === "ExportDefaultDeclaration"
      ? (entry.declaration as SyntaxNode | undefined)
      : entry;
  if (!top) return [];
  if (top.type === "FunctionDeclaration" || top.type === "ClassDeclaration") {
    const id = top.id as SyntaxNode | undefined;
    return [{ name: id?.type === "Identifier" ? String(id.name) : "?", root: top }];
  }
  if (top.type !== "VariableDeclaration") return [{ name: "?", root: top }];
  return (top.declarations as SyntaxNode[]).flatMap((declaration) => {
    const id = declaration.id as SyntaxNode | undefined;
    const root = declaration.init as SyntaxNode | undefined;
    return root
      ? [{ name: id?.type === "Identifier" ? String(id.name) : "?", root }]
      : [];
  });
}

function boxesIn(file: string, source: string): Box[] {
  const tree = babelParse(source, {
    sourceType: "module",
    sourceFilename: file,
    plugins: ["typescript", "jsx", "decorators-legacy"],
  });
  const found: Box[] = [];
  const add = (name: string, root: SyntaxNode): void => {
    let textareas = 0;
    let mic = false;
    walk(root, (node) => {
      if (node.type === "CallExpression") {
        const callee = node.callee as SyntaxNode | undefined;
        if (callee?.type === "Identifier" && callee.name === "useDictationField") mic = true;
      }
      if (node.type !== "JSXOpeningElement") return;
      const tag = node.name as SyntaxNode | undefined;
      const tagName = tag?.type === "JSXIdentifier" ? tag.name : undefined;
      if (tagName === "textarea" || tagName === "Textarea") textareas += 1;
      if (tagName === "DictationButton" || tagName === "DictationStrip" || tagName === "ProfileBox") mic = true;
    });
    for (let i = 0; i < textareas; i++) found.push({ where: `${file}#${name}`, mic });
  };
  for (const entry of tree.program.body as unknown as SyntaxNode[]) {
    for (const component of componentRoots(entry)) add(component.name, component.root);
  }
  return found;
}

const boxes: Box[] = tsxFiles(WEB).flatMap((path) =>
  boxesIn(relative(ROOT, path), readFileSync(path, "utf8")),
);

describe("prose boxes have a microphone", () => {
  it("finds a textarea wherever JSX puts it on the line", () => {
    const found = boxesIn(
      "src/web/Inline.tsx",
      "function Inline() { return <textarea aria-label=\"Words\" />; }",
    );
    expect(found.map((box) => box.where)).toEqual(["src/web/Inline.tsx#Inline"]);
  });

  it("does not mistake a microphone named only in a comment for one the component draws", () => {
    const [found] = boxesIn(
      "src/web/CommentOnly.tsx",
      "function CommentOnly() { /* <DictationStrip /> */ return <textarea />; }",
    );
    expect(found?.mic).toBe(false);
  });

  it("finds the boxes it is about (a scan that matches nothing proves nothing)", () => {
    const withMic = boxes.filter((b) => b.mic).map((b) => b.where);
    expect(withMic).toEqual(
      expect.arrayContaining([
        "src/web/AddPage.tsx#PurposeBox",
        "src/web/AddPage.tsx#AboutYouBox",
        "src/web/ProfileBox.tsx#ProfileBox",
        "src/web/FeedbackSendBox.tsx#FeedbackSendBox",
      ]),
    );
  });

  it("does not let a second textarea hide behind one microphone in the same component", () => {
    const counts = new Map<string, number>();
    for (const box of boxes) counts.set(box.where, (counts.get(box.where) ?? 0) + 1);
    const ambiguous = [...counts].filter(([, count]) => count > 1);
    expect(ambiguous, "give each textarea its own component, or make this ratchet account for each occurrence").toEqual([]);
  });

  it("every textarea is in a component with a microphone, or is listed with its reason", () => {
    const missing = boxes.filter((b) => !b.mic && !(b.where in WITHOUT)).map((b) => b.where);
    expect(missing, "add a microphone (docs/project/dictation.md § Adding it to a box), or list it in WITHOUT with why").toEqual([]);
  });

  it("every listed component still has a textarea and still has no microphone", () => {
    const stale = Object.keys(WITHOUT).filter((where) => {
      const found = boxes.filter((b) => b.where === where);
      return found.length === 0 || found.some((b) => b.mic);
    });
    expect(stale, "this exemption no longer describes the code: delete its line").toEqual([]);
  });
});
