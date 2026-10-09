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
 * numbered list, a block quote, a picture anywhere but alone in its
 * paragraph, a line of HTML, a token nobody defined. A test renders every file (tests/help-page.test.tsx renders the
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
 * `kbd`, `a`), with no class of their own: HelpPage.tsx § `WORDS_CLASS`
 * styles them once, by element.
 *
 * And, since 2026-10-07, **a picture**: an image alone in its paragraph,
 * `![alt](images/name.png "caption")`, drawn as a `<figure>` with the title
 * as its caption — the one place a file's words get classes of their own
 * (§ HelpFigure). The file must be in help-images.ts. In the text walk a
 * picture is its caption. docs/plans/261007l-help-screenshots-and-gifs.md.
 *
 * ## Links are final addresses, and every one is checked
 *
 * A file says `/help/spine`, `/help/questions#faq-older-profile`, `/pricing`,
 * so it reads correctly on GitHub and to a model handed it raw. A `/help/…`
 * link is turned back into its anchor, and one that names no live anchor
 * throws: that is the guard a typed `HelpRef` gave when the words were TSX.
 * Every link is the router's `Link` (help-parts.tsx § PageLink).
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
import { helpHref, resolveHelpAnchor, type HelpAnchor } from "./help-anchors.js";
import { MODE_WHEN, ModesTable } from "./help-mode-when.js";
import { HELP_IMAGES, type HelpImage } from "./help-images.js";
import { helpPageBody } from "./help-pages.js";
import { HelpSub, PageLink } from "./help-parts.js";

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

/* ───────────────────────────── pictures ───────────────────────────── */

type ImageNode = Extract<PhrasingContent, { type: "image" }>;

/** `images/<name>` from a topic's file, `../images/<name>` from one in a folder. */
const IMAGE_PATH = /^(?:\.\.\/)?images\/([a-z0-9-]+\.(?:png|gif))$/;

interface Figure {
  image: HelpImage;
  alt: string;
  caption: string;
}

/**
 * **A paragraph that is one picture and nothing else**, or null when it holds
 * no picture at all. A picture anywhere else — in a sentence, a list, a link,
 * beside another — reaches `drawInline`, which refuses it. The path's folder
 * is not checked here, only its name: tests/help-images.test.ts checks that
 * each path resolves from where its file is.
 */
function figureOf(node: Paragraph, where: string): Figure | null {
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type !== "image") return null;
  const alt = only.alt?.trim() ?? "";
  const caption = only.title?.trim() ?? "";
  if (alt === "") throw new Error(`Help page ${where}: a picture needs alt text, ![what it shows](…)`);
  if (caption === "") throw new Error(`Help page ${where}: a picture needs a caption, ![…](${only.url} "the caption")`);
  const name = IMAGE_PATH.exec(only.url)?.[1];
  if (name === undefined) throw new Error(`Help page ${where}: a picture's path is images/<name>.png or .gif, found ${only.url}`);
  const image = Object.hasOwn(HELP_IMAGES, name) ? HELP_IMAGES[name] : undefined;
  if (image === undefined) throw new Error(`Help page ${where}: ${name} is not in help-images.ts`);
  return { image, alt, caption: proseOf(caption, where) };
}

function imageAlone(node: ImageNode, where: string): never {
  throw new Error(`Help page ${where}: a picture must be alone in its own paragraph, found ${node.url}`);
}

/* ───────────────────────────── as React ───────────────────────────── */

interface Ctx {
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
      /* `helpHref` of the anchor and not the file's own spelling: they are
         the same today (`targetOf` refuses anything else), and if the two
         ever part, the address code builds is the one that is kept working. */
      return (
        <PageLink key={key} href={target.kind === "help" ? helpHref(target.anchor) : target.href}>
          {children}
        </PageLink>
      );
    }
    case "image":
      return imageAlone(node, ctx.where);
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

/**
 * **A picture and its caption.** Its own classes, unlike the other elements
 * here, which HelpPage.tsx § `WORDS_CLASS` styles by element: a figure needs a
 * frame and a quieter caption, and nothing else on the page is one. Drawn at
 * half its pixels, since every picture is shot at 2×; a narrow column shrinks
 * it (tailwind.css § images gives every `img` `max-width: 100%` and
 * `height: auto`). The thin rule gives a dark screenshot an edge on a light
 * page.
 */
function HelpFigure({ image, alt, caption }: Figure) {
  const img = (
    <img
      src={image.src}
      width={image.w / 2}
      height={image.h / 2}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="tw:rounded-md tw:border tw:border-rule"
    />
  );
  return (
    <figure className="tw:m-0 tw:my-2 tw:flex tw:flex-col tw:gap-2">
      {/* A GIF has a still for a reader who asked for less motion (help-images.ts § still). */}
      {image.still === undefined ? (
        img
      ) : (
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet={image.still.src} />
          {img}
        </picture>
      )}
      <figcaption className="tw:text-xs tw:leading-relaxed tw:text-ink-faint">{caption}</figcaption>
    </figure>
  );
}

function drawBlock(node: RootContent, key: number, ctx: Ctx): ReactNode {
  switch (node.type) {
    case "paragraph": {
      if (isTableToken(node)) return <ModesTable key={key} />;
      const figure = figureOf(node, ctx.where);
      if (figure !== null) return <HelpFigure key={key} {...figure} />;
      return <p key={key}>{drawInlines(node.children, ctx)}</p>;
    }
    case "heading":
      /* One level, drawn as the small subheading a mode's sections have
         always had. A page's own title is its front matter, never a `#`.
         A mode's own headings do not come this way: the page draws
         those itself (§ renderHelpModeSections). */
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

/** **One file's body as elements.** `where` names the file in any error. */
export function renderHelpMarkdown(markdown: string, where: string): ReactNode {
  return drawBlocks(fromMarkdown(markdown).children, { where });
}

/**
 * The three headings a mode's file has, spelled exactly so, in this order.
 * `In short` is required: it is the page's opening (Greg, `spya-xcmg2d`,
 * 2026-10-08 — *"motivate each mode. Why does it exist and what's it for, and
 * roughly how does it work? Start with that."*). Plan 261009a.
 */
const MODE_HEADINGS = { inShort: "In short", whenToUse: "When to use it", reading: "Reading it" } as const;
export type ModeSection = keyof typeof MODE_HEADINGS;
const MODE_SECTIONS = Object.keys(MODE_HEADINGS) as ModeSection[];

/** One section of a mode's file: its nodes, and its Markdown as written, heading included. */
export interface ModeSectionSource {
  readonly nodes: readonly RootContent[];
  readonly markdown: string;
}

interface Open {
  nodes: RootContent[];
  from: number;
  to: number;
}

/**
 * **A mode's file, split into its sections** — the one definition of which
 * headings a mode's file may have and in what order, used by the page
 * (§ renderHelpModeSections) and by the corpus the Help chat reads
 * (tests/help-corpus.test.ts), so the two cannot disagree.
 *
 * Strict about the shape, because a misspelt heading would otherwise file a
 * whole section under the wrong name or drop it: nothing before the first
 * heading, only these three headings, each at most once, in this order, and
 * `In short` present and not empty.
 */
export function helpModeSections(
  markdown: string,
  where: string,
): { inShort: ModeSectionSource } & Record<Exclude<ModeSection, "inShort">, ModeSectionSource | null> {
  const found: Partial<Record<ModeSection, Open>> = {};
  let into: Open | null = null;
  let last = -1;
  for (const node of fromMarkdown(markdown).children) {
    if (node.type !== "heading") {
      if (into === null) throw new Error(`Help page ${where}: a mode's file must start with a ## heading`);
      into.nodes.push(node);
      into.to = node.position?.end.offset ?? into.to;
      continue;
    }
    const title = plainInlines(node.children, where);
    const section = MODE_SECTIONS.find((h) => MODE_HEADINGS[h] === title);
    if (node.depth !== 2 || section === undefined) {
      const all = MODE_SECTIONS.map((h) => `"## ${MODE_HEADINGS[h]}"`).join(", ");
      throw new Error(`Help page ${where}: a mode's headings are ${all}, found "${title}"`);
    }
    const at = MODE_SECTIONS.indexOf(section);
    if (at <= last) throw new Error(`Help page ${where}: "## ${title}" is repeated or out of order`);
    last = at;
    const from = node.position?.start.offset ?? 0;
    into = { nodes: [], from, to: node.position?.end.offset ?? from };
    found[section] = into;
  }
  const source = (s: Open | undefined): ModeSectionSource | null =>
    s === undefined ? null : { nodes: s.nodes, markdown: markdown.slice(s.from, s.to) };
  const inShort = source(found.inShort);
  if (inShort === null || inShort.nodes.length === 0) {
    throw new Error(`Help page ${where}: a mode's file must open with "## ${MODE_HEADINGS.inShort}" and something under it`);
  }
  return { inShort, whenToUse: source(found.whenToUse), reading: source(found.reading) };
}

/**
 * **A mode's file, as its sections drawn**, each null when the file leaves it
 * out (the page draws nothing for a null: help-content.tsx § helpBody). The
 * headings are not drawn here: the page puts its own above each, and none
 * above `In short`, which opens the page.
 */
export function renderHelpModeSections(
  markdown: string,
  where: string,
): { inShort: ReactNode } & Record<Exclude<ModeSection, "inShort">, ReactNode | null> {
  const sections = helpModeSections(markdown, where);
  const ctx: Ctx = { where };
  const draw = (s: ModeSectionSource | null) => (s === null ? null : drawBlocks(s.nodes, ctx));
  return { inShort: draw(sections.inShort), whenToUse: draw(sections.whenToUse), reading: draw(sections.reading) };
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
    case "image":
      return imageAlone(node, where);
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
    case "paragraph": {
      if (isTableToken(node)) return MODES.map((m) => `${MODE_LABEL[m]}: reach for it when ${MODE_WHEN[m]}`);
      /* A picture is its caption: the words a reader can search for. */
      const figure = figureOf(node, where);
      if (figure !== null) return [figure.caption];
      return [plainInlines(node.children, where)];
    }
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
 * A mode's are its own three sections with their headings. Its label and its two
 * catalog sentences are not here: they are `MODE_LABEL`'s and `MODE_CATALOG`'s
 * (help-content.tsx § The modes say only what the catalog does not).
 */
export function helpSectionText(anchor: HelpAnchor): string {
  return helpMarkdownText(helpPageBody(anchor), anchor);
}
