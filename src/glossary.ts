/**
 * Pipeline stage 5d — the **glossary**: the terms this piece uses in a
 * non-obvious way, defined from the piece itself.
 *
 *   npm run glossary -- data/writes
 *
 * [vision.md](docs/project/vision.md#where-this-goes-after-granularity-zoom)
 * has listed an *author's glossary* as a thing to build since the beginning.
 * The version this project is an offshoot of built one, and
 * docs/project/original-version/glossary.md is an account of what it got right
 * and the two bugs worth knowing about. Both of those bugs are answered here,
 * in code, and neither answer is the one they shipped:
 *
 *  - **Their extraction timed out on output tokens, not input tokens**, because
 *    every entry carries two explanations. So this asks for a bounded number of
 *    entries per call and appends on a second pass, feeding the existing names
 *    back so the model does not repeat itself. `passes` on the artefact counts
 *    them.
 *  - **Their dedup deleted the more specific term.** It kept whichever of
 *    `nonreductive` and `nonreductive explanation` appeared first in the
 *    document, which in practice threw away the better phrase and left the
 *    matcher hunting for the shorter, wronger one. Their own plan proposed a
 *    richness-scored normaliser instead; it was never built. `dedupe` below is
 *    that normaliser. See its docstring.
 *
 * **It is not part of a plain "add this URL".** `glossary` is in `STEP_ORDER`
 * so it sorts and so the API will accept the name, but `DEFAULT_INGEST_STEPS`
 * in src/pipeline.ts deliberately excludes it: a glossary costs a model call
 * and exists only for articles somebody asks for one for. Greg, 2026-08-25:
 * a button, on demand.
 *
 * **Nothing here marks up the prose on the model's initiative.** The original
 * put a dotted underline and a small book icon on every term, inline, on every
 * article. That is the prose acquiring marks the author did not write, which is
 * the small version of what vision.md § Principles refuses. The glossary is a
 * list you open; the underlines appear in the article only while the reader has
 * a term selected. See docs/project/glossary.md.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { partsOf } from "./arc.js";
import { mintUniqueId } from "./ids.js";
import { MODEL } from "./models.js";
import { hashBlocks } from "./source-hash.js";
import { formsOf, termAppears, termPattern } from "./term-match.js";
import { budgetFor, truncatedMessage } from "./token-budget.js";
import type {
  Block,
  BlockId,
  Glossary,
  GlossaryEntry,
  GlossaryKind,
  Meta,
  Tree,
} from "./types.js";

/**
 * Bumped whenever the prompt changes in a way that changes what an entry *is*.
 *
 * `glossary/2`, 2026-08-26: one blended `gloss` became `senseHere` and
 * `background` — see docs/plans/glossary-entries-worth-reading.md. Bumping it
 * is what marks every existing glossary stale, which is not a side effect but
 * the migration: the panel says so at the top and offers "Find them again".
 *
 * Exported so tests can assert against the current value rather than pin a
 * literal that has to be edited on every bump — a fixture that hardcodes the
 * version tests the fixture.
 */
export const PROMPT_VERSION = "glossary/2";

/**
 * The most entries one call may return.
 *
 * **Twenty is their number, and it was arrived at by a production outage rather
 * than by taste.** Their extraction hit 504s, and the cause was the size of the
 * answer, not the size of the article: every entry carries a short definition
 * and a longer explanation, so the output grows with the entry count and
 * nothing else. Capping the answer and paginating the work is the fix, and it
 * is the lesson that generalises past this feature —
 * docs/project/original-version/glossary.md § Bug one.
 *
 * Our token budget (src/token-budget.ts) is honest about the ceiling in a way
 * theirs was not, so this cap is no longer the only thing between us and a
 * truncated response. It is still the right shape: a glossary is a list that
 * can grow, so "twenty now, twenty more if you want them" costs nothing and a
 * single unbounded call would eventually meet an encyclopaedia of an article.
 */
export const BATCH_SIZE = 20;

/** The kinds we accept. Anything else the model invents becomes `other`. */
const KINDS: ReadonlySet<string> = new Set<GlossaryKind>([
  "person", "place", "organization", "event", "work", "concept", "term", "other",
]);

/**
 * How many entries to ask for.
 *
 * One per ~400 words, which on a normal essay lands somewhere in the low teens,
 * clamped at both ends. The floor stops a 600-word post being asked for two
 * terms and padding to reach them; the ceiling is `BATCH_SIZE` and the reason
 * for it is above.
 */
export function suggestedCount(words: number): number {
  return Math.min(BATCH_SIZE, Math.max(6, Math.round(words / 400)));
}

/**
 * A term reduced to the form two spellings of it have in common.
 *
 * Used only as a **comparison key** — nothing normalised here is ever shown or
 * stored. Case, curly quotes, runs of whitespace and edge punctuation are the
 * four ways the model returns "the same" term twice, and all four are noise.
 *
 * What it deliberately does **not** do is strip a leading "the", or stem, or
 * singularise. Each of those merges pairs that are genuinely different terms in
 * some article somewhere, and an over-eager normaliser is its own bug: their
 * first attempt merged entities that merely shared a synonym and silently lost
 * legitimate ones. Both directions fail quietly, so this one errs towards
 * keeping two entries that a person would have merged, which the reader can see
 * and a lost entry is not.
 */
export function normaliseTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

/**
 * How specific a name is — **the tie-break their plan specified and never
 * shipped.**
 *
 * Words first, then characters. `nonreductive explanation` beats
 * `nonreductive`; `United States of America` beats `America`.
 *
 * The rule this replaces was "keep whichever came first in the document", and
 * it is worth being precise about why that was not merely arbitrary: it was
 * *systematically* wrong. A general term is nearly always introduced before the
 * specific phrase built on it, so first-wins does not pick randomly between the
 * two — it reliably picks the vaguer one, and then the matcher underlines the
 * wrong words for the rest of the article.
 *
 * > **"Keep the first one" is not a tie-break, it's a coin toss.** It looked
 * > reasonable and it systematically destroyed the better data. Every dedup
 * > rule should be justified by what it keeps, not by what's convenient to
 * > write.
 * >
 * > — docs/project/original-version/glossary.md
 */
export function richness(name: string): [number, number] {
  const trimmed = name.trim();
  return [trimmed.split(/\s+/).filter(Boolean).length, trimmed.length];
}

function richer(candidate: string, incumbent: string): boolean {
  const [aw, ac] = richness(candidate);
  const [bw, bc] = richness(incumbent);
  if (aw !== bw) return aw > bw;
  return ac > bc;
}

/**
 * A URL we are willing to put in an `href`, or nothing.
 *
 * **This is a security check, not a tidy-up.** The panel renders `url` as a
 * link, and the string came out of a language model, so `javascript:alert(1)`
 * is a script injection with a very short path: model → JSON → `<a href>`. Two
 * schemes are allowed and everything else — `javascript:`, `data:`, `file:`,
 * and anything that will not parse at all — is dropped rather than shown
 * broken. docs/project/security.md § Two untrusted parties now has a third, and
 * this is where it is answered.
 *
 * Their record validated this too, with Zod's `.url()`, which accepts
 * `javascript:` — it only checks that the string parses as a URL. Copying the
 * field without copying the scheme check would have been the easy mistake.
 */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 0–1, or nothing. Anything outside the range is a model error, not a signal to clamp silently. */
function score(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

/** One entry as the model returns it, before any of it has been believed. */
interface RawEntry {
  name?: unknown;
  kind?: unknown;
  aliases?: unknown;
  senseHere?: unknown;
  background?: unknown;
  /* `glossary/1`'s two prose fields. Still read, because a model told to write
     the new shape occasionally writes the old one — the name it was trained on
     is a strong prior — and an entry is more useful in the wrong field than
     dropped. `toEntries` maps them on: `gloss` was a blend of the two new
     fields, and the honest place to put a blend is the one that claims less. */
  gloss?: unknown;
  detail?: unknown;
  url?: unknown;
  difficulty?: unknown;
  centrality?: unknown;
  fromOutside?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Turn what the model said into entries, believing as little of it as possible.
 *
 * **The drop rule is a name and at least one line of prose.** It used to be a
 * name and a `gloss`, and the change is forced rather than chosen: from
 * `glossary/2` on, either prose field may legitimately be absent — a coinage
 * needs no `background`, and a person simply quoted needs no `senseHere`, which
 * is the entire fix for the entry that prompted the rewrite. What cannot be
 * absent is *both*, because an entry with a name and nothing else says nothing
 * at all.
 *
 * Everything else degrades to a default rather than failing the batch. Thirty
 * good entries must not be lost because one came back with `centrality: "high"`.
 *
 * **A `glossary/1` answer still lands somewhere.** The model is asked for the
 * new fields and sometimes writes the old ones anyway; `gloss` is mapped to
 * `background` and `detail` is appended to it. `background` and not
 * `senseHere`, deliberately: the old `gloss` was a blend of the two, and the
 * panel labels `senseHere` "in this piece" — putting a blend there would
 * attribute the model's own knowledge to the article, which is the one
 * direction of error this design is built to avoid.
 */
function toEntries(raw: RawEntry[], taken: Set<string>): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const item of raw) {
    const name = text(item.name);
    const senseHere = text(item.senseHere);
    /* The old shape, folded in rather than dropped — see the docstring. Joined
       with a space and not a newline: nothing renders these as blocks, and a
       newline inside a paragraph is invisible in the panel and mangled in a
       `title` attribute. */
    const background = [text(item.background), text(item.gloss), text(item.detail)]
      .filter(Boolean)
      .join(" ");
    if (!name || (!senseHere && !background)) continue;

    const kindText = text(item.kind).toLowerCase();
    const kind = (KINDS.has(kindText) ? kindText : "other") as GlossaryKind;

    /* Aliases that repeat the name buy nothing — `termPattern` already includes
       the name — and an alias that is only the name in different case would
       make the panel look like it is stuttering. Compared on the normalised
       key, kept in the model's own spelling. */
    const seen = new Set<string>([normaliseTerm(name)]);
    const aliases: string[] = [];
    for (const alias of Array.isArray(item.aliases) ? item.aliases : []) {
      const value = text(alias);
      const key = normaliseTerm(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push(value);
    }

    const url = safeUrl(item.url);
    const difficulty = score(item.difficulty);
    const centrality = score(item.centrality);

    out.push({
      id: mintUniqueId(taken),
      name,
      kind,
      aliases,
      ...(senseHere ? { senseHere } : {}),
      ...(background ? { background } : {}),
      ...(url ? { url } : {}),
      ...(difficulty === undefined ? {} : { difficulty }),
      ...(centrality === undefined ? {} : { centrality }),
      blocks: [],
    });
  }
  return out;
}

/**
 * What a second pass appends to, or null for a fresh start.
 *
 * **One expression, and it has been wrong once**, which is why it is a named
 * function with tests rather than a ternary inside a 120-line call — the
 * docstring on `generateGlossary` has pointed at "`existingFor` below" since
 * before there was one.
 *
 * A glossary whose `sourceHash` no longer matches describes a piece that no
 * longer exists, so its entries are about text that has moved and appending to
 * them would produce a list half-describing each. That one is a real refusal.
 *
 * A glossary written by an **older prompt** is not. It was briefly refused too,
 * and the refusal was a data-loss bug: null here means `buildGlossary` gets no
 * previous entries, so `taken` is empty and every id is re-minted — every
 * `?term=` link the reader holds goes dead — while the file is overwritten and
 * `passes` resets to 1, so nothing anywhere says it happened. Behind a button
 * labelled "Find more terms". See docs/plans/glossary-entries-worth-reading.md
 * § What review caught.
 *
 * The thing that refusal was protecting against is real — `merge` cannot choose
 * between a `gloss` and a `background`, because they are not the same field —
 * and `upcast` answers it properly, by translating rather than discarding.
 */
export function existingFor(onDisk: Glossary | null, sourceHash: string): Glossary | null {
  if (!onDisk || onDisk.sourceHash !== sourceHash) return null;
  return { ...onDisk, entries: onDisk.entries.map(upcast) };
}

/**
 * A `glossary/1` entry in `glossary/2` shape, so a second pass has one
 * vocabulary to merge rather than two.
 *
 * The blend goes to **`background`**, which is the same call `toEntries` makes
 * when the model answers in the old shape, and for the same reason: the old
 * `gloss` mixed what the article means with what the model knows, `senseHere`
 * is labelled "in this piece", and putting a blend under that label would
 * attribute the model's own knowledge to the article. `background` under-claims
 * the article, which is the harmless direction.
 *
 * `fromOutside` is carried rather than dropped. It is the only field that could
 * ever discriminate an old blend into its two halves without guessing, and an
 * upcast that threw it away would close that door for good.
 *
 * An entry already in the new shape is returned untouched — this is idempotent,
 * which matters because it runs on every append.
 */
export function upcast(entry: GlossaryEntry): GlossaryEntry {
  if (entry.senseHere !== undefined || entry.background !== undefined) return entry;
  const background = [entry.gloss, entry.detail].filter(Boolean).join(" ");
  if (!background) return entry;
  const { gloss, detail, ...rest } = entry;
  return { ...rest, background };
}

/**
 * Merge two entries for the same thing, keeping the **richer name**.
 *
 * The id is always the incumbent's, even when the challenger's name wins. A
 * `?term=` link and a selected term in the panel both address an entry by id,
 * so an id that changes when a later pass finds a better name for the same
 * thing would break the reader's link to say the word slightly differently.
 * Names are display; ids are identity.
 */
function merge(incumbent: GlossaryEntry, challenger: GlossaryEntry): GlossaryEntry {
  const swap = richer(challenger.name, incumbent.name);
  const winner = swap ? challenger : incumbent;
  const loser = swap ? incumbent : challenger;

  const seen = new Set<string>([normaliseTerm(winner.name)]);
  const aliases: string[] = [];
  // The loser's own name becomes an alias of the winner. That is the whole
  // point: nothing is discarded, the vaguer phrase goes on finding its
  // occurrences in the prose, and it does so under the better heading.
  for (const alias of [...winner.aliases, loser.name, ...loser.aliases]) {
    const key = normaliseTerm(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }

  /* **Field by field, winner first, loser as the fallback** — and this is the
     line that changed when one required prose field became two optional ones.
     The old rule took `gloss` from the winner outright, which was safe only
     because every entry had one. Doing that to `senseHere` would silently
     delete the loser's, in exactly the case where it is the only one there: two
     entries for the same thing where the richer *name* came back with the
     background and the poorer one with what the article means by it. The whole
     point of this dedup is that nothing is thrown away. */
  const senseHere = winner.senseHere ?? loser.senseHere;
  const background = winner.background ?? loser.background;
  const url = winner.url ?? loser.url;
  const difficulty = winner.difficulty ?? loser.difficulty;
  const centrality = winner.centrality ?? loser.centrality;
  /* `glossary/1` fields. `toEntries` no longer produces them and the append
     gate no longer lets an old list meet a new one, so in practice this runs
     over two old entries or over none — carried anyway, because the cost is
     three lines and the failure it prevents is an old entry coming back from a
     merge with all of its prose gone. */
  const gloss = winner.gloss ?? loser.gloss;
  const detail = winner.detail ?? loser.detail;

  return {
    id: incumbent.id,
    name: winner.name,
    kind: winner.kind === "other" ? loser.kind : winner.kind,
    aliases,
    ...(senseHere ? { senseHere } : {}),
    ...(background ? { background } : {}),
    ...(gloss ? { gloss } : {}),
    ...(detail ? { detail } : {}),
    ...(url ? { url } : {}),
    ...(difficulty === undefined ? {} : { difficulty }),
    ...(centrality === undefined ? {} : { centrality }),
    // Either half drawing on outside knowledge keeps the merged entry marked.
    // Only ever true of `glossary/1` entries; kept so a merge between two of
    // them does not quietly clear a badge the panel is still rendering.
    ...(winner.fromOutside || loser.fromOutside ? { fromOutside: true } : {}),
    blocks: [],
  };
}

/**
 * Collapse entries that name the same thing.
 *
 * **The rule, stated by what it keeps rather than by what is convenient:**
 *
 *  1. Two entries collide when their names normalise the same, or when one's
 *     **name** matches the other's **alias**.
 *  2. Two entries that merely **share an alias** do NOT collide. That was
 *     their first attempt, and it was too aggressive — legitimate entries that
 *     happened to share a synonym were being discarded, quietly.
 *  3. When they do collide, the **richer name wins** and the poorer becomes an
 *     alias of it, carrying its own aliases across. Nothing is thrown away.
 *
 * Rules 1 and 2 are theirs — the narrower fix they actually shipped, and it is
 * right. Rule 3 is the one their plan wrote down and never built, and it is the
 * half that matters: without it, 1 and 2 still systematically destroy the more
 * specific phrase, they just do it less often.
 *
 * Order is preserved, and it is load-bearing for a second pass: the entries
 * already on disk go in first, so they hold their ids and their positions, and
 * a fresh entry either joins the end or is folded into one of them.
 */
export function dedupe(entries: GlossaryEntry[]): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const byName = new Map<string, number>();
  const byAlias = new Map<string, number>();

  const index = (entry: GlossaryEntry, at: number): void => {
    byName.set(normaliseTerm(entry.name), at);
    for (const alias of entry.aliases) {
      const key = normaliseTerm(alias);
      // First writer wins, so an alias already owned by an earlier entry does
      // not silently change hands and pull a later merge towards the wrong one.
      if (key && !byAlias.has(key)) byAlias.set(key, at);
    }
  };

  for (const entry of entries) {
    const nameKey = normaliseTerm(entry.name);
    let hit = byName.get(nameKey) ?? byAlias.get(nameKey);
    if (hit === undefined) {
      // This entry's aliases against existing *names* only — never against
      // existing aliases. See rule 2.
      for (const alias of entry.aliases) {
        const found = byName.get(normaliseTerm(alias));
        if (found !== undefined) {
          hit = found;
          break;
        }
      }
    }
    if (hit === undefined) {
      out.push(entry);
      index(entry, out.length - 1);
      continue;
    }
    const merged = merge(out[hit] as GlossaryEntry, entry);
    out[hit] = merged;
    index(merged, hit);
  }
  return out;
}

/**
 * Which blocks each term actually appears in — **computed here, never asked for.**
 *
 * The model is never shown a block id and never returns one, so it cannot
 * invent one. Matching the text can only be wrong about *where* a term is, and
 * an occurrence list that disagrees with the prose is visible the moment a
 * reader presses the term; a hallucinated id would be invisible and would
 * scroll them somewhere arbitrary.
 *
 * It also turns the prompt's alias instruction into something measurable: an
 * entry that matches **no** block is either a term the piece does not use in
 * those words, or an alias set too narrow to find it. Both are worth seeing, so
 * the empty list is stored rather than smoothed over, and the panel says so.
 *
 * The matching rule itself is src/term-match.ts, shared with the reading view
 * so the underlines and this list cannot disagree.
 */
export function findOccurrences(entry: GlossaryEntry, blocks: Block[]): BlockId[] {
  const pattern = termPattern(formsOf(entry));
  if (!pattern) return [];
  const found: BlockId[] = [];
  for (const block of blocks) {
    if (block.text && termAppears(block.text, pattern)) found.push(block.id);
  }
  return found;
}

/**
 * Document order: whichever term the piece uses first comes first.
 *
 * The reader's own order through the article, which is a real order rather than
 * a judgment about what matters. `difficulty` and `centrality` are stored and
 * the panel offers them as a sort the reader chooses — Greg's call, 2026-08-25,
 * against a recommendation to drop the scores entirely. What that decision
 * rules out is sorting by them *silently*, which is the model doing the
 * reader's prioritising with nothing on screen saying so.
 *
 * Terms that appear in no block sort last, ahead of nothing, and keep their
 * relative order. They are the suspicious ones and the foot of a list is where
 * a reader expects to find the dregs.
 */
export function inDocumentOrder(entries: GlossaryEntry[], blocks: Block[]): GlossaryEntry[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  const rank = (entry: GlossaryEntry): number => {
    const first = entry.blocks[0];
    if (first === undefined) return Number.MAX_SAFE_INTEGER;
    return position.get(first) ?? Number.MAX_SAFE_INTEGER;
  };
  // Index as the tie-break so the sort is stable across runs and platforms —
  // Array.prototype.sort is specified stable now, but two entries first used in
  // the same block should have a reason for their order, not an accident.
  return entries
    .map((entry, i) => ({ entry, i, rank: rank(entry) }))
    .sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank - b.rank))
    .map((x) => x.entry);
}

/**
 * The artefact, from what the model said plus what we found for ourselves.
 *
 * `existing` is the glossary already on disk, if this is a second pass. It goes
 * through `dedupe` **first**, which is what keeps its ids and its order while
 * still letting a fresh entry with a richer name take one of them over.
 *
 * An empty result throws. Nothing to say is not a degenerate success — it is a
 * model call that produced nothing, and writing it would make the step report
 * done for ever after.
 */
export function buildGlossary(
  parsed: { entries?: unknown },
  opts: {
    slug: string;
    blocks: Block[];
    sourceHash: string;
    elapsedMs: number;
    existing?: Glossary | null;
  },
): Glossary {
  const raw = Array.isArray(parsed.entries) ? (parsed.entries as RawEntry[]) : [];
  const previous = opts.existing?.entries ?? [];
  // Ids already spent, so a fresh entry cannot collide with one the reader may
  // already have a `?term=` link to.
  const taken = new Set(previous.map((e) => e.id));
  const fresh = toEntries(raw, taken);
  if (previous.length === 0 && fresh.length === 0) {
    throw new Error("The model returned no terms. Nothing to write.");
  }

  const merged = dedupe([...previous, ...fresh]);
  const located = merged.map((entry) => ({ ...entry, blocks: findOccurrences(entry, opts.blocks) }));

  return {
    version: PROMPT_VERSION,
    generator: MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    entries: inDocumentOrder(located, opts.blocks),
    passes: (opts.existing?.passes ?? 0) + 1,
    generatedAt: new Date().toISOString(),
    elapsedMs: (opts.existing?.elapsedMs ?? 0) + opts.elapsedMs,
  };
}

/**
 * Does this glossary still describe the article on disk?
 *
 * Pure, and used at both ends, exactly as the thread's is: `GET
 * /api/glossary/:slug` puts the answer in the response so the panel can say the
 * list is out of date, and `glossaryIsCurrent` below wraps it so the pipeline
 * will not skip a step whose artefact has gone stale.
 */
export function isStale(glossary: Glossary, blocks: Block[]): boolean {
  return glossary.sourceHash !== hashBlocks(blocks);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** The glossary on disk, or null. Exported so the step and the API read it one way. */
export async function readGlossary(dir: string): Promise<Glossary | null> {
  return readJson<Glossary>(path.join(dir, "glossary.json"));
}

/**
 * Is the glossary on disk one we would write again today?
 *
 * The step's `isDone`, and the same three conditions the thread checks: the
 * blocks it was written from, the prompt that wrote it, and the model that ran.
 * Change any one and it regenerates by itself, with no `force` and nobody
 * having to remember.
 *
 * Anything unreadable answers **false**, which is the safe way to be wrong: the
 * cost is one model call, where the other way round is a stale glossary served
 * for ever.
 */
export async function glossaryIsCurrent(dir: string): Promise<boolean> {
  const glossary = await readGlossary(dir);
  if (!glossary) return false;
  if (glossary.version !== PROMPT_VERSION) return false;
  if (glossary.generator !== MODEL) return false;
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  if (!blocksFile?.blocks) return false;
  return !isStale(glossary, blocksFile.blocks);
}

/* ------------------------------------------------------------- the prompt --
   Four lines of this are theirs almost verbatim, and they are the four best
   lines in the file — see docs/project/original-version/glossary.md § The
   prompt, which is the best-written one over there. The alias instruction in
   particular is a concrete, testable target for something prompts usually
   hand-wave, and `findOccurrences` above is what tests it. */

const SYSTEM = `You are writing an AUTHOR'S GLOSSARY: the terms THIS PIECE uses in a
non-obvious way, defined from the piece itself.

WHAT BELONGS IN IT

A term earns an entry when a careful reader could reach it, not know what the
author means by it, and be unable to work it out from the sentence in front of
them. That includes:

- words the author uses in a special or narrowed sense
- technical vocabulary, jargon, and coinages
- people, organisations, places, works and events named without introduction
- a phrase the piece leans on as if it were already agreed

WHAT DOES NOT

- ordinary words used ordinarily
- anything the piece defines clearly on the spot — the reader has it already
- the article's own title, or the author's name
- terms you can define only from general knowledge and which the piece does not
  actually depend on. This is a glossary FOR this article, not an encyclopaedia
  entry that happens to be adjacent to it.

WHAT AN ENTRY SUPPLIES

The reader has the article in front of them. Never spend an entry describing
what the article does with a term — "quoted for the line ...", "the author's
example of ...", "used to argue that ..." are all descriptions of a page the
reader can already see, and an entry made of them adds nothing. An entry exists
to supply what is NOT on the page.

There are two kinds of missing thing, and they are the entry's two fields.

"senseHere" — what THIS author means by the term, where a reader could not get
that from the sentences around it: the narrowed sense, the coinage, how the
piece bends an ordinary word. From the article and only the article. If the
piece's use is plain once you know what the term is — a person simply quoted, a
work simply named — LEAVE THIS FIELD OUT rather than restate the page. An absent
field is a real answer.

"background" — what the reader needs to bring TO the piece: who this person is,
what this work or event is, what the term ordinarily means outside this article.
This is your knowledge, not the article's, and the reader will be told so, so
write it as knowledge rather than as hedged commentary on the article. Pick the
two or three facts that make THIS article's use of it land — for a person quoted
as an authority, the facts that say why the author reached for that name — and
stop. A biography is padding, and so is any fact the piece does not lean on.

A coinage of the author's usually needs only "senseHere". A person named without
introduction usually needs only "background". A borrowed term the author bends
needs both. At least one of the two must be there.

If you do not actually know who or what something is beyond what the article
says, leave "background" out. Do not guess, and never invent a fact about a
person or an organisation.

FOR EXAMPLE

An article quotes Leslie Lamport on writing, without saying who he is.

BAD — "senseHere": "Computer scientist quoted for the line 'If you're thinking
without writing, you only think you're thinking,' which the article uses to
argue writing and thinking are inseparable."
That describes the page the reader is looking at. It is the whole failure.

GOOD — "background": "Turing Award-winning computer scientist, known for
distributed systems and for writing LaTeX. A byword for the view that precise
writing is the test of precise thought, which is what his line is being borrowed
for."
That is what makes the quotation land, and it is not on the page.

NAMES AND ALIASES

"name" is the canonical and unambiguous way to refer to it (usually the longest
or official form, e.g. "United States of America" rather than "America").

Name the THING, not the topic. The name is what a reader would look up: the
person, the work, the term. Do not compose a heading out of the thing plus what
the article says about it — "JFK speechwriting" and "MLK plagiarism controversy"
are topics; "John F. Kennedy" and "Martin Luther King Jr." are the entries, and
what the article does with them belongs in the fields below, if anywhere. A
composed name is also a name that appears nowhere in the article, so nothing
will match it.

"aliases" are the other forms this article actually uses — abbreviations, short
forms, the plural if it is irregular, the surname where the piece introduced a
full name. Try to make the aliases distinctive, so that a regex using the
aliases finds all and only references to the entity (if possible). A one- or
two-letter alias, or a common English word, will match half the article: leave
it out.

SCORES

"difficulty" 0-1: how likely a well-read non-specialist is to be stopped by it.
0 is a word everyone knows; 1 is a coinage or a deep technical term.

"centrality" 0-1: how much of the article's argument rests on it. 0 is mentioned
once in passing; 1 is the piece's central idea.

Both are your judgment and both are shown as your judgment. Do not inflate them.

WRITING

- "senseHere": one or two plain sentences, or absent.
- "background": one to three plain sentences, or absent.
- Plain prose in both. No Markdown, no bullet lists, no headings, no bold.
- Do not begin with "refers to" or "is a term for". Say the thing.
- Do not hedge about the article ("the article doesn't say, but ..."). The panel
  labels which field is which; saying it again in the prose spends the reader's
  line on something they are already being told.
- Never invent a fact about a person or an organisation. If you are not sure who
  someone is, leave "background" out.

OUTPUT

JSON only, no prose, no code fence:

{"entries": [
  {
    "name": "...",
    "kind": "person|place|organization|event|work|concept|term|other",
    "aliases": ["...", "..."],
    "senseHere": "...",
    "background": "...",
    "difficulty": 0.0,
    "centrality": 0.0,
    "url": "https://..."
  }
]}

"url" is optional and only for a term with an obvious canonical page. Omit it
rather than guessing — a wrong link is worse than none.

"senseHere", "background" and "url" may each be omitted, but an entry with
neither "senseHere" nor "background" says nothing and will be thrown away.
Nothing else may be omitted.`;

/**
 * What the model is shown.
 *
 * The skeleton before the full text, for the same reason the arc and the thread
 * do it: it is what lets the model judge centrality against the shape of the
 * argument rather than against how often a word happens to appear.
 *
 * `existing` is the second-pass half, and it is their FORBIDDEN checklist
 * almost verbatim. Their version of this feature could not do a second pass
 * without repeating itself, and the list is what fixed it — a plain "don't
 * repeat these" is not enough, because the model's idea of a repeat is looser
 * than ours and it will happily return the synonym, the plural, and the
 * subcategory of something already on the list.
 */
function renderPrompt(opts: {
  meta: Meta | null;
  tree: Tree;
  blocks: Block[];
  count: number;
  existing: GlossaryEntry[];
}): string {
  const { meta, tree, blocks, count, existing } = opts;
  const skeleton = partsOf(tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");
  const body = blocks.map((b) => b.text).filter(Boolean).join("\n\n");

  const already =
    existing.length === 0
      ? ""
      : `\n=== ALREADY IN THE GLOSSARY ===

These are done. Find ${count} MORE, and go further down the list — the obvious
terms are taken, so the ones left are the quieter ones a reader still trips on.

${existing.map((e) => `- ${[e.name, ...e.aliases].join(" / ")}`).join("\n")}

FORBIDDEN: do not return an entry that:
- has the same name, or a similar name (case-insensitive), as one above
- is a synonym, alternative term, translation, plural or possessive of one above
- is a closely related concept that overlaps in meaning with one above
- is a subcategory or an aspect of one above
- shares any alias with one above

If there are genuinely no more terms worth an entry, return {"entries": []}.
That is a real answer and a better one than padding.
`;

  return `Find up to ${count} terms. Fewer is fine — a short piece has few, and a
list padded to a number is worse than a short list.
${already}
=== THE ARTICLE ===

Title: ${meta?.title ?? tree.slug}${meta?.byline ? `\nWritten by ${meta.byline}.` : ""}${
    meta?.siteName ? `\nPublished by ${meta.siteName}.` : ""
  }

=== ITS SHAPE ===

${skeleton}

=== ITS FULL TEXT ===

${body}`;
}

/** Strip a stray code fence if the model wraps its JSON despite instructions. */
function parseJson(raw: string): { entries?: unknown } {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}

export interface GlossaryRun {
  glossary: Glossary;
  outFile: string;
  blocks: number;
  words: number;
  /** How many entries this pass added, after dedup. Zero is a real answer on a later pass. */
  added: number;
  /** Entries matching no block — the alias instruction not landing. Worth watching. */
  unmatched: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

/**
 * Stage 5d over a data directory: one model call, then `glossary.json` beside
 * the tree, the arc and the thread.
 *
 * **It appends when there is already a current glossary.** That is what makes
 * "Find more terms" a re-run of this step rather than a second mechanism, and
 * it is the shape their pagination had. A glossary that has gone *stale* is not
 * appended to — the article underneath it moved, so the old entries are about a
 * piece that no longer exists and folding new ones into them would produce a
 * list half-describing each. `existingFor` below is where that decision is
 * made, and it is the one line to read if the behaviour ever looks wrong.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 */
export async function generateGlossary(opts: {
  dir: string;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
}): Promise<GlossaryRun> {
  const { blocks } = JSON.parse(
    await readFile(path.join(opts.dir, "blocks.json"), "utf-8"),
  ) as { blocks: Block[] };
  const tree = JSON.parse(await readFile(path.join(opts.dir, "tree.json"), "utf-8")) as Tree;
  // Optional, and only ever used to tell the model what it is reading. A
  // missing meta.json is not worth failing the whole stage over.
  const meta = await readFile(path.join(opts.dir, "meta.json"), "utf-8")
    .then((raw) => JSON.parse(raw) as Meta)
    .catch(() => null);

  const sourceHash = hashBlocks(blocks);
  const onDisk = await readGlossary(opts.dir);
  /* Append to any glossary that still describes THIS text, whatever prompt
     version wrote it — **upcast on the way in** rather than refused.

     This was briefly a *gate*, and the gate was a bug. `glossary/2` replaced one
     blended `gloss` with `senseHere` and `background`, and refusing to append
     across that boundary sounds conservative until you follow it: `existing`
     becomes null, `buildGlossary` gets no previous entries, so `taken` is empty
     and **every id is re-minted** — every `?term=` link the reader holds goes
     dead, the file is overwritten wholesale, and `passes` resets to 1 so the log
     line is indistinguishable from a first run. A button labelled "Find more
     terms" quietly destroying the list is the exact shape
     docs/reusable/silent-success.md is about.

     The thing the gate was actually protecting against — `dedupe` handed two
     vocabularies, and `merge` asked to choose between a `gloss` and a
     `background`, which are not the same field — is real, and `upcast` answers
     it properly: there is one vocabulary because the old entries are translated
     into it before they are merged. Nothing is lost and no id moves. */
  const existing = existingFor(onDisk, sourceHash);

  const words = blocks.reduce((n, b) => n + b.words, 0);
  const count = suggestedCount(words);
  const started = Date.now();

  /* Bounded by `count`, which is bounded by BATCH_SIZE — the whole reason the
     answer has a ceiling at all. Each entry is a name, a handful of aliases,
     and one or two short prose fields, which comes to a few hundred tokens.
     The allowance still scales with the article because the model reads the
     whole piece and thinks about it inside this same number. See
     src/token-budget.ts.

     Raised from 260 with `glossary/2`: a `background` for a person named in
     passing runs longer than the gloss it replaced, because it is now carrying
     the facts that make the name land rather than a sentence about the
     quotation. Undersizing this does not degrade — it throws
     `truncatedMessage` and loses the whole pass. */
  const answerTokens = 600 + count * 340;
  const maxTokens = budgetFor("glossary", answerTokens);

  const client = new Anthropic();
  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: renderPrompt({
            meta,
            tree,
            blocks,
            count,
            existing: existing?.entries ?? [],
          }),
        },
      ],
    },
    { signal: opts.signal },
  );

  if (opts.onProgress) {
    const report = opts.onProgress;
    const verb = existing ? "more terms" : "terms";
    let chars = 0;
    let last = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      // Throttled: the model emits deltas far faster than anyone can read them,
      // and every one of these is a write the job poller may pick up.
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      report(`up to ${count} ${verb}, ${Math.round(chars / 1000)}k characters so far`);
    });
  }

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(message.stop_details)}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      truncatedMessage("glossary", maxTokens, answerTokens, {
        outputTokens: message.usage.output_tokens,
        answerChars: message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .reduce((n, b) => n + b.text.length, 0),
      }),
    );
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const glossary = buildGlossary(parseJson(raw), {
    slug: tree.slug,
    blocks,
    sourceHash,
    elapsedMs: Date.now() - started,
    existing,
  });

  const outFile = path.join(opts.dir, "glossary.json");
  await writeFile(outFile, JSON.stringify(glossary, null, 2), "utf-8");

  return {
    glossary,
    outFile,
    blocks: blocks.length,
    words,
    added: glossary.entries.length - (existing?.entries.length ?? 0),
    unmatched: glossary.entries.filter((e) => e.blocks.length === 0).length,
    model: MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    elapsedMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/glossary.ts <dir with blocks.json + tree.json>");
    console.error("Run it twice to add a second batch of terms to the same article.");
    process.exit(1);
  }
  // Before the call, not after. This is the only thing on screen while the
  // model works, and printing it afterwards makes the command look hung.
  console.log(`Finding the terms with ${MODEL}…`);
  const run = await generateGlossary({
    dir,
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const { glossary } = run;
  console.log(
    `\n${run.blocks} blocks, ${run.words} words → ${glossary.entries.length} terms ` +
      `(${run.added} new, pass ${glossary.passes})`,
  );
  console.log(`\nTokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Unmatched: ${run.unmatched}`);
  console.log(`Wrote:     ${path.resolve(run.outFile)}\n`);
  for (const entry of glossary.entries) {
    // The occurrence count is the interesting number here: a term with no
    // occurrences is the alias instruction not landing, and it is the one thing
    // reading this output is good for.
    const where = entry.blocks.length === 0 ? "no blocks ←" : `${entry.blocks.length} blocks`;
    console.log(`${entry.name}  [${entry.kind}] (${where})`);
    if (entry.aliases.length > 0) console.log(`  aka ${entry.aliases.join(", ")}`);
    /* Labelled, and both, because which field the model filled is the thing
       worth looking at after a prompt change — an entry whose `senseHere` is a
       sentence about the article rather than about the term is the failure
       `glossary/2` exists to fix, and it is invisible in an unlabelled dump.
       `gloss` for anything written before that. */
    if (entry.senseHere) console.log(`  here: ${entry.senseHere}`);
    if (entry.background) console.log(`  bg:   ${entry.background}`);
    if (entry.gloss) console.log(`  ${entry.gloss}`);
    console.log("");
  }
}

/* Compared as resolved paths, not by suffix — see the same guard in
   src/tweets.ts for what `endsWith` gets wrong. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
