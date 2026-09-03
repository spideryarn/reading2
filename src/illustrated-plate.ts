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
 * ## Two readers, because there are two trust levels
 *
 * **`readModelBrief` reads what a model just said. `readStoredIllustrated`
 * reads what came off our own disk or down our own wire.** They are not the
 * same question and one function answering both was the sharpest finding of the
 * 2026-09-03 review:
 *
 * > A fresh brief can include storage-owned fields … That permits a
 * > prompt-injected brief to claim an existing content-addressed blob or
 * > manufacture an impossible image-plus-failure state.
 * >
 * > — GPT Sol, 2026-09-03
 *
 * `image.sha256` addresses a blob in a content-addressed store shared by every
 * article, so a model that may name one may name **somebody else's picture**.
 * A model may not, here, at all: a brief carrying `image` or `failed` loses the
 * whole plate. `IllustratedImage` is written by us from bytes we received
 * (src/illustrated-image.ts) and `failed` is one of our own sentences, so both
 * are ours to read back and neither is ever the model's to write.
 *
 * The type says the same thing in the other direction: `IllustratedPlate` is a
 * **union**, so "has a picture and also failed" is not a state that can be
 * constructed — use `plateDrawn` and `plateFailed` rather than assigning either
 * field.
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
 *     than at the call site (plan § Two hazards). It bounds the payload; it
 *     does not make the field trustworthy — src/illustrated.ts § What an
 *     article's author can still make the picture do.
 *
 * The count is the point. `report.faults` rising means the prompt has started
 * drifting off the article, and a validator that quietly repaired things would
 * report a clean run on a model that had stopped following the schema —
 * docs/reusable/silent-success.md. So: **drop, never repair**, and where
 * something genuinely is repaired rather than dropped (a title, an overlong
 * `failed` sentence) the repair gets a fault of its own.
 *
 * ## The floors
 *
 * **A plate with no surviving vignette is not drawn** — from a model. The whole
 * claim of this mode is that the picture is anchored in the article, and a
 * plate whose every anchor was dropped is a picture of nothing that costs money
 * to find out. A *stored* plate in that state is kept and faulted instead: the
 * money is already spent and the bytes exist, and block ids can move under an
 * artefact (see the browser note below), so dropping it would delete a picture
 * a reader paid for over a re-extraction. **An empty plate set is a fault
 * either way.**
 *
 * ## Order is the Sketch's, never the model's
 *
 * Plates come back in the order `opts.sceneIds` gives, which is the Sketch's.
 * A model that lists the zoom scene first would otherwise make *it* the style
 * reference every later plate is drawn against (src/illustrated.ts § the
 * overview is the hand), which is a silent reordering of the whole run. Scene
 * membership, uniqueness and absence are all decided here rather than by the
 * caller afterwards, so that `report` is reconcilable against the artefact it
 * is a report of.
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
 * what it cannot vouch for before showing a reader a quote and a jump. It calls
 * `readStoredIllustrated`, never `readModelBrief`.
 */
import { findQuote } from "./quote-match.js";
import type { Sketch, SketchScene } from "./sketch-scene.js";
import type { BlockId } from "./types.js";

/**
 * **The version, and the only one.** Stamped onto every artefact this file
 * writes, and compared against the artefact's `version` in src/store/pg.ts to
 * answer `outdated` — so it has to be one constant, and until 2026-09-03 it was
 * two. `illustrated.ts` had its own `PROMPT_VERSION` beside this one, equal by
 * coincidence rather than by construction, and bumping only that one gave every
 * freshly drawn artefact `outdated: true` for ever: written as `illustrated/1`
 * here, compared against `illustrated/2` there. `illustrated.ts` now re-exports
 * this, so there is nothing to keep in step.
 *
 * Bump it whenever `SYSTEM` or `renderPrompt` changes what the model is asked.
 * It also feeds `inputFingerprint`, so a bump marks every stored plate stale.
 */
export const ILLUSTRATED_VERSION = "illustrated/2";

/**
 * **How many plates one run may draw**, and it is one character to change.
 *
 * The overview plus up to three zoom scenes. The plan defers "overview only" by
 * exactly this constant: if the per-scene plates disappoint, it goes to 1.
 */
export const MAX_PLATES = 4;

/**
 * **Which scenes get a plate** — the overview and then the zoom scenes in the
 * order the Sketch lists them, capped at `MAX_PLATES`.
 *
 * The cap is a constant so that "overview only" is one character away, which is
 * how the plan defers it rather than arguing about it.
 *
 * It lives here rather than in src/illustrated.ts, where it started, because
 * `sceneIds` made it the *reader's* question: every caller of a reader has to
 * answer it, and one of them (`--check` in evals/illustrated/run.ts) must do so
 * without dragging the stage, the SDK and the gateway in behind it. The
 * `Sketch` import is type-only, so this file still imports nothing at runtime
 * but `quote-match.js`.
 */
export function platedScenes(sketch: Sketch): SketchScene[] {
  return sketch.scenes.slice(0, MAX_PLATES);
}

/**
 * **How much of a brief is even looked at**, which is a different question from
 * how much is drawn.
 *
 * Parsing happens before any slice to `MAX_PLATES`, and it walks every vignette
 * of every plate calling `findQuote` on each — so a stored artefact claiming ten
 * thousand plates would spend a browser's afternoon proving they were all
 * unusable. Four times the drawing cap, so a model writing one plate too many
 * is still visible as a fault rather than silently truncated, and forty
 * vignettes against the 8–14 the prompt asks for.
 */
export const MAX_PLATES_READ = 16;
export const MAX_VIGNETTES = 40;

/**
 * The shortest thing that may count as a quote — **both of these, not either**.
 *
 * Four words and twenty characters. Without a floor, `"the"` matches every
 * block in the article and the anchor stops meaning anything: a vignette could
 * name any block at all and pass. Words alone would let `"a b c d"` through;
 * characters alone would let one long compound word through.
 *
 * The ceiling is the prompt's own "4 to 20 words", enforced rather than asked
 * for. Measured against the 2026-09-03 runs the model never went over 19, so it
 * costs nothing today and stops a "quote" that is really a paragraph.
 */
export const MIN_QUOTE_WORDS = 4;
export const MIN_QUOTE_CHARS = 20;
export const MAX_QUOTE_WORDS = 20;

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
/** Our own sentence saying why a plate has no picture. Not exported: one file
    writes it (`plateFailed`) and the same file reads it back. */
const MAX_FAILED_CHARS = 200;

/**
 * **Bounds on the stored image record**, which is ours rather than a model's
 * and is still checked.
 *
 * Deliberately a second, looser statement of the caps in src/ai-call.ts
 * § `MAX_IMAGE_BYTES`, and not an import of them: this file is on the client
 * allowlist and may import nothing but `types.js` and `quote-match.js`. They do
 * not have to agree to the byte — the seam's are what a live provider may
 * return, these are what a *stored* record may claim — so keep them in the same
 * order of magnitude and do not try to share them.
 */
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

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

/** Everything about a plate the brief model writes, before anybody draws it. */
export interface IllustratedPlateBrief {
  /** The Sketch scene this plate is of. `scenes[0]`'s id is the overview. */
  sceneId: string;
  title: string;
  /** The composition prompt that was sent to the image model. Shown to the reader. */
  prompt: string;
  vignettes: IllustratedVignette[];
}

/**
 * **A plate in exactly one of its three states**, and the union is the point.
 *
 * Not drawn yet (a fresh brief), drawn, or failed. Before this was a union both
 * fields were optional and independent, so `{ image, failed }` was a value the
 * compiler was happy with — a state no run can produce and every reader would
 * have to decide about. Build the drawn and failed states with `plateDrawn` and
 * `plateFailed`; the fields cannot be assigned.
 */
export type IllustratedPlate =
  | (IllustratedPlateBrief & { image?: undefined; failed?: undefined })
  | (IllustratedPlateBrief & { image: IllustratedImage; failed?: undefined })
  | (IllustratedPlateBrief & { image?: undefined; failed: string });

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

/** The same plate, now with the picture that was drawn for it. */
export function plateDrawn(plate: IllustratedPlate, image: IllustratedImage): IllustratedPlate {
  const { sceneId, title, prompt, vignettes } = plate;
  return { sceneId, title, prompt, vignettes, image };
}

/**
 * The same plate, with our sentence about why there is no picture.
 *
 * Capped here rather than at the reader, so what goes into the artefact is
 * already inside the bound a re-read enforces.
 */
export function plateFailed(plate: IllustratedPlate, why: string): IllustratedPlate {
  const { sceneId, title, prompt, vignettes } = plate;
  const failed = why.trim().slice(0, MAX_FAILED_CHARS) || "the plate could not be drawn";
  return { sceneId, title, prompt, vignettes, failed };
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
  /**
   * **The scenes that may have a plate, in the Sketch's order** — normally
   * `platedScenes(sketch).map((s) => s.id)`.
   *
   * Required rather than optional, and required by both readers, because it is
   * the answer to three questions that were previously the caller's and were
   * therefore answered after the fact or not at all: which plates exist, in what
   * order they are drawn, and which scene the model forgot. A reader given the
   * wrong list drops everything, which is loud; a reader given no list trusts
   * the model's own ordering, which is silent.
   */
  sceneIds: readonly string[];
}

/** Whose words these are. See the header: the two are not the same question. */
type Trust = "model" | "stored";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Absent, in the two spellings JSON has for it. */
const missing = (v: unknown): boolean => v === undefined || v === null;

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
 *
 * `U+061C` ARABIC LETTER MARK is in the list on its own because it sits outside
 * every range above and does the same job as `U+200F`; it passed until the
 * 2026-09-03 review looked for it.
 */
const FORBIDDEN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

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
  if (words(quote.ok) > MAX_QUOTE_WORDS) {
    return drop(`quote is ${words(quote.ok)} words, over the ${MAX_QUOTE_WORDS} the prompt asks for`);
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
  /* `node` is optional, so absence is fine and *rubbish* is not: a vignette
     carrying eighty characters of junk where a scene node id belongs is a
     vignette the model was not writing carefully. Dropping it is the same rule
     the rest of this file follows rather than a special case. */
  if (!missing(raw.node)) {
    const node = bounded(raw.node, MAX_NODE_CHARS, "node");
    if ("bad" in node) return drop(node.bad);
    vignette.node = node.ok;
  }
  return vignette;
}

/**
 * **Read the brief a model just sent**, and hand back only what can be vouched
 * for.
 *
 * Never throws on a malformed brief and never repairs one into something
 * plausible: a vignette survives intact or it is dropped and counted. A plate
 * claiming an `image` or a `failed` goes entirely — a model has no business
 * naming either, and `sha256` names a blob belonging to any article at all.
 */
export function readModelBrief(
  raw: unknown,
  opts: IllustratedReadOptions,
): { illustrated: Illustrated; report: IllustratedReport } {
  return read(raw, opts, "model");
}

/**
 * **Read an artefact of ours** — off the database, off disk, or off the wire in
 * the browser.
 *
 * The same checks, minus the two that only make sense against fresh model
 * output: `image` and `failed` are read back rather than refused, and a plate
 * whose every vignette has stopped matching (block ids move under an artefact
 * when an article is re-extracted) is kept and faulted rather than dropped,
 * because the picture was paid for and exists.
 */
export function readStoredIllustrated(
  raw: unknown,
  opts: IllustratedReadOptions,
): { illustrated: Illustrated; report: IllustratedReport } {
  return read(raw, opts, "stored");
}

function read(
  raw: unknown,
  opts: IllustratedReadOptions,
  trust: Trust,
): { illustrated: Illustrated; report: IllustratedReport } {
  const faults: IllustratedFault[] = [];
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

  const style = bounded(raw.style, MAX_STYLE_CHARS, "style");
  if ("bad" in style) faults.push({ where: "root", what: style.bad });

  let rawPlates: unknown[] = [];
  if (Array.isArray(raw.plates)) rawPlates = raw.plates;
  else if (!missing(raw.plates)) faults.push({ where: "root", what: "plates is not a list" });

  const looked = rawPlates.slice(0, MAX_PLATES_READ);
  if (rawPlates.length > looked.length) {
    faults.push({
      where: "root",
      what: `${rawPlates.length - looked.length} plate(s) past the ${MAX_PLATES_READ} cap were not read`,
    });
  }

  const byScene = new Map<string, IllustratedPlate>();
  let written = 0;
  for (const [i, rp] of looked.entries()) {
    const r = readPlate(rp, opts, byScene, faults, `plate[${i}]`, trust);
    written += r.written;
    if (r.plate) byScene.set(r.plate.sceneId, r.plate);
  }

  /* **The Sketch's order, not the model's**, and the absences are faults rather
     than a shorter list nobody notices. See the header. */
  const plates: IllustratedPlate[] = [];
  for (const sceneId of opts.sceneIds) {
    const plate = byScene.get(sceneId);
    if (plate) plates.push(plate);
    else faults.push({ where: sceneId, what: "no plate for this scene" });
  }
  if (plates.length === 0) {
    faults.push({ where: "root", what: "no plate survived — there is nothing to draw" });
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
      /* Counted off the plates that came back, so the report can be reconciled
         against the artefact it is a report of rather than describing a list
         that no longer exists. */
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
  seen: ReadonlyMap<string, IllustratedPlate>,
  faults: IllustratedFault[],
  where: string,
  trust: Trust,
): { plate: IllustratedPlate | null; written: number } {
  const drop = (what: string): { plate: null; written: number } => {
    faults.push({ where, what });
    return { plate: null, written: countVignettes(raw) };
  };
  if (!isObj(raw)) return drop("not an object");

  const sceneId = str(raw.sceneId);
  if (!sceneId) return drop("no sceneId — nothing says which scene this is of");
  /* A plate for a scene the Sketch has not got is a picture of nothing, and
     drawing it would spend money to find that out. Decided here rather than by
     the caller afterwards, so that what the report counts is what came back. */
  if (!opts.sceneIds.includes(sceneId)) {
    return drop(`no scene in the Sketch has the id "${sceneId}" — not drawn`);
  }
  /* Two plates of one scene is not a second picture, it is an ambiguous one:
     the panel's scene row addresses a plate by its scene id, so the reader
     would reach whichever the lookup happened to find. The second goes. */
  if (seen.has(sceneId)) return drop(`a second plate of scene "${sceneId}" — dropped`);

  const prompt = bounded(raw.prompt, MAX_PROMPT_CHARS, "prompt");
  if ("bad" in prompt) return drop(`${prompt.bad} — nothing to draw, so the plate goes`);

  /* **The trust boundary, in four lines.** `image` names a blob in a store
     shared by every article and `failed` is one of our own sentences; a model
     that could write either could claim somebody else's picture or invent a
     state no run produces. See the header. */
  if (trust === "model" && (!missing(raw.image) || !missing(raw.failed))) {
    return drop("a brief may not name an image or a failure — the whole plate is dropped");
  }

  const { vignettes, written } = readVignettes(raw.vignettes, opts, faults, where);

  const brief: IllustratedPlateBrief = {
    sceneId,
    title: readTitle(raw.title, faults, where, trust),
    prompt: prompt.ok,
    vignettes,
  };

  if (vignettes.length === 0) {
    /* **The anchor floor.** From a model, a plate nothing in the article
       anchors is not worth drawing — this mode's whole claim is that the
       picture comes from the piece. From storage it is kept: the money is spent
       and the bytes exist, and the likeliest cause is an article re-extraction
       moving the block ids under a perfectly good picture. */
    if (trust === "model") return drop("no vignette survived — nothing anchors this plate");
    faults.push({ where, what: "no vignette survived — the picture has no rows under it" });
  }

  const plate = trust === "model" ? brief : withStoredOutcome(brief, raw, faults, where);
  return { plate, written };
}

/**
 * The vignettes of one plate: parsed, capped, de-duplicated, and counted for
 * the report **as the model wrote them** rather than as they survived.
 */
function readVignettes(
  raw: unknown,
  opts: IllustratedReadOptions,
  faults: IllustratedFault[],
  where: string,
): { vignettes: IllustratedVignette[]; written: number } {
  let all: unknown[] = [];
  if (Array.isArray(raw)) all = raw;
  else if (!missing(raw)) faults.push({ where, what: "vignettes is not a list" });
  const looked = all.slice(0, MAX_VIGNETTES);
  if (all.length > looked.length) {
    faults.push({
      where,
      what: `${all.length - looked.length} vignette(s) past the ${MAX_VIGNETTES} cap were not read`,
    });
  }

  const vignettes: IllustratedVignette[] = [];
  const already = new Set<string>();
  for (const [j, rv] of looked.entries()) {
    const at = `${where}.vignettes[${j}]`;
    const v = readVignette(rv, opts, faults, at);
    if (!v) continue;
    /* The same thing drawn twice is one row in the reader's list twice, and one
       instruction to the illustrator twice. Cheap to drop, and it is evidence
       the model lost its place. */
    const key = `${v.block} ${v.quote} ${v.depicts}`;
    if (already.has(key)) {
      faults.push({ where: at, what: "the same vignette again — dropped" });
      continue;
    }
    already.add(key);
    vignettes.push(v);
  }

  return { vignettes, written: all.length };
}

/**
 * **The half of a stored plate a model never writes**: the picture, or the
 * sentence saying why there is not one.
 *
 * `image` is written from bytes we received (src/illustrated-image.ts) and
 * `failed` is one of our own sentences, so both are read back rather than
 * refused. Both at once is a state no run produces, so it is a corrupt record —
 * and the picture claim is the dangerous half, so that is the half that goes.
 */
function withStoredOutcome(
  brief: IllustratedPlateBrief,
  raw: Record<string, unknown>,
  faults: IllustratedFault[],
  where: string,
): IllustratedPlate {
  const said = str(raw.failed);
  const failed = said.slice(0, MAX_FAILED_CHARS);
  const image = missing(raw.image) ? null : readImage(raw.image);
  if (!missing(raw.image) && !image) {
    faults.push({ where, what: "the image record is not one — the plate is shown as undrawn" });
  }
  if (said.length > MAX_FAILED_CHARS) {
    faults.push({
      where,
      what: `the failure sentence was over the ${MAX_FAILED_CHARS} cap and was cut`,
    });
  }
  if (image && failed) {
    faults.push({ where, what: "a picture and a failure on one plate — the picture is dropped" });
    return { ...brief, failed };
  }
  if (image) return { ...brief, image };
  if (failed) return { ...brief, failed };
  return brief;
}

/**
 * The plate's name in the reader's scene row, or `""` — **and the `""` is
 * reported.**
 *
 * A title is decoration rather than a claim, so losing one does not cost the
 * plate. It is still a repair, and a repair nothing counts is how a model that
 * has stopped following the schema reports a clean run. An artefact of ours
 * carrying `""` is one we wrote that way and is not faulted again.
 */
function readTitle(
  raw: unknown,
  faults: IllustratedFault[],
  where: string,
  trust: Trust,
): string {
  if (missing(raw) || str(raw) === "") {
    if (trust === "model") faults.push({ where, what: "no title — the plate is nameless" });
    return "";
  }
  const title = bounded(raw, MAX_TITLE_CHARS, "title");
  if ("bad" in title) {
    faults.push({ where, what: `${title.bad} — dropped, the plate is nameless` });
    return "";
  }
  return title.ok;
}

/** How many vignettes a plate claimed, even when the plate itself is rubbish. */
function countVignettes(raw: unknown): number {
  return isObj(raw) && Array.isArray(raw.vignettes) ? raw.vignettes.length : 0;
}

/**
 * A stored plate's image record, or `null` if it is not one.
 *
 * The numbers are bounded as well as positive. They are ours, so this is not
 * about a hostile provider; it is about a record that has been through a
 * database column, a JSON round trip and possibly an older schema, and about
 * `width`/`height` being what the panel reserves space with. A fractional or
 * twenty-thousand-pixel claim is a broken record whichever way it got that way.
 */
function readImage(raw: unknown): IllustratedImage | null {
  if (!isObj(raw)) return null;
  const sha256 = str(raw.sha256);
  if (!/^[0-9a-f]{64}$/.test(sha256) || raw.ext !== "jpeg") return null;
  const nums: Record<"bytes" | "width" | "height", number> = { bytes: 0, width: 0, height: 0 };
  for (const k of ["bytes", "width", "height"] as const) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return null;
    nums[k] = v;
  }
  if (nums.bytes > MAX_IMAGE_BYTES) return null;
  if (nums.width > MAX_IMAGE_EDGE || nums.height > MAX_IMAGE_EDGE) return null;
  return { sha256, ext: "jpeg", bytes: nums.bytes, width: nums.width, height: nums.height };
}

/**
 * The plates that actually have a picture — a count, not a row list.
 *
 * **This said the panel's plate row is built from it, and stage 4 did the
 * opposite on purpose.** That sentence also carried its own refutation: a plate
 * filtered out of the row cannot "say so", it simply is not there, and a gap is
 * exactly what docs/project/diagram.md § Illustrated says a failed plate must
 * not be. `src/web/IllustratedView.tsx` lists every plate and draws the
 * failure sentence in place of the picture.
 *
 * So what is left for this is the question it really answers — *how many of
 * them came out* — which is what `src/pipeline.ts` logs at the end of a run.
 */
export function drawnPlates(illustrated: Illustrated): IllustratedPlate[] {
  return illustrated.plates.filter((p) => p.image !== undefined);
}
