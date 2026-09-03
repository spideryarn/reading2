/**
 * **Illustrated — the brief an image model is handed, and the check that runs
 * before it is handed over.**
 *
 * The fifth diagram sub-mode (docs/plans/260903c-illustrated-diagram-sub-mode.md)
 * takes the Sketch that already exists, has a model write an *illustration
 * brief* from it, and has an image model draw that brief as an antique map or
 * an illuminated page. This file is the brief's schema and its reader. It knows
 * nothing about drawing and nothing about the network.
 *
 * ## What is checked here, and — more importantly — what is not
 *
 * Sketch's design move is *don't check the picture, check the numbers that made
 * it*. This is that move applied one stage earlier, and it buys strictly less,
 * so the difference has to be said out loud rather than left to be assumed:
 *
 *  - Sketch validates **the data that determines the geometry** — coordinates,
 *    edges, containment, article order. Its checks can therefore support a
 *    claim about the resulting picture.
 *  - Illustrated validates **inputs to another model whose output remains
 *    unconstrained.** Every vignette here can be a genuine, verbatim,
 *    block-local quote and the picture can still draw something else entirely.
 *
 * So this file is not a safety mechanism for the image. It is two narrower
 * things, both real:
 *
 *  1. **An anchor.** A vignette must name a block the article really has and
 *     quote a contiguous run of *that block's own words*. That is what stops
 *     the brief drifting into general knowledge and symbols-for-topics, which
 *     is the failure mode this mode is most likely to have
 *     (plan § The highest-leverage instruction).
 *  2. **A blast-radius bound.** `depicts` is model-written free text that is
 *     handed to a *second* model, so an instruction inside a stranger's web
 *     page can travel through a field we generated into an image prompt. Length
 *     and character class are capped here, where the check is testable, rather
 *     than at the call site (plan § Two hazards).
 *
 * The count is the point. `report.faults` rising means the prompt has started
 * drifting off the article, and a validator that quietly repaired things would
 * report a clean run on a model that had stopped following the schema —
 * docs/reusable/silent-success.md. So: **drop, never repair**, exactly as
 * `readSketch` does.
 *
 * ## The one gap, stated rather than papered over
 *
 * The plan says "the composition prompt is built only from the survivors". That
 * is **not** what happens and could not be without throwing away the thing that
 * makes the picture good: the model writes `prompt` as one self-contained
 * composition, top to bottom, and a dropped vignette may still be named in it.
 * What a drop buys is that the vignette does not appear in the reader's "what
 * it depicts" list — the list that carries the real words and the real block
 * ids — and that the drop is counted. It does not buy its absence from the
 * picture. See the plan's § What this reverses, which is the honest version.
 *
 * ## Why `"spaced"` and not `"forgiving"`
 *
 * `findQuote`'s forgiving pass deletes whitespace, so an article saying *fall
 * apart* matches a model saying *fall a part*. That is right when the question
 * is "which characters do I wash" and wrong here, where a match is being read
 * as a claim that the model **copied** the text. src/quote-match.ts § the
 * `passes` argument.
 *
 * **And there is no second normaliser in this file.** `quote-match.ts` already
 * folds curly quotes, all three dashes and the non-breaking space, deliberately
 * with a same-length single-character table rather than `NFKC` so offsets
 * survive. A spike on 2026-09-03 reported three validator drops as false
 * positives; two of the three were the spike's own naive `String.includes`. If
 * you find yourself lower-casing or replacing characters before calling
 * `findQuote`, stop — that is the bug.
 *
 * Pure: `types.js` and `quote-match.js` and no other import, ever — it is on
 * the client allowlist in tests/client-imports.test.ts for the reason
 * `sketch-scene.ts` is on it. **The browser revalidates on arrival**: what
 * comes back from the artefact may have been written by an older schema or
 * against an article whose block ids have since moved, and the panel must drop
 * what it cannot vouch for before showing a reader a quote and a jump.
 */
import { findQuote } from "./quote-match.js";
import type { BlockId } from "./types.js";

export const ILLUSTRATED_VERSION = "illustrated/1";

/**
 * **How many plates one run may draw**, and it is one character to change.
 *
 * The overview plus up to three zoom scenes. The plan defers "overview only" by
 * exactly this constant: if the per-scene plates disappoint, it goes to 1.
 */
export const MAX_PLATES = 4;

/**
 * The shortest thing that may count as a quote — **both of these, not either**.
 *
 * Four words and twenty characters. Without a floor, `"the"` matches every
 * block in the article and the anchor stops meaning anything: a vignette could
 * name any block at all and pass. Words alone would let `"a b c d"` through;
 * characters alone would let one long compound word through.
 */
export const MIN_QUOTE_WORDS = 4;
export const MIN_QUOTE_CHARS = 20;

/**
 * Caps on the model's free text, in characters.
 *
 * These are a bound on what gets handed to the *image* model and shown to the
 * reader, not an opinion about style. The prompt asks for a quote of 4–20
 * words, `depicts` of one or two sentences, and a composition of 200–500 words;
 * each cap is comfortably above what the prompt asks for, so hitting one means
 * something has gone wrong rather than that the model was verbose.
 */
export const MAX_QUOTE_CHARS = 400;
export const MAX_DEPICTS_CHARS = 600;
export const MAX_PROMPT_CHARS = 8_000;
export const MAX_STYLE_CHARS = 600;
export const MAX_TITLE_CHARS = 200;
/** A sketch node id, which the model copies from the scene. */
export const MAX_NODE_CHARS = 80;

export interface IllustratedVignette {
  /** The sketch node this depicts, when it depicts one. */
  node?: string;
  /** Where in the article it comes from. Validated against the article's own ids. */
  block: BlockId;
  /** A contiguous run of the article's own words, from THAT block. Validated. */
  quote: string;
  /** What the illustrator draws. Free text from a model — treat as untrusted. */
  depicts: string;
}

export interface IllustratedPlate {
  /** The Sketch scene this plate is of. `scenes[0]`'s id is the overview. */
  sceneId: string;
  title: string;
  /** The composition prompt that was sent to the image model. Shown to the reader. */
  prompt: string;
  vignettes: IllustratedVignette[];
  /** Absent when this plate's image call failed — the artefact still lists the plate. */
  image?: IllustratedImage;
  /** Why there is no image, in the words a person would use. */
  failed?: string;
}

/**
 * Where a plate's bytes are, never the bytes themselves.
 *
 * Content-addressed in the blob store under `canonicalKey(sha256, "jpeg")`, the
 * same machinery the article's own figures use. **Never base64 in the
 * artefact** — that column would then be dragged along by every read of the
 * revision. Stage 3 puts the bytes there; this is the shape it writes.
 */
export interface IllustratedImage {
  sha256: string;
  ext: "jpeg";
  bytes: number;
  width: number;
  height: number;
}

export interface Illustrated {
  version: string;
  /** The model that wrote the brief. */
  generator?: string;
  /** The model that drew the plates. */
  illustrator?: string;
  slug?: string;
  /**
   * **What this was drawn against, and it is the Sketch rather than the
   * article.** A forced Sketch redraw changes the scene with every article byte
   * identical, so an article-shaped fingerprint would call a stale illustration
   * current. Plan § Its fingerprint is the Sketch.
   */
  sourceHash?: string;
  /**
   * Who it was drawn for, **inherited from the Sketch** — a personalised picture
   * must not quietly become an impersonal one. Three states and they are not
   * two: absent, `null` (no profile), or a hash. Same contract as
   * `Summaries.profileHash`; src/types.ts has the table.
   */
  profileHash?: string | null;
  /** One sentence naming the register and why this article suits it. */
  style: string;
  plates: IllustratedPlate[];
}

/* ------------------------------------------------------------------ reading */

/** One thing that was wrong, kept so a run can be read rather than trusted. */
export interface IllustratedFault {
  /** `plate[0].vignettes[3]` or a scene id — enough to find it in the raw JSON. */
  where: string;
  /** What was dropped, in the words a person would use. */
  what: string;
}

export interface IllustratedReport {
  faults: IllustratedFault[];
  /** Vignettes the model wrote, and vignettes that survived. */
  written: number;
  kept: number;
  /** Plates the model wrote, and plates that survived. */
  platesWritten: number;
  platesKept: number;
}

export interface IllustratedReadOptions {
  /**
   * **Every block the article has, by id, with its own text** — one map rather
   * than the `blockOrder` list `readSketch` takes plus a lookup beside it.
   *
   * One structure because there is exactly one question here and both halves of
   * a pair would have to answer it together: *is this block real, and does this
   * quote appear in it?* Two inputs is one place for them to disagree, and the
   * disagreement would be silent — a block present in the order list and absent
   * from the text lookup would drop every quote in it with a message about the
   * quote. Sketch takes an ordered list because it also **measures** order
   * (`flow`); nothing here does.
   */
  blockText: ReadonlyMap<BlockId, string>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Characters that may not appear in anything a model wrote here.
 *
 * The C0 and C1 control ranges (tab, newline and carriage return excepted —
 * `depicts` and `prompt` are prose and may be wrapped), `DEL`, the zero-width
 * and directional-formatting characters, and the bidi overrides. The last group
 * is the one worth naming: `U+202E` reverses the rendering of everything after
 * it, so a `depicts` carrying one displays to the reader as something other
 * than what is stored and other than what the image model was sent. That is a
 * spoof rather than a typo, and the field is shown to a reader *and* forwarded
 * to a second model.
 */
const FORBIDDEN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

/** How many words a string has, for the quote floor. */
function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Trimmed and length-checked, or `null` with a reason.
 *
 * Returns `null` rather than a truncation, because truncating a composition
 * prompt mid-sentence sends the image model half an instruction and truncating
 * a quote breaks the exact claim the quote check exists to make.
 */
function bounded(v: unknown, cap: number, what: string): { ok: string } | { bad: string } {
  const s = str(v);
  if (!s) return { bad: `${what} is empty` };
  if (s.length > cap) return { bad: `${what} is ${s.length} characters, over the ${cap} cap` };
  if (FORBIDDEN.test(s)) return { bad: `${what} contains a control or bidi character` };
  return { ok: s };
}

function readVignette(
  raw: unknown,
  opts: IllustratedReadOptions,
  faults: IllustratedFault[],
  where: string,
): IllustratedVignette | null {
  const drop = (what: string): null => {
    faults.push({ where, what });
    return null;
  };
  if (!isObj(raw)) return drop("not an object");

  const block = str(raw.block);
  /* **The article's own ids, and nothing else.** An invented block id is a row
     in the reader's list that jumps nowhere, which is the one thing
     docs/project/block-ids.md says this app must never ship. */
  const text = opts.blockText.get(block);
  if (text === undefined) {
    return drop(`block "${block || "(none)"}" is not in this article`);
  }

  const quote = bounded(raw.quote, MAX_QUOTE_CHARS, "quote");
  if ("bad" in quote) return drop(quote.bad);
  if (words(quote.ok) < MIN_QUOTE_WORDS || quote.ok.length < MIN_QUOTE_CHARS) {
    return drop(
      `quote is ${words(quote.ok)} word(s) and ${quote.ok.length} characters — ` +
        `under the ${MIN_QUOTE_WORDS}-word, ${MIN_QUOTE_CHARS}-character floor`,
    );
  }

  /* **In that block's own text, not in the article.** An article-wide search
     accepts a quote lifted from somewhere the vignette does not claim to be
     about, so the reader's row would show a real sentence beside a jump to a
     block that does not contain it. GPT Sol, 2026-09-03; the spike searched the
     whole article and this is the correction. */
  if (findQuote(text, quote.ok, undefined, "spaced") === null) {
    return drop(`quote is not in block ${block}`);
  }

  const depicts = bounded(raw.depicts, MAX_DEPICTS_CHARS, "depicts");
  if ("bad" in depicts) return drop(depicts.bad);

  const vignette: IllustratedVignette = { block, quote: quote.ok, depicts: depicts.ok };
  const node = bounded(raw.node, MAX_NODE_CHARS, "node");
  if ("ok" in node) vignette.node = node.ok;
  return vignette;
}

/**
 * **Read the brief a model sent and hand back only what can be vouched for.**
 *
 * Never throws on a malformed brief and never repairs one into something
 * plausible: a vignette survives intact or it is dropped and counted. Runs on
 * the server before the artefact is written **and** in the browser when it
 * arrives — see the header for why both.
 *
 * `raw` is either the model's answer (`{ style, plates }`) or a stored
 * `Illustrated` artefact, which is the same shape with `image`/`failed` on the
 * plates. Both go through here, so a `--render` of a saved brief takes the same
 * road a fresh one does.
 */
export function readIllustrated(
  raw: unknown,
  opts: IllustratedReadOptions,
): { illustrated: Illustrated; report: IllustratedReport } {
  if (!isObj(raw)) {
    return {
      illustrated: { version: ILLUSTRATED_VERSION, style: "", plates: [] },
      report: {
        faults: [{ where: "root", what: "not an object" }],
        written: 0,
        kept: 0,
        platesWritten: 0,
        platesKept: 0,
      },
    };
  }

  const faults: IllustratedFault[] = [];
  const style = bounded(raw.style, MAX_STYLE_CHARS, "style");
  if ("bad" in style) faults.push({ where: "root", what: style.bad });

  const rawPlates = Array.isArray(raw.plates) ? raw.plates : [];
  const plates: IllustratedPlate[] = [];
  const seen = new Set<string>();
  let written = 0;

  for (const [i, rp] of rawPlates.entries()) {
    const read = readPlate(rp, opts, seen, faults, `plate[${i}]`);
    written += read.written;
    if (read.plate) {
      seen.add(read.plate.sceneId);
      plates.push(read.plate);
    }
  }

  const illustrated: Illustrated = {
    version: ILLUSTRATED_VERSION,
    style: "ok" in style ? style.ok : "",
    plates,
  };
  for (const key of ["generator", "illustrator", "slug", "sourceHash"] as const) {
    const v = str(raw[key]);
    if (v) illustrated[key] = v;
  }
  if (typeof raw.profileHash === "string" || raw.profileHash === null) {
    illustrated.profileHash = raw.profileHash;
  }

  return {
    illustrated,
    report: {
      faults,
      written,
      kept: plates.reduce((n, p) => n + p.vignettes.length, 0),
      platesWritten: rawPlates.length,
      platesKept: plates.length,
    },
  };
}

/**
 * One plate, and how many vignettes it claimed.
 *
 * `written` comes back even when the plate itself is dropped, because a plate
 * that goes for having no prompt still took its vignettes with it, and the
 * report is about what the *model wrote* rather than about what happened to
 * survive.
 */
function readPlate(
  raw: unknown,
  opts: IllustratedReadOptions,
  seen: ReadonlySet<string>,
  faults: IllustratedFault[],
  where: string,
): { plate: IllustratedPlate | null; written: number } {
  const drop = (what: string): { plate: null; written: number } => {
    faults.push({ where, what });
    return { plate: null, written: countVignettes(raw) };
  };
  if (!isObj(raw)) return drop("not an object");

  const sceneId = str(raw.sceneId);
  if (!sceneId) return drop("no sceneId — nothing says which scene this is of");
  /* Two plates of one scene is not a second picture, it is an ambiguous one:
     the panel's scene row addresses a plate by its scene id, so the reader
     would reach whichever the lookup happened to find. The second goes. */
  if (seen.has(sceneId)) return drop(`a second plate of scene "${sceneId}" — dropped`);

  const prompt = bounded(raw.prompt, MAX_PROMPT_CHARS, "prompt");
  if ("bad" in prompt) return drop(`${prompt.bad} — nothing to draw, so the plate goes`);

  const rawVignettes = Array.isArray(raw.vignettes) ? raw.vignettes : [];
  const vignettes: IllustratedVignette[] = [];
  for (const [j, rv] of rawVignettes.entries()) {
    const v = readVignette(rv, opts, faults, `${where}.vignettes[${j}]`);
    if (v) vignettes.push(v);
  }

  const title = bounded(raw.title, MAX_TITLE_CHARS, "title");
  const plate: IllustratedPlate = {
    sceneId,
    title: "ok" in title ? title.ok : "",
    prompt: prompt.ok,
    vignettes,
  };
  /* Carried through when the input is a stored artefact rather than a fresh
     answer, so a re-read of what is on disk is the same object it was. Both are
     model-adjacent in one direction only — `image` is written by us from the
     bytes we received, `failed` is one of our own sentences — so neither is
     capped as untrusted text. */
  const image = readImage(raw.image);
  if (image) plate.image = image;
  const failed = str(raw.failed);
  if (failed) plate.failed = failed.slice(0, MAX_TITLE_CHARS);
  return { plate, written: rawVignettes.length };
}

/** How many vignettes a plate claimed, even when the plate itself is rubbish. */
function countVignettes(raw: unknown): number {
  return isObj(raw) && Array.isArray(raw.vignettes) ? raw.vignettes.length : 0;
}

/** A stored plate's image record, or `null` if it is not one. */
function readImage(raw: unknown): IllustratedImage | null {
  if (!isObj(raw)) return null;
  const sha256 = str(raw.sha256);
  const nums = ["bytes", "width", "height"] as const;
  if (!/^[0-9a-f]{64}$/.test(sha256) || raw.ext !== "jpeg") return null;
  for (const k of nums) {
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k]) || raw[k] <= 0) return null;
  }
  return {
    sha256,
    ext: "jpeg",
    bytes: raw.bytes as number,
    width: raw.width as number,
    height: raw.height as number,
  };
}

/**
 * The plates that actually have a picture. The panel's scene row is built from
 * this rather than from `plates`, because a plate whose call failed is a row
 * that says so rather than a row that opens onto nothing.
 */
export function drawnPlates(illustrated: Illustrated): IllustratedPlate[] {
  return illustrated.plates.filter((p) => p.image !== undefined);
}
