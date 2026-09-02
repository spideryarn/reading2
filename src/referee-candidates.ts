/**
 * **Candidates — who could review this paper, for an editor.**
 *
 * Referee mode's fourth sub-mode, and the only one that is not the referee's own
 * question: it answers an *editor's*. Greg overruled the plan's own cut of it on
 * 2026-08-31, and then said the next morning how it should work, which is what
 * makes it small:
 *
 * > The candidates search should allow for an extra and flexible prompt to scope
 * > the web search, which could be anything from criteria to names to
 * > emphasize/exclude, or something else. Probably this should be a special
 * > reuse of Chat mode, to get access to tools and make it interactive and
 * > potentially multiple messages back and forth.
 * >
 * > — Greg, 2026-09-01
 *
 * So it is **Chat**, not a bespoke panel: `candidates` is a third `ThreadKind`
 * beside `chat` and `remember` (src/types.ts), which buys streaming, the tools,
 * OpenRouter's server-side web search, citation collection, thread persistence,
 * retry and the whole store for nothing. What lives here is the part chat cannot
 * supply — **the shortlist, and the four rules it is under**.
 *
 * ## This file is the enforcement, not the prompt
 *
 * The prompt is in src/referee-candidates-prompt.ts and is asked for things. A
 * prompt is a wish; every rule below is a line of code that drops a row, and the
 * panel prints how many it dropped and why, because a shortlist that silently
 * shrank is exactly the failure docs/reusable/silent-success.md is about.
 *
 *  1. **No name without a source link the web search actually returned.**
 *     `readShortlist` is given the URLs OpenRouter's own annotations reported
 *     *up to that answer*, and a candidate whose `sources` meet none of them is
 *     dropped. Not "a URL that parses" — `isWebUrl` is necessary and nowhere near
 *     sufficient, since a plausible name beside a real-looking address is
 *     precisely what a model produces well. The **title** shown beside a source
 *     comes from the search result rather than from the model, for the same
 *     reason. And the rule governs **the screen and not the JSON**: a name the
 *     validator refused is cut out of the prose too, by `redactNames`, because a
 *     rule the reader can read straight past is not a rule.
 *  2. **The paper's own authors are excluded.** `authorKeys` reads the byline
 *     and `readShortlist` drops any candidate matching one. This is the one call
 *     in Referee mode that legitimately sees the byline — a stated exception to
 *     the mode's identity-stripping rule (docs/project/referee-mode.md, rule 4),
 *     written here rather than left to be discovered in a diff. See `authorKeys`
 *     for what it does *not* catch, which the panel says out loud.
 *  3. **Every candidate says which fit-requirement it answers, and links the
 *     passage behind it.** A row with no requirement, or with a block id this
 *     paper does not have, is dropped rather than shown unanchored — the mode's
 *     rule 2, and the reason the fit brief exists at all.
 *  4. **Conflict of interest is two different things and the panel must not blur
 *     them.** `COI_NOT_CHECKED` is the sentence, and it is a value here so that
 *     tests/referee-copy-is-about-the-model.test.ts can be right about the words.
 *     Half of what publishers name — co-authorship inside a 3–5 year window, no
 *     two of them agreeing on the number; shared current institution; joint
 *     grants — is mechanically checkable from OpenAlex or ORCID, and **we check
 *     none of it, because we have no identity graph**. The other half —
 *     advisor/advisee, rivalry, informal collaboration — is not automatable by
 *     anybody, and is what the conversation is for.
 *
 * ## Why the shortlist is parsed out of the transcript
 *
 * The research says people *like* chat and *perform worse* with it on comparison
 * tasks, which is exactly what choosing between candidates is
 * (docs/research/260831e-helping-peer-reviewers/editors-and-finding-reviewers.md
 * § 7). So the conversation steers and a list is what you look at — but the list
 * is derived from the transcript rather than stored beside it, because a second
 * store would be a second thing to keep in step with a conversation that can be
 * retried, edited and truncated. The newest answer that carries a fenced block
 * wins, so "each turn revises the shortlist" is a property of reading rather than
 * of writing.
 *
 * This module imports `types.js` and `urls.js` and nothing else, so the browser
 * can run the same validation the transcript was written under — the arrangement
 * `referee-criteria.js` and `referee-claims.js` are already on the client-import
 * allowlist for.
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4.
 */
import type { BlockId, Citation } from "./types.js";
import { isWebUrl } from "./urls.js";

/**
 * The fence the model closes an answer with when it has names.
 *
 * Exported so the prompt in src/referee-candidates-prompt.ts interpolates it
 * rather than spelling it a second time: a parser and a prompt that disagree
 * about one word produce an answer with a shortlist in it and a panel that says
 * nobody has been named.
 */
export const SHORTLIST_FENCE = "candidates";

/** At most this many rows, whatever arrives. A cap, not a target — see the prompt. */
export const MAX_CANDIDATES = 40;

/** At most this many source links per candidate. */
export const MAX_SOURCES = 4;

/**
 * One person the model has put forward, **after** every rule above has been
 * applied. There is no unvalidated shape: nothing constructs one of these except
 * `readShortlist`.
 */
export interface Candidate {
  /** As written. Rendered as text, never as markup. */
  name: string;
  /** Where the model says they are, if it said. Unverified, and labelled so. */
  affiliation?: string;
  /** Which fit-requirement this person answers, in the model's words. Never empty. */
  requirement: string;
  /** The passage in the paper that motivates that requirement. Checked against the article. */
  blockId: BlockId;
  /** Why this person, in a sentence. May be absent. */
  why?: string;
  /**
   * At least one, and every one a URL the web search returned in this
   * conversation. The `title` is the **search result's**, not the model's.
   */
  sources: Citation[];
}

/**
 * What was thrown away, by reason.
 *
 * Every field exists so a panel can say which of two very different things
 * happened: *the model named nobody* and *the model named eleven people and none
 * of them survived the rules*. Criteria shipped without that distinction and a
 * second cross-family review reopened it; Claims built it in from the start
 * (docs/project/referee-mode.md § 2). This is Claims' lesson, not Criteria's.
 */
export interface DroppedCandidates {
  /** No source link that the web search returned in this conversation. Rule 1. */
  uncited: number;
  /** One of the paper's own authors, by the byline. Rule 2. */
  authors: number;
  /** No fit-requirement, or a block id this paper does not have. Rule 3. */
  unanchored: number;
  /** Not an object with a usable name in it. */
  malformed: number;
  /** The same person twice in one list. */
  duplicate: number;
}

/** A shortlist and its losses. */
export interface Shortlist {
  candidates: Candidate[];
  dropped: DroppedCandidates;
  /**
   * **Every name in the block that is not on `candidates`** — refused by a rule,
   * or never read because the cap had already been reached.
   *
   * Here because the rules have to govern *the screen*, not the JSON. A
   * cross-family review on 2026-09-01 found the hole: the validator dropped six
   * names and the panel then rendered the same six out of the surrounding prose,
   * so "no name without a source" was true of the shortlist and false of the
   * page the editor was reading. Knowing the refused names by their exact
   * strings is what lets `redactNames` cut them out without guessing at what a
   * name looks like — see it for the residual hole and why this is not a
   * heuristic.
   */
  refused: string[];
  /** Rows past `MAX_CANDIDATES` that were never read at all. Never silent — see the panel. */
  omitted: number;
}

const NO_DROPS: DroppedCandidates = {
  uncited: 0,
  authors: 0,
  unanchored: 0,
  malformed: 0,
  duplicate: 0,
};

/** Did anything at all get thrown away? */
export function anyDropped(d: DroppedCandidates): boolean {
  return d.uncited + d.authors + d.unanchored + d.malformed + d.duplicate > 0;
}

/* ------------------------------------------------------------ the fence -- */

/**
 * Every fenced shortlist in one answer, opening index and body.
 *
 * `m` and `s` are deliberately absent: the fence is line-anchored, and a stray
 * ```` ``` ```` inside a JSON string would be an escaped one, which this regex
 * cannot be fooled by because the closing fence must start a line.
 */
const FENCE = new RegExp(`(^|\\n)\`\`\`${SHORTLIST_FENCE}[^\\n]*\\n([\\s\\S]*?)(\`\`\`|$)`, "g");

/**
 * The prose, with the shortlist block taken out.
 *
 * **Handles an unclosed fence**, because that is what a streaming answer looks
 * like for the second or two it takes the JSON to arrive: everything from the
 * opening fence to the end of the text goes, so the reader never watches raw
 * JSON scroll past and then vanish. The alternative — render it and hide it when
 * it closes — is a panel that shows an unvalidated claim about a named person,
 * which is the one thing this whole module exists to stop.
 */
export function withoutShortlist(text: string): string {
  return text.replace(FENCE, "$1").trimEnd();
}

/**
 * The shortlist in one answer, or `null` if it carries none.
 *
 * The **last** complete fence wins, so a model that thinks aloud and then
 * corrects itself is read as having corrected itself. `null` and an empty list
 * are different answers and the panel says different things about them.
 */
export function readShortlist(
  text: string,
  opts: {
    /** Every URL OpenRouter's annotations reported in this conversation. Rule 1. */
    allowed: Map<string, Citation>;
    /** Every block id this paper has. Rule 3. */
    blockIds: ReadonlySet<string>;
    /** The paper's own authors, from `authorKeys`. Rule 2. */
    authors: ReadonlySet<string>;
  },
): Shortlist | null {
  const body = lastClosedFence(text);
  if (body === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    /* A fence that arrived and could not be read is **not** "no shortlist": the
       model tried to name people and we could not tell who. One malformed row
       says so, rather than the panel saying nobody was named. */
    return { candidates: [], dropped: { ...NO_DROPS, malformed: 1 }, refused: [], omitted: 0 };
  }
  if (!Array.isArray(raw)) {
    return { candidates: [], dropped: { ...NO_DROPS, malformed: 1 }, refused: [], omitted: 0 };
  }

  const dropped = { ...NO_DROPS };
  const candidates: Candidate[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();
  let omitted = 0;

  for (const [i, item] of raw.entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    if (candidates.length >= MAX_CANDIDATES) {
      /* **The cap is counted, not merely applied.** Stopping at forty and saying
         nothing would make position a ranking in a feature built to have none —
         and it is the shape docs/reusable/silent-success.md is about. The tail
         is refused as well as counted, because a name the cap swallowed is still
         a name the panel must not let the prose show. */
      omitted = raw.length - i;
      for (const tail of raw.slice(i)) {
        const name = str((tail as Record<string, unknown> | null | undefined)?.name);
        if (name !== "") refused.push(name);
      }
      break;
    }
    const verdict = readCandidate(row, opts, seen);
    if (typeof verdict === "string") {
      dropped[verdict]++;
      const name = str(row.name);
      if (name !== "") refused.push(name);
      continue;
    }
    const key = nameKey(verdict.name);
    if (key !== null) seen.add(key);
    candidates.push(verdict);
  }

  return { candidates, dropped, refused, omitted };
}

/**
 * The body of the **last closed** fenced shortlist in an answer, or `null`.
 *
 * Last, so a model that thinks aloud and then corrects itself is read as having
 * corrected itself. **Closed**, because an unclosed fence is a shortlist still
 * arriving: reading it would be reading half a JSON document, `JSON.parse` on
 * half a document throws, and the honest thing to leave on screen meanwhile is
 * the previous turn's list.
 */
function lastClosedFence(text: string): string | null {
  let body: string | null = null;
  for (const m of text.matchAll(FENCE)) {
    if (m[3] !== "```") continue;
    body = m[2] ?? "";
  }
  return body;
}

/**
 * **One row against all four rules** — the candidate, or the reason it is not
 * shown.
 *
 * A discriminated return rather than a boolean and an out-parameter, so that
 * *why* a row was dropped cannot be lost on the way back: every rejection names
 * a field of `DroppedCandidates`, which is what the panel prints. A row that
 * fell through without incrementing anything would be a name that vanished with
 * nothing said, which is the whole failure this module is built against.
 *
 * **Rule 2 is tested before anything else about the row is considered.**
 * Cheapest-first is not the reason; the reason is that an author is a row we
 * must not show whatever else is right about it, and putting the test last is
 * how a later edit reorders it behind an early return that skips it.
 */
function readCandidate(
  row: Record<string, unknown>,
  opts: {
    allowed: Map<string, Citation>;
    blockIds: ReadonlySet<string>;
    authors: ReadonlySet<string>;
  },
  seen: ReadonlySet<string>,
): Candidate | keyof DroppedCandidates {
  const name = str(row.name);
  if (name === "") return "malformed";

  const key = nameKey(name);
  if (key !== null && opts.authors.has(key)) return "authors";

  /* Rule 3. Both halves, and both are code: a requirement nobody wrote and a
     block id this paper does not have are the same failure — a name with
     nothing behind it. */
  const requirement = str(row.requirement);
  const blockId = str(row.blockId);
  if (requirement === "" || !opts.blockIds.has(blockId)) return "unanchored";

  // Rule 1. See `readSources` below, which is where the rule lives.
  const sources = readSources(row.sources, opts.allowed);
  if (sources.length === 0) return "uncited";

  if (key !== null && seen.has(key)) return "duplicate";

  const affiliation = str(row.affiliation);
  const why = str(row.why);
  return {
    name,
    ...(affiliation === "" ? {} : { affiliation }),
    requirement,
    blockId: blockId as BlockId,
    ...(why === "" ? {} : { why }),
    sources,
  };
}

/**
 * **Rule 1, on its own so that it can be read on its own.**
 *
 * The URL must be one the search *returned*, not one that parses. `isWebUrl` is
 * applied to the model's string first so that a `javascript:` or `data:` URL can
 * never be used as a map key — `citedUrls` cannot put one in the map, but a
 * lookup is not the place to be relying on that.
 *
 * What comes back is the **annotation's** `Citation`, never the model's: the
 * title a reader clicks is what the search result called itself.
 */
function readSources(raw: unknown, allowed: Map<string, Citation>): Citation[] {
  const sources: Citation[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (sources.length >= MAX_SOURCES) break;
    const url = str(item);
    if (url === "" || !isWebUrl(url)) continue;
    const found = allowed.get(url);
    if (!found || sources.some((c) => c.url === found.url)) continue;
    sources.push(found);
  }
  return sources;
}

/** A trimmed string, or `""` for anything that is not one. */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* --------------------------------------------- the rule at the screen edge -- */

/**
 * What stands where a refused name stood.
 *
 * A value rather than a literal in the panel so
 * tests/referee-copy-is-about-the-model.test.ts can be right about the words,
 * and deliberately **not** bracketed: `[…]` immediately followed by a `(` is a
 * markdown link, and the commonest thing after a person's name in this prose is
 * a parenthesis.
 */
export const NAME_NOT_SHOWN = "(name not shown)";

/**
 * **Rule 1 applied to the prose, which is the only boundary that matters.**
 *
 * `withoutShortlist` hides the JSON; it does not hide the *names*. A model that
 * lists eleven people in the fence and introduces the same eleven in the
 * paragraph above it defeats every rule in this file, because the panel renders
 * that paragraph. That is exactly what happened: the first live run put six
 * names on screen beside an empty validated shortlist, and the test named "a
 * name reaches the screen only with a source" could not see it, because its
 * rejected candidate existed only inside the hidden fence.
 *
 * So the prose is rendered through here. Every name in `refused` — every name
 * the block put forward that is not a shown row, for **any** reason including
 * the cap — is cut out of the text, in full and by surname, and `NAME_NOT_SHOWN`
 * stands in its place. The editor keeps the paragraph, which is the point of the
 * sub-mode: what was searched, which subfields were covered, why somebody fits.
 * They just cannot read a name the rules refused.
 *
 * ## Why exact strings and not a name detector
 *
 * Because the refused names are **known**. They came out of the same JSON the
 * validator read, so no guess is needed about what a person's name looks like in
 * running text — and a detector that guessed would have to choose between
 * cutting "Item Response Theory" out of the fit brief and letting "Ada Kessler"
 * through, both of which are worse than this.
 *
 * **The residual hole, stated rather than discovered later:** a name the model
 * writes in prose and leaves *out* of the fence entirely is not known here and
 * is not cut. `CANDIDATES_SYSTEM` now forbids names in prose outright — the
 * shortlist block is the only place they belong — so this is the model
 * disobeying rather than the design allowing it, but it is a wish and not a
 * check, and closing it needs either an identity graph or an app-owned search
 * seam. See docs/project/referee-mode.md § Candidates.
 *
 * A surname is cut on its own too, since "Kessler has published…" is how a
 * second mention reads — but never one that a **shown** candidate also has, so
 * an accepted Kessler is not blanked by a refused one.
 */
export function redactNames(
  prose: string,
  refused: readonly string[],
  shown: readonly Candidate[],
): string {
  if (refused.length === 0 || prose === "") return prose;

  const keep = new Set<string>();
  for (const c of shown) {
    const s = surnameOf(c.name);
    if (s !== null) keep.add(s.toLowerCase());
  }

  let out = prose;
  /* Longest first, so "Ada Kessler" is cut before a bare "Kessler" can eat half
     of it and leave "Ada (name not shown)". */
  const full = [...new Set(refused)].filter((n) => n !== "").sort((a, b) => b.length - a.length);
  for (const name of full) out = cut(out, name.split(/\s+/), NAME_NOT_SHOWN);

  const surnames = new Set<string>();
  for (const name of full) {
    const s = surnameOf(name);
    if (s !== null && !keep.has(s.toLowerCase())) surnames.add(s);
  }
  for (const s of surnames) out = cut(out, [s], NAME_NOT_SHOWN);
  return out;
}

/**
 * Replace every whole-word occurrence of `parts` (whitespace-flexible) with
 * `with_`.
 *
 * `\\b` on both ends so "Frankfurt" survives a refused "Frank", and `\\s+`
 * between parts so a name that wrapped across a line is still one name. Each
 * part is escaped: a model may write "Jane O'Neill (Ph.D.)" and a raw `.` in a
 * pattern matches anything.
 *
 * Case-insensitive but **not** diacritic-folded, unlike `nameKey`: a name spelt
 * "Zugaro" in the block and "Zugaró" in the prose is not cut. Folding would mean
 * rebuilding the haystack, and the two spellings come out of the same answer, so
 * they agree in practice.
 */
function cut(text: string, parts: readonly string[], with_: string): string {
  const escaped = parts
    .filter((p) => p !== "")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return text;
  const body = escaped.join("\\s+");
  /* `\b` only works next to a word character. A name ending in `.` — "Ada K." —
     would make the trailing `\b` demand one, so it is conditional on the last
     character being wordy. */
  const head = /^\w/.test(parts[0] ?? "") ? "\\b" : "";
  const tail = /\w$/.test(parts.at(-1) ?? "") ? "\\b" : "";
  return text.replace(new RegExp(`${head}${body}${tail}`, "gi"), with_);
}

/**
 * The surname of a written name, **as written** — the part `nameKey` folds, but
 * un-folded, because this one goes into a pattern matched against the model's
 * own prose.
 */
function surnameOf(raw: string): string | null {
  const parts = raw.split(/\s+/).filter((p) => p !== "");
  for (let i = parts.length - 1; i > 0; i--) {
    const cleaned = (parts[i] ?? "").replace(/[^\p{L}'-]/gu, "");
    if (cleaned.length > 1) return cleaned;
  }
  return null;
}

/* ------------------------------------------------------- the URLs allowed -- */

/**
 * **The URLs a shortlist may cite**, gathered from the conversation's own
 * citations.
 *
 * `Citation` is what OpenRouter's `annotations` reported and `collectCitations`
 * kept (src/openrouter-stream.ts), so this really is *what the search returned*
 * rather than what the model wrote. `isWebUrl` again here because the map is
 * also a gate: nothing that is not http(s) may become a source, whichever side
 * it came from.
 *
 * ## Give this the messages **up to and including** the answer being validated
 *
 * Not the whole thread. It is still more than one answer — the model re-emits
 * the whole shortlist each turn, so a person found in turn two is still in turn
 * five's fence long after turn five's own searches have moved on, and scoping to
 * a single answer would count the earlier half of every long list as uncited.
 * But a citation from a **later** answer must not reach an earlier one, or a
 * search run at turn five retroactively validates a name written at turn two,
 * which is a rule that passes by waiting. `latestShortlist` in
 * src/web/CandidatesPanel.tsx is the caller and does the slicing; a cross-family
 * review found the unsliced version on 2026-09-01.
 *
 * ## What this proves, and what it does not
 *
 * It proves the URL came back from a search in this conversation. It does **not**
 * prove the page is about the person it is filed under: a hallucinated name can
 * be paired with a real URL from an earlier search and pass. Closing that needs
 * the result's own title and snippet stored beside the URL and the name matched
 * against them — feasible now that the wire supplies both (see below), but it
 * needs `Citation` to carry a snippet, which is a change in src/types.ts and
 * src/openrouter-stream.ts. docs/project/referee-mode.md § Candidates.
 *
 * ## Where the evidence comes from, measured on the wire 2026-09-01
 *
 * The **engine** decides whether this rule has anything to check, and the first
 * live run of Candidates found that out the hard way: four searches, six
 * well-sourced people, **zero** annotations, all six dropped here as uncited.
 * With the default engine the search runs inside Anthropic and OpenRouter emits
 * a `url_citation` only where the model attributes a result *in its prose*, so
 * the supply of the evidence depended on an instruction the model could ignore.
 *
 * A wire probe settled it. Same prompt both ways — two searches, and an answer
 * told to reply with the single word `DONE` and no attribution at all:
 *
 * - default engine (`max_uses`/`max_results`): 2 searches, **0 annotations**.
 * - `engine: "exa"`: 2 searches, **9 annotations**, every one of them arriving
 *   *before the first content token*, with `start_index === end_index === 0`,
 *   and each carrying `url`, `title` and a 250–5,300 character `content`
 *   extract of the page.
 *
 * So under Exa the results are delivered at search time and not at attribution
 * time, which is what makes rule 1 a check rather than a hope. `webSearchTool`
 * in src/converse.ts asks for that engine on Candidates turns for this reason
 * and no other.
 */
export function citedUrls(
  messages: readonly { role: string; citations?: Citation[] }[],
): Map<string, Citation> {
  const out = new Map<string, Citation>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.citations ?? []) {
      if (!isWebUrl(c.url) || out.has(c.url)) continue;
      out.set(c.url, c);
    }
  }
  return out;
}

/* ------------------------------------------------------------- the authors -- */

/**
 * **The paper's own authors, as comparison keys** — surname plus first initial.
 *
 * Loose on purpose in one direction and tight in the other. "Jane Doe", "Jane Q.
 * Doe", "J. Doe" and "Doe, Jane" all reduce to `doe|j`, so a candidate written
 * any of those ways is caught; "John Doe" does not, so an unrelated namesake is
 * not thrown away. Surname alone would drop every Smith in the field, which is a
 * worse failure than the one it prevents, because the editor never learns it
 * happened.
 *
 * ## What it does not catch, which the panel says out loud
 *
 * It reads `meta.byline` and that is all it has. A PDF ingested with no byline
 * has nothing to compare against; a preprint whose authors appear only as prose
 * on its title page has nothing here either. So the code half of rule 2 is
 * "excluded by name against the byline this app recorded", and the panel prints
 * which byline that was — or that there was none — rather than implying a filter
 * ran over the paper's real authorship. The prompt is separately told to exclude
 * anybody the paper presents as an author, and that half is a wish; this half is
 * the check.
 *
 * Two shapes of byline are read, because both are common and they disagree about
 * what a comma means: `"Doe, Jane"` (one person, surname first) and `"Jane Doe,
 * John Smith"` (two people). A segment is read surname-first only when both
 * sides of its single comma are short — the shape a list of full names never
 * has.
 */
export function authorKeys(byline: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!byline) return out;
  /* `and`, `&`, `;` and newlines split people. A comma might, and is decided per
     segment below. `with` is deliberately not a separator: "with photographs by
     …" is not an author list, and reading it as one would exclude somebody for
     no reason. */
  for (const segment of byline.split(/;|\n|&|\bwith\b|\band\b/i)) {
    const trimmed = segment.trim();
    if (trimmed === "") continue;
    const commas = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
    if (commas.length === 2 && words(commas[0] ?? "") <= 2 && words(commas[1] ?? "") <= 2) {
      /* "Doe, Jane" — surname first. `nameKey` wants given-name-first, so the
         halves are swapped before it sees them. */
      const key = nameKey(`${commas[1]} ${commas[0]}`);
      if (key !== null) out.add(key);
      continue;
    }
    for (const one of commas) {
      const key = nameKey(one);
      if (key !== null) out.add(key);
    }
  }
  return out;
}

/** How many whitespace-separated words a string has. */
function words(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/**
 * `"Jane Q. Doe"` → `"doe|j"`, and `null` for anything with fewer than two
 * name-shaped parts.
 *
 * `null` rather than a one-part key, because "Anonymous", "The Editors" and a
 * mangled byline would otherwise all become keys that a candidate could
 * accidentally match. A rule that cannot be sure declines to exclude, which is
 * the safe direction here: showing one extra name costs an editor a glance, and
 * silently withholding the right person costs them the reviewer.
 *
 * Diacritics are folded, so `Müller` and `Muller` are one person.
 *
 * **The surname is the last part with more than one letter in it**, which is
 * loose in a way worth stating: "Eva van der Berg" reduces to `berg|e` and so
 * would "Eva Berg". That is the safe direction — a slightly wider net catches
 * the author written without their particle, and the initial still keeps it off
 * everybody else's Berg.
 *
 * **An initial counts as a part.** It has to: a first draft required two parts
 * of more than one letter, and `nameKey("A. Kessler")` was therefore `null`, so
 * an author the model wrote as "A. Kessler" walked straight past rule 2. The
 * test for it went red on the first run. What is refused is a name whose only
 * full word is the *first* one — "Ada K." — because there is nothing there to
 * tell a surname from a given name, and a rule that cannot be sure declines to
 * exclude.
 */
export function nameKey(raw: string): string | null {
  const folded = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const parts = folded.split(/[^a-z]+/).filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  let surnameAt = -1;
  for (let i = parts.length - 1; i > 0; i--) {
    if ((parts[i] ?? "").length > 1) {
      surnameAt = i;
      break;
    }
  }
  if (surnameAt < 1) return null;
  /* The first *letter* of the first part, initial or not, so "A. Kessler" and
     "Ada Kessler" agree. */
  const initial = (parts[0] ?? "").charAt(0);
  if (initial === "") return null;
  return `${parts[surnameAt]}|${initial}`;
}

/* -------------------------------------------------------------- the copy -- */

/**
 * **The opening ask, sent when the thread is created — which is when the editor
 * presses *Build the reviewer brief*.**
 *
 * It was sent automatically, from a `useEffect` the first time the sub-mode was
 * opened, until 2026-09-02: a first-time referee clicking through the four
 * chips paid for a run and sent paper-derived terms to a search engine without
 * having asked for either. Now the press creates the thread and this is what it
 * sends. Nothing here has run until it is pressed — src/web/CandidatesPanel.tsx
 * § `StartBrief` — and coming back to a stored thread starts nothing.
 *
 * The thread still opens with the fit brief before the editor has typed
 * anything else, because that half has no hallucinated-person failure mode: it
 * is a statement
 * about what the paper demands of a reader, every requirement anchored to the
 * passage that motivates it. It is useful on its own and it is the query the
 * conversation then refines — so if the names layer disappoints, this still
 * stands. docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4.
 *
 * A real user message rather than a synthetic assistant one, and that is the
 * honest shape: something *was* asked, this is it, and the transcript says so.
 * Inventing an assistant turn nobody asked for would put words in the model's
 * mouth in a store whose whole job is to be what was said.
 */
export const CANDIDATES_OPENING =
  "Start with the fit brief: what expertise would a competent reviewer of this paper need? " +
  "No names yet.";

/**
 * What this panel has not checked, and cannot.
 *
 * A value rather than a string in the panel so that
 * tests/referee-copy-is-about-the-model.test.ts can be right about the words —
 * the arrangement `NO_PASSAGE_FOUND` in src/referee-claims.ts already uses.
 *
 * The wording is the research's own division and it matters that the two halves
 * stay in one sentence each: presenting an algorithmic pass as though it caught
 * everything is the specific move the editor research says editors already
 * distrust (§ 2), and saying nothing at all reads as a filter that ran.
 */
export const COI_NOT_CHECKED =
  "No conflict-of-interest check has run. Co-authorship, a shared institution and joint grants " +
  "are checkable from public data — this app checks none of them, because it has no scholarly " +
  "identity graph. Advisor and advisee, rivalry and informal collaboration are not checkable by " +
  "anybody, and are what this conversation is for: say who to leave out.";

/** Whose list this is, said before anybody reads it as a ranking. */
export const INDEXING_SKEW =
  "This list leans towards people the web indexes well, and is ordered by fit and evidence rather " +
  "than by prominence. Ask for more names than you need: invitation acceptance runs at about 36% " +
  "and roughly one accepted review in four is never delivered.";

/** Rule 2's code half, when there is a byline to run it against. */
export function excludedByByline(byline: string): string {
  return `The paper's own authors are excluded by name, against the byline this app recorded — ${byline}. Anyone named as an author only inside the paper's text is not caught by that check.`;
}

/** Rule 2's code half, when there is not. */
export const NO_BYLINE_TO_EXCLUDE =
  "This paper has no byline recorded, so no author exclusion could be run in code. The model was " +
  "asked to leave the paper's own authors out; nothing here checked that it did.";

/**
 * The model has not put any names forward yet.
 *
 * A different sentence from `ALL_DROPPED` above, and the pair is the same
 * three-states discipline Claims built in from the start: *nobody was named* and
 * *people were named and none could be shown* call for different actions from
 * the editor, so they must not be one sentence.
 */
export const NO_NAMES_YET =
  "No names yet. Ask for candidates once the fit brief looks right, and say what to scope the " +
  "search to — a subfield, a method, people to leave out.";

/**
 * It named people and none of them survived the rules.
 *
 * **The model is the subject**, as it is in every Referee null state — the rule
 * tests/referee-copy-is-about-the-model.test.ts exists for. The temptingly
 * shorter sentence here is "no suitable reviewers were found", which is a claim
 * about *the field* that this app has no standing whatever to make: what
 * happened is that a model wrote some names down and the rules could not stand
 * any of them up.
 */
export const ALL_DROPPED =
  "The model named people and none of them could be shown. What was dropped, and why, is below.";
