/**
 * **Structure's starts-only answer, converted into the ranged proposal the tree
 * builder already understands.**
 *
 * The wire DTO carries no redundant ends: the root is bounded by the body it was
 * shown, and each child carries only its start. `modelNodeFromStarts` derives a
 * complete `ModelNode` recursively through the shared starts-to-ranges kernel;
 * `ModelNode.range` therefore remains a required `[string, string]` everywhere
 * downstream.
 *
 * This is a conversion seam, not an id trust seam. Every proposed start is still
 * resolved against the body. An invented id refuses with `buildTree`'s existing
 * message, while a wrong-but-real id remains possible exactly as it is for the
 * ranged answer. The live `toc/11` path calls this module at its parse boundary;
 * the frozen `toc/10` eval arm deliberately keeps the old ranged parser.
 */
import { nameValue } from "./ids.js";
import type { BuildReport, ModelNode } from "./structure.js";
import {
  deriveStartRanges,
  WHOLE_DOCUMENT_START_POLICY,
  type DerivedStartRange,
} from "./start-ranges.js";
import type { Block } from "./types.js";

interface StartsOnlyFields {
  title: string;
  gist?: string;
  question?: string;
  sourceHeading?: string;
}

export interface StartsOnlyNode extends StartsOnlyFields {
  start: string;
  children?: StartsOnlyNode[];
}

export interface StartsOnlyRoot extends StartsOnlyFields {
  children?: StartsOnlyNode[];
}

export interface StartsOnlyWholeDocumentAnswer {
  root: StartsOnlyRoot;
}

function fieldsOf(node: StartsOnlyFields): Omit<ModelNode, "range" | "children"> {
  return {
    title: node.title,
    ...(node.gist !== undefined ? { gist: node.gist } : {}),
    ...(node.question !== undefined ? { question: node.question } : {}),
    ...(node.sourceHeading !== undefined ? { sourceHeading: node.sourceHeading } : {}),
  };
}

/** Convert one starts-only answer without changing it or any of its descendants. */
export function modelNodeFromStarts(
  answer: StartsOnlyWholeDocumentAnswer,
  blocks: readonly Block[],
  report?: BuildReport,
): ModelNode {
  const first = blocks[0];
  const last = blocks.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A starts-only table of contents cannot be built over an empty body.");
  }
  const index = new Map(blocks.map((block, position) => [block.id, position]));
  const built = report ?? {
    repairs: [],
    droppedChildren: [],
    rangelessChildren: [],
    droppedHeadings: [],
    collapsedRungs: [],
    droppedQuestions: [],
  };

  const convertChildren = (
    children: readonly StartsOnlyNode[] | undefined,
    parent: readonly [number, number],
    where: string,
  ): ModelNode[] | undefined => {
    if (children === undefined || children.length === 0) return undefined;
    const planned = deriveStartRanges({
      children,
      parent,
      blocks,
      index,
      where,
      policy: WHOLE_DOCUMENT_START_POLICY,
    });
    if (!planned.ok) {
      /* The whole-document policy clamps outside starts and accepts any child
         count, so only an unresolvable start can fail here. Keeping this switch
         exhaustive makes a future policy change a compiler error at the seam. */
      switch (planned.reason) {
        case "invented-start":
          throw new Error(
            `Node range not in blocks.json — at ${where} > child ${planned.childIndex + 1}: ` +
              `start ${nameValue(planned.start)}`,
          );
        case "outside-parent":
        case "not-an-expansion":
          throw new Error(`The whole-document start policy unexpectedly refused ${planned.reason}.`);
      }
    }
    built.repairs.push(...planned.repairs);
    built.droppedChildren.push(...planned.droppedChildren);
    return planned.children.map((child) => convertChild(child, `${where} > child ${child.childIndex + 1}`));
  };

  const convertChild = (
    child: DerivedStartRange<StartsOnlyNode>,
    where: string,
  ): ModelNode => {
    const children = convertChildren(child.proposed.children, [child.start, child.end], where);
    return {
      ...fieldsOf(child.proposed),
      range: child.range,
      ...(children !== undefined ? { children } : {}),
    };
  };

  const rootChildren = convertChildren(answer.root.children, [0, blocks.length - 1], "root");
  const root: ModelNode = {
    ...fieldsOf(answer.root),
    range: [first.id, last.id],
    ...(rootChildren !== undefined ? { children: rootChildren } : {}),
  };
  return root;
}
