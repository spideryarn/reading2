/**
 * **The few lines at the top of a Help page's Markdown file**, read without a
 * library: a `---` line, `key: value` lines, a `---` line, then the body.
 *
 * ```
 * ---
 * title: Reading the spine
 * summary: What the strip down the left edge shows, and how to read its marks.
 * keywords: heat thick line darker rail sidebar minimap
 * ---
 * ```
 *
 * Not YAML, on purpose. A value is the rest of its line, taken as it is: no
 * quotes to strip, no lists, no nesting, so a title with a colon or a question
 * mark in it needs nothing done to it. The files are ours, so everything
 * unexpected **throws** rather than being tolerated: a missing key, a key
 * nobody declared, a key given twice. tests/help-page.test.tsx renders every
 * file, so a throw here is a red test and not a blank page.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § The Markdown, and how it becomes a page.
 *
 * No React and no imports, so the tables (help-pages.ts) stay plain data.
 */

/** What one kind of file must say, and what it may. */
export interface FrontMatterShape<R extends string, O extends string> {
  required: readonly R[];
  optional: readonly O[];
}

export type FrontMatter<R extends string, O extends string> = Record<R, string> & Partial<Record<O, string>>;

const FENCE = "---";

/**
 * Split a file into its front matter and its body. `name` is only for the
 * message when something is wrong, so the error says which file.
 */
export function readFrontMatter<R extends string, O extends string>(
  raw: string,
  shape: FrontMatterShape<R, O>,
  name: string,
): { meta: FrontMatter<R, O>; body: string } {
  /* A file saved on Windows, or checked out with autocrlf, is the same file. */
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== FENCE) throw new Error(`Help page ${name}: the first line must be ---`);
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) throw new Error(`Help page ${name}: the front matter is never closed with ---`);

  const allowed: ReadonlySet<string> = new Set([...shape.required, ...shape.optional]);
  const found = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`Help page ${name}: front matter line is not "key: value": ${line}`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!allowed.has(key)) throw new Error(`Help page ${name}: unknown front matter key "${key}"`);
    if (found.has(key)) throw new Error(`Help page ${name}: front matter key "${key}" appears twice`);
    /* An empty value is a key somebody meant to fill in. */
    if (value === "") throw new Error(`Help page ${name}: front matter key "${key}" is empty`);
    found.set(key, value);
  }
  for (const key of shape.required) {
    if (!found.has(key)) throw new Error(`Help page ${name}: front matter is missing "${key}"`);
  }
  return {
    meta: Object.fromEntries(found) as FrontMatter<R, O>,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  };
}

/**
 * **`related: spine, mode-structure`** as a list. The ids are checked against
 * the live anchors by whoever knows them (help-pages.ts § relatedAnchors);
 * this only splits.
 */
export function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
