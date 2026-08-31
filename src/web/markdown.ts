/**
 * The **block structure** of a model's answer — lists, headings, quotes, code
 * — as data, so the panel can draw it and a test can check it without a
 * browser.
 *
 * A module of its own beside citations.ts, and DOM-free for the same reason: it
 * is a parser, the input is untrusted model output, and the rules are easier to
 * be sure about as strings than as a screenshot.
 *
 * ## Why we parse this ourselves rather than adding a Markdown library
 *
 * Every Markdown library on the shelf takes text and gives back **HTML**, and
 * HTML from a model is exactly the thing docs/project/security.md exists to
 * prevent. Rendering it would mean `dangerouslySetInnerHTML` plus a sanitiser,
 * and then a second problem: the citation chips, the hover cards and the link
 * host lines are React components, not markup, so the HTML would have to be
 * re-parsed to put them back. So this file does the half a library would do —
 * finding the *blocks* — and hands each block's text to Cited.tsx, which turns
 * it into runs of **string** that React escapes. No stage of this ever produces
 * HTML.
 *
 * ## What it deliberately does not do
 *
 * This is not CommonMark and does not try to be. It is the shapes a model
 * actually writes into a chat answer:
 *
 *  - bullet and numbered lists, nested by indentation;
 *  - `#` headings;
 *  - `>` block quotes;
 *  - fenced code blocks, closed or — while an answer is still streaming — not;
 *  - `---` rules.
 *
 * No tables, no reference links, no HTML blocks, no setext headings, no lazy
 * continuation. Anything it does not recognise stays in a paragraph, exactly as
 * the model wrote it, which is what the panel did with all of it before.
 *
 * The **inline** marks — `**bold**`, `*italic*`, `` `code` ``, links and block
 * ids — are citations.ts's, and are applied to each block's text by Cited.tsx.
 */

/** One block of an answer. `text` is inline source, still to be split. */
export type MdBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: MdBlock[][] }
  | { kind: "quote"; blocks: MdBlock[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" };

/* Three leading spaces are allowed before a fence, a heading, a rule or a quote,
   as CommonMark allows. **The list markers below accept any indent**, which is
   deliberate and differs: four spaces would be an indented code block in
   CommonMark, we do not support those, and so `    - a` is far more likely to
   be a bullet somebody over-indented than a line of code. An earlier version of
   this comment claimed the three-space limit applied to the markers too, which
   was simply false — caught by a GPT Sol review, 2026-08-31. */
const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([^\s`]*)[ \t]*$/;
/* A CLOSING fence carries nothing but the fence. Reusing the opener's pattern
   let ```js close a block and deleted the `js` with it. Same review. */
const FENCE_CLOSE = /^ {0,3}(```+|~~~+)[ \t]*$/;
/* The closing run of hashes must be preceded by whitespace, and that guard is
   not pedantry: without it `# Learn C#` is a heading reading "Learn C". A GPT
   Sol review found it, 2026-08-31 — text the model wrote, deleted silently,
   which is the one thing this file is not allowed to do. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
/* Checked BEFORE the bullet rule, because `- - -` and `***` are both. */
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>[ \t]?/;
/* The space after the marker is required, and it is what keeps `**bold**` at
   the start of a paragraph from being read as a bullet: the character after the
   first `*` is another `*`, not whitespace. Same for `-` used as a dash. */
const BULLET = /^([ \t]*)([-*+])([ \t]+)(.*)$/;
const NUMBER = /^([ \t]*)(\d{1,9})[.)]([ \t]+)(.*)$/;

/** A line's list marker, if it has one. */
interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  /** Columns to strip from this item's continuation lines. */
  content: number;
  text: string;
}

/** Tabs count as one column here — good enough, and models write spaces. */
const width = (s: string): number => s.length;

function marker(line: string): Marker | null {
  if (RULE.test(line)) return null;
  const bullet = BULLET.exec(line);
  if (bullet) {
    const [, indent = "", , gap = "", text = ""] = bullet;
    return {
      indent: width(indent),
      ordered: false,
      number: 1,
      content: width(indent) + 1 + width(gap),
      text,
    };
  }
  const numbered = NUMBER.exec(line);
  if (numbered) {
    const [, indent = "", digits = "1", gap = "", text = ""] = numbered;
    return {
      indent: width(indent),
      ordered: true,
      number: Number(digits),
      content: width(indent) + digits.length + 1 + width(gap),
      text,
    };
  }
  return null;
}

const blank = (line: string): boolean => line.trim() === "";
/** How far a line is indented. A blank line is not indented at anything. */
const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Does this line begin a block that is not a paragraph? */
function starts(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    marker(line) !== null
  );
}

/**
 * An answer, as blocks.
 *
 * Splits on lines rather than on `\n{2,}`, which is what the panel did before
 * and is why a bullet list used to arrive as one paragraph reading
 * `- one - two - three`. Paragraph text keeps its own single newlines, so an
 * answer with no Markdown in it comes back exactly as it went in.
 */
export function parseBlocks(text: string): MdBlock[] {
  return parseLines(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

/**
 * How deep a quote inside a list inside a quote may go before we stop reading
 * structure and take the rest as text.
 *
 * Every nesting level is a recursive call, and `>`×6000 — which is not prose
 * but is one paste away — threw `RangeError: Maximum call stack size exceeded`.
 * In this panel that is not a bad answer, it is the conversation gone: the
 * render throws and the reader loses the thread they were reading. Six levels
 * is past anything a model writes and nowhere near the stack. Found by a GPT
 * Sol review, 2026-08-31.
 */
const MAX_DEPTH = 6;

function parseLines(lines: string[], depth: number): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      i = takeCode(lines, i, fence, out);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ kind: "heading", level: (heading[1] ?? "#").length, text: heading[2] ?? "" });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }
    /* Past the cap nothing is read as structure — the characters stay in a
       paragraph, exactly as the model wrote them. */
    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      i = takeQuote(lines, i, out, depth);
      continue;
    }
    if (marker(line) && depth < MAX_DEPTH) {
      i = takeList(lines, i, out, depth);
      continue;
    }
    i = takePara(lines, i, out);
  }
  return out;
}

/**
 * A fenced code block.
 *
 * **An unclosed fence is still a code block**, and that is not tolerance of bad
 * input — it is the streaming case. The opening fence arrives seconds before
 * the closing one, and a reader watching the answer land should see code
 * appearing in a code block, not three backticks and then a paragraph that
 * turns into one when the fence finally closes.
 */
function takeCode(lines: string[], from: number, fence: RegExpExecArray, out: MdBlock[]): number {
  const open = fence[1] ?? "```";
  const char = open[0] ?? "`";
  const body: string[] = [];
  let i = from + 1;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const close = FENCE_CLOSE.exec(line);
    if (close && (close[1] ?? "").startsWith(char) && (close[1] ?? "").length >= open.length) {
      i++;
      break;
    }
    body.push(line);
    i++;
  }
  out.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
  return i;
}

/** Consecutive `>` lines, with the marker stripped and the rest parsed again. */
function takeQuote(lines: string[], from: number, out: MdBlock[], depth: number): number {
  const body: string[] = [];
  let i = from;
  while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
    body.push((lines[i] ?? "").replace(QUOTE, ""));
    i++;
  }
  out.push({ kind: "quote", blocks: parseLines(body, depth + 1) });
  return i;
}

/**
 * One list, and everything indented under it.
 *
 * An item's content is every following line indented past the marker, plus
 * blank lines that are followed by more of the same. That content is parsed
 * again, which is what makes a nested list nest and a two-paragraph item hold
 * two paragraphs — and it terminates, because each recursion strips at least
 * one column of indent.
 *
 * A line that is neither indented nor another item **ends the list**. That is
 * CommonMark's "lazy continuation" refused on purpose: a model that writes a
 * bullet list and then a closing sentence at column zero means the sentence to
 * be a paragraph, and reading it as more of the last bullet is the mistake a
 * reader notices.
 */
function takeList(lines: string[], from: number, out: MdBlock[], depth: number): number {
  const first = marker(lines[from] ?? "");
  if (!first) return takePara(lines, from, out);
  const { indent, ordered } = first;
  const items: MdBlock[][] = [];
  let item: string[] = [];
  /* The column this item's own text starts at. It is what separates a sibling
     from a child: `- outer` puts its text at column 2, so `  - inner` — which
     starts AT that column — is inside the item, and `- next`, which starts
     before it, is the next item. Getting this wrong is not a subtle bug; it
     flattens every nested list a model writes into one flat one. */
  let content = first.content;
  let i = from;

  const close = () => {
    if (item.length > 0) items.push(parseLines(item, depth + 1));
    item = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      /* A blank line only stays inside the list if the list continues under
         it; otherwise it is the gap before whatever comes next.

         Scanned with an index rather than `lines.slice(i + 1).find(...)`. The
         slice copied the whole remaining answer for EVERY blank line, which is
         quadratic — and this parser runs again on every streamed token, so the
         cost was paid per token too. 8,000 blank lines took 665ms. */
      let j = i + 1;
      while (j < lines.length && blank(lines[j] ?? "")) j++;
      const next = j < lines.length ? lines[j] : undefined;
      if (next === undefined || !(indentOf(next) > indent || sibling(next, ordered, content))) break;
      /* One blank line stands for the whole run of them — a paragraph break
         inside the item is a paragraph break however many times it is written —
         and `i` jumps to the end of the run rather than stepping through it, so
         the scan above happens once per gap rather than once per line. */
      item.push("");
      i = j;
      continue;
    }
    const here = marker(line);
    if (here && sibling(line, ordered, content)) {
      close();
      content = here.content;
      item.push(line.slice(here.content));
      i++;
      continue;
    }
    if (indentOf(line) > indent) {
      // Strip this item's text column, and no more of the line than that.
      item.push(line.slice(Math.min(indentOf(line), content)));
      i++;
      continue;
    }
    break;
  }
  close();
  out.push({ kind: "list", ordered, start: first.number, items });
  return i;
}

/**
 * Another item of *this* list, rather than one nested inside its current item.
 *
 * Same kind of marker, and starting **before** the column the current item's
 * own text starts at. A marker at or past that column belongs to the item.
 */
function sibling(line: string, ordered: boolean, content: number): boolean {
  const m = marker(line);
  return m !== null && m.ordered === ordered && m.indent < content;
}

/** Everything up to a blank line or the start of some other block. */
function takePara(lines: string[], from: number, out: MdBlock[]): number {
  const body: string[] = [];
  let i = from;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) break;
    if (i > from && starts(line)) break;
    body.push(line);
    i++;
  }
  /* Trailing whitespace only. `trim()` also took the LEADING spaces, which are
     invisible in ordinary HTML and are not here: `.chat-turn.model p` is
     `pre-wrap`, so an indented line the model wrote was being straightened
     without anybody deciding to. */
  const text = body.join("\n").replace(/\s+$/, "");
  if (text !== "") out.push({ kind: "para", text });
  return i;
}
