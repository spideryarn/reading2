/**
 * **A Help page's Markdown, drawn**: as React for the page, and as plain text
 * for the search box, the tests and a model.
 *
 * The files are in src/web/help/pages/ and the tables that load them in
 * help-pages.ts. They are parsed in the browser by `mdast-util-from-markdown`,
 * which the client already ships for chat (Cited.tsx), and the tree is walked
 * straight into elements, as there. **No HTML is ever built**, so there is
 * nothing to sanitise.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § The Markdown, and how it becomes a page.
 *
 * ## Not `Cited.tsx`, and the opposite of it in one way
 *
 * `Cited` draws what a model wrote, so whatever it does not understand it
 * shows as the characters that arrived: it must never lose text. These files
 * are ours, so whatever this walk does not understand it **throws** on: a
 * numbered list, a block quote, an image, a line of HTML, a token nobody
 * defined. A test renders every file (tests/help-page.test.tsx renders the
 * page), so a construct that would have been drawn wrongly is a red test
 * instead. Adding one is a case in `drawBlock` or `drawInline`, and its twin
 * in the text walk below.
 *
 * ## What a file may contain
 *
 * Paragraphs, `##` headings, tight bulleted lists (nested if need be),
 * `**strong**`, `*emphasis*`, `` `code` ``, links, and one piece of HTML:
 * `<kbd>…</kbd>`. The elements that come out are exactly the ones the words
 * were made of when they were TSX (`p`, `ul`, `li`, `strong`, `em`, `code`,
 * `kbd`, `a`), with no class of their own: HelpPage.tsx § HelpSectionView
 * styles them once, by element.
 *
 * ## Links are final addresses, and the page decides what to do with them
 *
 * A file says `/help/spine`, `/help/questions#faq-older-profile`, `/pricing`,
 * so it reads correctly on GitHub and to a model handed it raw. A `/help/…`
 * link is turned back into its anchor and given to the caller's `hrefFor`
 * (help-parts.tsx § HelpHrefFor), and one that names no live anchor throws.
 * Any other site path is the router's `Link`.
 *
 * ## The tokens
 *
 * Four facts live in code and would go stale in prose, so a file names them:
 *
 * | token | stands for |
 * |---|---|
 * | `{{experimental-modes}}` | the experimental modes' names, "A, B and C" |
 * | `{{public-shelf-label}}` | `PUBLIC_SHELF_LABEL` |
 * | `{{whats-new-label}}` | `CHANGELOG_LABEL` |
 * | `{{modes-table}}`, alone in a paragraph | the *Which mode when* table |
 *
 * The first three are replaced inside a run of text **after** parsing, so a
 * label can never be read as Markdown. An unknown token throws.
 */
import type { ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { List, ListItem, Paragraph, PhrasingContent, RootContent } from "mdast";

import { PUBLIC_SHELF_LABEL } from "../../messages.js";
import { MODE_CATALOG } from "../../mode-catalog.js";
import { MODES } from "../../modes.js";
import { MODE_LABEL } from "../../title-text.js";
import { CHANGELOG_LABEL, HELP_HREF } from "../router.js";
import { resolveHelpAnchor, type HelpAnchor } from "./help-anchors.js";
import { MODE_WHEN, ModesTable } from "./help-mode-when.js";
import { helpPageBody } from "./help-pages.js";
import { HelpAnchorLink, HelpSub, PageLink, type HelpHrefFor } from "./help-parts.js";

/* ───────────────────────────── the tokens ───────────────────────────── */

/** "A, B and C". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The tokens that stand for a few words. Functions, so each is read when it is
 * asked for; the experimental list is from the catalog, so it cannot go stale.
 */
const TEXT_TOKENS: Readonly<Record<string, () => string>> = {
  "experimental-modes": () => listOf(MODES.filter((m) => MODE_CATALOG[m].experimental).map((m) => MODE_LABEL[m])),
  "public-shelf-label": () => PUBLIC_SHELF_LABEL,
  "whats-new-label": () => CHANGELOG_LABEL,
};

const TABLE_TOKEN = "modes-table";
const TOKEN = /\{\{([^{}]*)\}\}/g;

/** One text token's words, or a throw naming it. */
function textToken(name: string, where: string): string {
  const read = Object.hasOwn(TEXT_TOKENS, name) ? TEXT_TOKENS[name] : undefined;
  if (read === undefined) {
    throw new Error(
      name === TABLE_TOKEN
        ? `Help page ${where}: {{${TABLE_TOKEN}}} must be alone in its own paragraph`
        : `Help page ${where}: unknown token {{${name}}}`,
    );
  }
  return read();
}

/** Replace every token, and refuse a `{{` or `}}` that is part of none: a token left half-typed. */
function expand(text: string, where: string, each: (name: string) => string): string {
  const out = text.replace(TOKEN, (_whole, name: string) => each(name));
  const stray = text.replace(TOKEN, "");
  if (stray.includes("{{") || stray.includes("}}")) throw new Error(`Help page ${where}: a token is not closed: ${text}`);
  return out;
}

/** The text tokens in one run of prose. */
function expandText(text: string, where: string): string {
  return expand(text, where, (name) => textToken(name, where));
}

/** The table as a model would want it: a line per mode, in `MODES` order. */
function modesTableMarkdown(): string {
  return MODES.map(
    (m) =>
      `- **${MODE_LABEL[m]}**${MODE_CATALOG[m].experimental ? " (experimental)" : ""}: reach for it when ${MODE_WHEN[m]}`,
  ).join("\n");
}

/**
 * **A file's Markdown with every token replaced, still Markdown.** For
 * anything that is handed the files as text rather than drawing them: the
 * Help chatbot is the reader this was written for. The table becomes a list,
 * "- **Label**: reach for it when …", since a model has no use for a
 * component. `where` is only for the message if a token is unknown.
 */
export function expandHelpTokens(raw: string, where = "(text)"): string {
  return expand(raw, where, (name) => (name === TABLE_TOKEN ? modesTableMarkdown() : textToken(name, where)));
}

/* ───────────────────────────── shared reading ───────────────────────────── */

/** A paragraph that is the table's token and nothing else. */
function isTableToken(node: Paragraph): boolean {
  const only = node.children.length === 1 ? node.children[0] : undefined;
  return only?.type === "text" && only.value.trim() === `{{${TABLE_TOKEN}}}`;
}

/** A soft line break in the file is a space on the page. */
function proseOf(value: string, where: string): string {
  return expandText(value.replace(/\n/g, " "), where);
}

const KBD_OPEN = "<kbd>";
const KBD_CLOSE = "</kbd>";

/**
 * **One inline run, with each `<kbd>…</kbd>` gathered into one piece.** The
 * parser gives an opening tag and a closing tag as two `html` nodes among
 * their siblings, so the pair is matched here, once, for both walks. Any other
 * HTML, a `<kbd>` never closed, or one inside another, throws.
 */
type Piece = { kind: "node"; node: PhrasingContent } | { kind: "kbd"; children: PhrasingContent[] };

function pieces(nodes: readonly PhrasingContent[], where: string): Piece[] {
  const out: Piece[] = [];
  let open: PhrasingContent[] | null = null;
  for (const node of nodes) {
    if (node.type !== "html") {
      if (open !== null) open.push(node);
      else out.push({ kind: "node", node });
      continue;
    }
    if (node.value === KBD_OPEN && open === null) open = [];
    else if (node.value === KBD_CLOSE && open !== null) {
      out.push({ kind: "kbd", children: open });
      open = null;
    } else throw new Error(`Help page ${where}: the only HTML allowed is <kbd>…</kbd>, found ${node.value}`);
  }
  if (open !== null) throw new Error(`Help page ${where}: a <kbd> is never closed`);
  return out;
}

/**
 * **What a list item holds**: its words, then any lists nested under it. Only
 * tight lists, where an item is one run of prose: a blank line between items
 * would make each a paragraph, which the page would space differently, so it
 * is refused rather than guessed at.
 */
function itemParts(item: ListItem, list: List, where: string): { words: Paragraph; nested: List[] } {
  const [words, ...rest] = item.children;
  if (list.ordered === true) throw new Error(`Help page ${where}: numbered lists are not drawn`);
  if (list.spread === true || item.spread === true) {
    throw new Error(`Help page ${where}: a list has a blank line between or inside its items`);
  }
  if (item.checked !== null && item.checked !== undefined) throw new Error(`Help page ${where}: task lists are not drawn`);
  if (words?.type !== "paragraph") throw new Error(`Help page ${where}: a list item must start with its words`);
  const nested = rest.map((child) => {
    if (child.type !== "list") throw new Error(`Help page ${where}: a list item holds a ${child.type}`);
    return child;
  });
  return { words, nested };
}

/** A link's title (`[x](/y "title")`) is drawn nowhere, so it is not allowed to exist. */
function linkTarget(node: Extract<PhrasingContent, { type: "link" }>, where: string): Target {
  if (node.title !== null && node.title !== undefined) throw new Error(`Help page ${where}: a link has a title`);
  return targetOf(node.url, where);
}

type Target = { kind: "help"; anchor: HelpAnchor } | { kind: "page"; href: string };

const HELP_PREFIX = `${HELP_HREF}/`;
/** Where the questions live together. A question's link is a fragment of it. */
const QUESTIONS_PREFIX = `${HELP_PREFIX}questions#`;

/**
 * **What a link in a file points at.** `/help/<anchor>` or
 * `/help/questions#<faq id>` is a Help anchor, and must be a live one: an
 * alias (`mode-trajectory`) is refused, because a file should name the page
 * as it is now. Any other path on this site is a page. A full URL throws:
 * nothing in Help links off the site yet, and when something does, how it
 * opens is a decision to make then.
 */
export function targetOf(url: string, where: string): Target {
  if (url.startsWith(HELP_PREFIX)) {
    const isQuestion = url.startsWith(QUESTIONS_PREFIX);
    const id = url.slice(isQuestion ? QUESTIONS_PREFIX.length : HELP_PREFIX.length);
    const anchor = resolveHelpAnchor(id);
    if (anchor === null || anchor !== id) throw new Error(`Help page ${where}: ${url} names no live Help page`);
    /* A question is only under `questions#`, and only questions are. */
    if (anchor.startsWith("faq-") !== isQuestion) {
      throw new Error(`Help page ${where}: ${url} should be ${isQuestion ? `${HELP_PREFIX}${id}` : `${QUESTIONS_PREFIX}${id}`}`);
    }
    return { kind: "help", anchor };
  }
  if (url.startsWith("/") && !url.startsWith("//")) return { kind: "page", href: url };
  throw new Error(`Help page ${where}: a link must be a path on this site, found ${url}`);
}

/* ───────────────────────────── as React ───────────────────────────── */

interface Ctx {
  hrefFor: HelpHrefFor;
  /** Which file, for the message when something in it is refused. */
  where: string;
}

/* Keys are positions: the words are constants, so nothing is ever reordered. */

function drawInlines(nodes: readonly PhrasingContent[], ctx: Ctx): ReactNode[] {
  return pieces(nodes, ctx.where).map((piece, i) =>
    piece.kind === "kbd" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: constant words; position is the identity
      <kbd key={i}>{drawInlines(piece.children, ctx)}</kbd>
    ) : (
      drawInline(piece.node, i, ctx)
    ),
  );
}

function drawInline(node: PhrasingContent, key: number, ctx: Ctx): ReactNode {
  switch (node.type) {
    case "text":
      return proseOf(node.value, ctx.where);
    case "strong":
      return <strong key={key}>{drawInlines(node.children, ctx)}</strong>;
    case "emphasis":
      return <em key={key}>{drawInlines(node.children, ctx)}</em>;
    case "inlineCode":
      return <code key={key}>{node.value}</code>;
    case "link": {
      const target = linkTarget(node, ctx.where);
      const children = drawInlines(node.children, ctx);
      return target.kind === "help" ? (
        <HelpAnchorLink key={key} href={ctx.hrefFor(target.anchor)}>
          {children}
        </HelpAnchorLink>
      ) : (
        <PageLink key={key} href={target.href}>
          {children}
        </PageLink>
      );
    }
    default:
      throw new Error(`Help page ${ctx.where}: nothing draws a "${node.type}" inside a line`);
  }
}

function drawList(list: List, key: number, ctx: Ctx): ReactNode {
  return (
    <ul key={key}>
      {list.children.map((item, i) => {
        const { words, nested } = itemParts(item, list, ctx.where);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: constant words; position is the identity
          <li key={i}>
            {drawInlines(words.children, ctx)}
            {nested.map((n, j) => drawList(n, j, ctx))}
          </li>
        );
      })}
    </ul>
  );
}

function drawBlock(node: RootContent, key: number, ctx: Ctx): ReactNode {
  switch (node.type) {
    case "paragraph":
      if (isTableToken(node)) return <ModesTable key={key} hrefFor={ctx.hrefFor} />;
      return <p key={key}>{drawInlines(node.children, ctx)}</p>;
    case "heading":
      /* One level, drawn as the small subheading a mode's two halves have
         always had. A page's own title is its front matter, never a `#`. */
      if (node.depth !== 2) throw new Error(`Help page ${ctx.where}: only ## headings are drawn`);
      return <HelpSub key={key}>{drawInlines(node.children, ctx)}</HelpSub>;
    case "list":
      return drawList(node, key, ctx);
    default:
      throw new Error(`Help page ${ctx.where}: nothing draws a "${node.type}"`);
  }
}

function drawBlocks(nodes: readonly RootContent[], ctx: Ctx): ReactNode {
  return nodes.map((node, i) => drawBlock(node, i, ctx));
}

/**
 * **One file's body as elements.** `where` names the file in any error.
 * `hrefFor` is where a link to another Help anchor should point.
 */
export function renderHelpMarkdown(markdown: string, hrefFor: HelpHrefFor, where: string): ReactNode {
  return drawBlocks(fromMarkdown(markdown).children, { hrefFor, where });
}

/** The two headings a mode's file may have, spelled exactly so. */
const MODE_HEADINGS = { whenToUse: "When to use it", reading: "Reading it" } as const;
type ModeHalf = keyof typeof MODE_HEADINGS;

/**
 * **A mode's file, as its two halves**, each null when the file leaves it out
 * (the page draws nothing for a null: help-parts.tsx § HelpModeExtra). The
 * headings are not drawn here: the page puts its own above each half, as it
 * always has.
 *
 * Strict about the shape, because a misspelt heading would otherwise file a
 * whole half under the wrong name or drop it: nothing before the first
 * heading, only these two headings, each at most once, in this order.
 */
export function renderHelpModeHalves(
  markdown: string,
  hrefFor: HelpHrefFor,
  where: string,
): Record<ModeHalf, ReactNode | null> {
  const halves: Record<ModeHalf, RootContent[] | null> = { whenToUse: null, reading: null };
  let into: RootContent[] | null = null;
  for (const node of fromMarkdown(markdown).children) {
    if (node.type !== "heading") {
      if (into === null) throw new Error(`Help page ${where}: a mode's file must start with a ## heading`);
      into.push(node);
      continue;
    }
    const title = plainInlines(node.children, where);
    const half = (Object.keys(MODE_HEADINGS) as ModeHalf[]).find((h) => MODE_HEADINGS[h] === title);
    if (node.depth !== 2 || half === undefined) {
      throw new Error(`Help page ${where}: a mode's headings are "## ${MODE_HEADINGS.whenToUse}" and "## ${MODE_HEADINGS.reading}", found "${title}"`);
    }
    if (halves[half] !== null || (half === "whenToUse" && halves.reading !== null)) {
      throw new Error(`Help page ${where}: "## ${title}" is repeated or out of order`);
    }
    into = [];
    halves[half] = into;
  }
  const ctx: Ctx = { hrefFor, where };
  return {
    whenToUse: halves.whenToUse === null ? null : drawBlocks(halves.whenToUse, ctx),
    reading: halves.reading === null ? null : drawBlocks(halves.reading, ctx),
  };
}

/* ───────────────────────────── as plain text ───────────────────────────── */

function plainInlines(nodes: readonly PhrasingContent[], where: string): string {
  return pieces(nodes, where)
    .map((piece) => (piece.kind === "kbd" ? plainInlines(piece.children, where) : plainInline(piece.node, where)))
    .join("");
}

function plainInline(node: PhrasingContent, where: string): string {
  switch (node.type) {
    case "text":
      return proseOf(node.value, where);
    case "inlineCode":
      return node.value;
    case "strong":
    case "emphasis":
      return plainInlines(node.children, where);
    case "link":
      /* Checked as the drawn walk checks it, so the two refuse the same files. */
      linkTarget(node, where);
      return plainInlines(node.children, where);
    default:
      throw new Error(`Help page ${where}: nothing reads a "${node.type}" inside a line`);
  }
}

function plainList(list: List, where: string): string[] {
  return list.children.flatMap((item) => {
    const { words, nested } = itemParts(item, list, where);
    return [plainInlines(words.children, where), ...nested.flatMap((n) => plainList(n, where))];
  });
}

function plainBlock(node: RootContent, where: string): string[] {
  switch (node.type) {
    case "paragraph":
      if (isTableToken(node)) return MODES.map((m) => `${MODE_LABEL[m]}: reach for it when ${MODE_WHEN[m]}`);
      return [plainInlines(node.children, where)];
    case "heading":
      if (node.depth !== 2) throw new Error(`Help page ${where}: only ## headings are drawn`);
      return [plainInlines(node.children, where)];
    case "list":
      return plainList(node, where);
    default:
      throw new Error(`Help page ${where}: nothing reads a "${node.type}"`);
  }
}

/**
 * **A file's body as the words a reader sees**, one line per paragraph, list
 * item or heading: tokens replaced, Markdown's marks gone, links reduced to
 * their words. Refuses exactly what `renderHelpMarkdown` refuses.
 */
export function helpMarkdownText(markdown: string, where: string): string {
  return fromMarkdown(markdown)
    .children.flatMap((node) => plainBlock(node, where))
    .join("\n");
}

/**
 * **The words of one section, by its anchor**: what the search box reads below
 * a title and its keywords, and what a test asserts a promise against.
 *
 * A mode's are its own two halves with their headings. Its label and its two
 * catalog sentences are not here: they are `MODE_LABEL`'s and `MODE_CATALOG`'s
 * (help-content.tsx § The modes say only what the catalog does not).
 */
export function helpSectionText(anchor: HelpAnchor): string {
  return helpMarkdownText(helpPageBody(anchor), anchor);
}
