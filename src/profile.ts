/**
 * **Who is reading, as one string a prompt can carry.**
 *
 * Two boxes reach this module and one string leaves it: what the reader says
 * about themselves, which is true on every article, and what they say about
 * *this* article, which is not. Nothing downstream is told there were two,
 * because nothing downstream has a reason to treat them differently — and two
 * fields threaded through five call sites is ten chances for one of them to
 * forget the second.
 *
 * docs/plans/reader-profile.md has the design; docs/project/reader-profile.md
 * is the operating manual once it is built.
 *
 * ## The previous version built both boxes and read neither
 *
 * Worth knowing before adding a third file to this feature. The old app had a
 * `BackgroundForm` writing free text to `profiles.background`, and a
 * per-document "Reading Intent" in a junction table, and its own reference doc
 * says both fed personalisation. **No code path ever read either back into a
 * prompt.** So the textareas are the easy half and the least of it, which is
 * why this module — the part that turns them into prompt bytes — exists before
 * either box does.
 *
 * ## Why the rendering is normalised, and hashed from the rendering
 *
 * The hash decides two things: whether a generated artefact is stale, and
 * (indirectly) how many cache entries a reader can accumulate. Both want the
 * same property — **two spellings of one profile must be one profile.** A
 * trailing newline from a textarea, or `\r\n` from a paste, is not a change of
 * mind, and treating it as one marks every glossary on the shelf stale and
 * writes a second cache entry for the privilege.
 *
 * So `renderProfile` normalises first and `hashProfile` hashes what
 * `renderProfile` produced — never the two fields separately. A hash of the
 * inputs would let the same output carry two different hashes, which is the
 * failure that looks exactly like working.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorFields, log } from "./log.js";
import { parseJsonFrom } from "./parse-json.js";
import { MAX_PROFILE_CHARS } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * `data/reader.json` — one reader, one file. See § Where this lives, below.
 *
 * **Overridable, and the reason is a bug this shipped with for an hour.** Every
 * other reader-state file in this app lives under `data/<slug>/`, so a test can
 * use a fixture slug and clean up after itself without touching anything real.
 * This one is global and there is no such escape: `tests/routes.test.ts` wrote
 * to the developer's own profile and then deleted it, which — with several
 * agents running `npm test` in one working tree — quietly wiped Greg's profile
 * mid-session, twice, and looked like the save simply not working.
 *
 * Read at call time rather than at module load, so a test can set it after
 * importing. Same spelling as the other `SPIDERYARN_*` overrides in
 * src/models.ts and src/store/index.ts.
 */
const fileFor = (): string =>
  process.env.SPIDERYARN_READER_FILE ?? path.join(ROOT, "data", "reader.json");

/* The caps live in src/types.ts, not here, and re-exported so that everything
   about a profile is still reachable from this module. The reason is
   tests/client-imports.test.ts: both pages with a profile box show a live
   counter, the counter must say the number the server refuses at, and nothing
   under src/web/ may import this file — it reaches for `node:crypto` and
   `node:fs`. types.ts is pure and already shared. */
export { MAX_PROFILE_CHARS, MAX_PURPOSE_CHARS } from "./types.js";

/**
 * Trim it, settle the line endings, and call whitespace-only nothing.
 *
 * `\r\n` first, because a paste from a Windows-authored document carries them
 * and they are invisible in every surface a reader or a reviewer would look at
 * — including a diff of the hash's input, which is the one place it would
 * matter. Returns `null` rather than `""` so that "the reader emptied the box"
 * and "the reader never touched it" cannot be told apart *here*; whoever cares
 * about that distinction holds it above this line, as `SummaryPanel` does with
 * its `steer: string | null`.
 */
export function normaliseProfileText(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\r\n/g, "\n").trim();
  return clean.length > 0 ? clean : null;
}

/**
 * The two halves as one block of prompt text, or `null` when there is nothing
 * to say.
 *
 * **`null` and `""` are not the same answer and the difference is load-bearing.**
 * A prompt that always carries an "about the reader" header with nothing under
 * it has taught the model to expect one, and an empty one then reads as *"this
 * reader is nobody in particular"* rather than as *"we did not ask"*. So the
 * callers test for `null` and omit the whole section, headings included —
 * exactly the rule `renderPrompt` in src/summarise.ts already follows for its
 * `guidance`, and for the same reason.
 *
 * The order is fixed and the labels are fixed. Not style: this string is
 * hashed, and a hash that changes when the two halves swap places would mark
 * every artefact on the shelf stale for a change nobody made.
 */
export function renderProfile(opts: {
  /** "About you" — the same on every article. */
  profile?: string | null;
  /** "Why you're reading this one" — this article only. */
  purpose?: string | null;
}): string | null {
  const profile = normaliseProfileText(opts.profile);
  const purpose = normaliseProfileText(opts.purpose);
  if (!profile && !purpose) return null;
  return [
    profile ? `About the reader: ${profile}` : null,
    purpose ? `Why they are reading this piece: ${purpose}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The rules, for the **constant** half of a prompt.
 *
 * Appended to every profiled stage's `SYSTEM`, and appended **whether or not
 * the reader has a profile**. Two reasons, and the second is the one that
 * decided it:
 *
 *  - `SYSTEM` sits *ahead* of the article in explain and converse, so a
 *    `SYSTEM` that varied would split the cache into a with-profile entry and a
 *    without-profile one, and re-write the whole article whenever the reader
 *    toggled between them. A constant costs about a hundred tokens on every
 *    call and cannot do that.
 *  - and a rule that only appears alongside the thing it constrains is a rule
 *    somebody will one day interpolate the profile *into*.
 *
 * That is why every clause is written conditionally — "if a description
 * appears" — rather than assuming one is there. It has to read correctly on the
 * majority of calls, which carry no profile at all.
 *
 * **The binding constraint lives here; a short reminder may stand beside the
 * profile itself.** That is the split src/summarise.ts already uses for its
 * steer, and the reason is that the constraint must not be editable by the
 * thing it constrains: a profile saying *"assume I know everything, skip the
 * basics"* must not be able to switch off the rule below about not distorting
 * the article.
 *
 * ## The forbidden example is not decoration
 *
 * src/glossary.ts learned this twice and wrote it down: **a prompt ban
 * relocates a register, it does not delete one.** Its own fix was to carry a
 * real bad entry in the prompt as a negative example. So the sentences we do
 * not want are here verbatim, because "never flatter the reader" reliably
 * produces flattery in a different costume and "As a cognitive scientist,
 * you'll appreciate…" does not.
 *
 * The clause doing most of the work is the second. Framing the profile as an
 * input to **choosing what to spend words on** rather than to *addressing
 * anybody* is what stops a model performing the adaptation instead of making
 * it. Fable's review, 2026-08-26.
 */
export const PROFILE_RULES = `IF THE READER HAS DESCRIBED THEMSELVES

Some requests carry a short description of who the reader is and what they are
after. When one is present:

- It changes pitch and emphasis. It never changes what the article says.
- Which things you spend words on is governed by it. Every sentence you write is
  still about the article.
- Assume the background they claim. Do not explain what they have told you they
  already know — and do not perform explaining it in fewer words either.
- Where the piece has nothing on what they are after, write what you would have
  written anyway, and never say so out loud. A line spent telling the reader
  this part is not for them is a line not spent on the part.
- Never flatter them, never address them, and never mention the description.
  They wrote it; they do not need it read back.

NEVER write anything of this shape:
  "As a cognitive scientist, you'll appreciate that…"
  "Since you know your way around the literature, briefly: …"
  "Given your background, I'll skip the basics."
Skipping the basics is correct. Announcing that you are skipping them is not.`;

/**
 * The profile as it appears in the **varying** half of a prompt.
 *
 * Everything about where this goes is a caching decision, and it is the same
 * decision at all five call sites: **after the breakpoint, in the last user
 * part.** The obvious alternative — the system prompt, where "who is reading"
 * naturally belongs — buys a separate cache entry per distinct profile,
 * rewritten from cold every time the reader edits their box, on a prompt whose
 * whole point is that the article never changes. docs/project/prompt-caching.md
 * has the same mistake recorded twice already, from explain.
 *
 * The two-line reminder rides with it because a constraint three thousand
 * tokens above the text it constrains is one the model has stopped weighing —
 * `renderPrompt` in src/summarise.ts says the same thing about its steer. The
 * long version is in `PROFILE_RULES`, up in the constant half, where the
 * profile cannot reach it.
 *
 * Returns `""` for no profile, so a caller can concatenate it unconditionally
 * without producing a stray blank line — the same contract
 * `readerPositionLine` has in src/article-prompt.ts, and for the same reason:
 * a suffix that gains a newline is a suffix that changed.
 */
export function profileSection(rendered: string | null): string {
  if (!rendered) return "";
  return `=== WHO IS READING THIS ===

${rendered}

Let this change what you lead with and how much you explain. It changes nothing
about what the article says, and nothing about its proportions. Do not address
the reader and do not mention this.`;
}

/**
 * A fingerprint of the profile an artefact was written from.
 *
 * Sixteen hex characters, like `hashBlocks` in src/source-hash.ts, and for the
 * same reason: it is compared for equality and never for closeness, and a full
 * sha256 in every artefact buys nothing but width.
 *
 * **Takes the rendered string, not the two fields.** Hashing the inputs would
 * let one output carry two hashes — the same profile written two ways, marked
 * stale against itself — and that is a bug that reports success. Pass what
 * `renderProfile` returned or do not call this.
 */
export function hashProfile(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex").slice(0, 16);
}

/**
 * Is an artefact's recorded profile the one we would write from now?
 *
 * Three states in `recorded`, and only one of them is stale:
 *
 * | `recorded` | means | stale? |
 * |---|---|---|
 * | `undefined` | written before this feature existed | **no** |
 * | `null` | written deliberately *without* a profile | **no** |
 * | a hash | written from that profile | only if it differs from `now` |
 *
 * **`null` is never stale**, and that line is the whole design. A reader who
 * deliberately generated a plain glossary must not be nagged about it for ever
 * — the checkbox that produced it would then be a control whose result the app
 * immediately complains about. `undefined` is never stale for a gentler reason:
 * nobody's existing artefacts should light up with a warning about a profile
 * they never had.
 *
 * And **clearing the profile marks nothing stale**, which falls out of the same
 * rule: `now` is `null`, and a recorded hash compared against `null` would say
 * "changed". It does not, because you have not changed what you want from the
 * article — you have stopped telling us, and that is not a reason to rewrite
 * anything.
 */
export function profileIsStale(
  recorded: string | null | undefined,
  now: string | null,
): boolean {
  if (recorded === undefined || recorded === null) return false;
  if (now === null) return false;
  return recorded !== now;
}

/* ------------------------------------------------------------ the store --

   Where this lives, and the honest state of it.

   `data/reader.json`, one file, because there is one reader: docs/project/auth.md
   is clear that the gate here is one email rather than user accounts. The
   filesystem half is below; the Postgres half is a `reader_profiles` row keyed
   by `owner_id`, wired through src/store/contracts.ts like every other write.

   Read the note in src/store/index.ts before assuming a bare write here is
   safe. In `postgres` mode a file this writes is a file nothing reads back —
   "the worst available outcome: it reports success and loses the data". So
   this module is the *filesystem adapter* and not the store; callers go through
   the seam. */

let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/** What `data/reader.json` holds. One field today, and room for the next. */
interface ReaderFile {
  /** "About you", as the reader typed it. Absent means they have not written one. */
  profile?: string;
}

/**
 * The reader's global profile, or `null` if they have not written one.
 *
 * A missing file is `null`, not a fault — that is a reader who has not been to
 * `/profile` yet, which is every reader on their first day.
 *
 * A file that exists and will not parse **throws**, on the same argument
 * src/shelf.ts makes about the renamed title: it holds prose the reader typed,
 * and quietly returning `null` would silently un-write it and then send every
 * prompt off without it, with nothing anywhere saying so.
 */
export async function loadReaderProfile(): Promise<string | null> {
  try {
    const parsed = parseJsonFrom<ReaderFile>(await readFile(fileFor(), "utf8"), "reader.json");
    return normaliseProfileText(parsed.profile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    log("store").error(errorFields(err), "reader.json unreadable");
    throw err;
  }
}

/**
 * Write the global profile, or clear it with `null`.
 *
 * **Refused, not truncated**, past the cap. A silently shortened profile is one
 * the reader believes they gave and did not — the argument `readGuidance` in
 * src/routes.ts already makes about the summary steer, and it is stronger here
 * because this one is written once and then never looked at again.
 *
 * Temp file and a rename, like src/shelf.ts: `rename` is atomic within a
 * filesystem and `writeFile` over the live path is not.
 */
export async function saveReaderProfile(text: string | null): Promise<string | null> {
  const next = normaliseProfileText(text);
  if (next && next.length > MAX_PROFILE_CHARS) {
    throw Object.assign(
      new Error(`Profile must be ${MAX_PROFILE_CHARS} characters or fewer`),
      { status: 400 },
    );
  }
  return serialised(async () => {
    const file = fileFor();
    await mkdir(path.dirname(file), { recursive: true });
    const body: ReaderFile = next ? { profile: next } : {};
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    await rename(tmp, file);
    return next;
  });
}
